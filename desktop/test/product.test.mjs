import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectProduct } from '../product.mjs'

test('each packaged product remains fixed to its own role', () => {
  for (const role of ['server', 'client', 'capture']) {
    assert.equal(selectProduct({ role, version: '0.3.1' }).role, role)
    const other = role === 'client' ? 'server' : 'client'
    assert.throws(() => selectProduct({ role }, other), /自己的启动入口/)
  }
})
test('development roles remain selectable without a packaged manifest', () => {
  assert.equal(selectProduct(null, 'capture').name, '账号采集工具')
  assert.equal(selectProduct(null).role, 'server')
  assert.throws(() => selectProduct({ role: 'unknown' }))
})
