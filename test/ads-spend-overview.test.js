import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAdsSpendOverview,adsSpendPercent,adsRoas} from '../shared/adsSpendOverview.js'

const report=(platform,spend,products,extra={})=>({platform,month:'2026-09',business:'Payi',shopId:'123',shopName:'Example',status:'reconciled',spend,products:products.map(([itemId,name,cost])=>({itemId,name,spend:cost,sources:[]})),...extra})
const scope={month:'2026-09',business:'Payi'}
test('platform shares and product shares use the actual selected spend, never sales or name mapping',()=>{
  const a=report('Shopee','0.3',[['1','Same name','0.1'],['2','Same name','0.2']])
  const b=report('Lazada','0.7',[['1','Same name','0.7']])
  const input=[a,b],before=structuredClone(input),data=buildAdsSpendOverview(input,scope)
  assert.equal(data.spend,'1');assert.equal(data.products.length,3)
  assert.equal(data.platforms.find(p=>p.platform==='Shopee').percent,30)
  assert.equal(data.products[0].percent,70)
  assert.equal(data.platforms.find(p=>p.platform==='TikTok Shop').spend,null)
  assert.deepEqual(input,before)
  const shopee=buildAdsSpendOverview(input,{...scope,platform:'Shopee'})
  assert.equal(shopee.spend,'0.3');assert.equal(shopee.products.length,2)
  assert.equal(shopee.platforms.find(p=>p.platform==='Shopee').percent,30)
  assert.ok(Math.abs(shopee.products[0].percent-200/3)<1e-10)
})
test('full platform denominator includes LIVE and signed product differences; no allocation',()=>{
  const a=report('TikTok Shop','100',[['1','Product','81']],{productReconciliation:{liveSpend:'20'}})
  const data=buildAdsSpendOverview([a],scope)
  assert.equal(data.products[0].percent,81)
  assert.deepEqual(data.unassigned.map(row=>[row.spend,row.percent]),[['20',20],['-1',-1]])
  assert.equal(data.productSpend,'81');assert.equal(data.spend,'100')
})
test('calendar month, business, shops and platform IDs remain separate',()=>{
  const a=report('Shopee','10',[['1','Product','10']])
  const b=report('Shopee','30',[['1','Product','30']],{shopId:'456'})
  const c=report('Lazada','100',[['1','Product','100']],{month:'2026-08'})
  const d=report('Lazada','200',[['1','Product','200']],{business:'กรอบรูป'})
  const data=buildAdsSpendOverview([a,b,c,d],scope)
  assert.equal(data.spend,'40');assert.equal(data.products.length,2)
  assert.equal(data.products[0].platformPercent,75)
  assert.equal(buildAdsSpendOverview([a,b,c,d],{...scope,shopId:'456'}).spend,'30')
  assert.equal(buildAdsSpendOverview([a,b,c,d],{...scope,business:'__all__'}).spend,'240')
  assert.throws(()=>buildAdsSpendOverview([a,a],scope),/ซ้ำ/)
})
test('missing reports are not zero; zero reports stay explicit; unchecked totals stay out',()=>{
  const zero=report('Shopee','0',[['1','Product','0']])
  const pending=report('Lazada','100',[['1','Product','100']],{status:'needs-review'})
  const data=buildAdsSpendOverview([zero,pending],scope)
  assert.equal(data.spend,'0');assert.equal(data.products[0].percent,null)
  assert.equal(data.unverified,1)
  assert.equal(data.platforms.find(p=>p.platform==='Lazada').spend,null)
  assert.equal(buildAdsSpendOverview([],scope).spend,null)
  assert.equal(adsSpendPercent('0','0'),null)
  assert.throws(()=>buildAdsSpendOverview([report('Shopee',null,[])],scope),/ขาด/)
})
test('campaign-only reports keep all unassigned spend instead of inventing products',()=>{
  const data=buildAdsSpendOverview([report('TikTok Shop','50',[])],scope)
  assert.equal(data.products.length,0)
  assert.equal(data.unassigned[0].spend,'50');assert.equal(data.unassigned[0].percent,100)
})
test('ROAS uses attributed sales divided by spend, including weighted platform totals',()=>{
  const a=report('Shopee','1',[['1','Product A','1']],{sales:'10'})
  a.products[0].sales='10'
  const b=report('Shopee','9',[['2','Product B','9']],{sales:'10',shopId:'456'})
  b.products[0].sales='10'
  const data=buildAdsSpendOverview([a,b],scope)
  assert.equal(data.platforms[0].sales,'20');assert.equal(data.platforms[0].roas,2)
  assert.equal(data.products.find(row=>row.itemId==='1').roas,10)
  assert.equal(adsRoas('100','40'),2.5)
  assert.equal(adsRoas('0','40'),0)
  assert.equal(adsRoas('100','0'),null)
  assert.equal(adsRoas(null,'40'),null)
})
test('product sales sum complete campaign sources; a missing source is not silently zero',()=>{
  const a=report('Lazada','20',[['1','Product','20']],{sales:'100'})
  a.products[0].sources=[{spend:'5',sales:'20'},{spend:'15',sales:'80'}]
  assert.equal(buildAdsSpendOverview([a],scope).products[0].roas,5)
  a.products[0].sources[1].sales=null
  assert.equal(buildAdsSpendOverview([a],scope).products[0].roas,null)
  const b=report('Lazada','10',[['2','Other','10']],{shopId:'456',sales:null})
  assert.equal(buildAdsSpendOverview([a,b],scope).platforms.find(row=>row.platform==='Lazada').roas,null)
})
