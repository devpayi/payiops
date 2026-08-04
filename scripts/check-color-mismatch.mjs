// เช็คสี SKU ที่แยกสี/ไซส์เอง (เช่น PY073-B, PY051-C) ว่า display_name ใน `inventory_items`
// (ชีตสต็อก — ใช้ขึ้นในดรอปดาวน์ "เบิกของ"/"สั่งของ"/Inventory) กับ `product_aliases`
// (ชีตจับคู่ยอดขายจริง) พูดถึงสีตรงกันไหม — เจอเคสจริง PY073-B ก่อนหน้านี้ (2026-08) ที่สองชีต
// ตั้งสีสลับกัน (ชีตสต็อกบอก "เนื้อ" แต่ชีตยอดขายบอก "ดำ") เกิดจากตอนแยก SKU สีปี 2026-07-22
// พิมพ์สีผิดตอนกรอกชีตใดชีตหนึ่ง — สคริปต์นี้ไล่เช็คทุก SKU อัตโนมัติแทนไล่ดูมือทีละแถว
//
// วิธีรัน (ต้องมี .env ที่มี GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY/SHEET_ID ใช้งานได้จริง
// และเน็ตเวิร์กต่อ Google Sheets API ได้ — รันจาก dev/CI ที่มีสิทธิ์เข้าถึงจริง ไม่ใช่ sandbox แยก):
//   node --env-file=.env scripts/check-color-mismatch.mjs
//
// อ่านอย่างเดียว (getSheet เท่านั้น) — ไม่แก้ไขอะไรในชีตทั้งสิ้น ปลอดภัยรันซ้ำได้เรื่อยๆ
import { getSheet } from '../api/_lib/sheets.js'
import { COLOR_TOKENS } from '../api/_lib/productGroup.js'

const norm = (s) => String(s || '').trim()
const upper = (s) => norm(s).toUpperCase()

// ดึง token สีที่เจอในข้อความ (คั่นด้วยช่องว่าง/ขีด/สแลช ฯลฯ เหมือน productGroup.js) — คืนเป็น Set
function colorsIn(text) {
  const tokens = norm(text)
    .split(/[\s\-_/|·•()（）\[\]【】]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean)
  return new Set(tokens.filter((t) => COLOR_TOKENS.has(t)))
}

function setsDisjoint(a, b) {
  if (!a.size || !b.size) return false
  for (const v of a) if (b.has(v)) return false
  return true
}

async function main() {
  const [items, aliases] = await Promise.all([
    getSheet('inventory_items'),
    getSheet('product_aliases'),
  ])

  // master_sku -> รวม text ทุกฟิลด์ที่อาจมีคำบอกสี (display_name, alias_product_name, alias_variation)
  const aliasTextBySku = new Map()
  for (const row of aliases) {
    const sku = upper(row.master_sku)
    if (!sku) continue
    const text = [row.display_name, row.alias_product_name, row.alias_variation].filter(Boolean).join(' ')
    aliasTextBySku.set(sku, `${aliasTextBySku.get(sku) || ''} ${text}`.trim())
  }

  const mismatches = []
  const noAliasMatch = []

  for (const item of items) {
    const sku = upper(item.sku)
    if (!sku || item.category === 'packaging') continue
    const invColors = colorsIn(item.display_name)
    if (!invColors.size) continue // ไม่มีคำสีในชื่อสต็อก ไม่มีอะไรให้เทียบ

    const aliasText = aliasTextBySku.get(sku)
    if (!aliasText) {
      noAliasMatch.push({ sku: item.sku, display_name: item.display_name })
      continue
    }

    const aliasColors = colorsIn(aliasText)
    if (setsDisjoint(invColors, aliasColors)) {
      mismatches.push({
        sku: item.sku,
        inventory_display_name: item.display_name,
        inventory_colors: [...invColors].join(', '),
        product_aliases_text: aliasText,
        product_aliases_colors: [...aliasColors].join(', '),
      })
    }
  }

  console.log(`\n=== ตรวจสอบสี: inventory_items เทียบ product_aliases ===`)
  console.log(`SKU ทั้งหมดที่มีคำสีในชื่อ (สต็อก): ${items.filter((it) => colorsIn(it.display_name).size).length}`)
  console.log(`\n--- ไม่ตรงกัน (${mismatches.length}) — ต้องแก้ ---`)
  for (const m of mismatches) {
    console.log(`\n${m.sku}`)
    console.log(`  ชีตสต็อก (inventory_items):   "${m.inventory_display_name}"  → สี: ${m.inventory_colors}`)
    console.log(`  ชีตยอดขาย (product_aliases):  "${m.product_aliases_text}"  → สี: ${m.product_aliases_colors}`)
  }

  console.log(`\n--- ไม่มีข้อมูลใน product_aliases ให้เทียบ (${noAliasMatch.length}) — ปกติได้ ถ้าเป็น SKU แยกสีเองที่ raw_orders ไม่เคยแยกขาย (ดู allocatedSales ใน Inventory.jsx) ---`)
  for (const m of noAliasMatch) console.log(`  ${m.sku} — "${m.display_name}"`)

  console.log(`\nเสร็จแล้ว — ${mismatches.length} รายการต้องแก้, ${noAliasMatch.length} รายการไม่มีคู่เทียบ (ไม่ใช่ปัญหาแน่นอน ต้องดูรายตัว)\n`)
}

main().catch((e) => {
  console.error('เช็คไม่สำเร็จ:', e.message)
  process.exit(1)
})
