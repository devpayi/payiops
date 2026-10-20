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
