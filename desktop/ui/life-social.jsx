import React from 'react'
import { Users } from 'lucide-react'

const status = { collected: '已返回', empty: '成功空列表', partial: '部分返回', unknown: '未知' }
const sample = row => row?.snapshots?.find(s => s.sections?.length === 3) || row?.snapshots?.find(s => s.level != null) || row?.snapshots?.[0]
const richestSuccess = row => row?.snapshots?.filter(s => s.status === 1).sort((a, b) => b.entry_count - a.entry_count)[0]
export default function LifeSocialRecords({ report }) {
  const bases = report.base.types, history = report.history.types, social = report.social.types
  return <section className="card checklist-card" data-testid="life-social-records">
    <div className="card-head"><div className="card-icon"><Users size={19} /></div><div><h2>生活与社交补充记录</h2><p>基础资料、图鉴历史与社交分类分别核对，只记录实际返回的内容。</p></div></div>
    <div className="capture-guide"><strong>怎样补充采集</strong><p>分别打开六类生活职业页及对应图鉴，再切换好友、好友申请和黑名单。无需制作物品、领取奖励或修改好友关系。</p>
      <p>旧 ZIP 缺少请求上下文时，社交分类保持未知；保留了原始抓包的，可以重新解析补回。图鉴历史没有回包时需打开对应图鉴补采，已有等级和技能仍然保留。</p></div>
    {!report.attributed && <p className="capture-hint">账号归属尚未确认，下方只显示本次观测；分类完成不代表已恢复关系。</p>}
    <div className="exploration-table"><table><thead><tr><th>生活职业</th><th>基础资料</th><th>等级</th><th>技能 / 成就 / 已领奖</th><th>图鉴历史</th><th>历史列表条目</th></tr></thead><tbody>
      {bases.map(row => { const h = history.find(value => value.type_id === row.type_id), b = sample(row)
        const matched = richestSuccess(h)
        return <tr key={row.type_id}><td>{row.label}</td><td>{status[row.state]}</td><td>{b?.level ?? '未知'}</td>
          <td>{b ? `${b.skills ?? '未知'} / ${b.achieves ?? '未知'} / ${b.rewarded ?? '未知'}` : '未知'}</td><td>{status[h?.state] || '未知'}</td><td>{matched ? matched.entry_count : '未知'}</td></tr> })}
    </tbody></table></div>
    <div className="exploration-table"><table><thead><tr><th>社交分类</th><th>采集状态</th><th>成功回包</th><th>成功列表观测条目</th></tr></thead><tbody>
      {social.filter(row => row.type_id !== 0 || row.snapshot_count).map(row => { const matched = richestSuccess(row)
        return <tr key={row.type_id}><td>{row.label}</td><td>{status[row.state]}</td><td>{row.successful_count}</td><td>{matched ? matched.entry_count : '未知'}</td></tr> })}
    </tbody></table></div>
    <p className="capture-hint">无法分类的记录 {report.unclassified_count} 条 · 尚缺对应回包的请求 {report.pending_request_count} 条。完整证据保存在账号 ZIP 的 life-social.json；有请求头记录时另含 packet-context.json。</p>
    <p className="capture-hint">未采到不会视为零次。列表展示条目较多的一份成功观测，全部快照分别保留；该工具只保存资料，社交关系恢复由导入端核对，不会创建虚构账号或家园。</p>
  </section>
}
