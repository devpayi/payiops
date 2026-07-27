export const ROLES = Object.freeze({ DEV: 'dev', BOSS: 'boss', STAFF: 'staff', STOCK: 'stock' })

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
  'Planner Control', 'FeedProducts',
  'Workforce OT', 'Claims',
  'Inventory', 'Stock Movement',
])

// role แคบสำหรับคนดูแลสต็อกอย่างเดียว (เช่น ฟ้า) — เห็นแค่ Inventory/Stock Movement ไม่เห็นแท็บอื่นเลย
export const STOCK_TABS = Object.freeze(['Inventory', 'Stock Movement'])

const BOSS_HIDDEN_TABS = new Set(['Import Orders', 'Dev Hub', 'Settings'])
const STAFF_TAB_SET = new Set(STAFF_TABS)
const STOCK_TAB_SET = new Set(STOCK_TABS)

export function canAccessTab(role, tab) {
  const normalized = normalizeRole(role)
  if (normalized === ROLES.DEV) return true
  if (normalized === ROLES.BOSS) return !BOSS_HIDDEN_TABS.has(tab)
  if (normalized === ROLES.STOCK) return STOCK_TAB_SET.has(tab)
  return STAFF_TAB_SET.has(tab)
}

export function isDev(role) {
  return normalizeRole(role) === ROLES.DEV
}

export function canManageOperations(role) {
  return [ROLES.DEV, ROLES.BOSS].includes(normalizeRole(role))
}
