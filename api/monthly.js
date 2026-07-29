// GET /api/monthly?year=2026
// สรุปยอดขาย/ออเดอร์ แยกรายเดือน และแยกร้าน (business × platform) จาก raw_orders_*
import { requireAuth, cacheable } from './_lib/auth.js'
import { getMetaCached, batchGetValues } from './_lib/sheets.js'

const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
const isReturned = (s = '') => s.toLowerCase().includes('return')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const round2 = (n) => Math.round(n * 100) / 100
const platShort = (p) => String(p || '').replace(' Shop', '')

// เหตุผลเดียวกับ dashboard.js — cacheable() บังคับ no-store ตอนเปิด auth เลย cache ในหน่วยความจำแทน CDN
const monthlyCache = new Map()
const MONTHLY_CACHE_MS = 300000

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const year = String(req.query.year || '').trim()

  const cached = monthlyCache.get(year)
  if (cached && Date.now() - cached.at < MONTHLY_CACHE_MS) {
    res.setHeader('Cache-Control', cacheable('public, s-maxage=300, stale-while-revalidate=1800'))
    return res.status(200).json(cached.data)
  }

  try {
    const meta = await getMetaCached()
    const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
    // B:F = order_id, order_item_id, date, platform, business ; L:N = qty, revenue, status
    const ranges = tabs.flatMap((t) => [`${t}!B:F`, `${t}!L:N`])
    const vr = await batchGetValues(ranges)

    const trend = new Map()        // 'YYYY-MM' -> { sales, units, orderIds:Set }
    const store = new Map()        // 'YYYY-MM' -> Map(storeKey -> { business, platform, sales, units, orderIds:Set })
    const yearsSet = new Set()
    let latestDate = null          // วันที่ล่าสุดจริงในข้อมูลทั้งหมด (ไม่ผูก year filter) — ใช้เช็คว่าเดือนล่าสุดข้อมูลครบเดือนหรือยัง
    // แต่ละร้าน (business×platform) อัพไฟล์คนละวันกัน — เก็บวันล่าสุดจริงแยกรายร้านต่อเดือน
    // ไม่ใช้ latestDay ตัวเดียวรวมทุกร้าน เพราะร้านที่อัพช้ากว่าจะโดนเทียบกับเดือนก่อนแบบไม่แฟร์ (นับวันเกินที่ร้านนั้นมีจริง)
    const storeMonthMaxDay = new Map() // `${storeKey}|${ym}` -> maxDay

    for (let i = 0; i < tabs.length; i++) {
      const left = vr[2 * i].values || []
      const right = vr[2 * i + 1].values || []
      const n = Math.max(left.length, right.length)
      for (let j = 1; j < n; j++) {
        const l = left[j] || [], r = right[j] || []
        const orderId = l[0], date = l[2], platform = l[3] || '', business = l[4] || ''
        const qty = parseInt(r[0], 10) || 0, rev = num(r[1]), status = r[2]
        if (!date) continue
        if (!latestDate || date > latestDate) latestDate = date
        // จำนวนออเดอร์นับรวมยกเลิก/ตีคืน (งานแพ็คเกิดขึ้นแล้ว) ยอดขาย/จำนวนชิ้นไม่นับ
        const excluded = isCancelled(status) || isReturned(status)
        const ym = String(date).slice(0, 7)
        const key = `${business} ${platShort(platform)}`
        const day = Number(date.slice(8, 10))
        const mmKey = `${key}|${ym}`
        if (day > (storeMonthMaxDay.get(mmKey) || 0)) storeMonthMaxDay.set(mmKey, day)
        yearsSet.add(String(date).slice(0, 4))
        if (year && !ym.startsWith(year)) continue

        let t = trend.get(ym)
        if (!t) trend.set(ym, (t = { sales: 0, units: 0, orderIds: new Set() }))
        if (orderId) t.orderIds.add(orderId)
        if (!excluded) { t.sales += rev; t.units += qty }

        let sm = store.get(ym)
        if (!sm) store.set(ym, (sm = new Map()))
        let s = sm.get(key)
        if (!s) sm.set(key, (s = { store: key, business, platform, sales: 0, units: 0, orderIds: new Set() }))
        if (orderId) s.orderIds.add(orderId)
        if (!excluded) { s.sales += rev; s.units += qty }
      }
    }

    // ---- partial-month fairness: ถ้าเดือนล่าสุดข้อมูลยังไม่ครบเดือน (เช่น อัพแค่ 1-19) ----
    // %MoM เทียบเต็มเดือนก่อนหน้าจะดูตกหนักเกินจริงเพราะเทียบวันไม่เท่ากัน (19 วัน vs 30 วัน)
    // สแกนรอบสองจำกัดแค่เดือนก่อนหน้า นับเฉพาะวันที่ 1..latestDay ให้เทียบกันแบบวันเท่ากัน (fair pace)
    let partialMonth = null
    if (latestDate) {
      const latestMonth = latestDate.slice(0, 7)
      const latestDay = Number(latestDate.slice(8, 10))
      const [ly, lm] = latestMonth.split('-').map(Number)
      const daysInLatestMonth = new Date(Date.UTC(ly, lm, 0)).getUTCDate()
      // ข้ามถ้า year filter ตัดเดือนล่าสุดออกไปแล้ว (partialMonth ต้องอยู่ในช่วงที่ frontend เห็นจริง)
      if (latestDay < daysInLatestMonth && (!year || latestMonth.startsWith(year))) {
        const pd = new Date(Date.UTC(ly, lm - 2, 1))
        const prevMonth = `${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, '0')}`
        const prevTrend = { sales: 0, units: 0, orderIds: new Set() }
        const prevStore = new Map()
        for (let i = 0; i < tabs.length; i++) {
          const left = vr[2 * i].values || []
          const right = vr[2 * i + 1].values || []
          const n = Math.max(left.length, right.length)
          for (let j = 1; j < n; j++) {
            const l = left[j] || [], r = right[j] || []
            const orderId = l[0], date = l[2], platform = l[3] || '', business = l[4] || ''
            const qty = parseInt(r[0], 10) || 0, rev = num(r[1]), status = r[2]
            if (!date || date.slice(0, 7) !== prevMonth) continue
            const key = `${business} ${platShort(platform)}`
            // ร้านนี้ต้องมีข้อมูลเดือนล่าสุดจริงก่อนถึงจะนับเทียบได้ — cap ตามวันล่าสุดที่ "ร้านนี้" มีจริง ไม่ใช่วันล่าสุดรวมทุกร้าน
            const storeCapDay = storeMonthMaxDay.get(`${key}|${latestMonth}`) || 0
            if (storeCapDay === 0) continue
            if (Number(date.slice(8, 10)) > storeCapDay) continue
            const excluded = isCancelled(status) || isReturned(status)
            if (orderId) prevTrend.orderIds.add(orderId)
            if (!excluded) { prevTrend.sales += rev; prevTrend.units += qty }
            let s = prevStore.get(key)
            if (!s) prevStore.set(key, (s = { store: key, business, platform, sales: 0, units: 0, orderIds: new Set(), capDay: storeCapDay }))
            if (orderId) s.orderIds.add(orderId)
            if (!excluded) { s.sales += rev; s.units += qty }
          }
        }
        partialMonth = {
          month: latestMonth,
          latestDay,
          daysInMonth: daysInLatestMonth,
          prevMonthCapped: {
            month: prevMonth,
            trend: { sales: round2(prevTrend.sales), orders: prevTrend.orderIds.size, units: prevTrend.units },
            byStore: [...prevStore.values()].map((s) => ({ store: s.store, business: s.business, platform: s.platform, sales: round2(s.sales), orders: s.orderIds.size, units: s.units, capDay: s.capDay })),
          },
        }
      }
    }

    const trendArr = [...trend.entries()]
      .map(([month, v]) => ({ month, sales: round2(v.sales), orders: v.orderIds.size, units: v.units }))
      .sort((a, b) => a.month.localeCompare(b.month))

    const byStore = {}
    for (const [ym, sm] of store.entries()) {
      byStore[ym] = [...sm.values()]
        .map((s) => ({ store: s.store, business: s.business, platform: s.platform, sales: round2(s.sales), orders: s.orderIds.size, units: s.units }))
        .sort((a, b) => b.sales - a.sales)
    }

    const data = {
      success: true,
      year: year || null,
      years: [...yearsSet].sort(),
      months: trendArr.map((t) => t.month),
      trend: trendArr,
      byStore,
      partialMonth,
    }
    monthlyCache.set(year, { data, at: Date.now() })
    res.setHeader('Cache-Control', cacheable('public, s-maxage=300, stale-while-revalidate=1800'))
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
