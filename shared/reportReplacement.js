import {reportMoneyDifference} from './tiktokProductDetails.js'

const known=value=>value!==null&&value!==undefined&&String(value).trim()!==''
export function summarizeSavedReport(record) {
  if(!record)return null
  const report=record.report
  return {business:report.business,platform:report.platform||'Shopee',shopId:report.shopId,shopName:report.shopName||report.shopId,
    month:report.month,dateFrom:report.dateFrom,dateTo:report.dateTo,spend:report.spend,sales:report.sales??null,orders:report.orders??null,
    productCount:report.products?.length||0,productSpend:report.productSpend??null,productCoverage:report.coverage?.productDetail||'unknown',
    files:(record.sourceFiles||[]).map(file=>file.name),savedAt:record.savedAt||null,savedBy:record.savedBy||null}
}

export function compareReportReplacement(previous,next) {
  const before=summarizeSavedReport(previous),after=summarizeSavedReport(next)
  const metrics=[['spend','ค่าแอด','money'],['sales','ยอดขายที่แพลตฟอร์มให้เครดิต','money'],['orders','ออเดอร์ตามรายงาน','count'],['productCount','สินค้าที่มีรายละเอียด','count'],['productSpend','ค่าแอดที่ระบุสินค้าได้','money']].map(([key,label,type])=>({key,label,type,before:before?.[key]??null,after:after?.[key]??null,
    difference:known(before?.[key])&&known(after?.[key])?reportMoneyDifference(String(after[key]),String(before[key])):null}))
  const warnings=[],remaining=new Set((next?.report.products||[]).map(product=>product.itemId))
  const missing=(previous?.report.products||[]).filter(product=>!remaining.has(product.itemId))
  if(previous&&next) {
    if(missing.length)warnings.push(`ชุดใหม่ไม่มีรายละเอียดสินค้าเดิม ${missing.length} รายการ เช่น ${missing.slice(0,3).map(product=>product.name||product.itemId).join(', ')}`)
    if(before.productCoverage==='complete'&&after.productCoverage!=='complete')warnings.push('ชุดเดิมมีรายละเอียดสินค้าครบ แต่ชุดใหม่ยังไม่ยืนยันความครบ')
    if(known(before.sales)&&!known(after.sales))warnings.push('ชุดใหม่ไม่มีข้อมูลยอดขายที่เคยมีในชุดเดิม')
  }
  return {before,after,metrics,warnings,missingProducts:missing.length}
}
