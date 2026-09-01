// แยกประเภทการจัดส่ง — เฉพาะ Shopee เท่านั้น (Lazada เป็น STANDARD ล้วน, TikTok เกือบทั้งหมดมาตรฐาน
// ไม่มีอะไรให้ดู). ใช้ชื่อประเภทตามที่คอลัมน์ "ตัวเลือกการจัดส่ง" บอกมาตรงๆ ไม่ตีเป็น ด่วน/ไม่ด่วน
//
// ค่าดิบ Shopee = "<ประเภท> - <คำอธิบายไทย>-<ชื่อขนส่ง>"
//   "Standard Delivery - ส่งธรรมดาในประเทศ-SPX Express"        -> "Standard Delivery"
//   "Standard Delivery Bulky - ส่งสินค้าขนาดใหญ่-DHL Domestic"  -> "Standard Delivery Bulky"
//   "Instant Delivery - ส่งทันที (แพ็ก 2 ชั่วโมง)"              -> "Instant Delivery"
//   "Express Delivery - ส่งด่วน-Express Delivery (SHP Food)"     -> "Express Delivery"
//
// เอาเฉพาะส่วนหน้าสุดก่อน " - " (เลี่ยงชื่อขนส่งท้ายประโยคที่มีคำว่า Express ปนมา)

const isShopee = (platform = '') => String(platform).trim().toLowerCase().includes('shopee')

// วงเล็บที่ระบุ "ความเร็ว" (มีตัวเลข หรือคำว่า ชั่วโมง/ชม/นาที/วัน) เช่น "(แพ็ก 2 ชั่วโมง)", "(แพ็ก 30 นาที)"
// — เก็บไว้เพื่อแยก Instant Delivery 2 ชม. กับ 30 นาที. วงเล็บอื่น (ชื่อโปรแกรม เช่น "(SHP Food)") ตัดทิ้ง
const SPEED_PAREN = /\(([^)]*(?:\d|ชั่วโมง|ชม\.?|นาที|วัน)[^)]*)\)/

// คืนชื่อประเภทการจัดส่ง Shopee ตามคอลัมน์ (เช่น "Standard Delivery", "Instant Delivery (แพ็ก 2 ชั่วโมง)")
// — คืน '' ถ้าไม่ใช่ Shopee/ไม่มีค่า
export function shopeeShippingOption(rawOption, platform = '') {
  if (!isShopee(platform)) return ''
  const raw = String(rawOption || '').trim()
  if (!raw) return ''
  const prefix = raw.split(' - ')[0].trim()
  const m = raw.match(SPEED_PAREN)
  return m ? `${prefix} (${m[1].trim()})` : prefix
}
