export const LEGACY_AD_BUSINESSES=['Payi','Payi Outlet','กรอบรูป']
export const LEGACY_AD_PLATFORMS=['Shopee','TikTok Shop','Lazada']
export const LEGACY_TIKTOK_BUSINESSES=['Payi','กรอบรูป']
export const isLegacyTikTokSales=row=>LEGACY_TIKTOK_BUSINESSES.includes(row.business)&&row.platform==='TikTok Shop'&&['tt_gmv','affiliate','live','vdo','other'].includes(row.metric)

// Existing API replaces a full month. Keep the other section and unknown rows
// verbatim, instead of reconstructing amounts through VAT or GMV calculations.
export function replaceLegacyMarketingSection(inputs,month,surface,editedRows) {
  if(!['ads','tiktok'].includes(surface))throw Error('ส่วนข้อมูลไม่ถูกต้อง')
  const owns=surface==='ads'?row=>row.metric==='ads'&&LEGACY_AD_BUSINESSES.includes(row.business)&&LEGACY_AD_PLATFORMS.includes(row.platform):isLegacyTikTokSales
  if(editedRows.some(row=>!owns(row)))throw Error('พบข้อมูลข้ามส่วนที่กำลังแก้ไข')
  return [...inputs.filter(row=>row.month===month&&!owns(row)).map(({business,platform,metric,value})=>({business,platform,metric,value})),...editedRows]
}

export function commitLegacyMarketingMonth(snapshot,month,rows) {
  return {...snapshot,months:[...new Set([...(snapshot.months || []),month])].sort(),inputs:[...snapshot.inputs.filter(row=>row.month!==month),...rows.map(row=>({...row,month}))]}
}
