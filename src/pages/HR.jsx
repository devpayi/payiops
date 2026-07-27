import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CalendarDays, Check, Clock3, Pencil, Plus, RefreshCw,
  Send, UsersRound, X,
} from 'lucide-react'
import './HR.css'
import LeaveEditPanel from '../components/LeaveEditPanel'
import { canManageOperations } from '../../shared/roles.js'

const API = '/api/sheet-tools?op=hr'
const LEAVE_TYPES = ['พักร้อน', 'ลากิจ', 'ลาป่วย', 'ขาดงาน', 'สลับวันหยุด']
const EMPLOYEE_GROUPS = ['คนแพ็ก', 'คนฟีด', 'พาร์ทไทม์', 'อื่น ๆ', 'ออฟฟิศ']
const NO_VACATION_GROUPS = new Set(['คนฟีด', 'พาร์ทไทม์'])
const PERIOD_OPTIONS = [{ value: 'full', label: 'เต็มวัน' }, { value: 'am', label: 'ครึ่งวันเช้า' }, { value: 'pm', label: 'ครึ่งวันบ่าย' }]
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const thaiYear = new Date().getFullYear() + 543

const STATUS = {
  pending: { label: 'รอพิจารณา', className: 'is-pending' },
  approved: { label: 'อนุมัติแล้ว', className: 'is-approved' },
  rejected: { label: 'ไม่อนุมัติ', className: 'is-rejected' },
  cancelled: { label: 'ยกเลิกแล้ว', className: 'is-rejected' },
}

const formatDate = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  : '—'

const formatDateRange = (leave) => {
  if (leave.leave_type === 'สลับวันหยุด') return `${formatDate(leave.start_date)} → ${formatDate(leave.end_date)}`
  return leave.start_date === leave.end_date ? formatDate(leave.start_date) : `${formatDate(leave.start_date)} – ${formatDate(leave.end_date)}`
}
const periodLabel = (period, days) => PERIOD_OPTIONS.find((item) => item.value === period)?.label || (Number(days) === 0.5 ? 'ครึ่งวัน' : 'เต็มวัน')
const selectionKey = (need, index) => `${need.date}|${need.period}|${index}`
const backupLabel = (leave, people) => (leave.backup_assignments || []).map((item) => {
  const person = people.find((candidate) => candidate.code === item.office_code)
  return `${formatDate(item.date)} ${item.period === 'am' ? 'เช้า' : 'บ่าย'} · ${person?.name || item.office_code}`
}).join(' · ') || (people.find((person) => person.code === leave.backup_office)?.name || leave.backup_office || '')

function StatusBadge({ status }) {
  const item = STATUS[status] || STATUS.pending
  return <span className={`hr-status ${item.className}`}><span aria-hidden="true" />{item.label}</span>
}

function Field({ label, children, className = '' }) {
  return <label className={`hr-field ${className}`}><span>{label}</span>{children}</label>
}

async function readApiResponse(response) {
  try { return await response.json() } catch { return { success: false, error: `HTTP ${response.status}` } }
}

export default function HR() {
  const loadStarted = useRef(false)
  const [authEnabled, setAuthEnabled] = useState(true)
  useEffect(() => { fetch('/api/auth?action=status').then((r) => r.json()).then((d) => setAuthEnabled(!!d.enabled)).catch(() => {}) }, [])
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('payi-user') || 'null') } catch { return null } })()
  const [serverCanManage, setServerCanManage] = useState(false)
  const isBoss = !authEnabled || canManageOperations(currentUser?.role) || serverCanManage

  const [leave, setLeave] = useState([])
  const [people, setPeople] = useState([])
  const [activeMonths, setActiveMonths] = useState({})
  const [leaveBalances, setLeaveBalances] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [leaveForm, setLeaveForm] = useState({ employee_code: '', leave_type: LEAVE_TYPES[0], start_date: today(), end_date: today(), leave_period: 'full', reason: '' })
  const [leaveLock, setLeaveLock] = useState({ locked: false, lockedDates: [], backupNeeds: [], blocked: false, error: '' })
  const [backupSelections, setBackupSelections] = useState({})
  const [empForm, setEmpForm] = useState({ code: '', name: '', group: EMPLOYEE_GROUPS[0] })
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [editEmployees, setEditEmployees] = useState(false)
  const [balanceDrafts, setBalanceDrafts] = useState({})
  const [editingBalanceCode, setEditingBalanceCode] = useState('')
  const [editingLeave, setEditingLeave] = useState(null)
  const [historyFilterCode, setHistoryFilterCode] = useState('')
  const [dayRecords, setDayRecords] = useState([])
  const isSwap = leaveForm.leave_type === 'สลับวันหยุด'
  const selectedEmployee = people.find((person) => person.code === leaveForm.employee_code)
  const availableLeaveTypes = selectedEmployee && NO_VACATION_GROUPS.has(selectedEmployee.group) ? LEAVE_TYPES.filter((type) => type !== 'พักร้อน') : LEAVE_TYPES
  const vacationLeaveBalances = leaveBalances.filter((item) => !NO_VACATION_GROUPS.has(item.group))
  const { employee_code: leaveEmployeeCode, leave_type: leaveType, start_date: leaveStartDate, end_date: leaveEndDate, leave_period: leavePeriod } = leaveForm

  useEffect(() => {
    if (!leaveEmployeeCode) { setLeaveLock({ locked: false, lockedDates: [], backupNeeds: [], blocked: false, error: '' }); setBackupSelections({}); return }
    const timer = setTimeout(() => {
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check-leave-lock', employee_code: leaveEmployeeCode, leave_type: leaveType, start_date: leaveStartDate, end_date: leaveEndDate, leave_period: leavePeriod }) })
        .then((r) => r.json())
        .then((d) => { if (d.success) { setLeaveLock({ locked: !!d.locked, lockedDates: d.lockedDates || [], backupNeeds: d.backupNeeds || [], blocked: !!d.blocked, error: d.coverageError || '' }); setBackupSelections({}) } })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [leaveEmployeeCode, leaveType, leaveStartDate, leaveEndDate, leavePeriod])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(API); const data = await readApiResponse(response)
      if (!response.ok || !data.success) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ')
      setLeave(data.leave || []); setPeople(data.people || []); setActiveMonths(data.activeMonths || {}); setLeaveBalances(data.leaveBalances || []); setServerCanManage(!!data.canManage)
      // โอทีเต็มวัน/ชดเชย — ข้อมูลอยู่คนละ op (workforce) เพราะปฏิทิน Manpower&OT ต้องใช้ร่วมด้วย (โชว์ป้ายชื่อในปฏิทิน)
      fetch('/api/sheet-tools?op=workforce').then((r) => r.json()).then((d) => { if (d.success) setDayRecords(d.dayRecords || []) }).catch(() => {})
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const peopleForMonth = (month) => {
    if (!Object.keys(activeMonths).length) return people
    return people.filter((person) => (activeMonths[person.code] || []).includes(month))
  }
  useEffect(() => { if (loadStarted.current) return; loadStarted.current = true; load() }, [])

  const postAction = async (body, fallbackError) => {
    const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await readApiResponse(response)
    if (!response.ok || !data.success) throw new Error(data.error || fallbackError)
    return data
  }

  const submitLeave = async (event) => {
    event.preventDefault()
    if (leaveLock.blocked) { setError(leaveLock.error || 'ไม่มีคนออฟฟิศว่างเพียงพอ จึงไม่สามารถลาได้'); return }
    // ไม่บังคับเลือกคนแทนครบทุกช่วงแล้ว (ลาได้เสมอ) — ส่งเฉพาะช่องที่เลือกจริง ที่เหลือปล่อยว่างให้ backend คำนวณ understaffed_dates เอง
    const backupAssignments = leaveLock.backupNeeds
      .flatMap((need) => Array.from({ length: need.required }, (_, index) => ({ date: need.date, period: need.period, office_code: backupSelections[selectionKey(need, index)] || '' })))
      .filter((item) => item.office_code)
    setSaving(true); setError('')
    try {
      await postAction({ action: leaveForm.employee_code ? 'request-leave-for' : 'request-leave', ...leaveForm, backup_assignments: backupAssignments }, 'ส่งคำขอไม่สำเร็จ')
      setLeaveForm({ employee_code: '', leave_type: LEAVE_TYPES[0], start_date: today(), end_date: today(), leave_period: 'full', reason: '' })
      setLeaveLock({ locked: false, lockedDates: [], backupNeeds: [], blocked: false, error: '' }); setBackupSelections({}); await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const addEmployee = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await postAction({ action: 'add-employee', ...empForm }, 'เพิ่มพนักงานไม่สำเร็จ')
      setEmpForm({ code: '', name: '', group: EMPLOYEE_GROUPS[0] }); setShowAddEmployee(false); await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const editEmployeeGroup = async (code, group) => {
    setSaving(true); setError('')
    try { await postAction({ action: 'edit-employee-group', code, group }, 'แก้กลุ่มไม่สำเร็จ'); await load() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const setLeaveBalance = async (item) => {
    const remaining = Number(balanceDrafts[item.code] ?? item.remaining)
    setSaving(true); setError('')
    try { await postAction({ action: 'set-leave-balance', code: item.code, remaining }, 'แก้ยอดคงเหลือไม่สำเร็จ'); setBalanceDrafts((current) => ({ ...current, [item.code]: remaining })); setEditingBalanceCode(''); await load() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const removeEmployee = async (code, group, name) => {
    if (!window.confirm(`ลบ ${name} ออกจากรายชื่อพนักงานใช่ไหม? (ประวัติการลาเดิมยังอยู่)`)) return
    setSaving(true); setError('')
    try { await postAction({ action: 'remove-employee', code, group }, 'ลบไม่สำเร็จ'); await load() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const decideLeave = async (id, decision) => {
    setSaving(true); setError('')
    try { await postAction({ action: 'decide-leave', id, decision }, 'บันทึกไม่สำเร็จ'); await load() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const cancelLeave = async (id) => {
    if (!window.confirm('ยกเลิกคำขอลานี้ใช่ไหม?')) return
    setSaving(true); setError('')
    try { await postAction({ action: 'cancel-leave', id }, 'ยกเลิกไม่สำเร็จ'); await load() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const myLeave = isBoss ? leave : leave.filter((item) => item.username === currentUser?.u)
  const visibleLeave = isBoss && historyFilterCode ? myLeave.filter((item) => item.username === `mp:${historyFilterCode}`) : myLeave
  const pendingLeave = leave.filter((item) => item.status === 'pending' || item.edit_pending === '1')
  const approvedThisMonth = leave.filter((item) => item.status === 'approved' && String(item.start_date).slice(0, 7) === today().slice(0, 7)).length
  const peopleOnLeaveToday = leave.filter((item) => item.status === 'approved' && item.leave_type !== 'สลับวันหยุด' && item.start_date <= today() && item.end_date >= today()).length

  return (
    <main className="hr-page" id="main-content">
      <header className="hr-page-header" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
        <h1 style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>จัดการวันลา</h1>
        <button className="hr-icon-button" onClick={load} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล"><RefreshCw size={18} /></button>
      </header>

      {error && <div className="hr-alert is-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}

      <section className="hr-metrics" aria-label="ภาพรวมวันลา">
        <article className="hr-metric is-emphasis"><div className="hr-metric-icon"><Clock3 size={20} /></div><div><span>รออนุมัติ</span><strong>{pendingLeave.length}</strong><small>รายการที่ต้องจัดการ</small></div></article>
        <article className="hr-metric"><div className="hr-metric-icon"><CalendarDays size={20} /></div><div><span>ลาวันนี้</span><strong>{peopleOnLeaveToday}</strong><small>คนที่อนุมัติแล้ว</small></div></article>
        <article className="hr-metric"><div className="hr-metric-icon"><Check size={20} /></div><div><span>อนุมัติเดือนนี้</span><strong>{approvedThisMonth}</strong><small>รายการ</small></div></article>
        <article className="hr-metric"><div className="hr-metric-icon"><UsersRound size={20} /></div><div><span>พนักงานในระบบ</span><strong>{people.length}</strong><small>คน</small></div></article>
      </section>

      {!!vacationLeaveBalances.length && <section className="hr-panel" aria-labelledby="balance-heading">
        <div className="hr-section-heading hr-balance-heading">
          <div><span className="hr-section-kicker">โควตาปี {thaiYear}</span><h2 id="balance-heading">วันลาพักร้อนคงเหลือ</h2></div>
          {isBoss && <div className="hr-toolbar"><button className={`hr-button is-secondary ${editEmployees ? 'is-active' : ''}`} onClick={() => setEditEmployees((value) => !value)}><Pencil size={16} />{editEmployees ? 'เสร็จแล้ว' : 'จัดการพนักงาน'}</button><button className="hr-button is-secondary" onClick={() => setShowAddEmployee((value) => !value)}><Plus size={17} />{showAddEmployee ? 'ปิด' : 'เพิ่มพนักงาน'}</button></div>}
        </div>
        {isBoss && showAddEmployee && <form className="hr-add-employee" onSubmit={addEmployee}>
          <Field label="รหัส"><input value={empForm.code} onChange={(e) => setEmpForm({ ...empForm, code: e.target.value })} placeholder="เช่น TANG" required /></Field>
          <Field label="ชื่อ"><input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} placeholder="ชื่อพนักงาน" required /></Field>
          <Field label="กลุ่ม"><select value={empForm.group} onChange={(e) => setEmpForm({ ...empForm, group: e.target.value })}>{EMPLOYEE_GROUPS.map((group) => <option key={group}>{group}</option>)}</select></Field>
          <button className="hr-button is-primary" disabled={saving}><Plus size={17} />เพิ่ม</button>
        </form>}
        <div className="hr-balance-groups">{[
          { key: 'lower', label: 'บ้านล่าง', rows: vacationLeaveBalances.filter((item) => item.group !== 'ออฟฟิศ') },
          { key: 'office', label: 'ออฟฟิศ', rows: vacationLeaveBalances.filter((item) => item.group === 'ออฟฟิศ') },
        ].filter((group) => group.rows.length).map((group) => <div className="hr-balance-group" key={group.key}><h3>{group.label}<span>{group.rows.length} คน</span></h3><div className="hr-balance-grid">{group.rows.map((item) => {
          const percentage = item.quota > 0 ? Math.max(0, Math.min(100, (item.remaining / item.quota) * 100)) : 0
          return <article className={`hr-balance-card ${item.remaining <= 0 ? 'is-empty' : ''}`} key={item.code}>
            <div className="hr-balance-card-top"><div className="hr-avatar is-small" aria-hidden="true">{item.name?.trim().slice(0, 1) || '?'}</div><div><strong>{item.name}</strong><span>{item.group}</span></div>{isBoss && <div className="hr-balance-card-actions"><button type="button" className={`hr-balance-pencil ${editingBalanceCode === item.code ? 'is-active' : ''}`} onClick={() => setEditingBalanceCode((code) => code === item.code ? '' : item.code)} aria-label={`แก้วันลาคงเหลือของ ${item.name}`} title="แก้วันลาคงเหลือ"><Pencil size={14} /></button>{editEmployees && <button className="hr-remove-button" onClick={() => removeEmployee(item.code, item.group, item.name)} aria-label={`ลบ ${item.name}`}><X size={15} /></button>}</div>}</div>
            <div className="hr-balance-value"><strong>{item.remaining}</strong><span>/ {item.quota} วัน</span></div>
            <div className="hr-progress" aria-label={`เหลือ ${item.remaining} จาก ${item.quota} วัน`}><span style={{ width: `${percentage}%` }} /></div>
            {isBoss && (editEmployees || editingBalanceCode === item.code) && <div className="hr-balance-edit"><input type="number" min="0" max="365" step="0.5" aria-label={`วันลาคงเหลือของ ${item.name}`} value={balanceDrafts[item.code] ?? item.remaining} onChange={(e) => setBalanceDrafts((current) => ({ ...current, [item.code]: e.target.value }))} /><button type="button" disabled={saving} onClick={() => setLeaveBalance(item)} aria-label={`บันทึกยอดของ ${item.name}`}><Check size={15} /></button></div>}
            {isBoss && editEmployees && <select aria-label={`กลุ่มของ ${item.name}`} value={item.group} onChange={(e) => editEmployeeGroup(item.code, e.target.value)}>{EMPLOYEE_GROUPS.map((value) => <option key={value}>{value}</option>)}</select>}
          </article>
        })}</div></div>)}</div>
      </section>}

      {isBoss && <section className="hr-panel hr-approval-panel" aria-labelledby="pending-heading">
        <div className="hr-section-heading">
          <div><span className="hr-section-kicker">งานที่ต้องทำก่อน</span><h2 id="pending-heading">คิวรออนุมัติ</h2></div>
          <span className="hr-count-pill">{pendingLeave.length} รายการ</span>
        </div>
        {loading ? <div className="hr-empty">กำลังโหลดข้อมูล…</div> : !pendingLeave.length ? (
          <div className="hr-empty is-success"><span><Check size={22} /></span><strong>จัดการครบแล้ว</strong><p>ไม่มีคำขอลาที่รออนุมัติ</p></div>
        ) : <div className="hr-approval-grid">{pendingLeave.map((rawItem) => { const item = rawItem.edit_proposal || rawItem; return (
          <article className="hr-request-card" key={rawItem.id}>
            <div className="hr-request-top">
              <div className="hr-avatar" aria-hidden="true">{item.employee_name?.trim().slice(0, 1) || '?'}</div>
              <div className="hr-request-person"><strong>{item.employee_name}</strong><span>{item.leave_type}</span></div>
              <StatusBadge status="pending" />
            </div>
            <div className="hr-request-facts">
              <div><CalendarDays size={16} /><span>วันที่</span><strong>{formatDateRange(item)}</strong></div>
              <div><Clock3 size={16} /><span>จำนวน</span><strong>{item.days} วัน</strong></div>
            </div>
            {item.understaffed_dates && <p className="hr-edit-request-pill" style={{ background: '#fff1f2', color: '#be123c' }}><AlertTriangle size={13} /> คนไม่พอวันที่ {item.understaffed_dates.split(',').join(', ')} — ต้องหาคนแทน</p>}
            {(item.reason || item.backup_office || item.backup_assignments?.length) && <div className="hr-request-note">
              {item.reason && <p><span>เหตุผล</span>{item.reason}</p>}
              {(item.backup_office || item.backup_assignments?.length) && <p><span>คนทดแทน</span>{backupLabel(item, people)}</p>}
            </div>}
            <div className="hr-request-actions">
              <button className="hr-button is-reject" disabled={saving} onClick={() => decideLeave(rawItem.id, 'rejected')}><X size={17} />ไม่อนุมัติ</button>
              <button className="hr-button is-approve" disabled={saving} onClick={() => decideLeave(rawItem.id, 'approved')}><Check size={17} />{rawItem.edit_pending === '1' ? 'ยืนยันการแก้ไข' : 'อนุมัติ'}</button>
            </div>
          </article>
        )})}</div>}
      </section>}

      <div className="hr-workspace-grid">
        <section className="hr-panel" aria-labelledby="history-heading">
          <div className="hr-section-heading">
            <div><span className="hr-section-kicker">ประวัติ</span><h2 id="history-heading">{isBoss ? 'คำขอลาทั้งหมด' : 'คำขอลาของฉัน'}</h2></div>
            {isBoss && people.length > 0 && <select aria-label="กรองตามพนักงาน" value={historyFilterCode} onChange={(e) => setHistoryFilterCode(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">ทุกคน</option>
              {people.map((person) => <option key={person.code} value={person.code}>{person.name}{person.group ? ` · ${person.group}` : ''}</option>)}
            </select>}
          </div>
          {loading ? <div className="hr-empty">กำลังโหลดข้อมูล…</div> : !visibleLeave.length ? <div className="hr-empty">ยังไม่มีคำขอลา</div> : (
            <div className="hr-history-list">{visibleLeave.slice().reverse().map((item) => (
              <article className="hr-history-row" key={item.id}>
                <div className="hr-history-main"><strong>{item.employee_name}</strong><span>{item.leave_type} · {formatDateRange(item)} · {periodLabel(item.leave_period, item.days)}</span>{item.edit_pending === '1' && <span className="hr-edit-request-pill">มีข้อมูลแก้ไขรอ HR ยืนยัน</span>}{item.understaffed_dates && !['rejected', 'cancelled'].includes(item.status) && <span className="hr-edit-request-pill" style={{ background: '#fff1f2', color: '#be123c' }}>คนไม่พอ — ต้องหาคนแทน</span>}</div>
                <div className="hr-history-days">{item.days}<span>วัน</span></div>
                <StatusBadge status={item.status} />
                <div className="hr-history-actions">{(isBoss || (item.username === currentUser?.u && !['rejected', 'cancelled'].includes(item.status))) && <button className="hr-history-edit" onClick={() => setEditingLeave(item)} aria-label={`แก้ไขรายการของ ${item.employee_name}`}><Pencil size={15} /></button>}{item.status === 'pending' && (item.username === currentUser?.u || isBoss) && <button className="hr-text-button is-danger" onClick={() => cancelLeave(item.id)}>ยกเลิก</button>}</div>
              </article>
            ))}</div>
          )}
        </section>

        <aside className="hr-panel hr-form-panel" aria-labelledby="request-heading">
          <div className="hr-section-heading"><div><span className="hr-section-kicker">งานด่วน</span><h2 id="request-heading">ยื่นคำขอลา</h2></div><Send size={20} /></div>
          <form className="hr-form" onSubmit={submitLeave}>
            {isBoss && people.length > 0 && <Field label={`ยื่นแทนพนักงาน · ${leaveForm.start_date.slice(0, 7)}`}>
              <select value={leaveForm.employee_code} onChange={(e) => { const employee_code = e.target.value; const person = people.find((item) => item.code === employee_code); const leave_type = person && NO_VACATION_GROUPS.has(person.group) && leaveForm.leave_type === 'พักร้อน' ? 'ลากิจ' : leaveForm.leave_type; setLeaveForm({ ...leaveForm, employee_code, leave_type }); if (!employee_code) setLeaveLock({ locked: false, lockedDates: [], backupNeeds: [], blocked: false, error: '' }) }}>
                <option value="">— ตัวเอง —</option>
                {peopleForMonth(leaveForm.start_date.slice(0, 7)).map((person) => <option key={person.code} value={person.code}>{person.name}{person.group ? ` · ${person.group}` : ''}</option>)}
              </select>
            </Field>}
            <Field label="ประเภทการลา"><select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value, leave_period: e.target.value === 'สลับวันหยุด' ? 'full' : leaveForm.leave_period })}>{availableLeaveTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <div className="hr-form-columns">
              <Field label={isSwap ? 'วันหยุดเดิม' : 'วันเริ่ม'}><input type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value, end_date: leaveForm.leave_period === 'full' ? leaveForm.end_date : e.target.value })} required /></Field>
              <Field label={isSwap ? 'วันหยุดใหม่' : 'วันสิ้นสุด'}><input type="date" value={leaveForm.leave_period === 'full' ? leaveForm.end_date : leaveForm.start_date} min={isSwap ? undefined : leaveForm.start_date} disabled={!isSwap && leaveForm.leave_period !== 'full'} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })} required /></Field>
            </div>
            {!isSwap && <Field label="ช่วงเวลา"><select value={leaveForm.leave_period} onChange={(e) => setLeaveForm({ ...leaveForm, leave_period: e.target.value, end_date: e.target.value === 'full' ? leaveForm.end_date : leaveForm.start_date })}>{PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>}
            <Field label="เหตุผล · ไม่บังคับ"><input value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="เพิ่มรายละเอียดสั้น ๆ" /></Field>
            {leaveLock.locked && <div className={`hr-alert ${leaveLock.blocked ? 'is-error' : 'is-warning'}`}><AlertTriangle size={18} /><div><strong>{leaveLock.blocked ? 'วันนี้ลาไม่ได้' : 'ต้องมีคนออฟฟิศทดแทน'}</strong><span>{leaveLock.error || `กำลังคนต่ำกว่า 3 คนในวันที่ ${leaveLock.lockedDates.join(', ')}`}</span>{!leaveLock.blocked && leaveLock.backupNeeds.flatMap((need) => Array.from({ length: need.required }, (_, index) => {
              const key = selectionKey(need, index); const selectedCodes = Array.from({ length: need.required }, (__, siblingIndex) => backupSelections[selectionKey(need, siblingIndex)]).filter(Boolean)
              return <Field key={key} label={`${formatDate(need.date)} · ${need.period === 'am' ? 'ช่วงเช้า' : 'ช่วงบ่าย'}${need.required > 1 ? ` · คนที่ ${index + 1}` : ''}`}><select value={backupSelections[key] || ''} onChange={(e) => setBackupSelections((current) => ({ ...current, [key]: e.target.value }))}><option value="">{need.candidates.length ? 'เลือกคนที่ว่าง (ไม่บังคับ)' : 'ไม่มีคนว่าง — ลาได้ แต่ HR ต้องหาคนแทนภายหลัง'}</option>{need.candidates.filter((candidate) => candidate.code === backupSelections[key] || !selectedCodes.includes(candidate.code)).map((candidate) => <option key={candidate.code} value={candidate.code}>{candidate.name}</option>)}</select></Field>
            }))}</div></div>}
            <button className="hr-button is-primary" disabled={saving || leaveLock.blocked}><Send size={17} />{saving ? 'กำลังบันทึก…' : leaveLock.blocked ? 'ไม่มีคนทดแทน' : 'ส่งคำขอลา'}</button>
          </form>
        </aside>
      </div>

      {isBoss && <DayRecordsPanel dayRecords={dayRecords} names={[...new Set(people.map((p) => p.name).filter(Boolean))]} setError={setError} onSaved={load} />}

      {editingLeave && <LeaveEditPanel leave={editingLeave} people={people} isAdmin={isBoss} onClose={() => setEditingLeave(null)} onSaved={async () => { setEditingLeave(null); await load() }} />}

    </main>
  )
}

// โอทีเต็มวัน (มาทำวันหยุด/นักขัตฤกษ์) หรือมาชดเชยเฉยๆไม่รับโอที — ย้ายมาไว้ที่ HR (เดิมอยู่ Manpower&OT)
// สลับวันหยุด ("จากวันไหนไปวันไหน") ทำผ่านระบบลาด้านบน (leave_type 'สลับวันหยุด') ไม่ได้อยู่ที่นี่
// ข้อมูลอยู่คนละ sheet/op (workforce_dayrecords ผ่าน op=workforce) เพราะปฏิทิน Manpower&OT ต้องอ่านไปโชว์ป้ายชื่อในปฏิทินด้วย
function DayRecordsPanel({ dayRecords = [], names = [], setError, onSaved }) {
  const [form, setForm] = useState({ date: today(), kind: 'ot_full', reason: '', note: '', paid_ot: true })
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)

  const add = async (e) => {
    e.preventDefault()
    if (!selected.length) return setError('เลือกอย่างน้อย 1 คน')
    setSaving(true); setError('')
    try {
      const r = await fetch('/api/sheet-tools?op=workforce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-dayrecord', employees: selected, date: form.date, kind: form.kind, reason: form.reason, paid_ot: form.paid_ot, note: form.note }) })
      const d = await readApiResponse(r); if (!r.ok || !d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      setSelected([]); setForm({ ...form, reason: '', note: '' })
      await onSaved()
    } catch (e2) { setError(e2.message) } finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!window.confirm('ลบรายการนี้ใช่ไหม?')) return
    setError('')
    try {
      const r = await fetch('/api/sheet-tools?op=workforce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-dayrecord', id }) })
      const d = await readApiResponse(r); if (!r.ok || !d.success) throw new Error(d.error || 'ลบไม่สำเร็จ')
      await onSaved()
    } catch (e) { setError(e.message) }
  }

  const kindLabel = (kind) => kind === 'ot_full' ? 'โอทีเต็มวัน' : 'ชดเชยเฉยๆ'

  return (
    <section className="hr-panel" aria-labelledby="dayrecord-heading">
      <div className="hr-section-heading"><div><span className="hr-section-kicker">Manpower</span><h2 id="dayrecord-heading">โอทีเต็มวัน / มาชดเชย</h2></div></div>
      <div style={{ fontSize: 12, color: 'var(--payi-text-muted, #64748b)', marginTop: -6, marginBottom: 14 }}>ใช้กับกรณีมาทำงานเต็มวันในวันหยุดตัวเอง/วันนักขัตฤกษ์ — ชื่อจะขึ้นป้ายในปฏิทิน Manpower&amp;OT ด้วย</div>
      <form onSubmit={add} className="hr-form" style={{ marginBottom: 18 }}>
        <div className="hr-form-columns">
          <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Field>
          <Field label="ประเภท"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="ot_full">โอทีเต็มวัน</option><option value="comp">มาชดเชยเฉยๆ (ไม่รับโอที)</option></select></Field>
        </div>
        <div className="hr-form-columns">
          <Field label="เหตุผล"><select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}><option value="">— ไม่ระบุ —</option><option value="วันนักขัตฤกษ์">วันนักขัตฤกษ์</option><option value="วันหยุดตัวเอง">วันหยุดตัวเอง</option><option value="อื่น ๆ">อื่น ๆ</option></select></Field>
          {form.kind === 'ot_full' && <Field label="รับโอทีไหม"><select value={form.paid_ot ? '1' : '0'} onChange={(e) => setForm({ ...form, paid_ot: e.target.value === '1' })}><option value="1">รับโอที</option><option value="0">ไม่รับโอที</option></select></Field>}
        </div>
        <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="เช่น หยุดตัวเองชนวันนักขัต ได้หยุด 2 วัน" /></Field>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted, #64748b)', marginBottom: 8 }}>เลือกคน · {selected.length} คน</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{names.map((name) => { const on = selected.includes(name); return <button type="button" key={name} onClick={() => setSelected(on ? selected.filter((n) => n !== name) : [...selected, name])} style={{ border: `1px solid ${on ? '#5ca8df' : '#cbd5e1'}`, background: on ? '#e9f5ff' : '#fff', color: on ? '#155f98' : '#64748b', borderRadius: 999, padding: '7px 12px', fontWeight: 800, cursor: 'pointer', fontSize: 12.5 }}>{on ? '✓ ' : ''}{name}</button> })}</div>
        </div>
        <button className="hr-button is-primary" disabled={saving || !selected.length}>{saving ? 'กำลังบันทึก…' : `บันทึก ${selected.length} คน`}</button>
      </form>
      {!dayRecords.length ? <div className="hr-empty">ยังไม่มีรายการ</div> : (
        <div className="hr-history-list">{dayRecords.map((r) => (
          <article className="hr-history-row" key={r.id}>
            <div className="hr-history-main"><strong>{r.employee}</strong><span>{kindLabel(r.kind)} · {r.date}{r.reason ? ` · ${r.reason}` : ''}{r.note ? ` · ${r.note}` : ''}</span></div>
            <button className="hr-text-button is-danger" onClick={() => remove(r.id)}>ลบ</button>
          </article>
        ))}</div>
      )}
    </section>
  )
}
