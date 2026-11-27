"""Observed ability badge state. BlessTree is a different protocol family."""
import hashlib

PACKETS = {'AbilityBadgeListRsp'}


class NebulaTree:
    def __init__(self, proto):
        self.proto = proto
        self.snapshots = []

    def add(self, name, raw, source):
        if name not in PACKETS:
            return
        message = self.proto.AbilityBadgeListRsp.FromString(raw)
        if message.status != 1:
            return
        pages = [dict(page=int(p.page), reward_claimed=bool(p.is_reward),
                      active_node_ids=sorted(set(p.active_box_ids))) for p in message.ability_badge_pages]
        self.snapshots.append(dict(source=dict(source), body_sha256=hashlib.sha256(raw).hexdigest(),
            pages=pages, achievements=[dict(id=int(a.achieve_id), count=str(a.count))
                for a in message.ability_badge_achieves],
            rewarded_achievement_ids=sorted(set(message.ability_badge_reward_achieve_ids))))

    def summary(self, player_id, uid=None, *, compact=False):
        # Display one richest successful observation, never a synthetic merged save.
        best = max(self.snapshots, key=lambda s: (len(s['pages']),
            sum(len(p['active_node_ids']) for p in s['pages']), len(s['achievements'])), default=None)
        attributed = bool(player_id)
        pages = [] if best is None else [dict(p, active_node_count=len(p['active_node_ids'])) for p in best['pages']]
        return dict(schema_version=1, attributed=attributed, protocol_player_id=player_id, account_uid=uid,
            state='unknown' if not attributed or best is None else 'collected' if
                best['pages'] or best['achievements'] or best['rewarded_achievement_ids'] else 'empty',
            snapshot_count=len(self.snapshots), page_count=len(pages), pages=pages,
            active_node_count=sum(p['active_node_count'] for p in pages),
            achievement_count=len(best['achievements']) if best else None,
            rewarded_achievement_count=len(best['rewarded_achievement_ids']) if best else None,
            display_source=best['source'] if best else None,
            display_body_sha256=best['body_sha256'] if best else None,
            selection_policy='richest_successful_snapshot_not_latest_or_union',
            total_verified=False, database_imported=False,
            **({} if compact else dict(snapshots=self.snapshots)))


def render_report(report):
    lines = ['星云树记录（原始响应观测，不代表已恢复游戏进度）']
    if report['state'] == 'unknown':
        lines.append('未收到成功列表或缺少唯一账号归属。请先重解析已有记录，仍缺少时再打开游戏里的星云树页面。')
    else:
        lines.append(f"已观测 {report['page_count']} 页、{report['active_node_count']} 个已激活节点；任务进度 {report['achievement_count']} 条；已领奖 {report['rewarded_achievement_count']} 项。")
        for page in report['pages']:
            lines.append(f"分区 {page['page']}：已激活 {page['active_node_count']} 个；分页奖励 {'已领取' if page['reward_claimed'] else '未领取'}；节点 {page['active_node_ids']}")
    lines.append('展示信息较多的一份成功快照；各页独立计数，全部快照与原始回包分别保留。不声称全部分区采齐。')
    return '\n'.join(lines) + '\n'
