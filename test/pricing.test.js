import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePricing, monthlyProfit, newPricingDraft, normalizePricingDraft, solvePricingTarget } from '../shared/pricing.js'
import { canAccessTab } from '../shared/roles.js'
import { applyPricingPreset, PRICING_CATEGORIES, PRICING_PAYMENTS } from '../shared/pricingPresets.js'

test('screenshot fixture: shipping income and expense both included, fees rounded separately', () => {
  const r = calculatePricing(newPricingDraft())
  assert.equal(r.valid, true)
  assert.equal(r.fees, 10394)
  assert.equal(r.profit, 18106)
  assert.equal(r.rows.find(r => r.key === 'transaction').amount, 1727)
  assert.equal(r.rows.find(r => r.key === 'shipping').amount, 3800)
})

test('bundle costs sum component quantities, one parcel/platform fee per order', () => {
  const d = { ...newPricingDraft(), kind: 'bundle', components: [{ name: 'A', sku: 'A', qty: 2, cost: 100 },{ name: 'B', sku: 'B', qty: 1, cost: 50 }], unitsPerOrder: 3, parcel: 10 }
  const r = calculatePricing(d)
  assert.equal(r.unitCost, 25000)
  assert.equal(r.rows.find(r => r.key === 'cost').amount, 75000)
  assert.equal(r.rows.find(r => r.key === 'parcel').amount, 1000)
  assert.equal(r.rows.find(r => r.key === 'platform').amount, 107)
})

test('empty cost is incomplete, explicitly entered zero cost is valid', () => {
  assert.equal(calculatePricing({ ...newPricingDraft(), unitCost: '' }).valid, false)
  assert.equal(calculatePricing({ ...newPricingDraft(), unitCost: 0 }).valid, true)
  const d = newPricingDraft(); d.kind = 'bundle'; d.components[0].cost = ''
  assert.equal(calculatePricing(d).valid, false)
})

test('transaction cap and shipping basis applied independently', () => {
  const d = newPricingDraft(); d.transactionCap = 10
  assert.equal(calculatePricing(d).rows.find(r => r.key === 'transaction').amount, 1000)
  d.transactionCap = 0; d.transactionIncludesShipping = false
  assert.equal(calculatePricing(d).rows.find(r => r.key === 'transaction').amount, 1605)
})

test('reference marketing percentages use selling price and leave platform fee base unchanged', () => {
  const d = newPricingDraft(); d.voucherEnabled = true; d.voucher = 100
  d.programs.campaign = { enabled: true, rate: 10 }; d.programs.ads = { enabled: true, rate: 5 }
  const r = calculatePricing(d)
  assert.equal(r.sales, 50000)
  assert.equal(r.rows.find(r => r.key === 'ads').amount, 2500)
  assert.equal(r.rows.find(r => r.key === 'voucher').amount, 2500)
  assert.equal(r.rows.find(r => r.key === 'campaign').amount, 5000)
  assert.equal(r.fees, 10394)
  assert.equal(r.fees, r.rows.filter(r => r.group === 'fee').reduce((a,r) => a+r.amount,0))
})

test('reference switches are independent, invalid quantities still block results', () => {
  const d = newPricingDraft(); d.programs.flash.enabled = true; d.programs.dynamic.enabled = true
  assert.equal(calculatePricing(d).valid, true)
  assert.equal(calculatePricing(d).marketing, 4105)
  assert.equal(calculatePricing({ ...newPricingDraft(), unitsPerOrder: 0 }).valid, false)
  assert.equal(calculatePricing({ ...newPricingDraft(), monthlyVolume: -1 }).valid, false)
})

test('reference screenshot: Exclusive 5% plus Affiliate 10% yields 106.06 without repricing', () => {
  const d = { ...newPricingDraft(), exclusiveEnabled: true, exclusivePct: 5 }
  d.programs.affiliate.enabled = true
  const r = calculatePricing(d)
  assert.equal(r.unitPrice, 50000)
  assert.equal(r.rows.find(r => r.key === 'exclusive').amount, 2500)
  assert.equal(r.rows.find(r => r.key === 'affiliate').amount, 5000)
  assert.equal(r.marketing, 7500)
  assert.equal(r.fees, 10394)
  assert.equal(r.profit, 10606)
  assert.ok(solvePricingTarget(d).price)
  d.exclusivePct = 7
  assert.equal(calculatePricing(d).profit, 9606)
  d.exclusiveEnabled = false
  assert.equal(calculatePricing(d).profit, 13106)
})

test('reference category, Mall, payment and manual overrides follow the baseline', () => {
  assert.equal(PRICING_CATEGORIES.length,24)
  assert.equal(PRICING_PAYMENTS.length,10)
  const d = applyPricingPreset(newPricingDraft(), { category: 'แฟชั่น (ต่ำสุด)', storeType: 'mall', payment: 'special3' })
  assert.equal(d.commission,19.26)
  assert.equal(d.transaction,5.35)
  assert.equal(d.programs.xtra.rate,8.56)
  assert.equal(d.programs.prime.rate,1.07)
  assert.equal(calculatePricing({...d, commission: 12}).rows.find(r=>r.key==='commission').amount,6000)
  const metal = applyPricingPreset(d,{category:'ทอง & แพลตตินั่ม'})
  assert.equal(metal.programs.prime.rate,2.14)
  assert.equal(metal.programs.xtra.rate,5.35)
})

test('reference shipping passes through; only transaction includes customer shipping', () => {
  const d = {...newPricingDraft(),customerShipping:100,actualShipping:0,shippingSubsidy:500}
  const r = calculatePricing(d)
  assert.equal(r.profit,50000-20000-1500-8560-1926-107)
  assert.equal(r.subsidy,0)
})

test('older saved plans preserve absolute Exclusive and voucher meaning until converted', () => {
  const old = newPricingDraft();delete old.calculationModel
  old.exclusiveEnabled=true;old.exclusivePrice=399;old.voucherEnabled=true;old.voucher=20
  const restored=normalizePricingDraft(old)
  assert.equal(restored.calculationModel,'legacy-v1')
  const result=calculatePricing(restored)
  assert.equal(result.unitPrice,39900)
  assert.equal(result.voucher,2000)
  assert.ok(solvePricingTarget(restored).error)
})

test('monthly projection charges a final partial order, zero sales has only fixed cost', () => {
  const d = { ...newPricingDraft(), unitsPerOrder: 2, fixedCost: 500 }
  const r = monthlyProfit(d, 5)
  assert.equal(r.orders, 3)
  assert.equal(r.afterFixed, calculatePricing(d).profit * 2 + calculatePricing({ ...d, unitsPerOrder: 1 }).profit - 50000)
  assert.equal(monthlyProfit(d,0).afterFixed, -50000)
})

test('amount and margin targets are verified forward at minimum whole-baht price', () => {
  for (const targetType of ['amount','margin']) {
    const d = { ...newPricingDraft(), targetType, target: targetType === 'amount' ? 100 : 30 }
    const solved = solvePricingTarget(d)
    assert.ok(solved.price)
    const previous = calculatePricing({ ...d, price: solved.price-1 })
    if (targetType === 'amount') { assert.ok(solved.result.unitProfit >= 10000); assert.ok(previous.unitProfit < 10000) }
    else { assert.ok(solved.result.margin >= 30); assert.ok(previous.margin < 30) }
  }
  assert.ok(solvePricingTarget({ ...newPricingDraft(), unitCost: 10000000 }).error)
})

test('normalization does not mutate saved scenario or accept extra financial fields', () => {
  const original = newPricingDraft(); const normalized = normalizePricingDraft({ ...original, actualPayout: 999 })
  normalized.components[0].cost = 55
  assert.equal(original.components[0].cost, 200)
  assert.equal('actualPayout' in normalized, false)
  for (const role of ['dev','boss','staff','finance']) assert.equal(canAccessTab(role, 'Pricing'), false)
})
