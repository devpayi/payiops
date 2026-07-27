import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Plus, RefreshCw, UserRoundPen, X } from 'lucide-react'
import { canManageOperations } from '../../shared/roles.js'

const API = '/api/sheet-tools?op=workforce'
const MANPOWER_CACHE_KEY = 'payi-manpower-today-cache'
const DEFAULT_NAMES = ['แตง', 'แป้ง', 'มี่', 'ฟ้า', 'ป้า', 'อื่น ๆ']
const PROMO_TITLE_OPTIONS = ['วันโปร', '7.7', '8.8', '9.9', '10.10', '11.11', '12.12', 'เงินเดือนออก', 'เทศกาล/วันหยุดยาว', 'เติมสต็อกล่วงหน้า']
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const fmtMinutes = (value) => {
  const n = Number(value) || 0
  const h = Math.floor(n / 60); const m = n % 60
  return h ? `${h} ชม.${m ? ` ${m} นาที` : ''}` : `${m} นาที`
}
const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #cfe0f3', borderRadius: 10, padding: '10px 12px', background: '#fff', color: '#0f172a', fontSize: 13, outline: 'none' }
const card = { background: '#fff', border: '1px solid #dce9f7', borderRadius: 16, boxShadow: '0 10px 28px rgba(30, 64, 175, .05)' }

export default function WorkforceOT({ preview = false }) {
  const loadStarted = useRef(false)
  const [authEnabled, setAuthEnabled] = useState(true)
  useEffect(() => { fetch('/api/auth?action=status').then((r) => r.json()).then((d) => setAuthEnabled(!!d.enabled)).catch(() => {}) }, [])
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('payi-user') || 'null') } catch { return null } })()
  const isBoss = preview || !authEnabled || canManageOperations(currentUser?.role)
  const [rows, setRows] = useState([])
  const [manpower, setManpower] = useState([])
  const [events, setEvents] = useState([])
  const [history, setHistory] = useState([])
  const [approvals, setApprovals] = useState([])
  const [approvalHistory, setApprovalHistory] = useState([])
  const [dayRecords, setDayRecords] = useState([])
  const [people, setPeople] = useState([])
  const [schedulePeople, setSchedulePeople] = useState([])
  const [officePeople, setOfficePeople] = useState([])
  const [officeAbsences, setOfficeAbsences] = useState([])
  const groupByName = useMemo(() => Object.fromEntries(people.filter((p) => p.name).map((p) => [p.name, p.group])), [people])
  // คนที่ถูกลบออกแล้ว (active='0') — กันไม่ให้โผล่ในตัวเลือก "เพิ่มคน OT ใหม่" อีก แม้ชื่อจะยังค้างในประวัติเดิม
  const inactiveNames = useMemo(() => new Set(people.filter((p) => p.name && String(p.active) === '0').map((p) => p.name)), [people])
  const [sourceStatus, setSourceStatus] = useState({ state: 'loading', count: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('calendar')
  const [names, setNames] = useState(DEFAULT_NAMES)
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState(DEFAULT_NAMES)
  const [form, setForm] = useState({ date: today(), team: 'บ้านล่าง', task: 'แพ็ก', planned_start: '17:30', planned_end: '20:00', reason: 'ออเดอร์เยอะ', note: '' })
  const [edits, setEdits] = useState({})
  const [otLimits, setOtLimitsState] = useState(() => { try { return JSON.parse(localStorage.getItem('payi-ot-limits-preview') || '{}') } catch { return {} } })
  const saveOtLimit = async (employee, limitHours) => {
    setOtLimitsState((prev) => ({ ...prev, [employee]: limitHours }))
    if (preview) { localStorage.setItem('payi-ot-limits-preview', JSON.stringify({ ...otLimits, [employee]: limitHours })); return }
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-ot-limit', employee, limit_hours: limitHours }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'บันทึกลิมิตไม่สำเร็จ')
      setOtLimitsState(d.otLimits || {})
    } catch (e) { setError(e.message) }
  }

  const load = async () => {
    setLoading(true); setError('')
    try {
      if (preview) {
        const loadedRows = JSON.parse(localStorage.getItem('payi-ot-preview') || '[]')
        const loadedManpower = JSON.parse(localStorage.getItem('payi-manpower-preview') || '[]')
        const loadedEvents = JSON.parse(localStorage.getItem('payi-events-preview') || '[]')
        const loadedHistory = JSON.parse(localStorage.getItem('payi-ot-history-preview') || '[]')
        const loadedApprovals = JSON.parse(localStorage.getItem('payi-ot-approvals-preview') || '[]')
        let sourceManpower = []
        try { const r = await fetch(`${API}&sourceOnly=1`); const d = await r.json(); if (r.ok) { sourceManpower = d.sourceManpower || []; localStorage.setItem(MANPOWER_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows: sourceManpower })); setSourceStatus({ state: 'ok', count: sourceManpower.length }) } else setSourceStatus({ state: 'error', count: 0 }) } catch { setSourceStatus({ state: 'error', count: 0 }) }
        setRows(loadedRows); setManpower([...sourceManpower, ...loadedManpower]); setEvents(loadedEvents); setHistory(loadedHistory); setApprovals(loadedApprovals); setNames((current) => [...new Set([...current, ...loadedRows.map((row) => row.employee).filter(Boolean), ...sourceManpower.map((row) => row.employee).filter(Boolean), ...loadedManpower.map((row) => row.employee).filter(Boolean)])]); return
      }
      const r = await fetch(API); const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'โหลดข้อมูลไม่สำเร็จ')
      const loadedRows = d.rows || []
      setRows(loadedRows)
      setManpower(d.sourceManpower || [])
      localStorage.setItem(MANPOWER_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows: d.sourceManpower || [] }))
      setEvents(d.events || [])
      setHistory(d.history || [])
      setApprovals(d.approvals || [])
      setApprovalHistory(d.approvalHistory || [])
      setDayRecords(d.dayRecords || [])
      setPeople(d.people || [])
      setSchedulePeople(d.schedulePeople?.length ? d.schedulePeople : (d.people || []).filter((person) => String(person.active) !== '0' && person.code && person.name))
      setOfficePeople(d.officePeople || [])
      setOfficeAbsences(d.officeAbsences || [])
      setOtLimitsState(d.otLimits || {})
      setSourceStatus({ state: d.sourceManpower?.length ? 'ok' : 'error', count: d.sourceManpower?.length || 0 })
      setNames((current) => [...new Set([...current, ...loadedRows.map((row) => row.employee).filter(Boolean), ...(d.sourceManpower || []).map((row) => row.employee).filter(Boolean), ...(d.manpower || []).map((row) => row.employee).filter(Boolean)])])
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (loadStarted.current) return; loadStarted.current = true; load() }, [])

  const planned = useMemo(() => rows.filter((r) => r.status === 'planned'), [rows])
  const completed = useMemo(() => rows.filter((r) => r.status === 'completed'), [rows])
  const totalPlanned = rows.reduce((s, r) => s + Number(r.planned_minutes || 0), 0)
  const totalActual = completed.reduce((s, r) => s + Number(r.actual_minutes || 0), 0)
  const dates = useMemo(() => [...new Set(rows.map((r) => r.date).filter(Boolean))].sort().reverse().slice(0, 14), [rows])

  const pendingApprovals = useMemo(() => {
    if (!isBoss) return []
    const thisMonth = today().slice(0, 7)
    const [y, m] = thisMonth.split('-').map(Number)
    const prevDate = new Date(y, m - 2, 1)
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    const pending = []
    for (const mo of [prevMonth, thisMonth]) {
      for (const p of groupOtByEmployee(rows, mo)) {
        if (!approvals.some((a) => a.month === mo && a.employee === p.name)) pending.push({ name: p.name, month: mo })
      }
    }
    return pending
  }, [rows, approvals, isBoss])

  const createPlan = async (e) => {
    e.preventDefault(); if (!selected.length) return setError('เลือกอย่างน้อย 1 คน')
    setSaving(true); setError('')
    try {
      if (preview) {
        const plannedMinutes = (() => { const [a,b] = form.planned_start.split(':').map(Number); const [c,d] = form.planned_end.split(':').map(Number); return Math.max(0, c * 60 + d - a * 60 - b) })()
        const created = selected.map((employee, i) => ({ id: `demo-${Date.now()}-${i}`, employee, ...form, planned_minutes: plannedMinutes, status: 'planned' }))
        const next = [...created, ...rows]; localStorage.setItem('payi-ot-preview', JSON.stringify(next)); setRows(next); setTab('close'); return
      }
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-plan', employees: selected, ...form }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      await load(); setTab('close')
    } catch (e2) { setError(e2.message) } finally { setSaving(false) }
  }

  const closeRows = async (targetRows) => {
    setSaving(true); setError('')
    try {
      const updates = targetRows.map((r) => ({ id: r.id, planned_start: edits[r.id]?.planned_start || r.planned_start, planned_end: edits[r.id]?.planned_end || r.planned_end, actual_minutes: r.actual_minutes || '', note: edits[r.id]?.note ?? r.note ?? '' }))
      if (updates.some((u) => !validTime24(u.planned_start) || !validTime24(u.planned_end) || timeToMinutes(u.planned_end) <= timeToMinutes(u.planned_start))) throw new Error('เวลาจบต้องมากกว่าเวลาเริ่มและอยู่ในวันเดียวกัน')
      if (preview) {
        const updateMap = new Map(updates.map((u) => [u.id, u])); const changedAt = new Date().toISOString(); const addedHistory = rows.filter((r) => { const u = updateMap.get(r.id); return u && (u.planned_start !== r.planned_start || u.planned_end !== r.planned_end || String(u.note ?? '') !== String(r.note ?? '')) }).map((r, i) => { const u = updateMap.get(r.id); return { id: `hist-${Date.now()}-${i}`, plan_id: r.id, date: r.date, employee: r.employee, before_start: r.planned_start, before_end: r.planned_end, after_start: u.planned_start, after_end: u.planned_end, before_note: r.note || '', after_note: u.note || '', changed_at: changedAt, changed_by: 'Boss' } }); const nextHistory = [...addedHistory.map((h) => ({ ...h, changed_by: currentUser?.name || 'Boss' })), ...history]; const next = rows.map((r) => { const u = updateMap.get(r.id); return u ? { ...r, ...u, planned_minutes: timeToMinutes(u.planned_end) - timeToMinutes(u.planned_start), status: 'planned' } : r }); localStorage.setItem('payi-ot-preview', JSON.stringify(next)); localStorage.setItem('payi-ot-history-preview', JSON.stringify(nextHistory)); setRows(next); setHistory(nextHistory); setEdits({}); return true
      }
      const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-plan', updates, changed_by: currentUser?.name }) })
      const d = await resp.json(); if (!resp.ok) throw new Error(d.error || 'แก้ไขแผนไม่สำเร็จ')
      setEdits({}); await load(); return true
    } catch (e) { setError(e.message); return false } finally { setSaving(false) }
  }

  const deleteRows = async (targetRows) => {
    const ids = targetRows.map((r) => r.id); setSaving(true); setError('')
    try {
      if (preview) { const next = rows.filter((r) => !ids.includes(r.id)); localStorage.setItem('payi-ot-preview', JSON.stringify(next)); setRows(next); return }
      const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-plan', ids }) }); const d = await resp.json(); if (!resp.ok) throw new Error(d.error || 'ลบแผนไม่สำเร็จ'); await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const addName = () => {
    const name = newName.trim(); if (!name || names.includes(name)) return
    setNames([...names, name]); setSelected([...selected, name]); setNewName('')
  }

  return (
    <div className="workforce-page" style={{ display: 'grid', gap: 10 }}>
      <div style={{ minHeight: 34, display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: sourceStatus.state === 'ok' ? '#16866f' : '#be123c' }}><span style={{ width: 8, height: 8, borderRadius: 99, background: sourceStatus.state === 'ok' ? '#16866f' : sourceStatus.state === 'loading' ? '#d97706' : '#be123c' }} />{sourceStatus.state === 'ok' ? 'ตาราง Manpower ปี 2026 พร้อมใช้ · ข้อมูลภายในระบบ' : sourceStatus.state === 'loading' ? 'กำลังโหลด Manpower…' : 'โหลดตาราง Manpower ไม่สำเร็จ'}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['calendar','ปฏิทิน'], ...(isBoss ? [['overview','ภาพรวม'], ['summary','สรุป OT'], ['daytype','โอทีเต็มวัน/ชดเชย']] : [])].map(([id,label]) => <button key={id} onClick={() => { setError(''); setTab(id) }} style={miniTab(tab === id)}>{label}</button>)}
          <button onClick={load} aria-label="รีเฟรช" style={{ border: '1px solid #d7e3ef', background: '#fff', borderRadius: 9, padding: 7, color: '#2474b8', cursor: 'pointer' }}><RefreshCw size={15} /></button>
        </div>
      </div>
      {error && <div style={{ padding: '10px 14px', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: 10 }}>{error}</div>}
      {pendingApprovals.length > 0 && tab !== 'summary' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: '#fef3c7', color: '#633806', border: '1px solid #fde3b8', borderRadius: 10, fontSize: 12, fontWeight: 800 }}>
        <span>มี {pendingApprovals.length} รายการที่ยังไม่ approve OT (เดือนนี้/เดือนก่อน)</span>
        <button onClick={() => setTab('summary')} style={{ border: 0, background: '#d97706', color: '#fff', borderRadius: 8, padding: '6px 12px', fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' }}>ไปที่สรุป OT</button>
      </div>}

      {tab === 'plan' && <form onSubmit={createPlan} style={{ ...card, padding: 20, display: 'grid', gap: 18 }}>
        <div><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>1. วางแผน OT ล่วงหน้า</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>เลือกหลายคนพร้อมกัน รายการหนึ่งครั้งจะสร้างแผนให้ทุกคน</div></div>
        <div className="workforce-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
          <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} required /></Field>
          <Field label="ทีม"><select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} style={inputStyle}><option>บ้านล่าง</option><option>บ้านบน</option><option>พาร์ตไทม์</option></select></Field>
          <Field label="งาน"><select value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} style={inputStyle}><option>แพ็ก</option><option>ฟีด</option><option>พาร์ตไทม์</option><option>อื่น ๆ</option></select></Field>
          <Field label="เหตุผล"><select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={inputStyle}><option>ออเดอร์เยอะ</option><option>3 วันก่อนโปร</option><option>งานค้าง</option><option>คนขาด</option><option>อื่น ๆ</option></select></Field>
          <Field label="เริ่ม OT"><input type="time" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })} style={inputStyle} required /></Field>
          <Field label="จบ OT"><input type="time" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })} style={inputStyle} required /></Field>
          <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="ไม่จำเป็นต้องกรอก" style={inputStyle} /></Field>
        </div>
        <div><div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 9 }}>เลือกคนทำ OT · {selected.length} คน</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{names.map((name) => { const on = selected.includes(name); return <button type="button" key={name} onClick={() => setSelected(on ? selected.filter((n) => n !== name) : [...selected, name])} style={{ border: `1px solid ${on ? '#5ca8df' : '#cbd5e1'}`, background: on ? '#e9f5ff' : '#fff', color: on ? '#155f98' : '#64748b', borderRadius: 999, padding: '8px 13px', fontWeight: 800, cursor: 'pointer' }}>{on ? '✓ ' : ''}{name}</button>})}</div></div>
        <div style={{ display: 'flex', gap: 8, maxWidth: 330 }}><input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addName() } }} placeholder="เพิ่มชื่อ" style={inputStyle} /><button type="button" onClick={addName} style={{ border: 0, borderRadius: 10, background: '#e9f5ff', color: '#155f98', width: 44, cursor: 'pointer' }}><Plus size={17} /></button></div>
        <button disabled={saving || !selected.length} style={{ justifySelf: 'start', border: 0, borderRadius: 10, padding: '11px 20px', background: '#397fb5', color: '#fff', fontWeight: 900, cursor: 'pointer', opacity: saving ? .6 : 1 }}>{saving ? 'กำลังบันทึก…' : `บันทึกแผน ${selected.length} คน`}</button>
      </form>}

      {tab === 'close' && <section style={{ ...card, overflow: 'hidden' }}><div style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><div><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>2. ยืนยันเวลาจริงหลังทำเสร็จ</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>เวลาเหมือนแผนไม่ต้องแก้ กดยืนยันทั้งชุดได้ทันที</div></div>{planned.length > 0 && <button disabled={saving} onClick={() => closeRows(planned)} style={{ border: 0, borderRadius: 10, padding: '10px 16px', background: '#16866f', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>ยืนยันตามแผนทั้งหมด</button>}</div>
        {loading ? <Empty text="กำลังโหลด…" /> : !planned.length ? <Empty text="ไม่มีรายการ OT ที่รอยืนยัน" /> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820, fontSize: 13 }}><thead><tr style={{ background: '#f0f7fd', color: '#52677a', textAlign: 'left' }}>{['วันที่','ชื่อ','งาน','เวลาแผน','เริ่มจริง','จบจริง','สถานะ',''].map((h) => <th key={h} style={{ padding: '10px 12px' }}>{h}</th>)}</tr></thead><tbody>{planned.map((r) => { const e = edits[r.id] || {}; return <tr key={r.id} style={{ borderTop: '1px solid #e5eef7' }}><td style={td}>{r.date}</td><td style={{ ...td, fontWeight: 900 }}>{r.employee}</td><td style={td}>{r.task}</td><td style={td}>{r.planned_start}–{r.planned_end}<div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtMinutes(r.planned_minutes)}</div></td><td style={td}><input type="time" value={e.actual_start ?? r.planned_start} onChange={(x) => setEdits({ ...edits, [r.id]: { ...e, actual_start: x.target.value } })} style={{ ...inputStyle, width: 105, padding: 7 }} /></td><td style={td}><input type="time" value={e.actual_end ?? r.planned_end} onChange={(x) => setEdits({ ...edits, [r.id]: { ...e, actual_end: x.target.value } })} style={{ ...inputStyle, width: 105, padding: 7 }} /></td><td style={td}><select value={e.status || 'completed'} onChange={(x) => setEdits({ ...edits, [r.id]: { ...e, status: x.target.value } })} style={{ ...inputStyle, width: 110, padding: 7 }}><option value="completed">ทำแล้ว</option><option value="cancelled">ยกเลิก</option></select></td><td style={td}><button onClick={() => closeRows([r])} aria-label={`ยืนยัน ${r.employee}`} style={{ border: 0, background: '#e7f7f2', color: '#16866f', borderRadius: 8, padding: 8, cursor: 'pointer' }}><CheckCircle2 size={17} /></button></td></tr> })}</tbody></table></div>}
      </section>}

      {tab === 'calendar' && <CalendarPlanner rows={rows} manpower={manpower} events={events} history={history} names={names} preview={preview} onSaved={load} error={error} setError={setError} otLimits={otLimits} closeRows={closeRows} deleteRows={deleteRows} edits={edits} setEdits={setEdits} saving={saving} groupByName={groupByName} officePeople={officePeople} officeAbsences={officeAbsences} inactiveNames={inactiveNames} schedulePeople={schedulePeople} canEditManpower={isBoss && !preview} />}
      {tab === 'overview' && isBoss && <OverviewOT rows={rows} approvals={approvals} otLimits={otLimits} />}
      {tab === 'summary' && isBoss && <PlanControlSummary rows={rows} approvals={approvals} setApprovals={setApprovals} approvalHistory={approvalHistory} preview={preview} setError={setError} otLimits={otLimits} setOtLimits={saveOtLimit} currentUser={currentUser} onSaved={load} />}
      {tab === 'daytype' && isBoss && <DayRecordsPanel dayRecords={dayRecords} names={names} preview={preview} setError={setError} onSaved={load} />}
    </div>
  )
}

// โอทีเต็มวัน (มาทำวันหยุด/นักขัตฤกษ์) หรือมาชดเชยเฉยๆไม่รับโอที — แยกจาก OT รายชั่วโมงข้างบน
// สลับวันหยุด ("จากวันไหนไปวันไหน") ทำผ่านระบบลา (leave_type 'สลับวันหยุด') อยู่แล้ว ไม่ได้อยู่ที่นี่
function DayRecordsPanel({ dayRecords = [], names = [], preview, setError, onSaved }) {
  const [form, setForm] = useState({ date: today(), kind: 'ot_full', reason: '', note: '', paid_ot: true })
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)

  const add = async (e) => {
    e.preventDefault()
    if (!selected.length) return setError('เลือกอย่างน้อย 1 คน')
    setSaving(true); setError('')
    try {
      if (preview) { setSaving(false); return }
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-dayrecord', employees: selected, date: form.date, kind: form.kind, reason: form.reason, paid_ot: form.paid_ot, note: form.note }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      setSelected([]); setForm({ ...form, reason: '', note: '' })
      await onSaved()
    } catch (e2) { setError(e2.message) } finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!window.confirm('ลบรายการนี้ใช่ไหม?')) return
    setError('')
    try {
      if (preview) return
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-dayrecord', id }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'ลบไม่สำเร็จ')
      await onSaved()
    } catch (e) { setError(e.message) }
  }

  const kindLabel = (kind) => kind === 'ot_full' ? 'โอทีเต็มวัน' : 'ชดเชยเฉยๆ'

  return <div style={{ display: 'grid', gap: 14 }}>
    <form onSubmit={add} style={{ ...card, padding: 20, display: 'grid', gap: 16 }}>
      <div><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>บันทึกโอทีเต็มวัน / มาชดเชย</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>ใช้กับกรณีมาทำงานเต็มวันในวันหยุดตัวเอง/วันนักขัตฤกษ์ — ถ้าเป็น "สลับวันหยุด" ให้ใช้เมนูลาแทน</div></div>
      <div className="workforce-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} required /></Field>
        <Field label="ประเภท"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={inputStyle}><option value="ot_full">โอทีเต็มวัน</option><option value="comp">มาชดเชยเฉยๆ (ไม่รับโอที)</option></select></Field>
        <Field label="เหตุผล"><select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={inputStyle}><option value="">— ไม่ระบุ —</option><option value="วันนักขัตฤกษ์">วันนักขัตฤกษ์</option><option value="วันหยุดตัวเอง">วันหยุดตัวเอง</option><option value="อื่น ๆ">อื่น ๆ</option></select></Field>
        {form.kind === 'ot_full' && <Field label="รับโอทีไหม"><select value={form.paid_ot ? '1' : '0'} onChange={(e) => setForm({ ...form, paid_ot: e.target.value === '1' })} style={inputStyle}><option value="1">รับโอที</option><option value="0">ไม่รับโอที</option></select></Field>}
        <Field label="หมายเหตุ"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="เช่น หยุดตัวเองชนวันนักขัต ได้หยุด 2 วัน" style={inputStyle} /></Field>
      </div>
      <div><div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 9 }}>เลือกคน · {selected.length} คน</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{names.map((name) => { const on = selected.includes(name); return <button type="button" key={name} onClick={() => setSelected(on ? selected.filter((n) => n !== name) : [...selected, name])} style={{ border: `1px solid ${on ? '#5ca8df' : '#cbd5e1'}`, background: on ? '#e9f5ff' : '#fff', color: on ? '#155f98' : '#64748b', borderRadius: 999, padding: '8px 13px', fontWeight: 800, cursor: 'pointer' }}>{on ? '✓ ' : ''}{name}</button> })}</div></div>
      <button disabled={saving || !selected.length} style={{ justifySelf: 'start', border: 0, borderRadius: 10, padding: '11px 20px', background: '#397fb5', color: '#fff', fontWeight: 900, cursor: 'pointer', opacity: saving ? .6 : 1 }}>{saving ? 'กำลังบันทึก…' : `บันทึก ${selected.length} คน`}</button>
    </form>
    <section style={{ ...card, overflow: 'hidden' }}>
      {!dayRecords.length ? <Empty text="ยังไม่มีรายการ" /> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700, fontSize: 13 }}><thead><tr style={{ background: '#f0f7fd', color: '#52677a', textAlign: 'left' }}>{['วันที่', 'ชื่อ', 'ประเภท', 'เหตุผล', 'รับโอที', 'หมายเหตุ', ''].map((h) => <th key={h} style={{ padding: '10px 12px' }}>{h}</th>)}</tr></thead><tbody>{dayRecords.map((r) => <tr key={r.id} style={{ borderTop: '1px solid #e5eef7' }}><td style={td}>{r.date}</td><td style={{ ...td, fontWeight: 900 }}>{r.employee}</td><td style={td}>{kindLabel(r.kind)}</td><td style={td}>{r.reason || '—'}</td><td style={td}>{r.kind === 'ot_full' ? (String(r.paid_ot) === '1' ? 'รับ' : 'ไม่รับ') : '—'}</td><td style={td}>{r.note || '—'}</td><td style={td}><button onClick={() => remove(r.id)} aria-label={`ลบ ${r.employee}`} style={{ border: 0, background: '#fef1f1', color: '#be123c', borderRadius: 8, padding: 8, cursor: 'pointer' }}><X size={15} /></button></td></tr>)}</tbody></table></div>}
    </section>
  </div>
}

function Kpi({ icon: Icon, label, value, tone }) { return <div style={{ ...card, padding: 15, display: 'flex', alignItems: 'center', gap: 11 }}><div style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 11, color: tone, background: `${tone}15` }}><Icon size={19} /></div><div><div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>{label}</div><div style={{ color: '#102a43', fontSize: 18, fontWeight: 900, marginTop: 2 }}>{value}</div></div></div> }
function Field({ label, children }) { return <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 800, color: '#475569' }}>{label}{children}</label> }
function Empty({ text }) { return <div style={{ padding: 42, textAlign: 'center', color: '#94a3b8' }}>{text}</div> }
const td = { padding: '11px 12px', color: '#334155', verticalAlign: 'middle' }

function CalendarPlanner({ rows, manpower, events, history = [], names, preview, onSaved, error, setError, otLimits = {}, closeRows, deleteRows, edits = {}, setEdits, saving, groupByName = {}, officePeople = [], officeAbsences = [], inactiveNames = new Set(), schedulePeople = [], canEditManpower = false }) {
  const [month, setMonth] = useState(today().slice(0, 7))
  // มือถือ: ปฏิทินตาราง 7 คอลัมน์บีบจนอ่านไม่ออก — สลับเป็นรายการรายวันแทน (owner ขอ)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 700)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 700)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState([])
  const [start, setStart] = useState('17:30')
  const [end, setEnd] = useState('20:00')
  const [note, setNote] = useState('')
  const [promoTitle, setPromoTitle] = useState('วันโปร')
  const [promoTeam, setPromoTeam] = useState('ทุกทีม')
  const [leadDays, setLeadDays] = useState('0')
  const [lagDays, setLagDays] = useState('0')
  const [customTitle, setCustomTitle] = useState(false)
  const [promoEnd, setPromoEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState('')
  const [scheduleDraft, setScheduleDraft] = useState({})
  const [year, mo] = month.split('-').map(Number)
  const first = new Date(year, mo - 1, 1)
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: new Date(year, mo, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  // เดือนที่แต่ละคนมีงานจริง (จาก manpower/ประวัติ OT) — ใช้กรองตัวเลือก "เพิ่มคน OT ใหม่" ไม่ให้โชว์คนที่ไม่ได้ทำงานเดือนนี้
  // ถ้าไม่เคยมีข้อมูลของคนนั้นเลย (เช่น ชื่อที่พิมพ์เพิ่มเอง) ให้โชว์ไว้ก่อน ไม่กรองออก
  const monthsByName = useMemo(() => {
    const map = {}
    for (const row of manpower) { if (row.employee && row.date) (map[row.employee] ||= new Set()).add(String(row.date).slice(0, 7)) }
    for (const row of rows) { if (row.employee && row.date) (map[row.employee] ||= new Set()).add(String(row.date).slice(0, 7)) }
    return map
  }, [manpower, rows])
  while (cells.length % 7) cells.push(null)
  const promoDates = new Set(events.map((e) => e.date))
  // ช่วงเตรียมฟีด = ช่วงวันโปรเอง (หลายวัน) บวกวันเผื่อก่อน/หลัง (lead_days/lag_days) ถ้ากำหนดไว้ — โปรวันเดียวไม่มีเผื่อก่อน/หลังเลยจะไม่ไฮไลท์ (เหมือนเดิม)
  const feedRangeDates = new Set()
  events.forEach((e) => {
    const lead = Number(e.lead_days || 0); const lag = Number(e.lag_days || 0)
    const end = e.end_date || e.date
    if (end === e.date && !lead && !lag) return
    const d = new Date(`${e.date}T00:00:00`); d.setDate(d.getDate() - lead)
    const endD = new Date(`${end}T00:00:00`); endD.setDate(endD.getDate() + lag)
    for (let x = new Date(d); x <= endD; x.setDate(x.getDate() + 1)) feedRangeDates.add(x.toLocaleDateString('en-CA'))
  })
  const openOT = (date) => { setError(''); setModal({ type: 'ot', date }); setSelected([]); setNote('') }
  const openSchedule = (date) => {
    const workingCodes = new Set(manpower.filter((row) => row.date === date).map((row) => String(row.code || '').toUpperCase()))
    setScheduleDraft(Object.fromEntries(schedulePeople.map((person) => [person.code, workingCodes.has(String(person.code).toUpperCase())])))
    setError('')
    setModal({ type: 'schedule', date })
  }
  const checkLimits = (date, employees, plannedMinutes) => {
    const targetMonth = date.slice(0, 7)
    const over = employees.filter((employee) => {
      const limitHours = Number(otLimits[employee]); if (!limitHours) return false
      const existing = rows.filter((r) => r.employee === employee && r.status !== 'cancelled' && r.date?.startsWith(targetMonth)).reduce((s, r) => s + Number(r.planned_minutes || 0), 0)
      return existing + plannedMinutes > limitHours * 60
    })
    setWarning(over.length ? `เกินลิมิต OT ที่ตั้งไว้: ${over.join(', ')} (เดือนนี้จะรวมเกินโควต้า) — ยังบันทึกให้แล้ว แต่ควรแจ้งบอส` : '')
  }
  const save = async () => {
    if (modal.type === 'schedule') {
      setBusy(true); setError('')
      try {
        const codes = schedulePeople.filter((person) => scheduleDraft[person.code]).map((person) => person.code)
        const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-schedule-day', date: modal.date, codes }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'บันทึก Manpower ไม่สำเร็จ')
        setModal(null)
        await onSaved()
      } catch (e) { setError(e.message) } finally { setBusy(false) }
      return
    }
    if (modal.type === 'ot' && !selected.length) return setError('กรุณาเลือกคนทำ OT อย่างน้อย 1 คน')
    if (modal.type === 'ot' && (!validTime24(start) || !validTime24(end))) return setError('กรอกเวลาเป็น HH:MM เช่น 17:30')
    if (modal.type === 'ot' && timeToMinutes(end) <= timeToMinutes(start)) return setError('เวลาจบต้องมากกว่าเวลาเริ่มและอยู่ในวันเดียวกัน')
    if (modal.type === 'ot') {
      const conflicts = selected.filter((employee) => rows.some((r) => r.date === modal.date && r.employee === employee && r.status !== 'cancelled' && timeToMinutes(start) < timeToMinutes(r.planned_end) && timeToMinutes(r.planned_start) < timeToMinutes(end)))
      if (conflicts.length) return setError(`มีแผนซ้ำหรือเวลาชนกัน: ${conflicts.join(', ')}`)
    }
    if (modal.type === 'promo' && promoEnd && promoEnd < modal.date) return setError('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
    setBusy(true); setError(''); setWarning('')
    try {
      const eventEnd = promoEnd || modal.date
      const body = modal.type === 'ot'
        ? { action: 'create-plan', date: modal.date, employees: selected, team: 'บ้านล่าง', task: 'แพ็ก', planned_start: start, planned_end: end, reason: 'วางแผน OT', note }
        : { action: 'create-event', date: modal.date, end_date: eventEnd, title: promoTitle, team: promoTeam, note, lead_days: leadDays, lag_days: lagDays }
      if (preview) {
        if (modal.type === 'ot') {
          const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number)
          const added = selected.map((employee, i) => ({ id: `demo-${Date.now()}-${i}`, date: modal.date, employee, task: 'แพ็ก', planned_start: start, planned_end: end, planned_minutes: Math.max(0, eh * 60 + em - sh * 60 - sm), status: 'planned', note }))
          localStorage.setItem('payi-ot-preview', JSON.stringify([...added, ...rows]))
        } else {
          localStorage.setItem('payi-events-preview', JSON.stringify([...events, { id: `ev-${Date.now()}`, date: modal.date, end_date: eventEnd, title: promoTitle, team: promoTeam, note, lead_days: leadDays, lag_days: lagDays }]))
        }
      } else {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      }
      if (modal.type === 'ot') { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); checkLimits(modal.date, selected, Math.max(0, eh * 60 + em - sh * 60 - sm)) }
      setModal(null); await onSaved()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const deleteEvent = async (event) => {
    if (!window.confirm(`ลบ "${event.title}" ใช่ไหม?`)) return
    setError('')
    try {
      if (preview) {
        localStorage.setItem('payi-events-preview', JSON.stringify(events.filter((e) => e.id !== event.id)))
      } else {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-event', id: event.id }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'ลบไม่สำเร็จ')
      }
      await onSaved()
    } catch (e) { setError(e.message) }
  }

  // สรุปข้อมูลของวันเดียว — ใช้ร่วมกันทั้งช่องปฏิทินตาราง (desktop) และการ์ดรายวัน (มือถือ) กันคำนวณซ้ำสองที่
  const computeDayInfo = (date) => {
    const dayRows = rows.filter((r) => r.date === date && r.status !== 'cancelled'); const dayManpower = manpower.filter((r) => r.date === date); const isPromo = promoDates.has(date); const isFeed = feedRangeDates.has(date); const partTime = dayRows.filter((r) => groupByName[r.employee] === 'พาร์ทไทม์'); const packers = dayRows.filter((r) => groupByName[r.employee] !== 'พาร์ทไทม์')
    const distinctDayManpower = [...new Map(dayManpower.map((r) => [String(r.code || r.employee).toUpperCase(), r])).values()]
    const feedManpower = distinctDayManpower.filter((r) => {
      const code = String(r.code || '').toUpperCase()
      const employee = String(r.employee || '').trim().toUpperCase()
      return r.group === 'คนฟีด' || ['PANID', 'MOM'].includes(code) || ['PANID', 'MOM', 'ป้านิด', 'แม่'].includes(employee)
    })
    const regularManpower = distinctDayManpower.filter((r) => !feedManpower.includes(r))
    const feedNames = feedManpower.map((r) => { const identity = String(r.code || r.employee || '').trim().toUpperCase(); return identity === 'PANID' ? 'ป้านิด' : identity === 'MOM' ? 'แม่' : r.employee })
    const regularNames = regularManpower.map((r) => r.employee === 'มะปราง' ? 'ปราง' : r.employee)
    const regularHeadcount = regularManpower.reduce((s, r) => s + Number(r.fraction || 1), 0)
    const officeAbsentCodes = new Set(officeAbsences.filter((a) => a.date === date).map((a) => a.code))
    const officePresentNames = officePeople.filter((p) => !officeAbsentCodes.has(p.code)).map((p) => p.name)
    const lowPackingManpower = regularHeadcount <= 2
    const isToday = date === today()
    const promoTitleForDate = events.filter((e) => e.date === date)
    return { isPromo, isFeed, partTime, packers, feedNames, regularNames, officePresentNames, lowPackingManpower, isToday, promoEvents: promoTitleForDate }
  }
  const monthDates = cells.filter(Boolean)
  const defaultMobileDate = monthDates.includes(today()) ? today() : (monthDates[0] || today())
  const [mobileSelectedDate, setMobileSelectedDate] = useState(defaultMobileDate)
  const activeMobileDate = monthDates.includes(mobileSelectedDate) ? mobileSelectedDate : defaultMobileDate
  const WEEKDAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

  return <section style={{ ...card, width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden', borderRadius: 22, background: 'linear-gradient(180deg,#ffffff,#f7fbff)' }}>
    <div style={{ padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>ปฏิทิน Manpower & OT</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>ปุ่ม “คน” ใช้แก้รายชื่อมาทำงาน · ปุ่ม + ใช้เพิ่ม OT</div></div>
      <div style={{ display: 'flex', gap: 8 }}><button onClick={() => { setPromoEnd(`${month}-01`); setPromoTeam('ทุกทีม'); setLeadDays('0'); setLagDays('0'); setModal({ type: 'promo', date: `${month}-01` }) }} style={miniTab(false)}>+ วันโปร</button><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inputStyle, width: 155 }} /></div>
    </div>
    {warning && <div style={{ margin: '0 18px 12px', padding: '10px 14px', background: '#fef6da', color: '#8a6d1f', border: '1px solid #fbe6a8', borderRadius: 10, fontSize: 12, fontWeight: 800 }}>{warning}</div>}
    <div style={{ padding: '9px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', background: '#f8fbff', fontSize: 11, color: '#64748b' }}><Legend color="#d3c2f2" text="วันโปร"/><Legend color="#f0eafb" text="ช่วงเตรียมฟีด (กำหนดเองได้)"/></div>
    {isMobile && (
      <MobileDayAgenda
        monthDates={monthDates}
        activeDate={activeMobileDate}
        onSelectDate={setMobileSelectedDate}
        computeDayInfo={computeDayInfo}
        weekdayLabels={WEEKDAY_TH}
        canEditManpower={canEditManpower}
        openSchedule={openSchedule}
        openOT={openOT}
        deleteEvent={deleteEvent}
      />
    )}
    {!isMobile && <div style={{ width: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box', padding: '4px 8px 12px' }}><div style={{ width: '100%', minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', background: 'linear-gradient(180deg,#eef6ff,#f7fbff)', borderRadius: 12 }}>{['อา','จ','อ','พ','พฤ','ศ','ส'].map((d) => <div key={d} style={{ padding: 7, textAlign: 'center', fontSize: 11, fontWeight: 900, color: '#7a94b8' }}>{d}</div>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 5, marginTop: 5 }}>{cells.map((date, i) => {
        if (!date) return <div key={`blank-${i}`} style={{ minWidth: 0, minHeight: 132, borderRadius: 12, background: 'transparent' }} />
        const dayRows = rows.filter((r) => r.date === date && r.status !== 'cancelled'); const dayManpower = manpower.filter((r) => r.date === date); const isPromo = promoDates.has(date); const isFeed = feedRangeDates.has(date); const partTime = dayRows.filter((r) => groupByName[r.employee] === 'พาร์ทไทม์'); const packers = dayRows.filter((r) => groupByName[r.employee] !== 'พาร์ทไทม์')
        const distinctDayManpower = [...new Map(dayManpower.map((r) => [String(r.code || r.employee).toUpperCase(), r])).values()]
        const feedManpower = distinctDayManpower.filter((r) => {
          const code = String(r.code || '').toUpperCase()
          const employee = String(r.employee || '').trim().toUpperCase()
          return r.group === 'คนฟีด' || ['PANID', 'MOM'].includes(code) || ['PANID', 'MOM', 'ป้านิด', 'แม่'].includes(employee)
        })
        const regularManpower = distinctDayManpower.filter((r) => !feedManpower.includes(r))
        const feedNames = feedManpower.map((r) => { const identity = String(r.code || r.employee || '').trim().toUpperCase(); return identity === 'PANID' ? 'ป้านิด' : identity === 'MOM' ? 'แม่' : r.employee })
        const regularNames = regularManpower.map((r) => r.employee === 'มะปราง' ? 'ปราง' : r.employee)
        const regularHeadcount = regularManpower.reduce((s, r) => s + Number(r.fraction || 1), 0)
        // กลุ่มออฟฟิศ — แยกจากบ้านล่าง/บ้านบนข้างบน ไม่รวมนับ headcount เดียวกัน แค่โชว์ให้เห็นว่าใครลาวันนี้
        const officeAbsentCodes = new Set(officeAbsences.filter((a) => a.date === date).map((a) => a.code))
        const officePresentNames = officePeople.filter((p) => !officeAbsentCodes.has(p.code)).map((p) => p.name)
        const lowPackingManpower = regularHeadcount <= 2
        const isToday = date === today()
        return <div key={date} style={{ minWidth: 0, minHeight: 132, padding: 7, textAlign: 'left', borderRadius: 12, border: isToday ? '2px solid #355872' : `1px solid ${isPromo ? '#c3b1ea' : isFeed ? '#e4d9f7' : '#e2e8ef'}`, background: isPromo ? 'linear-gradient(135deg,#ede7fb,#f5f1fd)' : isFeed ? 'linear-gradient(180deg,#f5f1fd,#faf8fe)' : 'linear-gradient(180deg,#ffffff,#fbfdff)', boxShadow: isToday ? '0 4px 16px rgba(53,88,114,.20)' : '0 2px 10px rgba(53,88,114,.07)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', overflow: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span style={isToday ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, borderRadius: 6, background: '#355872', color: '#fff', fontSize: 11, fontWeight: 900 } : { fontSize: 12, fontWeight: 900, color: '#334155' }}>{Number(date.slice(-2))}</span>
              <span style={{ color: isPromo ? '#5b4b8a' : '#8a76c0', fontSize: 9 }}>{isPromo ? 'วันโปร' : isFeed ? 'เตรียมฟีด' : ''}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {canEditManpower && <button type="button" onClick={() => openSchedule(date)} aria-label={`แก้ Manpower วันที่ ${date}`} title="แก้คนมาทำงาน" style={{ minWidth: 30, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3, border: 0, borderRadius: 7, padding: '0 7px', background: '#9CD5FF', color: '#355872', cursor: 'pointer', fontSize: 9, fontWeight: 900 }}><UserRoundPen size={12} /><span>คน</span></button>}
              <button type="button" onClick={() => openOT(date)} aria-label={`เพิ่ม OT วันที่ ${date}`} title="เพิ่ม OT" style={{ width: 22, height: 22, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: '#7AAACE', opacity: .55, cursor: 'pointer' }}><Plus size={13} strokeWidth={2.1} aria-hidden="true" /></button>
            </span>
          </div>
          {events.filter((e) => e.date === date).map((e) => <div key={e.id} style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, minWidth: 0, color: '#be185d', fontSize: 10, fontWeight: 900 }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.title}>{e.title}</span><span role="button" aria-label={`ลบ ${e.title}`} onClick={(ev) => { ev.stopPropagation(); deleteEvent(e) }} style={{ flexShrink: 0, cursor: 'pointer', color: '#be185d', opacity: .6, padding: '0 3px' }}>×</span></div>)}
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            {regularManpower.length > 0 && <div style={{ borderRadius: 7, padding: '3px 5px', background: '#e0f2fe', border: '1px solid #7AAACE' }}>
              <div style={{ fontSize: 9, lineHeight: '13px', fontWeight: lowPackingManpower ? 900 : 700, color: lowPackingManpower ? '#dc2626' : '#355872' }}>{regularNames.join(', ')}</div>
            </div>}
            {feedManpower.length > 0 && <div style={{ borderRadius: 7, padding: '3px 5px', background: '#ffedd5', border: '1px solid #fb923c' }}>
              <div style={{ fontSize: 9, lineHeight: '13px', fontWeight: 900, color: '#c2410c' }}>{feedNames.join(', ')}</div>
            </div>}
            {officePresentNames.length > 0 && <div style={{ borderRadius: 7, padding: '3px 5px', background: '#ecfdf5', border: '1px solid #6ee7b7' }}>
              <div style={{ fontSize: 9, lineHeight: '13px', fontWeight: 700, color: '#047857' }}>{officePresentNames.join(', ')}</div>
            </div>}
          </div>
          {packers.length > 0 && <DayGroup label="OT คนแพ็ก" rows={packers} />}{partTime.length > 0 && <DayGroup label="OT พาร์ทไทม์" rows={partTime} />}
        </div>
      })}</div>
    </div></div>}
    {modal && (() => { const modalDayRows = modal.type === 'ot' ? rows.filter((r) => r.date === modal.date && r.status !== 'cancelled') : []; return <div onMouseDown={() => setModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 18 }}><div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: 'calc(100vw - 36px)', background: '#fff', borderRadius: 18, padding: 20, boxShadow: '0 24px 70px rgba(15,23,42,.22)', maxHeight: '86vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>{modal.type === 'schedule' ? 'แก้ Manpower' : modal.type === 'ot' ? 'เพิ่มแผน OT' : 'เพิ่มวันโปร'}</div>{modalDayRows.length > 0 && <span style={{ background: '#fef3c7', color: '#633806', fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 999 }}>แก้ไข</span>}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{modal.date}</div></div><button onClick={() => setModal(null)} aria-label="ปิด" style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: '#64748b', cursor: 'pointer', borderRadius: 10 }}><X size={18}/></button></div>
      {error && !(modal.type === 'ot' && modalDayRows.length > 0) && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#fff1f2', color: '#be123c', fontSize: 12, fontWeight: 800 }}>{error}</div>}

      {modal.type === 'ot' && modalDayRows.length > 0 && <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#334155', marginBottom: 8 }}>รายการที่มีอยู่แล้ว · {modalDayRows.length} คน</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {modalDayRows.map((r) => { const e = edits[r.id] || {}; return <div key={r.id} style={{ border: '1px solid #eef2f9', borderRadius: 10, padding: '8px 10px', background: '#f8fbff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}><b style={{ fontSize: 12, color: '#102a43' }}>{r.employee}</b><span style={{ fontSize: 10, color: '#94a3b8' }}>แผน {r.planned_start}-{r.planned_end}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <ManualTime24 value={e.planned_start ?? r.planned_start} onChange={(value) => setEdits?.({ ...edits, [r.id]: { ...e, planned_start: value } })} />
              <ManualTime24 value={e.planned_end ?? r.planned_end} onChange={(value) => setEdits?.({ ...edits, [r.id]: { ...e, planned_end: value } })} />
              <button onClick={() => deleteRows?.([r])} disabled={saving} style={{ border: '1px solid #fecdd3', background: '#fff1f2', color: '#be123c', borderRadius: 8, padding: '6px 10px', fontWeight: 800, cursor: 'pointer' }}>ลบ</button>
            </div>
          </div> })}
        </div>
        {error && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#fff1f2', color: '#be123c', fontSize: 11, fontWeight: 800 }}>{error}</div>}
        <button onClick={async () => { const ok = await closeRows?.(modalDayRows); if (ok) setModal(null) }} disabled={saving} style={{ marginTop: 10, border: 0, borderRadius: 10, padding: '9px 15px', background: '#16866f', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>{saving ? 'กำลังบันทึก…' : 'บันทึกการแก้ไขแผน'}</button>
        {history.some((h) => h.date === modal.date) && <div style={{ marginTop: 14, borderTop: '1px solid #e5eef7', paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#334155', marginBottom: 7 }}>ประวัติการแก้แผน</div>
          <div style={{ display: 'grid', gap: 6 }}>{history.filter((h) => h.date === modal.date).sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at))).slice(0, 8).map((h) => <div key={h.id} style={{ padding: '7px 9px', borderRadius: 9, background: '#fff7ed', color: '#7c4a13', fontSize: 11 }}><b>{h.employee}</b> · {h.before_start}-{h.before_end} → <b>{h.after_start}-{h.after_end}</b><div style={{ marginTop: 2, color: '#9a6b38' }}>{new Date(h.changed_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })} · {h.changed_by || 'Boss'}</div></div>)}</div>
        </div>}
      </div>}

      {modal.type === 'schedule' ? <ScheduleDayEditor people={schedulePeople} draft={scheduleDraft} setDraft={setScheduleDraft} /> : modal.type === 'ot' ? <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#334155' }}>{modalDayRows.length > 0 ? 'เพิ่มคน OT ใหม่' : 'เลือกคนทำ OT'}</div>
        <Field label="เลือกคนทำ OT"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{[
          ...names.filter((name) => !inactiveNames.has(name) && (!monthsByName[name] || monthsByName[name].has((modal?.date || month).slice(0, 7)))),
          // คนออฟฟิศเลือกได้ทุกคนทุกวันเสมอ ไม่กรองตามประวัติเดือนหรือวันลา — มาช่วยทำ OT ได้ไม่ว่าปกติจะหยุดวันนั้นหรือไม่
          ...officePeople.map((p) => p.name).filter((name) => name && !names.includes(name)),
        ].map((name) => { const on = selected.includes(name); return <button key={name} onClick={() => setSelected(on ? selected.filter((n) => n !== name) : [...selected, name])} style={{ border: `1px solid ${on ? '#ec4899' : '#d7e3ef'}`, background: on ? '#fff0f7' : '#fff', color: on ? '#be185d' : '#475569', borderRadius: 999, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>{on ? '✓ ' : ''}{name}</button> })}</div></Field><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}><Field label="เริ่ม OT · HH:MM"><ManualTime24 value={start} onChange={setStart}/></Field><Field label="จบ OT · HH:MM"><ManualTime24 value={end} onChange={setEnd}/></Field></div>{validTime24(start) && validTime24(end) && timeToMinutes(end) > timeToMinutes(start) && <div style={{ padding: '8px 10px', borderRadius: 9, background: '#eaf5ff', color: '#155f98', fontSize: 12, fontWeight: 900 }}>รวม {fmtMinutes(timeToMinutes(end) - timeToMinutes(start))} ต่อคน</div>}<Field label="หมายเหตุ"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ไม่จำเป็นต้องกรอก" style={inputStyle}/></Field></div> : <div style={{ display: 'grid', gap: 12, marginTop: 18 }}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}><Field label="ตั้งแต่วันที่"><input type="date" value={modal.date} onChange={(e) => { setModal({ ...modal, date: e.target.value }); if (!promoEnd || promoEnd < e.target.value) setPromoEnd(e.target.value) }} style={inputStyle}/></Field><Field label="ถึงวันที่"><input type="date" value={promoEnd} min={modal.date} onChange={(e) => setPromoEnd(e.target.value)} style={inputStyle}/></Field></div><Field label="ชื่อโปร / ช่วงเตรียมฟีด">{customTitle
          ? <div style={{ display: 'flex', gap: 8 }}><input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} placeholder="ระบุชื่อ" style={inputStyle} autoFocus /><button type="button" onClick={() => { setCustomTitle(false); setPromoTitle(PROMO_TITLE_OPTIONS[0]) }} style={{ border: '1px solid #d7e3ef', background: '#fff', color: '#64748b', borderRadius: 10, padding: '0 12px', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>เลือกจากรายการ</button></div>
          : <select value={promoTitle} onChange={(e) => { if (e.target.value === '__other__') { setCustomTitle(true); setPromoTitle('') } else setPromoTitle(e.target.value) }} style={inputStyle}>
              {PROMO_TITLE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__other__">อื่นๆ โปรดระบุ</option>
            </select>}</Field>
        <Field label="ใคร / ทีมไหนเกี่ยวข้อง"><select value={promoTeam} onChange={(e) => setPromoTeam(e.target.value)} style={inputStyle}>{['ทุกทีม', 'บ้านล่าง', 'บ้านบน', 'พาร์ตไทม์', 'ออฟฟิศ'].map((t) => <option key={t}>{t}</option>)}</select></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          <Field label="เตรียมล่วงหน้ากี่วัน (ก่อนวันโปร)"><input type="number" min="0" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} style={inputStyle}/></Field>
          <Field label="เก็บงานหลังกี่วัน (หลังวันโปร)"><input type="number" min="0" value={lagDays} onChange={(e) => setLagDays(e.target.value)} style={inputStyle}/></Field>
        </div></div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button onClick={() => setModal(null)} style={{ minHeight: 44, border: '1px solid #d7e3ef', background: '#fff', borderRadius: 10, padding: '9px 15px', color: '#64748b', fontWeight: 800 }}>ยกเลิก</button><button onClick={save} disabled={busy} style={{ minHeight: 44, border: 0, background: modal.type === 'schedule' ? '#0284c7' : '#ec4899', color: '#fff', borderRadius: 10, padding: '9px 17px', fontWeight: 900 }}>{busy ? 'กำลังบันทึก…' : modal.type === 'schedule' ? 'บันทึก Manpower' : 'บันทึก'}</button></div>
    </div></div> })()}
  </section>
}

function ScheduleDayEditor({ people = [], draft = {}, setDraft }) {
  const selectedCount = people.filter((person) => draft[person.code]).length
  const groups = [...new Set(people.map((person) => person.group || 'อื่น ๆ'))]
  return <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
    <div style={{ padding: '10px 12px', borderRadius: 11, background: '#eef8ff', color: '#155f98', fontSize: 12, lineHeight: 1.55 }}>
      เลือกเฉพาะคนที่มาทำงานวันนี้ · เมื่อบันทึก ระบบจะใช้รายการนี้แทนข้อมูล SKJ เฉพาะวันนี้
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <strong style={{ color: '#102a43', fontSize: 13 }}>มาทำงาน {selectedCount} คน</strong>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => setDraft(Object.fromEntries(people.map((person) => [person.code, true])))} style={{ minHeight: 36, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#155f98', borderRadius: 9, padding: '0 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>เลือกทุกคน</button>
        <button type="button" onClick={() => setDraft(Object.fromEntries(people.map((person) => [person.code, false])))} style={{ minHeight: 36, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', borderRadius: 9, padding: '0 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>หยุดทั้งหมด</button>
      </div>
    </div>
    {people.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>ยังไม่มีรายชื่อพนักงานในระบบ</div> : groups.map((group) => <fieldset key={group} style={{ margin: 0, padding: 0, border: 0 }}>
      <legend style={{ marginBottom: 7, color: '#64748b', fontSize: 11, fontWeight: 900 }}>{group}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
        {people.filter((person) => (person.group || 'อื่น ๆ') === group).map((person) => {
          const checked = !!draft[person.code]
          return <label key={person.code} style={{ minHeight: 46, display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', border: `1px solid ${checked ? '#7dd3fc' : '#e2e8f0'}`, borderRadius: 11, background: checked ? '#f0f9ff' : '#fff', color: checked ? '#075985' : '#64748b', cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={(event) => setDraft({ ...draft, [person.code]: event.target.checked })} style={{ width: 18, height: 18, accentColor: '#0284c7' }} />
            <span style={{ minWidth: 0 }}><strong style={{ display: 'block', color: checked ? '#0c4a6e' : '#334155', fontSize: 12 }}>{person.name}</strong><small style={{ fontSize: 9 }}>{person.code}</small></span>
          </label>
        })}
      </div>
    </fieldset>)}
  </div>
}

function DayGroup({ label, rows }) { return <div style={{ marginTop: 7 }}><div style={{ fontSize: 9, fontWeight: 900, color: '#64748b' }}>{label}</div>{rows.map((r) => <div key={r.id} style={{ marginTop: 3, padding: '4px 6px', borderRadius: 8, background: '#fef6da', color: '#8a6d1f', fontSize: 10 }}><b>{r.employee}</b> {r.planned_start}-{r.planned_end}</div>)}</div> }

// ปฏิทินมือถือ — สลับจากตาราง 7 คอลัมน์ (บีบจนอ่านไม่ออก) เป็นแถบเลือกวันแนวนอน + การ์ดรายวันเดียวด้านล่าง
// (อ้างอิงสไตล์: แถบวันที่ด้านบน + timeline การ์ดมีแถบสีด้านซ้าย)
function MobileDayAgenda({ monthDates, activeDate, onSelectDate, computeDayInfo, weekdayLabels, canEditManpower, openSchedule, openOT, deleteEvent }) {
  const stripRef = useRef(null)
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-date="${activeDate}"]`)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeDate])

  const info = computeDayInfo(activeDate)
  const d = new Date(`${activeDate}T00:00:00`)
  const dateLabel = `${weekdayLabels[d.getDay()]} ${d.getDate()} ${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][d.getMonth()]}`
  const sections = [
    info.regularNames.length > 0 && { color: info.lowPackingManpower ? '#dc2626' : '#0369a1', bg: '#e0f2fe', label: 'บ้านล่าง', value: info.regularNames.join(', ') },
    info.feedNames.length > 0 && { color: '#c2410c', bg: '#ffedd5', label: 'คนฟีด', value: info.feedNames.join(', ') },
    info.officePresentNames.length > 0 && { color: '#047857', bg: '#ecfdf5', label: 'ออฟฟิศ', value: info.officePresentNames.join(', ') },
  ].filter(Boolean)

  return <div style={{ padding: '4px 0 14px' }}>
    {/* แถบเลือกวันแนวนอน */}
    <div ref={stripRef} style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 14px 10px', scrollSnapType: 'x proximity' }}>
      {monthDates.map((date) => {
        const dd = new Date(`${date}T00:00:00`)
        const isSel = date === activeDate
        const isToday = date === today()
        const dInfo = computeDayInfo(date)
        const hasContent = dInfo.regularNames.length > 0 || dInfo.feedNames.length > 0 || dInfo.packers.length > 0 || dInfo.partTime.length > 0
        return <button key={date} data-date={date} onClick={() => onSelectDate(date)} style={{
          flexShrink: 0, scrollSnapAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 3px', width: 42,
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: isSel ? 'var(--payi-mint-strong)' : '#94a3b8' }}>{weekdayLabels[dd.getDay()]}</span>
          <span style={{
            width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: '50%', fontSize: 13, fontWeight: 900,
            background: isSel ? 'var(--payi-gradient-primary)' : 'transparent',
            color: isSel ? '#fff' : isToday ? 'var(--payi-mint-strong)' : '#334155',
            border: !isSel && isToday ? '1.5px solid var(--payi-mint)' : 'none',
            boxShadow: isSel ? '0 6px 14px rgba(37,99,235,.28)' : 'none',
          }}>{dd.getDate()}</span>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: hasContent ? (isSel ? 'var(--payi-mint-strong)' : '#94a3b8') : 'transparent' }} />
        </button>
      })}
    </div>

    {/* อาเจนดาของวันที่เลือก */}
    <div style={{ padding: '6px 14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#102a43' }}>{dateLabel}</div>
          {(info.isPromo || info.isFeed) && <div style={{ fontSize: 11, fontWeight: 800, color: info.isPromo ? '#5b4b8a' : '#8a76c0', marginTop: 2 }}>{info.isPromo ? 'วันโปร' : 'เตรียมฟีด'}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canEditManpower && <button type="button" onClick={() => openSchedule(activeDate)} style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 10, padding: '0 12px', background: '#eaf5ff', color: '#155f98', cursor: 'pointer', fontSize: 12, fontWeight: 900 }}><UserRoundPen size={14} /><span>คน</span></button>}
          <button type="button" onClick={() => openOT(activeDate)} style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 10, padding: '0 12px', background: 'var(--payi-gradient-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 900, boxShadow: '0 6px 14px rgba(37,99,235,.22)' }}><Plus size={14} /><span>OT</span></button>
        </div>
      </div>

      {info.promoEvents.map((e) => <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: '#fdf2f8', borderLeft: '4px solid #ec4899' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, color: '#be185d' }}>{e.title}</span>
        <span role="button" aria-label={`ลบ ${e.title}`} onClick={() => deleteEvent(e)} style={{ cursor: 'pointer', color: '#be185d', opacity: .6, fontSize: 16, padding: '0 4px' }}>×</span>
      </div>)}

      {sections.length === 0 && info.packers.length === 0 && info.partTime.length === 0 && info.promoEvents.length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>ไม่มีคนลงวันนี้</div>
      )}

      {sections.map((s) => (
        <div key={s.label} style={{ display: 'flex', gap: 10, marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: s.bg, borderLeft: `4px solid ${s.color}` }}>
          <div style={{ minWidth: 60, fontSize: 11, fontWeight: 900, color: s.color, opacity: .75 }}>{s.label}</div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: s.color }}>{s.value}</div>
        </div>
      ))}

      {info.packers.length > 0 && <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', marginBottom: 6 }}>OT คนแพ็ก</div>
        {info.packers.map((r) => <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 12px', marginBottom: 5, borderRadius: 12, background: '#fef6da', borderLeft: '4px solid #eab308' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#8a6d1f' }}>{r.employee}</span>
          <span style={{ fontSize: 12, color: '#8a6d1f' }}>{r.planned_start}-{r.planned_end}</span>
        </div>)}
      </div>}
      {info.partTime.length > 0 && <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', marginBottom: 6 }}>OT พาร์ทไทม์</div>
        {info.partTime.map((r) => <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 12px', marginBottom: 5, borderRadius: 12, background: '#fef6da', borderLeft: '4px solid #eab308' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#8a6d1f' }}>{r.employee}</span>
          <span style={{ fontSize: 12, color: '#8a6d1f' }}>{r.planned_start}-{r.planned_end}</span>
        </div>)}
      </div>}
    </div>
  </div>
}

const validTime24 = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const timeToMinutes = (v) => { const [h, m] = String(v || '').split(':').map(Number); return (h * 60) + m }
function ManualTime24({ value, onChange }) {
  const format = (raw) => { const digits = String(raw || '').replace(/\D/g, '').slice(0, 4); return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}` }
  return <input value={value} onChange={(e) => onChange(format(e.target.value))} inputMode="numeric" maxLength={5} placeholder="HH:MM" aria-label="เวลาแบบ 24 ชั่วโมง HH:MM" style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 900, fontSize: 17 }} />
}

const groupOtByEmployee = (rows, month) => Object.values(rows.filter((r) => String(r.date || '').startsWith(month)).reduce((acc, r) => {
  const name = r.employee || 'ไม่ระบุชื่อ'
  if (!acc[name]) acc[name] = { name, minutes: 0, actualMinutes: 0, days: new Set(), plans: 0 }
  acc[name].minutes += Number(r.planned_minutes || 0)
  acc[name].actualMinutes += Number(r.actual_minutes || 0)
  acc[name].days.add(r.date)
  acc[name].plans += 1
  return acc
}, {})).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'th'))

// ชั่วโมงติดต่อกันล่าสุด (นับถอยจากวันที่มี OT ล่าสุดของคนนั้น) — ใช้เป็นสัญญาณเตือน burnout แยกจากลิมิตชั่วโมง/เดือน
const consecutiveStreak = (rows, employee) => {
  const dates = [...new Set(rows.filter((r) => r.employee === employee && r.status !== 'cancelled').map((r) => r.date))].filter(Boolean).sort()
  if (!dates.length) return { streak: 0, endDate: null }
  let streak = 1
  for (let i = dates.length - 1; i > 0; i--) {
    const diffDays = Math.round((new Date(`${dates[i]}T00:00:00`) - new Date(`${dates[i - 1]}T00:00:00`)) / 86400000)
    if (diffDays === 1) streak++; else break
  }
  return { streak, endDate: dates[dates.length - 1] }
}

const OT_HUE = { r: 36, g: 116, b: 184 } // น้ำเงินหลักของธีม — ใช้สีเดียวไล่เข้ม-อ่อนแทนเกณฑ์แดง/เหลือง/เขียว เพราะยังไม่มีเกณฑ์ว่าเท่าไหนคือ OT มาก/น้อย/ปกติ
const otShade = (intensity) => ({ bg: intensity === 0 ? '#f8fafc' : `rgba(${OT_HUE.r},${OT_HUE.g},${OT_HUE.b},${0.1 + intensity * 0.55})`, fg: intensity > 0.55 ? '#fff' : intensity === 0 ? '#94a3b8' : '#0f3a5c' })

function OverviewOT({ rows = [], approvals = [], otLimits = {} }) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [monthlyTrend, setMonthlyTrend] = useState([])
  useEffect(() => { fetch('/api/monthly').then((r) => r.json()).then((d) => setMonthlyTrend(d.trend || [])).catch(() => {}) }, [])
  const otMinutesForMonth = (m) => rows.filter((r) => r.status !== 'cancelled' && r.date?.startsWith(m)).reduce((s, r) => s + Number(r.planned_minutes || 0), 0)
  const prevMonth = (() => { const [y, m2] = month.split('-').map(Number); const d = new Date(y, m2 - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const otTrend = { this: otMinutesForMonth(month), prev: otMinutesForMonth(prevMonth), thisOrders: monthlyTrend.find((t) => t.month === month)?.orders, prevOrders: monthlyTrend.find((t) => t.month === prevMonth)?.orders }
  const people = groupOtByEmployee(rows, month)
  const statused = people.map((p) => {
    const approved = approvals.find((a) => a.month === month && a.employee === p.name)
    const actualMinutes = approved ? Number(approved.actual_minutes || 0) : p.actualMinutes
    const rawLimit = otLimits[p.name]; const hasLimit = rawLimit !== '' && rawLimit != null
    const overLimit = hasLimit && p.minutes / 60 > Number(rawLimit)
    const status = overLimit ? 'over' : !approved ? 'pending' : 'ok'
    const { streak, endDate } = consecutiveStreak(rows, p.name)
    return { ...p, approved, actualMinutes, hasLimit, overLimit, status, streak, streakEndDate: endDate }
  }).sort((a, b) => { const order = { over: 0, pending: 1, ok: 2 }; return order[a.status] - order[b.status] || b.minutes - a.minutes })

  const varianceTrend = useMemo(() => {
    const months = [...new Set(rows.map((r) => r.date?.slice(0, 7)).filter(Boolean))].sort().slice(-4)
    return months.map((mo) => {
      const ppl = groupOtByEmployee(rows, mo)
      const planned = ppl.reduce((s, p) => s + p.minutes, 0)
      const actual = ppl.reduce((s, p) => { const a = approvals.find((x) => x.month === mo && x.employee === p.name); return s + (a ? Number(a.actual_minutes || 0) : p.actualMinutes) }, 0)
      const pct = planned ? Math.round(((actual - planned) / planned) * 100) : null
      return { month: mo, planned, actual, pct }
    })
  }, [rows, approvals])

  const totalPlanned = people.reduce((s, p) => s + p.minutes, 0)
  const totalActual = statused.reduce((s, p) => s + p.actualMinutes, 0)
  const overCount = statused.filter((p) => p.status === 'over').length
  const pendingCount = statused.filter((p) => p.status === 'pending').length
  const STATUS_INFO = { over: { label: 'เกินลิมิต', bg: '#fff1f2', fg: '#791f1f', border: '#fecdd3' }, pending: { label: 'รอ approve', bg: '#fef3c7', fg: '#633806', border: '#fde3b8' }, ok: { label: 'ปกติ', bg: '#e7f7f2', fg: '#085041', border: '#dce9f7' } }

  const [year, mo] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mo, 0).getDate()
  const leadBlank = new Date(year, mo - 1, 1).getDay()
  const dayMinutes = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    return rows.filter((r) => r.date === date && r.status !== 'cancelled').reduce((s, r) => s + Number(r.planned_minutes || 0), 0)
  })
  const maxMinutes = Math.max(...dayMinutes, 0)
  const cells = [...Array(leadBlank).fill(null), ...dayMinutes.map((m, i) => ({ day: i + 1, minutes: m, intensity: maxMinutes ? m / maxMinutes : 0 }))]
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const monthTotalMinutes = dayMinutes.reduce((s, m) => s + m, 0)
  const weekSummaries = weeks.map((week, i) => {
    const days = week.filter(Boolean)
    const totalMin = days.reduce((s, d) => s + d.minutes, 0)
    const otDays = days.filter((d) => d.minutes > 0).length
    const share = monthTotalMinutes ? totalMin / monthTotalMinutes : 0
    const desc = otDays ? `รวม ${fmtMinutes(totalMin)} ใน ${otDays} วัน` : 'ไม่มี OT สัปดาห์นี้'
    return { label: `สัปดาห์ ${i + 1}`, desc, share }
  }).filter((w) => w.desc !== 'ไม่มี OT สัปดาห์นี้' || weeks.length <= 5)

  return <section style={{ display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>ดูสีก่อน ตัวเลขค่อยเปิดทีหลัง</div>
      <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inputStyle, width: 160 }} />
    </div>
    <div className="workforce-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
      <Kpi icon={CheckCircle2} label="คนมี OT เดือนนี้" value={`${people.length} คน`} tone="#2474b8" />
      <Kpi icon={CheckCircle2} label="ชม.แผนรวม" value={fmtMinutes(totalPlanned)} tone="#7c5bb6" />
      <Kpi icon={CheckCircle2} label="ชม.จริงรวม (ที่กรอก/approve แล้ว)" value={fmtMinutes(totalActual)} tone="#16866f" />
      <Kpi icon={CheckCircle2} label="เกินลิมิต / รอ approve" value={`${overCount} / ${pendingCount} คน`} tone={overCount ? '#be123c' : '#d97706'} />
    </div>

    <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: '#102a43', marginBottom: 6 }}>แนวโน้ม OT รวม เทียบยอดออเดอร์รายเดือน</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>เป็นแนวโน้มคร่าวๆ ให้ดูเองเท่านั้น — ไม่ auto ตัดสินว่าเกินหรือไม่ เพราะยังไม่มีเกณฑ์ว่าเท่าไหนคือปกติ</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, color: '#334155' }}>
        <div><div style={{ color: '#94a3b8', fontSize: 10 }}>เดือนนี้ ({month})</div>OT รวม {fmtMinutes(otTrend.this)} · ออเดอร์ {otTrend.thisOrders != null ? otTrend.thisOrders.toLocaleString('th-TH') : 'ไม่มีข้อมูล'} รายการ</div>
        <div><div style={{ color: '#94a3b8', fontSize: 10 }}>เดือนก่อน ({prevMonth})</div>OT รวม {fmtMinutes(otTrend.prev)} · ออเดอร์ {otTrend.prevOrders != null ? otTrend.prevOrders.toLocaleString('th-TH') : 'ไม่มีข้อมูล'} รายการ</div>
      </div>
    </div>

    {varianceTrend.length > 0 && <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: '#102a43', marginBottom: 6 }}>แผน vs จริง ย้อนหลัง</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>ดูว่าที่ผ่านมาวางแผนแม่นแค่ไหน (+ = ทำจริงมากกว่าแผน, − = น้อยกว่าแผน)</div>
      <div className="workforce-form-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${varianceTrend.length},1fr)`, gap: 10 }}>
        {varianceTrend.map((v) => <div key={v.month} style={{ fontSize: 12, color: '#334155' }}>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>{v.month}</div>
          <div>แผน {fmtMinutes(v.planned)}</div>
          <div>จริง {fmtMinutes(v.actual)}</div>
          <div style={{ fontWeight: 900 }}>{v.pct == null ? '-' : `${v.pct > 0 ? '+' : ''}${v.pct}%`}</div>
        </div>)}
      </div>
    </div>}

    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }} className="workforce-form-grid">
      <div style={{ ...card, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#102a43' }}>ปฏิทินสีทั้งเดือน</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748b' }}>น้อย<div style={{ width: 60, height: 8, borderRadius: 99, background: `linear-gradient(90deg, ${otShade(0.05).bg}, ${otShade(1).bg})` }} />มาก</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, fontSize: 10, color: '#64748b', textAlign: 'center', marginBottom: 4 }}>{['อา','จ','อ','พ','พฤ','ศ','ส'].map((d) => <div key={d}>{d}</div>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
          {cells.map((c, i) => { if (!c) return <div key={`b-${i}`} />; const info = otShade(c.intensity); return <div key={c.day} title={c.minutes ? fmtMinutes(c.minutes) : 'ไม่มี OT'} style={{ background: info.bg, borderRadius: 6, padding: '4px 2px', textAlign: 'center' }}><div style={{ fontSize: 10, fontWeight: 900, color: info.fg }}>{c.day}</div><div style={{ fontSize: 8, color: info.fg }}>{c.minutes ? fmtMinutes(c.minutes) : '-'}</div></div> })}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        {weekSummaries.map((w) => <div key={w.label} style={{ ...card, padding: '10px 12px', display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><div style={{ fontSize: 12, fontWeight: 900, color: '#102a43' }}>{w.label}</div><div style={{ fontSize: 11, color: '#64748b' }}>{w.desc}</div></div>
          <div style={{ height: 6, borderRadius: 99, background: '#eef2f9', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(w.share * 100)}%`, background: `rgb(${OT_HUE.r},${OT_HUE.g},${OT_HUE.b})`, borderRadius: 99 }} /></div>
        </div>)}
      </div>
    </div>

    <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: '#102a43', marginBottom: 8 }}>สิ่งที่บอสต้องดู</div>
      <div className="workforce-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, fontSize: 11, color: '#475569' }}>
        <div><b style={{ color: '#102a43' }}>1. ดูวันที่สีเข้มที่สุดก่อน</b><br />สีเข้ม = OT วันนั้นมากกว่าวันอื่นในเดือนนี้ (เทียบกันเองในเดือน ยังไม่มีเกณฑ์ตายตัวว่ามากเกินไปหรือไม่)</div>
        <div><b style={{ color: '#102a43' }}>2. ดูแนวโน้มรายสัปดาห์</b><br />สัปดาห์ที่แถบยาวกว่า = สัปดาห์นั้นมี OT สัดส่วนสูงกว่าสัปดาห์อื่นในเดือน</div>
        <div><b style={{ color: '#102a43' }}>3. ดู badge "ติดต่อกัน N วัน"</b><br />คนที่มี OT ติดต่อกันตั้งแต่ 3 วันขึ้นไป น่าจะเหนื่อยสะสม ไม่ใช่แค่ดูชั่วโมงรวม</div>
        <div><b style={{ color: '#102a43' }}>4. ค่อยเปิดตัวเลขเมื่อจำเป็น</b><br />รายละเอียดรายคนอยู่ด้านล่าง</div>
      </div>
    </div>

    <div style={{ display: 'grid', gap: 8 }}>
      {statused.map((p) => { const info = STATUS_INFO[p.status]; return <div key={p.name} style={{ background: '#fff', border: `1px solid ${info.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span style={{ background: info.bg, color: info.fg, fontSize: 11, fontWeight: 900, padding: '3px 9px', borderRadius: 999 }}>{info.label}</span><span style={{ fontSize: 14, fontWeight: 900, color: '#102a43' }}>{p.name}</span>{p.streak >= 3 && <span title={`OT ติดต่อกันถึงวันที่ ${p.streakEndDate}`} style={{ background: '#fef3c7', color: '#633806', fontSize: 10, fontWeight: 900, padding: '3px 9px', borderRadius: 999 }}>ติดต่อกัน {p.streak} วัน</span>}</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#334155' }}>
          <div><div style={{ color: '#94a3b8', fontSize: 10 }}>แผน</div>{fmtMinutes(p.minutes)}</div>
          <div><div style={{ color: '#94a3b8', fontSize: 10 }}>จริง</div>{p.approved || p.actualMinutes ? fmtMinutes(p.actualMinutes) : 'ยังไม่กรอก'}</div>
          <div><div style={{ color: '#94a3b8', fontSize: 10 }}>วันที่ OT</div>{p.days.size} วัน</div>
          <div><div style={{ color: '#94a3b8', fontSize: 10 }}>ลิมิต</div>{p.hasLimit ? `${otLimits[p.name]} ชม.` : 'ไม่จำกัด'}</div>
        </div>
      </div> })}
      {!statused.length && <Empty text="ยังไม่มีแผน OT ในเดือนนี้" />}
    </div>
  </section>
}

function exportOtSummaryCsv(people, month, otLimits) {
  const header = ['ชื่อ', 'จำนวนวันที่มีแผน', 'จำนวนแผน', 'ชม.ที่วางแผน (นาที)', 'ชม.ที่ทำจริง (นาที)', 'ลิมิตต่อเดือน (ชม.)']
  const lines = [header, ...people.map((p) => [p.name, p.days.size, p.plans, p.minutes, p.actualMinutes, otLimits[p.name] ?? ''])]
  const csv = '﻿' + lines.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a'); a.href = url; a.download = `ot-summary-${month}.csv`; a.click(); URL.revokeObjectURL(url)
}

function PlanControlSummary({ rows = [], approvals = [], setApprovals, approvalHistory = [], preview, setError, otLimits = {}, setOtLimits, currentUser, onSaved }) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [actualInputs, setActualInputs] = useState({})
  const [approving, setApproving] = useState('')
  const [unlocked, setUnlocked] = useState({})
  const [historyModal, setHistoryModal] = useState(null)
  const people = groupOtByEmployee(rows, month)

  const approveActual = async (person) => {
    const input = actualInputs[person.name] || {}
    const hasCustomActual = !((input.hours === '' || input.hours == null) && (input.minutes === '' || input.minutes == null))
    const hours = input.hours === '' || input.hours == null ? 0 : Number(input.hours)
    const minutes = input.minutes === '' || input.minutes == null ? 0 : Number(input.minutes)
    if (hasCustomActual && (!Number.isInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59)) return setError?.('กรอกชั่วโมงและนาทีที่ทำจริงให้ถูกต้อง')
    setApproving(person.name); setError?.('')
    try {
      const approvedBy = currentUser?.name || 'Boss'
      const approval = { id: `approve-${month}-${person.name}`, month, employee: person.name, actual_minutes: hasCustomActual ? (hours * 60) + minutes : person.minutes, approved_at: new Date().toISOString(), approved_by: approvedBy }
      if (preview) {
        const next = [...approvals.filter((a) => !(a.month === month && a.employee === person.name)), approval]
        localStorage.setItem('payi-ot-approvals-preview', JSON.stringify(next)); setApprovals?.(next)
      } else {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve-actual-month', month, employee: person.name, actual_minutes: approval.actual_minutes, approved_by: approvedBy }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Approve ไม่สำเร็จ')
        setApprovals?.([...approvals.filter((a) => !(a.month === month && a.employee === person.name)), d.approval])
        await onSaved?.()
      }
      setUnlocked((u) => ({ ...u, [person.name]: false }))
    } catch (e) { setError?.(e.message) } finally { setApproving('') }
  }

  return <section style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <div><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>สรุป OT</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>ชั่วโมงที่วางแผน : ชั่วโมงที่ทำจริง โดยหัวหน้าเป็นผู้กรอกเวลาจริง — approve แล้วจะล็อกไว้ ต้องกด "แก้ไข" ถึงจะเปลี่ยนได้ (มีบันทึกประวัติ)</div></div>
      <div style={{ display: 'flex', gap: 8 }}><button onClick={() => exportOtSummaryCsv(people, month, otLimits)} disabled={!people.length} style={{ border: '1px solid #d7e3ef', background: '#fff', borderRadius: 9, padding: '8px 14px', color: '#155f98', fontWeight: 800, cursor: 'pointer', opacity: people.length ? 1 : .5 }}>ส่งออก CSV</button><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
    </div>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, fontSize: 13 }}><thead><tr style={{ background: '#f0f7fd', textAlign: 'left', color: '#52677a' }}>{['ชื่อ', 'จำนวนวันที่มีแผน', 'จำนวนแผน', 'ชม.ที่วางแผน : ชม.ที่ทำจริง', 'กรอกเวลาจริง / Approve', 'ลิมิตต่อเดือน (ชม.)', 'สถานะลิมิต'].map((h) => <th key={h} style={{ padding: '10px 14px' }}>{h}</th>)}</tr></thead><tbody>{people.map((p) => {
      const approved = approvals.find((a) => a.month === month && a.employee === p.name)
      const actual = approved ? Number(approved.actual_minutes || 0) : p.actualMinutes
      const hasActual = !!approved || actual > 0
      const actualDifference = actual - p.minutes
      const input = actualInputs[p.name] || {}
      const hours = p.minutes / 60; const rawLimit = otLimits[p.name]; const hasLimit = rawLimit !== '' && rawLimit != null; const over = hasLimit && hours > Number(rawLimit)
      const locked = !!approved && !unlocked[p.name]
      const rowHistory = approvalHistory.filter((h) => h.month === month && h.employee === p.name).sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)))
      return <tr key={p.name} style={{ borderTop: '1px solid #e5eef7' }}>
        <td style={{ ...td, fontWeight: 900 }}>{p.name}</td><td style={td}>{p.days.size} วัน</td><td style={td}>{p.plans}</td>
        <td style={{ ...td, fontWeight: 900 }}>
          {fmtMinutes(p.minutes)} <span style={{ color: '#94a3b8' }}>:</span> <span style={{ color: hasActual && actualDifference !== 0 ? '#be123c' : '#16866f' }}>{hasActual ? fmtMinutes(actual) : 'ยังไม่กรอก'}</span>
          {hasActual && actualDifference !== 0 && <div style={{ marginTop: 4, color: '#be123c', fontSize: 10, fontWeight: 800 }}>ไม่ตรงแผน · {actualDifference > 0 ? 'มากกว่า' : 'น้อยกว่า'} {fmtMinutes(Math.abs(actualDifference))}</div>}
        </td>
        <td style={td}>
          {locked
            ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ background: '#e7f7f2', color: '#16866f', borderRadius: 8, padding: '8px 10px', fontWeight: 900, whiteSpace: 'nowrap' }}>Approved</span>
                <span style={{ ...inputStyle, width: 68, padding: '7px 8px', background: '#f8fafc', color: '#94a3b8', display: 'inline-block', textAlign: 'center' }}>{Math.floor(Number(approved.actual_minutes) / 60)} ชม.</span>
                <span style={{ ...inputStyle, width: 72, padding: '7px 8px', background: '#f8fafc', color: '#94a3b8', display: 'inline-block', textAlign: 'center' }}>{Number(approved.actual_minutes) % 60} นาที</span>
                <button onClick={() => setUnlocked((u) => ({ ...u, [p.name]: true }))} style={{ border: '1px solid #d7e3ef', background: '#fff', color: '#155f98', borderRadius: 8, padding: '8px 10px', fontWeight: 900, cursor: 'pointer' }}>แก้ไข</button>
              </div>
            : <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min="0" step="1" value={input.hours ?? (approved ? Math.floor(Number(approved.actual_minutes) / 60) : '')} onChange={(e) => setActualInputs({ ...actualInputs, [p.name]: { ...input, hours: e.target.value } })} placeholder="ชม." aria-label={`ชั่วโมงจริง ${p.name}`} style={{ ...inputStyle, width: 68, padding: '7px 8px' }} />
                <input type="number" min="0" max="59" step="1" value={input.minutes ?? (approved ? Number(approved.actual_minutes) % 60 : '')} onChange={(e) => setActualInputs({ ...actualInputs, [p.name]: { ...input, minutes: e.target.value } })} placeholder="นาที" aria-label={`นาทีจริง ${p.name}`} style={{ ...inputStyle, width: 72, padding: '7px 8px' }} />
                <button onClick={() => approveActual(p)} disabled={approving === p.name} style={{ border: 0, borderRadius: 8, padding: '8px 10px', background: approved ? '#d97706' : '#397fb5', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>{approving === p.name ? '…' : approved ? 'บันทึกการแก้ไข' : 'Approve'}</button>
                {approved && <button onClick={() => { setUnlocked((u) => ({ ...u, [p.name]: false })); setActualInputs((a) => ({ ...a, [p.name]: {} }) )}} style={{ border: '1px solid #d7e3ef', background: '#fff', color: '#64748b', borderRadius: 8, padding: '8px 10px', fontWeight: 800, cursor: 'pointer' }}>ยกเลิก</button>}
              </div>}
          {approved && <div style={{ marginTop: 4, fontSize: 9, color: '#16866f' }}>Approved by {approved.approved_by || 'Boss'} · {new Date(approved.approved_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div>}
          {rowHistory.length > 0 && <button onClick={() => setHistoryModal({ employee: p.name, month })} style={{ marginTop: 4, border: 0, background: 'transparent', color: '#155f98', fontSize: 9, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>ดูรายละเอียด ({rowHistory.length} ครั้ง)</button>}
        </td>
        <td style={td}><input type="number" min="0" step="0.5" value={rawLimit ?? ''} onChange={(e) => setOtLimits?.(p.name, e.target.value)} placeholder="ไม่จำกัด" style={{ ...inputStyle, width: 105, padding: '7px 9px' }} /></td>
        <td style={td}>{over ? <span style={{ color: '#be123c', background: '#fff1f2', borderRadius: 999, padding: '4px 9px', fontWeight: 900 }}>เกินลิมิต</span> : hasLimit ? <span style={{ color: '#16866f', fontWeight: 800 }}>ยังไม่เกิน</span> : <span style={{ color: '#94a3b8' }}>ไม่จำกัด</span>}</td>
      </tr>
    })}</tbody></table>{!people.length && <Empty text="ยังไม่มีแผน OT ในเดือนนี้" />}</div>
    {historyModal && (() => {
      const entries = approvalHistory.filter((h) => h.month === historyModal.month && h.employee === historyModal.employee).sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)))
      return <div onMouseDown={() => setHistoryModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 18 }}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: 'calc(100vw - 36px)', background: '#fff', borderRadius: 18, padding: 20, boxShadow: '0 24px 70px rgba(15,23,42,.22)', maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div><div style={{ fontSize: 17, fontWeight: 900, color: '#102a43' }}>ประวัติการแก้ไข</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{historyModal.employee} · {historyModal.month}</div></div>
            <button onClick={() => setHistoryModal(null)} style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}><X size={18}/></button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
            {entries.map((h) => <div key={h.id} style={{ padding: '9px 11px', borderRadius: 10, background: '#fff7ed', color: '#7c4a13', fontSize: 12 }}>
              <b>{fmtMinutes(h.before_minutes)}</b> → <b>{fmtMinutes(h.after_minutes)}</b>
              <div style={{ marginTop: 3, color: '#9a6b38', fontSize: 11 }}>{new Date(h.changed_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })} · {h.changed_by || 'Boss'}</div>
            </div>)}
            {!entries.length && <Empty text="ไม่มีประวัติ" />}
          </div>
        </div>
      </div>
    })()}
  </section>
}


const miniTab = (on) => ({ border: `1px solid ${on ? '#5ca8df' : '#d7e3ef'}`, borderRadius: 9, padding: '7px 12px', background: on ? '#e9f5ff' : '#fff', color: on ? '#155f98' : '#64748b', fontWeight: 800, cursor: 'pointer' })
function Legend({ color, text }) { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 9, height: 9, background: color, borderRadius: 3 }} />{text}</span> }
