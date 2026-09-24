// GET /api/sheet-tools?op=workspace[&as=username] — Workspace รุ่นแรก (2026-09-24)
// หน้า "งานของฉัน": ฝ่าย/หัวข้อบนกระดานเป้า 2027 ของแต่ละคน + ยอดบริษัทเทียบเป้า 150 ล้าน (หัวหน้าฝ่าย/CEO เท่านั้น)
// ข้อมูลคน/ฝ่าย/หัวข้อ = ค่าตั้งต้นในไฟล์นี้ (โมตัดสินโครงสร้างเอง — ดู memory workspace-permissions)
// ตอนนี้เปิดให้ dev เท่านั้น (?as= สลับดูมุมของแต่ละคน) — ยังไม่เปิดให้ role อื่นจนกว่าโมจะอนุมัติ
import { authEnabled } from './auth.js'
import { normalizeRole, canAccessTab } from '../../shared/roles.js'
import { getMetaCached, batchGetValues, getSheet, appendRows, ensureSheet } from './sheets.js'

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
// แยกช่องทาง (E=platform) และร้าน (F=business) ด้วย เพื่อแตกเป้าแบบ OKR
const isCancelled = (s) => /ยกเลิก|cancel/i.test(String(s || ''))
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
let salesCache = null
async function monthlySales() {
  if (salesCache && Date.now() - salesCache.at < 30 * 60_000) return salesCache.data
  const meta = await getMetaCached()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => /^raw_orders_\d{4}_\d{2}$/.test(t)).sort()
  const vr = await batchGetValues(tabs.flatMap((t) => [`${t}!E:F`, `${t}!L:N`]))
  const months = []
  tabs.forEach((t, i) => {
    const ef = vr[2 * i].values || [], ln = vr[2 * i + 1].values || []
    const m = { month: t.slice(11).replace('_', '-'), revenue: 0, platform: {}, business: {} }
    for (let j = 1; j < ln.length; j++) {
      const r = ln[j] || []
      if (isCancelled(r[2])) continue
      const rev = num(r[1]); const [plat = '', biz = ''] = ef[j] || []
      m.revenue += rev
      if (plat) m.platform[plat] = (m.platform[plat] || 0) + rev
      if (biz) m.business[biz] = (m.business[biz] || 0) + rev
    }
    if (m.revenue > 0) months.push(m)
  })
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))
  const data = months.map((m) => ({ ...m, revenue: Math.round(m.revenue), platform: round(m.platform), business: round(m.business) }))
  salesCache = { at: Date.now(), data }
  return data
}

// โครงจาก CMO/COO app #58 OKR: เป้าบริษัท → เป้าย่อยต่อช่องทาง/ร้าน (ค่าตั้งต้น = สัดส่วนยอดจริงปีนี้)
// เป้าเป็นรายปีเท่านั้น (ไม่ได้ตั้งรายเดือนแบบเป๊ะ) — ความคืบหน้า = อัตรายอดปัจจุบันคิดทั้งปี (เฉลี่ย 3 เดือนล่าสุด × 12) ÷ เป้าปี; ≥90% ถึงเป้า, 60–90% ใกล้เป้า, <60% ห่างเป้า
const statusOf = (pct) => (pct >= 0.9 ? 'on' : pct >= 0.6 ? 'risk' : 'off')
export function buildOkr(months, total = TARGET_2027) {
  if (!months?.length) return null
  const recent = months.slice(-3)
  const avg = (fn) => recent.reduce((s, m) => s + fn(m), 0) / recent.length
  const ytd = (dim) => {
    const sum = {}
    for (const m of months) for (const [k, v] of Object.entries(m[dim])) sum[k] = (sum[k] || 0) + v
    return sum
  }
  const all = months.reduce((s, m) => s + m.revenue, 0)
  const krs = (dim) => Object.entries(ytd(dim)).sort((a, b) => b[1] - a[1]).map(([name, v]) => {
    const share = v / all
    const target = total * share
    const runRate = avg((m) => m[dim][name] || 0) * 12
    const pct = runRate / target
    return { name, share, target: Math.round(target), runRate: Math.round(runRate), pct, status: statusOf(pct), growthNeeded: runRate ? target / runRate - 1 : null }
  })
  const runRate = avg((m) => m.revenue) * 12
  const pct = runRate / total
  return {
    objective: { title: `ยอดขายปี 2027 = ${total / 1_000_000} ล้านบาท`, target: total, runRate: Math.round(runRate), pct, status: statusOf(pct), basis: recent.map((m) => m.month) },
    platforms: krs('platform'),
    businesses: krs('business'),
  }
}

// ── check-in รายสัปดาห์ต่อหัวข้อบนกระดาน (โครงจากแอป #58 OKR check-in) ──
// แท็บ workspace_checkins: append-only (แก้ = ส่งอัปเดตใหม่ ไม่เขียนทับของเก่า) — คอลัมน์ต่อท้ายเท่านั้น
const CHECKIN_TAB = 'workspace_checkins'
const CHECKIN_HEADERS = ['id', 'board_no', 'author_key', 'author_name', 'status', 'done_text', 'next_text', 'blocker', 'created_at', 'account_user']
export const CHECKIN_STATUS = ['on', 'stuck', 'done']
const STALE_DAYS = 7

// หัวข้อที่คนนี้มองเห็น: CEO/dev ทุกข้อ, หัวหน้าฝ่ายเห็นข้อของฝ่ายตัวเอง + ข้อที่ตัวเองถือ, คนทั่วไปเห็นเฉพาะที่ตัวเองถือ
export function visibleBoard(key) {
  const me = profileFor(key)
  if (!me) return []
  if (me.seesAllDepts) return BOARD
  return BOARD.filter((b) => b.owners.includes(key) || me.headOf.includes(b.dept))
}
export const canCheckin = (key, boardNo) => key === 'dev' || BOARD.some((b) => b.no === boardNo && b.owners.includes(key))

async function loadCheckins() {
  const meta = await getMetaCached()
  if (!meta.sheets.some((s) => s.properties.title === CHECKIN_TAB)) return []
  return (await getSheet(CHECKIN_TAB)).filter((r) => r.id)
}

export function summarize(board, checkins, now = Date.now()) {
  return board.map((b) => {
    const rows = checkins.filter((c) => Number(c.board_no) === b.no).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
    const last = rows[0] || null
    const ageDays = last ? Math.floor((now - Date.parse(last.created_at)) / 86_400_000) : null
    const waiting = b.owners.every((o) => /^รอ \d$/.test(o))
    return { ...b, ownerNames: b.owners.map(nameOf), last, history: rows.slice(0, 5), ageDays, stale: !waiting && (!last || ageDays > STALE_DAYS), waiting }
  })
}

async function addCheckin(req, res, key) {
  const body = req.body || {}
  const boardNo = Number(body.board_no)
  if (!BOARD.some((b) => b.no === boardNo)) return res.status(400).json({ success: false, error: 'ไม่พบหัวข้อนี้' })
  if (!canCheckin(key, boardNo)) return res.status(403).json({ success: false, error: 'อัปเดตได้เฉพาะหัวข้อที่ตัวเองรับผิดชอบ' })
  const status = String(body.status || '')
  if (!CHECKIN_STATUS.includes(status)) return res.status(400).json({ success: false, error: 'เลือกสถานะก่อน' })
  const clip = (v) => String(v || '').trim().slice(0, 1000)
  const done = clip(body.done), next = clip(body.next), blocker = clip(body.blocker)
  if (!done && !next) return res.status(400).json({ success: false, error: 'กรอกอย่างน้อย "ทำอะไรไปแล้ว" หรือ "ขั้นต่อไป"' })
  if (status === 'stuck' && !blocker) return res.status(400).json({ success: false, error: 'สถานะติด — บอกด้วยว่าติดอะไร' })
  const createdAt = new Date().toISOString()
  const id = `CI${createdAt.replace(/\D/g, '').slice(0, 14)}${Math.random().toString(36).slice(2, 6)}`
  // ขึ้นต้น ' กัน Sheets แปลงข้อความเป็นสูตร/ตัวเลข
  const txt = (v) => (v ? `'${v}` : '')
  await ensureSheet(CHECKIN_TAB, CHECKIN_HEADERS)
  await appendRows(CHECKIN_TAB, [[id, boardNo, key, nameOf(key), status, txt(done), txt(next), txt(blocker), createdAt, req.user?.username || '']])
  return res.status(200).json({ success: true, id })
}

// ── สรุปก่อนเริ่มงาน (บอส/CEO เท่านั้น รุ่นแรก) ──
// ตอบ 4 คำถาม: ตอนนี้เป็นไง / อะไรเปลี่ยนมากสุด / วันนี้ควรดูอะไร / ไปดูต่อที่ไหน
// เทียบ "ช่วงเวลาเดียวกัน" เสมอ (วันที่ 1 ถึงวันล่าสุดที่มีข้อมูลเดือนนี้ เทียบวันเดียวกันของเดือนก่อน)
// ไม่สรุปเหตุผล ("เพราะคอนเทนต์ไม่ดี") แค่ชี้ว่าตัวเลขไหนขยับมากที่สุด ให้คนไปดูต่อเอง
const briefCache = new Map()
async function loadMonth(tab) {
  const cached = briefCache.get(tab)
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.data
  const [dnVr] = await Promise.all([batchGetValues([`${tab}!D:N`])])
  const rows = (dnVr[0]?.values || []).slice(1)
  const data = rows.map((r) => ({ date: r[0] || '', platform: r[1] || '', business: r[2] || '', masterSku: r[6] || '', name: r[7] || '', qty: num(r[8]), revenue: num(r[9]), status: r[10] || '' })).filter((r) => r.date)
  briefCache.set(tab, { at: Date.now(), data })
  return data
}
const ymd = (d) => d.toISOString().slice(0, 10)
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }
const prevMonthTab = (tab) => {
  const [y, m] = tab.slice(11).split('_').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `raw_orders_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function sumBy(rows, keyFn) {
  const out = new Map()
  for (const r of rows) { if (isCancelled(r.status)) continue; const k = keyFn(r); if (!k) continue; out.set(k, (out.get(k) || 0) + r.revenue) }
  return out
}
let briefingCache = null
export async function buildBriefing() {
  if (briefingCache && Date.now() - briefingCache.at < 15 * 60_000) return briefingCache.data
  const meta = await getMetaCached()
  const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => /^raw_orders_\d{4}_\d{2}$/.test(t)).sort()
  // เดือนล่าสุดที่ "สร้างแท็บไว้แล้ว" อาจยังไม่มีออเดอร์เลย (เพิ่งขึ้นเดือนใหม่ ยังไม่ import) — ไล่ย้อนหา
  // แท็บล่าสุดที่มีข้อมูลจริงแทน ไม่งั้นหน้าสรุปจะว่างเปล่าทั้งที่มีข้อมูลเดือนก่อนให้ดู
  let thisTab = null, thisRows = []
  for (let i = tabs.length - 1; i >= 0; i--) {
    const rows = await loadMonth(tabs[i])
    if (rows.length) { thisTab = tabs[i]; thisRows = rows; break }
  }
  if (!thisTab) return null
  const latestDate = thisRows.reduce((max, r) => (r.date > max ? r.date : max), '')
  if (!latestDate) return null
  const dayNum = Number(latestDate.slice(8, 10))
  const monthStart = latestDate.slice(0, 8) + '01'
  const prevTab = prevMonthTab(thisTab)
  const prevRows = tabs.includes(prevTab) || (await getMetaCached()).sheets.some((s) => s.properties.title === prevTab) ? await loadMonth(prevTab) : []
  const prevMonthStart = prevTab.slice(11).replace('_', '-') + '-01'
  const prevComparable = prevRows.filter((r) => r.date >= prevMonthStart && r.date <= addDays(prevMonthStart, dayNum - 1))

  const today = latestDate, yesterday = addDays(latestDate, -1)
  const revOn = (rows, d) => rows.filter((r) => r.date === d && !isCancelled(r.status)).reduce((s, r) => s + r.revenue, 0)
  const mtd = thisRows.filter((r) => r.date >= monthStart && !isCancelled(r.status)).reduce((s, r) => s + r.revenue, 0)
  const mtdPrev = prevComparable.reduce((s, r) => s + r.revenue, 0)

  const movers = (keyFn) => {
    const cur = sumBy(thisRows.filter((r) => r.date >= monthStart), keyFn)
    const prev = sumBy(prevComparable, keyFn)
    const keys = new Set([...cur.keys(), ...prev.keys()])
    return [...keys].map((k) => ({ name: k, now: Math.round(cur.get(k) || 0), before: Math.round(prev.get(k) || 0), delta: Math.round((cur.get(k) || 0) - (prev.get(k) || 0)) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }
  const platformMovers = movers((r) => r.platform)
  const productMovers = movers((r) => r.name).slice(0, 5)

  let lowStock = []
  try { const { computeLowStockList } = await import('./inventory.js'); lowStock = (await computeLowStockList()).sort((a, b) => (b.recommendedOrder || 0) - (a.recommendedOrder || 0)) } catch { /* ไม่มีสต็อกให้เช็คก็ข้าม ไม่ทำให้หน้าพัง */ }

  const platformLatest = {}
  for (const r of thisRows) if (r.platform && (!platformLatest[r.platform] || r.date > platformLatest[r.platform])) platformLatest[r.platform] = r.date

  briefingCache = {
    at: Date.now(),
    data: {
      asOfDate: latestDate,
      today: { revenue: Math.round(revOn(thisRows, today)) },
      yesterday: { revenue: Math.round(revOn(thisRows, yesterday)) },
      mtd: { revenue: Math.round(mtd), comparableDays: dayNum, prevMonthComparable: Math.round(mtdPrev), deltaPct: mtdPrev ? (mtd - mtdPrev) / mtdPrev : null, prevMonthLabel: prevMonthStart.slice(0, 7) },
      platformMovers, productMovers,
      lowStock: { count: lowStock.length, top: lowStock.slice(0, 5) },
      dataStatus: {
        latestMonthTab: thisTab, comparableDays: dayNum,
        platformLatestDate: platformLatest,
        archivedMonths: meta.sheets.filter((s) => s.properties.archived).map((s) => s.properties.title),
        unconnected: [
          { source: 'ไลฟ์ (payi-webapp)', state: 'มีข้อมูลจริง ยังไม่เชื่อมเข้ามา', detail: 'มียอดต่อรอบ ต่อคนไลฟ์ ต่อทีม และตารางแคมเปญอยู่แล้วในฐานข้อมูลแยก' },
          { source: 'Affiliate / KOL', state: 'ยังไม่มีที่เก็บ', detail: 'ยังไม่มีระบบบันทึกยอดต่อคนที่ใดเลย' },
          { source: 'Content', state: 'ยังไม่มีที่เก็บ', detail: 'ยังไม่มีระบบเก็บผลตอบรับคอนเทนต์' },
        ],
      },
    },
  }
  return briefingCache.data
}

export default async function opWorkspace(req, res) {
  try {
    const role = normalizeRole(req.user?.role)
    if (authEnabled() && role !== 'dev') return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' })
    // dev สลับดูมุมคนอื่นได้ (?as=) — ตอนเปิดให้ทุกคน ต้องล็อกให้แต่ละคนเห็นเฉพาะตัวเอง
    const key = String(req.query.as || req.user?.username || 'dev')
    const me = profileFor(key)
    if (!me) return res.status(404).json({ success: false, error: `ไม่พบ ${key} ในรายชื่อ Workspace` })
    if (req.method === 'POST') {
      if ((req.body || {}).action === 'checkin') return addCheckin(req, res, key)
      return res.status(400).json({ success: false, error: 'action ไม่ถูกต้อง' })
    }
    const checkins = await loadCheckins()
    const sales = me.canSeeCompany ? await monthlySales() : null
    res.status(200).json({
      success: true,
      me,
      people: PEOPLE.map((p) => ({ key: p.key, name: p.name, account: p.account })),
      departments: departmentsView(key),
      pending: PENDING_SLOTS,
      target: me.canSeeCompany ? { year: 2027, total: TARGET_2027 } : null,
      sales: sales?.map(({ month, revenue }) => ({ month, revenue })) || null,
      okr: sales ? buildOkr(sales) : null,
      tracker: summarize(visibleBoard(key), checkins),
      briefing: key === 'boss' || key === 'dev' ? await buildBriefing().catch(() => null) : null,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
