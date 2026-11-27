"""Evidence-based capture checklist and non-disruptive live ETL snapshot observer.
Never stops PktMon. Snapshot failures are unknown, not proof of missing data.
Only successfully decoded server responses contribute to collected categories.
"""
from __future__ import annotations
import argparse
from collections import Counter
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

BASE = Path(__file__).resolve().parent
TOOLKIT = Path(os.environ.get('OVERFIELD_CAPTURE_TOOLKIT', str(BASE)))
GROUPS = [
    ('login','登录基础信息',['PlayerLoginRsp'],'重新登录公服'),
    ('main','UID、等级与任务主数据',['PlayerMainDataRsp'],'登录并进入场景'),
    ('characters','角色与外观',['@characters'],'打开角色、穿搭界面'),
    ('bag','背包物品',['@bag'],'打开背包并翻页'),
    ('weapon','武器',['GetWeaponRsp','@weapon'],'打开武器、装备界面'),
    ('armor','护甲',['GetArmorRsp','@armor'],'打开护甲、装备界面'),
    ('poster','装备海报',['GetPosterRsp','@poster'],'打开海报装备界面'),
    ('pet','宠物列表',['GetPetRsp'],'打开宠物、仓库界面'),
    ('garden','家园与家具',['GetGardenInfoRsp','@garden'],'进入自己的家园，等待加载'),
    ('mail','邮件列表',['GetMailsRsp'],'打开邮件界面'),
    ('gacha','卡池信息',['GachaListRsp'],'打开抽卡界面'),
    ('gacha_records','抽卡记录',['GachaRecordRsp'],'打开抽卡历史并翻页'),
    ('achieve','成就',['GetAchieveGroupListRsp','GetAchieveOneGroupRsp'],'打开成就各分组'),
    ('manual','图鉴',['ManualListRsp','GetCharacterAchievementListRsp'],'打开图鉴界面'),
    ('explore','探索与收集',['GetCollectItemIdsRsp','GetCollectMoonInfoRsp','ExploreInitRsp'],'打开探索、收藏界面'),
    ('map_progress','各地图探索点',['SceneProcessListRsp'],'打开世界地图与地区探索进度，逐一切换已解锁地区'),
    ('map_collections','地图收集记录',['GetCollectItemIdsRsp','CollectingRsp','CollectionRewardRsp'],'打开地图收集与收藏页面；增量记录不能代替完整列表'),
    ('map_moons','月亮与情绪月亮',['GetCollectMoonInfoRsp'],'切换各已解锁地图，打开月亮收集页面；仅记录实际返回的地区'),
    ('map_scene','场景与水晶观测',['@map_scene'],'进入各已解锁地区，等待场景加载；单个场景不代表整张地图'),
    ('map_boxes','场景宝箱观测',['@map_boxes'],'进入对应地区并等待宝箱状态返回；只确认已观测宝箱'),
    ('map_scenic','美丽景点历史观测',['@map_scenic'],'进入对应地区等待场景返回；解锁标记不等同于已完成景点'),
    ('map_challenges','限时挑战历史观测',['@map_challenges','ChallengeStateUpdateRsp','ChallengeFriendRankRsp'],'进入各地区并打开挑战记录。仅有用时或 Start 状态不判为未完成'),
    ('map_riddles','世界挑战历史观测',['@map_riddles','RiddleStateUpdateRsp'],'进入各地区等待世界挑战历史返回；无需重新挑战或领取奖励'),
    ('dungeons','小副本进度摘要',['@dungeons'],'进入各已解锁地区，等待场景中的副本进度返回；总数未知，不表示全部采齐'),
    ('dungeon_details','小副本独立详情',['@dungeon_details'],'按需打开各副本详情；需保留副本内宝箱时进入副本等待加载，无需重打或领取奖励'),
    ('friend','社交原始资料',['FriendRsp','FriendListRsp'],'打开社交界面；列表分类另见带分类的社交列表'),
    ('archive','档案资料',['GetArchiveInfoRsp'],'打开档案界面'),
]
RELEVANT = {n for _,_,targets,_ in GROUPS for n in targets if not n.startswith('@')} | {'PackNotice','GetAllCharacterEquipRsp','SceneDataNotice', 'FlagBattleStateUpdateRsp', 'DungeonViewRsp', 'DungeonEnterRsp', 'DungeonRepeatEnterRsp', 'DungeonFinishRsp', 'DungeonOpenFinalBoxNotice'}
STATES = {'collected':'已采集','partial':'未见装备列表','empty':'已收到（列表为空）','waiting':'尚未采集','missing':'未采集到','unknown':'暂时无法判断'}


def atomic_json(path, data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    temporary.replace(path)


def observe(name, body, counts, empty):
    if name not in RELEVANT or not isinstance(body,dict):return
    status=body.get('status')
    if name.endswith('Rsp') and status not in (1,'StatusCode_OK'):return
    if name.endswith('Notice') and status not in (None,0,1,'StatusCode_NONE','StatusCode_OK'):return
    # A decoded protobuf response may omit an empty repeated field. Its successful
    # status is evidence the list was received, not evidence of non-empty contents.
    if name not in ('PackNotice','SceneDataNotice') and status is None and not body:return
    counts[name]+=1
    if name=='PlayerMainDataRsp':
        if int(body.get('player_id') or body.get('player_label') or 0)<=0:
            counts[name]-=1;return
        counts['@characters']+=1
        if not body.get('characters'):empty['@characters']+=1
    if name == 'PackNotice':
        counts['@bag']+=1
        if not body.get('items') and not body.get('characters'):empty['@bag']+=1
    if name in ('PackNotice','GetAllCharacterEquipRsp'):
        for detail in body.get('items',[]) or []:
            if not isinstance(detail,dict):continue
            parts = [detail.get('main_item',{}), *detail.get('transformed_item',[]), *detail.get('extras',[])]
            for item in parts:
                for kind in ('weapon','armor','poster'):
                    value=item.get(kind)
                    if isinstance(value,dict) and int(value.get('instance_id') or 0)>0:counts['@'+kind]+=1
    if name=='SceneDataNotice':
        from exploration import is_garden_scene
        data=body.get('data',{})
        if isinstance(data,dict) and int(data.get('scene_id') or 0)==9999:counts['@garden']+=1
        elif isinstance(data,dict) and int(data.get('scene_id') or 0)>0 and not is_garden_scene(data):
            counts['@map_scene']+=1
            counts['@map_boxes']+=1
            if not data.get('treasure_boxes'):empty['@map_boxes']+=1
        if isinstance(data,dict) and not is_garden_scene(data) and any(row.get('dungeon_id') for row in data.get('dungeons',[])):
            counts['@dungeons']+=1
        if isinstance(data,dict) and not is_garden_scene(data):
            for key, present in [('map_scenic',any(row.get('type') in (1,'EMissionType_ScenicSpot') for row in data.get('flags',[]))),
                                 ('map_challenges',bool(data.get('challenges'))),('map_riddles',bool(data.get('riddles')))]:
                if present:counts['@'+key]+=1
    if name in ('DungeonViewRsp','DungeonEnterRsp','DungeonRepeatEnterRsp','DungeonFinishRsp') and body.get('dungeon_data',{}).get('dungeon_id'):
        counts['@dungeon_details']+=1
    list_fields={'GetWeaponRsp':'weapons','GetArmorRsp':'armors','GetPosterRsp':'posters','GetPetRsp':'pets','GetMailsRsp':'mails','GachaListRsp':'gachas','GachaRecordRsp':'records','FriendRsp':'info','FriendListRsp':'info'}
    key=list_fields.get(name)
    if key and not body.get(key):empty[name]+=1


def report(counts=None, empty=None, *, phase='idle', readable=False, warning='', updated=None, live_packets=None):
    counts=counts or {};empty=empty or {}
    final=phase=='complete'
    items=[]
    for key,label,targets,hint in GROUPS:
        evidence={n:int(counts.get(n,0)) for n in targets if counts.get(n,0)>0}
        count=sum(evidence.values())
        if count:
            if key == 'map_collections' and 'GetCollectItemIdsRsp' not in evidence:
                state = 'partial'
            elif key in ('weapon', 'armor', 'poster') and set(evidence) == {'@' + key}:
                state = 'partial'
            else:
                state='empty' if all(empty.get(n,0)>=v for n,v in evidence.items()) else 'collected'
        else:state='missing' if final and readable else 'waiting' if readable else 'unknown'
        items.append({'id':key,'label':label,'state':state,'status':STATES[state],
                      'count':count,'evidence':evidence,'hint':hint})
        if key == 'map_collections' and state == 'partial':items[-1]['status']='已见增量，缺收集列表'
    return {'phase':phase,'readable':readable,'updatedAt':updated or dt.datetime.now().isoformat(timespec='seconds'),
            'warning':warning,'items':items,'counts':dict(counts),'emptyCounts':dict(empty),
            'livePackets':live_packets}


def final_report(export):
    counts=Counter();empty=Counter();export=Path(export)
    directory=export/'json'
    if not directory.is_dir():return report(phase='complete',readable=False,warning='未找到解码JSON，无法确认清单完整性。')
    for path in sorted(directory.glob('*.json')):
        match=re.search(r'_s2c_\d+_([A-Za-z0-9_]+)\.json$',path.name)
        if not match or match.group(1) not in RELEVANT:continue
        try:observe(match.group(1),json.loads(path.read_text(encoding='utf-8-sig')),counts,empty)
        except (ValueError,TypeError,OSError):continue
    warnings = []
    summary = export / 'summary.json'
    if summary.is_file():
        try:
            metadata = json.loads(summary.read_text(encoding='utf-8-sig'))
            if isinstance(metadata, dict):
                if len(metadata.get('player_uids', [])) > 1:
                    warnings.append('本次流量包含多个账号，清单仅表示本次见过这些响应；不能作为单账号完整备份，请按账号分别采集。')
                if metadata.get('incomplete_streams'):
                    warnings.append('检测到抓包缺口或未解码数据，备份可能不完整。')
        except (OSError, ValueError, TypeError):
            pass
    return report(counts, empty, phase='complete', readable=True, warning=' '.join(warnings))


def load_decoder(tool):
    tool=Path(tool);os.environ['OVERFIELD_CAPTURE_TOOLKIT']=str(tool)
    sys.path.insert(0,str(tool/'proto_gen'));sys.path.insert(0,str(BASE))
    spec=importlib.util.spec_from_file_location('live_capture_decoder',BASE/'parse_pcap.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    class BoundedProcess:
        @staticmethod
        def run(*args,**kwargs):
            kwargs.setdefault('timeout',12)
            kwargs.setdefault('creationflags',subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            if kwargs.get('text'):
                kwargs.setdefault('encoding','utf-8');kwargs.setdefault('errors','replace')
            return subprocess.run(*args,**kwargs)
    module.subprocess=BoundedProcess
    return module


def scan_pcap(decoder,path,stop=None,details=None):
    counts=Counter();empty=Counter();cmd_map=decoder.load_cmd_map()
    from exploration import Exploration, PACKETS
    from account_identity import AccountIdentityIndex
    from dungeons import Dungeons, PACKETS as DUNGEON_PACKETS
    from packet_context import PacketContexts, CODES as CONTEXT_CODES, REQUESTS
    from life_social import LifeSocial, quality_items
    identities=AccountIdentityIndex();players={}
    garden_layouts={};garden_names={};garden_owners=set()
    dungeons=Dungeons(decoder.net_pb2)
    contexts=PacketContexts();supplemental=LifeSocial(decoder.net_pb2);context_packets=[]
    exploration=Exploration(decoder.net_pb2);uids=set()
    path=decoder.prepare_capture(Path(path))
    streams=decoder.list_tcp_streams(path)
    if len(streams)>64:raise ValueError('Live stream budget exceeded; final analysis required')
    for sid in streams:
        if stop is not None and stop.is_file():break
        node0,node1,b01,b10,gaps=decoder._follow_tcp_stream(path,sid)
        port0=node0.rsplit(':',1)[-1];port1=node1.rsplit(':',1)[-1]
        if port1 in decoder.GAME_PORTS:directions=[('c2s',b01),('s2c',b10)]
        elif port0 in decoder.GAME_PORTS:directions=[('s2c',b01),('c2s',b10)]
        else:directions=decoder.pick_directions(b01,b10)
        for label,data in directions:
            packets,remaining=decoder.parse_game_stream(data)
            if remaining or gaps:contexts.mark_incomplete(sid)
            for number,packet in enumerate(packets):
                name=cmd_map.get(packet['msg_id'],'')
                if name in CONTEXT_CODES and label == ('c2s' if name in REQUESTS else 's2c'):
                    stem=f'{number+1:05}_s{sid}_{label}_{packet["msg_id"]}_{name}'
                    contexts.add(decoder.net_pb2,name,packet['body'],packet,sid,label,stem,incomplete=bool(gaps))
                    context_packets.append((name,packet['body'],'raw/'+stem+'.bin'))
                if label=='c2s':continue
                if name not in RELEVANT | {'OtherPlayerInfoRsp'} or packet.get('decompress_err'):continue
                body,error=decoder.decode_proto_body(name,packet['body'])
                if not error:
                    try:
                        observe(name,body,counts,empty)
                        decoder.collect_player_profile(name,body,garden_names)
                        if name == 'PlayerMainDataRsp' and body.get('status') in (1,'StatusCode_OK') and body.get('player_id'):
                            uids.add(int(body['player_id']))
                            identities.add(body['player_id'],body.get('player_label'))
                            players[int(body['player_id'])]={key:body.get(key) for key in ['player_name','level','world_level']}
                        if name in PACKETS:exploration.add(name,packet['body'],{'direction':'s2c'})
                        if name in DUNGEON_PACKETS:dungeons.add(name,packet['body'],{'stream_id':sid,'direction':'s2c'})
                        if name=='SceneDataNotice':
                            scene=decoder.net_pb2.SceneDataNotice.FromString(packet['body']).data
                            owner=decoder.collect_garden_scene(scene,garden_layouts,garden_names)
                            if owner: garden_owners.add(owner)
                    except (ValueError,TypeError):continue
    for name,raw,source in context_packets:
        supplemental.add(name,raw,source,contexts.match(source,name,raw))
    if details is not None:
        summary=exploration.summary(sorted(uids),identities.records());summary.pop('evidence',None)
        for row in summary['maps'].values():
            row['source_count']=len(row['sources']);row['sources']=row['sources'][-3:]
        details['exploration']=summary
        details['accounts_detail']=[dict(players.get(row['player_id'],{}),**row) for row in identities.records()]
        details['accounts']=sum(max(1,len(row['observed_player_labels'])) for row in identities.records())
        details['dungeons']=dungeons.summary(identities,compact=True)
        details['life_social']=supplemental.summary(identities,compact=True)
        details['supplemental_items']=quality_items(details['life_social'])
        single=identities.single()
        own=single['player_id'] if single else None
        details['garden_account_identified']=own is not None
        details['gardens']=[dict(owner_uid=owner,owner_name=garden_names.get(owner,'未知屋主'),
            furniture_count=len(garden_layouts[owner].garden_furniture_info_map) if owner in garden_layouts else None)
            for owner in sorted(garden_owners) if owner!=own]
    return counts,empty,len(streams)


def read_packet_counters():
    """Total packets seen by the running PktMon session, or None if unavailable."""
    pktmon = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/PktMon.exe'
    try:
        result = subprocess.run([str(pktmon), 'counters'], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=8,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode:
        return None
    text = result.stdout.decode('utf-8', errors='replace')
    total = 0
    for line in text.splitlines():
        fields = [part.strip() for part in line.split('|')]
        if len(fields) != 2:
            continue
        for side in fields:
            values = re.findall(r'[\d,]{1,15}', side)
            if len(values) >= 2:
                try:
                    total += int(values[0].replace(',', ''))
                except ValueError:
                    pass
    return total or None


def snapshot_pcap(decoder, etl, live, stop):
    """Scan a copy of the live ETL without stopping the capture or keeping the copy."""
    if stop.is_file():
        return None
    with tempfile.TemporaryDirectory(prefix='snapshot-', dir=live) as temporary:
        pcaps=[]
        pktmon = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/PktMon.exe'
        for source in sorted(etl.parent.glob('capture*.etl'), key=lambda p:p.stat().st_mtime_ns):
            if stop.is_file():return None
            # The compatibility backend may reserve hundreds of MB without any
            # readable events. Do not repeatedly copy that reservation in the UI.
            if source.stat().st_size > 64 * 1024 * 1024:return None
            copied=Path(temporary)/source.name;pcap=copied.with_suffix('.pcapng')
            shutil.copyfile(source,copied)
            result = subprocess.run([str(pktmon), 'etl2pcap', str(copied), '--out', str(pcap)],
                                    capture_output=True, timeout=20,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            if result.returncode or not pcap.is_file():return None
            pcaps.append(pcap)
        pcap=Path(temporary)/'snapshot.pcapng'
        with pcap.open('wb') as target:
            for part in pcaps:
                with part.open('rb') as source:shutil.copyfileobj(source,target)
        if pcap.stat().st_size<=256 or stop.is_file():return None
        details={}
        counts, empty, _ = scan_pcap(decoder, pcap, stop, details)
        return (counts, empty, details) if counts else None


def watch(capture_root):
    """Poll counters and check any data that has already reached the continuous ETL."""
    root = Path(capture_root).resolve()
    live = root / 'live-progress'
    live.mkdir(exist_ok=True)
    etl = root / 'capture.etl'
    stop = root / 'live-progress-stop.flag'
    target = live / 'progress.json'
    counts = Counter()
    empty = Counter()
    readable = False
    details = {}
    last_signature = None
    next_snapshot = 0.0
    progress_hint = '采集期间仅核对已落盘的数据，结束采集后进行最终核对。'
    unavailable_hint = '实时快照暂不可读，结束采集后进行最终核对。'
    notice = progress_hint
    watch_started = time.monotonic()
    first_response_ms = None
    atomic_json(target, report(phase='capturing', warning=notice))
    decoder = load_decoder(TOOLKIT)
    deadline = time.monotonic() + 4 * 3600
    while not stop.is_file() and time.monotonic() < deadline:
        live_packets = read_packet_counters()
        now = time.monotonic()
        if now >= next_snapshot:
            try:
                files=list(root.glob('capture*.etl'))
                signature = tuple((p.name,p.stat().st_size,p.stat().st_mtime_ns) for p in sorted(files))
                if files and signature != last_signature:
                    last_signature = signature
                    next_snapshot = now + (3.0 if sum(p.stat().st_size for p in files) < 64 * 1024 * 1024 else 10.0)
                    snapshot = snapshot_pcap(decoder, etl, live, stop)
                    if snapshot is None:
                        notice = unavailable_hint
                    else:
                        counts, empty, details = snapshot
                        readable = True
                        if first_response_ms is None and any(counts.values()):
                            first_response_ms = round((time.monotonic() - watch_started) * 1000)
                        notice = progress_hint
            except FileNotFoundError:
                pass
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                notice = unavailable_hint
        if stop.is_file():
            break
        result=report(counts, empty, phase='capturing', readable=readable, warning=notice, live_packets=live_packets)
        result.update(details)
        result['items'].extend(result.pop('supplemental_items', []))
        result['first_response_observed_ms'] = first_response_ms
        atomic_json(target, result)
        waited = 0.0
        while waited < 3.0:
            if stop.is_file():
                break
            time.sleep(0.5); waited += 0.5


def progress(state):
    capture_root=Path(state.get('capturePath','')) if state.get('capturePath') else None
    if state.get('phase')=='complete' and state.get('export'):
        export=Path(state['export']);cache=export/'capture-checklist.json'
        if not cache.is_file():atomic_json(cache,final_report(export))
        return json.loads(cache.read_text(encoding='utf-8-sig'))
    if capture_root:
        path=capture_root/'live-progress/progress.json'
        if path.is_file():
            try:return json.loads(path.read_text(encoding='utf-8-sig'))
            except (OSError,ValueError):pass
    return report(phase='capturing' if state.get('active') else state.get('phase','idle'),
                  warning='采集开始后核对实际响应；快照不可读时显示暂无法判断，不会误报已采集。')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['watch'])
    parser.add_argument('--capture-root',type=Path,required=True);args=parser.parse_args();watch(args.capture_root)

if __name__=='__main__':main()
