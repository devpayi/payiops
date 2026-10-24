import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

// ไม่มี network: Sheets จำลอง + Turso จำลอง แต่รัน handler/import pipeline ตัวจริง
let events, tabs
let advanceSource = () => {}
const logHeaders = ['import_id', 'filename', 'business', 'platform', 'rows_imported', 'mapped', 'unmapped', 'uploaded_at', 'target_sheet', 'status']
const sheets = {
  getSheet: async () => [],
  ensureSheet: async (tab, headers) => { tabs[tab] ??= [headers] },
  appendRows: async (tab, rows) => { events.push(`append:${tab}`); (tabs[tab] ??= []).push(...rows) },
  batchGetValues: async (ranges) => ranges.map((range) => ({ values: tabs[range.split('!')[0]] || [] })),
  batchUpdateValues: async () => {},
  overwriteSheet: async (tab, headers, rows) => { events.push(`overwrite:${tab}`); tabs[tab] = [headers, ...rows]; advanceSource(tab) },
  getMeta: async () => ({ sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) }),
}
mock.module('../../api/_lib/sheets.js', { namedExports: sheets })
mock.module('../../api/_lib/auth.js', { namedExports: { requireDev: () => true } })
const { __setDepsForTests } = await import('../../api/_lib/ordersMirror.js')
const { default: handler } = await import('../../api/import-orders.js')
const { ingestOrders } = await import('../../api/_lib/ingestOrders.js')

function setup(client) {
  events = []; tabs = { import_log: [logHeaders] }
  advanceSource = () => {}
  __setDepsForTests({ enabled: true, sheets, client: client || {
    batch: async () => { events.push('turso'); throw new Error('simulated Turso outage') },
  } })
}
const rows = [
  { order_id: 'TEST1', date: '2026-09-01', qty: 2, revenue: 100, product_name: 'test' },
  { order_id: 'TEST2', date: '2026-08-01', qty: 1, revenue: 50, product_name: 'test' },
]
function response() {
  return { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
}
function logBeforeTurso(event) {
  assert.ok(events.indexOf(event) >= 0)
  assert.ok(events.indexOf(event) < events.indexOf('turso'), JSON.stringify(events))
}

test('POST หลายเดือน: Sheets และ log สำเร็จก่อน Turso ล้ม; response ยังสำเร็จ', async () => {
  setup()
  const res = response()
  await handler({ method: 'POST', query: {}, body: { platform: 'Shopee', business: 'Payi', fileName: 'fixture.csv', rows } }, res)
  assert.equal(res.code, 200)
  assert.equal(res.body.imported, 2)
  logBeforeTurso('append:import_log')
  assert.equal(tabs.import_log.length, 2)
  assert.equal(tabs.raw_orders_2026_09.length, 2)
  assert.equal(tabs.raw_orders_2026_08.length, 2)
  assert.ok(events.indexOf('append:turso_dirty') < events.indexOf('append:raw_orders_2026_09'))
  assert.deepEqual(tabs.turso_dirty.slice(1).map((r) => r[0]).sort(), ['raw_orders_2026_08', 'raw_orders_2026_09'])
})

test('POST: Turso ไม่ตอบเลย log ยังถูกบันทึกก่อน timeout และ response สำเร็จ', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  setup({ batch: () => { events.push('turso'); return new Promise(() => {}) } })
  const res = response()
  const pending = handler({ method: 'POST', query: {}, body: { platform: 'Shopee', business: 'Payi', fileName: 'fixture.csv', rows } }, res)
  for (let i = 0; i < 100; i++) await Promise.resolve()
  logBeforeTurso('append:import_log')
  assert.equal(res.code, undefined)
  t.mock.timers.tick(8000)
  for (let i = 0; i < 100; i++) await Promise.resolve()
  await pending
  assert.equal(res.code, 200); assert.equal(res.body.imported, 2)
  assert.equal(tabs.import_log.length, 2)
  assert.equal(tabs.turso_dirty.length, 3)
})

test('DELETE: log เป็น deleted ก่อนรอ Turso และคงแถวล็อตอื่น', async () => {
  setup()
  tabs.import_log.push(['IMP1', 'fixture.csv', '', '', 1, 0, 1, '', 'raw_orders_2026_09', 'active'])
  tabs.raw_orders_2026_09 = [['order_key', 'import_id'], ['remove', 'IMP1'], ['keep', 'IMP2']]
  const res = response()
  await handler({ method: 'DELETE', query: { importId: 'IMP1' } }, res)
  assert.equal(res.code, 200); assert.equal(res.body.deleted, 1)
  logBeforeTurso('overwrite:import_log')
  assert.ok(events.indexOf('append:turso_dirty') < events.indexOf('overwrite:raw_orders_2026_09'))
  assert.equal(tabs.import_log[1][9], 'deleted')
  assert.deepEqual(tabs.raw_orders_2026_09[1], ['keep', 'IMP2'])
})

test('TikTok ingest: หลายเดือนบันทึก log ก่อน Turso ล้ม', async () => {
  setup()
  const result = await ingestOrders(rows, { platform: 'TikTok Shop', businessDefault: 'Payi', importId: 'IMP-TT' })
  assert.equal(result.imported, 2)
  logBeforeTurso('append:import_log')
  assert.ok(events.indexOf('append:turso_dirty') < events.indexOf('append:raw_orders_2026_09'))
  assert.equal(tabs.import_log[1][0], 'IMP-TT')
  assert.equal(events.filter((event) => event === 'turso').length, 1)
})

test('DELETE ที่ Sheets ใช้เกิน 60s: มีธงก่อนลบและ log ครบ แม้ไม่มีเวลารอ Turso', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  setup()
  tabs.import_log.push(['IMP1', 'fixture.csv', '', '', 1, 0, 1, '', 'raw_orders_2026_09', 'active'])
  tabs.raw_orders_2026_09 = [['order_key', 'import_id'], ['remove', 'IMP1'], ['keep', 'IMP2']]
  advanceSource = (tab) => { if (tab.startsWith('raw_orders_')) t.mock.timers.tick(61000) }
  const res = response()
  await handler({ method: 'DELETE', query: { importId: 'IMP1' } }, res)
  assert.equal(res.code, 200)
  assert.equal(tabs.import_log[1][9], 'deleted')
  assert.equal(tabs.turso_dirty[1][1], 'dirty')
  assert.ok(events.indexOf('append:turso_dirty') < events.indexOf('overwrite:raw_orders_2026_09'))
  assert.equal(events.includes('turso'), false)
})
