export const captureSteps = [
  { id: 'login', title: '登录并进入游戏', needs: ['login', 'main'], text: '先登录自己的账号并进入场景。游戏原本已打开时，请返回登录界面重新登录一次。' },
  { id: 'items', title: '浏览角色和背包', needs: ['characters', 'bag'], text: '打开角色、穿搭、背包和宠物仓库，切换分类并翻到最后一页。' },
  { id: 'equipment', title: '逐类查看全部装备', needs: ['weapon', 'armor', 'poster'], text: '依次打开武器、护甲和装备海报，切换筛选并翻页。只有穿戴数据时仍需补开装备列表。' },
  { id: 'maps', title: '切换地图与副本详情', needs: ['map_progress', 'map_collections', 'map_moons', 'map_scene', 'map_boxes', 'dungeons'], text: '打开世界地图、地区探索、收集与月亮页面，进入各已解锁地区等待加载。景点和挑战历史随回包保留，另可打开挑战记录核对。小副本摘要会随场景记录；按需点开副本详情，要保存副本内宝箱时再进入等待加载。无需重打全部副本或领取奖励。' },
  { id: 'garden', title: '查看自己的家园和宠物', needs: ['garden', 'pet'], text: '进入自己的家园并等待加载，再切换各套家园预设、家具与宠物页面。' },
  { id: 'life', title: '查看六类生活职业与图鉴', needs: ['life_base'], optional: ['life_history'], text: '只补充尚未返回的生活职业基础。生活图鉴历史次数单独记录，不影响已保存的等级、技能和成就。' },
  { id: 'social', title: '切换社交列表分类', needs: ['social_lists'], text: '只需打开尚未返回的好友、好友申请或黑名单分类，无需添加或删除好友。' },
  { id: 'other', title: '补齐其他账号资料', needs: ['mail', 'achieve', 'manual', 'archive'], text: '打开邮件、各组成就、图鉴和档案。完成浏览后退出游戏，工具会自动整理备份。抽卡历史无需操作。' }
]

export function guidedSteps(report) {
  const items = new Map((report?.items || []).map(item => [item.id, item]))
  return captureSteps.map(step => {
    const rows = step.needs.map(id => items.get(id))
    const received = rows.filter(row => ['collected', 'empty'].includes(row?.state)).length
    const partial = rows.some(row => row?.count > 0)
    const status = received === rows.length ? 'received' : partial ? 'partial' : 'waiting'
    let text = status === 'received' ? '本步骤对应的记录已返回，无需重复浏览。' : step.text
    let statusLabel = status === 'received' ? '已保存' : status === 'partial' ? '部分已保存' : '待浏览'
    const oldSupplement = report && ['life','social'].includes(step.id) && !rows.some(Boolean)
    if (oldSupplement) return { ...step, received, total: rows.length, status:'legacy', statusLabel:'旧报告未核对',
      text:'这份旧报告没有此项分类信息，请先重新解析原始记录；无需先回游戏重复浏览。' }
    if (step.id === 'life' && status === 'received') {
      statusLabel = '基础已保存'
      text = '六类职业基础已保存，已有等级、技能和成就无需重复采集。' +
        (['collected','empty'].includes(items.get('life_history')?.state) ? '生活图鉴历史次数也已保存。' :
          '另有可选的生活图鉴历史次数尚未记录；只有需要保留制作等历史次数时，才打开对应职业图鉴补采。普通图鉴单独核对。')
    }
    if (step.id === 'social' && status === 'received') text = '好友、好友申请和黑名单分类已保存，无需重复浏览。成功空列表也属于已收到。'
    return { ...step, received, total: rows.length, status, statusLabel, text }
  })
}

export function lifeSocialGuidance(report) {
  const complete = section => report.attributed && section.expected_types.every(id =>
    section.types.some(row => row.type_id === id && ['collected','empty'].includes(row.state)))
  const base = complete(report.base), social = complete(report.social), history = complete(report.history)
  return { base, social, history,
    baseText: base ? '六类职业基础已保存：等级、技能、成就和已领奖记录无需重复采集。' :
      '职业基础尚有未确认项，只补充下表中未返回的职业；已有记录保留。',
    socialText: social ? '好友、好友申请和黑名单分类已保存，无需补充浏览。' :
      '社交分类尚有未确认项。旧 ZIP 缺少请求上下文时先重新解析原始抓包，仍缺分类时再浏览对应列表。',
    historyText: history ? '生活图鉴历史次数已保存。' :
      '可选补充：生活图鉴历史次数未采到，不代表普通图鉴或职业等级缺失。需要保留制作等历史次数时，再打开对应职业图鉴补采。' }
}

export function checklistHint(item) {
  if (['collected','empty'].includes(item.state)) {
    return item.detail?.includes('列表外') ? item.hint : '已保存本项返回的记录，无需重复浏览。'
  }
  return item.id === 'life_history' ? '可选补充生活职业的图鉴历史次数；已有职业等级、技能和普通图鉴不受影响。' : item.hint
}
