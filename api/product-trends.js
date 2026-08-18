// GET /api/product-trends?business=&platform=
// % เปลี่ยนแปลงรายเดือน (MoM) ของสินค้าแต่ละกลุ่ม — ทั้ง "จำนวนชิ้น" และ "ยอดขาย"
// รองรับกรองแพลตฟอร์ม/ร้าน (กรองแล้ว re-fetch เหมือน products.js)
// คืนค่ารายเดือน per กลุ่มสินค้า + per SKU สมาชิก (สำหรับกดขยายดู) — % คำนวณฝั่ง frontend
import { requireAuth, cacheable } from './_lib/auth.js'
import { getMetaCached, batchGetValues, getSheet } from './_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from './_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku, SET_RECIPES_SHEET } from './_lib/skuMapping.js'

const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
const isReturned = (s = '') => s.toLowerCase().includes('return')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const round2 = (n) => Math.round(n * 100) / 100

// จำนวนกลุ่มสูงสุดที่ส่งกลับ (คุมขนาด response — เรียงตามยอดขายรวม)
const MAX_GROUPS = 120

// เหตุผลเดียวกับ dashboard.js/products.js — cacheable() บังคับ no-store ตอนเปิด auth เลย cache ในหน่วยความจำแทน
const trendsCache = new Map()
const TRENDS_CACHE_MS = 180000

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { business = 'all', platform = 'all' } = req.query
  const keepBiz = (b) => business === 'all' || b === business || (business === 'Payi' && b === 'Payi Outlet')
  const keepPlat = (p) => platform === 'all' || p === platform

  const cacheKey = `${business}|${platform}`
  const cached = trendsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < TRENDS_CACHE_MS) {
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    return res.status(200).json(cached.data)
  }

  try {
    let overrideMap = new Map()
    let aliasRows = []
    try {
      aliasRows = await getSheet('product_aliases')
      overrideMap = buildOverrideMap(aliasRows)
    } catch { /* ไม่มี sheet — ใช้ auto-strip แทน */ }
    const [redirectMap, recipeKeySet, setRecipeRows] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet(), getSheet(SET_RECIPES_SHEET).catch(() => [])])

    // เหตุผลเดียวกับ products.js — บวกจำนวนชิ้นที่แตกจาก Set เข้ากลุ่มสินค้าจริง ไม่บวกรายได้
    const nameBySku = new Map()
    for (const row of aliasRows) {
      const sku = String(row.master_sku || '').trim().toUpperCase()
      if (sku && !nameBySku.has(sku)) nameBySku.set(sku, String(row.display_name || '').trim() || sku)
    }
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

    const groups = new Map()  // key -> { key, label, totalRev, monthly:Map(ym->{units,revenue}), skus:Map }
    const monthsSet = new Set()

    // helper: บวกค่ารายเดือนเข้าไปใน Map(ym -> {units,revenue,unitsFromSet})
    const addMonthly = (map, ym, qty, rev) => {
      let m = map.get(ym)
      if (!m) map.set(ym, (m = { units: 0, revenue: 0, unitsFromSet: 0 }))
      m.units += qty; m.revenue += rev
    }
    // บวกเฉพาะจำนวนชิ้นที่แตกจาก Set เข้ากลุ่ม (ไม่บวกรายได้ — เหตุผลเดียวกับ products.js)
    const addSetUnits = (map, ym, qty) => {
      let m = map.get(ym)
      if (!m) map.set(ym, (m = { units: 0, revenue: 0, unitsFromSet: 0 }))
      m.unitsFromSet += qty
    }

    for (let i = 0; i < tabs.length; i++) {
      const left = vr[2 * i].values || []
      const right = vr[2 * i + 1].values || []
      const n = Math.max(left.length, right.length)
      for (let j = 1; j < n; j++) {
        const l = left[j] || [], r = right[j] || []
        const date = l[2], plat = l[3] || '', biz = l[4] || ''
        const variationName = r[0], rawMasterSku = r[1], name = r[2], qty = parseInt(r[3], 10) || 0, rev = num(r[4]), status = r[5]
        const masterSku = resolveSalesSku(rawMasterSku, variationName, redirectMap, recipeKeySet)
        if (!date || isCancelled(status) || isReturned(status)) continue
        if (!keepBiz(biz) || !keepPlat(plat)) continue

        const ym = String(date).slice(0, 7)
        monthsSet.add(ym)

        const { key, label } = deriveGroup(name, masterSku, overrideMap)
        let g = groups.get(key)
        if (!g) groups.set(key, (g = { key, label, totalRev: 0, monthly: new Map(), skus: new Map() }))
        g.totalRev += rev
        addMonthly(g.monthly, ym, qty, rev)

        const sk = masterSku || '(ไม่ระบุ)'
        let m = g.skus.get(sk)
        if (!m) g.skus.set(sk, (m = { master_sku: sk, display_name: name || sk, monthly: new Map() }))
        if (!m.display_name && name) m.display_name = name
        addMonthly(m.monthly, ym, qty, rev)

        // แถวนี้เป็น Set จริง (มีสูตรแตกยอด) — บวกจำนวนชิ้นเข้ากลุ่มสินค้าจริงข้างในด้วย
        const setKey = `${masterSku}|${variationName || ''}`
        const recipe = setRecipesByKey.get(setKey)
        if (recipe) {
          for (const comp of recipe) {
            const compName = nameBySku.get(comp.componentSku) || comp.componentSku
            const { key: ck, label: cl } = deriveGroup(compName, comp.componentSku, overrideMap)
            let cg = groups.get(ck)
            if (!cg) groups.set(ck, (cg = { key: ck, label: cl, totalRev: 0, monthly: new Map(), skus: new Map() }))
            addSetUnits(cg.monthly, ym, qty * comp.qty)
          }
        }
      }
    }

    const months = [...monthsSet].sort()
    // แปลง Map(ym) → array ตามลำดับเดือนทั้งหมด (เดือนไม่มีข้อมูล = 0) — units = ขายเดี่ยว+แตกจาก Set รวมกัน
    // (ตัวเลขหลักที่โชว์), unitsFromSet > 0 ต่อเดือนไหน = เดือนนั้นมีส่วนที่มาจาก Set ให้ frontend โชว์ป้ายกำกับ
    const toRow = (map) => months.map((ym) => {
      const v = map.get(ym) || { units: 0, revenue: 0, unitsFromSet: 0 }
      return { month: ym, units: v.units + (v.unitsFromSet || 0), directUnits: v.units, unitsFromSet: v.unitsFromSet || 0, revenue: round2(v.revenue) }
    })

    const groupArr = [...groups.values()]
      .sort((a, b) => b.totalRev - a.totalRev)
      .slice(0, MAX_GROUPS)
      .map((g) => ({
        key: g.key,
        label: g.label,
        skuCount: g.skus.size,
        monthly: toRow(g.monthly),
        members: [...g.skus.values()]
          .map((m) => ({
            master_sku: m.master_sku,
            display_name: m.display_name,
            monthly: toRow(m.monthly),
            _rev: [...m.monthly.values()].reduce((s, v) => s + v.revenue, 0),
          }))
          .sort((a, b) => b._rev - a._rev)
          .map(({ _rev, ...m }) => m),
      }))

    const data = { success: true, months, groups: groupArr, groupCount: groups.size }
    trendsCache.set(cacheKey, { data, at: Date.now() })
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
