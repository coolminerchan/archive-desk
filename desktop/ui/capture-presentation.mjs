import catalog from '../capturelib/scene_catalog.json' with { type: 'json' }
import skillCatalog from '../capturelib/life_skill_catalog.json' with { type: 'json' }

export function lifeSkillLabel(kind, id) {
  return skillCatalog.skills[String(kind)]?.[String(id)] || `技能 ${id}`
}

export function sceneLabel(id, row) {
  if (Number(id) === 6) return '夜间场景（资源未命名）'
  return catalog.scenes[String(id)]?.name || row?.scene_name || `未命名场景 ${id}`
}

export function sceneCategory(id, row) {
  return catalog.scenes[String(id)]?.category || row?.scene_category || '类型未记录'
}

export function sceneNote(id) {
  return Number(id) === 6 ? '资源文件 SceneBattle003_V7_night；当前世界配置未列出，不能据此认定需要补采。' : ''
}

export function groupScenes(rows) {
  return { gardens: rows.filter(row => Number(row.scene_id) === 9999),
    worlds: rows.filter(row => Number(row.scene_id) !== 9999) }
}

export function equipmentLabel(row) {
  if (row.quantity_matches || row.matches) return '列表数量吻合'
  if (!row.reported?.length) return '未收到装备列表'
  if (row.list_matches) return '列表数量一致，采集质量另列'
  if (row.list_matches === false) return '列表数量或实例未通过校验'
  if (row.list_complete && row.other_only) return `另有 ${row.other_only} 件已保留`
  return '旧报告缺少数量核验信息'
}

export function qualityLabel(report) {
  const quality = report.quality
  if (!quality?.integrity_known) return '旧包未记录检测信息'
  const issues = []
  const gaps = quality.tcp_gap_directions ?? report.gaps
  const failures = quality.decode_failures ?? report.decode_errors
  const unknown = quality.unknown_protocol_packets ?? report.unknown
  const tails = quality.tail_directions ?? report.tail_directions
  if (gaps) issues.push(`TCP 缺口 ${gaps} 个方向`)
  if (failures) issues.push(`解析失败 ${failures} 条`)
  if (unknown) issues.push(`未识别协议 ${unknown} 条`)
  if (tails) issues.push(`未解析尾数据 ${tails} 个方向`)
  return issues.join('；') || '未见异常'
}
