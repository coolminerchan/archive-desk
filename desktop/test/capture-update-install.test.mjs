import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { apply, atomicJSON, cleanupHelpers, createManifest, directory, ensureDirectory, EXECUTABLE, inside, JOURNAL, legacyOrigin, makePlan, MANIFEST, product, removeOwned, rollback, startApply, validatePlan, verifyPackage } from '../capture-update-install.mjs'

const trust = { repository:'example/archive',public_key:'fixture-public-key' }
async function bundle(path, version, { inventory = true, publisher = trust } = {}) {
  await mkdir(join(path,'resources/app'),{recursive:true}); await mkdir(join(path,'runtime'))
  for (const [name, body] of [[EXECUTABLE,'host-'+version],['runtime/node.exe','node-'+version],['resources/app/main.mjs','app-'+version],
    ['resources/app/product.json',JSON.stringify({role:'capture',version})],['resources/app/capture-update.json',JSON.stringify(publisher)]])
    await writeFile(join(path,name),body)
  if (inventory) await createManifest(path,version)
}
async function fixture(run, tempRoot = tmpdir()) {
  const root = await mkdtemp(join(tempRoot,'capture-in-place-'))
  try {
    const target=join(root,'original path 原目录'), source=join(root,'staged package'), helper=join(root,'helper')
    await bundle(target,'0.7.1',{inventory:false}); await bundle(source,'0.7.2'); await mkdir(helper)
    await run({root,target,source,helper})
  } finally {
    assert.equal(dirname(resolve(root)),resolve(tempRoot)); assert.ok(basename(root).startsWith('capture-in-place-'))
    await rm(root,{recursive:true,force:true})
  }
}
test('in-place replacement keeps the exact entry, unrelated root files and previous program components',async()=>fixture(async({target,source,helper})=>{
  await writeFile(join(target,'my-account.zip'),'user-backup')
  await writeFile(join(target,'resources/app/stale.js'),'old-owned-file')
  const plan=await makePlan(target,source,helper,'0.7.2')
  const result=await apply(plan,{beforeReplace:async name=>{
    if(name==='resources') {
      assert.equal(await readFile(join(target,EXECUTABLE),'utf8'),'host-0.7.2')
      assert.equal(await readFile(join(plan.backup,EXECUTABLE),'utf8'),'host-0.7.1')
    }
  }})
  assert.equal(result.executable,join(await realpath(target),EXECUTABLE))
  assert.equal((await product(target)).version,'0.7.2')
  assert.equal(await readFile(join(target,'my-account.zip'),'utf8'),'user-backup')
  assert.equal(await readFile(join(result.backup,EXECUTABLE),'utf8'),'host-0.7.1')
  assert.equal(await readFile(join(result.backup,'resources/app/stale.js'),'utf8'),'old-owned-file')
  assert.ok(!(await readdir(join(target,'resources/app'))).includes('stale.js'))
}))
test('replacement failures restore every moved component without removing unrelated files',async()=>{
  for(const failAt of [EXECUTABLE,'runtime','resources',MANIFEST])await fixture(async({target,source,helper})=>{
    await writeFile(join(target,'notes.txt'),'keep')
    const plan=await makePlan(target,source,helper,'0.7.2')
    await assert.rejects(apply(plan,{beforeReplace:name=>{if(name===failAt)throw Error('Injected replacement failure')}}),/Injected/)
    assert.equal((await product(target)).version,'0.7.1')
    assert.equal(await readFile(join(target,EXECUTABLE),'utf8'),'host-0.7.1')
    assert.equal(await readFile(join(target,'notes.txt'),'utf8'),'keep')
    assert.equal(JSON.parse(await readFile(join(target,JOURNAL))).phase,'rolled_back')
  })
})
test('an interrupted rename can recover even while application metadata is missing',async()=>fixture(async({target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  await mkdir(plan.backup)
  await rename(join(target,'resources'),join(plan.backup,'resources'))
  await atomicJSON(join(target,JOURNAL),{...plan,phase:'applying',operations:[{name:'resources',existed:true}]})
  await rm(source,{recursive:true,force:true})
  await assert.rejects(apply(plan),{code:'ENOENT'})
  await rollback(plan)
  assert.equal((await product(target)).version,'0.7.1')
}))
test('tampered stage files fail before the original installation changes',async()=>fixture(async({target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  await writeFile(join(source,'runtime/node.exe'),'tampered')
  await assert.rejects(apply(plan),/changed/)
  assert.equal((await product(target)).version,'0.7.1')
}))
test('another publisher, a downgrade and overlapping directories cannot be applied',async()=>fixture(async({target,source,helper})=>{
  await assert.rejects(makePlan(target,source,helper,'0.7.1'))
  await writeFile(join(source,'resources/app/capture-update.json'),JSON.stringify({...trust,repository:'other/project'}))
  await createManifest(source,'0.7.2')
  await assert.rejects(makePlan(target,source,helper,'0.7.2'),/publisher/)
  assert.equal(inside(target,join(target,'resources')),true)
  assert.equal(inside(target,target),false)
  assert.equal(inside(target,join(dirname(target),'outside')),false)
  const nested=join(target,'nested-source');await bundle(nested,'0.7.2')
  await assert.rejects(makePlan(target,nested,helper,'0.7.2'),/overlap/)
}))
test('helper cleanup retains active helpers and directories containing unrelated files',async()=>fixture(async({root})=>{
  const userData=join(root,'user-data'), updates=join(userData,'updates')
  for(const [digit,pid,extra] of [['1',2147483647,false],['2',2147483647,true],['3',process.pid,false]]) {
    const helper=join(updates,'apply-'+digit.repeat(32));await mkdir(helper,{recursive:true})
    await atomicJSON(join(helper,'result.json'),{kind:'capture_update_result',phase:'committed',pid})
    if(extra)await writeFile(join(helper,'user-notes.txt'),'keep')
  }
  await cleanupHelpers(userData)
  assert.deepEqual((await readdir(updates)).sort(),['apply-'+'2'.repeat(32),'apply-'+'3'.repeat(32)])
}))
test('package inventories reject additional executables and path traversal',async()=>fixture(async({source})=>{
  await writeFile(join(source,'unrelated.exe'),'unexpected')
  await assert.rejects(verifyPackage(source,'0.7.2'),/Unexpected/)
  await rm(join(source,'unrelated.exe'))
  const manifest=JSON.parse(await readFile(join(source,MANIFEST)))
  manifest.files[0].path='../outside'
  await atomicJSON(join(source,MANIFEST),manifest)
  await assert.rejects(verifyPackage(source,'0.7.2'),/Invalid/)
}))
test('two update helpers cannot replace the same installation concurrently',async()=>fixture(async({target,source,helper})=>{
  const a=await makePlan(target,source,helper,'0.7.2'), b=await makePlan(target,source,helper,'0.7.2')
  let entered,release
  const ready=new Promise(ok=>{entered=ok}), gate=new Promise(ok=>{release=ok})
  const first=apply(a,{beforeReplace:async name=>{if(name===EXECUTABLE){entered();await gate}}})
  await ready
  try { await assert.rejects(apply(b),/already active/) } finally { release() }
  await first
  assert.equal((await product(target)).version,'0.7.2')
  assert.equal(JSON.parse(await readFile(join(target,JOURNAL))).id,a.id)
}))
test('an existing interrupted transaction must recover before preparing another update',async()=>fixture(async({target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  await atomicJSON(join(target,JOURNAL),{...plan,phase:'preparing',operations:[]})
  await assert.rejects(makePlan(target,source,helper,'0.7.2'),/recover first/)
  await assert.rejects(apply(plan),/recover first/)
  assert.equal((await product(target)).version,'0.7.1')
}))
test('legacy migration requires the matching update cache record and collector origin',async()=>fixture(async({root,target})=>{
  const userData=join(root,'settings'), source=join(userData,'updates/version-0.7.2-12345678')
  await bundle(source,'0.7.2')
  await atomicJSON(join(userData,'updates/prepared.json'),{path:source,version:'0.7.2'})
  const input={here:join(source,'resources/app'),userData,origin:target}
  assert.equal((await legacyOrigin(input)).target,await realpath(target))
  assert.equal(await legacyOrigin({...input,origin:source}),null)
  assert.equal(await legacyOrigin({...input,origin:root}),null)
  await atomicJSON(join(userData,'updates/prepared.json'),{path:join(root,'other'),version:'0.7.2'})
  assert.equal(await legacyOrigin(input),null)
}))

test('real Windows short and long aliases, case, spaces and Chinese retain the same installation', {skip:process.platform!=='win32'}, async t=>{
  const shortTemp=process.env.CAPTURE_TEST_SHORT_TEMP || tmpdir()
  if(resolve(shortTemp).toLowerCase()===(await realpath(shortTemp)).toLowerCase())return t.skip('No real 8.3 TEMP alias available')
  await fixture(async({target,source,helper})=>{
    await writeFile(join(target,'my-account.zip'),'keep-account')
    assert.equal((await product(target.toUpperCase())).version,'0.7.1')
    assert.equal(await directory(target),await realpath(target))
    const plan=await makePlan(target.toUpperCase(),await realpath(source),helper,'0.7.2')
    assert.equal(plan.target,await realpath(target))
    assert.equal(plan.source,await realpath(source))
    assert.equal(plan.helper,await realpath(helper))
    await assert.rejects(validatePlan({...plan,helper:target.toUpperCase()}),/overlap/)
    await apply(plan)
    assert.equal((await product(target)).version,'0.7.2')
    assert.equal(await readFile(join(target,'my-account.zip'),'utf8'),'keep-account')
  },shortTemp)
})

for(const type of ['dir','junction'])test('real '+type+' is rejected at every root and ancestor before normalization',async t=>fixture(async paths=>{
  const {root,target,source,helper}=paths
  for(const slot of ['target','source','helper'])for(const ancestor of [false,true]){
    const link=join(root,'link-'+slot+'-'+ancestor), destination=ancestor?dirname(paths[slot]):paths[slot]
    try{await symlink(destination,link,type)}catch(error){if(['EPERM','ENOTSUP','EACCES'].includes(error.code))return t.skip('Cannot create '+type+': '+error.code);throw error}
    try{
      const candidate=ancestor?join(link,basename(paths[slot])):link
      const args={target,source,helper,[slot]:candidate}
      await assert.rejects(makePlan(args.target,args.source,args.helper,'0.7.2'),/redirected/)
      await assert.rejects(directory(candidate),/redirected/)
      const plan=await makePlan(target,source,helper,'0.7.2')
      await assert.rejects(apply({...plan,[slot]:candidate}),/redirected/)
      await assert.rejects(directory(link+sep+'..'+sep+basename(target)),/Invalid update directory path/)
      assert.equal((await product(target)).version,'0.7.1')
      assert.equal((await product(source)).version,'0.7.2')
    }finally{await rm(link)}
  }
}))

test('all equal, ancestor and descendant root relationships reject after canonicalization',async()=>fixture(async({root,target,source,helper})=>{
  for(const [a,b,c] of [[target,target,helper],[target,source,target],[target,source,source],
    [root,source,helper],[target,root,helper],[target,source,root],
    [target,join(target,'resources'),helper],[target,source,join(target,'resources')],
    [target,source,join(source,'resources')],[await realpath(target),target,helper]])
    await assert.rejects(makePlan(a,b,c,'0.7.2'),/overlap/)
  const plan=await makePlan(target,source,helper,'0.7.2')
  for(const change of [{helper:plan.target},{helper:await realpath(root)},{source:plan.target},{source:join(plan.target,'resources')}])
    await assert.rejects(validatePlan({...plan,...change},{requireSource:true}),/overlap/)
  const sibling=target+'-sibling';await mkdir(sibling)
  assert.equal(inside(await directory(target),await directory(sibling)),false)
  await validatePlan({...plan,helper:await directory(sibling)},{requireSource:true})
}))

test('transaction directories cannot escape, redirect or change their recorded names',async()=>fixture(async({root,target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  for(const key of ['incoming','backup']){
    await assert.rejects(validatePlan({...plan,[key]:join(root,'outside')}),/transaction paths/)
    await assert.rejects(validatePlan({...plan,[key]:plan[key]+sep+'..'+sep+basename(plan[key])}),/transaction paths/)
    await symlink(helper,plan[key],'junction')
    try{await assert.rejects(validatePlan(plan),/redirected/)}finally{await rm(plan[key])}
  }
  assert.equal((await product(target)).version,'0.7.1')
}))

test('linked package members and metadata cannot read through another directory',async()=>fixture(async({root,target,source})=>{
  const metadata=join(target,'resources/app/product.json'), original=await readFile(metadata)
  await rm(metadata);await symlink(join(source,'resources/app/product.json'),metadata,'file')
  try{await assert.rejects(product(target),/metadata/)}finally{await rm(metadata);await writeFile(metadata,original)}
  const link=join(source,'docs');await symlink(root,link,'junction')
  try{await assert.rejects(verifyPackage(source,'0.7.2'),/Linked/)}finally{await rm(link)}
}))

test('owned cleanup validates the parent, final link and direct-child boundary',async()=>fixture(async({root,target,helper})=>{
  const marker=join(helper,'keep.txt');await writeFile(marker,'keep')
  const link=join(target,'linked');await symlink(helper,link,'junction')
  try{
    await assert.rejects(removeOwned(target,link),/cleanup|redirected/)
    await assert.rejects(removeOwned(link,marker),/redirected/)
    await assert.rejects(ensureDirectory(join(link,'must-not-be-created')),/redirected/)
  }finally{await rm(link)}
  await assert.rejects(removeOwned(target,root),/cleanup/)
  assert.equal(await readFile(marker,'utf8'),'keep')
  assert.deepEqual(await readdir(helper),['keep.txt'])
  const created=await ensureDirectory(join(root,'new-parent/child 中文'))
  assert.equal(created,await realpath(join(root,'new-parent/child 中文')))
}))

test('a rejected helper handoff cannot write a result through its unvalidated helper', {timeout:5000}, async()=>fixture(async({root,target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2'),link=join(root,'linked-helper')
  await symlink(helper,link,'junction')
  const path=join(root,'invalid-plan.json');await atomicJSON(path,{...plan,helper:link})
  try{
    await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../capture-update-apply.mjs',import.meta.url)),'--plan',path],
      {windowsHide:true,timeout:2000}),error=>error.code===1)
    assert.deepEqual(await readdir(helper),[])
    assert.equal((await product(target)).version,'0.7.1')
  }finally{await rm(link)}
}))

test('waiting for the old process is bounded by the test subprocess timeout and does not apply early', {timeout:5000}, async()=>fixture(async({root,target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2',[process.pid]),path=join(root,'wait-plan.json')
  await atomicJSON(path,plan)
  await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../capture-update-apply.mjs',import.meta.url)),'--plan',path],
    {windowsHide:true,timeout:400}),error=>error.killed===true)
  assert.equal((await product(target)).version,'0.7.1')
  assert.deepEqual(await readdir(helper),[])
}))

test('failed helper preparation removes only its own fresh helper',async()=>fixture(async({root,target,source})=>{
  const userData=join(root,'settings'),updates=join(userData,'updates')
  await mkdir(updates,{recursive:true});await writeFile(join(updates,'notes.txt'),'keep')
  await assert.rejects(startApply({here:join(source,'resources/app'),userData,source,target,version:'0.7.1',quit(){}}))
  assert.deepEqual(await readdir(updates),['notes.txt'])
  assert.equal((await product(target)).version,'0.7.1')
  const before=await readdir(target)
  await assert.rejects(startApply({here:join(source,'resources/app'),userData:target,source,target,version:'0.7.2',quit(){}}),/overlap/)
  assert.deepEqual(await readdir(target),before)
}))

test('helper cleanup retains linked roots, linked helpers and unrecognized contents',async()=>fixture(async({root,helper})=>{
  const userData=join(root,'settings'),updates=join(userData,'updates'),outside=join(helper,'keep.txt')
  await mkdir(userData);await writeFile(outside,'keep')
  await symlink(helper,updates,'junction')
  try{await cleanupHelpers(userData);assert.equal(await readFile(outside,'utf8'),'keep')}finally{await rm(updates)}
  await mkdir(updates)
  const linked=join(updates,'apply-'+'1'.repeat(32));await symlink(helper,linked,'junction')
  try{await cleanupHelpers(userData);assert.ok((await readdir(updates)).includes(basename(linked)))}finally{await rm(linked)}
}))
