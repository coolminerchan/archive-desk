import React from 'react'
import { ArrowDownToLine, FolderOpen } from 'lucide-react'
import { Action, Blank, Disclosure, Note, Panel } from './capture-ui.jsx'
import { groupScenes, sceneCategory, sceneLabel, sceneNote } from './capture-presentation.mjs'

export default function OwnScenesPage({state,busy,act}) {
  const data=(state.captureSceneReport||state.captureReport)?.own_scenes
  const {gardens,worlds}=groupScenes(data?.scenes||[]),locked=!!state.recording
  return <Panel title="本人场景" description="探索地区与自家装修分别保存。" aside={<div className="actions"><Action name="capture-scenes-open" act={act} busy={busy} disabled={locked} icon={FolderOpen}>打开场景包</Action><Action name="capture-scenes-export" act={act} busy={busy} disabled={locked||!data?.bundle} icon={ArrowDownToLine}>另存</Action></div>}>
    {data?.identity && <Note>{data.identity.uid?`UID ${data.identity.uid}`:'登录 UID 未记录'} · {data.scene_count} 个场景 · {data.snapshot_count} 份记录{data.identity_source==='archive_metadata'?' · 归属来自包内索引':''}</Note>}
    {!!worlds.length && <div data-testid="world-scene-records"><h3 className="c-subheading">探索地区</h3><div className="c-scene-list">{worlds.map(row=><div key={row.scene_id}><span><strong>{sceneLabel(row.scene_id,row)}</strong><small>{sceneCategory(row.scene_id,row)}</small></span><b>{row.snapshots}<small>份记录</small></b></div>)}</div></div>}
    {!!gardens.length && <div data-testid="garden-scene-records"><h3 className="c-subheading">自家装修</h3><div className="exploration-table"><table><thead><tr><th>家园</th><th>家具</th><th>摆放角色</th><th>房间装饰</th></tr></thead><tbody>{gardens.map(row=><tr key={row.scene_id}><td>{sceneLabel(row.scene_id,row)}</td><td>{row.garden_furniture}</td><td>{row.placed_characters}</td><td>{row.room_decor}</td></tr>)}</tbody></table></div></div>}
    {!worlds.length&&!gardens.length && <Blank title="还没有可确认归属的场景">采集账号后进入自己的频道，或打开已有场景包。</Blank>}
    {data && <Disclosure title="场景编号与记录详情"><div className="exploration-table"><table><thead><tr><th>场景</th><th>记录数</th><th>区域</th><th>宝箱</th><th>载具 / 椅子</th></tr></thead><tbody>{(data.scenes||[]).map(row=><tr key={row.scene_id}><td>{sceneLabel(row.scene_id,row)}<small>编号 {row.scene_id}{sceneNote(row.scene_id)&&` · ${sceneNote(row.scene_id)}`}</small></td><td>{row.snapshots}</td><td>{row.areas??'未记录'}</td><td>{row.treasure_boxes??'未记录'}</td><td>{row.vehicles??'—'} / {row.chairs??'—'}</td></tr>)}</tbody></table></div><p>不同记录分别保留，表格展示信息较多的一份，不合并为最终状态。场景区域和宝箱条数不代表全图完成度。</p></Disclosure>}
    {!!state.captureReport?.gardens?.length&&<Disclosure title="旧账号记录中附带的家园装修">{state.captureReport.gardens.map((garden,index)=><div className="c-setting-row" key={garden.owner_uid}><span><strong>{garden.owner_name||'屋主昵称未返回'}</strong><small>家园 {garden.owner_uid} · 家具 {garden.furniture_count??'未确认'} 件</small></span><Action name="capture-export-garden" act={act} busy={busy} disabled={locked||!garden.path} args={{index}} icon={ArrowDownToLine}>单独保存</Action></div>)}</Disclosure>}
  </Panel>
}
