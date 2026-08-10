// GET/POST /api/sheet-tools?op=summary|sheet|append|overwrite|workforce|planner|hr|inventory
// รวม 4 endpoint เครื่องมือชีตเดิม (/api/summary /api/sheet /api/append /api/overwrite)
// เป็นฟังก์ชันเดียว — Vercel Hobby จำกัด 12 serverless functions ต่อโปรเจค
import { requireAuth, cacheable, authEnabled } from './_lib/auth.js'
import { canManageOperations, normalizeRole } from '../shared/roles.js'
import { getMetaCached, batchGetValues, getSheet, appendRows, overwriteSheet, ensureSheet, ensureSheets } from './_lib/sheets.js'
import { verifySignature, pushMessage, replyMessage, linkRichMenuToUser } from './_lib/line.js'
import {
  MIN_LOWER_HOUSE_HEADCOUNT, buildCoveragePlan, leaveAbsenceDates, leaveAbsenceSlots,
  leavePeriodLabel, normalizeLeavePeriod, officeLeaveConflicts,
} from './_lib/leaveCoverage.js'
import { applyScheduleOverrides, LEGACY_OVERRIDE_EXEMPT_CODES } from './_lib/scheduleOverrides.js'
import { isoDate } from './_lib/dates.js'
import opInventory, { computeLowStockList, createOrderRequest, createOrderRequestForGroup, loadOrderGroups, addStockInRequest, matchStockInRequest, rejectStockInRequest, undoStockInDecision, editStockInRequest, getStockInRequestById, loadStockInRequests, loadItemsWithBalance, isPackagingItem } from './_lib/inventory.js'
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
const PEOPLE_HEADERS = ['code', 'name', 'group', 'active', 'day_off_weekday', 'day_off_effective_from']
const OT_LIMIT_HEADERS = ['employee', 'limit_hours', 'updated_at', 'updated_by']
const OT_APPROVAL_HISTORY_HEADERS = ['id', 'month', 'employee', 'before_minutes', 'after_minutes', 'changed_at', 'changed_by']
// บันทึกวันพิเศษ: โอทีเต็มวัน (มาทำวันหยุด/นักขัตฤกษ์) หรือมาชดเชยเฉยๆไม่รับโอที — แยกจาก workforce_ot ที่เป็น OT รายชั่วโมง
// สลับวันหยุด ("จากวันไหนไปวันไหน") มีอยู่แล้วเป็น leave_type 'สลับวันหยุด' ใน hr_leave ไม่ต้องทำซ้ำที่นี่
const DAYRECORD_HEADERS = ['id', 'date', 'employee', 'team', 'kind', 'reason', 'paid_ot', 'note', 'created_at', 'created_by']
const LEAVE_HEADERS = ['id', 'username', 'employee_name', 'leave_type', 'start_date', 'end_date', 'days', 'reason', 'status', 'requested_by', 'requested_at', 'decided_by', 'decided_at', 'decision_note', 'backup_office', 'leave_period', 'edit_pending', 'edit_payload', 'edit_requested_at', 'edit_requested_by', 'understaffed_dates']
const BACKUP_HEADERS = ['leave_id', 'date', 'period', 'office_code', 'created_at']
const LEAVE_EDIT_HEADERS = ['leave_id', 'mode', 'before_json', 'after_json', 'changed_at', 'changed_by']
const SCHEDULE_HEADERS = ['id', 'date', 'username', 'employee_name', 'shift_start', 'shift_end', 'role_note', 'created_at', 'created_by']
// notify_hr/notify_stock: '1'/'' = รับ (default), '0' = ปิด — แยกเปิด/ปิดแจ้งเตือนแต่ละหมวดได้ต่อคน
// (บอสลาไม่เกี่ยวกับบอสสต็อก คนละคนกัน ไม่อยากให้ได้แจ้งเตือนของอีกฝั่ง)
const LINE_LINK_HEADERS = ['username', 'line_user_id', 'updated_at', 'notify_hr', 'notify_stock']
const LINE_SESSION_HEADERS = ['line_user_id', 'step', 'leave_type', 'date', 'date2', 'backup_office', 'updated_at', 'leave_period', 'backup_assignments', 'backup_needs', 'backup_cursor', 'edit_leave_id']
// โควตาวันลาพักร้อนต่อคนต่อปี — แยกชีตต่างหาก (ไม่ยุ่งกับ workforce_people) เพราะครอบคุมทั้งบ้านล่างและออฟฟิศ แก้ค่าตรงในชีตได้เลย ไม่ต้องแก้โค้ด
const QUOTA_HEADERS = ['code', 'quota', 'updated_at']
const DEFAULT_VACATION_QUOTA = 6
const NO_VACATION_GROUPS = new Set(['คนฟีด', 'พาร์ทไทม์'])
const hasVacationBenefit = (group) => !NO_VACATION_GROUPS.has(String(group || '').trim())
// รายชื่อออฟฟิศ — ย้ายจาก object hardcode มาเป็นชีต (เหมือน workforce_people) เพื่อให้เพิ่ม/ลบคนได้จากหน้าเว็บ ไม่ต้องแก้โค้ด
const OFFICE_HEADERS = ['code', 'name', 'active', 'day_off_weekday', 'day_off_effective_from']
const DEFAULT_OFFICE_ROWS = [['TOON', 'ตูน', '1'], ['KED', 'เกด', '1'], ['MO', 'โม', '1']]
const HR_SHEETS = [['hr_leave', LEAVE_HEADERS], ['hr_leave_backups', BACKUP_HEADERS], ['hr_leave_edits', LEAVE_EDIT_HEADERS], ['hr_schedule', SCHEDULE_HEADERS], ['hr_line_links', LINE_LINK_HEADERS], ['hr_line_sessions', LINE_SESSION_HEADERS], ['hr_leave_quota', QUOTA_HEADERS], ['hr_office_people', OFFICE_HEADERS], ['workforce_schedule_snapshot', SCHEDULE_SNAPSHOT_HEADERS], ['workforce_schedule_overrides', SCHEDULE_OVERRIDE_HEADERS]]
let hrEnsurePromise
let hrCache = { at: 0, data: null }
const ensureHrSheets = () => hrEnsurePromise ||= ensureSheets(HR_SHEETS)
let hrInflight = null
const clearHrCache = () => { hrCache = { at: 0, data: null }; hrInflight = null }
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

// รายชื่อ admin ที่ผูก LINE ไว้แล้ว (username, line_user_id) — ใช้ตอนแจ้งเตือนคำขอลาใหม่ — เฉพาะคนที่ไม่ได้ปิด
// แจ้งเตือนหมวดการลาไว้ (notify_hr) เพราะบอสฝั่ง HR กับบอสฝั่งสต็อกอาจเป็นคนละคน ไม่อยากให้ได้แจ้งเตือนไขว้กัน
async function getAdminLineTargets() {
  const [users, links] = await Promise.all([getSheet('users'), getSheet('hr_line_links')])
  const linkByUsername = Object.fromEntries(links.filter((l) => l.username && l.line_user_id && String(l.notify_hr) !== '0').map((l) => [l.username, l.line_user_id]))
  return users.filter((u) => canManageOperations(u.role) && linkByUsername[u.username]).map((u) => ({ username: u.username, line_user_id: linkByUsername[u.username] }))
}

// เหมือน getAdminLineTargets แต่กรองด้วย notify_stock — ใช้แจ้งเตือนของใกล้หมด/หมด แยกกลุ่มผู้รับกันชัดเจน
// เฉพาะ Boss เท่านั้น (owner ขอ 2026-08-06) — Dev ยังกด approve/ปฏิเสธเองได้ตามปกติถ้าเข้ามาดู (canManageOperations
// ยังคุมสิทธิ์เข้าถึง/กดปุ่มอยู่เหมือนเดิม) แค่ไม่ต้องการให้ยิงแจ้งเตือนหาเฉยๆ เหมือนมีกุญแจแต่ไม่ต้องโชว์หน้า
async function getStockLineTargets() {
  const [users, links] = await Promise.all([getSheet('users'), getSheet('hr_line_links')])
  const linkByUsername = Object.fromEntries(links.filter((l) => l.username && l.line_user_id && String(l.notify_stock) !== '0').map((l) => [l.username, l.line_user_id]))
  return users.filter((u) => normalizeRole(u.role) === 'boss' && linkByUsername[u.username]).map((u) => ({ username: u.username, line_user_id: linkByUsername[u.username] }))
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
// items_json: ต่อท้ายล่าสุด — เก็บรายการหลายชิ้นตอนสั่งของแบบ batch (พิมพ์ทีเดียวหลายบรรทัด "ชื่อ/SKU = จำนวน")
const STOCK_ORDER_SESSION_HEADERS = ['line_user_id', 'step', 'sku', 'qty', 'order_date', 'updated_at', 'items_json', 'pending_json']
// items_json: ต่อท้ายล่าสุด — เก็บรายการหลายชิ้นตอนแจ้งของเข้าแบบ batch (เหมือนตะกร้าสั่งของ)
// แยกชีต/session จาก stock_order_sessions เพื่อกันคนที่กำลังสั่งของค้างอยู่แล้วมาแจ้งของเข้าพร้อมกัน
// (หรือกลับกัน) ไม่ให้ session ของทั้งสอง flow ทับกัน
const STOCK_IN_SESSION_SHEET = 'stock_in_sessions'
const STOCK_IN_SESSION_HEADERS = ['line_user_id', 'step', 'sku', 'qty', 'arrival_date', 'count_date', 'updated_at', 'items_json', 'pending_json', 'edit_target_id']
// เก็บ groupId ของกลุ่มไลน์ทีมงาน (แถวเดียว) — ลงทะเบียนอัตโนมัติทันทีที่มีข้อความจากกลุ่มเข้ามา ไม่ต้อง
// ตั้งค่าเอง แค่เพิ่มบอทเข้ากลุ่มแล้วมีคนพิมพ์อะไรสักครั้ง ใช้ push การ์ด "แจ้งของเข้า" ให้ทั้งทีมเห็นพร้อมกัน
const LINE_GROUP_LINK_SHEET = 'line_group_link'
const LINE_GROUP_LINK_HEADERS = ['group_id', 'updated_at']
const STOCK_STATUS_ICON = { 'หมด': '🔴', 'ใกล้หมด': '🟠' }
const todayBKK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
// ตั้งบน Vercel เป็น URL จริงของเว็บ (เช่น https://payiops.vercel.app) — ใช้สร้างปุ่ม "เปิดเว็บ" ใน LINE
// ไม่ตั้งไว้ = ข้ามปุ่มนี้เฉยๆ ไม่พัง (เผื่อยังไม่ได้ตั้งตอน deploy รอบแรก)
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/$/, '')
// เดิม tab id พิมพ์ผิด ("StockMovement" ไม่มีเว้นวรรค) ไม่ตรงกับ id จริงใน App.jsx ("Stock Movement" มีเว้น
// วรรค) ลิงก์เลยไม่พาไปหน้าที่ตั้งใจ — แก้ให้เรียก appWebUrl() ตัวเดียวกับที่ตั้ง Stock Movement/Executive
// ที่อื่นในไฟล์นี้ (ประกาศทีหลังในไฟล์แต่เรียกใช้ตอน runtime หลังโมดูลโหลดครบแล้วเสมอ ไม่มีปัญหา hoist)
const stockWebUrl = () => appWebUrl('Stock Movement')

// โทนเหลืองละมุน แยกจาก LINE_CARD (โทนฟ้า ใช้กับเรื่องลา) โดยตั้งใจ — กันสับสนว่าการ์ดไหนเรื่องอะไร
// (ตามที่ owner ขอ) การ์ดขนาดเล็กกว่าการ์ดลา (ตัดรายละเอียดเหลือแค่ที่จำเป็น + padding แคบลง)
// เดิมโทนเหลืองอำพัน (amber) — owner ขอ 2026-08-06 ให้การ์ดสต็อกทั้งหมดเป็นเขียวละมุนเหมือนกันหมด (ไม่ใช่
// แค่การ์ดสั่งของ) รวมการ์ด "ของใกล้หมด/หมด" ด้วย — เปลี่ยนแค่ค่าสี ไม่เปลี่ยนชื่อ key (amber/amberDark)
// กันต้องไล่แก้ทุกจุดที่ใช้ STOCK_CARD.amber ทั่วไฟล์ ไม่กระทบ LINE_CARD (โทนฟ้า ใช้กับเรื่องลา คนละอ็อบเจกต์)
const STOCK_CARD = { base: '#EAF7EE', soft: '#F5FBF6', strong: '#CFEBD8', glass: '#FFFFFFCC', amber: '#3FA968', amberDark: '#1F6B3E', muted: '#7FA98D', line: '#CFEBD8' }
const stockFlexText = (text, options = {}) => ({ type: 'text', text: String(text ?? ''), color: STOCK_CARD.amberDark, size: 'xs', wrap: true, scaling: true, ...options })
const stockFactRow = (label, value) => ({
  type: 'box', layout: 'horizontal', spacing: 'sm',
  contents: [stockFlexText(label, { size: 'xxs', color: STOCK_CARD.muted, flex: 2 }), stockFlexText(value, { size: 'xs', weight: 'bold', color: STOCK_CARD.amberDark, align: 'end', flex: 3 })],
})
const stockCardHeader = (title, subtitle, icon) => ({
  type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', paddingAll: '10px', backgroundColor: STOCK_CARD.base, contents: [
    { type: 'box', layout: 'vertical', width: '30px', height: '30px', cornerRadius: '15px', backgroundColor: STOCK_CARD.strong, justifyContent: 'center', alignItems: 'center', contents: [stockFlexText(icon, { size: 'md', align: 'center' })] },
    { type: 'box', layout: 'vertical', flex: 1, contents: [
      stockFlexText(title, { color: STOCK_CARD.amberDark, size: 'sm', weight: 'bold' }),
      stockFlexText(subtitle, { color: STOCK_CARD.muted, size: 'xxs', margin: 'xs', wrap: true }),
    ] },
  ],
})
const stockCardButton = (action, primary = false) => ({ type: 'button', style: primary ? 'primary' : 'secondary', color: primary ? STOCK_CARD.amber : '#FDF3D8', height: 'sm', scaling: true, action })
// แถวรายการแบบมีปุ่ม ✓/✗ ต่อรายการ — ให้ boss ยืนยันทีละรายการ กันเคสของเข้าหลายรายการแต่ตรงไม่หมด
// (ต่างจาก stockFactRow ที่เป็นแค่ข้อความอย่างเดียว ไม่มีปุ่ม)
const stockInItemRow = (id, label, value) => ({
  type: 'box', layout: 'horizontal', spacing: 'xs', alignItems: 'center', margin: 'sm',
  contents: [
    { type: 'box', layout: 'vertical', flex: 5, contents: [stockFactRow(label, value)] },
    { type: 'button', style: 'primary', color: STOCK_CARD.amber, height: 'sm', flex: 2, gravity: 'center', action: { type: 'postback', label: '✓', data: `stockin-approve:${id}`, displayText: `Approve ${label}` } },
    { type: 'button', style: 'secondary', color: '#FDF3D8', height: 'sm', flex: 2, gravity: 'center', action: { type: 'postback', label: '✗', data: `stockin-reject:${id}`, displayText: `${label} ไม่ตรง` } },
  ],
})

// โทนเขียวละมุนแยกจาก STOCK_CARD (เหลืองอำพัน) — เฉพาะการ์ดที่เกี่ยวกับ "สั่งของ" โดยตรง (ยืนยันสั่งของ/
// เลือกลอต/รายการที่สั่งไว้) owner ขอ 2026-08-06 ว่าสีเดิมแสบตา การ์ดของเข้า/อนุมัติอื่นๆ ยังเป็นเหลืองเดิม
const ORDER_CARD = { base: '#EAF7EE', soft: '#F5FBF6', strong: '#CFEBD8', green: '#3FA968', greenDark: '#1F6B3E', muted: '#7FA98D' }
const orderFlexText = (text, options = {}) => ({ type: 'text', text: String(text ?? ''), color: ORDER_CARD.greenDark, size: 'xs', wrap: true, scaling: true, ...options })
const orderCardHeader = (title, subtitle, icon) => ({
  type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', paddingAll: '10px', backgroundColor: ORDER_CARD.base, contents: [
    { type: 'box', layout: 'vertical', width: '30px', height: '30px', cornerRadius: '15px', backgroundColor: ORDER_CARD.strong, justifyContent: 'center', alignItems: 'center', contents: [orderFlexText(icon, { size: 'md', align: 'center' })] },
    { type: 'box', layout: 'vertical', flex: 1, contents: [
      orderFlexText(title, { color: ORDER_CARD.greenDark, size: 'sm', weight: 'bold' }),
      orderFlexText(subtitle, { color: ORDER_CARD.muted, size: 'xxs', margin: 'xs', wrap: true }),
    ] },
  ],
})
const orderCardButton = (action, primary = false) => ({ type: 'button', style: primary ? 'primary' : 'secondary', color: primary ? ORDER_CARD.green : '#E3F5E8', height: 'sm', scaling: true, action })
const orderFactRow = (label, value) => ({
  type: 'box', layout: 'horizontal', spacing: 'sm',
  contents: [orderFlexText(label, { size: 'xxs', color: ORDER_CARD.muted, flex: 2 }), orderFlexText(value, { size: 'xs', weight: 'bold', color: ORDER_CARD.greenDark, align: 'end', flex: 3 })],
})

// การ์ด "ของใกล้หมด/หมด" ขอเป็นเหลืองเดิมต่อไปโดยเฉพาะ (owner ขอ 2026-08-06: "ดูน่ารำคาญดี เขาจะได้สั่งๆ")
// ตอนที่การ์ดสต็อกอื่นๆ เปลี่ยนเป็นเขียวหมดแล้ว — แยกพาเลตต์ของตัวเองแทนใช้ STOCK_CARD (เขียวไปแล้ว) กันปนกัน
const LOW_STOCK_CARD = { base: '#FFF8E3', soft: '#FFFCF3', amber: '#E0A324', muted: '#A6874A' }
const lowStockFlexText = (text, options = {}) => ({ type: 'text', text: String(text ?? ''), color: '#7A5B00', size: 'xs', wrap: true, scaling: true, ...options })
const lowStockCardHeader = (title, subtitle, icon) => ({
  type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', paddingAll: '10px', backgroundColor: LOW_STOCK_CARD.base, contents: [
    { type: 'box', layout: 'vertical', width: '30px', height: '30px', cornerRadius: '15px', backgroundColor: '#FBE9B8', justifyContent: 'center', alignItems: 'center', contents: [lowStockFlexText(icon, { size: 'md', align: 'center' })] },
    { type: 'box', layout: 'vertical', flex: 1, contents: [
      lowStockFlexText(title, { color: '#7A5B00', size: 'sm', weight: 'bold' }),
      lowStockFlexText(subtitle, { color: LOW_STOCK_CARD.muted, size: 'xxs', margin: 'xs', wrap: true }),
    ] },
  ],
})
const lowStockRow = (item) => ({
  type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', paddingAll: '8px', cornerRadius: '10px', backgroundColor: LOW_STOCK_CARD.base,
  contents: [
    lowStockFlexText(STOCK_STATUS_ICON[item.effectiveStatus] || '⚠️', { size: 'sm', flex: 0 }),
    lowStockFlexText(item.display_name, { size: 'xs', weight: 'bold', flex: 4, wrap: true }),
    lowStockFlexText(`${item.balance} ${item.unit || 'ชิ้น'}`, { size: 'xs', weight: 'bold', align: 'end', flex: 2, wrap: true }),
    { type: 'button', style: 'primary', color: LOW_STOCK_CARD.amber, height: 'sm', flex: 0, action: { type: 'postback', label: 'สั่ง', data: `stock-order:${item.sku}`, displayText: `สั่งของ ${item.display_name}` } },
  ],
})

// แจ้งเตือนรวมในใบเดียวแบบกว้าง: อ่านเป็นรายการต่อบรรทัดและกดสั่งได้จากบรรทัดนั้นเลย
function lowStockFlexMessage(items) {
  const visible = items.slice(0, 10)
  return {
    type: 'flex', altText: `แจ้งเตือนของใกล้หมด/หมด ${items.length} รายการ`,
    contents: {
      type: 'bubble', size: 'giga',
      header: lowStockCardHeader('ของใกล้หมด / หมด', `${items.length} รายการ · กด “สั่ง” ในบรรทัดที่ต้องการ`, '⚠️'),
      body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: LOW_STOCK_CARD.soft, contents: [
        ...visible.map(lowStockRow),
        ...(items.length > visible.length ? [lowStockFlexText(`+ อีก ${items.length - visible.length} รายการ`, { size: 'xs', color: LOW_STOCK_CARD.muted, align: 'center', margin: 'sm' })] : []),
      ] },
    },
  }
}

// คำสั่ง "เช็คของที่ต้องสั่ง" — ให้บอส/dev เรียกดูรายการของใกล้หมด/หมด ณ ตอนนี้ได้ทันทีทุกเมื่อ ไม่ต้องรอ
// การ์ดแจ้งเตือนรายวันจาก cron (opLowStockCron ด้านล่าง) ใช้ตัวกรอง/สูตรชุดเดียวกันเป๊ะ (computeLowStockList)
// รวมถึงกันไม่โชว์ของที่สั่งไปแล้วรอของเข้าอยู่ (loadOpenOrderSkus ใน _lib/inventory.js) ให้ตอบตรงกับสิ่งที่
// บอสถามจริงๆ ว่า "ตอนนี้อะไรที่ยังต้องสั่งอยู่บ้าง" ไม่ใช่แค่ของใกล้หมดทั้งหมดเฉยๆ
const STOCK_CHECK_COMMANDS = new Set(['เช็คของที่ต้องสั่ง', 'เช็คของ', 'เช็คสต็อก', 'ของที่ต้องสั่ง', 'เช็คของใกล้หมด'])
const isStockCheckCommand = (text) => STOCK_CHECK_COMMANDS.has(String(text || '').trim())

// พิมพ์คำพวกนี้ตอนติดอยู่กลาง flow สั่งของ/แจ้งของเข้า = เคลียร์ session ทันที (ดูจุดใช้งานใน opLineWebhook)
const CANCEL_STOCK_FLOW_COMMANDS = new Set(['ยกเลิก', 'หยุด', 'ออก', 'เลิก', 'cancel', 'ยกเลิกก่อน'])
const isCancelStockFlowCommand = (text) => CANCEL_STOCK_FLOW_COMMANDS.has(String(text || '').trim().toLowerCase())

async function handleStockCheckCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return false
  // findManagerLink เดิม (ผูกกับ checkbox "ของใกล้หมด" ในหน้า Settings) ผิดจุด — checkbox นั้นคุมว่าใคร
  // อยากรับ push แจ้งเตือนอัตโนมัติ ไม่ใช่คุมว่าใครมีสิทธิ์เรียกดูคำสั่งนี้เอง (เจอจริง 2026-08-11: lady role
  // boss ปิด "ของใกล้หมด" ไว้ กด "เช็คของ" จากเมนู "งานสต็อค" แล้วเงียบ/ตกไป fallback สินค้าค้นหาแทน) เปลี่ยน
  // มาเช็ค role ตรงๆ ผ่าน findStockApprover เหมือนคำสั่งสต็อกอื่นๆ ทั้งหมด (approve/สั่งของ/เมนูรวม)
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return false // ไม่ใช่บอส/dev — ปล่อยตกไป fallback เดิม
  const lowItems = await computeLowStockList()
  if (!lowItems.length) {
    await replyMessage(replyToken, [{ type: 'text', text: 'ตอนนี้ไม่มีของใกล้หมด/หมดที่ยังไม่ได้สั่งค่ะ 🎉' }])
  } else {
    await replyMessage(replyToken, [lowStockFlexMessage(lowItems)])
  }
  return true
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

    const targets = await getStockLineTargets()
    if (targets.length) await Promise.all(targets.map((t) => pushMessage(t.line_user_id, [lowStockFlexMessage(lowItems)])))
    await appendRows(STOCK_ALERT_RUNS_SHEET, [[today, new Date().toISOString(), lowItems.length]])
    return res.status(200).json({ success: true, item_count: lowItems.length, notified: targets.length })
  } catch (e) {
    console.error('opLowStockCron:', e.message)
    return res.status(500).json({ success: false, error: e.message })
  }
}

// ต้อง ensureSheet ก่อนอ่านเสมอ — จุดอ่านแรกสุดคือใน opLineWebhook ตอนเช็คว่ามี session ค้างอยู่ไหม
// (บรรทัด `const stockSession = ... getStockOrderSessions()`) ซึ่งเกิดก่อนจะมีใครเรียก
// upsertStockOrderSession สร้างชีตเลยสักครั้ง — ถ้าไม่ ensure ตรงนี้ด้วย พิมพ์ "สั่งของ" ครั้งแรกสุด
// (ตอนชีต stock_order_sessions ยังไม่เคยถูกสร้าง) จะอ่าน sheet ที่ไม่มีอยู่จริง Sheets API throw error
// ถูก catch เงียบๆ ใน per-event try/catch ของ webhook แล้วไม่ตอบอะไรกลับเลย (บั๊กจริงที่เจอ 2026-07-30)
async function getStockOrderSessions() {
  await ensureSheet(STOCK_ORDER_SESSION_SHEET, STOCK_ORDER_SESSION_HEADERS)
  return getSheet(STOCK_ORDER_SESSION_SHEET)
}
async function upsertStockOrderSession(lineUserId, patch) {
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

// session สำหรับ flow "แจ้งของเข้า" (ตะกร้าเหมือนสั่งของ แต่คนละชีต) — ensureSheet ก่อนอ่านเสมอ เหตุผลเดียวกับ
// getStockOrderSessions ด้านบน (กัน error เงียบตอนอ่านชีตที่ยังไม่เคยถูกสร้าง)
async function getStockInSessions() {
  await ensureSheet(STOCK_IN_SESSION_SHEET, STOCK_IN_SESSION_HEADERS)
  return getSheet(STOCK_IN_SESSION_SHEET)
}
async function upsertStockInSession(lineUserId, patch) {
  const current = await getStockInSessions()
  const existing = current.find((r) => r.line_user_id === lineUserId) || { line_user_id: lineUserId, step: '', sku: '', qty: '' }
  const next = { ...existing, ...patch, updated_at: new Date().toISOString() }
  const rows = current.filter((r) => r.line_user_id !== lineUserId).map((r) => STOCK_IN_SESSION_HEADERS.map((h) => r[h] ?? ''))
  rows.push(STOCK_IN_SESSION_HEADERS.map((h) => next[h] ?? ''))
  await overwriteSheet(STOCK_IN_SESSION_SHEET, STOCK_IN_SESSION_HEADERS, rows)
  return next
}
async function clearStockInSession(lineUserId) {
  await ensureSheet(STOCK_IN_SESSION_SHEET, STOCK_IN_SESSION_HEADERS)
  const current = await getStockInSessions()
  const rows = current.filter((r) => r.line_user_id !== lineUserId).map((r) => STOCK_IN_SESSION_HEADERS.map((h) => r[h] ?? ''))
  await overwriteSheet(STOCK_IN_SESSION_SHEET, STOCK_IN_SESSION_HEADERS, rows)
}

// ลงทะเบียน groupId อัตโนมัติ (ดู comment บน LINE_GROUP_LINK_SHEET) — เขียนเฉพาะตอน id เปลี่ยนจริง กันยิง
// เขียนชีตทุกข้อความในกลุ่ม (overwriteSheet ทั้งชีตทุกครั้งมีต้นทุน ไม่ควรทำถี่เกินจำเป็น)
async function registerLineGroup(groupId) {
  if (!groupId) return
  await ensureSheet(LINE_GROUP_LINK_SHEET, LINE_GROUP_LINK_HEADERS)
  const rows = await getSheet(LINE_GROUP_LINK_SHEET)
  if (rows.some((r) => r.group_id === groupId)) return
  await overwriteSheet(LINE_GROUP_LINK_SHEET, LINE_GROUP_LINK_HEADERS, [[groupId, new Date().toISOString()]])
}
async function getGroupTarget() {
  await ensureSheet(LINE_GROUP_LINK_SHEET, LINE_GROUP_LINK_HEADERS)
  const rows = await getSheet(LINE_GROUP_LINK_SHEET)
  return rows[0]?.group_id || null
}

// เฉพาะบอส/dev ที่เปิดรับแจ้งเตือนหมวด "ของใกล้หมด" ไว้ (notify_stock) เท่านั้นสั่งของผ่านไลน์ได้ —
// ผูก 2 อย่างเข้าด้วยกันตามที่ owner ขอ (ปิด checkbox = ปิดทั้งรับการ์ดแจ้งเตือนและสั่งของผ่านแชท)
// เทียบ line_user_id -> hr_line_links (username ธรรมดา ไม่ใช่ mp: ของพนักงาน) -> users.role
async function findManagerLink(lineUserId) {
  const links = await getSheet('hr_line_links')
  const link = links.find((l) => l.line_user_id === lineUserId && !String(l.username || '').startsWith('mp:'))
  if (!link || String(link.notify_stock) === '0') return null
  const user = (await getSheet('users')).find((u) => u.username === link.username)
  if (!user || !canManageOperations(user.role)) return null
  return { username: link.username, name: user.display_name || link.username, role: user.role }
}

// แจ้งของเข้าเปิดให้ "ใครก็ได้ที่ล็อกอินได้" เหมือนปุ่มบนเว็บ (addStockInRequest ไม่มี role gate) — ต่างจาก
// findManagerLink (สั่งของ ต้องบอส/dev + เปิด notify_stock เท่านั้น) เช็คทั้งฝั่งพนักงาน (mp: ผ่าน findStaffLink
// ตัวเดียวกับ flow ลา) และฝั่งบอส/dev (username ธรรมดา แต่ไม่บังคับ notify_stock/role เหมือน findManagerLink)
async function resolveArrivalReporter(lineUserId) {
  const staff = await findStaffLink(lineUserId)
  if (staff) return { name: staff.name }
  const links = await getSheet('hr_line_links')
  const link = links.find((l) => l.line_user_id === lineUserId && !String(l.username || '').startsWith('mp:'))
  if (!link) return null
  const user = (await getSheet('users')).find((u) => u.username === link.username)
  if (!user) return null
  return { name: user.display_name || link.username }
}

// สั่งของผ่านไลน์ได้เฉพาะสินค้าขายจริง — วัสดุแพ็คเกจจิ้ง/กล่อง/พัสดุ (category=packaging หรือ SKU ขึ้นต้น
// PKG-/BOXMJ-/BOXP-) ไม่ให้ค้นเจอหรือเลือกได้เลยตั้งแต่ต้น (createOrderRequest ก็ block ซ้ำอยู่แล้วฝั่ง backend
// แต่กันไว้ตั้งแต่การค้นหาให้บอสไม่เห็นตัวเลือกที่สั่งไม่ได้ตั้งแต่แรก)
async function loadOrderableItems() {
  const { items } = await loadItemsWithBalance({ includeHidden: false })
  return items.filter((it) => !isPackagingItem(it))
}

// ตะกร้าสั่งของ — เพิ่มได้หลายรายการก่อนค่อยเลือกวันที่แล้วจบทีเดียว (เพิ่มทีละตัวผ่านค้นหา/เลือกจาก quick reply
// หรือวางข้อความ "ชื่อ = จำนวน" หลายบรรทัดทีเดียวก็ได้ ผสมกันได้ในตะกร้าเดียวกัน) — เก็บใน session.items_json
// เพิ่มรายการแล้วถามต่อทุกครั้งว่าจะสั่งเพิ่มไหม หรือกด "เสร็จแล้ว" เพื่อไปเลือกวันที่ (เดิมพอเลือก/พิมพ์ได้ 1
// รายการก็จบเลย ไม่มีทางสั่งได้มากกว่า 1 SKU ต่อครั้ง — owner แจ้งว่านี่คือปัญหาหลัก จึงรื้อ flow ใหม่ทั้งหมด)
async function addToCartAndAskMore(replyToken, lineUserId, newItems, prefixText = '') {
  const session = (await getStockOrderSessions()).find((s) => s.line_user_id === lineUserId)
  let cart = []
  try { cart = JSON.parse(session?.items_json || '[]') } catch { cart = [] }
  cart = [...cart, ...newItems]
  await upsertStockOrderSession(lineUserId, { step: 'await_item', items_json: JSON.stringify(cart), sku: '', pending_json: '' })
  const summary = cart.map((it) => `• ${it.display_name} × ${it.qty > 0 ? `${it.qty} ${it.unit}` : 'ไม่ระบุจำนวน'}`).join('\n')
  const text = `${prefixText ? prefixText + '\n\n' : ''}ตะกร้าตอนนี้ (${cart.length} รายการ):\n${summary}\n\nจะสั่งเพิ่มไหม? พิมพ์ชื่อสินค้าหรือ SKU ต่อไปได้เลย หรือกด "เสร็จแล้ว" เพื่อเลือกวันที่`
  await replyMessage(replyToken, [{
    type: 'text', text,
    quickReply: { items: [{ type: 'action', action: { type: 'postback', label: '✅ เสร็จแล้ว สั่งของ', data: 'stock-cart-done', displayText: 'เสร็จแล้ว สั่งของ' } }] },
  }])
}

// พิมพ์คำเหล่านี้แทนตัวเลขได้ตอนถูกถามจำนวน — เผื่อของเก่าก่อนเริ่มใช้ระบบที่ไม่มีบันทึกจำนวนไว้ ยังลงเป็น
// "สั่งแล้ว" ได้ (qty เก็บเป็น 0 = ไม่ระบุจำนวน เหมือนฝั่งเว็บ — ดู createOrderRequest ที่ยอมรับ qty ว่าง/0)
const SKIP_QTY_TEXTS = new Set(['-', 'ไม่ทราบ', 'ไม่รู้', 'ไม่ระบุ', 'ข้าม', 'unknown', 'skip'])
const isSkipQtyText = (text) => SKIP_QTY_TEXTS.has(String(text || '').trim().toLowerCase())

// ถามจำนวนของ 1 รายการที่เพิ่งค้นหา/เลือกได้ — พอตอบจำนวนแล้วเข้าตะกร้า (addToCartAndAskMore) ไม่จบทันที
// ต่างจาก approve/reject วันลาที่กดปุ่มจบในทีเดียว ใช้ร่วมกันทั้งกดปุ่มจากการ์ดแจ้งเตือน (handleStockOrderPostback)
// และเลือกจากผลค้นหา (handleStockPickPostback)
async function askOrderQty(replyToken, lineUserId, item) {
  await upsertStockOrderSession(lineUserId, { step: 'await_item_qty', sku: item.sku, qty: '' })
  await replyMessage(replyToken, [{ type: 'text', text: `สั่ง "${item.display_name}" กี่${item.unit || 'ชิ้น'}คะ? พิมพ์ตัวเลขได้เลย หรือพิมพ์ "ไม่ทราบ" ถ้ายังไม่รู้จำนวน (เช่น ของเก่าก่อนเริ่มใช้ระบบ)\nคงเหลือตอนนี้ ${item.balance} ${item.unit || 'ชิ้น'}` }])
}

async function handleStockOrderPostback(event, sku) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const manager = lineUserId ? await findManagerLink(lineUserId) : null
  if (!manager) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }])

  const items = await loadOrderableItems()
  const item = items.find((it) => String(it.sku).toUpperCase() === String(sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ' }])
  await upsertStockOrderSession(lineUserId, { items_json: '', pending_json: '' }) // เริ่มตะกร้าใหม่ทุกครั้งที่กดจากการ์ด
  await askOrderQty(replyToken, lineUserId, item)
}

// รับคำสั่ง "สั่งของ" (และชื่อสินค้าที่พิมพ์ต่อท้ายได้) เพื่อเริ่มสั่งสินค้า
// (ไม่ต้องรอการ์ดแจ้งเตือน) — สั่งของที่ยังปกติ (ไม่ใกล้หมด) ได้ด้วย ต่างจากปุ่มบนการ์ด
// ที่จำกัดแค่ของใกล้หมด/หมดเท่านั้น เริ่ม session ถามชื่อ/SKU ก่อน แล้วค่อยถามจำนวนต่อ (handleStockOrderSearchReply)
function stockOrderCommandQuery(text) {
  const match = String(text || '').trim().match(/^สั่งของ\s*(.*)$/)
  return match ? match[1].trim() : null
}

async function handleStockOrderSearchStart(event, initialQuery = '') {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return false
  const manager = lineUserId ? await findManagerLink(lineUserId) : null
  if (!manager) return false // ไม่ใช่บอส/dev — ปล่อยให้ตกไป fallback เดิม (echo userId) ไม่ตอบอะไรพิเศษ
  await upsertStockOrderSession(lineUserId, { step: 'await_item', sku: '', qty: '', items_json: '', pending_json: '' }) // เริ่มตะกร้าใหม่เสมอ
  if (initialQuery) {
    await handleStockOrderSearchReply(event, initialQuery)
    return true
  }
  await replyMessage(replyToken, [{ type: 'text', text: 'จะสั่งอะไรคะ? พิมพ์ชื่อสินค้าหรือ SKU ได้เลย (สั่งได้หลายรายการต่อเนื่องกัน ระบบจะถามทีละรายการให้เอง)' }])
  return true
}

// คำเดียวยาวๆ (>=4 ตัวอักษร) ที่ไม่เจอ substring ตรงๆ ให้ลองแบบ "subsequence" แทน (ตัวอักษรของ query ต้องเจอ
// ในชื่อสินค้าตามลำดับเดิม แต่มีคำอื่นแทรกกลางได้) — ภาษาไทยไม่มีเว้นวรรคระหว่างคำ พิมพ์ติดกันเช่น "ถุงเท้าส้น"
// จะไม่ใช่ substring ตรงตัวของ "ถุงเท้าเจลส้น" (มีคำว่า "เจล" คั่นอยู่) แต่เป็น subsequence ได้ — จำกัดความยาวขั้นต่ำ
// ไว้ที่ 4 ตัวอักษรกันจับคู่มั่ว (คำสั้นๆ ตัวอักษรไทยซ้ำกันบ่อย โอกาส false positive สูง)
function tokenMatches(haystack, token) {
  if (haystack.includes(token)) return true
  if (token.length < 4) return false
  let cursor = 0
  for (const ch of token) {
    const found = haystack.indexOf(ch, cursor)
    if (found === -1) return false
    cursor = found + 1
  }
  return true
}

// ค้นด้วย "ทุกคำต้องเจอ" (AND ต่อคำ ไม่สนลำดับ) แทน substring ทั้งวลีตรงๆ — พิมพ์ "sky 35-36" ต้องเจอ
// "รองเท้าเพื่อสุขภาพ Sky(ฟ้าอ่อน) 35-36" ได้ทั้งที่คำไม่ติดกัน (เจอบั๊กจริงจาก owner: ข้อความยาวที่ตัดบรรทัด
// เอง เช่น "ถุงเท้าส้น\nซิลิโคนโป้ง\nผ้ายืด" กลายเป็น query ก้อนเดียวมี \n ติดมาด้วย ไม่ตรงกับชื่อสินค้าจริงเป๊ะๆ
// เลยไม่เจอเลย) — normalize \n เป็นช่องว่างก่อนตัดคำด้วย เผื่อเคสนี้
function searchItemsByQuery(query, items) {
  const tokens = String(query || '').replace(/[\r\n]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  return items.filter((it) => {
    const haystack = `${it.display_name} ${it.sku}`.toLowerCase()
    return tokens.every((t) => tokenMatches(haystack, t))
  })
}

// ตัดจำนวนออกจากท้ายบรรทัด รองรับ 2 แบบ: "ชื่อ = จำนวน" (คั่นด้วย =) หรือ "ชื่อ จำนวน" (เลขล้วนท้ายบรรทัด
// ไม่ต้องสลับภาษาพิมพ์ =) เช่น "sky 35-36 10" — คืน queryRaw/qtyText แยกกัน (qtyText เป็น null ถ้าไม่มีจำนวนระบุ
// มาด้วยเลย แปลว่าเป็นแค่ชื่อสินค้าเฉยๆ ต้องถามจำนวนทีหลัง)
function splitQueryAndQty(line) {
  const eqIdx = line.lastIndexOf('=')
  if (eqIdx !== -1) return { queryRaw: line.slice(0, eqIdx).trim(), qtyText: line.slice(eqIdx + 1).trim() }
  const tokens = line.split(/\s+/)
  const last = tokens[tokens.length - 1]
  if (tokens.length > 1 && /^[\d,]+(\.\d+)?$/.test(last)) {
    return { queryRaw: tokens.slice(0, -1).join(' '), qtyText: last }
  }
  return { queryRaw: line, qtyText: null }
}

// ไซส์ล้วนๆ ไม่มีชื่อสินค้าด้วย (เช่นพิมพ์ต่อจากบรรทัดที่ระบุชื่อสินค้าไปแล้ว วางแค่ไซส์+จำนวนบรรทัดถัดๆไป)
const SIZE_ONLY_RE = /^(xxxl|xxl|xl|xs|s|m|l)$/i

// ตัดไซส์ท้ายคำค้นออก เอาไว้จำเป็น "ชื่อสินค้าฐาน" ให้บรรทัดถัดไปที่พิมพ์แค่ไซส์เฉยๆ สืบทอดชื่อสินค้าต่อได้
function stripTrailingSize(queryRaw) {
  const tokens = queryRaw.trim().split(/\s+/)
  if (tokens.length > 1 && SIZE_ONLY_RE.test(tokens[tokens.length - 1])) return tokens.slice(0, -1).join(' ')
  return queryRaw.trim()
}

// เจอไซส์แบบขอบคำจริง (word boundary) ไม่ใช่ substring ธรรมดา — กัน "l" ไปแมตช์มั่วกับ "XL" (ตัว l ที่อยู่ใน
// "xl" ไม่ใช่ตัวเดียวกับไซส์ L) จำเป็นเพราะ tokenMatches ทั่วไปเป็น substring เฉยๆ ใช้กับไซส์ตรงๆ ไม่ได้
function matchesSizeWord(haystack, sizeToken) {
  return new RegExp(`(^|[^a-z0-9])${sizeToken.toLowerCase()}([^a-z0-9]|$)`, 'i').test(haystack)
}

// พิมพ์หลายรายการทีเดียว บรรทัดละ 1 รายการ ระบุจำนวนได้ทั้ง "ชื่อ/SKU = จำนวน" หรือ "ชื่อ/SKU จำนวน" เช่น
//   sky 35-36 = 10
//   37-38 20
// หรือไม่ระบุจำนวนเลยก็ได้ (แค่ชื่อสินค้าเฉยๆ บรรทัดละตัว) — เดี๋ยวถามจำนวนทีหลังทีละตัว (ดู pending ด้านล่าง)
// บรรทัดที่เป็นแค่ "ไซส์ จำนวน" เฉยๆ (เช่น "L 1000" ต่อจาก "ถุงเท้าฝ่า M 500") จะสืบชื่อสินค้าจากบรรทัดล่าสุดที่
// ระบุชื่อเต็มไว้ (lastBaseQuery) มาแทน — พิมพ์ไซส์ต่างๆ ต่อกันได้โดยไม่ต้องพิมพ์ชื่อสินค้าซ้ำทุกบรรทัด
// เจอ SKU ตรงตัวก่อนเสมอ (ไม่ทับซ้อน) ไม่งั้นค้นด้วย searchItemsByQuery — เจอ 0 หรือมากกว่า 1 ตัวถือเป็น
// error ของบรรทัดนั้น (ไม่เดา กันสั่งผิดตัว)
function parseOrderBatchLines(text, items) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const resolved = [] // มีจำนวนแล้ว พร้อมเข้าตะกร้าเลย
  const pending = [] // รู้ตัวสินค้าแล้วแต่ยังไม่รู้จำนวน ต้องถามทีหลัง
  const errors = []
  let lastBaseQuery = ''
  for (const line of lines) {
    const { queryRaw, qtyText } = splitQueryAndQty(line)
    if (!queryRaw) { errors.push(`บรรทัด "${line}" ไม่มีชื่อสินค้า`); continue }
    const isSizeOnly = SIZE_ONLY_RE.test(queryRaw.trim())
    const effectiveQuery = isSizeOnly && lastBaseQuery ? `${lastBaseQuery} ${queryRaw.trim()}` : queryRaw
    const query = effectiveQuery.toLowerCase()
    let match = items.find((it) => String(it.sku).toLowerCase() === query)
    if (!match) {
      // ไซส์ล้วนสืบทอดชื่อสินค้า: ค้นชื่อฐานแบบ fuzzy ก่อน แล้วกรองไซส์ด้วย word-boundary แยกต่างหาก
      // (ไม่ใช้ searchItemsByQuery ตรงๆ เพราะ token ไซส์สั้นๆ อย่าง "l" จะ substring-match "XL" ผิดตัว)
      const matches = isSizeOnly && lastBaseQuery
        ? searchItemsByQuery(lastBaseQuery, items).filter((it) => matchesSizeWord(`${it.display_name} ${it.sku}`, queryRaw.trim()))
        : searchItemsByQuery(effectiveQuery, items)
      if (matches.length === 1) match = matches[0]
      else if (!matches.length) { errors.push(`ไม่พบสินค้า "${effectiveQuery}"`); continue }
      else { errors.push(`"${effectiveQuery}" ตรงกับหลายรายการ สินค้าไหนคะ?\n${matches.slice(0, 5).map((m) => `- ${m.display_name} (${m.sku})`).join('\n')}${matches.length > 5 ? '\n...' : ''}`); continue }
    }
    if (!isSizeOnly) lastBaseQuery = stripTrailingSize(queryRaw)
    const base = { sku: match.sku, display_name: match.display_name, unit: match.unit || 'ชิ้น' }
    if (qtyText === null) { pending.push(base); continue }
    if (isSkipQtyText(qtyText)) { resolved.push({ ...base, qty: 0 }); continue }
    const qty = Number(qtyText.replace(/,/g, ''))
    if (!Number.isFinite(qty) || qty <= 0) { errors.push(`บรรทัด "${line}" จำนวนไม่ถูกต้อง`); continue }
    resolved.push({ ...base, qty })
  }
  return { resolved, pending, errors }
}

// เพิ่มรายการที่มีจำนวนแล้วเข้าตะกร้าเงียบๆ (ไม่ตอบกลับ) — ใช้ต่อกับ askPendingQueue/addToCartAndAskMore
// เพื่อไม่ให้ตอบซ้ำหลายข้อความในทัวน์เดียว (LINE reply token ใช้ได้ครั้งเดียว)
async function mergeIntoCart(lineUserId, newItems) {
  if (!newItems.length) return
  const session = (await getStockOrderSessions()).find((s) => s.line_user_id === lineUserId)
  let cart = []
  try { cart = JSON.parse(session?.items_json || '[]') } catch { cart = [] }
  cart = [...cart, ...newItems]
  await upsertStockOrderSession(lineUserId, { items_json: JSON.stringify(cart) })
}

// ถามจำนวนของรายการถัดไปในคิว (สินค้าที่รู้ตัวแล้วแต่ยังไม่รู้จำนวน) — เก็บคิวที่เหลือไว้ใน pending_json
// พอตอบจำนวนของตัวแรกแล้ว handleStockOrderQtyReply จะ pop มาถามตัวถัดไปเองจนกว่าคิวจะหมด
async function askPendingQueue(replyToken, lineUserId, pendingList, prefixText = '') {
  await upsertStockOrderSession(lineUserId, { step: 'await_item_qty', sku: pendingList[0].sku, pending_json: JSON.stringify(pendingList) })
  const more = pendingList.length > 1 ? `\n(ถามทีละตัว เหลืออีก ${pendingList.length - 1} รายการที่ยังไม่ระบุจำนวน)` : ''
  const text = `${prefixText ? prefixText + '\n\n' : ''}สั่ง "${pendingList[0].display_name}" กี่${pendingList[0].unit}คะ? พิมพ์ตัวเลขได้เลย หรือพิมพ์ "ไม่ทราบ" ถ้ายังไม่รู้จำนวน${more}`
  await replyMessage(replyToken, [{ type: 'text', text }])
}

// พิมพ์ชื่อ/SKU ค้นหา (ขั้นตอนต่อจาก handleStockOrderSearchStart หรือพิมพ์ใหม่ตอนเลือกจากรายการเดิมไม่เจอ) —
// หลายบรรทัด หรือมีจำนวนระบุมาด้วย (= หรือเลขท้ายบรรทัด) ใช้โหมดหลายรายการ (parseOrderBatchLines) ส่วน
// บรรทัดเดียวไม่มีจำนวนยังใช้โหมดค้นหาแบบเดิม (เจอตัวเดียวถามจำนวนเลย เจอหลายตัวโชว์ quick reply ให้เลือก)
async function handleStockOrderSearchReply(event, queryOverride = '') {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const rawText = String(queryOverride || event.message?.text || '')
  const query = rawText.trim().toLowerCase()
  if (!query) return replyMessage(replyToken, [{ type: 'text', text: 'พิมพ์ชื่อสินค้าหรือ SKU ได้เลยค่ะ (สั่งหลายรายการทีเดียวก็ได้ บรรทัดละ 1 รายการ เช่น sky 35-36 = 10 หรือ 37-38 20)' }])

  // พิมพ์ชื่อกลุ่มตรงเป๊ะ (ตั้งไว้ที่ order_group ในหน้า Inventory เช่น "รองเท้าเพื่อสุขภาพ") = สั่งทั้งกลุ่ม
  // ทีเดียว ไม่ระบุจำนวนต่อ SKU (นับจริงตอนแจ้งของเข้า/Match) — ตัดหน้าก่อนไปเข้า flow ค้นหาสินค้าทีละตัว
  // ปกติ เพราะไม่ต้องถามจำนวนเลย จบในข้อความเดียว ต่างจากสั่งรายตัวที่ต้องถามทีละรายการ
  if (!rawText.includes('\n')) {
    const groups = await loadOrderGroups()
    const groupMatch = groups.find((g) => g.group.toLowerCase() === query)
    if (groupMatch) {
      const manager = await findManagerLink(lineUserId)
      if (!manager) { await clearStockOrderSession(lineUserId); return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }]) }
      const orderDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
      await clearStockOrderSession(lineUserId)
      try {
        await createOrderRequestForGroup({ group: groupMatch.group, order_date: orderDate, note: 'สั่งจาก LINE (ทั้งกลุ่ม)' }, manager.name, manager.role)
        const list = groupMatch.items.map((it) => `• ${it.display_name}`).join('\n')
        return replyMessage(replyToken, [{ type: 'text', text: `สั่ง "${groupMatch.group}" ทั้งกลุ่มเรียบร้อยค่ะ (${groupMatch.items.length} รายการ ไม่ระบุจำนวน นับจริงตอนของเข้า):\n${list}` }])
      } catch (e) {
        return replyMessage(replyToken, [{ type: 'text', text: `สั่งไม่สำเร็จ: ${e.message}` }])
      }
    }
  }

  const items = await loadOrderableItems()
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const singleLineHasQty = lines.length === 1 && splitQueryAndQty(lines[0]).qtyText !== null
  if (lines.length > 1 || singleLineHasQty) {
    const { resolved, pending, errors } = parseOrderBatchLines(rawText, items)
    if (!resolved.length && !pending.length) {
      const text = errors.length ? errors.join('\n') + '\n\nลองพิมพ์ใหม่ได้เลยค่ะ' : 'ไม่พบรายการที่จะสั่งเลยค่ะ ลองพิมพ์ใหม่'
      return replyMessage(replyToken, [{ type: 'text', text }])
    }
    await mergeIntoCart(lineUserId, resolved)
    const prefixText = errors.length ? `⚠️ บางบรรทัดมีปัญหา:\n${errors.join('\n')}` : ''
    if (pending.length) return askPendingQueue(replyToken, lineUserId, pending, prefixText)
    return addToCartAndAskMore(replyToken, lineUserId, [], prefixText)
  }

  const matches = searchItemsByQuery(rawText, items).slice(0, 10)
  if (!matches.length) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ค่ะ ลองพิมพ์สั้นลง หรือใช้ชื่อ/SKU ที่ตรงกับหน้าเว็บมากขึ้น\nหากต้องการเริ่มใหม่ พิมพ์ “สั่งของ” ได้เลยค่ะ' }])
  if (matches.length === 1) return askOrderQty(replyToken, lineUserId, matches[0])

  await upsertStockOrderSession(lineUserId, { step: 'await_item_pick', sku: '', qty: '' })
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
  const items = await loadOrderableItems()
  const item = items.find((it) => String(it.sku).toUpperCase() === String(sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ' }])
  await askOrderQty(replyToken, lineUserId, item)
}

// บันทึกคำสั่งซื้อทั้งตะกร้า (1 รายการขึ้นไป) — สร้างทีละแถวด้วย createOrderRequest ตัวเดียวกับปุ่มบนหน้า
// Stock Movement (ไม่แยก "สั่งทีละตัว" กับ "สั่งหลายตัว" อีกต่อไป — ตะกร้า 1 รายการก็ผ่าน path เดียวกันนี้)
async function completeStockOrderBatch(replyToken, lineUserId, session, orderDate) {
  let items = []
  try { items = JSON.parse(session.items_json || '[]') } catch { items = [] }
  if (!Array.isArray(items) || !items.length) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบรายการสั่งของค่ะ กรุณาเริ่มใหม่ด้วย “สั่งของ”' }])
  const manager = await findManagerLink(lineUserId)
  if (!manager) { await clearStockOrderSession(lineUserId); return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }]) }

  const done = []
  const failed = []
  for (const it of items) {
    try {
      await createOrderRequest({ sku: it.sku, qty: it.qty, order_date: orderDate, note: 'สั่งจาก LINE' }, manager.name, manager.role)
      done.push(it)
    } catch (e) { failed.push(`${it.display_name}: ${e.message}`) }
  }
  await clearStockOrderSession(lineUserId)

  const facts = done.map((it) => orderFactRow(it.display_name, it.qty > 0 ? `× ${it.qty} ${it.unit}` : 'ไม่ระบุจำนวน'))
  const footerButtons = APP_BASE_URL ? [orderCardButton({ type: 'uri', label: 'เปิดเว็บ', uri: stockWebUrl() }, true)] : []
  await replyMessage(replyToken, [{
    type: 'flex', altText: `สั่งของ ${done.length} รายการ เรียบร้อย`,
    contents: {
      type: 'bubble', size: 'giga',
      header: orderCardHeader('สั่งของเรียบร้อย', `${done.length} รายการ · ${orderDate}`, '✅'),
      body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: ORDER_CARD.soft, contents: [
        { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px', cornerRadius: '10px', backgroundColor: ORDER_CARD.base, contents: facts.length ? facts : [orderFlexText('ไม่มีรายการสำเร็จ', {})] },
        ...(failed.length ? [orderFlexText(`ล้มเหลว: ${failed.join('; ')}`, { color: '#C0392B', size: 'xxs', margin: 'sm', wrap: true })] : []),
      ] },
      ...(footerButtons.length ? { footer: { type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px', backgroundColor: ORDER_CARD.base, contents: footerButtons } } : {}),
    },
  }])
}

// พิมพ์จำนวนกลับมาในแชท (ของรายการที่เพิ่งค้นหา/เลือกไว้) — เข้าตะกร้าแล้วถามว่าจะสั่งเพิ่มไหม
// (addToCartAndAskMore) ไม่ใช่ไปขั้นตอนวันที่ทันที ต้องกด "เสร็จแล้ว" ก่อนถึงจะไปเลือกวันที่
async function handleStockOrderQtyReply(event, session) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const rawText = String(event.message?.text || '').trim()
  const skip = isSkipQtyText(rawText)
  const qty = skip ? 0 : Number(rawText.replace(/,/g, ''))
  if (!skip && (!Number.isFinite(qty) || qty <= 0)) return replyMessage(replyToken, [{ type: 'text', text: 'กรุณาพิมพ์เป็นตัวเลขค่ะ เช่น 100 หรือพิมพ์ "ไม่ทราบ" ถ้ายังไม่รู้จำนวน' }])

  const manager = await findManagerLink(lineUserId)
  if (!manager) { await clearStockOrderSession(lineUserId); return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะบอส/dev สั่งของผ่านไลน์ได้ค่ะ' }]) }

  // ถ้ากำลังไล่ถามจำนวนทีละตัวจากคิว pending (พิมพ์หลายชื่อสินค้ามาแบบไม่ระบุจำนวน) — ตอบจำนวนตัวแรกในคิว
  // เข้าตะกร้าแล้ว pop ไปถามตัวถัดไป จนกว่าคิวจะหมดค่อยโชว์สรุปตะกร้า+ถามว่าจะสั่งเพิ่มไหม
  let pending = []
  try { pending = JSON.parse(session.pending_json || '[]') } catch { pending = [] }
  if (pending.length) {
    const done = { ...pending[0], qty }
    const remaining = pending.slice(1)
    await mergeIntoCart(lineUserId, [done])
    if (remaining.length) return askPendingQueue(replyToken, lineUserId, remaining)
    return addToCartAndAskMore(replyToken, lineUserId, [])
  }

  const items = await loadOrderableItems()
  const item = items.find((it) => String(it.sku).toUpperCase() === String(session.sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ กรุณาเริ่มใหม่ด้วย “สั่งของ”' }])
  await addToCartAndAskMore(replyToken, lineUserId, [{ sku: item.sku, display_name: item.display_name, unit: item.unit || 'ชิ้น', qty }])
}

// กด "เสร็จแล้ว สั่งของ" — ปิดรับรายการเพิ่ม ไปถามวันที่ (ครั้งเดียวสำหรับทั้งตะกร้า ไม่ใช่ต่อรายการ)
async function handleStockCartDonePostback(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken || !lineUserId) return
  const session = (await getStockOrderSessions()).find((s) => s.line_user_id === lineUserId)
  let cart = []
  try { cart = JSON.parse(session?.items_json || '[]') } catch { cart = [] }
  if (!cart.length) return replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่มีรายการในตะกร้าเลยค่ะ พิมพ์ชื่อสินค้าหรือ SKU ที่จะสั่งได้เลย' }])
  await upsertStockOrderSession(lineUserId, { step: 'await_batch_date' })
  await replyMessage(replyToken, [{
    type: 'text', text: 'วันที่สั่งของวันไหนคะ?',
    quickReply: { items: [
      { type: 'action', action: { type: 'postback', label: 'วันนี้', data: 'stock-order-date:today', displayText: 'วันนี้' } },
      { type: 'action', action: { type: 'datetimepicker', label: 'เลือกวันที่', data: 'stock-order-date:pick', mode: 'date', initial: todayBKK() } },
    ] },
  }])
}

async function handleStockOrderDatePostback(event, choice) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken || !lineUserId) return
  const session = (await getStockOrderSessions()).find((s) => s.line_user_id === lineUserId)
  if (session?.step !== 'await_batch_date') return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบรายการสั่งของที่รอเลือกวันที่ค่ะ กรุณาเริ่มใหม่ด้วย “สั่งของ”' }])
  const orderDate = choice === 'today' ? todayBKK() : String(event.postback?.params?.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return replyMessage(replyToken, [{ type: 'text', text: 'กรุณาเลือกวันที่จากปฏิทินอีกครั้งค่ะ' }])
  await completeStockOrderBatch(replyToken, lineUserId, session, orderDate)
}

// ── "แจ้งของเข้า" ผ่านไลน์ — มิเรอร์ flow "สั่งของ" ด้านบนแทบทุกจุด (ตะกร้า/ค้นหา/ถามจำนวน/เลือกวันที่)
// ใช้ parser ตัวเดียวกัน (searchItemsByQuery/parseOrderBatchLines ฯลฯ) ต่างกันแค่: session คนละชีต
// (stock_in_sessions), เข้าถึงได้ทุกคนที่ผูกไลน์ไว้แล้ว (resolveArrivalReporter ไม่บังคับบอส/dev เหมือน
// findManagerLink), และปลายทางเรียก addStockInRequest แทน createOrderRequest (ไม่ผ่านการอนุมัติ แค่สร้างแถว
// pending รอบอส Match จากหน้าเว็บ — เหมือนปุ่ม "แจ้งของเข้า" บนเว็บทุกประการ)
async function mergeIntoStockInCart(lineUserId, newItems) {
  if (!newItems.length) return
  const session = (await getStockInSessions()).find((s) => s.line_user_id === lineUserId)
  let cart = []
  try { cart = JSON.parse(session?.items_json || '[]') } catch { cart = [] }
  cart = [...cart, ...newItems]
  await upsertStockInSession(lineUserId, { items_json: JSON.stringify(cart) })
}

async function addToStockInCartAndAskMore(replyToken, lineUserId, newItems, prefixText = '') {
  const session = (await getStockInSessions()).find((s) => s.line_user_id === lineUserId)
  let cart = []
  try { cart = JSON.parse(session?.items_json || '[]') } catch { cart = [] }
  cart = [...cart, ...newItems]
  await upsertStockInSession(lineUserId, { step: 'await_item', items_json: JSON.stringify(cart), sku: '', pending_json: '' })
  const summary = cart.map((it) => `• ${it.display_name} × ${it.qty} ${it.unit}`).join('\n')
  const text = `${prefixText ? prefixText + '\n\n' : ''}ตะกร้าตอนนี้ (${cart.length} รายการ):\n${summary}\n\nแจ้งเพิ่มไหม? พิมพ์ชื่อสินค้าหรือ SKU ต่อไปได้เลย หรือกด "เสร็จแล้ว" เพื่อเลือกวันที่ของเข้า`
  await replyMessage(replyToken, [{
    type: 'text', text,
    quickReply: { items: [{ type: 'action', action: { type: 'postback', label: '✅ เสร็จแล้ว แจ้งของเข้า', data: 'stockin-cart-done', displayText: 'เสร็จแล้ว แจ้งของเข้า' } }] },
  }])
}

async function askStockInQty(replyToken, lineUserId, item) {
  await upsertStockInSession(lineUserId, { step: 'await_item_qty', sku: item.sku, qty: '' })
  await replyMessage(replyToken, [{ type: 'text', text: `"${item.display_name}" เข้ากี่${item.unit || 'ชิ้น'}คะ? พิมพ์ตัวเลขได้เลย\nคงเหลือตอนนี้ ${item.balance} ${item.unit || 'ชิ้น'}` }])
}

async function askStockInPendingQueue(replyToken, lineUserId, pendingList, prefixText = '') {
  await upsertStockInSession(lineUserId, { step: 'await_item_qty', sku: pendingList[0].sku, pending_json: JSON.stringify(pendingList) })
  const more = pendingList.length > 1 ? `\n(ถามทีละตัว เหลืออีก ${pendingList.length - 1} รายการที่ยังไม่ระบุจำนวน)` : ''
  const text = `${prefixText ? prefixText + '\n\n' : ''}"${pendingList[0].display_name}" เข้ากี่${pendingList[0].unit}คะ? พิมพ์ตัวเลขได้เลย${more}`
  await replyMessage(replyToken, [{ type: 'text', text }])
}

// รับคำสั่ง "แจ้งของเข้า" (พิมพ์ชื่อสินค้าต่อท้ายได้เลย) — เริ่ม session ตะกร้าใหม่เสมอ
function stockInCommandQuery(text) {
  const match = String(text || '').trim().match(/^(?:แจ้ง)?ของเข้า\s*(.*)$/)
  return match ? match[1].trim() : null
}

async function handleStockInStart(event, initialQuery = '') {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return false
  const reporter = lineUserId ? await resolveArrivalReporter(lineUserId) : null
  if (!reporter) return false // ยังไม่ได้ผูกไลน์ — ปล่อยตกไป fallback เดิม (echo userId)
  await upsertStockInSession(lineUserId, { step: 'await_item', sku: '', qty: '', items_json: '', pending_json: '' })
  if (initialQuery) {
    await handleStockInSearchReply(event, initialQuery)
    return true
  }
  await replyMessage(replyToken, [{ type: 'text', text: 'ของเข้าอะไรคะ? พิมพ์ชื่อสินค้าหรือ SKU ได้เลย (แจ้งได้หลายรายการต่อเนื่องกัน ระบบจะถามทีละรายการให้เอง)' }])
  return true
}

async function handleStockInSearchReply(event, queryOverride = '') {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const rawText = String(queryOverride || event.message?.text || '')
  const query = rawText.trim().toLowerCase()
  if (!query) return replyMessage(replyToken, [{ type: 'text', text: 'พิมพ์ชื่อสินค้าหรือ SKU ได้เลยค่ะ (แจ้งหลายรายการทีเดียวก็ได้ บรรทัดละ 1 รายการ เช่น sky 35-36 = 10 หรือ 37-38 20)' }])

  const items = await loadOrderableItems()
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const singleLineHasQty = lines.length === 1 && splitQueryAndQty(lines[0]).qtyText !== null
  if (lines.length > 1 || singleLineHasQty) {
    const { resolved, pending, errors } = parseOrderBatchLines(rawText, items)
    if (!resolved.length && !pending.length) {
      const text = errors.length ? errors.join('\n') + '\n\nลองพิมพ์ใหม่ได้เลยค่ะ' : 'ไม่พบรายการที่จะแจ้งเลยค่ะ ลองพิมพ์ใหม่'
      return replyMessage(replyToken, [{ type: 'text', text }])
    }
    await mergeIntoStockInCart(lineUserId, resolved)
    const prefixText = errors.length ? `⚠️ บางบรรทัดมีปัญหา:\n${errors.join('\n')}` : ''
    if (pending.length) return askStockInPendingQueue(replyToken, lineUserId, pending, prefixText)
    return addToStockInCartAndAskMore(replyToken, lineUserId, [], prefixText)
  }

  const matches = searchItemsByQuery(rawText, items).slice(0, 10)
  if (!matches.length) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ค่ะ ลองพิมพ์สั้นลง หรือใช้ชื่อ/SKU ที่ตรงกับหน้าเว็บมากขึ้น\nหากต้องการเริ่มใหม่ พิมพ์ “แจ้งของเข้า” ได้เลยค่ะ' }])
  if (matches.length === 1) return askStockInQty(replyToken, lineUserId, matches[0])

  await upsertStockInSession(lineUserId, { step: 'await_item_pick', sku: '', qty: '' })
  await replyMessage(replyToken, [{
    type: 'text', text: `พบ ${matches.length} รายการ เลือกได้เลยค่ะ`,
    quickReply: { items: matches.map((it) => ({ type: 'action', action: { type: 'postback', label: it.display_name.slice(0, 20), data: `stockin-pick:${it.sku}`, displayText: it.display_name } })) },
  }])
}

async function handleStockInPickPostback(event, sku) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const reporter = lineUserId ? await resolveArrivalReporter(lineUserId) : null
  if (!reporter) return replyMessage(replyToken, [{ type: 'text', text: 'ต้องผูกไลน์กับระบบก่อนถึงจะแจ้งของเข้าได้ค่ะ' }])
  const items = await loadOrderableItems()
  const item = items.find((it) => String(it.sku).toUpperCase() === String(sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ' }])
  await askStockInQty(replyToken, lineUserId, item)
}

async function handleStockInQtyReply(event, session) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken) return
  const text = String(event.message?.text || '').trim().replace(/,/g, '')
  const qty = Number(text)
  if (!Number.isFinite(qty) || qty <= 0) return replyMessage(replyToken, [{ type: 'text', text: 'กรุณาพิมพ์เป็นตัวเลขค่ะ เช่น 100' }])

  const reporter = await resolveArrivalReporter(lineUserId)
  if (!reporter) { await clearStockInSession(lineUserId); return replyMessage(replyToken, [{ type: 'text', text: 'ต้องผูกไลน์กับระบบก่อนถึงจะแจ้งของเข้าได้ค่ะ' }]) }

  let pending = []
  try { pending = JSON.parse(session.pending_json || '[]') } catch { pending = [] }
  if (pending.length) {
    const done = { ...pending[0], qty }
    const remaining = pending.slice(1)
    await mergeIntoStockInCart(lineUserId, [done])
    if (remaining.length) return askStockInPendingQueue(replyToken, lineUserId, remaining)
    return addToStockInCartAndAskMore(replyToken, lineUserId, [])
  }

  const items = await loadOrderableItems()
  const item = items.find((it) => String(it.sku).toUpperCase() === String(session.sku).toUpperCase())
  if (!item) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ในระบบแล้วค่ะ กรุณาเริ่มใหม่ด้วย “แจ้งของเข้า”' }])
  await addToStockInCartAndAskMore(replyToken, lineUserId, [{ sku: item.sku, display_name: item.display_name, unit: item.unit || 'ชิ้น', qty }])
}

// ── แก้ไขรายการที่โดนปฏิเสธ ผ่าน 1:1 กับคนนับของ (owner ขอ 2026-07-31 กันไม่ให้แก้ไขในกลุ่มแล้วรก) ──
// จำ username คงที่ของ "คนนับของ" ไว้ตรงนี้ (ค่าเดียวกับ default ในการ์ด StockCounterLineCard ฝั่งเว็บ
// Settings.jsx) — ยังไม่ทำเป็นค่าตั้งค่าแยก เพราะมีคนเดียวจริง ๆ ตอนนี้ ถ้าเปลี่ยนคนวันหน้า แก้ userId
// ในการ์ดนั้นได้เลย ไม่ต้องแก้โค้ด (ยกเว้นเปลี่ยน username ล็อกอินไปด้วย ถึงจะต้องแก้ค่านี้ตาม)
const STOCK_COUNTER_USERNAME = 'fah'
async function getStockCounterLineUserId() {
  const links = await getSheet('hr_line_links')
  return links.find((l) => l.username === STOCK_COUNTER_USERNAME)?.line_user_id || null
}

// ── Rich menu tier ────────────────────────────────────────────────────────
// แตง (staff tang) เป็นหัวหน้าฟ้า — role ในระบบเป็น staff ธรรมดา แต่ owner ขอให้เห็นเมนูชุดเดียวกับฟ้า
// (แจ้งของเข้า/ขอลา ไม่ใช่เมนู staff ทั่วไปที่มีแค่ขอลา/ประวัติ) ยกเว้นเป็นรายชื่อ ไม่ใช้ role ล้วน
const RICHMENU_STOCK_TIER_USERNAME_OVERRIDES = ['tang']
const RICHMENU_SHEET = 'line_richmenu_ids'
const RICHMENU_HEADERS = ['tier', 'richmenu_id', 'updated_at']

// เลือก tier เมนูจาก role + username override — ไม่ใช้ canManageOperations ตรงๆ เพราะอันนั้นรวม dev/boss
// ไว้ด้วยกัน แต่ที่นี่ dev/boss ยังแยก "full" tier เดียวกันได้ (เห็นปุ่มเท่ากันทั้งคู่)
function richMenuTierForRole(role, username) {
  const r = normalizeRole(role)
  // แตงผูก LINE ผ่านฝั่งพนักงาน (mp:TANG) ไม่ใช่บัญชี login 'tang' — ต้องตัด mp: ออกก่อนเทียบ ไม่งั้น
  // ไม่ตรงกับ override list เลย (พลาดจุดนี้ตอน backfill ครั้งแรก tang หลุดไปที่ tier staff)
  const bareUsername = String(username || '').replace(/^mp:/i, '').toLowerCase()
  if (RICHMENU_STOCK_TIER_USERNAME_OVERRIDES.includes(bareUsername)) return 'stock'
  if (r === 'dev' || r === 'boss') return 'full'
  if (r === 'stock') return 'stock'
  return 'staff'
}

async function getRichMenuIdMap() {
  try {
    const rows = await getSheet(RICHMENU_SHEET)
    return Object.fromEntries(rows.filter((r) => r.tier && r.richmenu_id).map((r) => [r.tier, r.richmenu_id]))
  } catch { return {} }
}

// ผูก rich menu ให้ผู้ใช้ 1 คนตาม tier ที่ resolve ได้ — เรียกทุกครั้งที่มีการผูก/เปลี่ยน LINE user id ใหม่
// (ดู action==='set-line-id'/'set-line-id-for') เงียบๆ ถ้ายังไม่เคย setup เมนูไว้เลย (ไม่มีแถวใน
// line_richmenu_ids) หรือ LINE API ล่ม ไม่ทำให้การผูกบัญชีหลักพังไปด้วย (best-effort ล้วนๆ)
async function assignRichMenuForLink(username, lineUserId, role) {
  if (!lineUserId) return
  try {
    const tier = richMenuTierForRole(role, username)
    const idMap = await getRichMenuIdMap()
    const richMenuId = idMap[tier]
    if (!richMenuId) return
    await linkRichMenuToUser(lineUserId, richMenuId)
  } catch (e) { console.error('assign richmenu:', e.message) }
}

// สรุปผล Approve/จับคู่ลอต เป็นข้อความสั้นเข้ากลุ่ม (ปฏิเสธ ไม่แจ้งกลุ่ม — แจ้งกลับผู้แจ้งของเข้า 1:1
// คนเดียว, owner ขอ 2026-08-05) — การ์ดจริงกับปุ่มกดทั้งหมดย้ายไปอยู่ 1:1 กับ boss/dev แล้ว (2026-08-01)
// กลุ่มเลยไม่เห็นอะไรเลยถ้าไม่ประกาศผลตรงนี้ ไม่มีกลุ่มลงทะเบียนไว้ก็แค่ข้ามเงียบๆ
async function announceStockInResultToGroup(text) {
  const groupId = await getGroupTarget()
  if (!groupId) return
  try { await pushMessage(groupId, [{ type: 'text', text }]) }
  catch (e) { console.error('announce stock-in result to group:', e.message) }
}

// บรรทัดสรุปของเข้าต่อ 1 รายการ เช่น "✅ รับเข้า รองเท้าเพื่อสุขภาพ Sky 37-38 จำนวน 50 คู่" — owner ขอ
// (2026-08-05) ให้กลุ่มเห็นว่ารับอะไรจำนวนเท่าไหร่ตรงๆ แทนข้อความ "Approve สำเร็จ" เฉยๆ ที่ไม่มีข้อมูลอะไรเลย
function stockInReceivedLine(request, items) {
  const item = items.find((it) => String(it.sku).toUpperCase() === String(request.sku).toUpperCase())
  const label = item?.display_name || request.sku
  const unit = item?.unit || ''
  return `✅ รับเข้า ${label} จำนวน ${Number(request.qty) || 0}${unit ? ` ${unit}` : ''}`
}

function stockInEditMenuMessage(request, item) {
  const label = item?.display_name || request.sku
  const unit = item?.unit || 'ชิ้น'
  return {
    type: 'text',
    text: `❗ "${label}" ถูกปฏิเสธค่ะ (แจ้งไว้ ${request.qty} ${unit} · เข้า ${request.arrival_date} · นับ ${request.count_date})\n\nต้องการแก้ไขอะไรคะ?`,
    quickReply: { items: [
      { type: 'action', action: { type: 'postback', label: 'จำนวน', data: `stockin-editmenu:qty:${request.id}`, displayText: 'แก้จำนวน' } },
      { type: 'action', action: { type: 'postback', label: 'วันที่', data: `stockin-editmenu:date:${request.id}`, displayText: 'แก้วันที่' } },
      { type: 'action', action: { type: 'postback', label: 'สินค้า', data: `stockin-editmenu:item:${request.id}`, displayText: 'แก้สินค้า' } },
      { type: 'action', action: { type: 'postback', label: 'ยกเลิก', data: `stockin-editmenu:cancel:${request.id}`, displayText: 'ยกเลิก ไม่แก้ไข' } },
    ] },
  }
}

async function handleStockInEditMenu(event, payload) {
  const [kind, id] = String(payload || '').split(':')
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken || !lineUserId || !id) return
  if (kind === 'cancel') {
    await clearStockInSession(lineUserId)
    return replyMessage(replyToken, [{ type: 'text', text: 'ไม่แก้ไขค่ะ รายการนี้ยังถูกปฏิเสธอยู่' }])
  }
  if (kind === 'qty') {
    await upsertStockInSession(lineUserId, { step: 'await_edit_qty', edit_target_id: id })
    return replyMessage(replyToken, [{ type: 'text', text: 'จำนวนใหม่เท่าไหร่คะ? พิมพ์ตัวเลขได้เลย' }])
  }
  if (kind === 'date') {
    await upsertStockInSession(lineUserId, { step: 'await_edit_arrival_date', edit_target_id: id, arrival_date: '', count_date: '' })
    return replyMessage(replyToken, [{
      type: 'text', text: 'ขั้นตอนวันที่ (1/2): ของเข้าวันไหนคะ?',
      quickReply: { items: [
        { type: 'action', action: { type: 'postback', label: 'วันนี้', data: 'stockin-date:today', displayText: 'วันนี้' } },
        { type: 'action', action: { type: 'datetimepicker', label: 'เลือกวันที่', data: 'stockin-date:pick', mode: 'date', initial: todayBKK() } },
      ] },
    }])
  }
  if (kind === 'item') {
    await upsertStockInSession(lineUserId, { step: 'await_edit_item', edit_target_id: id })
    return replyMessage(replyToken, [{ type: 'text', text: 'พิมพ์ชื่อสินค้าหรือ SKU ใหม่ได้เลยค่ะ' }])
  }
}

async function handleStockInEditQtyReply(event, session) {
  const replyToken = event.replyToken
  const lineUserId = event.source?.userId
  if (!replyToken) return
  const text = String(event.message?.text || '').trim().replace(/,/g, '')
  const qty = Number(text)
  if (!Number.isFinite(qty) || qty <= 0) return replyMessage(replyToken, [{ type: 'text', text: 'กรุณาพิมพ์เป็นตัวเลขค่ะ เช่น 100' }])
  await finishStockInEdit(replyToken, lineUserId, session.edit_target_id, { qty })
}

async function handleStockInEditItemReply(event, session) {
  const replyToken = event.replyToken
  const lineUserId = event.source?.userId
  if (!replyToken) return
  const query = String(event.message?.text || '').trim()
  if (!query) return replyMessage(replyToken, [{ type: 'text', text: 'พิมพ์ชื่อสินค้าหรือ SKU ได้เลยค่ะ' }])
  const items = await loadOrderableItems()
  const matches = searchItemsByQuery(query, items).slice(0, 10)
  if (!matches.length) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบสินค้านี้ค่ะ ลองพิมพ์ใหม่' }])
  if (matches.length === 1) return finishStockInEdit(replyToken, lineUserId, session.edit_target_id, { sku: matches[0].sku })
  await replyMessage(replyToken, [{
    type: 'text', text: `พบ ${matches.length} รายการ เลือกได้เลยค่ะ`,
    quickReply: { items: matches.map((it) => ({ type: 'action', action: { type: 'postback', label: it.display_name.slice(0, 20), data: `stockin-edititempick:${session.edit_target_id}:${it.sku}`, displayText: it.display_name } })) },
  }])
}

// รวมทุกทางแก้ไขให้จบที่เดียว — เติมฟิลด์ที่ไม่ได้แก้จากค่าเดิมเสมอ (editStockInRequest ต้องการ qty
// ครบทุกครั้งไม่ว่าจะแก้อะไรก็ตาม) แล้ว push การ์ด 1 รายการกลับเข้ากลุ่มให้ตรวจใหม่ เหมือน flow แจ้งของเข้ารอบแรก
async function finishStockInEdit(replyToken, lineUserId, id, patch) {
  const editor = lineUserId ? await resolveArrivalReporter(lineUserId) : null
  try {
    const original = await getStockInRequestById(id)
    if (!original) throw new Error('ไม่พบรายการนี้ อาจถูกจัดการไปแล้ว')
    const body = { id, sku: original.sku, qty: original.qty, arrival_date: original.arrival_date, count_date: original.count_date, ...patch }
    const updated = await editStockInRequest(body, editor?.name || 'LINE', editor?.role)
    await clearStockInSession(lineUserId)
    const items = await loadOrderableItems()
    const item = items.find((it) => String(it.sku).toUpperCase() === String(updated.sku).toUpperCase())
    await pushEditedStockInResult(replyToken, updated, item, editor?.name || 'ทีม')
  } catch (e) {
    await replyMessage(replyToken, [{ type: 'text', text: `แก้ไขไม่สำเร็จ: ${e.message}` }])
  }
}

async function pushEditedStockInResult(replyToken, request, item, editorName) {
  const label = item?.display_name || request.sku
  const unit = item?.unit || 'ชิ้น'
  const card = {
    type: 'flex', altText: `แก้ไขของเข้าแล้ว: ${label}`,
    contents: {
      type: 'bubble', size: 'giga',
      header: stockCardHeader('แก้ไขแล้ว รอตรวจอีกครั้ง', `เข้า ${request.arrival_date} · นับ ${request.count_date} · โดย ${editorName}`, '✏️'),
      body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: STOCK_CARD.soft, contents: [
        { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px', cornerRadius: '10px', backgroundColor: STOCK_CARD.base, contents: [stockInItemRow(request.id, label, `× ${request.qty} ${unit}`)] },
      ] },
    },
  }
  // การ์ดจริง (มีปุ่ม ✓/✗) ต้องไป 1:1 หา boss/dev เท่านั้น เหมือน flow แจ้งของเข้ารอบแรก (ดู
  // handleStockInCartDonePostback) — เดิม bug ตกหล่นจุดนี้ตอนย้ายทุกอย่างไป 1:1 (2026-08-01) ยังส่ง
  // เข้ากลุ่มอยู่ กลายเป็นปุ่ม Approve โผล่ในกลุ่มทั้งที่ควรกดได้แค่ 1:1 (owner เจอจริง 2026-08-04)
  const targets = await getStockLineTargets()
  if (targets.length) {
    await Promise.all(targets.map((t) => pushMessage(t.line_user_id, [card]).catch((e) => console.error('push edited card to boss/dev:', e.message))))
    await replyMessage(replyToken, [{ type: 'text', text: 'แก้ไขแล้วค่ะ ส่งให้ Boss ตรวจใหม่แล้ว' }])
  } else {
    await replyMessage(replyToken, [card])
  }
}

async function handleStockInCartDonePostback(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken || !lineUserId) return
  const session = (await getStockInSessions()).find((s) => s.line_user_id === lineUserId)
  let cart = []
  try { cart = JSON.parse(session?.items_json || '[]') } catch { cart = [] }
  if (!cart.length) return replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่มีรายการในตะกร้าเลยค่ะ พิมพ์ชื่อสินค้าหรือ SKU ที่จะแจ้งได้เลย' }])
  await upsertStockInSession(lineUserId, { step: 'await_arrival_date', arrival_date: '', count_date: '' })
  await replyMessage(replyToken, [{
    type: 'text', text: 'ขั้นตอนวันที่ (1/2): ของเข้าวันไหนคะ?',
    quickReply: { items: [
      { type: 'action', action: { type: 'postback', label: 'วันนี้', data: 'stockin-date:today', displayText: 'วันนี้' } },
      { type: 'action', action: { type: 'datetimepicker', label: 'เลือกวันที่', data: 'stockin-date:pick', mode: 'date', initial: todayBKK() } },
    ] },
  }])
}

// บันทึกของเข้าทั้งตะกร้า (1 รายการขึ้นไป) — สร้างทีละแถวด้วย addStockInRequest ตัวเดียวกับปุ่ม "แจ้งของเข้า"
// บนหน้า Stock Movement (ยังไม่ตัดสต็อกจริง — สร้างแค่แถว pending รอบอส/dev กด Match จากเว็บ) แล้ว push
// การ์ดสรุปเข้ากลุ่มไลน์ทีม (ถ้าเคยลงทะเบียนกลุ่มไว้แล้ว) ให้บอส/dev เห็นว่ามีของรอ Match
async function completeStockInBatch(replyToken, lineUserId, session, arrivalDate, countDate) {
  let items = []
  try { items = JSON.parse(session.items_json || '[]') } catch { items = [] }
  if (!Array.isArray(items) || !items.length) return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบรายการแจ้งของเข้าค่ะ กรุณาเริ่มใหม่ด้วย “แจ้งของเข้า”' }])
  const reporter = await resolveArrivalReporter(lineUserId)
  if (!reporter) { await clearStockInSession(lineUserId); return replyMessage(replyToken, [{ type: 'text', text: 'ต้องผูกไลน์กับระบบก่อนถึงจะแจ้งของเข้าได้ค่ะ' }]) }

  const done = []
  const failed = []
  for (const it of items) {
    try {
      const request = await addStockInRequest({ sku: it.sku, qty: it.qty, arrival_date: arrivalDate, count_date: countDate, note: 'แจ้งจาก LINE' }, reporter.name)
      done.push({ ...it, request })
    } catch (e) { failed.push(`${it.display_name}: ${e.message}`) }
  }
  await clearStockInSession(lineUserId)

  // ปุ่ม ✓/✗ แยกต่อรายการ (ของเข้าหลายรายการอาจตรงไม่หมดทุกอัน) + ปุ่ม "Approve ทั้งหมด" รวม
  // ไว้ตรงกดจบทีเดียวถ้าตรงหมด — สองแบบอยู่ด้วยกันได้ กด ✗ รายการไหนไปแล้ว กด "ทั้งหมด" ซ้ำ
  // แค่รายการนั้นจะ error เฉยๆ (เช็ค status pending อยู่แล้วใน matchStockInRequest)
  const itemRows = done.map((it) => stockInItemRow(it.request.id, it.display_name, `× ${it.qty} ${it.unit}`))
  const footerButtons = done.length > 1 ? [stockCardButton({
    type: 'postback', label: `Approve ทั้งหมด (${done.length})`, data: `stockin-approve:${done.map((it) => it.request.id).join(',')}`, displayText: `Approve ของเข้า ${done.length} รายการ`,
  }, true)] : []
  const summaryCard = {
    type: 'flex', altText: `แจ้งของเข้า ${done.length} รายการ`,
    contents: {
      type: 'bubble', size: 'giga',
      header: stockCardHeader('แจ้งของเข้าแล้ว', `${done.length} รายการ · เข้า ${arrivalDate} · นับ ${countDate} · โดย ${reporter.name}`, '📦'),
      body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: STOCK_CARD.soft, contents: [
        { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px', cornerRadius: '10px', backgroundColor: STOCK_CARD.base, contents: itemRows.length ? itemRows : [stockFlexText('ไม่มีรายการสำเร็จ', {})] },
        ...(failed.length ? [stockFlexText(`ล้มเหลว: ${failed.join('; ')}`, { color: '#C0392B', size: 'xxs', margin: 'sm', wrap: true })] : []),
      ] },
      ...(footerButtons.length ? { footer: { type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px', backgroundColor: STOCK_CARD.base, contents: footerButtons } } : {}),
    },
  }
  // การ์ดจริง (มีปุ่ม ✓/✗) ส่ง 1:1 หา boss/dev ทุกคนที่เปิด notify_stock ไว้ (ใช้ target ชุดเดียวกับ
  // แจ้งเตือนของใกล้หมด getStockLineTargets()) แทนการโพสต์เข้ากลุ่ม — กลุ่มเห็นแค่ผลลัพธ์หลัง boss กด
  // ✓/✗ เสร็จแล้ว (ดู stockin-approve/-reject/-matchlot) ไม่ต้องมีปุ่มโชว์ในกลุ่มเลย กันรกตามที่ owner ขอ
  // (2026-08-01 กลับทิศจาก push-to-group เดิมเมื่อวาน) ถ้ายังไม่มีใครเปิด notify_stock เลย fallback ส่ง
  // การ์ดเต็มกลับไปหาคนแจ้งแทน ไม่งั้นไม่มีใครเห็นการ์ดนี้เลย
  const targets = done.length ? await getStockLineTargets() : []
  if (targets.length) {
    const altText = `ของเข้ารอ Match: ${done.length} รายการ (แจ้งโดย ${reporter.name})`
    await Promise.all(targets.map((t) => pushMessage(t.line_user_id, [{ ...summaryCard, altText }]).catch((e) => console.error('push arrival card to boss/dev:', e.message))))
    await replyMessage(replyToken, [{ type: 'text', text: `แจ้งของเข้า ${done.length} รายการเรียบร้อยค่ะ ส่งให้ Boss ตรวจแล้ว` }])
  } else {
    // ยังไม่มีใครเปิด notify_stock เลย — ส่งการ์ดเต็มกลับไปหาคนแจ้งแทน ไม่งั้นไม่มีใครเห็นการ์ดนี้เลย
    await replyMessage(replyToken, [summaryCard])
  }
}

async function handleStockInDatePostback(event, choice) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!replyToken || !lineUserId) return
  const session = (await getStockInSessions()).find((s) => s.line_user_id === lineUserId)
  const isEdit = ['await_edit_arrival_date', 'await_edit_count_date'].includes(session?.step)
  if (!isEdit && !['await_arrival_date', 'await_count_date'].includes(session?.step)) {
    return replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบรายการแจ้งของเข้าที่รอเลือกวันที่ค่ะ กรุณาเริ่มใหม่ด้วย “แจ้งของเข้า”' }])
  }
  const selectedDate = choice === 'same' ? session.arrival_date : choice === 'today' ? todayBKK() : String(event.postback?.params?.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return replyMessage(replyToken, [{ type: 'text', text: 'กรุณาเลือกวันที่จากปฏิทินอีกครั้งค่ะ' }])
  const firstStep = isEdit ? 'await_edit_arrival_date' : 'await_arrival_date'
  const nextStep = isEdit ? 'await_edit_count_date' : 'await_count_date'
  if (session.step === firstStep) {
    await upsertStockInSession(lineUserId, { step: nextStep, arrival_date: selectedDate })
    return replyMessage(replyToken, [{
      type: 'text', text: `ขั้นตอนวันที่ (2/2): วันที่นับสต็อกวันไหนคะ?\nวันที่เข้าที่เลือก: ${selectedDate}`,
      quickReply: { items: [
        { type: 'action', action: { type: 'postback', label: 'วันเดียวกับของเข้า', data: 'stockin-date:same', displayText: 'วันเดียวกับของเข้า' } },
        { type: 'action', action: { type: 'datetimepicker', label: 'เลือกวันที่นับ', data: 'stockin-date:pick', mode: 'date', initial: selectedDate } },
      ] },
    }])
  }
  if (isEdit) return finishStockInEdit(replyToken, lineUserId, session.edit_target_id, { arrival_date: session.arrival_date, count_date: selectedDate })
  await completeStockInBatch(replyToken, lineUserId, session, session.arrival_date, selectedDate)
}

// สิทธิ์กด Approve ของเข้าในกลุ่ม LINE ดูจาก users.role โดยตรง ไม่ผูกกับชนิด username
// เพราะบัญชีพนักงาน (เช่น mp:...) อาจได้รับสิทธิ์ Dev/Boss ได้เช่นกัน — คนเดียวอาจมีหลายแถวผูก LINE id
// เดียวกัน (เช่น mp:MO สำหรับลา + dev สำหรับสิทธิ์จริง) ต้องไล่เช็คทุกแถว ไม่ใช่หยุดที่แถวแรกที่เจอ (บั๊กจริง
// ที่เจอ 2026-07-31: .find() เจอแถว mp: ก่อน ซึ่งไม่มีใน users sheet เลย fail ทั้งที่มีแถว dev ที่ถูกต้องอยู่ด้วย)
async function findStockApprover(lineUserId) {
  const links = (await getSheet('hr_line_links')).filter((l) => l.line_user_id === lineUserId)
  const users = await getSheet('users')
  for (const link of links) {
    const user = users.find((u) => u.username === link.username)
    if (user && canManageOperations(user.role)) return { name: user.display_name || link.username, role: user.role }
  }
  return null
}
// ── ริชเมนู: คำสั่งดึงดูรายการรอตรวจแบบ on-demand (แต่เดิมมีแต่การ์ด push อัตโนมัติตอนมีรายการใหม่
// เท่านั้น กดปุ่มริชเมนูแล้วอยากเห็น "ตอนนี้มีอะไรค้างอยู่บ้าง" ต้องมีคำสั่งดึงเองด้วย) — boss/dev เท่านั้น
const STOCK_PENDING_TRIGGER = 'ของเข้ารอตรวจ'
const LEAVE_PENDING_TRIGGER = 'อนุมัติการลา'
const HELP_TRIGGER = 'ช่วยเหลือ'
// ปุ่ม "เช็คประวัติ" ฝั่ง boss/dev — คนละความหมายกับ "ประวัติลา" ฝั่งพนักงาน (ดูของตัวเองปีนี้) นี่คือดู
// "ใครลาบ้างเดือนไหน" ทั้งทีม เลือกเดือนก่อนแล้วค่อยตอบ (owner ขอ 2026-08-06 แทนที่ปุ่ม "ขอลา" เดิมของ boss/dev)
const BOSS_LEAVE_HISTORY_TRIGGER = 'เช็คประวัติ'
// ปุ่ม "รายการที่สั่งไว้" — ดูว่าสั่งอะไรไปแล้วเท่าไหร่ ยังรอของเข้าอยู่กี่รายการ (owner ขอ 2026-08-06)
// เพดาน 10 รายการต่อการ์ด เกินกว่านั้นให้กดปุ่มเปิดเว็บไปดูที่ Stock Movement แทน (LINE การ์ดยาวเกินไปอ่านยาก)
const ORDER_LIST_TRIGGER = 'รายการที่สั่งไว้'
const ORDER_LIST_LIMIT = 10
// ปุ่ม "แก้ไขของเข้า" — ย้อนกลับ approve/ปฏิเสธที่กดผิดใน LINE (owner ขอ 2026-08-11 คู่กับบั๊ก race
// condition ที่เจอ: บาง approve ไม่เข้า stock จริง) แสดงรายการล่าสุดที่ approve/ปฏิเสธไปแล้วให้เลือกย้อนกลับ
const STOCK_IN_UNDO_TRIGGER = 'แก้ไขของเข้า'
const STOCK_IN_UNDO_LIMIT = 5 // LINE reply รับได้สูงสุด 5 ข้อความต่อครั้ง (1 การ์ด = 1 ข้อความ)
// รวบปุ่ม boss/dev ที่แน่นเกินไป (8 ปุ่ม) เหลือ hero เดียวต่อหมวด — เลือกจริงผ่าน quick reply ที่ยิง
// ข้อความเดิม (เช่น "สั่งของ") กลับเข้ามาเหมือนพิมพ์เอง ไม่ต้องเขียน handler ใหม่ (owner ขอ 2026-08-11)
const STOCK_MENU_TRIGGER = 'งานสต็อค'
const HR_MENU_TRIGGER = 'งาน HR'
const appWebUrl = (tab) => `${APP_BASE_URL}/${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`

async function handleOrderListCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss เท่านั้นที่ดูรายการนี้ได้ค่ะ' }])
  const orders = (await loadStockInRequests({ status: 'pending', role: approver.role })).filter((r) => r.order_only)
  if (!orders.length) return replyMessage(replyToken, [{ type: 'text', text: '✅ ไม่มีรายการที่สั่งไว้รอของเข้าตอนนี้ค่ะ' }])
  orders.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) // เก่าสุดก่อน (รอนานสุดขึ้นบน)
  const items = await loadOrderableItems()
  const rows = orders.slice(0, ORDER_LIST_LIMIT).map((o) => {
    const item = items.find((it) => String(it.sku).toUpperCase() === String(o.sku).toUpperCase())
    const label = item?.display_name || o.sku
    const unit = item?.unit || ''
    // จำนวน optional (0/ว่าง = "ไม่ระบุจำนวน" — คำสั่งซื้อเก่าก่อนเริ่มระบบไม่มีบันทึกจำนวนไว้ ไม่ใช่ข้อมูลพัง)
    const qtyText = Number(o.qty) > 0 ? `× ${o.qty}${unit}` : 'ไม่ระบุจำนวน'
    return {
      type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', margin: 'sm', contents: [
        orderFlexText(`${label} ${qtyText}`, { size: 'xs', weight: 'bold', flex: 5, wrap: true }),
        orderFlexText((o.order_date || o.created_at || '-').slice(0, 10), { size: 'xxs', color: ORDER_CARD.muted, flex: 3, align: 'end' }),
      ],
    }
  })
  const footerButtons = orders.length > ORDER_LIST_LIMIT && APP_BASE_URL
    ? [orderCardButton({ type: 'uri', label: `ดูทั้งหมด (${orders.length})`, uri: stockWebUrl() }, true)]
    : []
  await replyMessage(replyToken, [{
    type: 'flex', altText: `รายการที่สั่งไว้ ${orders.length} รายการ`,
    contents: {
      type: 'bubble', size: 'giga',
      header: orderCardHeader('รายการที่สั่งไว้', `รอของเข้า ${orders.length} รายการ`, '📋'),
      body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: ORDER_CARD.soft, contents: rows },
      ...(footerButtons.length ? { footer: { type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px', backgroundColor: ORDER_CARD.base, contents: footerButtons } } : {}),
    },
  }])
}

// รายการ approve/ปฏิเสธล่าสุด ให้เลือกย้อนกลับ (undoStockInDecision) — เผื่อกดผิด/มีของเข้าไม่ครบตามที่คิด
async function handleStockInUndoListCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss หรือ Dev เท่านั้นที่แก้ไขย้อนหลังได้ค่ะ' }])
  const all = await loadStockInRequests({ role: approver.role })
  const decided = all.filter((r) => r.status === 'matched' || r.status === 'rejected')
  decided.sort((a, b) => String(b.matched_at).localeCompare(String(a.matched_at)))
  const recent = decided.slice(0, STOCK_IN_UNDO_LIMIT)
  if (!recent.length) return replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่มีรายการที่ approve หรือปฏิเสธไว้ค่ะ' }])
  const items = await loadOrderableItems()
  const cards = recent.map((r) => {
    const item = items.find((it) => String(it.sku).toUpperCase() === String(r.sku).toUpperCase())
    const label = item?.display_name || r.sku
    const statusText = r.status === 'matched' ? `✅ Approve แล้ว × ${r.qty}${item?.unit || ''}` : '✗ ปฏิเสธแล้ว'
    return {
      type: 'flex', altText: `${label} — ${statusText}`,
      contents: {
        type: 'bubble', size: 'kilo',
        header: stockCardHeader('แก้ไขของเข้า', `${(r.matched_at || '').slice(0, 10)} · โดย ${r.matched_by || '-'}`, '↩️'),
        body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: STOCK_CARD.soft, contents: [stockInItemRow(r.id, label, statusText)] },
        footer: { type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px', backgroundColor: STOCK_CARD.base, contents: [
          stockCardButton({ type: 'postback', label: 'ย้อนกลับ', data: `stockin-undo:${r.id}`, displayText: `ย้อนกลับ ${label}` }, true),
        ] },
      },
    }
  })
  await replyMessage(replyToken, cards.slice(0, 5))
}

async function handleStockMenuCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss หรือ Dev เท่านั้นค่ะ' }])
  return replyMessage(replyToken, [{
    type: 'text', text: 'งานสต็อค — เลือกได้เลยค่ะ',
    quickReply: { items: [
      { type: 'action', action: { type: 'message', label: 'สั่งของ', text: 'สั่งของ' } },
      { type: 'action', action: { type: 'message', label: 'ของเข้ารอตรวจ', text: STOCK_PENDING_TRIGGER } },
      { type: 'action', action: { type: 'message', label: 'รายการที่สั่งไว้', text: ORDER_LIST_TRIGGER } },
      { type: 'action', action: { type: 'message', label: 'เช็คของ', text: 'เช็คของ' } },
      { type: 'action', action: { type: 'message', label: 'แก้ไขของเข้า', text: STOCK_IN_UNDO_TRIGGER } },
    ] },
  }])
}

async function handleHrMenuCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss หรือ Dev เท่านั้นค่ะ' }])
  return replyMessage(replyToken, [{
    type: 'text', text: 'งาน HR — เลือกได้เลยค่ะ',
    quickReply: { items: [
      { type: 'action', action: { type: 'message', label: 'อนุมัติการลา', text: LEAVE_PENDING_TRIGGER } },
      { type: 'action', action: { type: 'message', label: 'เช็คประวัติลา', text: BOSS_LEAVE_HISTORY_TRIGGER } },
    ] },
  }])
}

async function handleStockPendingListCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss เท่านั้นที่ดูรายการนี้ได้ค่ะ' }])
  const pending = (await loadStockInRequests({ status: 'pending', role: approver.role })).filter((r) => !r.order_only)
  if (!pending.length) return replyMessage(replyToken, [{ type: 'text', text: '✅ ไม่มีของเข้ารอตรวจตอนนี้ค่ะ' }])
  const items = await loadOrderableItems()
  const cards = pending.slice(0, 5).map((r) => {
    const item = items.find((it) => String(it.sku).toUpperCase() === String(r.sku).toUpperCase())
    const label = item?.display_name || r.sku
    return {
      type: 'flex', altText: `ของเข้ารอตรวจ: ${label} × ${r.qty}`,
      contents: {
        type: 'bubble', size: 'kilo',
        header: stockCardHeader('ของเข้ารอตรวจ', `เข้า ${r.arrival_date} · นับ ${r.count_date} · โดย ${r.created_by || '-'}`, '📦'),
        body: { type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs', backgroundColor: STOCK_CARD.soft, contents: [stockInItemRow(r.id, label, `× ${r.qty} ${item?.unit || ''}`)] },
        footer: { type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px', backgroundColor: STOCK_CARD.base, contents: [
          stockCardButton({ type: 'postback', label: 'ปฏิเสธ', data: `stockin-reject:${r.id}`, displayText: `ปฏิเสธ ${label}` }),
          stockCardButton({ type: 'postback', label: 'Approve', data: `stockin-approve:${r.id}`, displayText: `Approve ${label}` }, true),
        ] },
      },
    }
  })
  const suffix = pending.length > 5 ? [{ type: 'text', text: `และอีก ${pending.length - 5} รายการ — เปิดเว็บเพื่อดูทั้งหมด` }] : []
  return replyMessage(replyToken, [...cards, ...suffix])
}

async function handleLeavePendingListCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss เท่านั้นที่ดูรายการนี้ได้ค่ะ' }])
  const pending = (await getSheet('hr_leave')).filter((l) => l.status === 'pending')
  if (!pending.length) return replyMessage(replyToken, [{ type: 'text', text: '✅ ไม่มีคำขอลารอตรวจตอนนี้ค่ะ' }])
  const officeMap = await getOfficePeopleMap()
  const cards = pending.slice(0, 5).map((record) => leaveFlexMessage(record, 'pending', officeMap))
  const suffix = pending.length > 5 ? [{ type: 'text', text: `และอีก ${pending.length - 5} รายการ — เปิดเว็บเพื่อดูทั้งหมด` }] : []
  return replyMessage(replyToken, [...cards, ...suffix])
}

// เลือกเดือนก่อนดูประวัติการลาทั้งทีม — ย้อนหลัง 6 เดือนจากเดือนปัจจุบัน
function monthQuickReplyItems(count = 6) {
  const items = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
    items.push({ type: 'action', action: { type: 'postback', label, data: `leave-hist-month:${ym}`, displayText: `ประวัติการลาเดือน ${label}` } })
  }
  return items
}

async function handleBossLeaveHistoryCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss เท่านั้นที่ดูรายการนี้ได้ค่ะ' }])
  return replyMessage(replyToken, [{ type: 'text', text: 'เลือกเดือนที่ต้องการดูประวัติการลาค่ะ', quickReply: { items: monthQuickReplyItems() } }])
}

async function handleBossLeaveHistoryMonth(event, ym) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  const approver = lineUserId ? await findStockApprover(lineUserId) : null
  if (!approver) return replyMessage(replyToken, [{ type: 'text', text: 'เฉพาะ Boss เท่านั้นที่ดูรายการนี้ได้ค่ะ' }])
  const leaves = (await getSheet('hr_leave')).filter((l) => l.status === 'approved' && String(l.start_date || '').startsWith(ym))
  const monthLabel = new Date(`${ym}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
  if (!leaves.length) return replyMessage(replyToken, [{ type: 'text', text: `เดือน ${monthLabel} ไม่มีใครลาเลยค่ะ` }])
  leaves.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
  const lines = leaves.map((l) => `${leaveTypeIcon(l.leave_type)} ${l.employee_name || '-'} — ${l.leave_type} ${lineDateRange(l)}${Number(l.days) ? ` (${l.days} วัน)` : ''}`)
  const text = `ประวัติการลาเดือน ${monthLabel} (${leaves.length} รายการ)\n\n${lines.join('\n')}`
  return replyMessage(replyToken, [{ type: 'text', text: text.slice(0, 4900) }])
}

// ข้อความคู่มือสั้นๆ ต่อ tier — ให้ตรงกับปุ่มที่คนนั้นเห็นจริงในริชเมนู (ไม่ใช่ list คำสั่งทั้งหมดที่มี
// เพราะบางคำสั่งเขาไม่มีสิทธิ์ใช้อยู่ดี) resolve tier เดียวกับตอน assign เมนู (richMenuTierForRole)
async function handleHelpCommand(event) {
  const lineUserId = event.source?.userId
  const replyToken = event.replyToken
  if (!lineUserId || !replyToken) return
  const links = (await getSheet('hr_line_links')).filter((l) => l.line_user_id === lineUserId)
  const users = await getSheet('users')
  let username = '', role = ''
  for (const link of links) {
    const user = users.find((u) => u.username === link.username)
    if (user) { username = link.username; role = user.role; break }
  }
  if (!username && links.length) username = links[0].username
  const tier = richMenuTierForRole(role, username)
  const guide = {
    full: [
      `📦 พิมพ์ "${STOCK_MENU_TRIGGER}" — เมนูรวมงานสต็อค (สั่งของ/ของเข้ารอตรวจ/รายการที่สั่งไว้/เช็คของ/แก้ไขของเข้า)`,
      `📝 พิมพ์ "${HR_MENU_TRIGGER}" — เมนูรวมงาน HR (อนุมัติการลา/เช็คประวัติลา)`,
      '📦 พิมพ์ "แจ้งของเข้า" — บันทึกของเข้าที่นับได้จริง',
      '🏖️ เว็บแอพ — กดปุ่มในเมนูด้านล่างแชทได้เลย',
    ],
    stock: ['📦 พิมพ์ "แจ้งของเข้า" — บันทึกของเข้าที่นับได้จริง', '🏖️ ขอลา/เปิดเว็บแอพ — กดปุ่มในเมนูด้านล่างแชทได้เลย'],
    staff: ['🏖️ พิมพ์ "ลา" — เริ่มขอลา', '📖 พิมพ์ "ประวัติลา" — ดูประวัติการลาปีนี้', '📊 พิมพ์ "สรุปลา" — ดูวันลาคงเหลือ'],
  }[tier] || []
  return replyMessage(replyToken, [{ type: 'text', text: `คู่มือการใช้งานค่ะ:\n\n${guide.join('\n')}` }])
}

const PLANNER_CONFIG_SHEET = 'planner_config'
const PLANNER_DAILY_SHEET = 'planner_daily'
const PLANNER_CONFIG_HEADERS = ['master_sku', 'enabled', 'reserve_days', 'safety_percent', 'updated_at', 'updated_by']
const PLANNER_DAILY_HEADERS = ['id', 'date', 'master_sku', 'fg', 'sales_average', 'demand_mode', 'recommended_feed', 'planned_feed', 'feeders', 'updated_at', 'updated_by']
const WORKFORCE_SHEETS = [['workforce_ot', OT_HEADERS], ['workforce_manpower', MANPOWER_HEADERS], ['workforce_events', EVENT_HEADERS], ['workforce_ot_history', OT_HISTORY_HEADERS], ['workforce_ot_approvals', OT_APPROVAL_HEADERS], ['workforce_people', PEOPLE_HEADERS], ['workforce_ot_limits', OT_LIMIT_HEADERS], ['workforce_ot_approval_history', OT_APPROVAL_HISTORY_HEADERS], ['workforce_schedule_snapshot', SCHEDULE_SNAPSHOT_HEADERS], ['workforce_schedule_overrides', SCHEDULE_OVERRIDE_HEADERS], ['workforce_dayrecords', DAYRECORD_HEADERS]]
let workforceEnsurePromise
let workforceCache = { at: 0, data: null }
const ensureWorkforceSheets = () => workforceEnsurePromise ||= ensureSheets(WORKFORCE_SHEETS)
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

// วันหยุดประจำสัปดาห์ต่อคน (0=อาทิตย์...6=เสาร์ ตาม Date.getDay()) — รวมทั้งบ้านล่าง (workforce_people)
// และออฟฟิศ (hr_office_people สำคัญเหมือนกัน เพราะ buildCoveragePlan เช็คคนออฟฟิศว่างเป็นแคนดิเดตแทนกันจาก
// scheduleSet เดียวกับบ้านล่าง — ไม่มีวันหยุดประจำของออฟฟิศ ระบบจะเสนอคนออฟฟิศที่จริงๆ หยุดอยู่ให้แทนกันได้ผิด)
// เก็บแยกจาก getPersonMap() (คืน [name, group] tuple ใช้อยู่หลายจุด) กันไม่ต้องแก้ signature ทุกที่ที่เรียกอยู่แล้ว
// value เป็น {weekday, from} — from ว่าง = มีผลทันทีไม่จำกัดวันที่ย้อนหลัง (ดู isFixedDayOff)
async function getDayOffMap() {
  const [people, officePeople] = await Promise.all([getSheet('workforce_people'), getSheet('hr_office_people')])
  const map = {}
  for (const p of [...people, ...officePeople]) {
    if (!p.code || String(p.active) === '0') continue
    const w = String(p.day_off_weekday ?? '').trim()
    if (w !== '') map[String(p.code).toUpperCase()] = { weekday: w, from: String(p.day_off_effective_from ?? '').trim() }
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
  const [personMap, quotaMap, officeMap, dayOffMap] = await Promise.all([getPersonMap(), getQuotaMap(), includeOffice ? getOfficePeopleMap() : {}, getDayOffMap()])
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
    return { code: p.code, name: p.name, group: p.group, quota, used, remaining: Math.max(0, quota - used), day_off_weekday: dayOffMap[p.code]?.weekday ?? '', day_off_effective_from: dayOffMap[p.code]?.from ?? '' }
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
// เช็ควันหยุดประจำสัปดาห์คงที่ต่อคน (เช่น หยุดทุกวันอาทิตย์) — เทียบ weekday ของวันที่นั้นตรงกับที่ตั้งไว้ไหม
// ใช้ new Date(`${date}T00:00:00`) เสมอ (ไม่ใช่ new Date(date) เฉยๆ) กัน parse เป็น UTC แล้ว weekday เพี้ยน
const isFixedDayOff = (dayOffMap, code, date) => {
  const entry = dayOffMap[code]
  if (!entry) return false
  if (entry.from && date < entry.from) return false // ยังไม่ถึงวันที่เริ่มมีผล — ใช้รูปแบบเดิม (มาทำงานปกติ) ต่อไป
  return String(new Date(`${date}T00:00:00`).getDay()) === entry.weekday
}
// fallback เมื่อยังไม่มีตารางพนักงาน (หรือพนักงานคนนี้ยังไม่มีแถวในตารางเลย เช่นเพิ่งเพิ่มใหม่ผ่านหน้า HR) —
// สมมติมาทำงานทุกวัน ยกเว้นวันที่มีคำขอลาอนุมัติแล้ว หรือตรงวันหยุดประจำ — onlyCodes จำกัดเฉพาะบางคนได้
// (ใช้ตอน getCalendarPresence เจอคนที่ snapshot ปีทั้งปีไม่มีแถวเลย จะได้ไม่ต้อง generate ทับคนที่มีตารางจริงอยู่แล้ว)
function generateCalendarPresence(personMap, leaveRows, dayOffMap = {}, onlyCodes = null) {
  const absenceByCode = buildLeaveAbsenceMap(leaveRows)
  const roster = Object.entries(personMap)
    .filter(([code]) => !onlyCodes || onlyCodes.has(code))
    .map(([code, [name, group]]) => ({ code, name, group }))
  const start = new Date(`${todayStr()}T00:00:00`); start.setDate(start.getDate() - 90)
  const end = new Date(`${todayStr()}T00:00:00`); end.setDate(end.getDate() + 180)
  const result = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    for (const p of roster) {
      if (isFixedDayOff(dayOffMap, p.code, date)) continue
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
  const [snapshotRows, overrideRows, leaveRows, dayOffMap] = await Promise.all([
    getSheet('workforce_schedule_snapshot'), getSheet('workforce_schedule_overrides'), getSheet('hr_leave'), getDayOffMap(),
  ])
  let baseRows = (snapshotRows.length ? snapshotRows : generateCalendarPresence(personMap, [], dayOffMap))
    .filter((r) => personMap[String(r.code || '').toUpperCase()])
    .map((r) => ({ id: `stored-${r.date}-${r.code}`, date: r.date, employee: r.employee, code: String(r.code || '').toUpperCase(), group: r.group, fraction: Number(r.fraction) || 1, source: 'stored' }))
    // วันหยุดประจำสัปดาห์ตัดออกก่อน apply override เสมอ — ถ้า boss แก้ตารางเฉพาะวันนั้นเจาะจงไว้ (เช่น
    // เรียกมาทำงานพิเศษ) override ยังทับกลับมาให้มาได้ตามปกติ ไม่ถูกวันหยุดประจำบังตลอดไป
    .filter((r) => !isFixedDayOff(dayOffMap, r.code, r.date))
  // snapshot ปีทั้งปีโหลดไว้ล่วงหน้าตอนเริ่มระบบ — พนักงานที่เพิ่งเพิ่มใหม่ผ่านหน้า HR ทีหลังไม่มีแถวในนั้น
  // เลยไม่เคยโผล่ในปฏิทินเลย (เจอจริง 2026-08-01) หาคนที่ไม่มีแถวไหนใน baseRows เลยสักแถว แล้ว generate
  // ให้เหมือน fallback (มาทำงานทุกวัน ยกเว้นลา/วันหยุดประจำ) จะได้ขึ้นปฏิทินทันทีที่เพิ่ม ไม่ต้องรอแก้ snapshot มือ
  if (snapshotRows.length) {
    const codesWithRows = new Set(baseRows.map((r) => r.code))
    const missingCodes = new Set(Object.keys(personMap).filter((code) => !codesWithRows.has(code)))
    if (missingCodes.size) baseRows = [...baseRows, ...generateCalendarPresence(personMap, [], dayOffMap, missingCodes)]
    // คนใน LEGACY_OVERRIDE_EXEMPT_CODES (ดูคอมเมนต์ scheduleOverrides.js) มี snapshot จริงอยู่บ้างแต่ไม่ครบทั้งปี
    // (เจอจริง 2026-08-04 กรณีเกด มี snapshot แค่ 2 วัน) เลยไม่เข้าเงื่อนไข missingCodes ข้างบน (ต้องไม่มีแถวเลยสัก
    // แถวถึงจะเข้า) — เติมเฉพาะวันที่ยังไม่มีแถวจริงให้ด้วย กันไม่ให้หายไปในวันที่ snapshot เดิมไม่ครอบคลุม
    const partialExemptCodes = new Set([...codesWithRows].filter((code) => LEGACY_OVERRIDE_EXEMPT_CODES.has(code)))
    if (partialExemptCodes.size) {
      const existingKeys = new Set(baseRows.map((r) => `${r.date}|${r.code}`))
      const filler = generateCalendarPresence(personMap, [], dayOffMap, partialExemptCodes).filter((r) => !existingKeys.has(`${r.date}|${r.code}`))
      baseRows = [...baseRows, ...filler]
    }
  }
  baseRows = applyScheduleOverrides({ baseRows, overrideRows, personMap, overrideScopeCodes, officeCodes, dayOffMap })
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
    let dayOffMapForSchedule = {}
    try {
      const [leaveRows, officeMapResult, dayOffMapResult] = await Promise.all([getSheet('hr_leave'), getOfficePeopleMap(), getDayOffMap()])
      officeMap = officeMapResult
      dayOffMapForSchedule = dayOffMapResult
      // รวมออฟฟิศเข้ากับตารางกะด้วย (เดิมส่งแค่บ้านล่าง) — ปฏิทินจะได้โชว์ตามตารางกะจริงของออฟฟิศด้วย ไม่ใช่ "มาทุกวันเสมอ" เหมือนก่อน
      sourceManpower = await getCalendarPresence({ ...personMap, ...officeMap }, Object.keys(personMap), true, Object.keys(officeMap))
      officePeople = Object.entries(officeMap).map(([code, [name]]) => ({ code, name }))
      for (const l of leaveRows) {
        // hr ยังไม่ approve ไม่ต้องมีผลกับปฏิทิน — approved เท่านั้น
        if (l.status !== 'approved') continue
        if (!String(l.username || '').startsWith('mp:')) continue
        const code = l.username.slice(3)
        if (!officeMap[code]) continue
        for (const date of leaveAbsenceDates(l)) officeAbsences.push({ code, date })
      }
    } catch (e) { console.error('office presence:', e.message) }
    res.setHeader('Cache-Control', cacheable('public, s-maxage=20, stale-while-revalidate=60'))
    // เพิ่มออฟฟิศเข้าไปในรายชื่อที่แก้ผ่านปุ่ม "คน" ได้แล้ว (เดิมแก้ได้แค่บ้านล่าง)
    // แนบวันหยุดประจำมาด้วย — ให้หน้าเว็บ default ไม่ติ๊กคนที่วันหยุดประจำตรงกับวันที่กำลังแก้ตอนเปิด modal เสมอ
    // (กันปัญหา checkbox ค้างจาก override เก่าที่เคยมีชื่อเขาทำงานวันนั้น แล้ว resave ทับวันหยุดประจำใหม่โดยไม่ตั้งใจ)
    const withDayOff = (code) => ({ day_off_weekday: dayOffMapForSchedule[code]?.weekday ?? '', day_off_effective_from: dayOffMapForSchedule[code]?.from ?? '' })
    const schedulePeople = [
      ...Object.entries(personMap).map(([code, [name, group]]) => ({ code, name, group, ...withDayOff(code) })),
      ...Object.entries(officeMap).map(([code, [name]]) => ({ code, name, group: 'ออฟฟิศ', ...withDayOff(code) })),
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
    // การ์ดหลายใบในหน้า Settings (LineLinkCard/BossLineNotifyCard/StaffLineLinkCard ฯลฯ) ยิง op=hr พร้อมกัน
    // ตอน mount — ถ้าไม่กันซ้ำ แต่ละใบจะยิง batchGetValues เองหมด (ก่อน cache ด้านบนทันเวลา) ชนโควตา
    // "Read requests per minute" ของ Sheets API ได้ง่ายๆ (เจอจริงตอน owner ทดสอบ) รวมเป็น request เดียวกัน
    if (!hrInflight) {
      hrInflight = (async () => {
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
        hrCache = { at: Date.now(), data }
        return data
      })().finally(() => { hrInflight = null })
    }
    const data = await hrInflight
    res.setHeader('Cache-Control', cacheable('public, s-maxage=20, stale-while-revalidate=60'))
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
    // วันหยุดประจำสัปดาห์ (0=อาทิตย์...6=เสาร์) + วันที่เริ่มมีผล — ใช้ได้ทั้งบ้านล่างและออฟฟิศ (ออฟฟิศก็มีผล
    // จริงกับ buildCoveragePlan ตอนเลือกคนออฟฟิศมาแทนกัน ดูคอมเมนต์ getDayOffMap)
    const dayOffWeekday = ['0', '1', '2', '3', '4', '5', '6'].includes(String(body.day_off_weekday)) ? String(body.day_off_weekday) : ''
    const dayOffFrom = dayOffWeekday ? (isoDate(body.day_off_effective_from) || '') : ''
    if (!code || !name) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสและชื่อ' })
    if (group === 'ออฟฟิศ') {
      const current = await getSheet('hr_office_people')
      const existing = current.find((r) => String(r.code).toUpperCase() === code)
      if (existing && String(existing.active) !== '0') return res.status(400).json({ success: false, error: 'มีรหัสนี้อยู่แล้ว' })
      if (existing) {
        const next = current.map((r) => String(r.code).toUpperCase() === code ? { ...r, name, active: '1', day_off_weekday: dayOffWeekday, day_off_effective_from: dayOffFrom } : r)
        await overwriteSheet('hr_office_people', OFFICE_HEADERS, next.map((r) => OFFICE_HEADERS.map((h) => r[h] ?? '')))
      } else {
        await appendRows('hr_office_people', [[code, name, '1', dayOffWeekday, dayOffFrom]])
      }
    } else {
      const current = await getSheet('workforce_people')
      const existing = current.find((r) => String(r.code).toUpperCase() === code)
      if (existing && String(existing.active) !== '0') return res.status(400).json({ success: false, error: 'มีรหัสนี้อยู่แล้ว' })
      if (existing) {
        const next = current.map((r) => String(r.code).toUpperCase() === code ? { ...r, name, group, active: '1', day_off_weekday: dayOffWeekday, day_off_effective_from: dayOffFrom } : r)
        await overwriteSheet('workforce_people', PEOPLE_HEADERS, next.map((r) => PEOPLE_HEADERS.map((h) => r[h] ?? '')))
      } else {
        await appendRows('workforce_people', [[code, name, group, '1', dayOffWeekday, dayOffFrom]])
      }
    }
    clearHrCache(); clearWorkforceCache()
    return res.status(200).json({ success: true })
  }
  if (action === 'edit-employee-dayoff') {
    if (!requireAdmin(req, res)) return
    const code = String(body.code || '').trim().toUpperCase()
    const dayOffWeekday = ['0', '1', '2', '3', '4', '5', '6'].includes(String(body.day_off_weekday)) ? String(body.day_off_weekday) : ''
    // เปลี่ยนวันหยุดประจำมีผล "ตั้งแต่วันที่เลือก" เท่านั้น (owner ขอ 2026-08-01) — ก่อนวันนี้ยังยึด
    // รูปแบบเดิม ไม่ย้อนหลังไปแก้กำลังคนที่คำนวณไปแล้วในอดีต ว่าง = มีผลทันทีไม่จำกัดย้อนหลัง (เช่นคนใหม่)
    const dayOffFrom = dayOffWeekday ? (isoDate(body.day_off_effective_from) || '') : ''
    if (!code) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัส' })
    // หารหัสนี้ทั้งสองชีต (บ้านล่าง/ออฟฟิศ) เพราะแก้ได้ทั้งคู่แล้วตอนนี้
    const peopleCurrent = await getSheet('workforce_people')
    const peopleExisting = peopleCurrent.find((r) => String(r.code).toUpperCase() === code)
    if (peopleExisting) {
      const next = peopleCurrent.map((r) => String(r.code).toUpperCase() === code ? { ...r, day_off_weekday: dayOffWeekday, day_off_effective_from: dayOffFrom } : r)
      await overwriteSheet('workforce_people', PEOPLE_HEADERS, next.map((r) => PEOPLE_HEADERS.map((h) => r[h] ?? '')))
      clearHrCache(); clearWorkforceCache()
      return res.status(200).json({ success: true })
    }
    const officeCurrent = await getSheet('hr_office_people')
    const officeExisting = officeCurrent.find((r) => String(r.code).toUpperCase() === code)
    if (!officeExisting) return res.status(404).json({ success: false, error: 'ไม่พบพนักงานนี้' })
    const nextOffice = officeCurrent.map((r) => String(r.code).toUpperCase() === code ? { ...r, day_off_weekday: dayOffWeekday, day_off_effective_from: dayOffFrom } : r)
    await overwriteSheet('hr_office_people', OFFICE_HEADERS, nextOffice.map((r) => OFFICE_HEADERS.map((h) => r[h] ?? '')))
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
      // ผูกแทนพนักงาน manpower (employee_code -> mp:<code>) หรือผูกแทนบอส/dev คนอื่นตรงๆ (username) ก็ได้ —
      // ใช้ตอน dev ผูก LINE แทนบอสที่ไม่สะดวก login เอง (เช่น บอสสต็อกคนละคนกับบอส HR)
      const code = String(body.employee_code || '').trim()
      const rawUsername = String(body.username || '').trim()
      if (!code && !rawUsername) return res.status(400).json({ success: false, error: 'กรุณาระบุพนักงานหรือ username' })
      username = code ? `mp:${code}` : rawUsername
    } else {
      username = actorUsername() || 'boss'
    }
    const lineUserId = String(body.line_user_id || '').trim()
    const current = await getSheet('hr_line_links')
    const existing = current.find((r) => r.username === username)
    const now = new Date().toISOString()
    const kept = current.filter((r) => r.username !== username).map((r) => LINE_LINK_HEADERS.map((h) => r[h] ?? ''))
    // notify_hr/notify_stock: ใช้ค่าที่ส่งมาถ้ามี ไม่งั้นสืบต่อจากของเดิม (แก้แค่ userId ไม่ควรรีเซ็ตค่าที่ตั้งไว้) —
    // ยังไม่เคยมีแถวเดิมเลย (ผูกครั้งแรก) default เปิดทั้งคู่
    const notifyHr = body.notify_hr !== undefined ? (body.notify_hr ? '1' : '0') : (existing?.notify_hr ?? '1')
    const notifyStock = body.notify_stock !== undefined ? (body.notify_stock ? '1' : '0') : (existing?.notify_stock ?? '1')
    const rows = lineUserId ? [...kept, LINE_LINK_HEADERS.map((h) => ({ username, line_user_id: lineUserId, updated_at: now, notify_hr: notifyHr, notify_stock: notifyStock })[h] ?? '')] : kept
    await overwriteSheet('hr_line_links', LINE_LINK_HEADERS, rows)
    clearHrCache()
    // ผูกเมนู richmenu ให้ตรง tier ทันทีที่ผูก/เปลี่ยน LINE user id — mp:<code> (พนักงานทั่วไปไม่มี login)
    // ไม่มีแถวใน users เลย ก็ตกไปเป็น tier "staff" ตามค่า default ของ richMenuTierForRole
    if (lineUserId) {
      const users = await getSheet('users').catch(() => [])
      const role = users.find((u) => u.username === username)?.role
      await assignRichMenuForLink(username, lineUserId, role)
    }
    return res.status(200).json({ success: true, line_user_id: lineUserId })
  }
  // admin ตั้งค่าหมวดแจ้งเตือน (การลา/สต็อก) ให้คนอื่นได้เลย ไม่ต้องให้แต่ละคน login เข้ามาตั้งเอง —
  // ใช้ตอนบอสหลายคน (เช่น บอส HR กับบอสสต็อกคนละคน) ผูก LINE ไว้แล้วแต่ตั้งหมวดเริ่มต้นให้แต่ละคนจากที่เดียว
  if (action === 'admin-set-notify') {
    if (!requireAdmin(req, res)) return
    const username = String(body.username || '').trim()
    if (!username) return res.status(400).json({ success: false, error: 'ต้องระบุ username' })
    const current = await getSheet('hr_line_links')
    const idx = current.findIndex((r) => r.username === username)
    if (idx === -1) return res.status(400).json({ success: false, error: 'คนนี้ยังไม่ได้ผูก LINE' })
    const now = new Date().toISOString()
    const rows = current.map((r, i) => LINE_LINK_HEADERS.map((h) => (i === idx
      ? { ...r, notify_hr: body.notify_hr ? '1' : '0', notify_stock: body.notify_stock ? '1' : '0', updated_at: now }
      : r)[h] ?? ''))
    await overwriteSheet('hr_line_links', LINE_LINK_HEADERS, rows)
    clearHrCache()
    return res.status(200).json({ success: true })
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
    await ensureSheets([[PLANNER_CONFIG_SHEET, PLANNER_CONFIG_HEADERS], [PLANNER_DAILY_SHEET, PLANNER_DAILY_HEADERS]])

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

// เช็ค header ของ 3 แท็บที่ webhook เกือบทุก event ต้องอ่าน (session สั่งของ/แจ้งของเข้า/group link)
// รวดเดียวด้วย ensureSheets ก่อนเข้า loop event — เดิมแต่ละแท็บเรียก ensureSheet แยกกันทีละจุด (ดู
// getStockOrderSessions/getStockInSessions/registerLineGroup) รวม 3 read request ต่อ cold instance
// ทุกข้อความไลน์ที่เข้ามา ซึ่งเป็น endpoint ที่ถี่สุดในระบบ (ทุกครั้งที่มีคนพิมพ์แชท ไม่ใช่แค่ตอนเปิดหน้าเว็บ)
let lineFlowEnsurePromise
const ensureLineFlowSheets = () => lineFlowEnsurePromise ||= ensureSheets([
  [STOCK_ORDER_SESSION_SHEET, STOCK_ORDER_SESSION_HEADERS],
  [STOCK_IN_SESSION_SHEET, STOCK_IN_SESSION_HEADERS],
  [LINE_GROUP_LINK_SHEET, LINE_GROUP_LINK_HEADERS],
])

async function opLineWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!verifySignature(req.rawBody, req.headers['x-line-signature'])) return res.status(401).end()
  await ensureLineFlowSheets()
  const events = Array.isArray(req.body?.events) ? req.body.events : []
  for (const event of events) {
    try {
      // ลงทะเบียน groupId ของกลุ่มไลน์ทีมงานอัตโนมัติ ถ้า event นี้มาจากกลุ่ม (ดู comment บน LINE_GROUP_LINK_SHEET)
      if (event.source?.type === 'group' && event.source.groupId) await registerLineGroup(event.source.groupId)

      // กลุ่มไลน์ใช้แค่ "แสดงผล" (การ์ดแจ้งเตือน/สรุปหลัง match) ไม่รับคำสั่งใดๆ ทั้งพิมพ์ข้อความและกดปุ่ม —
      // ทุก flow (สั่งของ/แจ้งของเข้า/อนุมัติลา/ฯลฯ) ต้องทำใน 1:1 เท่านั้น (owner ขอ 2026-08-04 หลังเจอปัญหา
      // session ค้างทำให้บอทตอบข้อความคุยเล่นในกลุ่มด้วย — 1:1 ก็ยังมีปัญหาเดิมได้เหมือนกัน แต่ตัด attack
      // surface ที่คนอื่นในกลุ่มบังเอิญพิมพ์ชนกับ session ของคนอื่นออกไปได้อย่างน้อย)
      if (event.source?.type !== 'user') continue

      const lineUserId = event.source?.userId
      const staffLink = lineUserId ? await findStaffLink(lineUserId) : null

      if (event.type === 'message' && event.message?.type === 'text') {
        // รอบอส/dev พิมพ์จำนวนสั่งของกลับมาไหม (หลังกดปุ่ม "สั่งของ" จากการ์ดแจ้งเตือนของใกล้หมด หรือหลังเลือกจาก
        // ผลค้นหา) หรือกำลังพิมพ์ชื่อ/SKU ค้นหาอยู่ (หลังพิมพ์ "สั่งของ" เปล่าๆ) — เช็คก่อน fallback echo userId
        // ด้านล่าง เพราะบอส/dev ไม่ผ่าน findStaffLink (นั่นสำหรับพนักงาน mp: เท่านั้น)
        // session ค้าง (เช่น พิมพ์ "สั่งของ" แล้วเงียบไปกลางคัน) เดิมไม่มีวันหมดอายุเลย — ทุกข้อความถัดไป
        // ที่พิมพ์ (แม้ในกลุ่มไลน์ แชทเล่นๆ ไม่เกี่ยวกับสต็อกเลย) จะถูกตีความเป็นชื่อสินค้า/จำนวนตลอดไป จนกว่า
        // จะรู้ต้องพิมพ์ "สั่งของ"/"แจ้งของเข้า" ซ้ำเพื่อเริ่มใหม่ (เจอจริง: บอสพิมพ์คุยเล่นในกลุ่มแล้วบอทตอบ
        // "ไม่พบสินค้านี้" ซ้ำๆ ทุกข้อความ งงว่าเกิดอะไรขึ้น) หมดอายุอัตโนมัติถ้าไม่มีการตอบต่อเกิน 30 นาที
        const isStale = (s) => s && Date.now() - new Date(s.updated_at).getTime() > 30 * 60 * 1000
        let stockSession = lineUserId ? (await getStockOrderSessions()).find((s) => s.line_user_id === lineUserId) : null
        let stockInSession = lineUserId ? (await getStockInSessions()).find((s) => s.line_user_id === lineUserId) : null
        if (isStale(stockSession)) { await clearStockOrderSession(lineUserId); stockSession = null }
        if (isStale(stockInSession)) { await clearStockInSession(lineUserId); stockInSession = null }
        const initialQuery = stockOrderCommandQuery(event.message.text)
        const initialInQuery = stockInCommandQuery(event.message.text)
        // ทางออกด่วน — พิมพ์คำพวกนี้ตอนติดอยู่กลาง flow สั่งของ/แจ้งของเข้า จะเคลียร์ session ทันที ไม่ต้องรอ
        // หมดอายุ 30 นาที (isStale ด้านบน) — เช็คเฉพาะตอนมี session ค้างจริง กันบอทไปตอบ "ยกเลิก" ลอยๆ ในกลุ่ม
        if ((stockSession || stockInSession) && isCancelStockFlowCommand(event.message.text)) {
          await clearStockOrderSession(lineUserId)
          await clearStockInSession(lineUserId)
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: 'ยกเลิกแล้วค่ะ' }])
          continue
        }
        // กดปุ่มริชเมนูอันไหนก็ได้ ต้อง "ชนะ" เสมอ ไม่ว่าจะติดอยู่กลาง flow ไหนอยู่ก่อนก็ตาม (owner ขอ
        // 2026-08-06: ค้างขั้นตอนลาอยู่ กดช่วยเหลือ ต้องสลับได้ทันที ไม่ใช่แค่ตอบไม่ได้เงียบๆ) เคลียร์ session
        // ทั้ง 3 ชุด (สั่งของ/แจ้งของเข้า/ตัวช่วยขอลา) ทิ้งก่อนเข้า handler จริงข้างล่าง กันของเก่าค้างสับสน
        const isAnyMenuCommand = initialQuery === '' || initialInQuery === '' ||
          [STOCK_PENDING_TRIGGER, LEAVE_PENDING_TRIGGER, HELP_TRIGGER, BOSS_LEAVE_HISTORY_TRIGGER, ORDER_LIST_TRIGGER, STOCK_IN_UNDO_TRIGGER, STOCK_MENU_TRIGGER, HR_MENU_TRIGGER, LEAVE_TRIGGER, LEAVE_HISTORY_TRIGGER, LEAVE_SUMMARY_TRIGGER].includes(event.message.text)
        if (isAnyMenuCommand) {
          await clearStockOrderSession(lineUserId)
          await clearStockInSession(lineUserId)
          await clearSession(lineUserId)
          stockSession = null
          stockInSession = null
        }
        // ปุ่มริชเมนู "ของเข้ารอตรวจ"/"อนุมัติการลา"/"ช่วยเหลือ" ต้องใช้ได้ทุกเมื่อเหมือนกัน แม้กำลังติดอยู่
        // กลาง flow สั่งของ/แจ้งของเข้า (เช่นรอเลือกสินค้าอยู่) ไม่งั้นข้อความจะโดนตีความเป็นชื่อสินค้าค้นหา
        // ไปก่อนถึงจะมาถึงเช็คตรงนี้ (เจอจริง: กด "ช่วยเหลือ" ระหว่างรอเลือกสินค้าตอนสั่งของ ได้ "ไม่พบสินค้านี้")
        if (event.message.text === STOCK_PENDING_TRIGGER) { await handleStockPendingListCommand(event); continue }
        if (event.message.text === LEAVE_PENDING_TRIGGER) { await handleLeavePendingListCommand(event); continue }
        if (event.message.text === HELP_TRIGGER) { await handleHelpCommand(event); continue }
        if (event.message.text === BOSS_LEAVE_HISTORY_TRIGGER) { await handleBossLeaveHistoryCommand(event); continue }
        if (event.message.text === ORDER_LIST_TRIGGER) { await handleOrderListCommand(event); continue }
        if (event.message.text === STOCK_IN_UNDO_TRIGGER) { await handleStockInUndoListCommand(event); continue }
        if (event.message.text === STOCK_MENU_TRIGGER) { await handleStockMenuCommand(event); continue }
        if (event.message.text === HR_MENU_TRIGGER) { await handleHrMenuCommand(event); continue }
        // คำสั่ง “เช็คของที่ต้องสั่ง” ดูได้ทุกเมื่อจากทุกขั้นตอนเหมือนกัน — ไม่ต้องรอการ์ดแจ้งเตือนรายวัน
        if (isStockCheckCommand(event.message.text) && await handleStockCheckCommand(event)) continue
        // คำสั่ง “สั่งของ”/“แจ้งของเข้า” เริ่มใหม่ได้จากทุกขั้นตอน รวมถึงตอนที่รอจำนวนหรือรอเลือกวันที่
        if (initialQuery === '') { await handleStockOrderSearchStart(event); continue }
        if (initialInQuery === '') { await handleStockInStart(event); continue }
        if (stockSession?.step === 'await_item_qty') { await handleStockOrderQtyReply(event, stockSession); continue }
        if (stockInSession?.step === 'await_item_qty') { await handleStockInQtyReply(event, stockInSession); continue }
        if (stockInSession?.step === 'await_edit_qty') { await handleStockInEditQtyReply(event, stockInSession); continue }
        if (stockInSession?.step === 'await_edit_item') { await handleStockInEditItemReply(event, stockInSession); continue }
        if (stockSession?.step === 'await_batch_date') { await replyMessage(event.replyToken, [{ type: 'text', text: 'กรุณากดเลือกวันที่จากข้อความก่อนหน้านี้ หรือพิมพ์ “สั่งของ” เพื่อเริ่มใหม่ค่ะ' }]); continue }
        if (stockInSession?.step === 'await_batch_date') { await replyMessage(event.replyToken, [{ type: 'text', text: 'กรุณากดเลือกวันที่จากข้อความก่อนหน้านี้ หรือพิมพ์ “แจ้งของเข้า” เพื่อเริ่มใหม่ค่ะ' }]); continue }
        if (stockSession?.step === 'await_item' || stockSession?.step === 'await_item_pick') {
          // ถ้าพิมพ์ "สั่งของ" ซ้ำระหว่างที่บอตรอชื่อสินค้า ให้เริ่มรอบใหม่ ไม่เอาคำสั่งไปค้นหาเป็นชื่อสินค้า
          await handleStockOrderSearchReply(event)
          continue
        }
        if (stockInSession?.step === 'await_item' || stockInSession?.step === 'await_item_pick') {
          await handleStockInSearchReply(event)
          continue
        }
        // พิมพ์ "สั่งของ"/"แจ้งของเข้า" ได้เลย (ไม่ได้มาจากการ์ดแจ้งเตือน)
        // เพื่อสั่งของที่ยังไม่ใกล้หมดได้ด้วย
        if (initialQuery !== null && await handleStockOrderSearchStart(event, initialQuery)) continue
        if (initialInQuery !== null && await handleStockInStart(event, initialInQuery)) continue
        // LINE ID เดียวกันอาจผูกเป็นทั้งพนักงานและ DEV/Boss ได้: ให้คำสั่งสต็อกด้านบน
        // มีสิทธิ์ทำงานก่อน แล้วข้อความอื่นค่อยเข้าขั้นตอนลาของพนักงาน
        if (staffLink) { await handleLeaveWizard(event, staffLink); continue }
        // เดิมตอบ userId กลับให้ทุกข้อความที่ไม่เข้าเงื่อนไขไหนเลย (เผื่อเอาไปผูก LINE) — เอาออกตามที่ owner
        // ขอ (2026-07-31) เพราะคนที่ผูกไลน์แล้ว (เช่น บอส ที่ผูกแบบ non-mp: ไม่เข้าเงื่อนไข staffLink) พิมพ์
        // อะไรเล่นๆ ในกลุ่มแล้วโดนบอทตอบ userId ใส่หน้า งงว่าเกิดอะไรขึ้น ไม่ตอบอะไรเลยดีกว่าถ้าไม่เข้าคำสั่งไหน
        continue
      }

      if (event.type !== 'postback') continue
      const data = String(event.postback?.data || '')
      if (data.startsWith('hr-wiz-')) { await handleLeaveWizard(event, staffLink); continue }
      if (data.startsWith('leave-hist-month:')) { await handleBossLeaveHistoryMonth(event, data.slice('leave-hist-month:'.length)); continue }
      if (data.startsWith('stock-order:')) { await handleStockOrderPostback(event, data.slice('stock-order:'.length)); continue }
      if (data.startsWith('stock-pick:')) { await handleStockPickPostback(event, data.slice('stock-pick:'.length)); continue }
      if (data.startsWith('stock-order-date:')) { await handleStockOrderDatePostback(event, data.slice('stock-order-date:'.length)); continue }
      if (data === 'stock-cart-done') { await handleStockCartDonePostback(event); continue }
      if (data.startsWith('stockin-pick:')) { await handleStockInPickPostback(event, data.slice('stockin-pick:'.length)); continue }
      if (data.startsWith('stockin-date:')) { await handleStockInDatePostback(event, data.slice('stockin-date:'.length)); continue }
      if (data === 'stockin-cart-done') { await handleStockInCartDonePostback(event); continue }
      if (data.startsWith('stockin-editmenu:')) { await handleStockInEditMenu(event, data.slice('stockin-editmenu:'.length)); continue }
      if (data.startsWith('stockin-edititempick:')) {
        const [id, sku] = data.slice('stockin-edititempick:'.length).split(':')
        await finishStockInEdit(event.replyToken, event.source?.userId, id, { sku })
        continue
      }
      if (data.startsWith('stockin-approve:')) {
        const approver = lineUserId ? await findStockApprover(lineUserId) : null
        if (!approver) {
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: 'ไม่มีสิทธิ์ Approve: กรุณาผูก LINE กับบัญชี Boss ในระบบก่อนค่ะ' }])
          continue
        }
        const ids = data.slice('stockin-approve:'.length).split(',').map((id) => id.trim()).filter(Boolean)
        // กด ✓ ทีละรายการ (ไม่ใช่ "Approve ทั้งหมด" แบบ batch) — เช็คก่อนว่ามีลอต "สั่งของ" ค้างรอของ sku
        // เดียวกันไหม (FIFO เหมือนหน้าเว็บ) ถ้ามีให้เลือกจับคู่ก่อน ไม่ match ทันที กันพลาดจับผิดลอต —
        // batch หลายรายการพร้อมกันไม่รองรับเลือกลอต (ซับซ้อนเกินไปใน LINE) match แบบไม่ผูกลอตไปเลย
        const pending = await loadStockInRequests({ status: 'pending', role: approver.role })
        if (ids.length === 1) {
          const target = pending.find((r) => String(r.id) === ids[0])
          if (target?.available_orders?.length) {
            const lots = target.available_orders.slice(0, 11) // carousel เต็มที่ 12 ใบ เผื่อ 1 ใบให้ "ไม่ผูกลอต"
            const unit = target.unit || ''
            const reportedQty = Number(target.qty) || 0
            // Carousel ปาดดูทีละลอต แทนลิสต์ยาว + quick reply แยก (owner ขอ 2026-08-06 หลัง preview
            // เทียบหลายแบบ) แต่ละใบมีปุ่มของตัวเอง ไม่ต้องพึ่ง quick reply เลย ใบสุดท้ายเป็น "ไม่ผูกลอต" เสมอ
            const lotBubbles = lots.map((o) => {
              const mismatch = (Number(o.qty) || 0) !== reportedQty
              const diff = (Number(o.qty) || 0) - reportedQty
              const color = mismatch ? '#C0392B' : ORDER_CARD.green
              const diffText = diff === 0 ? 'จำนวนตรง' : diff > 0 ? `เกิน ${diff} ${unit}` : `ขาด ${Math.abs(diff)} ${unit}`
              return {
                type: 'bubble', size: 'micro',
                body: {
                  type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm', backgroundColor: '#FFFFFF',
                  borderWidth: '3px', borderColor: color, cornerRadius: '16px',
                  contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                      { type: 'box', layout: 'baseline', flex: 1, contents: [
                        orderFlexText(String(o.qty), { size: '3xl', weight: 'bold', color }),
                        orderFlexText(unit, { size: 'sm', color: ORDER_CARD.muted, margin: 'xs' }),
                      ] },
                      orderFlexText(mismatch ? '⚠️' : '✅', { size: 'lg', flex: 0 }),
                    ] },
                    orderFlexText(`สั่ง ${(o.order_date || o.created_at || '-').slice(0, 10)}`, { size: 'sm', weight: 'bold', color: '#46644E', margin: 'md' }),
                    orderFlexText(diffText, { size: 'xs', weight: 'bold', color, margin: 'xs' }),
                  ],
                },
                footer: { type: 'box', layout: 'vertical', paddingAll: '8px', contents: [
                  orderCardButton({ type: 'postback', label: 'เลือกลอตนี้', data: `stockin-matchlot:${target.id}:${o.id}`, displayText: `จับคู่ลอต ${o.qty} (${o.order_date || '-'})` }, true),
                ] },
              }
            })
            const noneBubble = {
              type: 'bubble', size: 'micro',
              body: {
                type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
                borderWidth: '3px', borderColor: '#96969B', cornerRadius: '16px',
                contents: [
                  orderFlexText('❓', { size: 'xxl', align: 'center' }),
                  orderFlexText('ของที่เข้ามาไม่ตรงกับลอตไหนเลย', { size: 'sm', weight: 'bold', color: '#66666B', align: 'center', margin: 'md', wrap: true }),
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '8px', contents: [
                { type: 'button', style: 'primary', color: '#96969B', height: 'sm', action: { type: 'postback', label: 'ไม่ผูกลอต', data: `stockin-matchlot:${target.id}:none`, displayText: 'ไม่ผูกลอต' } },
              ] },
            }
            await replyMessage(event.replyToken, [{
              type: 'flex', altText: `เลือกลอตที่ตรงกับของเข้า "${target.display_name}" (แจ้งเข้า ${reportedQty}${unit})`,
              contents: { type: 'carousel', contents: [...lotBubbles, noneBubble] },
            }])
            continue
          }
        }
        // Approve หลายรายการพร้อมกัน ("Approve ทั้งหมด") — ถามทีละรายการเหมือน ids.length===1 ไม่ได้ (ยิง
        // คำถามรัวๆ ใน LINE ใช้ไม่ได้จริง) แต่ก็ไม่ควรปล่อยไม่ผูกลอตไปเงียบๆ เหมือนเดิม — owner แจ้งว่า
        // "Approve ทั้งหมด" ไม่ผูกลอตให้เลย ถ้ารายการไหนมีลอต "สั่งของ" ค้างรอพอดี ผูกลอตที่เก่าสุด (FIFO)
        // ให้อัตโนมัติเลย เหมือนติ๊ก ⭐ ให้ทุกรายการ
        const approved = []
        const failed = []
        for (const id of ids) {
          const target = pending.find((r) => String(r.id) === id)
          const fifoLotId = target?.available_orders?.[0]?.id
          try { approved.push(await matchStockInRequest({ id, order_request_id: fifoLotId }, approver.name, approver.role)) }
          catch (e) { failed.push(e.message) }
        }
        if (event.replyToken) await replyMessage(event.replyToken, [{
          type: 'text', text: failed.length
            ? `Approve สำเร็จ ${approved.length} รายการ\nไม่สำเร็จ: ${failed.join('; ')}`
            : `Approve สำเร็จ ${approved.length} รายการ โดย ${approver.name}`,
        }])
        // การ์ดจริงส่ง 1:1 ไม่ได้ขึ้นในกลุ่มแล้ว — แจ้งผลสั้นๆ เข้ากลุ่มแทน ให้ทีมเห็นว่า Match ไปแล้ว
        // owner ขอ (2026-08-05): บอกรับเข้าอะไร/จำนวนเท่าไหร่ตรงๆ ไม่ใช่แค่ "Approve สำเร็จ" เฉยๆ
        // ไม่แจ้งกลับฟ้า 1:1 อีกต่อไปเมื่อ match ตรง (owner ขอ 2026-08-05) — Approve ผ่าน LINE ไม่มีช่องแก้
        // จำนวนตอน match เลย จำนวนที่รับเข้าจะตรงกับที่ฟ้าแจ้งไว้เสมอ ไม่มีเคส "ไม่ตรง" ให้ต้องแจ้งกลับ
        if (approved.length) {
          const items = await loadOrderableItems()
          const lines = approved.map((r) => stockInReceivedLine(r, items))
          await announceStockInResultToGroup(lines.join('\n'))
        }
        continue
      }
      if (data.startsWith('stockin-matchlot:')) {
        const approver = lineUserId ? await findStockApprover(lineUserId) : null
        if (!approver) {
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: 'ไม่มีสิทธิ์ Approve: กรุณาผูก LINE กับบัญชี Boss ในระบบก่อนค่ะ' }])
          continue
        }
        const [reqId, lotId] = data.slice('stockin-matchlot:'.length).split(':')
        try {
          const matched = await matchStockInRequest({ id: reqId, order_request_id: lotId === 'none' ? undefined : lotId }, approver.name, approver.role)
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: `Approve สำเร็จ โดย ${approver.name}${lotId !== 'none' ? ' (จับคู่ลอตแล้ว)' : ''}` }])
          const items = await loadOrderableItems()
          await announceStockInResultToGroup(stockInReceivedLine(matched, items))
        } catch (e) {
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: `ทำรายการไม่สำเร็จ: ${e.message}` }])
        }
        continue
      }
      if (data.startsWith('stockin-reject:')) {
        const approver = lineUserId ? await findStockApprover(lineUserId) : null
        if (!approver) {
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: 'ไม่มีสิทธิ์ปฏิเสธ: กรุณาผูก LINE กับบัญชี Boss ในระบบก่อนค่ะ' }])
          continue
        }
        const ids = data.slice('stockin-reject:'.length).split(',').map((id) => id.trim()).filter(Boolean)
        const rejected = []
        const failed = []
        for (const id of ids) {
          try { rejected.push(await rejectStockInRequest({ id }, approver.name, approver.role)) }
          catch (e) { failed.push(e.message) }
        }
        // แก้ไขให้เกิดขึ้น 1:1 กับคนนับของเท่านั้น (owner ขอ 2026-07-31) — กันกลุ่มรกด้วยเมนูแก้ไขที่ไม่
        // เกี่ยวกับบอส/dev เลย กลุ่มเห็นแค่สรุปสั้นๆ ว่าปฏิเสธแล้วและแจ้งใครไปให้แก้ไข ส่วนเมนูแก้ไขจริง
        // (จำนวน/วันที่/สินค้า/ยกเลิก) ส่งตรงเข้าแชท 1:1 ของคนนับของ ผ่าน pushMessage
        let notifyResult = ''
        if (rejected.length) {
          const counterId = await getStockCounterLineUserId()
          if (counterId) {
            const items = await loadOrderableItems()
            for (const r of rejected) {
              const item = items.find((it) => String(it.sku).toUpperCase() === String(r.sku).toUpperCase())
              try { await pushMessage(counterId, [stockInEditMenuMessage(r, item)]) }
              catch (e) { console.error('push edit-menu to stock counter:', e.message) }
            }
            notifyResult = ' — แจ้งคนนับของให้แก้ไขทาง LINE 1:1 แล้ว'
          } else {
            notifyResult = ' — ยังไม่ได้ผูกไลน์คนนับของ (ตั้งค่าที่หน้า Settings > คนนับของ) ให้แจ้งด้วยตนเองนะคะ'
          }
        }
        if (event.replyToken) await replyMessage(event.replyToken, [{
          type: 'text',
          text: failed.length
            ? `ปฏิเสธสำเร็จ ${rejected.length} รายการ\nไม่สำเร็จ: ${failed.join('; ')}`
            : `ปฏิเสธสำเร็จ ${rejected.length} รายการ โดย ${approver.name}${notifyResult}`,
        }])
        continue
      }
      if (data.startsWith('stockin-undo:')) {
        const approver = lineUserId ? await findStockApprover(lineUserId) : null
        if (!approver) {
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: 'ไม่มีสิทธิ์ย้อนกลับ: กรุณาผูก LINE กับบัญชี Boss ในระบบก่อนค่ะ' }])
          continue
        }
        const id = data.slice('stockin-undo:'.length).trim()
        try {
          const items = await loadOrderableItems()
          const before = await getStockInRequestById(id)
          const item = items.find((it) => String(it.sku).toUpperCase() === String(before?.sku).toUpperCase())
          const label = item?.display_name || before?.sku || id
          const reverted = await undoStockInDecision({ id }, approver.name, approver.role)
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: `ย้อนกลับ "${label}" แล้ว โดย ${approver.name} — กลับไปรอ approve/ปฏิเสธใหม่ค่ะ` }])
          await announceStockInResultToGroup(`↩️ ${approver.name} ย้อนกลับรายการ "${label}" (${before?.status === 'matched' ? 'เคย Approve' : 'เคยปฏิเสธ'})`)
        } catch (e) {
          if (event.replyToken) await replyMessage(event.replyToken, [{ type: 'text', text: `ทำรายการไม่สำเร็จ: ${e.message}` }])
        }
        continue
      }

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
