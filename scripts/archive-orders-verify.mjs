// archive-orders-verify — ตรวจการย้ายแท็บ raw_orders_* เดือนเก่าไปไฟล์เก็บ (ARCHIVE_SHEET_ID) — อ่านอย่างเดียว
//
//   node --env-file=.env scripts/archive-orders-verify.mjs compare
//     เทียบแท็บที่อยู่ทั้งสองไฟล์: จำนวนแถว + hash ของทุกช่อง ต้อง MATCH ทุกแท็บก่อนลบออกจากไฟล์หลัก
//   node --env-file=.env scripts/archive-orders-verify.mjs totals
//     ยอดรายเดือน (แถว / ยอดไม่ยกเลิก / ชิ้น) ผ่าน sheets.js ตัวเดียวกับที่เว็บใช้ — รันก่อน/หลังตั้งค่าแล้วเทียบกัน
//     (ใส่ ARCHIVE_PREFER_ARCHIVE=1 เพื่อบังคับอ่านจากไฟล์เก็บ ทั้งที่ไฟล์หลักยังมีแท็บนั้นอยู่)
import { createHash } from 'node:crypto'
import { google } from 'googleapis'
import { getMeta, batchGetValues } from '../api/_lib/sheets.js'

const mode = process.argv[2] || 'compare'
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const isCancelled = (s) => /ยกเลิก|cancel/i.test(String(s || ''))

async function compare() {
  const archiveId = (process.env.ARCHIVE_SHEET_ID || '').trim()
  if (!archiveId) throw new Error('ยังไม่ได้ตั้ง ARCHIVE_SHEET_ID ใน .env')
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, ''),
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const api = google.sheets({ version: 'v4', auth })
  const titles = async (id) => (await api.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' })).data.sheets.map((s) => s.properties.title)
  const mainTitles = new Set(await titles(process.env.SHEET_ID))
  const arcTitles = (await titles(archiveId)).filter((t) => t.startsWith('raw_orders_')).sort()
  const stray = (await titles(archiveId)).filter((t) => !t.startsWith('raw_orders_'))
  if (stray.length) console.log('แท็บอื่นในไฟล์เก็บ (ไม่ถูกอ่าน):', stray.join(', '))
  const digest = (values) => {
    const h = createHash('sha256')
    for (const row of values) {
      const cells = row.map((c) => String(c ?? ''))
      while (cells.length && cells[cells.length - 1] === '') cells.pop() // ช่องว่างท้ายแถวไม่นับ
      h.update(JSON.stringify(cells) + '\n')
    }
    return h.digest('hex').slice(0, 16)
  }
  let ok = true
  for (const t of arcTitles) {
    const read = async (id) => (await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${t}'!A:Z` })).data.values || []
    const arc = await read(archiveId)
    if (!mainTitles.has(t)) { console.log(`ARCHIVE-ONLY ${t}  ${arc.length - 1} แถว  (ไฟล์หลักไม่มีแล้ว)`); continue }
    const main = await read(process.env.SHEET_ID)
    const same = main.length === arc.length && digest(main) === digest(arc)
    if (!same) ok = false
    console.log(`${same ? 'MATCH' : 'DIFF '} ${t}  หลัก ${main.length - 1} แถว / เก็บ ${arc.length - 1} แถว`)
  }
  console.log(ok ? '\nผล: ตรงทุกแท็บ' : '\nผล: มีแท็บไม่ตรง — ห้ามลบแท็บในไฟล์หลัก')
}

async function totals() {
  const meta = await getMeta()
  const tabs = meta.sheets.filter((s) => s.properties.title.startsWith('raw_orders')).sort((a, b) => a.properties.title.localeCompare(b.properties.title))
  const vr = await batchGetValues(tabs.map((s) => `${s.properties.title}!L:N`))
  let all = 0
  tabs.forEach((s, i) => {
    const rows = (vr[i].values || []).slice(1)
    let rev = 0, units = 0
    for (const r of rows) if (!isCancelled(r[2])) { rev += num(r[1]); units += parseInt(r[0], 10) || 0 }
    all += rev
    console.log(`${s.properties.title}${s.properties.archived ? ' (เก็บ)' : ''}\t${rows.length}\t${rev.toFixed(2)}\t${units}`)
  })
  console.log(`รวม\t\t${all.toFixed(2)}`)
}

await (mode === 'totals' ? totals() : compare())
