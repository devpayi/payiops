// GET/POST /api/sheet-tools?op=fulfillment — วิเคราะห์ว่าเมื่อไหร่ถึงจังหวะย้ายงานแพ็คเข้า Fulfillment
// DEV-only (gated ใน sheet-tools.js) เหมือน cfo/demographic/import-tracking
//
// โจทย์: ค่าแรงทีมแพ็ค 4 คนเป็น fixed cost — ย้ายเข้า FBS ไม่ประหยัดเงินจนกว่าจะโตชนเพดานทีม
// (ต้อง OT เยอะ / จ้างคนที่ 5) หรือ FBS ถูกกว่าค่า OT ต่อออเดอร์. เครื่องมือนี้ = สัญญาณ ไม่ใช่ "ทำเลย"
//
// views (รวมใน summary เดียว):
//   fbsUsage   — % ออเดอร์ Shopee ที่ผ่าน Fulfilled By Shopee อยู่แล้ว + trend รายเดือน
//   byProduct  — คะแนน "ควร/ไม่ควร FBS" รายกลุ่มสินค้า (ขายเยอะ+ส่งธรรมดาสูง = ควร / ส่งด่วนสูง = เก็บแพ็คเอง)
//   capacity   — ออเดอร์/วัน, ใช้กำลังทีมกี่ %, โตเดือนละเท่าไร, ชนเพดานเมื่อไหร่
//   otAudit    — ชม. OT รายวัน เทียบออเดอร์วันนั้น — วันไหน OT เยอะแต่ออเดอร์น้อย = เฟ้อ
import { getSheet, ensureSheet, getMetaCached, batchGetValues, overwriteSheet } from './sheets.js'
import { deriveGroup, buildOverrideMap } from './productGroup.js'
import { shopeeShippingOption, isFastShopeeOption } from './shippingClass.js'

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const isCancelled = (s = '') => String(s).includes('ยกเลิก') || String(s).toLowerCase().includes('cancel')
const isFbsOption = (opt) => /fulfilled by shopee| full?filled by shopee|ffm by shopee/i.test(String(opt || ''))

const CONFIG_HEADERS = ['key', 'value', 'updated_at']
// โมเดล capacity คิดจาก "เวลาเลิกงาน" ไม่ใช่อัตราแพ็คที่เดาเอง — self-calibrate จากข้อมูลจริง:
// throughput = ออเดอร์/วันล่าสุด ÷ (คน × ชม.ทำงานปกติ). เพดาน = ปริมาณที่ทำให้เลิกงานตรง max_finish
const CONFIG_DEFAULTS = {
  pack_headcount: 4,           // คนแพ็ค
  pack_start: 8.0,             // เข้างาน (8:00)
  normal_finish: 14.5,         // เลิกปกติที่เห็นตอนนี้ (~14:30 — ใช้ calibrate throughput)
  max_finish: 17.0,            // เลิกช้าสุดที่รับได้ ก่อนต้อง OT/จ้างเพิ่ม (17:00)
  daily_wage: 400,             // ค่าแรง/คน/วัน
  ot_rate_per_hour: 50,        // ค่า OT/ชม.
  fbs_fee_per_piece: 0,        // ค่าธรรมเนียม FBS/ชิ้น (เดือนหน้าเริ่มคิด)
  fbs_storage_monthly: 0,      // ค่าเก็บของ FBS/เดือน
}

async function loadConfig() {
  await ensureSheet('fulfillment_config', CONFIG_HEADERS)
  const rows = await getSheet('fulfillment_config')
  const cfg = { ...CONFIG_DEFAULTS }
  for (const r of rows) {
    const k = String(r.key || '').trim()
    if (k in cfg) cfg[k] = num(r.value)
  }
  return cfg
}

async function readOrders() {
  const meta = await getMetaCached()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
  if (!tabs.length) return []
  // B:B = order_id ; D:V = date(0) platform(1) business(2) ... master_sku(6) display_name(7)
  //   qty(8) revenue(9) order_status(10) ... shipping_option(16)
  const vr = await batchGetValues(tabs.flatMap((t) => [`${t}!B:B`, `${t}!D:V`]))
  const out = []
  for (let i = 0; i < tabs.length; i++) {
    const idRows = vr[i * 2].values || []
    const rows = vr[i * 2 + 1].values || []
    for (let j = 1; j < rows.length; j++) {
      const r = rows[j] || []
      if (!r[0] || isCancelled(r[10])) continue
      out.push({
        orderId: String((idRows[j] || [])[0] || '').replace(/^'/, '').trim(),
        date: String(r[0]).slice(0, 10),
        platform: String(r[1] || '').trim(),
        masterSku: r[6] || '',
        displayName: r[7] || '',
        qty: num(r[8]),
        revenue: num(r[9]),
        shipOption: r[16] || '',
        buyerHash: String(r[18] || '').trim(),
      })
    }
  }
  return out
}

// นับ "ออเดอร์" ราย order_id (dedupe line item) ต่อวัน — ทุกแพลตฟอร์ม
function ordersPerDay(rows) {
  const seen = new Set()
  const byDay = new Map()
  for (const r of rows) {
    if (!r.orderId || !r.date) continue
    const k = `${r.platform}:${r.orderId}`
    if (seen.has(k)) continue
    seen.add(k)
    byDay.set(r.date, (byDay.get(r.date) || 0) + 1)
  }
  return byDay
}

function fbsUsage(rows) {
  const shopee = rows.filter((r) => r.platform.toLowerCase().includes('shopee'))
  const withOpt = shopee.filter((r) => r.shipOption)
  const byMonth = new Map()
  let fbsOrders = 0, fbsUnits = 0, fbsRevenue = 0, totUnits = 0, totRevenue = 0
  for (const r of withOpt) {
    const ym = r.date.slice(0, 7)
    const m = byMonth.get(ym) || { month: ym, fbs: 0, self: 0 }
    const fbs = isFbsOption(r.shipOption)
    if (fbs) { m.fbs++; fbsOrders++; fbsUnits += r.qty; fbsRevenue += r.revenue }
    else m.self++
    totUnits += r.qty; totRevenue += r.revenue
    byMonth.set(ym, m)
  }
  const n = withOpt.length
  return {
    shopeeOrders: shopee.length,
    coveredOrders: n,
    coveragePct: shopee.length ? Math.round((n / shopee.length) * 1000) / 10 : 0,
    fbsOrderPct: n ? Math.round((fbsOrders / n) * 1000) / 10 : 0,
    fbsUnitPct: totUnits ? Math.round((fbsUnits / totUnits) * 1000) / 10 : 0,
    fbsRevenuePct: totRevenue ? Math.round((fbsRevenue / totRevenue) * 1000) / 10 : 0,
    trend: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ month: m.month, fbsPct: (m.fbs + m.self) ? Math.round((m.fbs / (m.fbs + m.self)) * 1000) / 10 : 0, orders: m.fbs + m.self })),
  }
}

async function byProduct(rows) {
  let overrideMap = new Map()
  try { overrideMap = buildOverrideMap(await getSheet('product_aliases')) } catch { /* ok */ }
  const shopee = rows.filter((r) => r.platform.toLowerCase().includes('shopee') && r.shipOption)
  // ช่วงวันที่ที่มีข้อมูล shipping — ใช้แปลง "ยอดรวมช่วงนี้" เป็น "ต่อเดือน"
  let minD = '9999', maxD = '0'
  for (const r of shopee) { if (r.date < minD) minD = r.date; if (r.date > maxD) maxD = r.date }
  const spanDays = (minD < maxD) ? Math.max(1, Math.round((new Date(maxD) - new Date(minD)) / 86400000) + 1) : 30
  const months = Math.max(0.3, spanDays / 30)

  const byGroup = new Map()
  for (const r of shopee) {
    const { key, label } = deriveGroup(r.displayName, r.masterSku, overrideMap)
    const g = byGroup.get(key) || { label, orders: 0, fast: 0, standard: 0, fbs: 0, stdUnits: 0 }
    g.orders++
    const optLabel = shopeeShippingOption(r.shipOption, r.platform)
    if (isFbsOption(r.shipOption)) { g.fbs++; g.stdUnits += r.qty }        // FBS + ส่งธรรมดา = demand ที่ FBS รับได้
    else if (isFastShopeeOption(optLabel)) g.fast++
    else { g.standard++; g.stdUnits += r.qty }
    byGroup.set(key, g)
  }
  const list = [...byGroup.values()]
    .filter((g) => g.orders >= 20)
    .map((g) => {
      const fastPct = Math.round((g.fast / g.orders) * 1000) / 10
      const standardPct = Math.round((g.standard / g.orders) * 1000) / 10
      const fbsPct = Math.round((g.fbs / g.orders) * 1000) / 10
      // ควร FBS: ขายเยอะ + ส่งธรรมดาสูง + ส่งด่วนต่ำ. verdict:
      //   'keep-self'     ส่งด่วน >= 25% (ความเร็วคือจุดขาย)
      //   'fbs-candidate' ส่งด่วน < 20% และ (standard + fbs ที่ทำอยู่แล้ว) >= 55%
      //   'review'        อื่น ๆ (ส่งด่วน 20–25%)
      let verdict = 'review'
      if (fastPct >= 25) verdict = 'keep-self'
      else if (fastPct < 20 && (standardPct + fbsPct) >= 55) verdict = 'fbs-candidate'
      // แนะนำส่ง FBS/รอบเติม (เดือนละครั้ง) = demand ส่งธรรมดาต่อเดือน (พอให้ค่อยๆหมดในเดือน)
      const fbsSendUnits = Math.round(g.stdUnits / months)
      return { label: g.label, orders: g.orders, fastPct, standardPct, fbsPct, verdict, fbsSendUnits }
    })
    .sort((a, b) => b.orders - a.orders)
  return { list, dataMonths: Math.round(months * 10) / 10, dataFrom: minD < maxD ? minD : null, dataTo: minD < maxD ? maxD : null }
}

// โหลดตามวันในสัปดาห์ — วันพีค (จันทร์?) คือตัวจริงที่ชนเพดาน ไม่ใช่ค่าเฉลี่ย
function weekdayLoad(rows, cap, cfg) {
  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
  const byDay = ordersPerDay(rows)
  const bucket = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }))
  for (const [date, orders] of byDay) {
    const d = new Date(date)
    if (isNaN(d)) continue
    bucket[d.getDay()].sum += orders; bucket[d.getDay()].n++
  }
  const series = bucket.map((b, w) => ({ day: DOW[w], avgOrders: b.n ? Math.round(b.sum / b.n) : 0 })).filter((x) => x.avgOrders > 0)
  if (series.length < 5 || !cap?.ready) return { ready: false }
  const overallAvg = series.reduce((s, x) => s + x.avgOrders, 0) / series.length
  const peak = [...series].sort((a, b) => b.avgOrders - a.avgOrders)[0]
  const oph = cap.ordersPerPersonHour, hc = cfg.pack_headcount || 4
  const finishPeak = cfg.pack_start + (oph > 0 ? peak.avgOrders / (hc * oph) : 0)
  return {
    ready: true,
    series,
    overallAvg: Math.round(overallAvg),
    peakDay: peak.day,
    peakAvgOrders: peak.avgOrders,
    peakRatio: overallAvg ? Math.round((peak.avgOrders / overallAvg) * 100) / 100 : 1,
    finishOnPeakDay: hhmm(finishPeak),
    peakOverCeiling: finishPeak > cfg.max_finish,
  }
}

// โหลดออเดอร์ตามวันที่ของเดือน (1-31) — หาช่วง 4 วันที่เบาสุดสำหรับเตรียมส่งของเข้า FBS
function dayOfMonthLoad(rows) {
  const byDay = ordersPerDay(rows)
  const bucket = Array.from({ length: 32 }, () => ({ sum: 0, n: 0 }))
  for (const [date, orders] of byDay) {
    const dom = parseInt(String(date).slice(8, 10), 10)
    if (dom >= 1 && dom <= 31) { bucket[dom].sum += orders; bucket[dom].n++ }
  }
  const series = []
  for (let d = 1; d <= 31; d++) {
    if (bucket[d].n === 0) continue
    series.push({ day: d, avgOrders: Math.round(bucket[d].sum / bucket[d].n) })
  }
  if (series.length < 10) return { ready: false }
  // หน้าต่าง 4 วันติดกัน (ตามลำดับวันจริงใน series) ที่ค่าเฉลี่ยรวมต่ำสุด
  let best = null
  for (let i = 0; i + 3 < series.length; i++) {
    const win = series.slice(i, i + 4)
    const avg = win.reduce((s, x) => s + x.avgOrders, 0) / 4
    if (!best || avg < best.avg) best = { avg, start: win[0].day, end: win[3].day }
  }
  const overallAvg = series.reduce((s, x) => s + x.avgOrders, 0) / series.length
  return {
    ready: true,
    series,
    bestWindow: best ? { start: best.start, end: best.end, avgOrders: Math.round(best.avg) } : null,
    overallAvg: Math.round(overallAvg),
  }
}

// ชม.ทศนิยม -> "HH:MM"
const hhmm = (h) => {
  if (h == null || !isFinite(h)) return '-'
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function capacity(rows, cfg) {
  const byDay = ordersPerDay(rows)
  const days = [...byDay.entries()].map(([date, orders]) => ({ date, orders })).sort((a, b) => a.date.localeCompare(b.date))
  if (days.length < 14) return { ready: false }
  const avg = (arr) => (arr.length ? arr.reduce((s, d) => s + d.orders, 0) / arr.length : 0)
  const recent = days.slice(-14)
  const prior = days.slice(-44, -30)          // ~1 เดือนก่อน
  const recentAvg = avg(recent)
  const priorAvg = avg(prior)
  const monthlyGrowthPct = priorAvg ? Math.round(((recentAvg - priorAvg) / priorAvg) * 1000) / 10 : 0

  const headcount = cfg.pack_headcount || 4
  const normalHours = Math.max(0.5, cfg.normal_finish - cfg.pack_start)
  const maxHours = Math.max(normalHours, cfg.max_finish - cfg.pack_start)
  // calibrate: ปริมาณล่าสุด = สิ่งที่ทำเสร็จภายใน normalHours -> ได้ throughput
  const ordersPerPersonHour = recentAvg / (headcount * normalHours)
  const capacityPerDay = ordersPerPersonHour * headcount * maxHours   // ปริมาณที่ทำให้เลิกตรง max_finish
  const utilizationPct = capacityPerDay ? Math.round((recentAvg / capacityPerDay) * 1000) / 10 : 0
  // เวลาเลิกงานคาดการณ์ที่ปริมาณ x
  const finishAt = (orders) => cfg.pack_start + (ordersPerPersonHour > 0 ? orders / (headcount * ordersPerPersonHour) : 0)

  const g = monthlyGrowthPct / 100
  let monthsToCap = null
  if (g > 0.001 && recentAvg < capacityPerDay) {
    monthsToCap = Math.ceil(Math.log(capacityPerDay / recentAvg) / Math.log(1 + g))
  }
  const peakDay = [...days].sort((a, b) => b.orders - a.orders)[0]
  return {
    ready: true,
    recentAvgPerDay: Math.round(recentAvg),
    priorAvgPerDay: Math.round(priorAvg),
    capacityPerDay: Math.round(capacityPerDay),
    ordersPerPersonHour: Math.round(ordersPerPersonHour * 10) / 10,
    monthlyGrowthPct,
    utilizationPct,
    finishNow: hhmm(finishAt(recentAvg)),
    finishAtPeak: hhmm(finishAt(peakDay?.orders || recentAvg)),
    finishIn3mo: hhmm(finishAt(recentAvg * Math.pow(1 + g, 3))),
    maxFinish: hhmm(cfg.max_finish),
    peakDay,
    monthsToCap,
    dailySeries: days.slice(-60),
  }
}

async function otAudit(rows, cfg) {
  let ot
  try { ot = await getSheet('workforce_ot') } catch { return { ready: false } }
  const byDay = ordersPerDay(rows)
  const orderVals = [...byDay.values()].sort((a, b) => a - b)
  const median = orderVals.length ? orderVals[Math.floor(orderVals.length / 2)] : 0

  const otByDay = new Map()
  for (const r of ot) {
    const date = String(r.date || '').slice(0, 10)
    if (!date) continue
    const mins = num(r.actual_minutes) || num(r.planned_minutes)
    if (!mins) continue
    otByDay.set(date, (otByDay.get(date) || 0) + mins)
  }

  let totalOtMinutes = 0, suspiciousMinutes = 0
  const flagged = []
  for (const [date, mins] of otByDay) {
    totalOtMinutes += mins
    const dayOrders = byDay.get(date) || 0
    if (dayOrders > 0 && dayOrders < median * 0.8) {
      suspiciousMinutes += mins
      flagged.push({ date, otHours: Math.round((mins / 60) * 10) / 10, orders: dayOrders, medianOrders: median })
    }
  }
  flagged.sort((a, b) => b.otHours - a.otHours)
  const rate = cfg.ot_rate_per_hour
  return {
    ready: true,
    medianDailyOrders: median,
    totalOtHours: Math.round((totalOtMinutes / 60) * 10) / 10,
    totalOtCost: Math.round((totalOtMinutes / 60) * rate),
    suspiciousOtHours: Math.round((suspiciousMinutes / 60) * 10) / 10,
    suspiciousOtCost: Math.round((suspiciousMinutes / 60) * rate),
    flaggedDays: flagged.slice(0, 30),
  }
}

// สังเกต: ลูกค้าที่เคยได้ FBS กลับมาซื้อซ้ำมากกว่าลูกค้าที่ได้แต่แพ็คเองไหม
// (Shopee เท่านั้น — จับคนจาก buyer_hash. ไม่ใช่หลักฐานเชิงเหตุผล มี confounder เยอะ + ข้อมูลยังสั้น)
function fbsRetention(rows) {
  const shopee = rows.filter((r) => r.platform.toLowerCase().includes('shopee') && r.buyerHash && r.shipOption)
  const byBuyer = new Map()
  for (const r of shopee) {
    const b = byBuyer.get(r.buyerHash) || { orders: new Set(), fbs: false }
    if (r.orderId) b.orders.add(r.orderId)
    if (isFbsOption(r.shipOption)) b.fbs = true
    byBuyer.set(r.buyerHash, b)
  }
  const grp = { fbs: { buyers: 0, repeat: 0 }, self: { buyers: 0, repeat: 0 } }
  for (const b of byBuyer.values()) {
    const g = b.fbs ? grp.fbs : grp.self
    g.buyers++
    if (b.orders.size >= 2) g.repeat++
  }
  const rate = (g) => (g.buyers ? Math.round((g.repeat / g.buyers) * 1000) / 10 : 0)
  const enough = grp.fbs.buyers >= 100 && grp.self.buyers >= 100
  return {
    ready: byBuyer.size > 0,
    enoughSample: enough,
    fbsBuyers: grp.fbs.buyers,
    fbsRepeatPct: rate(grp.fbs),
    selfBuyers: grp.self.buyers,
    selfRepeatPct: rate(grp.self),
  }
}

function verdict(cap, cfg, wd) {
  if (!cap.ready) return { level: 'unknown', text: 'ข้อมูลออเดอร์ยังไม่พอสร้างโมเดล capacity (ต้องมีอย่างน้อย 14 วัน)' }
  const feeKnown = cfg.fbs_fee_per_piece > 0
  const feeNote = feeKnown ? '' : ' รอค่าธรรมเนียม FBS เดือนหน้ามากรอก แล้วโมเดลจะเทียบ break-even กับค่า OT/จ้างเพิ่มให้'
  // วันพีคชนเพดานแล้วแม้ค่าเฉลี่ยยังโอเค — วันพีคคือตัวจริง
  if (wd?.ready && wd.peakOverCeiling && cap.recentAvgPerDay < cap.capacityPerDay) {
    return { level: 'watch', text: `ค่าเฉลี่ยยังไหว (เลิก ~${cap.finishNow}) แต่วัน${wd.peakDay}ทีมเลิก ~${wd.finishOnPeakDay} เกิน ${cap.maxFinish} — วัน${wd.peakDay}คือตัวจริง. ย้ายสินค้าส่งธรรมดา 1-2 ตัวเข้า FBS ช่วยลดโหลดวันนั้น.${feeNote}` }
  }
  if (cap.recentAvgPerDay >= cap.capacityPerDay) {
    return { level: 'act', text: `ปริมาณตอนนี้ทำให้ทีมเลิกงาน ~${cap.finishNow} เลย ${cap.maxFinish} — ถึงจังหวะย้ายส่วนส่งธรรมดาเข้า FBS แทนจ้างคนเพิ่ม/OT.${feeNote}` }
  }
  if (cap.monthsToCap != null && cap.monthsToCap <= 4) {
    return { level: 'watch', text: `ยังไหว (เลิก ~${cap.finishNow}) แต่ที่อัตราโต ${cap.monthlyGrowthPct}%/เดือน จะชนเพดาน (${cap.maxFinish}) ใน ~${cap.monthsToCap} เดือน — เริ่มทดลอง FBS กับสินค้าส่งธรรมดา 1-2 ตัวไว้ก่อน.${feeNote}` }
  }
  return { level: 'hold', text: `ยังเบา — ทีมเลิกงาน ~${cap.finishNow} (เพดาน ${cap.maxFinish}). ยังไม่ถึงจังหวะ scale เข้า FBS.${feeNote}` }
}

const STOCKOUT_NOTE = 'ของใน FBS หมด = ออเดอร์เด้งกลับมาทีมแพ็คเอง ไม่เสียยอด — ลองส่งเข้าน้อยๆ ก่อนได้ ความเสี่ยงต่ำ'

export default async function opFulfillment(req, res) {
  try {
    if (req.method === 'POST' && req.query.action === 'save-config') {
      await ensureSheet('fulfillment_config', CONFIG_HEADERS)
      const body = req.body || {}
      const cur = await getSheet('fulfillment_config')
      const now = new Date().toISOString()
      const rows = Object.keys(CONFIG_DEFAULTS).map((k) => {
        const val = k in body ? num(body[k]) : (cur.find((r) => r.key === k)?.value ?? CONFIG_DEFAULTS[k])
        return [k, val, now]
      })
      await overwriteSheet('fulfillment_config', CONFIG_HEADERS, rows)
      return res.status(200).json({ success: true })
    }

    const cfg = await loadConfig()
    const rows = await readOrders()
    const cap = capacity(rows, cfg)
    const wd = weekdayLoad(rows, cap, cfg)
    const bp = await byProduct(rows)
    return res.status(200).json({
      success: true,
      config: cfg,
      fbsUsage: fbsUsage(rows),
      byProduct: bp.list,
      byProductMeta: { dataMonths: bp.dataMonths, dataFrom: bp.dataFrom, dataTo: bp.dataTo },
      prepWindow: dayOfMonthLoad(rows),
      weekday: wd,
      fbsRetention: fbsRetention(rows),
      capacity: cap,
      otAudit: await otAudit(rows, cfg),
      verdict: verdict(cap, cfg, wd),
      stockoutNote: STOCKOUT_NOTE,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
