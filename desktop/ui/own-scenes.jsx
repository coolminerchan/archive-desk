import React from 'react'
import { ArrowDownToLine, FolderOpen, Layers } from 'lucide-react'
import { ArtHeading, artwork } from './artwork.jsx'
import { sceneLabel } from './capture-presentation.mjs'

export default function OwnScenesPage({ state, busy, act }) {
  const report = state.captureSceneReport || state.captureReport
  const data = report?.own_scenes
  const rows = data?.scenes || []
  const locked = !!busy || !!state.recording
  const button = (action, text, Icon, disabled) => <button type="button" className="button secondary" data-action={action}
    disabled={locked || disabled} onClick={() => act(action, undefined, action.endsWith('export') ? '本人场景包已校验并保存' : undefined)}><Icon size={16} />{busy === action ? '处理中…' : text}</button>
  return <>
    <ArtHeading title="本人频道场景" description="查看自己频道中已返回的场景快照、摆放角色和环境物件。" art={artwork.morning} />
    <div className="actions">{button('capture-scenes-open', '打开场景或账号包', FolderOpen)}
      {button('capture-scenes-export', '保存本人场景 ZIP', ArrowDownToLine, !data?.bundle)}</div>
    <div className="capture-guide"><strong>{state.recording ? '正在录制，下方是已完成解析的结果' : '场景按归属单独整理'}</strong>
      <p>在「采集与核对」完成账号录制，并进入自己的频道等待场景加载；已有账号包可直接打开。家园请走到各区域等待加载，近处的一份快照不能代表全部家具。</p>
      <p>保留所有不同快照，表格展示信息较多的一份，不跨快照拼接，也不代表最终状态。此页只导出，不写入游戏存档。</p></div>
    {data?.identity && <div className="capture-guide"><strong>{data.identity.uid ? `${data.identity_source === 'archive_metadata' ? '归档 UID' : '登录 UID'} ${data.identity.uid}` : '登录 UID 未记录'}</strong>
      <p>{data.identity_source === 'archive_metadata' ? '归属来自包内索引，未重新验证登录。' : '归属来自本次账号主数据。'}场景 {data.scene_count} 个 · 独立快照 {data.snapshot_count} 份。</p></div>}
    {rows.length ? <div className="exploration-table"><table><thead><tr><th>场景</th><th>独立快照</th><th>观测家具</th><th>摆放角色</th><th>房间装饰</th><th>载具 / 椅子</th><th>宝箱</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.scene_id}><td>{sceneLabel(row.scene_id, row)}<small>场景 {row.scene_id}</small></td><td>{row.snapshots}</td><td>{row.garden_furniture}</td><td>{row.placed_characters}</td><td>{row.room_decor}</td><td>{row.vehicles} / {row.chairs}</td><td>{row.treasure_boxes}</td></tr>)}
    </tbody></table></div> : <div className="empty"><Layers size={18} /><span>尚无可确认属于本人频道的场景。请先采集账号主数据，再进入自己的场景；公共频道不会猜作本人数据。</span></div>}
    {state.captureError && <div className="notice error">{state.captureError}</div>}
  </>
}
