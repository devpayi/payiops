// GET /api/products?business=&platform=&month=YYYY-MM|all
// สรุปผลงานสินค้าแบบ "รายกลุ่มสินค้า" (product family) สำหรับหน้า Dashboard สินค้า
// รวม SKU คนละไซส์เข้าเป็นสินค้าเดียวด้วย api/_lib/productGroup.js (TODO#2/#4)
// ข้อมูลหลัก (totals/groups/trendTopGroups) สโคปตาม "เดือนที่เลือก" (default = เดือนล่าสุด)
// month=all = รวมทุกเดือน (all-time, ไม่มี MoM) พร้อม MoM % เทียบเดือนก่อนหน้า — เหมือน MonthlyDashboard
import { requireAuth, cacheable } from './_lib/auth.js'
import { getMetaCached, batchGetValues, getSheet } from './_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from './_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku, SET_RECIPES_SHEET } from './_lib/skuMapping.js'

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
    let aliasRows = []
    try {
      aliasRows = await getSheet('product_aliases')
      overrideMap = buildOverrideMap(aliasRows)
    } catch { /* ไม่มี sheet หรืออ่านไม่ได้ — ใช้การ strip อัตโนมัติแทน */ }
    const [redirectMap, recipeKeySet, setRecipeRows] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet(), getSheet(SET_RECIPES_SHEET).catch(() => [])])

    // ชื่อสินค้าจริง (ไม่ใช่ Set) ต่อ master_sku — ใช้ตอนต้องสร้าง/หากลุ่มของสินค้าที่ยอดถูกแตกมาจาก Set
    // (แถวของ Set เองไม่มีชื่อสินค้าจริงให้ใช้ deriveGroup ต้องเปิด product_aliases หา)
    const nameBySku = new Map()
    for (const row of aliasRows) {
      const sku = String(row.master_sku || '').trim().toUpperCase()
      if (sku && !nameBySku.has(sku)) nameBySku.set(sku, String(row.display_name || '').trim() || sku)
    }
    // set_sku|variation_name -> [{ componentSku, qty }] — เอาไว้บวกจำนวนชิ้นเข้ากลุ่มสินค้าจริง (ไม่บวก
    // รายได้ เพราะราคา Set ไม่ได้แบ่งสัดส่วนต่อสินค้าจริงชัดเจน โดยเฉพาะ "Set จัดให้" ที่คละหลายแบบราคาเดียว
    // — ยอดขาย/รายได้ยังเป็นของสินค้าที่ขายเดี่ยวจริงเท่านั้น, ยอดขายของ Set เองก็ยังคงแยกต่างหากเหมือนเดิม
    // ดู CLAUDE.md "แล้วเซ็ทอื่นพังเหมือนกันไหม" — เจ้าของยืนยันแล้วว่าต้องรวมยอดชิ้นแบบนี้)
    const setRecipesByKey = new Map()
    for (const row of setRecipeRows) {
      const setSku = String(row.set_sku || '').trim().toUpperCase()
      const variation = String(row.variation_name || '').trim()
      const componentSku = String(row.component_sku || '').trim().toUpperCase()
      const qty = Number(row.qty_per_unit) || 0
      if (!setSku || !variation || !componentSku || qty <= 0) continue
      const key = `${setSku}|${variation}`
      if (!setRecipesByKey.has(key)) setRecipesByKey.set(key, [])
      setRecipesByKey.get(key).push({ componentSku, qty })
    }

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
        if (!gm) g.monthly.set(ym, (gm = { revenue: 0, units: 0, unitsFromSet: 0, orderIds: new Set(), platforms: new Map() }))
        if (orderId) gm.orderIds.add(orderId)
        if (!excluded) {
          gm.revenue += rev; gm.units += qty
          if (plat) gm.platforms.set(plat, (gm.platforms.get(plat) || 0) + rev)
        }

        // แถวนี้เป็น Set จริง (มีสูตรแตกยอด) — บวกจำนวนชิ้นเข้ากลุ่มสินค้าจริงข้างในด้วย (ไม่บวกรายได้/ออเดอร์
        // เพราะเป็นของกลุ่ม Set เอง อยู่แล้วในบรรทัดข้างบน — สินค้าจริงแค่ยืมยอด "ชิ้น" มาโชว์รวมด้วย)
        if (!excluded) {
          const setKey = `${masterSku}|${variationName || ''}`
          const recipe = setRecipesByKey.get(setKey)
          if (recipe) {
            for (const comp of recipe) {
              const compName = nameBySku.get(comp.componentSku) || comp.componentSku
              const { key: ck, label: cl } = deriveGroup(compName, comp.componentSku, overrideMap)
              let cg = groups.get(ck)
              if (!cg) groups.set(ck, (cg = { key: ck, label: cl, skus: new Map(), monthly: new Map() }))
              let cgm = cg.monthly.get(ym)
              if (!cgm) cg.monthly.set(ym, (cgm = { revenue: 0, units: 0, unitsFromSet: 0, orderIds: new Set(), platforms: new Map() }))
              cgm.unitsFromSet += qty * comp.qty
            }
          }
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
        const acc = { revenue: 0, units: 0, unitsFromSet: 0, orderIds: new Set(), platforms: new Map() }
        for (const gm of g.monthly.values()) {
          acc.revenue += gm.revenue; acc.units += gm.units; acc.unitsFromSet += gm.unitsFromSet || 0
          for (const id of gm.orderIds) acc.orderIds.add(id)
          for (const [p, v] of gm.platforms) acc.platforms.set(p, (acc.platforms.get(p) || 0) + v)
        }
        return { revenue: acc.revenue, units: acc.units, unitsFromSet: acc.unitsFromSet, orders: acc.orderIds.size, platforms: acc.platforms }
      }
      const gm = ym ? g.monthly.get(ym) : null
      return gm ? { revenue: gm.revenue, units: gm.units, unitsFromSet: gm.unitsFromSet || 0, orders: gm.orderIds.size, platforms: gm.platforms } : { revenue: 0, units: 0, unitsFromSet: 0, orders: 0, platforms: new Map() }
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
        // units = จำนวนชิ้นรวม (ขายเดี่ยว + แตกจาก Set) ตัวเลขหลักที่โชว์ในตาราง — directUnits = ขายเดี่ยว
        // ล้วนๆ ไว้เทียบ/คำนวณราคาเฉลี่ย (avgPrice ใช้ directUnits เพราะรายได้ไม่ได้รวม Set มาด้วย ถ้าหาร
        // ด้วย units รวมราคาเฉลี่ยจะโชว์ต่ำกว่าจริง) unitsFromSet > 0 = มีส่วนที่มาจาก Set ให้ frontend โชว์
        // ป้าย "รวม Set แล้ว" กำกับ
        const curUnits = cur.units + cur.unitsFromSet
        const prevUnits = prev.units + prev.unitsFromSet
        return {
          key: g.key,
          label: g.label,
          revenue: round2(cur.revenue),
          units: curUnits,
          directUnits: cur.units,
          unitsFromSet: cur.unitsFromSet,
          orders: cur.orders,
          skuCount: members.length,
          avgPrice: cur.units > 0 ? Math.round(cur.revenue / cur.units) : 0,
          revenueMoM: prevMonth ? pct(cur.revenue, prev.revenue) : null,
          unitsMoM: prevMonth ? pct(curUnits, prevUnits) : null,
          prevRevenue: prevMonth ? round2(prev.revenue) : null,
          members,
          platforms: Object.fromEntries([...cur.platforms.entries()].map(([k, v]) => [k, round2(v)])),
        }
      })
      .filter((g) => g.revenue > 0 || g.units > 0) // เฉพาะกลุ่มที่มีขายในเดือนที่เลือก (รวมที่มาจาก Set ล้วนๆ ด้วย)
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
        prevTotalRevenue += p.revenue; prevTotalUnits += p.units + p.unitsFromSet
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
