// Private stdio bridge to the native WebView2 host. No TCP listener or Node API in the renderer.
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const pending = new Map(), handlers = new Map(), paths = new Map()
let serial = 0, window, destroyed = false, exited = false
paths.set('appData', process.env.OVERFIELD_APP_DATA || process.env.APPDATA || join(homedir(), 'AppData/Roaming'))
paths.set('documents', process.env.OVERFIELD_DOCUMENTS || join(homedir(), 'Documents'))
function send(value) { if (!process.stdout.destroyed) process.stdout.write(JSON.stringify(value) + '\n') }
process.stdout.on('error', () => {})
function host(method, value) {
  const id = 'host-' + ++serial
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); send({ kind: 'host', id, method, value }) })
}

export const app = new EventEmitter()
app.getPath = key => paths.get(key) || join(paths.get('appData'), 'OverField Desktop')
app.setPath = (key, value) => paths.set(key, value)
app.setName = () => {}
app.setAppUserModelId = () => {}
app.whenReady = () => Promise.resolve()
app.quit = () => {
  if (exited) return
  let prevented = false
  app.emit('before-quit', { preventDefault() { prevented = true } })
  if (prevented) return
  exited = true; destroyed = true
  process.stdout.write(JSON.stringify({ kind: 'quit' }) + '\n', () => process.exit(0))
}
export class BrowserWindow {
  constructor(options) {
    window = this
    this.webContents = new EventEmitter()
    this.webContents.mainFrame = { url: '' }
    this.webContents.send = (name, value) => send({ kind: 'event', name, value })
    this.webContents.setWindowOpenHandler = () => {}
    send({ kind: 'window', options })
  }
  isDestroyed() { return destroyed }
  async loadFile(path, { query } = {}) {
    this.webContents.mainFrame.url = pathToFileURL(path).href + '?' + new URLSearchParams(query)
    send({ kind: 'ready', query })
  }
}
export const ipcMain = { handle(name, handler) { handlers.set(name, handler) } }
export const dialog = {
  showOpenDialog: (_, options) => host('open-dialog', options),
  showSaveDialog: (_, options) => host('save-dialog', options)
}
export const shell = {
  elevateCapture: () => host('elevate-capture', {}),
  openPath: path => host('open-path', path),
  openExternal: url => host('open-external', url)
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', async line => {
  try {
    if (line.length > 16 * 1024 * 1024) throw new Error('Request too large')
    const request = JSON.parse(line)
    if (request.kind === 'host-result') {
      const item = pending.get(request.id)
      if (item) { pending.delete(request.id); request.error ? item.reject(new Error(request.error)) : item.resolve(request.value) }
    } else if (request.kind === 'invoke' && window) {
      const callback = handlers.get('desktop:action')
      const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
      const result = await callback(event, request.name, request.args)
      send({ kind: 'result', id: request.id, value: result })
    } else if (request.kind === 'close') app.quit()
  } catch (error) { send({ kind: 'result', value: { error: String(error.message || error) } }) }
})
input.on('close', () => {
  for (const item of pending.values()) item.reject(new Error('Window closed'))
  pending.clear()
  app.quit()
})
process.on('uncaughtException', error => { process.stderr.write(String(error.stack || error) + '\n'); app.quit() })
