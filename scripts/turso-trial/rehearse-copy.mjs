// ซ้อมกระจก Turso บน "ชีตสำเนา" — รัน handler จริง (api/import-orders.js) ในเครื่อง ไม่แตะชีตจริง
//
// เตรียม: Make a copy ของ mona-ops-db (ชื่อมีคำว่า copy/สำเนา/rehearsal) แชร์ให้ service account แบบ Editor
//   REHEARSAL_SHEET_ID=<id ของสำเนา> node --use-system-ca --env-file=.env scripts/turso-trial/rehearse-copy.mjs
//
// สิ่งที่ทำ (ตามลำดับ) — ทุกอย่างเขียนเฉพาะสำเนา + ตาราง Turso แยกชื่อ raw_orders_rehearsal:
//   main   : ฐานเทียบ → นำเข้า 10 ออเดอร์ → นำเข้าซ้ำ (ต้องไม่เปลี่ยน) → แก้สถานะ 2 ออเดอร์ → ลบล็อต 2 ล็อต
//            หลังแต่ละขั้น: Sheets(สำเนา) = Turso(ตารางซ้อม) ตาม fingerprint และหลังลบหมดต้องเท่าฐานเทียบ
//   down   : จำลอง Turso ล่ม (URL ผิด) → นำเข้าต้องสำเร็จ + import_log ครบ + แท็บติดธง turso_dirty
//   repair : Turso กลับมา → reconcile ซ่อมจนตรง ธงถูกปลด → ลบล็อตที่เหลือ → กลับเท่าฐานเทียบ
// ออกด้วย exit code 1 ถ้ามีข้อใดไม่ผ่าน
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const phase = process.argv[2] || 'all'
const TAB = 'raw_orders_2026_09'
const DATE = '2026-09-28'
const TABLE = 'raw_orders_rehearsal'

function checkEnv() {
  const original = (process.env.SHEET_ID || '').trim()
  const copy = (process.env.REHEARSAL_SHEET_ID || '').trim()
  if (!copy) throw new Error('ต้องตั้ง REHEARSAL_SHEET_ID = id ของชีตสำเนา')
  if (copy === original) throw new Error('REHEARSAL_SHEET_ID ตรงกับ SHEET_ID จริง — ปฏิเสธ')
}
function guard() {
  checkEnv()
  process.env.SHEET_ID = (process.env.REHEARSAL_SHEET_ID || '').trim()
  process.env.ARCHIVE_SHEET_ID = (process.env.REHEARSAL_ARCHIVE_SHEET_ID || '').trim()
  delete process.env.AUTH_SECRET // เปิด auth ไม่ได้ในเครื่อง — requireDev ผ่านเหมือน local dev ปกติ
  process.env.TURSO_MIRROR = 'on'
  process.env.TURSO_ORDERS_TABLE = TABLE
}

if (phase === 'all') {
  checkEnv() // เช็คก่อนเริ่ม child (child ทำ guard + สลับ SHEET_ID เอง)
  const dir = mkdtempSync(join(tmpdir(), 'turso-rehearsal-'))
  const state = join(dir, 'state.json')
  // --env-file ไม่ทับตัวแปรที่ตั้งไว้แล้ว → ขั้น down ส่ง TURSO_DATABASE_URL ผิดไปทับค่าใน .env ได้
  const run = (p, env = {}) => spawnSync(process.execPath, ['--use-system-ca', '--env-file=.env', fileURLToPath(import.meta.url), p, state], {
    stdio: 'inherit', env: { ...process.env, ...env },
  }).status
  const codes = [run('main'), run('down', { TURSO_DATABASE_URL: 'https://turso-down.invalid' }), run('repair')]
  console.log('\n=== สรุป ===', codes.map((c, i) => `${['main', 'down', 'repair'][i]}=${c === 0 ? 'ผ่าน' : 'ไม่ผ่าน'}`).join(' '))
  process.exit(codes.every((c) => c === 0) ? 0 : 1)
}

guard()
const statePath = process.argv[3]
const sheets = await import('../../api/_lib/sheets.js')
const mirror = await import('../../api/_lib/ordersMirror.js')
const importHandler = (await import('../../api/import-orders.js')).default
if (mirror.TABLE !== TABLE) throw new Error(`ตารางที่ใช้ต้องเป็น ${TABLE} ไม่ใช่ ${mirror.TABLE}`)

const meta = await sheets.getMeta()
const title = meta.properties?.title || ''
if (!/copy|สำเนา|rehearsal|test/i.test(title)) throw new Error(`ชื่อชีต "${title}" ไม่ดูเป็นสำเนา (ต้องมี copy/สำเนา/rehearsal/test) — ปฏิเสธ`)
console.log(`[${phase}] ชีตสำเนา: "${title}" | ตาราง Turso: ${TABLE}`)

let failed = 0
const check = (ok, label, extra = '') => { console.log(`  ${ok ? 'ผ่าน' : 'ไม่ผ่าน'}  ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed++ }

async function call(method, query, body) {
  let code = 200, out
  const res = { setHeader() {}, status(c) { code = c; return this }, json(b) { out = b; return this }, end() {} }
  await importHandler({ method, query, body, headers: {} }, res)
  return { code, body: out }
}
const sheetFp = async () => {
  const vr = await sheets.batchGetValues([`${TAB}!A:V`])
  return mirror.fingerprint(((vr[0]?.values) || []).slice(1).map((a) => mirror.toRow(a, TAB)).filter(Boolean))
}
const fpStr = (f) => `${f.count} แถว/${(f.cents / 100).toFixed(2)} บาท/${f.hash}`
const same = (a, b) => a.count === b.count && a.cents === b.cents && a.qty === b.qty && a.hash === b.hash
async function checkMirrorAfterDelete(label) {
  if (!same(await sheetFp(), await tursoFp())) {
    // ลบเดือนใหญ่ใน Sheets อาจกินเวลาทั้ง request จน mirror ต้องเลื่อนงาน
    // ยอมรับได้เฉพาะมีธงถาวรแล้ว และซ่อมจาก Sheets ได้ตรงจริง
    check((await dirtyLast()) === 'dirty', `${label}: มีธงรอซ่อมถาวรเมื่อ mirror ถูกเลื่อน`)
    await mirror.reconcile({ tabs: [TAB], repair: true, budgetMs: 120000 })
  }
  check(same(await sheetFp(), await tursoFp()), `${label}: Sheets = Turso`)
}
async function tursoFp() {
  const { createClient } = await import('@libsql/client/http')
  const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  await mirror.ensureSchema(c)
  return mirror.tursoFingerprint(c, TAB)
}

const runId = Date.now().toString(36).toUpperCase()
const mkRows = (tag, statusOf = () => 'สำเร็จ') => Array.from({ length: 10 }, (_, i) => ({
  business: 'Payi', order_id: `REH${runId}${tag}${i}`, date: DATE, product_name: 'REHEARSAL สินค้าทดสอบ', variation_name: 'X', qty: 2, revenue: 100.5 + i, order_status: statusOf(i),
}))
const importRows = (rows, name) => call('POST', {}, { fileName: name, platform: 'Shopee', business: 'Payi', rows, expectedMonth: '2026-09' })
const dirtyLast = async () => { const rows = await sheets.getSheet('turso_dirty').catch(() => []); const last = new Map(); for (const r of rows) last.set(r.tab, r.event); return last.get(TAB) }

if (phase === 'main') {
  // ฐานเทียบ: ทำให้ตารางซ้อมตรงกับสำเนาก่อน (โหลดแท็บเดียวจากสำเนา)
  console.log('[main] โหลดฐานเทียบ…')
  await mirror.resyncTab(TAB, { reason: 'rehearsal-baseline' })
  const base = await sheetFp()
  check(same(base, await tursoFp()), 'ฐานเทียบ: สำเนา Sheets = ตาราง Turso ซ้อม', fpStr(base))
  const rows1 = mkRows('A')
  const r1 = await importRows(rows1, 'rehearsal-1.xlsx')
  check(r1.body?.success && r1.body.imported === 10, 'นำเข้า 10 ออเดอร์', JSON.stringify({ imported: r1.body?.imported, updated: r1.body?.updated }))
  const id1 = r1.body.importId
  check(same(await sheetFp(), await tursoFp()), 'หลังนำเข้า: Sheets = Turso')
  const r2 = await importRows(rows1, 'rehearsal-1.xlsx')
  check(r2.body?.success && r2.body.imported === 0 && r2.body.updated === 0, 'นำเข้าไฟล์เดิมซ้ำ: ไม่เพิ่ม ไม่แก้', JSON.stringify({ imported: r2.body?.imported, updated: r2.body?.updated, skippedDup: r2.body?.skippedDup }))
  check(same(await sheetFp(), await tursoFp()), 'หลังนำเข้าซ้ำ: Sheets = Turso')
  const r3 = await importRows(mkRows('A', (i) => (i < 2 ? 'ยกเลิก' : 'สำเร็จ')), 'rehearsal-2.xlsx')
  check(r3.body?.success && r3.body.updated === 2, 'แก้สถานะ 2 ออเดอร์เป็นยกเลิก', JSON.stringify({ imported: r3.body?.imported, updated: r3.body?.updated }))
  const id2 = r3.body.importId
  check(same(await sheetFp(), await tursoFp()), 'หลังแก้สถานะ: Sheets = Turso')
  // แถวที่ถูกแก้ถือ import_id ของล็อตที่แก้ (2 แถว) ที่เหลือ 8 แถวยังถือล็อตแรก
  const d2 = await call('DELETE', { importId: id2 })
  check(d2.body?.success && d2.body.deleted === 2, 'ลบล็อตที่ 2 (แถวที่ถูกแก้)', JSON.stringify(d2.body))
  await checkMirrorAfterDelete('หลังลบล็อต 2')
  const d1 = await call('DELETE', { importId: id1 })
  check(d1.body?.success && d1.body.deleted === 8, 'ลบล็อตที่ 1 (ที่เหลือ 8 แถว)', JSON.stringify(d1.body))
  await checkMirrorAfterDelete('หลังลบหมด')
  const end = await sheetFp()
  check(same(end, base), 'กลับเท่าฐานเทียบ (ข้อมูลอื่นไม่หาย)', fpStr(end))
  await mirror.reconcile({ tabs: [TAB], repair: true, budgetMs: 120000 })
  check((await dirtyLast()) !== 'dirty', 'ตรวจแล้วไม่มีธง dirty ค้างจากรอบปกติ')
} else if (phase === 'down') {
  console.log('[down] Turso ถูกจำลองให้ล่ม (URL ผิด) — นำเข้าต้องสำเร็จ')
  const rows = mkRows('D')
  const t0 = Date.now()
  const r = await importRows(rows, 'rehearsal-down.xlsx')
  const ms = Date.now() - t0
  check(r.code === 200 && r.body?.success && r.body.imported === 10, 'นำเข้าสำเร็จแม้ Turso ล่ม', `${ms}ms ${JSON.stringify({ imported: r.body?.imported })}`)
  check(ms < 45000, 'ไม่เกินงบเวลา (45 วินาที)', `${ms}ms`)
  const log = await sheets.getSheet('import_log')
  check(log.some((x) => x.import_id === r.body?.importId && x.status === 'active'), 'import_log บันทึกครบ')
  const vr = await sheets.batchGetValues([`${TAB}!A:V`])
  check(((vr[0]?.values) || []).filter((row) => String(row[16]) === r.body?.importId).length === 10, 'Sheets มี 10 แถวของล็อตนี้')
  check((await dirtyLast()) === 'dirty', 'แท็บถูกติดธง dirty ใน turso_dirty', await dirtyLast())
  writeFileSync(statePath, JSON.stringify({ importId: r.body?.importId }))
} else if (phase === 'repair') {
  console.log('[repair] Turso กลับมา — reconcile ต้องซ่อมจนตรง')
  if (!existsSync(statePath)) throw new Error('ไม่พบ state ของขั้น down (รันขั้น down ก่อน)')
  const { importId } = JSON.parse(readFileSync(statePath, 'utf8'))
  const before = await sheetFp()
  check(!same(before, await tursoFp()), 'ก่อนซ่อม: Turso ขาดแถวของล็อตที่นำเข้าตอนล่ม (ไม่ตรงจริง)')
  const out = await mirror.reconcile({ tabs: [TAB], repair: true, budgetMs: 120000 })
  const e = out.report[0]
  check(e && !e.match && e.repair?.done, 'reconcile เจอไม่ตรงและซ่อมสำเร็จ', JSON.stringify({ match: e?.match, repair: e?.repair }))
  check(same(await sheetFp(), await tursoFp()), 'หลังซ่อม: Sheets = Turso')
  check((await dirtyLast()) === 'clean', 'ธง dirty ถูกปลด', await dirtyLast())
  const again = await mirror.reconcile({ tabs: [TAB], repair: false })
  check(again.report[0].match, 'reconcile รอบสองตรงโดยไม่ต้องซ่อม')
  const d = await call('DELETE', { importId })
  check(d.body?.success && d.body.deleted === 10, 'ลบล็อตที่เหลือ', JSON.stringify(d.body))
  await checkMirrorAfterDelete('หลังลบ')
  console.log('  หมายเหตุ: ขั้น main ตรวจ "กลับเท่าฐานเทียบ" ไปแล้ว ขั้นนี้ตรวจ Sheets = Turso หลังลบ')
}
console.log(failed ? `[${phase}] ไม่ผ่าน ${failed} ข้อ` : `[${phase}] ผ่านทุกข้อ`)
process.exit(failed ? 1 : 0)
