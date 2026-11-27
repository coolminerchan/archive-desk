import json
import unittest
from zipfile import ZipFile
import test_capture as fixtures
from test_capture import TOOLKIT, capture, codes, frame, main_data, pcap, proto
from scene_metadata import CATALOG, scene_metadata
from world_activities import WorldActivities


class WorldActivityTests(unittest.TestCase):
    setUp = fixtures.CaptureTests.setUp
    tearDown = fixtures.CaptureTests.tearDown
    zip = fixtures.CaptureTests.zip
    def activity(self):
        scene=proto.SceneDataNotice(status=1)
        scene.data.scene_id=1;scene.data.channel_id=987650001
        scene.data.flags.add(battle_id=1001,type=1,state=1,finish_times=1)
        scene.data.flags.add(battle_id=10001,type=0,state=1,finish_times=1)
        scene.data.flag_ids.append(10002)
        scene.data.challenges.add(challenge_id=102001,state=0,use_time=23000)
        scene.data.riddles.add(riddle_id=200001,state=0,is_win=True)
        return scene

    def test_names_use_explicit_resource_joins_with_unknown_names_retained(self):
        self.assertEqual(len(CATALOG['scenes']),156)
        self.assertEqual(scene_metadata(1)['scene_name'],'樱庭世界·昼')
        self.assertEqual(scene_metadata(2)['scene_name'],'贝海姆世界·正')
        self.assertEqual(scene_metadata(1002)['scene_name'],'鸳鸯锅')
        self.assertFalse(scene_metadata(6)['scene_name_known'])
        self.assertFalse(scene_metadata(987654)['scene_name_known'])

    def test_scenic_completion_does_not_come_from_unlock_flags(self):
        observer=WorldActivities(proto);scene=self.activity()
        observer.add('SceneDataNotice',scene.SerializeToString(),{'test':'one'})
        report=observer.summary(987650001,987650001)
        self.assertEqual([r['id'] for r in report['records']['scenic']],[1001])
        self.assertTrue(report['records']['scenic'][0]['observed_completed'])
        self.assertEqual(report['records']['scenic'][0]['scene_id'],1)

    def test_start_state_and_use_time_stay_unknown_while_riddle_win_is_retained(self):
        observer=WorldActivities(proto);observer.add('SceneDataNotice',self.activity().SerializeToString(),{})
        report=observer.summary(987650001,987650001)
        challenge=report['records']['challenge'][0]
        self.assertIsNone(challenge['observed_completed'])
        self.assertEqual(challenge['scene_id'],2)  # Table mapping; container scene is 1.
        self.assertTrue(report['records']['riddle'][0]['observed_completed'])
        self.assertIsNone(report['records']['riddle'][0]['scene_id'])

    def test_repeated_global_histories_are_counted_once_and_foreign_histories_unattributed(self):
        observer=WorldActivities(proto)
        for _ in range(3):observer.add('SceneDataNotice',self.activity().SerializeToString(),{})
        rank=proto.ChallengeFriendRankRsp(status=1)
        rank.self_challenge.player_id=12345;rank.self_challenge.challenge_infos.add(challenge_id=100001,use_time=42)
        observer.add('ChallengeFriendRankRsp',rank.SerializeToString(),{})
        report=observer.summary(987650001,987650001,compact=True)
        self.assertEqual(report['categories'][1]['observed_count'],1)
        self.assertEqual(report['records']['challenge'][0]['observation_count'],3)
        self.assertEqual(report['challenge_history_count'],0)
        self.assertEqual(report['unattributed_observations'],1)

    def test_empty_or_foreign_scene_records_do_not_establish_account_activity_coverage(self):
        observer=WorldActivities(proto)
        scene=self.activity();scene.data.channel_id=12345
        observer.add('SceneDataNotice',scene.SerializeToString(),{})
        report=observer.summary(987650001,987650001)
        self.assertTrue(all(row['state']=='unknown' for row in report['categories']))
        self.assertFalse(any(row['complete'] for row in report['categories']))

    def test_failed_responses_are_not_completion_evidence(self):
        observer=WorldActivities(proto)
        response=proto.ChallengeStateUpdateRsp(status=2)
        response.challenge_data.challenge_id=100001;response.challenge_data.state=1
        observer.add('ChallengeStateUpdateRsp',response.SerializeToString(),{})
        self.assertEqual(observer.summary(987650001,987650001)['records']['challenge'],[])

    def test_archive_roundtrip_preserves_original_activity_fields_and_named_scenes(self):
        path=self.zip([('PlayerMainDataRsp',main_data()),('SceneDataNotice',self.activity())])
        report=capture.analyze(path,self.root/'first',TOOLKIT)
        self.assertEqual(report['exploration']['maps']['1']['scene_name'],'樱庭世界·昼')
        self.assertEqual(report['own_scenes']['scenes'][0]['scene_name'],'樱庭世界·昼')
        archive=report['account_zip']
        with ZipFile(archive) as z:
            activity=json.loads(z.read('world-activities.json'))
            original=z.read(f'raw/00001_s0_s2c_{codes["SceneDataNotice"]}_SceneDataNotice.bin')
            self.assertEqual(original,self.activity().SerializeToString())
            self.assertEqual(activity['categories'][2]['observed_completed_count'],1)
        reopened=capture.analyze(__import__('pathlib').Path(archive),self.root/'second',TOOLKIT)
        self.assertEqual(reopened['exploration']['activities'],report['exploration']['activities'])

    def test_live_pcap_recognizes_activity_histories_and_known_empty_is_not_assumed(self):
        path=self.root/'sample.pcap'
        pcap(path,[(0,frame('PlayerMainDataRsp',main_data()),0),(0,frame('SceneDataNotice',self.activity()),0)])
        details={};capture.checklist.scan_pcap(capture.load_parser(TOOLKIT),path,details=details)
        self.assertEqual(details['exploration']['maps']['1']['scene_name'],'樱庭世界·昼')
        self.assertEqual(details['exploration']['activities']['categories'][0]['observed_completed_count'],1)


if __name__=='__main__':unittest.main()
