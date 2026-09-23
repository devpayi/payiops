// ใช้ร่วมกันทั้ง src/pages/Upload.jsx (client) และ api/import-orders.js (server)
// — pick() + ชุดชื่อคอลัมน์ต้องเหมือนกันเป๊ะสองฝั่ง ไม่งั้นเลขบรรทัดที่ client นับจะไม่ตรงกับที่ server เคยนับ
import { isoDate } from './dates.js'

export const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export const ORDER_ID_KEYS = ['order_id', 'order id', 'เลขที่คำสั่งซื้อ', 'order sn', 'orderid', 'หมายเลขคำสั่งซื้อ', 'ordernumber']
export const ORDER_ITEM_ID_KEYS = ['order_item_id', 'order item id', 'item id', 'orderitemid']
export const DATE_KEYS = ['date', 'วันที่', 'order creation', 'created time', 'createtime', 'เวลาการชำระ', 'วันเวลาที่ทำการสั่งซื้อ']

// ฟิลด์ที่ client แนบมาในแต่ละแถว = เลขบรรทัด (L1, L2, ...) ของออเดอร์ นับครบทั้งไฟล์แล้ว
// ชื่อขึ้นต้นด้วย _ และไม่มีคำไหนตรง candidate ของ pick() เลย จึงไม่ถูกหยิบไปเป็นคอลัมน์อื่นโดยบังเอิญ
export const LINE_FIELD = '_payi_line'

export function pick(row, keys) {
  const entries = Object.entries(row)
  // pass 1: exact header match (avoids grabbing an unrelated column that merely
  // contains a candidate word as a substring, e.g. "สถานะการคืนเงินหรือคืนสินค้า"
  // matching the "สินค้า" candidate before the real "ชื่อสินค้า" column is checked)
  for (const [k, v] of entries) {
    const nk = normalize(k)
    if (keys.some((c) => nk === normalize(c))) return v
  }
  // pass 2: substring fallback for loosely-named columns
  for (const [k, v] of entries) {
    const nk = normalize(k)
    if (keys.some((c) => nk.includes(normalize(c)))) return v
  }
  return ''
}

// ไฟล์ Shopee ไม่มี item id — server เคยไล่เลข L1, L2 ต่อออเดอร์ "ภายใน request เดียว" แต่ Upload.jsx
// แบ่งไฟล์ส่งทีละ 2,000 แถว ออเดอร์ที่คร่อม 2 batch เลยได้ L1 ซ้ำกับสินค้าคนละตัว → upsert เขียนทับ
// แถวเดิม (ยอดหายเงียบ) หรือได้ 2 แถว key เดียวกัน ฟังก์ชันนี้นับให้ครบทั้งไฟล์ก่อนแบ่ง batch
// กติกาเดียวกับของเดิมทุกอย่าง (นับเฉพาะแถวที่มี order id + วันที่อ่านได้, เรียงตามลำดับในไฟล์)
// ออเดอร์ที่ไม่คร่อม batch จึงได้ key เหมือนที่เคยนำเข้าไว้ทุกตัว
export function assignOrderLines(rows) {
  const counter = new Map()
  return rows.map((row) => {
    const orderId = String(pick(row, ORDER_ID_KEYS) || '')
    if (!orderId || !isoDate(pick(row, DATE_KEYS))) return row
    if (String(pick(row, ORDER_ITEM_ID_KEYS) || '')) return row
    const n = (counter.get(orderId) || 0) + 1
    counter.set(orderId, n)
    return { ...row, [LINE_FIELD]: `L${n}` }
  })
}
