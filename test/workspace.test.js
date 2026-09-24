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
