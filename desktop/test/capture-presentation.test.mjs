import {test} from 'node:test'
import assert from 'node:assert/strict'
import {equipmentLabel, groupScenes, qualityLabel, sceneCategory, sceneLabel, sceneNote} from '../ui/capture-presentation.mjs'
import {checklistHint, guidedSteps, lifeSocialGuidance} from '../ui/capture-guide.mjs'

test('old cached scene reports use verified names without requiring recapture',()=>{
  assert.equal(sceneLabel(1,{}),'樱庭世界·昼')
  assert.equal(sceneLabel(1002,{}),'鸳鸯锅')
  assert.equal(sceneLabel(6,{}),'夜间场景（资源未命名）')
  assert.ok(sceneNote(6).includes('当前世界配置未列出'))
  assert.equal(sceneLabel(987654,{}),'未命名场景 987654')
})
test('exploration scenes never enter the furniture table, including legacy reports',()=>{
  const rows=[{scene_id:1,garden_furniture:0},{scene_id:1002,garden_furniture:0},{scene_id:9999,garden_furniture:500}]
  const {gardens,worlds}=groupScenes(rows)
  assert.deepEqual(worlds.map(row=>row.scene_id),[1,1002])
  assert.deepEqual(gardens.map(row=>row.scene_id),[9999])
  assert.equal(sceneCategory(1,{}),'开放空间')
  assert.equal(sceneCategory(100,{}),'模拟空间')
})
test('additional preserved equipment does not make a matching list appear unresolved',()=>{
  assert.equal(equipmentLabel({quantity_matches:true,matches:false,other_only:33,reported:[433]}),'列表数量吻合')
  assert.equal(equipmentLabel({list_matches:false,reported:[10]}),'列表数量或实例未通过校验')
  assert.equal(equipmentLabel({list_matches:true,quantity_matches:false,reported:[10]}),'列表数量一致，采集质量另列')
  assert.equal(equipmentLabel({reported:[]}),'未收到装备列表')
})
test('quality labels identify actual evidence gaps without turning missing metadata into damage',()=>{
  assert.equal(qualityLabel({quality:{integrity_known:true},gaps:0,decode_errors:0,unknown:0,tail_directions:0}),'未见异常')
  assert.equal(qualityLabel({quality:{integrity_known:false}}),'旧包未记录检测信息')
  assert.equal(qualityLabel({quality:{integrity_known:true},tail_directions:1}),'未解析尾数据 1 个方向')
  assert.equal(qualityLabel({quality:{integrity_known:true,tcp_gap_directions:2},gaps:0}),'TCP 缺口 2 个方向')
})
test('complete base and social evidence does not request rebrowsing because optional history is missing',()=>{
  const steps=guidedSteps({items:[{id:'life_base',state:'collected',count:6},{id:'life_history',state:'unknown'},
    {id:'social_lists',state:'collected',count:3},{id:'friend',state:'collected',count:4}]})
  const life=steps.find(step=>step.id==='life'),social=steps.find(step=>step.id==='social')
  assert.equal(life.status,'received');assert.equal(life.statusLabel,'基础已保存')
  assert.ok(life.text.includes('可选'));assert.ok(life.text.includes('无需重复'))
  assert.equal(social.status,'received');assert.ok(social.text.includes('无需重复浏览'))
})
test('response-only legacy reports request reanalysis rather than inventing classified coverage',()=>{
  const steps=guidedSteps({items:[{id:'friend',state:'collected',count:4}]})
  const social=steps.find(step=>step.id==='social')
  assert.equal(social.status,'legacy');assert.ok(social.text.includes('重新解析'))
  assert.ok(social.text.includes('无需先回游戏'))
})
test('life and social detail guidance respects successful empty lists and incomplete categories',()=>{
  const section=(ids)=>({expected_types:ids,types:ids.map(type_id=>({type_id,state:'empty'}))})
  const report={attributed:true,base:section([1,2,3,4,5,6]),history:section([1,2,3,4,5,6]),social:section([1,2,3])}
  report.history.types.forEach(row=>row.state='unknown')
  let result=lifeSocialGuidance(report)
  assert.ok(result.base&&result.social&&!result.history)
  assert.ok(result.socialText.includes('无需补充'));assert.ok(result.historyText.includes('可选'))
  report.social.types[2].state='unknown'
  result=lifeSocialGuidance(report);assert.equal(result.social,false)
  assert.ok(result.socialText.includes('尚有未确认项'))
})
test('completed checklist rows suppress generic browse hints while retaining unresolved instructions',()=>{
  assert.equal(checklistHint({id:'manual',state:'collected',hint:'打开图鉴界面'}),'已保存本项返回的记录，无需重复浏览。')
  assert.equal(checklistHint({id:'weapon',state:'collected',detail:'列表外 33 件已保留',hint:'额外来源已保留'}),'额外来源已保留')
  assert.equal(checklistHint({id:'manual',state:'missing',hint:'打开图鉴界面'}),'打开图鉴界面')
})
