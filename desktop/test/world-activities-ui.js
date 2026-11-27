;(async()=>{
  const fixture=window.__fixture
  document.addEventListener('click',e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},true)
  const wait=ms=>new Promise(ok=>setTimeout(ok,ms)),check=(v,m)=>{if(!v)throw Error(m)}
  async function until(fn){const started=Date.now();while(Date.now()-started<45000){if(await fn())return;await wait(150)}throw Error('UI timeout')}
  async function state(){const r=await window.desktop.act('state');check(!r.error,r.error);return r.value}
  async function nav(label){await until(()=>{const b=[...document.querySelectorAll('nav button')].find(x=>x.innerText.trim()===label);if(!b)return false;b.click();return true});await wait(300)}
  await until(()=>window.desktop&&document.querySelector('nav'))
  check((await state()).version===fixture.version,'Version mismatch')
  await nav('探索证据')
  check(document.body.innerText.includes('樱庭世界·昼')&&document.body.innerText.includes('鸳鸯锅')&&document.body.innerText.includes('星愿学园'),'Scene names missing')
  const table=document.querySelector('[data-testid="world-activities"]');check(table,'Activity evidence table missing')
  check(table.innerText.includes('42')&&table.innerText.includes('110')&&table.innerText.includes('100'),'Activity counts missing')
  check(table.innerText.includes('完成状态未知'),'Unknown completion label missing')
  table.scrollIntoView({block:'start'});await wait(300)
  check(document.documentElement.scrollWidth<=innerWidth+2,'Horizontal overflow')
  await nav('本人场景')
  check(document.body.innerText.includes('罗塔花园广场')&&document.body.innerText.includes('贝海姆世界·正'),'Own-scene names missing')
  await nav('探索证据');document.querySelector('[data-testid="world-activities"]').scrollIntoView({block:'start'});await wait(300)
  window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(e=>window.chrome.webview.postMessage({kind:'test-done',success:false,error:e.stack||e.message}))
