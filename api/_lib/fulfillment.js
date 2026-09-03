// GET/POST /api/sheet-tools?op=fulfillment — วิเคราะห์ว่าเมื่อไหร่ถึงจังหวะย้ายงานแพ็คเข้า Fulfillment
// DEV-only (gated ใน sheet-tools.js) เหมือน cfo/demographic/import-tracking
//
// โจทย์: ค่าแรงทีมแพ็ค 4 คนเป็น fixed cost — ย้ายเข้า FBS ไม่ประหยัดเงินจนกว่าจะโตชนเพดานทีม
// (ต้อง OT เยอะ / จ้างคนที่ 5) หรือ FBS ถูกกว่าค่า OT ต่อออเดอร์. เครื่องมือนี้ = สัญญาณ ไม่ใช่ "ทำเลย"
//
// ?range=all | N (N เดือนล่าสุดที่จบแล้ว) | YYYY-MM (เดือนเดียว) — default 3
//   scoped ตาม range: capacity, fbsUsage, byProduct, otMonthly, fbsRetention
//   pool ทุกเดือนเสมอ (ต้องการ volume): prepWindow, weekday, campaign
// OT = งานฟีด/รีแพ็คของ (ขึ้นกับ FG) ไม่ผูกกับจำนวนออเดอร์ — แสดงเป็น ชม./บาท รายเดือนเฉยๆ
// capacity คิดแบบ month-over-month: เวลาเลิกงานรายเดือน + slope จริง (ไม่ใช่ rolling window ที่เปราะ)
import { getSheet, ensureSheet, getMetaCached, batchGetValues, overwriteSheet } from './sheets.js'
import { deriveGroup, buildOverrideMap } from './productGroup.js'
import { shopeeShippingOption, isFastShopeeOption } from './shippingClass.js'

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
// หมายเหตุ: ที่นี่ **ไม่ตัด** ออเดอร์ยกเลิก/ตีคืน — ทุกออเดอร์ = พัสดุที่ทีมแพ็คไปแล้ว = ภาระงานจริง
// (ตรงกับ logic "จำนวนออเดอร์" ของ Dashboard/Products) ต่างจาก revenue ที่ตัดออก
const isFbsOption = (opt) => /fulfilled by shopee| full?filled by shopee|ffm by shopee/i.test(String(opt || ''))
const isShopee = (r) => r.platform.toLowerCase().includes('shopee')
const currentYm = () => new Date().toISOString().slice(0, 7)

// ชม.ทศนิยม -> "HH:MM"
const hhmm = (h) => {
  if (h == null || !isFinite(h)) return '-'
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
// slope ของ least-squares linear fit (x = index เดือน 0,1,2..)
const slope = (ys) => {
  const n = ys.length
  if (n < 2) return 0
  const xs = ys.map((_, i) => i)
  const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, x) => a + x * x, 0), sxy = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const d = n * sxx - sx * sx
  return d ? (n * sxy - sx * sy) / d : 0
}

const CONFIG_HEADERS = ['key', 'value', 'updated_at']
const CONFIG_DEFAULTS = {
  pack_headcount: 4,           // คนแพ็ค
  pack_start: 8.0,             // เข้างาน (8:00)
  normal_finish: 14.5,         // เลิกปกติเดือนล่าสุด (~14:30 — ใช้ calibrate throughput)
  max_finish: 17.0,            // เลิกช้าสุดที่รับได้ ก่อนต้อง OT/จ้างเพิ่ม (17:00)
  daily_wage: 400,             // ค่าแรง/คน/วัน
  ot_rate_per_hour: 50,        // ค่า OT/ชม.
  fbs_fee_per_piece: 0,        // ค่าธรรมเนียม FBS/ชิ้น (เดือนหน้าเริ่มคิด)
  fbs_storage_monthly: 0,      // ค่าเก็บของ FBS/เดือน
  workdays_per_month: 26,      // วันทำงาน/เดือน (คิดค่าจ้างคนที่ 5)
  hire_ot_offset_pct: 100,     // จ้างคนที่ 5 แล้ว OT ลดกี่ % (100 = หมด) — หักออกจากค่าจ้าง
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
  //   qty(8) revenue(9) order_status(10) ... shipping_option(16) ... buyer_hash(18)
  const vr = await batchGetValues(tabs.flatMap((t) => [`${t}!B:B`, `${t}!D:V`]))
  const out = []
  for (let i = 0; i < tabs.length; i++) {
    const idRows = vr[i * 2].values || []
    const rows = vr[i * 2 + 1].values || []
    for (let j = 1; j < rows.length; j++) {
      const r = rows[j] || []
      if (!r[0]) continue
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

// เดือนทั้งหมดที่มีข้อมูล (YYYY-MM, เรียงเก่า->ใหม่)
function allMonths(rows) {
  return [...new Set(rows.map((r) => r.date.slice(0, 7)).filter(Boolean))].sort()
}
// กรอง rows ตาม range: 'all' | 'N' | 'YYYY-MM'
function filterByRange(rows, range, months) {
  if (!range || range === 'all') return rows
  if (/^\d{4}-\d{2}$/.test(range)) return rows.filter((r) => r.date.slice(0, 7) === range)
  const n = parseInt(range, 10)
  if (n > 0) {
    const cur = currentYm()
    const complete = months.filter((m) => m < cur)
    const keep = new Set(complete.slice(-n))
    return rows.filter((r) => keep.has(r.date.slice(0, 7)))
  }
  return rows
}

// นับ order ราย order_id (dedupe line item) ต่อวัน — ทุกแพลตฟอร์ม
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

// capacity แบบ month-over-month: เวลาเลิกงานรายเดือน + slope จริง
function capacity(rows, cfg) {
  const byDay = ordersPerDay(rows)
  if (byDay.size < 10) return { ready: false }
  const cur = currentYm()
  const byMonth = new Map()
  for (const [date, orders] of byDay) {
    const ym = date.slice(0, 7)
    const m = byMonth.get(ym) || { month: ym, orders: 0, days: 0 }
    m.orders += orders; m.days += 1
    byMonth.set(ym, m)
  }
  const hc = cfg.pack_headcount || 4
  const normalHours = Math.max(0.5, cfg.normal_finish - cfg.pack_start)
  const maxHours = Math.max(normalHours, cfg.max_finish - cfg.pack_start)

  let series = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ month: m.month, avgPerDay: Math.round(m.orders / m.days), activeDays: m.days, partial: m.month >= cur }))
  const complete = series.filter((m) => !m.partial)
  const calMonth = complete.length ? complete[complete.length - 1] : series[series.length - 1]
  const oph = calMonth.avgPerDay / (hc * normalHours)          // calibrate จากเดือนล่าสุดที่จบ
  const capacityPerDay = Math.round(oph * hc * maxHours)
  const finishAt = (avg) => cfg.pack_start + (oph > 0 ? avg / (hc * oph) : 0)
  series = series.map((m) => ({ ...m, finish: hhmm(finishAt(m.avgPerDay)) }))

  const growthPerDay = Math.round(slope(complete.map((m) => m.avgPerDay)))   // ออเดอร์/วัน เพิ่มต่อเดือน
  const lastAvg = calMonth.avgPerDay
  const monthlyGrowthPct = lastAvg ? Math.round((growthPerDay / lastAvg) * 1000) / 10 : 0
  let monthsToCap = null
  if (growthPerDay > 0 && lastAvg < capacityPerDay) monthsToCap = Math.ceil((capacityPerDay - lastAvg) / growthPerDay)

  // ต้นทุนถ้าไม่ทำอะไร — พอออเดอร์โตเกินกำลังปกติ (เลิกตรงเวลา) ทีมต้องอยู่ OT เคลียร์งานทุกวัน
  // OT ชม./วัน = (ออเดอร์เกินกำลังปกติ) ÷ (คน × oph), เพดานที่ max_finish; เกินนั้น OT ไม่พอ ต้อง FBS/จ้างเพิ่ม
  const normalCapPerDay = Math.round(oph * hc * normalHours)
  const ceilingOtHoursPerDay = Math.max(0, maxHours - normalHours)
  const wdpm = cfg.workdays_per_month || 26
  const doNothing = []
  if (growthPerDay > 0) {
    for (let m = 1; m <= 6; m++) {
      const projAvgPerDay = Math.round(lastAvg + growthPerDay * m)
      const overNormal = Math.max(0, projAvgPerDay - normalCapPerDay)
      let otHoursPerDay = oph > 0 ? overNormal / (hc * oph) : 0
      const cappedOut = otHoursPerDay > ceilingOtHoursPerDay + 1e-9
      otHoursPerDay = Math.min(otHoursPerDay, ceilingOtHoursPerDay)
      doNothing.push({
        monthsAhead: m,
        projAvgPerDay,
        otHoursPerDay: Math.round(otHoursPerDay * 10) / 10,
        otCostMonthly: Math.round(otHoursPerDay * hc * cfg.ot_rate_per_hour * wdpm),
        cappedOut,
      })
    }
  }

  return {
    ready: true,
    series,
    calMonth: calMonth.month,
    calMonthPartial: !complete.length,
    lastAvgPerDay: lastAvg,
    finishLastMonth: hhmm(finishAt(lastAvg)),
    ordersPerPersonHour: Math.round(oph * 10) / 10,
    capacityPerDay,
    maxFinish: hhmm(cfg.max_finish),
    growthPerDay,
    monthlyGrowthPct,
    monthsToCap,
    finishIn3mo: hhmm(finishAt(lastAvg + growthPerDay * 3)),
    overCeiling: lastAvg >= capacityPerDay,
    normalCapPerDay,
    doNothing,
  }
}

function fbsUsage(rows) {
  const shopee = rows.filter(isShopee)
  const withOpt = shopee.filter((r) => r.shipOption)
  const byMonth = new Map()
  let fbsOrders = 0, fbsUnits = 0, fbsRevenue = 0, totUnits = 0, totRevenue = 0
  for (const r of withOpt) {
    const ym = r.date.slice(0, 7)
    const m = byMonth.get(ym) || { month: ym, fbs: 0, self: 0 }
    if (isFbsOption(r.shipOption)) { m.fbs++; fbsOrders++; fbsUnits += r.qty; fbsRevenue += r.revenue }
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
  const shopee = rows.filter((r) => isShopee(r) && r.shipOption)
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
    if (isFbsOption(r.shipOption)) { g.fbs++; g.stdUnits += r.qty }
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
      let verdict = 'review'
      if (fastPct >= 25) verdict = 'keep-self'
      else if (fastPct < 20 && (standardPct + fbsPct) >= 55) verdict = 'fbs-candidate'
      const fbsSendUnits = Math.round(g.stdUnits / months)
      return { label: g.label, orders: g.orders, fastPct, standardPct, fbsPct, verdict, fbsSendUnits }
    })
    .sort((a, b) => b.orders - a.orders)
  return { list, dataMonths: Math.round(months * 10) / 10, dataFrom: minD < maxD ? minD : null, dataTo: minD < maxD ? maxD : null }
}

// pool ทุกเดือนเสมอ — วันในสัปดาห์ (วันพีคคือตัวจริง)
function weekdayLoad(allRows, cap, cfg) {
  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
  const byDay = ordersPerDay(allRows)
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
    ready: true, series,
    overallAvg: Math.round(overallAvg),
    peakDay: peak.day, peakAvgOrders: peak.avgOrders,
    peakRatio: overallAvg ? Math.round((peak.avgOrders / overallAvg) * 100) / 100 : 1,
    finishOnPeakDay: hhmm(finishPeak),
    peakOverCeiling: finishPeak > cfg.max_finish,
  }
}

// pool ทุกเดือนเสมอ — วันในเดือน (หาช่วง 4 วันเบาสุดเตรียมส่ง FBS)
function dayOfMonthLoad(allRows) {
  const byDay = ordersPerDay(allRows)
  const bucket = Array.from({ length: 32 }, () => ({ sum: 0, n: 0 }))
  for (const [date, orders] of byDay) {
    const dom = parseInt(String(date).slice(8, 10), 10)
    if (dom >= 1 && dom <= 31) { bucket[dom].sum += orders; bucket[dom].n++ }
  }
  const series = []
  for (let d = 1; d <= 31; d++) if (bucket[d].n) series.push({ day: d, avgOrders: Math.round(bucket[d].sum / bucket[d].n) })
  if (series.length < 10) return { ready: false }
  let best = null
  for (let i = 0; i + 3 < series.length; i++) {
    const win = series.slice(i, i + 4)
    const avg = win.reduce((s, x) => s + x.avgOrders, 0) / 4
    if (!best || avg < best.avg) best = { avg, start: win[0].day, end: win[3].day }
  }
  const overallAvg = series.reduce((s, x) => s + x.avgOrders, 0) / series.length
  return {
    ready: true, series,
    bestWindow: best ? { start: best.start, end: best.end, avgOrders: Math.round(best.avg) } : null,
    overallAvg: Math.round(overallAvg),
  }
}

// วันแคมเปญ = วันที่ = เดือน (9.9, 11.11, 12.12, ...) — วันที่ทีมเครียดสุด
const isCampaignDate = (dateStr) => {
  const [, m, d] = String(dateStr).split('-')
  return m && d && m === d
}
// คืน { str: 'YYYY-MM-DD', daysUntil } ของวันแคมเปญถัดไป (เลี่ยง timezone จาก toISOString)
function nextCampaign(fromStr) {
  const y = parseInt(fromStr.slice(0, 4), 10)
  let best = null
  for (const yy of [y, y + 1]) {
    for (let mm = 1; mm <= 12; mm++) {
      const s = `${yy}-${String(mm).padStart(2, '0')}-${String(mm).padStart(2, '0')}`
      if (s >= fromStr && (!best || s < best)) best = s
    }
  }
  if (!best) return null
  const daysUntil = Math.round((new Date(best) - new Date(fromStr)) / 86400000)
  return { str: best, daysUntil }
}
const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
function campaignModel(allRows, cap, cfg) {
  if (!cap?.ready) return { ready: false }
  const byDay = ordersPerDay(allRows)
  const dates = [...byDay.keys()].sort()
  if (!dates.length) return { ready: false }
  const dnum = (s) => new Date(s).getTime() / 86400000
  const campDayNums = dates.filter(isCampaignDate).map(dnum)
  const nearCamp = (n) => campDayNums.some((c) => Math.abs(c - n) <= 2)

  const observed = []
  for (const date of dates) {
    if (!isCampaignDate(date)) continue
    const c = dnum(date)
    const base = dates.filter((x) => {
      const xn = dnum(x)
      return Math.abs(xn - c) >= 3 && Math.abs(xn - c) <= 12 && !nearCamp(xn)
    }).map((x) => byDay.get(x)).sort((a, b) => a - b)
    if (base.length < 4) continue
    const baseline = base[Math.floor(base.length / 2)]
    const orders = byDay.get(date)
    observed.push({ date, orders, baseline, multiplier: baseline ? Math.round((orders / baseline) * 100) / 100 : null })
  }
  // ใช้ median ของ 4 วันแคมเปญล่าสุด (ตัดวันหยุด เช่น 1.1 ที่ยอดตก + จับ trend ล่าสุด)
  const mults = observed.map((o) => o.multiplier).filter((m) => m)
  const recentMults = mults.slice(-4)
  const avgMultiplier = median(recentMults.length >= 3 ? recentMults : mults)

  const complete = (cap.series || []).filter((m) => !m.partial)
  const lastAvg = complete.length ? complete[complete.length - 1].avgPerDay : cap.lastAvgPerDay
  const todayStr = new Date().toISOString().slice(0, 10)
  const nc = nextCampaign(todayStr)
  const nextStr = nc?.str || null
  const daysUntil = nc?.daysUntil ?? null

  let predictedOrders = null, predictedFinish = null, overCeiling = false
  if (avgMultiplier && lastAvg) {
    predictedOrders = Math.round(lastAvg * avgMultiplier)
    const oph = cap.ordersPerPersonHour, hc = cfg.pack_headcount || 4
    const finishH = cfg.pack_start + (oph > 0 ? predictedOrders / (hc * oph) : 0)
    predictedFinish = hhmm(finishH)
    overCeiling = finishH > cfg.max_finish
  }
  return {
    ready: observed.length > 0,
    observed: observed.sort((a, b) => a.date.localeCompare(b.date)),
    avgMultiplier,
    next: nextStr ? { date: nextStr, daysUntil, predictedOrders, predictedFinish, overCeiling } : null,
  }
}

// OT รายเดือน — เป็นชั่วโมง/บาท ไม่ผูกกับจำนวนออเดอร์
// (owner: OT ส่วนใหญ่เป็นงานฟีด/รีแพ็คของ ขึ้นกับ FG ไม่ใช่การแพ็คออเดอร์ — แพ็คเสร็จ พัก 1 ชม.
//  แล้วมาฟีดของต่อจนเลิกงาน). ถ้ามี planner_daily แสดงปริมาณฟีดเทียบด้วย
async function otMonthly(rows, cfg) {
  let ot
  try { ot = await getSheet('workforce_ot') } catch { return { ready: false } }
  const dates = [...ordersPerDay(rows).keys()].sort()
  if (!dates.length) return { ready: false }
  const from = dates[0].slice(0, 7), to = dates[dates.length - 1].slice(0, 7)

  const byMonth = new Map()
  for (const r of ot) {
    const ym = String(r.date || '').slice(0, 7)
    if (!ym || ym < from || ym > to) continue
    const mins = num(r.actual_minutes) || num(r.planned_minutes)
    if (mins) byMonth.set(ym, (byMonth.get(ym) || 0) + mins)
  }
  // ปริมาณฟีดต่อเดือน จาก planner_daily (planned_feed) — ถ้ามี
  let feedByMonth = new Map()
  try {
    const pd = await getSheet('planner_daily')
    for (const r of pd) {
      const ym = String(r.date || '').slice(0, 7)
      if (!ym || ym < from || ym > to) continue
      feedByMonth.set(ym, (feedByMonth.get(ym) || 0) + num(r.planned_feed))
    }
  } catch { feedByMonth = new Map() }

  const rate = cfg.ot_rate_per_hour
  const months = [...new Set([...byMonth.keys(), ...feedByMonth.keys()])].sort()
  const series = months.map((m) => {
    const hrs = Math.round(((byMonth.get(m) || 0) / 60) * 10) / 10
    return { month: m, otHours: hrs, otCost: Math.round(hrs * rate), feedUnits: Math.round(feedByMonth.get(m) || 0) }
  })
  const totalHours = Math.round(series.reduce((s, x) => s + x.otHours, 0) * 10) / 10
  return {
    ready: series.length > 0,
    hasFeedData: [...feedByMonth.values()].some((v) => v > 0),
    series,
    totalHours,
    totalCost: Math.round(totalHours * rate),
  }
}

// สังเกต: ลูกค้าที่เคยได้ FBS กลับมาซื้อซ้ำมากกว่าไหม (Shopee, จับจาก buyer_hash) — มี bias เยอะ
function fbsRetention(rows) {
  const shopee = rows.filter((r) => isShopee(r) && r.buyerHash && r.shipOption)
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
  return {
    ready: byBuyer.size > 0,
    enoughSample: grp.fbs.buyers >= 100 && grp.self.buyers >= 100,
    fbsBuyers: grp.fbs.buyers, fbsRepeatPct: rate(grp.fbs),
    selfBuyers: grp.self.buyers, selfRepeatPct: rate(grp.self),
  }
}

// ต้นทุนส่วนเพิ่มต่อออเดอร์ เมื่อปริมาณโตเกินทีม — เทียบ 3 ทาง
// ค่าแรง 4 คน fixed อยู่แล้ว ไม่นับ. ที่นับคือ marginal: OT ต่อไป / จ้างคนที่ 5 / FBS
// จ้างคนที่ 5: ค่าจ้าง หัก OT ที่ลดได้ (คนใหม่มาทำงานฟีดในเวลาปกติ OT เลยลด)
function breakeven(rows, cap, cfg, lastMonthOtCost) {
  if (!cap.ready) return { ready: false }
  const oph = cap.ordersPerPersonHour
  const normalHours = Math.max(0.5, cfg.normal_finish - cfg.pack_start)
  const shopeeStd = rows.filter((r) => isShopee(r) && r.shipOption && !isFastShopeeOption(shopeeShippingOption(r.shipOption, r.platform)))
  const stdOrderIds = new Set(shopeeStd.map((r) => `${r.platform}:${r.orderId}`))
  const stdUnits = shopeeStd.reduce((s, r) => s + r.qty, 0)
  const piecesPerOrder = stdOrderIds.size ? Math.round((stdUnits / stdOrderIds.size) * 100) / 100 : 1.5

  // OT ต่อไป: 4 คนอยู่ทำ OT 1 ชม. = 4×เรต, ได้ oph×4 ออเดอร์ -> เรต/oph
  const otCostPerOrder = oph > 0 ? Math.round((cfg.ot_rate_per_hour / oph) * 100) / 100 : null
  // จ้างคนที่ 5: (ค่าจ้าง/เดือน − OT ที่ลดได้) ÷ กำลังแพ็คที่เพิ่ม/เดือน
  const workdays = cfg.workdays_per_month || 26
  const hireGrossMonthly = cfg.daily_wage * workdays
  const otSavedMonthly = Math.round((lastMonthOtCost || 0) * (cfg.hire_ot_offset_pct / 100))
  const hireNetMonthly = hireGrossMonthly - otSavedMonthly
  const hireCapacityMonthly = oph * normalHours * workdays
  const hireCostPerOrder = hireCapacityMonthly > 0 ? Math.round((hireNetMonthly / hireCapacityMonthly) * 100) / 100 : null

  const feeKnown = cfg.fbs_fee_per_piece > 0
  const fbsCostPerOrder = feeKnown ? Math.round((cfg.fbs_fee_per_piece * piecesPerOrder) * 100) / 100 : null

  const alts = [otCostPerOrder, hireCostPerOrder].filter((x) => x != null)
  return {
    ready: true,
    piecesPerOrder,
    otCostPerOrder,
    hireCostPerOrder,
    hireGrossMonthly, otSavedMonthly, hireNetMonthly,
    fbsCostPerOrder,
    fbsFeePerPiece: cfg.fbs_fee_per_piece,
    cheapestAlt: alts.length ? Math.min(...alts) : null,
  }
}

function verdict(cap, cfg, wd, be) {
  if (!cap.ready) return { level: 'unknown', text: 'ข้อมูลออเดอร์ยังไม่พอสร้างโมเดล capacity' }
  let feeNote = ' รอค่าธรรมเนียม FBS มากรอก แล้วโมเดลจะเทียบ break-even กับค่า OT/จ้างเพิ่มให้'
  if (cfg.fbs_fee_per_piece > 0 && be?.ready) {
    const fbs = be.fbsCostPerOrder, alt = be.cheapestAlt
    feeNote = fbs != null && alt != null
      ? (fbs <= alt
        ? ` ต้นทุน FBS ~฿${fbs}/ออเดอร์ ถูกกว่าค่า OT/จ้างเพิ่ม (~฿${alt}) — คุ้มตามต้นทุน`
        : ` ต้นทุน FBS ~฿${fbs}/ออเดอร์ แพงกว่าค่า OT/จ้างเพิ่ม (~฿${alt}) — ไม่คุ้มถ้าดูแค่ต้นทุน. ใช้ FBS เพื่อไม่ต้องจัดการคนเพิ่ม/รับพีควันแคมเปญแทน`)
      : ''
  }
  if (wd?.ready && wd.peakOverCeiling && !cap.overCeiling) {
    return { level: 'watch', text: `ค่าเฉลี่ยยังไหว (เดือน ${cap.calMonth} เลิก ~${cap.finishLastMonth}) แต่วัน${wd.peakDay}ทีมเลิก ~${wd.finishOnPeakDay} เกิน ${cap.maxFinish} — วัน${wd.peakDay}คือตัวจริง. ย้ายสินค้าส่งธรรมดา 1-2 ตัวเข้า FBS ช่วยลดโหลดวันนั้น.${feeNote}` }
  }
  if (cap.overCeiling) {
    return { level: 'act', text: `เดือน ${cap.calMonth} ทีมเลิกงาน ~${cap.finishLastMonth} เลย ${cap.maxFinish} — ถึงจังหวะย้ายส่วนส่งธรรมดาเข้า FBS แทนจ้างคนเพิ่ม/OT.${feeNote}` }
  }
  if (cap.monthsToCap != null && cap.monthsToCap <= 4) {
    return { level: 'watch', text: `ยังไหว (เดือน ${cap.calMonth} เลิก ~${cap.finishLastMonth}) แต่โต ~${cap.growthPerDay} ออเดอร์/วัน/เดือน จะชนเพดาน (${cap.maxFinish}) ใน ~${cap.monthsToCap} เดือน — เริ่มทดลอง FBS กับสินค้าส่งธรรมดา 1-2 ตัวไว้ก่อน.${feeNote}` }
  }
  return { level: 'hold', text: `ยังเบา — เดือน ${cap.calMonth} ทีมเลิกงาน ~${cap.finishLastMonth} (เพดาน ${cap.maxFinish}). ยังไม่ถึงจังหวะ scale เข้า FBS.${feeNote}` }
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
    const all = await readOrders()
    const months = allMonths(all)
    const range = String(req.query.range || '3')
    const rows = filterByRange(all, range, months)

    const cap = capacity(rows, cfg)
    const wd = weekdayLoad(all, cap, cfg)
    const ot = await otMonthly(rows, cfg)
    const lastMonthOtCost = ot?.ready && ot.series.length ? ot.series[ot.series.length - 1].otCost : 0
    const be = breakeven(rows, cap, cfg, lastMonthOtCost)
    const camp = campaignModel(all, cap, cfg)
    const bp = await byProduct(rows)
    return res.status(200).json({
      success: true,
      config: cfg,
      range,
      availableMonths: months.filter((m) => m < currentYm()),   // dropdown: เฉพาะเดือนที่จบแล้ว
      currentMonth: currentYm(),
      capacity: cap,
      weekday: wd,
      prepWindow: dayOfMonthLoad(all),
      fbsUsage: fbsUsage(rows),
      byProduct: bp.list,
      byProductMeta: { dataMonths: bp.dataMonths, dataFrom: bp.dataFrom, dataTo: bp.dataTo },
      fbsRetention: fbsRetention(rows),
      otMonthly: ot,
      breakeven: be,
      campaign: camp,
      verdict: verdict(cap, cfg, wd, be),
      stockoutNote: STOCKOUT_NOTE,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
