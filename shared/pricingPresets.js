// Baseline transcribed from the user's reference calculator, not an automatic policy feed.
export const PRICING_REFERENCE = { url: 'https://tainiyom.github.io/shopee-calculator-/', effectiveDate: '2026-08-04', checkedDate: '2026-10-14' }
export const PRICING_CATEGORIES = [
  ['อิเล็กทรอนิกส์ (ต่ำสุด)',7.49,7.49,7.49,1.07],
  ['อิเล็กทรอนิกส์ (สูงสุด)',16.05,19.26,8.56,1.07],
  ['แฟชั่น (ต่ำสุด)',17.12,19.26,8.56,1.07],
  ['แฟชั่น (สูงสุด)',17.12,19.26,8.56,1.07],
  ['FMCG (อาหาร/ของใช้)',16.05,19.26,8.56,1.07],
  ['ไลฟ์สไตล์ (ต่ำสุด)',11.77,14.98,7.49,1.07],
  ['ไลฟ์สไตล์ (สูงสุด)',16.05,19.26,8.56,1.07],
  ['สินค้าอื่นๆ',16.05,19.26,8.56,1.07],
  ['ทอง & แพลตตินั่ม',8.03,11.24,5.35,2.14],
  ['เงิน (โลหะมีค่า)',14.45,16.59,7.49,0],
  ['เครื่องประดับ (แหวน/สร้อย/กำไล)',13.38,16.59,7.49,1.07],
  ['เครื่องประดับมีมูลค่า',15.52,18.73,8.56,1.07],
  ['มือถือ/แท็บเล็ต/แล็ปท็อป',7.49,7.49,7.49,0],
  ['เครื่องใช้ไฟฟ้าใหญ่ (ตู้เย็น/ซักผ้า)',11.24,11.77,7.49,1.07],
  ['คอมพิวเตอร์ (จอ/ชิ้นส่วน)',8.56,9.63,7.49,1.07],
  ['คอมพิวเตอร์ (จัดเก็บข้อมูล/ปริ้นเตอร์)',11.77,12.84,7.49,1.07],
  ['คอมพิวเตอร์ (อุปกรณ์ต่อพ่วง/เน็ตเวิร์ก)',14.45,15.52,8.56,1.07],
  ['เกม (แผ่น/ตลับ/เครื่องเกม)',13.38,14.45,8.56,0],
  ['กล้องวงจรปิด/โดรน/ซอฟต์แวร์',16.05,17.12,8.56,1.07],
  ['หนังสือและนิตยสาร',14.45,17.66,7.49,1.07],
  ['เครื่องประดับ (เพชร/หยก เพื่อการลงทุน)',16.59,18.73,8.56,1.07],
  ['ยานยนต์/มอเตอร์ไซค์ (ตัวรถ)',10.17,13.38,7.49,1.07],
  ['เครื่องเสียง/โปรเจคเตอร์/เครื่องใช้ไฟฟ้าในบ้าน',15.52,16.59,8.56,1.07],
  ['ทีวีและอุปกรณ์',11.77,11.77,8.56,1.07],
].map(([name,normal,mall,xtra,prime]) => ({name,normal,mall,xtra,prime}))

export const PRICING_PAYMENTS = [
  ['normal','ปกติ (โอน/เดบิต/ShopeePay/COD)',3.21],
  ['later','SPayLater (จ่ายเดือนหน้า)',3.21],
  ['special1','Special SPayLater ผ่อน 1 เดือน',3.21],
  ['special2','Special SPayLater ผ่อน 2 เดือน',4.28],
  ['special3','Special SPayLater ผ่อน 3 เดือน',5.35],
  ['special5','Special SPayLater ผ่อน 5 เดือน',6.96],
  ['special12','Special SPayLater ผ่อน 12 เดือน',7.49],
  ['credit3','บัตรเครดิตผ่อน 3 เดือน',5.35],
  ['credit6','บัตรเครดิตผ่อน 6 เดือน',6.96],
  ['credit10','บัตรเครดิตผ่อน 10 เดือนขึ้นไป',7.49],
].map(([id,name,rate]) => ({id,name,rate}))

export function applyPricingPreset(draft, changes) {
  const next = { ...draft, ...changes, programs: { ...draft.programs } }
  if ('category' in changes || 'storeType' in changes) {
    const category = PRICING_CATEGORIES.find(c => c.name === next.category)
    if (category) {
      next.commission = next.storeType === 'mall' ? category.mall : category.normal
      next.programs.prime = { ...next.programs.prime, rate: category.prime }
      next.programs.xtra = { ...next.programs.xtra, rate: category.xtra }
    }
  }
  if ('payment' in changes) {
    const method = PRICING_PAYMENTS.find(p => p.id === next.payment)
    if (method) next.transaction = method.rate
  }
  return next
}
