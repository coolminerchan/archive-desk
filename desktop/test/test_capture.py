"""Regression coverage for data loss, evidence ambiguity and archive handling."""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import capture_report as capture

TOOLKIT = Path(os.environ['OVERFIELD_CAPTURE_TOOLKIT']).resolve()
parser = capture.load_parser(TOOLKIT)
proto = parser.net_pb2
codes = {name: code for code, name in parser.load_cmd_map().items()}


def frame(name, message, *, packet_id=0, seq_id=0):
    body = message.SerializeToString()
    head = proto.PacketHead(msg_id=codes[name], body_len=len(body), packet_id=packet_id, seq_id=seq_id).SerializeToString()
    return struct.pack('>H', len(head)) + head + body


def pcap(path, payloads, server_port=39991):
    """Small real Ethernet/IP/TCP capture, including direction and sequence gaps."""
    seqs = [100, 800]
    with path.open('wb') as file:
        file.write(struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1))
        for index, (direction, payload, gap) in enumerate(payloads):
            seqs[direction] += gap
            src, dst = (('198.51.100.2', '192.0.2.1') if not direction else ('192.0.2.1', '198.51.100.2'))
            sport, dport = (server_port, 45678) if not direction else (45678, server_port)
            tcp = struct.pack('!HHIIBBHHH', sport, dport, seqs[direction], 1, 0x50, 0x18, 65535, 0, 0)
            ip = struct.pack('!BBHHHBBH4s4s', 0x45, 0, 40 + len(payload), index, 0, 64, 6, 0,
                             socket.inet_aton(src), socket.inet_aton(dst))
            packet = bytes.fromhex('00112233445566778899aabb0800') + ip + tcp + payload
            file.write(struct.pack('<IIII', 100 + index, 0, len(packet), len(packet)))
            file.write(packet)
            seqs[direction] += len(payload)


def main_data(uid=987650001):
    return proto.PlayerMainDataRsp(status=proto.StatusCode_OK, player_id=uid, player_label=uid, player_name='Test')


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def zip(self, packets, summary=None, name='input.zip'):
        target = self.root / name
        with ZipFile(target, 'w') as archive:
            if summary is not None:
                archive.writestr('summary.json', json.dumps(summary))
            for i, (key, message) in enumerate(packets):
                archive.writestr(f'raw/{i:05}_s0_s2c_{codes[key]}_{key}.bin', message.SerializeToString())
        return target

    def analyze(self, path):
        return capture.analyze(path, self.root / 'output', TOOLKIT)

    def follow_output(self, lines):
        output = 'Follow: tcp,raw\nNode 0: 198.51.100.2:11003\nNode 1: 192.0.2.1:45678\n'
        output += '\n'.join(('\t' if direction else '') + data.hex() for direction, data in lines) + '\n====\n'
        with patch.object(parser.subprocess, 'run', side_effect=[
                subprocess.CompletedProcess([], 0, output, ''), subprocess.CompletedProcess([], 0, '', '')]):
            return parser._follow_tcp_stream(self.root / 'unused.pcap', 0)

    def test_tcp_markers_keep_only_each_direction_prefix(self):
        marker = b'[5 bytes missing in capture file]\0'
        cases = [
            ([(0,b'ABC'),(0,marker),(0,b'AFTER'),(1,b'REVERSE')], b'ABC', b'REVERSE', {0}),
            ([(0,b'ABC'+marker+b'SUFFIX'),(0,b'AFTER'),(1,b'REVERSE')], b'ABC', b'REVERSE', {0}),
            ([(0,b'ABC'+marker),(0,marker),(0,b'AFTER')], b'ABC', b'', {0}),
            ([(0,b'ABC'+marker),(1,b'DEF'+marker),(0,b'AFTER'),(1,b'AFTER')], b'ABC', b'DEF', {0,1}),
        ]
        for lines, forward, backward, gaps in cases:
            with self.subTest(lines=lines):
                _,_,actual_forward,actual_backward,actual_gaps=self.follow_output(lines)
                self.assertEqual((actual_forward,actual_backward,actual_gaps),(forward,backward,gaps))

    def test_gap_keeps_reverse_direction_and_exports_valid_prefix_once(self):
        path=self.root/'gap-prefix.pcap'
        first=frame('PlayerMainDataRsp',main_data())
        reverse=frame('GetWeaponReq',proto.GetWeaponReq())
        pcap(path,[(0,first,0),(0,b'ORPHAN',23),(1,reverse,0)],server_port=11003)
        _,_,forward,backward,gaps=parser._follow_tcp_stream(path,0)
        self.assertEqual(forward,first)
        self.assertEqual(backward,reverse)
        self.assertEqual(gaps,{0})
        result=self.analyze(path)
        self.assertEqual(result['quality']['tcp_gap_directions'],1)
        self.assertTrue(Path(result['account_zip']).is_file())
        self.assertEqual(len(list((self.root/'output').glob('account_*.zip'))),1)
        self.assertFalse((self.root/'output/.responses.zip').exists())

    def test_quality_counts_directions_once_and_does_not_call_tails_packet_loss(self):
        summary={'incomplete_streams':[{'stream_id':1,'direction':'s2c','tcp_gap':True},
                 {'stream_id':1,'direction':'s2c','tcp_gap':True},
                 {'stream_id':1,'direction':'s2c','trailing_bytes':5},
                 {'stream_id':2,'direction':'c2s','trailing_bytes':2}],
                 'trailing_streams':[{'stream_id':1,'direction':'s2c','remaining_bytes':5}]}
        result=self.analyze(self.zip([('PlayerMainDataRsp',main_data())],summary))
        q=result['quality']
        self.assertEqual((q['tcp_gap_directions'],q['tail_directions'],q['incomplete_directions']),(1,2,2))
        self.assertEqual(result['gaps'],1)
        self.assertTrue(any('不等同于网络丢包' in w for w in result['warnings']))
        self.assertEqual(q['decode_failures'],0)

    def test_old_archive_unknown_quality_is_not_reported_as_zero(self):
        result=self.analyze(self.zip([('PlayerMainDataRsp',main_data())]))
        self.assertIsNone(result['quality']['tcp_gap_directions'])
        self.assertIsNone(result['quality']['tail_directions'])

    def dungeon_packets(self):
        scene=proto.SceneDataNotice()
        scene.data.scene_id=1
        scene.data.dungeons.add(dungeon_id=11101,all_task_finished=True,finish_times=3)
        scene.data.dungeons.add(dungeon_id=11102)
        view=proto.DungeonViewRsp(status=1)
        view.dungeon_data.dungeon_id=11101
        view.dungeon_data.all_task_finished=True
        view.task_data_lst.add()
        enter=proto.DungeonEnterRsp(status=1)
        enter.dungeon_data.dungeon_id=11102
        enter.treasure_boxes.add(box_id=999,state=proto.TreasureBoxState_Open)
        return [('PlayerMainDataRsp',main_data()),('SceneDataNotice',scene),('DungeonViewRsp',view),('DungeonEnterRsp',enter)]

    def test_dungeon_summaries_details_and_boxes_are_exported_without_unlocking(self):
        result=self.analyze(self.zip(self.dungeon_packets(),{'incomplete_streams':[]}))
        d=result['dungeons']
        self.assertEqual((d['observed_count'],d['detailed_count']),(2,2))
        self.assertFalse(d['complete'])
        self.assertFalse(d['database_imported'])
        self.assertIsNone(d['declared_total'])
        self.assertEqual(d['dungeons'][0]['snapshots'][0]['data']['finish_times'],3)
        self.assertEqual(len(d['dungeons'][0]['snapshots'][1]['task_data_lst']),1)
        self.assertEqual(d['dungeons'][1]['snapshots'][1]['treasure_boxes'][0]['box_id'],999)
        self.assertFalse(d['dungeons'][1]['observed_finished'])
        with ZipFile(result['account_zip']) as z:
            self.assertEqual(len(z.namelist()),len(set(z.namelist())))
            self.assertEqual(json.loads(z.read('dungeons.json')),d)
            self.assertIn('无需为采集领取奖励',z.read('dungeons.txt').decode('utf-8'))
            saved=json.loads(z.read('capture-report.json'))
            self.assertEqual(saved['timings'],result['timings'])

    def test_unseen_dungeon_details_are_not_inferred_from_scene_or_failed_response(self):
        failed=proto.DungeonViewRsp(status=0)
        failed.dungeon_data.dungeon_id=11101
        result=self.analyze(self.zip([*self.dungeon_packets()[:2],('DungeonViewRsp',failed)]))
        self.assertEqual(result['dungeons']['observed_count'],2)
        self.assertEqual(result['dungeons']['detailed_count'],0)
        self.assertTrue(all(row['coverage']=='scene_summary_only' for row in result['dungeons']['dungeons']))
        self.assertEqual(next(x for x in result['items'] if x['id']=='dungeon_details')['state'],'missing')

    def test_garden_dungeons_are_excluded_and_multiaccount_observations_unattributed(self):
        packets=self.dungeon_packets()[:2]
        garden=proto.SceneDataNotice()
        garden.data.scene_id=9999
        garden.data.dungeons.add(dungeon_id=555555)
        result=self.analyze(self.zip([*packets,('SceneDataNotice',garden),('PlayerMainDataRsp',main_data(987650002))]))
        self.assertEqual(result['dungeons']['observed_count'],2)
        self.assertFalse(result['dungeons']['attributed'])
        self.assertTrue(all(row['observed_finished'] is None for row in result['dungeons']['dungeons']))
        self.assertNotIn('account_zip',result)

    def test_live_dungeon_evidence_matches_final_without_copying_snapshot_bodies(self):
        path=self.root/'dungeons.pcap'
        pcap(path,[(0,b''.join(frame(name,msg) for name,msg in self.dungeon_packets()),0)])
        details={}
        capture.checklist.scan_pcap(parser,path,details=details)
        self.assertEqual(details['dungeons']['observed_count'],2)
        self.assertNotIn('snapshots',details['dungeons']['dungeons'][0])
        result=self.analyze(path)
        self.assertEqual(result['dungeons']['observed_count'],details['dungeons']['observed_count'])

    def test_session_timings_are_numeric_allowlisted_and_old_capture_times_not_reused(self):
        path=self.zip([('PlayerMainDataRsp',main_data())],{'incomplete_streams':[], 'timings':{'conversion_ms':999999}})
        result=capture.analyze(path,self.root/'output',TOOLKIT,dict(preparation_ms=42,recording_ms=-1,
            conversion_ms='private-ticket',first_response_observed_ms=11,capture_backend='compact-etw',access_code='private-code'))
        self.assertEqual(result['session_timings'],dict(preparation_ms=42,first_response_observed_ms=11))
        self.assertNotIn('conversion_ms',result['timings'])
        self.assertEqual(result['capture_backend'],'compact-etw')

    def test_public_uid_is_exported_without_changing_protocol_or_garden_ownership(self):
        main = main_data(8765001)
        main.player_label = 7654001
        own = proto.SceneDataNotice()
        own.data.scene_id = 9999
        own.data.channel_id = main.player_id
        own.data.channel_label = main.player_label
        own.data.scene_garden_data.SetInParent()
        friend = proto.SceneDataNotice()
        friend.data.scene_id = 9999
        friend.data.channel_id = main.player_label  # Collision must not make this our garden.
        friend.data.channel_label = 8888888
        friend.data.scene_garden_data.SetInParent()
        result = self.analyze(self.zip([('PlayerMainDataRsp', main), ('SceneDataNotice', own), ('SceneDataNotice', friend)]))
        self.assertEqual(result['account_uid'], 7654001)
        self.assertEqual(result['accounts_detail'][0]['player_id'], 8765001)
        self.assertEqual(Path(result['account_zip']).name, 'account_7654001.zip')
        self.assertEqual([g['owner_uid'] for g in result['gardens']], [7654001])
        self.assertEqual(next(x for x in result['items'] if x['id'] == 'garden')['state'], 'collected')
        with ZipFile(result['account_zip']) as archive:
            summary = json.loads(archive.read('summary.json'))
            self.assertEqual(summary['player_uids'], [8765001])  # Legacy importer contract.
            self.assertEqual(summary['player_uids_kind'], 'protocol_player_id')
            self.assertEqual(summary['account_uids'], [7654001])
            self.assertEqual(summary['exploration']['account_uid'], 7654001)
            self.assertEqual(summary['exploration']['protocol_player_id'], 8765001)
            raws = [n for n in archive.namelist() if n.endswith('PlayerMainDataRsp.bin')]
            self.assertEqual(archive.read(raws[0]), main.SerializeToString())
            scenes = [proto.SceneDataNotice.FromString(archive.read(n)) for n in archive.namelist() if n.endswith('SceneDataNotice.bin')]
            self.assertEqual([s.data.channel_id for s in scenes], [8765001])

    def test_known_public_uid_survives_later_response_without_label(self):
        missing = main_data(8765001)
        missing.player_label = 0
        known = main_data(8765001)
        known.player_label = 7654001
        result = self.analyze(self.zip([('PlayerMainDataRsp', missing), ('PlayerMainDataRsp', known), ('PlayerMainDataRsp', missing)]))
        self.assertEqual(result['account_uid'], 7654001)
        self.assertEqual(result['accounts_detail'][0]['player_label'], 7654001)
        self.assertEqual(Path(result['account_zip']).name, 'account_7654001.zip')

    def test_missing_public_uid_is_never_presented_as_login_uid(self):
        main = main_data(8765001)
        main.player_label = 0
        result = self.analyze(self.zip([('PlayerMainDataRsp', main)]))
        self.assertIsNone(result['account_uid'])
        self.assertIsNone(result['accounts_detail'][0]['uid'])
        self.assertEqual(Path(result['account_zip']).name, 'account_internal_8765001.zip')
        self.assertEqual(result['exploration']['attribution'], 'single_observed_player_id')
        self.assertTrue(any('未返回登录 UID' in w for w in result['warnings']))

    def test_conflicting_public_uids_are_not_exported_as_one_account(self):
        first = main_data(8765001)
        first.player_label = 7654001
        second = main_data(8765001)
        second.player_label = 7654002
        packets = self.map_packets()[1:]
        path = self.root / 'conflict.pcap'
        pcap(path, [(0, b''.join(frame(name, msg) for name, msg in [('PlayerMainDataRsp', first), ('PlayerMainDataRsp', second), *packets]), 0)])
        result = self.analyze(path)
        self.assertEqual(result['accounts'], 2)
        self.assertNotIn('account_zip', result)
        self.assertIsNone(result['account_uid'])
        self.assertEqual(result['exploration']['attribution'], 'unattributed_evidence')
        self.assertIsNone(result['exploration']['maps']['1']['points']['collected'])
        summary = json.loads((self.root / 'output/summary.json').read_text('utf-8'))
        self.assertNotIn('account_zip', summary)

    def test_live_and_final_public_uid_match_when_ids_differ(self):
        main = main_data(8765001)
        main.player_label = 7654001
        path = self.root / 'uid.pcap'
        pcap(path, [(0, frame('PlayerMainDataRsp', main), 0)])
        details = {}
        capture.checklist.scan_pcap(parser, path, details=details)
        self.assertEqual(details['accounts_detail'][0]['uid'], 7654001)
        self.assertEqual(details['exploration']['account_uid'], 7654001)
        self.assertEqual(details['exploration']['protocol_player_id'], 8765001)
        result = self.analyze(path)
        self.assertEqual(result['accounts_detail'][0]['player_id'], details['accounts_detail'][0]['player_id'])
        self.assertEqual(result['account_uid'], details['accounts_detail'][0]['uid'])
        summary = json.loads((self.root / 'output/summary.json').read_text('utf-8'))
        self.assertEqual(summary['player_highlights']['player_label'], 7654001)

    def test_dynamic_port_both_directions_frame_and_server_speaks_first(self):
        path = self.root / 'dynamic.pcap'
        response = frame('PlayerMainDataRsp', main_data()) + frame('GetWeaponRsp', proto.GetWeaponRsp(status=1, total_num=0))
        request = frame('GetWeaponReq', proto.GetWeaponReq())
        pcap(path, [(0, response, 0), (1, request, 0)])
        result = self.analyze(path)
        self.assertEqual(result['accounts'], 1)
        self.assertEqual(result['equipment']['weapon']['pages'], 1)
        self.assertTrue(result['equipment']['weapon']['matches'])
        self.assertEqual(next(x for x in result['items'] if x['id'] == 'weapon')['state'], 'empty')

    def test_gap_cannot_prove_equipment_complete(self):
        path = self.root / 'gap.pcap'
        first = frame('PlayerMainDataRsp', main_data()) + frame('GetWeaponRsp', proto.GetWeaponRsp(status=1, total_num=0))
        pcap(path, [(0, first, 0), (0, frame('GetArmorRsp', proto.GetArmorRsp(status=1, total_num=0)), 33)])
        result = self.analyze(path)
        self.assertGreater(result['gaps'], 0)
        self.assertFalse(result['equipment']['weapon']['matches'])
        self.assertEqual(result['equipment']['armor']['pages'], 0)

    def test_out_of_order_and_retransmissions_do_not_create_false_gap(self):
        path = self.root / 'reordered.pcap'
        main = frame('PlayerMainDataRsp', main_data())
        weapons = frame('GetWeaponRsp', proto.GetWeaponRsp(status=1, total_num=0))
        armors = frame('GetArmorRsp', proto.GetArmorRsp(status=1, total_num=0))
        pcap(path, [(0, main, 0), (0, armors, len(weapons)),
                    (0, weapons, -len(armors)-len(weapons)), (0, weapons, -len(weapons))])
        result = self.analyze(path)
        self.assertEqual(result['gaps'], 0)
        self.assertTrue(result['equipment']['weapon']['matches'])
        self.assertTrue(result['equipment']['armor']['matches'])

    def test_multifile_pcapng_sections_reassemble_one_game_frame(self):
        packet = frame('PlayerMainDataRsp', main_data()) + frame('GetWeaponRsp', proto.GetWeaponRsp(status=1, total_num=0))
        temporary = self.root / 'parts.pcap'
        pcap(temporary, [(0, packet[:10], 0), (0, packet[10:], 0)])
        raw, position = temporary.read_bytes(), 24
        def block(kind, body):
            body += b'\0' * (-len(body) % 4)
            length = len(body) + 12
            return struct.pack('<II', kind, length) + body + struct.pack('<I', length)
        sections = []
        for index in range(2):
            timestamp, _, size, _ = struct.unpack_from('<IIII', raw, position)
            payload = raw[position + 16:position + 16 + size]
            sections.append(block(0x0a0d0d0a, struct.pack('<IHHq', 0x1a2b3c4d, 1, 0, -1)) +
                block(1, struct.pack('<HHI', 1, 0, 65535)) +
                block(6, struct.pack('<IIIII', 0, 0, timestamp * 1000000, size, size) + payload))
            position += size + 16
        path = self.root / 'multifile.pcapng'
        path.write_bytes(b''.join(sections))
        result = self.analyze(path)
        self.assertEqual(result['accounts'], 1)
        self.assertEqual(result['equipment']['weapon']['pages'], 1)
        self.assertEqual(result['gaps'], 0)

    def test_push_only_transformed_and_extra_items_remain_partial(self):
        message = proto.PackNotice()
        detail = message.items.add()
        detail.transformed_item.add().weapon.instance_id = 101
        detail.extras.add().armor.instance_id = 202
        path = self.zip([('PlayerMainDataRsp', main_data()), ('PackNotice', message)])
        result = self.analyze(path)
        self.assertEqual(result['equipment']['weapon']['observed'], 1)
        self.assertEqual(result['equipment']['armor']['observed'], 1)
        self.assertFalse(result['equipment']['weapon']['matches'])
        self.assertEqual(next(x for x in result['items'] if x['id'] == 'weapon')['state'], 'partial')
        self.assertNotIn('gacha_records', [x['id'] for x in result['items']])

    def test_failed_response_does_not_count_as_empty_list(self):
        failed = proto.GetWeaponRsp(status=0)
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('GetWeaponRsp', failed)]))
        self.assertEqual(result['equipment']['weapon']['pages'], 0)
        self.assertEqual(result['rejected'], 1)
        self.assertEqual(result['decode_errors'], 0)
        self.assertEqual(next(x for x in result['items'] if x['id'] == 'weapon')['state'], 'missing')

    def test_multi_account_never_exports_merged_account(self):
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('PlayerMainDataRsp', main_data(987650002))]))
        self.assertEqual(result['accounts'], 2)
        self.assertNotIn('account_zip', result)

    def test_poster_counts_include_transformed_items_and_list(self):
        notice = proto.PackNotice()
        notice.items.add().transformed_item.add().poster.instance_id = 701
        posters = proto.GetPosterRsp(status=1, total_num=1)
        posters.posters.add().instance_id = 701
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('PackNotice', notice), ('GetPosterRsp', posters)], {'incomplete_streams': []}))
        self.assertTrue(result['equipment']['poster']['matches'])
        self.assertEqual(result['equipment']['poster']['observed'], 1)

    def test_friend_garden_is_exported_separately_from_account(self):
        scene = proto.SceneDataNotice()
        scene.data.scene_id = 9999
        scene.data.channel_id = 987650002
        scene.data.scene_garden_data.SetInParent()
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('SceneDataNotice', scene)]))
        self.assertEqual(len(result['gardens']), 1)
        self.assertEqual(result['gardens'][0]['owner_uid'], 987650002)
        self.assertEqual(next(x for x in result['items'] if x['id'] == 'garden')['state'], 'missing')
        with ZipFile(result['account_zip']) as archive:
            self.assertFalse(any('SceneDataNotice' in name for name in archive.namelist()))

    def profile(self, owner, nickname, status=1):
        message=proto.OtherPlayerInfoRsp(status=status)
        message.other_info.player_id=owner
        message.other_info.nick_name=nickname
        message.other_info.player_label=7654001
        return message

    def test_offline_garden_owners_resolve_from_profiles_in_live_pcap_and_reopened_zips(self):
        scenes=[self.garden_scene(111,2),self.garden_scene(222,3)]
        for scene in scenes:
            scene.data.ClearField('players')
            scene.data.players.add(player_id=333,player_name='Visitor')
        packets=[('OtherPlayerInfoRsp',self.profile(111,'Same Name')),('SceneDataNotice',scenes[0]),
                 ('SceneDataNotice',scenes[1]),('OtherPlayerInfoRsp',self.profile(222,'Same Name')),
                 ('OtherPlayerInfoRsp',self.profile(111,'Wrong Name',status=0)),
                 ('OtherPlayerInfoRsp',self.profile(111,''))]
        source=self.root/'offline-owners.pcap'
        pcap(source,[(0,b''.join(frame(name,message) for name,message in packets),0)])
        details={};capture.checklist.scan_pcap(parser,source,details=details)
        self.assertEqual([(r['owner_uid'],r['owner_name']) for r in details['gardens']],[(111,'Same Name'),(222,'Same Name')])
        result=capture.analyze(source,self.root/'first',TOOLKIT,purpose='gardens')
        self.assertEqual([(r['owner_uid'],r['owner_name'],r['furniture_count']) for r in result['gardens']],[(111,'Same Name',2),(222,'Same Name',3)])
        for number,path in enumerate([result['gardens'][0]['path'],result['gardens_bundle']]):
            reopened=capture.analyze(Path(path),self.root/f'reopened-{number}',TOOLKIT,purpose='gardens')
            self.assertTrue(all(r['owner_name']=='Same Name' for r in reopened['gardens']))
            third=capture.analyze(Path(reopened['gardens_bundle']),self.root/f'third-{number}',TOOLKIT,purpose='gardens')
            self.assertEqual([(r['owner_uid'],r['owner_name']) for r in reopened['gardens']],[(r['owner_uid'],r['owner_name']) for r in third['gardens']])
            with ZipFile(path) as z:self.assertFalse(any('OtherPlayerInfoRsp' in n for n in z.namelist()))
        # ZIP input exercises the analyzer independently of the PCAP parser.
        zipped=capture.analyze(self.zip(packets),self.root/'zipped',TOOLKIT,purpose='gardens')
        self.assertEqual([r['owner_name'] for r in zipped['gardens']],['Same Name','Same Name'])

    def test_profile_never_guesses_owner_by_label_and_ignores_invalid_or_failed_names(self):
        names={}
        for body in [{'status':0,'other_info':{'player_id':111,'nick_name':'Failed'}},
                     {'status':1,'other_info':{'player_id':0,'nick_name':'Invalid'}},
                     {'status':1,'other_info':{'player_id':True,'nick_name':'Invalid'}},
                     {'status':1,'other_info':{'player_id':111,'nick_name':[]}}]:
            parser.collect_player_profile('OtherPlayerInfoRsp',body,names)
        self.assertEqual(names,{})
        parser.collect_player_profile('OtherPlayerInfoRsp',{'status':1,'other_info':{'player_id':222,'player_label':111,'nick_name':'Different Owner'}},names)
        self.assertNotIn(111,names)
        self.assertEqual(names[222],'Different Owner')

    def garden_scene(self, owner, count=1):
        scene=proto.SceneDataNotice()
        scene.data.scene_id=9999
        scene.data.channel_id=owner
        scene.data.players.add(player_id=owner,player_name='Garden '+str(owner))
        for key in range(1,count+1):scene.data.scene_garden_data.garden_furniture_info_map[key].SetInParent()
        return scene

    def test_garden_module_exports_visits_as_collection_without_an_account_zip(self):
        world=proto.SceneDataNotice();world.data.scene_id=1;world.data.channel_id=222
        packets=[('PlayerMainDataRsp',main_data()),('SceneDataNotice',self.garden_scene(987650001,9)),
                 ('SceneDataNotice',self.garden_scene(987650002,2)),('SceneDataNotice',world),
                 ('SceneDataNotice',self.garden_scene(987650003,3))]
        source=self.zip(packets,{'incomplete_streams':[]})
        result=capture.analyze(source,self.root/'gardens',TOOLKIT,purpose='gardens')
        self.assertNotIn('account_zip',result)
        self.assertTrue(result['garden_account_identified'])
        self.assertEqual([row['owner_uid'] for row in result['gardens']],[987650002,987650003])
        self.assertEqual([row['furniture_count'] for row in result['gardens']],[2,3])
        with ZipFile(result['gardens_bundle']) as z:
            self.assertIsNone(z.testzip())
            self.assertFalse(any('PlayerMainDataRsp' in n for n in z.namelist()))
            self.assertEqual(json.loads(z.read('garden_collection.json'))['kind'],'garden_collection')
        reopened=capture.analyze(Path(result['gardens_bundle']),self.root/'reopened',TOOLKIT,purpose='gardens')
        self.assertEqual([row['owner_uid'] for row in reopened['gardens']],[987650002,987650003])
        self.assertEqual([row['furniture_count'] for row in reopened['gardens']],[2,3])

    def test_garden_zip_can_be_reopened_without_login_data_or_filename_growth(self):
        result=capture.analyze(self.zip([('SceneDataNotice',self.garden_scene(123,4))]),self.root/'first',TOOLKIT,purpose='gardens')
        self.assertFalse(result['garden_account_identified'])
        self.assertNotIn('account_zip',result)
        reopened=capture.analyze(Path(result['gardens'][0]['path']),self.root/'second',TOOLKIT,purpose='gardens')
        third=capture.analyze(Path(reopened['gardens'][0]['path']),self.root/'third',TOOLKIT,purpose='gardens')
        self.assertEqual(third['gardens'][0]['furniture_count'],4)
        with ZipFile(reopened['gardens'][0]['path']) as a, ZipFile(third['gardens'][0]['path']) as b:
            self.assertEqual(a.namelist(),b.namelist())
            for name in a.namelist():self.assertEqual(a.read(name),b.read(name))

    def test_garden_collection_namespaces_repeated_stems_and_keeps_payloads(self):
        source=self.root/'collection.zip'
        with ZipFile(source,'w') as z:
            for owner in (111,222):
                name=f'{owner}/raw/00001_s0_s2c_{codes["SceneDataNotice"]}_SceneDataNotice.bin'
                z.writestr(name,self.garden_scene(owner,owner//111).SerializeToString())
        original=source.read_bytes()
        result=capture.analyze(source,self.root/'separate',TOOLKIT,purpose='gardens')
        self.assertEqual([row['owner_uid'] for row in result['gardens']],[111,222])
        self.assertEqual([row['furniture_count'] for row in result['gardens']],[1,2])
        self.assertEqual(source.read_bytes(),original)

    def test_live_garden_module_excludes_known_self_and_world_scenes(self):
        path=self.root/'visits.pcap'
        world=proto.SceneDataNotice();world.data.scene_id=1;world.data.channel_id=222
        packets=[('PlayerMainDataRsp',main_data()),('SceneDataNotice',self.garden_scene(987650001,9)),
                 ('SceneDataNotice',self.garden_scene(987650002,2)),('SceneDataNotice',world)]
        pcap(path,[(0,b''.join(frame(name,message) for name,message in packets),0)])
        details={};capture.checklist.scan_pcap(parser,path,details=details)
        self.assertTrue(details['garden_account_identified'])
        self.assertEqual([row['owner_uid'] for row in details['gardens']],[987650002])
        self.assertEqual(details['gardens'][0]['furniture_count'],2)

    def test_legacy_layout_only_garden_archive_keeps_binary_and_does_not_invent_responses(self):
        layout=self.garden_scene(123,4).data.scene_garden_data
        source=self.root/'legacy.zip'
        meta=dict(owner_uid=123,owner_name='TestGarden',scene_id=9999,bin_file='garden_123_TestGarden_4items.bin')
        with ZipFile(source,'w') as z:
            z.writestr('garden_123_TestGarden_4items.json',json.dumps({'_meta':meta}))
            z.writestr(meta['bin_file'],layout.SerializeToString())
        result=capture.analyze(source,self.root/'legacy-output',TOOLKIT,purpose='gardens')
        self.assertEqual(result['successful'],0)
        self.assertEqual(result['gardens'][0]['furniture_count'],4)
        with ZipFile(result['gardens'][0]['path']) as z:
            self.assertEqual(z.read('garden_123_TestGarden_4items.bin'),layout.SerializeToString())
            self.assertFalse(any('SceneDataNotice' in n for n in z.namelist()))

    def test_legacy_garden_metadata_must_be_typed_and_cannot_escape_archive(self):
        for index,data in enumerate([[],{'_meta':[]},{'_meta':dict(owner_uid=123,scene_id=9999,bin_file='../outside.bin')} ]):
            source=self.root/f'bad-layout-{index}.zip'
            with ZipFile(source,'w') as z:z.writestr('garden_123_Test_1items.json',json.dumps(data))
            with self.assertRaises(ValueError):capture.analyze(source,self.root/f'bad-output-{index}',TOOLKIT,purpose='gardens')

    def test_duplicate_response_aliases_rejected(self):
        path = self.zip([('PlayerMainDataRsp', main_data())])
        with ZipFile(path, 'a') as archive:
            archive.writestr('export/raw/00000_s0_s2c_1006_PlayerMainDataRsp.bin', main_data().SerializeToString())
        with self.assertRaisesRegex(ValueError, '重复'):
            list(capture.zip_packets(path, parser))

    def test_decode_failure_invalidates_matching_count(self):
        path = self.zip([('PlayerMainDataRsp', main_data()), ('GetWeaponRsp', proto.GetWeaponRsp(status=1, total_num=0))], {'incomplete_streams': [], 'decode_fallback_count': 1})
        result = self.analyze(path)
        self.assertFalse(result['equipment']['weapon']['matches'])
        self.assertEqual(result['decode_errors'], 1)

    def test_reexport_preserves_unknown_and_failed_server_responses(self):
        path = self.zip([('PlayerMainDataRsp', main_data()), ('GetWeaponRsp', proto.GetWeaponRsp(status=0))])
        with ZipFile(path, 'a') as archive:
            archive.writestr('raw/009_s0_s2c_65000_Unknown_65000.bin', b'opaque-protocol')
        result = self.analyze(path)
        self.assertEqual(result['unknown'], 1)
        with ZipFile(result['account_zip']) as archive:
            self.assertEqual(archive.read('raw/009_s0_s2c_65000_Unknown_65000.bin'), b'opaque-protocol')
            self.assertTrue(any('GetWeaponRsp.bin' in name for name in archive.namelist()))

    def test_old_zip_missing_integrity_is_unknown(self):
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('GetWeaponRsp', proto.GetWeaponRsp(status=1, total_num=0))]))
        self.assertFalse(result['integrity_known'])
        self.assertFalse(result['equipment']['weapon']['matches'])

    def test_reexport_removes_login_token_and_requests(self):
        login = proto.PlayerLoginRsp(status=1, client_log_server_token='sensitive-test-token')
        path = self.zip([('PlayerMainDataRsp', main_data()), ('PlayerLoginRsp', login)])
        with ZipFile(path, 'a') as archive:
            archive.writestr('raw/099_s0_c2s_1003_PlayerLoginReq.bin', b'private-login-request')
        result = self.analyze(path)
        with ZipFile(result['account_zip']) as archive:
            data = b''.join(archive.read(name) for name in archive.namelist())
            self.assertNotIn(b'sensitive-test-token', data)
            self.assertNotIn(b'private-login-request', data)

    def test_zip_path_traversal_and_duplicates_rejected(self):
        for index, name in enumerate(('../outside', 'raw/../../outside', 'C:/outside')):
            path = self.root / f'bad{index}.zip'
            with ZipFile(path, 'w') as archive:
                archive.writestr(name, '{}')
            with self.assertRaisesRegex(ValueError, '无效路径'):
                list(capture.zip_packets(path, parser))

    def test_ethernet_compatibility_retains_original(self):
        path = self.root / 'ethernet.pcap'
        pcap(path, [(0, frame('PlayerMainDataRsp', main_data()), 0)])
        original = path.read_bytes()
        self.assertEqual(parser.prepare_capture(path), path)
        self.assertEqual(path.read_bytes(), original)

    def map_packets(self):
        import exploration
        catalog = exploration.Exploration(proto).catalog['maps']['1']
        crystal = catalog['collections']['8'][0]
        points = proto.SceneProcessListRsp(status=1)
        points.scene_process_list.add(scene_id=1, process=73)
        collected = proto.GetCollectItemIdsRsp(status=1, item_ids=[crystal])
        moon = proto.GetCollectMoonInfoRsp(status=1, scene_id=1, collected_moon_ids=[123])
        moon.emotion_moons.add(moon_id=456, interacted=True)
        scene = proto.SceneDataNotice()
        scene.data.scene_id = 1
        # Real server messages serialize an empty garden submessage on ordinary
        # world maps; channel_id is a world channel, not a garden owner UID.
        scene.data.scene_garden_data.SetInParent()
        scene.data.channel_id = 222
        index, box_id = next(iter(catalog['boxes'].items()))
        scene.data.treasure_boxes.add(index=int(index), box_id=box_id, state=proto.TreasureBoxState_Open)
        return [('PlayerMainDataRsp', main_data()), ('SceneProcessListRsp', points),
                ('GetCollectItemIdsRsp', collected), ('GetCollectMoonInfoRsp', moon), ('SceneDataNotice', scene)]

    def test_map_fields_and_human_readable_report_are_preserved_in_zip(self):
        result = self.analyze(self.zip(self.map_packets(), {'incomplete_streams': []}))
        row = result['exploration']['maps']['1']
        self.assertEqual(row['points']['collected'], 73)
        self.assertEqual(row['crystals']['collected'], 1)
        self.assertEqual(row['one_time_boxes']['collected'], 1)
        self.assertEqual(row['moons']['collected_ids'], [123])
        self.assertEqual(row['moons']['interacted_emotion_ids'], [456])
        self.assertFalse(row['complete'])
        self.assertIsNone(row['points']['percentage'])
        items = {x['id']: x for x in result['items']}
        for key in ['map_progress', 'map_collections', 'map_moons', 'map_scene', 'map_boxes']:
            self.assertEqual(items[key]['state'], 'collected')
        with ZipFile(result['account_zip']) as archive:
            self.assertIn('地图 1', archive.read('exploration.txt').decode())
            self.assertIn('探索点 73/', archive.read('exploration.txt').decode())
            self.assertIn('情绪月亮已互动ID [456]', archive.read('exploration.txt').decode())
            self.assertEqual(json.loads(archive.read('exploration.json'))['maps']['1']['points']['collected'], 73)
            world = [n for n in archive.namelist() if n.endswith('SceneDataNotice.bin')]
            self.assertEqual(len(world), 1)
        self.assertEqual(result['gardens'], [])

    def test_filtered_list_followed_by_complete_larger_list_is_not_a_conflict(self):
        filtered = proto.GetArmorRsp(status=1, total_num=1, end_index=1)
        filtered.armors.add(instance_id=101)
        complete = proto.GetArmorRsp(status=1, total_num=3, end_index=3)
        for item in [101,102,103]:complete.armors.add(instance_id=item)
        result=self.analyze(self.zip([('PlayerMainDataRsp',main_data()),('GetArmorRsp',filtered),('GetArmorRsp',complete)],{'incomplete_streams':[]}))
        self.assertTrue(result['equipment']['armor']['list_complete'])
        self.assertTrue(result['equipment']['armor']['matches'])
        self.assertEqual(result['equipment']['armor']['observed'],3)

    def test_empty_moon_response_is_zero_but_unvisited_map_stays_unknown(self):
        moon=proto.GetCollectMoonInfoRsp(status=1,scene_id=2)
        result=self.analyze(self.zip([('PlayerMainDataRsp',main_data()),('GetCollectMoonInfoRsp',moon)]))
        self.assertEqual(result['exploration']['maps']['2']['moons']['collected_count'],0)
        self.assertEqual(result['exploration']['maps']['2']['moons']['interacted_emotion_count'],0)
        self.assertIsNone(result['exploration']['maps']['3']['moons']['collected_count'])

    def test_list_match_and_preserved_push_items_are_distinct_evidence(self):
        weapons=proto.GetWeaponRsp(status=1,total_num=1,end_index=1)
        weapons.weapons.add(instance_id=101)
        notice=proto.PackNotice()
        notice.items.add().main_item.weapon.instance_id=202
        result=self.analyze(self.zip([('PlayerMainDataRsp',main_data()),('GetWeaponRsp',weapons),('PackNotice',notice)],{'incomplete_streams':[]}))
        row=result['equipment']['weapon']
        self.assertTrue(row['quantity_matches'])
        self.assertFalse(row['matches']) # No claim that the whole account scope is proven.
        self.assertEqual(row['observed'],2)
        self.assertEqual(row['other_only'],1)
        item=next(x for x in result['items'] if x['id']=='weapon')
        self.assertEqual(item['state'],'collected')
        self.assertIn('已保留',item['detail'])

    def test_incompatible_filtered_lists_do_not_create_false_complete_union(self):
        first=proto.GetArmorRsp(status=1,total_num=2,end_index=2)
        second=proto.GetArmorRsp(status=1,total_num=2,end_index=2)
        for value in [1,2]:first.armors.add(instance_id=value)
        for value in [3,4]:second.armors.add(instance_id=value)
        result=self.analyze(self.zip([('PlayerMainDataRsp',main_data()),('GetArmorRsp',first),('GetArmorRsp',second)],{'incomplete_streams':[]}))
        self.assertFalse(result['equipment']['armor']['quantity_matches'])

    def test_scene_only_does_not_claim_other_maps_or_full_collection_list(self):
        scene = proto.SceneDataNotice()
        scene.data.scene_id = 1
        incremental = proto.CollectingRsp(status=1)
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('SceneDataNotice', scene), ('CollectingRsp', incremental)]))
        items = {x['id']: x for x in result['items']}
        self.assertEqual(items['map_collections']['state'], 'partial')
        self.assertEqual(items['map_moons']['state'], 'missing')
        self.assertIsNone(result['exploration']['maps']['1']['one_time_boxes']['collected'])
        self.assertEqual(result['exploration']['maps']['2']['collection_coverage'], 'not_captured')
        self.assertIsNone(result['exploration']['maps']['2']['points']['collected'])

    def test_friend_garden_never_satisfies_world_map_guidance(self):
        scene = proto.SceneDataNotice()
        scene.data.scene_id = 9999
        scene.data.scene_garden_data.SetInParent()
        result = self.analyze(self.zip([('PlayerMainDataRsp', main_data()), ('SceneDataNotice', scene)]))
        items = {x['id']: x for x in result['items']}
        self.assertEqual(items['map_scene']['state'], 'missing')
        self.assertEqual(items['map_boxes']['state'], 'missing')

    def test_live_map_observation_matches_final_evidence(self):
        path = self.root / 'maps.pcap'
        pcap(path, [(0, b''.join(frame(name, msg) for name, msg in self.map_packets()), 0)])
        details = {}
        counts, _, _ = capture.checklist.scan_pcap(parser, path, details=details)
        self.assertEqual(counts['SceneProcessListRsp'], 1)
        self.assertEqual(details['exploration']['maps']['1']['points']['collected'], 73)
        self.assertEqual(details['exploration']['maps']['1']['moons']['collected_ids'], [123])
        self.assertNotIn('evidence', details['exploration'])


if __name__ == '__main__':
    unittest.main()
