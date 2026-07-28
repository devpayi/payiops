import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateUnitLift, recommendMarketingAction } from '../shared/marketingRadar.js'

test('compares units per day rather than raw totals', () => {
  assert.deepEqual(calculateUnitLift(70, 7, 360, 30), {
    beforeDaily: 10,
    afterDaily: 12,
    lift: 20,
  })
})

test('uses agreed thresholds for scale, iterate, and stop', () => {
  const before = { units: 70, days: 7, activeDays: 7 }
  assert.equal(recommendMarketingAction({ before, after: { units: 81, days: 7 }, complete: true }).code, 'scale')
  assert.equal(recommendMarketingAction({ before, after: { units: 77, days: 7 }, complete: true }).code, 'iterate')
  assert.equal(recommendMarketingAction({ before, after: { units: 63, days: 7 }, complete: true }).code, 'stop')
})

test('still recommends when changes overlap but requires a boss recheck', () => {
  const result = recommendMarketingAction({
    before: { units: 70, days: 7, activeDays: 7 },
    after: { units: 84, days: 7 },
    complete: true,
    overlap: true,
  })
  assert.equal(result.code, 'scale')
  assert.equal(result.confidence, 'low')
  assert.match(result.reason, /Boss ต้องรีเช็ก/)
})

test('waits until the review window is complete', () => {
  const result = recommendMarketingAction({
    before: { units: 70, days: 7, activeDays: 7 },
    after: { units: 30, days: 3 },
    reviewDay: 7,
    complete: false,
  })
  assert.equal(result.code, 'wait')
})
