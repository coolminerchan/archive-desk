import React, { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, FolderOpen, Play, Square } from 'lucide-react'
import { artwork, guidePortraits } from './artwork.jsx'
import { Action, Disclosure, Note, Panel, receivedLabel } from './capture-ui.jsx'
import { accountIdentity, captureSummary, hasRecordView, isReceived, recordingStage } from './capture-workflow.mjs'
import { checklistHint, guidedSteps } from './capture-guide.mjs'
import CaptureRecords from './capture-records.jsx'
import CaptureSettings from './capture-settings.jsx'
import GardenCapturePage from './gardens.jsx'
import CaptureProcess from './capture-process.jsx'

export default function CapturePage(props) {
  const other=props.state.recording && props.state.capturePurpose==='gardens'
  if(props.tab==='gardens')return <GardenCapturePage {...props} />
  const state={...props.state,recording:other?null:props.state.recording,
    captureFlow:props.state.captureFlow?.purpose==='gardens'?null:props.state.captureFlow,
    captureError:props.state.captureFlow?.purpose==='gardens'?'':props.state.captureError}
  if(props.tab==='settings')return <CaptureSettings {...props} />
  if(hasRecordView(props.tab))return <>{other&&<Note>家园装修正在采集。下面是此前读取的账号资料。</Note>}<CaptureRecords {...props} state={state} /></>
  return <BackupHome {...props} state={state} other={other} />
}

function BackupHome({state,busy,act,onNavigate,other}) {
  const started=useRef(false),[filter,setFilter]=useState('remaining')
  useEffect(()=>{if(state.windows && !window.__captureAutoStarted && !started.current && state.captureResumePurpose!=='gardens' && new URLSearchParams(location.search).get('autoCapture')==='1'){
    started.current=true;window.__captureAutoStarted=true;act('capture-one-click')
  }},[state.windows,state.captureResumePurpose,act])
  const active=!!state.recording,report=state.captureReport,observation=active?state.captureProgress:report
  const identity=accountIdentity(observation),summary=captureSummary(observation),steps=guidedSteps(observation)
  const next=steps.find(s=>['partial','waiting'].includes(s.status)),stage=recordingStage(state.recording,state.captureFlow)
  const locked=active||other,items=(observation?.items||[]).filter(r=>r.id!=='gacha_records')
  const filtered=filter==='all'?items:filter==='optional'?summary.optional:[...summary.remaining,...summary.unknown]
  const hasIssue=report?.quality?.integrity_known && ((report.quality.tcp_gap_directions||0)+(report.quality.decode_failures||0)+(report.quality.unknown_protocol_packets||0)+(report.quality.tail_directions||0)>0)
  const jump=key=><button type="button" className="c-text-button" onClick={()=>onNavigate(key)}>查看资料<ArrowRight size={15} /></button>
  return <div className="c-home" data-testid="backup-home">
    <section className={`c-backup-hero ${active?'is-recording':''}`}>
      <img className="c-backup-art" src={artwork.harvest.image} alt="" />
      <div className="c-backup-shade" />
      <div className="c-backup-copy"><span className="c-eyebrow">{active?'正在备份':'冒险留存'}</span><h1>{stage.title}</h1><p>{stage.hint}</p>
        <div className="actions">{active ? <Action name="capture-stop" act={act} busy={busy} disabled={!['starting','recording'].includes(state.recording)} primary icon={Square}>{['starting','recording'].includes(state.recording)?'停止并保存':'正在整理…'}</Action> :
          <Action name="capture-one-click" act={act} busy={busy} disabled={!state.windows||other} primary icon={Play}>开始备份</Action>}
          <Action name="analyze" act={act} busy={busy} disabled={locked} icon={FolderOpen}>打开已有备份</Action></div>
      </div>
    </section>
    {active&&<p className="c-live-footnote">原始记录占用 {typeof state.captureBytes==='number'?`${(state.captureBytes/1048576).toFixed(1)} MiB`:'等待统计'} · 本轮最多 30 分钟或 448 MiB</p>}
    {other && <Note>家园装修正在采集。请先在「家园装修」结束当前任务。</Note>}
    {state.captureError && <div className="notice error" role="alert">{state.captureError}</div>}
    {state.captureLimit && <Note>本轮已达到录制限制，原始记录已保留，正在整理。</Note>}
    {!active&&state.captureFlow?.phase==='complete'&&!state.captureSavedZip&&<Note>{state.captureFlow.hint}</Note>}
    {active && <Panel className="c-next-step" title={state.recording==='recording'?'接下来做什么':'当前状态'} data-testid="recording-guidance">
      <div className="c-next-copy"><img src={guidePortraits[next?.id||'login']} alt="" /><div><h3>{state.recording==='recording'?(next?.title||'可以结束浏览并保存'):stage.title}</h3><p>{state.recording==='recording'?(next?.text||'退出游戏，或点击上方「停止并保存」。'):state.captureFlow?.hint||stage.hint}</p></div></div>
      <Disclosure title="查看完整浏览指引"><div className="capture-steps">{steps.map((s,i)=><details className={`capture-step ${s.status}`} key={s.id}><summary><span className="step-avatar"><img src={guidePortraits[s.id]} alt="" /><b>{s.status==='received'?'✓':i+1}</b></span><strong>{s.title}</strong><small>{s.statusLabel}</small></summary><p>{s.text}</p></details>)}</div><p>实时记录可能延迟，无需等每项变色才继续操作。</p></Disclosure>
    </Panel>}
    <CaptureProcess />
    {!active && report && <Panel title="最近查看的账号" aside={jump('records')} className="c-recent" data-testid="backup-result">
      <div className="c-account-line"><img src={guidePortraits.login} alt="" /><div><h3>{identity.name}</h3><p>{identity.uid?`UID ${identity.uid}`:'登录 UID 未返回'}{identity.level!=null?` · 等级 ${identity.level}`:''}</p></div><span className="c-tag">已读取</span></div>
      <div className="c-equipment-summary">{['weapon','armor','poster'].map(kind=><div key={kind}><span>{{weapon:'武器',armor:'护甲',poster:'海报'}[kind]}</span><strong>{report.equipment?.[kind]?.observed??'—'}</strong><small>件已保留</small></div>)}</div>
      <div className="c-result-footer"><span>{summary.received.length} 类资料已读取{summary.remaining.length?` · ${summary.remaining.length} 项可补充`:''}{summary.unknown.length?` · ${summary.unknown.length} 项待确认`:''}</span>
        <div className="actions"><Action name="capture-export" act={act} busy={busy} disabled={!report.account_zip||other} icon={ArrowDownToLine}>另存账号包</Action><Action name="open-backup-folder" act={act} busy={busy} icon={FolderOpen}>打开文件夹</Action></div></div>
      {report.accounts>1&&<Note warning>这份记录包含多个账号。请分别采集后再保存账号包，避免混淆归属。</Note>}
      {hasIssue && <Note warning>这份记录有需要核对的采集信息。<button type="button" className="c-text-button" onClick={()=>onNavigate('settings')}>查看诊断</button></Note>}
    </Panel>}
    {observation && <Disclosure title={`核对采集内容${summary.remaining.length?` · ${summary.remaining.length} 项可补充`:''}`} data-testid="capture-checklist-disclosure">
      <div className="c-filter" role="group" aria-label="清单范围">{[['remaining','需要核对'],['all','全部资料'],['optional','可选补充']].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
      {filtered.length ? <div className="c-checklist">{filtered.map(item=><div key={item.id}><div><strong>{item.label}</strong><span className={`c-item-state ${isReceived(item)?'ok':''}`}>{receivedLabel(item.state)}</span></div><p>{checklistHint(item)}</p></div>)}</div> : <p className="c-muted">此分类暂无需要补充的项目。已有记录不代表全账号所有内容均已采齐。</p>}
      <div className="actions"><Action name="analyze" args={{recent:true}} act={act} busy={busy} disabled={locked||!state.capture}>重新核对本次采集</Action></div>
    </Disclosure>}
    <div className="c-home-bottom"><span>每轮独立保存，原始记录保留。</span><button type="button" className="c-text-button" onClick={()=>onNavigate('settings')}>模拟器或手动连接 → 设置</button></div>
  </div>
}
