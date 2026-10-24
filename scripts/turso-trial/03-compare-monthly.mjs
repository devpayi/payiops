import { DatabaseSync } from 'node:sqlite'
import handler from '../../api/monthly.js'
const run = async () => {
  const t0 = performance.now()
  let body, code = 200
  const res = { setHeader() {}, status(c) { code = c; return this }, json(b) { body = b; return this } }
  await handler({ method: 'GET', query: { year: '2026' }, headers: {} }, res)
  return { body, ms: Math.round(performance.now() - t0), code }
}
const cold = await run(); console.log('endpoint cold', cold.ms, 'ms', cold.code)
const warm = await run(); console.log('endpoint warm(cache)', warm.ms, 'ms')
const api = cold.body
const EX = `(order_status LIKE '%ยกเลิก%' OR lower(order_status) LIKE '%cancel%' OR lower(order_status) LIKE '%return%')`
for (const f of process.argv.slice(2)) {
  const db = new DatabaseSync(f, { readOnly: true })
  const q = (sql) => { const t = performance.now(); const r = db.prepare(sql).all(); return [r, +(performance.now() - t).toFixed(1)] }
  const [tr, t1] = q(`SELECT ym month, ROUND(SUM(CASE WHEN ${EX} THEN 0 ELSE revenue END),2) sales, COUNT(DISTINCT CASE WHEN order_id<>'' THEN order_id END) orders, COUNT(DISTINCT CASE WHEN order_id<>'' AND NOT ${EX} THEN order_id END) salesOrders, SUM(CASE WHEN ${EX} THEN 0 ELSE qty END) units FROM orders GROUP BY ym ORDER BY ym`)
  const [st, t2] = q(`SELECT ym, business, platform, ROUND(SUM(CASE WHEN ${EX} THEN 0 ELSE revenue END),2) sales, ROUND(SUM(CASE WHEN ${EX} THEN revenue ELSE 0 END),2) cancelSales, COUNT(DISTINCT CASE WHEN order_id<>'' THEN order_id END) orders, COUNT(DISTINCT CASE WHEN order_id<>'' AND NOT ${EX} THEN order_id END) salesOrders, SUM(CASE WHEN ${EX} THEN 0 ELSE qty END) units FROM orders GROUP BY ym,business,platform`)
  let bad = 0
  for (const a of api.trend) { const s = tr.find(x => x.month === a.month); for (const k of ['sales','orders','salesOrders','units']) if (!s || Math.abs(s[k]-a[k])>0.005) { bad++; console.log('TREND DIFF', a.month, k, a[k], s?.[k]) } }
  let storeN = 0
  for (const [ym, arr] of Object.entries(api.byStore)) for (const a of arr) { storeN++; const s = st.find(x => x.ym===ym && x.business===a.business && x.platform===a.platform); for (const k of ['sales','cancelSales','orders','salesOrders','units']) if (!s || Math.abs(s[k]-a[k])>0.005) { bad++; console.log('STORE DIFF', ym, a.store, k, a[k], s?.[k]) } }
  console.log(f.split('/').pop(), 'months', api.trend.length, 'storeRows', storeN, 'diffs', bad, '| sql ms trend', t1, 'store', t2)
}
