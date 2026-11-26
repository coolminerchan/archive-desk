"""Read an existing capture and report equipment counts without exporting packets."""

import argparse
from contextlib import closing
import gzip
import io
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3
import sys
from zipfile import ZipFile

MAX_FILE = 96 << 20
MAX_MESSAGE = 16 << 20
MAX_TOTAL_MESSAGES = 128 << 20
MAX_SAVE = 64 << 20
NAMES = {1006: "PlayerMainDataRsp", 1400: "PackNotice", 1402: "GetWeaponRsp",
         1404: "GetArmorRsp", 1406: "GetPosterRsp", 1416: "GetAllCharacterEquipRsp"}
ARCHIVE_PACKET = re.compile(r"_(?:s2c|d0to1|d1to0)_\d+_([A-Za-z0-9_]+)$")
PACKET_CODES = {name: code for code, name in NAMES.items()}


def backup_messages(path, proto):
    from google.protobuf.json_format import ParseDict, ParseError

    with ZipFile(path) as archive:
        packets = {}
        for info in archive.infolist():
            name = PurePosixPath(info.filename)
            parent = name.parent.parts
            if (name.is_absolute() or ".." in name.parts or "\\" in info.filename):
                raise ValueError("账号 ZIP 含无效路径")
            if parent not in {("raw",), ("json",), ("export", "raw"), ("export", "json")}:
                continue
            if name.suffix != (".bin" if parent[-1] == "raw" else ".json"):
                continue
            match = ARCHIVE_PACKET.search(name.stem)
            code = PACKET_CODES.get(match[1]) if match else None
            if code is None:
                continue
            # Prefer the binary response when a standard archive contains both encodings.
            selected = packets.setdefault(name.stem, {})
            if name.suffix in selected:
                raise ValueError("账号 ZIP 含重复的装备响应文件")
            selected[name.suffix] = (code, info)
        total = 0
        for versions in packets.values():
            code, info = versions.get(".bin") or versions[".json"]
            total += info.file_size
            if info.file_size > MAX_MESSAGE or total > MAX_TOTAL_MESSAGES:
                raise ValueError("装备响应超过处理上限")
            body = archive.read(info)
            if info.filename.endswith(".json"):
                try:
                    decoded = json.loads(body.decode("utf-8-sig"))
                    if not isinstance(decoded, dict) or any(re.fullmatch(r"field_\d+", key) for key in decoded):
                        raise ValueError("undecoded capture fields")
                    if code == 1006:
                        # Older archives may encode unrelated character fields differently.
                        keys = {"status", "player_id", "playerId", "player_label", "playerLabel"}
                        decoded = {key: value for key, value in decoded.items() if key in keys}
                    body = ParseDict(decoded, getattr(proto, NAMES[code])(),
                                     ignore_unknown_fields=True).SerializeToString()
                except (ParseError, ValueError):
                    body = None
            yield code, body


def selected_frames(data, parser):
    """Skip non-equipment bodies before ever reading or decompressing them."""
    from google.protobuf.message import DecodeError

    position = 0
    while position + 2 <= len(data):
        size, = parser.HEADER_STRUCT.unpack_from(data, position)
        body_start = position + 2 + size
        if not 0 < size <= 4096 or body_start > len(data):
            return
        try:
            head = parser.net_pb2.PacketHead.FromString(data[position + 2:body_start])
        except DecodeError:
            return
        position = body_start + head.body_len
        if position > len(data) or not head.msg_id:
            return
        if head.msg_id not in NAMES:
            continue
        if head.body_len > MAX_MESSAGE:
            raise ValueError("装备响应超过单条处理上限")
        body = data[body_start:position]
        if head.flag == 1:
            try:
                if parser.cramjam.snappy.decompress_raw_len(body) > MAX_MESSAGE:
                    yield head.msg_id, None
                    continue
                body = bytes(parser.cramjam.snappy.decompress_raw(body))
            except (ValueError, RuntimeError, parser.cramjam.DecompressionError):
                body = None
        yield head.msg_id, body


def capture_messages(path, parser, port):
    path = parser.prepare_capture(path)
    ports = {str(port)} if port else parser.GAME_PORTS
    streams = parser.list_tcp_streams(path)
    if len(streams) > 256:
        raise ValueError("TCP 流过多，请选择更短或预先筛选的抓包文件")
    for stream in streams:
        a, b, outward, inward = parser.extract_tcp_stream_directions(path, stream)
        a_is_server = a.rsplit(":", 1)[-1] in ports
        b_is_server = b.rsplit(":", 1)[-1] in ports
        directions = parser.pick_directions(outward, inward) if a_is_server == b_is_server else [
            ('s2c', outward if a_is_server else inward)]
        for label, data in directions:
            if label != 'c2s':
                yield from selected_frames(data, parser)


def summarize(messages, proto, database=None):
    counts = {kind: {"snapshot": set(), "reported": set(), "observed": set(),
                     "pages": 0, "without_id": 0, "complete_totals": set()} for kind in ("weapon", "armor", "poster")}
    uids = {}
    failures = 0
    response_errors = 0
    sources = {"pack": 0, "equipped": 0}
    total = 0

    def add(item, targets):
        for kind, target in targets.items():
            if item.HasField(kind) and getattr(item, kind).instance_id:
                target.add(getattr(item, kind).instance_id)

    for code, body in messages:
        if body is None:
            failures += 1
            continue
        total += len(body)
        if total > MAX_TOTAL_MESSAGES:
            raise ValueError("装备响应总量超过处理上限")
        try:
            message = getattr(proto, NAMES[code]).FromString(body)
        except Exception:
            failures += 1
            continue
        if message.status not in (proto.StatusCode_NONE, proto.StatusCode_OK):
            response_errors += 1
            continue
        if code == 1006:
            if message.player_id:
                labels = uids.setdefault(message.player_id, set())
                if message.player_label:
                    labels.add(message.player_label)
            continue
        if code in (1402, 1404, 1406):
            if message.status != proto.StatusCode_OK:
                response_errors += 1
                continue
            kind, field = {1402: ("weapon", "weapons"), 1404: ("armor", "armors"), 1406: ("poster", "posters")}[code]
            result = counts[kind]
            result["pages"] += 1
            result["reported"].add(message.total_num)
            page_ids = {item.instance_id for item in getattr(message, field) if item.instance_id}
            if len(page_ids) == message.total_num and message.end_index in (0, message.total_num):
                result['complete_totals'].add(message.total_num)
            for item in getattr(message, field):
                if item.instance_id:
                    result["snapshot"].add(item.instance_id)
                else:
                    result["without_id"] += 1
            continue
        sources["pack" if code == 1400 else "equipped"] += 1
        targets = {kind: data["observed"] for kind, data in counts.items()}
        for item in message.items:
            for part in (item.main_item, *item.transformed_item, *item.extras):
                add(part, targets)

    identity = None
    if len(uids) == 1:
        internal, labels = next(iter(uids.items()))
        if len(labels) <= 1:
            identity = next(iter(labels), internal)
    reduct = {}
    for kind, data in counts.items():
        totals = sorted(data["reported"])
        snapshot = len(data["snapshot"])
        # A filtered list and a later unfiltered list can legitimately have
        # different total_num values. An individual complete response covering
        # the union is evidence for that list, without claiming global coverage.
        list_complete = bool(totals) and snapshot == max(totals) and (len(totals) == 1 or snapshot in data['complete_totals'])
        reduct[kind] = {
            "pages": data["pages"], "snapshot": snapshot, "reported": totals,
            "observed": len(data["observed"] | data["snapshot"]),
            "other_only": len(data["observed"] - data["snapshot"]),
            "without_id": data["without_id"],
            "list_complete": list_complete,
            "list_matches": list_complete and not data['without_id'] and not failures and not response_errors
                            and len(uids) == 1 and all(len(labels) <= 1 for labels in uids.values()),
            "matches": list_complete and not data["without_id"]
                       and not failures and not response_errors and not (data['observed'] - data['snapshot'])
                       and len(uids) == 1 and all(len(labels) <= 1 for labels in uids.values()),
        }
    accounts = sum(max(1, len(labels)) for labels in uids.values())
    report = {"equipment": reduct, "sources": sources, "accounts": accounts, "decode_errors": failures,
              "response_errors": response_errors}
    if database is not None:
        if identity is None:
            raise ValueError("采集包须包含一份可唯一识别的账号主数据")
        expected = {kind: data["observed"] | data["snapshot"] for kind, data in counts.items()}
        report["migration"] = compare_save(database, identity, expected)
    return report


def compare_save(path, uid, captured):
    if not path.is_file():
        raise ValueError("找不到所选的 游戏数据库")
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)) as db:
        rows = db.execute(
            """SELECT CASE WHEN length(g.bin_data) <= ? THEN g.bin_data END
               FROM of_user u JOIN of_game g ON u.user_id = g.user_id
               WHERE u.sdk_uid = ? LIMIT 2""",
            (MAX_SAVE, uid),
        ).fetchall()
    if not rows:
        return {"uid": uid, "found": False}
    if len(rows) != 1 or not isinstance(rows[0][0], bytes):
        raise ValueError("游戏存档有重复 UID、格式无效或超过读取上限")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(rows[0][0])) as compressed:
            payload = compressed.read(MAX_SAVE + 1)
        if len(payload) > MAX_SAVE:
            raise ValueError("游戏存档超过解压上限")
        inventory = json.loads(payload)["item"]
        fields = {"weapon": "itemWeaponMap", "armor": "itemArmorMap"}
        result = {}
        for kind, field in fields.items():
            equipment = inventory.get(field)
            if equipment is not None and not isinstance(equipment, dict):
                raise ValueError("装备存档的映射格式无效")
            saved = {int(key) for key in equipment or {}}
            result[kind] = {"captured": len(captured[kind]), "saved": len(saved),
                            "missing": len(captured[kind] - saved)}
    except (EOFError, KeyError, OSError, TypeError, AttributeError, ValueError):
        raise ValueError("无法读取所选存档的装备数据") from None
    return {"uid": uid, "found": True, "equipment": result}


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--toolkit", type=Path, required=True)
    cli.add_argument("--input", type=Path, required=True)
    cli.add_argument("--port", type=int)
    cli.add_argument("--database", type=Path, help="只读核对已导入的 游戏存档")
    args = cli.parse_args()
    if not args.input.is_file() or args.input.stat().st_size > MAX_FILE:
        cli.error("请选择小于 96 MB 的单次采集文件")
    import os
    os.environ['OVERFIELD_CAPTURE_TOOLKIT'] = str(args.toolkit)
    sys.path.insert(0, str(args.toolkit))
    sys.path.insert(0, str(args.toolkit / 'proto_gen'))
    sys.path.insert(0, str(Path(__file__).resolve().parent / 'capturelib'))
    import parse_pcap as parser
    extension = args.input.suffix.lower()
    if args.database and extension != ".zip":
        cli.error("对照存档时请选择账号 ZIP")
    if extension == ".zip":
        messages = backup_messages(args.input, parser.net_pb2)
    elif extension in {".pcap", ".pcapng"}:
        messages = capture_messages(args.input, parser, args.port)
    else:
        cli.error("请选择账号 ZIP、PCAP 或 PCAPNG")
    try:
        report = summarize(messages, parser.net_pb2, args.database)
    except (ValueError, sqlite3.Error) as error:
        cli.error(str(error))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
