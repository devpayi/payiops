import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAdProductHistory} from '../shared/adProductHistory.js'
import {adProductKey} from '../shared/adProductMappings.js'

const report=(month,platform,products)=>({month,platform,business:'Payi',shopId:'1',status:'reconciled',spend:products.reduce((sum,row)=>sum+Number(row.spend),0).toFixed(2),products})
const product=(itemId,spend)=>({itemId,name:'ชื่อที่เปลี่ยนได้',spend,sales:'1000'})
const source=(platform,itemId)=>adProductKey({platform,business:'Payi',shopId:'1',itemId})
const families=[{key:'family',name:'ถุงเท้าเจล',business:'Payi'}]
const mappings=[{sourceKey:source('Shopee','10'),familyKey:'family'},{sourceKey:source('Shopee','11'),familyKey:'family'},{sourceKey:source('TikTok Shop','20'),familyKey:'family'}]
const options={groupKey:'family:family',month:'2026-09',business:'Payi',platform:'__all__',mappings,families}

test('history uses six calendar months and explicit mappings, preserving zero vs missing and platform totals',()=>{
  const reports=[report('2026-07','Shopee',[product('10','10'),product('11','20')]),report('2026-08','Shopee',[product('10','0'),product('11','0')]),report('2026-09','Shopee',[product('10','40'),product('11','50')]),report('2026-09','TikTok Shop',[product('20','25')]),report('2026-10','Shopee',[product('10','999')])]
  const original=structuredClone(reports)
  const result=buildAdProductHistory(reports,options)
  assert.deepEqual(result.points.map(row=>row.month),['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'])
  assert.equal(result.points[0].values.Shopee,null)
  assert.equal(result.points[3].values.Shopee,30)
  assert.equal(result.points[3].roas.Shopee,2000/30)
  assert.equal(result.points[4].values.Shopee,0)
  assert.equal(result.points[4].roas.Shopee,null)
  assert.equal(result.points[4].values['TikTok Shop'],null)
  assert.equal(result.points[5].values.Shopee,90)
  assert.equal(result.points[5].values['TikTok Shop'],25)
  assert.equal(result.points[5].roas.Shopee,2000/90)
  assert.equal(result.points[5].roas['TikTok Shop'],40)
  assert.deepEqual(reports,original)
})

test('history excludes unverified and partial source sets, does not merge similar names, respects filters',()=>{
  const reports=[report('2026-08','Shopee',[product('10','20')]),report('2026-09','Shopee',[product('10','40'),product('11','50'),product('99','100')]),{...report('2026-08','TikTok Shop',[product('20','15')]),status:'needs-review'}]
  const result=buildAdProductHistory(reports,options)
  assert.equal(result.points[4].values.Shopee,null)
  assert.equal(result.points[4].roas.Shopee,null)
  assert.equal(result.points[4].incomplete.Shopee,true)
  assert.equal(result.points[5].values.Shopee,90)
  const raw=buildAdProductHistory(reports,{...options,groupKey:`unmapped:${source('Shopee','99')}`})
  assert.equal(raw.points[5].values.Shopee,100)
  assert.equal(raw.points[4].values.Shopee,null)
  assert.deepEqual(buildAdProductHistory(reports,{...options,platform:'TikTok Shop'}).platforms,[])
  assert.deepEqual(buildAdProductHistory(reports,{...options,shopId:'2'}).platforms,[])
})
