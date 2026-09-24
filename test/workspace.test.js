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
