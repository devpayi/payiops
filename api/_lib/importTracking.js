// GET/POST /api/sheet-tools?op=import-tracking
// ติดตามสถานะของนำเข้าจากจีน — ไม่แทรคเงิน/ต้นทุนใดๆ แค่ตามสถานะเอกสาร + ส่งต่องาน
// (ตัดออกจากเวอร์ชันแรกที่คำนวณต้นทุนต่อชิ้น ตามที่เจ้าของขอ "ลบที่เกี่ยวกับเงินทั้งหมด")
import { getSheet, appendRows, overwriteSheet, ensureSheet } from './sheets.js'
import { isoDate } from './dates.js'

const SHEET = 'import_tracking'
// ต่อท้ายเท่านั้น (ห้ามแทรกกลาง) — เหมือนกติกา inventory_items/claims
const HEADERS = [
  'id', 'date', 'item_name', 'sku', 'qty',
  'bill_no', 'customs_no', 'tracking_no',
  'draft_doc', 'customs_draft', 'customs_actual', 'tax_invoice', 'withholding_tax', 'accounting_notice',
  'sent_accounting', 'sent_joy', 'printed',
  'note',
  'created_by', 'created_at', 'updated_at',
]
const CHECKBOX_FIELDS = [
  'draft_doc', 'customs_draft', 'customs_actual', 'tax_invoice', 'withholding_tax', 'accounting_notice',
  'sent_accounting', 'sent_joy', 'printed',
]
const NUM_FIELDS = ['qty']
const TEXT_FIELDS = ['item_name', 'sku', 'bill_no', 'customs_no', 'tracking_no', 'note']

let ensurePromise
const ensureImportTrackingSheet = () => ensurePromise ||= ensureSheet(SHEET, HEADERS)

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const bool = (v) => v === true || v === '1' || String(v).toLowerCase() === 'true'
const genId = () => `it-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const todayBKK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

// เอกสาร: ใบดราฟ / ใบขน(ดราฟ) / ใบขน(จริง) / ใบกำกับภาษี / หัก ณ ที่จ่าย / ใบทักบัญชี — 6 จุด
function docStatus(row) {
  const need = ['draft_doc', 'customs_draft', 'customs_actual', 'tax_invoice', 'withholding_tax', 'accounting_notice']
  const done = need.filter((f) => bool(row[f])).length
  if (done === need.length) return 'ครบ'
  if (done === 0) return 'ยังไม่เริ่ม'
  return 'ค้าง'
}

async function loadOrders() {
  await ensureImportTrackingSheet()
  const rows = await getSheet(SHEET)
  const items = rows.filter((r) => r.id).map((r) => {
    const out = { id: r.id, date: isoDate(r.date) }
    for (const f of TEXT_FIELDS) out[f] = r[f] || ''
    for (const f of NUM_FIELDS) out[f] = num(r[f])
    for (const f of CHECKBOX_FIELDS) out[f] = bool(r[f])
    out.created_by = r.created_by || ''
    out.created_at = r.created_at || ''
    out.updated_at = r.updated_at || ''
    out.docStatus = docStatus(out)
    return out
  })
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)))

  const totals = {
    totalOrders: items.length,
    pendingDocs: items.filter((r) => r.docStatus !== 'ครบ').length,
    pendingHandover: items.filter((r) => !r.sent_accounting || !r.sent_joy).length,
  }
  return { items, totals }
}

async function upsertOrder(body, actorName) {
  const id = String(body.id || '').trim()
  await ensureImportTrackingSheet()
  const rows = await getSheet(SHEET)
  const now = new Date().toISOString()

  const fieldsIn = (row) => {
    for (const f of TEXT_FIELDS) {
      if (body[f] !== undefined) row[f] = body[f]
    }
    for (const f of NUM_FIELDS) {
      if (body[f] !== undefined) row[f] = num(body[f])
    }
    for (const f of CHECKBOX_FIELDS) {
      if (body[f] !== undefined) row[f] = body[f] ? '1' : '0'
    }
    if (body.date !== undefined) row.date = isoDate(body.date) || todayBKK()
    return row
  }

  if (!id) {
    if (!String(body.item_name || '').trim()) throw new Error('ต้องระบุชื่อสินค้า')
    const row = fieldsIn({ id: genId(), date: todayBKK() })
    for (const f of NUM_FIELDS) if (row[f] === undefined) row[f] = 0
    for (const f of CHECKBOX_FIELDS) if (row[f] === undefined) row[f] = '0'
    for (const f of TEXT_FIELDS) if (row[f] === undefined) row[f] = ''
    row.created_by = actorName || ''
    row.created_at = now
    row.updated_at = now
    rows.push(row)
  } else {
    const idx = rows.findIndex((r) => String(r.id) === id)
    if (idx === -1) throw new Error('ไม่พบรายการนี้')
    fieldsIn(rows[idx])
    rows[idx].updated_at = now
  }
  await overwriteSheet(SHEET, HEADERS, rows.map((r) => HEADERS.map((h) => r[h] ?? '')))
  return { id: id || rows[rows.length - 1].id }
}

async function deleteOrder(id) {
  if (!id) throw new Error('ต้องระบุ id')
  await ensureImportTrackingSheet()
  const rows = await getSheet(SHEET)
  const next = rows.filter((r) => String(r.id) !== String(id))
  if (next.length === rows.length) throw new Error('ไม่พบรายการนี้')
  await overwriteSheet(SHEET, HEADERS, next.map((r) => HEADERS.map((h) => r[h] ?? '')))
  return { id }
}

export default async function opImportTracking(req, res) {
  try {
    const actorName = req.user?.display_name || req.user?.username || ''

    if (req.method === 'GET') {
      const data = await loadOrders()
      return res.status(200).json({ success: true, ...data })
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || 'upsert')
      if (action === 'upsert') {
        const result = await upsertOrder(req.body, actorName)
        return res.status(200).json({ success: true, ...result })
      }
      if (action === 'delete') {
        const result = await deleteOrder(req.body?.id)
        return res.status(200).json({ success: true, ...result })
      }
      return res.status(400).json({ success: false, error: 'action ไม่ถูกต้อง' })
    }

    return res.status(405).json({ success: false, error: 'method not allowed' })
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message })
  }
}
