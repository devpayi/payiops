// ข้อมูลพนักงาน / ผู้สมัครงาน
//
// อ่าน: อ่านอย่างเดียวจาก Google Form -> Google Sheet (employees, applicants) หรือจากฟอร์มเว็บ
// มือถือของเราเอง (applicants_full, ดู opSubmitApplicant ด้านล่าง)
//
// เก็บ PII (เลขบัตร ปชช, ทะเบียนบ้าน, ที่อยู่) จึง "ห้าม" อยู่ใน mona-ops-db ตัวหลักที่ยังเปิด
// link-public — ใช้ spreadsheet แยกต่างหาก ระบุด้วย env HR_SHEET_ID (ไม่ตั้ง = หน้าเว็บโชว์ขั้นตอน
// ติดตั้งแทน ไม่ error). รูปบัตร/ทะเบียนบ้านที่อัปโหลดผ่านฟอร์มอยู่ใน Google Drive ของเจ้าของฟอร์ม —
// เซลล์จะเก็บเป็น URL เฉยๆ ฝั่งเว็บทำเป็นลิงก์ให้กด (boss เปิดด้วย Google session ตัวเอง) ไม่ต้องใช้
// Drive API และ service account ไม่ต้องเห็นไฟล์
//
// gate สำหรับอ่าน (view=): dev + boss เท่านั้น (ทำใน sheet-tools.js ก่อนเรียกเข้ามา)
// opSubmitApplicant (เขียน): ตั้งใจเปิดสาธารณะแบบเดียวกับ Google Form เดิม — ไม่มี requireAuth
// (ดู route ใน sheet-tools.js, เช็คก่อนถึง requireAuth เหมือน line-webhook) เพราะผู้สมัครงาน
// ไม่มีบัญชีในระบบ ไม่เก็บรูป/ไฟล์ใดๆ (owner ตัดสินใจ 2026-09-11 — เก็บแค่ข้อความ ไม่เสี่ยงเรื่อง
// พื้นที่เก็บไฟล์ฟรีไม่มี/ความเป็นส่วนตัวของรูปบัตร)
import { getExternalSheet, ensureExternalSheet, appendExternalRows } from './sheets.js'

const HR_SHEET_ID = () => (process.env.HR_SHEET_ID || '').trim()
const TAB = {
  employees: (process.env.HR_EMP_TAB || 'employees').trim(),
  applicants: (process.env.HR_APPLICANT_TAB || 'applicants').trim(),
  applicants_full: (process.env.HR_APPLICANT_FULL_TAB || 'applicants_full').trim(),
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

// ===== ฟอร์มสมัครงานแบบเต็ม (public/apply.html) — เขียนเข้า applicants_full =====
// key ตรงกับที่ apply.html ส่งมาใน JSON body, label = หัวคอลัมน์ภาษาไทยในชีต (ลำดับนี้คือลำดับคอลัมน์
// จริง เพิ่ม field ใหม่ให้ต่อท้ายลิสต์เสมอ ห้ามแทรกกลาง — กฎเดียวกับทุกชีตในระบบนี้)
export const APPLICANT_FULL_FIELDS = [
  ['position', 'ตำแหน่งงานที่สมัคร'],
  ['expected_salary', 'เงินเดือนที่ต้องการ'],
  ['available_date', 'วันที่เริ่มงานได้'],
  ['current_status', 'สถานภาพการทำงานปัจจุบัน'],
  ['documents_ready', 'เอกสารที่เตรียมมา'],
  ['title', 'คำนำหน้า'],
  ['full_name', 'ชื่อ-นามสกุล'],
  ['nickname', 'ชื่อเล่น'],
  ['age', 'อายุ'],
  ['birth_date', 'วันเดือนปีเกิด'],
  ['nationality', 'สัญชาติ'],
  ['ethnicity', 'เชื้อชาติ'],
  ['religion', 'ศาสนา'],
  ['hometown', 'ภูมิลำเนาเดิม'],
  ['siblings', 'จำนวนพี่น้อง'],
  ['birth_order', 'เป็นบุตรคนที่'],
  ['address', 'ที่อยู่ปัจจุบัน'],
  ['sub_district', 'ตำบล/แขวง'],
  ['district', 'อำเภอ/เขต'],
  ['province', 'จังหวัด'],
  ['postal_code', 'รหัสไปรษณีย์'],
  ['home_phone', 'โทรศัพท์บ้าน'],
  ['mobile_phone', 'โทรศัพท์มือถือ'],
  ['email', 'Email'],
  ['residence_type', 'ประเภทที่อยู่อาศัย'],
  ['residence_years', 'อาศัยมาแล้ว (ปี)'],
  ['marital_status', 'สถานภาพครอบครัว'],
  ['spouse_name', 'ชื่อคู่สมรส'],
  ['spouse_occupation', 'อาชีพคู่สมรส'],
  ['children_count', 'จำนวนบุตร'],
  ['father_name', 'ชื่อบิดา'],
  ['father_status', 'สถานะบิดา'],
  ['father_occupation', 'อาชีพบิดา'],
  ['father_address', 'ที่อยู่/จังหวัดบิดา'],
  ['mother_name', 'ชื่อมารดา'],
  ['mother_status', 'สถานะมารดา'],
  ['mother_occupation', 'อาชีพมารดา'],
  ['mother_address', 'ที่อยู่/จังหวัดมารดา'],
  ['military_status', 'สถานะทางการทหาร'],
  ['education_level', 'วุฒิการศึกษาที่ใช้สมัคร'],
  ['education_history', 'ประวัติการศึกษา'],
  ['education_activities', 'กิจกรรม/รางวัลระหว่างการศึกษา'],
  ['favorite_subject', 'สาขาที่ชอบเป็นพิเศษ'],
  ['work_history', 'ประวัติการทำงาน'],
  ['english_speak', 'ภาษาอังกฤษ (พูด)'],
  ['english_read', 'ภาษาอังกฤษ (อ่าน)'],
  ['english_write', 'ภาษาอังกฤษ (เขียน)'],
  ['other_language', 'ภาษาอื่นๆ'],
  ['office_skills', 'ความสามารถใช้เครื่องใช้สำนักงาน'],
  ['computer_level', 'ความสามารถใช้คอมพิวเตอร์'],
  ['computer_programs', 'โปรแกรมที่ใช้ได้'],
  ['reference_name', 'บุคคลอ้างอิง (ชื่อ/ความสัมพันธ์)'],
  ['reference_occupation', 'บุคคลอ้างอิง (อาชีพ)'],
  ['reference_phone', 'บุคคลอ้างอิง (เบอร์โทร)'],
  ['heard_from', 'ทราบข่าวการสมัครงานจาก'],
  ['confirmed', 'ยืนยันข้อมูลถูกต้อง'],
]
const APPLICANT_FULL_HEADERS = ['ประทับเวลา', ...APPLICANT_FULL_FIELDS.map(([, label]) => label)]

const MAX_LEN = 4000 // กันช่องยาวผิดปกติ (เช่น JSON ประวัติการศึกษา/ทำงานหลายแถว)
const clean = (v) => String(v ?? '').trim().slice(0, MAX_LEN)

// เบอร์โทร/รหัสไปรษณีย์ ขึ้นต้นด้วย 0 — Sheets (valueInputOption USER_ENTERED) ตีความสตริงตัวเลข
// ล้วนเป็นตัวเลขแล้วตัดเลข 0 นำหน้าทิ้ง (0812345678 -> 812345678) ต้องบังคับเป็นข้อความด้วย ' นำหน้า
const TEXT_FORCE_KEYS = new Set(['mobile_phone', 'home_phone', 'postal_code', 'reference_phone'])
const cleanField = (key, v) => {
  const s = clean(v)
  return TEXT_FORCE_KEYS.has(key) && /^\d+$/.test(s) ? `'${s}` : s
}

export async function opSubmitApplicant(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const sheetId = HR_SHEET_ID()
  if (!sheetId) return res.status(503).json({ success: false, error: 'ระบบยังไม่ได้ตั้งค่า (HR_SHEET_ID)' })

  const body = req.body || {}
  // กันสแปม/กรอกไม่ครบ ขั้นต่ำ — ไม่ต้องเข้มมาก เพราะฟอร์มสาธารณะเดิม (Google Form) ก็ไม่ได้เช็คอะไรเพิ่ม
  const fullName = clean(body.full_name)
  const phone = clean(body.mobile_phone)
  const position = clean(body.position)
  if (!fullName || !phone || !position) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อ-สกุล, เบอร์โทร, และตำแหน่งที่สมัคร' })
  }

  try {
    await ensureExternalSheet(sheetId, TAB.applicants_full, APPLICANT_FULL_HEADERS)
    const row = [new Date().toLocaleString('en-US'), ...APPLICANT_FULL_FIELDS.map(([key]) => cleanField(key, body[key]))]
    await appendExternalRows(sheetId, TAB.applicants_full, [row])
    return res.status(200).json({ success: true })
  } catch (e) {
    console.error('opSubmitApplicant:', e.message)
    return res.status(500).json({ success: false, error: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' })
  }
}
