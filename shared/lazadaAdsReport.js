// Verified Lazada exports: Storewide Overview + Sponsored Max Campaign + Promoted Product.
// Preserve different source conversion totals without assuming why they differ.
import {sumReportMoney} from './monthlyAdsReports.js'

const text=value=>String(value??'').trim()
const id=(value,label)=>{if(typeof value!=='string'||!/^\d+$/.test(value))throw Error(`รหัส ${label} ต้องเป็นข้อความตัวเลข`);return value}
const amount=(value,label)=>{if(value===null||value===undefined||text(value)==='')throw Error(`ขาดค่า ${label}`);return sumReportMoney([value])}
const sum=(rows,key)=>sumReportMoney(rows.map(row=>row[key]))
const fullMonth=(from,to)=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(from))throw Error('ต้องใช้รายงานเต็มเดือน')
  const [year,month]=from.split('-').map(Number)
  if(to!==`${from.slice(0,7)}-${new Date(Date.UTC(year,month,0)).getUTCDate()}`)throw Error('ต้องใช้รายงานเต็มเดือน')
}
function table(source,kind,scope) {
  if(!source||!text(source.filename)||!Array.isArray(source.rows)||source.rows.length>50000)throw Error(`ขาดไฟล์ ${kind}`)
  const rows=source.rows
  if(rows.some(row=>!Array.isArray(row)))throw Error('รูปแบบแถวรายงานไม่ถูกต้อง')
  const headerIndex=rows.findIndex(row=>row[0]==='วันที่')
  if(headerIndex<0)throw Error('ไม่พบหัวตารางวันที่')
  const headers=rows[headerIndex].map(text)
  if(new Set(headers).size!==headers.length)throw Error('หัวตารางซ้ำ')
  const meta=new Map(rows.slice(0,headerIndex).filter(row=>row.length>1).map(row=>[text(row[0]),text(row[1])]))
  let exportedAt
  if(kind==='Storewide Overview') {
    const read=prefix=>text(rows.find(row=>text(row[0]).startsWith(prefix))?.[0]).slice(prefix.length).trim()
    if(read('Data Type:')!==kind||read('Seller Id:')!==scope.shopId||read('Seller Name:')!==scope.shopName)throw Error('ร้านหรือประเภทไฟล์ภาพรวมไม่ตรง')
    exportedAt=read('Timing:')
  } else {
    if(meta.get('ReportType')!==kind||meta.get('Venture')!=='TH')throw Error('ไม่รองรับชนิดรายงานหรือประเทศนี้')
    if(meta.get('Seller Info')!==`${scope.shopName}/${scope.shopId}`)throw Error('รหัสร้านในไฟล์ไม่ตรงกัน')
    if(meta.get('Duration')!==`${scope.dateFrom.replaceAll('-','/')} - ${scope.dateTo.replaceAll('-','/')}`)throw Error('ช่วงวันที่ในไฟล์ไม่ตรงเดือนที่เลือก')
    exportedAt=meta.get('CreateTime')
  }
  const required=kind==='Storewide Overview'?['ค่าใช้จ่าย','ยอดรายได้','คำสั่งซื้อ']:['ชื่อแคมเปญ','หมายเลขแคมเปญ','ค่าใช้จ่าย','รายได้','คำสั่งซื้อ',...(kind==='Campaign'?['ประเภทแคมเปญ']:['สินค้าโปรโมต','หมายเลขสินค้าโปรโมต','Product ID (the ID of this product in Product Management)'])]
  for(const header of required)if(!headers.includes(header))throw Error(`ขาดคอลัมน์ ${header}`)
  const seen=new Set()
  const data=rows.slice(headerIndex+1).filter(row=>row.some(cell=>text(cell)!=='' )).map((row,index)=>{
    if(row.length!==headers.length)throw Error(`จำนวนคอลัมน์ไม่ตรงใน ${kind} แถว ${index+1}`)
    const entry=Object.fromEntries(headers.map((header,i)=>[header,row[i]]))
    const raw=text(entry['วันที่']),date=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<scope.dateFrom||date>scope.dateTo||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw Error('วันที่ข้อมูลอยู่นอกเดือนหรือไม่ถูกต้อง')
    const key=JSON.stringify([date,kind==='Campaign'?entry['ประเภทแคมเปญ']:entry['หมายเลขแคมเปญ'],entry['หมายเลขสินค้าโปรโมต']])
    if(seen.has(key))throw Error('พบแถวข้อมูลซ้ำ');seen.add(key)
    const orders=amount(entry['คำสั่งซื้อ'],'คำสั่งซื้อ')
    if(!/^\d+$/.test(orders))throw Error('คำสั่งซื้อต้องเป็นจำนวนเต็ม')
    return {...entry,date,spend:amount(entry['ค่าใช้จ่าย'],'ค่าแอด'),sales:amount(entry[kind==='Storewide Overview'?'ยอดรายได้':'รายได้'],'ยอดขาย'),orders}
  })
  if(!data.length)throw Error(`ไม่มีแถว ${kind} ยืนยันยอดศูนย์ไม่ได้`)
  // Both daily summary exports must explicitly cover every day, including real zeroes.
  if(kind!=='Promoted Product')for(let day=1;day<=Number(scope.dateTo.slice(-2));day++)if(!data.some(row=>row.date===`${scope.month}-${String(day).padStart(2,'0')}`))throw Error('รายงานรายวันไม่ครบเดือน')
  return {data,exportedAt}
}

export function buildLazadaMonthlyReport(input,{business=''}={}) {
  if(!['Payi','Payi Outlet','กรอบรูป'].includes(business))throw Error('เลือกธุรกิจสำหรับรายงาน')
  if(input?.platform!=='Lazada'||input.schemaVersion!==1)throw Error('ไม่รองรับรูปแบบรายงาน Lazada นี้')
  const {dateFrom,dateTo}=input
  fullMonth(text(dateFrom),text(dateTo))
  const scope={month:dateFrom.slice(0,7),dateFrom,dateTo,shopId:id(input.shopId,'ร้าน'),shopName:text(input.shopName)}
  if(!scope.shopName||input.currency!=='THB'||input.timeZone!=='Asia/Bangkok')throw Error('ขาดร้าน สกุลเงิน THB หรือเขตเวลาไทย')
  const overview=table(input.exports?.overview,'Storewide Overview',scope)
  const campaignTable=table(input.exports?.campaigns,'Campaign',scope)
  const productTable=table(input.exports?.products,'Promoted Product',scope)
  // Campaign export currently contains ad-type summaries with N/A campaign IDs.
  // Never misrepresent those rows as actual campaign IDs, or guess coverage of other ad products.
  for(const row of campaignTable.data)if(row['ประเภทแคมเปญ']!=='Sponsored Max Product'||row['หมายเลขแคมเปญ']!=='N/A'||row['ชื่อแคมเปญ']!=='N/A')throw Error('รูปแบบแคมเปญเปลี่ยน ต้องตรวจรายงาน Lazada ใหม่')
  const sourceGroups=new Map(),products=new Map(),promotedProducts=new Map()
  for(const row of productTable.data) {
    const itemId=id(row['Product ID (the ID of this product in Product Management)'],'สินค้า')
    const campaignId=id(row['หมายเลขแคมเปญ'],'แคมเปญ'),promotedId=id(row['หมายเลขสินค้าโปรโมต'],'สินค้าโปรโมต')
    if(promotedProducts.has(promotedId)&&promotedProducts.get(promotedId)!==itemId)throw Error('สินค้าโปรโมตเดียวกันมี Product ID ขัดแย้งกัน')
    promotedProducts.set(promotedId,itemId)
    const name=text(row['สินค้าโปรโมต']),campaignName=text(row['ชื่อแคมเปญ'])
    if(!name||!campaignName)throw Error('ขาดชื่อสินค้า/แคมเปญ')
    const key=JSON.stringify([itemId,campaignId,promotedId])
    const existing=sourceGroups.get(key)
    if(existing)for(const metric of ['spend','sales','orders'])existing[metric]=sumReportMoney([existing[metric],row[metric]])
    else sourceGroups.set(key,{rowId:key,campaignName,platformCampaignId:campaignId,promotedId,itemId,name,spend:row.spend,sales:row.sales,orders:row.orders})
  }
  for(const source of sourceGroups.values()) {
    const product=products.get(source.itemId)||{itemId:source.itemId,name:source.name,familyKey:null,spend:'0',sources:[]}
    product.spend=sumReportMoney([product.spend,source.spend]);product.sources.push(source);products.set(source.itemId,product)
  }
  const reportedTotals=Object.fromEntries(['spend','sales','orders'].map(key=>[key,sum(overview.data,key)]))
  const campaignTotals=Object.fromEntries(['spend','sales','orders'].map(key=>[key,sum(campaignTable.data,key)]))
  const productSpend=sum(productTable.data,'spend')
  const issues=[]
  if(campaignTotals.spend!==reportedTotals.spend)issues.push('ค่าแอด Sponsored Max ไม่ตรงภาพรวมร้าน ยังยืนยันความครบของชนิดโฆษณาไม่ได้')
  if(productSpend!==campaignTotals.spend)issues.push('ค่าแอดรายสินค้าไม่ตรง Sponsored Max')
  for(const row of overview.data) {
    const campaignSpend=sum(campaignTable.data.filter(entry=>entry.date===row.date),'spend')
    const detailSpend=sum(productTable.data.filter(entry=>entry.date===row.date),'spend')
    if(row.spend!==campaignSpend||campaignSpend!==detailSpend)issues.push(`ค่าแอดรายวันไม่ตรง ${row.date}`)
  }
  const campaigns=[{id:'lazada:Sponsored Max Product',name:'Sponsored Max Product (รวมประเภทโฆษณา)',grain:'ad-type',...campaignTotals,sourceRoas:null}]
  return {schemaVersion:1,platform:'Lazada',business,...scope,currency:'THB',timeZone:'Asia/Bangkok',taxBasis:'unknown',...reportedTotals,reportedTotals,campaignTotals,
    productSpend,campaigns,products:[...products.values()],status:issues.length?'needs-review':'reconciled',issues,
    sources:[['overview',overview],['campaigns',campaignTable],['products',productTable]].map(([kind,result])=>({kind:`lazada-${kind}`,filename:input.exports[kind].filename,exportedAt:result.exportedAt||null})),
    coverage:{dateRange:'full-month',productDetail:issues.length?'partial':'complete',adTypes:'Sponsored Max Product · ตรวจค่าแอดกับภาพรวมร้าน',orders:'storewide-purchase-date'},
    attributionNote:'ยอดออเดอร์ของภาพรวมร้านกับ Sponsored Max ต่างกัน ยังไม่ยืนยันสาเหตุ จึงเก็บแยกตามต้นฉบับ ไม่ใช้แทนยอดขายจริงหรือกำไร'}
}
