import { useEffect, useState } from 'react'
import { Loader2, KeyRound, UserPlus, Trash2, Users, ShieldCheck, MessageCircle } from 'lucide-react'
import { isDev } from '../../shared/roles.js'

const getMe = () => {
  try { return JSON.parse(localStorage.getItem('payi-user') || 'null') } catch { return null }
}

export default function Settings() {
  const me = getMe()
  const isAdmin = isDev(me?.role)

  return (
    <div style={{ width: '100%', display: 'grid', gap: 20, maxWidth: 720 }}>
      <ChangePasswordCard me={me} />
      <LineLinkCard me={me} />
      {isAdmin && <BossLineNotifyCard />}
      {isAdmin && <StaffLineLinkCard />}
      {isAdmin && <UserManagementCard me={me} />}
    </div>
  )
}

function LineLinkCard({ me }) {
  const [lineUserId, setLineUserId] = useState('')
  const [saved, setSaved] = useState('')
  const [notifyHr, setNotifyHr] = useState(true)
  const [notifyStock, setNotifyStock] = useState(true)
  const [savedNotify, setSavedNotify] = useState({ hr: true, stock: true })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    fetch('/api/sheet-tools?op=hr').then((r) => r.json()).then((d) => {
      const mine = (d.lineLinks || []).find((l) => l.username === me?.u)
      if (mine) {
        setLineUserId(mine.line_user_id); setSaved(mine.line_user_id)
        const hr = String(mine.notify_hr) !== '0', stock = String(mine.notify_stock) !== '0'
        setNotifyHr(hr); setNotifyStock(stock); setSavedNotify({ hr, stock })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [me?.u])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/sheet-tools?op=hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-line-id', line_user_id: lineUserId, notify_hr: notifyHr, notify_stock: notifyStock }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      setSaved(lineUserId)
      setSavedNotify({ hr: notifyHr, stock: notifyStock })
      setMsg({ ok: true, text: lineUserId ? 'เชื่อม LINE สำเร็จ' : 'ยกเลิกการเชื่อม LINE แล้ว' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const dirty = lineUserId !== saved || notifyHr !== savedNotify.hr || notifyStock !== savedNotify.stock

  return (
    <Card icon={MessageCircle} title="แจ้งเตือนผ่าน LINE" sub="เชื่อม LINE userId เพื่อรับแจ้งเตือน พร้อมกดอนุมัติ/สั่งของจากแชทได้เลย">
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <input value={lineUserId} onChange={(e) => setLineUserId(e.target.value)} placeholder="LINE userId (เช่น U1234567890abcdef...)" style={inputStyle} autoCapitalize="none" />
          <div style={{ fontSize: 11.5, color: 'var(--payi-text-faint)', lineHeight: 1.5 }}>
            หา userId ได้จากหน้า LINE Developers Console ของ OA (Basic settings) หรือดูจาก log ตอนทักแชทเข้า OA ครั้งแรก
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--payi-text)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={notifyHr} onChange={(e) => setNotifyHr(e.target.checked)} />
              รับแจ้งเตือนการลา
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={notifyStock} onChange={(e) => setNotifyStock(e.target.checked)} />
              รับแจ้งเตือนของใกล้หมด
            </label>
          </div>
          {msg && (
            <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, color: msg.ok ? 'var(--payi-success)' : 'var(--payi-danger)', background: msg.ok ? 'var(--payi-success-bg)' : 'var(--payi-danger-bg)' }}>
              {msg.text}
            </div>
          )}
          <button type="submit" disabled={busy || !dirty} style={{ ...primaryBtn, opacity: busy || !dirty ? 0.6 : 1, justifySelf: 'start' }}>
            {busy ? <Loader2 size={14} className="payi-spin" /> : <MessageCircle size={14} />} บันทึก
          </button>
        </form>
      )}
    </Card>
  )
}

// admin ดู/แก้หมวดแจ้งเตือน LINE ของบอส/dev ทุกคนจากที่เดียว — ไม่ต้องให้แต่ละคน login เข้ามาตั้งเอง
// (เช่น มีบอส HR กับบอสสต็อกคนละคน ผูก LINE ไว้แล้วทั้งคู่แต่อยากตั้งค่าเริ่มต้นให้จากตรงนี้เลย)
function BossLineNotifyCard() {
  const [rows, setRows] = useState([]) // [{ username, display_name, role, line_user_id, notify_hr, notify_stock }]
  const [loading, setLoading] = useState(true)
  const [busyUser, setBusyUser] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = () => {
    setLoading(true); setMsg(null)
    Promise.all([
      fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list-users' }) }).then((r) => r.json()),
      fetch('/api/sheet-tools?op=hr').then((r) => r.json()),
    ]).then(([u, d]) => {
      if (!u.success) throw new Error(u.error || 'โหลดรายชื่อ user ไม่สำเร็จ')
      const linkByUsername = Object.fromEntries((d.lineLinks || []).filter((l) => l.username && !String(l.username).startsWith('mp:')).map((l) => [l.username, l]))
      const managers = (u.users || []).filter((x) => ['boss', 'dev', 'admin'].includes(x.role))
      setRows(managers.map((m) => {
        const link = linkByUsername[m.username]
        return {
          username: m.username, display_name: m.display_name || m.username, role: m.role,
          line_user_id: link?.line_user_id || '',
          notify_hr: link ? String(link.notify_hr) !== '0' : true,
          notify_stock: link ? String(link.notify_stock) !== '0' : true,
        }
      }))
    }).catch((err) => setMsg({ ok: false, text: err.message })).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const toggle = async (row, field) => {
    if (!row.line_user_id) return
    setBusyUser(row.username); setMsg(null)
    try {
      const nextHr = field === 'hr' ? !row.notify_hr : row.notify_hr
      const nextStock = field === 'stock' ? !row.notify_stock : row.notify_stock
      const res = await fetch('/api/sheet-tools?op=hr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-set-notify', username: row.username, notify_hr: nextHr, notify_stock: nextStock }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      setRows((prev) => prev.map((r) => (r.username === row.username ? { ...r, notify_hr: nextHr, notify_stock: nextStock } : r)))
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusyUser(null)
    }
  }

  return (
    <Card icon={MessageCircle} title="หมวดแจ้งเตือน LINE ของบอส/dev" sub="ตั้งจากตรงนี้ให้แต่ละคนได้เลย ไม่ต้องรอให้เขา login เข้ามาตั้งเอง — ต้องผูก LINE (การ์ดด้านบน) ก่อนถึงจะตั้งได้">
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
          {rows.map((row) => (
            <div key={row.username} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: 'var(--payi-surface-muted)' }}>
              <div style={{ width: 130, flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{row.display_name}</div>
              {!row.line_user_id ? (
                <div style={{ fontSize: 12, color: 'var(--payi-text-faint)' }}>ยังไม่ได้ผูก LINE</div>
              ) : (
                <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: 'var(--payi-text)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: busyUser === row.username ? 'default' : 'pointer', opacity: busyUser === row.username ? 0.5 : 1 }}>
                    <input type="checkbox" checked={row.notify_hr} disabled={busyUser === row.username} onChange={() => toggle(row, 'hr')} />
                    การลา
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: busyUser === row.username ? 'default' : 'pointer', opacity: busyUser === row.username ? 0.5 : 1 }}>
                    <input type="checkbox" checked={row.notify_stock} disabled={busyUser === row.username} onChange={() => toggle(row, 'stock')} />
                    ของใกล้หมด
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function StaffLineLinkCard() {
  const [people, setPeople] = useState([])
  const [activeMonths, setActiveMonths] = useState({})
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7))
  const [links, setLinks] = useState({}) // { [code]: line_user_id }
  const [drafts, setDrafts] = useState({}) // { [code]: input value }
  const [loading, setLoading] = useState(true)
  const [busyCode, setBusyCode] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = () => {
    setLoading(true)
    fetch('/api/sheet-tools?op=hr').then((r) => r.json()).then((d) => {
      const linkMap = {}
      for (const l of d.lineLinks || []) {
        if (String(l.username || '').startsWith('mp:')) linkMap[l.username.slice(3)] = l.line_user_id
      }
      setPeople(d.people || [])
      setActiveMonths(d.activeMonths || {})
      setLinks(linkMap)
      setDrafts((prev) => ({ ...linkMap, ...prev }))
    }).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

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
      setLinks((prev) => ({ ...prev, [code]: drafts[code] || '' }))
      setMsg({ ok: true, text: `บันทึก LINE ของ${people.find((p) => p.code === code)?.name || code} แล้ว` })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <Card icon={MessageCircle} title="ผูก LINE พนักงาน (manpower)" sub="ให้พนักงานทักแชทเข้า OA 1 ครั้ง (บอทจะตอบ userId กลับมา) แล้วเอามาวางที่นี่ให้แต่ละคน — เชื่อมแล้วยื่นลาผ่านไลน์ได้เลย พิมพ์ &quot;ลา&quot; ในแชท">
      {loading ? (
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

function UserManagementCard({ me }) {
  const [users, setUsers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ username: '', display_name: '', password: '', role: 'staff' })
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true); setError('')
    fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list-users' }) })
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.error); setUsers(d.users) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

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
      load()
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
      load()
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
          <option value="boss">Boss</option>
          <option value="dev">Dev</option>
        </select>
        <button type="submit" disabled={busy || !draft.username || draft.password.length < 6} style={{ ...primaryBtn, gridColumn: '1 / -1', justifySelf: 'start', opacity: busy || !draft.username || draft.password.length < 6 ? 0.6 : 1 }}>
          {busy ? <Loader2 size={14} className="payi-spin" /> : <UserPlus size={14} />} เพิ่มผู้ใช้
        </button>
      </form>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {(users || []).map((u) => (
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
          {!users?.length && <div style={{ fontSize: 13, color: 'var(--payi-text-faint)' }}>ไม่มีผู้ใช้อื่น</div>}
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
