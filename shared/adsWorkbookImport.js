// Original Seller Center workbooks. This module runs in both browser and save API.
import * as XLSX from 'xlsx'
import {buildLazadaMonthlyReport} from './lazadaAdsReport.js'
import {sumReportMoney} from './monthlyAdsReports.js'
import {reportMoneyDifference} from './tiktokProductDetails.js'

const text=value=>String(value??'').trim()
const sum=(rows,key)=>sumReportMoney(rows.map(row=>row[key]))
const amount=(value,label)=>{
  if(text(value)==='')throw Error(`ขาดค่า ${label}`)
  return sumReportMoney([value])
}
function fullMonth(from,to) {
  if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(from))throw Error('เลือกช่วงเต็มเดือน ตั้งแต่วันที่ 1 ถึงวันสุดท้ายของเดือน')
  if(to!==`${from.slice(0,7)}-${new Date(Date.UTC(Number(from.slice(0,4)),Number(from.slice(5,7)),0)).getUTCDate()}`)throw Error('เลือกช่วงเต็มเดือน ตั้งแต่วันที่ 1 ถึงวันสุดท้ายของเดือน')
}

export function readAdsWorkbook(file) {
  if(!/\.xlsx$/i.test(file.name)||typeof file.base64!=='string'||!file.base64.length||file.base64.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)||file.base64.length>1_333_336)throw Error('ไฟล์ Excel ไม่ถูกต้องหรือมีขนาดเกิน 1 MB')
  // Bound ZIP expansion before SheetJS decompresses any workbook content.
  const binary=atob(file.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),zip=new DataView(bytes.buffer)
  let end=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(zip.getUint32(i,true)===0x06054b50&&i+22+zip.getUint16(i+20,true)===bytes.length){end=i;break}
  if(end<0)throw Error('ไฟล์ไม่ใช่ Excel (.xlsx) ที่สมบูรณ์')
  const count=zip.getUint16(end+10,true)
  if(count>1000||zip.getUint16(end+4,true)||zip.getUint16(end+6,true))throw Error('ไฟล์ Excel มีขนาดเกินที่รองรับ')
  let offset=zip.getUint32(end+16,true),expanded=0
  for(let i=0;i<count;i++) {
    if(offset+46>end||zip.getUint32(offset,true)!==0x02014b50)throw Error('โครงสร้างไฟล์ Excel ไม่สมบูรณ์')
    expanded+=zip.getUint32(offset+24,true)
    if(expanded>20_000_000)throw Error('ไฟล์ Excel เมื่อเปิดมีขนาดเกิน 20 MB')
    offset+=46+zip.getUint16(offset+28,true)+zip.getUint16(offset+30,true)+zip.getUint16(offset+32,true)
  }
  const book=XLSX.read(file.base64,{type:'base64',cellFormula:true,cellDates:false,sheetRows:50002})
  if(book.SheetNames.length!==1)throw Error('ต้องใช้ Excel ต้นฉบับจากแพลตฟอร์มที่มีหนึ่งชีต')
  const sheet=book.Sheets[book.SheetNames[0]]
  let lastRow=0,lastColumn=0
  for(const [key,cell] of Object.entries(sheet)) {
    if(key.startsWith('!'))continue
    const position=XLSX.utils.decode_cell(key)
    if(position.r>=50000||position.c>=100||sheet['!fullref'])throw Error('ไฟล์รายงานมีขนาดตารางเกินที่รองรับ')
    if(cell.f||cell.t==='e')throw Error('ไม่รับสูตรหรือเซลล์ error กรุณาใช้ไฟล์ต้นฉบับจากแพลตฟอร์ม')
    if(cell.t==='n'&&(!Number.isFinite(cell.v)||Math.abs(cell.v)>Number.MAX_SAFE_INTEGER))throw Error('พบเลขยาวที่ Excel เก็บเป็นตัวเลข กรุณาดาวน์โหลดไฟล์ใหม่ให้ ID เป็นข้อความ')
    lastRow=Math.max(lastRow,position.r);lastColumn=Math.max(lastColumn,position.c)
  }
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true,range:{s:{r:0,c:0},e:{r:lastRow,c:lastColumn}}})
  return {filename:file.name,rows:rows.map(row=>row.map(text))}
}

function lazadaInput(exports) {
  const overview=exports.find(source=>source.rows.some(row=>row[0]==='Data Type: Storewide Overview'))
  const campaigns=exports.find(source=>source.rows.some(row=>row[0]==='ReportType'&&row[1]==='Campaign'))
  const products=exports.find(source=>source.rows.some(row=>row[0]==='ReportType'&&row[1]==='Promoted Product'))
  if(exports.length!==3||!overview||!campaigns||!products)throw Error('Lazada ต้องเลือก Excel 3 ไฟล์พร้อมกัน: ภาพรวมร้าน, Campaign และ Promoted Product')
  const meta=prefix=>text(overview.rows.find(row=>row[0].startsWith(prefix))?.[0]).slice(prefix.length).trim()
  const duration=campaigns.rows.find(row=>row[0]==='Duration')?.[1]?.match(/^(\d{4}\/\d{2}\/\d{2}) - (\d{4}\/\d{2}\/\d{2})$/)
  if(!duration)throw Error('ไม่พบช่วงวันที่ในรายงาน Lazada')
  // Metadata rows are padded by Excel; normalize only table rows to their header width.
  for(const source of exports) {
    const index=source.rows.findIndex(row=>row[0]==='วันที่')
    if(index<0)throw Error('ไม่พบหัวตารางวันที่')
    const headers=source.rows[index]
    while(headers.at(-1)==='')headers.pop()
    for(let i=index+1;i<source.rows.length;i++) {
      if(source.rows[i].slice(headers.length).some(Boolean))throw Error('พบข้อมูลอยู่นอกหัวตาราง')
      source.rows[i]=source.rows[i].slice(0,headers.length)
    }
  }
  return {schemaVersion:1,platform:'Lazada',shopId:meta('Seller Id:'),shopName:meta('Seller Name:'),currency:'THB',timeZone:'Asia/Bangkok',dateFrom:duration[1].replaceAll('/','-'),dateTo:duration[2].replaceAll('/','-'),exports:{overview,campaigns,products}}
}

function tikTokReport(exports,{business,shopId,shopName}) {
  if(!['Payi','Payi Outlet','กรอบรูป'].includes(business))throw Error('เลือกธุรกิจสำหรับรายงาน')
  if(!/^\d+$/.test(shopId)||!text(shopName))throw Error('เลือกร้าน TikTok ที่ดาวน์โหลดไฟล์มา เพราะ Excel ไม่ระบุรหัสร้าน')
  const overviews=exports.filter(source=>source.rows[0]?.includes('ตามวัน'))
  if(overviews.length!==1)throw Error('เลือก Campaign overview data หนึ่งไฟล์ และ Product data ของเดือนเดียวกันได้เพิ่มเติม')
  const overview=overviews[0],headers=overview.rows[0]
  const required=['ตามวัน','ต้นทุน','คำสั่งซื้อ SKU (ร้านค้าปัจจุบัน)','รายได้ขั้นต้น (ร้านค้าปัจจุบัน)','สกุลเงิน']
  for(const key of required)if(!headers.includes(key))throw Error(`ขาดคอลัมน์ ${key}`)
  if(new Set(headers).size!==headers.length)throw Error('หัวตารางซ้ำ')
  const days=new Map(),footer=[]
  for(const row of overview.rows.slice(1).filter(row=>row.some(Boolean))) {
    const entry=Object.fromEntries(headers.map((key,i)=>[key,row[i]]))
    if(entry['ตามวัน']==='-'){footer.push(entry);continue}
    const raw=entry['ตามวัน'],date=raw?.slice(0,10)
    if(!/^\d{4}-\d{2}-\d{2}(?: 00:00:00)?$/.test(raw)||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date||days.has(date))throw Error('วันที่รายงานไม่ถูกต้องหรือซ้ำ')
    if(entry['สกุลเงิน']!=='THB')throw Error('รองรับรายงานสกุลเงิน THB เท่านั้น')
    const orders=amount(entry['คำสั่งซื้อ SKU (ร้านค้าปัจจุบัน)'],'คำสั่งซื้อ SKU')
    if(!/^\d+$/.test(orders))throw Error('คำสั่งซื้อต้องเป็นจำนวนเต็ม')
    days.set(date,{spend:amount(entry['ต้นทุน'],'ต้นทุน'),sales:amount(entry['รายได้ขั้นต้น (ร้านค้าปัจจุบัน)'],'รายได้ขั้นต้น'),orders})
  }
  const dates=[...days.keys()].sort(),dateFrom=dates[0]||'',dateTo=dates.at(-1)||''
  fullMonth(dateFrom,dateTo)
  if(days.size!==Number(dateTo.slice(-2)))throw Error('รายงานรายวันไม่ครบเดือน รวมวันที่ยอดเป็นศูนย์ด้วย')
  const dailyTotals=Object.fromEntries(['spend','sales','orders'].map(key=>[key,sum([...days.values()],key)]))
  if(footer.length!==1||footer[0]['สกุลเงิน']!=='THB')throw Error('ไม่พบแถวรวมท้ายไฟล์ TikTok ที่ตรวจยอดได้')
  const issues=[],roundingNotes=[],totals={}
  for(const [key,label] of [['spend','ต้นทุน'],['sales','รายได้ขั้นต้น (ร้านค้าปัจจุบัน)'],['orders','คำสั่งซื้อ SKU (ร้านค้าปัจจุบัน)']]) {
    totals[key]=amount(footer[0][label],label)
    if(totals[key]===dailyTotals[key])continue
    const difference=reportMoneyDifference(totals[key],dailyTotals[key])
    // The actual export rounds daily sales to cents separately from the monthly footer.
    // Allow only a cent-rounded sales difference bounded by half a cent per daily row + footer.
    const centsOnly=/^\d+(?:\.\d{1,2})?$/.test(totals[key])&&[...days.values()].every(day=>/^\d+(?:\.\d{1,2})?$/.test(day[key]))
    if(key==='sales'&&centsOnly&&Math.abs(Number(difference))<=(days.size+1)*0.005)roundingNotes.push(`รายได้ขั้นต้น: ผลรวมรายวันต่างจากแถวรวม ${difference} บาท อยู่ในขอบเขตการปัดเศษรายวัน ระบบใช้ยอดแถวรวม ${totals[key]} บาท`)
    else issues.push(`ผลรวมรายวันไม่ตรงแถวรวม: ${label}`)
  }
  const products=new Map(),campaigns=[],seen=new Set()
  for(const source of exports.filter(source=>source!==overview)) {
    const match=source.filename.match(/^Product data (\d{4}-\d{2}-\d{2}) - (\d{4}-\d{2}-\d{2}) - Campaign (\d+)(?: \(\d+\))?\.xlsx$/i)
    if(!match||match[1]!==dateFrom||match[2]!==dateTo)throw Error('Product data ต้องเป็นเดือนเดียวกับภาพรวมและคงชื่อไฟล์ที่แพลตฟอร์มให้มา')
    const campaignId=match[3]
    if(seen.has(campaignId))throw Error('เลือก Product data ของแคมเปญเดียวกันซ้ำ');seen.add(campaignId)
    const head=source.rows[0]
    for(const key of ['ชื่อสินค้า','ID สินค้า','ต้นทุน','คำสั่งซื้อ SKU','รายได้ขั้นต้น','สกุลเงิน'])if(!head.includes(key))throw Error(`ขาดคอลัมน์ ${key}`)
    if(new Set(head).size!==head.length)throw Error('หัวตารางซ้ำ')
    const ids=new Set(),values=[]
    for(const row of source.rows.slice(1).filter(row=>row.some(Boolean))) {
      const entry=Object.fromEntries(head.map((key,i)=>[key,row[i]])),itemId=entry['ID สินค้า'],name=entry['ชื่อสินค้า']
      if(!/^\d+$/.test(itemId)||ids.has(itemId)||!name)throw Error('รหัสสินค้าขาดหรือซ้ำในแคมเปญ');ids.add(itemId)
      if(entry['สกุลเงิน']!=='THB')throw Error('รองรับรายงานสกุลเงิน THB เท่านั้น')
      const value={spend:amount(entry['ต้นทุน'],'ต้นทุนสินค้า'),sales:amount(entry['รายได้ขั้นต้น'],'รายได้สินค้า'),orders:amount(entry['คำสั่งซื้อ SKU'],'คำสั่งซื้อสินค้า')}
      if(!/^\d+$/.test(value.orders))throw Error('คำสั่งซื้อต้องเป็นจำนวนเต็ม')
      const product=products.get(itemId)||{itemId,name,spend:'0',sales:'0',orders:'0',sources:[]}
      for(const key of ['spend','sales','orders'])product[key]=sumReportMoney([product[key],value[key]])
      product.sources.push({rowId:`${campaignId}:${itemId}`,campaignName:`Campaign ${campaignId}`,platformCampaignId:campaignId,...value})
      products.set(itemId,product);values.push(value)
    }
    if(!values.length)throw Error('Product data ไม่มีแถวสินค้า ยืนยันยอดศูนย์ไม่ได้')
    // These are product export subtotals, not claimed campaign dashboard totals.
    campaigns.push({id:campaignId,platformCampaignId:campaignId,name:`Campaign ${campaignId} · รวมแถวสินค้า`,grain:'product-export',spend:sum(values,'spend'),sales:sum(values,'sales'),orders:sum(values,'orders'),sourceRoas:null})
  }
  const productSpend=products.size?sum([...products.values()],'spend'):null
  const exceeds=productSpend!==null&&reportMoneyDifference(totals.spend,productSpend).startsWith('-')
  if(exceeds)issues.push('ค่าแอดใน Product data มากกว่าภาพรวม กรุณาตรวจร้านและไฟล์ที่เลือก')
  return {schemaVersion:1,platform:'TikTok Shop',business,shopId,shopName:text(shopName),month:dateFrom.slice(0,7),dateFrom,dateTo,...totals,reportedTotals:totals,dailyTotals,roundingNotes,products:[...products.values()],productSpend,campaigns,
    status:issues.length?'needs-review':'reconciled',verification:'daily-export',issues,taxBasis:'unknown',
    sources:exports.map(source=>({kind:source===overview?'tiktok-daily-overview':'tiktok-product-export',filename:source.filename,exportedAt:null})),
    coverage:{dateRange:'full-month',productDetail:products.size?'partial':'not-captured',adTypes:'GMV Max · ภาพรวมจาก Excel',orders:'platform-reported',shop:'user-selected'},
    attributionNote:'รหัสร้านเลือกโดยผู้ใช้ เพราะไฟล์ไม่ระบุร้าน · ผลรวมจาก Excel รายวัน ไม่ได้ตรวจเทียบยอดรายแคมเปญ · ส่วนที่ไม่มี Product data จะแสดงเป็นค่าแอดที่ยังระบุสินค้าไม่ได้'}
}

export function buildAdsWorkbookReport(files,options) {
  if(!Array.isArray(files)||!files.length||files.length>25)throw Error('เลือก Excel ได้ 1–25 ไฟล์')
  const exports=files.map(readAdsWorkbook)
  const lazada=exports.some(source=>source.rows.some(row=>row[0]?.startsWith('Data Type:')||row[0]==='ReportType'))
  return lazada?buildLazadaMonthlyReport(lazadaInput(exports),options):tikTokReport(exports,options)
}
