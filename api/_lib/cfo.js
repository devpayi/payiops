// GET/POST /api/sheet-tools?op=cfo
// เงินทุน/fix cost/burn rate/runway — dev+boss เท่านั้น (การเงินอ่อนไหว เหมือน import-tracking)
import { getSheet, appendRows, ensureSheet, getMetaCached, batchGetValues, overwriteSheet } from './sheets.js'

const CAPITAL_HEADERS = ['id', 'date', 'amount', 'note', 'created_at']
const FIXCOST_HEADERS = ['id', 'item', 'amount', 'active', 'created_at']

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const round2 = (n) => Math.round(n * 100) / 100
const isCancelled = (s = '') => String(s).includes('ยกเลิก') || String(s).toLowerCase().includes('cancel')
const genId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

async function loadCapital() {
  await ensureSheet('cfo_capital', CAPITAL_HEADERS)
  return getSheet('cfo_capital')
}
async function loadFixCost() {
  await ensureSheet('cfo_fixcost', FIXCOST_HEADERS)
  return getSheet('cfo_fixcost')
}

// ยอดขายจริงรายเดือน (ไม่รวมยกเลิก) จาก raw_orders_* — D=date, M=revenue(index 9), N=order_status(index 10)
async function monthlyRevenue() {
  const meta = await getMetaCached()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
  if (!tabs.length) return new Map()
  const vr = await batchGetValues(tabs.map((t) => `${t}!D:R`))
  const byMonth = new Map()
  for (let i = 0; i < tabs.length; i++) {
    const rows = vr[i].values || []
    for (let j = 1; j < rows.length; j++) {
      const r = rows[j] || []
      const date = r[0]
      const revenue = num(r[9])
      const status = r[10]
      if (!date || isCancelled(status)) continue
      const ym = String(date).slice(0, 7)
      byMonth.set(ym, (byMonth.get(ym) || 0) + revenue)
    }
  }
  return byMonth
}

export default async function opCfo(req, res) {
  try {
    const action = req.query.action

    if (req.method === 'POST' && action === 'add-capital') {
      const { date, amount, note = '' } = req.body || {}
      if (!date) return res.status(400).json({ success: false, error: 'ต้องระบุวันที่' })
      await ensureSheet('cfo_capital', CAPITAL_HEADERS)
      const row = { id: genId('cap'), date, amount: String(num(amount)), note, created_at: new Date().toISOString() }
      await appendRows('cfo_capital', [CAPITAL_HEADERS.map((h) => row[h] ?? '')])
      return res.status(200).json({ success: true, capital: row })
    }

    if (req.method === 'POST' && action === 'upsert-fixcost') {
      const b = req.body || {}
      if (!String(b.item || '').trim()) return res.status(400).json({ success: false, error: 'ต้องระบุชื่อรายการ' })
      const rows = await loadFixCost()
      const id = String(b.id || '').trim() || genId('fc')
      const idx = rows.findIndex((r) => r.id === id)
      const record = { id, item: String(b.item).trim(), amount: String(num(b.amount)), active: b.active === false ? '' : '1', created_at: idx >= 0 ? rows[idx].created_at : new Date().toISOString() }
      const next = idx >= 0 ? rows.map((r, i) => (i === idx ? record : r)) : [...rows, record]
      await overwriteSheet('cfo_fixcost', FIXCOST_HEADERS, next.map((r) => FIXCOST_HEADERS.map((h) => r[h] ?? '')))
      return res.status(200).json({ success: true, item: record })
    }

    if (req.method === 'POST' && action === 'delete-fixcost') {
      const id = String(req.body?.id || '').trim()
      if (!id) return res.status(400).json({ success: false, error: 'ต้องระบุ id' })
      const rows = await loadFixCost()
      const next = rows.filter((r) => r.id !== id)
      await overwriteSheet('cfo_fixcost', FIXCOST_HEADERS, next.map((r) => FIXCOST_HEADERS.map((h) => r[h] ?? '')))
      return res.status(200).json({ success: true })
    }

    if ((req.query.view || 'summary') === 'summary') {
      const [capitalRows, fixcostRows, revenueByMonth] = await Promise.all([loadCapital(), loadFixCost(), monthlyRevenue()])

      const capitalSorted = [...capitalRows].sort((a, b) => a.date.localeCompare(b.date))
      const latestCapital = capitalSorted.length ? num(capitalSorted[capitalSorted.length - 1].amount) : 0

      const activeFixCost = fixcostRows.filter((r) => r.active === '1' || r.active === true || r.active === 1)
      const fixCostMonthly = round2(activeFixCost.reduce((s, r) => s + num(r.amount), 0))

      const months = [...revenueByMonth.keys()].sort()
      const currentYm = new Date().toISOString().slice(0, 7)
      const closedMonths = months.filter((m) => m < currentYm).slice(-3)
      const avgRevenue = closedMonths.length ? closedMonths.reduce((s, m) => s + revenueByMonth.get(m), 0) / closedMonths.length : 0
      const burnRate = round2(fixCostMonthly - avgRevenue)
      const runwayMonths = latestCapital > 0 && burnRate > 0 ? round2(latestCapital / burnRate) : null

      const cashTrend = capitalSorted.slice(-6).map((r) => ({ date: r.date, amount: num(r.amount), note: r.note }))

      return res.status(200).json({
        success: true,
        latestCapital,
        fixCostMonthly,
        fixCostItems: activeFixCost.map((r) => ({ id: r.id, item: r.item, amount: num(r.amount) })),
        avgRevenue: round2(avgRevenue),
        burnRate,
        runwayMonths,
        cashTrend,
        capitalHistory: capitalSorted.slice(-12).reverse(),
      })
    }

    return res.status(400).json({ success: false, error: 'unknown view/action' })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
