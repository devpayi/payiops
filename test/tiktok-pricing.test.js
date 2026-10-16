import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import {newTikTokDraft,normalizeTikTokDraft,calculateTikTok,isTikTokPlan,latestTikTokFamilyPlan} from '../shared/tiktokPricing.js'
import {calculatePricing,newPricingDraft} from '../shared/pricing.js'
import {opPricing} from '../api/_lib/pricing.js'

test('family selection seeds the most recently saved TikTok plan, including updates to an older scenario',()=>{
  const draft={...newTikTokDraft(),productGroupId:'family-a'}
  const first={scenarioId:'first',createdAt:'2026-10-14T00:00:00Z',draft:{...draft,cost:100}}
  const second={scenarioId:'second',createdAt:'2026-10-15T00:00:00Z',draft:{...draft,cost:200}}
  const updated={...first,createdAt:'2026-10-16T00:00:00Z',draft:{...draft,cost:300}}
  assert.equal(latestTikTokFamilyPlan([first,second],'family-a').draft.cost,200)
  assert.equal(latestTikTokFamilyPlan([first,second,updated],'family-a').draft.cost,300)
  const deleted={...updated,createdAt:'2026-10-16T01:00:00Z',deleted:true}
  const shopee={scenarioId:'shopee',createdAt:'2026-10-17T00:00:00Z',draft:{...newPricingDraft(),productGroupId:'family-a',cost:999}}
  assert.equal(latestTikTokFamilyPlan([first,second,updated,deleted,shopee],'family-a').draft.cost,200)
  assert.equal(latestTikTokFamilyPlan([first,second],'family-b'),undefined)
})

test('Mall worksheet baseline: 395 price, 108.06 cost, 33.22% platform, 15% affiliate, 10% profit',()=>{
  const r=calculateTikTok(newTikTokDraft())
  assert.equal(r.valid,true);assert.equal(r.unitCost,10806);assert.equal(r.platformFees,13121.9);assert.equal(r.affiliate,5925)
  assert.equal(r.unitProfit,3950);assert.equal(r.availableAds,5697.1)
  assert.equal(r.learningBudget,56971);assert.equal(r.heroBudget,170913);assert.equal(r.evergreenBudget,284855)
  assert.ok(Math.abs(r.roi-6.933)<.001);assert.equal(r.monthlyProfit,3950000)
  assert.ok(Math.abs(r.unitCost+r.platformFees+r.affiliate+r.unitProfit+r.availableAds-r.unitPrice)<1e-8)
})
test('zero and negative ads budget are explicit; no negative or infinite suggested ad spend',()=>{
  const over=calculateTikTok({...newTikTokDraft(),cost:1000})
  assert.ok(over.availableAds<0);assert.equal(over.roi,null);assert.equal(over.monthlyAds,0);assert.equal(over.heroBudget,0)
  const zero=calculateTikTok({...newTikTokDraft(),price:100,cost:100,packing:0,overhead:0,extraCost:0,transaction:0,commission:0,campaign:0,deals:0,vat:0,affiliate:0,targetMargin:0})
  assert.equal(zero.availableAds,0);assert.equal(zero.roi,null)
  for(const patch of [{price:''},{cost:-1},{vat:101},{affiliate:'invalid'},{monthlyVolume:1.5}]) assert.equal(calculateTikTok({...newTikTokDraft(),...patch}).valid,false)
})
test('TikTok normalization preserves membership, drops arbitrary fields and leaves Shopee fixture unchanged',()=>{
  const input={...newTikTokDraft(),productSkus:['py001','PY001','py002'],settlement:999}
  const d=normalizeTikTokDraft(input)
  assert.deepEqual(d.productSkus,['PY001','PY002']);assert.equal(d.settlement,undefined);assert.equal(isTikTokPlan(d),true)
  assert.equal(isTikTokPlan(newPricingDraft()),false);assert.equal(calculatePricing(newPricingDraft()).unitProfit,18106)
})
test('private API calculates TikTok server-side, recovers idempotently and blocks cross-channel overwrite',async t=>{
  const previous={AUTH_SECRET:process.env.AUTH_SECRET,PRICING_SHEET_ID:process.env.PRICING_SHEET_ID,PRICING_ALLOWED_USERS:process.env.PRICING_ALLOWED_USERS}
  Object.assign(process.env,{AUTH_SECRET:'test-tiktok',PRICING_SHEET_ID:'private-tiktok',PRICING_ALLOWED_USERS:'dev,boss'})
  t.after(()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}})
  const records=[],services={listRevisions:async()=>records,appendRevision:async r=>records.push(r)}
  const response=()=>({setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}})
  const req=(draft,extra={})=>({method:'POST',query:{action:'save-scenario'},user:{u:'dev'},body:{requestId:'00000000-0000-0000-0000-000000000041',draft,...extra}})
  const saved=response();await opPricing(req(newTikTokDraft()),saved,services)
  assert.equal(saved.code,200);assert.equal(saved.data.record.result.availableAds,5697.1);assert.equal(records.length,1)
  const duplicate=response();await opPricing(req(newTikTokDraft()),duplicate,services);assert.equal(duplicate.code,200);assert.equal(records.length,1)
  const record=saved.data.record
  const wrong=response();await opPricing(req(newPricingDraft(),{requestId:'00000000-0000-0000-0000-000000000042',scenarioId:record.scenarioId,parentRevisionId:record.revisionId}),wrong,services)
  assert.equal(wrong.code,409);assert.equal(records.length,1)
  const recovered=response();await opPricing({method:'GET',query:{action:'recover',requestId:record.requestId},user:{u:'boss'}},recovered,services);assert.equal(recovered.data.record.revisionId,record.revisionId)
  const denied=response();await opPricing({...req(newTikTokDraft()),user:{u:'staff'}},denied,services);assert.equal(denied.code,403)
  const edited=response();await opPricing(req({...newTikTokDraft(),price:499},{requestId:'00000000-0000-0000-0000-000000000043',scenarioId:record.scenarioId,parentRevisionId:record.revisionId}),edited,services)
  assert.equal(edited.code,200);assert.equal(edited.data.record.result.unitPrice,49900)
  const statusReq=(action,parentRevisionId,requestId)=>({method:'POST',query:{action},user:{u:'boss'},body:{scenarioId:record.scenarioId,parentRevisionId,requestId}})
  const deleted=response();await opPricing(statusReq('delete-scenario',edited.data.record.revisionId,'00000000-0000-0000-0000-000000000044'),deleted,services)
  assert.equal(deleted.code,200);assert.equal(deleted.data.record.deleted,true);assert.ok(isTikTokPlan(deleted.data.record.draft))
  const restored=response();await opPricing(statusReq('restore-scenario',deleted.data.record.revisionId,'00000000-0000-0000-0000-000000000045'),restored,services)
  assert.equal(restored.code,200);assert.equal(restored.data.record.deleted,false);assert.equal(restored.data.record.result.unitPrice,49900)
})
