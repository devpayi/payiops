import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
const f = process.argv[2]; const db = new DatabaseSync(f)
const t = (label, sql) => { const t0 = performance.now(); const r = db.prepare(sql).all(); console.log(label, (performance.now()-t0).toFixed(1)+'ms', r.length,'rows') }
db.exec(`ALTER TABLE orders ADD COLUMN ex INTEGER; UPDATE orders SET ex = (order_status LIKE '%ยกเลิก%' OR lower(order_status) LIKE '%cancel%' OR lower(order_status) LIKE '%return%'); CREATE INDEX i_cover ON orders(ym,business,platform,ex,order_id,qty,revenue)`)
t('sum only w/ ex flag', `SELECT ym,business,platform,SUM(CASE WHEN ex THEN 0 ELSE revenue END),SUM(CASE WHEN ex THEN 0 ELSE qty END) FROM orders GROUP BY ym,business,platform`)
t('full monthly (distinct) w/ covering idx', `SELECT ym,business,platform,SUM(CASE WHEN ex THEN 0 ELSE revenue END),COUNT(DISTINCT order_id),COUNT(DISTINCT CASE WHEN ex=0 THEN order_id END),SUM(CASE WHEN ex THEN 0 ELSE qty END) FROM orders GROUP BY ym,business,platform`)
t('one month only', `SELECT business,platform,SUM(revenue) FROM orders WHERE ym='2026-09' AND ex=0 GROUP BY 1,2`)
db.exec('VACUUM'); console.log('size', fs.statSync(f).size)
