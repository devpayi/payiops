// เช็คชื่อ/สี SKU ตัวเดียว (match ด้วยคำในชื่อ) ระหว่าง inventory_items กับ product_aliases —
// ใช้กรณีอยากดูเจาะจงตัวเดียวแทนไล่ทั้งหมดแบบ check-color-mismatch.mjs (อ่านอย่างเดียว ไม่แก้ไข)
//   node --env-file=.env scripts/check-one-product.mjs "<คำค้น>"
import { getSheet } from '../api/_lib/sheets.js'

const query = process.argv[2] || ''
if (!query) { console.error('ใส่คำค้นด้วย เช่น: node scripts/check-one-product.mjs "แผ่นกันหลวม"'); process.exit(1) }

async function main() {
  const [items, aliases] = await Promise.all([getSheet('inventory_items'), getSheet('product_aliases')])

  const matchedItems = items.filter((it) => String(it.display_name || '').includes(query) || String(it.sku || '').toUpperCase().includes(query.toUpperCase()))
  const skusFound = new Set(matchedItems.map((it) => String(it.sku).toUpperCase()))

  console.log(`\n=== inventory_items ที่ตรงกับ "${query}" (${matchedItems.length}) ===`)
  for (const it of matchedItems) {
    console.log(`  ${it.sku} — "${it.display_name}"  (active: ${it.active})`)
  }

  console.log(`\n=== product_aliases ที่ตรงกับ SKU เดียวกัน หรือชื่อมีคำนี้ ===`)
  const matchedAliases = aliases.filter((a) => skusFound.has(String(a.master_sku).toUpperCase()) || String(a.display_name || '').includes(query) || String(a.alias_product_name || '').includes(query))
  for (const a of matchedAliases) {
    console.log(`  ${a.master_sku} — display_name: "${a.display_name}" | alias: "${a.alias_product_name}" ${a.alias_variation ? `(${a.alias_variation})` : ''} | platform: ${a.platform}`)
  }
  if (!matchedAliases.length) console.log('  (ไม่พบ)')
  console.log()
}

main().catch((e) => { console.error('พัง:', e.message); process.exit(1) })
