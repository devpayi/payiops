import { useEffect, useMemo, useState, useCallback } from 'react'
import { Users, UserPlus, Search, X, ExternalLink, RefreshCw, FilePlus2, Printer } from 'lucide-react'
import KpiCard from '../components/KpiCard'

const API = '/api/sheet-tools?op=hr-people'

const VIEWS = [
  { id: 'employees', label: 'พนักงาน (เดิม)', icon: Users, formLabel: 'ฟอร์มข้อมูลพนักงาน (เดิม)', formUrl: 'https://docs.google.com/forms/d/1hxqaPqkZfiOaR7Hclm5XtBYrZTnS4vHdf7p4KviBVTk/viewform' },
  { id: 'employees_full', label: 'พนักงาน (แบบเต็ม)', icon: Users, formLabel: 'ฟอร์มข้อมูลพนักงาน (แบบเต็ม บนมือถือ)', formUrl: '/employee.html' },
  { id: 'applicants', label: 'ผู้สมัครงาน (แบบสั้น)', icon: UserPlus, formLabel: 'ฟอร์มใบสมัครงาน (แบบสั้น)', formUrl: 'https://docs.google.com/forms/d/1sjhYp5tFwJlvuhpa5yT0DwPOVutZdmxXmBnENiWs_AM/viewform' },
  { id: 'applicants_full', label: 'ผู้สมัครงาน (แบบเต็ม)', icon: FilePlus2, formLabel: 'ฟอร์มใบสมัครงาน (แบบเต็ม บนมือถือ)', formUrl: '/apply.html' },
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

// จัดกลุ่มหัวข้อสำหรับ PDF ให้หน้าตาเหมือนแบบฟอร์ม HR จริง (กล่องมีหัวข้อ + ตาราง 2 คอลัมน์)
// แทนโชว์เป็น list เดี่ยวๆ ยาวเป็นหางว่าว — ใช้ label ไทยตรงตาม APPLICANT_FULL_FIELDS/
// EMPLOYEE_FULL_FIELDS ใน api/_lib/hrPeople.js (คนละไฟล์ ไม่ import ข้ามกันได้ เพราะฝั่งนั้น
// เป็น backend — ถ้าเปลี่ยน label ตรงนั้น ต้องมาแก้ที่นี่ด้วย)
const PROFILE_SECTIONS = [
  { title: 'ข้อมูลตำแหน่งงาน', headers: ['ตำแหน่งงานที่สมัคร', 'ตำแหน่งงาน', 'เงินเดือนที่ต้องการ', 'วันที่เริ่มงานได้', 'วันที่เริ่มงาน', 'สถานภาพการทำงานปัจจุบัน', 'เอกสารที่เตรียมมา'] },
  { title: 'เอกสารประจำตัว', headers: ['เลขบัตรประชาชน', 'รูปบัตรประชาชน', 'ที่อยู่ตามทะเบียนบ้าน', 'รูปทะเบียนบ้าน'] },
  { title: 'ข้อมูลส่วนตัว', headers: ['คำนำหน้า', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'อายุ', 'วันเดือนปีเกิด', 'สัญชาติ', 'เชื้อชาติ', 'ศาสนา', 'ภูมิลำเนาเดิม', 'จำนวนพี่น้อง', 'เป็นบุตรคนที่'] },
  { title: 'ที่อยู่และการติดต่อ', headers: ['ที่อยู่ปัจจุบัน', 'ตำบล/แขวง', 'อำเภอ/เขต', 'จังหวัด', 'รหัสไปรษณีย์', 'โทรศัพท์บ้าน', 'โทรศัพท์มือถือ', 'Email'] },
  { title: 'ที่พักอาศัย/ครอบครัว', headers: ['ประเภทที่อยู่อาศัย', 'อาศัยมาแล้ว (ปี)', 'สถานภาพครอบครัว', 'ชื่อคู่สมรส', 'อาชีพคู่สมรส', 'จำนวนบุตร'] },
  { title: 'สุขภาพและประวัติ', headers: ['กรุ๊ปเลือด', 'น้ำหนัก (กก.)', 'ส่วนสูง (ซม.)', 'ประวัติอาชญากรรม', 'โรคประจำตัว/สุขภาพ'] },
  { title: 'ข้อมูลบิดา-มารดา', headers: ['ชื่อบิดา', 'สถานะบิดา', 'อาชีพบิดา', 'ที่อยู่/จังหวัดบิดา', 'ชื่อมารดา', 'สถานะมารดา', 'อาชีพมารดา', 'ที่อยู่/จังหวัดมารดา'] },
  { title: 'สถานะทางการทหาร', headers: ['สถานะทางการทหาร'] },
  { title: 'ประวัติการศึกษา', headers: ['วุฒิการศึกษาที่ใช้สมัคร', 'วุฒิการศึกษาสูงสุด', 'ประวัติการศึกษา', 'กิจกรรม/รางวัลระหว่างการศึกษา', 'สาขาที่ชอบเป็นพิเศษ'] },
  { title: 'ประสบการณ์การทำงาน', headers: ['ประวัติการทำงาน'] },
  { title: 'ทักษะและความสามารถ', headers: ['ภาษาอังกฤษ (พูด)', 'ภาษาอังกฤษ (อ่าน)', 'ภาษาอังกฤษ (เขียน)', 'ภาษาอื่นๆ', 'ความสามารถใช้เครื่องใช้สำนักงาน', 'ความสามารถใช้คอมพิวเตอร์', 'โปรแกรมที่ใช้ได้'] },
  { title: 'บุคคลอ้างอิง', headers: ['บุคคลอ้างอิง (ชื่อ/ความสัมพันธ์)', 'บุคคลอ้างอิง (อาชีพ)', 'บุคคลอ้างอิง (เบอร์โทร)', 'ทราบข่าวการสมัครงานจาก'] },
  { title: 'บัญชีธนาคาร', headers: ['ธนาคาร', 'เลขบัญชี', 'ชื่อบัญชี'] },
  { title: 'บุคคลที่ติดต่อได้กรณีฉุกเฉิน', headers: ['บุคคลที่ติดต่อได้กรณีฉุกเฉิน (ชื่อ)', 'ความสัมพันธ์', 'เบอร์โทรฉุกเฉิน'] },
]

function fieldValue(row, h) {
  const rows = parseJsonRows(row[h])
  if (rows) return null // ตารางแยกต่างหาก ไม่โชว์ในกริด label:value
  return row[h] || ''
}

function PrintableProfile({ row, headers }) {
  const headerSet = new Set(headers)
  const usedHeaders = new Set()
  const sections = PROFILE_SECTIONS
    .map((sec) => ({ ...sec, headers: sec.headers.filter((h) => headerSet.has(h)) }))
    .filter((sec) => sec.headers.length > 0)
  sections.forEach((sec) => sec.headers.forEach((h) => usedHeaders.add(h)))
  const leftoverHeaders = headers.filter((h) => h !== 'ประทับเวลา' && !usedHeaders.has(h))
  const name = row['ชื่อ-นามสกุล'] || '-'
  const position = row['ตำแหน่งงานที่สมัคร'] || row['ตำแหน่งงาน'] || '-'
  const submittedAt = row['ประทับเวลา'] || ''

  return (
    <div style={{ fontFamily: '-apple-system, "Noto Sans Thai", Arial, sans-serif', color: '#111827', fontSize: 13, lineHeight: 1.6 }}>
      <div style={{ borderBottom: '3px solid #0b63d8', paddingBottom: 10, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#0b63d8', letterSpacing: '.06em', textTransform: 'uppercase' }}>PAYI · เอกสารประวัติบุคคล</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{name}</div>
          <div style={{ fontSize: 13, color: '#475569' }}>ตำแหน่ง: {position}</div>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>วันที่ส่งฟอร์ม<br />{submittedAt}</div>
      </div>

      {sections.map((sec) => (
        <div key={sec.title} style={{ border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 12, overflow: 'hidden', breakInside: 'avoid' }}>
          <div style={{ background: '#eaf3ff', color: '#0b63d8', fontWeight: 700, fontSize: 12, padding: '6px 12px' }}>{sec.title}</div>
          {sec.headers.some((h) => parseJsonRows(row[h])) ? (
            <div style={{ padding: 10 }}>
              {sec.headers.map((h) => {
                const rows = parseJsonRows(row[h])
                if (!rows) return null
                return (
                  <table key={h} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 6 }}>
                    <tbody>
                      {rows.length ? rows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '4px 6px', color: '#475569' }}>{Object.values(r).filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                      )) : (
                        <tr><td style={{ padding: '4px 6px', color: '#94a3b8' }}>— ไม่มีข้อมูล —</td></tr>
                      )}
                    </tbody>
                  </table>
                )
              })}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            {sec.headers.filter((h) => !parseJsonRows(row[h])).map((h) => (
              <div key={h} style={{ display: 'flex', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ width: '45%', padding: '6px 10px', color: '#64748b', fontSize: 11, borderRight: '1px solid #e2e8f0' }}>{displayLabel(h)}</div>
                <div style={{ flex: 1, padding: '6px 10px', fontWeight: 500 }}>{fieldValue(row, h) || '—'}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {leftoverHeaders.length > 0 && (
        <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 12, overflow: 'hidden', breakInside: 'avoid' }}>
          <div style={{ background: '#eaf3ff', color: '#0b63d8', fontWeight: 700, fontSize: 12, padding: '6px 12px' }}>อื่นๆ</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {leftoverHeaders.map((h) => (
              <div key={h} style={{ display: 'flex', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ width: '45%', padding: '6px 10px', color: '#64748b', fontSize: 11, borderRight: '1px solid #e2e8f0' }}>{displayLabel(h)}</div>
                <div style={{ flex: 1, padding: '6px 10px', fontWeight: 500 }}>{row[h] || '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <div>ลงชื่อ ................................................. ผู้กรอกข้อมูล</div>
        <div>วันที่ ................./................./.................</div>
      </div>
    </div>
  )
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

// พิมพ์เฉพาะเนื้อหา drawer (ซ่อนทุกอย่างอื่นตอนสั่งพิมพ์) — ไม่ต้องใช้ library, ใช้ browser
// print เดิม เหมือน public/apply.html แค่ scope ด้วย class .hr-print-area แทน
function DetailDrawer({ row, headers, onClose }) {
  if (!row) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .hr-print-area, .hr-print-area * { visibility: visible !important; }
          .hr-print-area { position: fixed; inset: 0; width: 100%; height: auto !important; overflow: visible !important; padding: 20px !important; }
          .hr-no-print { display: none !important; }
          .hr-print-only { display: block !important; }
        }
        .hr-print-only { display: none; }
      `}</style>
      <div className="app-side-drawer hr-print-area" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--payi-surface)', width: 'min(460px,100vw)', height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
        <div className="hr-no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 16, color: 'var(--payi-text-strong)' }}>รายละเอียด</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => window.print()} title="สร้าง PDF / พิมพ์"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-text-strong)' }}>
              <Printer size={14} /> สร้าง PDF
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--payi-text-muted)' }}><X size={20} /></button>
          </div>
        </div>
        <div className="hr-no-print" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {headers.map((h) => (
            <div key={h}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--payi-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>{displayLabel(h)}</div>
              <div style={{ fontSize: 14, color: 'var(--payi-text-strong)', wordBreak: 'break-word' }}><JsonRowsView value={row[h]} /></div>
            </div>
          ))}
        </div>
        <div className="hr-print-only">
          <PrintableProfile row={row} headers={headers} />
        </div>
      </div>
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
  const [view, setView] = useState('employees')
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

  const activeView = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const headers = data.headers || []
  const rows = data.rows || []
  const nameCol = useMemo(() => headers.find(nameHint) || headers[1] || headers[0], [headers])
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
        <a href={activeView.formUrl} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, border: 'none', background: 'var(--payi-gradient-primary)', color: '#fff', textDecoration: 'none', marginLeft: 'auto' }}>
          <FilePlus2 size={15} /> เปิด{activeView.formLabel}
        </a>
      </div>
      <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--payi-text-faint)' }}>
        ส่งลิงก์นี้ให้พนักงาน/ผู้สมัครกรอกได้เลย: <a href={activeView.formUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--payi-mint-strong)' }}>{activeView.formUrl}</a>
      </p>

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
                  {isSummaryView && <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--payi-border)' }} />}
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

      {selected && <DetailDrawer row={selected} headers={headers} onClose={() => setSelected(null)} />}
    </div>
  )
}
