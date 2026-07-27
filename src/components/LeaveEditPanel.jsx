import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Pencil, X } from 'lucide-react'

const API = '/api/sheet-tools?op=hr'
const LEAVE_TYPES = ['พักร้อน', 'ลากิจ', 'ลาป่วย', 'ขาดงาน', 'สลับวันหยุด']
const PERIODS = [{ value: 'full', label: 'เต็มวัน' }, { value: 'am', label: 'ครึ่งวันเช้า' }, { value: 'pm', label: 'ครึ่งวันบ่าย' }]
const ACTIVE_STATUSES = new Set(['pending', 'approved'])
const selectionKey = (need, index) => `${need.date}|${need.period}|${index}`

const initialForm = (leave) => {
  const source = leave.edit_proposal || leave
  return {
    leave_type: source.leave_type,
    start_date: source.start_date,
    end_date: source.end_date,
    leave_period: source.leave_period || (Number(source.days) === 0.5 ? 'am' : 'full'),
    reason: source.reason || '',
    status: leave.status,
    decision_note: leave.decision_note || '',
  }
}

async function readResponse(response) {
  try { return await response.json() } catch { return { success: false, error: `HTTP ${response.status}` } }
}

export default function LeaveEditPanel({ leave, people = [], isAdmin, onClose, onSaved }) {
  const [form, setForm] = useState(() => initialForm(leave))
  const [coverage, setCoverage] = useState({ locked: false, blocked: false, backupNeeds: [], error: '' })
  const [selections, setSelections] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const employeeCode = String(leave.username || '').startsWith('mp:') ? leave.username.slice(3) : ''
  const employee = people.find((person) => person.code === employeeCode)
  const isSwap = form.leave_type === 'สลับวันหยุด'
  const needsCoverage = ACTIVE_STATUSES.has(form.status)

  useEffect(() => {
    if (!employeeCode || !needsCoverage) { setCoverage({ locked: false, blocked: false, backupNeeds: [], error: '' }); setSelections({}); return }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check-leave-lock', employee_code: employeeCode, exclude_leave_id: leave.id, ...form }),
        })
        const data = await readResponse(response)
        if (data.success) {
          setCoverage({ locked: !!data.locked, blocked: !!data.blocked, backupNeeds: data.backupNeeds || [], error: data.coverageError || '' })
          setSelections({})
        }
      } catch { setError('ตรวจสอบกำลังคนไม่สำเร็จ กรุณาลองใหม่ค่ะ') }
    }, 250)
    return () => clearTimeout(timer)
  }, [employeeCode, form.leave_type, form.start_date, form.end_date, form.leave_period, form.status, leave.id, needsCoverage])

  const assignments = useMemo(() => coverage.backupNeeds.flatMap((need) =>
    Array.from({ length: need.required }, (_, index) => ({ date: need.date, period: need.period, office_code: selections[selectionKey(need, index)] || '' }))), [coverage.backupNeeds, selections])

  const submit = async (event) => {
    event.preventDefault()
    if (coverage.blocked) { setError(coverage.error || 'ไม่มีคนออฟฟิศว่างเพียงพอค่ะ'); return }
    if (needsCoverage && assignments.some((item) => !item.office_code)) { setError('กรุณาเลือกคนออฟฟิศทดแทนให้ครบค่ะ'); return }
    setSaving(true); setError('')
    try {
      const response = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isAdmin ? 'admin-update-leave' : 'request-leave-edit', id: leave.id, ...form, backup_assignments: assignments }),
      })
      const data = await readResponse(response)
      if (!response.ok || !data.success) {
        if (data.backupNeeds) setCoverage({ locked: true, blocked: !!data.blocked, backupNeeds: data.backupNeeds, error: data.error || '' })
        throw new Error(data.error || 'แก้ไขรายการไม่สำเร็จ')
      }
      await onSaved()
    } catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }

  return <div className="hr-edit-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="hr-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-edit-title">
      <div className="hr-edit-title"><div><span>{isAdmin ? 'แก้ไขโดย HR' : 'ส่งให้ HR ยืนยันอีกครั้ง'}</span><h2 id="leave-edit-title"><Pencil size={18} /> แก้ไขวันลาของ {leave.employee_name}</h2></div><button type="button" onClick={onClose} aria-label="ปิด"><X size={19} /></button></div>
      <form className="hr-edit-form" onSubmit={submit}>
        {employee && <div className="hr-edit-person">{employee.name}<span>{employee.group}</span></div>}
        <label><span>ประเภทการลา</span><select value={form.leave_type} onChange={(event) => setForm({ ...form, leave_type: event.target.value, leave_period: event.target.value === 'สลับวันหยุด' ? 'full' : form.leave_period })}>{LEAVE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <div className="hr-edit-columns">
          <label><span>{isSwap ? 'วันหยุดเดิม' : 'วันเริ่ม'}</span><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value, end_date: form.leave_period === 'full' ? form.end_date : event.target.value })} required /></label>
          <label><span>{isSwap ? 'วันหยุดใหม่' : 'วันสิ้นสุด'}</span><input type="date" value={form.leave_period === 'full' ? form.end_date : form.start_date} min={isSwap ? undefined : form.start_date} disabled={!isSwap && form.leave_period !== 'full'} onChange={(event) => setForm({ ...form, end_date: event.target.value })} required /></label>
        </div>
        {!isSwap && <label><span>ช่วงเวลา</span><select value={form.leave_period} onChange={(event) => setForm({ ...form, leave_period: event.target.value, end_date: event.target.value === 'full' ? form.end_date : form.start_date })}>{PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}</select></label>}
        <label><span>เหตุผล / หมายเหตุ</span><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="ระบุสั้น ๆ เพื่อให้ HR ตรวจสอบ" /></label>
        {isAdmin && <><label><span>สถานะรายการ</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="pending">รออนุมัติ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ไม่อนุมัติ</option><option value="cancelled">ยกเลิก / ไม่ลาแล้ว</option></select></label><label><span>บันทึกของ HR</span><input value={form.decision_note} onChange={(event) => setForm({ ...form, decision_note: event.target.value })} placeholder="เช่น พนักงานแจ้งว่าไม่ลาแล้ว" /></label></>}
        {coverage.locked && <div className={`hr-edit-coverage ${coverage.blocked ? 'is-blocked' : ''}`}><AlertTriangle size={17} /><div><strong>{coverage.blocked ? 'บันทึกไม่ได้' : 'ต้องเลือกคนออฟฟิศทดแทน'}</strong><p>{coverage.error || 'กำลังคนบ้านล่างจะต่ำกว่า 3 คน'}</p>{!coverage.blocked && coverage.backupNeeds.flatMap((need) => Array.from({ length: need.required }, (_, index) => {
          const key = selectionKey(need, index)
          const selectedCodes = Array.from({ length: need.required }, (__, sibling) => selections[selectionKey(need, sibling)]).filter(Boolean)
          return <label key={key}><span>{need.date} · {need.period === 'am' ? 'ช่วงเช้า' : 'ช่วงบ่าย'}{need.required > 1 ? ` · คนที่ ${index + 1}` : ''}</span><select value={selections[key] || ''} onChange={(event) => setSelections((current) => ({ ...current, [key]: event.target.value }))}><option value="">{need.candidates.length ? 'เลือกคนที่ว่าง (ไม่บังคับ)' : 'ไม่มีคนว่าง — บันทึกได้ แต่ HR ต้องหาคนแทนภายหลัง'}</option>{need.candidates.filter((candidate) => candidate.code === selections[key] || !selectedCodes.includes(candidate.code)).map((candidate) => <option key={candidate.code} value={candidate.code}>{candidate.name}</option>)}</select></label>
        }))}</div></div>}
        {error && <div className="hr-edit-error" role="alert">{error}</div>}
        {!isAdmin && <p className="hr-edit-help">รายการเดิมยังมีผลจนกว่า HR จะอนุมัติข้อมูลใหม่ค่ะ</p>}
        <div className="hr-edit-actions"><button type="button" onClick={onClose}>ยกเลิก</button><button type="submit" disabled={saving || coverage.blocked}><Check size={17} />{saving ? 'กำลังบันทึก…' : isAdmin ? 'บันทึกทันที' : 'ส่งให้ HR ยืนยัน'}</button></div>
      </form>
    </section>
  </div>
}
