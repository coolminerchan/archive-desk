"""Cross-format compatibility, snapshot ownership, and failed-delivery recovery."""
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo, BadZipFile

import test_capture as fixtures
from test_capture import TOOLKIT, proto, codes, main_data
import capture_report as capture
import capture_delivery as delivery
import capture_preflight as preflight
from archive_files import ArchiveView


class ArchiveDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.helper = fixtures.CaptureTests()

    def archive(self, files, name='input.zip'):
        target = self.root / name
        with ZipFile(target, 'w') as archive:
            for key, value in files.items():
                archive.writestr(key, value)
        return target

    def packet(self, name, message, prefix='raw/', serial=1):
        return {f'{prefix}{serial:05}_s0_s2c_{codes[name]}_{name}.bin': message.SerializeToString()}

    def account(self, **files):
        main = main_data(8765001)
        main.player_label = 7654001
        return self.archive(dict(self.packet('PlayerMainDataRsp', main), **files))

    def test_new_account_directories_and_nested_garden_zip_keep_both_houses(self):
        inner = io.BytesIO()
        with ZipFile(inner, 'w') as archive:
            for key, value in self.packet('SceneDataNotice', self.helper.garden_scene(222, 3)).items():
                archive.writestr(key, value)
        files = self.packet('SceneDataNotice', self.helper.garden_scene(111, 2), 'export/gardens/111/raw/')
        files['export/gardens/garden_Another_222.zip'] = inner.getvalue()
        # Nested login data must not override the account or identify a garden.
        files.update(self.packet('PlayerMainDataRsp', main_data(999), 'export/gardens/111/raw/'))
        source = self.archive(files)
        result = capture.analyze(source, self.root / 'out', TOOLKIT, purpose='gardens')
        self.assertEqual([(r['owner_uid'], r['furniture_count']) for r in result['gardens']], [(111, 2), (222, 3)])
        self.assertFalse(result['garden_account_identified'])
        self.assertEqual(delivery.inspect(source, TOOLKIT, 'gardens')['identity']['owners'], [111, 222])

    def test_duplicate_nested_copy_is_accepted_but_conflicting_copy_is_rejected(self):
        files = self.packet('SceneDataNotice', self.helper.garden_scene(111, 2))
        for conflict in (False, True):
            inner = io.BytesIO()
            with ZipFile(inner, 'w') as archive:
                for key, value in files.items():
                    archive.writestr(key, b'changed' if conflict else value)
            source = self.archive({**{'gardens/111/' + k: v for k, v in files.items()}, 'gardens/garden_A_111.zip': inner.getvalue()}, f'dup-{conflict}.zip')
            if conflict:
                with self.assertRaises(ValueError):
                    with ArchiveView(source, nested_gardens=True):
                        pass
            else:
                with ArchiveView(source, nested_gardens=True) as archive:
                    self.assertEqual(archive.read('gardens/111/' + next(iter(files))), next(iter(files.values())))

    def test_directory_owner_must_match_the_scene_and_nested_archive(self):
        source = self.archive(self.packet('SceneDataNotice', self.helper.garden_scene(222, 1), 'gardens/111/raw/'))
        with self.assertRaisesRegex(ValueError, '归属'):
            capture.analyze(source, self.root / 'bad-scene', TOOLKIT, purpose='gardens')
        inner = io.BytesIO()
        with ZipFile(inner, 'w') as archive:
            archive.writestr('222/raw/a.bin', b'anything')
        nested = self.archive({'gardens/garden_A_111.zip': inner.getvalue()}, 'bad-nested.zip')
        with self.assertRaisesRegex(ValueError, '屋主'):
            with ArchiveView(nested, nested_gardens=True):
                pass

    def test_archive_paths_symlinks_duplicates_and_expanded_budget_are_rejected(self):
        for i, name in enumerate(('../outside', '/absolute', '..\\outside', 'C:escape')):
            source = self.archive({name: b'x'}, f'path-{i}.zip')
            with self.assertRaises(ValueError):
                with ArchiveView(source):
                    pass
        link = ZipInfo('link')
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        source = self.root / 'symlink.zip'
        with ZipFile(source, 'w') as archive:
            archive.writestr(link, 'outside')
        with self.assertRaises(ValueError):
            with ArchiveView(source):
                pass
        source = self.archive({'a': b'ab', 'b': b'cd'})
        with patch('archive_files.MAX_TOTAL', 3), self.assertRaises(ValueError):
            with ArchiveView(source):
                pass

    def test_own_snapshots_remain_distinct_and_public_uid_is_not_an_internal_owner(self):
        source = self.account()
        scenes = [self.helper.garden_scene(8765001, 1), self.helper.garden_scene(8765001, 4),
                  self.helper.garden_scene(7654001, 9), self.helper.garden_scene(222, 8)]
        label_only = self.helper.garden_scene(0, 2)
        label_only.data.scene_id = 1001
        label_only.data.ClearField('scene_garden_data')
        label_only.data.channel_label = 7654001
        scenes += [label_only, scenes[0]]
        with ZipFile(source, 'a') as archive:
            for serial, scene in enumerate(scenes, 2):
                for name, raw in self.packet('SceneDataNotice', scene, serial=serial).items():
                    archive.writestr(name, raw)
        result = capture.analyze(source, self.root / 'own', TOOLKIT)
        own = result['own_scenes']
        self.assertEqual((own['scene_count'], own['snapshot_count']), (2, 3))
        garden = next(r for r in own['scenes'] if r['scene_id'] == 9999)
        self.assertEqual(garden['garden_furniture'], 4)
        self.assertEqual(garden['observations'], 3)
        self.assertEqual(own['identity'], dict(player_id=8765001, uid=7654001))
        reopened = capture.analyze(Path(own['bundle']), self.root / 'scenes-only', TOOLKIT, purpose='scenes')
        self.assertEqual(reopened['own_scenes']['snapshot_count'], 3)
        self.assertEqual(reopened['own_scenes']['identity_source'], 'archive_metadata')
        self.assertEqual(reopened['successful'], 0)
        self.assertNotIn('account_zip', reopened)
        self.assertFalse(list((self.root / 'scenes-only').glob('raw/*')))
        with ZipFile(result['account_zip']) as archive:
            self.assertIn('own-scenes/index.json', archive.namelist())
        account_reopened = capture.analyze(Path(result['account_zip']), self.root / 'own-reopened', TOOLKIT)
        self.assertEqual(account_reopened['own_scenes']['snapshot_count'], 3)

    def test_legacy_my_scene_archive_keeps_bare_data_without_inventing_responses(self):
        scene = self.helper.garden_scene(8765001, 3).data
        index = dict(owner_uid=8765001, scenes=[dict(scene_id=9999, bin_file='scene.bin')])
        source = self.archive({'my-scenes/index.json': json.dumps(index), 'my-scenes/scene.bin': scene.SerializeToString()})
        result = capture.analyze(source, self.root / 'legacy', TOOLKIT, purpose='scenes')
        self.assertEqual(result['own_scenes']['scene_count'], 1)
        self.assertEqual(result['own_scenes']['identity']['player_id'], 8765001)
        self.assertIsNone(result['own_scenes']['identity']['uid'])
        self.assertEqual(result['successful'], 0)
        self.assertNotIn('account_zip', result)

    def test_scene_index_cannot_change_the_account_owner(self):
        scene = self.helper.garden_scene(222, 1).data
        source = self.account(**{'my-scenes/index.json': json.dumps(dict(owner_uid=222, scenes=[dict(scene_id=9999, bin_file='s.bin')])), 'my-scenes/s.bin': scene.SerializeToString()})
        with self.assertRaisesRegex(ValueError, '归属'):
            capture.analyze(source, self.root / 'wrong-owner', TOOLKIT)

    def test_valid_delivery_keeps_opaque_records_and_is_idempotent_at_same_path(self):
        source = self.account(**{'raw/009_s0_s2c_65000_Unknown_65000.bin': b'opaque-protocol'})
        target = self.root / 'delivered.zip'
        result = delivery.export(source, target, TOOLKIT, 'account', 8765001, 7654001)
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertEqual(result['sha256'], delivery.file_hash(source))
        self.assertEqual(delivery.export(target, target, TOOLKIT, 'account')['sha256'], result['sha256'])

    def test_delivery_cli_works_with_the_bundled_isolated_python(self):
        source = self.account()
        target = self.root / 'cli.zip'
        process = subprocess.run([str(TOOLKIT / 'tools/python/python.exe'), '-B', '-X', 'utf8',
            str(capture.HERE / 'capture_delivery.py'), '--input', str(source), '--output', str(target),
            '--toolkit', str(TOOLKIT), '--kind', 'account', '--expected-id', '8765001', '--expected-uid', '7654001'],
            capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout)['sha256'], delivery.file_hash(source))
        self.assertEqual(target.read_bytes(), source.read_bytes())

    def test_identity_failure_and_interrupted_replace_keep_previous_target(self):
        source = self.account()
        target = self.root / 'previous.zip'
        target.write_bytes(b'previous-backup')
        with self.assertRaises(delivery.DeliveryError):
            delivery.export(source, target, TOOLKIT, 'account', 222)
        self.assertEqual(target.read_bytes(), b'previous-backup')
        with patch.object(delivery, 'replace_ready', side_effect=PermissionError('occupied')):
            with self.assertRaises(PermissionError):
                delivery.export(source, target, TOOLKIT)
        self.assertEqual(target.read_bytes(), b'previous-backup')
        self.assertEqual(list(self.root.glob('.archive-export-*')), [])

    def test_crc_error_and_raw_recording_cannot_replace_an_existing_backup(self):
        source = self.account(**{'notes.txt': b'uncorrupted-sentinel'})
        source.write_bytes(source.read_bytes().replace(b'uncorrupted-sentinel', b'Xncorrupted-sentinel'))
        target = self.root / 'previous.zip'
        target.write_bytes(b'previous-backup')
        with self.assertRaises(BadZipFile):
            delivery.export(source, target, TOOLKIT)
        self.assertEqual(target.read_bytes(), b'previous-backup')
        source = self.account(**{'capture.pcapng': b'private-recording'})
        with self.assertRaisesRegex(delivery.DeliveryError, '原始网络'):
            delivery.export(source, target, TOOLKIT)

    def test_preflight_blocks_missing_files_and_low_space_without_leaking_exception(self):
        result = preflight.inspect(self.root, TOOLKIT, self.root)
        self.assertFalse(result['ok'])
        self.assertFalse(next(r for r in result['checks'] if r['id'] == 'package')['ok'])
        usage = shutil._ntuple_diskusage(10 << 30, 10 << 30, 500 << 20)
        with patch.object(preflight.shutil, 'disk_usage', return_value=usage):
            result = preflight.inspect(capture.HERE, TOOLKIT, self.root)
        row = next(r for r in result['checks'] if r['id'] == 'output')
        self.assertFalse(row['ok'])
        self.assertEqual(row['level'], 'error')
        self.assertTrue(next(r for r in result['checks'] if r['id'] == 'protocol')['ok'])


if __name__ == '__main__':
    unittest.main()
