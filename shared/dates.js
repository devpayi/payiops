// แปลงวันที่จากไฟล์ import (Excel มีหลายรูปแบบ: dd/mm/yyyy, yyyy-m-d ไม่ใส่ 0 นำหน้า, ISO มี T ฯลฯ)
// ให้เป็น YYYY-MM-DD เสมอ — ใช้ร่วมกันทั้ง api/import-orders.js และ Upload.jsx (ผ่าน shared/orderLines.js) กันวันที่ไม่ตรงรูปแบบ
// แล้วพังตอนกรองช่วงวันที่ (string compare) หรือ group by เดือน (slice ตำแหน่งคงที่) ที่หน้าอื่นๆ ทำกันอยู่
export function isoDate(v) {
  let s = String(v ?? '').trim()
  if (!s) return ''
  if (s.includes('T')) return s.slice(0, 10)
  // dd/mm/yyyy หรือ yyyy-mm-dd
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`
  const dash = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (dash) return `${dash[1]}-${dash[2].padStart(2, '0')}-${dash[3].padStart(2, '0')}`
  // Excel serial date (เลขล้วน) — เกิดตอน sheet_to_json อ่านเซลล์ date type แบบ raw โดยไม่แปลงเป็นข้อความก่อน
  // เลขวันที่ตั้งแต่ปี ~1990-2100 จะอยู่ในช่วง 30000-75000 เป็นด่านกันไม่ให้เผลอตีความตัวเลขอื่นเป็นวันที่
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (serial > 30000 && serial < 75000) {
      const d2 = new Date(Math.round((serial - 25569) * 86400000))
      if (!isNaN(d2)) return d2.toISOString().slice(0, 10)
    }
    return ''
  }
  const d = new Date(s)
  return isNaN(d) ? '' : d.toISOString().slice(0, 10)
}
