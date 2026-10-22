import test from 'node:test'
import {Buffer} from 'node:buffer'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import {buildAdsWorkbookReport,readAdsWorkbook} from '../shared/adsWorkbookImport.js'
import {buildReportImport} from '../api/_lib/marketingReportImport.js'
import {buildAdsSpendOverview} from '../shared/adsSpendOverview.js'
import {encodeReportRevision,decodeReportRevisions,REPORT_HEADERS} from '../api/_lib/marketingReportRevisions.js'

const options={business:'Payi',shopId:'123',shopName:'Example'}
function workbook(name,rows,change=()=>{}) {
  const sheet=XLSX.utils.aoa_to_sheet(rows);change(sheet)
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Report')
  return {name,base64:XLSX.write(book,{type:'base64',bookType:'xlsx'})}
}
function dailyRows() {
  return [['ตามวัน','ต้นทุน','คำสั่งซื้อ SKU (ร้านค้าปัจจุบัน)','รายได้ขั้นต้น (ร้านค้าปัจจุบัน)','สกุลเงิน'],
    ...Array.from({length:30},(_,i)=>[`2026-09-${String(i+1).padStart(2,'0')} 00:00:00`,'0.10',1,'1','THB']),['-','3',30,'30','THB']]
}
const overview=rows=>workbook('Campaign overview data 20260901 - 20260930.xlsx',rows||dailyRows())
const product=(id='9000000000000000001',cost='1')=>workbook('Product data 2026-09-01 - 2026-09-30 - Campaign 1838247992429666.xlsx',[
  ['ชื่อสินค้า','ID สินค้า','ต้นทุน','คำสั่งซื้อ SKU','รายได้ขั้นต้น','สกุลเงิน'],['Product',id,cost,'1','10','THB']])
function lazadaFiles() {
  const days=Array.from({length:30},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`)
  const meta=kind=>[['ReportType',kind],['Venture','TH'],['Seller Info','Example/123'],['CreateTime','2026/10/19'],['Duration','2026/09/01 - 2026/09/30']]
  return [
    workbook('overview.xlsx',[['Seller Id: 123'],['Seller Name: Example'],['Data Type: Storewide Overview'],['Timing: 2026-10-19'],[],['วันที่','ค่าใช้จ่าย','ยอดรายได้','คำสั่งซื้อ'],...days.map(d=>[d.replaceAll('-',''),'0.10','1','1'])]),
    workbook('campaign.xlsx',[...meta('Campaign'),[],['วันที่','ชื่อแคมเปญ','หมายเลขแคมเปญ','ประเภทแคมเปญ','ค่าใช้จ่าย','รายได้','คำสั่งซื้อ'],...days.map(d=>[d,'N/A','N/A','Sponsored Max Product','0.10','1','1'])]),
    workbook('products.xlsx',[...meta('Promoted Product'),[],['วันที่','ชื่อแคมเปญ','หมายเลขแคมเปญ','สินค้าโปรโมต','หมายเลขสินค้าโปรโมต','Product ID (the ID of this product in Product Management)','ค่าใช้จ่าย','รายได้','คำสั่งซื้อ'],...days.map(d=>[d,'Campaign','456','Product','789','9000000000000000001','0.10','1','1'])])]
}

test('original TikTok workbook reconciles daily rows with footer; unallocated spend stays visible',()=>{
  const report=buildAdsWorkbookReport([overview()],options)
  assert.equal(report.spend,'3');assert.equal(report.orders,'30');assert.equal(report.status,'reconciled')
  assert.equal(report.verification,'daily-export');assert.equal(report.coverage.shop,'user-selected')
  assert.deepEqual(report.campaigns,[]);assert.deepEqual(report.products,[])
  const dashboard=buildAdsSpendOverview([report],{month:'2026-09'})
  assert.equal(dashboard.spend,'3');assert.equal(dashboard.unassigned[0].spend,'3')
})
test('TikTok requires shop confirmation, full month, every day, currency and explicit totals',()=>{
  assert.throws(()=>buildAdsWorkbookReport([overview()],{business:'Payi'}),/ร้าน/)
  for(const change of [rows=>rows.splice(2,1),rows=>rows.splice(1,1),rows=>rows.push(rows[1]),rows=>{rows[1][1]=''},rows=>{rows[1][4]='USD'},rows=>rows.pop()]) {
    const rows=dailyRows();change(rows)
    assert.throws(()=>buildAdsWorkbookReport([overview(rows)],options))
  }
  const zero=dailyRows().map((row,i)=>i?[row[0],'0','0','0','THB']:row)
  assert.equal(buildAdsWorkbookReport([overview(zero)],options).spend,'0')
})
test('TikTok preserves long IDs and partial product coverage; rejects duplicates and wrong period',()=>{
  const report=buildAdsWorkbookReport([product(),overview()],options)
  assert.equal(report.products[0].itemId,'9000000000000000001')
  assert.equal(report.products[0].sources[0].platformCampaignId,'1838247992429666')
  assert.equal(report.coverage.productDetail,'partial')
  assert.equal(buildAdsSpendOverview([report],{month:'2026-09'}).unassigned[0].spend,'2')
  assert.throws(()=>buildAdsWorkbookReport([overview(),product(),product()],options),/ซ้ำ/)
  assert.throws(()=>buildAdsWorkbookReport([overview(),{...product(),name:product().name.replace('09-30','08-31')}],options),/เดือนเดียว/)
  assert.throws(()=>buildAdsWorkbookReport([overview(),product(Number('9000000000000000001'))],options),/เลขยาว/)
})
test('server re-parses original Excel; inconsistent totals cannot save; raw files round-trip storage',()=>{
  const payload={platform:'TikTok Shop',...options,files:[overview(),product()],report:{spend:'999'}}
  const record=buildReportImport(payload)
  assert.equal(record.report.spend,'3');assert.equal(record.sourceFiles[0].base64,payload.files[0].base64)
  assert.equal(decodeReportRevisions([REPORT_HEADERS,...encodeReportRevision(record)])[0].report.products[0].itemId,'9000000000000000001')
  const rows=dailyRows();rows.at(-1)[1]='4'
  assert.equal(buildAdsWorkbookReport([overview(rows)],options).status,'needs-review')
  assert.throws(()=>buildReportImport({...payload,files:[overview(rows)]}),/ยังไม่ตรง/)
  assert.throws(()=>buildReportImport({...payload,files:[overview(),product(undefined,'4')]}),/ยังไม่ตรง/)
  assert.throws(()=>buildReportImport({...payload,platform:'Lazada'}),/แพลตฟอร์ม/)
})
test('source footer remains authoritative for cent-rounded daily sales, with visible difference',()=>{
  const rows=dailyRows();rows.at(-1)[3]='30.03'
  const report=buildAdsWorkbookReport([overview(rows)],options)
  assert.equal(report.status,'reconciled');assert.equal(report.sales,'30.03');assert.equal(report.dailyTotals.sales,'30')
  assert.match(report.roundingNotes[0],/0.03/)
  rows.at(-1)[3]='31'
  assert.equal(buildAdsWorkbookReport([overview(rows)],options).status,'needs-review')
  rows.at(-1)[3]='30';rows.at(-1)[1]='3.01'
  assert.equal(buildAdsWorkbookReport([overview(rows)],options).status,'needs-review')
})
test('Lazada original three workbooks autodetect types in any order and preserve exact IDs',()=>{
  const files=lazadaFiles().reverse(),report=buildAdsWorkbookReport(files,{business:'Payi'})
  assert.equal(report.status,'reconciled');assert.equal(report.spend,'3')
  assert.equal(report.products[0].itemId,'9000000000000000001')
  assert.equal(buildReportImport({platform:'Lazada',business:'Payi',files}).report.spend,'3')
  assert.throws(()=>buildAdsWorkbookReport(files.slice(1),options),/3 ไฟล์/)
  assert.throws(()=>buildAdsWorkbookReport([files[0],files[0],files[1]],options),/3 ไฟล์/)
  assert.throws(()=>buildAdsWorkbookReport([...files,overview()],options),/3 ไฟล์/)
})
test('workbook reader rejects formulas, invalid binary and oversized expansion',()=>{
  const good=overview()
  assert.throws(()=>readAdsWorkbook({...good,base64:'not a workbook'}))
  assert.throws(()=>readAdsWorkbook({...good,base64:'AAAA'}),/สมบูรณ์/)
  assert.throws(()=>readAdsWorkbook(workbook('bad.xlsx',[['x'],[1]],sheet=>{sheet.A2.f='1+1'})),/สูตร/)
  const bytes=Buffer.from(good.base64,'base64'),index=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))
  bytes.writeUInt32LE(20_000_001,index+24)
  assert.throws(()=>readAdsWorkbook({...good,base64:bytes.toString('base64')}),/20 MB/)
})
