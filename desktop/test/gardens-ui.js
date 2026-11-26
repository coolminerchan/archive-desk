(async () => {
  // A visible test window shares the desktop. Ignore physical clicks while
  // retaining the scripted DOM clicks, so another task cannot change its page.
  document.addEventListener('click', event => {
    if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
  const fixture = window.__fixture
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  async function until(fn, label, timeout = 60000) {
    const started = Date.now()
    while (Date.now() - started < timeout) { if (await fn()) return; await wait(150) }
    throw new Error('Timed out: ' + label + '\n' + document.body.innerText)
  }
  async function state() { const result = await window.desktop.act('state'); check(!result.error, result.error); return result.value }
  async function nav(label) {
    await until(() => { const button = [...document.querySelectorAll('nav button')].find(button => button.innerText.trim() === label); if (!button) return false; button.click(); return true }, label)
    await wait(200)
  }
  async function action(name) {
    await until(() => { const button = document.querySelector(`[data-action="${name}"]:not(:disabled)`); if (!button) return false; button.click(); return true }, name)
    await wait(250)
    await until(() => !document.querySelector(`[data-action="${name}"]:disabled`), name + ' settled')
  }
  await until(() => window.desktop && document.querySelector('nav'), 'startup')
  check((await state()).version === (fixture.version || '0.5.5'), 'Wrong product version')
  if (!fixture.autoStart) await nav('装修采集')
  await until(() => document.body.innerText.includes('把喜欢的装修，单独收藏'), 'dedicated garden page')
  check(![...document.querySelectorAll('button')].some(button => button.innerText.includes('导入')), 'Garden importing must not be offered')
  if (fixture.runCapture) {
    if (!fixture.autoStart) {
      const button = document.querySelector('[data-action="capture-gardens-one-click"]'); check(button && !button.disabled, 'Garden start unavailable'); button.click()
    }
    await until(async () => { const s = await state(); return s.recording === 'recording' && s.capturePurpose === 'gardens' }, 'garden recorder ready', 120000)
    await until(() => document.body.innerText.includes('原始记录占用') && document.body.innerText.includes('448 MiB'), 'recording capacity')
    await until(async () => { const s = await state(); return !s.recording && s.captureFlow?.phase === 'complete' }, 'automatic garden stop/save', 120000)
    const saved = await state()
    check(!saved.captureGardenSavedZip, 'Empty traffic must not produce a garden collection')
    check(saved.captureFlow.hint.includes('未生成装修合集'), 'Missing empty garden explanation')
  }
  await action('capture-gardens-open')
  await until(async () => (await state()).captureGardenReport?.gardens?.length === 2, 'two visited gardens')
  check((await state()).captureReport.account_uid === 7654001, 'Account report was changed by garden capture')
  check(document.body.innerText.includes('观测家具 3 件') && document.body.innerText.includes('观测家具 4 件'), 'Furniture counts missing')
  if (fixture.expectedNames) for (const name of fixture.expectedNames) check(document.body.innerText.includes(name), 'Missing offline owner name: ' + name)
  if (fixture.expectLimit) check(document.body.innerText.includes('已达到本轮录制'), 'Limit explanation missing')
  check(!document.body.innerText.includes('测试自家'), 'Known own garden must be excluded')
  await action('capture-gardens-export-all')
  check(!!(await state()).captureGardenDelivery?.sha256, 'Validated collection delivery failed')
  await action('capture-gardens-export')
  await action('capture-gardens-open')
  await until(async () => (await state()).captureGardenReport?.input === fixture.exportAll, 'reopened collection')
  check((await state()).captureGardenReport.gardens.length === 2, 'Reopened collection lost houses')
  await nav('采集与核对')
  check(document.body.innerText.includes('UID 7654001'), 'Account overview must remain intact')
  await nav('装修采集')
  check((await state()).captureGardenReport.gardens.length === 2, 'Garden results lost on navigation')
  check(document.documentElement.scrollWidth <= innerWidth + 2, 'Garden horizontal overflow')
  check(!document.querySelector('.notice.error'), 'Garden UI error')
  check(!/上游|Lolo|Frida|miaomiao|Electron|React|Vite|OverField-Backup/.test(document.body.innerText), 'Engineering names in garden UI')
  if (fixture.view === 'results') [...document.querySelectorAll('.card')].find(card => card.innerText.includes('已采到的家园装修')).scrollIntoView({ block: 'center' })
  await wait(350)
  window.chrome.webview.postMessage({ kind: 'test-done', success: true })
})().catch(error => window.chrome.webview.postMessage({ kind: 'test-done', success: false, error: error.stack || error.message }))
