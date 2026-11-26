import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { signedRelease, newer, releaseURL, CaptureUpdater } from '../capture-update.mjs'

const pair = generateKeyPairSync('ed25519')
const trust = { repository: 'example/archive', public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }) }
const data = Buffer.from('fake-package-for-update-orchestration')
const release = { schema: 1, role: 'capture', repository: trust.repository, version: '0.6.1',
  url: 'https://github.com/example/archive/releases/download/v0.6.1/package.zip',
  bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
function envelope(value = release) {
  const payload = Buffer.from(JSON.stringify(value))
  return { payload: payload.toString('base64'), signature: sign(null, payload, pair.privateKey).toString('base64') }
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'archive-update-'))
  try {
    await writeFile(join(root, 'capture-update.json'), JSON.stringify(trust))
    await writeFile(join(root, 'product.json'), '{"role":"capture","version":"0.6.0"}')
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('updates require our own signature, product identity, bounded size and release URL', () => {
  assert.equal(signedRelease(envelope(), trust, '0.6.0').newer, true)
  assert.equal(signedRelease(envelope(), trust, '0.6.1').newer, false)
  assert.equal(newer('0.10.0', '0.6.1'), true)
  assert.equal(newer('0.6.0', '0.6.0'), false)
  assert.equal(newer('bad', '0.6.0'), false)
  assert.throws(() => signedRelease({ ...envelope(), payload: Buffer.from('{}').toString('base64') }, trust, '0.6.0'), /签名/)
  assert.throws(() => signedRelease(envelope({ ...release, role: 'server' }), trust, '0.6.0'), /格式/)
  assert.throws(() => signedRelease(envelope({ ...release, bytes: 1e12 }), trust, '0.6.0'), /格式/)
  assert.throws(() => releaseURL('https://github.com/other/repo/releases/download/v1/a.zip', trust.repository))
  assert.throws(() => releaseURL('http://github.com/example/archive/releases/download/v1/a.zip', trust.repository))
})

test('private or absent releases are an explicit unavailable state without any account token', async () => fixture(async root => {
  const updater = new CaptureUpdater({ here: root, userData: root }, { fetcher: async (_url, options) => {
    assert.ok(!('Authorization' in options.headers)); return new Response('', { status: 404 })
  } })
  assert.equal(await updater.check(), false)
  assert.equal(updater.state.phase, 'unavailable')
}))

test('active capture prevents checking, downloading and launching an update', async () => {
  const updater = new CaptureUpdater({}, { idle: () => false })
  await assert.rejects(updater.check(), /结束采集/)
  await assert.rejects(updater.prepare(), /结束采集/)
  await assert.rejects(updater.launch(), /结束采集/)
})

test('closing can cancel a pending request without waiting for its network timeout', async () => fixture(async root => {
  let started
  const ready = new Promise(ok => { started = ok })
  const updater = new CaptureUpdater({ here: root, userData: root }, { fetcher: async (_url, options) => {
    started()
    return new Promise((_ok, fail) => options.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true }))
  } })
  const task = updater.check()
  await ready; updater.cancel()
  await assert.rejects(task, /aborted/)
  assert.equal(updater.running, false)
}))

test('download is hashed before installation and installs in a new directory', async () => fixture(async root => {
  let calls = 0, installed
  const updater = new CaptureUpdater({ here: root, userData: root, python: () => 'python',
    command: (_exe, args) => ({ done: (async () => {
      const file = args[args.indexOf('--input') + 1]
      assert.deepEqual(await readFile(file), data)
      installed = args[args.indexOf('--output') + 1]
      await mkdir(installed)
      return JSON.stringify({ path: installed, executable: join(installed, '账号采集工具.exe'), version: '0.6.1' })
    })() }) }, { fetcher: async () => ++calls === 1 ? new Response(JSON.stringify(envelope())) : new Response(data) })
  await updater.check(); await updater.prepare()
  assert.equal(updater.state.phase, 'ready')
  assert.ok(installed.startsWith(join(root, 'updates', 'version-0.6.1-')))
}))

test('download tampering and untrusted redirects never reach the installer', async () => fixture(async root => {
  let calls = 0, installed = false
  const updater = new CaptureUpdater({ here: root, userData: root, command: () => { installed = true } },
    { fetcher: async () => ++calls === 1 ? new Response(JSON.stringify(envelope())) : new Response('tampered') })
  await updater.check()
  await assert.rejects(updater.prepare(), /校验/)
  assert.equal(installed, false)
  assert.equal(updater.state.phase, 'failed')
  const redirected = new CaptureUpdater({ here: root, userData: root }, { fetcher: async () => new Response('', {
    status: 302, headers: { location: 'https://untrusted.example/payload' } }) })
  await assert.rejects(redirected.check(), /重定向地址/)
}))
