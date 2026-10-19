import test from 'node:test'
import assert from 'node:assert/strict'
import {buildLazadaMonthlyReport} from '../shared/lazadaAdsReport.js'
import {buildReportImport} from '../api/_lib/marketingReportImport.js'
import {encodeReportRevision,decodeReportRevisions,REPORT_HEADERS} from '../api/_lib/marketingReportRevisions.js'

function fixture() {
  const meta=type=>[['ReportType',type],['Venture','TH'],['Seller Info','Example/123'],['CreateTime','2026/10/19 13:00'],['Duration','2026/09/01 - 2026/09/30']]
  const days=Array.from({length:30},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`)
  return {schemaVersion:1,platform:'Lazada',shopId:'123',shopName:'Example',currency:'THB',timeZone:'Asia/Bangkok',dateFrom:days[0],dateTo:days[29],exports:{
    overview:{filename:'overview.xlsx',rows:[['Seller Id: 123'],['Seller Name: Example'],['Data Type: Storewide Overview'],['Timing: 2026-10-19'],['วันที่','ค่าใช้จ่าย','ยอดรายได้','คำสั่งซื้อ'],...days.map(day=>[day.replaceAll('-',''),'0.10','1','1'])]},
    campaigns:{filename:'campaign.xlsx',rows:[...meta('Campaign'),['วันที่','ชื่อแคมเปญ','หมายเลขแคมเปญ','ประเภทแคมเปญ','ค่าใช้จ่าย','รายได้','คำสั่งซื้อ'],...days.map(day=>[day,'N/A','N/A','Sponsored Max Product','0.10','2','2'])]},
    products:{filename:'product.xlsx',rows:[...meta('Promoted Product'),['วันที่','ชื่อแคมเปญ','หมายเลขแคมเปญ','สินค้าโปรโมต','หมายเลขสินค้าโปรโมต','Product ID (the ID of this product in Product Management)','ค่าใช้จ่าย','รายได้','คำสั่งซื้อ'],...days.map(day=>[day,'Product campaign','456','Example product','789','9000000000000000001','0.10','2','2'])]}
  }}
}
const build=input=>buildLazadaMonthlyReport(input,{business:'Payi'})
test('Lazada exact daily spend reconciles while different conversion bases remain separate',()=>{
  const report=build(fixture())
  assert.equal(report.status,'reconciled');assert.equal(report.spend,'3');assert.equal(report.productSpend,'3')
  assert.equal(report.orders,'30');assert.equal(report.campaignTotals.orders,'60')
  assert.equal(report.sales,'30');assert.equal(report.campaignTotals.sales,'60')
  assert.equal(report.products[0].itemId,'9000000000000000001')
  assert.equal(report.products[0].familyKey,null)
  assert.equal(report.products[0].sources[0].platformCampaignId,'456')
  assert.equal(report.campaigns[0].platformCampaignId,undefined)
})
test('Lazada rejects missing values, partial months/days, wrong shops/currency and duplicate daily rows',()=>{
  const changes=[
    input=>{input.exports.products.rows[6][6]=''},
    input=>{input.dateTo='2026-09-29'},
    input=>{input.exports.overview.rows.pop()},
    input=>{input.exports.campaigns.rows[2][1]='Wrong/123'},
    input=>{input.currency='USD'},
    input=>{input.exports.products.rows.push(input.exports.products.rows[6])},
    input=>{input.exports.products.rows[6][5]=Number('9000000000000000001')},
    input=>{input.exports.products.rows[6][0]='2026-10-01'},
    input=>{input.exports.products.rows[6][8]='1.5'},
    input=>{input.exports.campaigns.rows[6][3]='Unverified new format'}
  ]
  for(const change of changes){const input=fixture();change(input);assert.throws(()=>build(input))}
})
test('Lazada explicit zero stays zero; missing products or spend mismatches cannot be published',()=>{
  const input=fixture()
  for(const [kind,offset,index] of [['overview',5,1],['campaigns',6,4],['products',6,6]])for(const row of input.exports[kind].rows.slice(offset))row[index]='0'
  assert.equal(build(input).spend,'0')
  input.exports.products.rows[6][6]='1'
  assert.equal(build(input).status,'needs-review')
  assert.throws(()=>buildReportImport({platform:'Lazada',business:'Payi',files:[{name:'report.json',text:JSON.stringify(input)}]}),/ยังไม่ตรง/)
  input.exports.products.rows=input.exports.products.rows.slice(0,6)
  assert.throws(()=>build(input),/ไม่มีแถว/)
})
test('Lazada server rebuild and journal preserve scope, source and product IDs without touching other platforms',()=>{
  const input=fixture()
  const record=buildReportImport({platform:'Lazada',business:'Payi',files:[{name:'report.json',text:JSON.stringify(input)}],report:{spend:'999'}})
  const other=structuredClone(record);other.report.platform='Shopee'
  const records=decodeReportRevisions([REPORT_HEADERS,...encodeReportRevision(other),...encodeReportRevision(record)])
  assert.equal(records.length,2);assert.equal(record.report.spend,'3')
  assert.equal(records.find(r=>r.report.platform==='Lazada').sourceFiles[0].text,JSON.stringify(input))
})
test('offsetting daily errors do not pass just because monthly totals match',()=>{
  const input=fixture()
  input.exports.products.rows[6][6]='0.2';input.exports.products.rows[7][6]='0'
  const report=build(input)
  assert.equal(report.spend,report.productSpend)
  assert.equal(report.status,'needs-review');assert.equal(report.coverage.productDetail,'partial')
  assert.ok(report.issues.some(issue=>issue.includes('รายวัน')))
})
