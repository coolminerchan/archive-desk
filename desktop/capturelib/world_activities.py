"""Keep scenic, challenge, and riddle observations separate from game restoration."""
from collections import defaultdict
import hashlib
from scene_metadata import CATALOG, scene_metadata

PACKETS = {'SceneDataNotice', 'ChallengeFriendRankRsp', 'ChallengeStateUpdateRsp',
           'RiddleStateUpdateRsp', 'FlagBattleStateUpdateRsp'}


class WorldActivities:
    def __init__(self, proto):
        self.proto = proto
        self.records = []
        self.responses = defaultdict(int)

    def add(self, name, raw, source):
        if name not in PACKETS:
            return
        message = getattr(self.proto, name).FromString(raw)
        if message.status not in ((0, 1) if name.endswith('Notice') else (1,)):
            return
        self.responses[name] += 1
        context = dict(message=name, source=source, body_sha256=hashlib.sha256(raw).hexdigest(), scene_id=None, owner_id=None, owner_label=None)
        if name == 'SceneDataNotice':
            scene = message.data
            context.update(scene_id=int(scene.scene_id), owner_id=int(scene.channel_id), owner_label=int(scene.channel_label))
            groups = [('scenic', [v for v in scene.flags if v.type == 1], 'battle_id'),
                      ('challenge', scene.challenges, 'challenge_id'), ('riddle', scene.riddles, 'riddle_id')]
        elif name == 'ChallengeFriendRankRsp':
            context['owner_id'] = int(message.self_challenge.player_id)
            groups = [('challenge_history', message.self_challenge.challenge_infos, 'challenge_id')]
        elif name == 'ChallengeStateUpdateRsp':
            groups = [('challenge', [message.challenge_data] if message.HasField('challenge_data') else [], 'challenge_id')]
        elif name == 'RiddleStateUpdateRsp':
            groups = [('riddle', [message.riddle_data] if message.HasField('riddle_data') else [], 'riddle_id')]
        else:
            groups = [('scenic', [message.battle_data] if message.HasField('battle_data') and message.battle_data.type == 1 else [], 'battle_id')]
        for kind, values, field in groups:
            for value in values:
                if not getattr(value, field):
                    continue
                row = dict(context, kind=kind, id=int(getattr(value, field)))
                for key in ('state', 'finish_times', 'is_win', 'star', 'use_time'):
                    if key in value.DESCRIPTOR.fields_by_name:
                        row[key] = getattr(value, key)
                self.records.append(row)

    def summary(self, player_id, uid, *, compact=False):
        rows = defaultdict(list)
        unattributed = 0
        for record in self.records:
            own = bool(player_id) and (record['owner_id'] == player_id if record['owner_id'] else
                                      record['owner_label'] == uid if record['owner_label'] else
                                      record['message'] != 'SceneDataNotice' and record['kind'] != 'challenge_history')
            if not own:
                unattributed += 1
                continue
            rows[(record['kind'], record['id'])].append(record)
        result = {'scenic': [], 'challenge': [], 'riddle': [], 'challenge_history': []}
        for (kind, ident), observations in sorted(rows.items()):
            mapped = CATALOG['scenic' if kind == 'scenic' else 'challenges'].get(str(ident), {}) if kind != 'riddle' else {}
            # Challenges and riddles may be global lists repeated in every scene.
            # Container scene IDs are evidence context, not item ownership.
            mapped_scene = mapped.get('scene_id')
            if kind == 'scenic':
                completed = any(r['state'] == 1 or r['finish_times'] > 0 for r in observations)
            elif kind == 'riddle':
                completed = any(r['is_win'] for r in observations)
            else:
                completed = True if any(r.get('state') == 1 for r in observations) else None
            row = dict(id=ident, scene_id=mapped_scene, **(scene_metadata(mapped_scene) if mapped_scene else {}),
                       observed_completed=completed, observation_count=len(observations))
            if compact:
                row['states'] = sorted({int(r['state']) for r in observations if 'state' in r})
                row['use_times'] = sorted({int(r['use_time']) for r in observations if 'use_time' in r})
                row['finish_times'] = sorted({int(r['finish_times']) for r in observations if 'finish_times' in r})
                row['win_values'] = sorted({bool(r['is_win']) for r in observations if 'is_win' in r})
            else:
                row['observations'] = observations
            result[kind].append(row)
        categories = []
        for key, label in [('scenic', '美丽景点'), ('challenge', '限时挑战'), ('riddle', '世界挑战')]:
            entries = result[key]
            categories.append(dict(id=key, label=label, observed_count=len(entries),
                observed_completed_count=sum(row['observed_completed'] is True for row in entries),
                unknown_completion_count=sum(row['observed_completed'] is None for row in entries),
                state='observed' if entries else 'unknown', complete=False))
        return dict(schema_version=1, database_imported=False, categories=categories, records=result,
            challenge_history_count=len(result['challenge_history']), responses=dict(self.responses),
            unattributed_observations=unattributed, policy='retain_observations_never_default_missing_to_unfinished',
            note='挑战 state=Start 或仅有用时记录时，不据此判为未完成。景点解锁 flag_ids 与完成 flags 是不同字段。')


def render_report(report):
    lines = ['景点与挑战历史观测（只核对采集证据，不代表已恢复到游戏）']
    for row in report['categories']:
        if row['state'] == 'unknown':
            lines.append(f"{row['label']}：未采到可归属记录，完成状态未知。")
            continue
        lines.append(f"{row['label']}：已见 {row['observed_count']} 项，明确完成证据 {row['observed_completed_count']} 项，完成状态未知 {row['unknown_completion_count']} 项。")
    lines.append(f"本人挑战用时历史 {report['challenge_history_count']} 项。{report['note']}")
    return '\n'.join(lines) + '\n'
