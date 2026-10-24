import {sumReportMoney} from './monthlyAdsReports.js'
import {reportMoneyDifference} from './tiktokProductDetails.js'
import {reportScope} from './marketingReadModels.js'

export const ADS_PLATFORMS=['Shopee','TikTok Shop','Lazada']
export const adsSpendPercent=(spend,total)=>Number(total)===0?null:Number(spend)/Number(total)*100
export const adsRoas=(sales,spend)=>sales===null||sales===undefined||String(sales).trim()===''||spend===null||spend===undefined||String(spend).trim()===''||Number(spend)===0?null:Number(sales)/Number(spend)
// Business targets set by the owner; compare actual ROAS before display rounding.
export function adsRoasStatus(value) {
  if(!Number.isFinite(value)||value<0)return {key:'unavailable',label:'ยังประเมินไม่ได้'}
  if(value>=6)return {key:'target',label:'ถึงเป้า'}
  if(value>=4)return {key:'acceptable',label:'รับได้'}
  return {key:'below',label:'ต่ำกว่าเกณฑ์'}
}
const hasSales=row=>row.sales!==null&&row.sales!==undefined&&String(row.sales).trim()!==''
const completeSales=rows=>rows.length>0&&rows.every(hasSales)?sumReportMoney(rows.map(row=>row.sales)):null
const amount=value=>{
  if(value===undefined||value===null||String(value).trim()==='')throw Error('รายงานขาดค่าแอด')
  return sumReportMoney([value])
}
const platformOf=report=>report.platform||'Shopee'
const sum=rows=>sumReportMoney(rows.map(row=>row.spend))

// No Ops mapping or name-based grouping. Same ID in different shops/platforms is distinct.
export function buildAdsSpendOverview(reports,{month,business='__all__',platform='__all__',shopId=''}={}) {
  const scopes=new Set(),unverified=[]
  const base=reports.filter(report=>report.month===month&&(business==='__all__'||report.business===business)).filter(report=>{
    const key=reportScope(report)
    if(scopes.has(key))throw Error('พบรายงานเดือน/ร้าน/แพลตฟอร์มซ้ำ')
    scopes.add(key)
    if(report.status!=='reconciled'){unverified.push(report);return false}
    amount(report.spend);return true
  })
  const allSpend=sum(base)
  const platforms=ADS_PLATFORMS.map(name=>{
    const matches=base.filter(report=>platformOf(report)===name)
    const spend=matches.length?sum(matches):null
    const sales=completeSales(matches)
    return {platform:name,spend,sales,roas:adsRoas(sales,spend),percent:spend===null?null:adsSpendPercent(spend,allSpend),reports:matches.length}
  })
  const selected=base.filter(report=>(platform==='__all__'||platformOf(report)===platform)&&(!shopId||report.shopId===shopId))
  const spend=sum(selected),products=[],unassigned=[]
  for(const report of selected) {
    const meta={platform:platformOf(report),business:report.business,shopId:report.shopId,shopName:report.shopName||report.shopId}
    const productRows=report.products||[],seen=new Set()
    for(const product of productRows) {
      if(typeof product.itemId!=='string'||!/^\d+$/.test(product.itemId)||seen.has(product.itemId))throw Error('รหัสสินค้าขาดหรือซ้ำในรายงาน')
      seen.add(product.itemId)
      const sales=hasSales(product)?sumReportMoney([product.sales]):completeSales(product.sources||[])
      products.push({...meta,key:JSON.stringify([meta.platform,meta.business,meta.shopId,product.itemId]),itemId:product.itemId,name:product.name,spend:amount(product.spend),sales,roas:adsRoas(sales,product.spend),sources:product.sources||[],platformPercent:adsSpendPercent(product.spend,report.spend)})
    }
    const captured=sum(productRows)
    const add=(kind,label,value)=>{
      if(value!=='0')unassigned.push({...meta,key:JSON.stringify([reportScope(report),kind]),label,spend:value})
    }
    const check=report.productReconciliation
    if(meta.platform==='TikTok Shop'&&check) {
      const live=amount(check.liveSpend)
      // Derive the difference from actual rows; never trust a stale subtotal or allocate LIVE.
      add('live','ค่าแอด LIVE',live)
      add('difference','ผลต่างรายสินค้า / แคมเปญ',reportMoneyDifference(reportMoneyDifference(report.spend,live),captured))
    }else add('missing','ค่าแอดที่ยังระบุสินค้าไม่ได้',reportMoneyDifference(report.spend,captured))
  }
  // Platform % uses all selected shops, not each shop's own total.
  const selectedPlatformTotals=new Map(ADS_PLATFORMS.map(name=>[name,sum(selected.filter(report=>platformOf(report)===name))]))
  for(const row of products){row.percent=adsSpendPercent(row.spend,spend);row.platformPercent=adsSpendPercent(row.spend,selectedPlatformTotals.get(row.platform))}
  for(const row of unassigned)row.percent=adsSpendPercent(row.spend,spend)
  products.sort((a,b)=>Number(b.spend)-Number(a.spend)||a.key.localeCompare(b.key))
  return {spend: selected.length?spend:null,allSpend:base.length?allSpend:null,platforms,products,unassigned,reports:selected.length,unverified:unverified.length,productSpend:sum(products)}
}
