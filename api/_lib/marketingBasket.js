// GET /api/marketing?kind=basket&action=summary|product|pair-detail — วิเคราะห์ "ออเดอร์ที่ซื้อพ่วง"
// สินค้ากลุ่มไหนถูกซื้อคู่กับกลุ่มไหนบ่อยสุด แยกตาม Shopee/TikTok/Lazada/Outlet — ใช้ประกอบการจัด Set/โปรโมชั่น
// เดิมเจ้าของทำมือใน Google Sheet (group by order → นับคู่สินค้าที่ขึ้นด้วยกัน) ย้ายมาคำนวณสดจาก raw_orders
import { requireMarketingManager, cacheable } from './auth.js'
import { getMeta, batchGetValues, getSheet } from './sheets.js'
import { deriveGroup, buildOverrideMap } from './productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku } from './skuMapping.js'

const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
const isReturned = (s = '') => s.toLowerCase().includes('return')

// อ่าน raw_orders ทั้งหมดหนักพอสมควร (เหมือน products.js) — cache รายการดิบไว้ 6 ชม.
// ส่วนสรุป/รายละเอียดคำนวณสดทุก request จาก cache นี้ (ถูก ไม่ต้องอ่าน Sheets ซ้ำตอนเปลี่ยนเดือน/บัคเก็ต)
const CACHE_MS = 6 * 60 * 60 * 1000
let rawCache = null

const TOP_N = 40
const DETAIL_LIMIT = 30

// "Outlet" ไม่ใช่แพลตฟอร์มจริง แต่เจ้าของอยากแยกยอด Payi Outlet ออกมาเป็นบัคเก็ตของตัวเอง
// (ข้ามการนับซ้ำใน Shopee/TikTok/Lazada — ออเดอร์ Outlet ไปรวมที่ "Outlet" อย่างเดียว)
const BUCKET_ORDER = ['Shopee', 'TikTok Shop', 'Lazada', 'Outlet']
const bucketOf = (business, platform) => (String(business || '').trim() === 'Payi Outlet' ? 'Outlet' : String(platform || '').trim())

// ดึงรายการออเดอร์ดิบทั้งหมด — ไม่รวมยกเลิก/ตีคืน, เฉพาะ master_sku ขึ้นต้น PY
async function loadRawOrders() {
  let overrideMap = new Map()
  try {
    overrideMap = buildOverrideMap(await getSheet('product_aliases'))
  } catch { /* ไม่มี sheet หรืออ่านไม่ได้ — ใช้การ strip อัตโนมัติแทน */ }
  const [redirectMap, recipeKeySet] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet()])

  const meta = await getMeta()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))

  // B:F = order_id, order_item_id, date, platform, business ; I:N = variation_name, master_sku, display_name, qty, revenue, status
  const ranges = tabs.flatMap((t) => [`${t}!B:F`, `${t}!I:N`])
  const vr = ranges.length ? await batchGetValues(ranges) : []

  // orderKey (`${bucket}|${orderId}`) -> { orderId, date, bucket, month, groups: Set(groupKey) }
  const orders = new Map()
  const groupLabelByKey = new Map()
  const monthsSet = new Set()

  for (let i = 0; i < tabs.length; i++) {
    const left = vr[2 * i]?.values || []
    const right = vr[2 * i + 1]?.values || []
    const n = Math.max(left.length, right.length)
    for (let j = 1; j < n; j++) {
      const l = left[j] || [], r = right[j] || []
      const orderId = l[0], date = l[2], plat = l[3] || '', biz = l[4] || ''
      const variationName = r[0], rawMasterSku = r[1], name = r[2], status = r[5]
      if (!orderId || !plat || !date) continue
      const masterSku = resolveSalesSku(rawMasterSku, variationName, redirectMap, recipeKeySet)
      if (!/^PY/i.test(String(masterSku || ''))) continue
      if (isCancelled(status) || isReturned(status)) continue

      const { key, label } = deriveGroup(name, masterSku, overrideMap)
      groupLabelByKey.set(key, label)

      const bucket = bucketOf(biz, plat)
      const month = String(date).slice(0, 7)
      monthsSet.add(month)

      const orderKey = `${bucket}|${orderId}`
      let o = orders.get(orderKey)
      if (!o) orders.set(orderKey, (o = { orderId, date: String(date).slice(0, 10), bucket, month, groups: new Set() }))
      o.groups.add(key)
    }
  }

  return {
    orders: [...orders.values()].map((o) => ({ ...o, groups: [...o.groups].sort() })),
    groupLabelByKey,
    months: [...monthsSet].sort(),
  }
}

const filterOrders = (orders, month, bucket) =>
  orders.filter((o) => (!month || o.month === month) && (!bucket || bucket === 'all' || o.bucket === bucket))

// สรุปคู่/เดี่ยวของ orders ที่กรองไว้แล้ว (ทั้งบัคเก็ต)
function summarize(scoped, groupLabelByKey) {
  const totalOrders = scoped.length
  const pairCounts = new Map()
  const singleCounts = new Map()

  for (const o of scoped) {
    const arr = o.groups
    if (arr.length === 1) {
      singleCounts.set(arr[0], (singleCounts.get(arr[0]) || 0) + 1)
      continue
    }
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const pairKey = `${arr[a]}::${arr[b]}`
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1)
      }
    }
  }

  const pairs = [...pairCounts.entries()]
    .map(([pairKey, count]) => {
      const [keyA, keyB] = pairKey.split('::')
      return {
        keyA, keyB,
        a: groupLabelByKey.get(keyA) || keyA,
        b: groupLabelByKey.get(keyB) || keyB,
        orders: count,
        percentOfOrders: totalOrders ? Math.round((count / totalOrders) * 10000) / 100 : 0,
      }
    })
    .sort((x, y) => y.orders - x.orders)
    .slice(0, TOP_N)

  const topSingles = [...singleCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: groupLabelByKey.get(key) || key,
      orders: count,
      percentOfOrders: totalOrders ? Math.round((count / totalOrders) * 10000) / 100 : 0,
    }))
    .sort((x, y) => y.orders - x.orders)
    .slice(0, TOP_N)

  return { totalOrders, pairs, topSingles }
}

// โฟกัสสินค้าเดียว — ขายคู่กับอะไรมากที่สุด (จาก orders ที่มีสินค้านี้อยู่เท่านั้น)
function productFocus(scoped, focusKey, groupLabelByKey) {
  const withProduct = scoped.filter((o) => o.groups.includes(focusKey))
  const totalOrders = withProduct.length
  const counts = new Map()
  let soloOrders = 0

  for (const o of withProduct) {
    const others = o.groups.filter((g) => g !== focusKey)
    if (!others.length) { soloOrders += 1; continue }
    for (const g of others) counts.set(g, (counts.get(g) || 0) + 1)
  }

  const pairs = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: groupLabelByKey.get(key) || key,
      orders: count,
      percentOfProductOrders: totalOrders ? Math.round((count / totalOrders) * 10000) / 100 : 0,
    }))
    .sort((x, y) => y.orders - x.orders)
    .slice(0, TOP_N)

  return {
    product: groupLabelByKey.get(focusKey) || focusKey,
    totalOrders,
    soloOrders,
    pairs,
  }
}

function pairDetail(scoped, keyA, keyB, groupLabelByKey) {
  return scoped
    .filter((o) => o.groups.includes(keyA) && o.groups.includes(keyB))
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, DETAIL_LIMIT)
    .map((o) => ({ orderId: o.orderId, date: o.date, items: o.groups.map((k) => groupLabelByKey.get(k) || k) }))
}

export default async function handler(req, res) {
  if (!requireMarketingManager(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    if (!rawCache || Date.now() - rawCache.at >= CACHE_MS) {
      rawCache = { at: Date.now(), data: await loadRawOrders() }
    }
    const { orders, groupLabelByKey, months } = rawCache.data
    const requestedMonth = String(req.query.month || 'all')
    const month = requestedMonth === 'all' ? null : (months.includes(requestedMonth) ? requestedMonth : null)
    const action = String(req.query.action || 'summary')

    res.setHeader('Cache-Control', cacheable('private, max-age=300, stale-while-revalidate=21600'))

    if (action === 'product') {
      const bucket = String(req.query.bucket || '')
      const focusKey = String(req.query.product || '')
      if (!bucket || !focusKey) return res.status(400).json({ success: false, error: 'ต้องระบุ bucket และ product' })
      const scoped = filterOrders(orders, month, bucket)
      return res.status(200).json({ success: true, month: month || 'all', bucket, ...productFocus(scoped, focusKey, groupLabelByKey) })
    }

    if (action === 'pair-detail') {
      const bucket = String(req.query.bucket || '')
      const keyA = String(req.query.a || ''), keyB = String(req.query.b || '')
      if (!bucket || !keyA || !keyB) return res.status(400).json({ success: false, error: 'ต้องระบุ bucket, a, b' })
      const scoped = filterOrders(orders, month, bucket)
      return res.status(200).json({ success: true, examples: pairDetail(scoped, keyA, keyB, groupLabelByKey) })
    }

    // action === 'summary' (default) — "all" = ทุกแพลตฟอร์มรวมกัน (bucket เทียม ไม่ filter จริง)
    const bucketOrder = ['all', ...BUCKET_ORDER]
    const platforms = {}
    for (const bucket of bucketOrder) {
      const scoped = filterOrders(orders, month, bucket)
      if (scoped.length) platforms[bucket] = summarize(scoped, groupLabelByKey)
    }
    const groupOptions = [...groupLabelByKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'th'))

    return res.status(200).json({
      success: true,
      month: month || 'all',
      months,
      bucketOrder,
      platforms,
      groupOptions,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message })
  }
}
