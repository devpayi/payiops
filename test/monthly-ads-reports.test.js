import test from 'node:test'
import assert from 'node:assert/strict'
import {parseReportCsv,parseShopeeMonthlyReport,buildShopeeMonthlyReport,sumReportMoney} from '../shared/monthlyAdsReports.js'
import {legacyAdsTotals,legacyTikTokSales,marketingMonthChange,previousMarketingMonth,selectMonthlyReport} from '../shared/marketingReadModels.js'

const csvCell=value=>`"${String(value).replaceAll('"','""')}"`
function file(kind,rows,{period='01/09/2026 - 30/09/2026',shop='123',sales=true}={}) {
  const headers=['ลำดับ',kind==='overview'?'ชื่อโฆษณา':'ชื่อโฆษณา / ชื่อสินค้า','รหัสสินค้า','ค่าโฆษณา',...(sales?['ยอดขาย']:[])]
  return [kind==='overview'?'รายงานโฆษณา CPC ทั้งหมด - Shopee ประเทศไทย':'โฆษณาแบบกลุ่มสินค้า - Shopee {Country}',
    `Shop ID,${shop}`,`ระยะเวลา,${period}`,'',headers.join(','),...rows.map((r,i)=>[i+1,...r].map(csvCell).join(','))].join('\r\n')
}
const parse=(kind,rows,options)=>parseShopeeMonthlyReport(file(kind,rows,options))
const build=(a,b)=>buildShopeeMonthlyReport(a,b,{business:'Payi'})

test('CSV preserves quoted commas, escaped quotes, BOM and embedded newlines; malformed CSV rejected',()=>{
  assert.deepEqual(parseReportCsv('\uFEFFa,b\r\n"name, with ""quotes""","two\nlines"'),[['a','b'],['name, with "quotes"','two\nlines']])
  assert.throws(()=>parseReportCsv('"open'),/ปิด/)
  assert.throws(()=>parseReportCsv('"x"oops'),/ข้อความหลัง/)
})
test('money sums decimal amounts exactly, including greater-than-satang precision and grouped digits',()=>{
  assert.equal(sumReportMoney(['0.1','0.2','0.003']), '0.303')
  assert.equal(sumReportMoney(['1,000.01','0.99']), '1001')
  assert.throws(()=>sumReportMoney(['1,23']),/ตัวเลข/)
})
test('foreign currency or country is rejected, unknown marketplace cannot become THB silently',()=>{
  const source=file('overview',[['a','1','100','500']])
  assert.throws(()=>parseShopeeMonthlyReport(source.replace('Shop ID,123','Currency,USD\nShop ID,123')),/สกุลเงินบาท/)
  assert.throws(()=>parseShopeeMonthlyReport(source.replace('Shop ID,123','Country,PH\nShop ID,123')),/ประเทศไทย/)
  assert.throws(()=>parseShopeeMonthlyReport(source.replace('ประเทศไทย','{Country}')),/ยังยืนยัน/)
  assert.throws(()=>parseShopeeMonthlyReport(source.replace('ประเทศไทย','{Country}').replace('Shop ID,123','Currency,THB\nShop ID,123')),/ยังยืนยัน/)
  assert.equal(parseShopeeMonthlyReport(source).currency,'THB')
})
test('a pending replacement for shop A never overrides shop B or another month in filters',()=>{
  const a={month:'2026-09',business:'Payi',shopId:'A'},b={...a,shopId:'B'},candidate={...a,spend:'999'}
  assert.equal(selectMonthlyReport([a,b],{...a,shopId:'B'},candidate),b)
  assert.equal(selectMonthlyReport([a,b],{...a,month:'2026-08'},candidate),null)
  assert.equal(selectMonthlyReport([a,b],a,candidate),candidate)
})
test('full calendar month comes from header, never the filename; leap months and year boundary work',()=>{
  const rows=[['A','1','0','0']]
  assert.equal(parse('overview',rows,{period:'01/02/2024 - 29/02/2024'}).month,'2024-02')
  assert.equal(previousMarketingMonth('2026-01'),'2025-12')
  assert.throws(()=>parse('overview',rows,{period:'16/09/2026 - 16/10/2026'}),/เต็มเดือน/)
  assert.throws(()=>parse('overview',rows,{period:'01/02/2026 - 29/02/2026'}),/ไม่มีอยู่จริง/)
  assert.throws(()=>previousMarketingMonth('2026-13'),/เดือน/)
})
test('group subtotal and member rows never count twice; same product in two campaigns retains both spends',()=>{
  const a=parse('overview',[['single','1','20','100'],['group','-','30','150']])
  const b=parse('group-detail',[['group','-','30','150'],['same product','1','10','50'],['other','2','20','100']])
  const result=build(a,b)
  assert.equal(result.status,'reconciled');assert.equal(result.spend,'50');assert.equal(result.productSpend,'50')
  assert.equal(result.products.find(r=>r.itemId==='1').spend,'30')
  assert.equal(result.products.find(r=>r.itemId==='1').sources.length,2)
  assert.equal(result.products[0].familyKey,null)
})
test('source data is immutable and unknown VAT/attribution never gets inferred or added',()=>{
  const a=parse('overview',[['a','1','100','500']]),before=JSON.stringify(a)
  const r=build(a)
  assert.equal(r.spend,'100');assert.equal(r.taxBasis,'unknown');assert.equal(a.attributionBasis,'unknown')
  assert.equal(JSON.stringify(a),before)
  assert.equal(r.coverage.adTypes,'product-ads-only');assert.equal(r.coverage.orders,'unknown')
})
test('missing detail is partial; source mismatch and duplicate group names cannot reconcile silently',()=>{
  const a=parse('overview',[['group','-','30','150']])
  assert.equal(build(a).status,'needs-review')
  assert.equal(build(a,parse('group-detail',[['group','-','30','150'],['p','1','29','140']])).status,'needs-review')
  const duplicate=parse('overview',[['group','-','30','150'],['group','-','30','150']])
  assert.equal(build(duplicate,parse('group-detail',[['group','-','30','150'],['p','1','30','150']])).status,'needs-review')
})
test('month/shop mismatch, unknown kind and invalid required metrics stop import',()=>{
  const a=parse('overview',[['a','1','0','0']])
  assert.throws(()=>build(a,parse('group-detail',[['g','-','0','0']],{shop:'999'})),/ร้านและเดือน/)
  assert.throws(()=>build(a,parse('group-detail',[['g','-','0','0']],{period:'01/08/2026 - 31/08/2026'})),/ร้านและเดือน/)
  assert.throws(()=>parse('overview',[['a','1','-','0']]),/ไม่มีค่าแอด/)
  assert.throws(()=>parse('overview',[['a','1','NaN','0']]),/ตัวเลข/)
  assert.throws(()=>parseShopeeMonthlyReport('another report'),/รองรับเฉพาะ/)
  assert.throws(()=>parse('group-detail',[['p','1','1','1']]),/ก่อนแถวกลุ่ม/)
})
test('explicit zero differs from missing optional sales; absent metrics never become zero',()=>{
  assert.equal(build(parse('overview',[['a','1','0','0']])).sales,'0')
  assert.equal(build(parse('overview',[['a','1','0','-']])).sales,null)
  assert.equal(build(parse('overview',[['a','1','0']],{sales:false})).sales,null)
})
test('legacy projection keeps stored VAT-inclusive ads unchanged and TikTok zero/missing distinct',()=>{
  const inputs=[{month:'2026-09',business:'Payi',platform:'Shopee',metric:'ads',value:107},
    {month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'tt_gmv',value:0},
    {month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'affiliate',value:10}]
  const before=JSON.stringify(inputs),r=legacyTikTokSales(inputs,'2026-09','Payi')
  assert.deepEqual(legacyAdsTotals(inputs),{'2026-09':107})
  assert.deepEqual(r.gmv,{value:0,status:'present'})
  assert.equal(r.channels.find(c=>c.metric==='live').status,'absent')
  assert.equal(r.channels.find(c=>c.metric==='other').value,null)
  assert.equal(legacyTikTokSales(inputs,'2026-09','กรอบรูป').gmv.status,'absent')
  assert.equal(JSON.stringify(inputs),before)
})
test('MoM requires adjacent calendar months and explicit values; duplicate legacy keys show conflict',()=>{
  const cur={status:'present',value:0},prev={status:'present',value:100}
  assert.equal(marketingMonthChange(cur,prev,'2026-09','2026-08'),-100)
  assert.equal(marketingMonthChange(cur,prev,'2026-09','2026-07'),null)
  assert.equal(marketingMonthChange({status:'absent',value:null},prev,'2026-09','2026-08'),null)
  assert.equal(marketingMonthChange(cur,{status:'present',value:0},'2026-09','2026-08'),null)
  const row={month:'2026-09',business:'Payi',platform:'TikTok Shop',metric:'tt_gmv',value:10}
  assert.equal(legacyTikTokSales([row,row],'2026-09','Payi').gmv.status,'conflict')
})
