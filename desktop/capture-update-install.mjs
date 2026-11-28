import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const EXECUTABLE = '账号采集工具.exe', MANIFEST = 'app-files.json', JOURNAL = '.capture-update.json'
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/
const ROOTS = new Set([EXECUTABLE, 'runtime', 'resources', 'licenses', 'docs', MANIFEST,
  '使用说明.txt', '致谢.txt', 'Capture-guide.md', 'README.md', 'Release-notes.md'])
export const alive = pid => { try { process.kill(Number(pid), 0); return true } catch (error) { return error.code !== 'ESRCH' } }
const pause = ms => new Promise(ok => setTimeout(ok, ms))
export function inside(root, path) {
  const part = relative(resolve(root), resolve(path))
  return !!part && !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)
}
async function readJSON(path) {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink()) throw Error('Linked or invalid update metadata')
  if (entry.size > 4 * 1024 * 1024) throw Error('Update metadata exceeds limit')
  return JSON.parse(await readFile(path, 'utf8'))
}
export async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function atomicJSON(path, value) {
  const pending = path + '.' + randomUUID() + '.tmp'
  try {
    const handle = await open(pending, 'wx')
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    await rename(pending, path)
  } finally { await rm(pending, { force: true }).catch(() => {}) }
}
async function exists(path) { try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
function directoryInput(path) {
  // Reject before resolve(), which would erase a linked component followed by .. .
  if (typeof path !== 'string' || !path || path.includes('\0') || path.split(/[\\/]/).includes('..'))
    throw Error('Invalid update directory path')
  return resolve(path)
}
export async function directory(path) {
  const absolute = directoryInput(path)
  for (let current = absolute; ; current = dirname(current)) {
    const entry = await lstat(current)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('Update directory cannot contain a redirected path')
    if (dirname(current) === current) break
  }
  // Expand legitimate Windows 8.3 names only after checking the original ancestry.
  return realpath(absolute)
}
export async function directoryLocation(path) {
  let parent = directoryInput(path)
  const missing = []
  while (!await exists(parent)) {
    const next = dirname(parent)
    if (next === parent) throw Error('Update directory has no existing parent')
    missing.unshift(basename(parent)); parent = next
  }
  return join(await directory(parent), ...missing)
}
export async function ensureDirectory(path) {
  let parent = await directoryLocation(path)
  const missing = []
  while (!await exists(parent)) { missing.unshift(basename(parent)); parent = dirname(parent) }
  parent = await directory(parent)
  for (const name of missing) {
    const child = join(parent, name)
    try { await mkdir(child) } catch (error) { if (error.code !== 'EEXIST') throw error }
    parent = await directory(child)
  }
  return parent
}
export function overlap(a, b) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase() || inside(a, b) || inside(b, a)
}
export async function product(root) {
  await directory(root)
  await directory(join(root, 'resources/app'))
  const info = await readJSON(join(root, 'resources/app/product.json'))
  if (info.role !== 'capture' || !VERSION.test(info.version)) throw Error('Update destination is not a collector installation')
  const trust = await readJSON(join(root, 'resources/app/capture-update.json'))
  if (typeof trust.repository !== 'string' || typeof trust.public_key !== 'string') throw Error('Missing update trust configuration')
  return { ...info, trust }
}
const sameTrust = (a, b) => a.repository === b.repository && a.public_key.trim() === b.public_key.trim()
async function requireIdleInstallation(root) {
  const path = join(root, JOURNAL)
  if (!await exists(path)) return
  const previous = await readJSON(path)
  if (previous.kind !== 'capture_update' || ['preparing','applying'].includes(previous.phase))
    throw Error('A previous update must recover first; reopen the original application entry')
}
function validFile(path) {
  return typeof path === 'string' && !/[\\:\x00-\x1f<>"|?*]/.test(path) &&
    path.split('/').every(part => part && !['.','..'].includes(part) && !/[ .]$/.test(part)) && ROOTS.has(path.split('/')[0])
}
async function listFiles(root, prefix = '') {
  const rows = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isSymbolicLink()) throw Error('Linked update member')
    if (entry.isDirectory()) rows.push(...await listFiles(root, name))
    else if (entry.isFile()) rows.push(name)
    else throw Error('Unsupported update member')
  }
  return rows
}
export async function createManifest(root, version) {
  const files = []
  for (const path of (await listFiles(root)).sort()) {
    if (path === MANIFEST) continue
    if (!validFile(path)) throw Error('Unexpected package member: ' + path)
    files.push({ path, bytes: (await stat(join(root, path))).size, sha256: await digest(join(root, path)) })
  }
  const manifest = { schema: 1, kind: 'capture_package', version, files }
  await atomicJSON(join(root, MANIFEST), manifest)
  return manifest
}
export async function verifyPackage(root, version) {
  const info = await product(root), manifest = await readJSON(join(root, MANIFEST))
  if (info.version !== version || manifest.schema !== 1 || manifest.kind !== 'capture_package' || manifest.version !== version ||
      !Array.isArray(manifest.files) || manifest.files.length > 50000) throw Error('Invalid package inventory')
  const seen = new Set()
  for (const row of manifest.files) {
    if (!validFile(row.path) || row.path === MANIFEST || seen.has(row.path.toLowerCase()) ||
        !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw Error('Invalid package file')
    seen.add(row.path.toLowerCase())
    const path = join(root, row.path), metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== row.bytes || await digest(path) !== row.sha256)
      throw Error('Package file changed: ' + row.path)
  }
  const actual = await listFiles(root)
  if (actual.length !== seen.size + 1 || actual.some(path => path !== MANIFEST && !seen.has(path.toLowerCase())))
    throw Error('Unexpected file in update package')
  for (const required of [EXECUTABLE, 'runtime/node.exe', 'resources/app/main.mjs', 'resources/app/product.json'])
    if (!seen.has(required.toLowerCase())) throw Error('Incomplete package inventory')
  return { ...info, manifest }
}
async function retryRename(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return } catch (error) {
      if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= 30) throw error
      await pause(200)
    }
  }
}
export async function removeOwned(root, path) {
  const absolute = directoryInput(path), parent = await directory(dirname(absolute)), owner = await directory(root)
  if (parent.toLowerCase() !== owner.toLowerCase() || !inside(owner, join(parent, basename(absolute))) ||
      (await lstat(absolute)).isSymbolicLink()) throw Error('Invalid update cleanup path')
  if ((await lstat(absolute)).isDirectory()) await directory(absolute)
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
export async function validatePlan(plan, { requireSource = false } = {}) {
  if (plan.schema !== 1 || plan.kind !== 'capture_update' || !VERSION.test(plan.version) || !VERSION.test(plan.previousVersion) ||
      !/^[a-f0-9]{32}$/.test(plan.id) || ![plan.target, plan.source, plan.helper].every(path => typeof path === 'string' && isAbsolute(path)))
    throw Error('Invalid update plan')
  const target = await directory(plan.target), helper = await directory(plan.helper)
  // Recovery may outlive its downloaded package; it never reads files from source.
  const source = requireSource ? await directory(plan.source) : await directoryLocation(plan.source)
  if (overlap(target, source) || overlap(target, helper) || overlap(source, helper)) throw Error('Update directories overlap')
  if (plan.incoming !== join(plan.target, '.capture-incoming-' + plan.id) || plan.backup !== join(plan.target, '.capture-backup-' + plan.id))
    throw Error('Invalid update transaction paths')
  for (const path of [plan.incoming, plan.backup]) {
    if (await directoryLocation(path) !== join(target, basename(path))) throw Error('Invalid update transaction paths')
  }
}
export async function makePlan(target, source, helper, version, pids = []) {
  target = await directory(target); source = await directory(source); helper = await directory(helper)
  if (overlap(target, source) || overlap(target, helper) || overlap(source, helper)) throw Error('Update directories overlap')
  await requireIdleInstallation(target)
  const before = await product(target), after = await verifyPackage(source, version)
  if (!sameTrust(before.trust, after.trust)) throw Error('Update publisher does not match this installation')
  const a = before.version.split('.').map(Number), b = version.split('.').map(Number)
  if (!b.some((value, i) => value > a[i] && b.slice(0,i).every((n,j) => n === a[j]))) throw Error('Update must be newer')
  const probe = join(target, '.capture-write-' + randomUUID())
  const writable = await open(probe, 'wx'); await writable.close(); await rm(probe)
  const id = randomUUID().replaceAll('-', '')
  const plan = { schema: 1, kind: 'capture_update', id, target, source, helper, version, previousVersion: before.version, pids,
    incoming: join(target, '.capture-incoming-' + id), backup: join(target, '.capture-backup-' + id) }
  await validatePlan(plan, { requireSource: true })
  return plan
}
export async function rollback(plan) {
  await validatePlan(plan)
  const journal = await readJSON(join(plan.target, JOURNAL))
  if (journal.id !== plan.id || !Array.isArray(journal.operations)) throw Error('Update journal does not match plan')
  for (const operation of [...journal.operations].reverse()) {
    if (!ROOTS.has(operation.name)) throw Error('Invalid rollback member')
    const target = join(plan.target, operation.name), backup = join(plan.backup, operation.name)
    if (await exists(backup)) {
      if ((await lstat(backup)).isSymbolicLink()) throw Error('Invalid linked rollback component')
      if (operation.name !== EXECUTABLE && await exists(target)) await removeOwned(plan.target, target)
      await retryRename(backup, target)
    } else if (!operation.existed && await exists(target)) await removeOwned(plan.target, target)
  }
  await atomicJSON(join(plan.target, JOURNAL), { ...journal, phase: 'rolled_back' })
}
async function lockInstallation(plan) {
  const path = join(plan.target, '.capture-update.lock')
  let handle
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await open(path, 'wx'); break } catch (error) {
      if (error.code !== 'EEXIST' || attempt) throw error
      if ((await lstat(path)).isSymbolicLink()) throw Error('Invalid update lock')
      const owner = await readJSON(path).catch(() => null)
      if (!owner || owner.kind !== 'capture_update_lock' || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || alive(owner.pid))
        throw Error('Another update is already active; close duplicate windows and retry')
      await rm(path)
    }
  }
  try { await handle.writeFile(JSON.stringify({ kind:'capture_update_lock', id:plan.id, pid:process.pid })); await handle.sync() }
  catch (error) { await handle.close(); await rm(path).catch(() => {}); throw error }
  return async () => {
    await handle.close()
    if ((await readJSON(path).catch(() => null))?.id === plan.id) await rm(path)
  }
}
export async function apply(plan, options = {}) {
  await validatePlan(plan, { requireSource: true })
  const release = await lockInstallation(plan)
  try { return await applyLocked(plan, options) } finally { await release() }
}
async function applyLocked(plan, { beforeReplace } = {}) {
  await validatePlan(plan, { requireSource: true })
  await requireIdleInstallation(plan.target)
  const before = await product(plan.target), after = await verifyPackage(plan.source, plan.version)
  if (before.version !== plan.previousVersion || !sameTrust(before.trust, after.trust)) throw Error('Installation changed since update preparation')
  await mkdir(plan.incoming); await mkdir(plan.backup)
  let journal
  try {
    journal = { ...plan, phase: 'preparing', helper_pid: process.pid, operations: [] }
    await atomicJSON(join(plan.target, JOURNAL), journal)
    for (const row of [...after.manifest.files, { path: MANIFEST }]) {
      const dest = join(plan.incoming, row.path)
      await mkdir(dirname(dest), { recursive: true }); await copyFile(join(plan.source, row.path), dest)
    }
    await verifyPackage(plan.incoming, plan.version)
    const components = [EXECUTABLE, ...[...new Set(after.manifest.files.map(row => row.path.split('/')[0]))]
      .filter(name => name !== EXECUTABLE), MANIFEST]
    journal.phase = 'applying'
    await atomicJSON(join(plan.target, JOURNAL), journal)
    for (const name of components) {
      const target = join(plan.target, name), existed = await exists(target)
      if (existed && (await lstat(target)).isSymbolicLink()) throw Error('Installation contains a redirected program component')
      journal.operations.push({ name, existed })
      await atomicJSON(join(plan.target, JOURNAL), journal)
      await beforeReplace?.(name)
      if (existed) {
        if (name === EXECUTABLE) await copyFile(target, join(plan.backup, name))
        else await retryRename(target, join(plan.backup, name))
      }
      await retryRename(join(plan.incoming, name), target)
    }
    await verifyInstalled(plan.target, plan.version, after.manifest)
    await atomicJSON(join(plan.target, JOURNAL), { ...journal, phase: 'committed' })
    await atomicJSON(join(plan.backup, 'backup.json'), { kind: 'capture_previous_program', version: before.version, currentVersion: plan.version })
    return { path: plan.target, version: plan.version, executable: join(plan.target, EXECUTABLE), backup: plan.backup }
  } catch (error) {
    if (journal) {
      try { await rollback(plan) } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Update and rollback failed; recovery journal retained') }
    }
    throw error
  } finally { if (await exists(plan.incoming)) await removeOwned(plan.target, plan.incoming) }
}
async function verifyInstalled(root, version, manifest) {
  if ((await product(root)).version !== version) throw Error('Installed version does not match')
  for (const row of manifest.files)
    if (await digest(join(root, row.path)) !== row.sha256) throw Error('Installed file verification failed')
}
export async function startApply({ here, userData, source, version, target = resolve(here, '../..'), quit, pids = [process.pid, process.ppid] }) {
  await directory(here)
  target = await directory(target); source = await directory(source)
  const updates = await directoryLocation(join(userData, 'updates'))
  const helper = join(updates, 'apply-' + randomUUID().replaceAll('-', ''))
  if (overlap(target, source) || overlap(target, helper) || overlap(source, helper)) throw Error('Update directories overlap')
  await ensureDirectory(updates)
  // A failed mkdir must not make an existing directory eligible for cleanup.
  await mkdir(helper)
  try {
    const plan = await makePlan(target, source, helper, version, pids)
    await copyFile(process.execPath, join(helper, 'node.exe'))
    for (const name of ['capture-update-apply.mjs', 'capture-update-install.mjs']) await copyFile(join(here, name), join(helper, name))
    await atomicJSON(join(helper, 'plan.json'), plan)
    const child = spawn(join(helper, 'node.exe'), [join(helper, 'capture-update-apply.mjs'), '--plan', join(helper, 'plan.json')],
      { detached: true, stdio: 'ignore', windowsHide: true, cwd: helper })
    await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail) }); child.unref()
    setTimeout(quit, 100)
    return plan
  } catch (error) { await removeOwned(updates, helper).catch(() => {}); throw error }
}
export async function legacyOrigin({ here, userData, origin = process.env.OVERFIELD_CAPTURE_LAUNCH_CWD }) {
  if (!origin || !isAbsolute(origin)) return null
  try {
    const source = await directory(resolve(await directory(here), '../..')), updates = await directory(join(userData, 'updates'))
    const target = await directory(origin)
    if (dirname(source).toLowerCase() !== updates.toLowerCase() || !/^version-\d+\.\d+\.\d+-[a-f0-9-]+$/.test(basename(source)) || overlap(target, source)) return null
    const prepared = await readJSON(join(updates, 'prepared.json'))
    if ((await directory(prepared.path)).toLowerCase() !== source.toLowerCase() || !VERSION.test(prepared.version)) return null
    const before = await product(origin), after = await product(source)
    if (prepared.version !== after.version || !sameTrust(before.trust, after.trust) || before.version === after.version) return null
    return { target, source, version: after.version }
  } catch { return null }
}
export async function cleanupHelpers(userData) {
  let root
  try { root = await directory(join(userData, 'updates')) } catch { return }
  for (const name of await readdir(root).catch(() => [])) {
    if (!/^apply-[a-f0-9]{32}$/.test(name)) continue
    const path = join(root, name)
    try {
      await directory(path)
      const result = await readJSON(join(path, 'result.json'))
      if (result.kind !== 'capture_update_result' || !['committed','rolled_back'].includes(result.phase) || alive(result.pid)) continue
      if ((await readdir(path)).some(file => !['node.exe','capture-update-apply.mjs','capture-update-install.mjs','plan.json','result.json'].includes(file))) continue
      await removeOwned(root, path)
    } catch { /* Running or unknown helpers are retained. */ }
  }
}
