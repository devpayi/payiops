// GET/POST /api/sheet-tools?op=inventory&view=items|movements
// สต็อกสินค้า — คงเหลือคำนวณสด (opening_balance + sum(stock_movements)) ไม่เก็บเลขนิ่งๆ
// เพื่อกันเพี้ยนแบบไฟล์ Excel เดิม (คงเหลือแยกชีตต้องพิมพ์เชื่อมมือทุกเดือน)
// นับสต็อกระดับ SKU จริง (master_sku) ไม่ใช่ product-family group — M/L/สี คือของคนละถังจริง
// ต้องแยกนับ ไม่รวมแบบ deriveGroup ที่ใช้กับหน้า Products/Claims (นั่นไว้แค่ดูภาพรวมยอดขาย)
import { getSheet, appendRows, overwriteSheet, ensureSheet } from './sheets.js'
import { isoDate } from './dates.js'
import { getSkuRedirectMap, resolveRedirect } from './skuMapping.js'

const ITEMS_SHEET = 'inventory_items'
const MOVEMENTS_SHEET = 'stock_movements'
// ต่อท้ายรายการเดิมเท่านั้น (ห้ามแทรกกลาง) — แถวเดิมใน Sheet อิงตำแหน่งคอลัมน์เดิมอยู่ เหมือน claims sheet
const ITEMS_HEADERS = ['sku', 'display_name', 'unit', 'safety_stock', 'opening_balance', 'opening_date', 'active', 'created_at', 'updated_at', 'reorder_date', 'expected_arrival', 'lead_time_production', 'lead_time_transport', 'ship_freight', 'reorder_qty', 'reorder_note', 'category', 'units_per_batch']
// category: '' หรือ 'product' = สินค้าขาย (ของเดิม), 'packaging' = วัสดุแพ็คเกจจิ้ง/สิ้นเปลือง (สติกเกอร์/กล่อง —
// เดิมอยู่ในชีท Excel "Something" แยกต่างหาก ไม่มี dailyAverage จากยอดขายลูกค้าเหมือนสินค้าจริง เพราะใช้ตามการผลิตไม่ใช่ตามออเดอร์
// units_per_batch: เฉพาะ category=packaging — 1 แผ่น/แพ็คมีกี่ชิ้น ไว้แปลงยอดใช้ (ชิ้น) เป็นจุดสั่งซื้อ (แผ่น/แพ็ค)
// ผ่าน packaging_recipes (ดูด้านล่าง)
const MOVEMENTS_HEADERS = ['id', 'date', 'sku', 'type', 'qty', 'note', 'created_by', 'created_at']
const MOVEMENT_TYPES = new Set(['in', 'out', 'adjust'])

// เชื่อมวัสดุแพ็คเกจจิ้งกับสินค้าที่ใช้มันจริง — 1 แถวต่อ 1 คู่ (วัสดุ, สินค้า) เพื่อเอายอดขาย
// เฉลี่ยของสินค้ามาคำนวณว่าวัสดุควรสั่งเพิ่มเท่าไหร่ (เหมือน pattern set_recipes ที่ planner-sales.js ใช้)
const PACKAGING_RECIPES_SHEET = 'packaging_recipes'
const PACKAGING_RECIPES_HEADERS = ['packaging_sku', 'product_sku', 'qty_per_unit', 'created_at']

let ensurePromise
const ensureInventorySheets = () => ensurePromise ||= Promise.all([
  ensureSheet(ITEMS_SHEET, ITEMS_HEADERS),
  ensureSheet(MOVEMENTS_SHEET, MOVEMENTS_HEADERS),
  ensureSheet(PACKAGING_RECIPES_SHEET, PACKAGING_RECIPES_HEADERS),
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
    if (body.active !== undefined) row.active = body.active ? '1' : '0'
    row.updated_at = now
  }
  await overwriteSheet(ITEMS_SHEET, ITEMS_HEADERS, items.map((it) => ITEMS_HEADERS.map((h) => it[h] ?? '')))
  return { sku }
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
    const actorName = req.user?.display_name || req.user?.username || ''

    if (req.method === 'GET') {
      const view = String(req.query.view || 'items')
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
