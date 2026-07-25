// /api/marketing?kind=events|inputs|basket — รวม endpoint การตลาดเดิม
// (/api/marketing-events และ /api/marketing-inputs) เป็นฟังก์ชันเดียว
// เพราะ Vercel Hobby จำกัด 12 serverless functions ต่อโปรเจค
// ตัว implementation จริงอยู่ใน api/_lib/marketingEvents.js / marketingInputs.js / marketingBasket.js
// (แต่ละตัวมี requireAuth ของตัวเองอยู่แล้ว)
import eventsHandler from './_lib/marketingEvents.js'
import inputsHandler from './_lib/marketingInputs.js'
import basketHandler from './_lib/marketingBasket.js'

export default async function handler(req, res) {
  const kind = String(req.query.kind || 'events')
  if (kind === 'inputs') return inputsHandler(req, res)
  if (kind === 'basket') return basketHandler(req, res)
  return eventsHandler(req, res)
}
