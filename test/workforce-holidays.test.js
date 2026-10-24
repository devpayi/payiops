import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { applyScheduleOverrides, LEGACY_OVERRIDE_EXEMPT_CODES } from '../api/_lib/scheduleOverrides.js'

// Exercise the actual calendar pipeline without connecting to or writing Sheets.
const source = readFileSync(new URL('../api/sheet-tools.js', import.meta.url), 'utf8')
const calendarSource = source.slice(source.indexOf("const HOLIDAY_RULE_SINCE ="), source.indexOf('\nconst minutesBetween ='))
const date = '2026-10-23'
const personMap = { TANG: ['แตง', 'คนแพ็ก'], MOM: ['แม่', 'คนฟีด'], TOON: ['ตูน', 'ออฟฟิศ'] }

async function presence({ overrides = [], leaves = [], swapBack = {}, holidays = [{ date }] } = {}) {
  const tables = {
    workforce_schedule_snapshot: Object.entries(personMap).map(([code, [employee, group]]) => ({ date, code, employee, group, fraction: 1 })),
    workforce_schedule_overrides: overrides,
    hr_leave: leaves,
  }
  const context = vm.createContext({
    getSheet: async (name) => tables[name],
    getDayOffMap: async () => ({}),
    getHolidayRows: async () => holidays,
    buildSwapBackDates: () => swapBack,
    isFixedDayOff: () => false,
    generateCalendarPresence: () => [],
    applyScheduleOverrides, LEGACY_OVERRIDE_EXEMPT_CODES,
    buildLeaveAbsenceMap: () => ({}),
    absenceFraction: (_, code, day) => leaves.some((leave) => leave.code === code && leave.date === day) ? 1 : 0,
  })
  vm.runInContext(calendarSource, context)
  return context.getCalendarPresence(personMap, ['TANG', 'MOM'], true, ['TOON'])
}

const override = (updated_at, codes = Object.keys(personMap)) => ({ date, updated_at, entries_json: JSON.stringify(codes.map((code) => ({ code }))) })

test('holiday roster keeps explicitly selected packers, feed and office staff as Payi Floor does', async () => {
  const rows = await presence({ overrides: [override('2026-10-22T12:00:00Z')] })
  assert.deepEqual(Array.from(rows, (row) => row.code).sort(), ['MOM', 'TANG', 'TOON'])
  assert.ok(rows.every((row) => row.source === 'override'))
})

test('holidays exclude default schedules, old overrides and automatic swap backs', async () => {
  for (const overrides of [[], [override('2026-09-30T23:59:59Z')], [override('')]]) {
    assert.equal((await presence({ overrides, swapBack: { TANG: [date] } })).length, 0)
  }
})

test('holiday rule accepts overrides starting October 1 and respects later removals', async () => {
  assert.equal((await presence({ overrides: [override('2026-10-01')] })).length, 3)
  assert.equal((await presence({ overrides: [override('2026-10-01'), override('2026-10-22', [])] })).length, 0)
})

test('approved absences still remove staff selected on a holiday', async () => {
  const rows = await presence({ overrides: [override('2026-10-22')], leaves: [{ code: 'TANG', date }] })
  assert.deepEqual(Array.from(rows, (row) => row.code).sort(), ['MOM', 'TOON'])
})

test('ordinary days keep overrides saved before the holiday rule', async () => {
  const rows = await presence({ overrides: [override('2026-09-01', ['MOM'])], holidays: [] })
  assert.deepEqual(Array.from(rows, (row) => row.code).sort(), ['MOM', 'TOON'])
})
