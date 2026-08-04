import { useEffect, useMemo, useState } from 'react'
import { Loader2, KeyRound, UserPlus, Trash2, Users, ShieldCheck, MessageCircle } from 'lucide-react'
import { isDev } from '../../shared/roles.js'

const getMe = () => {
  try { return JSON.parse(localStorage.getItem('payi-user') || 'null') } catch { return null }
}

// เดิมแต่ละการ์ด (LineLinkCard/BossLineNotifyCard/StaffLineLinkCard) ยิง op=hr เอง, UserManagementCard
// กับ BossLineNotifyCard ยิง list-users เอง — เปิดหน้านี้ทีเดียวจึงยิง Sheets API 5 รอบพร้อมกัน ชนโควตา
// "Read requests per minute" จริง (แม้ฝั่ง server จะ dedup แล้วก็ตาม เพราะ Vercel serverless แต่ละ request
// อาจไปคนละ instance ไม่แชร์หน่วยความจำกัน — dedup ฝั่ง server ช่วยไม่ได้ 100% ต้องตัดที่ต้นตอคือจำนวน
// request จากฝั่ง browser เอง) ย้าย fetch มารวมไว้ที่นี่ที่เดียว แล้วส่งผ่าน props ให้ทุกการ์ดใช้ร่วมกัน
export default function Settings() {
  const me = getMe()
  const isAdmin = isDev(me?.role)

  const [hrData, setHrData] = useState(null)
  const [hrLoading, setHrLoading] = useState(true)
  const [usersData, setUsersData] = useState(null)
  const [usersLoading, setUsersLoading] = useState(true)

  const reloadHr = () => {
    setHrLoading(true)
    fetch('/api/sheet-tools?op=hr').then((r) => r.json()).then(setHrData).catch(() => {}).finally(() => setHrLoading(false))
  }
  const reloadUsers = () => {
    setUsersLoading(true)
    fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list-users' }) })
      .then((r) => r.json()).then(setUsersData).catch(() => {}).finally(() => setUsersLoading(false))
  }
  useEffect(() => { reloadHr() }, [])
  useEffect(() => { if (isAdmin) reloadUsers() }, [isAdmin])

  return (
    <div style={{ width: '100%', display: 'grid', gap: 20, maxWidth: 720 }}>
      <ChangePasswordCard me={me} />
      {isAdmin && <BossLineNotifyCard hrData={hrData} hrLoading={hrLoading} usersData={usersData} usersLoading={usersLoading} reloadHr={reloadHr} />}
      {isAdmin && <StockCounterLineCard hrData={hrData} hrLoading={hrLoading} reloadHr={reloadHr} />}
      {isAdmin && <StaffLineLinkCard hrData={hrData} hrLoading={hrLoading} reloadHr={reloadHr} />}
      {isAdmin && <UserManagementCard me={me} usersData={usersData} usersLoading={usersLoading} reloadUsers={reloadUsers} />}
    </div>
  )
}

// admin ดู/แก้ LINE ของบอส/dev ทุกคนจากที่เดียว (userId + หมวดแจ้งเตือน ในฟอร์มเดียวกัน) — ไม่ต้องให้
// แต่ละคน login เข้ามาผูกเอง (เดิมมีการ์ด self-service แยกต่างหากด้วย แต่คนที่ใช้จริงมีแต่บอส/dev ซึ่ง
// การ์ดนี้ทำได้ครบกว่าอยู่แล้ว เลยตัดออก เหลือจุดเดียวไม่ให้งงว่าต้องตั้งตรงไหน)
function BossLineNotifyCard({ hrData, hrLoading, usersData, usersLoading, reloadHr }) {
  // draft ต่อคน = { line_user_id, notify_hr, notify_stock } — รวมทุกอย่างไว้ในฟอร์มเดียว กดบันทึกทีเดียวจบ
  // (เดิมแยกเป็น 2 ขั้น: เซฟ userId ก่อน checkbox ถึงจะโผล่ให้ติ๊ก — งงว่าทำไมไม่มีปุ่มให้เลือกเหมือน DEV
  // ทั้งที่จริงๆ แค่ยังไม่กดบันทึกรอบแรก)
  const [drafts, setDrafts] = useState({}) // { [username]: { line_user_id, notify_hr, notify_stock } }
  const [busyUser, setBusyUser] = useState(null)
  const [msg, setMsg] = useState(null)

  const rows = useMemo(() => {
    if (!hrData || !usersData) return []
    const linkByUsername = Object.fromEntries((hrData.lineLinks || []).filter((l) => l.username && !String(l.username).startsWith('mp:')).map((l) => [l.username, l]))
    const managers = (usersData.users || []).filter((x) => ['boss', 'dev', 'admin'].includes(x.role))
    return managers.map((m) => {
      const link = linkByUsername[m.username]
      return {
        username: m.username, display_name: m.display_name || m.username, role: m.role,
        line_user_id: link?.line_user_id || '',
        notify_hr: link ? String(link.notify_hr) !== '0' : true,
        notify_stock: link ? String(link.notify_stock) !== '0' : true,
      }
    })
  }, [hrData, usersData])

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const r of rows) if (!next[r.username]) next[r.username] = { line_user_id: r.line_user_id, notify_hr: r.notify_hr, notify_stock: r.notify_stock }
      return next
    })
  }, [rows])

  const loading = hrLoading || usersLoading
  const patchDraft = (username, patch) => setDrafts((prev) => ({ ...prev, [username]: { ...prev[username], ...patch } }))

  // วาง/แก้ LINE userId + ตั้งหมวดแจ้งเตือน พร้อมกันในคลิกเดียว (เผื่อบอสไม่สะดวก login เอง)
  const save = async (row) => {
    const draft = drafts[row.username] || {}
    setBusyUser(row.username); setMsg(null)
    try {
      const res = await fetch('/api/sheet-tools?op=hr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-line-id-for', username: row.username, line_user_id: draft.line_user_id || '', notify_hr: draft.notify_hr, notify_stock: draft.notify_stock }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      reloadHr()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusyUser(null)
    }
  }

  const isDirty = (row) => {
    const d = drafts[row.username]
    return d && (d.line_user_id !== row.line_user_id || d.notify_hr !== row.notify_hr || d.notify_stock !== row.notify_stock)
  }

  return (
    <Card icon={MessageCircle} title="หมวดแจ้งเตือน LINE ของบอส/dev" sub="วาง LINE userId + ติ๊กหมวดที่ต้องการ แล้วกดบันทึกทีเดียว (ให้เขาทักแชทเข้า OA ก่อน บอทจะตอบ userId กลับมา) ไม่ต้องรอให้ login เข้ามาผูกเอง">
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {msg && (
            <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, color: msg.ok ? 'var(--payi-success)' : 'var(--payi-danger)', background: msg.ok ? 'var(--payi-success-bg)' : 'var(--payi-danger-bg)' }}>
              {msg.text}
            </div>
          )}
          {!rows.length && <div style={{ fontSize: 13, color: 'var(--payi-text-faint)' }}>ยังไม่มี user role boss/dev ในระบบ</div>}
          {rows.map((row) => {
            const draft = drafts[row.username] || { line_user_id: row.line_user_id, notify_hr: true, notify_stock: true }
            const busy = busyUser === row.username
            return (
              <div key={row.username} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: 'var(--payi-surface-muted)' }}>
                <div style={{ width: 110, flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{row.display_name}{row.line_user_id && <span title="ผูกแล้ว" style={{ color: 'var(--payi-success)', marginLeft: 4 }}>●</span>}</div>
                <input
                  value={draft.line_user_id ?? ''}
                  onChange={(e) => patchDraft(row.username, { line_user_id: e.target.value })}
                  placeholder="LINE userId"
                  style={{ ...inputStyle, flex: '1 1 180px', minWidth: 140 }}
                  autoCapitalize="none"
                />
                <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: 'var(--payi-text)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>
                    <input type="checkbox" checked={!!draft.notify_hr} disabled={busy} onChange={(e) => patchDraft(row.username, { notify_hr: e.target.checked })} />
                    การลา
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>
                    <input type="checkbox" checked={!!draft.notify_stock} disabled={busy} onChange={(e) => patchDraft(row.username, { notify_stock: e.target.checked })} />
                    ของใกล้หมด
                  </label>
                </div>
                <button
                  onClick={() => save(row)}
                  disabled={busy || !isDirty(row)}
                  style={{ ...primaryBtn, padding: '7px 12px', opacity: busy || !isDirty(row) ? 0.5 : 1 }}
                >
                  {busy ? <Loader2 size={13} className="payi-spin" /> : 'บันทึก'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function StaffLineLinkCard({ hrData, hrLoading, reloadHr }) {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7))
  const [drafts, setDrafts] = useState({}) // { [code]: input value }
  const [busyCode, setBusyCode] = useState(null)
  const [msg, setMsg] = useState(null)

  const people = hrData?.people || []
  const activeMonths = hrData?.activeMonths || {}
  const links = useMemo(() => {
    const map = {}
    for (const l of hrData?.lineLinks || []) {
      if (String(l.username || '').startsWith('mp:')) map[l.username.slice(3)] = l.line_user_id
    }
    return map
  }, [hrData])

  useEffect(() => {
    setDrafts((prev) => ({ ...links, ...prev }))
  }, [links])

  // เอาเฉพาะคนที่มีชื่อในตารางพนักงานปี 2026 เดือนที่เลือกจริง
  const monthOptions = [...new Set(Object.values(activeMonths).flat())].sort().reverse()
  const visiblePeople = Object.keys(activeMonths).length === 0 ? people : people.filter((p) => (activeMonths[p.code] || []).includes(month))

  const save = async (code) => {
    setBusyCode(code); setMsg(null)
    try {
      const res = await fetch('/api/sheet-tools?op=hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-line-id-for', employee_code: code, line_user_id: drafts[code] || '' }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      setMsg({ ok: true, text: `บันทึก LINE ของ${people.find((p) => p.code === code)?.name || code} แล้ว` })
      reloadHr()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <Card icon={MessageCircle} title="ผูก LINE พนักงาน (manpower)" sub="ให้พนักงานทักแชทเข้า OA 1 ครั้ง (บอทจะตอบ userId กลับมา) แล้วเอามาวางที่นี่ให้แต่ละคน — เชื่อมแล้วยื่นลาผ่านไลน์ได้เลย พิมพ์ &quot;ลา&quot; ในแชท">
      {hrLoading ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {monthOptions.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 4 }}>
              เดือน (จากตารางพนักงานปี 2026)
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="payi-select" style={{ ...inputStyle, width: 'auto' }}>
                {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          {msg && (
            <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, color: msg.ok ? 'var(--payi-success)' : 'var(--payi-danger)', background: msg.ok ? 'var(--payi-success-bg)' : 'var(--payi-danger-bg)' }}>
              {msg.text}
            </div>
          )}
          {!visiblePeople.length && <div style={{ fontSize: 13, color: 'var(--payi-text-faint)' }}>ไม่มีพนักงานในตารางปี 2026 เดือนนี้</div>}
          {visiblePeople.map((p) => (
            <div key={p.code} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 110, flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{p.name}{links[p.code] && <span title="ผูกแล้ว" style={{ color: 'var(--payi-success)', marginLeft: 4 }}>●</span>}</div>
              <input
                value={drafts[p.code] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [p.code]: e.target.value }))}
                placeholder="LINE userId"
                style={{ ...inputStyle, flex: 1 }}
                autoCapitalize="none"
              />
              <button
                onClick={() => save(p.code)}
                disabled={busyCode === p.code || (drafts[p.code] ?? '') === (links[p.code] ?? '')}
                style={{ ...primaryBtn, padding: '7px 12px', opacity: busyCode === p.code || (drafts[p.code] ?? '') === (links[p.code] ?? '') ? 0.5 : 1 }}
              >
                {busyCode === p.code ? <Loader2 size={13} className="payi-spin" /> : 'บันทึก'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ช่องเดียวคงที่สำหรับ "คนนับของ/แจ้งของเข้า" — ต่างจาก BossLineNotifyCard (บอส/dev เท่านั้น) เพราะ
// resolveArrivalReporter (sheet-tools.js) ไม่เช็ค role เลย แค่หา username ใน users sheet ได้ก็พอ ใช้ username
// login จริงของคนนับของตรงๆ (เช่น "fah") เปลี่ยนคนวันหน้าก็แก้ username + userId ที่นี่ที่เดียว ไม่ต้องหาในตาราง
// manpower ยาวๆ ที่การ์ด "ผูก LINE พนักงาน (manpower)" ใช้อยู่ (การ์ดนั้นมีไว้เพื่อยื่นลา คนละจุดประสงค์)
function StockCounterLineCard({ hrData, hrLoading, reloadHr }) {
  const [username, setUsername] = useState('fah')
  const [lineUserId, setLineUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const currentLink = useMemo(() => (hrData?.lineLinks || []).find((l) => l.username === username), [hrData, username])
  useEffect(() => { setLineUserId(currentLink?.line_user_id || '') }, [currentLink])
  const isDirty = lineUserId.trim() !== (currentLink?.line_user_id || '')

  const save = async () => {
    const u = username.trim()
    if (!u) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/sheet-tools?op=hr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-line-id-for', username: u, line_user_id: lineUserId.trim() }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      setMsg({ ok: true, text: 'บันทึกแล้ว' })
      reloadHr()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={MessageCircle} title="คนนับของ (แจ้งของเข้า)" sub="username ล็อกอินจริงของคนที่กด &quot;แจ้งของเข้า&quot; ในแชท + LINE userId ของเขา (ให้ทักแชทเข้า OA ก่อน บอทจะตอบ userId กลับมา) เปลี่ยนคนวันหน้าแก้ที่นี่ที่เดียว">
      {hrLoading ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {msg && (
            <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, color: msg.ok ? 'var(--payi-success)' : 'var(--payi-danger)', background: msg.ok ? 'var(--payi-success-bg)' : 'var(--payi-danger-bg)' }}>
              {msg.text}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username ล็อกอิน"
              style={{ ...inputStyle, width: 140 }}
              autoCapitalize="none"
            />
            <input
              value={lineUserId}
              onChange={(e) => setLineUserId(e.target.value)}
              placeholder="LINE userId"
              style={{ ...inputStyle, flex: '1 1 180px', minWidth: 140 }}
              autoCapitalize="none"
            />
            <button
              onClick={save}
              disabled={busy || !username.trim() || !isDirty}
              style={{ ...primaryBtn, padding: '7px 12px', opacity: busy || !username.trim() || !isDirty ? 0.5 : 1 }}
            >
              {busy ? <Loader2 size={13} className="payi-spin" /> : 'บันทึก'}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function ChangePasswordCard({ me }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  const submit = async (e) => {
    e.preventDefault()
    setMsg(null)
    if (next !== confirm) return setMsg({ ok: false, text: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' })
    setBusy(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-password', current_password: current, new_password: next }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
      setMsg({ ok: true, text: 'เปลี่ยนรหัสผ่านสำเร็จ' })
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={KeyRound} title="บัญชีของฉัน" sub={me ? `${me.name || me.u} · ${me.role || 'staff'}` : ''}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 360 }}>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="รหัสผ่านปัจจุบัน" style={inputStyle} />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" style={inputStyle} />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="ยืนยันรหัสผ่านใหม่" style={inputStyle} />
        {msg && (
          <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, color: msg.ok ? 'var(--payi-success)' : 'var(--payi-danger)', background: msg.ok ? 'var(--payi-success-bg)' : 'var(--payi-danger-bg)' }}>
            {msg.text}
          </div>
        )}
        <button type="submit" disabled={busy || !current || !next} style={{ ...primaryBtn, opacity: busy || !current || !next ? 0.6 : 1, justifySelf: 'start' }}>
          {busy ? <Loader2 size={14} className="payi-spin" /> : <KeyRound size={14} />} เปลี่ยนรหัสผ่าน
        </button>
      </form>
    </Card>
  )
}

function UserManagementCard({ me, usersData, usersLoading, reloadUsers }) {
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ username: '', display_name: '', password: '', role: 'staff' })
  const [busy, setBusy] = useState(false)
  const users = usersData?.users || []

  const addUser = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-user', ...draft }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'เพิ่มผู้ใช้ไม่สำเร็จ')
      setDraft({ username: '', display_name: '', password: '', role: 'staff' })
      reloadUsers()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeUser = async (username) => {
    if (!window.confirm(`ลบผู้ใช้ "${username}"?`)) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-user', username }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'ลบไม่สำเร็จ')
      reloadUsers()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={Users} title="จัดการผู้ใช้" sub="เฉพาะ admin — เพิ่ม/ลบบัญชีคนในทีม">
      {error && <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, color: 'var(--payi-danger)', background: 'var(--payi-danger-bg)', marginBottom: 12 }}>{error}</div>}

      <form onSubmit={addUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
        <input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} placeholder="ชื่อผู้ใช้" style={inputStyle} autoCapitalize="none" />
        <input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} placeholder="ชื่อที่แสดง" style={inputStyle} />
        <input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว)" style={inputStyle} />
        <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="payi-select" style={inputStyle}>
          <option value="staff">Staff — Tang</option>
          <option value="stock">Stock — สต็อกเท่านั้น</option>
          <option value="marketing">Marketing — Dashboard + Marketing Radar</option>
          <option value="boss">Boss</option>
          <option value="dev">Dev</option>
        </select>
        <button type="submit" disabled={busy || !draft.username || draft.password.length < 6} style={{ ...primaryBtn, gridColumn: '1 / -1', justifySelf: 'start', opacity: busy || !draft.username || draft.password.length < 6 ? 0.6 : 1 }}>
          {busy ? <Loader2 size={14} className="payi-spin" /> : <UserPlus size={14} />} เพิ่มผู้ใช้
        </button>
      </form>

      {usersLoading ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {users.map((u) => (
            <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {u.display_name}
                  {isDev(u.role) && <ShieldCheck size={13} color="var(--payi-mint-strong)" />}
                </div>
                <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontFamily: 'monospace' }}>{u.username} · {u.role}</div>
              </div>
              <button
                onClick={() => removeUser(u.username)}
                disabled={busy || u.username === me?.u}
                title={u.username === me?.u ? 'ลบบัญชีตัวเองไม่ได้' : 'ลบผู้ใช้'}
                style={{ ...iconBtn, opacity: u.username === me?.u ? 0.35 : 1, cursor: u.username === me?.u ? 'not-allowed' : 'pointer' }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!users.length && <div style={{ fontSize: 13, color: 'var(--payi-text-faint)' }}>ไม่มีผู้ใช้อื่น</div>}
        </div>
      )}
    </Card>
  )
}

function Card({ icon: Icon, title, sub, children }) {
  return (
    <div className="payi-glass-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={16} color="var(--payi-mint)" />
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{title}</div>
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 16 }}>{sub}</div>}
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--payi-border)', background: 'var(--payi-surface)',
  borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--payi-text-strong)', outline: 'none',
}
const primaryBtn = {
  border: 0, borderRadius: 10, padding: '9px 16px', background: 'var(--payi-gradient-primary)', boxShadow: '0 8px 18px rgba(37,99,235,0.22)', color: '#fff',
  fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
}
const iconBtn = {
  border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', color: 'var(--payi-danger)',
  borderRadius: 7, padding: 7, display: 'grid', placeItems: 'center', flexShrink: 0,
}
