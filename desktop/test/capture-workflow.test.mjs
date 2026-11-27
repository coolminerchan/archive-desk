import {test} from 'node:test'
import assert from 'node:assert/strict'
import {captureSummary,accountIdentity,hasRecordView,recordingStage} from '../ui/capture-workflow.mjs'

test('optional history does not imply missing profession levels or block the main summary',()=>{
  const summary=captureSummary({items:[{id:'life_base',state:'collected'},{id:'life_history',state:'unknown'},{id:'dungeon_details',state:'missing'},{id:'gacha_records',state:'missing'}]})
  assert.equal(summary.total,1);assert.equal(summary.received.length,1)
  assert.equal(summary.remaining.length,0);assert.equal(summary.unknown.length,0);assert.equal(summary.optional.length,2)
})
test('partial data is never counted as a completed category and unknown does not become missing',()=>{
  const summary=captureSummary({items:[{id:'weapon',state:'partial'},{id:'armor',state:'empty'},{id:'poster',state:'unknown'},{id:'main',state:'missing'}]})
  assert.deepEqual(summary.received.map(r=>r.id),['armor'])
  assert.deepEqual(summary.remaining.map(r=>r.id),['weapon','main'])
  assert.deepEqual(summary.unknown.map(r=>r.id),['poster'])
})
test('mixed accounts never show one of their role IDs as the login UID',()=>{
  assert.equal(accountIdentity({accounts:2,accounts_detail:[{player_id:123,player_label:9},{player_id:124,player_label:10}]}).uid,null)
  assert.equal(accountIdentity({accounts:1,accounts_detail:[{player_id:123}]}).uid,null)
  assert.equal(accountIdentity({accounts:1,accounts_detail:[{player_id:123,player_label:9}]}).uid,9)
})
test('record views remain grouped under a single navigation destination',()=>{
  for(const key of ['records','exploration','life','social','progress','scenes','dungeons'])assert.ok(hasRecordView(key))
  assert.equal(hasRecordView('settings'),false)
})
test('recording and finalizing give distinct actions without calling an idle archive complete',()=>{
  assert.equal(recordingStage('recording',null).stage,1)
  assert.equal(recordingStage('stopping',null).stage,2)
  assert.equal(recordingStage(null,{phase:'permission'}).stage,0)
  assert.equal(recordingStage(null,{phase:'complete'}).stage,-1)
})
