import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessTab, canManageOperations, canManageMarketing, canManageFinance, normalizeRole } from '../shared/roles.js'

test('legacy admin keeps full Dev access', () => {
  assert.equal(normalizeRole('admin'), 'dev')
  assert.equal(canAccessTab('admin', 'Settings'), true)
  assert.equal(canAccessTab('admin', 'Import Orders'), true)
})

test('Boss sees the app except Dev-only pages', () => {
  assert.equal(canAccessTab('boss', 'Executive'), true)
  assert.equal(canAccessTab('boss', 'Inventory'), true)
  assert.equal(canAccessTab('boss', 'Import Orders'), false)
  assert.equal(canAccessTab('boss', 'Dev Hub'), false)
  assert.equal(canAccessTab('boss', 'Settings'), false)
  assert.equal(canAccessTab('boss', 'Import Tracking'), false)
  assert.equal(canAccessTab('boss', 'WHT Cert'), false)
  assert.equal(canAccessTab('dev', 'Import Tracking'), true)
  assert.equal(canManageOperations('boss'), true)
})

test('Staff sees only its operational pages', () => {
  for (const tab of ['Executive', 'Monthly', 'Products', 'ProductTrends', 'Inventory', 'Stock Movement']) {
    assert.equal(canAccessTab('staff', tab), true, tab)
  }
  for (const tab of ['MarketingRadar', 'HR', 'CFO', 'Demographic', 'Import Orders', 'Dev Hub', 'Settings']) {
    assert.equal(canAccessTab('staff', tab), false, tab)
  }
  assert.equal(canManageOperations('staff'), false)
})

test('Stock role sees only Inventory/Stock Movement', () => {
  assert.equal(canAccessTab('stock', 'Inventory'), true)
  assert.equal(canAccessTab('stock', 'Stock Movement'), true)
  assert.equal(canAccessTab('stock', 'Executive'), false)
})

test('Marketing role sees dashboards plus Marketing Radar and Demographic', () => {
  for (const tab of ['Executive', 'Monthly', 'Products', 'ProductTrends', 'MarketingRadar', 'Demographic']) {
    assert.equal(canAccessTab('marketing', tab), true, tab)
  }
  assert.equal(canAccessTab('marketing', 'Inventory'), false)
  assert.equal(canManageMarketing('marketing'), true)
  assert.equal(canManageMarketing('staff'), false)
})

test('Finance role sees CFO + Fulfillment only', () => {
  assert.equal(canAccessTab('finance', 'CFO'), true)
  assert.equal(canAccessTab('finance', 'Fulfillment'), true)
  assert.equal(canAccessTab('finance', 'Executive'), false)
  assert.equal(canManageFinance('finance'), true)
  assert.equal(canManageFinance('staff'), false)
})

test('Tang role sees staff pages plus Fulfillment', () => {
  for (const tab of ['Executive', 'Monthly', 'Products', 'Inventory', 'Stock Movement', 'Fulfillment']) {
    assert.equal(canAccessTab('tang', tab), true, tab)
  }
  assert.equal(canAccessTab('tang', 'CFO'), false)
  assert.equal(canAccessTab('tang', 'Import Orders'), false)
  assert.equal(canManageOperations('tang'), false)
})

test('plain staff does not get Fulfillment', () => {
  assert.equal(canAccessTab('staff', 'Fulfillment'), false)
})
