;(async () => {
  const fixture = window.__fixture
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const check = (value, message) => { if (!value) throw Error(message) }
  async function state() { const result = await window.desktop.act('state'); check(!result.error,result.error); return result.value }
  const started = Date.now()
  while (!window.desktop || !document.querySelector('nav')) {
    if (Date.now()-started>45000) throw Error('Application did not start')
    await pause(100)
  }
  check((await state()).version===fixture.version,'Original entry opened the wrong version')
  const settings=[...document.querySelectorAll('nav button')].find(button=>['设置','工具设置'].includes(button.innerText.trim()))
  check(settings,'Settings missing');settings.click();await pause(300)
  if(fixture.version==='0.7.2')check(document.body.innerText.includes('更新并重启'),'In-place update control missing')
  check(!document.querySelector('.notice.error'),'Unexpected application error')
  window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(error=>window.chrome.webview.postMessage({kind:'test-done',success:false,error:error.stack||error.message}))
