import hashlib
import json
import unittest
from zipfile import ZipFile

import test_capture as fixtures
from test_capture import capture, proto, main_data, TOOLKIT
from nebula_tree import NebulaTree
from exploration import Exploration
from checklist import observe, report
from collections import Counter


class NebulaTreeTests(unittest.TestCase):
    setUp = fixtures.CaptureTests.setUp
    tearDown = fixtures.CaptureTests.tearDown
    zip = fixtures.CaptureTests.zip

    def packet(self):
        msg = proto.AbilityBadgeListRsp(status=1)
        msg.ability_badge_pages.add(page=1, is_reward=True, active_box_ids=[2, 2, 3])
        msg.ability_badge_pages.add(page=2, active_box_ids=[2])
        msg.ability_badge_achieves.add(achieve_id=4, count=(1 << 64) - 1)
        msg.ability_badge_reward_achieve_ids.extend([4, 4])
        return msg

    def test_page_scoped_nodes_and_uint64_counts_survive(self):
        collector = NebulaTree(proto)
        raw = self.packet().SerializeToString()
        collector.add('AbilityBadgeListRsp', raw, {'packet_stem':'sample'})
        r = collector.summary(123, 456)
        self.assertEqual(r['active_node_count'], 3)
        self.assertEqual(r['rewarded_achievement_count'], 1)
        self.assertEqual(r['snapshots'][0]['achievements'][0]['count'], '18446744073709551615')
        self.assertEqual(r['display_body_sha256'], hashlib.sha256(raw).hexdigest())
        self.assertFalse(r['total_verified'])

    def test_snapshots_never_union_nodes_or_erase_history_with_empty(self):
        c = NebulaTree(proto)
        c.add('AbilityBadgeListRsp',self.packet().SerializeToString(),{})
        later = proto.AbilityBadgeListRsp(status=1)
        later.ability_badge_pages.add(page=1,active_box_ids=[99])
        c.add('AbilityBadgeListRsp',later.SerializeToString(),{})
        c.add('AbilityBadgeListRsp',proto.AbilityBadgeListRsp(status=1).SerializeToString(),{})
        r = c.summary(123)
        self.assertEqual(r['snapshot_count'],3)
        self.assertEqual(r['active_node_count'],3)
        self.assertNotIn(99,r['pages'][0]['active_node_ids'])
        self.assertEqual(len(r['snapshots']),3)

    def test_failed_missing_empty_and_foreign_account_evidence_differ(self):
        c = NebulaTree(proto)
        c.add('AbilityBadgeListRsp',proto.AbilityBadgeListRsp(status=2).SerializeToString(),{})
        self.assertEqual(c.summary(123)['state'],'unknown')
        c.add('AbilityBadgeListRsp',proto.AbilityBadgeListRsp(status=1).SerializeToString(),{})
        self.assertEqual(c.summary(123)['state'],'empty')
        self.assertEqual(c.summary(None)['state'],'unknown')
        c.add('BlessTreeNotice',proto.BlessTreeNotice(status=1).SerializeToString(),{})
        self.assertEqual(c.summary(123)['snapshot_count'],1)

    def test_failed_responses_do_not_mark_the_checklist_complete(self):
        counts,empty=Counter(),Counter()
        observe('AbilityBadgeListRsp',{'status':2},counts,empty)
        item=lambda:next(r for r in report(counts,empty,readable=True,phase='complete')['items'] if r['id']=='nebula')
        self.assertEqual(item()['state'],'missing')
        observe('AbilityBadgeListRsp',{'status':1},counts,empty)
        self.assertEqual(item()['state'],'empty')
        observe('AbilityBadgeListRsp',{'status':1,'ability_badge_pages':[{'page':1}]},counts,empty)
        self.assertEqual(item()['state'],'collected')

    def test_reopening_original_archive_exports_evidence_without_changing_raw(self):
        original=self.zip([('PlayerMainDataRsp',main_data()),('AbilityBadgeListRsp',self.packet())])
        first=capture.analyze(original,self.root/'first',TOOLKIT)
        second=capture.analyze(self.root/'first'/('account_'+str(main_data().player_label)+'.zip'),self.root/'second',TOOLKIT)
        self.assertEqual(first['exploration']['nebula_tree'],second['exploration']['nebula_tree'])
        with ZipFile(first['account_zip']) as exported, ZipFile(original) as source:
            nebula=json.loads(exported.read('nebula-tree.json'))
            self.assertEqual(nebula['active_node_count'],3)
            for name in source.namelist():
                if name.startswith('raw/'):
                    self.assertEqual(source.read(name),exported.read(name))

    def test_mixed_accounts_remain_unattributed_in_exploration(self):
        e=Exploration(proto)
        e.add('AbilityBadgeListRsp',self.packet().SerializeToString(),{})
        self.assertEqual(e.summary([123,456])['nebula_tree']['state'],'unknown')


if __name__ == '__main__':
    unittest.main()
