import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureFilters, DEFAULT_PORTS, CaptureController, captureDiagnostics } from '../capture-controller.mjs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'

test('auto includes every upstream game port', () => {
  assert.deepEqual(captureFilters({}), DEFAULT_PORTS.map(port => ({ port })))
})
test('dynamic channel scopes by address without guessing its port', () => {
  assert.deepEqual(captureFilters({ channel: 'steam', peer: '198.51.100.2, 198.51.100.2' }), [{ ip: '198.51.100.2' }])
  assert.throws(() => captureFilters({ channel: 'steam' }))
  assert.throws(() => captureFilters({ channel: 'emulator' }))
})
test('multi-endpoint filters remain bounded and reject malformed input', () => {
  assert.equal(captureFilters({ peer: '198.51.100.2, 203.0.113.1', port: '11003, 21001' }).length, 4)
  for (const options of [{ peer: 'example.com' }, { port: '-1' }, { port: '65536' }, { peer: '::1%scope' }])
    assert.throws(() => captureFilters(options))
})
test('cancelled export preserves source and does not report success', async () => {
  const controller = new CaptureController({ dialog: { showSaveDialog: async () => ({ canceled: true }) }, window() {} })
  controller.report = { account_zip: 'untouched.zip' }
  assert.equal(await controller.actions()['capture-export'](), false)
})

test('diagnostics exclude identity, paths, credentials and arbitrary protocol fields', () => {
  const secret = 'private-diagnostic-sentinel'
  const report = { analysis_version: '0.5.3', account_uid: 7654001, accounts_detail: [{ player_name: secret }],
    input: secret, warnings: [secret], access_code: secret, session_ticket: secret, raw: { body: secret },
    quality: { integrity_known: true, tcp_gap_directions: 1, tail_directions: 2, incomplete_directions: 2, error: secret },
    session_timings: { preparation_ms: 12, first_response_observed_ms: 200, conversion_ms: secret },
    timings: { archive_ms: 42, access_token: secret }, equipment: { weapon: { observed: 466, snapshot: 433, other_only: 33, without_id: secret } },
    items: [{ id: secret, hint: secret, state: 'missing' }], dungeons: { observed_count: 180, detailed_count: 0, snapshots: [secret] },
    life_social: { friend_name: secret, history: { counts: [secret] }, packet_context: { connection_id: secret } } }
  const result = captureDiagnostics(report, { version: '0.5.3', backend: 'compact-etw' })
  assert.equal(result.equipment.weapon.observed, 466)
  assert.equal(result.timings_ms.conversion_ms, null)
  assert.equal(result.timings_ms.archive_ms, 42)
  assert.equal(result.quality.incomplete_directions, 2)
  assert.equal(result.category_counts.missing, 1)
  assert.equal(result.dungeons.observed, 180)
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.ok(!JSON.stringify(result).includes('7654001'))
  assert.equal(captureDiagnostics(report, { version: secret, backend: secret }).version, null)
})

test('diagnostic export cancels cleanly and writes only allowlisted JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-diagnostic-'))
  try {
    const file = join(root, 'diagnostic.json')
    let canceled = true
    const controller = new CaptureController({ dialog: { showSaveDialog: async () => ({ canceled, filePath: file }) }, window() {} })
    controller.report = { analysis_version: '0.5.3', input: 'private-input', quality: { tcp_gap_directions: 1 } }
    assert.equal(await controller.actions()['capture-export-diagnostics'](), false)
    canceled = false
    assert.equal(await controller.actions()['capture-export-diagnostics'](), true)
    const saved = await readFile(file, 'utf8')
    assert.ok(!saved.includes('private-input'))
    assert.equal(JSON.parse(saved).quality.tcp_gap_directions, 1)
    controller.current = {}
    await assert.rejects(controller.actions()['capture-export-diagnostics'](), /结束/)
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('of-diagnostic-'))
    await rm(root, { recursive: true, force: true })
  }
})
test('a stale dependency selection falls back to the tools own bundled components', () => {
  const controller = new CaptureController({ settings: () => ({ toolkit: 'missing-old-install' }), toolkit: 'own-components' })
  assert.equal(controller.toolkit, 'own-components')
})
test('Steam shortcut finds an offline install in a second library, including UTF-16', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-steam-test-'))
  try {
    const primary = join(root, 'Steam'), library = join(root, 'Library Two')
    await mkdir(join(primary, 'steamapps'), { recursive: true })
    await mkdir(join(library, 'steamapps/common/Game/launcher_Data/StreamingAssets'), { recursive: true })
    await writeFile(join(primary, 'steamapps/libraryfolders.vdf'), '"path" "' + library.replaceAll('\\', '\\\\') + '"')
    await writeFile(join(library, 'steamapps/appmanifest_123456.acf'), '"installdir" "Game"')
    await writeFile(join(library, 'steamapps/common/Game/launcher_Data/StreamingAssets/Config.txt'), 'RemoteServerIP=198.51.100.4\nLocalServerIP=192.168.1.2')
    const shortcut = join(root, 'Game.url')
    await writeFile(shortcut, Buffer.concat([Buffer.from([255, 254]), Buffer.from('[InternetShortcut]\nURL=steam://rungameid/123456\n', 'utf16le')]))
    const controller = new CaptureController({ settings: () => ({ officialLauncher: shortcut }) })
    controller.ps = () => ({ done: Promise.resolve(JSON.stringify({ processes: [], connections: [], steamRoots: [primary] })) })
    assert.deepEqual((await controller.discover()).peers, ['198.51.100.4'])
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('of-steam-test-'))
    await rm(root, { recursive: true, force: true })
  }
})
