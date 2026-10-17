import {sumReportMoney} from './monthlyAdsReports.js'

const text=value=>String(value ?? '').trim()
const amount=(value,label)=>{
  if(value===null||value===undefined||text(value)==='')throw Error(`ขาดค่า ${label}`)
  return sumReportMoney([value])
}
const identifier=(value,label)=>{
  if(typeof value!=='string'||!/^\d+$/.test(value))throw Error(`รหัส ${label} ต้องเป็นข้อความตัวเลข`)
  return value
}
// Preserve signed differences exactly; never round, clamp or allocate them.
export function reportMoneyDifference(left,right) {
  const [a,b]=[amount(left,'ยอดตั้งต้น'),amount(right,'ยอดเปรียบเทียบ')].map(v=>v.split('.'))
  const scale=Math.max(a[1]?.length || 0,b[1]?.length || 0)
  const digits=parts=>BigInt(parts[0]+(parts[1] || '').padEnd(scale,'0'))
  const diff=digits(a)-digits(b),negative=diff<0n
  const raw=(negative?-diff:diff).toString().padStart(scale+1,'0')
  const normalized=scale?`${raw.slice(0,-scale)}.${raw.slice(-scale)}`.replace(/0+$/,'').replace(/\.$/,''):raw
  return `${negative?'-':''}${normalized}`
}

export function attachTikTokProductDetails(report,details) {
  if(!details||typeof details!=='object'||Array.isArray(details))throw Error('รูปแบบรายละเอียดสินค้าไม่ถูกต้อง')
  for(const field of ['month','dateFrom','dateTo','shopId'])if(details[field]!==report[field])throw Error(`ขอบเขตรายสินค้าไม่ตรงรายแคมเปญ: ${field}`)
  if(details.timeZone!=='Asia/Bangkok')throw Error('รายสินค้าต้องใช้เขตเวลา Asia/Bangkok')
  if(!text(details.source)||!text(details.capturedAt))throw Error('รายสินค้าต้องระบุแหล่งข้อมูลและวันที่เก็บ')
  const expected=report.campaigns.filter(c=>c.grain==='product')
  if(!Array.isArray(details.campaigns)||details.campaigns.length!==expected.length)throw Error('รายสินค้ายังไม่ครบทุกแคมเปญสินค้า')
  const known=new Map(expected.map(c=>[identifier(c.platformCampaignId,'แคมเปญ'),c]))
  if(known.size!==expected.length)throw Error('รหัสแคมเปญซ้ำ')
  const seen=new Set(),products=new Map(),checks=[]
  for(const detail of details.campaigns) {
    const campaignId=identifier(detail.campaignId,'แคมเปญ'),campaign=known.get(campaignId)
    if(!campaign||seen.has(campaignId))throw Error('รายสินค้าอ้างแคมเปญไม่ตรงหรือซ้ำ')
    seen.add(campaignId)
    if(!Array.isArray(detail.rows)||!Number.isSafeInteger(detail.reportedProductRows)||detail.reportedProductRows!==detail.rows.length)throw Error('รายสินค้าขาดหน้าหรือจำนวนแถวไม่ตรง')
    if(!detail.rows.length&&campaign.spend!=='0')throw Error('แคมเปญมีค่าแอดแต่ไม่มีรายสินค้า')
    const items=new Set(),spends=[]
    for(const row of detail.rows) {
      const itemId=identifier(row.itemId,'สินค้า')
      if(items.has(itemId)||!text(row.name))throw Error('สินค้าในแคมเปญซ้ำหรือไม่มีชื่อ')
      items.add(itemId)
      const spend=amount(row.spend,'ค่าแอดรายสินค้า'),sales=amount(row.sales,'ยอดขายรายสินค้า'),orders=amount(row.orders,'คำสั่งซื้อรายสินค้า')
      spends.push(spend)
      if(!products.has(itemId))products.set(itemId,{itemId,name:text(row.name),familyKey:null,sources:[]})
      products.get(itemId).sources.push({rowId:`${campaign.id}:product:${itemId}`,campaignId,campaignName:campaign.name,spend,sales,orders,status:text(row.status),sourceRoas:text(row.roas) || null})
    }
    const productSpend=sumReportMoney(spends)
    checks.push({campaignId,name:campaign.name,spend:campaign.spend,productSpend,difference:reportMoneyDifference(campaign.spend,productSpend),productRows:detail.rows.length})
  }
  const grouped=[...products.values()].map(product=>({...product,spend:sumReportMoney(product.sources.map(s=>s.spend)),sales:sumReportMoney(product.sources.map(s=>s.sales)),orders:sumReportMoney(product.sources.map(s=>s.orders))}))
  const productSpend=sumReportMoney(grouped.map(p=>p.spend))
  const productCampaignSpend=sumReportMoney(expected.map(c=>c.spend))
  const liveSpend=sumReportMoney(report.campaigns.filter(c=>c.grain==='live').map(c=>c.spend))
  const hasDifferences=checks.some(c=>c.difference!=='0')
  return {...report,products:grouped,productSpend,
    sources:[...report.sources,{kind:'seller-center-product-details',filename:text(details.source),exportedAt:details.capturedAt}],
    coverage:{...report.coverage,productDetail:hasDifferences?'captured-with-differences':'complete',productCampaigns:expected.length},
    productReconciliation:{status:hasDifferences?'has-differences':'reconciled',productCampaignSpend,productSpend,unallocatedProductSpend:reportMoneyDifference(productCampaignSpend,productSpend),liveSpend,totalUnallocatedSpend:reportMoneyDifference(report.spend,productSpend),campaigns:checks}}
}
