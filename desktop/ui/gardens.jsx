import React,{useEffect,useState} from 'react'
import {ArrowDownToLine,FolderOpen,Play,RefreshCw,Square} from 'lucide-react'
import {artwork} from './artwork.jsx'
import {Action,Blank,Disclosure,Note,Panel} from './capture-ui.jsx'

export default function GardenCapturePage({state,busy,act,onNavigate}) {
  const [query,setQuery]=useState(''),active=!!state.recording&&state.capturePurpose==='gardens',other=!!state.recording&&!active,locked=!!state.recording
  const report=state.captureGardenReport,observation=active?state.captureProgress:report,gardens=observation?.gardens||[]
  const rows=gardens.filter(row=>`${row.owner_name} ${row.owner_uid}`.includes(query.trim()))
  const flow=state.captureFlow?.purpose==='gardens'?state.captureFlow:null
  useEffect(()=>{if(state.windows&&state.captureResumePurpose==='gardens'&&!window.__captureAutoStarted&&new URLSearchParams(location.search).get('autoCapture')==='1'){
    window.__captureAutoStarted=true;act('capture-gardens-one-click')
  }},[state.windows,state.captureResumePurpose,act])
  return <div className="c-gardens">
    <section className="c-backup-hero c-garden-hero"><img className="c-backup-art" src={artwork.morning.image} alt="" /><div className="c-backup-shade" /><div className="c-backup-copy"><span className="c-eyebrow">家园装修</span><h1>{active?'正在收藏家园装修':'把喜欢的家，单独收藏'}</h1><p>{active?'继续拜访家园，走动等待家具加载。':'普通拜访即可。按屋主分别保存，也可导出合集。'}</p><div className="actions">
      {active?<Action name="capture-stop" act={act} busy={busy} primary icon={Square} disabled={!['starting','recording'].includes(state.recording)}>停止并保存</Action>:<Action name="capture-gardens-one-click" act={act} busy={busy} primary={!report} icon={Play} disabled={locked||!state.windows}>开始装修采集</Action>}
      <Action name="capture-gardens-open" act={act} busy={busy} disabled={locked} icon={FolderOpen}>打开已有装修</Action></div></div></section>
    {other&&<Note>账号备份正在进行。<button type="button" className="c-text-button" onClick={()=>onNavigate('overview')}>返回备份账号</button></Note>}
    {flow?.phase==='failed'&&state.captureError&&<div className="notice error" role="alert">{state.captureError}</div>}
    {active&&<Note>{state.recording==='recording'?'走到家园的不同区域，等家具加载后再拜访下一家。':flow?.hint||'正在整理装修记录…'}</Note>}
    {active&&<p className="c-live-footnote">原始记录占用 {typeof state.captureBytes==='number'?`${(state.captureBytes/1048576).toFixed(1)} MiB`:'等待统计'} · 本轮最多 30 分钟或 448 MiB</p>}
    {!active&&flow?.phase==='complete'&&!state.captureGardenSavedZip&&<Note>{flow.hint}</Note>}
    {state.captureGardenLimit&&<Note>已达到本轮录制限制，原始记录已保留，整理后可以继续下一轮。</Note>}
    <Panel title={`已记录的家园${gardens.length?` · ${gardens.length}`:''}`} aside={report?.gardens_bundle&&<Action name="capture-gardens-export-all" act={act} busy={busy} primary disabled={locked} icon={ArrowDownToLine}>保存装修合集</Action>}>
      {gardens.length>4&&<label className="field c-search"><span>查找家园</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="屋主昵称或家园编号" /></label>}
      {rows.length?<div className="c-garden-list">{rows.map(row=><div key={row.owner_uid}><span><strong>{row.owner_name||'屋主昵称未返回'}</strong><small>家园 {row.owner_uid} · {row.furniture_count??'尚未确认'} 件观测家具</small></span><Action name="capture-gardens-export" act={act} busy={busy} disabled={locked||!row.path} args={{index:gardens.indexOf(row)}} icon={ArrowDownToLine}>单独保存</Action></div>)}</div>:<Blank title={query?'没有匹配的家园':active?'等待家园资料':'从一次拜访开始'}>{active?'家园场景返回后会显示在这里。':'开始采集后进入想收藏的家园，或打开之前的装修包。'}</Blank>}
    </Panel>
    <Disclosure title="采集方法与保存位置"><p>先开始记录，再拜访目标家园。走到各区域等待家具加载，可连续拜访多位屋主。结束后退出游戏，或点「停止并保存」。</p><p>默认保存在「文档 → 游戏家园备份」，与账号备份分开。本功能只保存装修，不导入自己的家园。</p><p>家具数量是本次观测，不保证全部家具已加载。未取得登录资料时，尚未区分自家与拜访家园。</p>
      <div className="actions"><Action name="capture-gardens-open-folder" act={act} busy={busy} icon={FolderOpen}>打开保存位置</Action><Action name="capture-gardens-recover" act={act} busy={busy} disabled={locked||!state.captureGardenSession} icon={RefreshCw}>恢复上次记录</Action></div>
      {state.captureGardenSavedZip&&<p className="c-path">{state.captureGardenSavedZip}</p>}
      {!!report?.warnings?.length&&report.warnings.map((w,i)=><p key={i}>{w}</p>)}
      <p>每轮最多 30 分钟或约 448 MiB 原始记录；达到限制后自动整理。家具原始场景与增量记录都会保留。</p>
    </Disclosure>
  </div>
}
