import { useEffect, useMemo, useState, useCallback } from 'react'
import { Users, UserPlus, Search, X, ExternalLink, RefreshCw, FilePlus2 } from 'lucide-react'
import KpiCard from '../components/KpiCard'

const API = '/api/sheet-tools?op=hr-people'

const VIEWS = [
  { id: 'employees', label: 'พนักงาน', icon: Users, formLabel: 'ฟอร์มข้อมูลพนักงาน', formUrl: 'https://docs.google.com/forms/d/1hxqaPqkZfiOaR7Hclm5XtBYrZTnS4vHdf7p4KviBVTk/viewform' },
  { id: 'applicants', label: 'ผู้สมัครงาน', icon: UserPlus, formLabel: 'ฟอร์มใบสมัครงาน', formUrl: 'https://docs.google.com/forms/d/1sjhYp5tFwJlvuhpa5yT0DwPOVutZdmxXmBnENiWs_AM/viewform' },
]

const isUrl = (v) => /^https?:\/\//i.test(String(v || '').trim())
// คอลัมน์ที่เป็นชื่อคน/หัวข้อหลัก — เดาจากชื่อ header เพื่อโชว์เป็นหัวแถวในตาราง
const nameHint = (h) => /ชื่อ|name|พนักงาน|ผู้สมัคร/i.test(h) && !/บริษัท|เล่น|ผู้ติดต่อ|ฉุกเฉิน|company/i.test(h)

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

function DetailDrawer({ row, headers, onClose }) {
  if (!row) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div className="app-side-drawer" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--payi-surface)', width: 'min(460px,100vw)', height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 16, color: 'var(--payi-text-strong)' }}>รายละเอียด</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--payi-text-muted)' }}><X size={20} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {headers.map((h) => (
            <div key={h}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--payi-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>{h}</div>
              <div style={{ fontSize: 14, color: 'var(--payi-text-strong)', wordBreak: 'break-word' }}><LinkOrText value={row[h]} /></div>
            </div>
          ))}
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

          <div className="payi-glass-card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--payi-border)', color: 'var(--payi-text-muted)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.__row} onClick={() => setSelected(row)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--payi-border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--payi-surface-muted)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {headers.map((h) => (
                      <td key={h} style={{ padding: '9px 12px', color: 'var(--payi-text-strong)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: h === nameCol ? 700 : 400 }}>
                        {isUrl(row[h]) ? <LinkOrText value={row[h]} /> : (row[h] || '—')}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !filtered.length && (
                  <tr><td colSpan={Math.max(headers.length, 1)} style={{ padding: 24, textAlign: 'center', color: 'var(--payi-text-muted)' }}>ไม่มีข้อมูล</td></tr>
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
