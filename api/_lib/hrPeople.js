// ข้อมูลพนักงาน / ผู้สมัครงาน — อ่านอย่างเดียวจาก Google Form -> Google Sheet
//
// เก็บ PII (เลขบัตร ปชช, ทะเบียนบ้าน, ที่อยู่) จึง "ห้าม" อยู่ใน mona-ops-db ตัวหลักที่ยังเปิด
// link-public — ใช้ spreadsheet แยกต่างหาก ระบุด้วย env HR_SHEET_ID (ไม่ตั้ง = หน้าเว็บโชว์ขั้นตอน
// ติดตั้งแทน ไม่ error). รูปบัตร/ทะเบียนบ้านที่อัปโหลดผ่านฟอร์มอยู่ใน Google Drive ของเจ้าของฟอร์ม —
// เซลล์จะเก็บเป็น URL เฉยๆ ฝั่งเว็บทำเป็นลิงก์ให้กด (boss เปิดด้วย Google session ตัวเอง) ไม่ต้องใช้
// Drive API และ service account ไม่ต้องเห็นไฟล์
//
// gate: dev + boss เท่านั้น (ทำใน sheet-tools.js ก่อนเรียกเข้ามา)
import { getExternalSheet } from './sheets.js'

const HR_SHEET_ID = () => (process.env.HR_SHEET_ID || '').trim()
const TAB = {
  employees: (process.env.HR_EMP_TAB || 'employees').trim(),
  applicants: (process.env.HR_APPLICANT_TAB || 'applicants').trim(),
}

const isEmptyRow = (row) => !row.some((cell) => String(cell ?? '').trim() !== '')

export default async function opHrPeople(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const view = TAB[req.query.view] ? req.query.view : 'employees'
  const sheetId = HR_SHEET_ID()
  if (!sheetId) {
    return res.status(200).json({ success: true, configured: false, view, headers: [], rows: [], count: 0 })
  }

  try {
    const values = await getExternalSheet(sheetId, `${TAB[view]}!A:Z`)
    const [headers = [], ...dataRows] = values
    const cleanHeaders = headers.map((h) => String(h ?? '').trim())
    const rows = dataRows
      .filter((row) => !isEmptyRow(row))
      .map((row, i) => {
        const obj = { __row: i + 2 }
        cleanHeaders.forEach((h, idx) => { obj[h || `col${idx + 1}`] = String(row[idx] ?? '').trim() })
        return obj
      })
      .reverse() // ฟอร์มต่อท้ายตามเวลา -> ล่าสุดขึ้นก่อน
    res.setHeader('Cache-Control', 'private, max-age=0, no-store')
    return res.status(200).json({
      success: true,
      configured: true,
      view,
      headers: cleanHeaders.map((h, idx) => h || `col${idx + 1}`),
      rows,
      count: rows.length,
    })
  } catch (e) {
    console.error('opHrPeople:', e.message)
    const notFound = /Unable to parse range|not found/i.test(e.message || '')
    return res.status(notFound ? 200 : 500).json({
      success: notFound,
      configured: true,
      view,
      headers: [],
      rows: [],
      count: 0,
      error: notFound ? `ยังไม่พบแท็บ "${TAB[view]}" ใน HR spreadsheet` : e.message,
    })
  }
}
