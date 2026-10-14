import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPricingCatalog,buildPricingSalesSummary,pricingProductKey,savedPricingCosts,draftForPricingProduct,draftForPricingRecipe,dateOffset } from '../shared/pricingCatalog.js'
import { newPricingDraft,calculatePricing,normalizePricingDraft } from '../shared/pricing.js'
import { bangkokDate,loadPricingSales,loadPricingCatalog } from '../api/_lib/pricingData.js'

test('catalog preserves business, canonical SKU, real variant metadata, price provenance and excludes packaging/correction recipes',()=>{
  const data=buildPricingCatalog({aliases:[{master_sku:'OLD',business:'Payi',display_name:'Shirt',alias_variation:'white M',platform:'Shopee'},{master_sku:'A',business:'Payi Outlet',display_name:'Outlet A'},{master_sku:'SET',business:'Payi',display_name:'Set',alias_variation:'pair'}],inventory:[{sku:'A',retail_price:'500'},{sku:'B',retail_price:''},{sku:'BOX',category:'packaging',retail_price:20}],master:[{sku:'A',color:'white',size:'M'}],redirects:[{old_sku:'OLD',new_sku:'A'},{old_sku:'SET',new_sku:'A'}],recipes:[{set_sku:'SET',variation_name:'pair',component_sku:'OLD',qty_per_unit:2},{set_sku:'WRONG',variation_name:'bad',component_sku:'A',qty_per_unit:1,keep_set_sales:0}]})
  const a=data.catalog.find(p=>p.key===pricingProductKey('Payi','A'))
  assert.equal(a.referencePrice,500);assert.equal(a.referencePriceSource,'inventory_items.retail_price');assert.equal(a.color,'white');assert.equal(a.size,'M');assert.deepEqual(a.variations,['white M'])
  assert.ok(data.catalog.some(p=>p.business==='Payi Outlet' && p.sku==='A'))
  assert.equal(data.catalog.find(p=>p.sku==='B').referencePrice,null)
  assert.equal(data.catalog.some(p=>p.sku==='BOX'),false)
  assert.equal(data.recipes.length,1);assert.equal(data.recipes[0].component_sku,'A')
  assert.deepEqual(data.catalog.find(p=>p.sku==='SET').recipeVariations,['pair'])
})

test('selection resets previous product costs, seeds reference price, recipe uses only saved same-business single costs',()=>{
  const revisions=[{createdAt:'2026-01-01',draft:{business:'Payi',sku:'A',kind:'single',unitCost:100,name:'older'}},{createdAt:'2026-02-01',draft:{business:'Payi',sku:'A',kind:'single',unitCost:150,name:'latest'}},{createdAt:'2026-03-01',draft:{business:'Payi Outlet',sku:'B',kind:'single',unitCost:10}},{createdAt:'2026-04-01',draft:{business:'Payi',sku:'A',kind:'bundle',unitCost:999}}]
  const costs=savedPricingCosts(revisions)
  const p={sku:'A',business:'Payi',name:'A',color:'white',size:'M',referencePrice:500,referencePriceSource:'inventory_items.retail_price',recipeVariations:[]}
  const selected=draftForPricingProduct(newPricingDraft(),p,costs)
  assert.equal(selected.unitCost,150);assert.equal(selected.price,500);assert.equal(selected.monthlyVolume,0);assert.equal(selected.salesSnapshot,null)
  const blank=draftForPricingProduct(newPricingDraft(),{...p,sku:'B',referencePrice:null},costs);assert.equal(blank.unitCost,'');assert.equal(calculatePricing(blank).valid,false)
  const bundle=draftForPricingRecipe({...newPricingDraft(),sku:'SET',unitCost:''},[{set_sku:'SET',variation_name:'pair',component_sku:'A',qty_per_unit:2},{set_sku:'SET',variation_name:'pair',component_sku:'B',qty_per_unit:1}],[p],costs)
  assert.equal(bundle.components[0].cost,150);assert.equal(bundle.components[1].cost,'');assert.equal(bundle.variationName,'pair');assert.equal(calculatePricing(bundle).valid,false)
  bundle.components[1].cost=20;assert.equal(calculatePricing(bundle).unitCost,32000)
  assert.equal(calculatePricing(normalizePricingDraft(bundle)).unitCost,32000)
})

const base={order_key:'one',order_id:'order1',date:'2026-10-14',platform:'Shopee',business:'Payi',master_sku:'A',variation_name:'white M',qty:2,revenue:1000,order_status:'completed'}
test('30/90 windows use Bangkok calendar dates, strict business/channel, cancellations/returns, no duplicate rows or component expansion',()=>{
  const rows=[base,{...base},{...base,order_key:'old',date:'2026-09-10',qty:3,revenue:1350},...['cancelled','returned','refund','ยกเลิก','คืนสินค้า'].map((s,i)=>({...base,order_key:`excluded${i}`,order_status:s})),{...base,order_key:'outlet',business:'Payi Outlet'},{...base,order_key:'tt',platform:'TikTok Shop'},{...base,order_key:'future',date:'2026-10-15'},{...base,order_key:'invalid',date:'2026-09-99'},{...base,order_key:'redirect',master_sku:'OLD',qty:1,revenue:400},{...base,order_key:'set',master_sku:'SET',variation_name:'pair',qty:10,revenue:6000}]
  const opts={sku:'A',business:'Payi',endDate:'2026-10-14',redirects:[{old_sku:'OLD',new_sku:'A'}],recipes:[{set_sku:'SET',variation_name:'pair',component_sku:'A',qty_per_unit:2}]}
  const s=buildPricingSalesSummary(rows,opts)
  assert.equal(s.days30.from,'2026-09-15');assert.equal(s.days90.from,'2026-07-17');assert.equal(s.days30.units,3);assert.equal(s.days90.units,6);assert.equal(s.days90.suggestedMonthlyVolume,2);assert.equal(s.days30.averagePriceSatang,46667)
  const set=buildPricingSalesSummary(rows,{...opts,sku:'SET',variation:'pair'});assert.equal(set.days30.units,10)
  const variant=buildPricingSalesSummary([...rows,{...base,order_key:'other-size',variation_name:'black L',qty:5}],{...opts,variation:'white M'});assert.equal(variant.days30.units,3)
  assert.equal(bangkokDate(new Date('2026-10-13T18:00:00Z')),'2026-10-14')
  assert.throws(()=>dateOffset('2026-02-30',0))
})

test('window boundaries, zero history, and wrong-code correction rows are explicit',()=>{
  const rows=[base,{...base,order_key:'first30',date:'2026-09-15',qty:1},{...base,order_key:'first90',date:'2026-07-17',qty:1},{...base,order_key:'outside90',date:'2026-07-16',qty:999},{...base,order_key:'correction',variation_name:'wrong',qty:999}]
  const options={sku:'A',business:'Payi',endDate:'2026-10-14',recipes:[{set_sku:'A',variation_name:'wrong',component_sku:'B',qty_per_unit:1,keep_set_sales:0}]}
  const s=buildPricingSalesSummary(rows,options);assert.equal(s.days30.units,3);assert.equal(s.days90.units,4);assert.equal(s.skippedCorrections,1)
  const empty=buildPricingSalesSummary([],{...options,missingMonths:['2026-08']});assert.equal(empty.days30.units,0);assert.equal(empty.days30.averagePriceSatang,null);assert.deepEqual(empty.missingMonths,['2026-08'])
})

test('loader batches only requested months, lets existing sheet adapter route archives, returns no order details',async()=>{
  let ranges
  const headers=['order_key','order_id','order_item_id','date','platform','business','sku_platform','product_name','variation_name','master_sku','display_name','qty','revenue','order_status']
  const values=headers.map(h=>base[h] ?? '')
  const result=await loadPricingSales({sku:'A',business:'Payi',endDate:'2026-10-14'},{getMeta:async()=>({sheets:['raw_orders_2026_01','raw_orders_2026_07','raw_orders_2026_09','raw_orders_2026_10'].map(title=>({properties:{title}}))}),batchRead:async r=>{ranges=r;return r.map((_,i)=>({values:i===2 ? [headers,values] : [headers]}))},readSheet:async()=>[]})
  assert.deepEqual(ranges,['raw_orders_2026_07!A:N','raw_orders_2026_09!A:N','raw_orders_2026_10!A:N']);assert.deepEqual(result.missingMonths,['2026-08']);assert.equal(result.days30.units,2);assert.equal('rows' in result,false)
  const data=await loadPricingCatalog({readSheet:async()=>[],master:[]});assert.deepEqual(data.catalog,[])
})

test('saved plan retains the sales basis and variant, no raw revenue/settlement ledger',()=>{
  const d=normalizePricingDraft({...newPricingDraft(),variationName:'white M',color:'white',size:'M',referencePrice:500,referencePriceSource:'inventory_items.retail_price',salesSnapshot:{days:90,units:300,from:'2026-07-17',to:'2026-10-14',sku:'A',business:'Payi',variation:'white M',suggestedMonthlyVolume:100,salesSatang:100000}})
  assert.equal(d.salesSnapshot.suggestedMonthlyVolume,100);assert.equal(d.referencePrice,500);assert.equal(d.variationName,'white M');assert.equal('salesSatang' in d.salesSnapshot,false)
})
