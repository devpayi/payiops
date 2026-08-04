// เช็ค product_aliases ทุกแถวของ SKU ตัวเดียว (ไม่ตัดพิมพ์เล็ก/ใหญ่) — อ่านอย่างเดียว
//   node --env-file=.env scripts/check-one-sku.mjs PY073
import { getSheet } from '../api/_lib/sheets.js'

const sku = (process.argv[2] || '').toUpperCase()
if (!sku) { console.error('ใส่ SKU ด้วย'); process.exit(1) }

async function main() {
  const aliases = await getSheet('product_aliases')
  const rows = aliases.filter((a) => String(a.master_sku).toUpperCase() === sku)
  console.log(`\n=== product_aliases master_sku=${sku} (${rows.length} แถว) ===`)
  for (const r of rows) {
    console.log(`  master_sku:"${r.master_sku}" | business:${r.business} | platform:${r.platform} | display_name:"${r.display_name}" | alias_product_name:"${r.alias_product_name}" | alias_variation:"${r.alias_variation}"`)
  }
}

main().catch((e) => { console.error('พัง:', e.message); process.exit(1) })
