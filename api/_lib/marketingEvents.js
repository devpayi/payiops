// GET/POST/PATCH /api/marketing-events
// Lightweight marketing action log plus sales snapshots from raw_orders_*.
import { requireMarketingManager } from './auth.js'
import { appendRows, batchGetValues, ensureSheet, getMeta, getSheet, overwriteSheet } from './sheets.js'
import { buildOverrideMap, deriveGroup } from './productGroup.js'
import { recommendMarketingAction } from '../../shared/marketingRadar.js'

const SHEET = 'marketing_events'
const HEADERS = [
  'event_id',
  'product_key',
  'master_sku',
  'display_name',
  'business',
  'platform',
  'event_type',
  'event_date',
  'confirmed_at',
  'status',
  'owner',
  'note',
  'created_at',
  'updated_at',
  'review7_decision',
  'review7_note',
  'review7_at',
  'review7_by',
  'review30_decision',
  'review30_note',
  'review30_at',
  'review30_by',
]

const EVENT_LABELS = {
  new_product: 'ลงสินค้าใหม่',
  image_change: 'แก้รูปสินค้า',
  package_change: 'ปรับแพ็คเกจ',
  video_posted: 'ลงคลิป',
  content_push: 'ดันคอนเทนต์',
  boss_sent: 'ส่งให้บอสแล้ว',
}

const STATUS_LABELS = {
  waiting: 'รอยืนยันขึ้นร้าน',
  live: 'เริ่มนับผลแล้ว',
  check7: 'ถึงรอบเช็ก 7 วัน',
  check30: 'ถึงรอบเช็ก 30 วัน',
  content: 'ควรดันคอนเทนต์ต่อ',
  done: 'จบแล้ว',
}

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const round2 = (n) => Math.round(n * 100) / 100
const isCancelled = (s = '') => s.includes('ยกเลิก') || s.toLowerCase().includes('cancel')
const isReturned = (s = '') => s.toLowerCase().includes('return')
const dayMs = 86400000
const todayIso = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const day10 = (v) => String(v ?? '').slice(0, 10) // กันกรณีค่ามี timestamp ปน (เช่น "2026-05-01T..") ไม่ให้ Date พัง
const addDays = (iso, days) => {
  const d = new Date(`${day10(iso)}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (start, end) => Math.floor((new Date(`${day10(end)}T00:00:00Z`) - new Date(`${day10(start)}T00:00:00Z`)) / dayMs)
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)

function rowToEvent(row) {
  return Object.fromEntries(HEADERS.map((h) => [h, row[h] ?? '']))
}

function eventToRow(event) {
  return HEADERS.map((h) => event[h] ?? '')
}

async function getMarketingRows() {
  await ensureSheet(SHEET, HEADERS)
  return (await getSheet(SHEET)).map(rowToEvent)
}

async function readOrderRows() {
  let overrideMap = new Map()
  try {
    overrideMap = buildOverrideMap(await getSheet('product_aliases'))
  } catch {
    // Optional mapping sheet.
  }

  const meta = await getMeta()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
  if (!tabs.length) return []

  const ranges = tabs.flatMap((t) => [`${t}!B:F`, `${t}!J:N`])
  const vr = await batchGetValues(ranges)
  const rows = []

  for (let i = 0; i < tabs.length; i++) {
    const left = vr[2 * i].values || []
    const right = vr[2 * i + 1].values || []
    const n = Math.max(left.length, right.length)
    for (let j = 1; j < n; j++) {
      const l = left[j] || []
      const r = right[j] || []
      const date = l[2]
      const platform = l[3] || ''
      const business = l[4] || ''
      const masterSku = r[0]
      const displayName = r[1]
      const qty = parseInt(r[2], 10) || 0
      const revenue = num(r[3])
      const status = r[4]
      if (!date || isCancelled(status) || isReturned(status)) continue

      const group = deriveGroup(displayName, masterSku, overrideMap)
      rows.push({
        date,
        platform,
        business,
        master_sku: masterSku || '',
        display_name: displayName || masterSku || '',
        product_key: group.key,
        product_label: group.label,
        qty,
        revenue,
      })
    }
  }

  return rows
}

function matchEvent(order, event) {
  const sku = String(event.master_sku || '').trim()
  const key = String(event.product_key || '').trim()
  const platform = String(event.platform || 'all').trim()
  const business = String(event.business || 'all').trim()
  const outletSelected = platform === 'Payi Outlet'
  if (sku && order.master_sku !== sku) return false
  if (!sku && key && order.product_key !== key) return false
  if (outletSelected && order.business !== 'Payi Outlet') return false
  if (!outletSelected && platform && platform !== 'all' && order.platform !== platform) return false
  if (outletSelected) return true
  if (business && business !== 'all' && order.business !== business) return false
  return true
}

function sumWindow(orders, event, start, end) {
  const matched = orders.filter((order) => matchEvent(order, event) && order.date >= start && order.date <= end)
  const orderDays = new Set(matched.map((order) => order.date))
  return {
    start,
    end,
    days: Math.max(1, daysBetween(start, end) + 1),
    revenue: round2(matched.reduce((sum, order) => sum + order.revenue, 0)),
    units: matched.reduce((sum, order) => sum + order.qty, 0),
    activeDays: orderDays.size,
  }
}

function buildSnapshot(event, orders, dataThrough) {
  const anchor = event.confirmed_at || event.event_date
  if (!anchor) return null
  const before7 = sumWindow(orders, event, addDays(anchor, -7), addDays(anchor, -1))
  const after7 = sumWindow(orders, event, anchor, addDays(anchor, 6))
  const after30 = sumWindow(orders, event, anchor, addDays(anchor, 29))
  const daysLive = event.confirmed_at ? Math.max(0, daysBetween(event.confirmed_at, dataThrough)) : null
  const observedDays = event.confirmed_at && dataThrough >= event.confirmed_at
    ? Math.min(30, daysLive + 1)
    : 0
  const check7Due = Boolean(event.confirmed_at && observedDays >= 7)
  const check30Due = Boolean(event.confirmed_at && observedDays >= 30)
  const partialEnd = observedDays > 0 ? addDays(anchor, Math.min(6, observedDays - 1)) : anchor
  const afterPartial = observedDays > 0 ? sumWindow(orders, event, anchor, partialEnd) : null

  return {
    anchor,
    daysLive,
    observedDays,
    dataThrough,
    before7,
    after7,
    after30,
    afterPartial,
    lift7: pct(after7.units, before7.units),
    lift30: pct(after30.units / 30, before7.units / 7),
    check7Due,
    check30Due,
  }
}

function sameTrackedProduct(a, b) {
  if (a.master_sku && b.master_sku) return a.master_sku === b.master_sku
  return Boolean(a.product_key && b.product_key && a.product_key === b.product_key)
}

function decorateEvents(events, orders, dataThrough = latestOrderDate(orders)) {
  const base = events
    .filter((event) => event.event_id)
    .map((event) => {
      const snapshot = buildSnapshot(event, orders, dataThrough)
      const daysSinceEvent = event.event_date ? daysBetween(event.event_date, dataThrough) : null
      const inferredStatus = event.status || (event.confirmed_at ? 'live' : 'waiting')
      return {
        ...event,
        event_label: EVENT_LABELS[event.event_type] || event.event_type || 'Event',
        status: inferredStatus,
        status_label: STATUS_LABELS[inferredStatus] || inferredStatus,
        daysSinceEvent,
        snapshot,
      }
    })

  return base
    .map((event) => {
      const anchor = event.confirmed_at || event.event_date
      const overlaps = base.filter((other) => {
        if (other.event_id === event.event_id || !sameTrackedProduct(event, other)) return false
        const otherAnchor = other.confirmed_at || other.event_date
        return anchor && otherAnchor && Math.abs(daysBetween(anchor, otherAnchor)) <= 30
      })
      const reviewDay = event.snapshot?.check30Due ? 30 : 7
      const after = reviewDay === 30 ? event.snapshot?.after30 : event.snapshot?.after7
      const complete = reviewDay === 30 ? event.snapshot?.check30Due : event.snapshot?.check7Due
      const recommendation = event.snapshot
        ? recommendMarketingAction({
            before: event.snapshot.before7,
            after,
            reviewDay,
            complete,
            overlap: overlaps.length > 0,
          })
        : null
      const needsReview = event.status !== 'done' && (
        (event.snapshot?.check30Due && !event.review30_decision) ||
        (event.snapshot?.check7Due && !event.review7_decision)
      )
      const dueReviewDay = event.snapshot?.check30Due && !event.review30_decision
        ? 30
        : event.snapshot?.check7Due && !event.review7_decision
          ? 7
          : null

      return {
        ...event,
        overlaps: overlaps.map((item) => ({
          event_id: item.event_id,
          event_label: item.event_label,
          event_date: item.event_date,
        })),
        recommendation,
        needs_review: needsReview,
        due_review_day: dueReviewDay,
      }
    })
    .sort((a, b) =>
      Number(b.needs_review) - Number(a.needs_review) ||
      Number(b.due_review_day || 0) - Number(a.due_review_day || 0) ||
      String(b.event_date || '').localeCompare(String(a.event_date || ''))
    )
}

function buildRadar(events) {
  const buckets = {
    waiting: [],
    live: [],
    check7: [],
    check30: [],
    content: [],
  }

  for (const event of events) {
    if (event.status === 'done') continue // เสร็จแล้ว → ออกจากบอร์ด เหลือแค่ในประวัติ
    if (!event.confirmed_at || event.status === 'waiting') buckets.waiting.push(event)
    else if (event.due_review_day === 30) buckets.check30.push(event)
    else if (event.due_review_day === 7) buckets.check7.push(event)
    else if (event.review7_decision === 'scale' || event.status === 'content') buckets.content.push(event)
    else buckets.live.push(event)
  }

  return buckets
}

// ยึด "วันล่าสุดที่มีข้อมูลจริง" (anchor) แทนวันนี้ — กันพาเนลว่างตอนข้อมูลไม่สด
function latestOrderDate(orders) {
  return orders.reduce((max, o) => (o.date > max ? o.date : max), '') || todayIso()
}

function buildProductSignals(orders, anchor = latestOrderDate(orders)) {
  const thisStart = addDays(anchor, -6)
  const prevStart = addDays(anchor, -13)
  const prevEnd = addDays(anchor, -7)
  const products = new Map()

  for (const order of orders) {
    let product = products.get(order.product_key)
    if (!product) {
      product = {
        product_key: order.product_key,
        display_name: order.product_label || order.display_name,
        master_sku: order.master_sku,
        revenue7: 0,
        revenuePrev7: 0,
        units7: 0,
        unitsPrev7: 0,
        platforms: new Map(),
      }
      products.set(order.product_key, product)
    }
    if (order.date >= thisStart && order.date <= anchor) {
      product.revenue7 += order.revenue
      product.units7 += order.qty
      product.platforms.set(order.platform, (product.platforms.get(order.platform) || 0) + order.revenue)
    } else if (order.date >= prevStart && order.date <= prevEnd) {
      product.revenuePrev7 += order.revenue
      product.unitsPrev7 += order.qty
    }
  }

  return [...products.values()]
    .map((product) => ({
      ...product,
      revenue7: round2(product.revenue7),
      revenuePrev7: round2(product.revenuePrev7),
      lift7: pct(product.units7, product.unitsPrev7),
      platforms: Object.fromEntries(product.platforms.entries()),
    }))
    .filter((product) => product.revenue7 > 0)
    .sort((a, b) => {
      const aScore = (a.lift7 || 0) * 1000 + a.units7
      const bScore = (b.lift7 || 0) * 1000 + b.units7
      return bScore - aScore
    })
    .slice(0, 20)
}

function buildProductOptions(orders) {
  const products = new Map()
  for (const order of orders) {
    const key = order.product_key || order.master_sku || order.display_name
    if (!key) continue
    let product = products.get(key)
    if (!product) {
      product = {
        product_key: order.product_key || key,
        display_name: order.product_label || order.display_name || order.master_sku || key,
        master_sku: '',
        revenue: 0,
        units: 0,
        lastDate: '',
        skuSet: new Set(),
      }
      products.set(key, product)
    }
    product.revenue += order.revenue
    product.units += order.qty
    if (order.date > product.lastDate) product.lastDate = order.date
    if (order.master_sku) product.skuSet.add(order.master_sku)
  }

  return [...products.values()]
    .map((product) => ({
      product_key: product.product_key,
      display_name: product.display_name,
      master_sku: '',
      revenue: round2(product.revenue),
      units: product.units,
      lastDate: product.lastDate,
      skuCount: product.skuSet.size,
    }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.revenue - a.revenue)
    .slice(0, 200)
}

function bodyFromReq(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

export default async function handler(req, res) {
  if (!requireMarketingManager(req, res)) return
  try {
    if (req.method === 'GET') {
      const [events, orders] = await Promise.all([getMarketingRows(), readOrderRows()])
      const anchor = latestOrderDate(orders)
      const decorated = decorateEvents(events, orders, anchor)
      const reviewQueue = decorated.filter((event) => event.needs_review)
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        success: true,
        events: decorated,
        radar: buildRadar(decorated),
        productSignals: buildProductSignals(orders, anchor),
        productOptions: buildProductOptions(orders),
        signalWindow: { start: addDays(anchor, -6), end: anchor },
        dataThrough: anchor,
        dueReviewCount: reviewQueue.length,
      })
    }

    if (req.method === 'POST') {
      await ensureSheet(SHEET, HEADERS)
      const body = bodyFromReq(req)
      const now = new Date().toISOString()
      const event = {
        event_id: `mkt_${Date.now()}`,
        product_key: String(body.product_key || '').trim(),
        master_sku: String(body.master_sku || '').trim(),
        display_name: String(body.display_name || body.master_sku || '').trim(),
        business: String(body.business || 'all').trim(),
        platform: String(body.platform || 'all').trim(),
        event_type: String(body.event_type || 'image_change').trim(),
        event_date: String(body.event_date || todayIso()).slice(0, 10),
        confirmed_at: String(body.confirmed_at || body.event_date || todayIso()).slice(0, 10),
        status: String(body.status || 'live').trim(),
        owner: String(body.owner || req.user?.username || '').trim(),
        note: String(body.note || '').trim(),
        created_at: now,
        updated_at: now,
      }
      if (!event.product_key && !event.master_sku) {
        return res.status(400).json({ success: false, error: 'product_key or master_sku is required' })
      }
      await appendRows(SHEET, [eventToRow(event)])
      return res.status(200).json({ success: true, event })
    }

    if (req.method === 'PATCH') {
      const body = bodyFromReq(req)
      const eventId = String(body.event_id || '').trim()
      if (!eventId) return res.status(400).json({ success: false, error: 'event_id is required' })

      const rows = await getMarketingRows()
      const now = new Date().toISOString()
      const nextRows = rows.map((event) => {
        if (event.event_id !== eventId) return event
        const next = { ...event, updated_at: now }
        for (const key of ['status', 'confirmed_at', 'note', 'owner', 'event_type', 'event_date', 'platform', 'business']) {
          if (body[key] !== undefined) {
            const v = String(body[key]).trim()
            next[key] = (key === 'confirmed_at' || key === 'event_date') ? v.slice(0, 10) : v
          }
        }
        if (body.review_day !== undefined && body.decision !== undefined) {
          const reviewDay = Number(body.review_day) === 30 ? 30 : 7
          const decision = String(body.decision || '').trim()
          if (!['scale', 'iterate', 'stop'].includes(decision)) return next
          const prefix = reviewDay === 30 ? 'review30' : 'review7'
          next[`${prefix}_decision`] = decision
          next[`${prefix}_note`] = String(body.decision_note || '').trim()
          next[`${prefix}_at`] = now
          next[`${prefix}_by`] = String(req.user?.username || req.user?.role || 'Boss')
          if (reviewDay === 30 || decision === 'stop') next.status = 'done'
          else next.status = decision === 'scale' ? 'content' : 'live'
        }
        if (next.status === 'live' && !next.confirmed_at) next.confirmed_at = todayIso()
        return next
      })
      await overwriteSheet(SHEET, HEADERS, nextRows.map(eventToRow))
      return res.status(200).json({ success: true })
    }

    if (req.method === 'DELETE') {
      // event_id ส่งมาทาง query (dev middleware ไม่ parse body ของ DELETE)
      const eventId = String(req.query.event_id || '').trim()
      if (!eventId) return res.status(400).json({ success: false, error: 'event_id is required' })
      const rows = await getMarketingRows()
      const nextRows = rows.filter((event) => event.event_id !== eventId)
      await overwriteSheet(SHEET, HEADERS, nextRows.map(eventToRow))
      return res.status(200).json({ success: true, deleted: rows.length - nextRows.length })
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
