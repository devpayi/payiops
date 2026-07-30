// GET/POST /api/sheet-tools?op=summary|sheet|append|overwrite|workforce|planner|hr|inventory
// รวม 4 endpoint เครื่องมือชีตเดิม (/api/summary /api/sheet /api/append /api/overwrite)
// เป็นฟังก์ชันเดียว — Vercel Hobby จำกัด 12 serverless functions ต่อโปรเจค
import { requireAuth, cacheable, authEnabled } from './_lib/auth.js'
import { canManageOperations } from '../shared/roles.js'
import { getMetaCached, batchGetValues, getSheet, appendRows, overwriteSheet, ensureSheet } from './_lib/sheets.js'
import { verifySignature, pushMessage, replyMessage } from './_lib/line.js'
import {
  MIN_LOWER_HOUSE_HEADCOUNT, buildCoveragePlan, leaveAbsenceDates, leaveAbsenceSlots,
  leavePeriodLabel, normalizeLeavePeriod, officeLeaveConflicts,
} from './_lib/leaveCoverage.js'
import { applyScheduleOverrides } from './_lib/scheduleOverrides.js'
import opInventory, { computeLowStockList, createOrderRequest, loadItemsWithBalance } from './_lib/inventory.js'
import opImportTracking from './_lib/importTracking.js'

// ปิด body parser อัตโนมัติของ Vercel — ต้องอ่าน raw body เองเพื่อตรวจลายเซ็น LINE webhook (HMAC ต้องใช้ byte ดิบ)
// req.body ยังใช้ได้ตามปกติในทุก op เดิม เพราะ readRawBody() ด้านล่าง parse JSON ให้เหมือน Vercel ทำเอง
export const config = { api: { bodyParser: false } }
async function readRawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody // dev middleware (vite.config.js) เซ็ตไว้ให้แล้ว
  const chunks = []
  for await (const c of req) chunks.push(c)
  req.rawBody = Buffer.concat(chunks).toString()
  return req.rawBody
}
const OT_HEADERS = ['id', 'date', 'employee', 'team', 'task', 'planned_start', 'planned_end', 'planned_minutes', 'actual_start', 'actual_end', 'actual_minutes', 'status', 'reason', 'note', 'created_at', 'closed_at']
const MANPOWER_HEADERS = ['id', 'date', 'employee', 'team', 'task', 'start_time', 'end_time', 'note', 'created_at']
// ตารางพนักงานปี 2026 ที่คัดลอกมาเก็บในระบบแล้ว ทั้งบ้านล่างและออฟฟิศ
const SCHEDULE_SNAPSHOT_HEADERS = ['date', 'code', 'employee', 'group', 'fraction']
const SCHEDULE_OVERRIDE_HEADERS = ['date', 'entries_json', 'updated_at', 'updated_by']
const EVENT_HEADERS = ['id', 'title', 'date', 'team', 'note', 'created_at', 'end_date', 'lead_days', 'lag_days']
const OT_HISTORY_HEADERS = ['id', 'plan_id', 'date', 'employee', 'before_start', 'before_end', 'after_start', 'after_end', 'before_note', 'after_note', 'changed_at', 'changed_by']
const OT_APPROVAL_HEADERS = ['id', 'month', 'employee', 'actual_minutes', 'approved_at', 'approved_by']
const PEOPLE_HEADERS = ['code', 'name', 'group', 'active']
const OT_LIMIT_HEADERS = ['employee', 'limit_hours', 'updated_at', 'updated_by']
const OT_APPROVAL_HISTORY_HEADERS = ['id', 'month', 'employee', 'before_minutes', 'after_minutes', 'changed_at', 'changed_by']
// บันทึกวันพิเศษ: โอทีเต็มวัน (มาทำวันหยุด/นักขัตฤกษ์) หรือมาชดเชยเฉยๆไม่รับโอที — แยกจาก workforce_ot ที่เป็น OT รายชั่วโมง
// สลับวันหยุด ("จากวันไหนไปวันไหน") มีอยู่แล้วเป็น leave_type 'สลับวันหยุด' ใน hr_leave ไม่ต้องทำซ้ำที่นี่
const DAYRECORD_HEADERS = ['id', 'date', 'employee', 'team', 'kind', 'reason', 'paid_ot', 'note', 'created_at', 'created_by']
const LEAVE_HEADERS = ['id', 'username', 'employee_name', 'leave_type', 'start_date', 'end_date', 'days', 'reason', 'status', 'requested_by', 'requested_at', 'decided_by', 'decided_at', 'decision_note', 'backup_office', 'leave_period', 'edit_pending', 'edit_payload', 'edit_requested_at', 'edit_requested_by', 'understaffed_dates']
const BACKUP_HEADERS = ['leave_id', 'date', 'period', 'office_code', 'created_at']
const LEAVE_EDIT_HEADERS = ['leave_id', 'mode', 'before_json', 'after_json', 'changed_at', 'changed_by']
const SCHEDULE_HEADERS = ['id', 'date', 'username', 'employee_name', 'shift_start', 'shift_end', 'role_note', 'created_at', 'created_by']
const LINE_LINK_HEADERS = ['username', 'line_user_id', 'updated_at']
const LINE_SESSION_HEADERS = ['line_user_id', 'step', 'leave_type', 'date', 'date2', 'backup_office', 'updated_at', 'leave_period', 'backup_assignments', 'backup_needs', 'backup_cursor', 'edit_leave_id']
// โควตาวันลาพักร้อนต่อคนต่อปี — แยกชีตต่างหาก (ไม่ยุ่งกับ workforce_people) เพราะครอบคุมทั้งบ้านล่างและออฟฟิศ แก้ค่าตรงในชีตได้เลย ไม่ต้องแก้โค้ด
const QUOTA_HEADERS = ['code', 'quota', 'updated_at']
const DEFAULT_VACATION_QUOTA = 6
const NO_VACATION_GROUPS = new Set(['คนฟีด', 'พาร์ทไทม์'])
const hasVacationBenefit = (group) => !NO_VACATION_GROUPS.has(String(group || '').trim())
// รายชื่อออฟฟิศ — ย้ายจาก object hardcode มาเป็นชีต (เหมือน workforce_people) เพื่อให้เพิ่ม/ลบคนได้จากหน้าเว็บ ไม่ต้องแก้โค้ด
const OFFICE_HEADERS = ['code', 'name', 'active']
const DEFAULT_OFFICE_ROWS = [['TOON', 'ตูน', '1'], ['KED', 'เกด', '1'], ['MO', 'โม', '1']]
const HR_SHEETS = [['hr_leave', LEAVE_HEADERS], ['hr_leave_backups', BACKUP_HEADERS], ['hr_leave_edits', LEAVE_EDIT_HEADERS], ['hr_schedule', SCHEDULE_HEADERS], ['hr_line_links', LINE_LINK_HEADERS], ['hr_line_sessions', LINE_SESSION_HEADERS], ['hr_leave_quota', QUOTA_HEADERS], ['hr_office_people', OFFICE_HEADERS], ['workforce_schedule_snapshot', SCHEDULE_SNAPSHOT_HEADERS], ['workforce_schedule_overrides', SCHEDULE_OVERRIDE_HEADERS]]
let hrEnsurePromise
let hrCache = { at: 0, data: null }
const ensureHrSheets = () => hrEnsurePromise ||= Promise.all(HR_SHEETS.map(([name, headers]) => ensureSheet(name, headers)))
const clearHrCache = () => { hrCache = { at: 0, data: null } }
const daysBetween = (start, end) => Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1
const currentYearBKK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4)
const parseJsonObject = (value) => { try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} } }
const leaveEditPayload = (record) => parseJsonObject(record?.edit_payload)
const pendingLeaveView = (record) => record?.edit_pending === '1' ? { ...record, ...leaveEditPayload(record), is_edit_request: true } : record
async function appendLeaveAudit(leaveId, mode, before, after, changedBy) {
  await appendRows('hr_leave_edits', [[leaveId, mode, JSON.stringify(before || {}), JSON.stringify(after || {}), new Date().toISOString(), changedBy]])
}

// ใช้ร่วมกันทั้งจาก action decide-leave (กดในเว็บ) และ webhook LINE (กดปุ่มในแชท)
async function applyLeaveDecision(id, decision, decidedBy, decisionNote = '') {
  if (!id || !['approved', 'rejected'].includes(decision)) return { error: 'ข้อมูลไม่ถูกต้อง' }
  const [current, backupRows] = await Promise.all([getSheet('hr_leave'), getSheet('hr_leave_backups')])
  const target = current.find((r) => String(r.id) === String(id))
  if (!target) return { error: 'ไม่พบคำขอลานี้' }
  const now = new Date().toISOString()
  if (target.edit_pending === '1') {
    const payload = leaveEditPayload(target)
    const proposed = { ...target, ...payload, backup_assignments: payload.backup_assignments || [] }
    let record
    let notificationRecord
    if (decision === 'approved' && payload.cancel_requested) {
      // ขอยกเลิกวันลาที่อนุมัติไปแล้ว — ไม่ต้องเช็คกำลังคน (ยกเลิกมีแต่ทำให้คนว่างขึ้น) แค่เปลี่ยนสถานะเป็นยกเลิก
      record = { ...target, status: 'cancelled', edit_pending: '', edit_payload: '', edit_requested_at: '', edit_requested_by: '', decided_by: decidedBy, decided_at: now, decision_note: decisionNote }
      await appendLeaveAudit(id, 'cancel-approved', target, record, decidedBy)
      notificationRecord = { ...record }
    } else if (decision === 'approved') {
      const coverage = await resolveLeaveCoverage(target.username, proposed, proposed.backup_assignments, target.id)
      if (!coverage.ok) return { error: coverage.error, target }
      record = {
        ...target, ...payload,
        status: target.status === 'pending' ? 'approved' : target.status,
        backup_office: coverage.assignments?.[0]?.office_code || '',
        edit_pending: '', edit_payload: '', edit_requested_at: '', edit_requested_by: '',
        decided_by: decidedBy, decided_at: now, decision_note: decisionNote,
      }
      const keptBackups = backupRows.filter((row) => String(row.leave_id) !== String(id))
      const replacementRows = (coverage.assignments || []).map((assignment) => ({ leave_id: id, ...assignment, created_at: now }))
      await overwriteSheet('hr_leave_backups', BACKUP_HEADERS, [...keptBackups, ...replacementRows].map((row) => BACKUP_HEADERS.map((header) => row[header] ?? '')))
      await appendLeaveAudit(id, 'edit-approved', target, record, decidedBy)
      notificationRecord = { ...record, status: 'approved', backup_assignments: coverage.assignments || [] }
    } else {
      record = { ...target, edit_pending: '', edit_payload: '', edit_requested_at: '', edit_requested_by: '', decided_by: decidedBy, decided_at: now, decision_note: decisionNote }
      await appendLeaveAudit(id, 'edit-rejected', proposed, target, decidedBy)
      notificationRecord = { ...proposed, status: 'rejected', decision_note: decisionNote }
    }
    const next = current.map((row) => String(row.id) === String(id) ? record : row)
    await overwriteSheet('hr_leave', LEAVE_HEADERS, next.map((row) => LEAVE_HEADERS.map((header) => row[header] ?? '')))
    clearHrCache()
    try { await notifyLeaveDecision(notificationRecord) } catch (e) { console.error('notifyLeaveDecision:', e.message) }
    return { record }
  }
  if (target.status !== 'pending') return { error: 'คำขอนี้ถูกพิจารณาไปแล้ว', target }
  const record = { ...target, status: decision, decided_by: decidedBy, decided_at: now, decision_note: decisionNote, backup_assignments: backupRows.filter((row) => String(row.leave_id) === String(id)) }
  const next = current.map((r) => String(r.id) === String(id) ? record : r)
  await overwriteSheet('hr_leave', LEAVE_HEADERS, next.map((r) => LEAVE_HEADERS.map((h) => r[h] ?? '')))
  clearHrCache()
  try { await notifyLeaveDecision(record) } catch (e) { console.error('notifyLeaveDecision:', e.message) }
  return { record }
}

// แจ้งคนลากลับหลังถูกพิจารณา — คนละข้อความจาก notifyNewLeaveRequest (ที่ยิงหา admin) best-effort เหมือนกัน ห้ามทำให้การอนุมัติพัง
async function notifyLeaveDecision(record) {
  const links = await getSheet('hr_line_links')
  const link = links.find((l) => l.username === record.username && l.line_user_id)
  if (!link) return
  let balance = null
  if (record.status === 'approved' && record.leave_type === 'พักร้อน' && String(record.username || '').startsWith('mp:')) {
    try { balance = await vacationBalanceFor(record.username.slice(3)) } catch (e) { console.error('vacationBalanceFor:', e.message) }
  }
  const variant = record.status === 'pending' ? 'submitted' : record.status
  await pushMessage(link.line_user_id, [leaveFlexMessage(record, variant, await getOfficePeopleMap(), { balance })])
}

// รายชื่อ admin ที่ผูก LINE ไว้แล้ว (username, line_user_id) — ใช้ตอนแจ้งเตือนคำขอลาใหม่
async function getAdminLineTargets() {
  const [users, links] = await Promise.all([getSheet('users'), getSheet('hr_line_links')])
  const linkByUsername = Object.fromEntries(links.filter((l) => l.username && l.line_user_id).map((l) => [l.username, l.line_user_id]))
  return users.filter((u) => canManageOperations(u.role) && linkByUsername[u.username]).map((u) => ({ username: u.username, line_user_id: linkByUsername[u.username] }))
}

const recordBackupAssignments = (record) => Array.isArray(record.backup_assignments) ? record.backup_assignments : []
const backupAssignmentText = (record, officeMap = {}) => {
  const assignments = recordBackupAssignments(record)
  if (!assignments.length) return record.backup_office && officeMap[record.backup_office] ? officeMap[record.backup_office][0] : ''
  const grouped = new Map()
  for (const item of assignments) {
    const label = `${lineCompactDate(item.date)} ${item.period === 'am' ? 'เช้า' : 'บ่าย'}`
    const name = officeMap[item.office_code]?.[0] || item.office_code
    if (!grouped.has(label)) grouped.set(label, [])
    grouped.get(label).push(name)
  }
  return [...grouped.entries()].map(([label, names]) => `${label}: ${[...new Set(names)].join(', ')}`).join(' · ')
}
const backupOfficeLine = (leave, officeMap) => {
  const text = backupAssignmentText(leave, officeMap)
  return text ? `\nคนออฟฟิศทดแทน: ${text}` : ''
}
const understaffedLine = (l) => l.understaffed_dates ? `\n⚠️ คนไม่พอวันที่ ${l.understaffed_dates.split(',').join(', ')} ต้องหาคนแทน` : ''
const leaveSummaryText = (l, officeMap = {}) => l.cancel_requested
  ? `${l.employee_name} ขอยกเลิกวันลา${l.leave_type} วันที่ ${l.start_date}${l.end_date !== l.start_date ? ` – ${l.end_date}` : ''}${l.note ? `\nหมายเหตุ: ${l.note}` : ''}`
  : l.leave_type === 'สลับวันหยุด'
  ? `${l.employee_name} ขอสลับวันหยุด จาก ${l.start_date} เป็น ${l.end_date}${l.reason ? `\nเหตุผล: ${l.reason}` : ''}${backupOfficeLine(l, officeMap)}${understaffedLine(l)}`
  : `${l.employee_name} ขอลา${l.leave_type}\n${l.start_date}${Number(l.days) === 0.5 ? ' (ครึ่งวัน)' : l.end_date !== l.start_date ? ` – ${l.end_date}` : ''} · ${l.days} วัน${l.reason ? `\nเหตุผล: ${l.reason}` : ''}${backupOfficeLine(l, officeMap)}${understaffedLine(l)}`

const LINE_LEAVE_THEME = {
  pending: { title: 'คำขอลาใหม่', status: 'รออนุมัติ', icon: '⏰' },
  submitted: { title: 'ยังรออนุมัติอยู่นะคะ', status: 'รอหัวหน้าอนุมัติ', icon: '⏰' },
  approved: { title: 'คำขอลาได้รับการอนุมัติ', status: 'อนุมัติแล้ว', icon: '✅' },
  rejected: { title: 'คำขอลายังไม่ผ่าน', status: 'ไม่อนุมัติ', icon: '✕' },
  cancelled: { title: 'ยกเลิกรายการลาแล้ว', status: 'ยกเลิกแล้ว', icon: '↩️' },
}
const LINE_CARD = {
  sky: '#DDF3FF', skySoft: '#EFF9FF', skyStrong: '#C7EAFE', glass: '#FFFFFFCC',
  blue: '#4BAFE3', blueDark: '#16557E', ink: '#173F5C', muted: '#64849B', line: '#CBEAF9', white: '#FFFFFF',
}
const flexText = (text, options = {}) => ({ type: 'text', text: String(text ?? ''), color: LINE_CARD.ink, size: 'sm', wrap: true, scaling: true, ...options })
const lineDate = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '—'
const lineCompactDate = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' }) : '—'
const lineDateRange = (record) => record.start_date === record.end_date
  ? lineDate(record.start_date)
  : `${lineDate(record.start_date)} – ${lineDate(record.end_date)}`
const factRow = (label, value) => ({
  type: 'box', layout: 'horizontal', spacing: 'md',
  contents: [flexText(label, { size: 'xs', color: LINE_CARD.muted, flex: 2 }), flexText(value, { size: 'sm', weight: 'bold', color: LINE_CARD.blueDark, align: 'end', flex: 4 })],
})
const leaveTypeIcon = (type) => ({ 'พักร้อน': '🏖️', 'ลากิจ': '📌', 'ลาป่วย': '🏥', 'ขาดงาน': '⚠️', 'สลับวันหยุด': '🔁' }[type] || '📅')
const summaryTile = (label, value, backgroundColor, valueColor = '#17243B') => ({
  type: 'box', layout: 'vertical', flex: 1, paddingAll: '10px', cornerRadius: '14px', backgroundColor, alignItems: 'center',
  contents: [
    flexText(value, { size: 'xs', weight: 'bold', color: valueColor, align: 'center', wrap: false, adjustMode: 'shrink-to-fit' }),
    flexText(label, { size: 'xxs', color: LINE_CARD.muted, align: 'center', margin: 'xs', wrap: false, adjustMode: 'shrink-to-fit' }),
  ],
})

const lineCardHeader = (title, subtitle, icon, status = '') => ({
  type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: LINE_CARD.sky, contents: [
    { type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'md', paddingAll: '12px', cornerRadius: '18px', backgroundColor: LINE_CARD.glass, contents: [
      { type: 'box', layout: 'vertical', width: '44px', height: '44px', cornerRadius: '22px', backgroundColor: LINE_CARD.skyStrong, justifyContent: 'center', alignItems: 'center', contents: [flexText(icon, { size: 'xl', align: 'center' })] },
      { type: 'box', layout: 'vertical', flex: 1, contents: [
        flexText(title, { color: LINE_CARD.blueDark, size: 'md', weight: 'bold' }),
        flexText(subtitle, { color: LINE_CARD.muted, size: 'xs', margin: 'xs' }),
        ...(status ? [{ type: 'box', layout: 'vertical', alignItems: 'flex-start', margin: 'sm', contents: [
          { type: 'box', layout: 'vertical', paddingStart: '9px', paddingEnd: '9px', paddingTop: '4px', paddingBottom: '4px', cornerRadius: '12px', backgroundColor: LINE_CARD.skySoft, contents: [flexText(status, { size: 'xxs', color: LINE_CARD.blueDark, weight: 'bold', wrap: false })] },
        ] }] : []),
      ] },
    ] },
  ],
})

const lineCardButton = (action, primary = false) => ({
  type: 'button', style: primary ? 'primary' : 'secondary', color: primary ? LINE_CARD.blue : '#E4F5FD', height: 'sm', scaling: true, action,
})

// การ์ดเดียวกันทั้งแจ้ง admin และแจ้งผลกลับหาพนักงาน เพื่อให้สถานะอ่านได้เหมือนกันทุกจุด
const leaveFlexMessage = (record, variant = 'pending', officeMap = {}, { balance = null } = {}) => {
  const theme = LINE_LEAVE_THEME[variant] || LINE_LEAVE_THEME.pending
  const cardTitle = record.cancel_requested ? 'ขอยกเลิกวันลา' : record.is_edit_request ? 'คำขอแก้ไขวันลา' : theme.title
  const isSwap = record.leave_type === 'สลับวันหยุด'
  const facts = [factRow(isSwap ? 'วันหยุดเดิม → ใหม่' : 'วันที่ลา', isSwap ? `${lineDate(record.start_date)} → ${lineDate(record.end_date)}` : lineDateRange(record))]
  if (!isSwap) facts.push(factRow('ช่วงเวลา', leavePeriodLabel(normalizeLeavePeriod(record.leave_period, record.days))))
  if (record.reason) facts.push(factRow('เหตุผล', record.reason))
  if (record.backup_office || recordBackupAssignments(record).length) facts.push(factRow('คนทดแทน', backupAssignmentText(record, officeMap)))
  if (record.understaffed_dates) facts.push(factRow('⚠️ คนไม่พอ', `${record.understaffed_dates.split(',').map((d) => lineCompactDate(d)).join(', ')} ต้องหาคนแทน`))
  if (record.cancel_requested && record.note) facts.push(factRow('หมายเหตุ', record.note))
  if (record.decision_note) facts.push(factRow('หมายเหตุ', record.decision_note))
  if (balance) facts.push(factRow('พักร้อนคงเหลือ', `${balance.remaining} / ${balance.quota} วัน`))

  const bubble = {
    type: 'bubble', size: 'kilo',
    header: lineCardHeader(cardTitle, record.employee_name || 'พนักงาน', theme.icon, record.cancel_requested ? 'รอ HR ยืนยันการยกเลิก' : record.is_edit_request ? 'รอ HR ยืนยันการแก้ไข' : theme.status),
    body: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'md', backgroundColor: '#FBFEFF', contents: [
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        summaryTile('ประเภท', `${leaveTypeIcon(record.leave_type)} ${record.leave_type}`, LINE_CARD.skySoft, LINE_CARD.blueDark),
        summaryTile('จำนวน', `${record.days} วัน`, LINE_CARD.sky, LINE_CARD.blueDark),
        summaryTile('วันเริ่ม', lineCompactDate(record.start_date), '#F5FBFF', LINE_CARD.blueDark),
      ] },
      { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', cornerRadius: '14px', backgroundColor: LINE_CARD.skySoft, contents: facts },
    ] },
  }
  if (variant === 'pending') bubble.footer = { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', backgroundColor: LINE_CARD.skySoft, contents: [
    lineCardButton({ type: 'postback', label: 'ไม่อนุมัติ', data: `hr-reject:${record.id}`, displayText: 'ไม่อนุมัติคำขอลา' }),
    lineCardButton({ type: 'postback', label: 'อนุมัติ', data: `hr-approve:${record.id}`, displayText: 'อนุมัติคำขอลา' }, true),
  ] }
  if (['submitted', 'approved'].includes(variant) && !record.is_edit_request) bubble.footer = { type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: LINE_CARD.skySoft, contents: [
    lineCardButton({ type: 'postback', label: 'แก้ไขคำขอนี้', data: `hr-wiz-edit-direct:${record.id}`, displayText: 'แก้ไขคำขอลา' }),
  ] }
  return { type: 'flex', altText: `${theme.title}: ${leaveSummaryText(record, officeMap)}`.slice(0, 400), contents: bubble }
}

// แจ้งเตือน admin ที่ผูก LINE ไว้ทุกคน พร้อมปุ่มอนุมัติ/ปฏิเสธ — best-effort ล้วนๆ ห้ามทำให้คำขอลาพัง แม้ LINE ล่ม
async function notifyNewLeaveRequest(record) {
  const targets = await getAdminLineTargets()
  if (!targets.length) return
  const officeMap = await getOfficePeopleMap()
  const message = leaveFlexMessage(record, 'pending', officeMap)
  await Promise.all(targets.map((t) => pushMessage(t.line_user_id, [message])))
}

async function notifyNewLeaveRequestSafely(record) {
  try { await notifyNewLeaveRequest(record) } catch (e) { console.error('notifyNewLeaveRequest:', e.message) }
}

// ── แจ้งเตือนของใกล้หมด/หมด ผ่านไลน์ (cron วันละครั้ง) + สั่งของจากในแชทได้เลย ──
// ใช้ helper การ์ด LINE ชุดเดียวกับ leaveFlexMessage ด้านบน (LINE_CARD/lineCardHeader/lineCardButton/factRow)
const STOCK_ALERT_RUNS_SHEET = 'stock_alert_runs'
const STOCK_ALERT_RUNS_HEADERS = ['date', 'sent_at', 'item_count']
const STOCK_ORDER_SESSION_SHEET = 'stock_order_sessions'
const STOCK_ORDER_SESSION_HEADERS = ['line_user_id', 'step', 'sku', 'qty', 'updated_at']
const STOCK_STATUS_ICON = { 'หมด': '🔴', 'ใกล้หมด': '🟠' }
const todayBKK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
// ตั้งบน Vercel เป็น URL จริงของเว็บ (เช่น https://payiops.vercel.app) — ใช้สร้างปุ่ม "เปิดเว็บ" ใน LINE
// ไม่ตั้งไว้ = ข้ามปุ่มนี้เฉยๆ ไม่พัง (เผื่อยังไม่ได้ตั้งตอน deploy รอบแรก)
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/$/, '')
const stockWebUrl = () => `${APP_BASE_URL}/?tab=StockMovement`

function lowStockBubble(item) {
  const facts = [factRow('คงเหลือ', `${item.balance} ${item.unit || 'ชิ้น'}`), factRow('สถานะ', item.effectiveStatus)]
  if (item.recommendedOrder) facts.push(factRow('แนะนำสั่ง', `${item.recommendedOrder} ${item.unit || 'ชิ้น'}`))
  return {
    type: 'bubble', size: 'kilo',
    header: lineCardHeader('ของใกล้หมด', item.display_name, STOCK_STATUS_ICON[item.effectiveStatus] || '⚠️', item.effectiveStatus),
    body: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'md', backgroundColor: '#FBFEFF', contents: [
      { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', cornerRadius: '14px', backgroundColor: LINE_CARD.skySoft, contents: facts },
    ] },
    footer: { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', backgroundColor: LINE_CARD.skySoft, contents: [
      lineCardButton({ type: 'postback', label: 'สั่งของ', data: `stock-order:${item.sku}`, displayText: `สั่งของ ${item.display_name}` }, true),
    ] },
  }
}

// carousel รองรับสูงสุด 12 การ์ด (ข้อจำกัดของ LINE) — เกินกว่านั้นแปะการ์ดสรุป "+N รายการ" พร้อมลิงก์เข้าเว็บแทน
function lowStockFlexMessage(items) {
  const bubbles = items.slice(0, 12).map(lowStockBubble)
  if (APP_BASE_URL || items.length > 12) {
    bubbles.push({
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', spacing: 'md', justifyContent: 'center', contents: [
        flexText(items.length > 12 ? `+ อีก ${items.length - 12} รายการ` : 'ดูรายละเอียดทั้งหมดที่เว็บ', { size: 'sm', weight: 'bold', wrap: true }),
        ...(APP_BASE_URL ? [lineCardButton({ type: 'uri', label: 'เปิดเว็บ', uri: stockWebUrl() }, true)] : []),
      ] },
    })
  }
  return { type: 'flex', altText: `แจ้งเตือนของใกล้หมด/หมด ${items.length} รายการ`, contents: { type: 'carousel', contents: bubbles } }
}

// entry point ของ Vercel Cron (vercel.json) — ต้องข้าม requireAuth ปกติเพราะ cron ไม่มี user token
// (เหมือน line-webhook) ใช้ CRON_SECRET (Vercel ส่ง Authorization: Bearer อัตโนมัติเมื่อตั้ง env ไว้) แทน
// dry=1 ไว้ทดสอบ local โดยไม่ยิงข้อความจริง — คืนรายการที่คำนวณได้กลับมาเป็น JSON เฉยๆ
async function opLowStockCron(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const auth = req.headers.authorization || ''
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' })
  const dryRun = req.query.dry === '1'
  try {
    await ensureSheet(STOCK_ALERT_RUNS_SHEET, STOCK_ALERT_RUNS_HEADERS)
    const today = todayBKK()
    if (!dryRun) {
      const runs = await getSheet(STOCK_ALERT_RUNS_SHEET)
      if (runs.some((r) => r.date === today)) return res.status(200).json({ success: true, skipped: 'already sent today' })
    }

    const lowItems = await computeLowStockList()
    if (dryRun) return res.status(200).json({ success: true, dryRun: true, item_count: lowItems.length, items: lowItems })

    if (!lowItems.length) {
      await appendRows(STOCK_ALERT_RUNS_SHEET, [[today, new Date().toISOString(), 0]])
      return res.status(200).json({ success: true, item_count: 0 })
    }

    const targets = await getAdminLineTargets()
    if (targets.length) await Promise.all(targets.map((t) => pushMessage(t.line_user_id, [lowStockFlexMessage(lowItems)])))
    await appendRows(STOCK_ALERT_RUNS_SHEET, [[today, new Date().toISOString(), lowItems.length]])
    return res.status(200).json({ success: true, item_count: lowItems.length, notified: targets.length })
  } catch (e) {
    console.error('opLowStockCron:', e.message)
    return res.status(500).json({ success: false, error: e.message })
  }
}

const getStockOrderSessions = () => getSheet(STOCK_ORDER_SESSION_SHEET)
async function upsertStockOrderSession(lineUserId, patch) {
  await ensureSheet(STOCK_ORDER_SESSION_SHEET, STOCK_ORDER_SESSION_HEADERS)
  const current = await getStockOrderSessions()
  const existing = current.find((r) => r.line_user_id === lineUserId) || { line_user_id: lineUserId, step: '', sku: '', qty: '' }
  const next = { ...existing, ...patch, updated_at: new Date().toISOString() }
  const rows = current.filter((r) => r.line_user_id !== lineUserId).map((r) => STOCK_ORDER_SESSION_HEADERS.map((h) => r[h] ?? ''))
  rows.push(STOCK_ORDER_SESSION_HEADERS.map((h) => next[h] ?? ''))
  await overwriteSheet(STOCK_ORDER_SESSION_SHEET, STOCK_ORDER_SESSION_HEADERS, rows)
  return next
}
async function clearStockOrderSession(lineUserId) {
  await ensureSheet(STOCK_ORDER_SESSION_SHEET, STOCK_ORDER_SESSION_HEADERS)
  const current = await getStockOrderSessions()
  const rows = current.filter((r) => r.line_user_id !== lineUserId).map((r) => STOCK_ORDER_SESSION_HEADERS.map((h) => r[h] ?? ''))
  await overwriteSheet(STOCK_ORDER_SESSION_SHEET, STOCK_ORDER_SESSION_HEADERS, rows)
}

// เฉพาะบอส/dev สั่งของผ่านไลน์ได้ — เทียบ line_user_id -> hr_line_links (username ธรรมดา ไม่ใช่ mp: ของพนักงาน) -> users.role
async function findManagerLink(lineUserId) {
  const links = await getSheet('hr_line_links')
  const link = links.find((l) => l.line_user_id === lineUserId && !String(l.username || '').startsWith('mp:'))
  if (!link) return null
  const user = (await getSheet('users')).find((u) => u.username === link.username)
  if (!user || !canManageOperations(user.role)) return null
  return { username: link.username, name: user.display_name || link.username, role: user.role }
}

// กดปุ่ม "สั่งของ" บนการ์ดแจ้งเตือน — เริ่ม session รอบอสพิมพ์จำนวนกลับมาในแชท (ไม่ใช้ปุ่มจำนวนสำเร็จรูป
// ตามที่ owner ขอ ให้พิมพ์เองได้ยืดหยุ่นกว่า) ต่างจาก approve/reject วันลาที่กดปุ่มจบในทีเดียว
// ใช้ร่วมกันทั้งกดปุ่มจากการ์ดแจ้งเตือน (handleStockOrderPostback) และเลือกจากผลค้นหา (handleStockPickPostback)
async function askOrderQty(replyToken, lineUserId, item) {
  await upsertStockOrderSession(lineUserId, { step: 'await_qty', sku: item.sku, qty: '' })
  await replyMessage(replyToken, [{ type: 'text', text: `สั่ง "${item.display_name}" กี่${item.unit || 'ชิ้น'}คะ? พิมพ์ตัวเลขได้เลย\nคงเหลือตอนนี้ ${item.balance} ${item.unit || 'ชิ้น'}` }])
}

async function handleStockOrderPostback(event, sku) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const manager = lineUserId ? await findManagerLink(lineUserId) : null
  if (!manager) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }])

  const { items } = await loadItemsWithBalance({ includeHidden: false })
  const item = items.find((it) => String(it.sku).toUpperCase() === String(sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ' }])
  await askOrderQty(replyToken, lineUserId, item)
}

// พิมพ์ "สั่งของ" เฉยๆ (ไม่ต้องรอการ์ดแจ้งเตือน) — สั่งของที่ยังปกติ (ไม่ใกล้หมด) ได้ด้วย ต่างจากปุ่มบนการ์ด
// ที่จำกัดแค่ของใกล้หมด/หมดเท่านั้น เริ่ม session ถามชื่อ/SKU ก่อน แล้วค่อยถามจำนวนต่อ (handleStockOrderSearchReply)
async function handleStockOrderSearchStart(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return false
  const manager = lineUserId ? await findManagerLink(lineUserId) : null
  if (!manager) return false // ไม่ใช่บอส/dev — ปล่อยให้ตกไป fallback เดิม (echo userId) ไม่ตอบอะไรพิเศษ
  await upsertStockOrderSession(lineUserId, { step: 'await_sku_search', sku: '', qty: '' })
  await replyMessage(replyToken, [{ type: 'text', text: 'จะสั่งอะไรคะ? พิมพ์ชื่อสินค้าหรือ SKU ได้เลย' }])
  return true
}

// พิมพ์ชื่อ/SKU ค้นหา (ขั้นตอนต่อจาก handleStockOrderSearchStart หรือพิมพ์ใหม่ตอนเลือกจากรายการเดิมไม่เจอ) —
// เจอตัวเดียวข้ามไปถามจำนวนเลย เจอหลายตัวโชว์เป็น quick reply ให้เลือก (สูงสุด 10 ตามลิมิต quick reply ของ LINE)
async function handleStockOrderSearchReply(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const query = String(event.message?.text || '').trim().toLowerCase()
  if (!query) return replyMessage(replyToken, [{ type: 'text', text: 'พิมพ์ชื่อสินค้าหรือ SKU ได้เลยค่ะ' }])

  const { items } = await loadItemsWithBalance({ includeHidden: false })
  const matches = items.filter((it) => it.display_name.toLowerCase().includes(query) || String(it.sku).toLowerCase().includes(query)).slice(0, 10)
  if (!matches.length) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ค่ะ ลองพิมพ์คำอื่นดู' }])
  if (matches.length === 1) return askOrderQty(replyToken, lineUserId, matches[0])

  await upsertStockOrderSession(lineUserId, { step: 'await_sku_pick', sku: '', qty: '' })
  await replyMessage(replyToken, [{
    type: 'text', text: `พบ ${matches.length} รายการ เลือกได้เลยค่ะ`,
    quickReply: { items: matches.map((it) => ({ type: 'action', action: { type: 'postback', label: it.display_name.slice(0, 20), data: `stock-pick:${it.sku}`, displayText: it.display_name } })) },
  }])
}

async function handleStockPickPostback(event, sku) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const manager = lineUserId ? await findManagerLink(lineUserId) : null
  if (!manager) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }])
  const { items } = await loadItemsWithBalance({ includeHidden: false })
  const item = items.find((it) => String(it.sku).toUpperCase() === String(sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ' }])
  await askOrderQty(replyToken, lineUserId, item)
}

// พิมพ์จำนวนกลับมาในแชท (ขั้นตอนต่อจาก handleStockOrderPostback) — createOrderRequest ตัวเดียวกับที่
// ปุ่ม "สั่งของ" บนหน้า Stock Movement ใช้ (StockMovement.jsx) ผลลัพธ์เลยไปโผล่ที่ "สั่งไว้ รอของเข้า" เหมือนกันเป๊ะ
async function handleStockOrderQtyReply(event, session) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const text = String(event.message?.text || '').trim().replace(/,/g, '')
  const qty = Number(text)
  if (!Number.isFinite(qty) || qty <= 0) return replyMessage(replyToken, [{ type: 'text', text: 'กรุณาพิมพ์เป็นตัวเลขค่ะ เช่น 100' }])

  const manager = await findManagerLink(lineUserId)
  if (!manager) { await clearStockOrderSession(lineUserId); return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }]) }

  try {
    await createOrderRequest({ sku: session.sku, qty, note: 'สั่งจาก LINE' }, manager.name, manager.role)
    await clearStockOrderSession(lineUserId)
    const footerButtons = APP_BASE_URL ? [lineCardButton({ type: 'uri', label: 'เปิดเว็บ', uri: stockWebUrl() }, true)] : []
    await replyMessage(replyToken, [{
      type: 'flex', altText: `สั่งของ ${session.sku} x${qty} เรียบร้อย`,
      contents: {
        type: 'bubble', size: 'kilo',
        header: lineCardHeader('สั่งของเรียบร้อย', `${session.sku} × ${qty}`, '✅', 'บันทึกแล้ว'),
        ...(footerButtons.length ? { footer: { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', backgroundColor: LINE_CARD.skySoft, contents: footerButtons } } : {}),
      },
    }])
  } catch (e) {
    await replyMessage(replyToken, [{ type: 'text', text: `สั่งของไม่สำเร็จ: ${e.message}` }])
  }
}

const PLANNER_CONFIG_SHEET = 'planner_config'
const PLANNER_DAILY_SHEET = 'planner_daily'
const PLANNER_CONFIG_HEADERS = ['master_sku', 'enabled', 'reserve_days', 'safety_percent', 'updated_at', 'updated_by']
const PLANNER_DAILY_HEADERS = ['id', 'date', 'master_sku', 'fg', 'sales_average', 'demand_mode', 'recommended_feed', 'planned_feed', 'feeders', 'updated_at', 'updated_by']
const WORKFORCE_SHEETS = [['workforce_ot', OT_HEADERS], ['workforce_manpower', MANPOWER_HEADERS], ['workforce_events', EVENT_HEADERS], ['workforce_ot_history', OT_HISTORY_HEADERS], ['workforce_ot_approvals', OT_APPROVAL_HEADERS], ['workforce_people', PEOPLE_HEADERS], ['workforce_ot_limits', OT_LIMIT_HEADERS], ['workforce_ot_approval_history', OT_APPROVAL_HISTORY_HEADERS], ['workforce_schedule_snapshot', SCHEDULE_SNAPSHOT_HEADERS], ['workforce_schedule_overrides', SCHEDULE_OVERRIDE_HEADERS], ['workforce_dayrecords', DAYRECORD_HEADERS]]
let workforceEnsurePromise
let workforceCache = { at: 0, data: null }
const ensureWorkforceSheets = () => workforceEnsurePromise ||= Promise.all(WORKFORCE_SHEETS.map(([name, headers]) => ensureSheet(name, headers)))
// กลุ่มพื้นเหลืองในไฟล์ต้นฉบับ (TOON/KED/MO) เป็นอีกหน่วยงาน (ออฟฟิศ) ไม่ใช่บ้านล่าง — ไม่ต้องเพิ่มแถวใน workforce_people ให้กลุ่มนั้น จึงไม่ถูกดึงเข้าปฏิทินนี้
// รายชื่อบ้านล่างตอนเริ่มระบบ ใช้ seed แท็บ workforce_people ครั้งแรกเท่านั้น — หลังจากนี้แก้/เพิ่มคนได้ตรงในชีตเลย ไม่ต้องแก้โค้ด
const DEFAULT_PEOPLE_ROWS = [['TANG', 'แตง', 'คนแพ็ก', '1'], ['PANG', 'แป้ง', 'คนแพ็ก', '1'], ['FAH', 'ฟ้า', 'คนแพ็ก', '1'], ['MII', 'มี่', 'คนแพ็ก', '1'], ['PANID', 'ป้านิด', 'คนฟีด', '1'], ['MOM', 'แม่', 'คนฟีด', '1'], ['MAPRANG', 'มะปราง', 'พาร์ทไทม์', '1'], ['ATOM', 'อะตอม', 'อื่น ๆ', '1'], ['BAS', 'บาส', 'อื่น ๆ', '1'], ['NEOY', 'เนย', 'อื่น ๆ', '1']]
const rowsToObjects = (values = []) => { const [headers, ...rows] = values; return headers ? rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))) : [] }
// workforce_ot_approvals/workforce_ot_limits เป็น append-only log (ไม่ overwrite แถวเดิม) — กัน race condition ตอนแก้พร้อมกันหลายเครื่อง
// อ่านตอน GET ต้องลดเหลือ "ล่าสุดต่อ key" เอง
const latestByKey = (rows, keyFn, timeField) => { const map = new Map(); for (const r of rows) { const k = keyFn(r); const prev = map.get(k); if (!prev || String(r[timeField]) >= String(prev[timeField])) map.set(k, r) } return [...map.values()] }
const requireAdmin = (req, res) => { if (authEnabled() && !canManageOperations(req.user?.role)) { res.status(403).json({ error: 'ต้องเป็น Boss หรือ Dev เท่านั้น' }); return false } return true }
// staff (แตง) ได้สิทธิ์แก้ตารางกะในปฏิทิน Manpower&OT เพิ่มเติมจาก boss/dev — เฉพาะ action นี้จุดเดียว
const requireScheduleEditor = (req, res) => { if (authEnabled() && !canManageOperations(req.user?.role) && req.user?.role !== 'staff') { res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ตารางกะ' }); return false } return true }
const clearWorkforceCache = () => { workforceCache = { at: 0, data: null } }

async function getPersonMap() {
  const people = await getSheet('workforce_people')
  if (!people.length) { await appendRows('workforce_people', DEFAULT_PEOPLE_ROWS); return getPersonMap() }
  const map = Object.fromEntries(DEFAULT_PEOPLE_ROWS.map(([code, name, group]) => [code, [name, group]]))
  for (const p of people) {
    if (!p.code) continue
    const code = String(p.code).toUpperCase()
    if (String(p.active) === '0') { delete map[code]; continue } // ลบออกแล้ว (soft-delete จากปุ่มในหน้าเว็บ) — ตัดออกจาก roster ทุกที่
    const forcedName = code === 'PANID' ? 'ป้านิด' : code === 'MOM' ? 'แม่' : ''
    // เดิมล็อกกลุ่มของ PANID/MOM ให้เป็น "คนฟีด" เสมอ แก้ในชีตไม่มีผล — ทำให้เปลี่ยนเป็นพาร์ทไทม์ (ตัดออกจากโควตาพักร้อน) ไม่ได้เลย
    // เลิกล็อก ให้กลุ่มตามชีตจริง — ปฏิทิน OT ยังจับ PANID/MOM เป็นคนฟีดถูกต้องอยู่ดี เพราะเช็คจาก code ตรงๆ ด้วย ไม่ได้เช็คแค่ group (ดู WorkforceOT.jsx feedManpower)
    map[code] = [forcedName || p.name || map[code]?.[0] || code, p.group || 'อื่น ๆ']
  }
  return map
}

// กลุ่มออฟฟิศ — ชีตแยกจาก workforce_people (จงใจไม่รวม เพราะไม่ต้องการให้ขึ้นปฏิทิน Manpower & OT/ นับ headcount บ้านล่าง)
// เพิ่ม/ลบคนได้จากปุ่มในหน้าเว็บ (action add-employee/remove-employee, group='ออฟฟิศ') — ลบ = ตั้ง active='0' ไม่ลบแถวทิ้งจริง กันประวัติ leave หาย
async function getOfficePeopleMap() {
  const rows = await getSheet('hr_office_people')
  if (!rows.length) { await appendRows('hr_office_people', DEFAULT_OFFICE_ROWS); return getOfficePeopleMap() }
  const map = {}
  for (const r of rows) {
    if (!r.code) continue
    if (String(r.active) === '0') continue
    map[String(r.code).toUpperCase()] = [r.name || r.code, 'ออฟฟิศ']
  }
  return map
}
// คนหนึ่งคนสำหรับระบบลา/LINE — เช็ค workforce_people ก่อน (บ้านล่าง) แล้วค่อย fallback ไปกลุ่มออฟฟิศ
async function findHrPerson(code) {
  const normalizedCode = String(code || '').toUpperCase()
  const fromSheet = (await getSheet('workforce_people')).find((p) => String(p.code || '').toUpperCase() === normalizedCode && String(p.active) !== '0')
  if (fromSheet) return { code: normalizedCode, name: fromSheet.name, group: fromSheet.group || 'อื่น ๆ' }
  const officeMap = await getOfficePeopleMap()
  const extra = officeMap[normalizedCode]
  return extra ? { code: normalizedCode, name: extra[0], group: extra[1] } : null
}

// ── โควตาวันลาพักร้อน ──
async function getQuotaMap() {
  const rows = await getSheet('hr_leave_quota')
  return Object.fromEntries(rows.filter((r) => r.code).map((r) => {
    const quota = Number(r.quota)
    return [String(r.code).toUpperCase(), Number.isFinite(quota) && quota >= 0 ? quota : DEFAULT_VACATION_QUOTA]
  }))
}
// เหลือกี่วันพักร้อนของคนนี้ปีนี้ — นับจาก hr_leave ที่ status=approved, leave_type=พักร้อน, ปีปฏิทินเดียวกัน (ตาม start_date)
async function vacationBalanceFor(code) {
  const [leaveRows, quotaMap, person] = await Promise.all([getSheet('hr_leave'), getQuotaMap(), findHrPerson(code)])
  if (person && !hasVacationBenefit(person.group)) return { eligible: false, quota: 0, used: 0, remaining: 0 }
  const year = currentYearBKK()
  const used = leaveRows
    .filter((l) => l.status === 'approved' && l.leave_type === 'พักร้อน' && l.username === `mp:${code}` && String(l.start_date || '').slice(0, 4) === year)
    .reduce((s, l) => s + (Number(l.days) || 0), 0)
  const quota = quotaMap[code] ?? DEFAULT_VACATION_QUOTA
  return { eligible: true, quota, used, remaining: Math.max(0, quota - used) }
}
// สรุปโควตาพักร้อนทุกคน — includeOffice=false ตัดกลุ่มออฟฟิศออก (ผจก.บ้านล่างไม่ต้องเห็น)
// คนฟีดและพาร์ทไทม์ไม่มีโควตาพักร้อน — ตัดออกจากการ์ดนี้และทุก flow ที่ขอพักร้อน
async function computeLeaveBalances(leaveRows, includeOffice) {
  const [personMap, quotaMap, officeMap] = await Promise.all([getPersonMap(), getQuotaMap(), includeOffice ? getOfficePeopleMap() : {}])
  const year = currentYearBKK()
  const roster = [
    ...Object.entries(personMap).map(([code, [name, group]]) => ({ code, name, group })),
    ...(includeOffice ? Object.entries(officeMap).map(([code, [name, group]]) => ({ code, name, group })) : []),
  ].filter((p) => hasVacationBenefit(p.group))
  return roster.map((p) => {
    const used = leaveRows
      .filter((l) => l.status === 'approved' && l.leave_type === 'พักร้อน' && l.username === `mp:${p.code}` && String(l.start_date || '').slice(0, 4) === year)
      .reduce((s, l) => s + (Number(l.days) || 0), 0)
    const quota = quotaMap[p.code] ?? DEFAULT_VACATION_QUOTA
    return { code: p.code, name: p.name, group: p.group, quota, used, remaining: Math.max(0, quota - used) }
  })
}

// ── เช็คกำลังคนบ้านล่างและคนออฟฟิศทดแทนแบบรายวัน/เช้า/บ่าย ──
const LOWER_HOUSE_MIN_HEADCOUNT = MIN_LOWER_HOUSE_HEADCOUNT
const decorateBackupNeeds = (needs, officeMap) => needs.map((need) => ({
  ...need,
  candidates: need.candidates.map((code) => ({ code, name: officeMap[code]?.[0] || code })),
}))

async function inspectLeaveCoverage(username, proposedLeave, excludeLeaveId = '') {
  if (!String(username || '').startsWith('mp:')) return { ok: true, needs: [], assignments: [] }
  const code = username.slice(3).toUpperCase()
  const [personMap, officeMap, allLeaveRows, allBackupRows] = await Promise.all([
    getPersonMap(), getOfficePeopleMap(), getSheet('hr_leave'), getSheet('hr_leave_backups'),
  ])
  const scheduleRows = await getCalendarPresence({ ...personMap, ...officeMap }, Object.keys(personMap), false)
  const leaveRows = allLeaveRows.filter((row) => String(row.id) !== String(excludeLeaveId || ''))
  const backupRows = allBackupRows.filter((row) => String(row.leave_id) !== String(excludeLeaveId || ''))
  if (officeMap[code]) {
    // เดิมบล็อกถ้าคนออฟฟิศคนนี้ถูกจัดเป็นคนทดแทนที่อื่นไปแล้ว — ตอนนี้ไม่บล็อกอีกต่อไป (เผื่อฉุกเฉิน) แค่เตือนว่าคนไม่พอ
    const conflicts = officeLeaveConflicts({ officeCode: code, proposedLeave, leaveRows, backupRows })
    const understaffedDates = [...new Set(conflicts.map((row) => row.date))]
    return { ok: true, blocked: false, needs: [], assignments: [], understaffedDates }
  }
  const plan = buildCoveragePlan({
    employeeCode: code,
    proposedLeave,
    lowerCodes: Object.keys(personMap),
    officeCodes: Object.keys(officeMap),
    scheduleRows,
    leaveRows,
    backupRows,
    minimum: LOWER_HOUSE_MIN_HEADCOUNT,
  })
  const needs = decorateBackupNeeds(plan.needs, officeMap)
  // ไม่บล็อกการลาอีกต่อไปแม้คนออฟฟิศไม่พอ (เผื่อกรณีฉุกเฉิน) — แค่ทำเครื่องหมายวันที่ขาดคนไว้เตือนแทน
  const understaffedDates = [...new Set(plan.needs.filter((need) => need.candidates.length < need.required).map((need) => need.date))]
  return { ok: true, blocked: false, needs, rawNeeds: plan.needs, understaffedDates }
}

async function resolveLeaveCoverage(username, proposedLeave, submittedAssignments = [], excludeLeaveId = '') {
  const inspection = await inspectLeaveCoverage(username, proposedLeave, excludeLeaveId)
  if (!inspection.ok) return inspection // ยังบล็อกกรณีจริง: คนออฟฟิศคนนั้นถูกจองเป็นคนแทนของคนอื่นไปแล้ว (ชนกันจริง ไม่ใช่แค่คนไม่พอ)
  const needs = inspection.rawNeeds || []
  const selections = Array.isArray(submittedAssignments) ? submittedAssignments : []
  const assignments = []
  const understaffedDates = new Set(inspection.understaffedDates || [])
  for (const need of needs) {
    const chosen = [...new Set(selections.filter((item) => item.date === need.date && item.period === need.period).map((item) => String(item.office_code || '').toUpperCase()).filter(Boolean))]
      .filter((code) => need.candidates.includes(code))
    for (const code of chosen.slice(0, need.required)) assignments.push({ date: need.date, period: need.period, office_code: code })
    if (chosen.length < need.required) understaffedDates.add(need.date)
  }
  return { ok: true, blocked: false, needs: inspection.needs, assignments, understaffedDates: [...understaffedDates] }
}

function normalizeEditableLeave(body, fallback = {}) {
  const leaveType = String(body.leave_type || fallback.leave_type || '').trim()
  const startDate = String(body.start_date || fallback.start_date || '')
  const isSwap = leaveType === 'สลับวันหยุด'
  const leavePeriod = isSwap ? 'full' : normalizeLeavePeriod(body.leave_period || fallback.leave_period, fallback.days)
  const halfDay = ['am', 'pm'].includes(leavePeriod) && !isSwap
  const endDate = halfDay ? startDate : String(body.end_date || fallback.end_date || '')
  if (!leaveType || !startDate || !endDate) return { error: 'กรุณาระบุประเภทและวันที่ลาให้ครบค่ะ' }
  if (!isSwap && endDate < startDate) return { error: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มค่ะ' }
  return {
    draft: {
      leave_type: leaveType, start_date: startDate, end_date: endDate,
      leave_period: leavePeriod, days: isSwap ? 1 : halfDay ? 0.5 : daysBetween(startDate, endDate),
      reason: String(body.reason ?? fallback.reason ?? '').trim(),
    },
  }
}

// code -> date -> Set(am/pm) เพื่อให้ปฏิทินแสดงลาครึ่งวันเป็นกำลังคน 0.5 แทนการหายทั้งวัน
function buildLeaveAbsenceMap(leaveRows) {
  const absenceByCode = {}
  for (const l of leaveRows) {
    if (l.status !== 'approved') continue
    if (!String(l.username || '').startsWith('mp:')) continue
    const code = l.username.slice(3)
    for (const slot of leaveAbsenceSlots(l)) {
      absenceByCode[code] ||= {}
      absenceByCode[code][slot.date] ||= new Set()
      absenceByCode[code][slot.date].add(slot.period)
    }
  }
  return absenceByCode
}
const absenceFraction = (absenceByCode, code, date) => (absenceByCode[code]?.[date]?.size || 0) / 2
// fallback เมื่อยังไม่มีตารางพนักงาน — สมมติทุกคนมาทำงานทุกวัน ยกเว้นวันที่มีคำขอลาอนุมัติแล้ว
function generateCalendarPresence(personMap, leaveRows) {
  const absenceByCode = buildLeaveAbsenceMap(leaveRows)
  const roster = Object.entries(personMap).map(([code, [name, group]]) => ({ code, name, group }))
  const start = new Date(`${todayStr()}T00:00:00`); start.setDate(start.getDate() - 90)
  const end = new Date(`${todayStr()}T00:00:00`); end.setDate(end.getDate() + 180)
  const result = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    for (const p of roster) {
      const fraction = Math.max(0, 1 - absenceFraction(absenceByCode, p.code, date))
      if (!fraction) continue
      result.push({ id: `internal-${date}-${p.code}`, date, employee: p.name, code: p.code, group: p.group, fraction, source: 'internal' })
    }
  }
  return result
}
// ปฏิทินบ้านล่างใช้ตารางพนักงานปี 2026 ในระบบ และกรองแถวออฟฟิศออกด้วย roster บ้านล่าง
// ถ้ามีคำขอลาอนุมัติผ่านระบบ ให้ยึด hr_leave แทนตารางตั้งต้น
async function getCalendarPresence(personMap, overrideScopeCodes = Object.keys(personMap), applyLeaves = true, officeCodes = []) {
  const [snapshotRows, overrideRows, leaveRows] = await Promise.all([
    getSheet('workforce_schedule_snapshot'), getSheet('workforce_schedule_overrides'), getSheet('hr_leave'),
  ])
  let baseRows = (snapshotRows.length ? snapshotRows : generateCalendarPresence(personMap, []))
    .filter((r) => personMap[String(r.code || '').toUpperCase()])
    .map((r) => ({ id: `stored-${r.date}-${r.code}`, date: r.date, employee: r.employee, code: String(r.code || '').toUpperCase(), group: r.group, fraction: Number(r.fraction) || 1, source: 'stored' }))
  baseRows = applyScheduleOverrides({ baseRows, overrideRows, personMap, overrideScopeCodes, officeCodes })
  if (!applyLeaves) return baseRows
  const absenceByCode = buildLeaveAbsenceMap(leaveRows)
  return baseRows.map((row) => ({ ...row, fraction: Math.max(0, row.fraction - absenceFraction(absenceByCode, row.code, row.date)) })).filter((row) => row.fraction > 0)
}

const minutesBetween = (start, end) => {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number)
  let n = (eh * 60 + em) - (sh * 60 + sm)
  if (n < 0) n += 1440
  return Math.max(0, n)
}
const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))
const clockMinutes = (v) => { const [h, m] = String(v).split(':').map(Number); return h * 60 + m }
const overlaps = (aStart, aEnd, bStart, bEnd) => clockMinutes(aStart) < clockMinutes(bEnd) && clockMinutes(bStart) < clockMinutes(aEnd)

async function opWorkforce(req, res) {
  try {
    return await opWorkforceInner(req, res)
  } catch (e) {
    console.error('opWorkforce:', e)
    return res.status(500).json({ error: e.message })
  }
}

async function opWorkforceInner(req, res) {
  const actorName = () => req.user?.name || null
  if (req.method === 'GET' && String(req.query.sourceOnly || '') === '1') {
    try {
      await ensureWorkforceSheets()
      const [personMap, officeMap] = await Promise.all([getPersonMap(), getOfficePeopleMap()])
      const sourceManpower = await getCalendarPresence({ ...personMap, ...officeMap }, Object.keys(personMap), true, Object.keys(officeMap))
      return res.status(200).json({ success: true, sourceManpower, sourceYear: '2026' })
    } catch (e) { return res.status(500).json({ success: false, error: e.message }) }
  }
  await ensureWorkforceSheets()
  if (req.method === 'GET') {
    if (workforceCache.data && Date.now() - workforceCache.at < 20000) return res.status(200).json(workforceCache.data)
    const ranges = WORKFORCE_SHEETS.map(([name]) => `${name}!A:Z`)
    const values = await batchGetValues(ranges)
    const [rows, manpower, events, history, rawApprovals, people, rawLimits, approvalHistory] = values.map((range) => rowsToObjects(range.values || []))
    const dayRecords = rowsToObjects(values[WORKFORCE_SHEETS.findIndex(([name]) => name === 'workforce_dayrecords')].values || [])
    const approvals = latestByKey(rawApprovals, (r) => `${r.month}|${r.employee}`, 'approved_at')
    const limits = latestByKey(rawLimits, (r) => r.employee, 'updated_at')
    const personMap = await getPersonMap() // ต้องผ่าน getPersonMap() ไม่ใช่ build จาก people ตรงๆ — เผื่อชีตยังไม่มีแถวของบางคน (เช่น MOM/PANID) ต้อง fallback ไป DEFAULT_PEOPLE_ROWS ไม่งั้นหายจากปฏิทิน
    const otLimits = Object.fromEntries(limits.filter((l) => l.employee).map((l) => [l.employee, l.limit_hours]))
    let sourceManpower = []
    let officePeople = []; let officeAbsences = []; let officeMap = {}
    try {
      const [leaveRows, officeMapResult] = await Promise.all([getSheet('hr_leave'), getOfficePeopleMap()])
      officeMap = officeMapResult
      // รวมออฟฟิศเข้ากับตารางกะด้วย (เดิมส่งแค่บ้านล่าง) — ปฏิทินจะได้โชว์ตามตารางกะจริงของออฟฟิศด้วย ไม่ใช่ "มาทุกวันเสมอ" เหมือนก่อน
      sourceManpower = await getCalendarPresence({ ...personMap, ...officeMap }, Object.keys(personMap), true, Object.keys(officeMap))
      officePeople = Object.entries(officeMap).map(([code, [name]]) => ({ code, name }))
      for (const l of leaveRows) {
        if (!['pending', 'approved'].includes(l.status)) continue
        if (!String(l.username || '').startsWith('mp:')) continue
        const code = l.username.slice(3)
        if (!officeMap[code]) continue
        for (const date of leaveAbsenceDates(l)) officeAbsences.push({ code, date })
      }
    } catch (e) { console.error('office presence:', e.message) }
    res.setHeader('Cache-Control', cacheable('public, s-maxage=20, stale-while-revalidate=60'))
    // เพิ่มออฟฟิศเข้าไปในรายชื่อที่แก้ผ่านปุ่ม "คน" ได้แล้ว (เดิมแก้ได้แค่บ้านล่าง)
    const schedulePeople = [
      ...Object.entries(personMap).map(([code, [name, group]]) => ({ code, name, group })),
      ...Object.entries(officeMap).map(([code, [name]]) => ({ code, name, group: 'ออฟฟิศ' })),
    ]
    const data = { success: true, rows: rows.sort((a, b) => String(b.date).localeCompare(String(a.date))), manpower, sourceManpower, events, history, approvals, approvalHistory, otLimits, people, schedulePeople, officePeople, officeAbsences, sourceYear: '2026', dayRecords: dayRecords.sort((a, b) => String(b.date).localeCompare(String(a.date))) }
    workforceCache = { at: Date.now(), data }
    return res.status(200).json(data)
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const action = String(body.action || '').trim().toLowerCase()
  if (action === 'set-schedule-day') {
    if (!requireScheduleEditor(req, res)) return
    const date = String(body.date || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' })
    const [personMap, officeMap] = await Promise.all([getPersonMap(), getOfficePeopleMap()])
    const combinedMap = { ...personMap, ...officeMap }
    const requestedCodes = Array.isArray(body.codes) ? body.codes.map((code) => String(code || '').toUpperCase()).filter(Boolean) : []
    const codes = [...new Set(requestedCodes)]
    const unknown = codes.filter((code) => !combinedMap[code])
    if (unknown.length) return res.status(400).json({ error: `ไม่พบพนักงานในระบบ: ${unknown.join(', ')}` })
    const updatedAt = new Date().toISOString()
    const updatedBy = actorName() || body.updated_by || 'Boss'
    const entriesJson = JSON.stringify(codes.map((code) => ({ code })))
    await appendRows('workforce_schedule_overrides', [[date, entriesJson, updatedAt, updatedBy]])
    clearWorkforceCache(); clearHrCache()
    return res.status(200).json({ success: true, date, codes, updated_at: updatedAt, updated_by: updatedBy })
  }
  if (action === 'create-plan') {
    const employees = Array.isArray(body.employees) ? body.employees.filter(Boolean) : []
    if (!body.date || !employees.length || !body.planned_start || !body.planned_end) return res.status(400).json({ error: 'กรุณาระบุวันที่ รายชื่อ และเวลา OT' })
    if (!validTime(body.planned_start) || !validTime(body.planned_end) || clockMinutes(body.planned_end) <= clockMinutes(body.planned_start)) return res.status(400).json({ error: 'เวลาจบต้องมากกว่าเวลาเริ่มและอยู่ในวันเดียวกัน' })
    // ไม่บล็อกคนที่ไม่อยู่ใน Manpower วันนั้น (มาทำ OT เฉยๆ หรือสลับวันแต่ HR ยังไม่อัปเดต) — ฝั่งหน้าเว็บเตือนแบบไม่บล็อกแทนแล้ว
    const current = await getSheet('workforce_ot')
    const conflicts = employees.filter((employee) => current.some((r) => r.date === body.date && r.employee === employee && r.status !== 'cancelled' && overlaps(body.planned_start, body.planned_end, r.planned_start, r.planned_end)))
    if (conflicts.length) return res.status(409).json({ error: `แผน OT ซ้ำหรือเวลาชนกัน: ${conflicts.join(', ')}` })
    const now = new Date().toISOString(); const plannedMinutes = minutesBetween(body.planned_start, body.planned_end)
    const createdBy = actorName() || body.changed_by || 'Boss'
    const rows = employees.map((employee, index) => [`${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, body.date, employee, body.team || 'บ้านล่าง', body.task || 'แพ็ก', body.planned_start, body.planned_end, plannedMinutes, '', '', '', 'planned', body.reason || '', body.note || '', now, ''])
    await appendRows('workforce_ot', rows)
    await appendRows('workforce_ot_history', rows.map((row, index) => [`hist-${Date.now()}-c${index}`, row[0], body.date, row[2], '', '', body.planned_start, body.planned_end, '', body.note || '', now, createdBy]))
    clearWorkforceCache()
    return res.status(200).json({ success: true, created: rows.length })
  }
  if (action === 'update-plan') {
    const updates = Array.isArray(body.updates) ? body.updates : []
    if (!updates.length) return res.status(200).json({ success: true, updated: 0, action: 'update-plan' })
    const current = await getSheet('workforce_ot'); const updateMap = new Map(updates.map((u) => [String(u.id), u]))
    for (const row of current) {
      const u = updateMap.get(String(row.id)); if (!u) continue
      if (!validTime(u.planned_start) || !validTime(u.planned_end) || clockMinutes(u.planned_end) <= clockMinutes(u.planned_start)) return res.status(400).json({ error: `เวลาไม่ถูกต้อง: ${row.employee}` })
      if (u.actual_minutes !== '' && u.actual_minutes != null && (!Number.isFinite(Number(u.actual_minutes)) || Number(u.actual_minutes) < 0)) return res.status(400).json({ error: `ชั่วโมงที่ทำจริงไม่ถูกต้อง: ${row.employee}` })
      const conflict = current.some((other) => String(other.id) !== String(row.id) && other.date === row.date && other.employee === row.employee && other.status !== 'cancelled' && overlaps(u.planned_start, u.planned_end, other.planned_start, other.planned_end))
      if (conflict) return res.status(409).json({ error: `เวลาชนกับแผนเดิม: ${row.employee}` })
    }
    const changedAt = new Date().toISOString()
    const changedBy = actorName() || body.changed_by || 'Boss'
    const changedRows = current.filter((row) => { const u = updateMap.get(String(row.id)); return u && (u.planned_start !== row.planned_start || u.planned_end !== row.planned_end || String(u.note ?? '') !== String(row.note ?? '')) })
    if (changedRows.length) await appendRows('workforce_ot_history', changedRows.map((row, index) => { const u = updateMap.get(String(row.id)); return [`hist-${Date.now()}-${index}`, row.id, row.date, row.employee, row.planned_start, row.planned_end, u.planned_start, u.planned_end, row.note || '', u.note ?? row.note ?? '', changedAt, changedBy] }))
    const next = current.map((row) => { const u = updateMap.get(String(row.id)); const merged = u ? { ...row, planned_start: u.planned_start, planned_end: u.planned_end, planned_minutes: minutesBetween(u.planned_start, u.planned_end), actual_minutes: u.actual_minutes === '' || u.actual_minutes == null ? '' : Math.round(Number(u.actual_minutes)), note: u.note ?? row.note, status: 'planned' } : row; return OT_HEADERS.map((h) => merged[h] ?? '') })
    await overwriteSheet('workforce_ot', OT_HEADERS, next); clearWorkforceCache(); return res.status(200).json({ success: true, updated: updates.length })
  }
  if (action === 'delete-plan') {
    const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String)); const current = await getSheet('workforce_ot')
    const kept = current.filter((r) => !ids.has(String(r.id))).map((r) => OT_HEADERS.map((h) => r[h] ?? ''))
    await overwriteSheet('workforce_ot', OT_HEADERS, kept); clearWorkforceCache(); return res.status(200).json({ success: true, deleted: current.length - kept.length })
  }
  if (action === 'approve-actual-month') {
    if (!requireAdmin(req, res)) return
    if (!/^\d{4}-\d{2}$/.test(String(body.month || '')) || !body.employee || !Number.isFinite(Number(body.actual_minutes)) || Number(body.actual_minutes) < 0) return res.status(400).json({ error: 'ข้อมูลชั่วโมงจริงไม่ถูกต้อง' })
    const current = await getSheet('workforce_ot_approvals'); const now = new Date().toISOString()
    const changedBy = actorName() || body.approved_by || 'Boss'
    const record = { id: `approve-${body.month}-${body.employee}-${Date.now()}`, month: body.month, employee: body.employee, actual_minutes: Math.round(Number(body.actual_minutes)), approved_at: now, approved_by: changedBy }
    const existing = latestByKey(current, (r) => `${r.month}|${r.employee}`, 'approved_at').find((r) => r.month === body.month && r.employee === body.employee)
    if (existing) {
      await appendRows('workforce_ot_approval_history', [[`apphist-${Date.now()}`, body.month, body.employee, existing.actual_minutes, record.actual_minutes, now, changedBy]])
    }
    await appendRows('workforce_ot_approvals', [OT_APPROVAL_HEADERS.map((h) => record[h] ?? '')])
    clearWorkforceCache()
    return res.status(200).json({ success: true, approval: record })
  }
  if (action === 'set-ot-limit') {
    if (!requireAdmin(req, res)) return
    if (!body.employee) return res.status(400).json({ error: 'กรุณาระบุชื่อพนักงาน' })
    const limitHours = body.limit_hours === '' || body.limit_hours == null ? '' : Number(body.limit_hours)
    if (limitHours !== '' && (!Number.isFinite(limitHours) || limitHours < 0)) return res.status(400).json({ error: 'ลิมิตชั่วโมงไม่ถูกต้อง' })
    const current = await getSheet('workforce_ot_limits'); const now = new Date().toISOString()
    const record = { employee: body.employee, limit_hours: limitHours, updated_at: now, updated_by: actorName() || 'Boss' }
    await appendRows('workforce_ot_limits', [OT_LIMIT_HEADERS.map((h) => record[h] ?? '')])
    clearWorkforceCache()
    const latest = latestByKey([...current, record], (r) => r.employee, 'updated_at')
    return res.status(200).json({ success: true, otLimits: Object.fromEntries(latest.filter((r) => r.employee).map((r) => [r.employee, r.limit_hours])) })
  }
  if (action === 'create-manpower') {
    const employees = Array.isArray(body.employees) ? body.employees.filter(Boolean) : []
    if (!body.date || !employees.length) return res.status(400).json({ error: 'กรุณาระบุวันที่และรายชื่อ' })
    const now = new Date().toISOString()
    const rows = employees.map((employee, index) => [`mp-${Date.now()}-${index}`, body.date, employee, body.team || 'บ้านล่าง', body.task || 'แพ็ก', body.start_time || '09:00', body.end_time || '17:00', body.note || '', now])
    await appendRows('workforce_manpower', rows)
    clearWorkforceCache()
    return res.status(200).json({ success: true, created: rows.length })
  }
  if (action === 'create-event') {
    if (!body.date || !body.title) return res.status(400).json({ error: 'กรุณาระบุวันและชื่อโปร' })
    const endDate = body.end_date || body.date
    if (endDate < body.date) return res.status(400).json({ error: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' })
    const leadDays = Math.max(0, Math.round(Number(body.lead_days) || 0))
    const lagDays = Math.max(0, Math.round(Number(body.lag_days) || 0))
    await appendRows('workforce_events', [[`event-${Date.now()}`, body.title, body.date, body.team || 'ทุกทีม', body.note || '', new Date().toISOString(), endDate, leadDays, lagDays]])
    clearWorkforceCache()
    return res.status(200).json({ success: true })
  }
  if (action === 'delete-event') {
    if (!body.id) return res.status(400).json({ error: 'กรุณาระบุ id' })
    const current = await getSheet('workforce_events')
    const kept = current.filter((r) => String(r.id) !== String(body.id)).map((r) => EVENT_HEADERS.map((h) => r[h] ?? ''))
    await overwriteSheet('workforce_events', EVENT_HEADERS, kept)
    clearWorkforceCache()
    return res.status(200).json({ success: true, deleted: current.length - kept.length })
  }
  if (action === 'add-dayrecord') {
    const employees = Array.isArray(body.employees) ? body.employees.filter(Boolean) : []
    if (!body.date || !employees.length) return res.status(400).json({ error: 'กรุณาระบุวันที่และรายชื่อ' })
    if (!['ot_full', 'comp', 'sched_add', 'sched_remove'].includes(body.kind)) return res.status(400).json({ error: 'ประเภทไม่ถูกต้อง' })
    const now = new Date().toISOString()
    const createdBy = actorName() || body.created_by || 'Boss'
    const paidOt = body.kind === 'ot_full' ? (body.paid_ot === false ? '0' : '1') : '0'
    const rows = employees.map((employee, index) => [`dr-${Date.now()}-${index}`, body.date, employee, body.team || 'บ้านล่าง', body.kind, body.reason || '', paidOt, body.note || '', now, createdBy])
    await appendRows('workforce_dayrecords', rows)
    clearWorkforceCache()
    return res.status(200).json({ success: true, created: rows.length })
  }
  if (action === 'update-dayrecord') {
    if (!body.id) return res.status(400).json({ error: 'กรุณาระบุ id' })
    const current = await getSheet('workforce_dayrecords')
    const target = current.find((r) => String(r.id) === String(body.id))
    if (!target) return res.status(404).json({ error: 'ไม่พบรายการนี้' })
    const merged = { ...target, date: body.date ?? target.date, employee: body.employee ?? target.employee, team: body.team ?? target.team, kind: body.kind ?? target.kind, reason: body.reason ?? target.reason, paid_ot: body.paid_ot === undefined ? target.paid_ot : (body.paid_ot === false || body.paid_ot === '0' ? '0' : '1'), note: body.note ?? target.note }
    const next = current.map((r) => String(r.id) === String(body.id) ? merged : r).map((r) => DAYRECORD_HEADERS.map((h) => r[h] ?? ''))
    await overwriteSheet('workforce_dayrecords', DAYRECORD_HEADERS, next)
    clearWorkforceCache()
    return res.status(200).json({ success: true })
  }
  if (action === 'delete-dayrecord') {
    if (!body.id) return res.status(400).json({ error: 'กรุณาระบุ id' })
    const current = await getSheet('workforce_dayrecords')
    const kept = current.filter((r) => String(r.id) !== String(body.id)).map((r) => DAYRECORD_HEADERS.map((h) => r[h] ?? ''))
    await overwriteSheet('workforce_dayrecords', DAYRECORD_HEADERS, kept)
    clearWorkforceCache()
    return res.status(200).json({ success: true, deleted: current.length - kept.length })
  }
  return res.status(400).json({ error: `Unknown workforce action: ${action || '(empty)'}` })
}

async function opHr(req, res) {
  try {
    return await opHrInner(req, res)
  } catch (e) {
    console.error('opHr:', e)
    return res.status(500).json({ success: false, error: e.message })
  }
}

async function opHrInner(req, res) {
  const actorUsername = () => req.user?.u || null
  const actorName = () => req.user?.name || 'Boss'
  await ensureHrSheets()

  if (req.method === 'GET') {
    // ผจก. (ไม่ใช่ admin) เห็นแค่โควตาบ้านล่าง ไม่เห็นออฟฟิศ — เช็คทุกครั้งแม้ตอน cache hit เพราะ hrCache ใช้ร่วมกันข้าม request/role
    const isAdminViewer = !authEnabled() || canManageOperations(req.user?.role)
    const withRoleFilter = (data) => ({ ...data, canManage: isAdminViewer, leaveBalances: isAdminViewer ? data.leaveBalancesFull : data.leaveBalancesFull.filter((b) => b.group !== 'ออฟฟิศ') })
    if (hrCache.data && Date.now() - hrCache.at < 20000) return res.status(200).json(withRoleFilter(hrCache.data))
    const [leaveRange, backupRange, scheduleRange, lineLinkRange, peopleRange] = await batchGetValues(['hr_leave!A:Z', 'hr_leave_backups!A:Z', 'hr_schedule!A:Z', 'hr_line_links!A:Z', 'workforce_people!A:Z'])
    // เดือนที่แต่ละคนมีงานจริงจากตารางปี 2026 ที่เก็บในระบบ ใช้กรอง dropdown โดยไม่เชื่อมไฟล์ภายนอก
    const peopleFromSheet = rowsToObjects(peopleRange.values || []).filter((p) => String(p.active) !== '0')
    const [lowerMapForList, officeMapForList] = await Promise.all([getPersonMap(), getOfficePeopleMap()])
    let activeMonths = {}
    try {
      const manpowerRows = await getCalendarPresence({ ...lowerMapForList, ...officeMapForList }, Object.keys(lowerMapForList), false)
      for (const r of manpowerRows) (activeMonths[r.code] ||= new Set()).add(String(r.date).slice(0, 7))
      activeMonths = Object.fromEntries(Object.entries(activeMonths).map(([code, set]) => [code, [...set]]))
    } catch (e) { console.error('activeMonths:', e.message) }
    const extraPeople = Object.entries(officeMapForList).map(([code, [name, group]]) => ({ code, name, group }))
    const backupRows = rowsToObjects(backupRange.values || [])
    const leaveRows = rowsToObjects(leaveRange.values || []).map((leave) => ({
      ...leave,
      backup_assignments: backupRows.filter((row) => String(row.leave_id) === String(leave.id)),
      edit_proposal: leave.edit_pending === '1' ? pendingLeaveView(leave) : null,
    }))
    const leaveBalancesFull = await computeLeaveBalances(leaveRows, true)
    const data = { success: true, leave: leaveRows, schedule: rowsToObjects(scheduleRange.values || []), lineLinks: rowsToObjects(lineLinkRange.values || []), people: [...peopleFromSheet, ...extraPeople], activeMonths, leaveBalancesFull }
    res.setHeader('Cache-Control', cacheable('public, s-maxage=20, stale-while-revalidate=60'))
    hrCache = { at: Date.now(), data }
    return res.status(200).json(withRoleFilter(data))
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const body = req.body || {}
  const action = String(body.action || '').trim().toLowerCase()

  if (action === 'check-leave-lock') {
    const code = String(body.employee_code || '').trim()
    if (!code) return res.status(200).json({ success: true, locked: false, lockedDates: [] })
    const isSwap = body.leave_type === 'สลับวันหยุด'
    const leavePeriod = isSwap ? 'full' : normalizeLeavePeriod(body.leave_period || (body.half_day ? 'am' : 'full'))
    const halfDay = ['am', 'pm'].includes(leavePeriod) && !isSwap
    const endDate = halfDay ? body.start_date : body.end_date
    const draft = { leave_type: body.leave_type, start_date: body.start_date, end_date: endDate, leave_period: leavePeriod, days: halfDay ? 0.5 : undefined }
    const coverage = await inspectLeaveCoverage(`mp:${code}`, draft, body.exclude_leave_id)
    const lockedDates = [...new Set([...(coverage.needs || []).map((need) => need.date), ...(coverage.lockedDates || [])])]
    return res.status(200).json({ success: true, locked: lockedDates.length > 0 || !!coverage.blocked, lockedDates, backupNeeds: coverage.needs || [], blocked: !!coverage.blocked, coverageError: coverage.error || '', understaffedDates: coverage.understaffedDates || [] })
  }

  if (action === 'add-employee') {
    if (!requireAdmin(req, res)) return
    const code = String(body.code || '').trim().toUpperCase()
    const name = String(body.name || '').trim()
    const group = String(body.group || '').trim() || 'อื่น ๆ'
    if (!code || !name) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสและชื่อ' })
    if (group === 'ออฟฟิศ') {
      const current = await getSheet('hr_office_people')
      const existing = current.find((r) => String(r.code).toUpperCase() === code)
      if (existing && String(existing.active) !== '0') return res.status(400).json({ success: false, error: 'มีรหัสนี้อยู่แล้ว' })
      if (existing) {
        const next = current.map((r) => String(r.code).toUpperCase() === code ? { ...r, name, active: '1' } : r)
        await overwriteSheet('hr_office_people', OFFICE_HEADERS, next.map((r) => OFFICE_HEADERS.map((h) => r[h] ?? '')))
      } else {
        await appendRows('hr_office_people', [[code, name, '1']])
      }
    } else {
      const current = await getSheet('workforce_people')
      const existing = current.find((r) => String(r.code).toUpperCase() === code)
      if (existing && String(existing.active) !== '0') return res.status(400).json({ success: false, error: 'มีรหัสนี้อยู่แล้ว' })
      if (existing) {
        const next = current.map((r) => String(r.code).toUpperCase() === code ? { ...r, name, group, active: '1' } : r)
        await overwriteSheet('workforce_people', PEOPLE_HEADERS, next.map((r) => PEOPLE_HEADERS.map((h) => r[h] ?? '')))
      } else {
        await appendRows('workforce_people', [[code, name, group, '1']])
      }
    }
    clearHrCache(); clearWorkforceCache()
    return res.status(200).json({ success: true })
  }
  if (action === 'edit-employee-group') {
    if (!requireAdmin(req, res)) return
    const code = String(body.code || '').trim().toUpperCase()
    const group = String(body.group || '').trim()
    if (!code || !group) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสและกลุ่ม' })
    const officeRows = await getSheet('hr_office_people')
    const officeExisting = officeRows.find((r) => String(r.code).toUpperCase() === code && String(r.active) !== '0')
    const peopleRows = await getSheet('workforce_people')
    const peopleExisting = peopleRows.find((r) => String(r.code).toUpperCase() === code && String(r.active) !== '0')
    if (!officeExisting && !peopleExisting) return res.status(404).json({ success: false, error: 'ไม่พบพนักงานนี้' })
    const name = (officeExisting || peopleExisting).name

    if (group === 'ออฟฟิศ') {
      if (peopleExisting) {
        const nextPeople = peopleRows.map((r) => String(r.code).toUpperCase() === code ? { ...r, active: '0' } : r)
        await overwriteSheet('workforce_people', PEOPLE_HEADERS, nextPeople.map((r) => PEOPLE_HEADERS.map((h) => r[h] ?? '')))
      }
      if (officeExisting) {
        const nextOffice = officeRows.map((r) => String(r.code).toUpperCase() === code ? { ...r, name, active: '1' } : r)
        await overwriteSheet('hr_office_people', OFFICE_HEADERS, nextOffice.map((r) => OFFICE_HEADERS.map((h) => r[h] ?? '')))
      } else {
        await appendRows('hr_office_people', [[code, name, '1']])
      }
    } else {
      if (officeExisting) {
        const nextOffice = officeRows.map((r) => String(r.code).toUpperCase() === code ? { ...r, active: '0' } : r)
        await overwriteSheet('hr_office_people', OFFICE_HEADERS, nextOffice.map((r) => OFFICE_HEADERS.map((h) => r[h] ?? '')))
      }
      if (peopleExisting) {
        const nextPeople = peopleRows.map((r) => String(r.code).toUpperCase() === code ? { ...r, group } : r)
        await overwriteSheet('workforce_people', PEOPLE_HEADERS, nextPeople.map((r) => PEOPLE_HEADERS.map((h) => r[h] ?? '')))
      } else {
        await appendRows('workforce_people', [[code, name, group, '1']])
      }
    }
    clearHrCache(); clearWorkforceCache()
    return res.status(200).json({ success: true })
  }
  if (action === 'remove-employee') {
    if (!requireAdmin(req, res)) return
    const code = String(body.code || '').trim().toUpperCase()
    const group = String(body.group || '').trim()
    if (!code) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัส' })
    if (group === 'ออฟฟิศ') {
      const current = await getSheet('hr_office_people')
      if (!current.some((r) => String(r.code).toUpperCase() === code)) return res.status(404).json({ success: false, error: 'ไม่พบพนักงานนี้' })
      const next = current.map((r) => String(r.code).toUpperCase() === code ? { ...r, active: '0' } : r)
      await overwriteSheet('hr_office_people', OFFICE_HEADERS, next.map((r) => OFFICE_HEADERS.map((h) => r[h] ?? '')))
    } else {
      const current = await getSheet('workforce_people')
      if (!current.some((r) => String(r.code).toUpperCase() === code)) return res.status(404).json({ success: false, error: 'ไม่พบพนักงานนี้' })
      const next = current.map((r) => String(r.code).toUpperCase() === code ? { ...r, active: '0' } : r)
      await overwriteSheet('workforce_people', PEOPLE_HEADERS, next.map((r) => PEOPLE_HEADERS.map((h) => r[h] ?? '')))
    }
    clearHrCache(); clearWorkforceCache()
    return res.status(200).json({ success: true })
  }

  if (action === 'set-leave-balance') {
    if (!requireAdmin(req, res)) return
    const code = String(body.code || '').trim().toUpperCase()
    const remaining = Number(body.remaining)
    const person = code ? await findHrPerson(code) : null
    if (!person) return res.status(404).json({ success: false, error: 'ไม่พบพนักงานนี้' })
    if (!hasVacationBenefit(person.group)) return res.status(400).json({ success: false, error: `${person.group}ไม่มีสิทธิ์วันลาพักร้อน` })
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > 365 || Math.round(remaining * 2) !== remaining * 2) {
      return res.status(400).json({ success: false, error: 'ยอดคงเหลือต้องเป็น 0–365 วัน และเพิ่มทีละครึ่งวันได้ค่ะ' })
    }
    const balance = await vacationBalanceFor(code)
    const quota = balance.used + remaining
    const current = await getSheet('hr_leave_quota')
    const existing = current.find((row) => String(row.code).toUpperCase() === code)
    const now = new Date().toISOString()
    const next = existing
      ? current.map((row) => String(row.code).toUpperCase() === code ? { ...row, quota, updated_at: now } : row)
      : [...current, { code, quota, updated_at: now }]
    await overwriteSheet('hr_leave_quota', QUOTA_HEADERS, next.map((row) => QUOTA_HEADERS.map((header) => row[header] ?? '')))
    await appendLeaveAudit(`quota:${code}`, 'balance-adjusted', balance, { ...balance, quota, remaining }, actorName())
    clearHrCache()
    return res.status(200).json({ success: true, balance: { ...balance, quota, remaining } })
  }

  if (action === 'request-leave-edit' || action === 'admin-update-leave') {
    const isAdminEdit = action === 'admin-update-leave'
    if (isAdminEdit && !requireAdmin(req, res)) return
    const current = await getSheet('hr_leave')
    const target = current.find((row) => String(row.id) === String(body.id || ''))
    if (!target) return res.status(404).json({ success: false, error: 'ไม่พบรายการลานี้' })
    const isOwner = target.username === actorUsername()
    const isAdmin = !authEnabled() || canManageOperations(req.user?.role)
    if (!isAdminEdit && !isOwner && !isAdmin) return res.status(403).json({ success: false, error: 'แก้ไขได้เฉพาะคำขอของตัวเองค่ะ' })
    if (!isAdminEdit && ['rejected', 'cancelled'].includes(target.status)) return res.status(400).json({ success: false, error: 'รายการนี้สิ้นสุดแล้ว กรุณาส่งคำขอใหม่ค่ะ' })
    const { draft, error: draftError } = normalizeEditableLeave(body, target)
    if (draftError) return res.status(400).json({ success: false, error: draftError })
    const code = String(target.username || '').startsWith('mp:') ? target.username.slice(3) : ''
    const person = code ? await findHrPerson(code) : null
    if (draft.leave_type === 'พักร้อน' && person && !hasVacationBenefit(person.group)) return res.status(400).json({ success: false, error: `${person.group}ไม่มีสิทธิ์วันลาพักร้อน` })
    const nextStatus = isAdminEdit ? String(body.status || target.status) : target.status
    if (isAdminEdit && !['pending', 'approved', 'rejected', 'cancelled'].includes(nextStatus)) return res.status(400).json({ success: false, error: 'สถานะไม่ถูกต้อง' })
    let coverage = { ok: true, assignments: [] }
    if (!['rejected', 'cancelled'].includes(nextStatus)) {
      coverage = await resolveLeaveCoverage(target.username, draft, body.backup_assignments, target.id)
      if (!coverage.ok) return res.status(400).json({ success: false, error: coverage.error, backupNeeds: coverage.needs || [], blocked: !!coverage.blocked })
    }
    const now = new Date().toISOString()
    const payload = { ...draft, backup_office: coverage.assignments?.[0]?.office_code || '', backup_assignments: coverage.assignments || [], understaffed_dates: (coverage.understaffedDates || []).join(',') }
    if (!isAdminEdit) {
      const record = { ...target, edit_pending: '1', edit_payload: JSON.stringify(payload), edit_requested_at: now, edit_requested_by: actorName() }
      const next = current.map((row) => String(row.id) === String(target.id) ? record : row)
      await overwriteSheet('hr_leave', LEAVE_HEADERS, next.map((row) => LEAVE_HEADERS.map((header) => row[header] ?? '')))
      await appendLeaveAudit(target.id, 'edit-requested', target, payload, actorName())
      clearHrCache()
      await notifyNewLeaveRequestSafely({ ...target, ...payload, status: 'pending', is_edit_request: true })
      return res.status(200).json({ success: true, leave: record })
    }
    const record = {
      ...target, ...draft, status: nextStatus,
      backup_office: payload.backup_office, understaffed_dates: payload.understaffed_dates,
      edit_pending: '', edit_payload: '', edit_requested_at: '', edit_requested_by: '',
      decided_by: actorName(), decided_at: now, decision_note: String(body.decision_note || target.decision_note || ''),
    }
    const backupRows = await getSheet('hr_leave_backups')
    const keptBackups = backupRows.filter((row) => String(row.leave_id) !== String(target.id))
    const replacementRows = (coverage.assignments || []).map((assignment) => ({ leave_id: target.id, ...assignment, created_at: now }))
    await Promise.all([
      overwriteSheet('hr_leave', LEAVE_HEADERS, current.map((row) => String(row.id) === String(target.id) ? record : row).map((row) => LEAVE_HEADERS.map((header) => row[header] ?? ''))),
      overwriteSheet('hr_leave_backups', BACKUP_HEADERS, [...keptBackups, ...replacementRows].map((row) => BACKUP_HEADERS.map((header) => row[header] ?? ''))),
      appendLeaveAudit(target.id, 'admin-updated', target, { ...record, backup_assignments: coverage.assignments || [] }, actorName()),
    ])
    clearHrCache()
    try { await notifyLeaveDecision({ ...record, backup_assignments: coverage.assignments || [] }) } catch (e) { console.error('notifyLeaveDecision:', e.message) }
    return res.status(200).json({ success: true, leave: record })
  }

  if (action === 'request-leave' || action === 'request-leave-for') {
    const forSomeoneElse = action === 'request-leave-for'
    if (forSomeoneElse && !requireAdmin(req, res)) return
    if (!body.start_date || !body.leave_type) return res.status(400).json({ success: false, error: 'กรุณาระบุประเภทการลาและวันที่' })
    const isSwap = body.leave_type === 'สลับวันหยุด' // "จาก...เป็น..." ไม่ใช่ช่วงต่อเนื่อง วันที่ 2 มาก่อนวันที่ 1 ได้ ไม่ใช่ error
    const leavePeriod = isSwap ? 'full' : normalizeLeavePeriod(body.leave_period || (body.half_day ? 'am' : 'full'))
    const halfDay = ['am', 'pm'].includes(leavePeriod) && !isSwap
    const endDate = halfDay ? body.start_date : body.end_date
    if (!halfDay && !endDate) return res.status(400).json({ success: false, error: isSwap ? 'กรุณาระบุวันหยุดใหม่' : 'กรุณาระบุวันสิ้นสุด' })
    if (!halfDay && !isSwap && endDate < body.start_date) return res.status(400).json({ success: false, error: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' })

    let username, employeeName
    if (forSomeoneElse) {
      // ยื่นแทนพนักงานที่ไม่มีบัญชี login — ระบุตัวตนจากตาราง manpower (workforce_people + กลุ่มออฟฟิศ) ไม่ใช่ users
      const code = String(body.employee_code || '').trim()
      const person = code ? await findHrPerson(code) : null
      if (!code || !person) return res.status(400).json({ success: false, error: 'ไม่พบพนักงานในตาราง manpower' })
      if (body.leave_type === 'พักร้อน' && !hasVacationBenefit(person.group)) return res.status(400).json({ success: false, error: `${person.group}ไม่มีสิทธิ์วันลาพักร้อน` })
      username = `mp:${code}`
      employeeName = person.name
    } else {
      username = actorUsername() || 'boss'
      employeeName = actorName()
    }

    const draft = { leave_type: body.leave_type, start_date: body.start_date, end_date: endDate, leave_period: leavePeriod, days: halfDay ? 0.5 : undefined }
    const coverage = await resolveLeaveCoverage(username, draft, body.backup_assignments)
    if (!coverage.ok) return res.status(400).json({ success: false, error: coverage.error, backupNeeds: coverage.needs || [], blocked: !!coverage.blocked, needBackupOffice: !coverage.blocked })

    const now = new Date().toISOString()
    const record = {
      id: `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username, employee_name: employeeName, leave_type: body.leave_type,
      start_date: body.start_date, end_date: endDate,
      days: isSwap ? 1 : halfDay ? 0.5 : daysBetween(body.start_date, endDate),
      reason: body.reason || '', status: 'pending',
      requested_by: actorName(), requested_at: now,
      decided_by: '', decided_at: '', decision_note: '',
      backup_office: coverage.assignments?.[0]?.office_code || '', leave_period: leavePeriod,
      backup_assignments: coverage.assignments || [],
      understaffed_dates: (coverage.understaffedDates || []).join(','),
    }
    if (coverage.assignments?.length) await appendRows('hr_leave_backups', coverage.assignments.map((assignment) => BACKUP_HEADERS.map((header) => ({ leave_id: record.id, ...assignment, created_at: now })[header] ?? '')))
    await appendRows('hr_leave', [LEAVE_HEADERS.map((h) => record[h] ?? '')])
    clearHrCache()
    await notifyNewLeaveRequestSafely(record)
    return res.status(200).json({ success: true, leave: record })
  }
  if (action === 'decide-leave') {
    if (!requireAdmin(req, res)) return
    const { record, error } = await applyLeaveDecision(body.id, body.decision, actorName(), body.decision_note || '')
    if (error) return res.status(record ? 400 : 404).json({ success: false, error })
    return res.status(200).json({ success: true, leave: record })
  }
  if (action === 'cancel-leave') {
    if (!body.id) return res.status(400).json({ success: false, error: 'กรุณาระบุ id' })
    const current = await getSheet('hr_leave')
    const target = current.find((r) => String(r.id) === String(body.id))
    if (!target) return res.status(404).json({ success: false, error: 'ไม่พบคำขอลานี้' })
    const isOwner = target.username === actorUsername()
    const isAdmin = !authEnabled() || canManageOperations(req.user?.role)
    if (!isOwner && !isAdmin) return res.status(403).json({ success: false, error: 'ยกเลิกได้เฉพาะคำขอของตัวเองหรือ admin' })
    if (target.status !== 'pending') return res.status(400).json({ success: false, error: 'ยกเลิกได้เฉพาะรายการที่ยัง pending' })
    const kept = current.filter((r) => String(r.id) !== String(body.id))
    const backupRows = await getSheet('hr_leave_backups')
    const keptBackups = backupRows.filter((row) => String(row.leave_id) !== String(body.id))
    await Promise.all([
      overwriteSheet('hr_leave', LEAVE_HEADERS, kept.map((r) => LEAVE_HEADERS.map((h) => r[h] ?? ''))),
      overwriteSheet('hr_leave_backups', BACKUP_HEADERS, keptBackups.map((row) => BACKUP_HEADERS.map((header) => row[header] ?? ''))),
    ])
    clearHrCache()
    return res.status(200).json({ success: true })
  }
  if (action === 'request-leave-cancel') {
    // ยกเลิกคำขอลาที่อนุมัติไปแล้ว — พนักงานทำเองไม่ได้ทันที ต้องส่งคำขอแล้วรอ HR ยืนยันก่อน (เหมือน request-leave-edit)
    if (!body.id) return res.status(400).json({ success: false, error: 'กรุณาระบุ id' })
    const current = await getSheet('hr_leave')
    const target = current.find((r) => String(r.id) === String(body.id))
    if (!target) return res.status(404).json({ success: false, error: 'ไม่พบคำขอลานี้' })
    const isOwner = target.username === actorUsername()
    const isAdmin = !authEnabled() || canManageOperations(req.user?.role)
    if (!isOwner && !isAdmin) return res.status(403).json({ success: false, error: 'ยกเลิกได้เฉพาะคำขอของตัวเองหรือ admin' })
    if (!['pending', 'approved'].includes(target.status)) return res.status(400).json({ success: false, error: 'รายการนี้ยกเลิกไม่ได้แล้วค่ะ' })
    if (target.edit_pending === '1') return res.status(400).json({ success: false, error: 'มีคำขอแก้ไข/ยกเลิกค้างรอ HR อยู่แล้ว' })
    const now = new Date().toISOString()
    const payload = { cancel_requested: true, note: String(body.note || '').trim() }
    const record = { ...target, edit_pending: '1', edit_payload: JSON.stringify(payload), edit_requested_at: now, edit_requested_by: actorName() }
    const next = current.map((row) => String(row.id) === String(target.id) ? record : row)
    await overwriteSheet('hr_leave', LEAVE_HEADERS, next.map((row) => LEAVE_HEADERS.map((header) => row[header] ?? '')))
    await appendLeaveAudit(target.id, 'cancel-requested', target, payload, actorName())
    clearHrCache()
    await notifyNewLeaveRequestSafely({ ...target, ...payload, status: 'pending', is_edit_request: true, cancel_requested: true })
    return res.status(200).json({ success: true, leave: record })
  }
  if (action === 'set-line-id' || action === 'set-line-id-for') {
    let username
    if (action === 'set-line-id-for') {
      if (!requireAdmin(req, res)) return
      const code = String(body.employee_code || '').trim()
      if (!code) return res.status(400).json({ success: false, error: 'กรุณาระบุพนักงาน' })
      username = `mp:${code}`
    } else {
      username = actorUsername() || 'boss'
    }
    const lineUserId = String(body.line_user_id || '').trim()
    const current = await getSheet('hr_line_links')
    const now = new Date().toISOString()
    const kept = current.filter((r) => r.username !== username).map((r) => LINE_LINK_HEADERS.map((h) => r[h] ?? ''))
    const rows = lineUserId ? [...kept, LINE_LINK_HEADERS.map((h) => ({ username, line_user_id: lineUserId, updated_at: now })[h] ?? '')] : kept
    await overwriteSheet('hr_line_links', LINE_LINK_HEADERS, rows)
    clearHrCache()
    return res.status(200).json({ success: true, line_user_id: lineUserId })
  }
  return res.status(400).json({ success: false, error: `Unknown hr action: ${action || '(empty)'}` })
}

const isCancelled = (status = '') =>
  status.includes('ยกเลิก') || status.toLowerCase().includes('cancel')
const isReturned = (status = '') => status.toLowerCase().includes('return')

// ── op=summary: สรุปยอดขายจาก raw_orders_* (รายวัน + ราย SKU + import ล่าสุด) ──
async function opSummary(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const meta = await getMetaCached()
    const tabs = meta.sheets
      .map(s => s.properties.title)
      .filter(t => t.startsWith('raw_orders'))

    // ต่อ tab อ่าน 2 ช่วง: B:F (order_id, -, date, platform, business) และ J:N (sku, name, qty, revenue, status)
    const ranges = tabs.flatMap(t => [`${t}!B:F`, `${t}!J:N`])
    const valueRanges = await batchGetValues(ranges)

    const daily = new Map() // date|business|platform → { revenue, qty, orderIds }
    const skus = new Map()  // sku|business|platform → { name, revenue, qty, orders }

    for (let i = 0; i < tabs.length; i++) {
      const left = valueRanges[2 * i].values || []
      const right = valueRanges[2 * i + 1].values || []
      const n = Math.max(left.length, right.length)
      for (let j = 1; j < n; j++) {
        const [orderId, , date, platform, business] = left[j] || []
        const [sku, name, qtyS, revS, status] = right[j] || []
        if (!date) continue
        // จำนวนออเดอร์นับรวมยกเลิก/ตีคืน (งานแพ็คเกิดขึ้นแล้ว) ยอดขาย/จำนวนชิ้นไม่นับ
        const excluded = isCancelled(status) || isReturned(status)
        const qty = parseInt(qtyS, 10) || 0
        const revenue = parseFloat(String(revS ?? '').replace(/,/g, '')) || 0

        const dKey = `${date}|${business}|${platform}`
        let d = daily.get(dKey)
        if (!d) daily.set(dKey, d = { revenue: 0, qty: 0, grossQty: 0, orderIds: new Set() })
        if (orderId) d.orderIds.add(orderId)
        d.grossQty += qty
        if (!excluded) { d.revenue += revenue; d.qty += qty }

        const sKey = `${sku || '?'}|${business}|${platform}`
        let s = skus.get(sKey)
        if (!s) skus.set(sKey, s = { name: name || sku || '(ไม่ระบุ)', revenue: 0, qty: 0, grossQty: 0, orders: 0 })
        s.orders += 1
        s.grossQty += qty
        if (!excluded) { s.revenue += revenue; s.qty += qty }
      }
    }

    const dailyRows = [...daily.entries()].map(([key, v]) => {
      const [date, business, platform] = key.split('|')
      return {
        date, business, platform,
        revenue: Math.round(v.revenue * 100) / 100,
        qty: v.qty,
        grossQty: v.grossQty,
        orders: v.orderIds.size,
      }
    }).sort((a, b) => a.date.localeCompare(b.date))

    const skuRows = [...skus.entries()].map(([key, v]) => {
      const [sku, business, platform] = key.split('|')
      return {
        sku, business, platform,
        name: v.name,
        revenue: Math.round(v.revenue * 100) / 100,
        qty: v.qty,
        grossQty: v.grossQty,
        orders: v.orders,
      }
    })

    let imports = []
    try {
      const log = await getSheet('import_log')
      imports = log
        .filter(r => r.status === 'active')
        .slice(-6)
        .reverse()
        .map(r => ({
          file: r.filename,
          business: r.business,
          platform: r.platform,
          rows: Number(r.rows_imported) || 0,
          at: r.uploaded_at,
        }))
    } catch { /* ไม่มี tab import_log ก็ข้าม */ }

    res.setHeader('Cache-Control', cacheable('public, s-maxage=300, stale-while-revalidate=3600'))
    res.status(200).json({
      maxDate: dailyRows.length ? dailyRows[dailyRows.length - 1].date : null,
      daily: dailyRows,
      skus: skuRows,
      imports,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── op=sheet: อ่านทั้ง sheet (?name=) ──
async function opSheet(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const { name } = req.query
  if (!name) return res.status(400).json({ error: 'ต้องระบุ &name=<ชื่อ sheet>' })
  try {
    res.status(200).json(await getSheet(name))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── op=append: เขียนต่อท้าย body { sheetName, rows } ──
async function opAppend(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sheetName, rows } = req.body || {}
  if (!sheetName || !Array.isArray(rows)) return res.status(400).json({ error: 'ต้องส่ง sheetName และ rows (array)' })
  try {
    await appendRows(sheetName, rows)
    res.status(200).json({ ok: true, appended: rows.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── op=overwrite: เขียนทับทั้ง sheet body { sheetName, headers, rows } ──
async function opOverwrite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sheetName, headers, rows } = req.body || {}
  if (!sheetName || !Array.isArray(headers) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'ต้องส่ง sheetName, headers (array) และ rows (array)' })
  }
  try {
    await overwriteSheet(sheetName, headers, rows)
    res.status(200).json({ ok: true, written: rows.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── op=planner: อ่าน/บันทึก Planner ลง Google Sheet เดิม ──
async function opPlanner(req, res) {
  const text = (value) => String(value ?? '').trim()
  const number = (value) => Math.max(0, Number(value) || 0)
  const truthy = (value) => value === true || value === 1 || ['1', 'true', 'yes'].includes(String(value).toLowerCase())
  try {
    // ทำตามลำดับเพื่อลดโอกาสชนกันตอนสร้างแท็บครั้งแรก
    await ensureSheet(PLANNER_CONFIG_SHEET, PLANNER_CONFIG_HEADERS)
    await ensureSheet(PLANNER_DAILY_SHEET, PLANNER_DAILY_HEADERS)

    if (req.method === 'GET') {
      const date = text(req.query.date).slice(0, 10)
      const [config, allDaily] = await Promise.all([getSheet(PLANNER_CONFIG_SHEET), getSheet(PLANNER_DAILY_SHEET)])
      const daily = date ? allDaily.filter((row) => row.date === date) : allDaily
      // ค่าล่าสุดต่อ SKU ก่อนหรือเท่ากับวันที่ขอ — ใช้ carry-forward FG ที่ยังไม่กรอกของวันนี้ แทนที่จะให้เห็น 0 เปล่าๆ
      const latestBySku = {}
      if (date) {
        for (const row of allDaily) {
          if (!row.master_sku || row.date > date) continue
          const prev = latestBySku[row.master_sku]
          if (!prev || row.date > prev.date) latestBySku[row.master_sku] = row
        }
      }
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ success: true, config, daily, latestBySku })
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
    const body = req.body || {}
    if (body.action !== 'save-all') return res.status(400).json({ success: false, error: 'Unknown planner action' })

    const now = new Date().toISOString()
    const updatedBy = req.user?.name || text(body.updated_by) || 'Planner'
    const config = (Array.isArray(body.config) ? body.config : []).filter((row) => /^PY/i.test(text(row.master_sku))).map((row) => ({
      master_sku: text(row.master_sku).toUpperCase(),
      enabled: truthy(row.enabled) ? '1' : '0',
      reserve_days: number(row.reserve_days),
      safety_percent: number(row.safety_percent),
      updated_at: now,
      updated_by: updatedBy,
    }))
    const daily = (Array.isArray(body.daily) ? body.daily : []).filter((row) => row.date && /^PY/i.test(text(row.master_sku))).map((row) => ({
      id: `${text(row.date).slice(0, 10)}|${text(row.master_sku).toUpperCase()}`,
      date: text(row.date).slice(0, 10),
      master_sku: text(row.master_sku).toUpperCase(),
      fg: number(row.fg),
      sales_average: number(row.sales_average),
      demand_mode: ['normal', 'surge', 'promo'].includes(row.demand_mode) ? row.demand_mode : 'normal',
      recommended_feed: number(row.recommended_feed),
      planned_feed: number(row.planned_feed),
      feeders: [...new Set(Array.isArray(row.feeders) ? row.feeders.map(text).filter(Boolean) : [])].join(' · '),
      updated_at: now,
      updated_by: updatedBy,
    }))

    // อัปเดตเฉพาะแถว (date|sku) ที่ส่งมาจริง ห้ามลบแถววันเดียวกันของ SKU อื่นที่ไม่ได้ส่งมา (เช่น SKU ที่ถูกปิดชั่วคราว) — เดิมกรองด้วย row.date !== saveDate ทำให้ FG ของ SKU ที่ถูกปิดหายไปทั้งวัน พอเปิดกลับมาเลยเห็น FG เป็น 0
    const currentDaily = await getSheet(PLANNER_DAILY_SHEET)
    const incomingKeys = new Set(daily.map((row) => row.id))
    const keptDaily = currentDaily.filter((row) => !incomingKeys.has(row.id))
    await overwriteSheet(PLANNER_CONFIG_SHEET, PLANNER_CONFIG_HEADERS, config.map((row) => PLANNER_CONFIG_HEADERS.map((header) => row[header] ?? '')))
    await overwriteSheet(PLANNER_DAILY_SHEET, PLANNER_DAILY_HEADERS, [...keptDaily, ...daily].map((row) => PLANNER_DAILY_HEADERS.map((header) => row[header] ?? '')))
    return res.status(200).json({ success: true, configSaved: config.length, dailySaved: daily.length, updatedAt: now, updatedBy })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// ── op=line-webhook: LINE เรียกเข้ามาตอนกดปุ่มอนุมัติ/ปฏิเสธในแชท — ไม่มี x-api-token ต้องตรวจลายเซ็นแทน ──
// ── ตัวช่วยขั้นตอนยื่นลาผ่านแชท LINE (พนักงานที่ไม่มีบัญชี login กดเมนูสำเร็จรูปแทนเข้าเว็บ) ──
const LEAVE_TRIGGER = 'ลา'
const LEAVE_EDIT_TRIGGER = 'แก้ไขลา'
const LEAVE_CANCEL_TRIGGER = 'ยกเลิกลา'
const LEAVE_SUMMARY_TRIGGER = 'สรุปลา'
const LEAVE_HISTORY_TRIGGER = 'ประวัติลา'
// ลากิจ/ขาดงาน ตัดออกจากตัวเลือกใน LINE (ลาเองไม่ได้) — เก็บไว้ในเว็บให้ HR เพิ่ม/แก้เองได้ (เผื่อลาส่วนตัว/คุยนอกรอบ)
const LEAVE_TYPES_LINE = ['พักร้อน', 'ลาป่วย', 'สลับวันหยุด']
const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const addDaysStr = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const thaiDateLabel = (dateStr) => { const [, m, d] = dateStr.split('-'); return `${Number(d)} ${THAI_MONTH_ABBR[Number(m) - 1]}` }

// เลือกประเภทการลา — ใช้ quick reply (ไม่ใช่ buttons template) เพราะ buttons template จำกัดแค่ 4 ปุ่ม แต่ตอนนี้มี 5 ประเภทแล้ว
const typeQuickReplyMessage = (staffLink) => {
  const leaveTypes = staffLink && !hasVacationBenefit(staffLink.group) ? LEAVE_TYPES_LINE.filter((type) => type !== 'พักร้อน') : LEAVE_TYPES_LINE
  return { type: 'text', text: 'ลาประเภทไหนคะ?', quickReply: { items: leaveTypes.map((type) => ({ type: 'action', action: { type: 'postback', label: type, data: `hr-wiz-type:${type}`, displayText: type } })) } }
}
const editLeaveChoiceMessage = (leaves) => ({
  type: 'text', text: 'เลือกคำขอที่ต้องการแก้ไขค่ะ',
  quickReply: { items: leaves.slice(0, 10).map((leave) => ({ type: 'action', action: { type: 'postback', label: `${thaiDateLabel(leave.start_date)} · ${leave.leave_type}`.slice(0, 20), data: `hr-wiz-edit:${leave.id}`, displayText: `แก้ไข ${thaiDateLabel(leave.start_date)}` } })) },
})
const cancelLeaveChoiceMessage = (leaves) => ({
  type: 'text', text: 'เลือกคำขอที่ต้องการยกเลิกค่ะ (ยกเลิกได้เฉพาะรายการที่ยังไม่อนุมัติ)',
  quickReply: { items: leaves.slice(0, 10).map((leave) => ({ type: 'action', action: { type: 'postback', label: `${thaiDateLabel(leave.start_date)} · ${leave.leave_type}`.slice(0, 20), data: `hr-wiz-cancelpick:${leave.id}`, displayText: `ยกเลิก ${thaiDateLabel(leave.start_date)}` } })) },
})
// สรุปการลาปีนี้ของคนเดียว — ใช้ตอบทั้งใน LINE (พิมพ์ "สรุปลา") และเผื่อ reuse ที่อื่น
async function leaveOwnSummaryText(staffLink) {
  const year = currentYearBKK()
  const [balance, leaveRows] = await Promise.all([vacationBalanceFor(staffLink.code), getSheet('hr_leave')])
  const own = leaveRows.filter((l) => l.username === staffLink.username && l.status === 'approved' && String(l.start_date || '').slice(0, 4) === year)
  const byType = {}
  for (const l of own) byType[l.leave_type] = (byType[l.leave_type] || 0) + (Number(l.days) || 0)
  const pendingCount = leaveRows.filter((l) => l.username === staffLink.username && l.status === 'pending').length
  const lines = Object.entries(byType).map(([type, days]) => `${leaveTypeIcon(type)} ${type}: ${days} วัน`)
  const vacLine = balance.eligible ? `🏖️ พักร้อน: ใช้ ${balance.used}/${balance.quota} วัน (เหลือ ${balance.remaining})` : ''
  const otherLines = lines.filter((l) => !l.includes('พักร้อน'))
  const parts = [`สรุปการลาปี ${year} ของคุณ${staffLink.name ? ` ${staffLink.name}` : ''}ค่ะ`, vacLine, ...otherLines]
  if (pendingCount) parts.push(`⏳ รออนุมัติอยู่ ${pendingCount} รายการ`)
  return parts.filter(Boolean).join('\n') || `ยังไม่มีประวัติการลาปี ${year} ค่ะ`
}
const LEAVE_STATUS_LABEL_LINE = { pending: '⏳ รออนุมัติ', approved: '✅ อนุมัติแล้ว', rejected: '✕ ไม่อนุมัติ', cancelled: '↩️ ยกเลิกแล้ว' }
// ประวัติการลาทั้งปีนี้ของคนเดียวแบบทีละรายการ (ต่างจาก "สรุปลา" ที่เป็นยอดรวม) — ใช้ตอบใน LINE พิมพ์ "ประวัติลา"
// จำกัดแค่ปีปัจจุบัน ไม่ใช่ตลอดกาล — กันข้อความยาวเกิน 5000 ตัวอักษรของ LINE สำหรับคนที่ลามาหลายปี
async function leaveHistoryText(staffLink) {
  const year = currentYearBKK()
  const leaveRows = await getSheet('hr_leave')
  const own = leaveRows
    .filter((l) => l.username === staffLink.username && l.status !== 'cancelled' && String(l.start_date || '').slice(0, 4) === year)
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
  if (!own.length) return `ยังไม่มีประวัติการลาปี ${year} ค่ะ`
  const lines = own.map((l) => {
    const isSwap = l.leave_type === 'สลับวันหยุด'
    const dateLabel = isSwap ? `${thaiDateLabel(l.start_date)} → ${thaiDateLabel(l.end_date)}` : l.start_date === l.end_date ? thaiDateLabel(l.start_date) : `${thaiDateLabel(l.start_date)} – ${thaiDateLabel(l.end_date)}`
    const statusLabel = LEAVE_STATUS_LABEL_LINE[l.status] || l.status
    return `${leaveTypeIcon(l.leave_type)} ${l.leave_type} · ${dateLabel} · ${l.days} วัน\n${statusLabel}`
  })
  const text = [`ประวัติการลาปี ${year}${staffLink.name ? ` ของ ${staffLink.name}` : ''} (${own.length} รายการ)`, ...lines].join('\n\n')
  // เผื่อกรณีลาถี่มากจนยังยาวเกิน limit ของ LINE — ตัดท้ายไว้กันข้อความส่งไม่ออก
  return text.length > 4800 ? `${text.slice(0, 4750)}\n\n…(ดูรายการเพิ่มเติมได้ที่หน้าเว็บ)` : text
}
// ปฏิทินจริงของ LINE (datetimepicker) กันพิมพ์วันที่ผิด — ใช้แทนการพิมพ์วันที่เองทั้งหมด
const dtPicker = (label, data, min) => ({ type: 'datetimepicker', label, data, mode: 'date', initial: min || todayStr(), min: min || todayStr() })
const choiceCard = ({ altText, title, subtitle, icon = '💭', actions = [], primaryLast = false }) => ({
  type: 'flex', altText, contents: {
    type: 'bubble', size: 'kilo',
    header: lineCardHeader(title, subtitle, icon),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', backgroundColor: '#FBFEFF', contents: actions.map((action, index) => lineCardButton(action, primaryLast ? index === actions.length - 1 : actions.length === 1)) },
  },
})
// ประเภทลาทั่วไป: วันเดียว (วันนี้/พรุ่งนี้) หรือเลือกช่วงวันที่เอง (ลาหลายวัน/หยุดยาว)
const dateChoiceMessage = () => choiceCard({ altText: 'เลือกวันที่ลา', title: 'ลาวันไหนคะ?', subtitle: 'เลือกวันที่สะดวกได้เลยค่ะ', icon: '📅', primaryLast: true, actions: [
  { type: 'postback', label: 'วันนี้', data: 'hr-wiz-date:today', displayText: 'วันนี้' },
  { type: 'postback', label: 'พรุ่งนี้', data: 'hr-wiz-date:tomorrow', displayText: 'พรุ่งนี้' },
  { type: 'postback', label: 'เลือกวัน/ช่วงวันที่', data: 'hr-wiz-date:range', displayText: 'เลือกวัน/ช่วงวันที่' },
] })
const rangeStartMessage = () => choiceCard({ altText: 'เลือกวันเริ่มลา', title: 'เริ่มลาวันไหนคะ?', subtitle: 'แตะปุ่มเพื่อเปิดปฏิทินค่ะ', icon: '🗓️', actions: [dtPicker('เลือกวันที่', 'hr-wiz-range-start:pick')] })
const rangeEndMessage = (minDate) => choiceCard({ altText: 'เลือกวันสิ้นสุด', title: 'ลาถึงวันไหนคะ?', subtitle: 'ถ้าลาวันเดียว เลือกวันเดิมได้ค่ะ', icon: '🗓️', actions: [dtPicker('เลือกวันที่', 'hr-wiz-range-end:pick', minDate)] })
const periodChoiceMessage = () => choiceCard({ altText: 'เลือกช่วงเวลาที่ลา', title: 'ลาช่วงไหนคะ?', subtitle: 'เลือกเต็มวัน หรือครึ่งวันได้เลยค่ะ', icon: '🕘', actions: [
  { type: 'postback', label: 'เต็มวัน', data: 'hr-wiz-period:full', displayText: 'เต็มวัน' },
  { type: 'postback', label: 'ครึ่งวันเช้า', data: 'hr-wiz-period:am', displayText: 'ครึ่งวันเช้า' },
  { type: 'postback', label: 'ครึ่งวันบ่าย', data: 'hr-wiz-period:pm', displayText: 'ครึ่งวันบ่าย' },
] })
// สลับวันหยุด: ต้องมี 2 วันแยกกัน (วันหยุดเดิม -> วันหยุดใหม่) ไม่ใช่ช่วงต่อเนื่อง
const swapFromMessage = () => choiceCard({ altText: 'เลือกวันหยุดเดิม', title: 'วันหยุดเดิมคือวันไหนคะ?', subtitle: 'เลือกวันที่ต้องการสลับออกค่ะ', icon: '🔁', actions: [dtPicker('เลือกวันที่', 'hr-wiz-swap-from:pick')] })
const swapToMessage = () => choiceCard({ altText: 'เลือกวันหยุดใหม่', title: 'เปลี่ยนเป็นวันไหนคะ?', subtitle: 'เลือกวันหยุดใหม่ได้เลยค่ะ', icon: '✨', actions: [dtPicker('เลือกวันที่', 'hr-wiz-swap-to:pick')] })
const confirmMessage = (session) => {
  const isSwap = session.leave_type === 'สลับวันหยุด'
  const isRange = !isSwap && session.date2 && session.date2 !== session.date
  const dateLabel = isSwap
    ? `${thaiDateLabel(session.date)} → ${thaiDateLabel(session.date2)}`
    : isRange ? `${thaiDateLabel(session.date)} – ${thaiDateLabel(session.date2)}` : thaiDateLabel(session.date)
  const leavePeriod = isSwap ? 'full' : normalizeLeavePeriod(session.leave_period)
  const days = isSwap ? 1 : leavePeriod === 'full' ? daysBetween(session.date, session.date2 || session.date) : 0.5
  return { type: 'flex', altText: `ยืนยัน${session.leave_type} ${dateLabel}`, contents: {
    type: 'bubble', size: 'kilo',
    header: lineCardHeader('ตรวจสอบก่อนส่ง', 'เช็กข้อมูลอีกครั้งนะคะ', '📝'),
    body: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'md', backgroundColor: '#FBFEFF', contents: [
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        summaryTile('ประเภท', `${leaveTypeIcon(session.leave_type)} ${session.leave_type}`, LINE_CARD.skySoft, LINE_CARD.blueDark),
        summaryTile('จำนวน', `${days} วัน`, LINE_CARD.sky, LINE_CARD.blueDark),
        summaryTile('วันเริ่ม', lineCompactDate(session.date), '#F5FBFF', LINE_CARD.blueDark),
      ] },
      { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', cornerRadius: '14px', backgroundColor: LINE_CARD.skySoft, contents: [
        factRow(isSwap ? 'วันหยุดเดิม → ใหม่' : 'วันที่ลา', dateLabel),
        ...(!isSwap ? [factRow('ช่วงเวลา', leavePeriodLabel(leavePeriod))] : []),
      ] },
    ] },
    footer: { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px', backgroundColor: LINE_CARD.skySoft, contents: [
      lineCardButton({ type: 'postback', label: 'กลับไปแก้', data: 'hr-wiz-confirm:no', displayText: 'ยกเลิก' }),
      lineCardButton({ type: 'postback', label: 'ยืนยันส่งคำขอ', data: 'hr-wiz-confirm:yes', displayText: 'ยืนยัน' }, true),
    ] },
  } }
}
// วันที่เลือกไว้ทำให้บ้านล่างเหลือคนน้อยกว่าขั้นต่ำ — บังคับเลือกคนออฟฟิศมาทดแทนก่อนยืนยันได้
const officeBackupMessage = (need, chosenCodes = []) => choiceCard({
  altText: 'เลือกคนออฟฟิศมาทดแทน', title: 'เลือกคนมาทดแทนค่ะ',
  subtitle: `${thaiDateLabel(need.date)} · ${need.period === 'am' ? 'ช่วงเช้า' : 'ช่วงบ่าย'} · แสดงเฉพาะคนที่ว่างค่ะ`, icon: '🫧',
  actions: need.candidates.filter((candidate) => !chosenCodes.includes(candidate.code)).map((candidate) => ({ type: 'postback', label: candidate.name, data: `hr-wiz-office:${candidate.code}`, displayText: candidate.name })),
})

const parseSessionJson = (value, fallback = []) => {
  try { const parsed = JSON.parse(value || ''); return Array.isArray(parsed) ? parsed : fallback } catch { return fallback }
}
const expandBackupNeeds = (needs) => needs.flatMap((need) => Array.from({ length: need.required }, () => need))

const getLineSessions = () => getSheet('hr_line_sessions')
async function upsertSession(lineUserId, patch) {
  const current = await getLineSessions()
  const existing = current.find((r) => r.line_user_id === lineUserId) || { line_user_id: lineUserId, step: '', leave_type: '', date: '' }
  const next = { ...existing, ...patch, updated_at: new Date().toISOString() }
  const rows = current.filter((r) => r.line_user_id !== lineUserId).map((r) => LINE_SESSION_HEADERS.map((h) => r[h] ?? ''))
  rows.push(LINE_SESSION_HEADERS.map((h) => next[h] ?? ''))
  await overwriteSheet('hr_line_sessions', LINE_SESSION_HEADERS, rows)
  return next
}
async function clearSession(lineUserId) {
  const current = await getLineSessions()
  const rows = current.filter((r) => r.line_user_id !== lineUserId).map((r) => LINE_SESSION_HEADERS.map((h) => r[h] ?? ''))
  await overwriteSheet('hr_line_sessions', LINE_SESSION_HEADERS, rows)
}

// พนักงาน manpower ที่ผูก LINE ไว้แล้ว (username เก็บเป็น mp:<code> เหมือน request-leave-for) — ไม่พบ = ยังไม่ได้ผูก ใช้เมนูลาไม่ได้
async function findStaffLink(lineUserId) {
  const links = await getSheet('hr_line_links')
  const link = links.find((l) => l.line_user_id === lineUserId && String(l.username || '').startsWith('mp:'))
  if (!link) return null
  const code = link.username.slice(3)
  const person = await findHrPerson(code)
  if (!person) return null
  return { username: link.username, code, name: person.name, group: person.group }
}

async function handleLeaveWizard(event, staffLink) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const invalid = () => replyMessage(replyToken, [{ type: 'text', text: 'เริ่มใหม่โดยพิมพ์ "ลา" ได้เลยค่ะ' }])

  if (event.type === 'message' && event.message?.type === 'text') {
    const text = String(event.message.text || '').trim()
    const session = (await getLineSessions()).find((s) => s.line_user_id === lineUserId)

    // พิมพ์ "ลา" เริ่มใหม่ได้เสมอ แม้มี session ค้างจากรอบก่อน (เช่น กดออกจากแชทกลางคัน ไม่กดปุ่มจนจบ) — ไม่งั้นบอทจะเงียบตลอดไปเพราะข้อความอื่นไม่ถูกจับเลย
    if (text === LEAVE_TRIGGER) {
      await upsertSession(lineUserId, { step: 'await_type', leave_type: '', date: '', date2: '', leave_period: '', backup_assignments: '', backup_needs: '', backup_cursor: '', edit_leave_id: '' })
      return replyMessage(replyToken, [typeQuickReplyMessage(staffLink)])
    }
    if (text === LEAVE_EDIT_TRIGGER && staffLink) {
      const leaves = (await getSheet('hr_leave')).filter((leave) => leave.username === staffLink.username && ['pending', 'approved'].includes(leave.status) && leave.edit_pending !== '1').sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
      if (!leaves.length) return replyMessage(replyToken, [{ type: 'text', text: 'ตอนนี้ไม่มีรายการลาที่แก้ไขได้ค่ะ หากต้องการลาใหม่พิมพ์ “ลา” ได้เลยนะคะ' }])
      await upsertSession(lineUserId, { step: 'await_edit_pick', edit_leave_id: '', backup_assignments: '', backup_needs: '', backup_cursor: '' })
      return replyMessage(replyToken, [editLeaveChoiceMessage(leaves)])
    }
    if (text === LEAVE_CANCEL_TRIGGER && staffLink) {
      const leaves = (await getSheet('hr_leave')).filter((leave) => leave.username === staffLink.username && ['pending', 'approved'].includes(leave.status) && leave.edit_pending !== '1').sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
      if (!leaves.length) return replyMessage(replyToken, [{ type: 'text', text: 'ตอนนี้ไม่มีรายการลาที่ยกเลิกได้ค่ะ' }])
      return replyMessage(replyToken, [cancelLeaveChoiceMessage(leaves)])
    }
    if (text === LEAVE_SUMMARY_TRIGGER && staffLink) {
      return replyMessage(replyToken, [{ type: 'text', text: await leaveOwnSummaryText(staffLink) }])
    }
    if (text === LEAVE_HISTORY_TRIGGER && staffLink) {
      return replyMessage(replyToken, [{ type: 'text', text: await leaveHistoryText(staffLink) }])
    }
    return // ข้อความอื่นที่ไม่เข้าเงื่อนไข ไม่ตอบ กันสแปมแชท
  }

  if (event.type === 'postback') {
    const data = String(event.postback?.data || '')
    const session = (await getLineSessions()).find((s) => s.line_user_id === lineUserId)
    const pickedDate = event.postback?.params?.date // มาจากปฏิทินจริงของ LINE (datetimepicker) เท่านั้น ไม่มีทางพิมพ์ผิด

    if (data.startsWith('hr-wiz-edit:') || data.startsWith('hr-wiz-edit-direct:')) {
      const direct = data.startsWith('hr-wiz-edit-direct:')
      if ((!direct && session?.step !== 'await_edit_pick') || !staffLink) return invalid()
      const editLeaveId = data.slice((direct ? 'hr-wiz-edit-direct:' : 'hr-wiz-edit:').length)
      const target = (await getSheet('hr_leave')).find((leave) => String(leave.id) === editLeaveId && leave.username === staffLink.username && ['pending', 'approved'].includes(leave.status) && leave.edit_pending !== '1')
      if (!target) return replyMessage(replyToken, [{ type: 'text', text: 'รายการนี้แก้ไขไม่ได้แล้วค่ะ ลองพิมพ์ “แก้ไขลา” ใหม่อีกครั้งนะคะ' }])
      await upsertSession(lineUserId, { step: 'await_type', edit_leave_id: editLeaveId, leave_type: '', date: '', date2: '', leave_period: '', backup_assignments: '', backup_needs: '', backup_cursor: '' })
      return replyMessage(replyToken, [{ type: 'text', text: 'เลือกข้อมูลใหม่ได้เลยค่ะ รายการเดิมจะยังมีผลจนกว่า HR จะยืนยันการแก้ไขนะคะ' }, typeQuickReplyMessage(staffLink)])
    }

    if (data.startsWith('hr-wiz-cancelpick:')) {
      if (!staffLink) return invalid()
      const cancelLeaveId = data.slice('hr-wiz-cancelpick:'.length)
      const current = await getSheet('hr_leave')
      const target = current.find((leave) => String(leave.id) === cancelLeaveId && leave.username === staffLink.username)
      if (!target || !['pending', 'approved'].includes(target.status) || target.edit_pending === '1') return replyMessage(replyToken, [{ type: 'text', text: 'รายการนี้ยกเลิกไม่ได้แล้วค่ะ' }])
      if (target.status === 'approved') {
        // อนุมัติไปแล้ว — ยกเลิกเองทันทีไม่ได้ ต้องส่งคำขอแล้วรอ HR ยืนยันก่อน (เหมือนขอแก้ไข)
        const now = new Date().toISOString()
        const payload = { cancel_requested: true, note: '' }
        const record = { ...target, edit_pending: '1', edit_payload: JSON.stringify(payload), edit_requested_at: now, edit_requested_by: staffLink.name }
        await overwriteSheet('hr_leave', LEAVE_HEADERS, current.map((leave) => String(leave.id) === String(target.id) ? record : leave).map((leave) => LEAVE_HEADERS.map((header) => leave[header] ?? '')))
        await appendLeaveAudit(target.id, 'cancel-requested', target, payload, staffLink.name)
        clearHrCache()
        const proposed = { ...target, ...payload, status: 'pending', is_edit_request: true }
        await Promise.all([notifyNewLeaveRequestSafely(proposed), replyMessage(replyToken, [{ type: 'text', text: `ส่งคำขอยกเลิกวันลาวันที่ ${thaiDateLabel(target.start_date)} (${target.leave_type}) แล้วค่ะ รอ HR ยืนยันอีกทีนะคะ` }])])
        return
      }
      const kept = current.filter((leave) => String(leave.id) !== cancelLeaveId)
      const backupRows = await getSheet('hr_leave_backups')
      const keptBackups = backupRows.filter((row) => String(row.leave_id) !== cancelLeaveId)
      await Promise.all([
        overwriteSheet('hr_leave', LEAVE_HEADERS, kept.map((r) => LEAVE_HEADERS.map((h) => r[h] ?? ''))),
        overwriteSheet('hr_leave_backups', BACKUP_HEADERS, keptBackups.map((row) => BACKUP_HEADERS.map((header) => row[header] ?? ''))),
      ])
      clearHrCache()
      return replyMessage(replyToken, [{ type: 'text', text: `ยกเลิกคำขอลาวันที่ ${thaiDateLabel(target.start_date)} (${target.leave_type}) แล้วค่ะ` }])
    }

    if (data.startsWith('hr-wiz-type:')) {
      if (session?.step !== 'await_type') return invalid()
      const leaveType = data.slice('hr-wiz-type:'.length)
      if (leaveType === 'พักร้อน' && staffLink && !hasVacationBenefit(staffLink.group)) {
        await upsertSession(lineUserId, { step: 'await_type', leave_type: '', date: '', date2: '' })
        return replyMessage(replyToken, [{ type: 'text', text: `${staffLink.group}ไม่มีสิทธิ์วันลาพักร้อนค่ะ กรุณาเลือกประเภทการลาอื่นนะคะ` }, typeQuickReplyMessage(staffLink)])
      }
      if (leaveType === 'สลับวันหยุด') {
        await upsertSession(lineUserId, { leave_type: leaveType, step: 'await_swap_from' })
        return replyMessage(replyToken, [swapFromMessage()])
      }
      await upsertSession(lineUserId, { leave_type: leaveType, step: 'await_date' })
      if (leaveType === 'พักร้อน' && staffLink) {
        const balance = await vacationBalanceFor(staffLink.code)
        return replyMessage(replyToken, [{ type: 'text', text: `ตอนนี้เหลือวันลาพักร้อน ${balance.remaining} วันค่ะ (ใช้ไปแล้ว ${balance.used}/${balance.quota} วัน)` }, dateChoiceMessage()])
      }
      return replyMessage(replyToken, [dateChoiceMessage()])
    }

    // ── ประเภทลาทั่วไป: วันเดียว (วันนี้/พรุ่งนี้) หรือเลือกช่วงวันที่เอง (ลาหลายวัน/หยุดยาว) ──
    if (data.startsWith('hr-wiz-date:')) {
      if (session?.step !== 'await_date') return invalid()
      const choice = data.slice('hr-wiz-date:'.length)
      if (choice === 'range') {
        await upsertSession(lineUserId, { step: 'await_range_start' })
        return replyMessage(replyToken, [rangeStartMessage()])
      }
      const date = choice === 'today' ? todayStr() : addDaysStr(todayStr(), 1)
      await upsertSession(lineUserId, { date, date2: date, step: 'await_period' })
      return replyMessage(replyToken, [periodChoiceMessage()])
    }
    if (data === 'hr-wiz-range-start:pick') {
      if (session?.step !== 'await_range_start' || !pickedDate) return invalid()
      await upsertSession(lineUserId, { date: pickedDate, step: 'await_range_end' })
      return replyMessage(replyToken, [rangeEndMessage(pickedDate)])
    }
    if (data === 'hr-wiz-range-end:pick') {
      if (session?.step !== 'await_range_end' || !pickedDate) return invalid()
      if (pickedDate < session.date) return replyMessage(replyToken, [{ type: 'text', text: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มค่ะ ลองเลือกใหม่นะคะ' }, rangeEndMessage(session.date)])
      if (pickedDate === session.date) {
        await upsertSession(lineUserId, { date2: pickedDate, step: 'await_period' })
        return replyMessage(replyToken, [periodChoiceMessage()])
      }
      const next = await upsertSession(lineUserId, { date2: pickedDate, leave_period: 'full', step: 'await_confirm' })
      return replyMessage(replyToken, [confirmMessage(next)])
    }

    if (data.startsWith('hr-wiz-period:')) {
      if (session?.step !== 'await_period') return invalid()
      const leavePeriod = data.slice('hr-wiz-period:'.length)
      if (!['full', 'am', 'pm'].includes(leavePeriod)) return invalid()
      const next = await upsertSession(lineUserId, { leave_period: leavePeriod, date2: leavePeriod === 'full' ? session.date2 || session.date : session.date, step: 'await_confirm' })
      return replyMessage(replyToken, [confirmMessage(next)])
    }

    // ── สลับวันหยุด: จาก (วันหยุดเดิม) -> เป็น (วันหยุดใหม่) ──
    if (data === 'hr-wiz-swap-from:pick') {
      if (session?.step !== 'await_swap_from' || !pickedDate) return invalid()
      await upsertSession(lineUserId, { date: pickedDate, step: 'await_swap_to' })
      return replyMessage(replyToken, [swapToMessage()])
    }
    if (data === 'hr-wiz-swap-to:pick') {
      if (session?.step !== 'await_swap_to' || !pickedDate) return invalid()
      const next = await upsertSession(lineUserId, { date2: pickedDate, leave_period: 'full', step: 'await_confirm' })
      return replyMessage(replyToken, [confirmMessage(next)])
    }

    // เลือกคนออฟฟิศมาทดแทนวันที่ล็อค (ถูกส่งมาก็ต่อเมื่อ hr-wiz-confirm:yes เจอวันล็อคด้านล่าง)
    if (data.startsWith('hr-wiz-office:')) {
      if (session?.step !== 'await_office_backup') return invalid()
      const code = data.slice('hr-wiz-office:'.length)
      const steps = parseSessionJson(session.backup_needs)
      const cursor = Number(session.backup_cursor) || 0
      const currentNeed = steps[cursor]
      if (!currentNeed || !currentNeed.candidates?.some((candidate) => candidate.code === code)) return invalid()
      const assignments = parseSessionJson(session.backup_assignments)
      const sameSlotCodes = assignments.filter((item) => item.date === currentNeed.date && item.period === currentNeed.period).map((item) => item.office_code)
      if (sameSlotCodes.includes(code)) return invalid()
      const nextAssignments = [...assignments, { date: currentNeed.date, period: currentNeed.period, office_code: code }]
      const nextCursor = cursor + 1
      if (nextCursor < steps.length) {
        const nextNeed = steps[nextCursor]
        const chosenCodes = nextAssignments.filter((item) => item.date === nextNeed.date && item.period === nextNeed.period).map((item) => item.office_code)
        await upsertSession(lineUserId, { backup_assignments: JSON.stringify(nextAssignments), backup_cursor: String(nextCursor) })
        return replyMessage(replyToken, [officeBackupMessage(nextNeed, chosenCodes)])
      }
      const next = await upsertSession(lineUserId, { backup_office: nextAssignments[0]?.office_code || '', backup_assignments: JSON.stringify(nextAssignments), backup_cursor: String(nextCursor), step: 'await_confirm' })
      return replyMessage(replyToken, [confirmMessage(next)])
    }

    if (data === 'hr-wiz-confirm:yes') {
      if (session?.step !== 'await_confirm' || !staffLink) return invalid()
      if (session.leave_type === 'พักร้อน' && !hasVacationBenefit(staffLink.group)) {
        await upsertSession(lineUserId, { step: 'await_type', leave_type: '', date: '', date2: '' })
        return replyMessage(replyToken, [{ type: 'text', text: `${staffLink.group}ไม่มีสิทธิ์วันลาพักร้อนค่ะ กรุณาเลือกประเภทการลาอื่นนะคะ` }, typeQuickReplyMessage(staffLink)])
      }
      const isSwap = session.leave_type === 'สลับวันหยุด'
      const endDate = session.date2 || session.date
      const leavePeriod = isSwap ? 'full' : normalizeLeavePeriod(session.leave_period)
      const draft = { leave_type: session.leave_type, start_date: session.date, end_date: endDate, leave_period: leavePeriod, days: leavePeriod === 'full' ? undefined : 0.5 }
      const coverage = await resolveLeaveCoverage(staffLink.username, draft, parseSessionJson(session.backup_assignments), session.edit_leave_id)
      if (!coverage.ok) {
        if (coverage.blocked) return replyMessage(replyToken, [{ type: 'text', text: `${coverage.error}\nลองเลือกวันอื่นโดยพิมพ์ “ลา” อีกครั้งนะคะ` }])
        const steps = expandBackupNeeds(coverage.needs || [])
        if (!steps.length) return replyMessage(replyToken, [{ type: 'text', text: coverage.error || 'ยังส่งคำขอไม่ได้ค่ะ' }])
        await upsertSession(lineUserId, { step: 'await_office_backup', backup_needs: JSON.stringify(steps), backup_assignments: '', backup_cursor: '0' })
        return replyMessage(replyToken, [officeBackupMessage(steps[0])])
      }
      const now = new Date().toISOString()
      if (session.edit_leave_id) {
        const current = await getSheet('hr_leave')
        const target = current.find((leave) => String(leave.id) === String(session.edit_leave_id) && leave.username === staffLink.username)
        if (!target || !['pending', 'approved'].includes(target.status) || target.edit_pending === '1') return replyMessage(replyToken, [{ type: 'text', text: 'รายการนี้แก้ไขไม่ได้แล้วค่ะ ลองพิมพ์ “แก้ไขลา” ใหม่อีกครั้งนะคะ' }])
        const payload = {
          ...draft,
          days: isSwap ? 1 : leavePeriod === 'full' ? daysBetween(session.date, endDate) : 0.5,
          reason: target.reason || '', backup_office: coverage.assignments?.[0]?.office_code || '', backup_assignments: coverage.assignments || [],
          understaffed_dates: (coverage.understaffedDates || []).join(','),
        }
        const record = { ...target, edit_pending: '1', edit_payload: JSON.stringify(payload), edit_requested_at: now, edit_requested_by: staffLink.name }
        await overwriteSheet('hr_leave', LEAVE_HEADERS, current.map((leave) => String(leave.id) === String(target.id) ? record : leave).map((leave) => LEAVE_HEADERS.map((header) => leave[header] ?? '')))
        await appendLeaveAudit(target.id, 'edit-requested', target, payload, staffLink.name)
        clearHrCache()
        await clearSession(lineUserId)
        const proposed = { ...target, ...payload, status: 'pending', is_edit_request: true }
        await Promise.all([notifyNewLeaveRequestSafely(proposed), replyMessage(replyToken, [leaveFlexMessage(proposed, 'submitted', await getOfficePeopleMap())])])
        return
      }
      const record = {
        id: `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        username: staffLink.username, employee_name: staffLink.name, leave_type: session.leave_type,
        start_date: session.date, end_date: endDate,
        days: isSwap ? 1 : leavePeriod === 'full' ? daysBetween(session.date, endDate) : 0.5,
        reason: '', status: 'pending',
        requested_by: staffLink.name, requested_at: now,
        decided_by: '', decided_at: '', decision_note: '',
        backup_office: coverage.assignments?.[0]?.office_code || '', leave_period: leavePeriod,
        backup_assignments: coverage.assignments || [],
        understaffed_dates: (coverage.understaffedDates || []).join(','),
      }
      if (coverage.assignments?.length) await appendRows('hr_leave_backups', coverage.assignments.map((assignment) => BACKUP_HEADERS.map((header) => ({ leave_id: record.id, ...assignment, created_at: now })[header] ?? '')))
      await appendRows('hr_leave', [LEAVE_HEADERS.map((h) => record[h] ?? '')])
      clearHrCache()
      await clearSession(lineUserId)
      const submittedMessage = leaveFlexMessage(record, 'submitted', await getOfficePeopleMap())
      await Promise.all([notifyNewLeaveRequestSafely(record), replyMessage(replyToken, [submittedMessage])])
      return
    }
    if (data === 'hr-wiz-confirm:no') {
      await clearSession(lineUserId)
      return replyMessage(replyToken, [{ type: 'text', text: 'ยกเลิกให้แล้วค่ะ' }])
    }
  }
}

async function opLineWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!verifySignature(req.rawBody, req.headers['x-line-signature'])) return res.status(401).end()
  const events = Array.isArray(req.body?.events) ? req.body.events : []
  for (const event of events) {
    try {
      const lineUserId = event.source?.userId
      const staffLink = lineUserId ? await findStaffLink(lineUserId) : null

      if (event.type === 'message' && event.message?.type === 'text') {
        if (staffLink) { await handleLeaveWizard(event, staffLink); continue }
        // รอบอส/dev พิมพ์จำนวนสั่งของกลับมาไหม (หลังกดปุ่ม "สั่งของ" จากการ์ดแจ้งเตือนของใกล้หมด หรือหลังเลือกจาก
        // ผลค้นหา) หรือกำลังพิมพ์ชื่อ/SKU ค้นหาอยู่ (หลังพิมพ์ "สั่งของ" เปล่าๆ) — เช็คก่อน fallback echo userId
        // ด้านล่าง เพราะบอส/dev ไม่ผ่าน findStaffLink (นั่นสำหรับพนักงาน mp: เท่านั้น)
        const stockSession = lineUserId ? (await getStockOrderSessions()).find((s) => s.line_user_id === lineUserId) : null
        if (stockSession?.step === 'await_qty') { await handleStockOrderQtyReply(event, stockSession); continue }
        if (stockSession?.step === 'await_sku_search' || stockSession?.step === 'await_sku_pick') { await handleStockOrderSearchReply(event); continue }
        // พิมพ์ "สั่งของ" เฉยๆ (ไม่ได้มาจากการ์ดแจ้งเตือน) — สั่งของที่ยังไม่ใกล้หมดได้ด้วย
        if (String(event.message.text || '').includes('สั่งของ') && await handleStockOrderSearchStart(event)) continue
        // ยังไม่ผูกเป็นพนักงาน (หรือเป็น admin) — ตอบ userId กลับไปให้ก็อปไปผูกในหน้า Settings ได้เลย ไม่ต้องเปิด log
        if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: `LINE userId ของคุณคือ:\n${lineUserId || '(ไม่พบ)'}\n\nเอาไปวางที่เว็บ Payi Ops > Settings > แจ้งเตือนผ่าน LINE` }])
        continue
      }

      if (event.type !== 'postback') continue
      const data = String(event.postback?.data || '')
      if (data.startsWith('hr-wiz-')) { await handleLeaveWizard(event, staffLink); continue }
      if (data.startsWith('stock-order:')) { await handleStockOrderPostback(event, data.slice('stock-order:'.length)); continue }
      if (data.startsWith('stock-pick:')) { await handleStockPickPostback(event, data.slice('stock-pick:'.length)); continue }

      const [, kind, id] = data.match(/^hr-(approve|reject):(.+)$/) || []
      if (!kind || !id) continue
      const decision = kind === 'approve' ? 'approved' : 'rejected'
      const links = await getSheet('hr_line_links')
      const link = links.find((l) => l.line_user_id === lineUserId)
      let decidedBy = 'LINE'
      if (link) {
        const user = (await getSheet('users')).find((u) => u.username === link.username)
        decidedBy = user?.display_name || link.username
      }
      const { record, error } = await applyLeaveDecision(id, decision, decidedBy)
      if (event.replyToken) {
        const message = error
          ? { type: 'text', text: `ทำรายการไม่สำเร็จ: ${error}` }
          : leaveFlexMessage(record, decision, await getOfficePeopleMap())
        await replyMessage(event.replyToken, [message])
      }
    } catch (e) { console.error('opLineWebhook event:', e.message) }
  }
  return res.status(200).end()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    await readRawBody(req)
    try { req.body = JSON.parse(req.rawBody || '{}') } catch { req.body = {} }
  }
  const op = String(req.query.op || '')
  if (op === 'line-webhook') return opLineWebhook(req, res)
  // Vercel Cron เรียกไม่มี user token — ข้าม requireAuth เหมือน line-webhook แล้วเช็ค CRON_SECRET แทนในตัวมันเอง
  if (op === 'inventory' && req.query.cron === 'low-stock') return opLowStockCron(req, res)
  if (!requireAuth(req, res)) return
  // Staff only needs the data behind its operational areas (now includes
  // inventory, per owner request to open Inventory/Stock Movement to staff).
  // Raw sheet tools, HR and settings data remain restricted even if called directly.
  if (authEnabled() && !canManageOperations(req.user?.role) && !['summary', 'workforce', 'planner', 'inventory'].includes(op)) {
    return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  }
  if (op === 'summary') return opSummary(req, res)
  if (op === 'sheet') return opSheet(req, res)
  if (op === 'append') return opAppend(req, res)
  if (op === 'overwrite') return opOverwrite(req, res)
  if (op === 'workforce') return opWorkforce(req, res)
  if (op === 'planner') return opPlanner(req, res)
  if (op === 'hr') return opHr(req, res)
  if (op === 'inventory') return opInventory(req, res)
  if (op === 'import-tracking') return opImportTracking(req, res)
  return res.status(400).json({ error: 'ต้องระบุ ?op=summary|sheet|append|overwrite|workforce|planner|hr|inventory|import-tracking|line-webhook' })
}
