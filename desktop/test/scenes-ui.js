;(async () => {
  const fixture = window.__testFixture
  document.addEventListener('click', event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
  const pause = ms => new Promise(ok => setTimeout(ok, ms))
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  async function until(fn, label) {
    const started = Date.now()
    while (Date.now() - started < 45000) { if (await fn()) return; await pause(150) }
    throw new Error('Timed out: ' + label + '\n' + document.body.innerText)
  }
  async function state() { const result = await window.desktop.act('state'); check(!result.error, result.error); return result.value }
  async function nav(label) {
    await until(() => { const button = [...document.querySelectorAll('nav button')].find(b => b.innerText.trim() === label); if (!button) return false; button.click(); return true }, label)
    await pause(200)
  }
  async function action(name) {
    await until(() => { const b = document.querySelector(`[data-action="${name}"]:not(:disabled)`); if (!b) return false; b.click(); return true }, name)
    await pause(200)
    await until(() => !document.querySelector(`[data-action="${name}"]:disabled`), name + ' finished')
  }
  await until(() => window.desktop && document.querySelector('nav'), 'startup')
  check((await state()).version === '0.6.0', 'Wrong version')
  await nav('本人场景')
  await until(() => document.body.innerText.includes('独立快照 3 份'), 'account snapshots')
  check(document.body.innerText.includes('登录 UID 7654001'), 'Public UID missing')
  check(document.body.innerText.includes('不跨快照拼接'), 'Partial-snapshot explanation missing')
  await action('capture-scenes-export')
  await action('capture-scenes-open')
  await until(async () => (await state()).captureSceneReport?.own_scenes?.snapshot_count === 3, 'reopened scenes')
  check(document.body.innerText.includes('归属来自包内索引'), 'Archive ownership must be labeled')
  check(!(await state()).captureSceneReport.account_zip, 'Scene-only data became an account archive')
  await nav('采集与核对')
  check(document.body.innerText.includes('UID 7654001'), 'Scene operations changed account state')
  await nav('工具设置')
  await action('capture-preflight')
  const preflight = (await state()).preflight
  check(preflight.checks.some(c => c.id === 'protocol' && c.ok), 'Protocol preflight failed')
  check(preflight.checks.some(c => c.id === 'output' && c.ok), 'Output preflight failed')
  await action('capture-update-check')
  check(['unavailable', 'current', 'available'].includes((await state()).captureUpdate.phase), 'Update check did not finish')
  check(!document.querySelector('.notice.error'), 'Unexpected UI error')
  check(document.documentElement.scrollWidth <= innerWidth + 2, 'Horizontal overflow')
  await nav('本人场景'); await pause(250)
  window.chrome.webview.postMessage({ kind: 'test-done', success: true })
})().catch(error => window.chrome.webview.postMessage({ kind: 'test-done', success: false, error: error.stack || error.message }))
