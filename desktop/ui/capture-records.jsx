import React, { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Action, Blank, Disclosure, Note, PageTitle, Panel } from './capture-ui.jsx'
import { accountIdentity, recordViews } from './capture-workflow.mjs'
import { equipmentLabel, sceneLabel, sceneNote } from './capture-presentation.mjs'
import { NebulaRecords } from './growth-records.jsx'
import LifeSocialRecords, { SocialRecords } from './life-social.jsx'
import OwnScenesPage from './own-scenes.jsx'

const help = {
  records: '录制期间依次打开武器、护甲和海报的完整列表，切换分类与筛选；只看角色身上的装备不够。',
  exploration: '水晶：打开地图、地区探索与收集页，再进入各已解锁地区等待加载。美丽景点和挑战历史随场景返回，无需重新拾取、拍照或领奖。',
  progress: '录制期间打开星云树，切换可见分区等待加载即可，不用激活节点或领奖。旧备份可以先重新解析。',
  life: '录制期间分别打开烹饪、钓鱼、制作、手工艺、缝纫、采集页，等待资料加载。等级和技能已读取时不用再练级；图鉴历史次数单独保存。',
  social: '录制期间分别打开好友、好友申请、黑名单，等待列表返回。不用添加或删除好友。',
  dungeons: '先进入各已解锁地区，摘要会随场景保存。按需打开副本详情；需要副本内宝箱记录时，再进入副本等待加载，无需重打或领奖。',
  scenes: '完成账号录制后，进入自己的频道等待加载。家园可走到各区域等待家具加载；不同时间的场景记录分别保留。'
}

export default function CaptureRecords({ state, tab, busy, act, onNavigate }) {
  const report = state.recording ? state.captureProgress : state.captureReport
  const identity=accountIdentity(report),locked=!!state.recording
  return <div className="c-records" data-testid="records-page">
    <PageTitle title="查看资料" description={report && tab!=='scenes' ? `${identity.name}${identity.uid ? ` · UID ${identity.uid}` : ''}` : '打开备份，按类别查看已保存的内容。'}>
      <Action name="analyze" act={act} busy={busy} disabled={locked} icon={FolderOpen}>打开备份</Action>
    </PageTitle>
    <div className="c-record-tabs" role="tablist" aria-label="资料类别" onKeyDown={e=>{
      const index=recordViews.findIndex(([key])=>key===tab)
      const target=e.key==='ArrowRight'?(index+1)%recordViews.length:e.key==='ArrowLeft'?(index+recordViews.length-1)%recordViews.length:e.key==='Home'?0:e.key==='End'?recordViews.length-1:null
      if(target!==null){e.preventDefault();onNavigate(recordViews[target][0]);requestAnimationFrame(()=>document.getElementById(`record-tab-${recordViews[target][0]}`)?.focus())}
    }}>{recordViews.map(([key,label])=>
      <button type="button" role="tab" tabIndex={tab===key?0:-1} id={`record-tab-${key}`} aria-controls={`record-panel-${key}`} aria-selected={tab===key} key={key} onClick={()=>onNavigate(key)}>{label}</button>)}</div>
    {state.recording && <Note>正在采集。这里显示已读取的内容，停止后会统一核对。</Note>}
    <div role="tabpanel" id={`record-panel-${tab}`} aria-labelledby={`record-tab-${tab}`}>
      {tab==='scenes' ? <OwnScenesPage state={state} busy={busy} act={act} compact /> : !report ? <Blank act={act} busy={busy} disabled={locked} /> :
        tab==='records' ? <EquipmentRecords report={report} /> :
        tab==='exploration' ? <MapRecords report={report.exploration} /> :
        tab==='progress' ? <NebulaRecords report={report.exploration?.nebula_tree} /> :
        tab==='life' ? report.life_social ? <LifeSocialRecords report={report.life_social} /> : <Blank title="这份报告尚未展开生活资料">重新解析原账号包即可核对，不用先回游戏重复浏览。</Blank> :
        tab==='social' ? report.life_social ? <SocialRecords report={report.life_social} /> : <Blank title="这份报告尚未分类社交资料">先重新解析原账号包；有原始抓包时可补回列表分类。</Blank> :
        <DungeonRecords report={report.dungeons} />}
    </div>
    <Disclosure title="这类资料怎么采？" className="c-inline-help"><p>{help[tab]}</p><p>已有资料无需重复采集。这里只显示实际返回的内容，不代表全账号已齐或游戏进度已恢复。</p></Disclosure>
    {report&&tab!=='scenes'&&<Disclosure title="账号基础与资料来源"><div className="c-detail-grid">{Object.entries({'登录 UID':identity.uid,'等级':identity.level,'内部角色 ID':report.accounts_detail?.[0]?.player_id,'角色数':report.accounts_detail?.[0]?.characters,'任务数':report.accounts_detail?.[0]?.quests,'游戏连接数':report.streams,'失败状态响应':report.rejected,'缺少实例编号的装备':Object.values(report.equipment||{}).reduce((n,r)=>n+(r.without_id||0),0)}).map(([k,v])=><div key={k}><span>{k}</span><b>{v??'未记录'}</b></div>)}</div><p>来源：{report.input||'实时记录'}。内部角色编号与登录 UID 分开保存；出现多个账号时不将第一份资料视为唯一账号归属。</p></Disclosure>}
    {state.captureError && <div className="notice error" role="alert">{state.captureError}</div>}
  </div>
}

function EquipmentRecords({ report }) {
  const rows=Object.entries(report.equipment||{})
  return <Panel title="装备" description="列表与推送中的装备一并保留。" data-testid="equipment-records">
    {!rows.length ? <Blank title="等待装备资料" /> : <div className="c-equipment-list">{rows.map(([kind,row])=><div className="c-equipment-row" key={kind}>
      <span><strong>{{weapon:'武器',armor:'护甲',poster:'装备海报'}[kind]||kind}</strong><small>{equipmentLabel(row)}</small></span>
      <b>{row.observed ?? '—'}<small>件</small></b>
    </div>)}</div>}
    <Disclosure title="查看列表差异与采集来源"><div className="exploration-table"><table><thead><tr><th>类型</th><th>列表内</th><th>全部来源</th><th>额外保留</th><th>列表响应</th><th>报送数量</th></tr></thead><tbody>{rows.map(([kind,row])=><tr key={kind}><td>{{weapon:'武器',armor:'护甲',poster:'装备海报'}[kind]||kind}</td><td>{row.snapshot}</td><td>{row.observed}</td><td>{row.other_only}</td><td>{row.pages}</td><td>{row.reported?.join(' / ')||'未返回'}</td></tr>)}</tbody></table></div>
      <p>列表外装备也会保存，不与已有实例重复计数。穿戴响应 {report.sources?.equipped ?? '未记录'} 条，背包推送 {report.sources?.pack ?? '未记录'} 条，解码异常 {report.decode_errors ?? '未记录'} 条。</p></Disclosure>
  </Panel>
}

function MapRecords({ report }) {
  if(!report)return <Blank title="还没有地图资料" />
  const rows=Object.entries(report.maps||{}),shown=rows.filter(([id,row])=>Number(id)!==9999 && (row.collection_coverage==='scene_snapshot_partial'||row.crystals?.collected!=null||row.items?.collected!=null||row.points?.collected>0))
  return <>
    {report.activities && <Panel title="景点与挑战" data-testid="world-activities"><div className="c-activity-grid">{report.activities.categories.map(row=><div key={row.id}><span>{row.label}</span><strong>{row.state==='unknown' ? '—' : row.observed_count}</strong><small>{row.state==='unknown' ? '尚无可确认记录' : row.observed_completed_count ? `${row.observed_completed_count} 项有完成记录` : '已保留记录，完成状态未确定'}</small></div>)}</div>
      <Disclosure title="查看完成状态与历史用时"><p>本人挑战用时历史 {report.activities.challenge_history_count} 项。仅有用时或 Start 状态，不判作已完成或未完成。</p><div className="exploration-table"><table><thead><tr><th>类别</th><th>有完成记录</th><th>完成状态未知</th></tr></thead><tbody>{report.activities.categories.map(row=><tr key={row.id}><td>{row.label}</td><td>{row.observed_completed_count}</td><td>{row.unknown_completion_count}</td></tr>)}</tbody></table></div><p>游戏显示异常时需另查服务端恢复。原字段及来源保留在 world-activities.json。</p></Disclosure>
    </Panel>}
    <Panel title="地区收集" description="数量表示已采到的记录，不是全图完成率。" data-testid="map-records">
      {shown.length ? <div className="exploration-table"><table><thead><tr><th>地区</th><th>水晶</th><th>其他收集物</th><th>已开宝箱</th></tr></thead><tbody>{shown.map(([id,row])=><tr key={id}><td>{sceneLabel(id,row)}</td><td>{row.crystals?.collected ?? '未记录'}</td><td>{row.items?.collected ?? '未记录'}</td><td>{row.one_time_boxes?.collected ?? '未记录'}</td></tr>)}</tbody></table></div> : <Blank title="等待地区收集记录" />}
      <Disclosure title="全部场景与探索详情"><p>未返回的数量保持未知；总量未经核验，不计算完成率。未访问过的参考场景也列在这里。</p><div className="exploration-table"><table><thead><tr><th>场景</th><th>探索点</th><th>水晶 / 参考总量</th><th>月亮 / 情绪月亮</th></tr></thead><tbody>{rows.map(([id,row])=><tr key={id}><td>{sceneLabel(id,row)}<small>场景 {id}{sceneNote(id) && ` · ${sceneNote(id)}`}</small></td><td>{row.points?.collected ?? '未知'}</td><td>{row.crystals?.collected ?? '未知'} / {row.crystals?.total ?? '未知'}{row.crystals?.mismatch && <small>目录数量与声明不一致</small>}</td><td>{row.moons?.collected_count ?? '未知'} / {row.moons?.interacted_emotion_count ?? '未知'}</td></tr>)}</tbody></table></div><p>目录待匹配 {report.unknown_ids?.length||0} 项，原数据已保留。资源目录：{report.resource_version}。</p></Disclosure>
    </Panel>
  </>
}

function DungeonRecords({ report }) {
  const [query,setQuery]=useState('')
  if(!report)return <Blank title="还没有副本资料" />
  const rows=(report.dungeons||[]).filter(row=>(String(row.dungeon_id)+' '+row.scene_ids.join(' ')).includes(query.trim()))
  return <Panel title="副本记录" description="场景摘要与独立详情分别保存。" data-testid="dungeon-records">
    <div className="c-stats"><div><span>已记录副本</span><strong>{report.observed_count}</strong></div><div><span>含独立详情</span><strong>{report.detailed_count}</strong></div></div>
    <Disclosure title="查找副本与详情"><label className="field"><span>副本或场景编号</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入编号" /></label>
      <div className="exploration-table"><table><thead><tr><th>副本</th><th>所在场景</th><th>完成记录</th><th>资料范围</th></tr></thead><tbody>{rows.slice(0,200).map(row=><tr key={row.dungeon_id}><td>{row.dungeon_id}</td><td>{row.scene_ids.map(id=>sceneLabel(id,{})).join('、')||'未关联'}</td><td>{row.observed_finished===true ? '有完成记录' : row.observed_finished===false ? '未见完成记录' : '未确认'}</td><td>{{scene_summary_only:'场景摘要',detail_observed:'独立详情',event_only:'事件记录'}[row.coverage]}</td></tr>)}</tbody></table></div><p>匹配 {rows.length} 条，最多显示 200 条。完整记录保存在 dungeons.json。</p></Disclosure>
  </Panel>
}
