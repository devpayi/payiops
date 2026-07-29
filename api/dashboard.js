// GET /api/dashboard?business=&platform=&startDate=&endDate=
// สรุปข้อมูลสำหรับหน้า Executive จากทุก tab raw_orders_* (Google Sheets)
import { requireAuth, cacheable } from './_lib/auth.js'
import { getMetaCached, batchGetValues, getSheet } from './_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from './_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku } from './_lib/skuMapping.js'

const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
// "returned" ในภาษาอังกฤษเท่านั้น (ไม่ใช่ substring "คืน" ภาษาไทย) — สถานะ "ผู้ซื้อได้รับสินค้าแล้ว
// โปรดทราบว่าผู้ซื้อสามารถยื่นคำขอคืนเงิน/คืนสินค้าได้จนถึง..." เป็นออเดอร์ที่ส่งสำเร็จปกติ ยังไม่ได้คืนจริง
// ไม่ควรตัดออก ต่างจาก "returned"/"package returned" ที่คืนสำเร็จแล้วจริงๆ
const isReturned = (s = '') => s.toLowerCase().includes('return')
// จำนวนออเดอร์ = งานที่ทีมแพ็คต้องทำ นับรวมยกเลิก/ตีคืนด้วย (แพ็คไปแล้วก็คืองาน) — ต่างจากยอดขาย/
// จำนวนชิ้นที่ตัดยกเลิก/ตีคืนออก เพราะไม่ได้เป็นรายได้จริง
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const round2 = (n) => Math.round(n * 100) / 100

// อ่าน raw_orders ทั้งหมดช้า (~5-12s) — cache แบบ public Cache-Control ใช้ไม่ได้ตอนเปิด auth
// (cacheable() บังคับ no-store เพราะ response แต่ละคนไม่ควร cache ที่ CDN) จึงต้อง cache ในหน่วยความจำแทน
const dashboardCache = new Map()
// สั้นกว่าที่คิดไว้ตอนแรกโดยตั้งใจ — import-orders.js เป็นคนละ serverless function แยกกัน
// (บน Vercel แต่ละ api/*.js ไม่แชร์หน่วยความจำ) import ข้อมูลใหม่แล้วเรียกล้าง cache นี้ไม่ได้
// ตั้งยาวไปจะกลายเป็น "เพิ่งอัพโหลดแล้วทำไมไม่ขึ้น" แทน
const DASHBOARD_CACHE_MS = 180000

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { business = 'all', platform = 'all', startDate = '', endDate = '' } = req.query
  const inDate = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
  const keepBiz = (b) => business === 'all' || b === business
  const keepPlat = (p) => platform === 'all' || p === platform

  const cacheKey = `${business}|${platform}|${startDate}|${endDate}`
  const cached = dashboardCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DASHBOARD_CACHE_MS) {
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    return res.status(200).json(cached.data)
  }

  try {
    // override รายชื่อกลุ่มจาก product_aliases (เหมือน products.js/product-trends.js) — ไม่มีก็ข้าม
    let overrideMap = new Map()
    try { overrideMap = buildOverrideMap(await getSheet('product_aliases')) } catch { /* ไม่มี sheet — ใช้การ strip อัตโนมัติแทน */ }
    // sku_redirects/set_recipes แก้ได้จากชีทตรงๆ ไม่ต้องแก้โค้ด — ดู resolveSalesSku ตอนใช้งาน
    const [redirectMap, recipeKeySet] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet()])

    const meta = await getMetaCached()
    const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))

    // อ่าน B:F (order_id, order_item_id, date, platform, business) และ I:N (variation_name, master_sku,
    // display_name, qty, revenue, status) — variation_name ใช้เช็คว่าแถวนี้ตรง set_recipes (ปนโค้ด) ไหม
    const ranges = tabs.flatMap((t) => [`${t}!B:F`, `${t}!I:N`])
    const vr = await batchGetValues(ranges)

    // ---- PASS 1: หา distinct dates ที่ผ่าน filter เพื่อกำหนด "today / yesterday" ----
    const availableDateSet = new Set()
    const dateSet = new Set()
    // แต่ละร้าน (business×platform) อัพไฟล์คนละวันกัน — เก็บวันล่าสุดจริงแยกรายร้านต่อเดือน ใช้ cap
    // การเทียบเดือนก่อนหน้าให้ยุติธรรม (ร้านที่อัพช้ากว่าไม่ควรโดนเทียบเกินวันที่ตัวเองมีข้อมูลจริง)
    const storeMonthMaxDay = new Map() // `${biz}|${plat}|${ym}` -> maxDay
    for (let i = 0; i < tabs.length; i++) {
      const left = vr[2 * i].values || []
      for (let j = 1; j < left.length; j++) {
        const row = left[j]
        if (!row) continue
        const date = row[2], plat = row[3], biz = row[4]
        if (!date || !keepBiz(biz) || !keepPlat(plat)) continue
        availableDateSet.add(date)
        if (inDate(date)) dateSet.add(date)
        const mmKey = `${biz}|${plat}|${date.slice(0, 7)}`
        const day = Number(date.slice(8, 10))
        if (day > (storeMonthMaxDay.get(mmKey) || 0)) storeMonthMaxDay.set(mmKey, day)
      }
    }
    const sortedAvailableDates = [...availableDateSet].sort()
    const sortedDates = [...dateSet].sort()
    const latestDataDate = sortedAvailableDates[sortedAvailableDates.length - 1] || null
    const earliestDataDate = sortedAvailableDates[0] || null
    const todayD = sortedDates[sortedDates.length - 1] || null
    const yestD = sortedDates[sortedDates.length - 2] || null

    // ---- ช่วงก่อนหน้า (สำหรับ trend %) เมื่อมี date range ----
    let prevStart = null, prevEnd = null
    if (startDate && endDate) {
      const s = new Date(startDate), e = new Date(endDate)
      const days = Math.round((e - s) / 86400000) + 1
      const pe = new Date(s); pe.setDate(pe.getDate() - 1)
      const ps = new Date(pe); ps.setDate(ps.getDate() - days + 1)
      prevStart = ps.toISOString().slice(0, 10)
      prevEnd = pe.toISOString().slice(0, 10)
    }
    const inPrev = (d) => prevStart && d >= prevStart && d <= prevEnd

    // ---- PASS 2: aggregate ----
    let revenue = 0, units = 0
    const orderIds = new Set()
    let prevRevenue = 0, prevUnits = 0
    const prevOrderIds = new Set()
    // ยอดขายรวมดิบ ไม่ตัดยกเลิก/ตีคืนออก — ไว้เทียบกับ "revenue" (ตัดออกแล้ว) ตามที่ขอ
    let grossRevenue = 0

    const dailyRev = new Map()          // date -> amount
    const dailyOrders = new Map()       // date -> Set(order_id)
    const bizRev = new Map()            // business -> amount
    const platRev = new Map()           // platform -> amount
    const packBySku = new Map()         // master_sku -> { master_sku, display_name, qty } — รวมยกเลิก/ตีคืน สำหรับแพลนฟีด
    // "สินค้าขายดี" ตอนนี้รวมเป็นรายกลุ่มสินค้า (product family) ไม่ใช่รายแยก SKU/ไซส์
    // ใช้ deriveGroup ตัวเดียวกับ products.js/product-trends.js — SKU จริงยังดูได้ผ่าน skuCount/skus
    const sku = new Map()               // product-group key -> { name, orderIds:Set, qty, revenue, platforms:Map, platformUnits:Map, skus:Set }
    const groupThisMonth = new Map()    // product-group key -> revenue (เดือนล่าสุดที่มีข้อมูล) — ใช้กับ Trending Up/Down
    const groupLastMonth = new Map()    // product-group key -> revenue (เดือนก่อนหน้า)
    // ใช้ latestDataDate (ไม่ผูกกับตัวกรองวันที่หลักของผู้ใช้ — กรอง biz/platform เท่านั้น) ไม่ใช่ todayD
    // (ซึ่งผูกกับ inDate) กัน Trending Up/Down หายไปตอนผู้ใช้เลือกช่วงวันที่แคบๆ (เช่นแค่เดือนเดียว)
    // ที่ทำให้ไม่มีข้อมูลเดือนก่อนหน้าเหลือให้เทียบเลย
    const latestMonth = latestDataDate ? latestDataDate.slice(0, 7) : null
    const latestDay = latestDataDate ? Number(latestDataDate.slice(8, 10)) : 31
    const prevMonth = latestMonth ? (() => {
      const [y, m] = latestMonth.split('-').map(Number)
      const d = new Date(Date.UTC(y, m - 2, 1))
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    })() : null

    for (let i = 0; i < tabs.length; i++) {
      const left = vr[2 * i].values || []
      const right = vr[2 * i + 1].values || []
      const n = Math.max(left.length, right.length)
      for (let j = 1; j < n; j++) {
        const l = left[j] || [], r = right[j] || []
        const orderId = l[0], date = l[2], plat = l[3] || '', biz = l[4] || ''
        const variationName = r[0], rawMasterSku = r[1], name = r[2], qty = parseInt(r[3], 10) || 0, rev = num(r[4]), status = r[5]
        // SKU ที่ย้าย/ปนโค้ดกัน (แก้ได้จากชีท sku_redirects/set_recipes โดยตรง ไม่ต้องแก้โค้ด) —
        // ดู resolveSalesSku: ถ้าแถวนี้ตรง set_recipes (เป็น Set/ปนโค้ด) จะคงค่าเดิมไว้ ไม่ redirect
        const masterSku = resolveSalesSku(rawMasterSku, variationName, redirectMap, recipeKeySet)
        if (!date) continue
        // จำนวนออเดอร์นับรวมยกเลิก/ตีคืน (งานแพ็คเกิดขึ้นแล้ว) ยอดขาย/จำนวนชิ้นไม่นับ (ไม่ใช่รายได้จริง)
        const excluded = isCancelled(status) || isReturned(status)

        // ช่วงก่อนหน้า (ไม่สน platform/biz filter ยกเว้นที่ผู้ใช้เลือก) — ใช้เทียบ trend
        if (inPrev(date) && keepBiz(biz) && keepPlat(plat)) {
          if (orderId) prevOrderIds.add(orderId)
          if (!excluded) { prevRevenue += rev; prevUnits += qty }
        }

        // Trending Up/Down (เดือนล่าสุดจริง vs เดือนก่อนหน้า) — ไม่ผูกกับตัวกรองวันที่หลัก (inDate) ตั้งใจ
        // ให้เห็นเทรนด์เสมอไม่ว่าผู้ใช้จะเลือกกรองช่วงวันที่แคบแค่ไหนอยู่บนหน้าจอ
        // เทียบวันเท่ากัน (1-latestDay ทั้งคู่) — ไม่งั้นเดือนล่าสุดที่ข้อมูลยังไม่ครบเดือนจะดูตกหนักเกินจริง
        if (!excluded && keepBiz(biz) && keepPlat(plat)) {
          const rowMonth = date.slice(0, 7)
          const rowDay = Number(date.slice(8, 10))
          if (rowMonth === latestMonth) {
            const { key: trendKey } = deriveGroup(name, masterSku, overrideMap)
            groupThisMonth.set(trendKey, (groupThisMonth.get(trendKey) || 0) + rev)
          } else if (rowMonth === prevMonth) {
            // cap ตามวันล่าสุดที่ "ร้านนี้" (biz+plat ของแถวนี้) มีข้อมูลจริงในเดือนล่าสุด ไม่ใช่ latestDay รวมทุกร้าน
            const storeCapDay = storeMonthMaxDay.get(`${biz}|${plat}|${latestMonth}`) || 0
            if (storeCapDay > 0 && rowDay <= storeCapDay) {
              const { key: trendKey } = deriveGroup(name, masterSku, overrideMap)
              groupLastMonth.set(trendKey, (groupLastMonth.get(trendKey) || 0) + rev)
            }
          }
        }

        if (!inDate(date) || !keepBiz(biz) || !keepPlat(plat)) continue

        grossRevenue += rev
        if (orderId) orderIds.add(orderId)
        let ds = dailyOrders.get(date); if (!ds) dailyOrders.set(date, (ds = new Set())); if (orderId) ds.add(orderId)

        // จำนวนที่ต้องแพ็คจริง (รวมยกเลิก/ตีคืน) นับแยกราย SKU จริง ไม่รวมไซส์ — เพราะแต่ละไซส์แพ็คเป็นคนละชิ้นจริง
        // ต่างจาก "sku" ด้านล่างที่รวมกลุ่มสินค้า (family) ไว้โชว์หน้ายอดขาย
        if (masterSku) {
          let p = packBySku.get(masterSku)
          if (!p) packBySku.set(masterSku, (p = { master_sku: masterSku, display_name: name || masterSku, qty: 0 }))
          p.qty += qty
        }

        const { key: groupKey, label: groupLabel } = deriveGroup(name, masterSku, overrideMap)
        let s = sku.get(groupKey)
        if (!s) sku.set(groupKey, (s = { name: groupLabel, orderIds: new Set(), qty: 0, revenue: 0, platforms: new Map(), platformUnits: new Map(), skus: new Set() }))
        if (orderId) s.orderIds.add(orderId)
        if (masterSku) s.skus.add(masterSku)

        if (excluded) continue

        revenue += rev; units += qty
        dailyRev.set(date, (dailyRev.get(date) || 0) + rev)
        bizRev.set(biz, (bizRev.get(biz) || 0) + rev)
        platRev.set(plat, (platRev.get(plat) || 0) + rev)

        s.qty += qty; s.revenue += rev
        if (plat) {
          s.platforms.set(plat, (s.platforms.get(plat) || 0) + rev)
          s.platformUnits.set(plat, (s.platformUnits.get(plat) || 0) + qty)
        }
      }
    }

    const orders = orderIds.size
    const aov = orders ? revenue / orders : 0

    // ---- trends (%) ----
    const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)
    const prevOrders = prevOrderIds.size
    const revenueTrend = prevStart ? pct(revenue, prevRevenue) : null
    const ordersTrend = prevStart ? pct(orders, prevOrders) : null
    const unitsTrend = prevStart ? pct(units, prevUnits) : null
    const aovTrend = prevStart ? pct(aov, prevOrders ? prevRevenue / prevOrders : 0) : null

    // ---- breakdowns ----
    const revenueByDay = [...dailyRev.entries()].map(([date, amount]) => ({ date, amount: round2(amount) })).sort((a, b) => a.date.localeCompare(b.date))
    const ordersByDay = [...dailyOrders.entries()].map(([date, set]) => ({ date, count: set.size })).sort((a, b) => a.date.localeCompare(b.date))
    const businessBreakdown = [...bizRev.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount)
    const platformBreakdown = [...platRev.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount)

    const topSkus = [...sku.entries()]
      .map(([groupKey, v]) => ({
        key: groupKey,           // product-group key (ไม่ใช่ SKU จริง — ดู skuCount/skus สำหรับ SKU)
        display_name: v.name,
        skuCount: v.skus.size,
        skus: [...v.skus],
        orders: v.orderIds.size,
        qty: v.qty,
        amount: round2(v.revenue),
        platforms: Object.fromEntries([...v.platforms.entries()].map(([k, x]) => [k, round2(x)])),
        platformUnits: Object.fromEntries(v.platformUnits.entries()),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 50)

    // ---- command center ----
    const todayRevenue = todayD ? round2(dailyRev.get(todayD) || 0) : 0
    const yestRevenue = yestD ? (dailyRev.get(yestD) || 0) : 0
    const revenueGrowth = yestRevenue > 0 ? Math.round(((todayRevenue - yestRevenue) / yestRevenue) * 100) : null

    const deltas = [...new Set([...groupThisMonth.keys(), ...groupLastMonth.keys()])].map((k) => {
      const t = groupThisMonth.get(k) || 0, y = groupLastMonth.get(k) || 0
      const g = sku.get(k)
      return { key: k, display_name: g?.name || k, delta: round2(t - y), monthRevenue: round2(t) }
    })
    const trendingUp = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5)
    const trendingDown = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5)

    const alerts = []
    if (revenueGrowth !== null && revenueGrowth <= -30) {
      alerts.push({ type: 'critical', category: 'ยอดขายตก', message: `รายได้วันนี้ (${todayD}) ต่ำกว่าเมื่อวาน ${Math.abs(revenueGrowth)}% — ควรตรวจสอบช่องทางที่ตก` })
    }
    if (trendingDown.length > 0 && trendingDown[0].delta < 0) {
      const t = trendingDown[0]
      alerts.push({ type: 'warning', category: 'สินค้ายอดตก', message: `${t.display_name} ยอดตกจากเดือนก่อน ฿${Math.abs(t.delta).toLocaleString()}` })
    }

    const data = {
      success: true,
      revenue: round2(revenue),
      grossRevenue: round2(grossRevenue),
      orders,
      units,
      aov: Math.round(aov),
      revenueTrend, ordersTrend, unitsTrend, aovTrend,
      revenueByDay, ordersByDay,
      businessBreakdown, platformBreakdown,
      topSkus,
      packBySku: [...packBySku.values()].sort((a, b) => b.qty - a.qty),
      commandCenter: { alerts, trendingUp, trendingDown, todayRevenue, revenueGrowth, trendCompare: { latestMonth, prevMonth, latestDay } },
      dataRange: { earliestDate: earliestDataDate, latestDate: latestDataDate },
    }
    dashboardCache.set(cacheKey, { data, at: Date.now() })
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
