import React from 'react'
import { lifeSkillLabel } from './capture-presentation.mjs'
import { lifeSocialGuidance } from './capture-guide.mjs'
import { Disclosure, Note, Panel, receivedLabel } from './capture-ui.jsx'

const sample = row => row?.snapshots?.find(s => s.sections?.length === 3) || row?.snapshots?.find(s => s.level != null) || row?.snapshots?.[0]
const success = row => row?.snapshots?.filter(s => s.status === 1).sort((a,b) => b.entry_count-a.entry_count)[0]

export default function LifeSocialRecords({ report }) {
  const bases = report.base.types, guidance = lifeSocialGuidance(report)
  return <Panel title="生活职业" description="选择职业，展开查看各项技能。" data-testid="life-social-records">
    {!report.attributed && <Note warning>尚未确认这些资料属于同一个账号，暂不作完整性判断。</Note>}
    <div className="c-careers" data-testid="life-skill-details">{bases.map(row => { const b=sample(row), details=b?.skill_details
      return <details className="c-career" data-career={row.type_id} key={row.type_id}><summary><span><strong>{row.label}</strong><small>{Array.isArray(details) ? details.length ? `${details.length} 项技能` : '已读取 · 暂无技能' : b ? '技能详情待展开' : receivedLabel(row.state)}</small></span>
        <span className="c-career-level">{b?.level != null ? <><b>{b.level}</b><small>职业等级</small></> : <small>等级未记录</small>}</span></summary>
        <div className="c-career-content">{!Array.isArray(details) ? <p>{b ? '旧报告未展开单项技能等级，重新解析原账号包即可查看。' : '在录制期间打开此职业页面，等待资料加载。'}</p> : details.length ? <div className="skill-chips">{details.map((s,i) =>
          <div key={`${s.skill_id}-${i}`} title={`技能编号 ${s.skill_id}`}><span>{lifeSkillLabel(row.type_id,s.skill_id)}</span><strong>Lv. {s.level}</strong></div>)}</div> : <p>本次收到的技能列表为空，无需为此重复浏览。</p>}</div>
      </details>
    })}</div>
    <Disclosure title="图鉴历史与生活成就"><Note>{guidance.historyText}</Note><div className="exploration-table"><table><thead><tr><th>职业</th><th>成就 / 已领奖</th><th>图鉴历史</th><th>历史条目</th></tr></thead><tbody>{bases.map(row => {
      const b=sample(row),h=report.history.types.find(h=>h.type_id===row.type_id),record=success(h)
      return <tr key={row.type_id}><td>{row.label}</td><td>{b ? `${b.achieves ?? '未记录'} / ${b.rewarded ?? '未记录'}` : '未记录'}</td><td>{receivedLabel(h?.state)}</td><td>{record?.entry_count ?? '未记录'}</td></tr>
    })}</tbody></table></div></Disclosure>
    <Disclosure title="资料来源与核对说明"><p data-testid="life-social-guidance">{guidance.baseText}</p><p>职业等级与单项技能等级分别保存。列表展示信息较多的一份记录，全部记录及学习时间保留在 life-social.json。没有返回的内容不当作零。</p></Disclosure>
  </Panel>
}

export function SocialRecords({ report }) {
  const guidance=lifeSocialGuidance(report)
  return <Panel title="社交列表" description="好友、申请和黑名单分别核对。" data-testid="social-records">
    {!guidance.social && <Note>部分列表分类尚未确认。旧包可以先重新解析；仍缺少时，再在游戏中打开对应分类。</Note>}
    <div className="c-social-lists">{report.social.types.filter(row=>row.type_id!==0 || row.snapshot_count).map(row => <div className="c-social-row" key={row.type_id}><span><strong>{row.label}</strong><small>{receivedLabel(row.state)}</small></span><b>{success(row)?.entry_count ?? '—'}<small>条记录</small></b></div>)}</div>
    <Disclosure title="列表为空或分类未确认是什么意思？"><p>成功返回的空列表属于已读取。旧记录缺少请求分类时，会保留原始资料，不猜测好友、申请或黑名单关系。</p><p>无法分类 {report.unclassified_count} 条；待配对请求 {report.pending_request_count} 条。完整来源见 life-social.json。</p></Disclosure>
  </Panel>
}
