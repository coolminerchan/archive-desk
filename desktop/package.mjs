import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { PRODUCTS } from './product.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = dirname(here)
const dist = join(repo, 'dist')
const metadata = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'))
const requested = process.argv.find(arg => arg.startsWith('--role='))?.slice(7)
const captureVersion = JSON.parse(await readFile(join(here, 'capture-version.json'), 'utf8')).version
const version = process.argv.find(arg => arg.startsWith('--version='))?.slice(10) || (requested === 'capture' ? captureVersion : metadata.version)
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a numeric product version')
const toolkitSource = resolve(process.env.OVERFIELD_CAPTURE_TOOLKIT || join(dirname(repo), 'OverField-Backup'))
const nodeRuntime = resolve(process.env.OVERFIELD_NODE_RUNTIME || process.execPath)
const nativeTools = join(repo, '.tools/native')
const coreSource = resolve(process.env.OVERFIELD_CORE_DIR || join(repo, 'dist/windows-amd64'))
if (requested && !Object.hasOwn(PRODUCTS, requested)) throw new Error('Unknown package role')
const roles = requested ? [requested] : Object.keys(PRODUCTS)
const variants = {
  server: { core: ['overfield-server.exe'], app: ['equipment_audit.py', 'capturelib'],
    scripts: ['save_snapshot.py', 'initialize_player.py'], dependencies: ['proto_gen', 'tools/python'] },
  client: { core: ['overfield-client.exe'], app: [], scripts: ['local_client_adapter.py', 'remote_dispatch.py', 'pcgame_adapter.py', 'make_client_junction.ps1'], dependencies: ['tools/python'] },
  capture: { core: [], app: ['equipment_audit.py', 'capture-controller.mjs', 'capture-launcher.mjs', 'capture-errors.mjs', 'capture-update.mjs', 'capture-update-apply.mjs', 'capture-update.json', 'capture_update_package.py', 'capture_report.py', 'capture_delivery.py', 'capture_preflight.py', 'capture-version.json', 'capturelib', 'capture-session.ps1'],
    scripts: [], dependencies: ['proto_gen', 'tools/python', 'tools/tshark'] }
}
const guides = {
  server: '选择服务配置和签名公钥，检查配置后启动服务。也可以创建本机测试配置。账号、数据包、存档与游戏服务目录由配置文件指定。存档备份和装备核对的运行组件已包含在本包中。',
  client: '选择服务器提供的连接配置，再检查本机游戏目录、同步数据包并启动游戏。游戏本体与访问码需事先准备。固定版本的 B服 PC 实验接入已内置运行环境；首次点「准备隔离客户端」创建独立副本。TapTap 接入继续使用已核验的外部环境。详见 B服实验接入.md。客户端与服务端均为 0.8.0 时，已识别渠道默认启用短时断线恢复；界面显示恢复中时请保留窗口，超时按提示重新进入。详见连接恢复.md。',
  capture: '点击「一键采集并打开游戏」，按系统提示允许采集权限。工具自动识别客户端与渠道，开始采集后打开游戏；首次未找到时需选择一次官服程序或 Steam 快捷方式。进入游戏后依次浏览背包、装备、地图探索等界面，退出游戏后自动核对并将账号 ZIP 保存到「文档/游戏账号备份」，也可点击「停止并保存」。打开各已解锁地区的地图与探索界面，再进入对应场景等待加载，可采集探索点、收集物、水晶、宝箱和月亮观测。单次场景响应不代表全图完整；未知保持未知。已有账号 ZIP 可直接打开检查。高级采集保留模拟器和手动连接选项。抽卡历史不计入必需清单。'
}
const cleanSource = source => !source.split(/[\\/]/).includes('__pycache__')
function run(exe, args, env) {
  const result = spawnSync(exe, args, { cwd: repo, env, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error('Failed to run ' + exe, { cause: result.error })
}

await mkdir(dist, { recursive: true })
const temporary = await mkdtemp(join(dist, '.desktop-build-'))
try {
  for (const role of roles) {
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'native/build.ps1'), '-Product', role])
    if (role === 'client') run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts/build_pcgame_sdk.ps1')])
    const product = PRODUCTS[role], variant = variants[role]
    const name = `${product.package}-${version}-Windows-x64`
    const desktop = join(temporary, name)
    const runtime = join(desktop, 'runtime')
    const resources = join(desktop, 'resources')
    const bundle = join(resources, 'app')
    const dependencies = join(resources, 'dependencies')
    await mkdir(runtime, { recursive: true })
    await cp(nodeRuntime, join(runtime, 'node.exe'))
    await mkdir(bundle, { recursive: true })
    for (const file of ['main.mjs', 'product.mjs', ...(role === 'capture' ? [] : ['game-network.mjs', 'adapter-upgrade.mjs']), 'platform.mjs', 'native-platform.mjs', 'native-bridge.js', 'rendered', ...variant.app])
      await cp(join(here, role === 'capture' && file === 'main.mjs' ? 'capture-main.mjs' : file), join(bundle, file), { recursive: true, filter: cleanSource })
    await writeFile(join(bundle, 'package.json'), JSON.stringify({
      name: product.package.toLowerCase(), productName: product.name, version, type: 'module', main: 'main.mjs'
    }))
    await writeFile(join(bundle, 'product.json'), JSON.stringify({ role, version, name: product.name }))
    if (variant.core.length) await mkdir(join(resources, 'core'))
    for (const file of variant.core)
      await cp(join(coreSource, file), join(resources, 'core', file))
    for (const file of variant.scripts)
      await cp(join(repo, 'scripts', file), join(resources, file))
    if (role === 'client') {
      await mkdir(join(resources, 'pcgame'), { recursive: true })
      await cp(join(nativeTools, 'build/PCGameSDK.dll'), join(resources, 'pcgame/PCGameSDK.dll'))
    }
    if (variant.dependencies.length) {
      for (const file of [...variant.dependencies, 'THIRD-PARTY.txt'])
        await cp(join(toolkitSource, file), join(dependencies, file), { recursive: true, filter: cleanSource })
      for (const file of ['parse_pcap.py', 'pcap_compat.py', 'account_identity.py', 'exploration.py', 'exploration_catalog.json', 'SOURCE.md', 'PROVENANCE.json'])
        await cp(join(here, 'capturelib', file), join(dependencies, file))
    }
    const licenses = join(desktop, 'licenses')
    await mkdir(licenses)
    for (const [module, output] of [['react', 'React.txt'], ['react-dom', 'ReactDOM.txt'], ['lucide-react', 'Lucide.txt']])
      await cp(join(here, 'node_modules', module, 'LICENSE'), join(licenses, output))
    await cp(join(nativeTools, 'Node-LICENSE.txt'), join(licenses, 'Node.txt'))
    await cp(join(nativeTools, 'JSON-LICENSE.txt'), join(licenses, 'JSON.txt'))
    await cp(join(nativeTools, 'webview2/LICENSE.txt'), join(licenses, 'WebView2.txt'))
    if (role === 'client' || role === 'server') await cp(join(repo, 'licenses/Coder-WebSocket.txt'), join(licenses, 'Coder-WebSocket.txt'))
    if (variant.dependencies.length)
      await cp(join(here, 'capturelib/SOURCE.md'), join(licenses, 'Component-sources.md'))
    if (role === 'client') await cp(join(here, 'pcgame'), join(licenses, 'pcgame-adapter-source'), { recursive: true })
    await writeFile(join(desktop, '致谢.txt'), '感谢原作者、水音及社区贡献者的支持。\n详细版权与许可证见 licenses 目录及运行组件内的许可证文件。\n', 'utf8')
    if (role === 'capture') {
      await cp(join(repo, 'docs/capture-one-click.md'), join(desktop, 'Capture-guide.md'))
      await cp(join(repo, 'docs/github-capture-review/README.md'), join(desktop, 'README.md'))
      await cp(join(repo, 'docs/capture-quick-start.zh-CN.txt'), join(desktop, '使用说明.txt'))
      await cp(join(repo, 'docs/github-capture-review/RELEASE-0.6.0.md'), join(desktop, 'Release-notes.md'))
    }
    if (role === 'client' || role === 'server') await cp(join(repo, 'docs/sakurafrp-test.md'), join(desktop, '外部连接测试.md'))
    if (role === 'client' || role === 'server') await cp(join(repo, 'docs/bilibili-test.md'), join(desktop, 'B服实验接入.md'))
    if (role === 'client' || role === 'server') await cp(join(repo, 'docs/reconnect-implementation.md'), join(desktop, '连接恢复.md'))
    if (role !== 'capture') await writeFile(join(desktop, '使用说明.md'), `# ${product.name}\n\n版本 ${version} · Windows x64\n\n完整解压本包后，运行根目录的「${product.executable}」。本工具拥有自己的运行环境与配置，不需要安装另外两个工具。请将 runtime、resources 目录与启动程序放在一起。显示界面使用系统网页组件，Windows 11 和多数 Windows 10 已包含。缺少时请安装 Microsoft Edge WebView2 Runtime，官方地址 https://developer.microsoft.com/microsoft-edge/webview2/consumer/ 。\n\n${guides[role]}\n\n设置和日志分别保存在当前用户的 AppData/Roaming/OverField Desktop/${role}。这个目录仅保存本工具的数据。\n\n感谢原作者、水音及社区贡献者。详细许可见同目录文件。\n`, 'utf8')
    await cp(join(nativeTools, 'build', 'DesktopHost.' + role + '.exe'), join(desktop, product.executable))
    const pending = join(temporary, name + '.zip')
    run('python.exe', ['-B', join(here, 'zip_release.py'), desktop, pending])
    const output = join(dist, name + '.zip')
    await rename(pending, output)
    const hash = createHash('sha256').update(await readFile(output)).digest('hex')
    await writeFile(output + '.sha256', hash + '  ' + name + '.zip\n')
    console.log(output)
  }
} finally {
  if (dirname(await realpath(temporary)) === await realpath(dist))
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 })
}
