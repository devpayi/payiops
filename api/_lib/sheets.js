// Google Sheets helpers — ใช้โดย serverless functions ใน api/
// ต้องตั้ง env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID
import { google } from 'googleapis'

let client

// ลด round-trip ไป Google Sheets เมื่อหลาย widget ขอ tab เดียวกันพร้อมกัน
// mutation ด้านล่างจะล้าง cache ทันทีอยู่แล้ว ดังนั้นยืด TTL ได้โดยไม่เสียความสด (แค่ลดหน้าต่าง
// ที่ instance อื่น — เช่น serverless cold start ใหม่ — จะเห็นข้อมูลที่คนอื่นเขียนไปหมาดๆ)
// ยืดจาก 120s เป็น 300s หลังชน quota "Read requests per minute per user" ของ Sheets API จริง
const SHEET_CACHE_MS = 300_000
const sheetCache = new Map()
const sheetInflight = new Map()
const sheetVersion = new Map()

function invalidateSheet(sheetName) {
  sheetCache.delete(sheetName)
  sheetInflight.delete(sheetName)
  sheetVersion.set(sheetName, (sheetVersion.get(sheetName) || 0) + 1)
}

function getClient() {
  if (!client) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, ''),
        // Vercel เก็บ private key เป็น string บรรทัดเดียว ต้องแปลง \n กลับเป็น newline
        // + กัน paste ผิด: ตัดเครื่องหมายคำพูดที่เผลอก๊อปติดมาจาก .env
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    client = google.sheets({ version: 'v4', auth })
  }
  return client
}

const sheetId = () => process.env.SHEET_ID

// retry แบบ exponential backoff เฉพาะ error โควตา (429 "Read/Write requests per minute
// per user" ของ Sheets API) — เดิมพอชนโควตา request ล้มเหลวทันที ทั้งที่แค่รอไม่ถึงวินาที
// โควตาก็รีเซ็ตแล้ว (เป็น per-minute) ทุกจุดที่เรียก Google API ตรงในไฟล์นี้ผ่านตัวนี้หมด กันพังจริง
// ไม่ใช่แค่ลดจำนวน request (ที่ทำไปแล้วรอบก่อนๆ) — สอง fix นี้เสริมกัน ไม่ได้แทนกัน
//
// ปรับ retries 4→2 / baseDelay 600ms→300ms (2026-08-04) — เดิม worst-case รอนานถึง ~9 วินาที
// ก่อนจะพังให้เห็น (owner บ่นว่า "ช้ามาก") แต่ถ้าทั้งโควตาต่อนาทีถูกใช้หมดจริงจาก traffic ต่อเนื่อง
// (ไม่ใช่แค่ burst สั้นๆ) รอไม่กี่วินาทีในนาทีเดียวกันก็ไม่ช่วยอะไรอยู่ดี ต้องรอข้ามนาทีจริง — ลด
// เวลารอสูงสุดเหลือ ~1 วินาทีเผื่อ burst สั้นๆ พอ ไม่ทำให้ผู้ใช้รอนานโดยเปล่าประโยชน์ตอนโควตาหมดจริง
// (แก้ที่ต้นตอจริงๆ ต้องขอเพิ่ม quota limit ใน Google Cloud Console — ฟรี ไม่ใช่แค่ backoff)
async function withQuotaRetry(fn, { retries = 2, baseDelayMs = 300 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = Number(err?.code ?? err?.response?.status)
      const isQuotaError = status === 429
      if (!isQuotaError || attempt >= retries) throw err
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 300
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

// ── ไฟล์เก็บออเดอร์เดือนเก่า (ARCHIVE_SHEET_ID) ──
// Google Sheets รับได้ 10 ล้านช่องต่อไฟล์ — mona-ops-db ใช้ไป 8.3 ล้าน (ก.ย. 2026) ส่วนใหญ่เป็น raw_orders_*
// จึงย้ายแท็บออเดอร์เดือนเก่าไปไว้อีกไฟล์ แล้วให้ทุกตัวอ่านเห็นเหมือนยังอยู่ไฟล์เดียว:
//   - getMeta() ใส่รายชื่อแท็บ raw_orders_* ที่มีแค่ในไฟล์เก็บไว้หน้าสุด (properties.archived = true)
//   - batchGetValues()/getSheet() ส่ง range ของแท็บพวกนั้นไปอ่านที่ไฟล์เก็บ
//   - เขียนแท็บพวกนั้นไม่ได้ (assertWritable) — เดือนเก่าเป็นข้อมูลปิดแล้ว
// แท็บที่มีทั้งสองไฟล์ (ระหว่างคัดลอก) อ่านจากไฟล์หลักเท่านั้น → ยอดไม่นับซ้ำ
// ไม่ตั้ง ARCHIVE_SHEET_ID = ทำงานเหมือนเดิมทุกอย่าง (ไม่ยิง API เพิ่ม)
const archiveSheetId = () => (process.env.ARCHIVE_SHEET_ID || '').trim()
const isOrderTab = (title) => /^raw_orders_/.test(title)
let archivedTabs = new Set() // แท็บออเดอร์ที่อยู่แค่ในไฟล์เก็บ — อัปเดตทุกครั้งที่ getMeta() ทำงาน

export function tabOfRange(range) {
  const r = String(range)
  const bang = r.lastIndexOf('!')
  return (bang >= 0 ? r.slice(0, bang) : r).replace(/^'|'$/g, '').replace(/''/g, "'")
}

async function archivedTabSet() {
  if (!archiveSheetId()) return archivedTabs
  await getMetaCached()
  return archivedTabs
}

async function assertWritable(sheetNames) {
  if (!archiveSheetId()) return
  const archived = await archivedTabSet()
  for (const name of sheetNames) {
    if (archived.has(name)) throw new Error(`${name} ย้ายไปไฟล์เก็บออเดอร์เก่าแล้ว — นำเข้า/แก้/ลบข้อมูลเดือนนี้ไม่ได้`)
  }
}

// metadata ของ spreadsheet (รายชื่อ tab ฯลฯ)
export async function getMeta() {
  const res = await withQuotaRetry(() => getClient().spreadsheets.get({ spreadsheetId: sheetId() }))
  if (!archiveSheetId()) return res.data
  const arc = await withQuotaRetry(() => getClient().spreadsheets.get({ spreadsheetId: archiveSheetId(), fields: 'sheets.properties.title' }))
  const mainTitles = new Set((res.data.sheets || []).map((s) => s.properties.title))
  const arcTitles = (arc.data.sheets || []).map((s) => s.properties.title).filter(isOrderTab)
  // ARCHIVE_PREFER_ARCHIVE=1 ใช้ตรวจในเครื่องเท่านั้น (ห้ามตั้งบน Vercel): อ่านจากไฟล์เก็บแม้ไฟล์หลักยังมีแท็บนั้น
  // → เทียบยอดกับตอนไม่ตั้งค่าได้ก่อนลบแท็บเดือนเก่าออกจากไฟล์หลักจริง
  if (process.env.ARCHIVE_PREFER_ARCHIVE === '1') {
    archivedTabs = new Set(arcTitles)
    return { ...res.data, sheets: [...arcTitles.sort().map((title) => ({ properties: { title, archived: true } })), ...(res.data.sheets || []).filter((s) => !archivedTabs.has(s.properties.title))] }
  }
  const only = arcTitles.filter((t) => !mainTitles.has(t)).sort()
  archivedTabs = new Set(only)
  // ใส่ไว้หน้าสุด: แท็บในไฟล์เก็บคือเดือนเก่าสุด — คงลำดับ ม.ค.→ธ.ค. เหมือนตอนอยู่ไฟล์เดียว (บางตัวอ่าน
  // เลือกชื่อสินค้าจากแถวแรกที่เจอ ถ้าลำดับเปลี่ยน ป้ายชื่อจะเปลี่ยนตาม)
  return { ...res.data, sheets: [...only.map((title) => ({ properties: { title, archived: true } })), ...(res.data.sheets || [])] }
}

// cache ของ getMeta() แยกจาก sheetCache — ensureSheet() เดิมเรียก getMeta() สดทุกครั้ง (ไม่มี cache เลย)
// พอ ensureWorkforceSheets/ensureHrSheets วนเรียก ensureSheet() ~10 แท็บต่อครั้ง = ยิง getMeta() 10 รอบ
// ต่อ cold start เดียว เป็นสาเหตุหลักที่ชน quota "Read requests per minute" — cache ไว้ 5 นาทีเพราะรายชื่อ
// แท็บใน spreadsheet แทบไม่เปลี่ยนเลยระหว่าง request
const META_CACHE_MS = 300_000
let metaCache = null
let metaCacheAt = 0
export async function getMetaCached() {
  if (metaCache && Date.now() - metaCacheAt < META_CACHE_MS) return metaCache
  metaCache = await getMeta()
  metaCacheAt = Date.now()
  return metaCache
}

// ensureSheet() เช็ค header ผ่าน values.get ทุกครั้งที่เรียก (กันแท็บใหม่ที่ยังไม่มี header) — พอยืนยันแล้วว่า
// header ตรงในโปรเซสนี้ ไม่ต้องเช็คซ้ำอีกจนกว่าจะ restart (header ไม่มีทางเปลี่ยนเองระหว่าง process มีชีวิตอยู่)
const ensuredSheets = new Set()

// อ่านหลาย range ใน API call เดียว — cache สั้นๆ + กันยิงซ้ำพร้อมกัน (เหมือน getSheet ด้านล่าง) เพราะ
// endpoint หนักๆแทบทุกตัว (dashboard/monthly/products/claims/planner-sales/opHr ฯลฯ) เรียกตัวนี้ตรงๆ
// ไม่ผ่าน getSheet เลย จึงไม่เคยได้ cache/dedup มาก่อน — พอมีหลายการ์ด/แท็บ/คนเปิดพร้อมกัน (เช่น หน้า Settings
// ที่มีหลายการ์ดยิง op=hr ตอน mount พร้อมกัน) จะยิง batchGetValues ซ้ำๆ กันจริงๆ จนชนโควตา "Read requests
// per minute" ของ Sheets API (เจอจริงตอน owner ทดสอบ 2026-07-30) — cache สั้นแค่ 20s พอกันการยิงซ้ำตอน
// โหลดพร้อมกัน ไม่ได้ทำให้ข้อมูลเก่าค้างนาน (endpoint ส่วนใหญ่มี cache ของตัวเองที่ยาวกว่านี้อยู่แล้วชั้นบน)
const BATCH_CACHE_MS = 20_000
const batchCache = new Map()
const batchInflight = new Map()

// ล้าง batchCache ทุก entry ที่อ้างถึง tab เหล่านี้ — เรียกหลัง write เพื่อกันอ่านค่าเก่าในลูปเดียวกัน
// (invalidateSheet ล้างแค่ sheetCache/sheetInflight ที่ key เป็นชื่อ tab ตรง ๆ ไม่ครอบ batchCache
// ที่ key เป็น range string)
function invalidateBatchCache(sheetNames) {
  const names = [...sheetNames]
  for (const key of batchCache.keys()) if (names.some((n) => key.includes(n))) batchCache.delete(key)
}
export async function batchGetValues(ranges) {
  if (!archiveSheetId()) return batchGetFrom(sheetId(), ranges)
  const archived = await archivedTabSet()
  const toArchive = ranges.map((r) => archived.has(tabOfRange(r)))
  if (!toArchive.some(Boolean)) return batchGetFrom(sheetId(), ranges)
  const mainRanges = ranges.filter((_, i) => !toArchive[i])
  const archiveRanges = ranges.filter((_, i) => toArchive[i])
  const [fromMain, fromArchive] = await Promise.all([
    mainRanges.length ? batchGetFrom(sheetId(), mainRanges) : [],
    batchGetFrom(archiveSheetId(), archiveRanges),
  ])
  let m = 0, a = 0
  return ranges.map((_, i) => (toArchive[i] ? fromArchive[a++] : fromMain[m++]))
}

async function batchGetFrom(spreadsheetId, ranges) {
  const key = spreadsheetId + '' + ranges.join('')
  const cached = batchCache.get(key)
  if (cached && Date.now() - cached.at < BATCH_CACHE_MS) return cached.data
  if (batchInflight.has(key)) return batchInflight.get(key)

  const pending = withQuotaRetry(() => getClient().spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  })).then((res) => {
    batchCache.set(key, { at: Date.now(), data: res.data.valueRanges })
    return res.data.valueRanges
  }).finally(() => {
    if (batchInflight.get(key) === pending) batchInflight.delete(key)
  })

  batchInflight.set(key, pending)
  return pending
}

// อ่านข้อมูลทั้ง sheet → array ของ object (header เป็น key)
export async function getSheet(sheetName) {
  const cached = sheetCache.get(sheetName)
  if (cached && Date.now() - cached.at < SHEET_CACHE_MS) return cached.rows
  if (sheetInflight.has(sheetName)) return sheetInflight.get(sheetName)

  const version = sheetVersion.get(sheetName) || 0
  const pending = (archiveSheetId() && isOrderTab(sheetName) ? archivedTabSet() : Promise.resolve(archivedTabs)).then((archived) => withQuotaRetry(() => getClient().spreadsheets.values.get({
    spreadsheetId: archived.has(sheetName) ? archiveSheetId() : sheetId(),
    range: `${sheetName}!A:Z`,
  }))).then((res) => {
    const [headers, ...rows] = res.data.values || []
    const parsed = headers
      ? rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])))
      : []
    if ((sheetVersion.get(sheetName) || 0) === version) {
      sheetCache.set(sheetName, { at: Date.now(), rows: parsed })
    }
    return parsed
  }).finally(() => {
    if (sheetInflight.get(sheetName) === pending) sheetInflight.delete(sheetName)
  })

  sheetInflight.set(sheetName, pending)
  return pending
}

// อัปเดตหลายช่วงพร้อมกัน (targeted) — data: [{ range: 'tab!A5:V5', values: [[...]] }]
// ใช้แก้แถวเดิมแบบเจาะจงโดยไม่ต้อง clear+rewrite ทั้งชีต (เบากว่า/ปลอดภัยกว่า overwriteSheet)
export async function batchUpdateValues(data) {
  if (!data || !data.length) return
  await assertWritable(new Set(data.map((d) => tabOfRange(d.range))))
  await withQuotaRetry(() => getClient().spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  }))
  const names = new Set(data.map((d) => d.range.split('!')[0].replace(/^'|'$/g, '')))
  names.forEach(invalidateSheet)
  invalidateBatchCache(names)
}

export async function getExternalSheet(spreadsheetId, range = 'A:Z') {
  const res = await withQuotaRetry(() => getClient().spreadsheets.values.get({ spreadsheetId, range }))
  return res.data.values || []
}

// ensureSheet/appendRows แบบข้ามสเปรดชีต — สำหรับเขียนลง HR_SHEET_ID (แยกจาก SHEET_ID หลัก)
// ไม่มี cache เพราะ traffic น้อย (ฟอร์มสมัครงานไม่ได้ยิงถี่)
export async function ensureExternalSheet(spreadsheetId, sheetName, headers) {
  const meta = await withQuotaRetry(() => getClient().spreadsheets.get({ spreadsheetId }))
  const exists = meta.data.sheets.some((s) => s.properties.title === sheetName)
  if (!exists) {
    try {
      await withQuotaRetry(() => getClient().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      }))
    } catch (e) {
      if (!/already exists/i.test(e.message || '')) throw e
    }
  }
  const res = await withQuotaRetry(() => getClient().spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:ZZ1`,
  }))
  const current = res.data.values?.[0] || []
  const missingHeader = headers.some((h, i) => current[i] !== h)
  if (!current.length || missingHeader) {
    await withQuotaRetry(() => getClient().spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    }))
  }
}

// ลบแถวจริงออกจากแท็บ (rowNumber = เลขแถวใน Sheets เริ่มที่ 1 รวมแถวหัวตาราง)
export async function deleteExternalRow(spreadsheetId, sheetName, rowNumber) {
  const meta = await withQuotaRetry(() => getClient().spreadsheets.get({ spreadsheetId }))
  const tab = meta.data.sheets.find((s) => s.properties.title === sheetName)
  if (!tab) throw new Error(`ไม่พบแท็บ ${sheetName}`)
  await withQuotaRetry(() => getClient().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } }] },
  }))
}

export async function appendExternalRows(spreadsheetId, sheetName, rows) {
  await withQuotaRetry(() => getClient().spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  }))
}

// เขียนต่อท้าย (append)
export async function appendRows(sheetName, rows) {
  await assertWritable([sheetName])
  await withQuotaRetry(() => getClient().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  }))
  invalidateSheet(sheetName)
  invalidateBatchCache([sheetName])
}

// append(rows) แล้วอ่านย้อนกลับ verify ว่าแต่ละแถวลงจริง — กัน race กับฟังก์ชันอื่นที่ overwriteSheet
// (อ่าน-แก้-เขียนทับทั้งชีท) ชีทเดียวกันพร้อมกัน แล้วทับแถวที่เพิ่ง append หายไปเงียบๆ โดย appendRows เอง
// ไม่ throw เลย (เจอบั๊กจริงกับ stock_movements 2026-08-11 — approve ของเข้าผ่าน LINE 12 รายการหายไปแบบนี้)
// idField = คอลัมน์ที่ไม่ซ้ำต่อแถว (เช่น 'id'/'code') หรือฟังก์ชัน (sheetRow) => key ถ้าต้องผูกหลายคอลัมน์
// เป็น key เดียว (เช่น hr_leave_backups ไม่มีคอลัมน์ id เดี่ยวๆ ต้องผูก leave_id+date+period) — idValues
// คือ key คู่กับแต่ละแถวใน rows ตามลำดับ (ต้องคำนวณด้วยตรรกะเดียวกับ idField ถ้าเป็นฟังก์ชัน) — retry เฉพาะ
// แถวที่ยังไม่เจอ ไม่ append ซ้ำแถวที่ลงแล้ว (กันแถวซ้ำถ้า verify อ่านชนจังหวะ cache พอดี)
export async function appendRowsVerified(sheetName, rows, idField, idValues, attempts = 2) {
  const keyOf = typeof idField === 'function' ? idField : (r) => r[idField]
  await appendRows(sheetName, rows)
  let pending = rows.map((row, i) => ({ row, id: idValues[i] }))
  for (let i = 0; i < attempts && pending.length; i++) {
    const sheetRows = await getSheet(sheetName)
    const landed = new Set(sheetRows.map((r) => String(keyOf(r))))
    pending = pending.filter((p) => !landed.has(String(p.id)))
    if (!pending.length) return
    await appendRows(sheetName, pending.map((p) => p.row))
  }
}

// เขียนทับทั้ง sheet (สำหรับ product_master)
export async function ensureSheet(sheetName, headers) {
  if (ensuredSheets.has(sheetName)) return
  await assertWritable([sheetName])
  const meta = await getMetaCached()
  const exists = meta.sheets.some((s) => s.properties.title === sheetName)
  if (!exists) {
    try {
      await withQuotaRetry(() => getClient().spreadsheets.batchUpdate({
        spreadsheetId: sheetId(),
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      }))
    } catch (e) {
      // getMetaCached() อาจ stale (แท็บเพิ่งถูกสร้างโดย request คู่ขนาน) หรือสอง request แข่งสร้างพร้อมกัน
      // — ถ้า Sheets ตอบว่า "already exists" แปลว่าแท็บมีจริงแล้ว เดินหน้าต่อไปเช็ค header ได้เลย
      if (!/already exists/i.test(e.message || '')) throw e
    }
  }

  const res = await withQuotaRetry(() => getClient().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A1:ZZ1`,
  }))
  const current = res.data.values?.[0] || []
  const missingHeader = headers.some((h, i) => current[i] !== h)
  if (!current.length || missingHeader) {
    await withQuotaRetry(() => getClient().spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    }))
    invalidateSheet(sheetName)
  }
  ensuredSheets.add(sheetName)
}

// ensureSheets(list) — เหมือน ensureSheet แต่ทำหลายแท็บทีเดียวด้วย 1 batchGet call แทนที่จะยิง
// values.get แยกทีละแท็บ (สาเหตุหลักที่ชนโควตา "Read requests per minute per user": หน้า HR/
// Workforce/Inventory แต่ละหน้าเช็ค header 5-11 แท็บพร้อมกันตอน cold start ด้วย Promise.all ของ
// ensureSheet เดี่ยวๆ = 5-11 read request แยกกันต่อ instance เดียว พอมีคนเปิดหลายแท็บ/refresh พร้อมกัน
// (แต่ละ request อาจไปโดน serverless instance คนละตัว ไม่แชร์ cache กัน) ยอดรวมพุ่งชนโควตาไว — ฟังก์ชันนี้
// รวมเป็น 1 request ต่อกลุ่ม (เหมือน batchGetValues ด้านบนที่แก้ปัญหาเดียวกันไปแล้วรอบนึง)
export async function ensureSheets(list) {
  const notYetEnsured = list.filter(([name]) => !ensuredSheets.has(name))
  if (!notYetEnsured.length) return
  await assertWritable(notYetEnsured.map(([name]) => name))

  const meta = await getMetaCached()
  const existingNames = new Set(meta.sheets.map((s) => s.properties.title))
  const missing = notYetEnsured.filter(([name]) => !existingNames.has(name))
  if (missing.length) {
    await withQuotaRetry(() => getClient().spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: missing.map(([name]) => ({ addSheet: { properties: { title: name } } })) },
    }))
    for (const [name] of missing) invalidateSheet(name)
  }

  const res = await withQuotaRetry(() => getClient().spreadsheets.values.batchGet({
    spreadsheetId: sheetId(),
    ranges: notYetEnsured.map(([name]) => `${name}!A1:Z1`),
  }))
  const valueRanges = res.data.valueRanges || []

  for (let i = 0; i < notYetEnsured.length; i++) {
    const [name, headers] = notYetEnsured[i]
    const current = valueRanges[i]?.values?.[0] || []
    const missingHeader = headers.some((h, idx) => current[idx] !== h)
    if (!current.length || missingHeader) {
      await withQuotaRetry(() => getClient().spreadsheets.values.update({
        spreadsheetId: sheetId(),
        range: `${name}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      }))
      invalidateSheet(name)
    }
    ensuredSheets.add(name)
  }
}

export async function overwriteSheet(sheetName, headers, rows) {
  await assertWritable([sheetName])
  await withQuotaRetry(() => getClient().spreadsheets.values.clear({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A:Z`,
  }))
  await withQuotaRetry(() => getClient().spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers, ...rows] },
  }))
  invalidateSheet(sheetName)
  invalidateBatchCache([sheetName])
}
