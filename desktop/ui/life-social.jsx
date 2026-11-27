import React from 'react'
import { Users } from 'lucide-react'
import { lifeSocialGuidance } from './capture-guide.mjs'
import { lifeSkillLabel } from './capture-presentation.mjs'

const status = { collected: '已返回', empty: '成功空列表', partial: '部分返回', unknown: '未知' }
const sample = row => row?.snapshots?.find(s => s.sections?.length === 3) || row?.snapshots?.find(s => s.level != null) || row?.snapshots?.[0]
const richestSuccess = row => row?.snapshots?.filter(s => s.status === 1).sort((a, b) => b.entry_count - a.entry_count)[0]
export default function LifeSocialRecords({ report, lifeOnly = false }) {
  const bases = report.base.types, history = report.history.types, social = report.social.types
  const guidance = lifeSocialGuidance(report)
  return <section className="card checklist-card" data-testid="life-social-records">
    <div className="card-head"><div className="card-icon"><Users size={19} /></div><div><h2>{lifeOnly ? '生活职业与技能等级' : '生活与社交补充记录'}</h2><p>职业等级、单项技能等级和图鉴历史分开查看。</p></div></div>
    <div className="capture-guide" data-testid="life-social-guidance"><strong>{lifeOnly && guidance.base ? '职业基础已保存' : guidance.base && guidance.social ? '职业基础与社交分类已保存' : '按缺少的项目补充'}</strong>
      <p>{guidance.baseText}</p>{!lifeOnly && <p>{guidance.socialText}</p>}<p>{guidance.historyText}</p></div>
    {!report.attributed && <p className="capture-hint">账号归属尚未确认，下方只显示本次观测；分类完成不代表已恢复关系。</p>}
    <div className="exploration-table"><table><thead><tr><th>生活职业</th><th>基础资料</th><th>职业等级</th><th>技能 / 成就 / 已领奖</th><th>图鉴历史</th><th>历史列表条目</th></tr></thead><tbody>
      {bases.map(row => { const h = history.find(value => value.type_id === row.type_id), b = sample(row)
        const matched = richestSuccess(h)
        return <tr key={row.type_id}><td>{row.label}</td><td>{status[row.state]}</td><td>{b?.level ?? '未知'}</td>
          <td>{b ? `${b.skills ?? '未知'} / ${b.achieves ?? '未知'} / ${b.rewarded ?? '未知'}` : '未知'}</td><td>{status[h?.state] || '未知'}</td><td>{matched ? matched.entry_count : '未知'}</td></tr> })}
    </tbody></table></div>
    <div className="life-skill-details" data-testid="life-skill-details"><h3>单项生活技能等级</h3><p className="capture-hint">下方的等级属于每项技能，与上表职业等级分开。学习开始时间和原始字段在备份中保留。</p>
      {bases.map(row => { const b = sample(row)
        return <details key={row.type_id} data-career={row.type_id}><summary>{row.label}<span>{Array.isArray(b?.skill_details) ? `${b.skill_details.length} 项技能` : '待展开记录'}</span></summary>
          {!Array.isArray(b?.skill_details) ? <p className="capture-hint">{b ? '旧报告未展开单项等级。打开已有账号 ZIP 重新解析，无需先回游戏重复浏览。' : '尚未返回此职业的技能资料；在录制期间打开对应职业页，等待加载。'}</p> : b.skill_details.length ?
            <div className="skill-chips">{b.skill_details.map((skill, index) => <div key={`${skill.skill_id}-${index}`} title={`技能编号 ${skill.skill_id}`}><span>{lifeSkillLabel(row.type_id, skill.skill_id)}</span><strong>Lv. {skill.level}</strong></div>)}</div> : <p className="capture-hint">已收到此职业的空技能列表，不属于漏采。</p>}
        </details>
      })}</div>
    {!lifeOnly && <div className="exploration-table"><table><thead><tr><th>社交分类</th><th>采集状态</th><th>成功回包</th><th>成功列表观测条目</th></tr></thead><tbody>
      {social.filter(row => row.type_id !== 0 || row.snapshot_count).map(row => { const matched = richestSuccess(row)
        return <tr key={row.type_id}><td>{row.label}</td><td>{status[row.state]}</td><td>{row.successful_count}</td><td>{matched ? matched.entry_count : '未知'}</td></tr> })}
    </tbody></table></div>}
    <p className="capture-hint">无法分类的记录 {report.unclassified_count} 条 · 尚缺对应回包的请求 {report.pending_request_count} 条。完整证据保存在账号 ZIP 的 life-social.json；有请求头记录时另含 packet-context.json。</p>
    <p className="capture-hint">未采到不会视为零次。列表展示条目较多的一份成功观测，全部快照分别保留；该工具只保存资料，社交关系恢复由导入端核对，不会创建虚构账号或家园。</p>
  </section>
}
