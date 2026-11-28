import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, lstat, mkdtemp, writeFile, readFile, mkdir, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { signedRelease, newer, releaseURL, CaptureUpdater } from '../capture-update.mjs'

const pair = generateKeyPairSync('ed25519')
const trust = { repository: 'example/archive', public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }) }
const data = Buffer.from('fake-package-for-update-orchestration')
const release = { schema: 1, role: 'capture', repository: trust.repository, version: '0.6.1',
  url: 'https://github.com/example/archive/releases/download/v0.6.1/package.zip',
  bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
function envelope(value = release) {
  const payload = Buffer.from(JSON.stringify(value))
  return { payload: payload.toString('base64'), signature: sign(null, payload, pair.privateKey).toString('base64') }
}
const locations = root => ({here:join(root,'program/resources/app'),userData:join(root,'settings')})
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'archive-update-'))
  try {
    const {here}=locations(root)
    await mkdir(here,{recursive:true})
    await writeFile(join(here, 'capture-update.json'), JSON.stringify(trust))
    await writeFile(join(here, 'product.json'), '{"role":"capture","version":"0.6.0"}')
    await run(root)
  } finally {
    assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('archive-update-'))
    await rm(root, { recursive: true, force: true })
  }
}

test('updates require our own signature, product identity, bounded size and release URL', () => {
  assert.equal(signedRelease(envelope(), trust, '0.6.0').newer, true)
  assert.equal(signedRelease(envelope(), trust, '0.6.1').newer, false)
  assert.equal(newer('0.10.0', '0.6.1'), true)
  assert.equal(newer('0.6.0', '0.6.0'), false)
  assert.equal(newer('bad', '0.6.0'), false)
  assert.throws(() => signedRelease({ ...envelope(), payload: Buffer.from('{}').toString('base64') }, trust, '0.6.0'), /签名/)
  assert.throws(() => signedRelease(envelope({ ...release, role: 'server' }), trust, '0.6.0'), /格式/)
  assert.throws(() => signedRelease(envelope({ ...release, bytes: 1e12 }), trust, '0.6.0'), /格式/)
  assert.throws(() => releaseURL('https://github.com/other/repo/releases/download/v1/a.zip', trust.repository))
  assert.throws(() => releaseURL('http://github.com/example/archive/releases/download/v1/a.zip', trust.repository))
})

test('private or absent releases are an explicit unavailable state without any account token', async () => fixture(async root => {
  const updater = new CaptureUpdater(locations(root), { fetcher: async (_url, options) => {
    assert.ok(!('Authorization' in options.headers)); return new Response('', { status: 404 })
  } })
  assert.equal(await updater.check(), false)
  assert.equal(updater.state.phase, 'unavailable')
}))

test('active capture prevents checking, downloading and launching an update', async () => {
  const updater = new CaptureUpdater({}, { idle: () => false })
  await assert.rejects(updater.check(), /结束采集/)
  await assert.rejects(updater.prepare(), /结束采集/)
  await assert.rejects(updater.launch(), /结束采集/)
})

test('closing can cancel a pending request without waiting for its network timeout', {timeout:5000}, async () => fixture(async root => {
  let started
  const ready = new Promise(ok => { started = ok })
  const updater = new CaptureUpdater(locations(root), { fetcher: async (_url, options) => {
    started()
    return new Promise((_ok, fail) => options.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true }))
  } })
  const task = updater.check()
  await ready; updater.cancel()
  await assert.rejects(task, /aborted/)
  assert.equal(updater.running, false)
}))

test('download is hashed before installation and installs in a new directory', async () => fixture(async root => {
  let calls = 0, installed
  const updater = new CaptureUpdater({ ...locations(root), python: () => 'python',
    command: (_exe, args) => ({ done: (async () => {
      const file = args[args.indexOf('--input') + 1]
      assert.deepEqual(await readFile(file), data)
      installed = args[args.indexOf('--output') + 1]
      await mkdir(installed)
      return JSON.stringify({ path: installed, executable: join(installed, '账号采集工具.exe'), version: '0.6.1' })
    })() }) }, { fetcher: async () => ++calls === 1 ? new Response(JSON.stringify(envelope())) : new Response(data) })
  await updater.check(); await updater.prepare()
  assert.equal(updater.state.phase, 'ready')
  assert.ok(installed.startsWith(join(await realpath(locations(root).userData), 'updates', 'version-0.6.1-')))
}))

test('download tampering and untrusted redirects never reach the installer', async () => fixture(async root => {
  let calls = 0, installed = false
  const updater = new CaptureUpdater({ ...locations(root), command: () => { installed = true } },
    { fetcher: async () => ++calls === 1 ? new Response(JSON.stringify(envelope())) : new Response('tampered') })
  await updater.check()
  await assert.rejects(updater.prepare(), /校验/)
  assert.equal(installed, false)
  assert.equal(updater.state.phase, 'failed')
  const redirected = new CaptureUpdater(locations(root), { fetcher: async () => new Response('', {
    status: 302, headers: { location: 'https://untrusted.example/payload' } }) })
  await assert.rejects(redirected.check(), /重定向地址/)
}))

function installing(root) {
  let count = 0
  const context = { ...locations(root), python: () => 'python', command: (_exe, args) => ({ done: (async () => {
    assert.deepEqual(await readFile(args[args.indexOf('--input') + 1]), data)
    count++
    const target = args[args.indexOf('--output') + 1]
    await mkdir(target)
    return JSON.stringify({ path: target, executable: join(target, '账号采集工具.exe'), version: release.version })
  })() }) }
  return { context, count: () => count }
}
const isMirror = url => url.hostname === 'gh-proxy.com'
const isFeed = url => url.pathname.endsWith('/capture-update.json')

test('a blocked update feed falls back without credentials and prefers that route for the package', async () => fixture(async root => {
  const install = installing(root), calls = []
  const updater = new CaptureUpdater(install.context, { fetcher: async (url, options) => {
    calls.push(url.href)
    assert.equal(options.credentials, 'omit')
    assert.ok(!Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)))
    if (!isMirror(url)) throw Error('Direct connection blocked')
    assert.ok(url.href.startsWith('https://gh-proxy.com/https://github.com/example/archive/releases/'))
    return new Response(isFeed(url) ? JSON.stringify(envelope()) : data)
  } })
  await updater.check(); await updater.prepare()
  assert.equal(updater.state.phase, 'ready')
  assert.equal(updater.state.source, 'gh-proxy')
  assert.equal(calls.length, 3)
  assert.equal(install.count(), 1)
}))

test('a timed-out connection switches to the backup feed', { timeout: 3000 }, async () => fixture(async root => {
  let calls = 0
  const updater = new CaptureUpdater(locations(root), { timeouts: { connectMs: 20 }, fetcher: async (url, options) => {
    calls++
    if (isMirror(url)) return new Response(JSON.stringify(envelope()))
    return new Promise((_ok, fail) => options.signal.addEventListener('abort', () => fail(Error('connection timeout')), { once: true }))
  } })
  await updater.check()
  assert.equal(calls, 2)
  assert.equal(updater.state.phase, 'available')
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('a 404 direct feed still permits a valid signed backup feed', async () => fixture(async root => {
  const updater = new CaptureUpdater(locations(root), { fetcher: async url =>
    isMirror(url) ? new Response(JSON.stringify(envelope())) : new Response('', { status:404 }) })
  assert.equal(await updater.check(), true)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('backup follows wrapped GitHub CDN redirects while retaining signature verification', async () => fixture(async root => {
  const calls = []
  const redirected = 'https://gh-proxy.com/https://release-assets.githubusercontent.com/github-production-release-asset/1/descriptor?sig=public-download-signature'
  const updater = new CaptureUpdater(locations(root), { fetcher:async url => {
    calls.push(url.href)
    if (!isMirror(url)) throw Error('Direct blocked')
    if (isFeed(url)) return new Response('', {status:302,headers:{location:redirected}})
    assert.equal(url.href, redirected)
    return new Response(JSON.stringify(envelope()))
  } })
  assert.equal(await updater.check(), true)
  assert.equal(calls.length, 3)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('invalid direct metadata can recover through a separately verified descriptor', async () => fixture(async root => {
  const updater = new CaptureUpdater(locations(root), { fetcher: async url =>
    new Response(isMirror(url) ? JSON.stringify(envelope()) : '<html>Connection error</html>') })
  assert.equal(await updater.check(), true)
  assert.equal(updater.release.sha256, release.sha256)
}))

test('an interrupted package restarts from zero rather than mixing bytes from both routes', async () => fixture(async root => {
  const install = installing(root), progress = []
  let updater
  updater = new CaptureUpdater({ ...install.context, send: () => progress.push([updater.state.source, updater.state.progress]) }, {
    fetcher: async url => {
      if (isFeed(url)) return new Response(JSON.stringify(envelope()))
      if (isMirror(url)) return new Response(data)
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(data.subarray(0, 8))
        setTimeout(() => controller.error(Error('Disconnected mid-transfer')), 20)
      } }))
    }
  })
  await updater.check(); await updater.prepare()
  assert.ok(progress.some(([source, percent]) => source === 'github' && percent > 0 && percent < 100))
  assert.ok(progress.some(([source, percent]) => source === 'gh-proxy' && percent === 0))
  assert.equal(install.count(), 1)
  assert.equal(updater.state.source, 'gh-proxy')
  assert.ok(!(await readdir(join(locations(root).userData, 'updates'))).some(name => /\.zip(?:\.part)?$/.test(name)))
}))

test('a stalled transfer has its own deadline and can recover on the backup route', { timeout:3000 }, async () => fixture(async root => {
  const install = installing(root)
  const updater = new CaptureUpdater(install.context, { timeouts: { idleMs:20 }, fetcher: async (url, options) => {
    if (isFeed(url)) return new Response(JSON.stringify(envelope()))
    if (isMirror(url)) return new Response(data)
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(data.subarray(0, 8))
      options.signal.addEventListener('abort', () => controller.error(Error('idle timeout')), { once:true })
    } }))
  } })
  await updater.check(); await updater.prepare()
  assert.equal(install.count(), 1)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('same-size package tampering on one route never reaches installation before a correct retry', async () => fixture(async root => {
  const install = installing(root)
  const updater = new CaptureUpdater(install.context, { fetcher: async url => {
    if (isFeed(url)) return new Response(JSON.stringify(envelope()))
    return new Response(isMirror(url) ? data : Buffer.alloc(data.length))
  } })
  await updater.check(); await updater.prepare()
  assert.equal(install.count(), 1)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('unexpected partial content and oversized responses switch routes before installation', async () => fixture(async root => {
  for (const response of [() => new Response(data.subarray(0,4), { status:206 }),
    () => new Response(data, { headers: { 'content-length':String(data.length + 1) } })]) {
    const install = installing(root)
    const updater = new CaptureUpdater(install.context, { fetcher: async url => {
      if (isFeed(url)) return new Response(JSON.stringify(envelope()))
      return isMirror(url) ? new Response(data) : response()
    } })
    await updater.check(); await updater.prepare()
    assert.equal(install.count(), 1)
    assert.equal(updater.state.source, 'gh-proxy')
  }
}))

test('the backup cannot supply an unsigned update or redirect to a different proxy target', async () => fixture(async root => {
  for (const response of [() => new Response(JSON.stringify({ ...envelope(), signature:'invalid' })),
    () => new Response(JSON.stringify(envelope({ ...release, repository:'other/repository' }))),
    () => new Response('', { status:302, headers:{ location:'https://gh-proxy.com/https://evil.example/update.json' } }),
    () => new Response('', { status:302, headers:{ location:'https://gh-proxy.com/https://github.com/other/repository/releases/latest/download/capture-update.json' } })]) {
    const calls = []
    const updater = new CaptureUpdater(locations(root), { fetcher: async url => {
      calls.push(url.href)
      return isMirror(url) ? response() : new Response('', { status:503 })
    } })
    await assert.rejects(updater.check(), /签名|重定向地址|格式/)
    assert.equal(updater.release, null)
    assert.equal(calls.length, 2)
    assert.equal(updater.state.phase, 'failed')
  }
}))

test('cancelling a backup download prevents another route and removes partial bytes', {timeout:5000}, async () => fixture(async root => {
  let started, downloads = 0
  const ready = new Promise(resolve => { started = resolve })
  const install = installing(root)
  const updater = new CaptureUpdater(install.context, { fetcher: async (url, options) => {
    if (isFeed(url)) {
      if (!isMirror(url)) throw Error('Direct blocked')
      return new Response(JSON.stringify(envelope()))
    }
    downloads++
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(data.subarray(0,8))
      options.signal.addEventListener('abort', () => controller.error(Error('aborted')), { once:true })
      started()
    } }))
  } })
  await updater.check()
  const task = updater.prepare()
  await ready; updater.cancel()
  await assert.rejects(task, /aborted/)
  assert.equal(downloads, 1)
  assert.equal(install.count(), 0)
  assert.deepEqual(await readdir(join(locations(root).userData,'updates')), [])
}))

test('download staging rejects linked parents and overlap before fetching a package',async()=>fixture(async root=>{
  const {here,userData}=locations(root), outside=join(root,'outside')
  await mkdir(outside);await writeFile(join(outside,'keep.txt'),'keep')
  const link=join(root,'settings-link');await symlink(outside,link,'junction')
  try{
    for(const settings of [link,join(here,'updates-inside-program'),join(root,'program')]){
      let packages=0
      const updater=new CaptureUpdater({here,userData:settings},{fetcher:async url=>{
        if(isFeed(url))return new Response(JSON.stringify(envelope()))
        packages++;return new Response(data)
      }})
      await updater.check();await assert.rejects(updater.prepare(),/redirected|overlaps/)
      assert.equal(packages,0)
    }
  }finally{await rm(link)}
  assert.equal(await readFile(join(outside,'keep.txt'),'utf8'),'keep')
  assert.deepEqual(await readdir(outside),['keep.txt'])
  await mkdir(userData);await symlink(outside,join(userData,'updates'),'junction')
  try{
    const updater=new CaptureUpdater(locations(root),{fetcher:async()=>new Response(JSON.stringify(envelope()))})
    await updater.check();await assert.rejects(updater.prepare(),/redirected/)
  }finally{await rm(join(userData,'updates'))}
}))

test('Node hands a canonical output to the bundled Python package installer', {skip:process.platform!=='win32',timeout:15000}, async()=>fixture(async root=>{
  const python=process.env.OVERFIELD_CAPTURE_PYTHON || fileURLToPath(new URL('../../.tools/capture-toolkit/tools/python/python.exe',import.meta.url))
  const run=promisify(execFile), {here,userData}=locations(root), zip=join(root,'fixture-package.zip')
  const code=`import json,sys\nfrom zipfile import ZipFile\np='OverField-Capture-0.6.1-Windows-x64/'\nnames=['账号采集工具.exe','runtime/node.exe','resources/app/main.mjs','resources/app/rendered/index.html','resources/dependencies/tools/python/python.exe','resources/dependencies/tools/tshark/tshark.exe']\nwith ZipFile(sys.argv[1],'w') as z:\n for n in names:z.writestr(p+n,b'fixture-only')\n z.writestr(p+'resources/app/product.json',json.dumps(dict(role='capture',version='0.6.1')))\n`
  await run(python,['-B','-X','utf8','-c',code,zip],{windowsHide:true,timeout:10000})
  await copyFile(fileURLToPath(new URL('../capture_update_package.py',import.meta.url)),join(here,'capture_update_package.py'))
  const bytes=await readFile(zip), descriptor={...release,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
  const updater=new CaptureUpdater({here,userData,python:()=>python,command:(bin,args)=>({done:run(bin,args,{windowsHide:true,timeout:10000}).then(r=>r.stdout)})},
    {fetcher:async url=>new Response(isFeed(url)?JSON.stringify(envelope(descriptor)):bytes)})
  await updater.check();await updater.prepare()
  assert.equal(updater.state.phase,'ready')
  assert.equal(updater.installed.path,await realpath(updater.installed.path))
  assert.equal(await readFile(updater.installed.executable,'utf8'),'fixture-only')
  const prepared=JSON.parse(await readFile(join(userData,'updates/prepared.json')))
  assert.equal(prepared.path,updater.installed.path)
  assert.ok(!(await readdir(join(userData,'updates'))).some(n=>n.endsWith('.zip')||n.endsWith('.part')||n.startsWith('.capture-install-')))
}))

async function olderCache(root, prepared=true){
  const updates=join(locations(root).userData,'updates')
  await mkdir(updates,{recursive:true})
  const path=join(await realpath(updates),'version-0.6.0-11111111-1111-4111-8111-111111111111')
  await mkdir(path);await writeFile(join(path,'keep.txt'),'older-verified-cache')
  await writeFile(join(updates,'unrelated.txt'),'keep-user-file')
  const record=Buffer.from(JSON.stringify({version:'0.6.0',path,sha256:'1'.repeat(64),extra:'preserve exact bytes'}))
  if(prepared)await writeFile(join(updates,'prepared.json'),record)
  return {updates,path,record,prepared,members:(await readdir(updates)).sort()}
}
async function assertOlderCache(cache){
  assert.equal(await readFile(join(cache.path,'keep.txt'),'utf8'),'older-verified-cache')
  assert.equal(await readFile(join(cache.updates,'unrelated.txt'),'utf8'),'keep-user-file')
  if(cache.prepared)assert.deepEqual(await readFile(join(cache.updates,'prepared.json')),cache.record)
  else await assert.rejects(lstat(join(cache.updates,'prepared.json')),{code:'ENOENT'})
  assert.deepEqual((await readdir(cache.updates)).sort(),cache.members)
}
const extractionResult=target=>JSON.stringify({path:target,executable:join(target,'账号采集工具.exe'),version:release.version})
const extractionFetcher=async url=>new Response(isFeed(url)?JSON.stringify(envelope()):data)

for(const prepared of [false,true])test('cancelled extraction preserves '+(prepared?'an older prepared record':'the absence of a prepared record'),{timeout:5000},async()=>fixture(async root=>{
  const cache=await olderCache(root,prepared)
  let updater,target
  updater=new CaptureUpdater({...locations(root),python:()=>'fixture-python',command:(_bin,args)=>({done:(async()=>{
    target=args[args.indexOf('--output')+1]
    await mkdir(target);await writeFile(join(target,'partial.bin'),'this-attempt')
    updater.cancel()
    return extractionResult(target)
  })()})},{fetcher:extractionFetcher})
  await updater.check();const previous={path:cache.path};updater.installed=previous
  await assert.rejects(updater.prepare(),/更新已取消/)
  assert.equal(updater.state.phase,'failed');assert.equal(updater.installed,previous)
  await assert.rejects(lstat(target),{code:'ENOENT'});await assertOlderCache(cache)
}))

test('unfinished extraction failures and invalid results remove only the current UUID stage',{timeout:10000},async()=>{
  for(const failure of ['throw','malformed-json','wrong-path','wrong-version','wrong-executable'])await fixture(async root=>{
    const cache=await olderCache(root);let target
    const updater=new CaptureUpdater({...locations(root),python:()=>'fixture-python',command:(_bin,args)=>({done:(async()=>{
      target=args[args.indexOf('--output')+1]
      await mkdir(target);await writeFile(join(target,'partial.bin'),'this-attempt')
      if(failure==='throw')throw Error('controlled extraction failure')
      if(failure==='malformed-json')return '{'
      const result=JSON.parse(extractionResult(target))
      if(failure==='wrong-path')result.path=cache.path
      if(failure==='wrong-version')result.version='0.6.0'
      if(failure==='wrong-executable')result.executable=join(cache.path,'账号采集工具.exe')
      return JSON.stringify(result)
    })()})},{fetcher:extractionFetcher})
    await updater.check();const previous={path:cache.path};updater.installed=previous
    await assert.rejects(updater.prepare())
    assert.equal(updater.state.phase,'failed');assert.equal(updater.installed,previous)
    await assert.rejects(lstat(target),{code:'ENOENT'});await assertOlderCache(cache)
  })
})

for(const type of ['dir','junction'])test('redirected extracted stage '+type+' never publishes or cleans its external destination',{timeout:10000},async()=>{
  for(const failed of [false,true])await fixture(async root=>{
    const cache=await olderCache(root),external=join(root,'external');let target
    await mkdir(external);await writeFile(join(external,'keep.txt'),'external-sentinel')
    const updater=new CaptureUpdater({...locations(root),python:()=>'fixture-python',command:(_bin,args)=>({done:(async()=>{
      target=args[args.indexOf('--output')+1];await symlink(external,target,type)
      if(failed)throw Error('controlled extraction failure')
      return extractionResult(target)
    })()})},{fetcher:extractionFetcher})
    await updater.check()
    try{
      await assert.rejects(updater.prepare())
      assert.equal(updater.state.phase,'failed');assert.equal(updater.installed,undefined)
      assert.equal((await lstat(target)).isSymbolicLink(),true)
      assert.equal(await readFile(join(external,'keep.txt'),'utf8'),'external-sentinel')
      assert.deepEqual(await readdir(external),['keep.txt'])
    }finally{if(target&&(await lstat(target).catch(()=>null))?.isSymbolicLink())await rm(target)}
    await assertOlderCache(cache)
  })
})

test('redirected extraction parent preserves external data and the moved older cache',{timeout:10000},async()=>{
  for(const type of ['dir','junction'])await fixture(async root=>{
    const cache=await olderCache(root),external=join(root,'external'),retained=cache.updates+'-owned-original';let target,externalDownload
    await mkdir(external)
    const updater=new CaptureUpdater({...locations(root),python:()=>'fixture-python',command:(_bin,args)=>({done:(async()=>{
      target=args[args.indexOf('--output')+1]
      await mkdir(target);await writeFile(join(target,'partial.bin'),'this-attempt')
      await mkdir(join(external,basename(target)));await writeFile(join(external,basename(target),'keep.txt'),'external-stage')
      externalDownload=join(external,basename(args[args.indexOf('--input')+1]));await writeFile(externalDownload,'external-download')
      await rename(cache.updates,retained);await symlink(external,cache.updates,type)
      throw Error('controlled parent redirection')
    })()})},{fetcher:extractionFetcher})
    await updater.check()
    try{
      await assert.rejects(updater.prepare(),/controlled parent redirection/)
      assert.equal(await readFile(join(external,basename(target),'keep.txt'),'utf8'),'external-stage')
      assert.equal(await readFile(externalDownload,'utf8'),'external-download')
      assert.deepEqual(await readFile(join(retained,'prepared.json')),cache.record)
      assert.equal(await readFile(join(retained,basename(cache.path),'keep.txt'),'utf8'),'older-verified-cache')
      assert.equal(await readFile(join(retained,basename(target),'partial.bin'),'utf8'),'this-attempt')
      assert.equal((await readdir(external)).length,2)
    }finally{if((await lstat(cache.updates)).isSymbolicLink())await rm(cache.updates)}
  })
})

test('a linked prepared record cannot overwrite external metadata or retain a new unfinished stage',{timeout:5000},async()=>fixture(async root=>{
  const cache=await olderCache(root),external=join(root,'external-prepared.json'),record=join(cache.updates,'prepared.json');let target
  await writeFile(external,'external-old-record');await rm(record);await symlink(external,record,'file')
  const updater=new CaptureUpdater({...locations(root),python:()=>'fixture-python',command:(_bin,args)=>({done:(async()=>{
    target=args[args.indexOf('--output')+1];await mkdir(target);return extractionResult(target)
  })()})},{fetcher:extractionFetcher})
  await updater.check();await assert.rejects(updater.prepare())
  assert.equal(await readFile(external,'utf8'),'external-old-record')
  assert.equal((await lstat(record)).isSymbolicLink(),true)
  await assert.rejects(lstat(target),{code:'ENOENT'})
  assert.deepEqual((await readdir(cache.updates)).sort(),cache.members)
}))

test('cancel before extraction does not start the interpreter or publish a stage',{timeout:5000},async()=>fixture(async root=>{
  const cache=await olderCache(root);let updater,calls=0
  updater=new CaptureUpdater({...locations(root),python:()=>'fixture-python',send:()=>{
    if(updater.state.phase==='verifying')updater.cancel()
  },command:(_bin,args)=>({done:(async()=>{
    calls++;const target=args[args.indexOf('--output')+1];await mkdir(target);return extractionResult(target)
  })()})},{fetcher:extractionFetcher})
  await updater.check();await assert.rejects(updater.prepare(),/更新已取消/)
  assert.equal(calls,0);await assertOlderCache(cache)
}))
