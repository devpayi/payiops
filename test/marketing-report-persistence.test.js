import test from 'node:test'
import assert from 'node:assert/strict'
import {REPORT_HEADERS,encodeReportRevision,decodeReportRevisions} from '../api/_lib/marketingReportRevisions.js'
import {buildReportImport,createReportImport} from '../api/_lib/marketingReportImport.js'
import {reportStoreConfigured} from '../api/_lib/marketingReportStore.js'
import {monthlyAdsExample} from '../src/data/monthlyAdsExample.js'
import {createMarketingMonthlyRead} from '../api/_lib/marketingMonthlyRead.js'

const input={month:'2026-09',dateFrom:'2026-09-01',dateTo:'2026-09-30',shopId:'123',totals:{spend:'10',sales:'20',orders:'1'},campaigns:[{name:'=source name',grain:'product',spend:'10',sales:'20',orders:'1'}]}
const payload=over=>({platform:'TikTok Shop',business:'Payi',files:[{name:'report.json',text:JSON.stringify(input)}],...over})
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}})

test('source files are recalculated on the server, never trusting submitted result totals',()=>{
  const result=buildReportImport({...payload(),report:{spend:'999999'}})
  assert.equal(result.report.spend,'10')
  assert.equal(result.sourceFiles[0].text,JSON.stringify(input))
  assert.equal(result.sourceFiles[0].sha256.length,64)
  const shopee=buildReportImport({platform:'Shopee',business:'Payi',files:[{name:'overview.csv',text:monthlyAdsExample.overview},{name:'detail.csv',text:monthlyAdsExample.detail}]})
  assert.equal(shopee.report.status,'reconciled')
  assert.equal(shopee.report.platform,'Shopee')
  assert.throws(()=>buildReportImport(payload({platform:'Unknown'})),/ไม่รองรับ/)
  assert.throws(()=>buildReportImport(payload({files:[{name:'bad.json',text:JSON.stringify({...input,totals:{}})}]})),/ขาดค่า/)
})
test('revision chunks round-trip Thai and emoji, retain raw source and validate every byte',()=>{
  const record=buildReportImport(payload())
  record.sourceFiles[0].text='ก😀'.repeat(23000)
  const rows=encodeReportRevision(record,{by:'dev',now:'2026-10-17T00:00:00Z'})
  assert.ok(rows.length>2)
  assert.ok(rows.every(row=>row[8].length<=30000))
  assert.ok(rows.every(row=>!/[\uD800-\uDBFF]$/.test(row[8])))
  const decoded=decodeReportRevisions([REPORT_HEADERS,...rows])
  assert.equal(decoded[0].sourceFiles[0].text,record.sourceFiles[0].text)
  assert.equal(decoded[0].savedBy,'dev')
  const broken=structuredClone(rows);broken[0][8]+='x'
  assert.throws(()=>decodeReportRevisions([REPORT_HEADERS,...broken]),/เปลี่ยน/)
  assert.throws(()=>decodeReportRevisions([REPORT_HEADERS,...rows.slice(0,-1)]),/ยังไม่ยืนยัน/)
  assert.throws(()=>decodeReportRevisions([['wrong'],...rows]),/หัวตาราง/)
})
test('append-only revisions retain latest per scope, A B A and concurrent identical retries do not add totals',()=>{
  const a=buildReportImport(payload()),b=structuredClone(a),shopee=structuredClone(a)
  b.report.spend='11';shopee.report.platform='Shopee'
  const latest=decodeReportRevisions([REPORT_HEADERS,...encodeReportRevision(a),...encodeReportRevision(b),...encodeReportRevision(shopee),...encodeReportRevision(a),...encodeReportRevision(a)])
  assert.equal(latest.length,2)
  assert.equal(latest.find(row=>row.report.platform==='TikTok Shop').report.spend,'10')
})
test('report storage is opt-in and cannot target operational, HR, archive or pricing sheets',()=>{
  const base={MARKETING_REPORTS_SHEET_ID:'private-reports',MARKETING_REPORTS_STORE_APPROVED:'true'}
  assert.equal(reportStoreConfigured(base),true)
  assert.equal(reportStoreConfigured({...base,MARKETING_REPORTS_STORE_APPROVED:'false'}),false)
  for(const field of ['SHEET_ID','ARCHIVE_SHEET_ID','HR_SHEET_ID','PRICING_SHEET_ID'])assert.equal(reportStoreConfigured({...base,[field]:'private-reports'}),false)
  assert.equal(reportStoreConfigured({...base,MARKETING_REPORTS_SHEET_ID:'18vxUJ1bpJdj3DuxbCkOsnvzhDW1z5Vt0lAGhRP0krXY'}),false)
})
test('save route requires auth, role, configuration and valid source before any append',async()=>{
  let writes=0
  const make=over=>createReportImport({hasAuth:()=>true,authorize:req=>{req.user={username:'dev'};return true},configured:()=>true,append:async()=>{writes++;return {revisionId:'verified'}},...over})
  for(const [handler,req,code] of [
    [make({hasAuth:()=>false}),{method:'POST',body:payload()},503],
    [make({authorize:(req,res)=>{res.status(403).json({success:false});return false}}),{method:'POST',body:payload()},403],
    [make({configured:()=>false}),{method:'POST',body:payload()},409],
    [make(),{method:'GET'},405],
    [make(),{method:'POST',body:payload({files:[]})},400],
  ]){const res=response();await handler(req,res);assert.equal(res.code,code)}
  assert.equal(writes,0)
  const res=response();await make()({method:'POST',body:payload()},res)
  assert.equal(res.code,200);assert.equal(res.body.report.spend,'10');assert.equal(writes,1)
  assert.equal(res.headers['Cache-Control'],'no-store')
})

test('explicit zero is persisted while missing totals are rejected before writing',()=>{
  const zero={...input,totals:{spend:'0',sales:'0',orders:'0'},campaigns:[{name:'zero',grain:'product',spend:'0',sales:'0',orders:'0'}]}
  const record=buildReportImport(payload({files:[{name:'zero.json',text:JSON.stringify(zero)}]}))
  assert.equal(decodeReportRevisions([REPORT_HEADERS,...encodeReportRevision(record)])[0].report.spend,'0')
  assert.throws(()=>buildReportImport(payload({files:[{name:'missing.json',text:JSON.stringify({...zero,totals:{...zero.totals,spend:null}})}]})),/ขาดค่า/)
})

test('configured private store is available in production and failures never read legacy inputs',async()=>{
  let legacyReads=0
  const factory=over=>createMarketingMonthlyRead({authorize:()=>true,production:()=>true,hasAuth:()=>true,available:()=>true,persistent:()=>true,readReports:async()=>[{persisted:true,spend:'10'}],readInputs:async()=>{legacyReads++;return []},...over})
  const res=response();await factory()({method:'GET',query:{kind:'monthly-reports'}},res)
  assert.equal(res.body.storage,'private-sheets');assert.equal(res.body.writeAvailable,true)
  assert.equal(res.body.reports[0].persisted,true)
  const failed=response();await factory({readReports:async()=>{throw Error('store unavailable')}})({method:'GET',query:{kind:'monthly-reports'}},failed)
  assert.equal(failed.code,500);assert.equal(failed.body.reports,undefined);assert.equal(legacyReads,0)
})
