export const captureSteps = [
  { id: 'login', title: '登录并进入游戏', needs: ['login', 'main'], text: '先登录自己的账号并进入场景。游戏原本已打开时，请返回登录界面重新登录一次。' },
  { id: 'items', title: '浏览角色和背包', needs: ['characters', 'bag'], text: '打开角色、穿搭、背包和宠物仓库，切换分类并翻到最后一页。' },
  { id: 'equipment', title: '逐类查看全部装备', needs: ['weapon', 'armor', 'poster'], text: '依次打开武器、护甲和装备海报，切换筛选并翻页。只有穿戴数据时仍需补开装备列表。' },
  { id: 'maps', title: '切换地图与副本详情', needs: ['map_progress', 'map_collections', 'map_moons', 'map_scene', 'map_boxes', 'dungeons'], text: '打开世界地图、地区探索、收集与月亮页面，进入各已解锁地区等待加载。景点和挑战历史随回包保留，另可打开挑战记录核对。小副本摘要会随场景记录；按需点开副本详情，要保存副本内宝箱时再进入等待加载。无需重打全部副本或领取奖励。' },
  { id: 'garden', title: '查看自己的家园和宠物', needs: ['garden', 'pet'], text: '进入自己的家园并等待加载，再切换各套家园预设、家具与宠物页面。' },
  { id: 'life', title: '查看六类生活职业与图鉴', needs: ['life_base', 'life_history'], text: '分别打开烹饪、钓鱼、制作、手工艺、缝纫、采集的职业页及对应图鉴，等待加载。等级、技能和图鉴历史次数分开核对，不需要制作物品或领取奖励。' },
  { id: 'social', title: '切换社交列表分类', needs: ['friend', 'social_lists'], text: '依次打开好友、好友申请和黑名单。工具会记录请求分类并配对回包，无需添加或删除好友。' },
  { id: 'other', title: '补齐其他账号资料', needs: ['mail', 'achieve', 'manual', 'archive'], text: '打开邮件、各组成就、图鉴和档案。完成浏览后退出游戏，工具会自动整理备份。抽卡历史无需操作。' }
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
