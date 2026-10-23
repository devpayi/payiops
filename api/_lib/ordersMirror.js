// ordersMirror — สำเนา raw_orders_* ลง Turso (libSQL) ตามหลัง Google Sheets
//
// หลักการ: Sheets เป็นแหล่งหลักเสมอ — Sheets ตัดสินว่าแถวไหนเพิ่ม/แก้/ลบ แล้วไฟล์นี้ทำตามผลนั้น
//   - ปิดอยู่เป็นค่าเริ่มต้น: เปิดด้วย env TURSO_MIRROR=on (+ TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
//   - ทุกฟังก์ชันที่ถูกเรียกจากเส้นทางนำเข้า "ไม่ throw" — Turso พัง/ช้า ต้องไม่ทำให้การนำเข้าล้ม
//     ถ้าเขียนไม่สำเร็จจะบันทึก "ธง dirty" ลงแท็บ turso_dirty ในชีต (ถาวร ไม่ใช่หน่วยความจำ — serverless
//     instance หายได้) แล้วให้ reconcile() ซ่อมทั้งเดือนจาก Sheets ภายหลัง
//   - ตารางไม่บังคับ unique บน order_key: ข้อมูลเก่าเดือน ม.ค.–พ.ค. มี key ซ้ำเป็นพันชุด (คนละสินค้าใช้ key
//     เดียวกัน) และ dashboard นับตามแถวอยู่แล้ว สำเนาต้องมีจำนวนแถวเท่าชีตเป๊ะ
//
// รูปแบบแถว = 22 คอลัมน์ A–V ของ raw_orders (RAW_HEADERS) + src_tab/ym/ex ที่คำนวณเพิ่ม
import crypto from 'node:crypto'
import { appendRows, batchGetValues, ensureSheet, getSheet, getMeta } from './sheets.js'

export const RAW_HEADERS = ['order_key', 'order_id', 'order_item_id', 'date', 'platform', 'business', 'sku_platform', 'product_name', 'variation_name', 'master_sku', 'display_name', 'qty', 'revenue', 'order_status', 'imported_at', 'source_file', 'import_id', 'alias_key', 'province', 'shipping_option', 'fulfillment_type', 'buyer_hash']
export const TABLE = 'raw_orders'
export const DIRTY_SHEET = 'turso_dirty'
const DIRTY_HEADERS = ['tab', 'event', 'at', 'reason']

const WRITE_TIMEOUT_MS = 8000
// เพดานเวลารวมของ mirrorRows 1 ครั้ง + เบรกเกอร์: Vercel ฆ่าฟังก์ชันที่ 60 วินาที ถ้า Turso ค้าง (ไม่ error แค่ไม่ตอบ)
// แล้วเราวนรอทุก chunk การนำเข้าจะตายหลัง Sheets เขียนแล้วแต่ก่อนบันทึก import_log — จึงต้องหยุดรอเร็วและข้ามที่เหลือ
const MIRROR_BUDGET_MS = 12000
const BREAKER_MS = 60000
const CHUNK = 200       // แถวต่อ batch ตอนเพิ่ม/แก้ตามคำสั่งนำเข้า
const BULK_CHUNK = 500  // แถวต่อ batch ตอนซ่อมทั้งเดือน

// ---------- deps (ฉีดตอนเทสต์) ----------
let deps = null
let realClient = null
let schemaReady = new WeakSet()
export function __setDepsForTests(d) { deps = d; schemaReady = new WeakSet(); breakerUntil = 0 }
let breakerUntil = 0
const timeoutMs = () => deps?.timeoutMs ?? WRITE_TIMEOUT_MS
const budgetMs = () => deps?.budgetMs ?? MIRROR_BUDGET_MS
const breakerOpen = () => Date.now() < breakerUntil
const tripBreaker = () => { breakerUntil = Date.now() + (deps?.breakerMs ?? BREAKER_MS) }

export function mirrorEnabled() {
  if (deps?.enabled !== undefined) return deps.enabled
  return process.env.TURSO_MIRROR === 'on' && !!process.env.TURSO_DATABASE_URL && !!process.env.TURSO_AUTH_TOKEN
}
// โหลด @libsql/client ตอนใช้งานจริงเท่านั้น — ถ้า binding ของมันโหลดไม่ได้บน serverless (หรือปิดกระจกอยู่)
// จะไม่ทำให้ import-orders/tiktok ล้มตั้งแต่ตอน import module
async function getClient() {
  if (deps?.client) return deps.client
  if (!realClient) {
    const { createClient } = await import('@libsql/client')
    realClient = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  return realClient
}
const sheetsApi = () => deps?.sheets || { appendRows, batchGetValues, ensureSheet, getSheet, getMeta }
const nowIso = () => (deps?.now ? deps.now() : new Date().toISOString())

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ---------- schema ----------
export async function ensureSchema(client) {
  if (schemaReady.has(client)) return
  await client.batch([
    `CREATE TABLE IF NOT EXISTS ${TABLE}(
      order_key TEXT NOT NULL, order_id TEXT, order_item_id TEXT, date TEXT NOT NULL, platform TEXT, business TEXT,
      sku_platform TEXT, product_name TEXT, variation_name TEXT, master_sku TEXT, display_name TEXT,
      qty INTEGER NOT NULL DEFAULT 0, revenue REAL NOT NULL DEFAULT 0, order_status TEXT,
      imported_at TEXT, source_file TEXT, import_id TEXT, alias_key TEXT, province TEXT, shipping_option TEXT,
      fulfillment_type TEXT, buyer_hash TEXT,
      src_tab TEXT NOT NULL, ym TEXT NOT NULL, ex INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS ${TABLE}_key ON ${TABLE}(order_key)`,
    `CREATE INDEX IF NOT EXISTS ${TABLE}_import ON ${TABLE}(import_id)`,
    `CREATE INDEX IF NOT EXISTS ${TABLE}_tab ON ${TABLE}(src_tab)`,
    `CREATE INDEX IF NOT EXISTS ${TABLE}_cover ON ${TABLE}(ym,business,platform,ex,order_id,qty,revenue)`,
    `CREATE INDEX IF NOT EXISTS ${TABLE}_sku ON ${TABLE}(master_sku,date)`,
  ], 'write')
  schemaReady.add(client)
}

// ---------- แปลงแถวชีต -> แถว Turso ----------
const stripQuote = (v) => String(v ?? '').replace(/^'/, '')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const SCI = /^\d(\.\d+)?E\+\d+$/i
// กติกาเดียวกับ dashboard/monthly/products: ยกเลิก/cancel/return ไม่นับยอดขายและชิ้น
export const isExcluded = (s = '') => { const t = String(s); const l = t.toLowerCase(); return t.includes('ยกเลิก') || l.includes('cancel') || l.includes('return') }

// คืน null ถ้าแถวไม่มีวันที่ (ทุก endpoint ข้ามแถวแบบนี้อยู่แล้ว)
export function toRow(arr, tab) {
  const a = Array.from({ length: RAW_HEADERS.length }, (_, i) => arr?.[i] ?? '')
  const date = String(a[3] ?? '').trim()
  if (!date) return null
  const key = String(a[0] ?? '')
  let orderId = stripQuote(a[1]), itemId = stripQuote(a[2])
  // import รุ่นเก่าเก็บ order_id/item_id เป็นตัวเลข ชีตแสดงเป็น 1.12E+15 — order_key ยังมีข้อความเต็ม
  const parts = key.split(':')
  if (parts.length >= 3 && parts[0] === String(a[4])) {
    if (SCI.test(orderId)) orderId = parts[1]
    if (SCI.test(itemId)) itemId = parts.slice(2).join(':')
  }
  const status = String(a[13] ?? '')
  return {
    order_key: key, order_id: orderId, order_item_id: itemId, date, platform: String(a[4]), business: String(a[5]),
    sku_platform: stripQuote(a[6]), product_name: String(a[7]), variation_name: String(a[8]), master_sku: String(a[9]), display_name: String(a[10]),
    qty: parseInt(a[11], 10) || 0, revenue: num(a[12]), order_status: status,
    imported_at: String(a[14]), source_file: String(a[15]), import_id: String(a[16]), alias_key: String(a[17]),
    province: String(a[18]), shipping_option: String(a[19]), fulfillment_type: String(a[20]), buyer_hash: String(a[21]),
    src_tab: tab, ym: date.slice(0, 7), ex: isExcluded(status) ? 1 : 0,
  }
}
const COLS = [...RAW_HEADERS, 'src_tab', 'ym', 'ex']
const INSERT_SQL = `INSERT INTO ${TABLE}(${COLS.join(',')}) VALUES(${COLS.map(() => '?').join(',')})`
const insertStmt = (row) => ({ sql: INSERT_SQL, args: COLS.map((c) => row[c]) })

// ---------- fingerprint (เทียบ Sheets กับ Turso) ----------
// นับ/ยอด/ชิ้น + hash ของ (key, สถานะ, ยอด(สตางค์), qty, sku, import_id) เรียงแล้ว — จับทั้งแถวหาย/เกิน
// และค่าที่ถูกแก้ด้วยมือในชีต (ถ้าแก้เฉพาะคอลัมน์ที่ไม่อยู่ใน hash เช่นชื่อสินค้า จะไม่เห็น — ตั้งใจ)
export function fingerprint(rows) {
  let count = 0, cents = 0, qty = 0
  const lines = []
  for (const r of rows) {
    if (!r) continue
    count++
    const c = Math.round(r.revenue * 100)
    cents += c; qty += r.qty
    lines.push(`${r.order_key}|${r.order_status}|${c}|${r.qty}|${r.master_sku}|${r.import_id}`)
  }
  lines.sort()
  return { count, cents, qty, hash: crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16) }
}
const sameFp = (a, b) => a.count === b.count && a.cents === b.cents && a.qty === b.qty && a.hash === b.hash

// ---------- ธง dirty (เก็บถาวรในชีต, append-only) ----------
export async function markDirty(tab, reason) {
  try {
    const s = sheetsApi()
    await s.ensureSheet(DIRTY_SHEET, DIRTY_HEADERS)
    await s.appendRows(DIRTY_SHEET, [[tab, 'dirty', nowIso(), String(reason || '').slice(0, 300)]])
    return true
  } catch (e) {
    console.error('[ordersMirror] markDirty failed', tab, e?.message)
    return false
  }
}
export async function markClean(tab, reason) {
  try {
    const s = sheetsApi()
    await s.ensureSheet(DIRTY_SHEET, DIRTY_HEADERS)
    await s.appendRows(DIRTY_SHEET, [[tab, 'clean', nowIso(), String(reason || '').slice(0, 300)]])
    return true
  } catch (e) {
    console.error('[ordersMirror] markClean failed', tab, e?.message)
    return false
  }
}
// สถานะล่าสุดต่อแท็บ: dirty ถ้าเหตุการณ์สุดท้ายเป็น dirty
export async function listDirtyTabs() {
  let rows
  try { rows = await sheetsApi().getSheet(DIRTY_SHEET) } catch { return [] }
  const last = new Map()
  for (const r of rows) if (r.tab) last.set(r.tab, r.event)
  return [...last.entries()].filter(([, ev]) => ev === 'dirty').map(([tab]) => tab)
}

// ---------- เขียนตามคำสั่งนำเข้า ----------
// rows22 = แถว (array 22 ช่อง) ที่ Sheets เขียนจริงรอบนี้ (newRows + updates) — แถวที่ Sheets ข้าม ไม่ต้องส่งมา
// ทำซ้ำกี่ครั้งผลเท่าเดิม: ลบตาม order_key ก่อนแล้วค่อยใส่
export async function mirrorRows(tab, rows22, reason = 'import') {
  if (!mirrorEnabled() || !rows22?.length) return { skipped: true }
  if (breakerOpen()) { await markDirty(tab, `${reason}: skipped, turso failed recently`); return { ok: false, error: 'breaker open' } }
  const deadline = Date.now() + budgetMs()
  // ทุกคำสั่งรอได้ไม่เกิน "เวลาที่เหลือในงบ" — กันคำสั่งเดียวที่ค้างกินเกินงบ (เดิมรอได้ถึง 8s+16s ต่อ chunk)
  const remain = () => Math.max(50, deadline - Date.now())
  try {
    const client = await getClient()
    await withTimeout(ensureSchema(client), Math.min(timeoutMs(), remain()), 'schema')
    const rows = rows22.map((a) => toRow(a, tab)).filter(Boolean)
    let dupKeyTouched = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      if (Date.now() > deadline) throw new Error(`mirror time budget ${budgetMs()}ms exceeded at ${i}/${rows.length}`)
      const part = rows.slice(i, i + CHUNK)
      const keys = [...new Set(part.map((r) => r.order_key))]
      const ph = keys.map(() => '?').join(',')
      // key ซ้ำอยู่แล้วในสำเนา = ข้อมูลเก่าที่ชีตจัดการต่างจากเรา — ไม่เดา ปล่อยให้ซ่อมทั้งเดือน
      const dup = await withTimeout(client.execute({ sql: `SELECT count(*) n FROM (SELECT order_key FROM ${TABLE} WHERE order_key IN (${ph}) GROUP BY order_key HAVING count(*)>1)`, args: keys }), Math.min(timeoutMs(), remain()), 'dupcheck')
      dupKeyTouched += Number(dup.rows[0][0])
      await withTimeout(client.batch([{ sql: `DELETE FROM ${TABLE} WHERE order_key IN (${ph})`, args: keys }, ...part.map(insertStmt)], 'write'), Math.min(timeoutMs() * 2, remain()), 'write')
    }
    if (dupKeyTouched) {
      await markDirty(tab, `duplicate-key in mirror (${dupKeyTouched} keys) after ${reason}`)
      return { ok: true, written: rows.length, dirty: true }
    }
    return { ok: true, written: rows.length }
  } catch (e) {
    tripBreaker()
    await markDirty(tab, `${reason}: ${e?.message}`)
    return { ok: false, error: e?.message }
  }
}

// ลบล็อตตาม import_id (ลบข้ามทุกแท็บในครั้งเดียว) — expected = จำนวนแถวที่ Sheets ลบจริง
export async function mirrorDeleteLot(importId, expected, tabs = [], reason = 'delete-lot') {
  if (!mirrorEnabled() || !importId) return { skipped: true }
  if (breakerOpen()) { for (const t of tabs) await markDirty(t, `${reason} ${importId}: skipped, turso failed recently`); return { ok: false, error: 'breaker open' } }
  try {
    const client = await getClient()
    await withTimeout(ensureSchema(client), timeoutMs(), 'schema')
    const rs = await withTimeout(client.execute({ sql: `DELETE FROM ${TABLE} WHERE import_id = ?`, args: [importId] }), timeoutMs(), 'delete')
    const removed = Number(rs.rowsAffected)
    if (removed !== Number(expected)) {
      for (const t of tabs) await markDirty(t, `${reason}: removed ${removed} but sheets removed ${expected} (import ${importId})`)
      return { ok: true, removed, mismatch: true }
    }
    return { ok: true, removed }
  } catch (e) {
    tripBreaker()
    for (const t of tabs) await markDirty(t, `${reason} ${importId}: ${e?.message}`)
    return { ok: false, error: e?.message }
  }
}

// ---------- ซ่อม/โหลดทั้งเดือน ----------
export const tabYm = (tab) => { const m = /^raw_orders_(\d{4})_(\d{2})$/.exec(tab); return m ? `${m[1]}-${m[2]}` : null }

async function readSheetRows(tab) {
  const vr = await sheetsApi().batchGetValues([`${tab}!A:V`])
  const values = vr[0]?.values || []
  return values.slice(1).map((a) => toRow(a, tab)).filter(Boolean)
}

// แทนที่ทั้งแท็บ (src_tab) ด้วยสิ่งที่อ่านจาก Sheets ตอนนี้ — ใช้ทั้ง backfill แรกและซ่อมเดือนที่ติดธง
// ลบก่อนแล้วใส่ใหม่: ระหว่างทำ (ไม่กี่วินาที–นาที) เดือนนั้นในสำเนาไม่ครบ — ยังไม่มีใครอ่านจาก Turso ในระยะ 0
export async function resyncTab(tab, { reason = 'resync', deadlineMs = 0 } = {}) {
  if (!tabYm(tab)) throw new Error(`ชื่อแท็บไม่ใช่ raw_orders_YYYY_MM: ${tab}`)
  const client = await getClient()
  await ensureSchema(client)
  const rows = await readSheetRows(tab)
  const started = Date.now()
  await markDirty(tab, `${reason}: start`)
  await client.execute({ sql: `DELETE FROM ${TABLE} WHERE src_tab = ?`, args: [tab] })
  let inserted = 0
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    if (deadlineMs && Date.now() - started > deadlineMs) {
      await markDirty(tab, `${reason}: time budget hit at ${inserted}/${rows.length} — rerun`)
      return { tab, done: false, inserted, total: rows.length }
    }
    await client.batch(rows.slice(i, i + BULK_CHUNK).map(insertStmt), 'write')
    inserted += Math.min(BULK_CHUNK, rows.length - i)
  }
  await markClean(tab, `${reason}: ${inserted} rows`)
  return { tab, done: true, inserted, total: rows.length }
}

export async function tursoFingerprint(client, tab) {
  const rs = await client.execute({ sql: `SELECT order_key, order_status, revenue, qty, master_sku, import_id FROM ${TABLE} WHERE src_tab = ?`, args: [tab] })
  return fingerprint(rs.rows.map((r) => ({ order_key: r[0], order_status: r[1], revenue: Number(r[2]), qty: Number(r[3]), master_sku: r[4], import_id: r[5] })))
}

// เทียบ Sheets กับ Turso ต่อแท็บ; repair=true จะซ่อมแท็บที่ไม่ตรงหรือติดธง (แท็บละครั้ง ภายในงบเวลา)
// tabs: ถ้าไม่ระบุ = 2 เดือนล่าสุดที่มีในชีต + แท็บที่ติดธง
export async function reconcile({ tabs, repair = true, budgetMs = 45000 } = {}) {
  if (!mirrorEnabled()) return { enabled: false }
  const client = await getClient()
  await ensureSchema(client)
  const started = Date.now()
  const dirty = await listDirtyTabs()
  let list = tabs
  if (!list?.length) {
    const meta = await sheetsApi().getMeta()
    // แท็บของเดือนอนาคต (สร้างล่วงหน้า/ว่าง) ไม่นับ — เอา 2 เดือนล่าสุดที่ไม่เกินเดือนปัจจุบัน (เวลาไทย)
    const bkk = new Date(Date.parse(nowIso()) + 7 * 3600 * 1000).toISOString().slice(0, 7)
    const all = meta.sheets.map((s) => s.properties.title).filter((t) => tabYm(t) && tabYm(t) <= bkk)
    all.sort()
    // เดือนเก่าหมุนเวียนวันละ 1 เดือน (ตามเลขวัน) — ทุกเดือนถูกตรวจซ้ำเป็นรอบ ไม่ใช่แค่ 2 เดือนล่าสุด
    // แต่ไม่อ่านทั้งปีในครั้งเดียว (อ่านชีต+Turso ทั้งหมดไม่ทันเพดาน 60 วินาที)
    const older = all.slice(0, -2)
    const rotating = older.length ? [older[Math.floor(Date.parse(nowIso()) / 86400000) % older.length]] : []
    list = [...new Set([...all.slice(-2), ...rotating, ...dirty])]
  }
  const report = []
  for (const tab of list) {
    if (Date.now() - started > budgetMs) { report.push({ tab, skipped: 'time budget' }); continue }
    const sheetRows = await readSheetRows(tab)
    const a = fingerprint(sheetRows), b = await tursoFingerprint(client, tab)
    const wasDirty = dirty.includes(tab)
    const match = sameFp(a, b)
    const entry = { tab, sheets: a, turso: b, match, wasDirty }
    if (!match && repair) {
      entry.repair = await resyncTab(tab, { reason: 'reconcile', deadlineMs: Math.max(5000, budgetMs - (Date.now() - started)) })
    } else if (match && wasDirty && repair) {
      // ติดธงแต่ข้อมูลตรงกันแล้ว (เช่นซ่อมไปแล้ว) — แค่ปลดธง ไม่ต้องเขียนใหม่ (โควตาเขียนฟรีมีจำกัด)
      await markClean(tab, 'reconcile: verified match')
      entry.cleared = true
    }
    report.push(entry)
  }
  return { enabled: true, report }
}

export async function mirrorStatus() {
  if (!mirrorEnabled()) return { enabled: false }
  const client = await getClient()
  await ensureSchema(client)
  const rs = await client.execute(`SELECT src_tab, count(*) n FROM ${TABLE} GROUP BY src_tab ORDER BY src_tab`)
  return { enabled: true, tabs: rs.rows.map((r) => ({ tab: r[0], rows: Number(r[1]) })), dirty: await listDirtyTabs() }
}
