import test from 'node:test'
import assert from 'node:assert/strict'
import {adProductKey,availableAdMappingSources,applyAdMappingBatches,groupAdProducts} from '../shared/adProductMappings.js'
import {encodeAdMappingBatch,decodeAdMappingRows,AD_MAPPING_HEADERS} from '../api/_lib/adProductMappingStore.js'
import {createAdProductMappingHandler} from '../api/_lib/adProductMappings.js'

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const source=(platform='Shopee',shopId='123',itemId='1',business='Payi')=>({platform,business,shopId,itemId})
const a=adProductKey(source()),b=adProductKey(source('TikTok Shop'))
const change=(sourceKey,familyKey='f1',expectedRevision=null)=>({sourceKey,familyKey,expectedRevision})
const batch=(n,changes)=>({version:1,id:id(n),changes})
const families=[{key:'f1',business:'Payi',name:'ถุงเท้าเจล 2in1'},{key:'f2',business:'กรอบรูป',name:'Frame'}]
const response=()=>({code:200,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}})

test('new mapping shows only unmapped sources while editing keeps its mapped sources visible',()=>{
  const products=[{...source(),name:'Mapped',shopName:'Main'},{...source('TikTok Shop'),name:'Unmapped',shopName:'Main'},{...source('Lazada'),name:'Revoked',shopName:'Main'},{...source('Shopee','456'),name:'Invalid target',shopName:'Main'}]
  const mappings=[change(a),change(adProductKey(products[2]),null),change(adProductKey(products[3]),'f2')]
  assert.deepEqual(availableAdMappingSources(products,mappings,families).map(product=>product.name),['Unmapped','Revoked','Invalid target'])
  assert.deepEqual(availableAdMappingSources(products,mappings,families,[a]).map(product=>product.name),['Mapped','Unmapped','Revoked','Invalid target'])
  assert.deepEqual(availableAdMappingSources(products,mappings,families,[],'tiktok').map(product=>product.name),['Unmapped'])
})

test('manual mapping combines product IDs and computes spend-weighted ROAS across platforms',()=>{
  const products=[{...source(),name:'Same listing',spend:'10',sales:'50',percent:10},{...source('TikTok Shop'),name:'Other listing',spend:'20',sales:'100',percent:20},{...source('Lazada'),name:'Same listing',spend:'30',sales:'90',percent:30}]
  const original=structuredClone(products)
  const groups=groupAdProducts(products,[change(a),change(b)],families)
  assert.equal(groups.length,2)
  const group=groups.find(group=>group.mapped)
  assert.equal(group.name,'ถุงเท้าเจล 2in1');assert.equal(group.spend,'30');assert.equal(group.percent,30)
  assert.equal(group.sales,'150');assert.equal(group.roas,5);assert.deepEqual(group.platforms.map(row=>row.roas),[5,5])
  assert.deepEqual(products,original)
  assert.equal(groupAdProducts(products,[],families).length,3)
  assert.equal(groupAdProducts(products,[change(a,'missing')],families).length,3)
  assert.equal(groupAdProducts(products,[change(a,'f2')],families).length,3)
})
test('combined ROAS uses summed attributed sales and spend, never averages platform ratios',()=>{
  const products=[{...source(),name:'Shopee',spend:'10',sales:'80',percent:10},{...source('TikTok Shop'),name:'TikTok',spend:'90',sales:'180',percent:90}]
  const mapped=[change(a),change(b)]
  const group=groupAdProducts(products,mapped,families)[0]
  assert.equal(group.sales,'260');assert.equal(group.spend,'100');assert.equal(group.roas,2.6)
  assert.deepEqual(group.platforms.map(row=>row.roas),[8,2])
  products[1].sales=null
  assert.equal(groupAdProducts(products,mapped,families)[0].roas,null)
})
test('same product ID in different shops/businesses stays separate; same-platform mapped ROAS is weighted',()=>{
  const products=[{...source(),name:'One',spend:'1',sales:'10',percent:10},{...source('Shopee','456'),name:'Two',spend:'9',sales:'10',percent:90}]
  const result=groupAdProducts(products,[change(a),change(adProductKey(products[1]))],families)
  assert.equal(result.length,1);assert.equal(result[0].roas,2)
  products[1].sales=null;assert.equal(groupAdProducts(products,[change(a),change(adProductKey(products[1]))],families)[0].roas,null)
})
test('concurrent mapping batches apply all-or-none and stale writes/unmap cannot overwrite a newer mapping',()=>{
  const first=batch(1,[change(a),change(b)]),stale=batch(2,[change(a,'f2'),change('new','f2')])
  const unmap=batch(3,[change(a,null,id(1))]),remap=batch(4,[change(a,'f1',id(3))])
  const result=applyAdMappingBatches([first,stale,unmap,first,remap])
  assert.deepEqual(result.accepted,[id(1),id(3),id(4)]);assert.deepEqual(result.conflicts,[id(2)])
  assert.equal(result.mappings.some(mapping=>mapping.sourceKey==='new'),false)
  assert.equal(result.mappings.find(mapping=>mapping.sourceKey===a).revision,id(4))
  assert.throws(()=>applyAdMappingBatches([first,{...first,changes:[change(a,'other')]}]),/ซ้ำ/)
})
test('mapping journal validates hashes/headers and retains recoverable unmap revisions',()=>{
  const first=batch(1,[change(a)]),removed=batch(2,[change(a,null,id(1))])
  const rows=[AD_MAPPING_HEADERS,encodeAdMappingBatch(first),encodeAdMappingBatch(removed)]
  assert.equal(decodeAdMappingRows(rows).mappings[0].familyKey,null)
  const corrupt=structuredClone(rows);corrupt[1][4]+='x'
  assert.throws(()=>decodeAdMappingRows(corrupt),/เปลี่ยน/)
  assert.throws(()=>decodeAdMappingRows([['wrong'],...rows.slice(1)]),/หัวตาราง/)
})
const reports=[{platform:'Shopee',business:'Payi',shopId:'123',products:[{itemId:'1'}]}]
const request=(over={})=>({method:'POST',body:{id:id(1),familyKey:'f1',items:[{sourceKey:a,expectedRevision:null}]},...over})
function harness(over={}) {
  const batches=[],writes=[]
  const options={authorize:req=>{req.user={username:'dev'};return true},hasAuth:()=>true,production:()=>true,configured:()=>true,readState:async()=>applyAdMappingBatches(batches),readReports:async()=>reports,loadFamilies:async()=>families,append:async batch=>{writes.push(batch);batches.push(batch)},...over}
  return {handler:createAdProductMappingHandler(options),writes,batches}
}
test('mapping API requires private-store approval/auth/role and never writes on GET',async()=>{
  for(const [options,code] of [[{hasAuth:()=>false},503],[{authorize:(req,res)=>{res.status(403).json({});return false}},403],[{configured:()=>false},409]]){
    const h=harness(options),res=response();await h.handler(request(),res);assert.equal(res.code,code);assert.equal(h.writes.length,0)
  }
  const h=harness(),res=response();await h.handler({method:'GET'},res)
  assert.equal(res.code,200);assert.equal(res.body.families.length,2);assert.equal(h.writes.length,0)
})
test('mapping API validates report source and product family business, then confirms save/idempotency',async()=>{
  const h=harness(),res=response();await h.handler(request(),res)
  assert.equal(res.code,200);assert.equal(res.body.mappings[0].familyKey,'f1');assert.equal(h.writes.length,1)
  const replay=response();await h.handler(request(),replay);assert.equal(replay.body.alreadyApplied,true);assert.equal(h.writes.length,1)
  for(const body of [{id:id(2),familyKey:'f2',items:[{sourceKey:a,expectedRevision:id(1)}]},{id:id(2),familyKey:'f1',items:[{sourceKey:'unknown',expectedRevision:null}]}]){
    const bad=response();await h.handler(request({body}),bad);assert.equal(bad.code,400);assert.equal(h.writes.length,1)
  }
  const stale=response();await h.handler(request({body:{id:id(2),familyKey:null,items:[{sourceKey:a,expectedRevision:null}]}}),stale);assert.equal(stale.code,409);assert.equal(h.writes.length,1)
})
test('post-append race reports conflict rather than claiming an unaccepted save',async()=>{
  let reads=0
  const h=harness({readState:async()=>++reads===1?applyAdMappingBatches([]):applyAdMappingBatches([batch(99,[change(a)])])}),res=response()
  await h.handler(request(),res);assert.equal(res.code,409)
})
