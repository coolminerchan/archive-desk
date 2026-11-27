"""Read-only dependency checks plus a disposable output-writability probe."""
import argparse
import importlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile


FILES = ['capture_report.py', 'capture_delivery.py', 'capture-session.ps1', 'capture_update_package.py', 'capture-update.mjs', 'capture-update-install.mjs', 'capture-update-apply.mjs', 'capture-update.json',
    *['capturelib/' + name for name in ('parse_pcap.py', 'pcap_compat.py', 'account_identity.py',
       'checklist.py', 'capture_quality.py', 'dungeons.py', 'exploration.py',
       'exploration_catalog.json', 'scene_catalog.json', 'scene_metadata.py', 'world_activities.py', 'archive_files.py', 'own_scenes.py', 'capture_version.py', 'packet_context.py', 'life_social.py')]]


def inspect(app, toolkit, output=None):
    app, toolkit = Path(app), Path(toolkit)
    checks = []
    missing = [name for name in FILES if not (app / name).is_file()]
    checks.append(dict(id='package', label='程序文件', ok=not missing,
        detail='程序文件已找到' if not missing else '文件不完整，请重新完整解压：' + '、'.join(missing)))
    if not missing:
        try:
            importlib.import_module('cramjam')
            importlib.import_module('google.protobuf')
            sys.path.insert(0, str(app))
            import capture_report
            parser = capture_report.load_parser(toolkit)
            fields = parser.net_pb2.PlayerMainDataRsp.DESCRIPTOR.fields_by_name
            if not {'player_id', 'player_label'} <= set(fields) or not parser.load_cmd_map():
                raise ValueError('Protocol definition unavailable')
            catalog = json.loads((app / 'capturelib/exploration_catalog.json').read_text(encoding='utf-8-sig'))
            if not isinstance(catalog, dict) or not catalog:
                raise ValueError('Resource catalog unavailable')
            checks.append(dict(id='protocol', label='解析与资源目录', ok=True, detail='解析组件、协议和资源目录可加载'))
        except Exception:
            checks.append(dict(id='protocol', label='解析与资源目录', ok=False,
                detail='解析组件、协议或资源目录不可用，请重新解压匹配版本的完整包'))
    suspicious = any(re.match(r'(?i)^(rar\$|7z[oeas]?\w*\.|wz\w*\.|zip\$)', part) for part in app.parts)
    checks.append(dict(id='extraction', label='运行目录', ok=True, level='warning' if suspicious else 'ok',
        detail='当前位于压缩软件的临时目录，请完整解压后运行' if suspicious else '运行目录未见临时解压特征'))
    if output is not None:
        try:
            target = Path(output).absolute()
            while not target.exists() and target.parent != target:
                target = target.parent
            if not target.is_dir():
                raise OSError('Not a directory')
            with tempfile.TemporaryFile(dir=target) as probe:
                probe.write(b'archive-desk-output-check')
                probe.flush()
            free = shutil.disk_usage(target).free
            checks.append(dict(id='output', label='保存位置', ok=free >= 640 << 20,
                level='error' if free < 640 << 20 else 'warning' if free < 1536 << 20 else 'ok',
                free_bytes=free, detail='保存位置可写' if free >= 1536 << 20 else
                '保存位置空间偏少，建议至少预留 1.5 GiB' if free >= 640 << 20 else '保存位置可用空间不足，请先更换目录'))
        except OSError:
            checks.append(dict(id='output', label='保存位置', ok=False, detail='保存目录不可写或不可访问，请更换目录'))
    return dict(checks=checks, ok=all(row['ok'] for row in checks))


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--app', required=True, type=Path)
    cli.add_argument('--toolkit', required=True, type=Path)
    cli.add_argument('--output', type=Path)
    args = cli.parse_args()
    print(json.dumps(inspect(args.app, args.toolkit, args.output), ensure_ascii=False))
