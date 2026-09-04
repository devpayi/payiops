// GET/POST /api/sheet-tools?op=import-tracking
// ติดตามนำเข้าจากจีน — 2 ระดับ:
//   1) "ของเข้า" (import_arrivals) — ราย sku, มาถึงแยกกัน, ได้ใบชมพู (pink_slip) = ของถึงครบแล้ว
//   2) "ลอต" (import_lots) — รวมของเข้า ~4-5 อย่างเข้าด้วยกัน เพื่อทำใบขน 1 ครั้ง
//      ค่าบริการ LK ตายตัว 3,900 หารกับจำนวนชิ้นรวมของลอต = ถัวเฉลี่ยต่อชิ้น
//      proforma invoice + packing list ทำตอนนี้ (กดได้ตลอด ระบบเตือนถ้าของยังไม่ครบใบชมพู)
// หน้านี้เปิดให้ dev + boss เท่านั้น (gate อยู่ที่ sheet-tools.js)
//
// ⚠️ ทุก sheet ต้อง <= 26 คอลัมน์ (A:Z) — helper sheets.js อ่าน/เขียนแค่ A:Z
// เวอร์ชันก่อน ๆ ใช้ `import_tracking` แล้ว `import_lots`/`import_lot_items` — sheet เก่าไม่ถูกอ่านแล้ว
import { getSheet, overwriteSheet, ensureSheet, getExternalSheet } from './sheets.js'
import { isoDate } from './dates.js'

// ── ชีท LK (Lively Kingdom Import) — ดึง carton/น้ำหนัก/ขนาด ตามเลข SHIPPING บนใบชมพู ──
/* global process */
const LK_SHEET_ID = process.env.LK_SHEET_ID || ''
const LK_CODE = 'LK-PAYI-SALES'
const LK_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
// index คอลัมน์ (0-based): C=2 เลขเข้าคลัง(base-n) · D=3 CTN · G=6 code · H=7 ชื่อจีน ·
//   K=10 BOX · L=11 จำนวน · M=12 นน./กล่อง · N=13 นน.รวม · O=14 ยาว · P=15 กว้าง · Q=16 สูง · R=17 ปริมาตร · V=21 เข้าไทยโดยประมาณ
function lkTabsToTry(dateStr) {
  const now = new Date()
  const d = dateStr ? new Date(dateStr) : now
  const out = []
  for (let k = 0; k < 4; k++) {
    const t = new Date(d.getFullYear(), d.getMonth() - k, 1)
    out.push(`${LK_MONTHS[t.getMonth()]}${t.getFullYear()}`)
  }
  // เผื่อ arrive_date ใหม่กว่าปัจจุบัน
  const nx = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  out.unshift(`${LK_MONTHS[nx.getMonth()]}${nx.getFullYear()}`)
  return [...new Set(out)]
}

async function lkLookup(shippingNo, dateHint) {
  const key = String(shippingNo || '').trim()
  if (!key) throw new Error('ต้องระบุเลข SHIPPING')
  if (!LK_SHEET_ID) throw new Error('ยังไม่ตั้งค่า LK_SHEET_ID')
  for (const tab of lkTabsToTry(dateHint)) {
    let rows
    try {
      rows = await getExternalSheet(LK_SHEET_ID, `${tab}!A:V`)
    } catch { continue }
    if (!rows || !rows.length) continue
    const hits = rows.filter((r) =>
      String(r[6] || '').trim() === LK_CODE &&
      String(r[2] || '').trim().split('-')[0] === key)
    if (!hits.length) continue
    const nz = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
    const cartons = hits.map((r) => ({
      l: nz(r[14]), w: nz(r[15]), h: nz(r[16]), wt: nz(r[12]), box: nz(r[10]) || 1,
    }))
    return {
      found: true, tab,
      goods_zh: hits[0][7] || '',
      ctn_no: hits[0][3] || '',
      est_arrival: hits[0][21] || '',
      box_count: cartons.reduce((s, c) => s + c.box, 0),
      qty: hits.reduce((s, r) => s + nz(r[11]), 0),
      weight_kg: Math.round(hits.reduce((s, r) => s + (nz(r[13]) || nz(r[12])), 0) * 100) / 100,
      cbm: Math.round(hits.reduce((s, r) => s + nz(r[17]), 0) * 1000) / 1000,
      cartons,
    }
  }
  return { found: false }
}

const ARRIVALS = 'import_arrivals'
const LOTS = 'import_lots'

// ต่อท้ายเท่านั้น (ห้ามแทรกกลาง)
const ARRIVAL_HEADERS = [
  'id', 'sku', 'item_name', 'codename',
  'ctn_no', 'shipping_no', 'invoice_no',
  'box_count', 'qty', 'weight_kg', 'cbm',
  'arrive_date', 'pink_slip', 'pink_slip_date',
  'lot_id', 'note', 'created_at', 'updated_at',
]
const LOT_HEADERS = [
  'id', 'lot_ref', 'stage', 'order_date',
  'customs_no', 'customs_no_draft',
  'service_fee', 'advance_vat', 'other_fee',
  'docs', 'handover', 'proforma_done',
  'note', 'created_at', 'updated_at',
]

// ลอต: รวมของ -> ทำ proforma -> LK ยื่นใบขนดราฟ -> จ่ายเงิน+ออกใบหัก ณ ที่จ่าย ->
//      ใบขนใช้จริง -> เอกสารครบ -> ส่งต่อ (บัญชี/LK/แฟ้ม) -> ปิดลอต
export const STAGES = [
  'draft', 'proforma', 'customs_filed', 'paid', 'customs_done', 'docs_done', 'handed_over', 'closed',
]
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i]))

const DOC_FIELDS = ['draft_doc', 'customs_draft', 'customs_actual', 'tax_invoice', 'withholding_tax', 'advance_payment_doc']
const HANDOVER_FIELDS = ['sent_accounting', 'sent_lk', 'printed']
const WHT_RATE = 0.03

const ARRIVAL_TEXT = ['sku', 'item_name', 'codename', 'ctn_no', 'shipping_no', 'invoice_no', 'note']
const ARRIVAL_NUM = ['box_count', 'qty', 'weight_kg', 'cbm']
const LOT_TEXT = ['lot_ref', 'customs_no', 'customs_no_draft', 'note']
const LOT_NUM = ['service_fee', 'advance_vat', 'other_fee']

const DEFAULT_SERVICE_FEE = 3900
const LOT_TARGET = 5 // แนะนำให้ 1 ลอตมีของ ~5 อย่าง

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
const bool = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'
const genId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const todayBKK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const csvToSet = (v) => new Set(String(v || '').split(',').map((s) => s.trim()).filter(Boolean))
const setToCsv = (set, allowed) => allowed.filter((f) => set.has(f)).join(',')

let ensurePromise
const ensureAll = () => (ensurePromise ||= Promise.all([
  ensureSheet(ARRIVALS, ARRIVAL_HEADERS),
  ensureSheet(LOTS, LOT_HEADERS),
]))

function shapeArrival(r) {
  const out = { id: r.id }
  for (const f of ARRIVAL_TEXT) out[f] = r[f] || ''
  for (const f of ARRIVAL_NUM) out[f] = numOrNull(r[f])
  out.arrive_date = isoDate(r.arrive_date) || ''
  out.pink_slip = bool(r.pink_slip)
  out.pink_slip_date = isoDate(r.pink_slip_date) || ''
  out.lot_id = r.lot_id || ''
  out.created_at = r.created_at || ''
  out.updated_at = r.updated_at || ''
  out.lk_missing = String(r.note || '').includes('ไม่เจอในชีท LK')
  out.needs_review = !out.sku || out.lk_missing || out.qty == null
  return out
}

function shapeLot(r, arrivals) {
  const out = { id: r.id }
  for (const f of LOT_TEXT) out[f] = r[f] || ''
  for (const f of LOT_NUM) out[f] = numOrNull(r[f])
  out.order_date = isoDate(r.order_date) || ''
  out.proforma_done = bool(r.proforma_done)
  const docSet = csvToSet(r.docs)
  const handSet = csvToSet(r.handover)
  for (const f of DOC_FIELDS) out[f] = docSet.has(f)
  for (const f of HANDOVER_FIELDS) out[f] = handSet.has(f)
  out.stage = STAGE_INDEX[r.stage] !== undefined ? r.stage : 'draft'
  out.stage_index = STAGE_INDEX[out.stage]
  out.created_at = r.created_at || ''
  out.updated_at = r.updated_at || ''

  out.arrivals = arrivals
  out.arrival_count = arrivals.length
  out.box_count = arrivals.reduce((s, a) => s + num(a.box_count), 0)
  out.qty_total = arrivals.reduce((s, a) => s + num(a.qty), 0)
  out.weight_kg = Math.round(arrivals.reduce((s, a) => s + num(a.weight_kg), 0) * 100) / 100
  out.cbm = Math.round(arrivals.reduce((s, a) => s + num(a.cbm), 0) * 1000) / 1000
  out.all_pink_slip = arrivals.length > 0 && arrivals.every((a) => a.pink_slip)

  out.docs_done = DOC_FIELDS.filter((f) => out[f]).length
  out.docs_total = DOC_FIELDS.length
  out.handover_done = HANDOVER_FIELDS.filter((f) => out[f]).length
  out.wht_amount = num(r.service_fee) ? Math.round(num(r.service_fee) * WHT_RATE) : null
  const importCost = num(r.service_fee) + num(r.advance_vat) + num(r.other_fee)
  out.import_cost_total = importCost || null
  out.cost_per_pc = importCost && out.qty_total ? importCost / out.qty_total : null
  return out
}

async function loadAll() {
  await ensureAll()
  const [arrRows, lotRows] = await Promise.all([getSheet(ARRIVALS), getSheet(LOTS)])
  const arrivals = arrRows.filter((r) => r.id).map(shapeArrival)
  const byLot = new Map()
  for (const a of arrivals) {
    if (!a.lot_id) continue
    if (!byLot.has(a.lot_id)) byLot.set(a.lot_id, [])
    byLot.get(a.lot_id).push(a)
  }
  const lots = lotRows.filter((r) => r.id).map((r) => shapeLot(r, byLot.get(r.id) || []))
  lots.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  arrivals.sort((a, b) => String(b.arrive_date || b.created_at).localeCompare(String(a.arrive_date || a.created_at)))

  const unassigned = arrivals.filter((a) => !a.lot_id)
  const readyToLot = unassigned.filter((a) => a.pink_slip)

  const totals = {
    arrivalsWaitingPink: arrivals.filter((a) => !a.pink_slip && !a.lot_id).length,
    readyToLot: readyToLot.length,
    lotTarget: LOT_TARGET,
    canSuggestLot: readyToLot.length >= LOT_TARGET,
    lots: lots.length,
    pendingDocs: lots.filter((l) => l.stage !== 'closed' && l.docs_done < l.docs_total).length,
    lkMissing: unassigned.filter((a) => a.lk_missing).length,
  }
  return { arrivals, unassigned, lots, totals, stages: STAGES }
}

// ---------- writes ----------

async function upsertArrival(body) {
  await ensureAll()
  const rows = await getSheet(ARRIVALS)
  const now = new Date().toISOString()
  const id = String(body.id || '').trim()

  const apply = (row) => {
    for (const f of ARRIVAL_TEXT) if (body[f] !== undefined) row[f] = String(body[f] ?? '')
    for (const f of ARRIVAL_NUM) if (body[f] !== undefined) row[f] = body[f] === '' || body[f] === null ? '' : num(body[f])
    if (body.arrive_date !== undefined) row.arrive_date = isoDate(body.arrive_date) || ''
    if (body.lot_id !== undefined) row.lot_id = String(body.lot_id || '')
    if (body.pink_slip !== undefined) {
      const on = bool(body.pink_slip)
      row.pink_slip = on ? '1' : '0'
      row.pink_slip_date = on ? (isoDate(body.pink_slip_date) || row.pink_slip_date || todayBKK()) : ''
    }
    return row
  }

  let outId
  if (!id) {
    if (!String(body.item_name || '').trim()) throw new Error('ต้องระบุชื่อสินค้า')
    const row = {}
    for (const h of ARRIVAL_HEADERS) row[h] = ''
    row.id = genId('arr')
    apply(row)
    row.created_at = now
    row.updated_at = now
    rows.push(row)
    outId = row.id
  } else {
    const idx = rows.findIndex((r) => String(r.id) === id)
    if (idx === -1) throw new Error('ไม่พบรายการของเข้านี้')
    apply(rows[idx])
    rows[idx].updated_at = now
    outId = id
  }
  await overwriteSheet(ARRIVALS, ARRIVAL_HEADERS, rows.map((r) => ARRIVAL_HEADERS.map((h) => r[h] ?? '')))
  return { id: outId }
}

// LINE "ชมพู <เลข SHIPPING> ..." — สร้าง import_arrival จากเลขหลายตัวในครั้งเดียว (อ่าน/เขียนชีทรอบเดียว)
// เจอในชีท LK -> เติมกล่อง/นน./ขนาด/ชื่อจีน ให้ ; ไม่เจอ -> สร้างแถวมีแค่ shipping_no + ธงให้กรอกมือ
// กันซ้ำด้วย shipping_no (มีอยู่แล้ว = ข้าม). ไม่ throw ทั้งฟังก์ชัน — ให้ webhook เงียบเสมอ
export async function createArrivalsFromShipping(shippingNos, dateHint) {
  await ensureAll()
  const rows = await getSheet(ARRIVALS)
  const existing = new Set(rows.filter((r) => r.id).map((r) => String(r.shipping_no || '').trim()).filter(Boolean))
  const now = new Date().toISOString()
  const today = todayBKK()
  const added = []
  for (const raw of shippingNos || []) {
    const s = String(raw || '').trim()
    if (!s || existing.has(s)) continue
    existing.add(s)
    let lk
    try { lk = await lkLookup(s, dateHint) } catch { lk = { found: false } }
    const row = {}
    for (const h of ARRIVAL_HEADERS) row[h] = ''
    Object.assign(row, {
      id: genId('arr'), shipping_no: s,
      pink_slip: '1', pink_slip_date: today, arrive_date: today,
      created_at: now, updated_at: now,
    })
    if (lk.found) {
      row.ctn_no = lk.ctn_no || ''
      row.item_name = lk.goods_zh || `SHIPPING ${s}`
      row.box_count = lk.box_count || ''
      row.qty = lk.qty || ''
      row.weight_kg = lk.weight_kg || ''
      row.cbm = lk.cbm || ''
      row.note = `LK ${lk.tab}: ${lk.goods_zh || ''}`.trim()
    } else {
      row.item_name = `SHIPPING ${s}`
      row.note = `⚠ ไม่เจอในชีท LK (จากไลน์ ${today}) — เช็คเลขในกลุ่มไลน์อีกที / กรอกมือ`
    }
    rows.push(row)
    added.push({ shipping_no: s, found: !!lk.found })
  }
  if (added.length) {
    await overwriteSheet(ARRIVALS, ARRIVAL_HEADERS, rows.map((r) => ARRIVAL_HEADERS.map((h) => r[h] ?? '')))
  }
  return { added, total: (shippingNos || []).length }
}

async function deleteArrival(id) {
  if (!id) throw new Error('ต้องระบุ id')
  await ensureAll()
  const rows = await getSheet(ARRIVALS)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('ไม่พบรายการนี้')
  await overwriteSheet(ARRIVALS, ARRIVAL_HEADERS, next.map((r) => ARRIVAL_HEADERS.map((h) => r[h] ?? '')))
  return { id }
}

// ย้ายของเข้าเข้า/ออกจากลอต (lot_id ว่าง = เอาออก)
async function assignArrivals(arrivalIds, lotId) {
  await ensureAll()
  const ids = new Set((arrivalIds || []).map(String))
  if (!ids.size) throw new Error('ต้องระบุ arrival_ids')
  const rows = await getSheet(ARRIVALS)
  const now = new Date().toISOString()
  let hit = 0
  for (const r of rows) {
    if (ids.has(String(r.id))) { r.lot_id = String(lotId || ''); r.updated_at = now; hit++ }
  }
  if (!hit) throw new Error('ไม่พบรายการของเข้า')
  await overwriteSheet(ARRIVALS, ARRIVAL_HEADERS, rows.map((r) => ARRIVAL_HEADERS.map((h) => r[h] ?? '')))
  return { assigned: hit, lot_id: lotId || '' }
}

function applyLotFields(row, body) {
  for (const f of LOT_TEXT) if (body[f] !== undefined) row[f] = String(body[f] ?? '')
  for (const f of LOT_NUM) if (body[f] !== undefined) row[f] = body[f] === '' || body[f] === null ? '' : num(body[f])
  if (body.order_date !== undefined) row.order_date = isoDate(body.order_date) || ''
  if (body.proforma_done !== undefined) row.proforma_done = bool(body.proforma_done) ? '1' : '0'
  if (DOC_FIELDS.some((f) => body[f] !== undefined)) {
    const set = csvToSet(row.docs)
    for (const f of DOC_FIELDS) if (body[f] !== undefined) (bool(body[f]) ? set.add(f) : set.delete(f))
    row.docs = setToCsv(set, DOC_FIELDS)
  }
  if (HANDOVER_FIELDS.some((f) => body[f] !== undefined)) {
    const set = csvToSet(row.handover)
    for (const f of HANDOVER_FIELDS) if (body[f] !== undefined) (bool(body[f]) ? set.add(f) : set.delete(f))
    row.handover = setToCsv(set, HANDOVER_FIELDS)
  }
  if (body.stage !== undefined && STAGE_INDEX[body.stage] !== undefined) row.stage = body.stage
  return row
}

async function upsertLot(body) {
  await ensureAll()
  const rows = await getSheet(LOTS)
  const now = new Date().toISOString()
  const id = String(body.id || '').trim()

  let lotId
  if (!id) {
    const row = {}
    for (const h of LOT_HEADERS) row[h] = ''
    row.id = genId('lot')
    row.stage = 'draft'
    row.service_fee = DEFAULT_SERVICE_FEE
    row.order_date = todayBKK()
    applyLotFields(row, body)
    row.created_at = now
    row.updated_at = now
    rows.push(row)
    lotId = row.id
  } else {
    const idx = rows.findIndex((r) => String(r.id) === id)
    if (idx === -1) throw new Error('ไม่พบลอตนี้')
    applyLotFields(rows[idx], body)
    rows[idx].updated_at = now
    lotId = id
  }
  await overwriteSheet(LOTS, LOT_HEADERS, rows.map((r) => LOT_HEADERS.map((h) => r[h] ?? '')))

  if (Array.isArray(body.arrival_ids) && body.arrival_ids.length) {
    await assignArrivals(body.arrival_ids, lotId)
  }
  return { id: lotId }
}

async function deleteLot(id) {
  if (!id) throw new Error('ต้องระบุ id')
  await ensureAll()
  const [lotRows, arrRows] = await Promise.all([getSheet(LOTS), getSheet(ARRIVALS)])
  const nextLots = lotRows.filter((r) => String(r.id) !== String(id))
  if (nextLots.length === lotRows.length) throw new Error('ไม่พบลอตนี้')
  // ปลดของเข้าออกจากลอต (ไม่ลบของเข้า — กลับไปอยู่คิว "รอจัดลอต")
  let changed = false
  for (const r of arrRows) if (String(r.lot_id) === String(id)) { r.lot_id = ''; changed = true }
  await overwriteSheet(LOTS, LOT_HEADERS, nextLots.map((r) => LOT_HEADERS.map((h) => r[h] ?? '')))
  if (changed) await overwriteSheet(ARRIVALS, ARRIVAL_HEADERS, arrRows.map((r) => ARRIVAL_HEADERS.map((h) => r[h] ?? '')))
  return { id }
}

export default async function opImportTracking(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query?.view === 'lk-lookup') {
        return res.status(200).json({ success: true, ...(await lkLookup(req.query.shipping_no, req.query.date)) })
      }
      return res.status(200).json({ success: true, ...(await loadAll()) })
    }
    if (req.method === 'POST') {
      const action = String(req.body?.action || '')
      const map = {
        'upsert-arrival': () => upsertArrival(req.body),
        'delete-arrival': () => deleteArrival(req.body?.id),
        'assign-arrivals': () => assignArrivals(req.body?.arrival_ids, req.body?.lot_id),
        'upsert-lot': () => upsertLot(req.body),
        'delete-lot': () => deleteLot(req.body?.id),
      }
      if (!map[action]) return res.status(400).json({ success: false, error: 'action ไม่ถูกต้อง' })
      return res.status(200).json({ success: true, ...(await map[action]()) })
    }
    return res.status(405).json({ success: false, error: 'method not allowed' })
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message })
  }
}
