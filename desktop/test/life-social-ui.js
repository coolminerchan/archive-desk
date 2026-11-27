;(async()=>{
  const f=window.__fixture,wait=ms=>new Promise(ok=>setTimeout(ok,ms)),check=(v,m)=>{if(!v)throw Error(m)}
  document.addEventListener('click',e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},true)
  const until=async(fn,label)=>{const start=Date.now();while(Date.now()-start<60000){if(await fn())return;await wait(100)}throw Error('Timed out: '+label)}
  const state=async()=>{const r=await window.desktop.act('state');check(!r.error,r.error);return r.value}
  const nav=async label=>{[...document.querySelectorAll('nav button')].find(b=>b.innerText.trim()===label).click();await wait(150)}
  const action=async name=>{const b=[...document.querySelectorAll(`[data-action="${name}"]:not(:disabled)`)].find(b=>b.checkVisibility());check(b,'Missing '+name);b.click();await wait(200);await until(()=>!b.isConnected||!b.disabled,name)}
  const item=(s,id)=>s.captureReport.items.find(r=>r.id===id)
  await until(()=>window.desktop&&document.querySelector('nav'),'startup')
  check((await state()).version===f.version,'Version mismatch')
  await nav('备份账号');await action('analyze')
  await until(async()=>!!(await state()).captureReport?.life_social,'legacy report')
  let s=await state();check(item(s,'life_base').state==='collected','Legacy base lost')
  check(item(s,'life_history').state==='unknown'&&item(s,'social_lists').state==='unknown','Legacy classifications invented')
  await action('analyze');await until(async()=>item(await state(),'life_history').state==='collected','history classified')
  s=await state();check(item(s,'social_lists').state==='collected'&&item(s,'life_base').state==='collected','Classified records missing')
  await nav('查看资料');document.getElementById('record-tab-life').click();await wait(150)
  check(document.querySelectorAll('[data-career]').length===6,'Profession cards missing')
  document.getElementById('record-tab-social').click();await wait(150)
  check(document.body.innerText.includes('好友申请')&&document.body.innerText.includes('黑名单'),'Social class labels missing')
  await nav('备份账号');await action('capture-export');check((await state()).captureDelivery?.sha256,'Export validation missing')
  await action('analyze');await until(async()=>(await state()).captureReport.input===f.exportedZip,'reopened export')
  s=await state();check(item(s,'social_lists').state==='collected'&&item(s,'life_history').state==='collected','Roundtrip lost classification')
  await nav('查看资料');document.getElementById('record-tab-life').click();await wait(200)
  check(!document.querySelector('.notice.error'),'UI error');check(document.documentElement.scrollWidth<=innerWidth+2,'Horizontal overflow')
  window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(e=>window.chrome.webview.postMessage({kind:'test-done',success:false,error:e.stack||e.message}))
