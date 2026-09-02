export const ROLES = Object.freeze({ DEV: 'dev', BOSS: 'boss', STAFF: 'staff', STOCK: 'stock', MARKETING: 'marketing', FINANCE: 'finance' })

// `admin` was the owner role before roles were split. Treat it as `dev` so the
// existing owner account keeps full access without a manual data migration.
export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (value === 'admin') return ROLES.DEV
  return Object.values(ROLES).includes(value) ? value : ROLES.STAFF
}

export const STAFF_TABS = Object.freeze([
  'Executive', 'Monthly',
  'Products', 'ProductTrends',
  'Inventory', 'Stock Movement',
])

// role แคบสำหรับคนดูแลสต็อกอย่างเดียว (เช่น ฟ้า) — เห็นแค่ Inventory/Stock Movement ไม่เห็นแท็บอื่นเลย
export const STOCK_TABS = Object.freeze(['Inventory', 'Stock Movement'])

// role แคบสำหรับฝ่าย marketing (เช่น toon) — เห็นแค่ Dashboard ยอดขาย+สินค้า กับ Marketing Radar
// เต็มหน้า (จัดการได้ ไม่ใช่แค่ดู — ดู canManageMarketing ด้านล่างที่ผูกกับ endpoint ของ Marketing Radar
// โดยเฉพาะ ไม่ใช้ canManageOperations เพราะนั่นจะให้สิทธิ์ Inventory/HR/OT ไปด้วยซึ่งเกินขอบเขตที่ขอ)
export const MARKETING_TABS = Object.freeze(['Executive', 'Monthly', 'Products', 'ProductTrends', 'MarketingRadar', 'Demographic'])

// role แคบสำหรับฝ่ายบัญชี/การเงิน (พี่หยก, พี่แต้ว) — เห็นแค่ CFO เท่านั้น ไม่ปนกับ canManageOperations
// เพราะนั่นจะให้สิทธิ์ Inventory/HR/OT ไปด้วยซึ่งเกินขอบเขต (ตาม pattern เดียวกับ marketing ด้านบน)
export const FINANCE_TABS = Object.freeze(['CFO', 'Fulfillment'])

const BOSS_HIDDEN_TABS = new Set(['Import Orders', 'Dev Hub', 'Settings'])
const STAFF_TAB_SET = new Set(STAFF_TABS)
const STOCK_TAB_SET = new Set(STOCK_TABS)
const MARKETING_TAB_SET = new Set(MARKETING_TABS)
const FINANCE_TAB_SET = new Set(FINANCE_TABS)

export function canAccessTab(role, tab) {
  const normalized = normalizeRole(role)
  if (normalized === ROLES.DEV) return true
  if (normalized === ROLES.BOSS) return !BOSS_HIDDEN_TABS.has(tab)
  if (normalized === ROLES.STOCK) return STOCK_TAB_SET.has(tab)
  if (normalized === ROLES.MARKETING) return MARKETING_TAB_SET.has(tab)
  if (normalized === ROLES.FINANCE) return FINANCE_TAB_SET.has(tab)
  return STAFF_TAB_SET.has(tab)
}

export function isDev(role) {
  return normalizeRole(role) === ROLES.DEV
}

export function canManageOperations(role) {
  return [ROLES.DEV, ROLES.BOSS].includes(normalizeRole(role))
}

// จัดการ Marketing Radar ได้ (เพิ่ม/แก้ event, ดู basket analysis) — dev/boss ได้อยู่แล้วเหมือนเดิม
// บวก role marketing โดยเฉพาะ ไม่ปนกับ canManageOperations เพราะ marketing role ไม่ควรแตะ
// Inventory/Workforce/HR ที่ canManageOperations คุมอยู่
export function canManageMarketing(role) {
  return [ROLES.DEV, ROLES.BOSS, ROLES.MARKETING].includes(normalizeRole(role))
}

// จัดการ CFO module ได้ (บันทึกเงินทุน/fix cost) — dev/boss ได้อยู่แล้วเหมือนเดิม บวก role finance โดยเฉพาะ
export function canManageFinance(role) {
  return [ROLES.DEV, ROLES.BOSS, ROLES.FINANCE].includes(normalizeRole(role))
}
