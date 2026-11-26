import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureError } from '../capture-errors.mjs'
import { CaptureController } from '../capture-controller.mjs'

test('structured delivery errors hide paths but retain their local details', () => {
  const error = new Error('python failed\n' + JSON.stringify({ code: 'identity_mismatch', message: 'C:\\private\\record.zip' }))
  const result = captureError(error)
  assert.equal(result.code, 'identity_mismatch')
  assert.match(result.message, /归属/)
  assert.ok(!result.message.includes('private'))
  assert.ok(result.detail.includes('private'))
  assert.match(captureError({ code: 'ENOSPC', message: 'secret/path' }).message, /空间不足/)
})

test('only friendly business errors reach the interface and full errors stay in local logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archive-error-'))
  try {
    const controller = new CaptureController({ userData: root })
    const error = await controller.failure(new Error('Traceback C:\\private\\record.zip'), 'open')
    assert.ok(!error.message.includes('private'))
    assert.ok((await readFile(join(root, 'capture-errors.log'), 'utf8')).includes('private'))
    assert.equal(await controller.failure(error, 'again'), error)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('validated delivery passes both identity domains and remembers the correct module', async () => {
  let args, remembered
  const controller = new CaptureController({ here: '.', toolkit: '.', settings: () => ({}),
    command: (_exe, value) => { args = value; return { done: Promise.resolve('{"sha256":"abc","bytes":12}') } },
    remember: async value => { remembered = value } })
  await controller.deliver('source.zip', 'target.zip', 'scenes', { player_id: 8765001, uid: 7654001 })
  assert.equal(args[args.indexOf('--expected-id') + 1], '8765001')
  assert.equal(args[args.indexOf('--expected-uid') + 1], '7654001')
  assert.equal(remembered.captureSceneDelivery.sha256, 'abc')
  assert.ok(!remembered.captureDelivery)
})

test('settings failure after successful delivery does not report the delivered file as failed', async () => {
  const controller = new CaptureController({ here: '.', toolkit: '.', settings: () => ({}),
    command: () => ({ done: Promise.resolve('{"path":"target.zip","sha256":"abc","bytes":12}') }),
    remember: async () => { throw new Error('settings unavailable') } })
  assert.equal((await controller.deliver('source.zip', 'target.zip', 'gardens')).path, 'target.zip')
})
