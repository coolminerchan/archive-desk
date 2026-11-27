;(async()=>{
  const f=window.__fixture,wait=ms=>new Promise(ok=>setTimeout(ok,ms)),check=(v,m)=>{if(!v)throw Error(m)}
  const until=async(fn,label,timeout=60000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await wait(150)}throw Error('Timed out: '+label)}
  const state=async()=>{const r=await window.desktop.act('state');check(!r.error,r.error);return r.value}
  const nav=async label=>{[...document.querySelectorAll('nav button')].find(b=>b.innerText.trim()===label).click();await wait(150)}
  const action=async name=>{const b=[...document.querySelectorAll(`[data-action="${name}"]:not(:disabled)`)].find(b=>b.checkVisibility());check(b,'Missing '+name);b.click();await wait(200);await until(()=>!b.isConnected||!b.disabled,name)}
  await until(()=>window.desktop&&document.querySelector('nav'),'startup')
  check((await state()).version===f.version,'Version mismatch')
  if(f.runCapture){
    if(!f.autoStart)await action('capture-one-click')
    await until(async()=>(await state()).recording==='recording','recorder ready')
    check((await state()).captureFlow.launcher===f.game,'Wrong selected client')
    await until(async()=>!(await state()).recording&&(await state()).captureFlow?.phase==='complete','automatic finish',120000)
    const s=await state();check(!s.captureError&&!s.captureSavedZip,'Empty test traffic invented an account ZIP')
    check(s.captureFlow.hint.includes('未生成账号 ZIP'),'Empty capture needs an honest explanation')
  }
  await action('analyze');await until(async()=>(await state()).captureReport?.equipment?.weapon?.observed===(f.expectedWeapons||13),'equipment report')
  const report=(await state()).captureReport
  if(f.expectedUid){check(report.account_uid===f.expectedUid&&report.accounts_detail[0].player_label===f.expectedUid,'Wrong public UID');check(document.body.innerText.includes('UID '+f.expectedUid),'Public UID hidden')}
  if(f.expectedDungeons!=null){check(report.dungeons.observed_count===f.expectedDungeons&&report.dungeons.detailed_count===0,'Dungeon coverage wrong')
    await nav('设置');document.querySelector('[data-testid="capture-diagnostics"]').open=true;await action('capture-export-diagnostics')
    await until(()=>document.body.innerText.includes('诊断文件已保存'),'diagnostic confirmation')
  }
  await nav('查看资料');document.getElementById('record-tab-exploration').click();await wait(200)
  check(document.querySelector('[data-testid="map-records"]'),'Map records missing')
  if(f.view==='dungeons'){document.getElementById('record-tab-dungeons').click();await wait(150)}
  else if(f.view==='quality'){await nav('设置');document.querySelector('[data-testid="capture-diagnostics"]').open=true}
  else if(['overview','guide'].includes(f.view)){await nav('备份账号');if(f.view==='guide')document.querySelector('[data-testid="capture-process"]').scrollIntoView({block:'start'})}
  check(document.documentElement.scrollWidth<=innerWidth+2,'Horizontal overflow');check(!document.querySelector('.notice.error'),'UI error')
  check(!/上游|Lolo|Frida|miaomiao|Electron|React|Vite|OverField-Backup/.test(document.body.innerText),'Engineering names in UI')
  await wait(200);window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(e=>window.chrome.webview.postMessage({kind:'test-done',success:false,error:e.stack||e.message}))
