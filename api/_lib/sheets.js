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

// metadata ของ spreadsheet (รายชื่อ tab ฯลฯ)
export async function getMeta() {
  const res = await getClient().spreadsheets.get({ spreadsheetId: sheetId() })
  return res.data
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

// อ่านหลาย range ใน API call เดียว
export async function batchGetValues(ranges) {
  const res = await getClient().spreadsheets.values.batchGet({
    spreadsheetId: sheetId(),
    ranges,
  })
  return res.data.valueRanges
}

// อ่านข้อมูลทั้ง sheet → array ของ object (header เป็น key)
export async function getSheet(sheetName) {
  const cached = sheetCache.get(sheetName)
  if (cached && Date.now() - cached.at < SHEET_CACHE_MS) return cached.rows
  if (sheetInflight.has(sheetName)) return sheetInflight.get(sheetName)

  const version = sheetVersion.get(sheetName) || 0
  const pending = getClient().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A:Z`,
  }).then((res) => {
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

export async function getExternalSheet(spreadsheetId, range = 'A:Z') {
  const res = await getClient().spreadsheets.values.get({ spreadsheetId, range })
  return res.data.values || []
}

// เขียนต่อท้าย (append)
export async function appendRows(sheetName, rows) {
  await getClient().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  })
  invalidateSheet(sheetName)
}

// เขียนทับทั้ง sheet (สำหรับ product_master)
export async function ensureSheet(sheetName, headers) {
  if (ensuredSheets.has(sheetName)) return
  const meta = await getMetaCached()
  const exists = meta.sheets.some((s) => s.properties.title === sheetName)
  if (!exists) {
    await getClient().spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    })
  }

  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A1:Z1`,
  })
  const current = res.data.values?.[0] || []
  const missingHeader = headers.some((h, i) => current[i] !== h)
  if (!current.length || missingHeader) {
    await getClient().spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    })
    invalidateSheet(sheetName)
  }
  ensuredSheets.add(sheetName)
}

export async function overwriteSheet(sheetName, headers, rows) {
  await getClient().spreadsheets.values.clear({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A:Z`,
  })
  await getClient().spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers, ...rows] },
  })
  invalidateSheet(sheetName)
}
