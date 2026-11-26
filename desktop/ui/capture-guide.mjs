export const captureSteps = [
  { id: 'login', title: '登录并进入游戏', needs: ['login', 'main'], text: '先登录自己的账号并进入场景。游戏原本已打开时，请返回登录界面重新登录一次。' },
  { id: 'items', title: '浏览角色和背包', needs: ['characters', 'bag'], text: '打开角色、穿搭、背包和宠物仓库，切换分类并翻到最后一页。' },
  { id: 'equipment', title: '逐类查看全部装备', needs: ['weapon', 'armor', 'poster'], text: '依次打开武器、护甲和装备海报，切换筛选并翻页。只有穿戴数据时仍需补开装备列表。' },
  { id: 'maps', title: '切换地图与副本详情', needs: ['map_progress', 'map_collections', 'map_moons', 'map_scene', 'map_boxes', 'dungeons'], text: '打开世界地图、地区探索、收集与月亮页面，进入各已解锁地区等待加载。小副本摘要会随场景记录；按需点开副本详情，要保存副本内宝箱时再进入等待加载。无需重打全部副本或领取奖励。' },
  { id: 'garden', title: '查看自己的家园和宠物', needs: ['garden', 'pet'], text: '进入自己的家园并等待加载，再切换各套家园预设、家具与宠物页面。' },
  { id: 'other', title: '补齐其他账号资料', needs: ['mail', 'friend', 'achieve', 'manual', 'archive'], text: '打开邮件、好友、各组成就、图鉴、档案和生活技能。完成浏览后退出游戏，工具会自动整理备份。抽卡历史无需操作。' }
]

export function guidedSteps(report) {
  const items = new Map((report?.items || []).map(item => [item.id, item]))
  return captureSteps.map(step => {
    const rows = step.needs.map(id => items.get(id))
    const received = rows.filter(row => ['collected', 'empty'].includes(row?.state)).length
    const partial = rows.some(row => row?.count > 0)
    return { ...step, received, total: rows.length, status: received === rows.length ? 'received' : partial ? 'partial' : 'waiting' }
  })
}
