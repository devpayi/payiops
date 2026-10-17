import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTikTokMonthlyReport} from '../shared/tiktokAdsReport.js'
import {selectMonthlyReport} from '../shared/marketingReadModels.js'

const input=(over={})=>({month:'2026-09',dateFrom:'2026-09-01',dateTo:'2026-09-30',shopId:'123',shopName:'Shop',
  totals:{spend:'300.10',sales:'1500',orders:'12'},
  campaigns:[{name:'A',grain:'product',spend:'200.05',sales:'1000',orders:'8',roas:'5'},{name:'LIVE',grain:'live',spend:'100.05',sales:'500',orders:'4',roas:'5'}],...over})

test('TikTok campaigns that sum to dashboard totals reconcile exactly',()=>{
  const r=buildTikTokMonthlyReport(input(),{business:'Payi'})
  assert.equal(r.status,'reconciled')
  assert.equal(r.spend,'300.1')
  assert.equal(r.platform,'TikTok Shop')
  assert.equal(r.campaigns.length,2)
})
test('any total mismatch needs review instead of silently passing',()=>{
  const r=buildTikTokMonthlyReport(input({totals:{spend:'300.11',sales:'1500',orders:'13'}}),{business:'Payi'})
  assert.equal(r.status,'needs-review')
  assert.equal(r.issues.length,2)
})
test('partial month, missing campaigns and bad grain are rejected',()=>{
  assert.throws(()=>buildTikTokMonthlyReport(input({dateTo:'2026-09-16'}),{business:'Payi'}))
  assert.throws(()=>buildTikTokMonthlyReport(input({campaigns:[]}),{business:'Payi'}))
  assert.throws(()=>buildTikTokMonthlyReport(input({campaigns:[{name:'A',grain:'x',spend:'1',sales:'1',orders:'1'}]}),{business:'Payi'}))
  assert.throws(()=>buildTikTokMonthlyReport(input(),{business:'Other'}))
})
test('platform selector keeps Shopee and TikTok reports of the same month apart',()=>{
  const shopee={month:'2026-09',business:'Payi',shopId:'1'},tiktok=buildTikTokMonthlyReport(input(),{business:'Payi'})
  const scope={month:'2026-09',business:'Payi'}
  assert.equal(selectMonthlyReport([tiktok,shopee],scope),shopee)
  assert.equal(selectMonthlyReport([shopee,tiktok],{...scope,platform:'TikTok Shop'}),tiktok)
  assert.equal(selectMonthlyReport([shopee],{...scope,platform:'TikTok Shop'}),null)
})

test('missing figures are rejected, an explicit zero is accepted',()=>{
  const bare=(patch)=>input({campaigns:[{name:'A',grain:'product',spend:'0',sales:'0',orders:'0',...patch}],totals:{spend:'0',sales:'0',orders:'0'}})
  assert.equal(buildTikTokMonthlyReport(bare({}),{business:'Payi'}).status,'reconciled')
  for(const field of ['spend','sales','orders'])
    for(const empty of [undefined,null,'',' '])assert.throws(()=>buildTikTokMonthlyReport(bare({[field]:empty}),{business:'Payi'}),/ขาดค่า/,`${field}=${empty}`)
  for(const field of ['spend','sales','orders'])assert.throws(()=>buildTikTokMonthlyReport(input({totals:{...input().totals,[field]:undefined}}),{business:'Payi'}),/ขาดค่า/,`totals.${field}`)
  assert.throws(()=>buildTikTokMonthlyReport(input({totals:undefined}),{business:'Payi'}),/ขาดค่า/)
  assert.throws(()=>buildTikTokMonthlyReport(bare({spend:'abc'}),{business:'Payi'}))
})
