import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rename, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, basename, extname, resolve } from 'node:path'
import { isIP } from 'node:net'
import { chooseOfficialGame, findOfficialGames, gameInfo } from './capture-launcher.mjs'
import { captureError } from './capture-errors.mjs'
import { CaptureUpdater } from './capture-update.mjs'

export const DEFAULT_PORTS = [11001, 11002, 11003, 11004, 21001, 21002]
function purposeKeys(purpose) {
  if (!['account', 'gardens', 'scenes'].includes(purpose)) throw new Error('采集模块无效')
  const prefix = purpose === 'gardens' ? 'captureGarden' : purpose === 'scenes' ? 'captureScene' : 'capture'
  return { session: prefix + 'Session', report: prefix + 'Report', input: prefix + 'Input', saved: prefix + 'SavedZip', limit: prefix + 'Limit', delivery: prefix + 'Delivery' }
}
const TIMING_KEYS = ['preparation_ms', 'recording_ms', 'conversion_ms', 'first_response_observed_ms',
  'prepare_capture_ms', 'reassembly_decode_export_ms', 'response_audit_ms', 'archive_ms', 'analysis_total_ms']
const safeNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const safeTimings = value => Object.fromEntries(TIMING_KEYS.map(key => [key, safeNumber(value?.[key])]))
export function captureDiagnostics(report, { version, backend } = {}) {
  // An explicit allowlist prevents paths, UID, nickname, error bodies, filters,
  // addresses, tickets and raw protocol content from entering diagnostics.
  const qualityKeys = ['tcp_gap_directions', 'tail_directions', 'incomplete_directions',
    'decode_failures', 'unknown_protocol_packets', 'rejected_responses']
  const states = ['collected', 'empty', 'partial', 'missing', 'waiting', 'unknown']
  return { schema_version: 1, version: /^\d+\.\d+\.\d+$/.test(version || '') ? version : null,
    backend: ['compact-etw', 'buffered'].includes(backend) ? backend : null,
    integrity_known: report?.quality?.integrity_known === true,
    quality: Object.fromEntries(qualityKeys.map(key => [key, safeNumber(report?.quality?.[key])])),
    timings_ms: safeTimings({ ...report?.session_timings, ...report?.timings }),
    category_counts: Object.fromEntries(states.map(state => [state, (report?.items || []).filter(item => item.state === state).length])),
    equipment: Object.fromEntries(['weapon', 'armor', 'poster'].map(kind => {
      const row = report?.equipment?.[kind]
      return [kind, { list: safeNumber(row?.snapshot), observed: safeNumber(row?.observed),
        outside_list: safeNumber(row?.other_only), quantity_matches: row?.quantity_matches === true }]
    })),
    dungeons: { observed: safeNumber(report?.dungeons?.observed_count), detailed: safeNumber(report?.dungeons?.detailed_count) },
    first_response_timing_scope: 'first_readable_live_snapshot_including_flush_and_poll_delay',
    quality_counting_unit: 'unique_tcp_stream_direction_per_cause' }
}
async function steamShortcut(path) {
  if ((await stat(path)).size > 65536) throw new Error('Steam 快捷方式过大')
  const raw = await readFile(path)
  const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.subarray(2).toString('utf16le') : raw.toString('utf8').replace(/^\uFEFF/, '')
  const match = /^\s*URL\s*=\s*(steam:\/\/rungameid\/(\d{1,15})\/?)\s*$/mi.exec(text)
  if (!match) throw new Error('请选择 Steam 游戏快捷方式')
  return { url: match[1], id: match[2] }
}
async function steamInstalls(roots, id) {
  const libraries = new Set(roots || [])
  for (const root of roots || []) {
    try {
      const vdf = await readFile(join(root, 'steamapps/libraryfolders.vdf'), 'utf8')
      for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) libraries.add(match[1].replaceAll('\\\\', '\\'))
    } catch {}
  }
  const installs = []
  for (const library of libraries) {
    try {
      const manifest = await readFile(join(library, 'steamapps', `appmanifest_${id}.acf`), 'utf8')
      const leaf = /"installdir"\s*"([^"]+)"/i.exec(manifest)?.[1]
      const common = resolve(library, 'steamapps/common')
      if (leaf && dirname(resolve(common, leaf)) === common) installs.push(join(common, leaf, 'launcher.exe'))
    } catch {}
  }
  return installs
}
export function captureFilters({ peer = '', port = '', channel = 'auto' }) {
  if (!['auto', 'cn-pc', 'steam', 'emulator', 'manual'].includes(channel)) throw new Error('渠道选项无效')
  const ips = [...new Set(peer.split(/[,，\s]+/).filter(Boolean))]
  const ports = [...new Set(String(port).split(/[,，\s]+/).filter(Boolean).map(Number))]
  if (ips.some(ip => !isIP(ip) || ip.includes('%')) || ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535))
    throw new Error('请填写数字 IP 和 1–65535 端口，可用逗号分隔。留空端口可采集指定 IP 的动态端口。')
  if (!ips.length && !ports.length) {
    if (['steam', 'manual', 'emulator'].includes(channel)) throw new Error('此渠道请先识别游戏连接，或填写服务器 IP 与端口')
    ports.push(...DEFAULT_PORTS)
  }
  const filters = ips.length ? ips.flatMap(ip => ports.length ? ports.map(port => ({ ip, port })) : [{ ip }]) : ports.map(port => ({ port }))
  if (filters.length > 32) throw new Error('筛选范围超过 32 项，请缩小到本次游戏连接')
  return filters
}

export class CaptureController {
  constructor(context) {
    this.ctx = context; this.current = null; this.report = null; this.preflight = null; this.discovery = null; this.error = ''; this.flow = null
    this.updater = new CaptureUpdater({ ...context, python: () => this.python }, { idle: () => !this.current && !this.analysisTask && !this.ctx.closing?.() })
  }
  updateFlow(phase, hint, extra = {}) { this.flow = { ...this.flow, ...extra, phase, hint }; this.ctx.send() }
  get toolkit() {
    const chosen = this.ctx.settings().toolkit
    return chosen && ['proto_gen/net_pb2.py', 'tools/python/python.exe', 'tools/tshark/tshark.exe']
      .every(file => existsSync(join(chosen, file))) ? chosen : this.ctx.toolkit
  }
  get python() { return join(this.toolkit, 'tools', 'python', 'python.exe') }
  async read(path, limit = 8 * 1024 * 1024) {
    if ((await stat(path)).size > limit) throw new Error('采集报告超过界面读取上限')
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  }
  ps(mode, args = [], options) {
    return this.ctx.command(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.ctx.here, 'capture-session.ps1'), '-Mode', mode, ...args], options)
  }
  async failure(error, action) {
    if (error?.captureFriendly) return error
    const described = captureError(error)
    if (this.ctx.userData) {
      try {
        await mkdir(this.ctx.userData, { recursive: true })
        await appendFile(join(this.ctx.userData, 'capture-errors.log'), JSON.stringify({
          at: new Date().toISOString(), action, code: described.code, detail: described.detail.slice(0, 8192)
        }) + '\n')
      } catch { /* Logging never replaces the original error. */ }
    }
    return Object.assign(new Error(described.message), { captureFriendly: true, code: described.code })
  }
  async inspect({ output = this.ctx.defaultCaptureOutput } = {}) {
    const checks = (await Promise.all([
      ['system', '系统权限与采集组件', async () => {
        const info = JSON.parse(await this.ps('Inspect').done)
        return { ok: info.admin && info.idle && info.filtersEmpty,
          detail: !info.admin ? '需要以管理员身份启动实时采集' : !info.idle || !info.filtersEmpty ? '其他会话或筛选器占用中' : '管理员权限，抓包环境空闲' }
      }],
      ['package', '程序与解析组件', async () => {
        const script = join(this.ctx.here, 'capture_preflight.py')
        if (!existsSync(script)) return { ok: false, detail: '程序文件不完整，请重新完整解压' }
        const args = ['-B', '-X', 'utf8', script, '--app', this.ctx.here, '--toolkit', this.toolkit]
        if (output) args.push('--output', output)
        return JSON.parse(await this.ctx.command(this.python, args).done).checks
      }],
      ['tshark', '流量分析组件', async () => {
        const text = await this.ctx.command(join(this.toolkit, 'tools/tshark/tshark.exe'), ['--version']).done
        return { ok: true, detail: '流量分析已就绪' }
      }]
    ].map(async ([id, label, run]) => {
      try { const result = await run(); return Array.isArray(result) ? result : [{ id, label, ...result }] }
      catch (err) { return [{ id, label, ok: false, detail: captureError(err).message }] }
    }))).flat()
    return this.preflight = { checks, ok: checks.every(check => check.ok), updated: new Date().toISOString() }
  }
  async discover() {
    const data = JSON.parse(await this.ps('Discover').done)
    const paths = [...new Set([this.ctx.settings().officialLauncher, ...(data.processes || []).map(p => p.path)].filter(Boolean))]
    const shortcut = this.ctx.settings().officialLauncher
    if (shortcut && extname(shortcut).toLowerCase() === '.url') {
      const { id } = await steamShortcut(shortcut)
      paths.push(...await steamInstalls(data.steamRoots, id))
    }
    const addresses = []
    for (const path of paths) {
      try {
        const config = await readFile(join(dirname(path), 'launcher_Data/StreamingAssets/Config.txt'), 'utf8')
        for (const match of config.matchAll(/^\s*RemoteServerIP\s*=\s*([^\s#;]+)/gm))
          if (isIP(match[1])) addresses.push(match[1])
      } catch {}
    }
    const peers = [...new Set([...addresses, ...(data.connections || []).map(c => c.ip)])]
    const games = await findOfficialGames(data, shortcut, path => this.validateOfficial(path))
    return this.discovery = { ...data, games, peers, updated: new Date().toISOString(),
      hint: peers.length ? '已从客户端配置或进程连接找到候选地址，请核对后开始。' : '尚未发现候选地址。PC 通道可先按常用端口开始采集，再启动游戏。模拟器需打开游戏后重试。' }
  }
  async analyze(input, { purpose = this.current?.purpose || 'account' } = {}) {
    if (this.analysisTask) throw new Error('正在核对数据，请等待结束')
    const keys = purposeKeys(purpose)
    const session = this.current?.folder || await mkdtemp(join(await this.ensureRoot(), 'analysis-'))
    const output = join(session, 'export-' + Date.now())
    const args = ['-B', '-X', 'utf8', join(this.ctx.here, 'capture_report.py'),
      'analyze', '--toolkit', this.toolkit, '--input', input, '--output', output, '--purpose', purpose]
    if (this.current) {
      try {
        const progress = await this.read(join(session, 'live-progress/progress.json'))
        this.current.timings.first_response_observed_ms = progress.first_response_observed_ms
      } catch {}
      const timingFile = join(session, 'stage-timings.json')
      await writeFile(timingFile, JSON.stringify({ ...safeTimings(this.current.timings), capture_backend: this.current.backend }))
      args.push('--session-timings', timingFile)
    }
    const process = this.ctx.command(this.python, args, { persistent: true })
    const task = { stop() {} }
    this.analysisTask = task
    task.done = (async () => {
      await process.done
      const report = await this.read(join(output, 'capture-report.json'))
      if (purpose === 'gardens') this.gardenReport = report
      else if (purpose === 'scenes') this.sceneReport = report
      else this.report = report
      await this.ctx.remember({ [keys.report]: join(output, 'capture-report.json'), [keys.input]: input, [keys.delivery]: null })
      return report
    })().finally(() => { this.analysisTask = null })
    return task.done
  }
  async ensureRoot() {
    const root = join(this.ctx.userData, 'sessions')
    await mkdir(root, { recursive: true })
    return root
  }
  async persist(task, fields) {
    Object.assign(task, fields)
    const metadata = { folder: task.folder, phase: task.phase, channel: task.channel, filters: task.filters,
      started: task.started, error: task.error || '', limit: !!task.limit, automatic: !!task.automatic, backend: task.backend,
      timings: task.timings, purpose: task.purpose }
    await writeFile(join(task.folder, 'session.json.tmp'), JSON.stringify(metadata))
    await rename(join(task.folder, 'session.json.tmp'), join(task.folder, 'session.json'))
  }
  async oneClick({ purpose = 'account' } = {}) {
    if (!['account', 'gardens'].includes(purpose)) throw new Error('请选择账号或装修采集')
    purposeKeys(purpose)
    if (this.current || this.analysisTask) throw new Error('已有采集或核对任务')
    this.error = ''
    const preparationStarted = Date.now()
    try {
      await this.ctx.remember?.({ captureResumePurpose: purpose })
      this.updateFlow('checking', '正在检查权限和采集环境…', { purpose })
      const system = JSON.parse(await this.ps('Inspect').done)
      if (!system.admin) {
        if (!this.ctx.shell.elevateCapture) throw new Error('请以管理员身份打开采集工具，再点击一键采集')
        this.updateFlow('permission', '请在系统弹窗中允许采集权限，随后会自动继续。')
        await this.ctx.shell.elevateCapture()
        return false
      }
      if (!system.idle || !system.filtersEmpty) throw new Error('系统采集组件正被其他会话或筛选器占用，请在所属工具中结束后再试。')
      if (this.ctx.closing?.()) return false
      this.updateFlow('finding', '正在识别已安装的游戏和渠道…')
      const saved = this.ctx.settings().officialLauncher
      let game, discovery
      if (saved && extname(saved).toLowerCase() === '.exe') {
        try {
          await this.validateOfficial(saved)
          game = await gameInfo(saved)
          if (game) {
            if (this.ctx.settings().officialSteamId) Object.assign(game, { channel: 'steam', steamId: this.ctx.settings().officialSteamId })
            const observed = JSON.parse(await this.ps('Observe').done)
            discovery = { ...observed, connections: [], games: [game], steamRoots: [] }
          }
        } catch { game = undefined }
      }
      if (!game) { discovery = await this.discover(); game = chooseOfficialGame(discovery.games) }
      if (saved && extname(saved).toLowerCase() === '.url') {
        try {
          await this.validateOfficial(saved)
          const shortcut = await steamShortcut(saved)
          const installs = await steamInstalls(discovery.steamRoots, shortcut.id)
          const infos = (await Promise.all(installs.map(gameInfo))).filter(Boolean)
          game = { path: saved, steamId: shortcut.id, channel: 'steam', peers: infos.flatMap(i => i.peers), gamePaths: installs }
        } catch {}
      }
      if (!game) {
        this.updateFlow('finding', discovery.games.length > 1 ? '发现多套客户端，请选择本次要采集的官服程序。下次会记住。' : '首次未找到游戏，请选择官服程序或 Steam 游戏快捷方式。下次会记住。')
        const path = await this.ctx.pick('officialLauncher', ['官服程序或 Steam 快捷方式', 'exe', 'url'])
        if (!path) { this.updateFlow('idle', '已取消选择，可以随时重新开始。'); return false }
        await this.validateOfficial(path)
        await this.ctx.remember({ officialLauncher: path, officialSteamId: '' })
        if (extname(path).toLowerCase() === '.url') {
          const shortcut = await steamShortcut(path), installs = await steamInstalls(discovery.steamRoots, shortcut.id)
          const infos = (await Promise.all(installs.map(gameInfo))).filter(Boolean)
          game = { path, steamId: shortcut.id, channel: 'steam', peers: infos.flatMap(i => i.peers), gamePaths: installs }
        } else {
          game = await gameInfo(path)
          if (!game) throw new Error('未找到该游戏的服务器配置，请选择游戏目录中的 launcher.exe；模拟器可使用高级采集。')
        }
      }
      if (this.ctx.closing?.()) return false
      const gamePaths = game.gamePaths || [game.path]
      const running = (discovery.processes || []).find(p => gamePaths.some(path => resolve(path).toLowerCase() === resolve(p.path).toLowerCase()))
      if (running) { game.running = true; game.pid = running.pid }
      const livePeers = (discovery.connections || []).filter(c => c.pid === game.pid).map(c => c.ip)
      const peers = [...new Set([...game.peers, ...livePeers])].slice(0, 26)
      if (game.channel === 'steam' && !peers.length) throw new Error('未找到 Steam 游戏服务器地址。请先启动游戏，再点一键采集；或使用高级采集识别连接。')
      await this.ctx.remember({ officialLauncher: game.path, officialSteamId: game.steamId || '' })
      this.updateFlow('starting', '正在准备采集，准备好后自动打开游戏…', { channel: game.channel, launcher: game.path })
      return await this.start({ consent: true, automatic: true, launch: !game.running, channel: game.channel,
        peer: peers.join(', '), port: '', gamePaths, running: game.running, preparationStarted, purpose })
    } catch (err) {
      const friendly = await this.failure(err, 'one-click')
      this.error = friendly.message
      this.updateFlow('failed', friendly.message)
      throw friendly
    }
  }
  watchGame(task, paths) {
    const expected = new Set(paths.map(p => resolve(p).toLowerCase()))
    let seen = !!task.gameSeen, missing = 0, checking = false
    task.gameTimer = setInterval(async () => {
      if (checking || this.current !== task || task.phase !== 'recording') return
      checking = true
      try {
        const data = JSON.parse(await this.ps('Observe').done)
        if (this.current !== task || task.phase !== 'recording') return
        seen ||= !!task.gameSeen
        const running = data.processes.some(p => expected.has(resolve(p.path).toLowerCase()))
        if (running) { seen = true; missing = 0 }
        else if (seen) {
          missing ||= Date.now()
          if (Date.now() - missing >= 10000) {
            this.updateFlow('saving', '游戏已退出，正在整理数据和生成备份…')
            task.stop()
          }
        }
      } catch { /* A failed observation never counts as a game exit. */ }
      finally { checking = false }
    }, 4000)
    task.gameTimer.unref?.()
  }
  async start(options) {
    const purpose = options.purpose || 'account', keys = purposeKeys(purpose)
    if (!['account', 'gardens'].includes(purpose)) throw new Error('请选择账号或装修采集')
    const preparationStarted = options.preparationStarted || Date.now()
    if (!options.consent) throw new Error('请确认采集自己的授权连接')
    if (this.current || this.analysisTask) throw new Error('已有采集或核对任务')
    if (!options.automatic) this.flow = null
    const filters = captureFilters(options)
    // Automatic capture covers configured servers on every TCP port and the PC
    // protocol's known ports, so login is captured before the game is opened.
    if (options.automatic && options.peer) filters.push(...DEFAULT_PORTS.map(port => ({ port })))
    if (this.ctx.closing?.()) return false
    const parent = options.automatic ? purpose === 'gardens' ? this.gardenOutput : this.ctx.defaultCaptureOutput : await this.ctx.pick('captureOutput', null, true)
    if (!parent) return false
    if (!(await this.inspect({ output: parent })).ok) throw new Error('预检查未通过，请在工具设置中查看具体原因')
    await mkdir(parent, { recursive: true })
    const folder = await mkdtemp(join(parent, purpose === 'gardens' ? 'OF-gardens-' : 'OF-capture-'))
    const config = join(folder, 'filters.json')
    await writeFile(config, JSON.stringify({ filters }))
    await this.ctx.remember({ [keys.session]: folder, [keys.report]: '', [keys.input]: join(folder, 'capture.pcapng'), [keys.limit]: false, [keys.saved]: '',
      captureOptions: { channel: options.channel, peer: options.peer, port: options.port } })
    if (purpose === 'gardens') this.gardenReport = null
    else this.report = null
    this.error = ''
    const task = { folder, filters, channel: options.channel, automatic: !!options.automatic, gameSeen: !!options.running,
      phase: 'starting', started: Date.now(), timings: {}, outputTail: '', purpose }
    await this.persist(task, {})
    this.current = task
    let ready
    const readiness = new Promise(resolve => { ready = resolve })
    const child = this.ps('Capture', ['-Directory', folder, '-FilterPath', config], {
      persistent: true, onOutput: text => {
        text = (task.outputTail + text).slice(-4096)
        task.outputTail = text.slice(-128)
        if (text.includes('CAPTURE_BACKEND_COMPACT')) task.backend = 'compact-etw'
        else if (text.includes('CAPTURE_BACKEND_BUFFERED')) task.backend = 'buffered'
        if (text.includes('CAPTURE_STORAGE_shared-buffer')) task.storage = 'shared-buffer'
        else if (text.includes('CAPTURE_STORAGE_per-cpu-buffer')) task.storage = 'per-cpu-buffer'
        if (text.includes('CAPTURE_LIMIT')) task.limit = true
        const converted = [...text.matchAll(/CAPTURE_CONVERT_PART (\d+)\/(\d+)/g)].at(-1)
        if (converted && task.automatic) this.updateFlow('saving', `正在整理网络记录 ${converted[1]} / ${converted[2]}，${purpose === 'gardens' ? '随后整理家园装修' : '随后核对装备和地图'}…`)
        if (text.includes('CAPTURE_CONVERTING')) {
          task.phase = 'saving'
          task.conversionStarted ||= Date.now()
          if (task.recordingStarted) task.timings.recording_ms = task.conversionStarted - task.recordingStarted
        }
        else if (text.includes('CAPTURE_STARTED') && task.phase === 'starting') {
          task.recordingStarted = Date.now()
          task.timings.preparation_ms = task.recordingStarted - preparationStarted
          task.phase = 'recording'
          task.watcher = this.ctx.command(this.python, ['-B', '-X', 'utf8', join(this.ctx.here, 'capture_report.py'),
            'watch', '--toolkit', this.toolkit, '--output', task.folder], { persistent: true })
          task.watcher.done.catch(err => { task.liveError = err.message })
          ready(true)
          if (task.automatic) {
            this.updateFlow('recording', purpose === 'gardens' ? '装修采集已就绪。进入想保存的家园，等待家具加载后可继续拜访下一家。退出游戏会自动保存。' : options.running ? '游戏已在运行，请返回登录界面重新登录，再按下方提示浏览。退出游戏会自动保存。' : '采集已就绪，正在打开游戏。进入后按下方提示浏览，退出游戏会自动保存。', { purpose })
            this.watchGame(task, options.gamePaths)
          }
          if (options.launch && this.ctx.settings().officialLauncher)
            this.launchOfficial(task).catch(async err => { this.error = '采集已就绪，游戏启动失败，请手动打开游戏。' + (await this.failure(err, 'launch-client')).message; this.ctx.send() })
        }
        this.ctx.send()
      }
    })
    task.stop = () => {
      if (['starting', 'recording'].includes(task.phase)) task.phase = 'saving'
      writeFile(join(folder, 'stop.flag'), '').catch(() => {})
      writeFile(join(folder, 'live-progress-stop.flag'), '').catch(() => {})
      child.stop()
      if (task.automatic) this.updateFlow('saving', purpose === 'gardens' ? '正在保存原始记录与家园装修，请稍候…' : '正在保存原始数据、核对装备和地图信息，请稍候…')
    }
    task.done = child.done.then(async () => {
      if (task.conversionStarted) task.timings.conversion_ms = Date.now() - task.conversionStarted
      await writeFile(join(folder, 'live-progress-stop.flag'), '')
      task.phase = 'analyzing'; this.ctx.send()
      if (task.automatic) this.updateFlow('saving', purpose === 'gardens' ? '网络记录已保存，正在整理家园、家具与屋主信息…' : '网络记录已保存，正在核对账号、装备和地图…')
      const result = await this.analyze(join(folder, 'capture.pcapng'), { purpose })
      await this.ctx.remember({ [keys.limit]: !!task.limit })
      if (task.automatic) {
        if (purpose === 'gardens') {
          const report = result || this.gardenReport
          if (report?.gardens_bundle && report.gardens?.length) {
            const saved = join(parent, `装修合集_${basename(folder)}.zip`)
            await this.deliver(report.gardens_bundle, saved, 'gardens')
            await this.ctx.remember({ [keys.saved]: saved })
            this.updateFlow('complete', `已自动保存 ${report.gardens.length} 个家园的装修合集。每家也可以单独导出。`)
          } else this.updateFlow('complete', '原始记录已保存，尚未采到可识别的家园装修，未生成装修合集。请进入家园并等待家具加载后重新采集。')
        } else if (this.report?.account_zip) {
          const account = this.report.accounts_detail[0]
          const publicUid = Number(account.player_label || account.uid)
          const identity = Number.isSafeInteger(publicUid) && publicUid > 0 ? publicUid : `内部ID_${account.player_id}`
          const saved = join(parent, `账号_${identity}_${basename(folder)}.zip`)
          await this.deliver(this.report.account_zip, saved, 'account', this.report.identity || account)
          await this.ctx.remember({ captureSavedZip: saved })
          this.updateFlow('complete', '备份已自动保存。请查看下方清单，仍缺的项目可以下次补采。')
        } else this.updateFlow('complete', '原始记录已保存，尚未识别到唯一账号，未生成账号 ZIP。请查看下方提示后重新采集。')
      }
      await this.persist(task, { phase: 'complete' })
    }).catch(async err => {
      const friendly = await this.failure(err, 'finalize')
      this.error = friendly.message
      if (task.automatic) this.updateFlow('failed', '整理未完成，原始记录已保留。' + friendly.message)
      await this.persist(task, { phase: 'failed', error: friendly.message }).catch(() => {})
    }).finally(async () => {
      ready(false)
      clearInterval(task.gameTimer)
      await writeFile(join(folder, 'live-progress-stop.flag'), '').catch(() => {})
      if (task.watcher) {
        const timer = setTimeout(() => task.watcher.child.kill(), 25000)
        try { await task.watcher.done.catch(() => {}) } finally { clearTimeout(timer) }
      }
      this.current = null; this.ctx.send()
    })
    const timer = setTimeout(() => { task.stop(); ready(false) }, 90000)
    try { if (!(await readiness)) throw new Error(this.error || '采集尚未就绪，已请求安全停止。请查看环境检查。') }
    finally { clearTimeout(timer) }
    return true
  }
  async stop() { const task = this.current; if (task) { task.stop(); this.ctx.send(); await task.done } }
  async deliver(source, destination, kind, identity) {
    const args = ['-B', '-X', 'utf8', join(this.ctx.here, 'capture_delivery.py'),
      '--input', source, '--output', destination, '--toolkit', this.toolkit, '--kind', kind]
    const id = identity?.player_id ?? identity?.owner_uid
    const uid = identity?.uid ?? identity?.player_label
    if (Number.isSafeInteger(id) && id > 0) args.push('--expected-id', String(id))
    if (Number.isSafeInteger(uid) && uid > 0) args.push('--expected-uid', String(uid))
    const result = JSON.parse(await this.ctx.command(this.python, args, { persistent: true }).done)
    const keys = purposeKeys(kind === 'garden' ? 'gardens' : kind)
    try {
      await this.ctx.remember?.({ [keys.delivery]: { sha256: result.sha256, bytes: result.bytes, checkedAt: new Date().toISOString() } })
    } catch (error) { await this.failure(error, 'remember-delivery') }
    return result
  }
  async saveZip(source, kind = 'account', identity) {
    if (!source) throw new Error('当前结果没有可导出的 ZIP')
    const selected = await this.ctx.dialog.showSaveDialog(this.ctx.window(), { defaultPath: basename(source), filters: [{ name: '备份 ZIP', extensions: ['zip'] }] })
    if (selected.canceled) return false
    await this.deliver(source, selected.filePath, kind, identity)
    return true
  }
  get gardenOutput() { return join(dirname(this.ctx.defaultCaptureOutput), '游戏家园备份') }
  async recover(purpose = 'account') {
    if (this.current || this.analysisTask) throw new Error('请先结束当前采集或核对')
    const keys = purposeKeys(purpose), folder = this.ctx.settings()[keys.session]
    if (!folder) return false
    this.error = ''
    const pcap = join(folder, 'capture.pcapng')
    try { await stat(pcap) } catch { await this.ps('Recover', ['-Directory', folder], { persistent: true }).done }
    return this.analyze(pcap, { purpose })
  }
  async launchOfficial(task) {
    const path = await this.validateOfficial(this.ctx.settings().officialLauncher)
    if (!path) return
    if (task && (this.current !== task || task.phase !== 'recording')) return
    const steamId = this.ctx.settings().officialSteamId
    if (extname(path).toLowerCase() === '.url' || steamId) {
      const url = extname(path).toLowerCase() === '.url' ? (await steamShortcut(path)).url : `steam://rungameid/${steamId}`
      if (task && (this.current !== task || task.phase !== 'recording')) return
      await this.ctx.shell.openExternal(url)
    } else {
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('LOLO_') && !k.toUpperCase().startsWith('OVERFIELD_SESSION_')))
      const child = spawn(path, [], { cwd: dirname(path), env, windowsHide: false, detached: true, stdio: 'ignore' })
      await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail) })
      if (task && this.current === task && task.phase === 'recording') task.gameSeen = true
      child.unref()
    }
  }
  async validateOfficial(path) {
    if (!path || !(await stat(path)).isFile()) throw new Error('官服程序不存在')
    if (/^(overfield-(capture|client|server)|overfieldlauncher|lolo)\.exe$/i.test(basename(path)))
      throw new Error('请选择原版官服程序')
    for (let folder = dirname(path);;) {
      try { await stat(join(folder, 'client-ready.json')); throw new Error('这是准备过的隔离副本，请选择原版官服') }
      catch (err) { if (err.code !== 'ENOENT') throw err }
      const parent = dirname(folder)
      if (parent === folder) break
      folder = parent
    }
    if (extname(path).toLowerCase() === '.url') {
      await steamShortcut(path)
    } else if (extname(path).toLowerCase() !== '.exe') throw new Error('请选择 EXE 或 Steam 游戏快捷方式')
    return path
  }
  async state() {
    if (!this.updateChecked && this.ctx.settings().captureUpdateCheckOnStart && !this.current && !this.analysisTask) {
      this.updateChecked = true
      void this.updater.check().catch(error => this.failure(error, 'update-check-on-start'))
    }
    if (!this.current && !this.report && this.ctx.settings().captureReport) {
      try { this.report = await this.read(this.ctx.settings().captureReport) } catch {}
    }
    if (!this.current && !this.gardenReport && this.ctx.settings().captureGardenReport) {
      try { this.gardenReport = await this.read(this.ctx.settings().captureGardenReport) } catch {}
    }
    if (!this.current && !this.sceneReport && this.ctx.settings().captureSceneReport) {
      try { this.sceneReport = await this.read(this.ctx.settings().captureSceneReport) } catch {}
    }
    let progress, bytes
    if (this.current) {
      try { progress = await this.read(join(this.current.folder, 'live-progress/progress.json')) } catch {}
      try {
        bytes = (await Promise.all((await readdir(this.current.folder)).filter(n => /^capture.*\.etl$/.test(n))
          .map(n => stat(join(this.current.folder, n)).then(s => s.size)))).reduce((a, b) => a + b, 0)
      } catch {}
    }
    return { recording: this.current?.phase, captureReport: this.report, captureProgress: progress,
      captureError: this.error, preflight: this.preflight, discovery: this.discovery,
      capture: this.ctx.settings().captureInput, captureSession: this.ctx.settings().captureSession,
      officialLauncher: this.ctx.settings().officialLauncher, captureOptions: this.ctx.settings().captureOptions,
      captureFlow: this.flow, captureSavedZip: this.ctx.settings().captureSavedZip,
      capturePurpose: this.current?.purpose, captureResumePurpose: this.ctx.settings().captureResumePurpose,
      captureGardenReport: this.gardenReport, captureGardenSession: this.ctx.settings().captureGardenSession,
      captureSceneReport: this.sceneReport,
      captureUpdate: this.updater.state, captureUpdateCheckOnStart: !!this.ctx.settings().captureUpdateCheckOnStart,
      captureDelivery: this.ctx.settings().captureDelivery, captureGardenDelivery: this.ctx.settings().captureGardenDelivery,
      captureGardenInput: this.ctx.settings().captureGardenInput, captureGardenSavedZip: this.ctx.settings().captureGardenSavedZip,
      captureBackend: this.current?.backend,
      captureStorage: this.current?.storage,
      captureTimings: { ...this.current?.timings, first_response_observed_ms: progress?.first_response_observed_ms },
      captureBytes: bytes, captureStarted: this.current?.started,
      captureLimit: this.current?.purpose === 'account' ? !!this.current.limit : !!this.ctx.settings().captureLimit,
      captureGardenLimit: this.current?.purpose === 'gardens' ? !!this.current.limit : !!this.ctx.settings().captureGardenLimit }
  }
  actions() {
    const handlers = {
      'capture-one-click': options => this.oneClick(options),
      'capture-gardens-one-click': () => this.oneClick({ purpose: 'gardens' }),
      'capture-gardens-open': async () => {
        if (this.current || this.analysisTask) throw new Error('请先结束当前采集或核对')
        const input = await this.ctx.pick('captureGardenInput', ['装修包或抓包', 'zip', 'pcap', 'pcapng'])
        if (!input) return false
        await this.ctx.remember({ captureGardenSavedZip: '' })
        this.updateFlow('analyzing', '正在整理家园装修…', { purpose: 'gardens' })
        try {
          const report = await this.analyze(input, { purpose: 'gardens' })
          this.updateFlow('complete', `已整理 ${report.gardens?.length || 0} 个家园。可逐家导出或保存装修合集。`)
          return report
        } catch (error) {
          const friendly = await this.failure(error, 'open-gardens')
          this.error = friendly.message; this.updateFlow('failed', '装修包未能解析，原文件已保留。' + friendly.message); throw friendly
        }
      },
      'capture-gardens-recover': () => this.recover('gardens'),
      'capture-gardens-export': ({ index }) => {
        if (!Number.isInteger(index) || index < 0) throw new Error('家园条目无效')
        const row = this.gardenReport?.gardens?.[index]
        return this.saveZip(row?.path, 'garden', row)
      },
      'capture-gardens-export-all': () => this.saveZip(this.gardenReport?.gardens_bundle, 'gardens'),
      'capture-scenes-open': async () => {
        if (this.current || this.analysisTask) throw new Error('请先结束当前采集或核对')
        const input = await this.ctx.pick('captureSceneInput', ['场景包、账号包或抓包', 'zip', 'pcap', 'pcapng'])
        if (!input) return false
        return this.analyze(input, { purpose: 'scenes' })
      },
      'capture-scenes-export': () => {
        const row = this.sceneReport?.own_scenes || this.report?.own_scenes
        return this.saveZip(row?.bundle, 'scenes', row?.identity)
      },
      'capture-open-logs': () => this.ctx.shell.openPath(this.ctx.userData),
      'capture-update-check': () => this.updater.check(),
      'capture-update-download': () => this.updater.prepare(),
      'capture-update-start': () => this.updater.launch(),
      'capture-update-folder': async () => { await mkdir(this.updater.root, { recursive: true }); return this.ctx.shell.openPath(this.updater.root) },
      'capture-update-auto': async ({ enabled }) => {
        if (typeof enabled !== 'boolean') throw new Error('更新设置无效')
        await this.ctx.remember({ captureUpdateCheckOnStart: enabled })
      },
      'capture-gardens-open-folder': async () => {
        const folder = this.ctx.settings().captureGardenSavedZip ? dirname(this.ctx.settings().captureGardenSavedZip) : this.gardenOutput
        await mkdir(folder, { recursive: true }); return this.ctx.shell.openPath(folder)
      },
      'capture-preflight': () => this.inspect(), 'capture-discover': () => this.discover(),
      'capture-start': options => this.start(options), 'capture-stop': () => this.stop(), 'capture-recover': () => this.recover(),
      'select-official-launcher': async () => {
        const path = await this.ctx.pick('officialLauncher', ['官服客户端或 Steam 快捷方式', 'exe', 'url'])
        if (path) await this.ctx.remember({ officialLauncher: await this.validateOfficial(path), officialSteamId: '' })
        return !!path
      },
      analyze: async ({ recent = false } = {}) => {
        if (this.current) throw new Error('请先结束采集，等待最终解析')
        const input = recent ? this.ctx.settings().captureInput : await this.ctx.pick('capture', ['账号备份或抓包', 'zip', 'pcap', 'pcapng'])
        if (!input) return false
        this.flow = null
        await this.ctx.remember({ captureSavedZip: '' })
        return this.analyze(input)
      },
      'open-capture-folder': () => this.ctx.shell.openPath(this.report?.export || this.ctx.settings().captureSession || this.ctx.userData),
      'open-backup-folder': async () => {
        const folder = this.ctx.settings().captureSavedZip ? dirname(this.ctx.settings().captureSavedZip) : this.ctx.defaultCaptureOutput
        await mkdir(folder, { recursive: true })
        return this.ctx.shell.openPath(folder)
      },
      'capture-export': async () => {
        const source = this.report?.account_zip
        if (!source) throw new Error('须识别到唯一账号才能导出账号 ZIP')
        return this.saveZip(source, 'account', this.report.identity || this.report.accounts_detail?.[0])
      },
      'capture-export-garden': ({ index }) => {
        if (!Number.isInteger(index) || index < 0) throw new Error('家园条目无效')
        const row = this.report?.gardens?.[index]
        return this.saveZip(row?.path, 'garden', row)
      },
      'capture-export-diagnostics': async () => {
        if (this.current || this.analysisTask) throw new Error('请等待采集和核对结束后导出诊断')
        if (!this.report) throw new Error('请先打开采集文件进行核对')
        const selected = await this.ctx.dialog.showSaveDialog(this.ctx.window(), {
          defaultPath: '采集诊断.json', filters: [{ name: '诊断 JSON', extensions: ['json'] }] })
        if (selected.canceled) return false
        await writeFile(selected.filePath, JSON.stringify(captureDiagnostics(this.report, {
          version: this.report.analysis_version, backend: this.report.capture_backend }), null, 2))
        return true
      },
    }
    return Object.fromEntries(Object.entries(handlers).map(([name, run]) => [name, async (...args) => {
      try { return await run(...args) }
      catch (err) { throw await this.failure(err, name) }
    }]))
  }
}
