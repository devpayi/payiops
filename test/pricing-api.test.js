import test from 'node:test'
import assert from 'node:assert/strict'
import { opPricing } from '../api/_lib/pricing.js'
import { newPricingDraft } from '../shared/pricing.js'
import sheetTools from '../api/sheet-tools.js'
import { signToken } from '../api/_lib/auth.js'
import { pricingConfigured, pricingSheetId } from '../api/_lib/pricingStore.js'

function response() { return { code: 200, headers: {}, status(code) {this.code=code;return this}, setHeader(k,v){this.headers[k]=v}, json(data){this.data=data;return this} } }
function env(t, changes) { const before = Object.fromEntries(Object.keys(changes).map(k=>[k,process.env[k]]));Object.assign(process.env, changes); t.after(()=>{for(const [k,v] of Object.entries(before)) if(v===undefined)delete process.env[k];else process.env[k]=v}) }
const request = (u, method='GET', action='access', body={}) => ({ user:{u,role:'dev'},method,query:{action},body })

test('approved store defaults only in production and keeps dev-only API access', async t => {
  env(t,{VERCEL_ENV:'production',PRICING_SHEET_ID:'',SHEET_ID:'main',AUTH_SECRET:'production-test-secret',PRICING_ALLOWED_USERS:'dev'})
  assert.equal(pricingConfigured(),true)
  const productionId=pricingSheetId()
  assert.ok(productionId)
  const dev=response();await opPricing(request('dev'),dev);assert.equal(dev.data.configured,true)
  const boss=response();await opPricing(request('boss'),boss);assert.equal(boss.data.allowed,false);assert.equal(boss.data.configured,false)
  for(const mode of ['preview','development','']) {
    process.env.VERCEL_ENV=mode
    assert.equal(pricingSheetId(),'');assert.equal(pricingConfigured(),false)
  }
  process.env.VERCEL_ENV='production';process.env.PRICING_SHEET_ID='override-private'
  assert.equal(pricingSheetId(),'override-private')
  process.env.PRICING_SHEET_ID='main';assert.equal(pricingConfigured(),false)
  process.env.PRICING_SHEET_ID='';process.env.SHEET_ID=productionId;assert.equal(pricingConfigured(),false)
})

test('owner review blocks boss on every Pricing route even with stale dev,boss configuration', async t => {
  env(t,{AUTH_SECRET:'test-review-only',PRICING_ALLOWED_USERS:'dev,boss',PRICING_SHEET_ID:'private-test',SHEET_ID:'public-test'})
  let touched=false
  const services={loadCatalog:async()=>{touched=true},listRevisions:async()=>{touched=true},appendRevision:async()=>{touched=true},loadSales:async()=>{touched=true}}
  for(const role of ['boss','dev']) {
    const access=response()
    await sheetTools({method:'GET',query:{op:'pricing',action:'access'},headers:{'x-api-token':signToken({u:'boss',role})}},access)
    assert.equal(access.data.allowed,false)
    for(const [method,action] of [['GET','bootstrap'],['GET','sales'],['GET','recover'],['POST','save-scenario']]) {
      const res=response()
      await opPricing({...request('boss',method,action),user:{u:'boss',role}},res,services)
      assert.equal(res.code,403)
    }
  }
  assert.equal(touched,false)
  delete process.env.PRICING_ALLOWED_USERS
  const dev=response();await opPricing(request('dev'),dev,services);assert.equal(dev.data.allowed,true)
  const boss=response();await opPricing(request('boss'),boss,services);assert.equal(boss.data.allowed,false)
})

test('pricing store cannot point to Ops, archive, or HR', t => {
  env(t, { SHEET_ID:'ops', ARCHIVE_SHEET_ID:'archive', HR_SHEET_ID:'hr', PRICING_SHEET_ID:'private' })
  assert.equal(pricingConfigured(), true)
  for (const value of ['ops','archive','hr','']) {
    process.env.PRICING_SHEET_ID=value
    assert.equal(pricingConfigured(), false)
  }
})

test('pricing API privacy and persistence boundaries', async t => {
  env(t,{AUTH_SECRET:'test-pricing-only',PRICING_ALLOWED_USERS:'dev,boss',PRICING_SHEET_ID:'private-test',SHEET_ID:'public-test'})
  const records=[]
  let writes=0
  const services={listRevisions:async()=>records,appendRevision:async r=>{writes++;records.push(r)},readSheet:async()=>[]}
  for(const user of ['dev','boss']) {const res=response();await opPricing(request(user),res,services);assert.equal(res.data.allowed,user=='dev')}
  const other=response();await opPricing(request('other-dev','GET','bootstrap'),other,services);assert.equal(other.code,403);assert.equal(writes,0)
  process.env.PRICING_ALLOWED_USERS='boss'
  const revoked=response();await opPricing(request('dev','POST','save-scenario',{draft:newPricingDraft(),requestId:'00000000-0000-0000-0000-000000000001'}),revoked,services);assert.equal(revoked.code,403)
  process.env.PRICING_ALLOWED_USERS='dev,boss'
  const unauthenticated=response();await sheetTools({method:'GET',query:{op:'pricing',action:'access'},headers:{}},unauthenticated);assert.equal(unauthenticated.code,401)
  const authenticated=response();await sheetTools({method:'GET',query:{op:'pricing',action:'access'},headers:{'x-api-token':signToken({u:'boss',role:'boss'})}},authenticated);assert.equal(authenticated.data.allowed,false)
  const arbitraryDev=response();await sheetTools({method:'GET',query:{op:'pricing',action:'bootstrap'},headers:{'x-api-token':signToken({u:'other-dev',role:'dev'})}},arbitraryDev);assert.equal(arbitraryDev.code,403)
  const body={draft:newPricingDraft(),requestId:'00000000-0000-0000-0000-000000000001'}
  const saved=response();await opPricing(request('dev','POST','save-scenario',body),saved,services);assert.equal(saved.code,200);assert.equal(writes,1);assert.equal(saved.data.record.createdBy,'dev');assert.equal(saved.data.record.result.profit,18106)
  const duplicate=response();await opPricing(request('dev','POST','save-scenario',body),duplicate,services);assert.equal(duplicate.code,200);assert.equal(writes,1)
  const reuse=response();await opPricing(request('dev','POST','save-scenario',{...body,draft:{...body.draft,price:599}}),reuse,services);assert.equal(reuse.code,409)
  const stale=response();await opPricing(request('dev','POST','save-scenario',{...body,requestId:'00000000-0000-0000-0000-000000000002',scenarioId:records[0].scenarioId,parentRevisionId:'old'}),stale,services);assert.equal(stale.code,409)
  const timeout=response();await opPricing(request('dev','POST','save-scenario',{...body,requestId:'00000000-0000-0000-0000-000000000003'}),timeout,{...services,appendRevision:async()=>{throw Error('timeout')}});assert.equal(timeout.code,503);assert.equal(timeout.data.unknown,true)
  process.env.PRICING_SHEET_ID='public-test'
  const sameSheet=response();await opPricing(request('dev','GET','bootstrap'),sameSheet,services);assert.equal(sameSheet.code,200);assert.equal(sameSheet.data.storageConfigured,false);assert.deepEqual(sameSheet.data.revisions,[])
  const blockedWrite=response();await opPricing(request('dev','POST','save-scenario',body),blockedWrite,services);assert.equal(blockedWrite.code,409)
  const privateFreeRead=response();await opPricing({...request('dev','GET','sales'),query:{action:'sales',sku:'PY001',business:'Payi',endDate:'2026-01-02'}},privateFreeRead,{...services,loadSales:async options=>({sku:options.sku,days30:{units:5}})});assert.equal(privateFreeRead.code,200);assert.equal(privateFreeRead.data.summary.days30.units,5)
  const salesDenied=response();await opPricing({...request('other-dev','GET','sales'),query:{action:'sales',sku:'PY001',business:'Payi'}},salesDenied,services);assert.equal(salesDenied.code,403)
  process.env.AUTH_SECRET=''
  const demo=response();await opPricing(request('dev','GET','bootstrap'),demo,services);assert.equal(demo.code,409);assert.equal(demo.data.demo,true)
})
