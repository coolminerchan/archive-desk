import React from 'react'

export function NebulaRecords({ report }) {
  const known = report?.attributed && ['collected', 'empty'].includes(report.state)
  return <section className="card checklist-card" data-testid="nebula-records">
    <div className="card-head"><div><h2>星云树</h2><p>激活节点、任务进度和已领奖记录分别保存。</p></div><span className="record-badge">{known ? report.state === 'empty' ? '成功空列表' : '已有记录' : report ? '尚未确认' : '旧报告未展开'}</span></div>
    <p className="capture-hint">{known ? '已有列表无需重复采集。展示信息较多的一份成功快照，不拼接成虚构进度。' : '先打开已有账号 ZIP 重新解析；仍无记录时，在录制期间打开游戏里的星云树，切换可见分区并等待加载。无需激活或领奖。'}</p>
    {known && <>
      <div className="nebula-metrics"><div><span>已观测分区</span><strong>{report.page_count}</strong></div><div><span>已激活节点</span><strong>{report.active_node_count}</strong></div>
        <div><span>任务进度条目</span><strong>{report.achievement_count}</strong></div><div><span>已领任务奖励</span><strong>{report.rewarded_achievement_count}</strong></div></div>
      <div className="exploration-table"><table><thead><tr><th>分区</th><th>已激活节点</th><th>分区奖励</th><th>节点明细</th></tr></thead><tbody>
        {report.pages.map((page, index) => <tr key={`${page.page}-${index}`}><td>分区 {page.page}</td><td>{page.active_node_count}</td><td>{page.reward_claimed ? '已领取' : '未领取'}</td>
          <td><details><summary>查看节点编号</summary><p className="record-ids">{page.active_node_ids.join('、') || '此快照未激活节点'}</p></details></td></tr>)}
      </tbody></table></div>
      <p className="capture-hint">已收到 {report.snapshot_count} 份成功列表。分区总数未经核验，“已有记录”不代表全部采齐或已经恢复到游戏。完整证据见账号 ZIP 中的 nebula-tree.json。</p>
    </>}
  </section>
}

export function CaptureRecordLinks({ report, onNavigate, portraits }) {
  const exploration = report?.exploration, nebula = exploration?.nebula_tree
  const maps = Object.values(exploration?.maps || {}), crystalMaps = maps.filter(row => row.crystals?.collected != null)
  const scenic = exploration?.activities?.categories?.find(row => row.id === 'scenic')
  const life = report?.life_social?.base?.types || []
  const lifeCount = life.filter(row => ['collected', 'empty'].includes(row.state)).length
  const rows = [
    ['水晶', crystalMaps.length ? `${crystalMaps.length} 个场景有观测记录` : '进入地区，打开探索与收集页', 'exploration', portraits.maps],
    ['美丽景点', scenic?.state !== 'unknown' && scenic?.observed_count != null ? `已观测 ${scenic.observed_count} 处` : '进入地区等待场景加载', 'exploration', portraits.garden],
    ['星云树', nebula?.attributed && ['collected','empty'].includes(nebula.state) ? `${nebula.page_count} 个分区 · ${nebula.active_node_count} 个激活节点` : '旧包可重解析，查看激活与领奖', 'progress', portraits.equipment],
    ['生活技能', lifeCount ? `${lifeCount}/6 类基础 · 查看单项技能等级` : '打开六类职业页，等待资料加载', 'progress', portraits.life]
  ]
  return <section className="record-shortcuts" aria-label="常用采集记录" data-testid="record-shortcuts">{rows.map(([title, hint, tab, art]) =>
    <button type="button" key={title} onClick={() => onNavigate?.(tab)}><img src={art} alt="" /><span><strong>{title}</strong><small>{hint}</small></span><b aria-hidden="true">↗</b></button>)}</section>
}
