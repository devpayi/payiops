// GET /api/manager-claims
// รวมข้อมูลสำหรับ "โหมดผู้จัดการ" (มือถือ): เคลมรายกลุ่มสินค้า + อัตราเคลม (เคลม ÷ ยอดขาย)
// เคลมมาจาก sheet "claims", ยอดขาย(units) มาจาก raw_orders_* — จับกลุ่มด้วย deriveGroup
// ตัวเดียวกันทั้งคู่ (key จึงตรงกัน) ตาม TODO#2/#3
import { requireManager, cacheable } from './_lib/auth.js'
import { getMetaCached, batchGetValues, getSheet } from './_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from './_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku, resolveRedirect } from './_lib/skuMapping.js'

const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
const isReturned = (s = '') => s.toLowerCase().includes('return')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const truthy = (v) => v === '1' || v === 1 || v === true || String(v).toLowerCase() === 'true'
const round2 = (n) => Math.round(n * 100) / 100

// เกณฑ์สีตามอัตราเคลม % — TODO: ให้เจ้าของยืนยันตัวเลขจริง
const RED = 1.0        // >= 1% = แดง (สูงผิดปกติ)
const AMBER = 0.2      // >= 0.2% = เหลือง (เฝ้าดู)
// ขั้นต่ำยอดขายก่อนจะ "เชื่ออัตราได้" — กันสัญญาณปลอมจากของขายน้อย
// (เช่น เคลม 1 จากขาย 3 ชิ้น = 33% แต่ไม่มีนัยยะจริง) → ต่ำกว่านี้ = 'low' (ข้อมูลน้อย)
const MIN_UNITS = 100
const levelOf = (rate, units) => {
  if (rate == null || units < MIN_UNITS) return 'low'
  return rate >= RED ? 'red' : rate >= AMBER ? 'amber' : 'green'
}

// เหตุผลเดียวกับ dashboard.js — cacheable() บังคับ no-store ตอนเปิด auth เลย cache ในหน่วยความจำแทน
let managerClaimsCache = { at: 0, data: null }
const MANAGER_CLAIMS_CACHE_MS = 180000

export default async function handler(req, res) {
  if (!requireManager(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  if (managerClaimsCache.data && Date.now() - managerClaimsCache.at < MANAGER_CLAIMS_CACHE_MS) {
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    return res.status(200).json(managerClaimsCache.data)
  }

  try {
    let overrideMap = new Map()
    try { overrideMap = buildOverrideMap(await getSheet('product_aliases')) } catch { /* ข้ามได้ */ }
    const [redirectMap, recipeKeySet] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet()])

    // 1) ยอดขาย (units) ต่อกลุ่มสินค้า จาก raw_orders (I:N = variation_name, master_sku, display_name, qty, revenue, status)
    const meta = await getMetaCached()
    const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
    const vr = await batchGetValues(tabs.map((t) => `${t}!I:N`))
    const units = new Map() // key -> units
    for (let i = 0; i < tabs.length; i++) {
      const rows = vr[i].values || []
      for (let j = 1; j < rows.length; j++) {
        const r = rows[j] || []
        const variationName = r[0], rawMasterSku = r[1], name = r[2], qty = parseInt(r[3], 10) || 0, status = r[5]
        const masterSku = resolveSalesSku(rawMasterSku, variationName, redirectMap, recipeKeySet)
        if (isCancelled(status) || isReturned(status)) continue
        const { key } = deriveGroup(name, masterSku, overrideMap)
        units.set(key, (units.get(key) || 0) + qty)
      }
    }

    // 2) เคลม ต่อกลุ่มสินค้า จาก claims
    const claims = await getSheet('claims')
    const g = new Map() // key -> { key, label, claims, value, damaged, incomplete, wrong }
    let totalCount = 0, totalValue = 0
    let gDamaged = 0, gIncomplete = 0, gWrong = 0
    const monthly = new Map() // 'YYYY-MM' -> count
    for (const c of claims) {
      // เคลมบางแถวมีแต่ product_name (display_name ว่าง) — fallback กันจับคู่ยอดขายไม่ติด
      const claimSku = resolveRedirect(c.master_sku, redirectMap) || c.master_sku
      const { key, label } = deriveGroup(c.display_name || c.product_name, claimSku, overrideMap)
      let x = g.get(key)
      if (!x) g.set(key, (x = { key, label, claims: 0, value: 0, damaged: 0, incomplete: 0, wrong: 0 }))
      x.claims++
      const v = num(c.claim_value); x.value += v
      if (truthy(c.is_damaged)) { x.damaged++; gDamaged++ }
      if (truthy(c.is_incomplete)) { x.incomplete++; gIncomplete++ }
      if (truthy(c.is_wrong_item)) { x.wrong++; gWrong++ }
      totalCount++; totalValue += v
      const ym = String(c.date || '').slice(0, 7)
      if (ym) monthly.set(ym, (monthly.get(ym) || 0) + 1)
    }
    const monthlyArr = [...monthly.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month))

    // 3) join: อัตราเคลม = เคลม ÷ ยอดขาย, ให้ระดับสี, เรียงจากอัตราสูง→ต่ำ (ไม่มียอดขาย = ท้ายสุด)
    const products = [...g.values()]
      .map((x) => {
        const u = units.get(x.key) || 0
        const rate = u > 0 ? round2((x.claims / u) * 100) : null
        return { ...x, value: round2(x.value), units: u, rate, level: levelOf(rate, u) }
      })
      .sort((a, b) => {
        // ของที่ข้อมูลน้อย (low) ดันไปท้ายสุดเสมอ ไม่ให้แย่งความสนใจ
        const al = a.level === 'low', bl = b.level === 'low'
        if (al !== bl) return al ? 1 : -1
        if (a.rate == null && b.rate == null) return b.claims - a.claims
        if (a.rate == null) return 1
        if (b.rate == null) return -1
        return b.rate - a.rate
      })

    const alertCount = products.filter((p) => p.level === 'red').length
    const lowDataCount = products.filter((p) => p.level === 'low').length

    const data = {
      success: true,
      thresholds: { red: RED, amber: AMBER, minUnits: MIN_UNITS },
      summary: {
        claimCount: totalCount, claimValue: round2(totalValue),
        damaged: gDamaged, incomplete: gIncomplete, wrong: gWrong,
        productCount: products.length, alertCount, lowDataCount,
      },
      monthly: monthlyArr,
      products,
    }
    managerClaimsCache = { at: Date.now(), data }
    res.setHeader('Cache-Control', cacheable('public, s-maxage=120, stale-while-revalidate=600'))
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
