"""Prepare an allowlisted collector source candidate; never publish it."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Expected a numeric version')
    runtime = ROOT / f'dist/OverField-Capture-{version}-Windows-x64.zip'
    native = ROOT / '.tools/native'
    inputs = {
        'version': version, 'runtime_package': runtime.name,
        'runtime_package_sha256': digest(runtime),
        'webview2_url': 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4370.26/microsoft.web.webview2.1.0.4370.26.nupkg',
        'webview2_sha256': '1c0dacac84b70109b3fd42f90c53a0ba942abc3a87590d7a4e0ccd86e4a06cf4',
        'native_files': [],
    }
    for name, url in [
        ('json.hpp', 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp'),
        ('JSON-LICENSE.txt', 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT'),
        ('webview2/LICENSE.txt', None),
        ('webview2/build/native/include/WebView2.h', None),
        ('webview2/build/native/x64/WebView2LoaderStatic.lib', None),
    ]:
        inputs['native_files'].append(dict(path=name, sha256=digest(native / name), url=url))
    files = {}
    def add(path):
        path = ROOT / path
        files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for name in ['capture-main.mjs', 'product.mjs', 'platform.mjs', 'native-platform.mjs', 'native-bridge.js',
                 'preload.cjs', 'capture-controller.mjs', 'capture-launcher.mjs', 'capture-session.ps1',
                 'capture_report.py', 'capture_delivery.py', 'capture_preflight.py', 'capture-errors.mjs', 'capture-update.mjs', 'capture-update-apply.mjs', 'capture-update-install.mjs', 'capture-update.json', 'capture_update_package.py', 'capture-version.json', 'equipment_audit.py', 'package.json', 'package-lock.json',
                 'package.mjs', 'zip_release.py', 'vite.config.mjs', '.gitignore']:
        add('desktop/' + name)
    suffixes = {'.py', '.json', '.md', '.jsx', '.css', '.mjs', '.html', '.png', '.ico', '.cpp', '.ps1'}
    for directory in ['desktop/capturelib', 'desktop/ui', 'desktop/native']:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file() and path.suffix in suffixes and '__pycache__' not in path.parts:
                add(path.relative_to(ROOT))
    for name in ['test_capture.py', 'test_archive_delivery.py', 'test_capture_update.py', 'test_life_social.py', 'capture-errors.test.mjs', 'capture-update.test.mjs', 'capture-update-install.test.mjs', 'capture-controller.test.mjs', 'one-click.test.mjs', 'product.test.mjs', 'gardens-ui.js', 'scenes-ui.js', 'life-social-ui.js', 'update-ui.js', 'update-in-place-ui.js', 'one-click-ui.js']:
        add('desktop/test/' + name)
    for name in ['docs/capture-one-click.md', 'docs/capture-quick-start.zh-CN.txt', 'docs/capture-life-social-format.md', 'docs/github-capture-review/README.md', f'docs/github-capture-review/RELEASE-{version}.md',
                 'scripts/bootstrap_capture_build.ps1', 'scripts/prepare_capture_source.py', 'scripts/sign_capture_update.mjs']:
        add(name)
    files['README.md'] = (ROOT / 'docs/github-capture-review/README.md').read_bytes()
    changelog = ROOT / 'CHANGELOG.md'
    files['CHANGELOG.md'] = (changelog if changelog.is_file() else ROOT / f'docs/github-capture-review/RELEASE-{version}.md').read_bytes()
    package = json.loads(files['desktop/package.json'])
    package.update(name='archive-desk', productName='Archive Desk', version=version, main='capture-main.mjs')
    files['desktop/package.json'] = json.dumps(package, indent=2).encode()
    lock = json.loads(files['desktop/package-lock.json'])
    lock.update(name='archive-desk', version=version)
    lock['packages'][''].update(name='archive-desk', version=version)
    files['desktop/package-lock.json'] = json.dumps(lock, indent=2).encode()
    files['.gitignore'] = b'/.tools/\n/.local/\n/dist/\n*.pcap\n*.pcapng\n*.etl\n*.key\n*.pem\n*.db\n'
    files['capture-build-inputs.json'] = json.dumps(inputs, ensure_ascii=False, indent=2).encode()
    # Notices and the generated protocol source are present in the runtime too.
    with ZipFile(runtime) as z:
        prefix = f'OverField-Capture-{version}-Windows-x64/'
        for item in z.infolist():
            rel = item.filename.removeprefix(prefix)
            if (rel.startswith('licenses/') or rel.startswith('resources/dependencies/proto_gen/') or rel == 'resources/dependencies/THIRD-PARTY.txt') and not item.is_dir():
                if '__pycache__' not in rel and not rel.endswith('.pyc'):
                    files['third-party/' + rel] = z.read(item)
    for name, body in files.items():
        if name.startswith(('.local/', '.tools/', 'dist/')) or '..' in Path(name).parts:
            raise ValueError('Unexpected source member: ' + name)
        if Path(name).suffix in {'.json', '.md', '.py', '.mjs', '.jsx', '.ps1', '.txt', '.cpp'}:
            text = body.decode('utf-8-sig', errors='replace')
            if re.search(r'[A-Za-z]:[\\/]+Users[\\/]+Administrator[\\/]', text):
                raise ValueError('Developer home path in ' + name)
    name = f'OverField-Capture-{version}-Source'
    target = ROOT / 'dist' / (name + '.zip')
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.tmp', delete=False) as temp:
        pending = Path(temp.name)
    try:
        with ZipFile(pending, 'w', ZIP_DEFLATED) as z:
            for key, body in sorted(files.items()):
                z.writestr(name + '/' + key, body)
        with ZipFile(pending) as z:
            if z.testzip() is not None:
                raise ValueError('Source ZIP CRC failure')
        pending.replace(target)
    finally:
        pending.unlink(missing_ok=True)
    target.with_suffix('.zip.sha256').write_text(digest(target) + '  ' + target.name + '\n', encoding='utf-8')
    print(json.dumps(dict(path=str(target), files=len(files), sha256=digest(target)), ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    prepare(parser.parse_args().version)
