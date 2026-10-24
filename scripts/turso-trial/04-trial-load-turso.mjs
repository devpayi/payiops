import { createClient } from '@libsql/client'
import { DatabaseSync } from 'node:sqlite'
const t = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const src = new DatabaseSync(process.argv[2], { readOnly: true })
const cols = src.prepare('PRAGMA table_info(orders)').all().map(c => c.name)
const defs = src.prepare('PRAGMA table_info(orders)').all().map(c => `${c.name} ${c.type}`)
await t.execute('DROP TABLE IF EXISTS orders')
await t.execute(`CREATE TABLE orders(${defs.join(',')}, ex INTEGER)`)
const rows = src.prepare(`SELECT *, (order_status LIKE '%ยกเลิก%' OR lower(order_status) LIKE '%cancel%' OR lower(order_status) LIKE '%return%') ex FROM orders`).all()
const ph = `(${[...cols, 'ex'].map(() => '?').join(',')})`
const ins = `INSERT INTO orders VALUES ${ph}`
const B = 400; const t0 = Date.now()
for (let i = 0; i < rows.length; i += B) {
  const stmts = rows.slice(i, i + B).map(r => ({ sql: ins, args: [...cols, 'ex'].map(c => r[c]) }))
  await t.batch(stmts, 'write')
  if ((i / B) % 100 === 0) console.log(i, Math.round((Date.now() - t0) / 1000) + 's')
}
await t.batch(['CREATE INDEX i_cover ON orders(ym,business,platform,ex,order_id,qty,revenue)', 'CREATE INDEX i_sku ON orders(master_sku,date)', 'CREATE INDEX i_date ON orders(date)'], 'write')
const r = await t.execute('SELECT count(*) n FROM orders'); console.log('loaded', r.rows[0].n, 'in', Math.round((Date.now() - t0) / 1000) + 's')
