import React, { useEffect, useRef, useState } from 'react'
import { Activity, ArrowDownToLine, CircleCheck, CircleHelp, FolderOpen, Library, Play, Radio, RefreshCw, ScanLine, ShieldCheck, Sprout, Square, Swords, Users } from 'lucide-react'
import { guidedSteps } from './capture-guide.mjs'
import { artwork, portraits, ArtHero, ArtHeading } from './artwork.jsx'
import GardenCapturePage from './gardens.jsx'
import OwnScenesPage from './own-scenes.jsx'
import LifeSocialRecords from './life-social.jsx'
import { equipmentLabel, qualityLabel, sceneLabel, sceneNote } from './capture-presentation.mjs'

const channels = [['auto', '自动 / 通用 PC'], ['cn-pc', '国服 PC · TapTap / B站'], ['steam', 'Steam · 动态端口'], ['emulator', '安卓渠道 · 模拟器'], ['manual', '手动连接范围']]
const states = { collected: '已见响应', empty: '已收到空列表', partial: '有数据，待补齐', missing: '尚缺响应', waiting: '等待响应', unknown: '暂无法判断' }
function Button({ children, icon: Icon, primary, ...props }) {
  return <button type="button" className={'button ' + (primary ? 'primary' : 'secondary')} {...props}>{Icon && <Icon size={16} />}{children}</button>
}
function Card({ title, help, icon: Icon, children, className = '' }) {
  return <section className={'card ' + className}><div className="card-head"><div className="card-icon"><Icon size={19} /></div><div><h2>{title}</h2><p>{help}</p></div></div>{children}</section>
}
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }
function Value({ label, children }) { return <div className="value"><span>{label}</span><strong>{children ?? '—'}</strong></div> }
function Empty({ children }) { return <div className="empty"><CircleHelp size={17} /><span>{children}</span></div> }
const size = bytes => bytes == null ? '—' : (bytes / 1024 / 1024).toFixed(1) + ' MB'
const duration = value => typeof value === 'number' && Number.isFinite(value) ? (value / 1000).toFixed(2) + ' 秒' : '未记录'

export default function CapturePage(props) {
  if (props.tab === 'gardens') return <GardenCapturePage {...props} />
  if (props.tab === 'scenes') return <OwnScenesPage {...props} />
  const other = props.state.recording && props.state.capturePurpose === 'gardens'
  const state = { ...props.state, recording: other ? null : props.state.recording,
    captureFlow: props.state.captureFlow?.purpose === 'gardens' ? null : props.state.captureFlow,
    captureError: props.state.captureFlow?.purpose === 'gardens' ? '' : props.state.captureError }
  return <>{other && <div className="capture-guide"><strong>装修采集正在进行</strong><p>请切换到「装修采集」查看进度或停止保存。</p></div>}
    <AccountCapturePage {...props} state={state} busy={other ? 'garden-capture' : props.busy} /></>
}

function AccountCapturePage({ state, tab, busy, act }) {
  const [channel, setChannel] = useState('auto')
  const [peer, setPeer] = useState('')
  const [port, setPort] = useState('')
  const [consent, setConsent] = useState(false)
  const [launch, setLaunch] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const autoStarted = useRef(false)
  const initialized = useRef(false)
  const discoveryTime = useRef('')
  useEffect(() => {
    if (state.role === 'capture' && state.windows && !window.__captureAutoStarted && state.captureResumePurpose !== 'gardens' && !autoStarted.current && new URLSearchParams(location.search).get('autoCapture') === '1') {
      autoStarted.current = true
      window.__captureAutoStarted = true
      act('capture-one-click')
    }
  }, [state.role, state.windows, act])
  useEffect(() => {
    if (state.captureOptions && !initialized.current) {
      initialized.current = true
      setChannel(state.captureOptions.channel || 'auto'); setPeer(state.captureOptions.peer || ''); setPort(state.captureOptions.port || '')
    }
  }, [state.captureOptions])
  useEffect(() => {
    const discovery = state.discovery
    if (discovery?.updated && discoveryTime.current !== discovery.updated) {
      discoveryTime.current = discovery.updated
      if (discovery.peers?.length) { setPeer(discovery.peers.join(', ')); setPort('') }
    }
  }, [state.discovery])
  const report = state.captureReport
  const progress = state.captureProgress
  const flow = state.captureFlow
  const observation = state.recording ? progress : report
  const steps = guidedSteps(observation)
  const next = steps.find(step => step.status !== 'received')
  const exploration = observation?.exploration
  const checklist = (state.recording ? progress : report)?.items?.filter(item => item.id !== 'gacha_records') || []
  const account = observation?.accounts === 1 && observation?.accounts_detail?.length === 1 ? observation.accounts_detail[0] : null
  const publicUid = account?.player_label || account?.uid || null
  const quality = report?.quality
  const timings = { ...report?.session_timings, ...report?.timings, ...(state.recording ? state.captureTimings : {}) }
  const locked = !!busy || !!state.recording
  const action = (name, label, Icon, args, disabled = false, primary = false) => <Button icon={Icon} primary={primary}
    data-action={name} disabled={!!busy || disabled} onClick={() => act(name, args, name === 'capture-export-diagnostics' ? '诊断 JSON 已保存' : name.startsWith('capture-export') ? '备份 ZIP 已保存' : name === 'capture-recover' ? '已重新解析上次采集，请在采集页查看结果' : undefined)}>{busy === name ? '处理中…' : label}</Button>
  const received = checklist.filter(item => ['collected', 'empty', 'partial'].includes(item.state)).length
  const pending = checklist.filter(item => item.state === 'partial').length

  if (tab === 'settings') return <>
    <ArtHeading title="采集环境与恢复" description="检查采集环境，管理采集结果并恢复未完成的记录。" art={artwork.harvest} />
    <div className="grid">
      <Card icon={ShieldCheck} title="运行预检查" help="检查权限、占用和本地解码依赖。">
        <div className="checks">{state.preflight?.checks?.map(check => <div key={check.id} className="check"><span className={'check-dot ' + (check.ok && check.level !== 'warning' ? 'ok' : 'warn')} />
          <div><strong>{check.label}</strong><p>{check.detail}</p></div></div>) || <Empty>实时采集前将自动检查，也可以手动检查。</Empty>}</div>
        <div className="actions">{action('capture-preflight', '预检查', ShieldCheck, undefined, !!state.recording)}
          {action('capture-open-logs', '打开错误日志目录', FolderOpen)}</div>
      </Card>
      <Card icon={Library} title="工具与会话" help="切换完整依赖目录，或从上次会话重新解析。">
        <div className="values"><Value label="数据检查">{state.toolkit ? '已就绪' : '依赖缺失'}</Value><Value label="工具版本">{state.version || '0.5.2'}</Value>
          <Value label="上次会话">{state.captureSession?.split(/[\\/]/).at(-1) || '无'}</Value></div>
        <div className="actions">{action('select-toolkit', '选择工具目录', FolderOpen, undefined, locked)}
          {action('capture-recover', '恢复上次采集', RefreshCw, undefined, locked || !state.captureSession)}</div>
      </Card>
    </div>
    <Card icon={ArrowDownToLine} className="checklist-card" title="版本更新" help="下载通过签名验证的独立采集工具更新。">
      <p>{state.captureUpdate?.error || state.captureUpdate?.hint || '可手动检查；启动时检查由你选择开启。'}</p>
      <div className="values"><Value label="当前版本">{state.version}</Value><Value label="可用版本">{state.captureUpdate?.availableVersion || '尚未检查'}</Value>
        <Value label="更新状态">{({ idle: '未检查', checking: '检查中', unavailable: '暂无公开版本', current: '已是最新', available: '有新版本', downloading: `下载 ${state.captureUpdate?.progress || 0}%`, verifying: '验证包内容', ready: '可启动新版', restarting: '启动新版', failed: '需要重试' })[state.captureUpdate?.phase] || '未检查'}</Value>
        <Value label="更新线路">{state.captureUpdate?.sourceLabel || '自动选择'}</Value></div>
      <p className="capture-hint">优先直连 GitHub，连接失败或下载中断时自动尝试备用加速（GH-Proxy）。两条线路使用同一签名和文件校验。</p>
      <div className="actions">{action('capture-update-check', '检查更新', RefreshCw, undefined, locked)}
        {action('capture-update-download', '下载并验证', ArrowDownToLine, undefined, locked || state.captureUpdate?.phase !== 'available')}
        {action('capture-update-start', '更新并重启', Play, undefined, locked || state.captureUpdate?.phase !== 'ready')}
        {action('capture-update-folder', '打开更新目录', FolderOpen)}</div>
      <label className="check-consent"><input type="checkbox" checked={!!state.captureUpdateCheckOnStart} disabled={locked}
        onChange={event => act('capture-update-auto', { enabled: event.target.checked })} /><span>启动时检查新版本</span></label>
    </Card>
    <Card icon={Radio} className="checklist-card" title="游戏与备份位置" help="一键采集会自动识别已安装的游戏；多套客户端时，可在这里指定本次使用的官服。">
      <p className="capture-path">{state.officialLauncher || '尚未指定，开始时自动识别'}</p>
      <div className="actions">{action('select-official-launcher', '更换官服程序', FolderOpen, undefined, locked)}
        {action('open-backup-folder', '打开备份文件夹', FolderOpen)}</div>
      <p className="capture-hint">默认保存到系统“文档”内的“游戏账号备份”。每次保留独立原始记录，识别到唯一账号后自动生成账号 ZIP。</p>
    </Card>
    <div className="capture-guide"><strong>恢复保留原始数据</strong><p>重新解析会写入新的结果目录。采集组件空闲时可恢复未完成的原始记录。</p></div>
  </>

  if (tab === 'exploration') return <>
    <ArtHeading title="探索观测报告" description="探索点、收集物、水晶、宝箱、月亮和情绪月亮分别记录。未收到的项目显示未知。" art={artwork.morning} />
    <div className="capture-guide map-instructions"><strong>地图信息怎么采集</strong><ol>
      <li>打开世界地图和各地区的探索进度，逐一切换已解锁地区。</li>
      <li>打开收集、收藏与月亮页面，切换地区，等待页面加载完成。</li>
      <li>进入各已解锁地区，等待场景、水晶和宝箱状态返回。只停留在主城无法观测其他地区。</li>
      <li>已完成互动的月亮与情绪月亮按响应记录；无需为采集刻意消耗道具或领取奖励。</li>
      <li>景点和世界挑战历史随场景返回，限时挑战还可打开挑战记录核对。备份有记录但进服全显示未完成时，应检查服务端恢复，先不要全部重采。</li>
    </ol><p>实时数据可能延迟落盘，停止后会统一核对。场景快照仅表示已观测区域，不代表全图采齐，也不会把未知当作 0。</p></div>
    {exploration ? <>
      <div className="capture-guide"><strong>{exploration.summary}</strong><p>资源目录 {exploration.resource_version} · 目录待匹配 {exploration.unknown_ids?.length || 0} 项（数据已保留） · {exploration.attribution === 'single_observed_uid' ? '已关联单个账号' : exploration.attribution === 'single_observed_player_id' ? '已关联单个角色，登录 UID 未返回' : '缺少唯一账号归属'}</p></div>
      <div className="exploration-table"><table><thead><tr><th>场景</th><th>观测范围</th><th>探索点</th><th>收集物观测</th><th>水晶观测 / 声明总量</th><th>已开宝箱</th><th>月亮 / 情绪月亮</th></tr></thead><tbody>
        {Object.entries(exploration.maps || {}).map(([id, row]) => <tr key={id}><td>{sceneLabel(id, row)}<small>场景 {id}</small>{sceneNote(id) && <small>{sceneNote(id)}</small>}</td>
          <td>{({ not_captured: '未采到', scene_snapshot_partial: '部分场景快照', observed_evidence: '已见相关响应' })[row.collection_coverage]}</td>
          <td>{row.points.collected ?? '未知'} / {row.points.total ?? '未知'}</td>
          <td>{row.items.collected ?? '未知'}</td>
          <td>{row.crystals.collected ?? '未知'} / {row.crystals.total ?? '未知'}{row.crystals.mismatch && <small>目录数量与声明不一致</small>}</td>
          <td>{row.one_time_boxes.collected ?? '未知'}</td><td>{row.moons.collected_count ?? (row.moons.collected_ids.length || '未知')} / {row.moons.interacted_emotion_count ?? (row.moons.interacted_emotion_ids.length || '未知')}</td></tr>)}
      </tbody></table></div>
      {exploration.activities && <div className="card checklist-card" data-testid="world-activities">
        <h2>景点与挑战历史证据</h2><p>下表说明备份里是否存在记录。游戏显示“未完成”仍需核对服务端导入和回包，不能由此认定没采到。</p>
        <div className="exploration-table"><table><thead><tr><th>类别</th><th>已观测项目</th><th>明确完成证据</th><th>完成状态未知</th></tr></thead><tbody>
          {exploration.activities.categories.map(row => <tr key={row.id}><td>{row.label}</td><td>{row.state === 'unknown' ? '未采到 / 未归属' : row.observed_count}</td>
            <td>{row.state === 'unknown' ? '未知' : row.observed_completed_count}</td><td>{row.state === 'unknown' ? '未知' : row.unknown_completion_count}</td></tr>)}
        </tbody></table></div><p className="capture-hint">本人挑战用时历史 {exploration.activities.challenge_history_count} 项。{exploration.activities.note}</p>
        <p className="capture-hint">重复历史不累加，不把当前场景当作全局挑战的归属。完整记录及原始状态见账号包中的 world-activities.json。</p>
      </div>}
      <div className="actions">{action('open-capture-folder', '打开完整报告', FolderOpen)}</div>
    </> : <Empty>{state.recording ? '正在等待地图信息落盘，可继续在游戏中操作，停止后生成最终报告。' : '开始一次采集，或打开已有备份后查看各地区观测。'}</Empty>}
  </>

  return <>
    <section className="capture-banner"><ArtHero art={artwork.harvest} eyebrow="把珍贵的回忆，好好收起来" title="点一下，留住你的冒险" description="自动识别游戏与渠道。去游戏里走走，退出后为你保存。" className="capture-art-hero">
      <div className="actions one-click-actions">{state.recording
        ? action('capture-stop', ['starting', 'recording'].includes(state.recording) ? '停止并保存' : '正在整理备份…', Square, undefined, !['starting', 'recording'].includes(state.recording), true)
        : action('capture-one-click', '一键采集并打开游戏', Play, undefined, !state.windows, true)}
        {action('analyze', '打开采集文件', FolderOpen, undefined, locked)}
        <Button disabled={locked} data-action="toggle-advanced" onClick={() => setAdvanced(!advanced)}>{advanced ? '收起高级采集' : '高级采集'}</Button></div>
      </ArtHero>
      <p className="capture-hint">一键开始将记录本机游戏连接。首次可能弹出系统权限确认；未找到游戏时只需选择一次路径。抽卡历史无需操作。</p>
      {flow && <div className={'capture-flow ' + flow.phase} role="status"><Radio size={17} /><div><strong>{({ checking: '检查环境', permission: '等待系统权限', finding: '识别游戏', starting: '准备采集', recording: '采集中', saving: '整理备份', complete: state.captureSavedZip ? '账号备份已保存' : '记录已保存，请检查结果', failed: '需要处理', idle: '准备就绪' })[flow.phase]}</strong><p>{flow.hint}</p></div>
        {!!state.captureSavedZip && !state.recording && action('open-backup-folder', '打开备份文件夹', FolderOpen)}</div>}
      {!!state.captureSavedZip && !state.recording && <p className="capture-source" title={state.captureSavedZip}>保存位置 {state.captureSavedZip}</p>}
      {state.captureDelivery && !state.recording && <p className="capture-hint">最近一次账号导出已通过文件与归属校验。</p>}
      <div className="actions capture-result-actions">
        {action('analyze', '核对本次采集', ScanLine, { recent: true }, locked || !state.capture)}
        {action('capture-export', '另存账号 ZIP', ArrowDownToLine, undefined, locked || !report?.account_zip)}</div>
      {report && <p className="capture-source" title={report.input}>来源 {report.input.split(/[\\/]/).at(-1)} · {report.updatedAt?.replace('T', ' ')}</p>}
    </section>
    <div className="capture-metrics">
      <div><span>成功响应</span><strong>{state.recording ? progress?.readable ? '已观测' : '等待落盘' : report?.successful ?? '—'}</strong><small>{state.recording ? '结束后进行最终核对' : `${report?.packets ?? '—'} 个协议包`}</small></div>
      <div><span>已观测分类</span><strong>{checklist.length ? received + ' / ' + checklist.length : '—'}</strong><small>{pending ? `${pending} 项已有部分记录 · ` : ''}抽卡历史不计入</small></div>
      <div><span>{state.recording ? '网络记录' : '采集质量'}</span><strong>{state.recording ? progress?.livePackets ?? '等待计数' : report ? qualityLabel(report) : '—'}</strong><small>{state.recording ? size(state.captureBytes) : '仅限本次已记录数据，分项见下方'}</small></div>
      <div><span>账号归属</span><strong>{account ? publicUid ? 'UID ' + publicUid : '登录 UID 未返回' : observation ? (observation.accounts > 1 ? '多个账号' : '未确认') : '—'}</strong><small>{account ? `${account.player_name || '未返回昵称'} · 等级 ${account.level ?? '未知'}` : '以成功主数据响应为准'}</small></div>
    </div>
    {state.captureError && <div className="notice error" role="alert">{state.captureError}</div>}
    {state.captureLimit && <div className="notice">已达到单次时长或存储限制，原始记录已保留。</div>}
    <div className="grid capture-grid">
      {advanced ? <Card icon={Radio} title="高级采集" help="模拟器、指定连接和自选保存目录可在这里设置。">
        <Field label="渠道"><select disabled={locked} value={channel} onChange={e => { setChannel(e.target.value); setPort('') }}>
          {channels.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <div className="form-grid capture-fields"><Field label="对端 IP"><input value={peer} placeholder="留空使用 PC 常用端口" disabled={locked} onChange={e => setPeer(e.target.value)} /></Field>
          <Field label="TCP 端口"><input value={port} placeholder={peer ? '留空覆盖动态端口' : '自动 · 6 个常用端口'} disabled={locked} onChange={e => setPort(e.target.value)} /></Field></div>
        <div className="actions">{action('capture-discover', '识别游戏连接', ScanLine, undefined, locked)}
          {action('select-official-launcher', '选择官服程序', FolderOpen, undefined, locked)}</div>
        {state.discovery && <p className="capture-hint">{state.discovery.hint} 进程 {state.discovery.processes?.length || 0} 个，候选地址 {state.discovery.peers?.length || 0} 个。</p>}
        {state.officialLauncher && <><p className="capture-path">{state.officialLauncher}</p><label className="consent"><input type="checkbox" checked={launch} disabled={locked} onChange={e => setLaunch(e.target.checked)} /><span>采集就绪后启动所选官服</span></label></>}
        <label className="consent"><input type="checkbox" checked={consent} disabled={locked} onChange={e => setConsent(e.target.checked)} /><span>我仅采集自己已获授权的连接</span></label>
        <div className="actions">{state.recording ? action('capture-stop', '停止并保存', Square, undefined, !['starting', 'recording'].includes(state.recording), true)
          : action('capture-start', '开始采集', Play, { peer, port, channel, consent, launch }, !state.windows || !consent, true)}
          {action('open-capture-folder', '打开采集目录', FolderOpen, undefined, !state.captureSession && !report)}</div>
        <p className="capture-hint">{peer ? `范围 ${peer} · TCP ${port || '全部端口'}` : `范围 TCP ${port || '11001–11004、21001、21002'}`}<br />连续记录，自动换文件。单次原始记录限 30 分钟或约 448 MB。</p>
      </Card> : <Card icon={Play} title="游戏里这样操作" help={state.recording ? `建议下一步：${next?.title || '完成浏览后退出游戏，等待保存'}` : '按顺序浏览即可。标记表示已见响应，最终数量在保存后核对。'}>
        <div className="capture-steps">{steps.map((step, index) => <details key={step.id} className={'capture-step ' + step.status} open={step.id === next?.id}>
          <summary><span className="step-avatar">{step.id === 'life' ? <Sprout size={24} style={{ margin: 6 }} /> : step.id === 'social' ? <Users size={24} style={{ margin: 6 }} /> : <img src={portraits[step.id === 'other' ? 5 : index]} alt="" />}<b>{step.status === 'received' ? '✓' : index + 1}</b></span><strong>{step.title}</strong><small>{step.status === 'received' ? '已见响应' : step.status === 'partial' ? '继续补充' : '待浏览'}</small></summary>
          <p>{step.text}</p></details>)}</div>
        <p className="capture-hint">实时核对可能延迟，无需等每项变色才继续。若浏览完毕，可退出游戏自动保存，也可点“停止并保存”。</p>
      </Card>}
      <Card icon={Swords} title="装备完整性证据" help="按实例 ID 去重，合并列表、穿戴与背包推送。">
        {report ? <><Equipment report={report} /><div className="values capture-details"><Value label="角色 / 任务">{account ? `${account.characters} / ${account.quests}` : '未知'}</Value>
          <Value label="登录 UID">{publicUid ?? '未返回'}</Value>
          <Value label="内部角色 ID">{account?.player_id ?? '未知'}</Value>
          <Value label="游戏 TCP 流">{report.streams}</Value><Value label="失败状态响应">{report.rejected}</Value>
          <Value label="采集完整性记录">{report.integrity_known ? '已检测' : '旧包未记录'}</Value></div></> : <Empty>{state.recording ? '采集中。停止后重组全部 TCP 流并核对装备实例。' : '打开账号 ZIP 或 PCAP，显示装备列表与所有来源的差异。'}</Empty>}
        {!!report?.unknown && <p className="capture-hint">未知协议 {Object.entries(report.unknown_ids || {}).slice(0, 12).map(([id, count]) => `${id} × ${count}`).join('、')}</p>}
      </Card>
    </div>
    {(report?.warnings?.length > 0 || progress?.warning) && <div className="capture-guide warning"><strong>{state.recording ? '实时观测' : '需要留意'}</strong>
      <p>{state.recording ? progress?.warning : report.warnings.join(' ')}</p></div>}
    {(report || state.recording) && <Card className="checklist-card" icon={Activity} title="采集质量与耗时" help="TCP 缺口和尾数据按流方向去重，各项可重叠，不相加。未触发界面与空列表在下方清单区分。">
      {report && <div className="values capture-details"><Value label="TCP 序列缺口（方向）">{quality?.tcp_gap_directions ?? '未记录'}</Value>
        <Value label="未解析尾数据（方向）">{quality?.tail_directions ?? '未记录'}</Value><Value label="受影响方向总数">{quality?.incomplete_directions ?? '未记录'}</Value>
        <Value label="解码失败（条）">{quality?.decode_failures ?? report.decode_errors}</Value><Value label="未知协议（条）">{quality?.unknown_protocol_packets ?? report.unknown}</Value></div>}
      <p className="capture-hint">尾数据可能来自未收完的帧或格式差异，不能直接认定丢包。未知协议的原始数据保留在备份中。界面未触发表示缺响应，成功空列表表示已收到 0 条。</p>
      <div className="values capture-details"><Value label="准备到记录就绪">{duration(timings.preparation_ms)}</Value><Value label="记录与收尾">{duration(timings.recording_ms)}</Value>
        <Value label="首个响应可读">{duration(timings.first_response_observed_ms)}</Value><Value label="文件转换">{duration(timings.conversion_ms)}</Value>
        <Value label="抓包格式准备">{duration(timings.prepare_capture_ms)}</Value><Value label="重组、解码与落盘">{duration(timings.reassembly_decode_export_ms)}</Value>
        <Value label="响应核对">{duration(timings.response_audit_ms)}</Value><Value label="归档写入">{duration(timings.archive_ms)}</Value></div>
      <p className="capture-hint">首个响应可读包含落盘与轮询延迟。旧记录没有的阶段保持“未记录”；离线打开 ZIP 不沿用之前的采集耗时。归档耗时记录主体文件写入，不含最后的报告收尾。</p>
      <div className="actions">{action('capture-export-diagnostics', '导出诊断 JSON', ArrowDownToLine, undefined, locked || !report)}</div>
      <p className="capture-hint">诊断只含版本、计数与耗时，不含 UID、昵称、路径、连接地址或原始协议正文。</p>
    </Card>}
    {observation?.dungeons && <DungeonRecords report={observation.dungeons} />}
    {observation?.life_social && <LifeSocialRecords report={observation.life_social} />}
    {report && !state.recording && !report.life_social && <div className="capture-guide warning"><strong>这是旧版核对结果</strong><p>点击「核对本次采集」可生成生活与社交补充检查项。缺少请求头的旧 ZIP 会保留未知分类；如有原始抓包，可打开重新解析，原始文件会保留。</p></div>}
    <Card className="checklist-card" icon={Activity} title="数据采集清单" help="已见响应只表示有采集证据。按提示补开界面，装备另核对列表数量。">
      {checklist.length ? <div className="capture-checklist">{checklist.map(item => <div key={item.id} className={'checklist-item ' + item.state}>
        <div><strong>{item.label}</strong><span className="evidence-tag">{item.detail || states[item.state] || item.status}</span></div><p>{item.hint}</p>
        <small title={Object.entries(item.evidence).map(([name, n]) => `${name} × ${n}`).join(' · ')}>{item.count ? `${item.count} 条证据 · ${Object.keys(item.evidence).filter(k => !k.startsWith('@')).join('、') || '推送数据'}` : '尚无可用响应'}</small>
      </div>)}</div> : <Empty>开始采集后显示实时观测。未落盘的数据保持未知，停止后生成最终清单。</Empty>}
    </Card>
    <div className="capture-guide"><strong>建议依次浏览</strong><p>角色与穿搭 → 背包、武器、护甲、海报并翻页 → 宠物 → 家园及各套预设 → 六类生活职业与对应图鉴 → 好友、申请、黑名单 → 邮件、成就、探索与档案。</p></div>
    {!!report?.gardens?.length && <Card className="checklist-card" icon={Library} title="独立家园备份" help="拜访的家园按主人单独归档，避免混入当前账号。">
      {report.gardens.map((garden, index) => <div className="audit-row" key={garden.owner_uid}><div><strong>{garden.owner_name} · 家园编号 {garden.owner_uid}</strong><p>家具 {garden.furniture_count ?? '未确认'} 件</p></div>
        {action('capture-export-garden', '另存家园 ZIP', ArrowDownToLine, { index }, locked)}</div>)}
    </Card>}
  </>
}

function DungeonRecords({ report }) {
  const [query, setQuery] = useState('')
  const rows = (report.dungeons || []).filter(row => (String(row.dungeon_id) + ' ' + row.scene_ids.join(' ')).includes(query.trim()))
  return <Card className="checklist-card" icon={Library} title="小副本观测记录" help="场景摘要与独立详情分开保存。已见记录不代表全部副本已采齐，也不代表已导入服务端。">
    <div className="values"><Value label="已见副本">{report.observed_count}</Value><Value label="有独立响应">{report.detailed_count}</Value><Value label="全部副本总数">未知</Value></div>
    <p className="capture-hint">先浏览各地区，再按需查看副本详情。需要保留副本内宝箱时进入对应副本等待加载，无需重打全部副本。全开放入口不能替代原通关、奖励和宝箱历史。</p>
    {!report.attributed && <p className="capture-hint">尚无唯一账号归属，以下只表示本次观测证据。</p>}
    <details><summary>查看副本编号与覆盖范围</summary><Field label="查找副本或场景编号"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入编号" /></Field>
      <div className="exploration-table"><table><thead><tr><th>副本</th><th>场景</th><th>任务完成观测</th><th>覆盖范围</th><th>独立响应</th></tr></thead><tbody>
        {rows.slice(0, 200).map(row => <tr key={row.dungeon_id}><td>{row.dungeon_id}</td><td>{row.scene_ids.join('、') || '未关联'}</td>
          <td>{row.observed_finished === true ? '已见完成' : row.observed_finished === false ? '未见完成' : '未确认'}</td>
          <td>{{ scene_summary_only: '场景摘要', detail_observed: '已见详情响应', event_only: '仅事件' }[row.coverage]}</td><td>{row.detail_responses}</td></tr>)}
      </tbody></table></div><p className="capture-hint">匹配 {rows.length} 条，最多显示 200 条。全部观测快照保存在账号 ZIP 的 dungeons.json 和 dungeons.txt。</p>
    </details>
  </Card>
}

function Equipment({ report }) {
  return <div className="audit">{['weapon', 'armor', 'poster'].filter(kind => report.equipment[kind]).map(kind => { const row = report.equipment[kind]; return <div className="audit-row" key={kind}>
    <div><strong>{{weapon: '武器', armor: '护甲', poster: '装备海报'}[kind]}</strong><p>列表 {row.snapshot} 件 · 全部来源 {row.observed} 件</p>
      <p>列表响应 {row.pages} 次 · 列表外另见 {row.other_only} 件{row.without_id > 0 && ` · 缺实例 ID ${row.without_id} 件`}</p></div>
    <div className={'audit-count ' + (row.quantity_matches || row.matches ? 'on' : '')}>{equipmentLabel(row)}
      <span>报送 {row.reported.length ? row.reported.join(' / ') : '—'}</span></div>
  </div>})}<p className="audit-note">穿戴响应 {report.sources.equipped} 条 · 背包推送 {report.sources.pack} 条 · 解码异常 {report.decode_errors} 条</p></div>
}
