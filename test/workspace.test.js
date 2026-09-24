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
