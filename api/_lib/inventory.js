// GET/POST /api/sheet-tools?op=inventory&view=items|movements
// สต็อกสินค้า — คงเหลือคำนวณสด (opening_balance + sum(stock_movements)) ไม่เก็บเลขนิ่งๆ
// เพื่อกันเพี้ยนแบบไฟล์ Excel เดิม (คงเหลือแยกชีตต้องพิมพ์เชื่อมมือทุกเดือน)
// นับสต็อกระดับ SKU จริง (master_sku) ไม่ใช่ product-family group — M/L/สี คือของคนละถังจริง
// ต้องแยกนับ ไม่รวมแบบ deriveGroup ที่ใช้กับหน้า Products/Claims (นั่นไว้แค่ดูภาพรวมยอดขาย)
import { getSheet, appendRows, overwriteSheet, ensureSheet } from './sheets.js'
import { isoDate } from './dates.js'
import { getSkuRedirectMap, resolveRedirect } from './skuMapping.js'
import { canManageOperations } from '../../shared/roles.js'
import { authEnabled } from './auth.js'

const ITEMS_SHEET = 'inventory_items'
const MOVEMENTS_SHEET = 'stock_movements'
// ต่อท้ายรายการเดิมเท่านั้น (ห้ามแทรกกลาง) — แถวเดิมใน Sheet อิงตำแหน่งคอลัมน์เดิมอยู่ เหมือน claims sheet
const ITEMS_HEADERS = ['sku', 'display_name', 'unit', 'safety_stock', 'opening_balance', 'opening_date', 'active', 'created_at', 'updated_at', 'reorder_date', 'expected_arrival', 'lead_time_production', 'lead_time_transport', 'ship_freight', 'reorder_qty', 'reorder_note', 'category', 'units_per_batch', 'buffer_percent']
// buffer_percent: เฉพาะ category=packaging — % เผื่อเพิ่มจากยอดใช้เฉลี่ยที่คำนวณจากยอดขาย (เพราะของจริงเบิกไปฟีด
// การผลิตล่วงหน้า ไม่ใช่ผลิตตามยอดขายวันต่อวัน) ค่าว่าง = ใช้ค่าแนะนำที่หน้าเว็บคำนวณจาก safety_percent
// ของ Planner Control เฉลี่ยของสินค้าที่ผูกไว้ (fallback 30% ถ้าไม่มีข้อมูล) — เจ้าของแก้ทับเองได้เสมอ
// เผื่อกรณียอดพุ่ง/ฉุกเฉิน โดยไม่ถูกคำนวณทับอัตโนมัติซ้ำอีกเมื่อมีการตั้งค่าไว้แล้ว
// category: '' หรือ 'product' = สินค้าขาย (ของเดิม), 'packaging' = วัสดุแพ็คเกจจิ้ง/สิ้นเปลือง (สติกเกอร์/กล่อง —
// เดิมอยู่ในชีท Excel "Something" แยกต่างหาก ไม่มี dailyAverage จากยอดขายลูกค้าเหมือนสินค้าจริง เพราะใช้ตามการผลิตไม่ใช่ตามออเดอร์
// units_per_batch: เฉพาะ category=packaging — 1 แผ่น/แพ็คมีกี่ชิ้น ไว้แปลงยอดใช้ (ชิ้น) เป็นจุดสั่งซื้อ (แผ่น/แพ็ค)
// ผ่าน packaging_recipes (ดูด้านล่าง)
const MOVEMENTS_HEADERS = ['id', 'date', 'sku', 'type', 'qty', 'note', 'created_by', 'created_at', 'updated_by', 'updated_at']
const MOVEMENT_TYPES = new Set(['in', 'out', 'adjust'])
// ประวัติแก้ไขรายการเข้า-ออก — append-only เก็บ before/after ทั้งแถว (เหมือน pattern workforce_ot_history)
const MOVEMENTS_HISTORY_SHEET = 'stock_movements_history'
const MOVEMENTS_HISTORY_HEADERS = ['id', 'movement_id', 'before_json', 'after_json', 'changed_at', 'changed_by']

// เชื่อมวัสดุแพ็คเกจจิ้งกับสินค้าที่ใช้มันจริง — 1 แถวต่อ 1 คู่ (วัสดุ, สินค้า) เพื่อเอายอดขาย
// เฉลี่ยของสินค้ามาคำนวณว่าวัสดุควรสั่งเพิ่มเท่าไหร่ (เหมือน pattern set_recipes ที่ planner-sales.js ใช้)
const PACKAGING_RECIPES_SHEET = 'packaging_recipes'
const PACKAGING_RECIPES_HEADERS = ['packaging_sku', 'product_sku', 'qty_per_unit', 'created_at']

// คิวของเข้ารอ match — ฟ้า (stock role) ลงว่าของอะไรเข้าวันไหน/นับวันไหน/เข้าเท่าไร หลังเห็นรูป
// ที่หน้างานถ่ายลงกลุ่มไลน์ (คุยกันนอกระบบ ไม่ผูก LINE API) แล้วรอ boss (พี่หยก/พี่แต้ว) เข้ามา match
// ยืนยันในเว็บ — match แล้วค่อยสร้างแถวจริงใน stock_movements (ไม่กระทบยอดคงเหลือจนกว่าจะ match)
const STOCK_IN_REQUESTS_SHEET = 'stock_in_requests'
const STOCK_IN_REQUESTS_HEADERS = ['id', 'sku', 'arrival_date', 'count_date', 'qty', 'note', 'status', 'created_by', 'created_at', 'matched_by', 'matched_at', 'movement_id', 'reject_reason']
const STOCK_IN_STATUSES = new Set(['pending', 'matched', 'rejected'])

let ensurePromise
const ensureInventorySheets = () => ensurePromise ||= Promise.all([
  ensureSheet(ITEMS_SHEET, ITEMS_HEADERS),
  ensureSheet(MOVEMENTS_SHEET, MOVEMENTS_HEADERS),
  ensureSheet(PACKAGING_RECIPES_SHEET, PACKAGING_RECIPES_HEADERS),
  ensureSheet(MOVEMENTS_HISTORY_SHEET, MOVEMENTS_HISTORY_HEADERS),
  ensureSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS),
])

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const truthyActive = (v) => v === '' || v === undefined || v === null || String(v) === '1' || String(v).toLowerCase() === 'true'
const genId = () => `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const todayBKK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

// สถานะ: หมด (คงเหลือ <= 0) / ใกล้หมด (คงเหลือ <= safety stock) / ปกติ
function statusOf(balance, safetyStock) {
  if (balance <= 0) return 'หมด'
  if (safetyStock > 0 && balance <= safetyStock) return 'ใกล้หมด'
  return 'ปกติ'
}

async function loadItemsWithBalance({ includeHidden = false } = {}) {
  await ensureInventorySheets()
  const [items, movements, redirectMap] = await Promise.all([getSheet(ITEMS_SHEET), getSheet(MOVEMENTS_SHEET), getSkuRedirectMap()])

  // sku_redirects (แก้ได้จากชีทตรงๆ ไม่ต้องแก้โค้ด) — ของเก่าที่ย้ายโค้ดสต็อกไปแล้ว (เช่น PY075→PY077)
  // จะถูกรวมยอด opening_balance + movement เข้ากับ sku ใหม่โดยอัตโนมัติ ไม่ต้อง migrate ข้อมูลด้วยมือ
  const openingBySku = new Map()
  const metaBySku = new Map() // canonicalSku -> แถว item ตัวแทน (แถวที่ sku ตรง canonical เองชนะเสมอ)
  for (const it of items) {
    if (!it.sku) continue
    const canonical = resolveRedirect(it.sku, redirectMap)
    openingBySku.set(canonical, (openingBySku.get(canonical) || 0) + num(it.opening_balance))
    const isCanonicalRow = String(it.sku).trim().toUpperCase() === canonical
    if (!metaBySku.has(canonical) || isCanonicalRow) metaBySku.set(canonical, it)
  }

  const bySku = new Map()
  for (const m of movements) {
    const sku = resolveRedirect(m.sku, redirectMap)
    if (!sku) continue
    bySku.set(sku, (bySku.get(sku) || 0) + num(m.qty))
  }
  const today = todayBKK()
  const transactionsToday = movements.filter((m) => isoDate(m.date) === today).length

  // ซ่อนสินค้าที่ไม่ได้ใช้ track สต็อกจริง (active=0) ออกจากรายการ/ยอดรวมปกติ —
  // ยังกู้คืนได้เสมอ ไม่ใช่ลบทิ้ง (includeHidden=1 ไว้ดู/กู้คืนจากหน้า Inventory)
  const visibleCanonicalSkus = [...metaBySku.keys()].filter((sku) => includeHidden || truthyActive(metaBySku.get(sku).active))
  const rows = visibleCanonicalSkus.map((sku) => {
    const it = metaBySku.get(sku)
    const balance = (openingBySku.get(sku) || 0) + (bySku.get(sku) || 0)
    const safetyStock = num(it.safety_stock)
    return {
      sku,
      display_name: it.display_name || sku,
      unit: it.unit || 'ชิ้น',
      category: it.category === 'packaging' ? 'packaging' : 'product',
      safety_stock: safetyStock,
      balance,
      status: statusOf(balance, safetyStock),
      reorder_date: it.reorder_date || '',
      expected_arrival: it.expected_arrival || '',
      reorder_qty: it.reorder_qty || '',
      reorder_note: it.reorder_note || '',
      lead_time_production: num(it.lead_time_production),
      lead_time_transport: num(it.lead_time_transport),
      ship_freight: String(it.ship_freight) === '1' || String(it.ship_freight).toLowerCase() === 'true',
      units_per_batch: num(it.units_per_batch),
      buffer_percent: it.buffer_percent === '' || it.buffer_percent === undefined ? null : num(it.buffer_percent),
      active: truthyActive(it.active),
    }
  })
  rows.sort((a, b) => a.display_name.localeCompare(b.display_name, 'th'))

  const activeRows = rows.filter((r) => r.active)
  return {
    items: rows,
    totals: {
      totalProducts: activeRows.length,
      totalStock: activeRows.reduce((s, r) => s + r.balance, 0),
      lowStockCount: activeRows.filter((r) => r.status !== 'ปกติ').length,
      transactionsToday,
    },
  }
}

async function loadMovements({ type, q, from, to }) {
  await ensureInventorySheets()
  const [items, movements] = await Promise.all([getSheet(ITEMS_SHEET), getSheet(MOVEMENTS_SHEET)])
  const nameBySku = new Map(items.map((it) => [String(it.sku), it.display_name || it.sku]))
  const query = String(q || '').trim().toLowerCase()

  let rows = movements.map((m) => ({
    id: m.id,
    date: isoDate(m.date),
    sku: m.sku,
    display_name: nameBySku.get(String(m.sku)) || m.sku,
    type: m.type,
    qty: num(m.qty),
    note: m.note || '',
    created_by: m.created_by || '',
    created_at: m.created_at || '',
    updated_by: m.updated_by || '',
    updated_at: m.updated_at || '',
  }))

  if (type && type !== 'all') rows = rows.filter((r) => r.type === type)
  if (from) rows = rows.filter((r) => r.date >= from)
  if (to) rows = rows.filter((r) => r.date <= to)
  if (query) rows = rows.filter((r) =>
    r.display_name.toLowerCase().includes(query) ||
    String(r.sku).toLowerCase().includes(query) ||
    r.created_by.toLowerCase().includes(query) ||
    r.note.toLowerCase().includes(query)
  )

  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return rows
}

async function upsertItem(body, actorName) {
  const sku = String(body.sku || '').trim()
  if (!sku) throw new Error('ต้องระบุ sku')
  await ensureInventorySheets()
  const items = await getSheet(ITEMS_SHEET)
  const now = new Date().toISOString()
  const idx = items.findIndex((it) => String(it.sku) === sku)

  if (idx === -1) {
    const row = {
      sku,
      display_name: body.display_name || sku,
      unit: body.unit || 'ชิ้น',
      category: body.category === 'packaging' ? 'packaging' : 'product',
      safety_stock: num(body.safety_stock),
      opening_balance: num(body.opening_balance),
      opening_date: isoDate(body.opening_date) || todayBKK(),
      reorder_date: body.reorder_date ? String(body.reorder_date).trim() : '',
      expected_arrival: body.expected_arrival ? isoDate(body.expected_arrival) : '',
      reorder_qty: body.reorder_qty || '',
      reorder_note: body.reorder_note || '',
      lead_time_production: num(body.lead_time_production),
      lead_time_transport: num(body.lead_time_transport),
      ship_freight: body.ship_freight ? '1' : '0',
      units_per_batch: num(body.units_per_batch),
      buffer_percent: body.buffer_percent === '' || body.buffer_percent === undefined ? '' : num(body.buffer_percent),
      active: '1',
      created_at: now,
      updated_at: now,
    }
    items.push(row)
  } else {
    const row = items[idx]
    if (body.display_name !== undefined) row.display_name = body.display_name
    if (body.unit !== undefined) row.unit = body.unit
    if (body.category !== undefined) row.category = body.category === 'packaging' ? 'packaging' : 'product'
    if (body.safety_stock !== undefined) row.safety_stock = num(body.safety_stock)
    if (body.opening_balance !== undefined) row.opening_balance = num(body.opening_balance)
    // วันเติมสินค้า/รอเช็ค — ข้อความอิสระ (ไม่ใช่วันที่) เพราะบางทีสั่งหลายล็อต ของเข้าไม่พร้อมกัน
    // เขียนบรรยายได้เลย เช่น "สั่ง 2 ล็อต ล็อตแรกมาแล้ว 200/500 รออีก 300 ต้นเดือน" — เคลียร์ได้ (ส่ง '' มา)
    if (body.reorder_date !== undefined) row.reorder_date = body.reorder_date ? String(body.reorder_date).trim() : ''
    if (body.expected_arrival !== undefined) row.expected_arrival = body.expected_arrival ? isoDate(body.expected_arrival) : ''
    if (body.reorder_qty !== undefined) row.reorder_qty = body.reorder_qty
    if (body.reorder_note !== undefined) row.reorder_note = body.reorder_note
    if (body.lead_time_production !== undefined) row.lead_time_production = num(body.lead_time_production)
    if (body.lead_time_transport !== undefined) row.lead_time_transport = num(body.lead_time_transport)
    if (body.ship_freight !== undefined) row.ship_freight = body.ship_freight ? '1' : '0'
    if (body.units_per_batch !== undefined) row.units_per_batch = num(body.units_per_batch)
    if (body.buffer_percent !== undefined) row.buffer_percent = body.buffer_percent === '' ? '' : num(body.buffer_percent)
    if (body.active !== undefined) row.active = body.active ? '1' : '0'
    row.updated_at = now
  }
  await overwriteSheet(ITEMS_SHEET, ITEMS_HEADERS, items.map((it) => ITEMS_HEADERS.map((h) => it[h] ?? '')))
  return { sku }
}

// boss กด "สั่งของ" (ปุ่มแยกจาก "แจ้งของเข้า" บนหน้า Stock Movement) — สร้าง/อัปเดตแถว
// pending ที่ arrival_date/count_date ว่างไว้ก่อน ("สั่งแล้ว รอของเข้า") ทับแถวเดิมที่ยังไม่มี
// คนมาลงวันของเข้า แทนสร้างซ้ำถ้าสั่งของ sku เดิมอีกรอบก่อนของรอบแรกจะมา
async function createOrderRequest(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่สั่งของได้')
  const sku = String(body.sku || '').trim()
  const qty = Number(body.qty)
  if (!sku) throw new Error('ต้องระบุสินค้า')
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('ต้องระบุจำนวน')

  await ensureInventorySheets()
  const [items, requests] = await Promise.all([getSheet(ITEMS_SHEET), getSheet(STOCK_IN_REQUESTS_SHEET)])
  if (!items.some((it) => String(it.sku) === sku)) throw new Error('ไม่พบสินค้านี้ในระบบ')

  const idx = requests.findIndex((r) => String(r.sku) === sku && r.status === 'pending' && !r.arrival_date)
  if (idx !== -1) {
    requests[idx] = { ...requests[idx], qty, note: body.note || requests[idx].note }
    await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
    return requests[idx]
  }
  const now = new Date().toISOString()
  const row = {
    id: genId(),
    sku,
    arrival_date: '',
    count_date: '',
    qty,
    note: body.note || '',
    status: 'pending',
    created_by: actorName || '',
    created_at: now,
  }
  await appendRows(STOCK_IN_REQUESTS_SHEET, [STOCK_IN_REQUESTS_HEADERS.map((h) => row[h] ?? '')])
  return row
}

// ปิดรายการ "สั่งของ" ที่ของมาครบ/เคลียร์แล้วด้วยตัวเอง — ไม่สร้าง stock_movements (เพราะยอดจริง
// เข้าไปแล้วผ่านการที่ฟ้า "แจ้งของเข้า" + boss match แยกต่างหาก) แค่ปิดรายการติดตามให้หายไปจากคิว
async function finishOrderRequest(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่ปิดรายการได้')
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')

  await ensureInventorySheets()
  const requests = await getSheet(STOCK_IN_REQUESTS_SHEET)
  const idx = requests.findIndex((r) => String(r.id) === id)
  if (idx === -1) throw new Error('ไม่พบคำขอนี้')
  if (requests[idx].status !== 'pending' || requests[idx].arrival_date) throw new Error('ปิดได้เฉพาะรายการสั่งของที่ยังไม่มีของเข้า')

  const now = new Date().toISOString()
  requests[idx] = { ...requests[idx], status: 'done', matched_by: actorName || '', matched_at: now }
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return requests[idx]
}

// ลบทิ้งจริง (ไม่ใช่ append-only แบบ stock_movements) — เฉพาะแถวที่ถูกปฏิเสธแล้วเท่านั้น
// เพราะเป็นแค่คำขอที่ยังไม่กระทบยอดคงเหลือเลย (pending/matched ห้ามลบ กันหลักฐานหาย)
async function deleteStockInRequest(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่ลบได้')
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')

  await ensureInventorySheets()
  const requests = await getSheet(STOCK_IN_REQUESTS_SHEET)
  const idx = requests.findIndex((r) => String(r.id) === id)
  if (idx === -1) throw new Error('ไม่พบคำขอนี้')
  if (requests[idx].status !== 'rejected') throw new Error('ลบได้เฉพาะคำขอที่ถูกปฏิเสธแล้ว')

  const next = requests.filter((r) => String(r.id) !== id)
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, next.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return { id }
}

async function addMovement(body, actorName) {
  const sku = String(body.sku || '').trim()
  const type = String(body.type || '').trim()
  const qtyInput = Number(body.qty)
  if (!sku) throw new Error('ต้องระบุสินค้า')
  if (!MOVEMENT_TYPES.has(type)) throw new Error('ประเภทรายการไม่ถูกต้อง')
  if (!Number.isFinite(qtyInput) || qtyInput === 0) throw new Error('ต้องระบุจำนวน')

  await ensureInventorySheets()
  const [items, redirectMap] = await Promise.all([getSheet(ITEMS_SHEET), getSkuRedirectMap()])
  // ยอมรับ sku ที่เป็น "โค้ดใหม่" (canonical หลัง redirect) แม้ยังไม่มีแถว item จริงของโค้ดนั้น
  // เอง — แค่ต้องมีแถวเก่าที่ redirect มาถึงโค้ดเดียวกัน (ดู loadItemsWithBalance/sku_redirects)
  const canonical = resolveRedirect(sku, redirectMap)
  if (!items.some((it) => it.sku && resolveRedirect(it.sku, redirectMap) === canonical)) throw new Error('ไม่พบสินค้านี้ในระบบ')

  // in/out รับจำนวนเป็นบวกจาก UI เสมอ แล้วกำหนดเครื่องหมายเองตามประเภท —
  // adjust (ปรับยอด) ผู้ใช้พิมพ์เลขติดลบ/บวกเองตรงๆ เพราะเป็นการแก้ยอดให้ตรงของจริง
  let qty = qtyInput
  if (type === 'in') qty = Math.abs(qtyInput)
  if (type === 'out') qty = -Math.abs(qtyInput)

  const now = new Date().toISOString()
  const row = {
    id: genId(),
    date: isoDate(body.date) || todayBKK(),
    sku,
    type,
    qty,
    note: body.note || '',
    created_by: actorName || '',
    created_at: now,
  }
  await appendRows(MOVEMENTS_SHEET, [MOVEMENTS_HEADERS.map((h) => row[h] ?? '')])
  return row
}

async function updateMovement(body, actorName) {
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')
  const type = String(body.type || '').trim()
  const qtyInput = Number(body.qty)
  if (!MOVEMENT_TYPES.has(type)) throw new Error('ประเภทรายการไม่ถูกต้อง')
  if (!Number.isFinite(qtyInput) || qtyInput === 0) throw new Error('ต้องระบุจำนวน')

  await ensureInventorySheets()
  const movements = await getSheet(MOVEMENTS_SHEET)
  const idx = movements.findIndex((m) => String(m.id) === id)
  if (idx === -1) throw new Error('ไม่พบรายการนี้')
  const before = movements[idx]

  let qty = qtyInput
  if (type === 'in') qty = Math.abs(qtyInput)
  if (type === 'out') qty = -Math.abs(qtyInput)

  const now = new Date().toISOString()
  const after = {
    ...before,
    date: isoDate(body.date) || before.date,
    type, qty,
    note: body.note !== undefined ? body.note : before.note,
    updated_by: actorName || '',
    updated_at: now,
  }
  movements[idx] = after
  await Promise.all([
    overwriteSheet(MOVEMENTS_SHEET, MOVEMENTS_HEADERS, movements.map((m) => MOVEMENTS_HEADERS.map((h) => m[h] ?? ''))),
    appendRows(MOVEMENTS_HISTORY_SHEET, [[`mvhist-${Date.now()}`, id, JSON.stringify(before), JSON.stringify(after), now, actorName || '']]),
  ])
  return after
}

// role กรอง: แถวที่ยัง "สั่งไว้ รอของเข้า" (ไม่มี arrival_date เลย — มาจากพี่หยกกรอกจำนวนสั่งใน
// Inventory เอง) ให้ boss/dev เห็นเท่านั้น — ตั้งใจไม่ให้ฟ้า(คนรับของ)เห็นจำนวนที่สั่งไว้ล่วงหน้า
// จะได้นับสต็อกจริงแบบ blind count ไม่ใช่แค่เช็คให้ตรงกับเลขที่คาดไว้ (แถวที่มี arrival_date
// แล้ว = มีคนแจ้งของเข้าจริงแล้ว ปลอดภัยให้ทุกคนเห็น เพราะเป็นเลขนับจริง ไม่ใช่เลขคาดการณ์)
async function loadStockInRequests({ status, role } = {}) {
  await ensureInventorySheets()
  const [rows, items] = await Promise.all([getSheet(STOCK_IN_REQUESTS_SHEET), getSheet(ITEMS_SHEET)])
  const nameBySku = new Map(items.map((it) => [String(it.sku), it.display_name || it.sku]))
  let out = rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    display_name: nameBySku.get(String(r.sku)) || r.sku,
    arrival_date: isoDate(r.arrival_date),
    count_date: isoDate(r.count_date),
    qty: num(r.qty),
    note: r.note || '',
    status: r.status || 'pending',
    created_by: r.created_by || '',
    created_at: r.created_at || '',
    matched_by: r.matched_by || '',
    matched_at: r.matched_at || '',
    reject_reason: r.reject_reason || '',
    order_only: !isoDate(r.arrival_date),
  }))
  if (status) out = out.filter((r) => r.status === status)
  if (authEnabled() && !canManageOperations(role)) out = out.filter((r) => !r.order_only)
  out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return out
}

async function addStockInRequest(body, actorName) {
  const sku = String(body.sku || '').trim()
  const qty = Number(body.qty)
  if (!sku) throw new Error('ต้องระบุสินค้า')
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('ต้องระบุจำนวน')

  await ensureInventorySheets()
  const items = await getSheet(ITEMS_SHEET)
  if (!items.some((it) => String(it.sku) === sku)) throw new Error('ไม่พบสินค้านี้ในระบบ')

  const now = new Date().toISOString()
  const row = {
    id: genId(),
    sku,
    arrival_date: isoDate(body.arrival_date) || todayBKK(),
    count_date: isoDate(body.count_date) || '',
    qty,
    note: body.note || '',
    status: 'pending',
    created_by: actorName || '',
    created_at: now,
  }
  await appendRows(STOCK_IN_REQUESTS_SHEET, [STOCK_IN_REQUESTS_HEADERS.map((h) => row[h] ?? '')])
  return row
}

// boss match ยืนยัน — สร้างแถวจริงใน stock_movements (type=in) แล้ว mark คำขอเป็น matched
// รับ qty ทับได้ (ถ้านับจริงไม่ตรงกับที่ฟ้าลงไว้ก่อนหน้า) — ไม่บังคับต้องเท่าเดิม
async function matchStockInRequest(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่ match ได้')
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')

  await ensureInventorySheets()
  const requests = await getSheet(STOCK_IN_REQUESTS_SHEET)
  const idx = requests.findIndex((r) => String(r.id) === id)
  if (idx === -1) throw new Error('ไม่พบคำขอนี้')
  const req = requests[idx]
  if (req.status !== 'pending') throw new Error('คำขอนี้ถูกดำเนินการไปแล้ว')
  // แถว "สั่งไว้ รอของเข้า" เฉยๆ (ไม่มีคนแจ้งของเข้าจริง) ยัง match ไม่ได้ — ต้องรอมีคนแจ้งรับของจริงก่อน
  if (!req.arrival_date) throw new Error('คำขอนี้ยังไม่มีคนแจ้งรับของจริง — รอฟ้าแจ้งของเข้าก่อน')

  const qty = body.qty !== undefined ? Number(body.qty) : num(req.qty)
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('ต้องระบุจำนวน')

  const movement = await addMovement({
    sku: req.sku,
    type: 'in',
    qty,
    date: req.count_date || req.arrival_date,
    note: body.note || `รับเข้าจากคำขอของ ${req.created_by || '-'}${req.note ? ` — ${req.note}` : ''}`,
  }, actorName)

  const now = new Date().toISOString()
  requests[idx] = { ...req, status: 'matched', matched_by: actorName || '', matched_at: now, movement_id: movement.id }
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return requests[idx]
}

async function rejectStockInRequest(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่ปฏิเสธได้')
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')

  await ensureInventorySheets()
  const requests = await getSheet(STOCK_IN_REQUESTS_SHEET)
  const idx = requests.findIndex((r) => String(r.id) === id)
  if (idx === -1) throw new Error('ไม่พบคำขอนี้')
  if (requests[idx].status !== 'pending') throw new Error('คำขอนี้ถูกดำเนินการไปแล้ว')

  const now = new Date().toISOString()
  requests[idx] = { ...requests[idx], status: 'rejected', matched_by: actorName || '', matched_at: now, reject_reason: body.note || '' }
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return requests[idx]
}

// ฟ้าแก้ไขคำขอที่ถูกปฏิเสธแล้วส่งกลับเข้าคิวรอ match ใหม่ (ไม่ต้องพิมพ์แจ้งของเข้าใหม่ทั้งหมด)
// หรือแก้ไขคำขอที่ยัง pending อยู่ — กรณีนี้ใช้ตอนพี่หยกสั่งของไว้ก่อน (ยังไม่มีวันของเข้า/วันนับ)
// แล้วฟ้ามากรอกวันที่จริงทีหลังตอนของมาถึง
async function editStockInRequest(body, actorName, role) {
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')

  await ensureInventorySheets()
  const [requests, items] = await Promise.all([getSheet(STOCK_IN_REQUESTS_SHEET), getSheet(ITEMS_SHEET)])
  const idx = requests.findIndex((r) => String(r.id) === id)
  if (idx === -1) throw new Error('ไม่พบคำขอนี้')
  if (!['pending', 'rejected'].includes(requests[idx].status)) throw new Error('แก้ไขได้เฉพาะคำขอที่ยังไม่ match')
  // แถว "สั่งไว้ รอของเข้า" (ยังไม่มี arrival_date) เป็นของ boss เท่านั้น — กันไม่ให้ใครแก้ไขเพื่อ
  // ดูจำนวนที่สั่งไว้ล่วงหน้าได้ผ่าน endpoint ตรงๆ แม้ UI จะซ่อนไว้แล้วก็ตาม (defense in depth)
  if (!requests[idx].arrival_date && authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่แก้ไขได้')

  const sku = String(body.sku || requests[idx].sku).trim()
  const qty = Number(body.qty)
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('ต้องระบุจำนวน')
  if (!items.some((it) => String(it.sku) === sku)) throw new Error('ไม่พบสินค้านี้ในระบบ')

  requests[idx] = {
    ...requests[idx],
    sku,
    qty,
    arrival_date: isoDate(body.arrival_date) || requests[idx].arrival_date,
    count_date: body.count_date !== undefined ? (isoDate(body.count_date) || '') : requests[idx].count_date,
    note: body.note !== undefined ? body.note : requests[idx].note,
    status: 'pending',
    created_by: actorName || requests[idx].created_by,
    matched_by: '',
    matched_at: '',
    reject_reason: '',
  }
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return requests[idx]
}

async function loadPackagingRecipes() {
  await ensureInventorySheets()
  const [rows, items] = await Promise.all([getSheet(PACKAGING_RECIPES_SHEET), getSheet(ITEMS_SHEET)])
  const nameBySku = new Map(items.map((it) => [String(it.sku).toUpperCase(), it.display_name || it.sku]))
  return rows
    .filter((r) => r.packaging_sku && r.product_sku)
    .map((r) => ({
      packaging_sku: String(r.packaging_sku).toUpperCase(),
      product_sku: String(r.product_sku).toUpperCase(),
      product_name: nameBySku.get(String(r.product_sku).toUpperCase()) || r.product_sku,
      qty_per_unit: num(r.qty_per_unit) || 1,
    }))
}

async function upsertPackagingRecipe(body) {
  const packagingSku = String(body.packaging_sku || '').trim().toUpperCase()
  const productSku = String(body.product_sku || '').trim().toUpperCase()
  const qtyPerUnit = Number(body.qty_per_unit) || 1
  if (!packagingSku || !productSku) throw new Error('ต้องระบุ packaging_sku และ product_sku')

  await ensureInventorySheets()
  const rows = await getSheet(PACKAGING_RECIPES_SHEET)
  const idx = rows.findIndex((r) => String(r.packaging_sku).toUpperCase() === packagingSku && String(r.product_sku).toUpperCase() === productSku)
  if (idx === -1) {
    rows.push({ packaging_sku: packagingSku, product_sku: productSku, qty_per_unit: qtyPerUnit, created_at: new Date().toISOString() })
  } else {
    rows[idx].qty_per_unit = qtyPerUnit
  }
  await overwriteSheet(PACKAGING_RECIPES_SHEET, PACKAGING_RECIPES_HEADERS, rows.map((r) => PACKAGING_RECIPES_HEADERS.map((h) => r[h] ?? '')))
  return { packaging_sku: packagingSku, product_sku: productSku }
}

async function deletePackagingRecipe(body) {
  const packagingSku = String(body.packaging_sku || '').trim().toUpperCase()
  const productSku = String(body.product_sku || '').trim().toUpperCase()
  await ensureInventorySheets()
  const rows = await getSheet(PACKAGING_RECIPES_SHEET)
  const next = rows.filter((r) => !(String(r.packaging_sku).toUpperCase() === packagingSku && String(r.product_sku).toUpperCase() === productSku))
  await overwriteSheet(PACKAGING_RECIPES_SHEET, PACKAGING_RECIPES_HEADERS, next.map((r) => PACKAGING_RECIPES_HEADERS.map((h) => r[h] ?? '')))
  return { packaging_sku: packagingSku, product_sku: productSku }
}

export default async function opInventory(req, res) {
  try {
    const actorName = req.user?.name || req.user?.u || ''
    const role = req.user?.role

    if (req.method === 'GET') {
      const view = String(req.query.view || 'items')
      if (view === 'stock-in-requests') {
        const rows = await loadStockInRequests({ status: req.query.status, role })
        return res.status(200).json({ success: true, requests: rows })
      }
      if (view === 'movements') {
        const rows = await loadMovements({
          type: req.query.type,
          q: req.query.q,
          from: req.query.from,
          to: req.query.to,
        })
        return res.status(200).json({ success: true, movements: rows })
      }
      if (view === 'packaging-recipes') {
        const recipes = await loadPackagingRecipes()
        return res.status(200).json({ success: true, recipes })
      }
      const data = await loadItemsWithBalance({ includeHidden: req.query.includeHidden === '1' })
      return res.status(200).json({ success: true, ...data })
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '')
      if (action === 'upsert-item') {
        const result = await upsertItem(req.body, actorName)
        return res.status(200).json({ success: true, ...result })
      }
      if (action === 'add-movement') {
        const result = await addMovement(req.body, actorName)
        return res.status(200).json({ success: true, movement: result })
      }
      if (action === 'update-movement') {
        const result = await updateMovement(req.body, actorName)
        return res.status(200).json({ success: true, movement: result })
      }
      if (action === 'create-stock-in-request') {
        const result = await addStockInRequest(req.body, actorName)
        return res.status(200).json({ success: true, request: result })
      }
      if (action === 'match-stock-in-request') {
        const result = await matchStockInRequest(req.body, actorName, role)
        return res.status(200).json({ success: true, request: result })
      }
      if (action === 'reject-stock-in-request') {
        const result = await rejectStockInRequest(req.body, actorName, role)
        return res.status(200).json({ success: true, request: result })
      }
      if (action === 'edit-stock-in-request') {
        const result = await editStockInRequest(req.body, actorName, role)
        return res.status(200).json({ success: true, request: result })
      }
      if (action === 'create-order-request') {
        const result = await createOrderRequest(req.body, actorName, role)
        return res.status(200).json({ success: true, request: result })
      }
      if (action === 'finish-stock-in-request') {
        const result = await finishOrderRequest(req.body, actorName, role)
        return res.status(200).json({ success: true, request: result })
      }
      if (action === 'delete-stock-in-request') {
        const result = await deleteStockInRequest(req.body, actorName, role)
        return res.status(200).json({ success: true, ...result })
      }
      if (action === 'upsert-recipe') {
        const result = await upsertPackagingRecipe(req.body)
        return res.status(200).json({ success: true, ...result })
      }
      if (action === 'delete-recipe') {
        const result = await deletePackagingRecipe(req.body)
        return res.status(200).json({ success: true, ...result })
      }
      return res.status(400).json({ success: false, error: 'action ไม่ถูกต้อง' })
    }

    return res.status(405).json({ success: false, error: 'method not allowed' })
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message })
  }
}
