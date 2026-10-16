// TikTok Shop GMV Max (product + LIVE) monthly totals -> read-only monthly report.
// Source is the Seller Center ads dashboard, entered offline; never writes marketing_inputs.
import {sumReportMoney} from './monthlyAdsReports.js'

const BUSINESSES=['Payi','Payi Outlet','กรอบรูป']
const same=(a,b)=>sumReportMoney([a])===sumReportMoney([b])
const text=value=>String(value ?? '').trim()

export function buildTikTokMonthlyReport(input,{business=''}={}) {
  if(!BUSINESSES.includes(business))throw Error('เลือกธุรกิจสำหรับรายงาน')
  const month=text(input?.month)
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('เดือนไม่ถูกต้อง')
  const [y,m]=month.split('-').map(Number)
  const last=new Date(Date.UTC(y,m,0)).getUTCDate()
  if(input.dateFrom!==`${month}-01` || input.dateTo!==`${month}-${String(last).padStart(2,'0')}`)throw Error('ต้องใช้รายงานเต็มเดือน ตั้งแต่วันที่ 1 ถึงวันสุดท้ายของเดือน')
  if(!/^\d+$/.test(text(input.shopId)))throw Error('ไม่พบรหัสบัญชี')
  if(!Array.isArray(input.campaigns) || !input.campaigns.length)throw Error('ไม่มีแถวแคมเปญ ยังยืนยันค่าแอดเป็นศูนย์ไม่ได้')
  const totals=input.totals || {}
  const campaigns=input.campaigns.map((row,index)=>{
    const name=text(row.name)
    if(!name || !['product','live'].includes(row.grain))throw Error(`ชื่อหรือประเภทแคมเปญไม่ถูกต้องที่แถว ${index+1}`)
    return {id:`tiktok:${index+1}`,sourceRow:index+1,name,itemId:null,grain:row.grain,spend:sumReportMoney([row.spend]),sales:sumReportMoney([row.sales]),orders:sumReportMoney([row.orders]),sourceRoas:text(row.roas) || null}
  })
  const spend=sumReportMoney(campaigns.map(r=>r.spend)),sales=sumReportMoney(campaigns.map(r=>r.sales)),orders=sumReportMoney(campaigns.map(r=>r.orders))
  const issues=[]
  if(!same(spend,totals.spend))issues.push('ค่าแอดรวมรายแคมเปญไม่ตรงยอดรวมบนแดชบอร์ด')
  if(!same(sales,totals.sales))issues.push('รายได้ขั้นต้นรวมรายแคมเปญไม่ตรงยอดรวมบนแดชบอร์ด')
  if(!same(orders,totals.orders))issues.push('จำนวนคำสั่งซื้อรวมรายแคมเปญไม่ตรงยอดรวมบนแดชบอร์ด')
  return {schemaVersion:1,platform:'TikTok Shop',business,month,dateFrom:input.dateFrom,dateTo:input.dateTo,shopId:text(input.shopId),shopName:text(input.shopName),
    sources:[{kind:'seller-center-dashboard',filename:text(input.source) || 'TikTok Seller Center · แดชบอร์ดโฆษณา',exportedAt:input.capturedAt || null}],taxBasis:'unknown',
    spend,sales,orders,reportedTotals:{spend:sumReportMoney([totals.spend]),sales:sumReportMoney([totals.sales]),orders:sumReportMoney([totals.orders])},
    productSpend:null,campaigns,products:[],status:issues.length?'needs-review':'reconciled',issues,
    coverage:{dateRange:'full-month',productDetail:'not-applicable',adTypes:'gmv-max-product-and-live',orders:'platform-reported'}}
}
