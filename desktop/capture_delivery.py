"""Validate and atomically deliver account, garden, and own-scene archives."""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
from zipfile import BadZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture_report as capture
from archive_files import ArchiveView
from account_identity import AccountIdentityIndex
from own_scenes import OwnScenes


class DeliveryError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inspect(path, toolkit, kind, expected_id=None, expected_uid=None):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > capture.MAX_FILE:
        raise DeliveryError('invalid_archive', '备份不存在或超过文件上限')
    with ArchiveView(path, nested_gardens=kind in ('garden', 'gardens'), crc=True) as archive:
        if any(Path(name).suffix.lower() in ('.etl', '.pcap', '.pcapng') for name in archive.members):
            raise DeliveryError('raw_capture', '交付包中不能包含原始网络记录')
    parser = capture.load_parser(Path(toolkit))
    identity = None
    if kind == 'account':
        identities = AccountIdentityIndex()
        for _, _, name, _, body, error in capture.zip_packets(path, parser):
            if name == 'PlayerMainDataRsp' and not error and body.get('status') in (1, 'StatusCode_OK') and body.get('player_id'):
                identities.add(body['player_id'], body.get('player_label'))
        identity = identities.single()
        if identity is None:
            raise DeliveryError('identity_mismatch', '备份中没有唯一账号归属')
    elif kind in ('garden', 'gardens'):
        layouts, names, owners = {}, {}, set()
        for stem, code, name, raw, body, error in capture.zip_packets(path, parser, include_gardens=True):
            if error:
                continue  # Opaque protocol records remain archivable.
            if name == 'SceneDataNotice':
                owner = parser.collect_garden_scene(parser.net_pb2.SceneDataNotice.FromString(raw).data, layouts, names)
                if owner:
                    owners.add(owner)
            elif code in parser.GARDEN_SCENE_NOTICE_IDS:
                import re
                match = re.match(r'g(\d+)_', stem)
                if match:
                    owners.add(int(match[1]))
        capture.layout_only_zip(path, parser, layouts, names)
        owners.update(layouts)
        if not owners or (kind == 'garden' and len(owners) != 1):
            raise DeliveryError('identity_mismatch', '装修包的家园归属不符合本次导出')
        if expected_id is not None and owners != {expected_id}:
            raise DeliveryError('identity_mismatch', '装修包的屋主编号已变化')
        identity = dict(owners=sorted(owners))
    elif kind == 'scenes':
        with tempfile.TemporaryDirectory(prefix='archive-scene-check-') as directory:
            scenes = OwnScenes(parser.net_pb2, directory)
            scenes.load_archive(path)
            if not scenes.records or scenes.declared is None:
                raise DeliveryError('identity_mismatch', '场景包缺少有效归属或快照')
            identity = scenes.declared
    else:
        raise DeliveryError('unsupported_archive', '不支持的备份类型')
    if kind in ('account', 'scenes'):
        if expected_id is not None and identity['player_id'] != expected_id:
            raise DeliveryError('identity_mismatch', '备份的内部角色编号已变化')
        if expected_uid is not None and identity.get('uid') != expected_uid:
            raise DeliveryError('identity_mismatch', '备份的登录标识已变化')
    return dict(identity=identity, bytes=path.stat().st_size, kind=kind)


def replace_ready(source, destination):
    for attempt in range(5):
        try:
            os.replace(source, destination)
            return
        except OSError as error:
            if getattr(error, 'winerror', None) not in (5, 32, 33) or attempt == 4:
                raise
            time.sleep(.05 * 2 ** attempt)


def export(source, destination, toolkit, kind='account', expected_id=None, expected_uid=None):
    source, destination = Path(source).resolve(strict=True), Path(destination).absolute()
    if destination.suffix.lower() != '.zip' or not destination.parent.is_dir() or destination.is_symlink():
        raise DeliveryError('invalid_destination', '请选择有效的 ZIP 保存位置')
    metadata = inspect(source, toolkit, kind, expected_id, expected_uid)
    digest = file_hash(source)
    if source == destination.resolve():
        return dict(metadata, sha256=digest, path=str(destination))
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.archive-export-', suffix='.part', delete=False) as target:
            pending = Path(target.name)
            with source.open('rb') as stream:
                shutil.copyfileobj(stream, target, 1 << 20)
            target.flush()
            os.fsync(target.fileno())
        if file_hash(pending) != digest or file_hash(source) != digest:
            raise DeliveryError('source_changed', '备份在复制期间发生变化')
        copied = inspect(pending, toolkit, kind, expected_id, expected_uid)
        if copied['identity'] != metadata['identity']:
            raise DeliveryError('identity_mismatch', '复制后的备份归属不一致')
        replace_ready(pending, destination)
        return dict(copied, sha256=digest, path=str(destination))
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def error_code(error):
    if isinstance(error, DeliveryError):
        return error.code
    if isinstance(error, (BadZipFile, ValueError)):
        return 'invalid_archive'
    if isinstance(error, OSError):
        if error.errno == errno.ENOSPC:
            return 'storage_full'
        if getattr(error, 'winerror', None) in (32, 33):
            return 'file_busy'
        if isinstance(error, PermissionError):
            return 'permission_denied'
    return 'delivery_failed'


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--input', required=True, type=Path)
    cli.add_argument('--output', required=True, type=Path)
    cli.add_argument('--toolkit', required=True, type=Path)
    cli.add_argument('--kind', choices=('account', 'garden', 'gardens', 'scenes'), required=True)
    cli.add_argument('--expected-id', type=int)
    cli.add_argument('--expected-uid', type=int)
    args = cli.parse_args()
    try:
        print(json.dumps(export(args.input, args.output, args.toolkit, args.kind, args.expected_id, args.expected_uid)))
    except Exception as error:
        print(json.dumps(dict(code=error_code(error), message=str(error)), ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
