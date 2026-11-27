import React, { useEffect, useState } from 'react'
import { ArrowDownToLine, FolderOpen, Play, RefreshCw, ShieldCheck, Square } from 'lucide-react'
import { Action, Disclosure, Note, PageTitle, Panel } from './capture-ui.jsx'

const channels=[['auto','自动识别'],['cn-pc','国服 PC · TapTap / B站'],['steam','Steam'],['emulator','安卓模拟器'],['manual','手动连接']]
const seconds = n => typeof n==='number' && Number.isFinite(n) ? `${(n/1000).toFixed(2)} 秒` : '未记录'

export default function CaptureSettings({ state, busy, act }) {
  const [channel,setChannel]=useState(state.captureOptions?.channel||'auto'),[peer,setPeer]=useState(state.captureOptions?.peer||''),[port,setPort]=useState(state.captureOptions?.port||'')
  const [consent,setConsent]=useState(false),[launch,setLaunch]=useState(false)
  useEffect(()=>{if(state.discovery?.peers?.length){setPeer(state.discovery.peers.join(','));setPort('')}},[state.discovery?.updated])
  const locked=!!state.recording,u=state.captureUpdate,report=state.captureReport,quality=report?.quality
  const timings={...report?.session_timings,...report?.timings,...(state.recording?state.captureTimings:{})}
  const action=(name,text,Icon,args,disabled=false,primary=false)=><Action name={name} act={act} busy={busy} disabled={disabled} primary={primary} icon={Icon} args={args}>{text}</Action>
  return <>
    <PageTitle title="设置" description="游戏位置、版本更新与问题排查。" />
    <Panel title="游戏与保存位置">
      <div className="c-setting-row"><span><strong>游戏程序</strong><small className="c-path">{state.officialLauncher||'开始备份时自动识别'}</small></span>{action('select-official-launcher','更换',FolderOpen,undefined,locked)}</div>
      <div className="c-setting-row"><span><strong>账号备份</strong><small>系统文档 → 游戏账号备份</small></span>{action('open-backup-folder','打开文件夹',FolderOpen)}</div>
      <div className="c-setting-row"><span><strong>上次采集记录</strong><small>中途退出后，可以从原始记录重新整理。</small></span>{action('capture-recover','恢复记录',RefreshCw,undefined,locked||!state.captureSession)}</div>
    </Panel>
    <Panel title="版本更新" aside={<span className="c-tag">当前 {state.version}</span>}>
      <div className="c-setting-row"><span><strong>{u?.phase==='available' ? `可更新至 ${u.availableVersion}` : u?.phase==='ready' ? '新版已准备好' : u?.phase==='current' ? '已是最新版本' : '检查软件更新'}</strong><small>{u?.error||u?.hint||'更新后继续使用原来的启动入口。'}</small></span>
        {u?.phase==='ready' ? action('capture-update-start','更新并重启',Play,undefined,locked,true) : u?.phase==='available' ? action('capture-update-download','下载更新',ArrowDownToLine,undefined,locked,true) : action('capture-update-check',u?.phase==='checking'?'检查中…':'检查更新',RefreshCw,undefined,locked||['checking','downloading','verifying','restarting'].includes(u?.phase))}</div>
      <Disclosure title="更新选项"><label className="consent"><input type="checkbox" checked={!!state.captureUpdateCheckOnStart} disabled={locked||!!busy} onChange={e=>act('capture-update-auto',{enabled:e.target.checked})} />启动时检查新版本</label><p>优先直连 GitHub，失败时尝试 GH-Proxy。两条线路使用相同签名与文件校验，不上传账号数据。当前线路：{u?.sourceLabel||'自动选择'}。</p>{action('capture-update-folder','打开更新目录',FolderOpen)}</Disclosure>
    </Panel>
    <Panel title="问题排查">
      <div className="c-setting-row"><span><strong>检查运行环境</strong><small>开始备份前也会自动检查。</small></span>{action('capture-preflight','检测环境',ShieldCheck,undefined,locked)}</div>
      {state.preflight?.checks && <div className="c-preflight-list">{state.preflight.checks.map(c=><div key={c.id}><span className={`c-dot ${c.ok?'ok':'warn'}`} /><span><strong>{c.label}</strong><small>{c.detail}</small></span></div>)}</div>}
      <Disclosure title="诊断与运行详情" data-testid="capture-diagnostics">
        <div className="c-detail-grid">{Object.entries({'TCP 缺口':quality?.tcp_gap_directions,'尾数据方向':quality?.tail_directions,'解码失败':quality?.decode_failures??report?.decode_errors,'未知协议':report?.unknown,'协议包':report?.packets,'成功响应':report?.successful}).map(([k,v])=><div key={k}><span>{k}</span><b>{v??'未记录'}</b></div>)}</div>
        <p>缺口与尾数据可能重叠，不能相加；没有检测信息的旧包保持未记录。</p>
        <div className="c-detail-grid">{Object.entries({'准备':timings.preparation_ms,'记录与收尾':timings.recording_ms,'首次可读':timings.first_response_observed_ms,'格式转换':timings.conversion_ms,'抓包准备':timings.prepare_capture_ms,'重组与解码':timings.reassembly_decode_export_ms,'响应核对':timings.response_audit_ms,'归档':timings.archive_ms}).map(([k,v])=><div key={k}><span>{k}</span><b>{seconds(v)}</b></div>)}</div>
        {report?.warnings?.map((warning,i)=><p key={i}>{warning}</p>)}
        <div className="actions">{action('capture-export-diagnostics','导出诊断',ArrowDownToLine,undefined,locked||!report)}{action('capture-open-logs','打开日志',FolderOpen)}{action('select-toolkit','选择解析组件',FolderOpen,undefined,locked)}</div><p>诊断文件不包含账号标识、昵称、路径或协议正文。</p>
      </Disclosure>
    </Panel>
    <Disclosure title="高级采集 · 模拟器或手动连接" data-testid="advanced-capture">
      <Note>一般无需设置。无法自动识别游戏连接时，再手动指定范围。</Note>
      <label className="field"><span>游戏渠道</span><select value={channel} disabled={locked} onChange={e=>{setChannel(e.target.value);setPort('')}}>{channels.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <div className="form-grid"><label className="field"><span>连接 IP</span><input value={peer} disabled={locked} onChange={e=>setPeer(e.target.value)} placeholder="留空自动识别" /></label><label className="field"><span>TCP 端口</span><input value={port} disabled={locked} onChange={e=>setPort(e.target.value)} placeholder="留空使用默认范围" /></label></div>
      <div className="actions">{action('capture-discover','识别游戏连接',RefreshCw,undefined,locked)}</div>{state.discovery && <p>{state.discovery.hint}</p>}
      <label className="consent"><input type="checkbox" checked={launch} disabled={locked} onChange={e=>setLaunch(e.target.checked)} />采集准备好后打开游戏</label>
      <label className="consent"><input type="checkbox" checked={consent} disabled={locked} onChange={e=>setConsent(e.target.checked)} />我仅采集自己已获授权的连接</label>
      <div className="actions">{state.recording ? action('capture-stop','停止并保存',Square,undefined,!['starting','recording'].includes(state.recording),true) : action('capture-start','开始手动采集',Play,{peer,port,channel,consent,launch},!state.windows||!consent,true)}{action('open-capture-folder','打开原始记录',FolderOpen,undefined,!state.captureSession&&!report)}</div>
      <p>每轮最多 30 分钟或约 448 MB 原始记录，达到限制后自动整理。原始记录通常比导出包大。</p>
    </Disclosure>
  </>
}
