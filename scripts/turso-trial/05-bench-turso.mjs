import { createClient } from '@libsql/client'
import { DatabaseSync } from 'node:sqlite'
import { getSheet } from '../../api/_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from '../../api/_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku } from '../../api/_lib/skuMapping.js'
const t = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const local = new DatabaseSync(process.argv[2], { readOnly: true })
const overrideMap = buildOverrideMap(await getSheet('product_aliases'))
const [redirectMap, recipeKeySet] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet()])
const combos = local.prepare('SELECT DISTINCT variation_name,master_sku,display_name FROM orders').all()
await t.execute('DROP TABLE IF EXISTS cmap')
await t.execute('CREATE TABLE cmap(variation_name,master_sku,display_name,rsku,gkey,glabel)')
const rows = combos.map(c => { const rsku = resolveSalesSku(c.master_sku, c.variation_name, redirectMap, recipeKeySet); const g = deriveGroup(c.display_name, rsku, overrideMap); return [c.variation_name, c.master_sku, c.display_name, rsku, g.key, g.label] })
await t.batch(rows.map(a => ({ sql: 'INSERT INTO cmap VALUES(?,?,?,?,?,?)', args: a })), 'write')
await t.execute('CREATE INDEX cm ON cmap(variation_name,master_sku,display_name)')
// local copy of same cmap for equality check
local.close()
const L = new DatabaseSync(process.argv[2]); L.exec('DROP TABLE IF EXISTS cmap; CREATE TABLE cmap(variation_name,master_sku,display_name,rsku,gkey,glabel); CREATE INDEX cm ON cmap(variation_name,master_sku,display_name); ALTER TABLE orders ADD COLUMN ex INTEGER; UPDATE orders SET ex=(order_status LIKE \'%ยกเลิก%\' OR lower(order_status) LIKE \'%cancel%\' OR lower(order_status) LIKE \'%return%\')')
const li = L.prepare('INSERT INTO cmap VALUES(?,?,?,?,?,?)'); for (const r of rows) li.run(...r)
const queries = {
  monthly_trend: `SELECT ym month, ROUND(SUM(CASE WHEN ex THEN 0 ELSE revenue END),2) sales, COUNT(DISTINCT CASE WHEN order_id<>'' THEN order_id END) orders, COUNT(DISTINCT CASE WHEN order_id<>'' AND ex=0 THEN order_id END) salesOrders, SUM(CASE WHEN ex THEN 0 ELSE qty END) units FROM orders GROUP BY ym ORDER BY ym`,
  monthly_by_store: `SELECT ym,business,platform,ROUND(SUM(CASE WHEN ex THEN 0 ELSE revenue END),2) sales, COUNT(DISTINCT CASE WHEN order_id<>'' THEN order_id END) orders FROM orders GROUP BY 1,2,3 ORDER BY 1,2,3`,
  products_agg: `SELECT o.ym, o.platform plat, o.variation_name var, m.rsku, m.gkey, o.ex, ROUND(SUM(o.revenue),2) rev, SUM(o.qty) qty FROM orders o JOIN cmap m ON m.variation_name IS o.variation_name AND m.master_sku IS o.master_sku AND m.display_name IS o.display_name GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,3,4,5,6`,
  products_orders_month: `SELECT m.gkey, COUNT(DISTINCT o.order_id) n FROM orders o JOIN cmap m ON m.variation_name IS o.variation_name AND m.master_sku IS o.master_sku AND m.display_name IS o.display_name WHERE o.ym='2026-09' AND o.order_id<>'' GROUP BY 1 ORDER BY 1`,
  daily_one_month: `SELECT date, ROUND(SUM(CASE WHEN ex THEN 0 ELSE revenue END),2) amt, COUNT(DISTINCT order_id) n FROM orders WHERE ym='2026-09' GROUP BY date ORDER BY date`,
}
const med = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
for (const [name, sql] of Object.entries(queries)) {
  const ts = []; let remote
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); remote = await t.execute(sql); ts.push(Math.round(performance.now() - t0)) }
  const lr = L.prepare(sql).all()
  const norm = o => JSON.stringify(o, (k, v) => typeof v === 'bigint' ? Number(v) : v)
  const same = norm(lr) === norm(remote.rows.map(r => Object.fromEntries(remote.columns.map((c, i) => [c, r[i]]))))
  console.log(name.padEnd(22), 'rows', String(remote.rows.length).padEnd(6), 'first', ts[0] + 'ms', 'median', med([...ts]) + 'ms', 'all', ts.join('/'), same ? 'IDENTICAL' : 'DIFFERENT')
}
const c = await t.execute('SELECT count(*) n, sum(length(order_id)) FROM orders'); console.log('turso orders rows', c.rows[0][0])
