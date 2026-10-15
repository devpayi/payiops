// รวม SKU ที่เป็นสินค้าตัวเดียวกันแต่คนละไซส์/รุ่นย่อย เข้าเป็น "กลุ่มสินค้า" (product family)
// เช่น PY006 "ถุงเท้าเจล 2in1 M" + PY007 "ถุงเท้าเจล 2in1 L" → กลุ่มเดียว "ถุงเท้าเจล 2in1"
//
// สร้างที่เดียว ใช้ทั้งหน้า Dashboard สินค้า (api/products.js) และมุมมองเคลมรายสินค้า
// (api/claims.js?view=by-product) — ตาม TODO#2 ใน CLAUDE.md
//
// ลำดับการตัดสินใจ:
//   1) ถ้ามี override จาก product_aliases (คอลัมน์ product_group) → ใช้ค่านั้นเป็นชื่อกลุ่ม
//   2) ไม่งั้น strip token ที่เป็นไซส์/รุ่นย่อยออกจาก display_name → เหลือชื่อกลุ่ม

// token ที่เป็น "ไซส์ล้วน" — ตัดทิ้งเมื่อยืนเดี่ยว (คั่นด้วยช่องว่าง/ขีด/สแลช ฯลฯ)
const SIZE_TOKENS = new Set([
  'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl',
  '2xl', '3xl', '4xl', 'freesize', 'onesize',
])

// token ที่เป็น "สีล้วน" — ตัดเมื่อยืนเดี่ยว เช่น "แผ่นรองเท้า M ดำ" / "... M ฟ้า" = สินค้าเดียวกัน
// (ตัดเฉพาะสีที่แยกด้วยช่องว่าง — ถ้าสีติดกับคำ เช่น "สลิปเปอร์ฟ้า" จะไม่ถูกตัด ให้ใช้ product_group override)
export const COLOR_TOKENS = new Set([
  'ดำ', 'ขาว', 'แดง', 'ฟ้า', 'เขียว', 'เหลือง', 'ชมพู', 'ม่วง', 'ส้ม', 'เทา',
  'น้ำเงิน', 'น้ำตาล', 'ครีม', 'เบจ', 'ทอง', 'เงิน', 'คละสี', 'คละ',
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'orange', 'gray', 'grey', 'brown', 'navy', 'beige', 'gold', 'silver',
])

// รูปแบบ "ไซส์/size/เบอร์/ขนาด X" ที่ตัดทั้งวลี
const SIZE_PHRASE = /(?:ไซส์|ไซซ์|size|เบอร์|ขนาด|no\.?)\s*[:：]?\s*[\wก-๙]+/gi

// สระบน/ล่าง + วรรณยุกต์ไทย (combining marks) — ใช้ยุบตัวที่พิมพ์ซ้ำติดกัน (typo)
// เช่น "ที่แยกนิ้วโป้งแบบผ้านุุ่่ม" → "...ผ้านุ่ม" (สระอุ/ไม้เอกเกินมา)
const THAI_MARK_DUP = /([ัิ-ฺ็-๎])\1+/g
const collapseThaiMarks = (s) => String(s).normalize('NFC').replace(THAI_MARK_DUP, '$1')

// วงเล็บ/ก้อน variation ท้ายชื่อ เช่น "... (M)", "...(คละสี)", "…[L]"
const TRAILING_PAREN = /[([（【][^)\]）】]*[)\]）】]\s*$/

// ไซส์ติดท้ายคำแบบไม่มีช่องว่างคั่น เช่น "2in1M", "ส้นเท้าM", "ฝ่าเท้าL" — split ตามช่องว่างจับไม่ได้เพราะไม่มีตัวคั่น
// จำกัดเฉพาะกรณีตัวอักษรก่อนหน้าเป็นไทย/ตัวเลข กันไม่ให้ไปตัดคำอังกฤษล้วนที่บังเอิญลงท้ายด้วยตัวเดียวกัน (เช่น "Cream", "Small")
const GLUED_SIZE_SUFFIX = /([฀-๿0-9])(xxxl|xxl|2xl|3xl|4xl|xl|xs|s|m|l)$/i

// แปลง display_name → ชื่อกลุ่มสินค้า (ตัดไซส์/รุ่นย่อยออก)
export function normalizeGroupLabel(name = '') {
  const raw = collapseThaiMarks(String(name).trim())
  if (!raw) return ''

  // 1) ตัดก้อนในวงเล็บท้ายชื่อ (มักเป็นสี/ไซส์)
  let s = raw.replace(TRAILING_PAREN, ' ')
  // 2) ตัดวลี "ไซส์/เบอร์/ขนาด X"
  s = s.replace(SIZE_PHRASE, ' ')
  // 3) แยก token ตามตัวคั่น แล้วทิ้ง token ที่เป็นไซส์/สีล้วน
  const kept = s
    .split(/[\s\-_/|·•]+/)
    .filter(Boolean)
    .filter((t) => {
      const lc = t.toLowerCase()
      return !SIZE_TOKENS.has(lc) && !COLOR_TOKENS.has(lc)
    })

  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim()
  // 4) ตัดไซส์ที่ติดท้ายคำแบบไม่มีช่องว่างคั่น (ทำหลัง join แล้ว เผื่อไซส์ติดคำสุดท้ายพอดี)
  out = out.replace(GLUED_SIZE_SUFFIX, '$1').trim()
  // ถ้าตัดจนเหลือว่าง (ชื่อเป็นไซส์ล้วน) ให้คงชื่อเดิมไว้ ไม่งั้นข้อมูลหาย
  return out || raw
}

// คีย์สำหรับจับกลุ่ม — ไม่สนตัวพิมพ์/เว้นวรรค/สระซ้ำ
// (ตัดเว้นวรรคทิ้งทั้งหมด เพื่อให้ "ม้าดำเล็ก กรอบทอง" = "ม้าดำเล็กกรอบทอง")
export function groupKey(label = '') {
  return collapseThaiMarks(label).toLowerCase().replace(/\s+/g, '').trim()
}

// สร้าง map: master_sku → product_group (จากคอลัมน์ product_group ใน product_aliases ถ้ามี)
export function buildOverrideMap(aliasRows = []) {
  const map = new Map()
  for (const r of aliasRows) {
    const sku = String(r.master_sku || '').trim()
    const grp = String(r.product_group || '').trim()
    if (sku && grp) map.set(sku, grp)
  }
  return map
}

// override รายตัวในโค้ด (deterministic) — สำหรับเคสที่ auto-strip จับไม่ได้ เช่น "สีติดกับคำ"
// เฉพาะสินค้า Payi ที่ยืนยันกับเจ้าของแล้วว่าเป็นตัวเดียวกันต่างแค่สี
// หมายเหตุ: กรอบรูป (ม้า/ปลา/เรือ/… แดง/ดำ) จงใจไม่ใส่ที่นี่ — เจ้าของต้องการให้แยกตามสี
// ลำดับความสำคัญ: override จากชีต (product_aliases.product_group) > BUILTIN นี้ > auto-strip
const BUILTIN_GROUP = new Map([
  ['PY030', 'รองเท้าสลิปเปอร์'],  // สลิปเปอร์ขาว
  ['PY031', 'รองเท้าสลิปเปอร์'],  // สลิปเปอร์ฟ้า
  ['PY040', 'ถุงเท้าสปา'],        // สปาเขียว
  ['PY065', 'ถุงเท้าสปา'],        // สปาชมพู
])

// หากลุ่มของ 1 แถว: คืน { key, label }
// overrideMap = ผลจาก buildOverrideMap (optional)
export function deriveGroup(displayName, masterSku, overrideMap) {
  const sku = masterSku != null ? String(masterSku).trim() : ''
  const ov = (overrideMap && sku ? overrideMap.get(sku) : null) || BUILTIN_GROUP.get(sku)
  const label = ov || normalizeGroupLabel(displayName || sku || '(ไม่ระบุ)')
  return { key: groupKey(label) || '(ไม่ระบุ)', label: label || '(ไม่ระบุ)' }
}
