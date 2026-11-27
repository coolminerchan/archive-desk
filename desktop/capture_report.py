"""Local capture analysis. Response evidence is never a claim of full account coverage."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import time
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / 'capturelib'))
import equipment_audit
import checklist
from account_identity import AccountIdentityIndex
import capture_quality
import dungeons as dungeon_module
from archive_files import ArchiveView, garden_owner
from own_scenes import OwnScenes
from capture_version import VERSION
from packet_context import REQUESTS as CONTEXT_REQUESTS, FILENAME as CONTEXT_FILE, read_contexts
from life_social import LifeSocial, quality_items as life_social_quality, render_report as render_life_social
from world_activities import render_report as render_world_activities

MAX_FILE = 512 << 20
MAX_MESSAGE = 32 << 20
MAX_TOTAL = 256 << 20
PACKET = re.compile(r'_(s2c|c2s|d0to1|d1to0)_(\d+)_([A-Za-z0-9_]+)$')


def load_parser(toolkit):
    os.environ['OVERFIELD_CAPTURE_TOOLKIT'] = str(toolkit)
    sys.path.insert(0, str(toolkit / 'proto_gen'))
    import parse_pcap
    class BoundedProcess:
        @staticmethod
        def run(*args, **kwargs):
            import subprocess
            kwargs.setdefault('timeout', 35)
            if os.name == 'nt':
                kwargs.setdefault('creationflags', subprocess.CREATE_NO_WINDOW)
            if kwargs.get('text'):
                kwargs.setdefault('encoding', 'utf-8')
                kwargs.setdefault('errors', 'replace')
            return subprocess.run(*args, **kwargs)
    parse_pcap.subprocess = BoundedProcess
    return parse_pcap


def zip_packets(path, parser, *, include_gardens=False):
    """No extraction, bounded sizes, duplicate rejection, binary preferred over JSON."""
    from google.protobuf.json_format import ParseDict
    by_code = parser.load_cmd_map()
    with ArchiveView(path, nested_gardens=include_gardens) as archive:
        selected, seen = {}, set()
        for logical, (_, info) in archive.members.items():
            name = PurePosixPath(logical)
            owner = garden_owner(logical)
            directory = name.parent.parts
            owned = (len(directory) == 2 and directory[0].isdigit() and directory[1] in ('raw', 'json') or
                     len(directory) == 3 and directory[0] == 'gardens' and directory[1].isdigit() and directory[2] in ('raw', 'json'))
            garden_prefix = str(owner) if owned else None
            if directory not in {('raw',), ('json',)} and not (include_gardens and owned):
                continue
            if name.suffix not in ('.bin', '.json'):
                continue
            match = PACKET.search(name.stem)
            if not match:
                continue
            code, packet_name = int(match[2]), match[3]
            if code in parser.LOGIN_REQUEST_IDS:
                continue
            request = packet_name in CONTEXT_REQUESTS and match[1] == 'c2s' and not owned
            if packet_name.endswith('Req') and not request:
                continue
            if match[1] == 'c2s' and not request:
                continue
            canonical = by_code.get(code)
            if canonical and canonical != packet_name:
                raise ValueError('协议 ID 与响应文件名不一致')
            if not canonical and packet_name != 'Unknown_' + str(code):
                continue
            if canonical and not canonical.endswith(('Rsp', 'Notice')) and not request:
                continue
            if owned and code not in parser.GARDEN_SCENE_NOTICE_IDS | {parser.SCENE_DATA_NOTICE_ID}:
                continue
            if not canonical and name.suffix != '.bin':
                continue
            key = f'g{garden_prefix}_{name.stem}' if garden_prefix and not name.stem.startswith(f'g{garden_prefix}_') else name.stem
            versions = selected.setdefault(key, {})
            if name.suffix in versions:
                raise ValueError('ZIP 含重复的协议响应')
            versions[name.suffix] = (logical, info, packet_name, code, owner if owned else None)
        total = 0
        for stem, versions in sorted(selected.items()):
            logical, info, name, code, owner = versions.get('.bin') or versions['.json']
            total += info.file_size
            if info.file_size > MAX_MESSAGE or total > MAX_TOTAL:
                raise ValueError('ZIP 响应超过处理预算')
            raw = archive.read(logical)
            if name.startswith('Unknown_'):
                yield stem, code, name, raw, None, 'unknown_protocol'
                continue
            try:
                if logical.endswith('.json'):
                    data = json.loads(raw.decode('utf-8-sig'))
                    if not isinstance(data, dict) or any(re.fullmatch(r'field_\d+', k) for k in data):
                        raise ValueError('未解码的协议字段')
                    raw = ParseDict(data, getattr(parser.net_pb2, name)(), ignore_unknown_fields=True).SerializeToString()
                if name == 'PlayerLoginRsp':
                    login = parser.net_pb2.PlayerLoginRsp.FromString(raw)
                    login.ClearField('client_log_server_token')
                    raw = login.SerializeToString()
                body, error = parser.decode_proto_body(name, raw)
            except Exception:
                body, error = None, 'decode_failed'
            if owner is not None and name == 'SceneDataNotice' and body is not None:
                scene = parser.net_pb2.SceneDataNotice.FromString(raw).data
                if int(scene.channel_id or scene.channel_label or 0) != owner:
                    raise ValueError('装修目录编号与场景归属不一致')
                from exploration import is_garden_scene
                if not is_garden_scene(scene):
                    raise ValueError('装修目录中包含非家园场景')
            yield stem, code, name, raw, body, error


def layout_only_zip(path, parser, layouts, names):
    """Read layout metadata too, retaining names when scene packets lack owners."""
    with ArchiveView(path, nested_gardens=True) as archive:
        members = set(archive.members)
        total = 0
        for logical, (_, info) in archive.members.items():
            member = PurePosixPath(logical)
            directory = member.parent.parts
            if directory and directory != ('gardens',) and not (len(directory) == 1 and directory[0].isdigit()) and not (len(directory) == 2 and directory[0] == 'gardens' and directory[1].isdigit()):
                continue
            match = re.fullmatch(r'garden_(\d+)_.+items\.json', member.name)
            if not match:
                continue
            if info.file_size > MAX_MESSAGE:
                raise ValueError('装修索引超过读取上限')
            data = json.loads(archive.read(logical).decode('utf-8-sig'))
            if not isinstance(data, dict) or not isinstance(data.get('_meta'), dict):
                raise ValueError('装修索引格式无效')
            meta = data['_meta']
            owner = meta.get('owner_uid')
            if type(owner) is not int:
                raise ValueError('装修包屋主编号格式无效')
            if not 0 < owner <= 0xffffffff or owner != int(match[1]) or meta.get('scene_id') != 9999:
                raise ValueError('装修包屋主编号或场景记录不一致')
            declared = garden_owner(logical)
            if declared is not None and declared != owner:
                raise ValueError('装修包目录编号与索引不一致')
            leaf = meta.get('bin_file')
            if not isinstance(leaf, str) or PurePosixPath(leaf).name != leaf or '\\' in leaf or ':' in leaf:
                raise ValueError('装修布局文件路径无效')
            leaf = (member.parent / leaf).as_posix()
            if leaf not in members:
                raise ValueError('装修布局文件不存在')
            binary = archive.members[leaf][1]
            total += binary.file_size + info.file_size
            if binary.file_size > MAX_MESSAGE or total > MAX_TOTAL:
                raise ValueError('装修布局超过读取上限')
            layout = parser.net_pb2.SceneGardenData.FromString(archive.read(leaf))
            # Original scene evidence takes precedence over layout metadata.
            layouts.setdefault(owner, layout)
            nickname = meta.get('owner_name')
            if isinstance(nickname, str) and nickname.strip() and len(nickname) <= 256 and nickname not in ('未知玩家', '未知屋主'):
                names.setdefault(owner, nickname)


def analyze(path, output, toolkit, session_timings=None, purpose='account'):
    if purpose not in ('account', 'gardens', 'scenes'):
        raise ValueError('采集模块无效')
    analysis_started = time.perf_counter()
    parser = load_parser(toolkit)
    output.mkdir(parents=True, exist_ok=False)
    source_summary, integrity_known = {}, False
    if path.stat().st_size > MAX_FILE:
        raise ValueError('单个采集文件超过 512 MB，请缩短采集或拆分离线处理')
    if path.suffix.lower() in ('.pcap', '.pcapng'):
        with redirect_stdout(io.StringIO()):
            parser.analyze_pcap(path, output, write_account_archive=False)
        source_summary = json.loads((output / 'summary.json').read_text(encoding='utf-8-sig'))
        integrity_known = True
        packets = zip_or_export_packets(output, parser)
    elif path.suffix.lower() == '.zip':
        with ZipFile(path) as archive:
            for key in ('summary.json', 'export/summary.json'):
                if key in archive.namelist():
                    info = archive.getinfo(key)
                    if info.file_size > 2 << 20:
                        raise ValueError('采集摘要过大')
                    source_summary = json.loads(archive.read(info).decode('utf-8-sig'))
                    if not isinstance(source_summary, dict):
                        raise ValueError('采集摘要格式无效')
                    integrity_known = 'incomplete_streams' in source_summary
                    break
        packets = zip_packets(path, parser, include_gardens=purpose == 'gardens')
    else:
        raise ValueError('请选择 PCAP、PCAPNG 或账号 ZIP')

    audit_started = time.perf_counter()
    contexts = read_contexts(output) if path.suffix.lower() != '.zip' else read_contexts(path, archive=True)
    life_social = LifeSocial(parser.net_pb2)
    included_stems = set()
    counts, empty = Counter(), Counter()
    messages, decoded_counts, account_data = [], Counter(), {}
    identities = AccountIdentityIndex()
    failures, rejected, successful = 0, 0, 0
    unknown_messages = Counter()
    garden_layouts, garden_names = {}, {}
    garden_packets, current_gardens, own_garden_counts = defaultdict(list), {}, Counter()
    own_scenes = OwnScenes(parser.net_pb2, output)
    from exploration import Exploration
    exploration = Exploration(parser.net_pb2)
    dungeons = dungeon_module.Dungeons(parser.net_pb2)
    for stem, code, name, raw, body, error in packets:
        included_stems.add(stem)
        if path.suffix.lower() == '.zip':
            # Preserve opaque and failed responses for future protocol support.
            # A login response that cannot be sanitized is deliberately omitted.
            (output / 'raw').mkdir(exist_ok=True)
            if code != 1004 or not error:
                (output / 'raw' / (stem + '.bin')).write_bytes(raw)
            if body is not None:
                (output / 'json').mkdir(exist_ok=True)
                (output / 'json' / (stem + '.json')).write_text(json.dumps(body, ensure_ascii=False), encoding='utf-8')
        if purpose != 'gardens':
            source = 'raw/' + stem + '.bin'
            life_social.add(name, raw, source, contexts.match(source, name, raw), error=error)
        if name in CONTEXT_REQUESTS:
            continue
        if code in equipment_audit.NAMES:
            messages.append((code, None if error else raw))
        if error == 'unknown_protocol':
            unknown_messages[str(code)] += 1
            continue
        if error or not isinstance(body, dict):
            failures += 1
            continue
        if name.endswith('Rsp') and body.get('status') not in (1, 'StatusCode_OK'):
            rejected += 1
            continue
        if name.endswith('Notice') and body.get('status') not in (None, 0, 1, 'StatusCode_NONE', 'StatusCode_OK'):
            rejected += 1
            continue
        successful += 1
        decoded_counts[name] += 1
        parser.collect_player_profile(name, body, garden_names)
        checklist.observe(name, body, counts, empty)
        exploration.add(name, raw, {'packet_stem': stem, 'direction': 's2c'})
        dungeons.add(name, raw, {'packet_stem': stem, 'direction': 's2c'})
        stream = re.search(r'_s(\d+)_', stem)
        stream = stream[1] if stream else '0'
        scope = re.match(r'g(\d+)_', stem)
        stream = (scope[1] if scope else 'account') + ':' + stream
        if name == 'SceneDataNotice':
            scene = parser.net_pb2.SceneDataNotice.FromString(raw).data
            if purpose != 'gardens':
                own_scenes.add(scene, 'raw/' + stem + '.bin')
            owner = parser.collect_garden_scene(scene, garden_layouts, garden_names)
            current_gardens[stream] = owner
            if owner is not None:
                garden_packets[owner].append(stem)
                own_garden_counts[owner] += 1
        elif code in parser.GARDEN_SCENE_NOTICE_IDS and current_gardens.get(stream) is not None:
            garden_packets[current_gardens[stream]].append(stem)
        if name == 'PlayerMainDataRsp':
            uid = body.get('player_id')
            if uid:
                identities.add(uid, body.get('player_label'))
                account_data[str(uid)] = {key: body.get(key) for key in
                    ('player_id', 'player_label', 'player_name', 'level', 'world_level')}
                account_data[str(uid)].update(characters=len(body.get('characters', [])),
                    quests=len(body.get('quest_detail', {}).get('quests', [])),
                    placed_furniture_entries=len(body.get('furniture_item_info', [])))
    for identity in identities.records():
        account_data[str(identity['player_id'])].update(identity)
    audit = equipment_audit.summarize(messages, parser.net_pb2)
    account_uid = int(next(iter(account_data))) if len(account_data) == 1 and audit['accounts'] == 1 else None
    if path.suffix.lower() == '.zip' and purpose != 'gardens':
        own_scenes.load_archive(path, identities.single())
    scenes = own_scenes.export(identities.single(), allow_declared=not bool(account_data)) if purpose != 'gardens' else None
    if counts.get('@garden'):
        counts['@garden'] = own_garden_counts.get(account_uid, 0)
    if path.suffix.lower() == '.zip':
        if purpose == 'gardens':
            layout_only_zip(path, parser, garden_layouts, garden_names)
        separated = parser.separate_garden_packets(output, garden_packets, account_uid)
        if separated or (purpose == 'gardens' and garden_layouts):
            garden_layouts.pop(account_uid, None)
            with redirect_stdout(io.StringIO()):
                parser.write_garden_backups(output / 'gardens', garden_layouts, garden_names, separated)
    gaps = source_summary.get('incomplete_streams') or []
    quality = capture_quality.summarize(source_summary, integrity_known=integrity_known,
        decode_failures=max(failures, int(source_summary.get('decode_fallback_count') or 0), audit['decode_errors']),
        unknown_packets=max(sum(unknown_messages.values()), sum(int(v) for v in (source_summary.get('unknown_msg_ids') or {}).values())), rejected=rejected)
    warnings = []
    if purpose == 'account' and (len(account_data) != 1 or audit['accounts'] != 1):
        warnings.append('未识别到唯一账号主数据。请从登录前开始，单独采集一个账号。')
    elif purpose == 'account' and identities.single() and identities.single()['uid'] is None:
        warnings.append('服务端未返回登录 UID；内部角色 ID 仅用于数据关联，未作为登录 UID 展示。')
    if quality['tcp_gap_directions']:
        warnings.append(f"{quality['tcp_gap_directions']} 个 TCP 流方向存在序列缺口；缺口前有效响应保留，不能证明整段完整。")
    if quality['tail_directions']:
        warnings.append(f"{quality['tail_directions']} 个流方向有未解析尾数据，可能是尾帧未收完或帧格式不匹配，不等同于网络丢包。")
    if failures or source_summary.get('decode_fallback_count'):
        warnings.append('有协议解码异常，可能是版本差异或数据残缺。')
    if not integrity_known:
        warnings.append('此 ZIP 未附底层流完整性记录，无法仅凭装修或响应文件核实原采集期间是否漏包。')
    if unknown_messages or source_summary.get('unknown_msg_ids'):
        warnings.append('存在未知协议 ID，原始响应已保留，需匹配该版本的协议文件进一步解析。')
    if not successful and not any((output / 'gardens').glob('garden_*.zip')) and not (scenes and scenes['scene_count']):
        warnings.append('未识别到成功的游戏响应，请核对渠道、连接范围并重新登录进入场景。')
    for kind, row in audit['equipment'].items():
        row['quantity_matches'] = row.get('list_matches', row['matches'])
        row['quantity_matches'] = bool(row['quantity_matches'] and integrity_known and not failures and not gaps and
            not source_summary.get('decode_fallback_count') and len(account_data) == 1)
        row['matches'] = bool(row['matches'] and integrity_known and not failures and not gaps and
            not source_summary.get('decode_fallback_count') and len(account_data) == 1 and not row['other_only'])
    result = checklist.report(counts, empty, phase='complete', readable=bool(successful or (scenes and scenes['scene_count'])), warning=' '.join(warnings))
    supplemental = life_social.summary(identities)
    result['items'].extend(life_social_quality(supplemental))
    result['items'] = [item for item in result['items'] if item['id'] != 'gacha_records']
    for item in result['items']:
        if item['id'] in audit['equipment'] and item['state'] in ('collected', 'empty'):
            row=audit['equipment'][item['id']]
            if not row['quantity_matches']:item.update(state='partial', status='列表需核对')
            if row.get('list_complete') and row['other_only'] and not failures and not gaps:
                item.update(detail=f"列表外 {row['other_only']} 件已保留",hint=f"已保存全部来源 {row['observed']} 件，其中列表 {row['snapshot']} 件；另外 {row['other_only']} 件来自推送。可切换其他装备类型补核对，无需重复已采列表。")
    result.update(audit, input=str(path), accounts_detail=list(account_data.values()), warnings=warnings,
        decode_errors=max(failures, int(source_summary.get('decode_fallback_count') or 0), audit['decode_errors']),
        packets=source_summary.get('total_packets', successful + failures), successful=successful,
        rejected=rejected, streams=len(source_summary.get('game_streams') or []),
        gaps=quality['tcp_gap_directions'] or 0, tail_directions=quality['tail_directions'], quality=quality,
        unknown=quality['unknown_protocol_packets'],
        unknown_ids=dict(unknown_messages) or source_summary.get('unknown_msg_ids') or {},
        integrity_known=integrity_known, messages=dict(decoded_counts),
        exploration=exploration.summary([int(uid) for uid in account_data], identities.records()),
        dungeons=dungeons.summary(identities),
        identity=identities.single(), account_uid=identities.metadata()['account_uid'],
        excluded=['gacha_records'], export=str(output), analysis_version=VERSION, purpose=purpose,
        own_scenes=scenes, life_social=life_social.summary(identities, compact=True))
    result['quality'].update(missing_categories=[item['id'] for item in result['items'] if item['state'] == 'missing'],
                            empty_categories=[item['id'] for item in result['items'] if item['state'] == 'empty'])
    result['timings'] = dict(source_summary.get('timings') or {}) if path.suffix.lower() != '.zip' else {}
    result['timings']['response_audit_ms'] = round((time.perf_counter() - audit_started) * 1000)
    result['session_timings'] = {key: value for key, value in (session_timings or {}).items()
        if key in ('preparation_ms', 'recording_ms', 'conversion_ms', 'first_response_observed_ms')
        and type(value) in (int, float) and 0 <= value < 86400000}
    backend = (session_timings or {}).get('capture_backend')
    result['capture_backend'] = backend if backend in ('compact-etw', 'buffered') else None
    garden_index = output / 'gardens/gardens_index.json'
    result['gardens'] = []
    if garden_index.is_file():
        for row in json.loads(garden_index.read_text(encoding='utf-8-sig')):
            leaf = Path(row['zip_file']).name
            if leaf != row['zip_file'] or not (output / 'gardens' / leaf).is_file():
                continue
            result['gardens'].append(dict(row, path=str(output / 'gardens' / leaf)))
    result['garden_account_identified'] = account_uid is not None
    result['gardens_bundle'] = None
    if result['gardens']:
        bundle = output / 'gardens_all.zip'
        with ZipFile(bundle, 'w', ZIP_DEFLATED) as archive:
            manifest = dict(schema_version=1, kind='garden_collection',
                account_identified=account_uid is not None,
                gardens=[{key: row[key] for key in ('owner_uid','owner_name','scene_id','furniture_count') if key in row} for row in result['gardens']])
            archive.writestr('garden_collection.json', json.dumps(manifest, ensure_ascii=False))
            for file in sorted((output / 'gardens').rglob('*')):
                if file.is_file() and file.suffix in ('.bin', '.json') and file.name != 'gardens_index.json':
                    archive.write(file, file.relative_to(output / 'gardens'))
        result['gardens_bundle'] = str(bundle)
    uid = identities.filename_key()
    if purpose == 'account' and uid is not None and len(account_data) == 1 and audit['accounts'] == 1 and successful:
        # Stable filename avoids leaking the nickname into paths and logs.
        account_zip = output / ('account_' + uid + '.zip')
        result['account_zip'] = str(account_zip)
    metadata = dict(source_summary, player_uids=[int(uid) for uid in account_data],
                    message_counts=dict(decoded_counts), source_integrity_known=integrity_known)
    metadata.update(identities.metadata(), exploration=result['exploration'], analysis_version=VERSION, purpose=purpose)
    if identities.single():
        highlights = dict(metadata.get('player_highlights') or {})
        highlights.update(identities.single())
        metadata['player_highlights'] = highlights
    if result.get('account_zip'):
        metadata['account_zip'] = Path(result['account_zip']).name
    else:
        metadata.pop('account_zip', None)
    (output / 'exploration.json').write_text(json.dumps(result['exploration'], ensure_ascii=False), encoding='utf-8')
    import exploration as exploration_module
    (output / 'exploration.txt').write_text(exploration_module.render_report(result['exploration']), encoding='utf-8')
    activities = exploration.activities.summary(account_uid, result.get('account_uid'))
    (output / 'world-activities.json').write_text(json.dumps(activities, ensure_ascii=False), encoding='utf-8')
    (output / 'world-activities.txt').write_text(render_world_activities(activities), encoding='utf-8')
    (output / 'dungeons.json').write_text(json.dumps(result['dungeons'], ensure_ascii=False), encoding='utf-8')
    (output / 'dungeons.txt').write_text(dungeon_module.render_report(result['dungeons']), encoding='utf-8')
    if purpose != 'gardens':
        contexts.write(output)
        (output / 'life-social.json').write_text(json.dumps(supplemental, ensure_ascii=False), encoding='utf-8')
        (output / 'life-social.txt').write_text(render_life_social(supplemental), encoding='utf-8')
    archive_started = time.perf_counter()
    if result.get('account_zip'):
        with ZipFile(result['account_zip'], 'w', ZIP_DEFLATED) as archive:
            for file in [output / 'exploration.json', output / 'exploration.txt', output / 'dungeons.json', output / 'dungeons.txt',
                         output / 'world-activities.json', output / 'world-activities.txt',
                         output / 'life-social.json', output / 'life-social.txt',
                         *([output / CONTEXT_FILE] if (output / CONTEXT_FILE).is_file() else []),
                         *sorted(f for f in (output / 'raw').glob('*.bin') if f.stem in included_stems),
                         *sorted(f for f in (output / 'json').glob('*.json') if f.stem in included_stems),
                         *sorted((output / 'own-scenes').rglob('*.json')), *sorted((output / 'own-scenes').rglob('*.bin'))]:
                archive.write(file, file.relative_to(output))
    result['timings']['archive_ms'] = round((time.perf_counter() - archive_started) * 1000) if result.get('account_zip') else None
    result['timings']['analysis_total_ms'] = round((time.perf_counter() - analysis_started) * 1000)
    (output / 'summary.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
    (output / 'capture-report.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    if result.get('account_zip'):
        with ZipFile(result['account_zip'], 'a', ZIP_DEFLATED) as archive:
            for file in (output / 'summary.json', output / 'capture-report.json'):
                archive.write(file, file.name)
    return result


def zip_or_export_packets(output, parser):
    """Use exactly the same validation for parser output as imported archives."""
    path = output / '.responses.zip'
    try:
        # Local transport only: compress the final backup once, not this
        # temporary validation container and an extra intermediate account ZIP.
        with ZipFile(path, 'w', ZIP_STORED) as archive:
            for folder in ('raw', 'json'):
                for file in (output / folder).glob('*'):
                    archive.write(file, file.relative_to(output))
        yield from zip_packets(path, parser)
    finally:
        path.unlink(missing_ok=True)


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('action', choices=['analyze', 'watch'])
    cli.add_argument('--toolkit', type=Path, required=True)
    cli.add_argument('--input', type=Path)
    cli.add_argument('--output', type=Path, required=True)
    cli.add_argument('--session-timings', type=Path)
    cli.add_argument('--purpose', choices=['account', 'gardens', 'scenes'], default='account')
    args = cli.parse_args()
    if args.action == 'watch':
        checklist.TOOLKIT = args.toolkit
        checklist.watch(args.output)
    else:
        session_timings = None
        if args.session_timings:
            if args.session_timings.stat().st_size > 65536:
                raise ValueError('阶段耗时记录过大')
            session_timings = json.loads(args.session_timings.read_text('utf-8'))
            if not isinstance(session_timings, dict):
                raise ValueError('阶段耗时格式错误')
        analyze(args.input, args.output, args.toolkit, session_timings, args.purpose)
        print(json.dumps({'report': str(args.output / 'capture-report.json')}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
