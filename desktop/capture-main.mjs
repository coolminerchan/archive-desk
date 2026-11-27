import { app, BrowserWindow, dialog, ipcMain, shell } from './platform.mjs'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CaptureController } from './capture-controller.mjs'
import { cleanupHelpers, legacyOrigin, startApply } from './capture-update-install.mjs'

const here = dirname(fileURLToPath(import.meta.url)), windows = process.platform === 'win32'
const metadata = name => JSON.parse(readFileSync(join(here, name), 'utf8'))
const packaged = existsSync(join(here, 'product.json'))
const product = packaged ? metadata('product.json') : { role: 'capture', version: metadata('capture-version.json').version, name: '账号采集工具' }
if (product.role !== 'capture') throw new Error('请使用采集工具自己的启动入口')
const toolkit = packaged ? join(dirname(here), 'dependencies') : process.env.OVERFIELD_CAPTURE_TOOLKIT || join(dirname(dirname(here)), 'OverField-Backup')
const page = join(here, 'rendered/index.html'), activeCommands = new Set()
let mainWindow, settings = {}, busy = false, foreground, closing = false, readyToQuit = false
app.setName(product.name || '账号采集工具')
if (windows) app.setAppUserModelId('cn.overfield.capture')
app.setPath('userData', join(app.getPath('appData'), 'OverField Desktop/capture'))
const userData = app.getPath('userData'), stateFile = join(userData, 'settings.json')
let settingsQueue = Promise.resolve()
async function remember(fields) {
  settings = { ...settings, ...fields }
  const snapshot = JSON.stringify(settings, null, 2)
  const task = settingsQueue.catch(() => {}).then(async () => {
    await mkdir(userData, { recursive: true })
    await writeFile(stateFile + '.tmp', snapshot)
    await rename(stateFile + '.tmp', stateFile)
  })
  settingsQueue = task
  await task
}
async function exists(path) { try { await access(path); return true } catch { return false } }
function send() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:changed') }
function command(bin, args, { persistent = false, cwd, onOutput, timeoutMs = 90000 } = {}) {
  const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = '', timer
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdin.on('error', () => {})
  child.stdout.on('data', part => { out = (out + part).slice(-32768); onOutput?.(out) })
  child.stderr.on('data', part => { err = (err + part).slice(-8192) })
  const done = new Promise((ok, fail) => {
    child.once('error', error => { clearTimeout(timer); fail(error) })
    child.once('close', status => {
      clearTimeout(timer)
      if (status === 0) ok(out)
      else fail(new Error(err.trim().split(/\r?\n/).filter(Boolean).slice(-5).join('\n') || '程序退出，代码 ' + status))
    })
    if (!persistent) timer = setTimeout(() => { child.kill(); fail(new Error('操作超时')) }, timeoutMs)
  })
  const task = { child, done, stop: () => child.stdin.end() }
  activeCommands.add(task)
  done.then(() => activeCommands.delete(task), () => activeCommands.delete(task))
  return task
}
async function pick(property, filter, directory = false) {
  const selection = await dialog.showOpenDialog(mainWindow, { properties: [directory ? 'openDirectory' : 'openFile'],
    filters: filter ? [{ name: filter[0], extensions: filter.slice(1) }] : undefined, defaultPath: settings[property] })
  return selection.canceled ? '' : selection.filePaths[0]
}
const capture = new CaptureController({ here, toolkit, userData, settings: () => settings,
  remember, command, pick, send, shell, dialog, window: () => mainWindow,
  defaultCaptureOutput: join(app.getPath('documents'), '游戏账号备份'), closing: () => closing, quit: () => app.quit() })
async function profile() {
  return { role: 'capture', windows, version: product.version, toolkit: await exists(join(capture.toolkit, 'parse_pcap.py')),
    ...await capture.state() }
}
const actions = { ...capture.actions(),
  async 'select-toolkit'() {
    if (capture.current || capture.analysisTask) throw new Error('请先结束采集和核对')
    const path = await pick('toolkit', null, true)
    if (!path) return false
    if (!(await exists(join(path, 'proto_gen/net_pb2.py'))) || !(await exists(join(path, 'tools/python/python.exe'))) || !(await exists(join(path, 'tools/tshark/tshark.exe'))))
      throw new Error('请选择完整的解析组件目录')
    await remember({ toolkit: path }); return true
  }
}
ipcMain.handle('desktop:action', async (event, name, args) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame.url.startsWith(pathToFileURL(page).href + '?')) return { error: '会话不可用' }
  if (name === 'state') return { value: await profile() }
  if (!Object.hasOwn(actions, name)) return { error: '此窗口不支持该操作' }
  if (busy || closing) return { error: '请等待当前操作完成' }
  try { busy = true; foreground = Promise.resolve().then(() => actions[name](args)); return { value: await foreground } }
  catch (error) { return { error: (await capture.failure(error, name)).message } }
  finally { busy = false; foreground = undefined }
})
await app.whenReady()
try { settings = JSON.parse(await readFile(stateFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') await capture.failure(error, 'read-settings') }
const migration = packaged ? await legacyOrigin({ here, userData }) : null
let movingToOriginal = false
if (migration) {
  try {
    await startApply({ here, userData, ...migration, quit: () => app.quit() })
    movingToOriginal = true
  } catch (error) { capture.error = '原目录更新未完成：' + (await capture.failure(error, 'update-original-entry')).message }
}
if (!movingToOriginal) {
mainWindow = new BrowserWindow({ width: 1240, height: 820, minWidth: 960, minHeight: 680,
  backgroundColor: '#0d111a', title: '账号采集工具', webPreferences: {
    preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
mainWindow.webContents.on('will-navigate', event => event.preventDefault())
await mainWindow.loadFile(page, { query: { role: 'capture' } })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (readyToQuit) return
  capture.updater.cancel()
  const work = capture.current || capture.analysisTask
  if (!work && !foreground && !activeCommands.size) { readyToQuit = true; return }
  event.preventDefault()
  if (closing) return
  closing = true
  work?.stop()
  Promise.allSettled([work?.done, foreground, ...[...activeCommands].map(task => task.done), settingsQueue]).then(() => {
    readyToQuit = true; app.quit()
  })
})
setTimeout(() => void cleanupHelpers(userData), 3000).unref()
}
