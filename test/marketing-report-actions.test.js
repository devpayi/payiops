import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {buildReportImport} from '../api/_lib/marketingReportImport.js'
import {createReportActions} from '../api/_lib/marketingReportActions.js'
import {REPORT_HEADERS,encodeReportRevision,decodeReportState} from '../api/_lib/marketingReportRevisions.js'
import {reportScope} from '../shared/marketingReadModels.js'
import {compareReportReplacement} from '../shared/reportReplacement.js'

const input=spend=>({month:'2026-09',dateFrom:'2026-09-01',dateTo:'2026-09-30',shopId:'123',shopName:'Example',totals:{spend,sales:'20',orders:'1'},campaigns:[{name:'Campaign',grain:'product',spend,sales:'20',orders:'1'}]})
const payload=spend=>({requestId:randomUUID(),action:'import',platform:'TikTok Shop',business:'Payi',files:[{name:'report.json',text:JSON.stringify(input(spend))}]})
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}})
function fixture({products=false,...overrides}={}) {
  const first=buildReportImport(payload('10'))
  if(products){first.report.products=[{itemId:'111',name:'One',spend:'6'},{itemId:'222',name:'Two',spend:'4'}];first.report.productSpend='10';first.report.coverage.productDetail='complete'}
  const rows=[REPORT_HEADERS,...encodeReportRevision(first,{by:'original'})]
  const state=()=>decodeReportState(rows)
  let writes=0
  const handler=createReportActions({authorize:req=>{req.user={username:'tester'};return true},hasAuth:()=>true,configured:()=>true,readState:async()=>state(),append:async record=>{writes++;rows.push(...encodeReportRevision(record,{by:'tester'}))},...overrides})
  const call=async(kind,body,method='POST')=>{const res=response();await handler({method,query:{kind},body},res);return res}
  const review=async body=>{const res=await call('review-report',body);assert.equal(res.code,200,JSON.stringify(res.body));return res.body.review}
  const confirmed=(body,review,extra={})=>({...body,expectedEventId:review.expectedEventId,reviewHash:review.hash,confirmed:true,acknowledgeReduction:true,...extra})
  return {rows,state,call,review,confirmed,writes:()=>writes,scope:reportScope(first.report)}
}

test('preview compares authoritative sources, warns about lost products, and requires hash/confirmation/ack',async()=>{
  const f=fixture({products:true}),body=payload('12'),review=await f.review(body)
  assert.equal(f.writes(),0);assert.equal(review.before.spend,'10');assert.equal(review.after.spend,'12')
  assert.equal(review.metrics.find(row=>row.key==='spend').difference,'2')
  assert.equal(review.missingProducts,2);assert.ok(review.warnings.length>=1)
  assert.equal(JSON.stringify(review).includes('"sourceFiles"'),false)
  for(const extra of [{confirmed:false},{reviewHash:'forged'},{acknowledgeReduction:false}]) {
    assert.equal((await f.call('save-report',f.confirmed(body,review,extra))).code,400)
    assert.equal(f.writes(),0)
  }
  const result=await f.call('save-report',f.confirmed(body,review))
  assert.equal(result.code,200);assert.equal(f.state().records[0].report.spend,'12')
  assert.equal(f.state().history.length,2)
})

test('cancel excludes only its scope, retains originals, and restore references them without copying files',async()=>{
  const f=fixture({products:true}),original=f.state().records[0]
  const other=structuredClone(original);other.report.shopId='456';f.rows.push(...encodeReportRevision(other))
  const cancel={requestId:randomUUID(),action:'cancel',targetEventId:original.eventId},review=await f.review(cancel),save=f.confirmed(cancel,review)
  assert.equal(review.after,null);assert.equal((await f.call('report-action',save)).code,200)
  assert.deepEqual(f.state().records.map(row=>row.report.shopId),['456'])
  const cancelled=f.state().history.find(row=>row.action==='cancelled')
  assert.equal(cancelled.current,false);assert.equal(cancelled.latest,true)
  assert.equal(cancelled.restoreTargetEventId,original.eventId)
  assert.equal(f.state().versions.get(cancelled.eventId).record.sourceFiles,undefined)
  assert.equal((await f.call('report-action',save)).body.alreadyApplied,true);assert.equal(f.writes(),1)
  const restore={requestId:randomUUID(),action:'restore',targetEventId:original.eventId},restoreReview=await f.review(restore)
  assert.equal(restoreReview.before,null);assert.equal(restoreReview.after.productCount,2)
  assert.equal((await f.call('report-action',f.confirmed(restore,restoreReview))).code,200)
  const restored=f.state().records.find(row=>row.report.shopId==='123')
  assert.equal(restored.report.spend,'10');assert.deepEqual(restored.sourceFiles,original.sourceFiles)
  assert.notEqual(restored.eventId,original.eventId)
  // A late retry of the successful cancel must not cancel the restored head.
  const retry=await f.call('report-action',save)
  assert.equal(retry.code,200);assert.equal(retry.body.current,false);assert.equal(f.state().records.length,2)
})

test('stale pages cannot replace, cancel, or restore a newer head, including an ABA return to old data',async()=>{
  const f=fixture(),original=f.state().records[0]
  const staleBody=payload('99'),staleReview=await f.review(staleBody)
  const cancel={requestId:randomUUID(),action:'cancel',targetEventId:original.eventId},cancelReview=await f.review(cancel)
  const fresh=payload('12'),freshReview=await f.review(fresh)
  await f.call('save-report',f.confirmed(fresh,freshReview))
  assert.equal((await f.call('save-report',f.confirmed(staleBody,staleReview))).code,409)
  assert.equal((await f.call('report-action',f.confirmed(cancel,cancelReview))).code,409)
  const restore={requestId:randomUUID(),action:'restore',targetEventId:original.eventId},restoreReview=await f.review(restore)
  await f.call('report-action',f.confirmed(restore,restoreReview))
  assert.equal(f.state().records[0].report.spend,'10')
  assert.equal((await f.call('save-report',f.confirmed(staleBody,staleReview))).code,409)
  // Unguarded writers from before this release cannot overwrite the guarded head.
  f.rows.push(...encodeReportRevision(buildReportImport(payload('999'))))
  assert.equal(f.state().records[0].report.spend,'10');assert.equal(f.state().history[0].action,'conflict')
})

test('concurrent appends accept only the first expected-head match and expose no false success',async()=>{
  let rows,pending=[],release
  const gate=new Promise(resolve=>{release=resolve})
  const f=fixture({append:async record=>{pending.push(record);if(pending.length===2){for(const item of pending)rows.push(...encodeReportRevision(item));release()}await gate}})
  rows=f.rows
  const a=payload('12'),b=payload('13'),ra=await f.review(a),rb=await f.review(b)
  const responses=await Promise.all([f.call('save-report',f.confirmed(a,ra)),f.call('save-report',f.confirmed(b,rb))])
  assert.deepEqual(responses.map(res=>res.code),[200,409])
  assert.equal(f.state().records[0].report.spend,'12')
  assert.equal(f.state().history[0].action,'conflict');assert.equal(f.state().history[0].current,false)
  assert.equal((await f.call('save-report',f.confirmed(b,rb))).code,409)
})

test('concurrent request ID reuse with different payloads cannot poison the journal or return false success',async()=>{
  let rows,pending=[],release
  const gate=new Promise(resolve=>{release=resolve})
  const f=fixture({append:async record=>{pending.push(record);if(pending.length===2){for(const item of pending)rows.push(...encodeReportRevision(item));release()}await gate}})
  rows=f.rows
  const a=payload('12'),b={...payload('13'),requestId:a.requestId},ra=await f.review(a),rb=await f.review(b)
  const result=await Promise.all([f.call('save-report',f.confirmed(a,ra)),f.call('save-report',f.confirmed(b,rb))])
  assert.deepEqual(result.map(response=>response.code),[200,409])
  assert.equal(f.state().records[0].report.spend,'12');assert.equal(f.state().history[0].action,'conflict')
})

test('a lost response can retry the same operation without another append; ID payload reuse is rejected',async()=>{
  let rows,writes=0
  const f=fixture({append:async record=>{writes++;rows.push(...encodeReportRevision(record));throw Error('response lost')}})
  rows=f.rows
  const body=payload('12'),review=await f.review(body),request=f.confirmed(body,review)
  assert.equal((await f.call('save-report',request)).code,503)
  const retry=await f.call('save-report',request)
  assert.equal(retry.code,200);assert.equal(retry.body.alreadyApplied,true);assert.equal(writes,1)
  const altered={...request,files:payload('999').files}
  assert.equal((await f.call('save-report',altered)).code,409);assert.equal(writes,1)
})

test('files already active on the server do not append another revision despite stale client lists',async()=>{
  const f=fixture(),body=payload('10'),review=await f.review(body)
  assert.equal(review.identical,true)
  const result=await f.call('save-report',f.confirmed(body,review))
  assert.equal(result.code,200);assert.equal(result.body.alreadyApplied,true);assert.equal(f.writes(),0)
  assert.equal(f.state().history.length,1)
})

test('product ID replacement warns even with the same count; duplicate physical requests replay once',()=>{
  const a=buildReportImport(payload('10')),b=structuredClone(a)
  a.report.products=[{itemId:'111',name:'Old',spend:'10'}];b.report.products=[{itemId:'222',name:'New',spend:'10'}]
  assert.equal(compareReportReplacement(a,b).missingProducts,1)
  assert.ok(compareReportReplacement(a,b).warnings.length)
  const rows=[REPORT_HEADERS,...encodeReportRevision(a)],original=decodeReportState(rows).records[0]
  const operation={...b,version:2,mutation:{id:randomUUID(),action:'import',expectedEventId:original.eventId}}
  rows.push(...encodeReportRevision(operation),...encodeReportRevision(operation))
  const state=decodeReportState(rows)
  assert.equal(state.history.length,2);assert.equal(state.receipts.size,1)
  assert.equal(state.records[0].report.products[0].itemId,'222')
})

test('guards reject unauthorized, unreviewed, malformed, missing-target and wrong-scope mutations',async()=>{
  for(const [overrides,method,code] of [[{hasAuth:()=>false},'POST',503],[{authorize:(req,res)=>{res.status(403).json({success:false});return false}},'POST',403],[{},'GET',405],[{configured:()=>false},'POST',409]]) {
    const f=fixture({...overrides,readState:()=>{throw Error('must not read')}})
    assert.equal((await f.call('save-report',payload('12'),method)).code,code);assert.equal(f.writes(),0)
  }
  const f=fixture()
  assert.equal((await f.call('save-report',payload('12'))).code,400)
  assert.equal((await f.call('review-report',{...payload('12'),requestId:'bad'})).code,400)
  assert.equal((await f.call('review-report',{requestId:randomUUID(),action:'restore',targetEventId:'absent'})).code,400)
  const original=f.state().records[0],bad={version:2,report:{...original.report,shopId:'other'},mutation:{id:randomUUID(),action:'restore',expectedEventId:null,targetEventId:original.eventId}}
  f.rows.push(...encodeReportRevision(bad))
  assert.throws(()=>f.state(),/ขอบเขต/)
})
