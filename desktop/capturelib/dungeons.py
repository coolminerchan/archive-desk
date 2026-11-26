"""Export observed dungeon snapshots; never unlock content or invent completion."""
from collections import defaultdict
from google.protobuf.json_format import MessageToDict

DETAIL_PACKETS = {'DungeonViewRsp', 'DungeonEnterRsp', 'DungeonRepeatEnterRsp', 'DungeonFinishRsp'}
PACKETS = DETAIL_PACKETS | {'SceneDataNotice', 'DungeonOpenFinalBoxNotice'}


class Dungeons:
    def __init__(self, proto):
        self.proto = proto
        self.rows = {}
        self.responses = defaultdict(int)
        self.unattributed_responses = 0

    def add(self, name, raw, source):
        if name not in PACKETS:
            return
        message = getattr(self.proto, name).FromString(raw)
        allowed = (0, 1) if name.endswith('Notice') else (1,)
        if message.status not in allowed:
            return
        self.responses[name] += 1
        snapshots = []
        if name == 'SceneDataNotice':
            from exploration import is_garden_scene
            if is_garden_scene(message.data):
                return
            snapshots = list(message.data.dungeons)
        elif name in DETAIL_PACKETS and message.HasField('dungeon_data'):
            snapshots = [message.dungeon_data]
        elif name == 'DungeonOpenFinalBoxNotice' and message.dungeon_id:
            row = self.row(message.dungeon_id)
            row['events'].append(dict(source, message=name, event='secret_box_opened'))
            return
        if name != 'SceneDataNotice' and not snapshots:
            self.unattributed_responses += 1
        for data in snapshots:
            if not data.dungeon_id:
                self.unattributed_responses += 1
                continue
            row = self.row(data.dungeon_id)
            snapshot = dict(source, message=name, data=MessageToDict(data, preserving_proto_field_name=True,
                            always_print_fields_with_no_presence=True, use_integers_for_enums=True))
            if name == 'SceneDataNotice':
                scene = message.data.scene_id
                if scene and scene not in row['scene_ids']:
                    row['scene_ids'].append(scene)
            else:
                row['detail_responses'] += 1
                for field in ('task_data_lst', 'treasure_boxes'):
                    if field in message.DESCRIPTOR.fields_by_name:
                        snapshot[field] = [MessageToDict(value, preserving_proto_field_name=True,
                                            always_print_fields_with_no_presence=True, use_integers_for_enums=True)
                                           for value in getattr(message, field)]
            row['snapshots'].append(snapshot)

    def row(self, dungeon_id):
        return self.rows.setdefault(int(dungeon_id), dict(dungeon_id=int(dungeon_id), scene_ids=[],
                                   detail_responses=0, snapshots=[], events=[]))

    def summary(self, identities, *, compact=False):
        single = identities.single()
        rows = []
        for _, value in sorted(self.rows.items()):
            row = dict(value)
            row['observed_finished'] = (any(s['data']['all_task_finished'] for s in row['snapshots'])
                                       if single and row['snapshots'] else None)
            row['coverage'] = 'detail_observed' if row['detail_responses'] else 'scene_summary_only' if row['snapshots'] else 'event_only'
            if compact:
                row['snapshot_count'] = len(row.pop('snapshots'))
                row['event_count'] = len(row.pop('events'))
            rows.append(row)
        return dict(schema_version=1, account_uid=single['uid'] if single else None,
                    protocol_player_id=single['player_id'] if single else None,
                    attributed=single is not None, observed_count=len(rows),
                    detailed_count=sum(row['detail_responses'] > 0 for row in rows),
                    declared_total=None, complete=False, database_imported=False,
                    merge_policy='retain_each_observed_snapshot_no_cross_field_merge',
                    responses=dict(self.responses), unattributed_responses=self.unattributed_responses, dungeons=rows)


def render_report(report):
    lines = ['小副本观测记录（不是全部副本完整清单；未写入服务端存档）',
             f"登录 UID: {report['account_uid'] or '未返回'}；内部角色 ID: {report['protocol_player_id'] or '未确认'}",
             f"已见副本 {report['observed_count']} 个；含独立详情 {report['detailed_count']} 个；全部副本总数未知。",
             '优先查看各地区的副本详情；需要保留副本内宝箱状态时，可进入对应副本等待加载。无需为采集领取奖励或重打全部副本。',
             '全开放入口不会恢复原有通关、星级、奖励和宝箱历史。']
    for row in report['dungeons']:
        finished = '已见完成记录' if row['observed_finished'] else '未见完成记录' if row['observed_finished'] is False else '归属或状态未确认'
        lines.append(f"副本 {row['dungeon_id']}：{finished}；场景 {row['scene_ids']}；独立详情响应 {row['detail_responses']} 次；覆盖 {row['coverage']}")
    return '\n'.join(lines) + '\n'
