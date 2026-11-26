import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join, dirname, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { CaptureController, DEFAULT_PORTS } from '../capture-controller.mjs'
import { chooseOfficialGame, findOfficialGames } from '../capture-launcher.mjs'
import { guidedSteps } from '../ui/capture-guide.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'of-oneclick-'))
  try {
    const game = join(root, 'Games/Example/launcher.exe')
    await mkdir(join(dirname(game), 'launcher_Data/StreamingAssets'), { recursive: true })
    await writeFile(game, 'test-only executable placeholder')
    await writeFile(join(dirname(game), 'launcher_Data/StreamingAssets/Config.txt'), 'UseLocalServer=FALSE\nRemoteServerIP=192.0.2.8\n')
    await run({ root, game })
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('of-oneclick-'))
    await rm(root, { recursive: true, force: true })
  }
}

function controllerFor({ root, game }, extra = {}) {
  let settings = {}, release
  const controller = new CaptureController({ here: root, userData: root, toolkit: root,
    defaultCaptureOutput: join(root, 'Documents/游戏账号备份'),
    settings: () => settings, remember: async fields => { settings = { ...settings, ...fields } },
    send() {}, pick() { throw new Error('One-click must not open a directory chooser') },
    command: () => ({ done: Promise.resolve(''), child: { kill() {} } }), ...extra })
  controller.ps = (mode, args, options) => {
    if (mode === 'Inspect') return { done: Promise.resolve(JSON.stringify({ admin: true, idle: true, filtersEmpty: true })) }
    if (mode === 'Discover') return { done: Promise.resolve(JSON.stringify({ processes: [], connections: [], gameRoots: [join(root, 'Games')], steamRoots: [] })) }
    if (mode === 'Observe') return { done: Promise.resolve('{"processes":[]}') }
    if (mode === 'Capture') {
      const done = new Promise(ok => { release = ok })
      queueMicrotask(() => options.onOutput('CAPTURE_STARTED'))
      return { done, stop: () => { options.onOutput('CAPTURE_CONVERTING'); release('') }, child: { kill() {} } }
    }
    throw new Error('Unexpected command: ' + mode)
  }
  controller.inspect = async () => ({ ok: true })
  // This fixture tests orchestration; archive validation has real ZIP coverage.
  controller.deliver = async (source, destination) => { await copyFile(source, destination); return { path: destination } }
  controller.launchOfficial = async task => { assert.equal(task.phase, 'recording'); controller.didLaunch = true }
  controller.analyze = async () => {
    const zip = join(root, 'generated.zip'); await writeFile(zip, 'generated-backup')
    controller.report = { account_zip: zip, accounts_detail: [{ player_id: 8765001, player_label: 7654001, uid: 7654001 }] }
  }
  return controller
}

test('one click finds the game, captures before launch and saves a ZIP without dialogs', async () => fixture(async info => {
  const controller = controllerFor(info)
  assert.equal(await controller.oneClick(), true)
  assert.equal(controller.didLaunch, true)
  assert.equal(controller.current.phase, 'recording')
  const config = JSON.parse(await readFile(join(controller.current.folder, 'filters.json')))
  assert.ok(config.filters.some(f => f.ip === '192.0.2.8' && !f.port), 'Dynamic server ports must be covered from login')
  assert.deepEqual(config.filters.filter(f => f.port).map(f => f.port), DEFAULT_PORTS)
  const folder = controller.current.folder
  await controller.stop()
  const saved = (await controller.state()).captureSavedZip
  assert.equal(await readFile(saved, 'utf8'), 'generated-backup')
  assert.equal(dirname(saved), join(info.root, 'Documents/游戏账号备份'))
  assert.ok(basename(saved).startsWith('账号_7654001_'))
  assert.equal(JSON.parse(await readFile(join(folder, 'session.json'))).phase, 'complete')
  const timings = JSON.parse(await readFile(join(folder, 'session.json'))).timings
  assert.ok(timings.preparation_ms >= 0)
  assert.ok(timings.recording_ms >= 0)
  assert.ok(timings.conversion_ms >= 0)
  assert.equal(controller.flow.phase, 'complete')
}))

test('automatic export without public UID explicitly labels its internal ID', async () => fixture(async info => {
  const controller = controllerFor(info), analyze = controller.analyze
  controller.analyze = async () => { await analyze(); delete controller.report.accounts_detail[0].player_label; delete controller.report.accounts_detail[0].uid }
  await controller.oneClick(); await controller.stop()
  assert.ok(basename((await controller.state()).captureSavedZip).startsWith('账号_内部ID_8765001_'))
}))

test('an already running game is reused and asks for a fresh login', async () => fixture(async info => {
  const controller = controllerFor(info), original = controller.ps
  controller.ps = (mode, ...rest) => mode === 'Discover' ? { done: Promise.resolve(JSON.stringify({ processes: [{ path: info.game, pid: 42 }], connections: [] })) } : original(mode, ...rest)
  await controller.oneClick()
  assert.equal(controller.didLaunch, undefined)
  assert.match(controller.flow.hint, /重新登录/)
  await controller.stop()
}))

test('garden module saves a collection independently and preserves the account report', async () => fixture(async info => {
  const controller = controllerFor(info), account = { account_zip: 'previous-account.zip' }
  controller.report = account
  await controller.ctx.remember({ captureSession: 'previous-account-session', captureSavedZip: 'previous-account.zip' })
  controller.analyze = async (_input, options) => {
    assert.equal(options.purpose, 'gardens')
    const zip = join(info.root, 'gardens-all.zip'); await writeFile(zip, 'garden-collection')
    return controller.gardenReport = { gardens_bundle: zip, gardens: [{ owner_uid: 123, furniture_count: 4 }] }
  }
  await controller.actions()['capture-gardens-one-click']()
  assert.equal(controller.current.purpose, 'gardens')
  const folder = controller.current.folder
  assert.equal(dirname(folder), join(info.root, 'Documents/游戏家园备份'))
  await assert.rejects(controller.oneClick(), /已有采集/)
  await controller.stop()
  const state = await controller.state()
  assert.equal(state.captureReport, account)
  assert.equal(state.captureSession, 'previous-account-session')
  assert.equal(state.captureSavedZip, 'previous-account.zip')
  assert.equal(await readFile(state.captureGardenSavedZip, 'utf8'), 'garden-collection')
  assert.match(basename(state.captureGardenSavedZip), /^装修合集_/)
  assert.equal(JSON.parse(await readFile(join(folder, 'session.json'))).purpose, 'gardens')
  assert.match(controller.flow.hint, /1 个家园/)
}))

test('garden module does not claim a collection when no houses were observed', async () => fixture(async info => {
  const controller = controllerFor(info)
  controller.analyze = async () => controller.gardenReport = { gardens: [] }
  await controller.oneClick({ purpose: 'gardens' }); await controller.stop()
  assert.equal((await controller.state()).captureGardenSavedZip, '')
  assert.match(controller.flow.hint, /未生成装修合集/)
  assert.ok(!controller.flow.hint.includes('账号 ZIP'))
}))

test('capture limits belong to their own module and are visible while recording', async () => fixture(async info => {
  const controller = controllerFor(info)
  await controller.ctx.remember({ captureLimit: true, captureGardenLimit: true })
  controller.analyze = async () => controller.gardenReport = { gardens: [] }
  await controller.oneClick({ purpose: 'gardens' })
  let state = await controller.state()
  assert.equal(state.captureLimit, true)
  assert.equal(state.captureGardenLimit, false)
  controller.current.limit = true
  assert.equal((await controller.state()).captureGardenLimit, true)
  await controller.stop()
  state = await controller.state()
  assert.equal(state.captureLimit, true)
  assert.equal(state.captureGardenLimit, true)
}))

test('garden elevation remembers which module should resume', async () => fixture(async info => {
  let elevated = false
  const controller = controllerFor(info, { shell: { async elevateCapture() { elevated = true } } })
  controller.ps = () => ({ done: Promise.resolve('{"admin":false}') })
  assert.equal(await controller.oneClick({ purpose: 'gardens' }), false)
  assert.equal(elevated, true)
  assert.equal((await controller.state()).captureResumePurpose, 'gardens')
}))

test('permission handoff does not start an unprivileged capture', async () => {
  let elevated = false
  const controller = new CaptureController({ send() {}, shell: { async elevateCapture() { elevated = true } } })
  controller.ps = mode => { assert.equal(mode, 'Inspect'); return { done: Promise.resolve('{"admin":false}') } }
  assert.equal(await controller.oneClick(), false)
  assert.equal(elevated, true)
  assert.equal(controller.current, null)
})

test('cancelled permission handoff is reported without launching a game', async () => {
  const controller = new CaptureController({ send() {}, shell: { async elevateCapture() { throw new Error('已取消系统权限确认') } } })
  controller.ps = () => ({ done: Promise.resolve('{"admin":false}') })
  await assert.rejects(controller.oneClick(), /已取消/)
  assert.equal(controller.flow.phase, 'failed')
  assert.equal(controller.current, null)
})

test('failed preflight never launches the game', async () => fixture(async info => {
  const controller = controllerFor(info)
  controller.inspect = async () => ({ ok: false })
  await assert.rejects(controller.oneClick(), /预检查/)
  assert.equal(controller.didLaunch, undefined)
  assert.equal(controller.current, null)
}))

test('a remembered valid client avoids rescanning platform libraries', async () => fixture(async info => {
  const controller=controllerFor(info)
  await controller.ctx.remember({officialLauncher:info.game})
  const original=controller.ps
  controller.ps=(mode,...args)=>{assert.notEqual(mode,'Discover');return original(mode,...args)}
  await controller.oneClick();await controller.stop()
  assert.equal(controller.didLaunch,true)
}))

test('empty capture preserves records without claiming an account backup', async () => fixture(async info => {
  const controller = controllerFor(info)
  controller.analyze = async () => { controller.report = { accounts_detail: [] } }
  await controller.oneClick(); await controller.stop()
  assert.equal((await controller.state()).captureSavedZip, '')
  assert.match(controller.flow.hint, /未生成账号 ZIP/)
  assert.equal((await readdir(join(info.root, 'Documents/游戏账号备份'))).filter(n => n.endsWith('.zip')).length, 0)
}))

test('automatic discovery rejects a prepared private copy and unrelated launchers', async () => fixture(async info => {
  await writeFile(join(dirname(info.game), 'client-ready.json'), '{}')
  const controller = controllerFor(info)
  assert.deepEqual(await findOfficialGames({ gameRoots: [join(info.root, 'Games')] }, '', p => controller.validateOfficial(p)), [])
  assert.equal(chooseOfficialGame([{ path: 'one' }, { path: 'two' }]), null)
  assert.equal(chooseOfficialGame([{ path: 'one' }, { path: 'two', preferred: true }]).path, 'two')
}))

test('map guidance remains unfinished when only a scene response is present', () => {
  const steps = guidedSteps({ items: [{ id: 'map_scene', state: 'collected', count: 1 }] })
  const map = steps.find(s => s.id === 'maps')
  assert.equal(map.status, 'partial')
  assert.match(map.text, /月亮/)
  assert.equal(map.received, 1)
})

test('game exit saves only after the game has actually appeared', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000 })
  let running = false, stopped = false
  const controller = new CaptureController({})
  controller.ps = mode => { assert.equal(mode, 'Observe'); return { done: Promise.resolve(JSON.stringify({ processes: running ? [{ path: 'C:/Example/launcher.exe' }] : [] })) } }
  controller.updateFlow = () => {}
  const task = { phase: 'recording', stop() { stopped = true; task.phase = 'saving' } }
  controller.current = task
  controller.watchGame(task, ['C:/Example/launcher.exe'])
  const tick = async n => { for (let i=0; i<n; i++) { t.mock.timers.tick(4000); await new Promise(setImmediate) } }
  await tick(5)
  assert.equal(stopped, false, 'A slow Steam start is not an exit')
  running = true; await tick(1)
  running = false; await tick(3)
  assert.equal(stopped, false, 'Brief launcher handoff needs a grace period')
  await tick(1)
  assert.equal(stopped, true)
})
