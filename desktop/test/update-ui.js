;(async () => {
  const fixture = window.__fixture
  document.addEventListener('click', event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const check = (value, message) => { if (!value) throw new Error(message) }
  async function until(fn, label) {
    const started = Date.now()
    while (Date.now() - started < 60000) { if (await fn()) return; await pause(150) }
    throw new Error('Timed out: ' + label + '\n' + document.body.innerText)
  }
  async function state() { const result = await window.desktop.act('state'); check(!result.error, result.error); return result.value }
  await until(() => window.desktop && document.querySelector('nav'), 'startup')
  check((await state()).version === fixture.version, 'Wrong version')
  const settings = [...document.querySelectorAll('nav button')].find(button => button.innerText.trim() === '工具设置')
  check(settings, 'Settings navigation missing'); settings.click()
  await until(() => document.querySelector('[data-action="capture-update-check"]'), 'update controls')
  check(document.body.innerText.includes('自动选择'), 'Default route missing')
  document.querySelector('[data-action="capture-update-check"]').click()
  await until(async () => {
    const update = (await state()).captureUpdate
    check(update?.phase !== 'failed', update?.error || 'Update check failed')
    return ['current','available'].includes(update?.phase)
  }, 'signed backup feed')
  const update = (await state()).captureUpdate
  check(update.source === 'gh-proxy', 'Direct outage did not use backup')
  check(document.body.innerText.includes('更新线路') && document.body.innerText.includes('备用加速（GH-Proxy）'), 'Route display missing')
  check(!document.querySelector('.notice.error'), 'Unexpected UI error')
  document.querySelector('[data-action="capture-update-check"]').closest('.card').scrollIntoView({block:'start'})
  await pause(300)
  check(document.documentElement.scrollWidth <= innerWidth + 2, 'Horizontal overflow')
  window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(error => window.chrome.webview.postMessage({kind:'test-done',success:false,error:error.stack || error.message}))
