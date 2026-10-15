import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPricingFamilies, draftForPricingFamily, pricingFamilyCost } from '../shared/pricingFamilies.js'
import { buildPricingSalesSummary, draftForPricingProduct, pricingProductKey, savedPricingCosts } from '../shared/pricingCatalog.js'
import { newPricingDraft, normalizePricingDraft } from '../shared/pricing.js'
import { loadPricingSales } from '../api/_lib/pricingData.js'

const item=(sku,name,business='Payi',referencePrice=500,recipeVariations=[])=>({sku,name,business,referencePrice,recipeVariations,key:pricingProductKey(business,sku)})
const catalog=[item('PY001','ถุงเท้าเจลส้น M'),item('PY002','ถุงเท้าเจลส้น L'),item('PY003','ถุงเท้าเจลฝ่า M'),item('PY001','ถุงเท้าเจลส้น M','Payi Outlet')]

test('pricing picker merges colors/sizes into families, preserves business and distinct products/recipes',()=>{
  const groups=buildPricingFamilies([...catalog,item('PY015','แผ่นรองเท้า M ดำ'),item('PY016','แผ่นรองเท้า L ฟ้า'),item('SET-A','เซ็ต M','Payi',500,['shirt']),item('SET-B','เซ็ต L','Payi',500,['socks'])])
  const heel=groups.find(g=>g.business==='Payi'&&g.name==='ถุงเท้าเจลส้น')
  assert.deepEqual(heel.skus,['PY001','PY002'])
  assert.deepEqual(groups.find(g=>g.name==='แผ่นรองเท้า').skus,['PY015','PY016'])
  assert.equal(groups.filter(g=>g.kind==='bundle').length,2)
  assert.equal(groups.filter(g=>g.name==='ถุงเท้าเจลส้น').length,2)
  assert.ok(groups.some(g=>g.name==='ถุงเท้าเจลฝ่า')) // Equal price is not the grouping criterion.
})

test('existing Ops group overrides are scoped to the business',()=>{
  const groups=buildPricingFamilies(catalog,[{business:'Payi',master_sku:'PY001',product_group:'รุ่น A'},{business:'Payi',master_sku:'PY002',product_group:'รุ่น A'},{business:'Payi Outlet',master_sku:'PY001',product_group:'รุ่น Outlet'}])
  assert.equal(groups.find(g=>g.name==='รุ่น A').skus.length,2)
  assert.equal(groups.find(g=>g.business==='Payi Outlet').name,'รุ่น Outlet')
})

test('conflicting prices/costs remain blank; shared plan cost does not overwrite component SKU costs',()=>{
  const [family]=buildPricingFamilies([item('PY001','ถุงเท้าเจลส้น M'),item('PY002','ถุงเท้าเจลส้น L','Payi',600)])
  assert.equal(family.priceConflict,true);assert.equal(family.referencePrice,null)
  const costs=new Map([[pricingProductKey('Payi','PY001'),{cost:100}],[pricingProductKey('Payi','PY002'),{cost:150}]])
  assert.equal(pricingFamilyCost(family,costs),null)
  const draft=draftForPricingFamily(newPricingDraft(),family,costs)
  assert.equal(draft.price,'');assert.equal(draft.unitCost,'');assert.equal(draft.productName,'ถุงเท้าเจลส้น')
  const saved=normalizePricingDraft({...draft,price:549,unitCost:150})
  assert.deepEqual(saved.productSkus,['PY001','PY002']);assert.equal(saved.productGroupId,family.key)
  const memory=savedPricingCosts([{scenarioId:'family',draft:saved,createdAt:'2026-01-01'}])
  assert.equal(pricingFamilyCost(family,memory).cost,150)
  assert.equal(memory.has(pricingProductKey('Payi','PY002')),false)
  const single=draftForPricingProduct(saved,catalog[2],memory)
  assert.equal(single.productGroupId,'');assert.deepEqual(single.productSkus,[])
  assert.equal(normalizePricingDraft(newPricingDraft()).productGroupId,'')
})

test('family sales combine member SKU quantities once and exclude other products/businesses',()=>{
  const row=(sku,qty,order_key,business='Payi')=>({master_sku:sku,qty,revenue:qty*500,order_key,order_id:order_key,date:'2026-01-10',business,platform:'Shopee',order_status:'สำเร็จ'})
  const a=row('PY001',2,'a'),b=row('PY002',3,'b')
  const result=buildPricingSalesSummary([a,b,a,row('PY003',9,'c'),row('PY002',8,'d','Payi Outlet')],{sku:'PY001',skus:['PY001','PY002'],business:'Payi',endDate:'2026-01-10'})
  assert.equal(result.days30.units,5);assert.equal(result.days90.units,5);assert.equal(result.days30.orders,2)
})

test('sales endpoint resolves family membership from Ops rather than trusting client SKU lists',async()=>{
  const aliases=catalog.filter(p=>p.business==='Payi').map(p=>({master_sku:p.sku,display_name:p.name,business:p.business}))
  const family=buildPricingFamilies(catalog).find(g=>g.business==='Payi'&&g.name==='ถุงเท้าเจลส้น')
  const headers=['order_key','order_id','date','platform','business','master_sku','qty','revenue','order_status']
  const services={master:[],readSheet:async name=>name==='product_aliases'?aliases:[],getMeta:async()=>({sheets:[{properties:{title:'raw_orders'}}]}),batchRead:async()=>[{values:[headers,['a','a','2026-01-10','Shopee','Payi','PY001',2,1000,'สำเร็จ'],['b','b','2026-01-10','Shopee','Payi','PY002',3,1500,'สำเร็จ'],['c','c','2026-01-10','Shopee','Payi','PY003',9,4500,'สำเร็จ']]}]}
  const result=await loadPricingSales({sku:'PY001',productGroupId:family.key,skus:['PY003'],business:'Payi',endDate:'2026-01-10'},services)
  assert.equal(result.days30.units,5)
  await assert.rejects(()=>loadPricingSales({sku:'PY001',productGroupId:family.key,business:'Payi Outlet',endDate:'2026-01-10'},services),/ไม่พบกลุ่มสินค้า/)
})
