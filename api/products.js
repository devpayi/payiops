// GET /api/products?business=&platform=&month=YYYY-MM|all
// สรุปผลงานสินค้าแบบ "รายกลุ่มสินค้า" (product family) สำหรับหน้า Dashboard สินค้า
// รวม SKU คนละไซส์เข้าเป็นสินค้าเดียวด้วย api/_lib/productGroup.js (TODO#2/#4)
// ข้อมูลหลัก (totals/groups/trendTopGroups) สโคปตาม "เดือนที่เลือก" (default = เดือนล่าสุด)
// month=all = รวมทุกเดือน (all-time, ไม่มี MoM) พร้อม MoM % เทียบเดือนก่อนหน้า — เหมือน MonthlyDashboard
import { requireAuth, cacheable } from './_lib/auth.js'
import { getMetaCached, batchGetValues, getSheet } from './_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from './_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku } from './_lib/skuMapping.js'

const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
const isReturned = (s = '') => s.toLowerCase().includes('return')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const round2 = (n) => Math.round(n * 100) / 100
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)

// จำนวนกลุ่มที่ส่ง monthly trend กลับไป (กราฟแนวโน้ม) — คุมขนาด response
const TREND_TOP_N = 8

// เหตุผลเดียวกับ dashboard.js — cacheable() บังคับ no-store ตอนเปิด auth เลย cache ในหน่วยความจำแทน CDN
const productsCache = new Map()
const PRODUCTS_CACHE_MS = 180000

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { business = 'all', platform = 'all' } = req.query
  const keepBiz = (b) => business === 'all' || b === business
  const keepPlat = (p) => platform === 'all' || p === platform

  const cacheKey = `${business}|${platform}|${req.query.month || ''}`
  const cached = productsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < PRODUCTS_CACHE_MS) {
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    return res.status(200).json(cached.data)
  }

  try {
    // override รายชื่อกลุ่มจาก product_aliases (คอลัมน์ product_group ถ้ามี) — ไม่มีก็ข้าม
    let overrideMap = new Map()
    try {
      overrideMap = buildOverrideMap(await getSheet('product_aliases'))
    } catch { /* ไม่มี sheet หรืออ่านไม่ได้ — ใช้การ strip อัตโนมัติแทน */ }
    const [redirectMap, recipeKeySet] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet()])

    const meta = await getMetaCached()
    const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))

    // B:F = order_id, order_item_id, date, platform, business ; I:N = variation_name, master_sku, display_name, qty, revenue, status
    const ranges = tabs.flatMap((t) => [`${t}!B:F`, `${t}!I:N`])
    const vr = await batchGetValues(ranges)

    // key -> { key, label, skus:Map(sku -> {master_sku, display_name, monthly:Map(ym->{revenue,units})}), monthly:Map(ym->{revenue,units,orderIds:Set,platforms:Map}) }
    const groups = new Map()
    const monthsSet = new Set()

    for (let i = 0; i < tabs.length; i++) {
      const left = vr[2 * i].values || []
      const right = vr[2 * i + 1].values || []
      const n = Math.max(left.length, right.length)
      for (let j = 1; j < n; j++) {
        const l = left[j] || [], r = right[j] || []
        const orderId = l[0], date = l[2], plat = l[3] || '', biz = l[4] || ''
        const variationName = r[0], rawMasterSku = r[1], name = r[2], qty = parseInt(r[3], 10) || 0, rev = num(r[4]), status = r[5]
        const masterSku = resolveSalesSku(rawMasterSku, variationName, redirectMap, recipeKeySet)
        if (!date) continue
        if (!keepBiz(biz) || !keepPlat(plat)) continue
        // จำนวนออเดอร์นับรวมยกเลิก/ตีคืน (งานแพ็คเกิดขึ้นแล้ว) ยอดขาย/จำนวนชิ้นไม่นับ
        const excluded = isCancelled(status) || isReturned(status)

        const ym = String(date).slice(0, 7)
        monthsSet.add(ym)

        const { key, label } = deriveGroup(name, masterSku, overrideMap)
        let g = groups.get(key)
        if (!g) groups.set(key, (g = { key, label, skus: new Map(), monthly: new Map() }))

        let gm = g.monthly.get(ym)
        if (!gm) g.monthly.set(ym, (gm = { revenue: 0, units: 0, orderIds: new Set(), platforms: new Map() }))
        if (orderId) gm.orderIds.add(orderId)
        if (!excluded) {
          gm.revenue += rev; gm.units += qty
          if (plat) gm.platforms.set(plat, (gm.platforms.get(plat) || 0) + rev)
        }

        // สมาชิก SKU ในกลุ่ม — เก็บรายเดือนด้วย เพื่อให้ตาราง/drawer สโคปตามเดือนที่เลือกได้
        if (!excluded) {
          const sk = masterSku || '(ไม่ระบุ)'
          let m = g.skus.get(sk)
          if (!m) g.skus.set(sk, (m = { master_sku: sk, display_name: name || sk, monthly: new Map() }))
          if (!m.display_name && name) m.display_name = name
          let mm = m.monthly.get(ym)
          if (!mm) m.monthly.set(ym, (mm = { revenue: 0, units: 0 }))
          mm.revenue += rev; mm.units += qty
        }
      }
    }

    const months = [...monthsSet].sort()
    const requestedMonth = String(req.query.month || '')
    const isAll = requestedMonth === 'all'
    const selectedMonth = isAll ? null : (months.includes(requestedMonth) ? requestedMonth : (months[months.length - 1] || null))
    const prevMonth = (!isAll && selectedMonth) ? (months[months.indexOf(selectedMonth) - 1] || null) : null

    // ค่าดิบของกลุ่ม g ที่เดือน ym — ym = null หมายถึง "ทั้งหมด" (รวมทุกเดือน)
    const monthRaw = (g, ym) => {
      if (ym === null) {
        const acc = { revenue: 0, units: 0, orderIds: new Set(), platforms: new Map() }
        for (const gm of g.monthly.values()) {
          acc.revenue += gm.revenue; acc.units += gm.units
          for (const id of gm.orderIds) acc.orderIds.add(id)
          for (const [p, v] of gm.platforms) acc.platforms.set(p, (acc.platforms.get(p) || 0) + v)
        }
        return { revenue: acc.revenue, units: acc.units, orders: acc.orderIds.size, platforms: acc.platforms }
      }
      const gm = ym ? g.monthly.get(ym) : null
      return gm ? { revenue: gm.revenue, units: gm.units, orders: gm.orderIds.size, platforms: gm.platforms } : { revenue: 0, units: 0, orders: 0, platforms: new Map() }
    }
    // ผลรวมของสมาชิก SKU ในกลุ่ม g ที่ ym — null = รวมทุกเดือน
    const memberRaw = (m, ym) => {
      if (ym === null) {
        let revenue = 0, units = 0
        for (const mc of m.monthly.values()) { revenue += mc.revenue; units += mc.units }
        return { revenue, units }
      }
      return m.monthly.get(ym) || { revenue: 0, units: 0 }
    }

    const groupArr = [...groups.values()]
      .map((g) => {
        const cur = monthRaw(g, selectedMonth)
        const prev = monthRaw(g, prevMonth)
        const members = [...g.skus.values()]
          .map((m) => {
            const mc = memberRaw(m, selectedMonth)
            return { master_sku: m.master_sku, display_name: m.display_name, revenue: round2(mc.revenue), units: mc.units }
          })
          .filter((m) => m.revenue > 0 || m.units > 0)
          .sort((a, b) => b.revenue - a.revenue)
        return {
          key: g.key,
          label: g.label,
          revenue: round2(cur.revenue),
          units: cur.units,
          orders: cur.orders,
          skuCount: members.length,
          avgPrice: cur.units > 0 ? Math.round(cur.revenue / cur.units) : 0,
          revenueMoM: prevMonth ? pct(cur.revenue, prev.revenue) : null,
          unitsMoM: prevMonth ? pct(cur.units, prev.units) : null,
          prevRevenue: prevMonth ? round2(prev.revenue) : null,
          members,
          platforms: Object.fromEntries([...cur.platforms.entries()].map(([k, v]) => [k, round2(v)])),
        }
      })
      .filter((g) => g.revenue > 0 || g.units > 0) // เฉพาะกลุ่มที่มีขายในเดือนที่เลือก
      .sort((a, b) => b.revenue - a.revenue)

    // แนวโน้มรายเดือนของกลุ่มขายดี top N (ของเดือนที่เลือก) — โชว์ประวัติเต็มทุกเดือนที่มีข้อมูล
    const trendTopGroups = groupArr.slice(0, TREND_TOP_N).map((gTop) => {
      const g = groups.get(gTop.key)
      return {
        key: gTop.key,
        label: gTop.label,
        monthly: months.map((ym) => ({ month: ym, revenue: round2((g.monthly.get(ym) || { revenue: 0 }).revenue) })),
      }
    })

    // จำนวน SKU ที่มีการขายจริงในช่วงที่เลือก (นับจากทุกกลุ่ม ไม่ใช่แค่ 100 อันดับแรก) — isAll = ทั้งหมด (all-time)
    const skuCountThisMonth = new Set()
    for (const g of groups.values()) {
      for (const [sk, m] of g.skus) {
        const mc = isAll ? memberRaw(m, null) : m.monthly.get(selectedMonth)
        if (mc && (mc.revenue > 0 || mc.units > 0)) skuCountThisMonth.add(sk)
      }
    }

    let totalRevenue = 0, totalUnits = 0, prevTotalRevenue = 0, prevTotalUnits = 0
    for (const g of groupArr) { totalRevenue += g.revenue; totalUnits += g.units }
    if (prevMonth) {
      for (const g of groups.values()) {
        const p = monthRaw(g, prevMonth)
        prevTotalRevenue += p.revenue; prevTotalUnits += p.units
      }
    }

    const totals = {
      revenue: round2(totalRevenue),
      units: totalUnits,
      groupCount: groupArr.length,
      skuCount: skuCountThisMonth.size,
      revenueMoM: prevMonth ? pct(totalRevenue, prevTotalRevenue) : null,
      unitsMoM: prevMonth ? pct(totalUnits, prevTotalUnits) : null,
      prevMonth,
      prevRevenue: prevMonth ? round2(prevTotalRevenue) : null,
      prevUnits: prevMonth ? prevTotalUnits : null,
    }

    const data = {
      success: true,
      month: isAll ? 'all' : selectedMonth,
      months,
      totals,
      groups: groupArr.slice(0, 100),
      trendTopGroups,
    }
    productsCache.set(cacheKey, { data, at: Date.now() })
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
