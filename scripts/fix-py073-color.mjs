// PY073/PY073-B สีสลับกันระหว่าง inventory_items กับ product_aliases: ชีตขาย (Shopee, master_sku
// PY073-b) ระบุ variation "ดำ" ชัดเจน แต่ inventory_items ตั้ง PY073=ดำ, PY073-B=เนื้อ ไว้ตรงข้าม —
// ไม่แตะ master_sku/alias_key ของ product_aliases (เสี่ยง orphan การ matchออเดอร์ตามกฎของระบบนี้)
// แก้แค่ display_name ฝั่ง inventory_items ให้ตรงกับสัญญาณจริงจากยอดขาย: สลับป้ายสีของสอง SKU นี้
import { getSheet, overwriteSheet } from '../api/_lib/sheets.js'

const ITEMS_SHEET = 'inventory_items'
const ITEMS_HEADERS = ['sku', 'display_name', 'unit', 'safety_stock', 'opening_balance', 'opening_date', 'active', 'created_at', 'updated_at', 'reorder_date', 'expected_arrival', 'lead_time_production', 'lead_time_transport', 'ship_freight', 'reorder_qty', 'reorder_note', 'category', 'units_per_batch', 'buffer_percent']

const FIXES = {
  'PY073': { expectOld: 'กันรองเท้ากัด/หลวม สีดำ', new: 'กันรองเท้ากัด/หลวม สีเนื้อ' },
  'PY073-B': { expectOld: 'กันรองเท้ากัด/หลวม สีเนื้อ', new: 'กันรองเท้ากัด/หลวม สีดำ' },
}

async function main() {
  const items = await getSheet(ITEMS_SHEET)
  const log = []

  for (const [sku, { expectOld, new: newName }] of Object.entries(FIXES)) {
    const idx = items.findIndex((it) => String(it.sku).toUpperCase() === sku)
    if (idx === -1) { console.log(`ไม่พบ ${sku} — ข้าม`); continue }
    const before = items[idx].display_name
    if (before !== expectOld) {
      console.log(`${sku}: ค่าปัจจุบันไม่ตรงที่คาด (คาด "${expectOld}" เจอ "${before}") — หยุด ไม่แก้ตัวนี้`)
      continue
    }
    items[idx] = { ...items[idx], display_name: newName, updated_at: new Date().toISOString() }
    log.push({ sku, before, after: newName })
  }

  if (!log.length) { console.log('ไม่มีอะไรให้แก้'); return }

  await overwriteSheet(ITEMS_SHEET, ITEMS_HEADERS, items.map((it) => ITEMS_HEADERS.map((h) => it[h] ?? '')))

  console.log('\nแก้แล้ว:')
  for (const l of log) console.log(`  ${l.sku}\n    ก่อน: "${l.before}"\n    หลัง: "${l.after}"`)
}

main().catch((e) => { console.error('แก้ไม่สำเร็จ:', e.message); process.exit(1) })
