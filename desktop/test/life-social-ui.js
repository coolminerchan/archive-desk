;(async () => {
  const fixture = window.__fixture
  document.addEventListener('click', event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
  const pause = ms => new Promise(ok => setTimeout(ok, ms))
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  async function until(fn, label) {
    const started = Date.now()
    while (Date.now() - started < 60000) { if (await fn()) return; await pause(150) }
    throw new Error('Timed out: ' + label + '\n' + document.body.innerText)
  }
  async function state() { const result = await window.desktop.act('state'); check(!result.error, result.error); return result.value }
  async function action(name) {
    await until(() => { const b = document.querySelector(`[data-action="${name}"]:not(:disabled)`); if (!b) return false; b.click(); return true }, name)
    await pause(200)
    await until(() => !document.querySelector(`[data-action="${name}"]:disabled`), name + ' finished')
  }
  await until(() => window.desktop && document.querySelector('nav'), 'startup')
  check((await state()).version === fixture.version, 'Wrong version')
  await action('analyze')
  await until(async () => !!(await state()).captureReport?.life_social, 'legacy report')
  const getItem = (s, id) => s.captureReport.items.find(row => row.id === id)
  let current = await state()
  check(getItem(current, 'life_base').state === 'collected', 'Legacy base coverage lost')
  check(getItem(current, 'life_history').state === 'unknown', 'Legacy history was invented')
  check(getItem(current, 'social_lists').state === 'unknown', 'Legacy social type was guessed')
  check(document.body.innerText.includes('旧 ZIP 缺少请求上下文'), 'Legacy instructions missing')
  await action('analyze')
  await until(async () => getItem(await state(), 'life_history').state === 'collected', 'paired history')
  current = await state()
  check(getItem(current, 'social_lists').state === 'collected', 'Social classes incomplete')
  check(getItem(current, 'life_base').state === 'collected', 'Six profession base types incomplete')
  check(document.body.innerText.includes('生活与社交补充记录'), 'New data card missing')
  check(document.body.innerText.includes('好友申请') && document.body.innerText.includes('黑名单'), 'Class labels missing')
  check(document.body.innerText.includes('查看六类生活职业与图鉴'), 'Guidance missing')
  check([...document.querySelectorAll('.capture-steps img')].every(img => !!img.getAttribute('src')), 'Broken guide portrait')
  await action('capture-export')
  check(!!(await state()).captureDelivery?.sha256, 'Export was not validated')
  await action('analyze')
  await until(async () => (await state()).captureReport?.input === fixture.exportedZip, 'reopened archive')
  current = await state()
  check(getItem(current, 'social_lists').state === 'collected' && getItem(current, 'life_history').state === 'collected', 'Reopen lost classification')
  check(!document.querySelector('.notice.error'), 'UI error')
  document.querySelector('[data-testid="life-social-records"]').scrollIntoView({ block: 'start' })
  await pause(300)
  check(document.documentElement.scrollWidth <= innerWidth + 2, 'Horizontal overflow')
  window.chrome.webview.postMessage({ kind: 'test-done', success: true })
})().catch(error => window.chrome.webview.postMessage({ kind: 'test-done', success: false, error: error.stack || error.message }))
