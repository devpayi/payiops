// GET /api/sheet-tools?op=workspace[&as=username] — Workspace รุ่นแรก (2026-09-24)
// หน้า "งานของฉัน": ฝ่าย/หัวข้อบนกระดานเป้า 2027 ของแต่ละคน + ยอดบริษัทเทียบเป้า 150 ล้าน (หัวหน้าฝ่าย/CEO เท่านั้น)
// ข้อมูลคน/ฝ่าย/หัวข้อ = ค่าตั้งต้นในไฟล์นี้ (โมตัดสินโครงสร้างเอง — ดู memory workspace-permissions)
// ตอนนี้เปิดให้ dev เท่านั้น (?as= สลับดูมุมของแต่ละคน) — ยังไม่เปิดให้ role อื่นจนกว่าโมจะอนุมัติ
import { authEnabled } from './auth.js'
import { normalizeRole, canAccessTab } from '../../shared/roles.js'
import { getMetaCached, batchGetValues } from './sheets.js'

export const TARGET_2027 = 150_000_000

// หัวหน้าฝ่ายอนุมัติงานฝ่ายตัวเอง, CEO เห็นทุกอย่าง, หัวหน้าทุกฝ่ายเห็นยอดบริษัท
// Content ยังไม่มีหัวหน้า (ช่วยกัน ~4 คน) — ตอนนี้ให้เห็นแค่โม
export const DEPARTMENTS = [
  { id: 'CEO', label: 'CEO', duty: 'เป้า ผลบริษัท B2B ต้นทุน/ซัพพลายเออร์ Story Cocktail', head: 'boss' },
  { id: 'CMO', label: 'CMO', duty: 'สินค้า การตลาด ช่องทาง Ads Affiliate', head: 'toon' },
  { id: 'Content', label: 'Content', duty: 'แบรนด์ สื่อ เว็บไซต์ คอมเมนต์', head: null, devOnly: true },
  { id: 'CRM', label: 'CRM', duty: 'ลูกค้า ติดตาม ซื้อซ้ำ บริการหลังขาย', head: null, pending: 'รอ 1 — เริ่ม Q1–Q2 2027 หลังวาง workflow' },
  { id: 'Floor', label: 'Floor', duty: 'สต็อก แพ็ค ส่ง เคลม คนและ OT', head: 'tang' },
  { id: 'Management', label: 'Management (ไลฟ์)', duty: 'ตาราง Live ยอด ผลงาน ค่าจ้าง', head: 'ked' },
  { id: 'Finance', label: 'Finance', duty: 'รับจ่าย กระทบยอด ต้นทุน เอกสาร', head: 'lady' },
]

// key = username ในชีท users (คนที่ยังไม่มีบัญชีใน Ops ใช้ key สมมติ มี account:false)
// role = role จริงในชีท users — ใช้กรองทางลัดให้เหลือแต่หน้าที่คนนั้นเปิดได้จริง
export const PEOPLE = [
  { key: 'dev', role: 'dev', name: 'โม', dept: 'CEO', extraDepts: ['CMO', 'Content', 'Floor'], board: [10, 12, 18], account: true },
  { key: 'boss', role: 'boss', name: 'CEO (บอส)', dept: 'CEO', board: [5, 8, 14], account: true },
  { key: 'toon', role: 'marketing', name: 'ตูน', dept: 'CMO', extraDepts: ['Content'], board: [2, 3, 4, 9, 15], account: true },
  { key: 'tang', role: 'tang', name: 'แตง', dept: 'Floor', board: [18], account: true },
  { key: 'fah', role: 'stock', name: 'ฟ้า', dept: 'Floor', board: [], account: true },
  { key: 'lady', role: 'boss', name: 'พี่หยก', dept: 'Finance', board: [], account: true },
  { key: 'taew', name: 'พี่แต้ว', dept: 'Finance', board: [], account: false, headOf: 'Finance' },
  { key: 'ked', name: 'เกด', dept: 'Management', extraDepts: ['CMO'], board: [1, 11], account: false },
  { key: 'maprang', name: 'มะปราง', dept: 'Content', board: [13], account: false },
]

// 19 หัวข้อบนกระดาน (ประชุม 22 ก.ย. 2026) — owners = key ใน PEOPLE หรือช่องรอคน
export const BOARD = [
  { no: 1, title: 'Affiliate / KOL / KOC', owners: ['ked'], dept: 'CMO' },
  { no: 2, title: 'สินค้าใหม่', owners: ['toon'], dept: 'CMO' },
  { no: 3, title: 'Segment ใหม่', owners: ['toon'], dept: 'CMO' },
  { no: 4, title: 'เพิ่ม AOV (Bundle)', owners: ['toon'], dept: 'CMO' },
  { no: 5, title: 'Channel B2B / ร้านยา / MDT', owners: ['boss'], dept: 'CEO' },
  { no: 6, title: 'CRM', owners: ['รอ 1'], dept: 'CRM' },
  { no: 7, title: 'ลูกค้าเก่ากลับมาซื้อซ้ำ', owners: ['รอ 1'], dept: 'CRM' },
  { no: 8, title: 'Content → Story Cocktail', owners: ['boss'], dept: 'Content' },
  { no: 9, title: 'Branding → Top of Mind', owners: ['toon'], dept: 'Content' },
  { no: 10, title: 'Website (GEO)', owners: ['dev'], dept: 'Content' },
  { no: 11, title: 'แคมเปญใหญ่ → Live', owners: ['ked'], dept: 'Management' },
  { no: 12, title: 'CPAS = ยิงแอด Facebook', owners: ['dev'], dept: 'CMO' },
  { no: 13, title: 'ตอบ Comment', owners: ['maprang'], dept: 'Content' },
  { no: 14, title: 'ลดต้นทุน → หาซัพพลายเออร์เพิ่ม', owners: ['boss'], dept: 'Floor' },
  { no: 15, title: 'พัฒนาสินค้าเดิม', owners: ['toon'], dept: 'CMO' },
  { no: 16, title: 'แคมเปญ / โปรโมชั่น', owners: ['รอ 3'], dept: 'CMO' },
  { no: 17, title: 'Platform', owners: ['รอ 3'], dept: 'CMO' },
  { no: 18, title: 'หลังบ้าน', owners: ['tang', 'dev'], dept: 'Floor' },
  { no: 19, title: 'Ads Platform', owners: ['รอ 3'], dept: 'CMO' },
]
export const PENDING_SLOTS = {
  'รอ 1': 'คนดูแล CRM — เริ่ม Q1–Q2 2027 หลังระบบอื่นเสร็จ',
  'รอ 3': 'รอรับคนใหม่ Digital Marketing (โปรโมชั่น / Ads optimize)',
}

// แท็บใน Ops ที่เป็นทางลัดของแต่ละฝ่าย (หน้าเว็บกรองอีกชั้นด้วย canAccessTab ตาม role จริง)
const DEPT_LINKS = {
  CEO: ['Executive', 'Products', 'Fulfillment', 'CFO'],
  CMO: ['Products', 'MarketingRadar', 'AdsChannels', 'Demographic'],
  Content: ['ContentOS'],
  Floor: ['Inventory', 'Stock Movement', 'Fulfillment'],
  Management: [],
  Finance: ['CFO', 'Fulfillment', 'WHT Cert'],
}

// หน้าที่ App.jsx ล็อกให้เฉพาะ dev (DevOnlyLock) แม้ canAccessTab จะยอม — ไม่ใส่เป็นทางลัดให้คนอื่น
const DEV_ONLY_PAGES = new Set(['CFO', 'Demographic'])

const nameOf = (key) => PEOPLE.find((p) => p.key === key)?.name || key
const isHead = (key) => DEPARTMENTS.some((d) => d.head === key) || PEOPLE.some((p) => p.key === key && p.headOf)

export function profileFor(key) {
  const p = PEOPLE.find((x) => x.key === key)
  if (!p) return null
  const depts = [p.dept, ...(p.extraDepts || [])]
  const head = isHead(key)
  const seesAll = key === 'dev' || key === 'boss'
  return {
    key: p.key,
    name: p.name,
    account: p.account,
    dept: p.dept,
    depts,
    headOf: DEPARTMENTS.filter((d) => d.head === key).map((d) => d.id).concat(p.headOf ? [p.headOf] : []),
    canSeeCompany: head || seesAll,
    seesAllDepts: seesAll,
    board: BOARD.filter((b) => b.owners.includes(key)).map((b) => ({ ...b, ownerNames: b.owners.map(nameOf) })),
    links: p.account ? [...new Set(depts.flatMap((d) => DEPT_LINKS[d] || []))].filter((t) => canAccessTab(p.role, t) && (p.role === 'dev' || !DEV_ONLY_PAGES.has(t))) : [],
  }
}

function departmentsView(viewerKey) {
  const viewer = profileFor(viewerKey)
  return DEPARTMENTS
    .filter((d) => !d.devOnly || viewerKey === 'dev')
    .filter((d) => viewer?.seesAllDepts || viewer?.depts.includes(d.id))
    .map((d) => ({
      ...d,
      headName: [d.head, ...PEOPLE.filter((p) => p.headOf === d.id).map((p) => p.key)].filter(Boolean).map(nameOf).join(' / ') || null,
      members: PEOPLE.filter((p) => p.dept === d.id || (p.extraDepts || []).includes(d.id)).map((p) => ({ key: p.key, name: p.name, account: p.account })),
      board: BOARD.filter((b) => b.dept === d.id).map((b) => ({ ...b, ownerNames: b.owners.map(nameOf) })),
    }))
}

// ยอดขายรายเดือน (ไม่นับยกเลิก) จาก raw_orders_* — สูตรเดียวกับ Dashboard เดิม; cache 30 นาที
const isCancelled = (s) => /ยกเลิก|cancel/i.test(String(s || ''))
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
let salesCache = null
async function monthlySales() {
  if (salesCache && Date.now() - salesCache.at < 30 * 60_000) return salesCache.data
  const meta = await getMetaCached()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => /^raw_orders_\d{4}_\d{2}$/.test(t)).sort()
  const vr = await batchGetValues(tabs.map((t) => `${t}!L:N`))
  const months = tabs.map((t, i) => {
    let revenue = 0
    for (const r of (vr[i].values || []).slice(1)) if (!isCancelled(r[2])) revenue += num(r[1])
    return { month: t.slice(11).replace('_', '-'), revenue: Math.round(revenue) }
  }).filter((m) => m.revenue > 0)
  salesCache = { at: Date.now(), data: months }
  return months
}

export default async function opWorkspace(req, res) {
  try {
    const role = normalizeRole(req.user?.role)
    if (authEnabled() && role !== 'dev') return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' })
    // dev สลับดูมุมคนอื่นได้ (?as=) — ตอนเปิดให้ทุกคน ต้องล็อกให้แต่ละคนเห็นเฉพาะตัวเอง
    const key = String(req.query.as || req.user?.username || 'dev')
    const me = profileFor(key)
    if (!me) return res.status(404).json({ success: false, error: `ไม่พบ ${key} ในรายชื่อ Workspace` })
    const sales = me.canSeeCompany ? await monthlySales() : null
    res.status(200).json({
      success: true,
      me,
      people: PEOPLE.map((p) => ({ key: p.key, name: p.name, account: p.account })),
      departments: departmentsView(key),
      pending: PENDING_SLOTS,
      target: me.canSeeCompany ? { year: 2027, total: TARGET_2027, monthly: TARGET_2027 / 12 } : null,
      sales,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
