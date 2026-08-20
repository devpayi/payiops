// GET /api/sheet-tools?op=demographic&view=province — สรุปยอดขายตามจังหวัด จาก raw_orders_* (คอลัมน์ province)
// dev/boss/marketing เท่านั้น — เหมือน pattern ของ cfo.js
// D:S = date(0) ... qty(8) revenue(9) order_status(10) ... province(15)
import { getMetaCached, batchGetValues } from './sheets.js'

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const isCancelled = (s = '') => String(s).includes('ยกเลิก') || String(s).toLowerCase().includes('cancel')

export default async function opDemographic(req, res) {
  try {
    const meta = await getMetaCached()
    const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
    if (!tabs.length) return res.status(200).json({ success: true, provinces: [], totalOrders: 0, withProvince: 0 })

    const vr = await batchGetValues(tabs.map((t) => `${t}!D:S`))
    const byProvince = new Map()
    let totalOrders = 0, withProvince = 0

    for (let i = 0; i < tabs.length; i++) {
      const rows = vr[i].values || []
      for (let j = 1; j < rows.length; j++) {
        const r = rows[j] || []
        const date = r[0]
        const qty = num(r[8])
        const status = r[10]
        const province = String(r[15] || '').trim()
        if (!date || isCancelled(status)) continue
        totalOrders++
        if (!province) continue
        withProvince++
        const p = byProvince.get(province) || { province, orders: 0, units: 0 }
        p.orders++
        p.units += qty
        byProvince.set(province, p)
      }
    }

    const provinces = [...byProvince.values()].sort((a, b) => b.orders - a.orders)
    return res.status(200).json({ success: true, provinces, totalOrders, withProvince })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
