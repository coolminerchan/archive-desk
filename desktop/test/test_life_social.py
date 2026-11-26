"""RPC classification must survive archive reopening without guessing ownership."""
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from test_capture import capture, proto, codes, frame, pcap, main_data, TOOLKIT
from packet_context import PacketContexts, read_contexts
from life_social import LifeSocial, quality_items
from account_identity import AccountIdentityIndex


def basic(kind):
    result = proto.GetLifeInfoRsp(status=1)
    result.life_base_info.life_type = kind
    result.life_base_info.level = 12
    result.life_skill.life_type = kind
    result.life_achieve.life_type = kind
    return result


class LifeSocialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.contexts = PacketContexts()
        self.collector = LifeSocial(proto)
        self.identities = AccountIdentityIndex()
        self.identities.add(8765001, 7654001)
        self.serial = 0

    def add(self, name, message, packet_id=9, sid=0, incomplete=False, metadata=True):
        self.serial += 1
        direction = 'c2s' if name.endswith('Req') else 's2c'
        stem = f'{self.serial:05}_s{sid}_{direction}_{codes[name]}_{name}'
        raw = message.SerializeToString()
        packet = dict(msg_id=codes[name], packet_id=packet_id, seq_id=self.serial, decompress_err=None)
        self.contexts.add(proto, name, raw, packet, sid, direction, stem, incomplete=incomplete)
        context = self.contexts.match('raw/' + stem + '.bin', name, raw) if metadata else None
        self.collector.add(name, raw, 'raw/' + stem + '.bin', context)

    def summary(self):
        return self.collector.summary(self.identities)

    def history(self, kind=4, pid=9, count=3, sid=0):
        request = proto.GetOneTypeLifePictorialBookCountReq(life_type=kind)
        response = proto.GetOneTypeLifePictorialBookCountRsp(status=1)
        if count is not None:
            response.life_achieve_count_lst.add(id=2101, count=count)
        self.add('GetOneTypeLifePictorialBookCountReq', request, pid, sid)
        self.add('GetOneTypeLifePictorialBookCountRsp', response, pid, sid)

    def test_base_and_history_are_distinct_quality_items(self):
        for kind in range(1, 7):
            self.add('GetLifeInfoRsp', basic(kind), packet_id=kind)
        report = self.summary()
        items = {row['id']: row for row in quality_items(report)}
        self.assertEqual(items['life_base']['state'], 'collected')
        self.assertEqual(items['life_history']['state'], 'unknown')
        self.assertFalse(any(row['snapshots'] for row in report['history']['types']))

    def test_history_pairing_uses_connection_and_packet_id_not_response_order(self):
        self.add('GetOneTypeLifePictorialBookCountReq', proto.GetOneTypeLifePictorialBookCountReq(life_type=1), 11)
        self.add('GetOneTypeLifePictorialBookCountReq', proto.GetOneTypeLifePictorialBookCountReq(life_type=4), 12)
        later = proto.GetOneTypeLifePictorialBookCountRsp(status=1)
        later.life_achieve_count_lst.add(id=41, count=7)
        first = proto.GetOneTypeLifePictorialBookCountRsp(status=1)
        first.life_achieve_count_lst.add(id=11, count=2)
        self.add('GetOneTypeLifePictorialBookCountRsp', later, 12)
        self.add('GetOneTypeLifePictorialBookCountRsp', first, 11)
        rows = {r['type_id']: r for r in self.summary()['history']['types']}
        self.assertEqual(rows[1]['snapshots'][0]['counts'], [dict(id=11, count='2')])
        self.assertEqual(rows[4]['snapshots'][0]['counts'], [dict(id=41, count='7')])

    def test_identical_packet_ids_on_different_connections_stay_separate(self):
        self.history(kind=1, pid=10, sid=0, count=2)
        self.history(kind=4, pid=10, sid=1, count=8)
        rows = {r['type_id']: r for r in self.summary()['history']['types']}
        self.assertEqual(rows[1]['snapshots'][0]['counts'][0]['count'], '2')
        self.assertEqual(rows[4]['snapshots'][0]['counts'][0]['count'], '8')
        self.assertNotEqual(rows[1]['snapshots'][0]['request']['connection_id'], rows[4]['snapshots'][0]['request']['connection_id'])

    def test_cross_connection_or_zero_packet_id_never_infers_a_match(self):
        self.add('GetOneTypeLifePictorialBookCountReq', proto.GetOneTypeLifePictorialBookCountReq(life_type=4), 11, sid=0)
        self.add('GetOneTypeLifePictorialBookCountRsp', proto.GetOneTypeLifePictorialBookCountRsp(status=1), 11, sid=1)
        self.history(kind=1, pid=0)
        self.assertTrue(all(r['state'] == 'unknown' for r in self.summary()['history']['types']))

    def test_duplicate_packet_ids_and_incomplete_connections_remain_unknown(self):
        for kind in (1, 4):
            self.add('GetOneTypeLifePictorialBookCountReq', proto.GetOneTypeLifePictorialBookCountReq(life_type=kind), 9)
        self.add('GetOneTypeLifePictorialBookCountRsp', proto.GetOneTypeLifePictorialBookCountRsp(status=1), 9)
        self.add('FriendReq', proto.FriendReq(type=2), 10, sid=1, incomplete=True)
        self.add('FriendRsp', proto.FriendRsp(status=1), 10, sid=1)
        report = self.summary()
        self.assertTrue(all(r['state'] == 'unknown' for r in report['history']['types']))
        self.assertTrue(all(r['state'] == 'unknown' for r in report['social']['types']))
        self.assertTrue(any(r['reason'] == 'ambiguous_packet_id' for r in report['unclassified']))

    def test_failed_response_does_not_become_a_known_empty_list(self):
        self.add('FriendReq', proto.FriendReq(type=3))
        self.add('FriendRsp', proto.FriendRsp(status=2))
        row = next(r for r in self.summary()['social']['types'] if r['type_id'] == 3)
        self.assertEqual(row['state'], 'unknown')
        self.assertEqual(row['snapshots'][0]['status'], 2)

    def test_successful_empty_lists_are_classified_and_history_counts_keep_uint64(self):
        for kind in (1, 2, 3):
            self.add('FriendReq', proto.FriendReq(type=kind), kind)
            self.add('FriendRsp', proto.FriendRsp(status=1), kind)
        self.history(count=(1 << 64) - 1)
        report = self.summary()
        items = {r['id']: r for r in quality_items(report)}
        self.assertEqual(items['social_lists']['state'], 'empty')
        history = next(r for r in report['history']['types'] if r['type_id'] == 4)
        self.assertEqual(history['snapshots'][0]['counts'][0]['count'], '18446744073709551615')

    def test_legacy_responses_without_context_keep_classification_unknown(self):
        for _ in range(4):
            self.add('FriendRsp', proto.FriendRsp(status=1), metadata=False)
        report = self.summary()
        self.assertEqual(report['unclassified_count'], 4)
        self.assertEqual(quality_items(report)[2]['state'], 'unknown')

    def test_all_six_successful_empty_history_lists_are_distinct_from_missing(self):
        for kind in range(1, 7):
            self.history(kind=kind, pid=40 + kind, count=None)
        report = self.summary()
        self.assertEqual(quality_items(report)[1]['state'], 'empty')
        self.assertTrue(all(r['snapshots'][0]['counts'] == [] for r in report['history']['types']))

    def test_a_malformed_duplicate_response_cannot_hide_an_ambiguous_match(self):
        self.history()
        self.serial += 1
        name='GetOneTypeLifePictorialBookCountRsp'
        stem=f'{self.serial:05}_s0_s2c_{codes[name]}_{name}'
        packet=dict(msg_id=codes[name],packet_id=9,seq_id=90,decompress_err=None)
        self.contexts.add(proto,name,b'\xff',packet,0,'s2c',stem)
        self.collector.add(name,b'\xff','raw/'+stem+'.bin',self.contexts.match('raw/'+stem+'.bin',name,b'\xff'))
        report=self.summary()
        self.assertEqual(report['history']['types'][3]['state'],'unknown')
        self.assertTrue(any(r['reason']=='ambiguous_packet_id' for r in report['unclassified']))

    def test_multiple_accounts_do_not_establish_single_account_coverage(self):
        self.history()
        self.identities.add(8765002, 7654002)
        report = self.summary()
        self.assertFalse(report['attributed'])
        self.assertEqual(quality_items(report)[1]['state'], 'unknown')

    def test_unknown_request_enums_are_preserved_without_assigning_a_list(self):
        self.history(kind=-1)
        self.add('FriendReq', proto.FriendReq(type=-1), packet_id=17)
        self.add('FriendRsp', proto.FriendRsp(status=1), packet_id=17)
        report=self.summary()
        self.assertTrue(all(r['state']=='unknown' for r in report['history']['types']))
        self.assertTrue(all(r['state']=='unknown' for r in report['social']['types']))
        self.assertEqual(sum(r['reason']=='unsupported_request_type' for r in report['unclassified']),2)

    def test_snapshots_are_not_summed_and_partial_base_fields_stay_partial(self):
        self.history(pid=11, count=2)
        self.history(pid=12, count=3)
        sparse = proto.GetLifeInfoRsp(status=1)
        sparse.life_base_info.life_type = 4
        self.add('GetLifeInfoRsp', sparse)
        report = self.summary()
        row = next(r for r in report['history']['types'] if r['type_id'] == 4)
        self.assertEqual([s['counts'][0]['count'] for s in row['snapshots']], ['2', '3'])
        self.assertEqual(next(r for r in report['base']['types'] if r['type_id'] == 4)['state'], 'partial')

    def test_context_mismatch_and_duplicate_sources_are_rejected(self):
        self.history()
        document = self.contexts.document()
        context = PacketContexts(document)
        row = document['records'][0]
        with self.assertRaisesRegex(ValueError, '内容不一致'):
            context.match(row['source'], row['message'], b'changed')
        document['records'].append(dict(row))
        with self.assertRaisesRegex(ValueError, '重复'):
            PacketContexts(document)

    def test_untyped_base_sections_remain_unknown_and_compact_view_keeps_complete_evidence(self):
        sparse = basic(4)
        sparse.life_skill.life_type = 0
        sparse.life_achieve.life_type = 0
        for pid in range(6):
            self.add('GetLifeInfoRsp', sparse, packet_id=pid + 1)
        row = self.summary()['base']['types'][3]
        self.assertEqual(row['state'], 'partial')
        self.assertIsNone(row['snapshots'][0]['skills'])
        self.assertIsNone(row['snapshots'][0]['rewarded'])
        self.add('GetLifeInfoRsp', basic(4), packet_id=8)
        row = self.collector.summary(self.identities, compact=True)['base']['types'][3]
        self.assertEqual(row['state'], 'collected')
        self.assertEqual(len(row['snapshots'][0]['sections']), 3)

    def test_pcap_zip_roundtrip_preserves_pairing_and_only_whitelisted_requests(self):
        main = main_data(8765001)
        main.player_label = 7654001
        request = proto.GetOneTypeLifePictorialBookCountReq(life_type=4)
        response = proto.GetOneTypeLifePictorialBookCountRsp(status=1)
        response.life_achieve_count_lst.add(id=2101, count=3)
        source = self.root / 'sample.pcap'
        payloads = [(1, frame('GetOneTypeLifePictorialBookCountReq', request, packet_id=30, seq_id=12), 0),
                    (1, frame('FriendReq', proto.FriendReq(type=3), packet_id=31, seq_id=13), 0),
                    (1, frame('GetWeaponReq', proto.GetWeaponReq(), packet_id=32), 0),
                    (0, frame('PlayerMainDataRsp', main, packet_id=1), 0),
                    (0, frame('GetOneTypeLifePictorialBookCountRsp', response, packet_id=30, seq_id=800), 0),
                    (0, frame('FriendRsp', proto.FriendRsp(status=1), packet_id=31, seq_id=801), 0)]
        pcap(source, payloads)
        result = capture.analyze(source, self.root / 'first', TOOLKIT)
        archive = Path(result['account_zip'])
        with ZipFile(archive) as z:
            self.assertIsNone(z.testzip())
            self.assertIn('packet-context.json', z.namelist())
            self.assertIn('life-social.json', z.namelist())
            self.assertTrue(any('FriendReq.bin' in n for n in z.namelist()))
            self.assertFalse(any('GetWeaponReq' in n for n in z.namelist()))
            report = json.loads(z.read('life-social.json'))
            row = next(r for r in report['history']['types'] if r['type_id'] == 4)
            self.assertEqual(row['snapshots'][0]['counts'], [dict(id=2101, count='3')])
        reopened = capture.analyze(archive, self.root / 'second', TOOLKIT)
        with ZipFile(reopened['account_zip']) as z:
            self.assertEqual(json.loads(z.read('life-social.json')), report)
        details = {}
        capture.checklist.scan_pcap(capture.load_parser(TOOLKIT), source, details=details)
        self.assertEqual(details['life_social']['history']['types'][3]['state'], 'collected')
        self.assertEqual(details['life_social']['social']['types'][3]['state'], 'empty')


if __name__ == '__main__':
    unittest.main()
