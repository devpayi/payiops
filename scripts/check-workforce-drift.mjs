// Read-only source comparison. Does not import application code or connect to Sheets.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const defaultOps = fileURLToPath(new URL('../', import.meta.url))
const ignoredMetadata = new Set(['start', 'end', 'loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'])

export const workforceDeclarations = [
  'OT_HEADERS', 'MANPOWER_HEADERS', 'EVENT_HEADERS', 'OT_HISTORY_HEADERS',
  'OT_APPROVAL_HEADERS', 'PEOPLE_HEADERS', 'OT_LIMIT_HEADERS', 'OT_APPROVAL_HISTORY_HEADERS',
  'SCHEDULE_SNAPSHOT_HEADERS', 'SCHEDULE_OVERRIDE_HEADERS', 'DAYRECORD_HEADERS', 'HOLIDAY_HEADERS',
  'WORKFORCE_SHEETS', 'DEFAULT_HOLIDAY_ROWS', 'DEFAULT_PEOPLE_ROWS', 'DEFAULT_OFFICE_ROWS',
  'rowsToObjects', 'latestByKey', 'getPersonMap', 'getDayOffMap', 'getHolidayRows',
  'getHolidaysWithConflicts', 'getOfficePeopleMap', 'buildLeaveAbsenceMap', 'absenceFraction',
  'buildSwapBackDates', 'isFixedDayOff', 'todayStr', 'generateCalendarPresence',
  'HOLIDAY_RULE_SINCE', 'getCalendarPresence', 'minutesBetween', 'validTime', 'clockMinutes', 'overlaps',
]

// Floor-only transport, cache lifecycle and read-only HR entry point. These are
// intentionally outside the copied calculation rules; never ignore differences by hash.
const floorOnly = new Set([
  'workforceEnsurePromise', 'ensureWorkforceSheets', 'workforceCache',
  'setWorkforceCache', 'clearWorkforceCache', 'getLeaveReadOnly',
])

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).filter((key) => !ignoredMetadata.has(key)).sort().map((key) => [key, canonical(value[key])]))
}

export function declarations(source, filename = 'source.js') {
  const ast = parse(source, { sourceType: 'module', sourceFilename: filename })
  const entries = new Map()
  const otherStatements = []
  for (let node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration) node = node.declaration
    if (node.type === 'FunctionDeclaration') entries.set(node.id.name, node)
    else if (node.type === 'VariableDeclaration') {
      for (const entry of node.declarations) {
        if (entry.id.type !== 'Identifier') throw new Error(`${filename}: unsupported top-level destructuring; update drift checker explicitly`)
        entries.set(entry.id.name, { type: 'VariableDeclaration', kind: node.kind, declarations: [entry] })
      }
    } else otherStatements.push(node)
  }
  return { entries, otherStatements }
}

export function compareSources(opsSource, floorSource, { selected, ignored = [], opsOnly = [] } = {}) {
  const ops = declarations(opsSource)
  const floor = declarations(floorSource)
  const names = selected || [...new Set([...ops.entries.keys(), ...floor.entries.keys()])].filter((name) => !opsOnly.includes(name) || floor.entries.has(name)).sort()
  const differences = []
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
  for (const name of names) {
    const a = ops.entries.get(name)
    const b = floor.entries.get(name)
    if (!a || !b) differences.push({ name, reason: !a ? 'missing in Ops' : 'missing in Floor' })
    else if (!same(a, b)) differences.push({ name, reason: 'calculation/source differs', opsLine: a.loc?.start.line || a.declarations?.[0]?.loc?.start.line, floorLine: b.loc?.start.line || b.declarations?.[0]?.loc?.start.line })
  }
  // New Floor business declarations must be reviewed, not silently left untracked.
  if (selected) for (const name of floor.entries.keys()) {
    if (!selected.includes(name) && !ignored.includes(name)) differences.push({ name, reason: 'untracked Floor declaration; review and add to manifest' })
  }
  // For the pure helper files also cover imports, re-exports and executable code.
  // Workforce imports intentionally differ because Ops helpers live in sheet-tools.
  if (!selected && !same(ops.otherStatements, floor.otherStatements)) differences.push({ name: '(module)', reason: 'imports/exports or top-level statements differ' })
  return { checked: names.length, differences }
}

export async function checkWorkforceDrift({ opsRoot = defaultOps, floorRoot = path.resolve(opsRoot, '../payi-floor') } = {}) {
  const pairs = [
    { ops: 'api/sheet-tools.js', floor: 'api/_lib/workforce.js', selected: workforceDeclarations, ignored: [...floorOnly] },
    { ops: 'api/_lib/scheduleOverrides.js', floor: 'api/_lib/scheduleOverrides.js' },
    // These three HR replacement-planning helpers deliberately exist only in Ops.
    // If Floor starts carrying them too, compare them rather than excluding them.
    { ops: 'api/_lib/leaveCoverage.js', floor: 'api/_lib/leaveCoverage.js', opsOnly: ['addToSetMap', 'buildCoveragePlan', 'validateBackupSelections'] },
  ]
  const results = []
  for (const pair of pairs) {
    const opsPath = path.resolve(opsRoot, pair.ops)
    const floorPath = path.resolve(floorRoot, pair.floor)
    const [opsSource, floorSource] = await Promise.all([readFile(opsPath, 'utf8'), readFile(floorPath, 'utf8')])
    results.push({ opsPath, floorPath, ...compareSources(opsSource, floorSource, pair) })
  }
  return results
}

async function main() {
  const options = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Usage: npm run check:workforce-drift -- [--floor PATH] [--ops PATH]\nExit 0: match; 1: drift; 2: cannot check. No Sheets access or code execution.')
      return
    }
    const option = { '--floor': 'floorRoot', '--ops': 'opsRoot' }[args[i]]
    if (!option || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${args[i]}. Use --help.`)
    options[option] = path.resolve(args[++i])
  }
  const results = await checkWorkforceDrift(options)
  let count = 0
  for (const result of results) {
    console.log(`${result.differences.length ? 'DRIFT' : 'OK'} ${path.basename(result.floorPath)} (${result.checked} declarations)`)
    for (const diff of result.differences) {
      count++
      console.error(`  ${diff.name}: ${diff.reason}\n    Ops: ${result.opsPath}${diff.opsLine ? `:${diff.opsLine}` : ''}\n    Floor: ${result.floorPath}${diff.floorLine ? `:${diff.floorLine}` : ''}`)
    }
  }
  console.log(count ? `FAIL: ${count} differences. Review intended changes and copy calculation fixes before release.` : 'PASS: copied workforce rules match. Role, theme and API handlers are outside this check.')
  process.exitCode = count ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Cannot check workforce drift: ${error.message}\nProvide both checkouts with --floor PATH. Missing sources never count as a pass.`)
    process.exitCode = 2
  })
}
