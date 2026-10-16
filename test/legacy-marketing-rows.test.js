import test from 'node:test'
import assert from 'node:assert/strict'
import {replaceLegacyMarketingSection,commitLegacyMarketingMonth} from '../shared/legacyMarketingRows.js'

const rows=[
  {month:'2026-09',business:'Payi',platform:'Shopee',metric:'ads',value:107.003},
  {month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'ads',value:214.007},
  {month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'affiliate',value:1234.5},
  {month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'other',value:987.65},
  {month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'live',value:0},
  {month:'2026-09',business:'future',platform:'future',metric:'unknown',value:12.34},
  {month:'2026-08',business:'Payi',platform:'TikTok Shop',metric:'live',value:999},
]
test('editing ads preserves every other current-month value, including stored Other and zero',()=>{
  const before=structuredClone(rows)
  const edited=[{business:'Payi',platform:'Shopee',metric:'ads',value:321}]
  const result=replaceLegacyMarketingSection(rows,'2026-09','ads',edited)
  assert.deepEqual(result,[...rows.slice(2,6).map(({month,...row})=>{assert.ok(month);return row}),...edited])
  assert.deepEqual(rows,before)
})
test('editing TikTok sales leaves exact stored Ads unchanged without VAT round-trip',()=>{
  const edited=[{business:'Payi',platform:'TikTok Shop',metric:'live',value:456}]
  const result=replaceLegacyMarketingSection(rows,'2026-09','tiktok',edited)
  assert.deepEqual(result.filter(r=>r.metric==='ads').map(r=>r.value),[107.003,214.007])
  assert.equal(result.find(r=>r.metric==='unknown').value,12.34)
  assert.equal(result.find(r=>r.metric==='live').value,456)
  assert.equal(result.some(r=>r.value===999),false)
})
test('clearing a section only removes that section; cross-section payloads are refused',()=>{
  const result=replaceLegacyMarketingSection(rows,'2026-09','ads',[])
  assert.equal(result.some(r=>r.metric==='ads'),false)
  assert.equal(result.find(r=>r.metric==='other').value,987.65)
  assert.throws(()=>replaceLegacyMarketingSection(rows,'2026-09','ads',[{metric:'live',platform:'TikTok Shop'}]),/ข้ามส่วน/)
  assert.throws(()=>replaceLegacyMarketingSection(rows,'2026-09','tiktok',[{metric:'ads',platform:'TikTok Shop'}]),/ข้ามส่วน/)
})
test('unsupported businesses and platforms survive either form save',()=>{
  const extra=[
    {month:'2026-09',business:'Payi Outlet',platform:'TikTok Shop',metric:'live',value:55},
    {month:'2026-09',business:'Payi',platform:'future-platform',metric:'ads',value:66},
    {month:'2026-09',business:'new-business',platform:'Shopee',metric:'ads',value:77},
  ]
  for(const section of ['ads','tiktok']) {
    const result=replaceLegacyMarketingSection([...rows,...extra],'2026-09',section,[])
    for(const {month,...row} of extra){assert.ok(month);assert.ok(result.some(r=>JSON.stringify(r)===JSON.stringify(row)))}
  }
})
test('next section save uses confirmed submitted snapshot even if reload never succeeds',()=>{
  const snapshot={months:['2026-08','2026-09'],inputs:rows}
  const submitted=replaceLegacyMarketingSection(rows,'2026-09','ads',[{business:'Payi',platform:'Shopee',metric:'ads',value:222.009}])
  const confirmed=commitLegacyMarketingMonth(snapshot,'2026-09',submitted)
  const next=replaceLegacyMarketingSection(confirmed.inputs,'2026-09','tiktok',[{business:'Payi',platform:'TikTok Shop',metric:'live',value:123}])
  assert.equal(next.find(r=>r.metric==='ads').value,222.009)
  assert.equal(snapshot.inputs[0].value,107.003)
  assert.equal(confirmed.inputs.find(r=>r.month==='2026-08').value,999)
})
