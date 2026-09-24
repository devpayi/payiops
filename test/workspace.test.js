import test from 'node:test'
import assert from 'node:assert/strict'
import { profileFor, BOARD, PEOPLE, DEPARTMENTS } from '../api/_lib/workspace.js'

test('department heads and CEO see company totals, members do not', () => {
  for (const key of ['boss', 'dev', 'toon', 'tang', 'lady', 'taew', 'ked']) assert.equal(profileFor(key).canSeeCompany, true, key)
  for (const key of ['fah', 'maprang']) assert.equal(profileFor(key).canSeeCompany, false, key)
})

test('shortcuts only list pages the person can actually open', () => {
  assert.deepEqual(profileFor('fah').links, ['Inventory', 'Stock Movement'])
  assert.equal(profileFor('toon').links.includes('CFO'), false)
  assert.deepEqual(profileFor('ked').links, []) // no Ops account yet
})

test('every board item has an owner and a known department', () => {
  const people = new Set(PEOPLE.map((p) => p.key))
  const depts = new Set(DEPARTMENTS.map((d) => d.id))
  assert.equal(BOARD.length, 19)
  for (const b of BOARD) {
    assert.ok(depts.has(b.dept), `#${b.no} dept`)
    for (const o of b.owners) assert.ok(people.has(o) || /^รอ \d$/.test(o), `#${b.no} owner ${o}`)
  }
})

test('toon holds the five marketing board items', () => {
  assert.deepEqual(profileFor('toon').board.map((b) => b.no), [2, 3, 4, 9, 15])
})

test('OKR splits the company target by real sales share and scores progress', async () => {
  const { buildOkr } = await import('../api/_lib/workspace.js')
  const m = (month, s, t) => ({ month, revenue: s + t, platform: { Shopee: s, 'TikTok Shop': t }, business: { Payi: s + t } })
  const okr = buildOkr([m('2026-01', 70, 30), m('2026-02', 70, 30), m('2026-03', 70, 30)], 2400)
  assert.equal(okr.platforms[0].name, 'Shopee')
  assert.equal(okr.platforms[0].target, 1680) // 70% of 2400
  assert.equal(okr.objective.status, 'off') // run-rate 1200/yr vs 2400 target = 50%
  assert.equal(okr.platforms.reduce((s, k) => s + k.target, 0), 2400)
})

test('check-in visibility: CEO all, head own dept, member own items only', async () => {
  const { visibleBoard, canCheckin } = await import('../api/_lib/workspace.js')
  assert.equal(visibleBoard('boss').length, 19)
  assert.deepEqual(visibleBoard('tang').map((b) => b.no), [14, 18])
  assert.deepEqual(visibleBoard('maprang').map((b) => b.no), [13])
  assert.equal(visibleBoard('fah').length, 0)
  assert.equal(canCheckin('toon', 2), true)
  assert.equal(canCheckin('toon', 1), false) // เกด's item
})

test('tracker flags stuck, stale and waiting items', async () => {
  const { summarize, BOARD } = await import('../api/_lib/workspace.js')
  const now = Date.parse('2026-10-01T00:00:00Z')
  const rows = [
    { id: 'a', board_no: '2', status: 'on', created_at: '2026-09-29T00:00:00Z' },
    { id: 'b', board_no: '3', status: 'stuck', blocker: 'x', created_at: '2026-09-20T00:00:00Z' },
    { id: 'c', board_no: '2', status: 'stuck', created_at: '2026-09-01T00:00:00Z' },
  ]
  const t = Object.fromEntries(summarize(BOARD, rows, now).map((x) => [x.no, x]))
  assert.equal(t[2].last.id, 'a') // newest wins
  assert.equal(t[2].stale, false)
  assert.equal(t[3].stale, true) // 11 days
  assert.equal(t[4].stale, true) // never updated
  assert.equal(t[6].waiting, true) // รอ 1
  assert.equal(t[6].stale, false)
})

test('narrative flags when the biggest mover contradicts the total trend', async () => {
  const { buildNarrative } = await import('../api/_lib/workspace.js')
  const s = buildNarrative(-0.02, { name: 'Shopee', delta: 395940 })
  assert.match(s, /ลดลง 2%/)
  assert.match(s, /Shopee เพิ่ม/)
  assert.match(s, /อื่นรวมกันลดมากกว่า/)
})

test('narrative reads plainly when the biggest mover agrees with the total trend', async () => {
  const { buildNarrative } = await import('../api/_lib/workspace.js')
  const s = buildNarrative(0.1, { name: 'TikTok Shop', delta: 50000 })
  assert.match(s, /เพิ่มขึ้น 10%/)
  assert.match(s, /มีผลมากที่สุด/)
})

test('computeBriefing caps the comparison to the shorter month and says so', async () => {
  const { computeBriefing } = await import('../api/_lib/workspace.js')
  const row = (date, platform, name, revenue, status = 'สำเร็จ') => ({ date, platform, name, revenue, status })
  const thisRows = [
    row('2026-08-01', 'Shopee', 'A', 100), row('2026-08-15', 'Shopee', 'A', 100), row('2026-08-31', 'Shopee', 'A', 50),
    row('2026-08-31', 'Shopee', 'B', 999, 'ยกเลิก'),
  ]
  const prevRows = [row('2026-02-01', 'Shopee', 'A', 40), row('2026-02-15', 'Shopee', 'A', 40), row('2026-03-01', 'Shopee', 'A', 999)]
  const b = computeBriefing({ thisTab: 'raw_orders_2026_08', thisRows, prevTab: 'raw_orders_2026_02', prevRows, lowStock: null, archivedMonths: [] })
  assert.equal(b.asOfDate, '2026-08-31')
  assert.equal(b.comparableDays, 28) // ก.พ. มี 28 วัน แม้วันล่าสุดของ ส.ค. คือวันที่ 31
  assert.equal(b.dayCapped, true)
  assert.equal(b.mtd.windowRevenue, 200) // เฉพาะ 1-28 ส.ค. (ไม่รวมวันที่ 31 ที่เกินขอบเขตเทียบ, ไม่รวมแถวยกเลิก)
  assert.equal(b.mtd.prevRevenue, 80) // เฉพาะ 1-28 ก.พ.
  assert.equal(b.mtd.revenue, 250) // ยอดสะสมจริงทั้งเดือนถึงวันล่าสุด (200 + 50 วันที่ 31)
  assert.equal(b.lowStock.status, 'unknown')
})

test('computeBriefing works with no previous month at all', async () => {
  const { computeBriefing } = await import('../api/_lib/workspace.js')
  const thisRows = [{ date: '2026-01-05', platform: 'Shopee', name: 'A', revenue: 100, status: 'สำเร็จ' }]
  const b = computeBriefing({ thisTab: 'raw_orders_2026_01', thisRows, prevTab: null, prevRows: [], lowStock: { asOfDate: '2026-01-05', items: [] }, archivedMonths: [] })
  assert.equal(b.mtd.deltaPct, null)
  assert.equal(b.narrative, '')
  assert.equal(b.lowStock.status, 'ok')
})
