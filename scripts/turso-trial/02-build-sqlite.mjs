import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const dir = process.argv[2], dbPath = process.argv[3], lean = process.argv[4] === 'lean'
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
const db = new DatabaseSync(dbPath)
const H = 'order_key order_id order_item_id date platform business sku_platform product_name variation_name master_sku display_name qty revenue order_status imported_at source_file import_id alias_key province shipping_option fulfillment_type buyer_hash'.split(' ')
const drop = lean ? new Set(['imported_at','source_file','import_id','alias_key','sku_platform','product_name']) : new Set()
const cols = H.filter(c => !drop.has(c))
const type = c => c === 'qty' ? 'INTEGER' : c === 'revenue' ? 'REAL' : 'TEXT'
db.exec(`CREATE TABLE orders(${cols.map(c => `${c} ${type(c)}`).join(',')}, ym TEXT)`)
const ins = db.prepare(`INSERT INTO orders VALUES(${cols.map(() => '?').join(',')},?)`)
const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
let n = 0
db.exec('BEGIN')
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const vals = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i]; const d = {}
    H.forEach((c, k) => { d[c] = r[k] ?? '' })
    if (!d.date) continue
    d.qty = parseInt(d.qty, 10) || 0; d.revenue = num(d.revenue)
    ins.run(...cols.map(c => d[c]), String(d.date).slice(0, 7)); n++
  }
}
db.exec('COMMIT')
db.exec('CREATE INDEX i_date ON orders(date); CREATE INDEX i_store ON orders(business,platform,ym); CREATE INDEX i_sku ON orders(master_sku,date)')
db.exec('VACUUM')
console.log(lean ? 'lean' : 'full', 'rows', n, 'bytes', fs.statSync(dbPath).size)
