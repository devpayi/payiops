// GET/POST /api/sheet-tools?op=inventory&view=items|movements
// สต็อกสินค้า — คงเหลือคำนวณสด (opening_balance + sum(stock_movements)) ไม่เก็บเลขนิ่งๆ
// เพื่อกันเพี้ยนแบบไฟล์ Excel เดิม (คงเหลือแยกชีตต้องพิมพ์เชื่อมมือทุกเดือน)
// นับสต็อกระดับ SKU จริง (master_sku) ไม่ใช่ product-family group — M/L/สี คือของคนละถังจริง
// ต้องแยกนับ ไม่รวมแบบ deriveGroup ที่ใช้กับหน้า Products/Claims (นั่นไว้แค่ดูภาพรวมยอดขาย)
import { getSheet, appendRows, overwriteSheet, ensureSheets } from './sheets.js'
import { isoDate } from './dates.js'
import { getSkuRedirectMap, resolveRedirect } from './skuMapping.js'
import { canManageOperations } from '../../shared/roles.js'
import { authEnabled } from './auth.js'
import { computeSalesStats } from '../planner-sales.js'

const ITEMS_SHEET = 'inventory_items'
const MOVEMENTS_SHEET = 'stock_movements'
// ต่อท้ายรายการเดิมเท่านั้น (ห้ามแทรกกลาง) — แถวเดิมใน Sheet อิงตำแหน่งคอลัมน์เดิมอยู่ เหมือน claims sheet
const ITEMS_HEADERS = ['sku', 'display_name', 'unit', 'safety_stock', 'opening_balance', 'opening_date', 'active', 'created_at', 'updated_at', 'reorder_date', 'expected_arrival', 'lead_time_production', 'lead_time_transport', 'ship_freight', 'reorder_qty', 'reorder_note', 'category', 'units_per_batch', 'buffer_percent', 'order_group', 'retail_price']
// order_group: แท็กกลุ่มสินค้าสำหรับ "สั่งของ" เท่านั้น (เช่น PY051..PY051-J ทั้งไซส์/สีแท็ก "รองเท้าเพื่อสุขภาพ"
// เดียวกัน) — ตั้งเอง ไม่ auto-derive จากชื่อ เพราะลองแล้วพบว่า deriveGroup (ตัวจับกลุ่มฝั่งยอดขาย) จับ
// เคสพวกนี้ไม่ได้เลย (ไซส์เป็นตัวเลข "35-36" ไม่ใช่ M/L, สี "เนื้อ"/"ฟ้าเบบี้บลู" ไม่อยู่ใน COLOR_TOKENS)
// ปล่อยให้ผิดกลุ่มในหน้าสั่งของจริงเสี่ยงกว่าปล่อยให้วิเคราะห์ยอดขายผิด เลยให้เจ้าของ tag เองใน Inventory
// ว่างเปล่า = สินค้านั้นสั่งได้เฉพาะเลือกทีละ SKU เท่านั้น (ไม่โผล่ในตัวเลือก "สั่งทั้งกลุ่ม")
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
// linked_order_id: ต่อท้ายล่าสุด — ผูกแถว "แจ้งของเข้า" (มี arrival_date) เข้ากับแถว "สั่งของ"
// (order_only) ที่ boss เลือก match ด้วยตอนกดยืนยัน ใช้ตรวจสอบย้อนหลังว่าของล็อตนี้คือของที่สั่งลอตไหน
const STOCK_IN_REQUESTS_HEADERS = ['id', 'sku', 'arrival_date', 'count_date', 'qty', 'note', 'status', 'created_by', 'created_at', 'matched_by', 'matched_at', 'movement_id', 'reject_reason', 'linked_order_id', 'order_date']
const STOCK_IN_STATUSES = new Set(['pending', 'matched', 'rejected'])
export const isPackagingItem = (item) => item.category === 'packaging' || /^(PKG-|BOXMJ-|BOXP-)/i.test(String(item.sku || ''))

let ensurePromise
const ensureInventorySheets = () => ensurePromise ||= ensureSheets([
  [ITEMS_SHEET, ITEMS_HEADERS],
  [MOVEMENTS_SHEET, MOVEMENTS_HEADERS],
  [PACKAGING_RECIPES_SHEET, PACKAGING_RECIPES_HEADERS],
  [MOVEMENTS_HISTORY_SHEET, MOVEMENTS_HISTORY_HEADERS],
  [STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS],
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

export async function loadItemsWithBalance({ includeHidden = false } = {}) {
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
  let lastMovementAt = '' // created_at (มีเวลา) ของรายการเข้า-ออก/ปรับยอดล่าสุดทั้งระบบ — ให้หน้า Inventory
  // โชว์เป็นป้ายมุมเดียว "อัพเดทสต็อกล่าสุด วันที่/เวลา" (ไม่ใช่ต่อแถว) กันเข้าใจผิดว่าข้อมูลสดแค่ไหน
  for (const m of movements) {
    const sku = resolveRedirect(m.sku, redirectMap)
    if (!sku) continue
    bySku.set(sku, (bySku.get(sku) || 0) + num(m.qty))
    if (m.created_at && m.created_at > lastMovementAt) lastMovementAt = m.created_at
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
      order_group: it.order_group || '',
      retail_price: num(it.retail_price),
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
      lastMovementAt,
    },
  }
}

// SS = ยอดขายเฉลี่ย/วัน × (lead time total + ครึ่งนึงถ้าเป็นของเรือ) — ต้อง "ตรงเป๊ะ" กับสูตรใน
// Inventory.jsx (ที่มาต้นฉบับ, calcSuggestedSafety/calcRecommendedOrder) ไม่งั้นตัวเลขในไลน์กับ
// หน้าเว็บจะขัดแย้งกัน — พอร์ตมาไว้ฝั่งเซิร์ฟเวอร์เพราะ cron ไม่มี browser ให้รันโค้ดฝั่ง React
const calcSuggestedSafety = (dailyAvg, leadTimeTotal, shipFreight) => {
  if (!dailyAvg || !leadTimeTotal) return null
  const days = leadTimeTotal + (shipFreight ? leadTimeTotal / 2 : 0)
  return Math.round(dailyAvg * days)
}
const calcRecommendedOrder = (safetyStock, balance, dailyAvg, leadTimeTotal) => {
  const projectedAtArrival = balance - dailyAvg * leadTimeTotal
  return Math.max(0, Math.round(safetyStock - projectedAtArrival))
}

// รายการของใกล้หมด/หมด สำหรับ cron แจ้งเตือนไลน์ — สูตรเดียวกับหน้า Inventory.jsx เป๊ะ (ports จากที่นั่น
// รวม allocatedSales fallback สำหรับ SKU แยกสี/ไซส์ที่ไม่มียอดขายของตัวเองตรงๆ) ไม่รวมวัสดุแพ็คเกจจิ้ง
// (ไม่มี balance จริงให้เทียบ เหมือนหน้าเว็บ)
// SKU ที่มีคำสั่งซื้อ (สั่งของ) ค้างอยู่ ยังไม่มีของเข้า (order_only แถวใน stock_in_requests ที่ arrival_date
// ว่างและ status ยัง pending) — ใช้กันไม่ให้ cron แจ้งเตือนของใกล้หมดซ้ำสำหรับของที่บอสสั่งไปแล้วแต่กำลังรอ
// ส่งมา (บั๊กจริงที่เจอ 2026-08-04: บอสสั่งของไปแล้ว แต่ไลน์ยังเตือนของเหลือน้อยซ้ำทุกวัน เพราะ cron เดิม
// ไม่เคยเช็ค stock_in_requests เลย คำนวณจากยอดคงเหลือ/safety stock ล้วนๆ) พอของเข้าจริง (match แล้ว) หรือถูก
// ยกเลิก/ปฏิเสธ แถวจะไม่ใช่ pending อีกต่อไป → กลับมาแจ้งเตือนตามปกติถ้ายังของใกล้หมดอยู่
async function loadOpenOrderSkus() {
  await ensureInventorySheets()
  const rows = await getSheet(STOCK_IN_REQUESTS_SHEET)
  return new Set(
    rows
      .filter((r) => (r.status || 'pending') === 'pending' && !isoDate(r.arrival_date))
      .map((r) => String(r.sku).toUpperCase())
  )
}

export async function computeLowStockList() {
  const { items } = await loadItemsWithBalance({ includeHidden: false })
  // fresh: true — กันตัวเลขไม่ตรงกับหน้าเว็บ Inventory.jsx (ดู comment ยาวบน computeSalesStats ใน
  // api/planner-sales.js) เพราะแจ้งเตือนบอสตรงๆ ผ่านไลน์ ถ้าหลุด/ไม่ตรงบ่อยๆ บอสจะเลิกเชื่อระบบ
  const salesData = await computeSalesStats(30, { fresh: true })
  const salesBySku = new Map((salesData.items || []).map((p) => [String(p.masterSku || '').toUpperCase(), p]))
  const openOrderSkus = await loadOpenOrderSkus()

  const baseSkuOf = (sku) => sku.replace(/-[A-Z]$/, '')
  const childrenByBase = new Map()
  for (const it of items) {
    const sku = String(it.sku).toUpperCase()
    if (salesBySku.has(sku)) continue
    const base = baseSkuOf(sku)
    if (base === sku || !salesBySku.has(base)) continue
    if (!childrenByBase.has(base)) childrenByBase.set(base, [])
    childrenByBase.get(base).push(it)
  }
  const allocatedSales = new Map()
  for (const [base, children] of childrenByBase) {
    const baseItem = items.find((it) => String(it.sku).toUpperCase() === base)
    const group = baseItem ? [baseItem, ...children] : children
    const baseSales = salesBySku.get(base)
    const totalBalance = group.reduce((s, it) => s + (it.balance || 0), 0)
    for (const it of group) {
      const share = totalBalance > 0 ? (it.balance || 0) / totalBalance : 1 / group.length
      allocatedSales.set(String(it.sku).toUpperCase(), { dailyAverage: Math.round(baseSales.dailyAverage * share * 10) / 10 })
    }
  }

  const lowItems = []
  for (const it of items) {
    if (!it.active || it.category === 'packaging') continue
    const sku = String(it.sku).toUpperCase()
    if (openOrderSkus.has(sku)) continue // สั่งของไปแล้ว รอของเข้าอยู่ — ไม่ต้องแจ้งซ้ำ
    const sales = salesBySku.get(sku) || allocatedSales.get(sku)
    const dailyAvg = sales?.dailyAverage || 0
    const leadTimeTotal = (it.lead_time_production || 0) + (it.lead_time_transport || 0)
    const computedSafety = calcSuggestedSafety(dailyAvg, leadTimeTotal, it.ship_freight)
    const effectiveSafety = computedSafety !== null ? computedSafety : it.safety_stock
    const effectiveStatus = statusOf(it.balance, effectiveSafety)
    if (effectiveStatus === 'ปกติ') continue
    const recommendedOrder = (dailyAvg && leadTimeTotal) ? calcRecommendedOrder(effectiveSafety, it.balance, dailyAvg, leadTimeTotal) : null
    lowItems.push({ sku: it.sku, display_name: it.display_name, unit: it.unit, balance: it.balance, effectiveStatus, recommendedOrder })
  }
  return lowItems
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
      order_group: body.order_group ? String(body.order_group).trim() : '',
      retail_price: num(body.retail_price),
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
    if (body.order_group !== undefined) row.order_group = String(body.order_group).trim()
    if (body.retail_price !== undefined) row.retail_price = num(body.retail_price)
    if (body.active !== undefined) row.active = body.active ? '1' : '0'
    row.updated_at = now
  }
  await overwriteSheet(ITEMS_SHEET, ITEMS_HEADERS, items.map((it) => ITEMS_HEADERS.map((h) => it[h] ?? '')))
  return { sku }
}

// boss กด "สั่งของ" (ปุ่มแยกจาก "แจ้งของเข้า" บนหน้า Stock Movement) — สร้างแถว pending ใหม่เสมอ
// ที่ arrival_date/count_date ว่างไว้ก่อน ("สั่งแล้ว รอของเข้า") แยกแถวต่อ 1 ลอตเสมอ (ไม่ทับของเดิม)
// เพื่อให้สั่งซ้อนหลายลอตพร้อมกันได้โดยไม่ทำลอตแรกหาย — เรียงคิว FIFO ตาม created_at ตอน match
// (ดู loadStockInRequests: available_orders)
export async function createOrderRequest(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่สั่งของได้')
  const sku = String(body.sku || '').trim()
  // จำนวนเป็น optional (เว้นว่าง/ไม่ใส่ = 0 = "ไม่ระบุจำนวน") — เผื่อคำสั่งซื้อเก่าก่อนเริ่มใช้ระบบที่มีแค่
  // วันที่สั่ง/สินค้า แต่ไม่มีบันทึกจำนวนไว้ ยังต้องลงเป็น "สั่งแล้ว" ได้เพื่อกันไม่ให้ cron แจ้งเตือนของใกล้หมด
  // ซ้ำ (ดู loadOpenOrderSkus/computeLowStockList) แม้จะไม่รู้จำนวนที่สั่งจริงก็ตาม — ยังกรอกจำนวนจริงได้เสมอ
  // ตอน match ของเข้า (matchStockInRequest ให้แก้ qty ได้อยู่แล้ว)
  const qtyRaw = body.qty === '' || body.qty === undefined || body.qty === null ? 0 : Number(body.qty)
  if (!sku) throw new Error('ต้องระบุสินค้า')
  if (!Number.isFinite(qtyRaw) || qtyRaw < 0) throw new Error('จำนวนไม่ถูกต้อง')
  const qty = qtyRaw

  await ensureInventorySheets()
  const items = await getSheet(ITEMS_SHEET)
  const item = items.find((it) => String(it.sku) === sku)
  if (!item) throw new Error('ไม่พบสินค้านี้ในระบบ')
  if (isPackagingItem(item)) throw new Error('วัสดุแพ็คเกจจิ้ง/กล่อง/พัสดุ ไม่อยู่ในรายการแจ้งของเข้า')

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
    order_date: isoDate(body.order_date) || todayBKK(),
  }
  await appendRows(STOCK_IN_REQUESTS_SHEET, [STOCK_IN_REQUESTS_HEADERS.map((h) => row[h] ?? '')])
  return row
}

// รายชื่อกลุ่ม order_group ทั้งหมด (ที่มีสินค้าติดแท็กจริง) พร้อม SKU ในกลุ่ม — ให้หน้าเว็บ/ไลน์เอาไปทำ
// ตัวเลือก "สั่งทั้งกลุ่ม" (ดู createOrderRequestForGroup ด้านล่าง) วัสดุแพ็คเกจจิ้ง/สินค้าที่ถูกซ่อนไม่นับ
export async function loadOrderGroups() {
  await ensureInventorySheets()
  const items = await getSheet(ITEMS_SHEET)
  const byGroup = new Map()
  for (const it of items) {
    if (isPackagingItem(it) || !truthyActive(it.active)) continue
    const group = String(it.order_group || '').trim()
    if (!group) continue
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push({ sku: it.sku, display_name: it.display_name, unit: it.unit || 'ชิ้น' })
  }
  return [...byGroup.entries()]
    .map(([group, groupItems]) => ({ group, items: groupItems }))
    .sort((a, b) => a.group.localeCompare(b.group, 'th'))
}

// เหมือน createOrderRequest แต่สั่งทีเดียวทั้งกลุ่ม (ทุก SKU ที่ติด order_group เดียวกัน) — จำนวนไม่ระบุ
// เสมอ (qty=0 เหมือนโหมด "ไม่ทราบจำนวน" ที่มีอยู่แล้ว) เพราะสั่ง 1 ครั้งแต่แต่ละไซส์/สีของจริงมาไม่เท่ากัน
// ต้องนับแยกตอน "แจ้งของเข้า"/match อยู่ดี — ตัวนี้แค่ลัดขั้นตอนตอน "สั่ง" ไม่ต้องเลือกทีละ SKU
export async function createOrderRequestForGroup(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่สั่งของได้')
  const group = String(body.group || '').trim()
  if (!group) throw new Error('ต้องระบุกลุ่มสินค้า')

  await ensureInventorySheets()
  const items = await getSheet(ITEMS_SHEET)
  const matched = items.filter((it) => !isPackagingItem(it) && truthyActive(it.active) && String(it.order_group || '').trim() === group)
  if (!matched.length) throw new Error('ไม่พบสินค้าในกลุ่มนี้')

  const now = new Date().toISOString()
  const orderDate = isoDate(body.order_date) || todayBKK()
  const rows = matched.map((it) => ({
    id: genId(),
    sku: it.sku,
    arrival_date: '',
    count_date: '',
    qty: 0,
    note: body.note || '',
    status: 'pending',
    created_by: actorName || '',
    created_at: now,
    order_date: orderDate,
  }))
  await appendRows(STOCK_IN_REQUESTS_SHEET, rows.map((row) => STOCK_IN_REQUESTS_HEADERS.map((h) => row[h] ?? '')))
  return { group, skus: matched.map((it) => it.sku), count: rows.length }
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
  const rowValues = MOVEMENTS_HEADERS.map((h) => row[h] ?? '')
  await appendRows(MOVEMENTS_SHEET, [rowValues])
  // verify-and-retry: updateMovement/deleteMovement ทำ read-modify-write ทับทั้งชีทนี้ (overwriteSheet) —
  // ถ้าจังหวะชนกับ append ตรงนี้พอดี (คนละ request เข้ามาพร้อมกัน) การ overwrite จะอ่าน snapshot เก่าที่ยัง
  // ไม่เห็นแถวที่เพิ่ง append แล้วเขียนทับ ลบแถวนี้หายไปเงียบๆ โดย appendRows ไม่ throw เลย — เจอจริงจากข้อมูล
  // production (ของเข้า approve ผ่าน LINE 12 รายการ หายไปช่วง 2026-08-01..05 แต่สถานะคำขอบอกว่า matched แล้ว)
  // เช็คย้อนกลับหลัง append ถ้าไม่เจอ ลองใหม่ (สูงสุด 2 ครั้ง)
  for (let attempt = 0; attempt < 2; attempt++) {
    const check = await getSheet(MOVEMENTS_SHEET)
    if (check.some((m) => m.id === row.id)) break
    await appendRows(MOVEMENTS_SHEET, [rowValues])
  }
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
export async function loadStockInRequests({ status, role } = {}) {
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
    linked_order_id: r.linked_order_id || '',
    order_date: isoDate(r.order_date),
    order_only: !isoDate(r.arrival_date),
  }))

  // FIFO เทียบลอต: ต่อ sku เดียวกัน เรียง "สั่งของ" (order_only) ที่ยัง pending ตาม created_at ก่อนหลัง
  // แปะเป็น available_orders ลงในแถว "แจ้งของเข้า" ทุกแถว (ไม่ใช่แค่แถวแรก) ให้ boss เลือกจับคู่เองตอน
  // match ได้ (ล็อตสลับมาก็เลือกลอตอื่นแทน suggest ได้) — suggested = ตัวแรกตามคิว FIFO เท่านั้น ไม่บังคับ
  // เห็นเฉพาะ boss/dev เพราะเป็นข้อมูลจำนวนที่สั่งไว้ล่วงหน้า (กัน blind count รั่ว เหมือน order_only เอง)
  if (!authEnabled() || canManageOperations(role)) {
    const openOrdersBySku = new Map()
    for (const r of out) {
      if (r.order_only && r.status === 'pending') {
        if (!openOrdersBySku.has(r.sku)) openOrdersBySku.set(r.sku, [])
        openOrdersBySku.get(r.sku).push(r)
      }
    }
    for (const list of openOrdersBySku.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    for (const r of out) {
      if (!r.order_only && r.status === 'pending') {
        const available = openOrdersBySku.get(r.sku) || []
        r.available_orders = available.map((o) => ({ id: o.id, qty: o.qty, note: o.note, created_by: o.created_by, created_at: o.created_at, order_date: o.order_date }))
      }
    }
  }

  if (status) out = out.filter((r) => r.status === status)
  if (authEnabled() && !canManageOperations(role)) out = out.filter((r) => !r.order_only)
  out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return out
}

// อ่านแถวเดียวตรงๆ ด้วย id — ใช้ตอนสร้างเมนูแก้ไข (LINE 1:1) ที่ต้องรู้ sku/qty/วันที่เดิมก่อนถาม
export async function getStockInRequestById(id) {
  await ensureInventorySheets()
  const requests = await getSheet(STOCK_IN_REQUESTS_SHEET)
  return requests.find((r) => String(r.id) === String(id)) || null
}

export async function addStockInRequest(body, actorName) {
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
// order_request_id (ไม่บังคับ) — ถ้า boss เลือกจับคู่กับลอต "สั่งของ" ที่ค้างอยู่ (ดู available_orders
// จาก loadStockInRequests) ปิดลอตนั้นให้เป็น matched ในคำสั่งเดียวกันเลย ไม่ต้องกด "เสร็จสิ้น" แยกอีกที
// ฟ้าแจ้งของเข้าได้ตามปกติแม้พี่หยกยังไม่ได้กด "สั่งของ" ไว้ในระบบ (ไม่มีลอตให้เลือกก็ match เดี่ยวๆ ได้)
export async function matchStockInRequest(body, actorName, role) {
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

  const orderRequestId = String(body.order_request_id || '').trim()
  let orderIdx = -1
  if (orderRequestId) {
    orderIdx = requests.findIndex((r) => String(r.id) === orderRequestId)
    if (orderIdx === -1) throw new Error('ไม่พบลอตที่สั่งไว้นี้')
    const orderReq = requests[orderIdx]
    if (orderReq.status !== 'pending' || isoDate(orderReq.arrival_date)) throw new Error('ลอตนี้ไม่ใช่รายการสั่งของที่รอ match')
    if (String(orderReq.sku) !== String(req.sku)) throw new Error('ลอตที่เลือกไม่ตรงกับสินค้านี้')
  }

  const movement = await addMovement({
    sku: req.sku,
    type: 'in',
    qty,
    date: req.count_date || req.arrival_date,
    note: body.note || `รับเข้าจากคำขอของ ${req.created_by || '-'}${req.note ? ` — ${req.note}` : ''}`,
  }, actorName)

  const now = new Date().toISOString()
  requests[idx] = { ...req, status: 'matched', matched_by: actorName || '', matched_at: now, movement_id: movement.id, linked_order_id: orderRequestId }
  if (orderIdx !== -1) {
    requests[orderIdx] = { ...requests[orderIdx], status: 'matched', matched_by: actorName || '', matched_at: now, movement_id: movement.id }
  }
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return requests[idx]
}

export async function rejectStockInRequest(body, actorName, role) {
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

// ย้อนกลับ approve/ปฏิเสธที่กดพลาดใน LINE (owner ขอ 2026-08-11 คู่กับบั๊ก race condition ที่เจอ) — boss/dev
// เท่านั้น matched: ไม่ลบ movement เดิม (ประวัติต้องอยู่ตามธรรมเนียมไฟล์นี้ทั้งไฟล์) แต่สร้าง adjust ย้อนยอด
// แทน แล้ว reset คำขอกลับเป็น pending ให้ approve/ปฏิเสธใหม่ได้ถูกต้อง — ถ้าเคยผูกลอต "สั่งของ" ไว้ตอน match
// ด้วย ปลดลอตนั้นกลับ pending เช่นกัน (ไม่งั้นลอตค้าง matched ทั้งที่ของจริงถูกย้อนกลับไปแล้ว)
// rejected: แค่ reset สถานะกลับ pending เฉยๆ (ไม่เคยมี movement ให้ย้อน)
export async function undoStockInDecision(body, actorName, role) {
  if (authEnabled() && !canManageOperations(role)) throw new Error('เฉพาะ Boss หรือ Dev เท่านั้นที่ย้อนกลับได้')
  const id = String(body.id || '').trim()
  if (!id) throw new Error('ต้องระบุ id')

  await ensureInventorySheets()
  const requests = await getSheet(STOCK_IN_REQUESTS_SHEET)
  const idx = requests.findIndex((r) => String(r.id) === id)
  if (idx === -1) throw new Error('ไม่พบคำขอนี้')
  const req = requests[idx]
  if (req.status !== 'matched' && req.status !== 'rejected') throw new Error('ย้อนกลับได้เฉพาะรายการที่ approve หรือปฏิเสธไปแล้ว')

  if (req.status === 'matched' && req.movement_id) {
    await addMovement({
      sku: req.sku, type: 'adjust', qty: -Math.abs(num(req.qty)),
      date: todayBKK(), note: `ย้อนกลับ approve ที่กดพลาด (คำขอ ${id} · movement เดิม ${req.movement_id})`,
    }, actorName)
  }

  const now = new Date().toISOString()
  requests[idx] = { ...req, status: 'pending', matched_by: '', matched_at: '', movement_id: '', reject_reason: '', linked_order_id: '' }
  if (req.linked_order_id) {
    const orderIdx = requests.findIndex((r) => String(r.id) === String(req.linked_order_id))
    if (orderIdx !== -1) requests[orderIdx] = { ...requests[orderIdx], status: 'pending', matched_by: '', matched_at: '', movement_id: '' }
  }
  await overwriteSheet(STOCK_IN_REQUESTS_SHEET, STOCK_IN_REQUESTS_HEADERS, requests.map((r) => STOCK_IN_REQUESTS_HEADERS.map((h) => r[h] ?? '')))
  return { ...requests[idx], undone_from_status: req.status }
}

// ฟ้าแก้ไขคำขอที่ถูกปฏิเสธแล้วส่งกลับเข้าคิวรอ match ใหม่ (ไม่ต้องพิมพ์แจ้งของเข้าใหม่ทั้งหมด)
// หรือแก้ไขคำขอที่ยัง pending อยู่ — กรณีนี้ใช้ตอนพี่หยกสั่งของไว้ก่อน (ยังไม่มีวันของเข้า/วันนับ)
// แล้วฟ้ามากรอกวันที่จริงทีหลังตอนของมาถึง
export async function editStockInRequest(body, actorName, role) {
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
  // แถว "สั่งของ" (order_only ก่อนแก้ไข ยังไม่มี arrival_date) จำนวนเป็น optional เหมือน createOrderRequest —
  // เผื่อแก้ไขคำสั่งซื้อเก่าที่ไม่รู้จำนวนจริง ส่วนแถว "แจ้งของเข้า" จริง (มี arrival_date) ยังต้องระบุจำนวนเสมอ
  // เพราะเป็นยอดนับจริงที่จะสร้าง stock_movements
  const isOrderOnly = !requests[idx].arrival_date
  const qtyRaw = body.qty === '' || body.qty === undefined || body.qty === null ? (isOrderOnly ? 0 : NaN) : Number(body.qty)
  if (isOrderOnly) {
    if (!Number.isFinite(qtyRaw) || qtyRaw < 0) throw new Error('จำนวนไม่ถูกต้อง')
  } else {
    if (!Number.isFinite(qtyRaw) || qtyRaw <= 0) throw new Error('ต้องระบุจำนวน')
  }
  const qty = qtyRaw
  if (!items.some((it) => String(it.sku) === sku)) throw new Error('ไม่พบสินค้านี้ในระบบ')

  requests[idx] = {
    ...requests[idx],
    sku,
    qty,
    arrival_date: isoDate(body.arrival_date) || requests[idx].arrival_date,
    count_date: body.count_date !== undefined ? (isoDate(body.count_date) || '') : requests[idx].count_date,
    order_date: body.order_date !== undefined ? (isoDate(body.order_date) || requests[idx].order_date) : requests[idx].order_date,
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
      if (view === 'order-groups') {
        const groups = await loadOrderGroups()
        return res.status(200).json({ success: true, groups })
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
      if (action === 'create-order-request-group') {
        const result = await createOrderRequestForGroup(req.body, actorName, role)
        return res.status(200).json({ success: true, ...result })
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
