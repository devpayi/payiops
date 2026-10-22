import test from 'node:test'
import assert from 'node:assert/strict'
import master from '../src/data/productMaster.json' with {type:'json'}
import {buildPricingCatalog} from '../shared/pricingCatalog.js'
import {buildPricingFamilies} from '../shared/pricingFamilies.js'
import {adProductKey,groupAdProducts} from '../shared/adProductMappings.js'
import {resolveSalesProductFamily,salesProductSkuKey} from '../shared/productFamilyBridge.js'

const aliases=master.map(item=>({master_sku:item.sku,display_name:item.name_th,business:'Payi'}))
const families=buildPricingFamilies(buildPricingCatalog({master,aliases}).catalog,aliases)
const sources=family=>family.skus.map(sku=>salesProductSkuKey(family.business,sku))

test('sales SKUs and mapped ads resolve to the same existing Ops family for pictured products',()=>{
  for(const name of ['ถุงเท้าเจล 2in1','แผ่นรองเท้า','ถุงเท้าเจลส้น']) {
    const family=families.find(row=>row.business==='Payi'&&row.name===name)
    assert.ok(family,name)
    assert.deepEqual(resolveSalesProductFamily(sources(family),families),{familyKey:family.key,familyLinkStatus:'linked'})
    const product={platform:'Shopee',business:'Payi',shopId:'shop',itemId:name,name:'marketplace listing',spend:'10',sales:'40',percent:100}
    const groups=groupAdProducts([product],[{sourceKey:adProductKey(product),familyKey:family.key}],families)
    assert.equal(groups[0].familyKey,family.key)
  }
})

test('a pricing family can combine sales groups without relying on their display names',()=>{
  const shoes=families.find(family=>family.name==='รองเท้าเพื่อสุขภาพ Ocean')
  assert.ok(shoes)
  for(const sku of shoes.skus)assert.equal(resolveSalesProductFamily([salesProductSkuKey('Payi',sku)],families).familyKey,shoes.key)
  const renamed=families.map(family=>family===shoes?{...family,name:'ชื่อที่แสดงเปลี่ยนแล้ว'}:family)
  assert.equal(resolveSalesProductFamily(sources(shoes),renamed).familyKey,shoes.key)
})

test('missing, cross-business and mixed-family sales groups never claim one ad family',()=>{
  const first=families.find(family=>family.name==='ถุงเท้าเจล 2in1')
  const second=families.find(family=>family.name==='แผ่นรองเท้า')
  assert.deepEqual(resolveSalesProductFamily([salesProductSkuKey('Payi Outlet',first.skus[0])],families),{familyKey:null,familyLinkStatus:'unmatched'})
  assert.deepEqual(resolveSalesProductFamily([salesProductSkuKey('Payi',first.skus[0]),salesProductSkuKey('Payi',second.skus[0])],families),{familyKey:null,familyLinkStatus:'ambiguous'})
  assert.deepEqual(resolveSalesProductFamily(sources(first),null),{familyKey:null,familyLinkStatus:'unavailable'})
})

test('redirected 360 massage ball uses its canonical name without breaking existing family maps',()=>{
  const aliases=[
    {master_sku:'PY075',business:'Payi',display_name:'[Set คลายเส้น]'},
    {master_sku:'PY077',business:'Payi',display_name:'บอลเทาปุ่ม'},
    {master_sku:'PY077',business:'Payi Outlet',display_name:'บอลเทาปุ่ม'},
    {master_sku:'PY029',business:'Payi',display_name:'ลูกบอลนวด 3in1'},
  ]
  const inventory=[{sku:'PY077',display_name:'บอลเทาปุ่ม(360)',active:'1'}]
  const catalog=buildPricingCatalog({aliases,inventory,redirects:[{old_sku:'PY075',new_sku:'PY077'}]}).catalog
  const groups=buildPricingFamilies(catalog,aliases)
  const ball=groups.find(f=>f.business==='Payi'&&f.skus.includes('PY077'))
  const legacyKey=JSON.stringify(['Payi','[setคลายเส้น]'])
  assert.equal(ball.name,'บอลเทาปุ่ม(360)')
  assert.equal(ball.key,legacyKey)
  assert.deepEqual(ball.skus,['PY077'])
  assert.equal(catalog.find(p=>p.business==='Payi'&&p.sku==='PY077').name,'บอลเทาปุ่ม(360)')
  assert.deepEqual(resolveSalesProductFamily([salesProductSkuKey('Payi','PY077')],groups),{familyKey:legacyKey,familyLinkStatus:'linked'})
  const ad={platform:'Shopee',business:'Payi',shopId:'shop',itemId:'46363283596',name:'ลูกบอล 360',spend:'10',sales:'60',percent:100}
  const mapped=groupAdProducts([ad],[{sourceKey:adProductKey(ad),familyKey:legacyKey}],groups)[0]
  assert.equal(mapped.mapped,true)
  assert.equal(mapped.name,'บอลเทาปุ่ม(360)')
  assert.equal(mapped.spend,'10')
  assert.equal(mapped.roas,6)
  assert.ok(groups.some(f=>f.name==='ลูกบอลนวด 3in1'&&f.skus.includes('PY029')&&f.key!==ball.key))
  assert.equal(groups.find(f=>f.business==='Payi Outlet').name,'บอลเทาปุ่ม')
  const explicit=buildPricingFamilies(catalog,[...aliases,{master_sku:'PY077',business:'Payi',product_group:'ชื่อกลุ่มที่ตั้งเอง'}])
  assert.equal(explicit.find(f=>f.business==='Payi'&&f.skus.includes('PY077')).name,'ชื่อกลุ่มที่ตั้งเอง')
})
