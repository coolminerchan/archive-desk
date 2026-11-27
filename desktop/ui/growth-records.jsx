import React from 'react'
import { Blank, Disclosure, Panel } from './capture-ui.jsx'

export function NebulaRecords({ report }) {
  const known = report?.attributed && ['collected', 'empty'].includes(report.state)
  return <Panel title="星云树" description={known ? `已读取 ${report.page_count} 个分区` : '查看已保存的激活和领奖记录'} data-testid="nebula-records">
    {!known ? <Blank title={report ? '尚未确认星云树资料' : '这份报告尚未展开星云树'}>先重新解析已有备份。仍无记录时，在采集中打开游戏的星云树页面，无需激活或领奖。</Blank> : <>
      <div className="c-stats"><div><span>已激活节点</span><strong>{report.active_node_count}</strong></div><div><span>任务记录</span><strong>{report.achievement_count}</strong></div><div><span>已领奖励</span><strong>{report.rewarded_achievement_count}</strong></div></div>
      <div className="exploration-table"><table><thead><tr><th>分区</th><th>已激活节点</th><th>分区奖励</th></tr></thead><tbody>{report.pages.map((page,i) =>
        <tr key={`${page.page}-${i}`}><td>分区 {page.page}</td><td>{page.active_node_count}</td><td>{page.reward_claimed ? '已领取' : '未领取'}</td></tr>)}</tbody></table></div>
      <Disclosure title="节点编号与记录说明"><p>展示信息较多的一份成功记录，不合并不同时间的进度。已读取的分区不代表所有分区都已采齐。</p>
        {report.pages.map((p,i) => <p key={`${p.page}-${i}`} className="record-ids">分区 {p.page}：{p.active_node_ids.join('、') || '此记录未激活节点'}</p>)}
        <p>原始响应与全部记录保留在账号包中，详情见 nebula-tree.json。服务端恢复进度需另行核对。</p></Disclosure>
    </>}
  </Panel>
}
