"""Preserve life/social evidence; classify only uniquely paired RPCs."""
from collections import defaultdict
import hashlib
from packet_context import REQUESTS, RESPONSES

LIFE_TYPES = {1: '烹饪', 2: '钓鱼', 3: '制作', 4: '手工艺', 5: '缝纫', 6: '采集'}
SOCIAL_TYPES = {0: '默认列表', 1: '好友申请', 2: '好友', 3: '黑名单'}
FAMILIES = {
    'GetOneTypeLifePictorialBookCountReq': ('history', True),
    'GetOneTypeLifePictorialBookCountRsp': ('history', False),
    'FriendReq': ('social', True), 'FriendRsp': ('social', False),
}
NAMES = set(REQUESTS) | set(RESPONSES)


class LifeSocial:
    def __init__(self, proto):
        self.proto = proto
        self.base = defaultdict(list)
        self.events = []

    def add(self, name, raw, source, context=None, *, error=None):
        if name not in NAMES:
            return
        event = dict(message=name, source=source, body_sha256=hashlib.sha256(raw).hexdigest(), context=context)
        if name in FAMILIES:
            event['family'], event['request'] = FAMILIES[name]
        try:
            if error or (context and context['decode_error']):
                raise ValueError('unreadable body')
            message = getattr(self.proto, name).FromString(raw)
        except Exception:
            event['reason'] = 'decode_error'
            self.events.append(event)
            return
        if name == 'GetLifeInfoRsp':
            event['status'] = int(message.status)
            if message.status != 1:
                event['reason'] = 'failed_response'
            else:
                kinds = {int(getattr(message, field).life_type) for field in ('life_base_info', 'life_skill', 'life_achieve')
                         if message.HasField(field) and getattr(message, field).life_type}
                if len(kinds) == 1 and next(iter(kinds)) in LIFE_TYPES:
                    kind = kinds.pop()
                    sections = [field for field in ('life_base_info', 'life_skill', 'life_achieve')
                                if message.HasField(field) and getattr(message, field).life_type == kind]
                    self.base[kind].append(dict(source=source, body_sha256=event['body_sha256'],
                        sections=sections,
                        level=int(message.life_base_info.level) if 'life_base_info' in sections else None,
                        skills=len(message.life_skill.life_skill_info) if 'life_skill' in sections else None,
                        skill_details=[dict(skill_id=int(skill.skill_id), level=int(skill.lv),
                            start_study_time=str(skill.start_study_time)) for skill in message.life_skill.life_skill_info]
                            if 'life_skill' in sections else None,
                        achieves=len(message.life_achieve.life_achieve_) if 'life_achieve' in sections else None,
                        rewarded=len(message.life_achieve.rewarded_life_achieve_id_lst) if 'life_achieve' in sections else None))
                    return
                event['reason'] = 'missing_or_conflicting_life_type'
            self.events.append(event)
            return
        family, request = FAMILIES[name]
        event.update(family=family, request=request)
        if request:
            field = REQUESTS[name][1]
            event['type_id'] = int(getattr(message, field))
            if context and context['request_fields'] != {field: event['type_id']}:
                event['reason'] = 'context_field_mismatch'
        else:
            event['status'] = int(message.status)
            if family == 'history':
                event['counts'] = [dict(id=int(value.id), count=str(value.count)) for value in message.life_achieve_count_lst]
                event['entry_count'] = len(event['counts'])
            else:
                event['entry_count'] = len(message.info)
        if not context:
            event['reason'] = 'missing_packet_context'
        elif not context['packet_id']:
            event['reason'] = 'missing_packet_id'
        elif context['connection_incomplete']:
            event['reason'] = 'incomplete_connection'
        self.events.append(event)

    def summary(self, identities, *, compact=False):
        single = identities.single()
        groups = defaultdict(lambda: [[], []])
        unclassified, pending = [], []
        rows = {'history': defaultdict(list), 'social': defaultdict(list)}
        incomplete = {event['context']['connection_id'] for event in self.events if event.get('context') and event['context']['connection_incomplete']}
        for event in self.events:
            public = {key: value for key, value in event.items() if key not in ('counts', 'request', 'context')}
            context = event['context']
            if 'family' not in event or not context or not context['packet_id'] or context['connection_id'] in incomplete:
                unclassified.append(dict(public, reason=event.get('reason', 'unclassified')))
                continue
            key = (context['connection_id'], event['family'], context['packet_id'])
            groups[key][0 if event['request'] else 1].append(event)
        for (connection, family, packet_id), (requests, responses) in groups.items():
            reason = 'ambiguous_packet_id' if len(requests) > 1 or len(responses) > 1 else 'missing_request' if not requests else 'missing_response' if not responses else None
            if reason:
                for event in requests + responses:
                    target = pending if event['request'] else unclassified
                    target.append(dict(message=event['message'], source=event['source'], reason=reason,
                        connection_id=connection, packet_id=packet_id))
                continue
            request, response = requests[0], responses[0]
            if request.get('reason') or response.get('reason'):
                unclassified.append(dict(message=response['message'], source=response['source'], reason=request.get('reason') or response['reason']))
                continue
            kind = request['type_id']
            allowed = LIFE_TYPES if family == 'history' else SOCIAL_TYPES
            if kind not in allowed:
                unclassified.append(dict(message=response['message'], source=response['source'], reason='unsupported_request_type'))
                continue
            snapshot = dict(request=request['context'], response=response['context'], type_id=kind,
                status=response['status'], entry_count=response['entry_count'])
            if family == 'history' and not compact:
                snapshot['counts'] = response['counts']
            rows[family][kind].append(snapshot)
        def states(kinds, snapshots, base=False):
            result = []
            for kind, label in kinds.items():
                observed = snapshots.get(kind, [])
                successful = observed if base else [r for r in observed if r['status'] == 1]
                state = 'unknown' if not successful or not single else 'collected' if base or any(r['entry_count'] for r in successful) else 'empty'
                if base and state == 'collected' and not any(len(r['sections']) == 3 for r in successful):
                    state = 'partial'
                display = observed
                if compact:
                    ranking = (lambda r: (len(r['sections']), r['level'] is not None)) if base else (lambda r: (r['status'] == 1, r['entry_count']))
                    display = sorted(observed, key=ranking, reverse=True)[:5]
                    display = [{k: v for k, v in r.items() if k not in ('request', 'response', 'counts')} for r in display]
                result.append(dict(type_id=kind, label=label, state=state, snapshot_count=len(observed),
                    successful_count=len(successful), snapshots=display))
            return result
        base = states(LIFE_TYPES, self.base, base=True)
        history = states(LIFE_TYPES, rows['history'])
        social = states(SOCIAL_TYPES, rows['social'])
        return dict(schema_version=1, attributed=single is not None, account_uid=single['uid'] if single else None,
            protocol_player_id=single['player_id'] if single else None, database_imported=False,
            pairing_policy='unique_connection_packet_id_and_message_family',
            base=dict(expected_types=list(LIFE_TYPES), types=base),
            history=dict(expected_types=list(LIFE_TYPES), types=history),
            social=dict(expected_types=[1, 2, 3], types=social),
            unclassified_count=len(unclassified), pending_request_count=len(pending),
            unclassified=unclassified[:200] if compact else unclassified, pending_requests=pending[:200] if compact else pending)


def quality_items(report):
    result = []
    for key, label, section, hint in (
        ('life_base', '六类生活基础记录', 'base', '分别打开烹饪、钓鱼、制作、手工艺、缝纫、采集职业页，等待等级、技能和成就加载。'),
        ('life_history', '生活图鉴历史次数', 'history', '在六类职业页分别打开对应图鉴。仅有等级和技能回包不能证明图鉴历史已保存。'),
        ('social_lists', '带分类的社交列表', 'social', '分别打开好友、好友申请和黑名单。已有资料但缺少请求上下文时，列表分类保持未知。')):
        value = report[section]
        rows = [row for row in value['types'] if row['type_id'] in value['expected_types']]
        known = [row for row in rows if row['state'] in ('collected', 'empty')]
        count = sum(row['successful_count'] for row in rows)
        state = 'unknown' if not report['attributed'] or not known else 'partial' if len(known) < len(rows) else 'empty' if all(row['state'] == 'empty' for row in rows) else 'collected'
        result.append(dict(id=key, label=label, state=state, status='已返回' if state in ('collected', 'empty') else '待补充',
            count=count, evidence={}, detail=f"{'已见职业' if section == 'base' else '成功配对'} {len(known)}/{len(rows)}",
            hint=hint if report['attributed'] else '账号归属尚未确认，请从登录前开始单独采集一个账号。' + hint))
    return result


def render_report(report):
    lines = ['生活与社交采集记录', '仅按已返回的数据记录；未采到保持未知，不推算制作次数，不创建账号或家园。']
    for item in quality_items(report):
        lines.append(f"{item['label']}：{item['detail']}；{item['status']}。{item['hint']}")
    lines.append(f"无法分类的记录 {len(report['unclassified'])} 条；尚缺对应回包的请求 {len(report['pending_requests'])} 条。")
    return '\n'.join(lines) + '\n'
