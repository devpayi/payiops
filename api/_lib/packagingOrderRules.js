// กฎกล่องพัสดุ (BOXP) — กล่องไหนใช้กับออเดอร์แบบไหน ขึ้นกับ "องค์ประกอบของออเดอร์" ไม่ใช่ต่อสินค้าเดี่ยว
// เหมือน sticker/BOXMJ (ดู packaging_recipes ใน inventory.js) — คนละ mechanism กัน เพราะกล่องพัสดุ
// ขึ้นกับ (สินค้า+จำนวน) ที่มากับ "ทั้งออเดอร์" ไม่ใช่ต่อยอดขายสินค้าแต่ละตัว
//
// สอง rule table:
//  - packaging_qty_rules: ออเดอร์ที่มีสินค้าตัวเดียว (นับรวมทุกไซส์/สีเป็น "กลุ่มสินค้า" เดียว ผ่าน deriveGroup)
//    จำนวนชิ้นรวม (1/2/3/4/5+) -> กล่องไหน
//  - packaging_combo_rules: ออเดอร์ที่มีสินค้า 2 ตัวขึ้นไป — match แบบเป๊ะ (SKU+จำนวนตรงเป๊ะทุกตัว)
//
// ไม่ตรงกฎไหนเลย -> fallback: ดูสินค้าที่จำนวนเยอะสุดในออเดอร์ ใช้กล่องตาม qty_rule ของสินค้านั้นตัวเดียว
// (เช่นเดียวกับสั่งเดี่ยว) ถ้ายังไม่มีอีก -> ไม่ระบุกล่อง (unresolved) ไม่เดามั่ว
import { getSheet, overwriteSheet, ensureSheets, batchGetValues, getMetaCached } from './sheets.js'
import { deriveGroup, buildOverrideMap } from './productGroup.js'

const QTY_RULES_SHEET = 'packaging_qty_rules'
const QTY_RULES_HEADERS = ['group_key', 'group_label', 'qty', 'box_sku', 'created_at']
const COMBO_RULES_SHEET = 'packaging_combo_rules'
// signature: SKU เรียง A-Z คั่นด้วย "+" แต่ละตัว "SKUxQTY" เช่น "PY006x1+PY007x1" — ไว้ lookup ตรงๆ
const COMBO_RULES_HEADERS = ['id', 'signature', 'items_json', 'box_sku', 'created_at']

let ensurePromise
const ensurePackagingRuleSheets = () => ensurePromise ||= ensureSheets([
  [QTY_RULES_SHEET, QTY_RULES_HEADERS],
  [COMBO_RULES_SHEET, COMBO_RULES_HEADERS],
])

const qtyBucket = (qty) => (qty >= 5 ? '5+' : String(qty))
const buildSignature = (items) => items
  .slice()
  .sort((a, b) => a.sku.localeCompare(b.sku))
  .map((it) => `${it.sku}x${it.qty}`)
  .join('+')

// ---------------- rules CRUD ----------------

export async function loadQtyRules() {
  await ensurePackagingRuleSheets()
  const rows = await getSheet(QTY_RULES_SHEET)
  return rows
    .filter((r) => r.group_key && r.qty && r.box_sku)
    .map((r) => ({ groupKey: r.group_key, groupLabel: r.group_label, qty: String(r.qty), boxSku: String(r.box_sku).toUpperCase() }))
}

export async function loadComboRules() {
  await ensurePackagingRuleSheets()
  const rows = await getSheet(COMBO_RULES_SHEET)
  return rows
    .filter((r) => r.signature && r.box_sku)
    .map((r) => ({ id: r.id, signature: r.signature, items: JSON.parse(r.items_json || '[]'), boxSku: String(r.box_sku).toUpperCase() }))
}

// group_key ต้องคำนวณด้วยตัวเดียวกับตอน match ออเดอร์จริงเป๊ะ (deriveGroup พร้อม override map จริง +
// sku จริงถ้ามี) ไม่งั้นกฎที่ตั้งไว้จะหา key ไม่เจอตอนจับคู่ออเดอร์ (เงียบ ไม่ error ให้เห็น) — sku เป็น
// option เพราะบางทีตั้งกฎจากชื่อกลุ่มเฉยๆ ไม่ได้อิง SKU ตัวใดตัวหนึ่งโดยเฉพาะ (เช่น "ถุงเท้าเจล 2in1" เป็น
// ป้ายกลุ่มรวม M+L) ตอนนั้น override เฉพาะ SKU จะใช้ไม่ได้อยู่ดี แต่ต้อง fetch overrideMap จริงเสมอ เผื่อ
// ชื่อกลุ่มที่กรอกตรงกับ override ของสินค้าอื่นพอดี (ไม่เกิดตอนนี้ เพราะ product_aliases ยังไม่มี override เลย
// แต่ต้องกันไว้ก่อนเผื่ออนาคต)
async function resolveGroupKey(groupLabel, sku) {
  const aliasRows = await getSheet('product_aliases').catch(() => [])
  const overrideMap = buildOverrideMap(aliasRows)
  return deriveGroup(groupLabel, sku || '', overrideMap).key
}

export async function upsertQtyRule(body) {
  const groupLabel = String(body.group_label || '').trim()
  const qty = qtyBucket(Number(body.qty) || 0)
  const boxSku = String(body.box_sku || '').trim().toUpperCase()
  if (!groupLabel || !boxSku) throw new Error('ต้องระบุ group_label และ box_sku')
  const key = await resolveGroupKey(groupLabel, body.sample_sku)
  await ensurePackagingRuleSheets()
  const rows = await getSheet(QTY_RULES_SHEET)
  const idx = rows.findIndex((r) => r.group_key === key && String(r.qty) === qty)
  if (idx === -1) {
    rows.push({ group_key: key, group_label: groupLabel, qty, box_sku: boxSku, created_at: new Date().toISOString() })
  } else {
    rows[idx].box_sku = boxSku
    rows[idx].group_label = groupLabel
  }
  await overwriteSheet(QTY_RULES_SHEET, QTY_RULES_HEADERS, rows.map((r) => QTY_RULES_HEADERS.map((h) => r[h] ?? '')))
  return { group_key: key, qty, box_sku: boxSku }
}

// bulk เขียนครั้งเดียว (1 read + 1 write) แทนวนเรียก upsertQtyRule ทีละแถว — ตอน seed ข้อมูลจำนวนมาก
// (เช่น จาก Excel) การยิงทีละ HTTP request ทำให้ overwrite ทับกันเองจนชน Google Sheets write quota
// (เจอจริง 2026-08-13: seed 372 แถวจากไฟล์ Excel พลาดไป 23 แถวเงียบๆ เพราะโดน rate limit กลางทาง)
export async function bulkUpsertQtyRules(items) {
  const aliasRows = await getSheet('product_aliases').catch(() => [])
  const overrideMap = buildOverrideMap(aliasRows)
  await ensurePackagingRuleSheets()
  const rows = await getSheet(QTY_RULES_SHEET)
  const byKey = new Map(rows.map((r, i) => [`${r.group_key}|${r.qty}`, i]))
  let applied = 0
  for (const it of items) {
    const groupLabel = String(it.group_label || '').trim()
    const qty = qtyBucket(Number(it.qty) || 0)
    const boxSku = String(it.box_sku || '').trim().toUpperCase()
    if (!groupLabel || !boxSku) continue
    const key = deriveGroup(groupLabel, it.sample_sku || '', overrideMap).key
    const mapKey = `${key}|${qty}`
    if (byKey.has(mapKey)) {
      rows[byKey.get(mapKey)].box_sku = boxSku
      rows[byKey.get(mapKey)].group_label = groupLabel
    } else {
      byKey.set(mapKey, rows.length)
      rows.push({ group_key: key, group_label: groupLabel, qty, box_sku: boxSku, created_at: new Date().toISOString() })
    }
    applied++
  }
  await overwriteSheet(QTY_RULES_SHEET, QTY_RULES_HEADERS, rows.map((r) => QTY_RULES_HEADERS.map((h) => r[h] ?? '')))
  return { applied, total: rows.length }
}

export async function deleteQtyRule(body) {
  const groupKey = String(body.group_key || '').trim()
  const qty = qtyBucket(Number(body.qty) || 0)
  await ensurePackagingRuleSheets()
  const rows = await getSheet(QTY_RULES_SHEET)
  const next = rows.filter((r) => !(r.group_key === groupKey && String(r.qty) === qty))
  await overwriteSheet(QTY_RULES_SHEET, QTY_RULES_HEADERS, next.map((r) => QTY_RULES_HEADERS.map((h) => r[h] ?? '')))
  return { group_key: groupKey, qty }
}

export async function upsertComboRule(body) {
  const items = Array.isArray(body.items) ? body.items : []
  const boxSku = String(body.box_sku || '').trim().toUpperCase()
  if (!items.length || !boxSku) throw new Error('ต้องระบุ items (array ของ {sku,qty}) และ box_sku')
  const cleanItems = items
    .map((it) => ({ sku: String(it.sku || '').trim().toUpperCase(), qty: Number(it.qty) || 0 }))
    .filter((it) => it.sku && it.qty > 0)
  if (cleanItems.length < 2) throw new Error('combo rule ต้องมีสินค้าอย่างน้อย 2 ตัว')
  const signature = buildSignature(cleanItems)
  await ensurePackagingRuleSheets()
  const rows = await getSheet(COMBO_RULES_SHEET)
  const idx = rows.findIndex((r) => r.signature === signature)
  if (idx === -1) {
    rows.push({ id: `combo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, signature, items_json: JSON.stringify(cleanItems), box_sku: boxSku, created_at: new Date().toISOString() })
  } else {
    rows[idx].box_sku = boxSku
  }
  await overwriteSheet(COMBO_RULES_SHEET, COMBO_RULES_HEADERS, rows.map((r) => COMBO_RULES_HEADERS.map((h) => r[h] ?? '')))
  return { signature, box_sku: boxSku }
}

// bulk เขียนครั้งเดียว — เหตุผลเดียวกับ bulkUpsertQtyRules
export async function bulkUpsertComboRules(items) {
  await ensurePackagingRuleSheets()
  const rows = await getSheet(COMBO_RULES_SHEET)
  const bySignature = new Map(rows.map((r, i) => [r.signature, i]))
  let applied = 0
  for (const it of items) {
    const rawItems = Array.isArray(it.items) ? it.items : []
    const boxSku = String(it.box_sku || '').trim().toUpperCase()
    const cleanItems = rawItems
      .map((x) => ({ sku: String(x.sku || '').trim().toUpperCase(), qty: Number(x.qty) || 0 }))
      .filter((x) => x.sku && x.qty > 0)
    if (cleanItems.length < 2 || !boxSku) continue
    const signature = buildSignature(cleanItems)
    if (bySignature.has(signature)) {
      rows[bySignature.get(signature)].box_sku = boxSku
    } else {
      bySignature.set(signature, rows.length)
      rows.push({ id: `combo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, signature, items_json: JSON.stringify(cleanItems), box_sku: boxSku, created_at: new Date().toISOString() })
    }
    applied++
  }
  await overwriteSheet(COMBO_RULES_SHEET, COMBO_RULES_HEADERS, rows.map((r) => COMBO_RULES_HEADERS.map((h) => r[h] ?? '')))
  return { applied, total: rows.length }
}

export async function deleteComboRule(body) {
  const signature = String(body.signature || '').trim()
  await ensurePackagingRuleSheets()
  const rows = await getSheet(COMBO_RULES_SHEET)
  const next = rows.filter((r) => r.signature !== signature)
  await overwriteSheet(COMBO_RULES_SHEET, COMBO_RULES_HEADERS, next.map((r) => COMBO_RULES_HEADERS.map((h) => r[h] ?? '')))
  return { signature }
}

// ---------------- order loading (Payi only, trailing `days`) ----------------

async function loadPayiOrders(days) {
  const meta = await getMetaCached()
  const allTabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders')).sort()
  if (!allTabs.length) return { orders: [], anchor: '', start: '' }

  const dateCols = await batchGetValues(allTabs.map((t) => `${t}!D:D`))
  const dataTabs = allTabs.filter((t, i) => (dateCols[i]?.values || []).length > 1)
  // days<=180 เสมอ (guard ด้านล่าง) — 3 tab ล่าสุดพอเผื่อกรณีเดือนเพิ่งเริ่มไม่กี่วัน
  const tabs = dataTabs.slice(-3)
  if (!tabs.length) return { orders: [], anchor: '', start: '' }

  // B:F = order_id,order_item_id,date,platform,business ; I:N = variation_name,master_sku,display_name,qty,revenue,status
  const ranges = tabs.flatMap((t) => [`${t}!B:F`, `${t}!I:N`])
  const vr = await batchGetValues(ranges)

  const byOrder = new Map() // `${orderId}|${platform}` -> { date, items: Map(sku -> {name, qty}) }
  let anchor = ''
  for (let i = 0; i < tabs.length; i++) {
    const left = vr[2 * i]?.values || []
    const right = vr[2 * i + 1]?.values || []
    const n = Math.max(left.length, right.length)
    for (let j = 1; j < n; j++) {
      const l = left[j] || [], r = right[j] || []
      const orderId = l[0], date = String(l[2] || '').slice(0, 10), plat = l[3] || '', biz = l[4] || ''
      const masterSku = String(r[1] || '').trim().toUpperCase()
      const name = r[2] || masterSku
      const qty = parseInt(r[3], 10) || 0
      const status = String(r[5] || '')
      if (!orderId || !date || !masterSku || qty <= 0) continue
      if (biz !== 'Payi') continue
      if (status.includes('ยกเลิก') || status.toLowerCase().includes('cancel')) continue
      if (date > anchor) anchor = date

      const key = `${orderId}|${plat}`
      if (!byOrder.has(key)) byOrder.set(key, { date, items: new Map() })
      const order = byOrder.get(key)
      if (date > order.date) order.date = date
      if (!order.items.has(masterSku)) order.items.set(masterSku, { name, qty: 0 })
      order.items.get(masterSku).qty += qty
    }
  }

  const start = anchor ? addDays(anchor, -(days - 1)) : ''
  const orders = [...byOrder.values()]
    .filter((o) => !start || (o.date >= start && o.date <= anchor))
    .map((o) => ({ date: o.date, items: [...o.items.entries()].map(([sku, v]) => ({ sku, name: v.name, qty: v.qty })) }))

  return { orders, anchor, start }
}

const addDays = (iso, days) => {
  const date = new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// ---------------- matching + demand computation ----------------

// คืน { boxSku, estimated, ruleKind } หรือ null ถ้าไม่มีกฎรองรับเลย
// ruleKind ไว้ debug/trace ตรงๆ ว่ากล่องนี้มาจากกฎแบบไหน (single/combo/fallback) — โชว์ตัวอย่างจริงให้
// เจ้าของเช็คเองได้ ไม่ใช่แค่บอกว่า "เชื่อได้" เฉยๆ
function matchOrder(items, qtyRuleMap, comboRuleMap, overrideMap) {
  if (items.length === 1) {
    const it = items[0]
    const { key } = deriveGroup(it.name, it.sku, overrideMap)
    const boxSku = qtyRuleMap.get(`${key}|${qtyBucket(it.qty)}`)
    return boxSku ? { boxSku, estimated: false, ruleKind: 'single' } : null
  }

  const signature = buildSignature(items)
  const exact = comboRuleMap.get(signature)
  if (exact) return { boxSku: exact, estimated: false, ruleKind: 'combo' }

  // fallback: สินค้าที่จำนวนเยอะสุดในออเดอร์ ใช้กฎสั่งเดี่ยวของตัวนั้นแทน (ประมาณการ)
  const biggest = items.slice().sort((a, b) => b.qty - a.qty)[0]
  const { key } = deriveGroup(biggest.name, biggest.sku, overrideMap)
  const boxSku = qtyRuleMap.get(`${key}|${qtyBucket(biggest.qty)}`)
  return boxSku ? { boxSku, estimated: true, ruleKind: 'fallback' } : null
}

// dailyAverage ต่อกล่อง (BOXP) ย้อนหลัง `days` วัน จากออเดอร์จริง — ใช้แทน packaging_recipes
// สำหรับกล่องพัสดุโดยเฉพาะ (กล่องพัสดุขึ้นกับองค์ประกอบทั้งออเดอร์ ไม่ใช่ต่อสินค้าเดี่ยวแบบสติกเกอร์/BOXMJ)
export async function computeBoxDemand(days = 30) {
  const [qtyRules, comboRules, aliasRows] = await Promise.all([loadQtyRules(), loadComboRules(), getSheet('product_aliases').catch(() => [])])
  const overrideMap = buildOverrideMap(aliasRows)
  const qtyRuleMap = new Map(qtyRules.map((r) => [`${r.groupKey}|${r.qty}`, r.boxSku]))
  const comboRuleMap = new Map(comboRules.map((r) => [r.signature, r.boxSku]))

  const { orders, anchor, start } = await loadPayiOrders(days)

  const boxCounts = new Map()
  let matched = 0, estimated = 0, unresolved = 0
  const unresolvedSamples = []
  const matchedSamples = { single: [], combo: [], fallback: [] }
  for (const order of orders) {
    const result = matchOrder(order.items, qtyRuleMap, comboRuleMap, overrideMap)
    const label = order.items.map((it) => `${it.name}x${it.qty}`).join(' + ')
    if (!result) {
      unresolved++
      if (unresolvedSamples.length < 20) unresolvedSamples.push(label)
      continue
    }
    matched++
    if (result.estimated) estimated++
    boxCounts.set(result.boxSku, (boxCounts.get(result.boxSku) || 0) + 1)
    const bucket = matchedSamples[result.ruleKind]
    if (bucket && bucket.length < 15) bucket.push({ date: order.date, order: label, boxSku: result.boxSku })
  }

  const items = [...boxCounts.entries()].map(([boxSku, count]) => ({
    boxSku,
    orders: count,
    dailyAverage: days ? Math.round((count / days) * 10) / 10 : 0,
  }))

  return {
    days, anchor, start,
    totalOrders: orders.length,
    matchedOrders: matched,
    estimatedOrders: estimated,
    unresolvedOrders: unresolved,
    unresolvedSamples,
    matchedSamples,
    items,
  }
}
