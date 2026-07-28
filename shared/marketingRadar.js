export const MARKETING_DECISIONS = Object.freeze({
  scale: 'ทำต่อ',
  iterate: 'ปรับใหม่',
  stop: 'หยุด',
  wait: 'รอข้อมูล',
  manual: 'Boss ตรวจเอง',
})

const round1 = (value) => Math.round(value * 10) / 10

export function calculateUnitLift(beforeUnits, beforeDays, afterUnits, afterDays) {
  const beforeDaily = Number(beforeUnits || 0) / Math.max(1, Number(beforeDays || 0))
  const afterDaily = Number(afterUnits || 0) / Math.max(1, Number(afterDays || 0))
  const lift = beforeDaily > 0 ? Math.round(((afterDaily - beforeDaily) / beforeDaily) * 100) : null
  return { beforeDaily: round1(beforeDaily), afterDaily: round1(afterDaily), lift }
}

export function recommendMarketingAction({
  before,
  after,
  reviewDay = 7,
  complete = false,
  overlap = false,
}) {
  const rates = calculateUnitLift(before?.units, before?.days, after?.units, after?.days)
  const lowSample = Number(before?.units || 0) < 10 || Number(before?.activeDays || 0) < 3
  const confidence = overlap || lowSample ? 'low' : 'normal'

  if (!complete) {
    return {
      code: 'wait',
      label: MARKETING_DECISIONS.wait,
      confidence,
      ...rates,
      reason: `รอข้อมูลให้ครบ ${reviewDay} วัน`,
    }
  }

  if (rates.lift === null) {
    return {
      code: 'manual',
      label: MARKETING_DECISIONS.manual,
      confidence: 'low',
      ...rates,
      reason: 'ช่วงก่อนเปลี่ยนไม่มียอดขายสำหรับเทียบ',
    }
  }

  const code = rates.lift >= 15 ? 'scale' : rates.lift <= -10 ? 'stop' : 'iterate'
  const direction = rates.lift >= 0 ? `เพิ่ม ${rates.lift}%` : `ลด ${Math.abs(rates.lift)}%`
  const caveat = overlap
    ? ' · มีการเปลี่ยนแปลงซ้อน Boss ต้องรีเช็ก'
    : lowSample
      ? ' · ฐานข้อมูลน้อย Boss ควรรีเช็ก'
      : ''

  return {
    code,
    label: MARKETING_DECISIONS[code],
    confidence,
    ...rates,
    reason: `เฉลี่ย ${rates.beforeDaily} → ${rates.afterDaily} ชิ้น/วัน (${direction})${caveat}`,
  }
}
