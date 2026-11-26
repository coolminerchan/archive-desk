import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isIP } from 'node:net'

const key = value => resolve(value).toLowerCase()
export async function gameInfo(path) {
  try {
    if (!(await stat(path)).isFile()) return null
    const root = dirname(path)
    const config = await readFile(join(root, 'launcher_Data/StreamingAssets/Config.txt'), 'utf8')
    if (!/^\s*RemoteServerIP\s*=/m.test(config) || !/^\s*UseLocalServer\s*=/m.test(config)) return null
    const peers = [...config.matchAll(/^\s*RemoteServerIP\s*=\s*([^\s#;]+)/gm)].map(m => m[1]).filter(isIP)
    if (/^\s*UseLocalServer\s*=\s*TRUE\s*$/mi.test(config)) return null
    let steamId
    try {
      const id = (await readFile(join(root, 'steam_appid.txt'), 'utf8')).trim()
      if (/^\d{1,15}$/.test(id)) steamId = id
    } catch {}
    return { path: resolve(path), peers: [...new Set(peers)], channel: steamId ? 'steam' : 'cn-pc', steamId }
  } catch { return null }
}

async function steamCandidates(roots) {
  const libraries = new Set(roots || []), candidates = []
  for (const root of roots || []) {
    try {
      const text = await readFile(join(root, 'steamapps/libraryfolders.vdf'), 'utf8')
      for (const m of text.matchAll(/"path"\s*"([^"]+)"/g)) libraries.add(m[1].replaceAll('\\\\', '\\'))
    } catch {}
  }
  for (const library of libraries) {
    try {
      const folder = join(library, 'steamapps'), common = resolve(folder, 'common')
      for (const file of (await readdir(folder)).filter(n => /^appmanifest_\d+\.acf$/.test(n)).slice(0, 512)) {
        const text = await readFile(join(folder, file), 'utf8')
        const leaf = /"installdir"\s*"([^"]+)"/i.exec(text)?.[1]
        if (!leaf || dirname(resolve(common, leaf)) !== common) continue
        const info = await gameInfo(join(common, leaf, 'launcher.exe'))
        if (info) candidates.push({ ...info, steamId: /^appmanifest_(\d+)\.acf$/.exec(file)[1], channel: 'steam' })
      }
    } catch {}
  }
  return candidates
}

// Search platform game libraries only, with bounded depth. Never walk whole disks.
export async function findOfficialGames(data, saved, validate) {
  const found = new Map()
  async function add(path, extra = {}) {
    if (!path) return
    const info = await gameInfo(path)
    if (!info) return
    try { await validate(path) } catch { return }
    const previous = found.get(key(path)) || {}
    found.set(key(path), { ...info, ...previous, ...extra })
  }
  await add(saved, { preferred: true })
  for (const process of data.processes || []) await add(process.path, { running: true, pid: process.pid })
  for (const info of await steamCandidates(data.steamRoots)) await add(info.path, info)
  for (const root of [...new Set(data.gameRoots || [])].slice(0, 64)) {
    await add(join(root, 'launcher.exe'))
    try {
      for (const entry of (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && !e.isSymbolicLink()).slice(0, 256))
        await add(join(root, entry.name, 'launcher.exe'))
    } catch {}
  }
  return [...found.values()].sort((a, b) => Number(!!b.preferred) - Number(!!a.preferred) || Number(!!b.running) - Number(!!a.running))
}

export function chooseOfficialGame(candidates) {
  const preferred = candidates.filter(c => c.preferred)
  if (preferred.length === 1) return preferred[0]
  const running = candidates.filter(c => c.running)
  if (running.length === 1) return running[0]
  return candidates.length === 1 ? candidates[0] : null
}
