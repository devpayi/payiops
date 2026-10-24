import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { applyScheduleOverrides, LEGACY_OVERRIDE_EXEMPT_CODES } from '../api/_lib/scheduleOverrides.js'
import { leaveAbsenceSlots } from '../api/_lib/leaveCoverage.js'

const source = readFileSync(new URL('../api/sheet-tools.js', import.meta.url), 'utf8')
// Include the real leave, weekly-off, swap and fallback helpers, mocking only I/O.
const calendarSource = source.slice(source.indexOf('function buildLeaveAbsenceMap('), source.indexOf('\nconst minutesBetween ='))
const people = { TANG: ['แตง', 'คนแพ็ก'], MOM: ['แม่', 'คนฟีด'], TOON: ['ตูน', 'ออฟฟิศ'] }
const snapshot = (date) => Object.entries(people).map(([code, [employee, group]]) => ({ date, code, employee, group, fraction: 1 }))
const leave = (extra = {}) => ({ username: 'mp:TANG', status: 'approved', leave_type: 'ลากิจ', start_date: '2026-10-20', end_date: '2026-10-20', ...extra })
const override = (date, codes) => ({ date, updated_at: '2026-10-19', entries_json: JSON.stringify(codes.map((code) => ({ code }))) })

async function presence({ dates = ['2026-10-20'], overrides = [], leaves = [], dayOff = {}, holidays = [], personMap = people } = {}) {
  const tables = { workforce_schedule_snapshot: dates.flatMap(snapshot), workforce_schedule_overrides: overrides, hr_leave: leaves }
  const context = vm.createContext({
    getSheet: async (name) => tables[name],
    getDayOffMap: async () => dayOff,
    getHolidayRows: async () => holidays,
    todayStr: () => '2026-10-24',
    applyScheduleOverrides, LEGACY_OVERRIDE_EXEMPT_CODES, leaveAbsenceSlots,
  })
  vm.runInContext(calendarSource, context)
  return context.getCalendarPresence(personMap, Object.keys(personMap).filter((code) => code !== 'TOON'), true, ['TOON'])
}

test('ordinary dates keep all three staff groups across the full year', async () => {
  const dates = Array.from({ length: 365 }, (_, index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10))
  const rows = await presence({ dates })
  assert.equal(rows.length, 365 * 3)
  for (const date of dates) assert.equal(rows.filter((row) => row.date === date).length, 3, date)
})

test('weekly day off starts on its effective date and a new override can call staff in', async () => {
  const options = { dates: ['2026-10-13', '2026-10-20', '2026-10-27'], dayOff: { TANG: { weekday: '2', from: '2026-10-20' } } }
  const rows = await presence(options)
  assert.ok(rows.some((row) => row.code === 'TANG' && row.date === '2026-10-13'))
  assert.ok(!rows.some((row) => row.code === 'TANG' && row.date === '2026-10-20'))
  const calledIn = await presence({ ...options, overrides: [override('2026-10-20', ['TANG'])] })
  assert.ok(calledIn.some((row) => row.code === 'TANG' && row.date === '2026-10-20'))
})

test('only approved full-day leave removes staff, including after a manual override', async () => {
  for (const status of ['pending', 'rejected', 'cancelled', 'approved']) {
    const rows = await presence({ leaves: [leave({ status })], overrides: [override('2026-10-20', ['TANG', 'MOM'])] })
    assert.equal(rows.some((row) => row.code === 'TANG'), status !== 'approved', status)
  }
})

test('half-day leave counts 0.5 and duplicate leave slots are not subtracted twice', async () => {
  const am = leave({ leave_period: 'am', days: 0.5 })
  const rows = await presence({ leaves: [am, am] })
  assert.equal(rows.find((row) => row.code === 'TANG').fraction, 0.5)
  const full = await presence({ leaves: [am, leave({ leave_period: 'pm', days: 0.5 })] })
  assert.ok(!full.some((row) => row.code === 'TANG'))
})

test('approved swap restores the original day off despite an override and removes the new day off', async () => {
  const rows = await presence({
    dates: ['2026-10-20', '2026-10-21'],
    dayOff: { TANG: { weekday: '2', from: '' } },
    leaves: [leave({ leave_type: 'สลับวันหยุด', end_date: '2026-10-21' })],
    overrides: [override('2026-10-20', ['MOM']), override('2026-10-21', ['TANG', 'MOM'])],
  })
  assert.ok(rows.some((row) => row.code === 'TANG' && row.date === '2026-10-20'))
  assert.ok(!rows.some((row) => row.code === 'TANG' && row.date === '2026-10-21'))
})

test('office leave applies without lower-house overrides removing other office staff', async () => {
  const rows = await presence({ overrides: [override('2026-10-20', ['MOM'])], leaves: [leave({ username: 'mp:TOON', leave_period: 'pm', days: 0.5 })] })
  assert.equal(rows.find((row) => row.code === 'TOON').fraction, 0.5)
  assert.ok(!rows.some((row) => row.code === 'TANG'))
})

test('new staff missing from the yearly snapshot receive a schedule with weekly days off', async () => {
  const rows = await presence({ personMap: { ...people, NEW: ['ใหม่', 'คนแพ็ก'] }, dayOff: { NEW: { weekday: '2', from: '' } } })
  assert.ok(rows.some((row) => row.code === 'NEW' && row.date === '2026-10-21'))
  assert.ok(!rows.some((row) => row.code === 'NEW' && row.date === '2026-10-20'))
})
