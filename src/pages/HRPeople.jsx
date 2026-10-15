import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Users, Search, X, ExternalLink, RefreshCw, FilePlus2, Printer, Trash2, RotateCcw, Pencil } from 'lucide-react'
import KpiCard from '../components/KpiCard'

const API = '/api/sheet-tools?op=hr-people'

// บอส 2026-09-25: ตัดปุ่มแบบสั้น/เดิม (Google Form เก่า) ออกจากแดชบอร์ด เหลือแค่แบบเต็มทั้งสองฝั่ง
// — ข้อมูลเก่าในแท็บ employees/applicants ไม่ได้ลบทิ้ง แค่ไม่มีปุ่มเข้าถึงจากหน้านี้แล้ว
const VIEWS = [
  { id: 'employees_full', label: 'พนักงาน', icon: Users, formLabel: 'ฟอร์มข้อมูลพนักงาน (บนมือถือ)', formUrl: '/employee.html' },
  { id: 'applicants_full', label: 'ผู้สมัครงาน', icon: FilePlus2, formLabel: 'ฟอร์มใบสมัครงาน (บนมือถือ)', formUrl: '/apply.html' },
  // ลบจากแดชบอร์ด = ย้ายมาเก็บที่นี่ (ไม่หายจริง) กู้คืนกลับได้ — ไม่มีฟอร์มของตัวเอง
  { id: 'deleted', label: 'ประวัติที่ลบ', icon: Trash2 },
]

// ตาราง employees_full/applicants_full มีคอลัมน์เยอะมาก (50-65 คอลัมน์) โชว์ทุกคอลัมน์ในตาราง
// อ่านไม่ไหว — ตารางเลยโชว์แค่สรุปคร่าวๆ ตามนี้ (คลิกแถวหรือกด "ดูทั้งหมด" เพื่อเปิด Drawer ที่มี
// ทุกคอลัมน์จริง). view อื่น (employees/applicants จาก Google Form) header น้อยอยู่แล้ว โชว์ครบปกติ
const SUMMARY_COLUMNS = {
  employees_full: ['ประทับเวลา', 'ชื่อ-นามสกุล', 'ตำแหน่งงาน', 'โทรศัพท์มือถือ', 'วันที่เริ่มงาน'],
  applicants_full: ['ประทับเวลา', 'ชื่อ-นามสกุล', 'ตำแหน่งงานที่สมัคร', 'โทรศัพท์มือถือ'],
}

// ประวัติการศึกษา/ประวัติการทำงานเก็บเป็น JSON array ต่อแถว (มาจาก public/apply.html) —
// แปลงเป็นข้อความอ่านง่ายแทนโชว์ JSON ดิบ
function parseJsonRows(value) {
  try {
    const arr = JSON.parse(value)
    if (Array.isArray(arr) && arr.length && arr.every((x) => x && typeof x === 'object')) return arr
  } catch { /* not JSON, ignore */ }
  return null
}
function JsonRowsView({ value }) {
  const rows = parseJsonRows(value)
  if (!rows) return <LinkOrText value={value} />
  if (!rows.length) return <span style={{ color: 'var(--payi-text-faint)' }}>—</span>
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {rows.map((r, i) => (
        <li key={i} style={{ marginBottom: 2 }}>{Object.values(r).filter(Boolean).join(' · ') || '—'}</li>
      ))}
    </ul>
  )
}

// ป้ายแสดงผลสวยกว่าชื่อ header ดิบจากฟอร์ม — "ประทับเวลา" คือคอลัมน์ที่ Google Forms
// สร้างให้อัตโนมัติ แก้ชื่อในฟอร์มไม่ได้ (ไม่ใช่คำถามจริง) เลยแมปตรงนี้แทน
const HEADER_LABELS = { 'ประทับเวลา': 'วันที่ส่งฟอร์ม' }
const displayLabel = (h) => HEADER_LABELS[h] || h

const isUrl = (v) => /^https?:\/\//i.test(String(v || '').trim())
// คอลัมน์ที่เป็นชื่อคน/หัวข้อหลัก — เดาจากชื่อ header เพื่อโชว์เป็นหัวแถวในตาราง
const nameHint = (h) => /ชื่อ|name|พนักงาน|ผู้สมัคร/i.test(h) && !/บริษัท|เล่น|ผู้ติดต่อ|ฉุกเฉิน|company/i.test(h)

// ==================== PDF ====================
// ตัวสร้างฟอร์มอยู่ที่ public/hr-pdf-form.js (ไฟล์เดียวกับที่ apply.html/employee.html ใช้) — สร้างจาก
// "คำถามในฟอร์ม" เท่านั้น: ทุกคำถามต้องมีในไฟล์ (ไม่มีคำตอบก็เว้นว่าง) อะไรที่ฟอร์มไม่ได้ถามไม่มีในไฟล์
// ที่นี่แค่แปลง row (หัวคอลัมน์ภาษาไทยจากชีต) -> key เดียวกับที่ wizard ใช้ ให้ตรงกับ APPLICANT_FULL_FIELDS /
// EMPLOYEE_FULL_FIELDS ใน api/_lib/hrPeople.js
const PDF_HEADERS = {
  position: ['ตำแหน่งงานที่สมัคร', 'ตำแหน่งงาน'], expected_salary: ['เงินเดือนที่ต้องการ'],
  available_date: ['วันที่เริ่มงานได้'], start_date: ['วันที่เริ่มงาน'], current_status: ['สถานภาพการทำงานปัจจุบัน'],
  documents_ready: ['เอกสารที่เตรียมมา'], id_card_number: ['เลขบัตรประชาชน'], id_card_photo: ['รูปบัตรประชาชน'],
  house_registration_address: ['ที่อยู่ตามทะเบียนบ้าน'], house_registration_photo: ['รูปทะเบียนบ้าน'],
  title: ['คำนำหน้า'], full_name: ['ชื่อ-นามสกุล'], nickname: ['ชื่อเล่น'], age: ['อายุ'], birth_date: ['วันเดือนปีเกิด'],
  nationality: ['สัญชาติ'], ethnicity: ['เชื้อชาติ'], religion: ['ศาสนา'], hometown: ['ภูมิลำเนาเดิม'],
  siblings: ['จำนวนพี่น้อง'], birth_order: ['เป็นบุตรคนที่'], address: ['ที่อยู่ปัจจุบัน'], sub_district: ['ตำบล/แขวง'],
  district: ['อำเภอ/เขต'], province: ['จังหวัด'], postal_code: ['รหัสไปรษณีย์'], home_phone: ['โทรศัพท์บ้าน'],
  mobile_phone: ['โทรศัพท์มือถือ'], email: ['Email'], residence_type: ['ประเภทที่อยู่อาศัย'],
  residence_years: ['อาศัยมาแล้ว (ปี)'], marital_status: ['สถานภาพครอบครัว'], spouse_name: ['ชื่อคู่สมรส'],
  spouse_occupation: ['อาชีพคู่สมรส'], children_count: ['จำนวนบุตร'], weight: ['น้ำหนัก (กก.)'], height: ['ส่วนสูง (ซม.)'],
  blood_type: ['กรุ๊ปเลือด'], criminal_record: ['ประวัติอาชญากรรม'], health_condition: ['โรคประจำตัว/สุขภาพ'],
  father_name: ['ชื่อบิดา'], father_status: ['สถานะบิดา'], father_address: ['ที่อยู่/จังหวัดบิดา'],
  mother_name: ['ชื่อมารดา'], mother_status: ['สถานะมารดา'], mother_address: ['ที่อยู่/จังหวัดมารดา'],
  military_status: ['สถานะทางการทหาร'], education_level: ['วุฒิการศึกษาที่ใช้สมัคร', 'วุฒิการศึกษาสูงสุด'],
  education_history: ['ประวัติการศึกษา'], education_activities: ['กิจกรรม/รางวัลระหว่างการศึกษา'],
  favorite_subject: ['สาขาที่ชอบเป็นพิเศษ'], work_history: ['ประวัติการทำงาน'],
  english_speak: ['ภาษาอังกฤษ (พูด)'], english_read: ['ภาษาอังกฤษ (อ่าน)'], english_write: ['ภาษาอังกฤษ (เขียน)'],
  other_language: ['ภาษาอื่นๆ'], office_skills: ['ความสามารถใช้เครื่องใช้สำนักงาน'], computer_level: ['ความสามารถใช้คอมพิวเตอร์'],
  computer_programs: ['โปรแกรมที่ใช้ได้'], reference_name: ['บุคคลอ้างอิง (ชื่อ/ความสัมพันธ์)'],
  reference_occupation: ['บุคคลอ้างอิง (อาชีพ)'], reference_phone: ['บุคคลอ้างอิง (เบอร์โทร)'], heard_from: ['ทราบข่าวการสมัครงานจาก'],
  bank_name: ['ธนาคาร'], bank_account_number: ['เลขบัญชี'], bank_account_name: ['ชื่อบัญชี'],
  emergency_contact_name: ['บุคคลที่ติดต่อได้กรณีฉุกเฉิน (ชื่อ)'], emergency_contact_relation: ['ความสัมพันธ์'],
  emergency_contact_phone: ['เบอร์โทรฉุกเฉิน'], confirmed: ['ยืนยันข้อมูลถูกต้อง'],
}

let hrPdfScript = null
function loadHrPdfForm() {
  if (window.HRPdfForm) return Promise.resolve()
  if (!hrPdfScript) {
    hrPdfScript = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = '/hr-pdf-form.js'
      s.onload = resolve
      s.onerror = () => { hrPdfScript = null; reject(new Error('โหลดตัวสร้าง PDF ไม่สำเร็จ')) }
      document.head.appendChild(s)
    })
  }
  return hrPdfScript
}

function LockedApplicationForm({ row }) {
  const [ready, setReady] = useState(!!window.HRPdfForm)
  useEffect(() => { loadHrPdfForm().then(() => setReady(true)).catch(() => {}) }, [])
  if (!ready) return null
  const isEmployee = row['เลขบัตรประชาชน'] !== undefined
  const get = (key) => {
    const header = (PDF_HEADERS[key] || []).find((h) => row[h] !== undefined && row[h] !== '')
    const v = header ? row[header] : ''
    if (key === 'education_history' || key === 'work_history') return parseJsonRows(v) || []
    return v
  }
  return <div dangerouslySetInnerHTML={{ __html: window.HRPdfForm.build(get, isEmployee ? 'employee' : 'applicant') }} />
}

function LinkOrText({ value }) {
  if (isUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--payi-mint-strong)', fontWeight: 600 }}>
        <ExternalLink size={13} /> เปิดไฟล์
      </a>
    )
  }
  return <>{value || <span style={{ color: 'var(--payi-text-faint)' }}>—</span>}</>
}

// ==================== แก้ไขข้อมูล ====================
// ฟอร์มแก้ไขสร้างจากรายการคำถามชุดเดียวกับ PDF/wizard (window.HRPdfForm.sections จาก public/hr-pdf-form.js)
// — เพิ่ม/แก้คำถามที่ SECTIONS ที่เดียว ฟอร์มแก้ไข + PDF + ฟอร์มเปล่า ตามกันหมด ส่งขึ้นไปเฉพาะช่องที่แก้จริง
// (server เช็คประทับเวลา/จดประวัติลงแท็บ hr_edit_log) ช่องที่แก้ไม่ได้: รูปบัตร/ทะเบียนบ้าน (เป็นลิงก์ Drive)
const MULTI_KEYS = new Set(['documents_ready', 'office_skills', 'computer_programs'])
const splitList = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean)
const OTHER_RE = /^อื่นๆ:?\s*/
const normTableRows = (rows, cols) => (rows || [])
  .map((r) => ({ ...r, ...Object.fromEntries(cols.map(([k]) => [k, String(r[k] ?? '').trim()])) }))
  .filter((r) => cols.some(([k]) => r[k]))

const editInput = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--payi-border)', fontSize: 14, background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', boxSizing: 'border-box', fontFamily: 'inherit' }
const editLabel = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 4 }

// โหลด SECTIONS (สคริปต์ตัวสร้าง PDF) ก่อน แล้วค่อยเปิดฟอร์มจริง — ฟอร์มตั้งค่าเริ่มต้นตอน mount ครั้งเดียว
function RecordEditor(props) {
  const [sections, setSections] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    loadHrPdfForm().then(() => setSections(window.HRPdfForm.sections[props.kind])).catch(() => setErr('โหลดฟอร์มแก้ไขไม่สำเร็จ ลองรีเฟรชหน้า'))
  }, [props.kind])
  if (!sections) return <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>{err || 'กำลังโหลดฟอร์มแก้ไข...'}</div>
  return <RecordEditorForm {...props} sections={sections} />
}

function RecordEditorForm({ row, headers, sections, onCancel, onSave }) {
  // key ของคำถาม -> หัวคอลัมน์จริงในชีตของ view นี้ (บางคำถามหัวต่างกันระหว่างผู้สมัคร/พนักงาน)
  const headerOf = (key) => (PDF_HEADERS[key] || []).find((h) => headers.includes(h))
  const eachItem = (fn) => {
    for (const sec of sections) for (const r of sec.rows) for (const it of r) {
      const h = headerOf(it.key)
      if (h && it.t !== 'ok' && it.t !== 'f') fn(it, h, sec)
    }
  }
  const [vals, setVals] = useState(() => {
    const v = {}
    eachItem((it, h) => {
      const raw = row[h] ?? ''
      if (it.t === 'table') v[it.key] = parseJsonRows(raw) || []
      else if (it.t === 'y') v[it.key] = raw === 'ไม่มี' ? { mode: 'no', detail: '' } : raw ? { mode: 'yes', detail: raw === 'มี' ? '' : raw } : { mode: '', detail: '' }
      else if (it.t === 'c' && MULTI_KEYS.has(it.key)) v[it.key] = splitList(raw)
      else v[it.key] = raw
    })
    return v
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('') // ค้นหาช่องจากชื่อช่อง/หัวข้อ — ฟอร์มยาว ไม่ต้องเลื่อนหา

  const set = (key, value) => setVals((p) => ({ ...p, [key]: value }))

  const save = async () => {
    const changes = {}
    eachItem((it, h) => {
      const v = vals[it.key]
      let nv
      if (it.t === 'table') {
        const next = normTableRows(v, it.cols)
        if (JSON.stringify(next) === JSON.stringify(normTableRows(parseJsonRows(row[h]) || [], it.cols))) return
        nv = JSON.stringify(next)
      } else if (it.t === 'y') {
        nv = v.mode === 'no' ? 'ไม่มี' : v.mode === 'yes' ? (v.detail.trim() || 'มี') : ''
      } else if (it.t === 'c' && MULTI_KEYS.has(it.key)) {
        nv = v.join(', ')
      } else {
        nv = String(v ?? '').trim()
      }
      if (nv !== String(row[h] ?? '').trim()) changes[h] = nv
    })
    if (!Object.keys(changes).length) { onCancel(); return }
    setSaving(true); setErr('')
    try { await onSave(changes) } catch (e) { setErr(e.message || 'บันทึกไม่สำเร็จ'); setSaving(false) }
  }

  const renderItem = (it, sec) => {
    const h = headerOf(it.key)
    if (!h) return null
    const label = it.label || sec.title
    if (it.t === 'f') {
      return (
        <div key={it.key}><div style={editLabel}>{label}</div>
          <div style={{ fontSize: 13 }}><LinkOrText value={row[h]} /> <span style={{ color: 'var(--payi-text-faint)' }}>(แก้ไม่ได้ — ไฟล์เก็บใน Drive)</span></div></div>
      )
    }
    if (it.t === 'ok') return null
    const v = vals[it.key]
    let control = null
    if (it.t === 't') {
      control = (it.grow || 1) >= 3
        ? <textarea rows={2} value={v} onChange={(e) => set(it.key, e.target.value)} style={editInput} />
        : <input value={v} onChange={(e) => set(it.key, e.target.value)} style={editInput} />
    } else if (it.t === 'c' && MULTI_KEYS.has(it.key)) {
      const hasOther = v.some((x) => x.startsWith('อื่นๆ'))
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {it.options.map((o) => {
            const checked = o === 'อื่นๆ' ? hasOther : v.includes(o)
            return (
              <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={checked} onChange={(e) => {
                  const rest = v.filter((x) => (o === 'อื่นๆ' ? !x.startsWith('อื่นๆ') : x !== o))
                  set(it.key, e.target.checked ? [...rest, o] : rest)
                }} /> {o}
              </label>
            )
          })}
          {hasOther && it.key === 'computer_programs' && (
            <input placeholder="อื่นๆ (ระบุ)" style={editInput}
              value={(v.find((x) => x.startsWith('อื่นๆ')) || '').replace(OTHER_RE, '')}
              onChange={(e) => {
                const d = e.target.value.replace(/,/g, ' ')
                set(it.key, v.map((x) => (x.startsWith('อื่นๆ') ? (d.trim() ? `อื่นๆ: ${d}` : 'อื่นๆ') : x)))
              }} />
          )}
        </div>
      )
    } else if (it.t === 'c') {
      const opts = v && !it.options.includes(v) ? [v, ...it.options] : it.options // ค่าเดิมที่ไม่อยู่ในตัวเลือก ไม่ทิ้ง
      control = (
        <select value={v} onChange={(e) => set(it.key, e.target.value)} style={editInput}>
          <option value="">—</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    } else if (it.t === 'y') {
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 14, fontSize: 14 }}>
            {[['no', 'ไม่มี'], ['yes', 'มี (ระบุ)']].map(([m, t]) => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="radio" name={`y-${it.key}`} checked={v.mode === m} onChange={() => set(it.key, { ...v, mode: m })} /> {t}
              </label>
            ))}
          </div>
          {v.mode === 'yes' && <textarea rows={2} placeholder="ระบุ" value={v.detail} onChange={(e) => set(it.key, { ...v, detail: e.target.value })} style={editInput} />}
        </div>
      )
    } else if (it.t === 'table') {
      const rows = v
      const setCell = (i, k, val) => set(it.key, rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)))
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ border: '1px solid var(--payi-border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {it.cols.map(([k, lbl]) => (
                <div key={k}><div style={{ ...editLabel, fontWeight: 600 }}>{lbl}</div>
                  <input value={r[k] ?? ''} onChange={(e) => setCell(i, k, e.target.value)} style={editInput} /></div>
              ))}
              <button type="button" onClick={() => set(it.key, rows.filter((_, j) => j !== i))}
                style={{ alignSelf: 'flex-end', border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>ลบแถวนี้</button>
            </div>
          ))}
          <button type="button" onClick={() => set(it.key, [...rows, {}])}
            style={{ alignSelf: 'flex-start', border: '1px dashed var(--payi-border)', background: 'transparent', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--payi-mint-strong)', fontWeight: 600 }}>+ เพิ่มแถว</button>
        </div>
      )
    }
    return <div key={it.key}><div style={editLabel}>{label}</div>{control}</div>
  }

  const term = q.trim().toLowerCase()
  const matches = (it, sec) => !term || (it.label || '').toLowerCase().includes(term) || sec.title.toLowerCase().includes(term)
  const blocks = sections.map((sec, i) => ({
    sec, i, items: sec.rows.flat().filter((it) => matches(it, sec)).map((it) => renderItem(it, sec)).filter(Boolean),
  })).filter((b) => b.items.length)
  const jump = (i) => { const el = document.getElementById(`edit-sec-${i}`); if (el) el.scrollIntoView({ block: 'start' }) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ position: 'sticky', top: -24, zIndex: 2, background: 'var(--payi-surface)', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--payi-border)' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาช่อง เช่น เบอร์ / ที่อยู่ / ชื่อเล่น" style={editInput} />
        {!term && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {blocks.map((b) => (
              <button key={b.sec.title} type="button" onClick={() => jump(b.i)}
                style={{ border: '1px solid var(--payi-border)', background: 'var(--payi-surface-muted, transparent)', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--payi-text-strong)' }}>{b.sec.title}</button>
            ))}
          </div>
        )}
      </div>
      {!blocks.length && <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ไม่พบช่องที่ค้นหา</div>}
      {blocks.map(({ sec, i, items }) => (
        <div key={sec.title} id={`edit-sec-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 90 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--payi-text-strong)', borderBottom: '1px solid var(--payi-border)', paddingBottom: 4 }}>{sec.title}</div>
          {items}
        </div>
      ))}
      {err && <div style={{ color: 'var(--payi-danger, #b91c1c)', fontSize: 13 }}>{err}</div>}
      <div style={{ position: 'sticky', bottom: -24, background: 'var(--payi-surface)', padding: '12px 0', display: 'flex', gap: 8, borderTop: '1px solid var(--payi-border)' }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, border: 'none', borderRadius: 10, padding: '10px 14px', cursor: saving ? 'default' : 'pointer', fontSize: 14, fontWeight: 700, color: '#fff', background: 'var(--payi-gradient-primary)', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
        <button onClick={onCancel} disabled={saving}
          style={{ border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--payi-text-strong)' }}>ยกเลิก</button>
      </div>
    </div>
  )
}

// พิมพ์เฉพาะเนื้อหา drawer (ซ่อนทุกอย่างอื่นตอนสั่งพิมพ์) — ไม่ต้องใช้ library, ใช้ browser
// print เดิม เหมือน public/apply.html แค่ scope ด้วย class .hr-print-area แทน
function DetailDrawer({ row, headers, kind, onClose, onDelete, onRestore, onSave }) {
  const [editing, setEditing] = useState(false)
  if (!row) return null
  return (
    <div onClick={editing ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      {/* พิมพ์: ฟอร์มถูก portal ออกไปเป็นลูกตรงของ <body> (ดูด้านล่าง) แล้วซ่อนทุกอย่างอื่นด้วย display:none
          — ห้ามใช้วิธีซ่อนด้วย visibility + จัด position ให้ drawer เอง เพราะ drawer อยู่ใต้ overlay
          ที่เป็น position:fixed (ancestor แบบ fixed ขังเนื้อหาไว้แค่ 1 หน้ากระดาษ ต่อให้ลูกเป็น
          absolute ก็ตาม — บั๊ก "1/1 หน้า" ที่เจอ 2026-09-19) */}
      <style>{`
        @media print {
          body > *:not(.hr-print-portal) { display: none !important; }
          .hr-print-portal { display: block !important; position: static !important; width: 100% !important; padding: 12mm !important; box-sizing: border-box !important; }
        }
        .hr-print-portal { display: none; }
      `}</style>
      <div className="app-side-drawer" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--payi-surface)', width: 'min(460px,100vw)', height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 16, color: 'var(--payi-text-strong)' }}>{editing ? 'แก้ไขข้อมูล' : 'รายละเอียด'}</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!editing && onSave && (
              <button onClick={() => setEditing(true)} title="แก้ไขข้อมูล"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-mint-strong)' }}>
                <Pencil size={14} /> แก้ไขข้อมูล
              </button>
            )}
            {!editing && <button onClick={() => window.print()} title="สร้าง PDF / พิมพ์"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-text-strong)' }}>
              <Printer size={14} /> สร้าง PDF
            </button>}
            {onDelete && !editing && (
              <button onClick={onDelete} title="ลบ (ย้ายไปประวัติที่ลบ กู้คืนได้)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>
                <Trash2 size={14} /> ลบ
              </button>
            )}
            {onRestore && !editing && (
              <button onClick={onRestore} title="กู้คืนกลับไปที่เดิม"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-mint-strong)' }}>
                <RotateCcw size={14} /> กู้คืน
              </button>
            )}
            <button onClick={editing ? () => setEditing(false) : onClose} title={editing ? 'ยกเลิกการแก้ไข' : 'ปิด'} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--payi-text-muted)' }}><X size={20} /></button>
          </div>
        </div>
        {editing ? (
          <RecordEditor row={row} headers={headers} kind={kind} onCancel={() => setEditing(false)}
            onSave={async (changes) => { await onSave(changes); setEditing(false) }} />
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {headers.map((h) => (
            <div key={h}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--payi-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>{displayLabel(h)}</div>
              <div style={{ fontSize: 14, color: 'var(--payi-text-strong)', wordBreak: 'break-word' }}><JsonRowsView value={row[h]} /></div>
            </div>
          ))}
        </div>
        )}
      </div>
      {createPortal(<div className="hr-print-portal"><LockedApplicationForm row={row} /></div>, document.body)}
    </div>
  )
}

function SetupHint() {
  return (
    <div className="payi-glass-card" style={{ padding: 24, lineHeight: 1.7, fontSize: 14, color: 'var(--payi-text-strong)' }}>
      <strong style={{ fontSize: 15 }}>ยังไม่ได้ตั้งค่า HR spreadsheet</strong>
      <ol style={{ paddingLeft: 20, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>สร้าง Google Sheet ใหม่ (แยกจาก mona-ops-db) — <b>อย่าเปิดแชร์แบบลิงก์</b> เพราะมีเลขบัตร ปชช/ทะเบียนบ้าน</li>
        <li>แชร์ชีตให้ service account (อีเมล <code>...iam.gserviceaccount.com</code>) สิทธิ์ผู้อ่าน</li>
        <li>สร้าง Google Form 2 อัน: ข้อมูลพนักงาน + ใบสมัครงาน ผูกคำตอบเข้าชีตนี้</li>
        <li>เปลี่ยนชื่อแท็บคำตอบเป็น <code>employees</code> และ <code>applicants</code> (หรือตั้ง env <code>HR_EMP_TAB</code>/<code>HR_APPLICANT_TAB</code>)</li>
        <li>ตั้ง env <code>HR_SHEET_ID</code> = id จาก URL ของชีต แล้ว redeploy</li>
      </ol>
      <p style={{ marginTop: 12, color: 'var(--payi-text-muted)' }}>รูปบัตร/ทะเบียนบ้านที่อัปโหลดผ่านฟอร์มจะเก็บใน Google Drive ของเจ้าของฟอร์ม — หน้านี้แสดงเป็นลิงก์ให้กดเปิด</p>
    </div>
  )
}

export default function HRPeople() {
  const [view, setView] = useState('employees_full')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(() => {
    setLoading(true); setErr('')
    fetch(`${API}&view=${view}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.success && d.error) setErr(d.error)
        setData(d)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [view])

  useEffect(() => { load() }, [load])

  const isTrash = view === 'deleted'
  const post = (body) => fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { try { return await r.json() } catch { return { success: false, error: `เซิร์ฟเวอร์ตอบผิดปกติ (รหัส ${r.status}) ลองใหม่อีกครั้ง` } } })

  // ลบ = ย้ายไปประวัติที่ลบ (server เช็คว่าแถวยังเป็นคนเดิมจริงก่อนลบ กันเลขแถวเลื่อนจนลบผิดคน)
  const deleteRow = async (row) => {
    const name = row[nameColRef.current] || 'รายการนี้'
    if (!window.confirm(`ลบ "${name}" ?\n\nข้อมูลจะถูกย้ายไปแท็บ "ประวัติที่ลบ" ยังกู้คืนได้`)) return
    try {
      const d = await post({ action: 'delete-person', view, row: row.__row, ts: row['ประทับเวลา'] })
      if (!d.success) throw new Error(d.error || 'ลบไม่สำเร็จ')
      setSelected(null)
      load()
    } catch (e) { window.alert(e.message) }
  }
  // แก้ไข: ส่งเฉพาะช่องที่เปลี่ยน — สำเร็จแล้วอัปเดตแถวที่เปิดอยู่ทันที (PDF ที่สร้างจากแถวนี้เลยเป็นข้อมูลใหม่) แล้วโหลดตารางใหม่
  const saveEdit = async (changes) => {
    const d = await post({ action: 'update-person', view, row: selected.__row, ts: selected['ประทับเวลา'], changes })
    if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
    setSelected((s) => ({ ...s, ...changes }))
    load()
  }
  const restoreRow = async (row) => {
    if (!window.confirm(`กู้คืน "${row['ชื่อ'] || 'รายการนี้'}" กลับไปที่เดิม?`)) return
    try {
      const d = await post({ action: 'restore-person', id: row.__row })
      if (!d.success) throw new Error(d.error || 'กู้คืนไม่สำเร็จ')
      setSelected(null)
      load()
    } catch (e) { window.alert(e.message) }
  }

  const activeView = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const headers = data.headers || []
  const rows = data.rows || []
  const nameCol = useMemo(() => headers.find(nameHint) || headers[1] || headers[0], [headers])
  const nameColRef = useRef(nameCol)
  nameColRef.current = nameCol
  // แบบเต็ม (employees_full/applicants_full) คอลัมน์เยอะเกินโชว์ในตารางไหว — โชว์แค่สรุป
  // แล้วให้กด "ดูทั้งหมด" เปิด Drawer แทน (Drawer ยังโชว์ headers ครบทุกคอลัมน์เหมือนเดิม)
  const summaryDef = SUMMARY_COLUMNS[view]
  const tableCols = summaryDef ? summaryDef.filter((h) => headers.includes(h)) : headers
  const isSummaryView = !!summaryDef

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter((row) => headers.some((h) => String(row[h] || '').toLowerCase().includes(t)))
  }, [rows, headers, q])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => { setView(v.id); setQ('') }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600,
              border: '1px solid var(--payi-border)',
              background: view === v.id ? 'var(--payi-mint)' : 'var(--payi-surface)',
              color: view === v.id ? '#fff' : 'var(--payi-text-strong)',
            }}>
            <v.icon size={15} /> {v.label}
          </button>
        ))}
        <button onClick={load} title="โหลดใหม่"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', color: 'var(--payi-text-muted)' }}>
          <RefreshCw size={14} />
        </button>
        {!isTrash && (
          <a href={activeView.formUrl} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, border: 'none', background: 'var(--payi-gradient-primary)', color: '#fff', textDecoration: 'none', marginLeft: 'auto' }}>
            <FilePlus2 size={15} /> เปิด{activeView.formLabel}
          </a>
        )}
        {(view === 'applicants_full' || view === 'employees_full') && (
          <a href={`/blank-form.html?kind=${view === 'employees_full' ? 'employee' : 'applicant'}`} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', textDecoration: 'none' }}>
            <Printer size={15} /> ฟอร์ม PDF ว่าง (ปริ้นกรอกมือ)
          </a>
        )}
      </div>
      {isTrash ? (
        <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--payi-text-faint)' }}>
          รายการที่ลบจากแท็บอื่นจะมาอยู่ที่นี่ ข้อมูลครบทุกช่อง คลิกแถวเพื่อดู หรือกด "กู้คืน" เพื่อส่งกลับไปที่เดิม
        </p>
      ) : (
        <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--payi-text-faint)' }}>
          ส่งลิงก์นี้ให้พนักงาน/ผู้สมัครกรอกได้เลย: <a href={activeView.formUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--payi-mint-strong)' }}>{activeView.formUrl}</a>
        </p>
      )}

      {data.configured === false ? (
        <SetupHint />
      ) : (
        <>
          <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <KpiCard title={VIEWS.find((v) => v.id === view).label} value={loading ? '…' : rows.length} subtitle="รายการทั้งหมด" icon={Users} />
            <KpiCard title="แสดงอยู่" value={loading ? '…' : filtered.length} subtitle={q ? `กรอง: "${q}"` : 'ไม่ได้กรอง'} icon={Search} />
          </div>

          <div style={{ position: 'relative', maxWidth: 340 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--payi-text-faint)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา ชื่อ / เบอร์ / ที่อยู่ ..."
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 10, border: '1px solid var(--payi-border)', fontSize: 14, background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', boxSizing: 'border-box' }} />
          </div>

          {err && <div style={{ color: 'var(--payi-danger)', fontSize: 13 }}>{err}</div>}

          {isSummaryView && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--payi-text-faint)' }}>
              โชว์คร่าวๆ {tableCols.length} คอลัมน์ — คลิกแถวหรือกด "ดูทั้งหมด" เพื่อดูข้อมูลทุกช่องจริงๆ
            </p>
          )}
          <div className="payi-glass-card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr>
                  {tableCols.map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--payi-border)', color: 'var(--payi-text-muted)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em' }}>{displayLabel(h)}</th>
                  ))}
                  {(isSummaryView || isTrash) && <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--payi-border)' }} />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.__row} onClick={() => setSelected(row)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--payi-border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--payi-surface-muted)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {tableCols.map((h) => (
                      <td key={h} style={{ padding: '9px 12px', color: 'var(--payi-text-strong)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: h === nameCol ? 700 : 400 }}>
                        {parseJsonRows(row[h])
                          ? `${parseJsonRows(row[h]).length} รายการ (คลิกดูรายละเอียด)`
                          : isUrl(row[h]) ? <LinkOrText value={row[h]} /> : (row[h] || '—')}
                      </td>
                    ))}
                    {isTrash && (
                      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                        <button onClick={(e) => { e.stopPropagation(); restoreRow(row) }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-mint-strong)' }}>
                          <RotateCcw size={13} /> กู้คืน
                        </button>
                      </td>
                    )}
                    {isSummaryView && (
                      <td style={{ padding: '9px 12px' }}>
                        <button onClick={(e) => { e.stopPropagation(); setSelected(row) }}
                          style={{ border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-mint-strong)', whiteSpace: 'nowrap' }}>
                          ดูทั้งหมด
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && !filtered.length && (
                  <tr><td colSpan={Math.max(tableCols.length, 1)} style={{ padding: 24, textAlign: 'center', color: 'var(--payi-text-muted)' }}>ไม่มีข้อมูล</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && (isTrash
        ? <DetailDrawer row={selected.__data || {}} headers={Object.keys(selected.__data || {})} onClose={() => setSelected(null)} onRestore={() => restoreRow(selected)} />
        : <DetailDrawer row={selected} headers={headers} kind={view === 'employees_full' ? 'employee' : 'applicant'} onClose={() => setSelected(null)} onDelete={() => deleteRow(selected)} onSave={saveEdit} />)}
    </div>
  )
}
