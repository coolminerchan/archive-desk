import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, Archive, ArrowDownToLine, ArrowRight, Box, CircleCheck, CircleHelp, FileJson, FolderOpen,
  HardDrive, KeyRound, Layers, Library, Play, Radio, ScanLine, Server, ShieldCheck, Square, Swords, X, Settings, ChevronRight, Gamepad2
} from 'lucide-react'
import './style.css'
import './capture-clean.css'
import { hasRecordView, recordViews } from './capture-workflow.mjs'
import CapturePage from './capture.jsx'
import { artwork, roleArt, portraits, ArtHero, ArtLink, ArtHeading } from './artwork.jsx'

const ROLE = new URLSearchParams(location.search).get('role') || 'server'
const ROLE_INFO = {
  server: { name: '服务端管理', icon: Server, tabs: [['overview', '运行概览', Activity], ['releases', '资源发布', Layers], ['storage', '账号与存档', Archive]] },
  client: { name: '游戏启动器', icon: Box, tabs: [['overview', '连接与启动', Play], ['settings', '客户端设置', FolderOpen]] },
  capture: { name: '账号采集工具', icon: Radio, tabs: [['overview', '备份账号', ScanLine], ['records', '查看资料', Archive], ['gardens', '家园装修', Library], ['settings', '设置', Settings]] }
}

function Button({ icon: Icon, kind = 'secondary', children, ...props }) {
  return <button className={'button ' + kind} type="button" {...props}>{Icon && <Icon size={17} />}{children}</button>
}
function Card({ icon: Icon, title, help, children, className = '' }) {
  return <section className={'card ' + className}>
    <div className="card-head"><div className="card-icon"><Icon size={19} /></div>
      <div><h2>{title}</h2>{help && <p>{help}</p>}</div></div>
    {children}
  </section>
}
function Value({ label, value }) {
  return <div className="value"><span>{label}</span><strong title={typeof value === 'string' ? value : undefined}>{value || '—'}</strong></div>
}
function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
function Empty({ children }) {
  return <div className="empty"><CircleHelp size={17} /><span>{children}</span></div>
}

function App() {
  const [selectedArt, setSelectedArt] = useState(() => { try { return localStorage.getItem('launcher-art') || 'train' } catch { return 'train' } })
  const clientArt = artwork[selectedArt]?.image ? artwork[selectedArt] : artwork.train
  const [state, updateState] = useState({})
  const [tab, setTab] = useState('overview')
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tab])
  useEffect(() => {
    if (ROLE === 'capture' && new URLSearchParams(location.search).get('autoCapture') === '1' && state.captureResumePurpose === 'gardens') setTab('gardens')
  }, [state.captureResumePurpose])
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const [doctor, setDoctor] = useState(null)
  const [installed, setInstalled] = useState(null)
  const [audit, setAudit] = useState(null)
  const [migration, setMigration] = useState(null)
  const [uid, setUID] = useState('')
  const [version, setVersion] = useState('')
  const [targetVersion, setTargetVersion] = useState('2026-10-21-14-05-50')
  const [peer, setPeer] = useState('')
  const [port, setPort] = useState('11003')
  const [consent, setConsent] = useState(false)
  const [dispatchHost, setDispatchHost] = useState('127.0.0.1')
  const [dispatchPort, setDispatchPort] = useState('18080')
  const [dispatchUrl, setDispatchUrl] = useState('')
  const [connection, setConnection] = useState(null)
  const active = useRef(false)
  const config = state.config
  const settings = ROLE_INFO[ROLE]
  useEffect(() => { document.title = ROLE_INFO[ROLE].name }, [])
  useEffect(() => { setDispatchUrl(state.config?.dispatchUrl || ''); setConnection(null) }, [state.config?.path])
  const refresh = useCallback(async () => {
    const result = await window.desktop.act('state')
    if (result.value) updateState(result.value)
  }, [])

  useEffect(() => {
    const sync = () => refresh().catch(() => {})
    sync()
    const unsubscribe = window.desktop.onChange(sync)
    const timer = setInterval(() => { if (!document.hidden) sync() }, 1800)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [refresh])

  async function act(action, args, success) {
    if (active.current) return
    active.current = true
    setBusy(action)
    setToast(null)
    if (action === 'audit-migration') setMigration(null)
    try {
      const { value, error } = await window.desktop.act(action, args)
      if (error) throw new Error(error)
      if (value) {
        if (action === 'doctor') setDoctor(value)
        if (action === 'sync') setInstalled(value)
        if (action === 'analyze') setAudit(value)
        if (action === 'audit-migration') setMigration(value)
        if (action === 'check-connection') setConnection(value)
        if (['create', 'select-config'].includes(action)) { setDoctor(null); setInstalled(null); setConnection(null) }
      }
      if (success && value !== false) {
        const message = typeof success === 'function' ? success(value) : success
        if (message) setToast({ message })
      }
      await refresh()
    } catch (err) {
      setToast({ error: true, message: err.message })
    } finally {
      active.current = false
      setBusy('')
    }
  }

  const blocked = Boolean(busy)
  const actionButton = (action, label, icon, options = {}) => <Button kind={options.kind} icon={icon}
    data-action={action} disabled={blocked || options.disabled} onClick={() => act(action, options.args, options.success)}>
    {busy === action ? '处理中…' : label}</Button>
  const chooseConfig = actionButton('select-config', '选择配置', FileJson)
  const openFolder = config && actionButton('open-config-folder', '打开配置目录', FolderOpen)
  const runStatus = state.listening ? '运行中' : state.running ? '启动中' : '已停止'
  const captureStatus = ({ starting: '正在启动', recording: '正在采集', saving: '正在保存', analyzing: '正在解析' })[state.recording] || (state.captureReport ? '结果已就绪' : '等待采集')
  const connectionStatus = ({ connecting: '正在连接服务器', connected: '已连接服务器', reconnecting: '网络中断，正在恢复', expired: '连接已失效，请重新进入' })[state.gameNetwork]
  const status = ROLE === 'server' ? runStatus : ROLE === 'client' ? (state.gameRunning ? connectionStatus || '游戏程序运行中' : config ? '配置已加载' : '等待连接') : captureStatus
  const on = ROLE === 'server' ? state.listening : ROLE === 'client' ? config : state.recording === 'recording'

  const serverViews = {
    overview: <>
      <ArtHero art={artwork.morning} eyebrow="属于大家的开放空间" title="服务端总览" description="让每一段旅程，都有安心停靠的地方。">
        <div className="actions">
        {state.running ? actionButton('stop', '停止服务', Square, { kind: 'hero-primary', success: '服务已停止' })
          : actionButton('start', '启动服务', Play, { kind: 'hero-primary', disabled: !config })}
        {actionButton('doctor', '检查配置', ShieldCheck, { kind: 'hero-ghost', disabled: !config || !state.publicKey })}
        </div>
      </ArtHero>
      <div className="world-status-strip"><div><span className={'inline-dot ' + (state.listening ? 'ok' : '')} /><span>服务状态</span><strong>{runStatus}</strong></div><div><span>资源分发</span><strong>{config ? config.tls ? 'HTTPS' : 'HTTP' : '等待配置'}</strong></div><div><span>游戏网关</span><strong>{config?.lolo ? '已接入' : '等待接入'}</strong></div></div>
      <div className="art-links"><ArtLink art={artwork.train} title="管理资源包" description="统一资源，随时同步" onClick={() => setTab('releases')} /><ArtLink art={artwork.night} title="查看账号存档" description="保留每一次冒险" onClick={() => setTab('storage')} /></div>
      <div className="grid">
        <Card icon={Server} title="监听地址" help={config?.path || '选择已有配置，或创建本机测试配置。'}>
          <div className="values"><Value label="下载与登录" value={config?.listen} /><Value label="票据验证" value={config?.verifier} />
            <Value label="游戏网关" value={config?.lolo ? '已配置游戏服务' : '未配置'} /></div>
          <div className="actions">{chooseConfig}{openFolder}</div>
        </Card>
        <Card icon={ShieldCheck} title="部署检查" help="核对签名数据包、账号文件、证书和网关接入。">
          <div className="values"><Value label="签名公钥" value={state.publicKey ? state.publicKey.split(/[\\/]/).at(-1) : '未选择'} />
            <Value label="传输" value={config ? (config.tls ? 'HTTPS' : 'HTTP') : ''} /></div>
          <div className="actions">{actionButton('select-key', '选择公钥', KeyRound)}
            {actionButton('create', '创建本机测试配置', Box, { disabled: state.running,
              success: value => value && '已创建。客户端请选择 ' + value.client })}</div>
        </Card>
      </div>
      {doctor && <div className="result"><CircleCheck size={20} /><div><strong>部署检查通过</strong><p>
        {doctor.release?.client_version} · 资源版本 {doctor.release?.version}{doctor.tls_expires && ' · 证书有效期 ' + doctor.tls_expires}
      </p>{doctor.game_listen && <p>游戏本地监听 · {doctor.game_listen}</p>}{doctor.game_advertised && <p>游戏公布地址 · {doctor.game_advertised}</p>}
      {doctor.dispatch_listen && <p>调度本地监听 · {doctor.dispatch_listen}</p>}</div></div>}
    </>,
    releases: <>
      <ArtHeading title="资源发布" description="为指定客户端版本构建并签名统一数据包。" art={artwork.train} />
      <Card icon={Layers} title="发布数据包" help="选择资源目录和本机签名私钥。每次发布时递增资源版本。">
        <div className="form-grid">
          <Field label="资源版本"><input value={version} inputMode="numeric" placeholder="例如 2" onChange={e => setVersion(e.target.value)} /></Field>
          <Field label="客户端程序版本"><input value={targetVersion} onChange={e => setTargetVersion(e.target.value)} /></Field>
        </div>
        <div className="actions">{actionButton('publish', '选择资源并发布', Layers, { kind: 'primary', disabled: !config,
          args: { version, clientVersion: targetVersion }, success: result => result && '已发布资源版本 ' + result.version })}</div>
      </Card>
    </>,
    storage: <>
      <ArtHeading title="账号与存档" description="发放玩家访问码，定期验证存档快照。" art={artwork.morning} />
      <div className="grid">
        <Card icon={KeyRound} title="玩家账号" help="创建访问码后，停服初始化新账号的昵称。已有服务需重启后读取新增账号。">
          <Field label="玩家 UID"><input value={uid} inputMode="numeric" placeholder="输入 UID" onChange={e => setUID(e.target.value)} /></Field>
          <div className="actions">{actionButton('account', '创建访问码', KeyRound, { kind: 'primary', disabled: !config, args: { uid }, success: value => value && '访问码已保存' })}
            {actionButton('initialize-player', '初始化游戏账号', Box, {
              disabled: !config || state.running, args: { uid },
              success: value => value && (value.changed ? '游戏账号已初始化，原数据库已备份' : '游戏账号已有昵称')
            })}</div>
        </Card>
        <Card icon={HardDrive} title="存档备份" help="恢复演练会在选定目录中生成副本。">
          <div className="actions">{[
            ['backup', '创建快照', Archive], ['verify', '校验快照', ShieldCheck], ['stage-restore', '生成恢复副本', FolderOpen]
          ].map(([mode, label, icon]) => <React.Fragment key={mode}>{actionButton('snapshot', label, icon,
            { args: { mode }, disabled: mode === 'backup' && !config, success: value => value && (value.path || '快照校验通过') })}</React.Fragment>)}</div>
        </Card>
      </div>
      <Card icon={Swords} title="装备迁移核对" className="migration-card" help="按装备标识对照账号备份和游戏存档，报告采集到却未入库的武器、护甲。">
        <div className="actions">{actionButton('audit-migration', '核对已导入的装备', ShieldCheck, { disabled: !state.toolkit })}</div>
        {migration && <Migration result={migration.migration} errors={migration.decode_errors} input={migration.input} />}
      </Card>
    </>
  }

  const clientViews = {
    overview: <>
      <section className="game-stage">
        <img className="game-stage-art" src={clientArt.image} alt={'映像 · ' + clientArt.title} style={{ objectPosition: clientArt.position }} />
        <div className="game-stage-shade" />
        <div className="game-stage-top"><span className="edition-tag">国服 PC</span><button className="icon-button" aria-label="打开客户端设置" onClick={() => setTab('settings')}><Settings size={18} /></button></div>
        <div className="game-stage-copy"><span className="game-eyebrow">新的旅途，从这里开始</span><h1>开放空间</h1><p>和熟悉的伙伴，再一次相遇。</p><div className="companion-portraits" aria-label="角色映像">{portraits.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" />)}<span>在开放空间，继续你的故事</span></div></div>
        <span className="art-caption">映像 · {clientArt.title}</span>
        <div className="play-panel">
          <div className="play-details" aria-live="polite"><strong>{state.gameRunning ? connectionStatus || '游戏正在运行' : state.inspected ? '准备好再次出发' : '设置你的游戏'}</strong>
            <span>{state.gameNetwork === 'reconnecting' ? '正在保留当前连接，请稍候…' : config ? (config.gateway || '服务器配置已加载') : '先选择服务器，再定位本机游戏'}</span></div>
          <div className="play-actions">
            {actionButton('sync', '检查更新', ArrowDownToLine, { disabled: !config || !state.inspected,
              success: value => value && '资源已同步 · 版本 ' + value.version })}
            {!config ? actionButton('select-config', '选择服务器', Server, { kind: 'play-button' })
              : !state.inspected ? actionButton('inspect', '定位游戏', FolderOpen, { kind: 'play-button' })
              : !config.adapter ? <Button kind="play-button" icon={Settings} onClick={() => setTab('settings')}>配置游戏接入</Button>
              : state.gameRunning ? actionButton('stop-game', '关闭游戏', Square, { kind: 'play-button' })
              : actionButton('launch', '进入游戏', Play, { kind: 'play-button', success: '已启动游戏' })}
          </div>
        </div>
      </section>
      <div className="art-gallery" aria-label="选择首页映像">{['train', 'rain', 'morning'].map((id, index) => <button key={id} type="button" className={clientArt.id === id ? 'selected' : ''} aria-pressed={clientArt.id === id} aria-label={'切换映像：' + artwork[id].title} onClick={() => { setSelectedArt(id); try { localStorage.setItem('launcher-art', id) } catch {} }}>
        <img src={artwork[id].image} alt="" style={{ objectPosition: artwork[id].position }} /><span><small>映像 0{index + 1}</small><strong>{artwork[id].title}</strong></span><span className="gallery-mark" /></button>)}</div>
      <div className="game-install-strip">
        <div className="install-symbol"><FolderOpen size={20} /></div>
        <div className="install-copy"><strong>本机游戏</strong><span title={state.inspected?.game_root}>{state.inspected?.game_root || '尚未选择游戏安装位置'}</span></div>
        <div className="install-version"><span>程序版本</span><strong>{state.inspected?.program_version || '—'}</strong></div>
        <div className="install-version"><span>资源版本</span><strong>{state.inspected?.resource_version || '—'}</strong></div>
        {actionButton('inspect', '检查游戏目录', ScanLine)}
      </div>
      <div className="game-connection-row"><div><span className={'inline-dot ' + (config ? 'ok' : '')} /><strong>{config ? '服务器已配置' : '尚未配置服务器'}</strong><span>{config?.url || '使用管理员提供的连接配置'}</span></div>
        <Button icon={ChevronRight} onClick={() => setTab('settings')}>管理连接</Button></div>
      {installed && <div className="result"><CircleCheck size={18} /><div><strong>资源包已就绪 · 版本 {installed.version}</strong><p>{installed.pack_dir}</p></div></div>}
    </>,
    settings: <>
      <ArtHeading title="客户端设置" description="选择服务器配置，核对本机游戏目录。" art={artwork.train} />
      <div className="grid">
        <Card icon={FileJson} title="连接配置" help={config?.path || '请选择 client.json。'}>
          <div className="values"><Value label="接入程序" value={config?.adapter ? '已配置' : '未配置'} /></div>
          <div className="actions">{chooseConfig}{openFolder}</div>
        </Card>
        <Card icon={FolderOpen} title="游戏安装" help={state.inspected?.game_root || '请选择你使用的游戏安装目录。'}>
          <div className="actions">{actionButton('inspect', '检查游戏目录', ScanLine)}</div>
        </Card>
      </div>
      <Card icon={ShieldCheck} title="游戏接入设置" className="migration-card"
        help={state.inspected?.sdk_layout === 'pcgamesdk' ? '检测到 B 服登录组件。本次实验接入已内置运行环境，准备时会保留原游戏并创建独立副本；首次可能需要几分钟。' : '为游戏准备独立副本，并设置测试服务器地址。当前支持国服 PC 1.1.12，需选择接入资源和运行环境。'}>
        <div className="form-grid peer-fields">
          <Field label="服务器 IP"><input value={dispatchHost} onChange={e => setDispatchHost(e.target.value)} /></Field>
          <Field label="HTTP 端口"><input value={dispatchPort} inputMode="numeric" onChange={e => setDispatchPort(e.target.value)} /></Field>
        </div>
        <Field label="外部调度 HTTPS 地址（SakuraFRP）"><input value={dispatchUrl} placeholder="https://调度域名:外部端口，内网测试留空" onChange={e => { setDispatchUrl(e.target.value); setConnection(null) }} /></Field>
        <div className="actions">{actionButton('configure-research', '准备隔离客户端', Box, {
          disabled: !config || state.gameRunning, args: { host: dispatchHost, port: Number(dispatchPort), dispatchUrl },
          success: result => result && '隔离副本与接入配置已就绪'
        })}{actionButton('check-connection', '检查外部连接', Activity, { disabled: !config, args: { dispatchUrl } })}</div>
        {connection && <div className="result"><Activity size={18} /><div><strong>{connection.ok ? '基础连接检查通过' : '部分入口尚未连通'}</strong>
          {connection.checks.map(row => <p key={row.name}>{row.name} · {row.ok ? '已连通' : '未通过（' + row.error + '）'}</p>)}<p>{connection.note}</p></div></div>}
      </Card>
    </>
  }

  const captureViews = Object.fromEntries(['overview', 'gardens', 'settings', ...recordViews.map(([key])=>key)].map(key =>
    [key, <CapturePage key="capture" tab={key} state={state} busy={busy} act={act} onNavigate={setTab} />]))

  const panel = { server: serverViews, client: clientViews, capture: captureViews }[ROLE][tab]
  const activeTab = ROLE==='capture' && hasRecordView(tab) ? 'records' : tab
  return <div className={"desktop role-" + ROLE} style={{ '--ambient-art': `url("${roleArt[ROLE].blur}")` }}>
    <aside>
      <div className="brand"><div className="brand-icon"><img src={portraits[{server:4,client:0,capture:2}[ROLE]]} alt="" /></div><div><b>{settings.name}</b><span>{{server:'服务与数据',client:'游戏连接',capture:'账号备份'}[ROLE]}</span></div></div>
      {ROLE === 'client' && <div className="game-library-label">游戏库<span>01</span></div>}
      <nav aria-label="工具选项">{settings.tabs.map(([key, label, Icon]) =>
        <button type="button" key={key} onClick={() => setTab(key)} aria-current={activeTab === key ? 'page' : undefined}>
          <Icon size={18} /><span>{label}</span>{activeTab === key && <ArrowRight className="nav-arrow" size={14} />}</button>)}</nav>
      <div className="sidebar-memory"><img src={roleArt[ROLE].thumb} alt="" /><div><small>每一次相遇，都值得珍藏</small><strong>{roleArt[ROLE].title}</strong><span>OPEN SPACE · MEMORIES</span></div></div>
      <div className="app-credit"><span>版本 {state.version || '0.5.2'}</span><button type="button" onClick={() => setToast({ message: '感谢原作者、水音及社区贡献者的支持。详细版权与许可随程序附带。' })}>致谢</button></div>
    </aside>
    <main>
      <header><div className="breadcrumb"><span>{settings.name}</span><ChevronRight size={13} /><strong>{settings.tabs.find(([key]) => key === activeTab)?.[1]}</strong></div>
        <div className={'status ' + (on ? 'on' : '')}><span />{status}</div></header>
      <div className="content">
        {(state.configError || state.serviceError) && <div className="notice error" role="alert">{state.configError || state.serviceError}</div>}
        {panel}
      </div>
      {toast && <div className={'notice toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}>
        {!toast.error && <CircleCheck size={19} />}{toast.message}<button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={16} /></button></div>}
    </main>
  </div>
}

function Equipment({ audit }) {
  return <div className="audit">
    {Object.entries(audit.equipment).map(([kind, item]) => <div className="audit-row" key={kind}>
      <div><strong>{kind === 'weapon' ? '武器' : '护甲'}</strong><p>列表 {item.snapshot} 件 · 全部来源 {item.observed} 件</p></div>
      <div className={'audit-count ' + (item.matches ? 'on' : '')}>
        {item.matches ? '数量吻合' : item.reported.length ? '待核对' : '缺列表'}
        <span>报送 {item.reported.length ? item.reported.join(' / ') : '—'}</span>
      </div>
    </div>)}
    <p className="audit-note">穿戴响应 {audit.sources.equipped} 条 · 背包推送 {audit.sources.pack} 条
      {audit.decode_errors > 0 && ' · 解码异常 ' + audit.decode_errors + ' 条'}</p>
    {audit.accounts > 1 && <Empty>文件包含多个账号，请按账号分别采集。</Empty>}
  </div>
}

function Migration({ result, errors, input }) {
  if (!result.found) return <p className="migration-identity">该数据库里没有 UID {result.uid} 的存档。</p>
  return <div className="audit">
    <p className="migration-identity">UID {result.uid} · {input.split(/[\\/]/).at(-1)}{errors > 0 && ' · 解码异常 ' + errors + ' 条'}</p>
    {Object.entries(result.equipment).map(([kind, row]) => <div className="audit-row" key={kind}>
      <div><strong>{kind === 'weapon' ? '武器' : '护甲'}</strong><p>采集包 {row.captured} 件 · 存档 {row.saved} 件</p></div>
      <div className={'audit-count ' + (row.captured && !row.missing ? 'on' : '')}>
        {row.captured ? (row.missing ? '未入库 ' + row.missing + ' 件' : '所采集均已入库') : '采集包未见此类装备'}
      </div>
    </div>)}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
