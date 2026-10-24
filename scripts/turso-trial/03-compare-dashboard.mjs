import { DatabaseSync } from 'node:sqlite'
import handler from '../../api/dashboard.js'
const db = new DatabaseSync(process.argv[2], { readOnly: true })
const call = async (q) => { let body; const t=performance.now(); await handler({ method:'GET', query:q, headers:{} }, { setHeader(){}, status(){return this}, json(b){body=b} }); return { body, ms: Math.round(performance.now()-t) } }
const r2 = n => Math.round(n*100)/100
const J = 'FROM orders o JOIN cmap m ON m.variation_name IS o.variation_name AND m.master_sku IS o.master_sku AND m.display_name IS o.display_name'
async function test(q) {
  const { business='all', platform='all', startDate='', endDate='' } = q
  const w=['o.date<>\'\'']; const p=[]
  if(business!=='all'){w.push('o.business=?');p.push(business)}; if(platform!=='all'){w.push('o.platform=?');p.push(platform)}
  const W = w.join(' AND ')
  const range = (a,b)=>({ sql: (a?' AND o.date>=?':'')+(b?' AND o.date<=?':''), args:[a,b].filter(Boolean) })
  const rg = range(startDate,endDate)
  const t0=performance.now()
  const one = (sql,args)=>db.prepare(sql).get(...args), all=(sql,args)=>db.prepare(sql).all(...args)
  const A=[...p,...rg.args]; const WR=W+rg.sql
  const tot = one(`SELECT SUM(o.revenue) gross, SUM(CASE WHEN o.ex THEN 0 ELSE o.revenue END) rev, SUM(CASE WHEN o.ex THEN 0 ELSE o.qty END) units, COUNT(DISTINCT CASE WHEN o.order_id<>'' THEN o.order_id END) orders FROM orders o WHERE ${WR}`, A)
  const byDay = all(`SELECT o.date d, SUM(CASE WHEN o.ex THEN 0 ELSE o.revenue END) amt, COUNT(DISTINCT CASE WHEN o.order_id<>'' THEN o.order_id END) n FROM orders o WHERE ${WR} GROUP BY o.date ORDER BY o.date`, A)
  const byBiz = all(`SELECT o.business k, SUM(o.revenue) amt FROM orders o WHERE ${WR} AND o.ex=0 GROUP BY 1`, A)
  const byPlat = all(`SELECT o.platform k, SUM(o.revenue) amt FROM orders o WHERE ${WR} AND o.ex=0 GROUP BY 1`, A)
  const pack = all(`SELECT m.rsku sku, SUM(o.qty) qty ${J} WHERE ${WR} AND m.rsku<>'' AND m.rsku IS NOT NULL GROUP BY 1`, A)
  const groups = all(`SELECT m.gkey k, SUM(CASE WHEN o.ex THEN 0 ELSE o.revenue END) rev, SUM(CASE WHEN o.ex THEN 0 ELSE o.qty END) qty, COUNT(DISTINCT CASE WHEN o.order_id<>'' THEN o.order_id END) orders, COUNT(DISTINCT CASE WHEN m.rsku<>'' THEN m.rsku END) skus ${J} WHERE ${WR} GROUP BY 1`, A)
  const sqlMs=performance.now()-t0
  const api = await call(q); const a = api.body
  let bad=0; const d=(label,x,y,tol=0.005)=>{ if(Math.abs(x-y)>tol){bad++;console.log('  DIFF',label,'api',x,'sql',y)} }
  d('revenue',a.revenue,r2(tot.rev||0)); d('grossRevenue',a.grossRevenue,r2(tot.gross||0)); d('orders',a.orders,tot.orders); d('units',a.units,tot.units||0)
  d('revenueByDay.len',a.revenueByDay.length,byDay.filter(x=>x.amt!==null).length - byDay.filter(x=>x.amt===0&&!a.revenueByDay.find(y=>y.date===x.d)).length)
  for(const x of a.revenueByDay){const s=byDay.find(y=>y.d===x.date); d('day '+x.date,x.amount,r2(s?.amt||0))}
  for(const x of a.ordersByDay){const s=byDay.find(y=>y.d===x.date); d('ordersDay '+x.date,x.count,s?.n||0)}
  for(const x of a.businessBreakdown){d('biz '+x.name,x.amount,r2(byBiz.find(y=>y.k===x.name)?.amt||0))}
  for(const x of a.platformBreakdown){d('plat '+x.name,x.amount,r2(byPlat.find(y=>y.k===x.name)?.amt||0))}
  for(const x of a.packBySku){d('pack '+x.master_sku,x.qty,pack.find(y=>y.sku===x.master_sku)?.qty??-1)}
  d('packBySku.len',a.packBySku.length,pack.length)
  for(const x of a.topSkus){const g=groups.find(y=>y.k===x.key); d('top '+x.key+' amount',x.amount,r2(g?.rev||0)); d('top qty '+x.key,x.qty,g?.qty||0); d('top orders '+x.key,x.orders,g?.orders||0); d('top skuCount '+x.key,x.skuCount,g?.skus||0)}
  console.log(JSON.stringify(q), 'topSkus='+a.topSkus.length, 'days='+a.revenueByDay.length, 'pack='+a.packBySku.length, 'diffs='+bad, '| api '+api.ms+'ms, sql(local) '+Math.round(sqlMs)+'ms')
}
for (const q of [{}, {startDate:'2026-08-01',endDate:'2026-09-30'}, {business:'Payi',platform:'Shopee',startDate:'2026-09-01',endDate:'2026-09-30'}]) await test(q)
