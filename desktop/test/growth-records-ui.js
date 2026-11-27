;(async()=>{
  const f=window.__fixture,wait=ms=>new Promise(ok=>setTimeout(ok,ms)),check=(v,m)=>{if(!v)throw Error(m)}
  document.addEventListener('click',e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},true)
  const until=async fn=>{const start=Date.now();while(Date.now()-start<45000){if(fn())return;await wait(100)}throw Error('UI timeout')}
  await until(()=>window.desktop&&document.querySelector('nav'))
  const s=await window.desktop.act('state');check(s.value.version===f.version,'Version mismatch')
  ;[...document.querySelectorAll('nav button')].find(b=>b.innerText.trim()==='查看资料').click();await wait(200)
  document.getElementById('record-tab-progress').click();await wait(150)
  const tree=document.querySelector('[data-testid="nebula-records"]')
  check(tree,'Tree missing')
  if(f.legacy)check(tree.innerText.includes('重新解析'),'Legacy tree should request reanalysis')
  else check(tree.innerText.includes('198')&&tree.innerText.includes('447')&&tree.innerText.includes('418'),'Tree counts lost')
  document.getElementById('record-tab-life').click();await wait(150)
  const skills=document.querySelector('[data-testid="life-skill-details"]');check(skills?.querySelectorAll('[data-career]').length===6,'Professions missing')
  const cooking=skills.querySelector('[data-career="1"]');cooking.open=true
  if(f.legacy)check(cooking.innerText.includes('重新解析'),'Old skill detail treated as empty')
  else check(cooking.innerText.includes('料理精通')&&cooking.innerText.includes('Lv. 10'),'Individual levels missing')
  check(document.documentElement.scrollWidth<=innerWidth+2,'Horizontal overflow')
  window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(e=>window.chrome.webview.postMessage({kind:'test-done',success:false,error:e.stack||e.message}))
