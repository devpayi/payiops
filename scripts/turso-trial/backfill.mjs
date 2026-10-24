// Backfill สำเนา raw_orders ใน Turso จาก Google Sheets (รันซ้ำได้ — แท็บที่ตรงกันอยู่แล้วจะไม่ถูกเขียนใหม่)
//
//   node --use-system-ca --env-file=.env scripts/turso-trial/backfill.mjs            # ทุกแท็บ raw_orders_YYYY_MM ที่มีข้อมูล
//   node --use-system-ca --env-file=.env scripts/turso-trial/backfill.mjs --dry      # เทียบอย่างเดียว ไม่เขียน
//   node --use-system-ca --env-file=.env scripts/turso-trial/backfill.mjs raw_orders_2026_09 raw_orders_2026_08
//
// ต้องมี TURSO_DATABASE_URL / TURSO_AUTH_TOKEN ใน .env — Sheets ถูกอ่านอย่างเดียว (นอกจากแท็บ turso_dirty ที่ใช้เก็บธง)
// โควตาเขียนฟรีของ Turso = 10 ล้านแถว/เดือน (ดัชนีนับด้วย) — ทั้งปีราว 6 แถวเขียนต่อ 1 ออเดอร์ อย่ารัน "ซ่อมทั้งหมด" ซ้ำโดยไม่จำเป็น
process.env.TURSO_MIRROR = 'on'
const { reconcile, mirrorStatus, tabYm } = await import('../../api/_lib/ordersMirror.js')
const { getMeta } = await import('../../api/_lib/sheets.js')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
let tabs = args.filter((a) => tabYm(a))
if (!tabs.length) {
  const meta = await getMeta()
  tabs = meta.sheets.map((s) => s.properties.title).filter((t) => tabYm(t)).sort()
}
console.log(dry ? 'DRY RUN (เทียบอย่างเดียว)' : 'BACKFILL', tabs.length, 'แท็บ')
const out = await reconcile({ tabs, repair: !dry, budgetMs: 3 * 60 * 60 * 1000 })
let bad = 0
for (const r of out.report) {
  if (r.skipped) { console.log(r.tab, 'ข้าม:', r.skipped); bad++; continue }
  const s = r.sheets, t = r.turso
  const state = r.match ? 'ตรง' : r.repair ? (r.repair.done ? `ซ่อมแล้ว (${r.repair.inserted} แถว)` : 'ซ่อมไม่ครบ — รันซ้ำ') : 'ไม่ตรง'
  if (!r.match && (!r.repair || !r.repair.done)) bad++
  console.log(r.tab.padEnd(20), `sheets ${s.count} แถว / ${(s.cents / 100).toFixed(2)} บาท / ${s.qty} ชิ้น`, '|', `turso ${t.count} แถว`, '|', state)
}
console.log(JSON.stringify(await mirrorStatus()))
process.exit(bad ? 1 : 0)
