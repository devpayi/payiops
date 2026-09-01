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

// บางแถว Shopee เขียนแค่ชื่อบริษัทขนส่ง ไม่มี "Standard Delivery - " นำหน้า — พวกนี้ไม่รู้ว่าด่วน/ธรรมดา
// ยุบเป็น "ไม่ระบุประเภท" ไม่ให้โผล่เป็นหมวดขนส่งแยก (ประเภทจัดส่งจริงๆ ที่ยังไม่รู้จักจะยังขึ้นเองปกติ)
const CARRIER_ONLY = new Set([
  'spx express', 'spx instant', 'spx', 'flash express', 'flash', 'j&t express', 'j&t', 'jnt express',
  'kerry express', 'kerry', 'ninja van', 'ninjavan', 'best express', 'best inter express', 'dhl',
  'ems', 'shopee xpress', 'ไปรษณีย์ไทย',
])
const UNKNOWN_LABEL = 'ไม่ระบุประเภท'

// คืนชื่อประเภทการจัดส่ง Shopee ตามคอลัมน์ (เช่น "Standard Delivery", "Instant Delivery (แพ็ก 2 ชั่วโมง)")
// — คืน '' ถ้าไม่ใช่ Shopee/ไม่มีค่า
export function shopeeShippingOption(rawOption, platform = '') {
  if (!isShopee(platform)) return ''
  const raw = String(rawOption || '').trim()
  if (!raw) return ''
  const prefix = raw.split(' - ')[0].trim()
  if (CARRIER_ONLY.has(prefix.toLowerCase())) return UNKNOWN_LABEL
  const m = raw.match(SPEED_PAREN)
  return m ? `${prefix} (${m[1].trim()})` : prefix
}

// ยุบ label ตัวเลือก Shopee เป็น ด่วน/ธรรมดา (ใช้ในมุมมองรายสินค้า ที่โชว์ทุก label จะรก)
// Instant / Express / Sameday / Next Day = ด่วน ; Standard (รวม Bulky) = ธรรมดา
export function isFastShopeeOption(optionLabel) {
  return /^(instant|express|same[\s-]?day|next[\s-]?day)/i.test(String(optionLabel || '').trim())
}
