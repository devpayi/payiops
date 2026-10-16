// Source CSV -> read-only monthly report. Never writes marketing_inputs.
const clean=value=>String(value ?? '').trim()
const missing=value=>['','-','—','N/A'].includes(clean(value))

export function parseReportCsv(text) {
  if(typeof text!=='string' || text.length>5_000_000) throw Error('ไฟล์ต้องเป็น CSV ขนาดไม่เกิน 5 MB')
  const rows=[],row=[]
  let cell='',quoted=false,endedQuote=false
  const source=text.replace(/^\uFEFF/,'')
  for(let i=0;i<source.length;i++) {
    const ch=source[i]
    if(quoted) {
      if(ch==='"' && source[i+1]==='"') {cell+='"';i++}
      else if(ch==='"') {quoted=false;endedQuote=true}
      else cell+=ch
    } else if(ch==='"') {
      if(cell || endedQuote) throw Error('รูปแบบ CSV ไม่ถูกต้อง: เครื่องหมายคำพูด')
      quoted=true
    } else if(ch===',' || ch==='\n' || ch==='\r') {
      row.push(cell);cell='';endedQuote=false
      if(ch!==',') {if(row.some(v=>v!=='')) rows.push([...row]);row.length=0;if(ch==='\r' && source[i+1]==='\n')i++}
    } else {
      if(endedQuote) throw Error('รูปแบบ CSV ไม่ถูกต้อง: ข้อความหลังเครื่องหมายคำพูด')
      cell+=ch
    }
  }
  if(quoted) throw Error('รูปแบบ CSV ไม่ถูกต้อง: ปิดเครื่องหมายคำพูดไม่ครบ')
  row.push(cell);if(row.some(v=>v!==''))rows.push(row)
  return rows
}

function decimal(value) {
  const raw=clean(value)
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) throw Error(`ตัวเลขไม่ถูกต้อง: ${raw}`)
  const [whole,fraction='']=raw.replaceAll(',','').split('.')
  return `${whole.replace(/^0+(?=\d)/,'')}${fraction.replace(/0+$/,'')?'.'+fraction.replace(/0+$/,''):''}`
}
function parts(value) {const [a,b='']=value.split('.');return {digits:BigInt(a+b),scale:b.length}}
function fromParts(digits,scale) {
  const text=digits.toString().padStart(scale+1,'0')
  return decimal(scale ? text.slice(0,-scale)+'.'+text.slice(-scale) : text)
}
export function sumReportMoney(values) {
  const amounts=values.filter(v=>v!==null && v!==undefined).map(v=>parts(decimal(v)))
  const scale=Math.max(0,...amounts.map(v=>v.scale))
  return fromParts(amounts.reduce((sum,v)=>sum+v.digits*10n**BigInt(scale-v.scale),0n),scale)
}
const equalMoney=(a,b)=>decimal(a)===decimal(b)
function dateParts(text) {
  const match=clean(text).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if(!match)throw Error('วันที่ในหัวรายงานไม่ถูกต้อง')
  const [,day,month,year]=match
  const iso=`${year}-${month}-${day}`
  const date=new Date(`${iso}T00:00:00Z`)
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==iso)throw Error('วันที่ในหัวรายงานไม่มีอยู่จริง')
  return iso
}

export function parseShopeeMonthlyReport(text,{filename=''}={}) {
  const csv=parseReportCsv(text)
  const title=csv[0]?.[0] || ''
  const kind=title.includes('โฆษณา CPC ทั้งหมด')?'overview':title.includes('โฆษณาแบบกลุ่มสินค้า')?'group-detail':null
  if(!kind)throw Error('รองรับเฉพาะรายงานภาพรวม Shopee และรายงานกลุ่มโฆษณา')
  const headerIndex=csv.findIndex(row=>row[0]==='ลำดับ' && row.includes('ค่าโฆษณา'))
  if(headerIndex<0)throw Error('ไม่พบหัวตารางค่าโฆษณา')
  const meta=new Map(csv.slice(0,headerIndex).map(row=>[clean(row[0]),clean(row[1])]))
  const metadataCurrency=meta.get('Currency') || meta.get('currency') || meta.get('สกุลเงิน')
  const metadataCountry=meta.get('Country') || meta.get('ประเทศ') || meta.get('Market')
  if(metadataCurrency && !['THB','บาท'].includes(metadataCurrency.toUpperCase()))throw Error('รองรับรายงานสกุลเงินบาทเท่านั้น')
  if(metadataCountry && !['TH','THAILAND','ไทย','ประเทศไทย'].includes(metadataCountry.toUpperCase()))throw Error('ประเทศในรายงานไม่ใช่ประเทศไทย')
  const thailandSignature=title.includes('ประเทศไทย')
  if(kind==='overview' && !thailandSignature && !metadataCountry)throw Error('ยังยืนยันประเทศและสกุลเงินของไฟล์ภาพรวมไม่ได้')
  const shopId=meta.get('Shop ID')
  if(!/^\d+$/.test(shopId || ''))throw Error('ไม่พบรหัสร้านในรายงาน')
  const period=meta.get('ระยะเวลา')?.split(/\s+-\s+/)
  if(period?.length!==2)throw Error('ไม่พบช่วงวันที่ในหัวรายงาน')
  const dateFrom=dateParts(period[0]),dateTo=dateParts(period[1]),month=dateFrom.slice(0,7)
  const [y,m]=month.split('-').map(Number)
  const last=new Date(Date.UTC(y,m,0)).getUTCDate()
  if(dateFrom!==`${month}-01` || dateTo!==`${month}-${last}`)throw Error('ต้องใช้รายงานเต็มเดือน ตั้งแต่วันที่ 1 ถึงวันสุดท้ายของเดือนเดียวกัน')
  const headers=csv[headerIndex].map(clean)
  if(new Set(headers).size!==headers.length)throw Error('หัวตารางมีคอลัมน์ซ้ำ')
  const nameKey=kind==='overview'?'ชื่อโฆษณา':'ชื่อโฆษณา / ชื่อสินค้า'
  for(const key of [nameKey,'รหัสสินค้า','ค่าโฆษณา']) if(!headers.includes(key))throw Error(`ขาดคอลัมน์ ${key}`)
  let parent=null
  const rows=csv.slice(headerIndex+1).map((values,index)=>{
    if(values.length!==headers.length)throw Error(`จำนวนคอลัมน์ไม่ตรงที่แถวข้อมูล ${index+1}`)
    const source=Object.fromEntries(headers.map((key,i)=>[key,values[i]]))
    const name=clean(source[nameKey]),item=clean(source['รหัสสินค้า'])
    if(!name || !item || (item!=='-' && !/^\d+$/.test(item)))throw Error(`ชื่อหรือรหัสสินค้าไม่ถูกต้องที่แถว ${index+1}`)
    const metric=key=>missing(source[key])?null:decimal(source[key])
    const spend=metric('ค่าโฆษณา')
    if(spend===null)throw Error(`ไม่มีค่าแอดที่แถว ${index+1}`)
    const row={id:`${kind}:${index+1}`,sourceRow:index+1,name,itemId:item==='-'?null:item,
      grain:item==='-'?'group':'product',spend,sales:metric('ยอดขาย'),units:metric('สินค้าที่ขายแล้ว'),orders:metric('การสั่งซื้อ'),
      sourceRoas:metric('ยอดขาย/รายจ่าย (ROAS)'),raw:source,parentId:null}
    if(kind==='group-detail') {
      if(row.grain==='group')parent=row.id
      else {if(!parent)throw Error('พบสมาชิกสินค้าก่อนแถวกลุ่มโฆษณา');row.parentId=parent}
    }
    return row
  })
  if(!rows.length)throw Error('ไม่มีแถวข้อมูลในรายงาน ยังยืนยันค่าแอดเป็นศูนย์ไม่ได้')
  return {schemaVersion:1,platform:'Shopee',kind,filename,shopId,shopName:meta.get('ชื่อร้านค้า') || '',month,dateFrom,dateTo,
    exportedAt:meta.get('รายงานถูกสร้างเมื่อ') || null,currency:thailandSignature || metadataCurrency || metadataCountry?'THB':'unknown',taxBasis:'unknown',attributionBasis:'unknown',rows}
}

export function buildShopeeMonthlyReport(overview,detail=null,{business='',mappings={}}={}) {
  if(overview?.kind!=='overview')throw Error('ต้องมีรายงานภาพรวมก่อน')
  if(!['Payi','Payi Outlet','กรอบรูป'].includes(business))throw Error('เลือกธุรกิจสำหรับรายงาน')
  if(detail && (detail.kind!=='group-detail' || detail.month!==overview.month || detail.shopId!==overview.shopId))throw Error('รายละเอียดต้องเป็นร้านและเดือนเดียวกับภาพรวม')
  const issues=[],groups=overview.rows.filter(r=>r.grain==='group'),detailGroups=detail?.rows.filter(r=>r.grain==='group') || []
  let complete=groups.length===0
  if(groups.length && !detail)issues.push('ยังไม่มีรายละเอียดกลุ่มโฆษณา ยอดรายสินค้ายังไม่ครบ')
  const detailLeaves=[]
  if(detail) {
    complete=true
    if(new Set(groups.map(r=>r.name)).size!==groups.length || new Set(detailGroups.map(r=>r.name)).size!==detailGroups.length) {
      complete=false;issues.push('ชื่อกลุ่มซ้ำ ไม่สามารถจับคู่กลุ่มข้ามไฟล์ได้อย่างมั่นใจ')
    }
    if(detailGroups.length!==groups.length) {complete=false;issues.push('จำนวนกลุ่มโฆษณาในสองไฟล์ไม่ตรงกัน')}
    for(const root of detailGroups) {
      const matches=groups.filter(r=>r.name===root.name)
      const members=detail.rows.filter(r=>r.parentId===root.id)
      if(matches.length!==1 || !equalMoney(matches[0].spend,root.spend) || !members.length || !equalMoney(sumReportMoney(members.map(r=>r.spend)),root.spend)) {
        complete=false;issues.push(`ยอดกลุ่มยังไม่ตรง: ${root.name}`)
      }
      detailLeaves.push(...members.map(row=>({...row,campaignName:root.name})))
    }
  }
  const spend=sumReportMoney(overview.rows.map(r=>r.spend))
  const leaves=[...overview.rows.filter(r=>r.grain==='product').map(r=>({...r,campaignName:r.name})),...detailLeaves]
  const leafSpend=sumReportMoney(leaves.map(r=>r.spend))
  if(complete && !equalMoney(spend,leafSpend)) {complete=false;issues.push('ยอดสินค้ารวมยังไม่ตรงกับภาพรวม')}
  const products=new Map()
  for(const row of leaves) {
    const key=row.itemId
    if(!products.has(key))products.set(key,{itemId:key,name:row.name,spends:[],sources:[],familyKey:mappings[key]?.familyKey || null})
    const product=products.get(key)
    product.spends.push(row.spend);product.sources.push({rowId:row.id,campaignName:row.campaignName,spend:row.spend})
  }
  return {schemaVersion:1,business,month:overview.month,dateFrom:overview.dateFrom,dateTo:overview.dateTo,shopId:overview.shopId,shopName:overview.shopName,
    sources:[overview,detail].filter(Boolean).map(r=>({kind:r.kind,filename:r.filename,exportedAt:r.exportedAt})),taxBasis:'unknown',
    spend,productSpend:leafSpend,sales:overview.rows.every(r=>r.sales!==null)?sumReportMoney(overview.rows.map(r=>r.sales)):null,
    campaigns:overview.rows,products:[...products.values()].map(({spends,...p})=>({...p,spend:sumReportMoney(spends)})),
    status:complete?'reconciled':'needs-review',issues,coverage:{dateRange:'full-month',productDetail:complete?'complete':'partial',adTypes:'product-ads-only',orders:'unknown'}}
}
