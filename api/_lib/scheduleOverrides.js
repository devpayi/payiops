// override ที่บันทึกก่อนเวลานี้ถือเป็นของเก่า (bulk schedule import เดิม ไม่รู้จักพนักงานที่เพิ่มเข้าระบบทีหลัง) —
// override ที่บันทึก "ตั้งแต่ตอนนี้เป็นต้นไป" ถือว่ารู้จักทุกคนในระบบแล้วเสมอ ใช้บังคับได้เต็มที่ทั้งเพิ่ม/ถอน
const LEGACY_OVERRIDE_CUTOFF = '2026-08-04T10:16:00.000Z'
// คนที่ override เก่า (ก่อน cutoff ด้านบน) ไม่สะท้อนความจริงปัจจุบันอีกต่อไป — ยกเว้นให้ override เก่าไม่มีสิทธิ์ตัดสินใจ
// เรื่องพวกเขาอีก (ทั้งเพิ่ม/ลบเข้าออกจากตาราง) ปล่อยให้ตารางพื้นฐาน + วันหยุดประจำปัจจุบันตัดสินใจแทน สองเคสที่เจอจริง:
// (1) พนักงานใหม่ ไม่เคยมีชื่ออยู่ใน override เก่าเลยสักวัน — ถ้าปล่อยให้ override เก่าลบเขาออกไปด้วย จะไม่โผล่ในปฏิทิน
//     เลยทุกวันที่มี override เก่าทับอยู่ (เจอจริง 2026-08-04 กรณี "ไม้" หายทั้ง 5 เดือน)
// (2) พนักงานเก่าที่เพิ่งเปลี่ยนวันหยุดประจำ — วันหยุดเดิมถูก "ฝัง" อยู่ใน override เก่าทุกวันข้างหน้าแล้ว (ไม่ได้อยู่ใน
//     ทุก entries_json ของวันที่ตรงวันหยุดเดิม) เปลี่ยนวันหยุดในระบบแล้วก็ยังไม่มีผลกับวันหยุดเดิม เพราะ override เก่า
//     ยังตัดเขาออกจากวันนั้นตามความจริงเดิมอยู่ดี (เจอจริง 2026-08-04 กรณี "เกด" เปลี่ยนวันหยุดจันทร์เป็นอังคาร แต่ยัง
//     หายทุกวันจันทร์เหมือนเดิม)
// ทำแบบ hardcode ตรงจุดเหมือน SKU_REDIRECTS ใน planner-sales.js ถ้าเจอบ่อยขึ้นค่อยย้ายเป็นชีตแทน ไม่กระทบ override
// ใหม่ (>= cutoff) — เพิ่ม/ถอนคนกลุ่มนี้ผ่านตารางกะตามปกติได้เต็มที่เหมือนคนอื่น
export const LEGACY_OVERRIDE_EXEMPT_CODES = new Set(['ไม้', 'KED'])
// เหมือน isFixedDayOff ใน sheet-tools.js (คัดลอกมาเพราะไฟล์นี้เป็น pure module แยก ไม่ import ข้ามกัน) — เช็ควันหยุด
// ประจำสัปดาห์ของคนนั้นตรงกับวันที่นี้ไหม
const isFixedDayOff = (dayOffMap, code, date) => {
  const entry = dayOffMap[code]
  if (!entry) return false
  if (entry.from && date < entry.from) return false
  return String(new Date(`${date}T00:00:00`).getDay()) === entry.weekday
}

export function applyScheduleOverrides({ baseRows = [], overrideRows = [], personMap = {}, overrideScopeCodes = Object.keys(personMap), officeCodes = [], dayOffMap = {} }) {
  const latestByDate = new Map()
  for (const row of overrideRows) {
    const date = String(row.date || '')
    if (!date) continue
    const previous = latestByDate.get(date)
    if (!previous || String(row.updated_at || '') >= String(previous.updated_at || '')) latestByDate.set(date, row)
  }
  if (!latestByDate.size) return [...baseRows]

  const baseScope = new Set(overrideScopeCodes.map((code) => String(code).toUpperCase()))
  const officeSet = new Set(officeCodes.map((code) => String(code).toUpperCase()))
  // ออฟฟิศเพิ่งเริ่มแก้ผ่านตัวนี้ได้ — override เก่าที่เคยบันทึกไว้ก่อนหน้า (ไม่มีโค้ดออฟฟิศติดมาด้วยเลย) ไม่ควรลบแถวออฟฟิศเดิมทิ้ง
  // ถือว่า override วันนั้น "แตะออฟฟิศ" ก็ต่อเมื่อมีโค้ดออฟฟิศอยู่ใน entries จริงๆ เท่านั้น กันย้อนหลังพังของเก่า
  const overrideTouchesOffice = new Map()
  for (const [date, override] of latestByDate) {
    let entries = []
    try { entries = JSON.parse(override.entries_json || '[]') } catch { entries = [] }
    const codes = (Array.isArray(entries) ? entries : []).map((entry) => String(entry?.code || '').toUpperCase())
    overrideTouchesOffice.set(date, codes.some((code) => officeSet.has(code)))
  }
  const result = baseRows.filter((row) => {
    const date = String(row.date || '')
    if (!latestByDate.has(date)) return true
    const code = String(row.code || '').toUpperCase()
    const isLegacyOverride = String(latestByDate.get(date)?.updated_at || '') < LEGACY_OVERRIDE_CUTOFF
    if (isLegacyOverride && LEGACY_OVERRIDE_EXEMPT_CODES.has(code)) return true
    const inScope = baseScope.has(code) || (officeSet.has(code) && overrideTouchesOffice.get(date))
    return !inScope
  })
  for (const [date, override] of latestByDate) {
    let entries = []
    try { entries = JSON.parse(override.entries_json || '[]') } catch { entries = [] }
    const seen = new Set()
    for (const entry of Array.isArray(entries) ? entries : []) {
      const code = String(entry?.code || '').toUpperCase()
      const person = personMap[code]
      if (!person || seen.has(code)) continue
      // วันหยุดประจำชนะ override เสมอ ไม่ว่า override จะบันทึกก่อนหรือหลังตั้งวันหยุดก็ตาม — เดิมให้ override
      // ใหม่ทับวันหยุดได้ (ไว้เผื่อเรียกมาทำงานพิเศษ) แต่ตัว editor ตารางกะ (ScheduleDayEditor) ติ๊กช่องคนที่เคย
      // ทำงานวันนั้นไว้ล่วงหน้าเป็นค่าเริ่มต้นเสมอ (ไม่รู้เรื่องวันหยุดที่เพิ่งตั้ง) พอบอสแก้วันนั้นด้วยเรื่องอื่น (เช่น
      // ถอนคนอื่นออก) ก็ดันเผลอ resave ให้คนที่เพิ่งตั้งวันหยุดยังติดอยู่ในตารางไปด้วยทุกครั้ง (เจอจริง 2026-08-04
      // กรณีเกด ตั้งวันหยุดอังคารแล้วไม่มีผล) ยังไม่เคยมีการใช้ "เรียกมาทำงานวันหยุด" จริงจากข้อมูลจริง เลยตัดออกไปก่อน
      if (isFixedDayOff(dayOffMap, code, date)) continue
      seen.add(code)
      result.push({ id: `override-${date}-${code}`, date, employee: person[0], code, group: person[1], fraction: 1, source: 'override' })
    }
  }
  return result
}
