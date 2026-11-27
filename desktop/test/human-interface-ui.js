;(async()=>{
  const f=window.__fixture,wait=ms=>new Promise(ok=>setTimeout(ok,ms)),check=(v,m)=>{if(!v)throw Error(m)}
  document.addEventListener('click',e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},true)
  const until=async(fn,label)=>{const start=Date.now();while(Date.now()-start<45000){if(await fn())return;await wait(100)}throw Error('UI timeout: '+label+'\n'+document.body.innerText.slice(0,1000))}
  const state=async()=>{const r=await window.desktop.act('state');check(!r.error,r.error);return r.value}
  const nav=async label=>{const b=[...document.querySelectorAll('nav button')].find(b=>b.innerText.trim()===label);check(b,'Missing navigation '+label);b.click();await wait(120)}
  const tab=async id=>{const b=document.getElementById('record-tab-'+id);check(b,'Missing record tab '+id);b.click();await wait(120)}
  const act=async name=>{const b=[...document.querySelectorAll(`[data-action="${name}"]:not(:disabled)`)].find(el=>el.checkVisibility());check(b,'Unavailable action '+name);b.click();await wait(200);await until(()=>!b.isConnected||!b.disabled,'action '+name)}
  const visible=()=>document.querySelector('.content').innerText
  if(f.uiState)window.__uiState=f.uiState
  await until(()=>window.desktop&&document.querySelector('nav'),'startup')
  await until(async()=>(await state()).version===f.version,'version')
  await until(()=>document.querySelector('.app-credit')?.innerText.includes(f.version),'rendered profile')
  check([...document.querySelectorAll('nav button')].map(b=>b.innerText.trim()).join('|')==='备份账号|查看资料|家园装修|设置','Primary navigation must have four destinations')
  if(f.mode==='recording'||f.mode==='saving'||f.mode==='error'){
    await until(()=>f.mode==='error'?document.querySelector('[role="alert"]'):visible().includes(f.mode==='saving'?'正在整理备份':'正在记录你的冒险'),'simulated state')
    if(f.mode==='recording'){
      check(!!document.querySelector('[data-action="capture-stop"]:not(:disabled)'),'Recording must offer a working stop action')
      check(document.querySelector('[data-testid="recording-guidance"]'),'Recording guidance missing')
      const guideImages=[...document.querySelectorAll('.capture-steps .step-avatar img')]
      check(guideImages.length===8&&new Set(guideImages.map(i=>i.src)).size===8,'Distinct game guide portraits lost')
      check(!visible().includes('TCP')&&!visible().includes('解码失败'),'Technical details crowd recording')
    }else if(f.mode==='saving')check(!!document.querySelector('[data-action="capture-stop"]:disabled'),'Saving must not offer repeated stop')
    else check(document.querySelector('[role="alert"]').innerText.includes('测试错误'),'Actionable error hidden')
  }else if(f.mode==='idle'){
    check(document.querySelector('[data-action="capture-one-click"]:not(:disabled)'),'Start action missing')
    check(!document.querySelector('[data-testid="backup-result"]'),'Idle invents an account result')
    check(!visible().includes('尚缺响应')&&!visible().includes('未知')&&!visible().includes('TCP'),'Idle screen looks like failed capture')
    check(document.querySelector('.content').getBoundingClientRect().height<innerHeight+120,'Idle screen too long')
  }else if(f.mode==='legacy'){
    await until(()=>document.querySelector('[data-testid="backup-result"]'),'legacy account')
    await nav('查看资料');await tab('progress')
    check(visible().includes('尚未展开星云树')&&visible().includes('重新解析'),'Legacy tree treated as missing progress')
    await tab('life');document.querySelector('[data-career="1"]').open=true
    check(visible().includes('重新解析')&&!visible().includes('暂时收到空列表'),'Legacy skill detail silently zeroed')
  }else{
    await until(()=>document.querySelector('[data-testid="backup-result"]'),'real result')
    check(visible().includes('466')&&visible().includes('893')&&visible().includes('4370'),'Key equipment counts hidden')
    check(!document.querySelector('[data-testid="capture-checklist-disclosure"]').open,'Full checklist overwhelms default home')
    check(!visible().includes('GetLifeInfoRsp')&&!visible().includes('TCP')&&!visible().includes('447'),'Detailed evidence leaks onto home')
    if(f.testActions){
      const before=(await state()).captureReport.input
      await act('analyze');check((await state()).captureReport.input===before,'Cancelled open changed result')
      await act('analyze');await until(async()=>(await state()).captureReport.input===f.accountZip,'native archive import')
      await act('capture-export');check((await state()).captureDelivery?.sha256,'Verified export failed')
      check(document.body.innerText.includes('备份已保存'),'Save confirmation missing')
    }
    await nav('查看资料')
    check(document.querySelectorAll('[role="tab"]').length===7,'Record categories missing')
    check(visible().includes('466')&&visible().includes('893')&&visible().includes('4370'),'Equipment records lost')
    await tab('exploration')
    check(document.querySelector('[data-testid="world-activities"]').innerText.includes('42'),'Scenic records lost')
    check(document.querySelector('[data-testid="map-records"]'),'Map records missing')
    check(!visible().includes('未命名场景 6')&&!visible().includes('目录待匹配'),'Reference-only diagnostics clutter map defaults')
    await tab('progress')
    const tree=document.querySelector('[data-testid="nebula-records"]')
    check(tree.innerText.includes('198')&&tree.innerText.includes('447')&&tree.innerText.includes('418'),'Tree counts lost')
    await tab('life')
    const careers=document.querySelectorAll('[data-career]');check(careers.length===6,'Profession cards missing')
    check([...careers].every(c=>!c.open),'All skill details should be closed initially')
    const cooking=document.querySelector('[data-career="1"]');cooking.open=true
    check(visible().includes('料理精通')&&visible().includes('Lv. 10'),'Skill levels missing')
    document.querySelector('[data-career="2"]').open=true
    check(visible().includes('钓鱼专精'),'Fishing skill names crossed')
    await tab('social');check(document.querySelector('[data-testid="social-records"]'),'Social section missing')
    await tab('dungeons');check(document.querySelector('[data-testid="dungeon-records"]'),'Dungeon section missing')
    await tab('scenes');check(document.querySelector('[data-testid="world-scene-records"]')&&document.querySelector('[data-testid="garden-scene-records"]'),'Scene categories lost')
    await tab('records')
    const focused=document.getElementById('record-tab-records');focused.focus();focused.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await wait(150)
    check(document.activeElement.id==='record-tab-exploration'&&document.activeElement.getAttribute('aria-selected')==='true','Keyboard tab navigation failed')
    await nav('设置')
    check(!document.querySelector('[data-testid="capture-diagnostics"]').open&&!document.querySelector('[data-testid="advanced-capture"]').open,'Settings reveal all technical options by default')
    check(!visible().includes('连接 IP')&&!visible().includes('TCP 缺口'),'Advanced fields not hidden')
    document.querySelector('[data-testid="advanced-capture"]').open=true
    check(document.querySelector('select')&&visible().includes('我仅采集自己已获授权的连接'),'Manual capture no longer available')
    check(!!document.querySelector('[data-action="capture-start"]:disabled'),'Manual capture must require consent')
    await nav('家园装修')
    check(!!document.querySelector('[data-action="capture-gardens-one-click"]'),'Separate garden capture missing')
    check(!visible().includes('导入'),'Garden import unexpectedly offered')
    if(f.mode==='equipment'){await nav('查看资料')}
    else if(['exploration','progress','life','social','dungeons','scenes'].includes(f.mode)){await nav('查看资料');await tab(f.mode);if(f.mode==='life')document.querySelector('[data-career="1"]').open=true}
    else if(f.mode==='settings')await nav('设置')
    else if(f.mode==='home')await nav('备份账号')
  }
  await wait(200)
  check(document.documentElement.scrollWidth<=innerWidth+2,'Horizontal overflow')
  check(!document.querySelector('.notice.error')||f.mode==='error','Unexpected UI error')
  window.chrome.webview.postMessage({kind:'test-done',success:true})
})().catch(e=>window.chrome.webview.postMessage({kind:'test-done',success:false,error:e.stack||e.message}))
