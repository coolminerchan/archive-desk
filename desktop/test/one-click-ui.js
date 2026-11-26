(async () => {
  const fixture = window.__fixture
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const check = (ok, label) => { if (!ok) throw new Error(label) }
  async function until(fn, label, timeout = 60000) {
    const start = Date.now()
    while (Date.now() - start < timeout) { if (await fn()) return; await wait(150) }
    throw new Error('Timed out: ' + label + '\n' + document.body.innerText)
  }
  async function state() { const r = await window.desktop.act('state'); check(!r.error, r.error); return r.value }
  async function action(name) {
    await until(() => { const b = document.querySelector('[data-action="' + name + '"]:not(:disabled)'); if (!b) return false; b.click(); return true }, name)
    await wait(200)
  }
  async function button(label) {
    await until(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === label && !b.disabled); if (!b) return false; b.click(); return true }, label)
    await wait(200)
  }
  await until(() => window.desktop && document.querySelector('nav'), 'startup')
  check((await state()).version === (fixture.version || '0.4.1'), 'Wrong version')
  if (!fixture.autoStart) await until(() => document.body.innerText.includes('一键采集并打开游戏'), 'one-click action')
  check(!document.querySelector('input[placeholder="留空使用 PC 常用端口"]'), 'Advanced connection fields must be hidden initially')
  if (fixture.runCapture) {
    if (!fixture.autoStart) await action('capture-one-click')
    await until(async () => (await state()).recording === 'recording', 'recording ready')
    check((await state()).captureFlow.launcher === fixture.game, 'Wrong game selected')
    await until(async () => !(await state()).recording && (await state()).captureFlow?.phase === 'complete', 'automatic game-exit save', 120000)
    check(!(await state()).captureError, 'Capture error')
    check(!(await state()).captureSavedZip, 'Empty test traffic must not produce an account ZIP')
    check((await state()).captureFlow.hint.includes('未生成账号 ZIP'), 'No misleading completion message')
  }
  await action('analyze')
  await until(() => document.body.innerText.includes('全部来源 ' + (fixture.expectedWeapons || 13) + ' 件'), 'equipment report')
  if (fixture.expectedUid) {
    const report = (await state()).captureReport
    check(report.account_uid === fixture.expectedUid, 'Wrong account UID')
    check(report.accounts_detail[0].player_label === fixture.expectedUid, 'Wrong public account identity')
    check(document.body.innerText.includes('UID ' + fixture.expectedUid), 'Public UID missing from overview')
    check(!document.body.innerText.includes('UID ' + report.accounts_detail[0].player_id), 'Internal ID presented as login UID')
    const portraits = [...document.querySelectorAll('.capture-steps .step-avatar img')].map(img => img.src)
    check(portraits.length === 6 && new Set(portraits).size === 6, 'Guide portraits must be six different images')
  }
  if (fixture.expectedDungeons != null) {
    const report = (await state()).captureReport
    check(report.dungeons.observed_count === fixture.expectedDungeons, 'Wrong observed dungeon count')
    check(report.dungeons.detailed_count === 0, 'Unexpected dungeon detail coverage')
    check(document.body.innerText.includes('采集质量与耗时'), 'Quality and timings missing')
    check(document.body.innerText.includes('小副本观测记录'), 'Dungeon report missing')
    check(document.body.innerText.includes('未解析尾数据'), 'Tail evidence missing')
    await action('capture-export-diagnostics')
    await until(() => document.body.innerText.includes('诊断 JSON 已保存'), 'diagnostic export')
  }
  await button('探索证据')
  await until(() => document.body.innerText.includes('地图信息怎么采集'), 'map instructions')
  check(document.body.innerText.includes('情绪月亮'), 'Moon guidance missing')
  check(document.body.innerText.includes('收集物观测'), 'Collection column missing')
  if (['overview', 'guide', 'quality', 'dungeons'].includes(fixture.view)) await button('采集与核对')
  if (fixture.view === 'guide') document.querySelector('.capture-steps').scrollIntoView({ block: 'center' })
  if (fixture.view === 'quality') [...document.querySelectorAll('.card')].find(card => card.innerText.includes('采集质量与耗时')).scrollIntoView({ block: 'center' })
  if (fixture.view === 'dungeons') {
    const card = [...document.querySelectorAll('.card')].find(card => card.innerText.includes('小副本观测记录'))
    card.querySelector('details').open = true
    card.scrollIntoView({ block: 'start' })
  }
  check(document.documentElement.scrollWidth <= innerWidth + 2, 'Window horizontal overflow')
  check(!document.querySelector('.notice.error'), 'UI error')
  check(!/上游|Lolo|Frida|miaomiao|Electron|React|Vite|OverField-Backup/.test(document.body.innerText), 'Engineering names in UI')
  await wait(350)
  window.chrome.webview.postMessage({ kind: 'test-done', success: true })
})().catch(error => window.chrome.webview.postMessage({ kind: 'test-done', success: false, error: error.stack || error.message }))
