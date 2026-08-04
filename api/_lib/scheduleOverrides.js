export function applyScheduleOverrides({ baseRows = [], overrideRows = [], personMap = {}, overrideScopeCodes = Object.keys(personMap), officeCodes = [] }) {
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
  // วันแรกที่แต่ละคนเคยถูกระบุอยู่ใน override จริง (ทุกวันที่มีการแก้ ไม่ใช่แค่ latestByDate) — พนักงานใหม่ที่เพิ่งเพิ่มเข้าระบบ
  // ทีหลัง ไม่เคยมีชื่ออยู่ใน override เก่าที่บันทึกไว้ก่อนหน้าเลยสักวัน (override เก่าไม่รู้จักเขาด้วยซ้ำตอนนั้น) — ถ้าปล่อยให้
  // override เก่านั้นลบเขาออกจากปฏิทินไปด้วย เขาจะไม่โผล่ในปฏิทินเลยทุกวันที่มี override ทับอยู่ (เจอจริง 2026-08-04 กรณี "ไม้")
  const firstAppearanceDate = {}
  for (const row of overrideRows) {
    const date = String(row.date || '')
    if (!date) continue
    let entries = []
    try { entries = JSON.parse(row.entries_json || '[]') } catch { entries = [] }
    for (const entry of Array.isArray(entries) ? entries : []) {
      const code = String(entry?.code || '').toUpperCase()
      if (!code) continue
      if (!firstAppearanceDate[code] || date < firstAppearanceDate[code]) firstAppearanceDate[code] = date
    }
  }
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
    if (!firstAppearanceDate[code] || date < firstAppearanceDate[code]) return true
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
      seen.add(code)
      result.push({ id: `override-${date}-${code}`, date, employee: person[0], code, group: person[1], fraction: 1, source: 'override' })
    }
  }
  return result
}
