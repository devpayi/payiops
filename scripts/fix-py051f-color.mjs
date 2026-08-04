// แก้ display_name ของ PY051-F ใน inventory_items ให้สีตรงกับ product_aliases (ยึด product_aliases
// เป็นค่าที่ถูกต้อง ตาม check-color-mismatch.mjs ที่เจอ 1 รายการไม่ตรง: สต็อกเขียน "น้ำเงิน" แต่ยอดขาย
// เขียน "ฟ้า" สำหรับ SKU เดียวกัน — one-off fix, log ค่าก่อน-หลังไว้ ไม่ลบสคริปต์นี้ (เผื่อย้อนดู)
import { getSheet, overwriteSheet } from '../api/_lib/sheets.js'

const ITEMS_SHEET = 'inventory_items'
const ITEMS_HEADERS = ['sku', 'display_name', 'unit', 'safety_stock', 'opening_balance', 'opening_date', 'active', 'created_at', 'updated_at', 'reorder_date', 'expected_arrival', 'lead_time_production', 'lead_time_transport', 'ship_freight', 'reorder_qty', 'reorder_note', 'category', 'units_per_batch', 'buffer_percent']

const TARGET_SKU = 'PY051-F'
const OLD_NAME = 'รองเท้าเพื่อสุขภาพ Ocean(น้ำเงิน) 35-36'
const NEW_NAME = 'รองเท้าเพื่อสุขภาพ Ocean(ฟ้า) 35-36'

async function main() {
  const items = await getSheet(ITEMS_SHEET)
  const idx = items.findIndex((it) => String(it.sku).toUpperCase() === TARGET_SKU)
  if (idx === -1) throw new Error(`ไม่พบ ${TARGET_SKU}`)

  const before = items[idx].display_name
  if (before !== OLD_NAME) {
    console.log(`ค่าปัจจุบันไม่ตรงกับที่คาดไว้ — คาด "${OLD_NAME}" แต่เจอ "${before}" — หยุด ไม่แก้ (เผื่อมีคนแก้ไปแล้ว)`)
    return
  }

  items[idx] = { ...items[idx], display_name: NEW_NAME, updated_at: new Date().toISOString() }
  await overwriteSheet(ITEMS_SHEET, ITEMS_HEADERS, items.map((it) => ITEMS_HEADERS.map((h) => it[h] ?? '')))

  console.log(`แก้แล้ว: ${TARGET_SKU}`)
  console.log(`  ก่อน: "${before}"`)
  console.log(`  หลัง: "${NEW_NAME}"`)
}

main().catch((e) => {
  console.error('แก้ไม่สำเร็จ:', e.message)
  process.exit(1)
})
