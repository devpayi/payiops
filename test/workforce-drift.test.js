import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareSources, checkWorkforceDrift, workforceDeclarations } from '../scripts/check-workforce-drift.mjs'

test('ignores comments, layout, quote style and function export wrappers', () => {
  const result = compareSources("const label = 'OT'; function f(x) { return x + 1 }", '// Floor copy\nconst label = "OT"\nexport function f(x) { /* note */ return x+1; }')
  assert.deepEqual(result.differences, [])
})

test('detects changed business values and changed operators', () => {
  const result = compareSources("const since = '2026-10-01'; function f(x) { return x > 2 }", "const since = '2026-09-01'; function f(x) { return x >= 2 }")
  assert.deepEqual(result.differences.map((diff) => diff.name), ['f', 'since'])
})

test('reports missing and newly added helper declarations', () => {
  const result = compareSources('function oldRule() {}', 'function newRule() {}')
  assert.equal(result.differences.length, 2)
})

test('compares imports and executable module statements in pure helper files', () => {
  assert.equal(compareSources("import { rule } from './a.js'; const n = 1", "import { rule } from './b.js'; const n = 1").differences[0].name, '(module)')
})

test('explicitly excludes Ops-only HR helpers but compares them if copied into Floor', () => {
  const options = { opsOnly: ['buildCoveragePlan'] }
  assert.equal(compareSources('function buildCoveragePlan() { return 1 }', '', options).differences.length, 0)
  assert.equal(compareSources('function buildCoveragePlan() { return 1 }', 'function buildCoveragePlan() { return 2 }', options).differences.length, 1)
})

test('workforce manifest excludes role handlers and catches new Floor rules', () => {
  const options = { selected: ['getCalendarPresence'] }
  const ops = 'function getCalendarPresence() {} function requireBoss() {}'
  assert.equal(compareSources(ops, 'export function getCalendarPresence() {}', options).differences.length, 0)
  const drift = compareSources(ops, 'function getCalendarPresence() {} const NEW_RULE = 1', options)
  assert.match(drift.differences[0].reason, /untracked/)
})

test('syntax errors fail instead of passing partially parsed source', () => {
  assert.throws(() => compareSources('const n = 1', 'function broken('), SyntaxError)
})

test('three-file check and CLI detect the original holiday-order regression', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workforce-drift-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const opsRoot = path.join(root, 'ops')
  const floorRoot = path.join(root, 'floor')
  await Promise.all([opsRoot, floorRoot].map((dir) => mkdir(path.join(dir, 'api', '_lib'), { recursive: true })))
  const calendar = 'async function getCalendarPresence() { baseRows = baseRows.filter(r => !holidays.has(r.date)); baseRows = applyScheduleOverrides(baseRows); return baseRows }'
  const workforce = workforceDeclarations.filter((name) => name !== 'getCalendarPresence').map((name) => `const ${name} = 1`).join('\n') + '\n' + calendar
  await Promise.all([
    writeFile(path.join(opsRoot, 'api/sheet-tools.js'), workforce),
    writeFile(path.join(floorRoot, 'api/_lib/workforce.js'), workforce),
    ...[opsRoot, floorRoot].flatMap((dir) => ['scheduleOverrides', 'leaveCoverage'].map((name) => writeFile(path.join(dir, `api/_lib/${name}.js`), 'export function sharedRule() { return 1 }'))),
  ])
  assert.ok((await checkWorkforceDrift({ opsRoot, floorRoot })).every((result) => !result.differences.length))
  const script = fileURLToPath(new URL('../scripts/check-workforce-drift.mjs', import.meta.url))
  const run = () => spawnSync(process.execPath, [script, '--ops', opsRoot, '--floor', floorRoot], { encoding: 'utf8' })
  assert.equal(run().status, 0)

  const oldOrder = 'async function getCalendarPresence() { baseRows = applyScheduleOverrides(baseRows); baseRows = baseRows.filter(r => !holidays.has(r.date)); return baseRows }'
  await writeFile(path.join(floorRoot, 'api/_lib/workforce.js'), workforce.replace(calendar, oldOrder))
  const changed = run()
  assert.equal(changed.status, 1)
  assert.match(changed.stderr, /getCalendarPresence/)
  assert.match(changed.stderr, /Ops:.*sheet-tools.js/)

  await writeFile(path.join(floorRoot, 'api/_lib/workforce.js'), 'function broken(')
  assert.equal(run().status, 2)
  await rm(path.join(floorRoot, 'api/_lib/workforce.js'))
  const missing = run()
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /Missing sources never count as a pass/)
})
