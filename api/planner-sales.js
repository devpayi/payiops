// GET /api/planner-sales
// ABC และยอดเฉลี่ยต่อวันจากจำนวนชิ้นขาย 90 วันล่าสุด (ยึดวันล่าสุดที่มีข้อมูล)
import { requireAuth } from './_lib/auth.js'
import { batchGetValues, getMeta, getSheet, ensureSheet } from './_lib/sheets.js'
import { getSkuRedirectMap, resolveRedirect } from './_lib/skuMapping.js'

// สินค้า Set (เช่น PY067 [Set สุดคุ้ม]) ไม่ใช่ของจริงที่ track สต็อก — ต้อง "แตก" ยอดขาย Set
// ไปเป็นยอดของ SKU จริงที่อยู่ข้างในตาม variation_name ของออเดอร์ (บอกไซส์/สูตรผสม) ก่อนคำนวณ
// ABC/ยอดเฉลี่ย ไม่งั้น SKU จริงจะโดนนับยอดขายต่ำกว่าจริงมาก (Set สุดคุ้มขาย ABC-A เลย)
// keep_set_sales: เว้นว่างไว้ = นับ Set เองด้วย (default) — ใช้กับ Set ของจริงที่ตั้งใจขาย
// เป็น Set (PY067/069/071) เพราะต้องวัดว่า Set นั้นขายดีไหมด้วย ไม่ใช่แค่ของข้างในแตกไปไหน
// ใส่ '0' เมื่อเป็นเคส SKU ปนกันผิด (เช่น PY075 บอลเทาปุ่ม ที่มี variation "[Set คลายเส้น]"
// ของเก้าอี้มหัศจรรย์ติดโค้ดผิดมาด้วย) — กรณีนี้ไม่ใช่ Set จริง ไม่ต้องนับเข้า SKU ที่แตกออกไปเลย
const SET_RECIPES_SHEET = 'set_recipes'
const SET_RECIPES_HEADERS = ['set_sku', 'variation_name', 'component_sku', 'qty_per_unit', 'keep_set_sales']
// SKU ที่ย้าย/เปลี่ยนโค้ดแล้ว แต่ raw_orders เก่า+ใหม่จาก Shopee/TikTok ยังส่งโค้ดเดิมมาอยู่ — map ให้
// ยอดขายทั้งหมดของโค้ดเดิมไปนับใต้โค้ดใหม่แทน (ไม่ต้องแก้ raw_orders ย้อนหลัง) — แก้ได้จากชีท sku_redirects
// ตรงๆ ไม่ต้องแก้โค้ด/deploy ใหม่ทุกครั้งที่มีการย้ายโค้ด (ดู api/_lib/skuMapping.js)

// ABC ไม่จำเป็นต้องไล่อ่าน raw_orders ทุกครั้งที่เปิดหน้า — 6 ชม. ลดทั้งเวลาและ Sheets quota
const CACHE_MS = 6 * 60 * 60 * 1000
const cacheByDays = new Map()
const normalizeName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')
const addDays = (iso, days) => {
  const date = new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const days = Math.min(180, Math.max(7, parseInt(req.query.days, 10) || 90))
  const cache = cacheByDays.get(days)
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=21600')
    return res.status(200).json(cache.data)
  }

  try {
    await ensureSheet(SET_RECIPES_SHEET, SET_RECIPES_HEADERS)
    const [meta, aliases, setRecipeRows, redirectMap] = await Promise.all([getMeta(), getSheet('product_aliases'), getSheet(SET_RECIPES_SHEET), getSkuRedirectMap()])
    const recipesByKey = new Map() // `${set_sku}|${variation_name}` -> [{component_sku, qty_per_unit}]
    const keepSetSalesByKey = new Map() // same key -> true/false
    for (const row of setRecipeRows) {
      const setSku = String(row.set_sku || '').trim().toUpperCase()
      const variation = String(row.variation_name || '').trim()
      const componentSku = String(row.component_sku || '').trim().toUpperCase()
      const qtyPerUnit = Number(row.qty_per_unit) || 0
      if (!setSku || !variation || !componentSku || qtyPerUnit <= 0) continue
      const key = `${setSku}|${variation}`
      if (!recipesByKey.has(key)) recipesByKey.set(key, [])
      recipesByKey.get(key).push({ componentSku, qtyPerUnit })
      const keepRaw = String(row.keep_set_sales ?? '').trim()
      keepSetSalesByKey.set(key, keepRaw === '' ? true : keepRaw === '1' || keepRaw.toLowerCase() === 'true')
    }
    const mapped = new Map()
    for (const row of aliases) {
      const masterSku = String(row.master_sku || '').trim().toUpperCase()
      if (!/^PY/.test(masterSku)) continue
      const displayName = String(row.display_name || '').trim() || masterSku
      if (!mapped.has(masterSku)) mapped.set(masterSku, { masterSku, displayName })
    }
    const productMapping = [...mapped.values()].sort((a, b) => a.masterSku.localeCompare(b.masterSku, undefined, { numeric: true }))
    const allTabs = meta.sheets.map((sheet) => sheet.properties.title).filter((title) => title.startsWith('raw_orders')).sort()
    if (!allTabs.length) return res.status(200).json({ success: true, items: [], productMapping, anchor: '', start: '', days, fetchedAt: new Date().toISOString() })

    // ห้ามเดาว่า 4 tab ท้ายสุด (เรียงตามชื่อ) = 4 เดือนล่าสุดที่มีข้อมูลจริง — import-orders.js/ensureSheet
    // สร้าง tab เดือนล่วงหน้าไว้ล่วงหน้าได้ (ว่างเปล่า, แค่ header) ซึ่งจะอยู่ท้ายสุดตามชื่อเสมอ
    // เช็คคอลัมน์ D (วันที่) ของทุก tab ก่อน (เบา แค่คอลัมน์เดียว) แล้วค่อยเลือก 4 tab ที่มีข้อมูลจริงล่าสุด
    const dateCols = await batchGetValues(allTabs.map((tab) => `${tab}!D:D`))
    const dataTabs = allTabs.filter((tab, i) => (dateCols[i]?.values || []).length > 1)
    const tabs = dataTabs.slice(-4)
    if (!tabs.length) return res.status(200).json({ success: true, items: [], productMapping, anchor: '', start: '', days, fetchedAt: new Date().toISOString() })

    // I:N แทน J:N เดิม — เพิ่มคอลัมน์ variation_name (I) เข้ามาด้วย เพื่อแตกยอด Set ตาม variation
    const productCols = await batchGetValues(tabs.map((tab) => `${tab}!I:N`))
    const raw = []
    let anchor = ''

    for (let index = 0; index < tabs.length; index += 1) {
      const dates = dateCols[allTabs.indexOf(tabs[index])]?.values || []
      const products = productCols[index]?.values || []
      const length = Math.max(dates.length, products.length)
      for (let rowIndex = 1; rowIndex < length; rowIndex += 1) {
        const date = String(dates[rowIndex]?.[0] || '').slice(0, 10)
        const row = products[rowIndex] || []
        const variationName = String(row[0] || '').trim()
        let masterSku = String(row[1] || '').trim().toUpperCase()
        const name = String(row[2] || masterSku).trim()
        const qty = parseInt(row[3], 10) || 0
        // แพลนฟีดอ้างอิงงานที่ออกทั้งหมด จึงนับจำนวนชิ้นรวมสถานะยกเลิก/ตีคืนด้วย
        if (!date || !name || qty <= 0) continue
        if (date > anchor) anchor = date

        // เช็ค set_recipes ด้วยโค้ด "เดิม" ก่อนเสมอ (สูตรอ้างอิงโค้ดเดิมที่ปนกัน เช่น PY075) — ต้องทำ
        // ก่อน redirect ไม่งั้นโค้ดจะเปลี่ยนไปแล้วหาสูตรไม่เจอ (เช่น PY075→PY077 จะทำให้หา 'PY077|...' ไม่เจอ)
        const key = `${masterSku}|${variationName}`
        const recipe = recipesByKey.get(key)
        if (recipe) {
          // Set จริง (เช่น PY067) ยังนับยอดของตัวเองด้วยเสมอ เพราะต้องวัดว่า Set นั้นขายดีไหม —
          // เว้นแต่ตั้ง keep_set_sales=0 ไว้ (เคส SKU ปนกันผิด ไม่ใช่ Set จริง เช่น PY075)
          if (keepSetSalesByKey.get(key) !== false) raw.push({ date, masterSku, name, qty })
          for (const { componentSku, qtyPerUnit } of recipe) {
            const componentName = mapped.get(componentSku)?.displayName || componentSku
            raw.push({ date, masterSku: componentSku, name: componentName, qty: qty * qtyPerUnit })
          }
        } else {
          // ไม่ตรงสูตร Set — เป็นยอดขายจริงของ SKU นี้ ค่อย redirect โค้ดที่ย้ายไปแล้ว (แก้ได้จากชีท sku_redirects)
          const redirectedSku = resolveRedirect(masterSku, redirectMap)
          raw.push({ date, masterSku: redirectedSku, name, qty })
        }
      }
    }

    const start = anchor ? addDays(anchor, -(days - 1)) : ''
    const aggregated = new Map()
    for (const row of raw) {
      if (!start || row.date < start || row.date > anchor) continue
      const key = row.masterSku.toUpperCase() || normalizeName(row.name)
      let item = aggregated.get(key)
      if (!item) aggregated.set(key, (item = { key, name: row.name, masterSku: row.masterSku, units90: 0, lastDate: '' }))
      item.units90 += row.qty
      if (row.date > item.lastDate) item.lastDate = row.date
    }

    const ranked = [...aggregated.values()].sort((a, b) => b.units90 - a.units90)
    const totalUnits = ranked.reduce((sum, item) => sum + item.units90, 0)
    let cumulative = 0
    const items = ranked.map((item) => {
      const before = totalUnits ? cumulative / totalUnits : 1
      const abc = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'
      cumulative += item.units90
      return { ...item, abc, dailyAverage: Math.round((item.units90 / days) * 10) / 10, cumulativePercent: totalUnits ? Math.round((cumulative / totalUnits) * 1000) / 10 : 0 }
    })

    const data = { success: true, items, productMapping, anchor, start, days, totalUnits, includesCancelledReturned: true, fetchedAt: new Date().toISOString() }
    cacheByDays.set(days, { at: Date.now(), data })
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=21600')
    return res.status(200).json(data)
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}
