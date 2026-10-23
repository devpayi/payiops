// ordersMirror — สำเนา raw_orders ลง Turso: ใช้ libSQL ในหน่วยความจำ + ชีตจำลอง ไม่แตะ Google/Turso จริง
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@libsql/client'
import {
  __setDepsForTests, mirrorRows, mirrorDeleteLot, resyncTab, reconcile, listDirtyTabs, markDirty, fingerprint, toRow,
  mirrorStatus, RAW_HEADERS, TABLE,
} from '../api/_lib/ordersMirror.js'

const TAB = 'raw_orders_2026_09'

// แถว 22 คอลัมน์แบบที่ชีตเก็บ
function sheetRow(o = {}) {
  const d = {
    order_key: 'Shopee:A1:L1', order_id: "'A1", order_item_id: "'L1", date: '2026-09-01', platform: 'Shopee', business: 'Payi',
    sku_platform: "'S1", product_name: 'ถุงเท้า', variation_name: 'M', master_sku: 'PY006', display_name: 'ถุงเท้าเจล', qty: 2, revenue: 100.5,
    order_status: 'สำเร็จ', imported_at: '2026-09-02T00:00:00Z', source_file: 'a.xlsx', import_id: 'IMP1', alias_key: 'k', province: 'กรุงเทพ',
    shipping_option: '', fulfillment_type: '', buyer_hash: 'h', ...o,
  }
  return RAW_HEADERS.map((h) => d[h])
}

// ชีตจำลอง: เก็บแท็บในหน่วยความจำ + ธง dirty
function fakeSheets(tabs = {}) {
  const store = { tabs: { ...tabs }, dirtyLog: [] }
  return {
    store,
    api: {
      async ensureSheet() {},
      async appendRows(name, rows) { if (name === 'turso_dirty') for (const r of rows) store.dirtyLog.push({ tab: r[0], event: r[1], at: r[2], reason: r[3] }) },
      async getSheet(name) { return name === 'turso_dirty' ? store.dirtyLog.map((r) => ({ ...r })) : [] },
      async batchGetValues(ranges) { return ranges.map((r) => ({ values: [RAW_HEADERS, ...(store.tabs[r.split('!')[0]] || [])] })) },
      async getMeta() { return { sheets: Object.keys(store.tabs).map((title) => ({ properties: { title } })) } },
    },
  }
}

async function setup(tabs) {
  const client = createClient({ url: ':memory:' })
  const sheets = fakeSheets(tabs)
  __setDepsForTests({ client, enabled: true, sheets: sheets.api, now: () => '2026-09-10T00:00:00Z' })
  return { client, sheets }
}
const count = async (client, where = '1=1', args = []) => Number((await client.execute({ sql: `SELECT count(*) n FROM ${TABLE} WHERE ${where}`, args })).rows[0][0])

test('toRow: ตัด quote นำหน้า, แถวไม่มีวันที่ถูกข้าม, สถานะยกเลิก/return เป็น ex=1', () => {
  const r = toRow(sheetRow(), TAB)
  assert.equal(r.order_id, 'A1'); assert.equal(r.sku_platform, 'S1'); assert.equal(r.ym, '2026-09'); assert.equal(r.ex, 0)
  assert.equal(toRow(sheetRow({ date: '' }), TAB), null)
  assert.equal(toRow(sheetRow({ order_status: 'ยกเลิกแล้ว' }), TAB).ex, 1)
  assert.equal(toRow(sheetRow({ order_status: 'Package Returned' }), TAB).ex, 1)
  // ข้อความ "ผู้ซื้อ...ยื่นคำขอคืนเงิน" ต้องไม่นับเป็น return (เหมือน dashboard)
  assert.equal(toRow(sheetRow({ order_status: 'ผู้ซื้อได้รับสินค้าแล้ว สามารถคืนเงินได้' }), TAB).ex, 0)
})

test('toRow: id แบบ 1.12E+15 ถูกกู้คืนจาก order_key', () => {
  const r = toRow(sheetRow({ order_key: 'Lazada:1120000000000001:2230000000000002', platform: 'Lazada', order_id: '1.12E+15', order_item_id: '2.23E+15' }), TAB)
  assert.equal(r.order_id, '1120000000000001'); assert.equal(r.order_item_id, '2230000000000002')
})

test('เพิ่มแถวใหม่ แล้วนำเข้าซ้ำ (เล่นซ้ำ) ไม่ทำให้แถวเบิ้ล', async () => {
  const { client } = await setup()
  const rows = [sheetRow(), sheetRow({ order_key: 'Shopee:A2:L1', order_id: "'A2" })]
  assert.deepEqual((await mirrorRows(TAB, rows)).ok, true)
  assert.equal(await count(client), 2)
  await mirrorRows(TAB, rows); await mirrorRows(TAB, rows)
  assert.equal(await count(client), 2)
})

test('แก้สถานะ/ยอดของ order_key เดิม = แทนที่แถวเดิม ไม่เพิ่มแถว', async () => {
  const { client } = await setup()
  await mirrorRows(TAB, [sheetRow()])
  await mirrorRows(TAB, [sheetRow({ order_status: 'ยกเลิก', revenue: 0, import_id: 'IMP2' })])
  assert.equal(await count(client), 1)
  const r = (await client.execute(`SELECT order_status, ex, import_id, revenue FROM ${TABLE}`)).rows[0]
  assert.deepEqual([r[0], Number(r[1]), r[2], Number(r[3])], ['ยกเลิก', 1, 'IMP2', 0])
})

test('ลบล็อตตาม import_id: ลบเฉพาะล็อตนั้น และเทียบจำนวนกับที่ชีตลบ', async () => {
  const { client } = await setup()
  await mirrorRows(TAB, [sheetRow({ order_key: 'Shopee:A1:L1', import_id: 'IMP1' }), sheetRow({ order_key: 'Shopee:A2:L1', import_id: 'IMP1' }), sheetRow({ order_key: 'Shopee:A3:L1', import_id: 'IMP2' })])
  const ok = await mirrorDeleteLot('IMP1', 2, [TAB])
  assert.equal(ok.removed, 2); assert.equal(ok.mismatch, undefined)
  assert.equal(await count(client), 1)
  assert.deepEqual(await listDirtyTabs(), [])
  // ชีตบอกลบ 5 แต่สำเนามีแค่ 1 → ไม่ตรง → ติดธง
  const bad = await mirrorDeleteLot('IMP2', 5, [TAB])
  assert.equal(bad.mismatch, true)
  assert.deepEqual(await listDirtyTabs(), [TAB])
})

test('แถวที่ชีตข้าม (ออเดอร์กำกวม) ไม่ถูกส่ง = สำเนาไม่แตะ แม้ key ซ้ำอยู่แล้ว', async () => {
  const { client } = await setup()
  // สำเนามี key ซ้ำ 2 แถว (ข้อมูลเก่า) — ชีตข้ามออเดอร์นี้ จึงไม่เรียก mirrorRows ด้วยแถวนี้
  await resyncTabViaSheets(client, [sheetRow({ product_name: 'ก' }), sheetRow({ product_name: 'ข' })])
  assert.equal(await count(client), 2)
  await mirrorRows(TAB, [sheetRow({ order_key: 'Shopee:Z9:L1', order_id: "'Z9" })]) // ออเดอร์อื่นผ่านปกติ
  assert.equal(await count(client), 3)
  assert.equal(await count(client, 'order_key = ?', ['Shopee:A1:L1']), 2)
})
async function resyncTabViaSheets(client, rows) {
  const sheets = fakeSheets({ [TAB]: rows })
  __setDepsForTests({ client, enabled: true, sheets: sheets.api, now: () => '2026-09-10T00:00:00Z' })
  await resyncTab(TAB)
}

test('ถ้า Turso ล้มเหลว: ไม่ throw, คืน ok=false, ติดธง dirty ในชีต แล้ว reconcile ซ่อมให้ตรง', async () => {
  const sheetRows = [sheetRow(), sheetRow({ order_key: 'Shopee:A2:L1', order_id: "'A2", revenue: 50 })]
  const sheets = fakeSheets({ [TAB]: sheetRows })
  const broken = { batch: async () => { throw new Error('turso down') }, execute: async () => { throw new Error('turso down') } }
  __setDepsForTests({ client: broken, enabled: true, sheets: sheets.api })
  const res = await mirrorRows(TAB, sheetRows)
  assert.equal(res.ok, false)
  assert.deepEqual(await listDirtyTabs(), [TAB])
  // Turso กลับมา
  const client = createClient({ url: ':memory:' })
  __setDepsForTests({ client, enabled: true, sheets: sheets.api })
  const out = await reconcile({ tabs: [TAB] })
  assert.equal(out.report[0].match, false)
  assert.equal(out.report[0].repair.done, true)
  assert.equal(await count(client), 2)
  assert.deepEqual(await listDirtyTabs(), [])
  // รอบถัดไปตรงกันแล้ว ไม่ต้องซ่อมซ้ำ
  const again = await reconcile({ tabs: [TAB] })
  assert.equal(again.report[0].match, true); assert.equal(again.report[0].repair, undefined)
})

test('resync = เท่ากับ snapshot ในชีตเป๊ะ (รวมแถวซ้ำ/แถวไม่มีวันที่) และไม่ทับเดือนอื่น', async () => {
  const other = 'raw_orders_2026_08'
  const sheets = fakeSheets({
    [TAB]: [sheetRow(), sheetRow(), sheetRow({ order_key: 'Shopee:B:L1', date: '' }), sheetRow({ order_key: 'Shopee:C:L1', revenue: '1,234.50' })],
    [other]: [sheetRow({ order_key: 'Shopee:Old:L1', date: '2026-08-05' })],
  })
  const client = createClient({ url: ':memory:' })
  __setDepsForTests({ client, enabled: true, sheets: sheets.api })
  await resyncTab(other)
  const r = await resyncTab(TAB)
  assert.equal(r.total, 3) // แถวไม่มีวันที่ถูกข้าม เหมือนทุก endpoint
  assert.equal(await count(client, 'src_tab = ?', [TAB]), 3)
  assert.equal(await count(client, 'src_tab = ?', [other]), 1)
  // ซ่อมซ้ำได้โดยไม่เบิ้ล
  await resyncTab(TAB)
  assert.equal(await count(client, 'src_tab = ?', [TAB]), 3)
  const out = await reconcile({ tabs: [TAB, other] })
  assert.ok(out.report.every((x) => x.match))
  assert.equal(Number((await client.execute(`SELECT revenue FROM ${TABLE} WHERE order_key='Shopee:C:L1'`)).rows[0][0]), 1234.5)
})

test('reconcile จับค่าที่ถูกแก้ด้วยมือในชีต (สถานะเปลี่ยนแต่จำนวนแถวเท่าเดิม)', async () => {
  const rows = [sheetRow(), sheetRow({ order_key: 'Shopee:A2:L1' })]
  const sheets = fakeSheets({ [TAB]: rows })
  const client = createClient({ url: ':memory:' })
  __setDepsForTests({ client, enabled: true, sheets: sheets.api })
  await resyncTab(TAB)
  sheets.store.tabs[TAB] = [sheetRow({ order_status: 'ยกเลิก' }), rows[1]] // คนแก้ในชีต
  const dry = await reconcile({ tabs: [TAB], repair: false })
  assert.equal(dry.report[0].match, false)
  assert.equal(dry.report[0].repair, undefined) // repair=0 ไม่เขียนอะไร
  await reconcile({ tabs: [TAB] })
  const st = (await client.execute(`SELECT order_status FROM ${TABLE} WHERE order_key='Shopee:A1:L1'`)).rows[0][0]
  assert.equal(st, 'ยกเลิก')
})

test('ปิดกระจก (TURSO_MIRROR ไม่เปิด) = ไม่ทำอะไรเลย ไม่แตะ Turso/ชีต', async () => {
  const sheets = fakeSheets({})
  const trap = new Proxy({}, { get() { throw new Error('ไม่ควรแตะ client') } })
  __setDepsForTests({ client: trap, enabled: false, sheets: sheets.api })
  assert.deepEqual(await mirrorRows(TAB, [sheetRow()]), { skipped: true })
  assert.deepEqual(await mirrorDeleteLot('IMP1', 1, [TAB]), { skipped: true })
  assert.deepEqual(await reconcile(), { enabled: false })
  assert.deepEqual(await mirrorStatus(), { enabled: false })
  assert.equal(sheets.store.dirtyLog.length, 0)
})

test('dirty log: เหตุการณ์สุดท้ายต่อแท็บเป็นตัวตัดสิน', async () => {
  const { sheets } = await setup()
  await markDirty(TAB, 'x'); await markDirty('raw_orders_2026_08', 'y')
  sheets.store.dirtyLog.push({ tab: TAB, event: 'clean', at: 't', reason: '' })
  assert.deepEqual(await listDirtyTabs(), ['raw_orders_2026_08'])
})

test('fingerprint: ลำดับแถวไม่มีผล แต่ค่าเปลี่ยน 1 ช่องมีผล', () => {
  const a = [toRow(sheetRow(), TAB), toRow(sheetRow({ order_key: 'Shopee:A2:L1' }), TAB)]
  assert.deepEqual(fingerprint(a), fingerprint([...a].reverse()))
  const b = [toRow(sheetRow({ qty: 3 }), TAB), a[1]]
  assert.notEqual(fingerprint(a).hash, fingerprint(b).hash)
})

test('reconcile ค่าเริ่มต้น: เลือก 2 เดือนล่าสุดที่ไม่เกินเดือนปัจจุบัน (ไม่เลือกแท็บอนาคตที่ว่าง) + แท็บติดธง', async () => {
  const tabs = { raw_orders_2026_07: [sheetRow({ date: '2026-07-01' })], raw_orders_2026_08: [sheetRow({ order_key: 'Shopee:B:L1', date: '2026-08-01' })], raw_orders_2026_09: [sheetRow({ order_key: 'Shopee:C:L1' })], raw_orders_2026_10: [], raw_orders_2026_11: [] }
  const sheets = fakeSheets(tabs)
  const client = createClient({ url: ':memory:' })
  __setDepsForTests({ client, enabled: true, sheets: sheets.api, now: () => '2026-09-10T05:00:00Z' })
  const out = await reconcile({ repair: false })
  // 2 เดือนล่าสุด (08, 09) + เดือนเก่าหมุนเวียน 1 เดือน (มีแค่ 07) — ไม่เอาแท็บอนาคต 10/11 ที่ว่าง
  assert.deepEqual(out.report.map((r) => r.tab).sort(), ['raw_orders_2026_07', 'raw_orders_2026_08', 'raw_orders_2026_09'])
  await markDirty('raw_orders_2026_10', 'x') // แท็บที่ติดธงถูกเพิ่มเข้ามาเสมอ
  const out2 = await reconcile({ repair: false })
  assert.deepEqual(out2.report.map((r) => r.tab).sort(), ['raw_orders_2026_07', 'raw_orders_2026_08', 'raw_orders_2026_09', 'raw_orders_2026_10'])
})

test('Turso ค้าง (ไม่ตอบ): mirrorRows คืนเร็วภายในงบเวลา, ติดธง, เบรกเกอร์ทำให้ครั้งถัดไปข้ามทันที', async () => {
  const sheets = fakeSheets({})
  const hang = () => new Promise(() => {}) // ไม่ resolve ไม่ reject
  __setDepsForTests({ client: { batch: hang, execute: hang }, enabled: true, sheets: sheets.api, timeoutMs: 50, budgetMs: 200, breakerMs: 60000 })
  const t0 = Date.now()
  const r1 = await mirrorRows(TAB, [sheetRow()])
  assert.equal(r1.ok, false); assert.ok(Date.now() - t0 < 1000, 'ต้องไม่รอเกินงบเวลา')
  const t1 = Date.now()
  const r2 = await mirrorRows(TAB, [sheetRow({ order_key: 'Shopee:A9:L1' })])
  assert.equal(r2.error, 'breaker open'); assert.ok(Date.now() - t1 < 100, 'เบรกเกอร์เปิดต้องข้ามทันที')
  const r3 = await mirrorDeleteLot('IMP1', 1, [TAB])
  assert.equal(r3.error, 'breaker open')
  assert.deepEqual(await listDirtyTabs(), [TAB])
})

test('งบเวลารวมหมดกลางทาง (หลาย chunk): หยุด ติดธง ไม่วนรอทุก chunk', async () => {
  const sheets = fakeSheets({})
  let writes = 0
  const slow = { execute: async () => ({ rows: [[0]] }), batch: async () => { writes++; await new Promise((r) => setTimeout(r, 120)); return [] } }
  __setDepsForTests({ client: slow, enabled: true, sheets: sheets.api, timeoutMs: 5000, budgetMs: 250 })
  const rows = Array.from({ length: 1000 }, (_, i) => sheetRow({ order_key: `Shopee:X${i}:L1`, order_id: `'X${i}` })) // 5 chunk
  const r = await mirrorRows(TAB, rows)
  assert.equal(r.ok, false); assert.match(r.error, /budget|timeout/) // ขึ้นกับว่างบหมดระหว่างรอ chunk หรือกลาง chunk
  assert.ok(writes < 5, `ต้องหยุดก่อนครบ chunk (เขียนไป ${writes})`)
  assert.deepEqual(await listDirtyTabs(), [TAB])
})

test('คำสั่งเดียวค้างกลางทาง: รอไม่เกินงบเวลารวม (ไม่ใช่ timeout เต็มของคำสั่ง)', async () => {
  const sheets = fakeSheets({})
  const hangWrite = { execute: async () => ({ rows: [[0]] }), batch: (stmts) => (stmts.length > 5 ? new Promise(() => {}) : Promise.resolve([])) }
  __setDepsForTests({ client: hangWrite, enabled: true, sheets: sheets.api, timeoutMs: 10000, budgetMs: 150 })
  const rows = Array.from({ length: 50 }, (_, i) => sheetRow({ order_key: `Shopee:H${i}:L1`, order_id: `'H${i}` }))
  const t0 = Date.now()
  const r = await mirrorRows(TAB, rows)
  assert.equal(r.ok, false)
  assert.ok(Date.now() - t0 < 1500, `รอ ${Date.now() - t0}ms เกินงบ (ควร ~150ms ไม่ใช่ 10s+)`)
})

test('reconcile ค่าเริ่มต้น: เดือนเก่าถูกหมุนตรวจวันละ 1 เดือน ครบทุกเดือนภายในไม่กี่วัน', async () => {
  const mk = (k) => [sheetRow({ order_key: `Shopee:${k}:L1`, date: `2026-${k}-01` })]
  const tabs = { raw_orders_2026_01: mk('01'), raw_orders_2026_02: mk('02'), raw_orders_2026_03: mk('03'), raw_orders_2026_04: mk('04'), raw_orders_2026_05: mk('05') }
  const seen = new Set()
  for (let day = 0; day < 6; day++) {
    const sheets = fakeSheets(tabs)
    const client = createClient({ url: ':memory:' })
    const now = new Date(Date.UTC(2026, 4, 10 + day, 5)).toISOString() // 10–15 พ.ค.
    __setDepsForTests({ client, enabled: true, sheets: sheets.api, now: () => now })
    const out = await reconcile({ repair: false })
    const names = out.report.map((r) => r.tab)
    assert.ok(names.includes('raw_orders_2026_04') && names.includes('raw_orders_2026_05'), '2 เดือนล่าสุดต้องอยู่เสมอ')
    assert.equal(names.length, 3)
    for (const n of names) seen.add(n)
  }
  assert.equal(seen.size, 5, 'ทุกเดือนต้องถูกตรวจอย่างน้อยหนึ่งรอบ')
})
