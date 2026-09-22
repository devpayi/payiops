// ลบแถวของ import batch เดียวออกจาก raw_orders_* — สำรอง CSV ก่อนลบเสมอ
//
//   node --env-file=.env scripts/delete-import-batch.mjs IMP20260609-153226-RBZF6 raw_orders_2026_03
//   node --env-file=.env scripts/delete-import-batch.mjs IMP20260609-153226-RBZF6 raw_orders_2026_03 --apply
//
// ไม่ใส่ --apply = แค่ดูว่าจะลบกี่แถว + เขียนไฟล์สำรอง ยังไม่แตะชีต
//
// ทำไมต้องมีสคริปต์นี้ ทั้งที่ api/import-orders.js มี DELETE ?importId= อยู่แล้ว:
// endpoint นั้นหาแถวใน import_log ก่อน ไม่เจอ = 404 — ล็อตที่อัพก่อนระบบจะบันทึก log (หรือ log หาย)
// จึงลบผ่านหน้าเว็บไม่ได้ ต้องใช้ตัวนี้แทน
// ใช้ deleteDimension ไล่จากแถวล่างขึ้นบน (ลบจากบนลงล่างจะทำให้เลขแถวที่เหลือเลื่อน)
import { writeFileSync } from 'node:fs'
import { google } from 'googleapis'
import { getMetaCached, batchGetValues } from '../api/_lib/sheets.js'

const args = process.argv.slice(2).filter((a) => a !== '--apply')
const IMPORT_ID = args[0]
const TAB = args[1]
const APPLY = process.argv.includes('--apply')
if (!IMPORT_ID || !TAB) {
  console.error('ใช้: node --env-file=.env scripts/delete-import-batch.mjs <import_id> <tab> [--apply]')
  process.exit(1)
}

const meta = await getMetaCached()
const sheet = meta.sheets.find((s) => s.properties.title === TAB)
if (!sheet) throw new Error(`ไม่เจอแท็บ ${TAB}`)

const values = (await batchGetValues([`${TAB}!A:V`]))[0]?.values || []
const headers = values[0]
const hits = []
for (let i = 1; i < values.length; i++) {
  if ((values[i] || [])[16] === IMPORT_ID) hits.push({ rowNo: i + 1, row: values[i] })
}
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const total = hits.reduce((s, h) => s + (/ยกเลิก|cancel/i.test(String(h.row[13])) ? 0 : num(h.row[12])), 0)
console.log(`เจอ ${hits.length} แถว (import_id=${IMPORT_ID}) ใน ${TAB} | ยอดไม่ยกเลิกรวม ${total.toLocaleString()} บาท`)
console.log(`แถวที่ ${hits[0]?.rowNo} ถึง ${hits[hits.length - 1]?.rowNo}`)

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const backup = `reports/backup-${IMPORT_ID}.csv`
writeFileSync(backup, '﻿' + [['__row', ...headers].join(','), ...hits.map((h) => [h.rowNo, ...h.row].map(esc).join(','))].join('\n'), 'utf8')
console.log(`สำรองไว้ที่ ${backup}`)

if (!APPLY) { console.log('\n(ยังไม่ลบ — ใส่ --apply เพื่อลบจริง)'); process.exit(0) }

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, ''),
    private_key: (process.env.GOOGLE_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const api = google.sheets({ version: 'v4', auth })
const requests = hits
  .map((h) => h.rowNo)
  .sort((a, b) => b - a) // ล่างขึ้นบน
  .map((rowNo) => ({ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: rowNo - 1, endIndex: rowNo } } }))

await api.spreadsheets.batchUpdate({ spreadsheetId: process.env.SHEET_ID, requestBody: { requests } })
console.log(`ลบแล้ว ${requests.length} แถว`)

const after = (await batchGetValues([`${TAB}!A:V`]))[0]?.values || []
const left = after.slice(1).filter((r) => r[16] === IMPORT_ID).length
console.log(`ตรวจซ้ำ: เหลือแถวของ ${IMPORT_ID} อีก ${left} แถว | แถวทั้งหมดในแท็บ ${values.length - 1} → ${after.length - 1}`)
