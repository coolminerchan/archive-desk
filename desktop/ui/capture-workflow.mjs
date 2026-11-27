export const recordViews = [['records', '装备'], ['exploration', '地图'], ['progress', '星云树'], ['life', '生活'], ['social', '社交'], ['dungeons', '副本'], ['scenes', '场景']]
export const optionalItems = new Set(['life_history', 'dungeon_details', 'gacha_records'])
export const hasRecordView = tab => recordViews.some(([key]) => key === tab)
export const isReceived = row => ['collected', 'empty'].includes(row?.state)

export function captureSummary(report) {
  const items = (report?.items || []).filter(row => row.id !== 'gacha_records')
  const required = items.filter(row => !optionalItems.has(row.id))
  return {
    received: required.filter(isReceived),
    remaining: required.filter(row => ['missing', 'partial', 'waiting'].includes(row.state)),
    unknown: required.filter(row => !isReceived(row) && !['missing', 'partial', 'waiting'].includes(row.state)),
    optional: items.filter(row => optionalItems.has(row.id) && !isReceived(row)),
    total: required.length
  }
}

export function accountIdentity(report) {
  const row = report?.accounts === 1 && report.accounts_detail?.length === 1 ? report.accounts_detail[0] : null
  return { name: row?.player_name || (report?.accounts > 1 ? '记录中包含多个账号' : '账号资料'),
    uid: row?.player_label || row?.uid || null, level: row?.level ?? null }
}

export function recordingStage(recording, flow) {
  if (recording === 'recording') return { title: '正在记录你的冒险', hint: '去游戏里浏览想保存的内容，完成后退出游戏。', stage: 1 }
  if (recording && !['starting'].includes(recording)) return { title: '正在整理备份', hint: '请稍等，原始记录会一并保留。', stage: 2 }
  if (recording || ['checking', 'permission', 'finding', 'starting'].includes(flow?.phase)) return { title: '正在准备采集', hint: flow?.hint || '准备就绪后会打开游戏。', stage: 0 }
  return { title: '把冒险，好好留住', hint: '开始备份，照常登录游戏。退出后为你保存。', stage: -1 }
}
