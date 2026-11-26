import { createHash, randomUUID, verify } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/
export function newer(candidate, current) {
  if (![candidate, current].every(v => typeof v === 'string' && VERSION.test(v))) return false
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
export function releaseURL(value, repository) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith('/' + repository + '/releases/download/')) throw new Error('更新下载地址无效')
  return url.href
}
export function signedRelease(envelope, trust, currentVersion) {
  if (typeof envelope?.payload !== 'string' || envelope.payload.length > 32768 || typeof envelope.signature !== 'string' ||
      !verify(null, Buffer.from(envelope.payload, 'base64'), trust.public_key, Buffer.from(envelope.signature, 'base64')))
    throw new Error('更新签名验证失败')
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))
  if (payload.schema !== 1 || payload.role !== 'capture' || payload.repository !== trust.repository || typeof payload.version !== 'string' || !VERSION.test(payload.version) ||
      typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sha256) || typeof payload.url !== 'string' || !Number.isSafeInteger(payload.bytes) || payload.bytes < 1 || payload.bytes > 512 * 1024 * 1024)
    throw new Error('更新信息格式无效')
  releaseURL(payload.url, trust.repository)
  return { ...payload, newer: newer(payload.version, currentVersion) }
}

async function request(url, limit, receive, fetcher = fetch, signal) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 600000)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const current = new URL(url)
      if (current.protocol !== 'https:' || current.username || current.password || current.port ||
          !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(current.hostname))
        throw new Error('更新重定向地址无效')
      const response = await fetcher(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'archive-desk' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        url = new URL(response.headers.get('location'), current).href
        continue
      }
      if (response.status === 404) { await response.body?.cancel(); return false }
      if (!response.ok || Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); throw new Error('更新服务器暂时不可用') }
      let total = 0
      for await (const chunk of response.body) {
        total += chunk.length
        if (total > limit) { controller.abort(); throw new Error('更新下载超过大小上限') }
        await receive(chunk, total)
      }
      return true
    }
    throw new Error('更新重定向次数过多')
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

export class CaptureUpdater {
  constructor(context, { idle = () => true, fetcher } = {}) {
    this.ctx = context; this.idle = idle; this.fetcher = fetcher
    this.state = { phase: 'idle', repository: 'https://github.com/coolminerchan/archive-desk' }
  }
  get root() { return join(this.ctx.userData, 'updates') }
  async config() {
    const trust = JSON.parse(await readFile(join(this.ctx.here, 'capture-update.json'), 'utf8'))
    if (!/^[\w.-]+\/[\w.-]+$/.test(trust.repository)) throw new Error('更新仓库配置无效')
    const version = JSON.parse(await readFile(join(this.ctx.here, 'product.json'), 'utf8')).version
    return { trust, version }
  }
  set(fields) { Object.assign(this.state, fields); this.ctx.send?.() }
  cancel() { this.abort?.abort() }
  async guarded(action) {
    if (!this.idle() || this.running) throw new Error('请先结束采集或核对，再操作更新')
    this.running = true; this.abort = new AbortController()
    try { return await action() } catch (error) {
      this.set({ phase: 'failed', error: '更新未能完成，当前版本和备份均已保留。请稍后重试。' })
      throw error
    } finally { this.running = false; this.abort = null }
  }
  async check() { return this.guarded(async () => {
    this.set({ phase: 'checking', error: '' })
    const { trust, version } = await this.config(), chunks = []
    const feed = `https://github.com/${trust.repository}/releases/latest/download/capture-update.json`
    const found = await request(feed, 65536, async chunk => chunks.push(chunk), this.fetcher, this.abort.signal)
    if (!found) { this.release = null; this.set({ phase: 'unavailable', hint: '尚无可公开下载的版本。' }); return false }
    this.release = signedRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), trust, version)
    this.set({ phase: this.release.newer ? 'available' : 'current', version, availableVersion: this.release.version,
      hint: this.release.newer ? '发现新版本，下载后会验证签名、文件校验值和包内容。' : '当前已是最新版本。' })
    return true
  }) }
  async prepare() { return this.guarded(async () => {
    if (!this.release?.newer) throw new Error('请先检查可用的新版本')
    const release = this.release
    await mkdir(this.root, { recursive: true })
    const file = join(this.root, `capture-${release.version}-${randomUUID()}.zip`), pending = file + '.part'
    this.set({ phase: 'downloading', progress: 0, error: '' })
    let handle
    try {
      handle = await open(pending, 'wx')
      const hash = createHash('sha256')
      const found = await request(release.url, release.bytes, async (chunk, bytes) => {
        await handle.writeFile(chunk); hash.update(chunk)
        const progress = Math.floor(bytes / release.bytes * 100)
        if (progress !== this.state.progress) this.set({ progress })
      }, this.fetcher, this.abort.signal)
      if (!found || (await handle.stat()).size !== release.bytes || hash.digest('hex') !== release.sha256) throw new Error('更新文件校验失败')
      await handle.sync(); await handle.close(); handle = null
      await rename(pending, file)
      this.set({ phase: 'verifying' })
      const target = join(this.root, `version-${release.version}-${randomUUID()}`)
      const args = ['-B', '-X', 'utf8', join(this.ctx.here, 'capture_update_package.py'), '--input', file,
        '--output', target, '--version', release.version, '--sha256', release.sha256]
      const installed = JSON.parse(await this.ctx.command(this.ctx.python(), args, { persistent: true }).done)
      if (!installed.executable || installed.version !== release.version || installed.path !== target) throw new Error('更新包安装验证失败')
      this.installed = installed
      this.set({ phase: 'ready', hint: '新版本已验证。启动后请从新版目录运行；旧目录可保留用于回退。' })
      await writeFile(join(this.root, 'prepared.json'), JSON.stringify({ version: release.version, path: target, sha256: release.sha256 }))
      return true
    } finally {
      await handle?.close().catch(() => {})
      await unlink(pending).catch(() => {})
      await unlink(file).catch(() => {})
    }
  }) }
  async launch() { return this.guarded(async () => {
    if (this.state.phase !== 'ready' || !this.installed || !this.ctx.quit) throw new Error('请先下载并验证新版本')
    const helper = join(this.root, `launch-${randomUUID()}.mjs`)
    await copyFile(join(this.ctx.here, 'capture-update-apply.mjs'), helper)
    await stat(this.installed.executable)
    const child = spawn(process.execPath, [helper, String(process.pid), String(process.ppid), this.installed.executable, this.root],
      { detached: true, stdio: 'ignore', windowsHide: true })
    await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail) })
    child.unref()
    this.set({ phase: 'restarting', hint: '正在关闭当前窗口并启动新版本…' })
    setTimeout(() => this.ctx.quit(), 100)
    return true
  }) }
}
