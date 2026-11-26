import React, { useEffect, useState } from 'react'
import { ArrowDownToLine, FolderOpen, Library, Play, Radio, RefreshCw, Square } from 'lucide-react'
import { ArtHero, artwork, portraits } from './artwork.jsx'

function Card({ title, help, children }) {
  return <section className="card checklist-card"><div className="card-head"><div className="card-icon"><Library size={19} /></div><div><h2>{title}</h2><p>{help}</p></div></div>{children}</section>
}

const size = value => typeof value === 'number' && Number.isFinite(value) ? `${(value / 1048576).toFixed(1)} MiB` : '等待统计'

export default function GardenCapturePage({ state, busy, act }) {
  const [query, setQuery] = useState('')
  const active = !!state.recording && state.capturePurpose === 'gardens'
  const otherActive = !!state.recording && !active
  const locked = !!busy || !!state.recording
  const report = state.captureGardenReport
  const observation = active ? state.captureProgress : report
  const gardens = observation?.gardens || []
  const rows = gardens.filter(row => `${row.owner_name} ${row.owner_uid}`.includes(query.trim()))
  const flow = state.captureFlow?.purpose === 'gardens' ? state.captureFlow : null
  useEffect(() => {
    if (state.windows && state.captureResumePurpose === 'gardens' && !window.__captureAutoStarted && new URLSearchParams(location.search).get('autoCapture') === '1') {
      window.__captureAutoStarted = true
      act('capture-gardens-one-click')
    }
  }, [state.windows, state.captureResumePurpose, act])
  const button = (name, text, Icon, args, disabled = false, primary = false) => <button type="button" className={'button ' + (primary ? 'primary' : 'secondary')}
    data-action={name} disabled={!!busy || disabled} onClick={() => act(name, args, name.startsWith('capture-gardens-export') ? '装修 ZIP 已保存' : undefined)}><Icon size={16} />{busy === name ? '处理中…' : text}</button>
  return <>
    <ArtHero art={artwork.morning} eyebrow="拜访喜欢的家，留住布置灵感" title="把喜欢的装修，单独收藏" description="进入想保存的家园，等待家具加载。按屋主分别归档，也可一次保存本次装修合集。">
      <div className="actions">{active ? button('capture-stop', '停止并保存装修', Square, undefined, !['starting', 'recording'].includes(state.recording), true)
        : button('capture-gardens-one-click', '开始装修采集', Play, undefined, locked || !state.windows, true)}
        {button('capture-gardens-open', '打开抓包或装修包', FolderOpen, undefined, locked)}
        {button('capture-gardens-open-folder', '打开装修备份目录', FolderOpen)}</div>
    </ArtHero>
    {otherActive && <div className="capture-guide"><strong>账号采集正在进行</strong><p>请先在「采集与核对」结束当前任务，再开始装修采集。</p></div>}
    {flow && <div className={'capture-flow ' + flow.phase} role="status"><Radio size={17} /><div><strong>{active ? state.recording === 'recording' ? '装修采集中' : '正在整理装修' : flow.phase === 'failed' ? '需要处理' : flow.phase === 'complete' ? '装修记录已整理' : '准备装修采集'}</strong><p>{flow.hint}</p></div></div>}
    {flow?.purpose === 'gardens' && state.captureError && <div className="notice error">{state.captureError}</div>}
    {!otherActive && state.captureGardenLimit && <div className="notice" role="status">已达到本轮录制的时长或容量上限，原始记录已保留。整理完成后可导出，再开始新一轮。</div>}
    {active && (state.captureStorage === 'per-cpu-buffer' || state.captureBackend === 'buffered') && <div className="notice">当前系统正在使用兼容录制，原始记录可能增长较快。请留意空间占用，及时结束本轮。</div>}
    <div className="capture-metrics"><div><span>已见家园</span><strong>{gardens.length}</strong><small>{active ? '仅显示已经落盘的观测' : '按家园编号分别保存'}</small></div>
      <div><span>观测家具</span><strong>{gardens.reduce((sum, row) => sum + (row.furniture_count || 0), 0)}</strong><small>快照中的家具数，不代表完整校验</small></div>
      <div><span>{active ? '原始记录占用' : '采集状态'}</span><strong>{active ? size(state.captureBytes) : report ? '已整理' : '待开始'}</strong><small>{active ? '上限 448 MiB 或 30 分钟' : '游戏退出后自动保存'}</small></div>
      <div><span>保存位置</span><strong>游戏家园备份</strong><small>系统文档目录，独立于账号备份</small></div></div>
    <div className="grid capture-grid"><Card title="拜访时这样操作" help="普通拜访即可，不需要修改装修或领取任何奖励。">
      <div className="capture-steps">{[
        ['开始记录，再进入家园', '先点开始；游戏未运行时会自动打开。已在游戏里可直接继续拜访。'],
        ['走动等待各区域加载', '进入目标家园，走到各区域并等待家具加载，再拜访下一家；可以连续采多位屋主。'],
        ['结束后统一保存', '退出游戏自动整理，或点“停止并保存装修”。下方可分别导出，也可保存全部合集。']
      ].map(([title, text], index) => <details className="capture-step" key={title} open={index === 0}><summary><span className="step-avatar"><img src={portraits[index + 3]} alt="" /><b>{index + 1}</b></span><strong>{title}</strong></summary><p>{text}</p></details>)}</div>
      <p className="capture-hint">此模块只采集与导出装修，不把装修导入自己的家园。未取得本次登录主数据时，无法区分是否自家；屋主编号明确的记录仍会单独归档。</p>
      <p className="capture-hint">连续记录，自动换文件；每轮最多 30 分钟或约 448 MiB 原始记录，先到上限即整理保存。原始记录会大于装修 ZIP。</p>
    </Card><Card title="本次装修交付" help="无需采到完整账号主数据，也能整理家园。账号 ZIP 与装修合集分别保存。">
      <div className="actions">{button('capture-gardens-export-all', '保存全部装修合集', ArrowDownToLine, undefined, locked || !report?.gardens_bundle, true)}
        {button('capture-gardens-recover', '恢复上次装修记录', RefreshCw, undefined, locked || !state.captureGardenSession)}</div>
      {state.captureGardenSavedZip && <p className="capture-path">{state.captureGardenSavedZip}</p>}
      {state.captureGardenDelivery && <p className="capture-hint">最近一次装修导出已通过文件与归属校验。</p>}
      <p className="capture-hint">识别到家园后自动生成合集，结束一键采集时自动保存。请单独保管装修合集；账号 ZIP 不包含拜访的他人家园。</p>
      <p className="capture-hint">家具数量表示本次观测到的布局，不保证当前最新或所有家具均已返回。原始场景与增量响应会一并保留。</p>
      {!!report?.warnings?.length && <div className="capture-guide warning"><strong>记录质量提示</strong><p>{report.warnings.join(' ')}</p></div>}
    </Card></div>
    <Card title="已采到的家园装修" help={active ? '实时列表可能有落盘延迟，最终以停止后的解析为准。' : '按屋主查看观测数量，每个家园均可单独保存。'}>
      <label className="field"><span>查找屋主或家园编号</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入昵称或编号" /></label>
      {!!gardens.length && !observation?.garden_account_identified && <p className="capture-hint">未识别到本次登录账号，尚未区分自家与拜访家园。编号仅用于这份装修的归档。</p>}
      {rows.length ? rows.map(row => <div className="audit-row" key={row.owner_uid}><div><strong>{row.owner_name || '未知屋主'}</strong><p>家园编号 {row.owner_uid} · 观测家具 {row.furniture_count ?? '未确认'} 件</p></div>
        {button('capture-gardens-export', '单独保存装修 ZIP', ArrowDownToLine, { index: gardens.indexOf(row) }, locked || !row.path)}</div>)
        : <div className="empty"><Library size={18} /><span>{query ? '没有匹配的家园' : active ? '等待家园场景返回，加载后可继续拜访下一家。' : '开始装修采集并拜访家园，或打开之前的抓包、装修 ZIP。'}</span></div>}
    </Card>
  </>
}
