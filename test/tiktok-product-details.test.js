import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTikTokMonthlyReport} from '../shared/tiktokAdsReport.js'
import {reportMoneyDifference} from '../shared/tiktokProductDetails.js'
import {buildReportImport} from '../api/_lib/marketingReportImport.js'

function fixture(){return {month:'2026-09',dateFrom:'2026-09-01',dateTo:'2026-09-30',shopId:'123',totals:{spend:'300.10',sales:'1500',orders:'12'},campaigns:[
  {campaignId:'101',name:'A',grain:'product',spend:'150.05',sales:'1000',orders:'8'},
  {campaignId:'102',name:'B',grain:'product',spend:'50',sales:'0',orders:'0'},
  {campaignId:'103',name:'LIVE',grain:'live',spend:'100.05',sales:'500',orders:'4'},
],productDetails:{month:'2026-09',dateFrom:'2026-09-01',dateTo:'2026-09-30',shopId:'123',timeZone:'Asia/Bangkok',source:'Seller Center product table',capturedAt:'2026-10-17',campaigns:[
  {campaignId:'101',reportedProductRows:2,rows:[{itemId:'9000000000000000001',name:'Item X',spend:'100.01',sales:'900',orders:'7'},{itemId:'9000000000000000002',name:'Removed item',status:'ถูกนำออก',spend:'50.01',sales:'100',orders:'1'}]},
  {campaignId:'102',reportedProductRows:1,rows:[{itemId:'9000000000000000001',name:'Item X',spend:'50',sales:'0',orders:'0'}]},
]}}}
const build=input=>buildTikTokMonthlyReport(input,{business:'Payi'})

test('monthly products aggregate actual spend across campaigns while keeping LIVE and source differences separate',()=>{
  const report=build(fixture())
  assert.equal(report.spend,'300.1');assert.equal(report.productSpend,'200.02')
  assert.equal(report.products.length,2)
  const product=report.products.find(p=>p.itemId==='9000000000000000001')
  assert.equal(product.spend,'150.01');assert.equal(product.sources.length,2);assert.equal(product.familyKey,null)
  assert.equal(report.productReconciliation.unallocatedProductSpend,'0.03')
  assert.equal(report.productReconciliation.liveSpend,'100.05')
  assert.equal(report.productReconciliation.totalUnallocatedSpend,'100.08')
  assert.equal(report.productReconciliation.status,'has-differences')
  assert.equal(report.status,'reconciled') // Campaign totals match; product coverage has its own status.
  assert.equal(report.coverage.productDetail,'captured-with-differences')
  assert.equal(report.sources.at(-1).kind,'seller-center-product-details')
})

test('product scope must match the calendar month, account and Bangkok timezone',()=>{
  for(const [field,value] of [['month','2026-08'],['dateFrom','2026-08-31'],['dateTo','2026-09-29'],['shopId','999'],['timeZone','UTC']]){
    const input=fixture();input.productDetails[field]=value;assert.throws(()=>build(input))
  }
  const rolling=fixture();rolling.dateFrom='2026-08-31';rolling.dateTo='2026-09-29';assert.throws(()=>build(rolling),/เต็มเดือน/)
})

test('missing metrics, incomplete pages, missing campaigns and duplicate IDs cannot masquerade as complete',()=>{
  for(const field of ['spend','sales','orders'])for(const absent of [undefined,null,'']){
    const input=fixture();input.productDetails.campaigns[0].rows[0][field]=absent;assert.throws(()=>build(input),/ขาดค่า/)
  }
  const missing=fixture();missing.productDetails.campaigns.pop();assert.throws(()=>build(missing),/ครบทุก/)
  const page=fixture();page.productDetails.campaigns[0].reportedProductRows=3;assert.throws(()=>build(page),/ขาดหน้า/)
  const duplicate=fixture();duplicate.productDetails.campaigns[0].rows[1].itemId=duplicate.productDetails.campaigns[0].rows[0].itemId;assert.throws(()=>build(duplicate),/ซ้ำ/)
  const duplicateCampaign=fixture();duplicateCampaign.productDetails.campaigns[1].campaignId='101';assert.throws(()=>build(duplicateCampaign),/ซ้ำ/)
  const live=fixture();live.productDetails.campaigns[0].campaignId='103';assert.throws(()=>build(live),/ไม่ตรง/)
  const numericId=fixture();numericId.productDetails.campaigns[0].rows[0].itemId=Number('9000000000000000001');assert.throws(()=>build(numericId),/ข้อความ/)
})

test('zero stays explicit and negative reconciliation differences are never hidden',()=>{
  const zero=fixture();zero.campaigns[1].spend='0';zero.totals.spend='250.10';zero.productDetails.campaigns[1].rows[0].spend='0'
  assert.equal(build(zero).products[0].sources[1].spend,'0')
  const excess=fixture();excess.productDetails.campaigns[0].rows[0].spend='101.04'
  assert.equal(build(excess).productReconciliation.campaigns[0].difference,'-1')
  assert.equal(reportMoneyDifference('0','0.0001'),'-0.0001')
  assert.equal(reportMoneyDifference('1,000.0100','1000'),'0.01')
})

test('matching product subtotals can reconcile without allocating LIVE spend to products',()=>{
  const input=fixture();input.productDetails.campaigns[0].rows[1].spend='50.04'
  const report=build(input)
  assert.equal(report.productReconciliation.status,'reconciled')
  assert.equal(report.coverage.productDetail,'complete')
  assert.equal(report.productReconciliation.unallocatedProductSpend,'0')
  assert.equal(report.productReconciliation.totalUnallocatedSpend,'100.05')
  assert.equal(report.productReconciliation.liveSpend,'100.05')
})

test('server import rebuilds products from source, legacy campaign-only input stays supported',()=>{
  const input=fixture()
  const imported=buildReportImport({platform:'TikTok Shop',business:'Payi',files:[{name:'capture.json',text:JSON.stringify(input)}],report:{products:[{spend:'999999'}]}})
  assert.equal(imported.report.products[0].spend,'150.01')
  assert.ok(imported.sourceFiles[0].text.includes('9000000000000000001'))
  delete input.productDetails
  assert.equal(build(input).products.length,0)
  assert.equal(build(input).productReconciliation,undefined)
})
