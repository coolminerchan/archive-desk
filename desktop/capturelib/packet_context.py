"""Minimal header evidence for the two request families needed by archives."""
import hashlib
import json
from pathlib import Path
import re
from uuid import uuid4

REQUESTS = {'GetOneTypeLifePictorialBookCountReq': (1365, 'life_type'), 'FriendReq': (1739, 'type')}
RESPONSES = {'GetOneTypeLifePictorialBookCountRsp': 1366, 'GetLifeInfoRsp': 1370, 'FriendRsp': 1740}
CODES = {**{name: value[0] for name, value in REQUESTS.items()}, **RESPONSES}
FILENAME = 'packet-context.json'


def uint(value):
    return type(value) is int and 0 <= value <= 0xffffffff


class PacketContexts:
    def __init__(self, document=None):
        self.scope = uuid4().hex
        self.records = {}
        self.incomplete_streams = set()
        self.available = document is not None
        if document is not None:
            if not isinstance(document, dict) or type(document.get('schema_version')) is not int or document.get('schema_version') != 1 or document.get('kind') != 'packet_context':
                raise ValueError('请求上下文格式无效')
            self.scope = document.get('capture_scope')
            rows = document.get('records')
            if not isinstance(self.scope, str) or not re.fullmatch('[a-f0-9]{32}', self.scope) or not isinstance(rows, list) or len(rows) > 20000:
                raise ValueError('请求上下文超过限制或缺少连接范围')
            for row in rows:
                self.validate(row)
                if row['source'] in self.records:
                    raise ValueError('请求上下文含重复来源')
                self.records[row['source']] = dict(row)

    def validate(self, row):
        if not isinstance(row, dict) or row.get('message') not in CODES:
            raise ValueError('请求上下文包含不支持的协议')
        name = row['message']
        direction = 'c2s' if name in REQUESTS else 's2c'
        if (row.get('direction') != direction or row.get('msg_id') != CODES[name]
                or not all(uint(row.get(key)) for key in ('packet_id', 'seq_id', 'stream_id'))
                or row.get('connection_id') != f"{self.scope}:s{row['stream_id']}"
                or type(row.get('connection_incomplete')) is not bool or type(row.get('decode_error')) is not bool):
            raise ValueError('请求上下文字段无效')
        expected = rf"raw/\d+_s{row['stream_id']}_{direction}_{CODES[name]}_{name}\.bin"
        if not isinstance(row.get('source'), str) or not re.fullmatch(expected, row['source']):
            raise ValueError('请求上下文来源路径无效')
        if not isinstance(row.get('body_sha256'), str) or not re.fullmatch('[a-f0-9]{64}', row['body_sha256']):
            raise ValueError('请求上下文缺少内容校验值')
        fields = row.get('request_fields')
        if name in REQUESTS:
            key = REQUESTS[name][1]
            if fields is not None and (not isinstance(fields, dict) or set(fields) != {key}
                                       or type(fields[key]) is not int or not -(1 << 31) <= fields[key] < (1 << 31)):
                raise ValueError('请求分类字段无效')
        elif fields is not None:
            raise ValueError('响应上下文不能携带推测的请求分类')

    def add(self, proto, name, raw, packet, sid, direction, stem, *, incomplete=False):
        if name not in CODES or direction != ('c2s' if name in REQUESTS else 's2c'):
            return
        fields = None
        failed = bool(packet.get('decompress_err'))
        if name in REQUESTS and not failed:
            try:
                key = REQUESTS[name][1]
                fields = {key: int(getattr(getattr(proto, name).FromString(raw), key))}
            except Exception:
                failed = True
        row = dict(source='raw/' + stem + '.bin', message=name, msg_id=packet['msg_id'],
            packet_id=packet['packet_id'], seq_id=packet['seq_id'], stream_id=sid,
            connection_id=f'{self.scope}:s{sid}', direction=direction,
            body_sha256=hashlib.sha256(raw).hexdigest(), request_fields=fields,
            connection_incomplete=bool(incomplete), decode_error=failed)
        self.validate(row)
        if len(self.records) >= 20000:
            raise ValueError('请求上下文条数超过限制，请缩短采集')
        self.records[row['source']] = row
        self.available = True

    def match(self, source, name, raw):
        row = self.records.get(source)
        if row is None:
            return None
        if row['message'] != name or row['body_sha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('请求上下文与原始协议内容不一致')
        return dict(row, connection_incomplete=row['connection_incomplete'] or row['stream_id'] in self.incomplete_streams)

    def mark_incomplete(self, sid):
        self.incomplete_streams.add(sid)

    def document(self):
        return dict(schema_version=1, kind='packet_context', capture_scope=self.scope,
                    records=[dict(row, connection_incomplete=row['connection_incomplete'] or row['stream_id'] in self.incomplete_streams)
                             for row in self.records.values()])

    def write(self, output):
        if self.available:
            (Path(output) / FILENAME).write_text(json.dumps(self.document(), ensure_ascii=False), encoding='utf-8')


def read_contexts(path, *, archive=False):
    if archive:
        from archive_files import ArchiveView
        with ArchiveView(path) as view:
            if FILENAME not in view.members:
                return PacketContexts()
            document = json.loads(view.read(FILENAME, 16 << 20).decode('utf-8-sig'))
            context = PacketContexts(document)
            if any(source not in view.members for source in context.records):
                raise ValueError('请求上下文引用的原始文件不存在')
            return context
    source = Path(path) / FILENAME
    if not source.is_file():
        return PacketContexts()
    if source.stat().st_size > 16 << 20:
        raise ValueError('请求上下文超过读取限制')
    return PacketContexts(json.loads(source.read_text(encoding='utf-8-sig')))
