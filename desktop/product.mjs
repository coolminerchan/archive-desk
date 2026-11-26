export const PRODUCTS = {
  server: { name: '服务端管理', executable: '服务端管理.exe', package: 'OverField-Server' },
  client: { name: '游戏启动器', executable: '游戏启动器.exe', package: 'OverField-Client' },
  capture: { name: '账号采集工具', executable: '账号采集工具.exe', package: 'OverField-Capture' }
}

export function selectProduct(manifest, requestedRole) {
  const role = manifest?.role || requestedRole || 'server'
  if (!Object.hasOwn(PRODUCTS, role)) throw new Error('工具类型无效')
  if (manifest && requestedRole && requestedRole !== manifest.role) throw new Error('请使用此工具自己的启动入口')
  return { ...PRODUCTS[role], role, version: manifest?.version || '0.5.2' }
}
