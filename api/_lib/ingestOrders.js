// ingestOrders — นำ "แถวออเดอร์" (object ต่อรายการสินค้า 1 บรรทัด) เข้า raw_orders_YYYY_MM
//
// แยกออกมาจาก api/import-orders.js เพื่อให้ทั้ง (ก) การอัปโหลดไฟล์ export ด้วยมือ และ (ข) การดึงผ่าน
// API แพลตฟอร์ม (api/tiktok.js) ใช้ pipeline เดียวกัน: จับคู่ SKU → แยกเดือน → กันซ้ำด้วย order_key →
// append → บันทึก import_log
//
// ต่างจาก import-orders.js ตรงที่ "ผู้เรียกต้องเตรียม platform + business + แถวที่ map แล้ว" มาให้ —
// ไม่มีการเดา platform จากรูปคอลัมน์ (detectPlatform) เพราะฝั่ง API รู้ platform อยู่แล้ว
//
// แถว 1 แถว = สินค้า 1 รายการในออเดอร์ (order line) — key ที่รองรับ (ชื่อไหนก็ได้ที่ pick() หาเจอ):
//   order_id, order_item_id, date (YYYY-MM-DD), product_name, variation_name,
//   sku_platform, qty, revenue, order_status, province, shipping_option,
//   fulfillment_type, buyer_hash, business
import { getSheet, appendRows, batchGetValues } from './sheets.js'
import { isoDate } from './dates.js'

const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
// Sheets (USER_ENTERED) แปลง string ที่หน้าตาเป็นตัวเลข/scientific-notation เป็นเลขจริงเอง — id
// พวกนี้เป็นตัวระบุล้วน ไม่เคยเอาไปคำนวณ บังคับเก็บเป็น text ด้วย leading "'" (เหมือน import-orders.js)
const forceText = (v) => { const s = String(v ?? ''); return s ? `'${s}` : s }

const RAW_HEADERS = ['order_key', 'order_id', 'order_item_id', 'date', 'platform', 'business', 'sku_platform', 'product_name', 'variation_name', 'master_sku', 'display_name', 'qty', 'revenue', 'order_status', 'imported_at', 'source_file', 'import_id', 'alias_key', 'province', 'shipping_option', 'fulfillment_type', 'buyer_hash']

function pick(row, keys) {
  const entries = Object.entries(row)
  for (const [k, v] of entries) {
    const nk = normalize(k)
    if (keys.some((c) => nk === normalize(c))) return v
  }
  for (const [k, v] of entries) {
    const nk = normalize(k)
    if (keys.some((c) => nk.includes(normalize(c)))) return v
  }
  return ''
}

export function genImportId(prefix = 'IMP') {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `${prefix}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}

// rows: แถว object (ดู key ที่รองรับด้านบน)
// opts: { platform, businessDefault, fileName, importId }
// คืน { importId, imported, mapped, skippedInvalid, skippedDup, unmappedSamples, tabs }
export async function ingestOrders(rows, { platform, businessDefault = '', fileName = 'api-sync', importId } = {}) {
  if (!platform) throw new Error('ingestOrders: ต้องระบุ platform')
  if (!Array.isArray(rows) || rows.length === 0) {
    return { importId: importId || genImportId(), imported: 0, mapped: 0, skippedInvalid: 0, skippedDup: 0, unmappedSamples: [], tabs: [] }
  }

  // ---- alias lookup (เหมือน import-orders.js) ----
  const aliasByKey = new Map(), aliasByName = new Map()
  try {
    const aliases = await getSheet('product_aliases')
    for (const a of aliases) {
      if (a.alias_key) aliasByKey.set(normalize(a.alias_key), { master_sku: a.master_sku, display_name: a.display_name })
      const nm = normalize(a.alias_product_name || a.display_name)
      if (nm && !aliasByName.has(nm)) aliasByName.set(nm, { master_sku: a.master_sku, display_name: a.display_name })
    }
  } catch { /* ignore */ }

  importId = importId || genImportId()
  const importedAt = new Date().toISOString()

  const byMonth = new Map()
  const seenInFile = new Set()
  const itemCounter = new Map()
  let mapped = 0, skippedInvalid = 0
  const unmappedSamples = []

  for (const row of rows) {
    const orderId = String(pick(row, ['order_id', 'order id', 'order sn', 'orderid']) || '')
    let orderItemId = String(pick(row, ['order_item_id', 'order item id', 'item id', 'orderitemid']) || '')
    const date = isoDate(pick(row, ['date', 'created time', 'createtime', 'create_time']))
    if (!orderId || !date) { skippedInvalid++; continue }

    const business = pick(row, ['business', 'ธุรกิจ', 'แบรนด์', 'brand']) || businessDefault
    const skuPlatform = pick(row, ['sku_platform', 'seller sku', 'sku'])
    const productName = pick(row, ['product_name', 'product name', 'ชื่อสินค้า'])
    const variation = pick(row, ['variation_name', 'variation', 'sku_name'])
    const qty = parseInt(pick(row, ['qty', 'quantity', 'จำนวน']), 10) || 1
    const revenue = num(pick(row, ['revenue', 'sale_price', 'ยอดขาย']))
    const status = pick(row, ['order_status', 'status', 'order status']) || ''
    const province = pick(row, ['province', 'จังหวัด']) || ''
    const shippingOption = String(pick(row, ['shipping_option', 'delivery option', 'ตัวเลือกการจัดส่ง']) || '').trim()
    const fulfillmentType = String(pick(row, ['fulfillment_type', 'fulfillment type']) || '').trim()
    const buyerHashVal = String(pick(row, ['buyer_hash']) || '').trim()

    if (!orderItemId) {
      const n = (itemCounter.get(orderId) || 0) + 1
      itemCounter.set(orderId, n)
      orderItemId = `L${n}`
    }

    const orderKey = `${platform}:${orderId}:${orderItemId}`
    if (seenInFile.has(orderKey)) continue
    seenInFile.add(orderKey)

    const aliasKey = `${normalize(productName)}|${normalize(variation)}`
    const alias = aliasByKey.get(aliasKey) || aliasByName.get(normalize(productName))
    if (alias) mapped++
    else if (productName) {
      const dupeKey = `${productName}|${variation}`
      if (unmappedSamples.length < 20 && !unmappedSamples.some((s) => `${s.productName}|${s.variation}` === dupeKey)) {
        unmappedSamples.push({ productName, variation })
      }
    }

    const tab = `raw_orders_${date.slice(0, 4)}_${date.slice(5, 7)}`
    if (!byMonth.has(tab)) byMonth.set(tab, [])
    byMonth.get(tab).push({
      orderKey,
      arr: [orderKey, forceText(orderId), forceText(orderItemId), date, platform, business, forceText(skuPlatform), productName, variation, alias?.master_sku || '', alias?.display_name || productName, qty, revenue, status, importedAt, fileName, importId, aliasKey, province, shippingOption, fulfillmentType, buyerHashVal],
    })
  }

  // ---- กันซ้ำกับข้อมูลเดิม (order_key คอลัมน์ A) ----
  const tabs = [...byMonth.keys()]
  let skippedDup = 0, imported = 0
  if (tabs.length) {
    let existing = []
    try { existing = await batchGetValues(tabs.map((t) => `${t}!A:A`)) } catch { existing = [] }
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i]
      const existSet = new Set((existing[i]?.values || []).flat())
      const fresh = byMonth.get(tab).filter((r) => { if (existSet.has(r.orderKey)) { skippedDup++; return false } return true })
      if (fresh.length) {
        await appendRows(tab, fresh.map((r) => r.arr))
        imported += fresh.length
      }
    }
  }

  // ---- import_log ----
  try {
    await appendRows('import_log', [[importId, fileName, businessDefault, platform, imported, mapped, imported - mapped, importedAt, tabs.join(','), 'active']])
  } catch { /* ignore */ }

  return { importId, imported, mapped, skippedInvalid, skippedDup, unmappedSamples, tabs }
}

export { RAW_HEADERS }
