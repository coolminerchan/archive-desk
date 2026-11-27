;(async () => {
  const fixture = window.__fixture
  document.addEventListener('click', e => { if (e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation() } }, true)
  const pause = ms => new Promise(ok => setTimeout(ok, ms)), check = (v, m) => { if (!v) throw Error(m) }
  const until = async fn => { const start = Date.now(); while (Date.now() - start < 45000) { if (fn()) return; await pause(100) } throw Error('UI timeout: ' + document.body.innerText.slice(0, 1500)) }
  const nav = async label => { const b = [...document.querySelectorAll('nav button')].find(b => b.innerText.trim() === label); check(b, 'Missing nav: ' + label); b.click(); await pause(150) }
  await until(() => window.desktop && document.querySelector('[data-testid="record-shortcuts"]'))
  const state = await window.desktop.act('state')
  check(!state.error && state.value.version === fixture.version, 'Version mismatch')
  const buttons = [...document.querySelectorAll('[data-testid="record-shortcuts"] button')]
  check(buttons.length === 4, 'Record shortcuts missing')
  check(buttons.every(b => b.querySelector('img')?.complete && b.querySelector('img')?.naturalWidth > 0), 'Shortcut game portrait missing')
  buttons.find(b => b.innerText.includes('星云树')).click()
  await until(() => document.querySelector('[data-testid="nebula-records"]'))
  const nebula = document.querySelector('[data-testid="nebula-records"]')
  if (fixture.legacy) {
    check(nebula.innerText.includes('旧报告未展开') && nebula.innerText.includes('重新解析'), 'Legacy data treated as missing')
  } else {
    check(nebula.innerText.includes('198') && nebula.innerText.includes('447') && nebula.innerText.includes('418'), 'Captured tree counts lost')
    check(nebula.querySelectorAll('tbody tr').length === 8, 'Tree pages lost')
  }
  const skills = document.querySelector('[data-testid="life-skill-details"]')
  check(skills && skills.querySelectorAll('[data-career]').length === 6, 'Six life careers missing')
  const cooking = skills.querySelector('[data-career="1"]'), fishing = skills.querySelector('[data-career="2"]')
  cooking.open = true; fishing.open = true
  if (fixture.legacy) check(cooking.innerText.includes('重新解析') && !cooking.innerText.includes('空技能列表'), 'Old cached skills were silently zeroed')
  else {
    check(cooking.innerText.includes('料理精通') && cooking.innerText.includes('Lv. 10'), 'Individual cooking skill level missing')
    check(fishing.innerText.includes('幸运'), 'Profession-scoped skill names crossed')
    const gathering = skills.querySelector('[data-career="6"]'); gathering.open = true
    check(gathering.innerText.includes('空技能列表'), 'Observed empty skill list treated as missing')
  }
  await nav('水晶与景点')
  check(document.body.innerText.includes('水晶怎么采') && document.body.innerText.includes('美丽景点怎么采'), 'Action instructions missing')
  check(document.querySelector('[data-testid="world-activities"]')?.innerText.includes('42'), 'Scenic evidence regressed')
  await nav('采集与核对')
  document.querySelector('[data-testid="record-shortcuts"] button:last-child').click()
  await until(() => document.querySelector('[data-testid="life-skill-details"]'))
  if (fixture.screenshotView === 'overview') await nav('采集与核对')
  else if (fixture.screenshotView === 'exploration') await nav('水晶与景点')
  else if (fixture.screenshotView === 'skills') {
    const s = document.querySelector('[data-testid="life-skill-details"]')
    s.querySelector('[data-career="1"]').open = true; s.querySelector('[data-career="2"]').open = true
    s.scrollIntoView({ block: 'start' })
  }
  await pause(250)
  check(document.documentElement.scrollWidth <= innerWidth + 2, 'Horizontal overflow')
  window.chrome.webview.postMessage({ kind: 'test-done', success: true })
})().catch(e => window.chrome.webview.postMessage({ kind: 'test-done', success: false, error: e.stack || e.message }))
