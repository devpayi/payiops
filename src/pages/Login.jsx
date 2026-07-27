import { useState } from 'react'
import { Loader2, LogIn, UserPlus } from 'lucide-react'
import payiLogo from '../assets/payi-logo.png'

// จอ login รายบัญชี — ถ้าเป็นการเปิดระบบครั้งแรก (ยังไม่มีผู้ใช้) จะกลายเป็นฟอร์ม "สร้าง Dev คนแรก"
export default function Login({ firstTime, onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firstTime
          ? { action: 'setup', username, password, display_name: displayName }
          : { action: 'login', username, password }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'เข้าสู่ระบบไม่สำเร็จ')
      localStorage.setItem('payi-api-token', d.token)
      localStorage.setItem('payi-user', JSON.stringify(d.user))
      onLogin(d.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <form onSubmit={submit} className="payi-glass-card" style={{ width: 360, maxWidth: '94vw', borderRadius: 24, boxShadow: '0 24px 60px rgba(37,99,235,0.12)', padding: 28, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <span style={{ padding: 2, borderRadius: '50%', background: 'var(--payi-gradient-primary)', display: 'inline-flex', boxShadow: '0 8px 18px rgba(37,99,235,0.24)' }}>
            <img src={payiLogo} alt="PAYI" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
          </span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--payi-text-strong)' }}>Payi Ops</div>
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontWeight: 700, letterSpacing: '0.06em' }}>RETAIL CONTROL ROOM</div>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>
          {firstTime ? 'ตั้งค่าครั้งแรก — สร้างบัญชี Dev' : 'เข้าสู่ระบบ'}
        </div>
        {firstTime && (
          <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: -8 }}>
            ยังไม่มีผู้ใช้ในระบบ บัญชีแรกจะเป็น Dev (เพิ่ม Boss และ Staff ได้ทีหลัง)
          </div>
        )}

        {firstTime && (
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ชื่อที่แสดง (เช่น Nook)" style={inputStyle} />
        )}
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ชื่อผู้ใช้" autoFocus autoCapitalize="none" style={inputStyle} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={firstTime ? 'รหัสผ่าน (อย่างน้อย 6 ตัว)' : 'รหัสผ่าน'} style={inputStyle} />

        {error && <div style={{ fontSize: 12.5, color: 'var(--payi-danger)', background: 'var(--payi-danger-bg)', border: '1px solid var(--payi-danger)', borderRadius: 8, padding: '8px 10px' }}>{error}</div>}

        <button type="submit" disabled={busy || !username || !password} style={{ border: 0, borderRadius: 10, minHeight: 42, background: 'var(--payi-gradient-primary)', boxShadow: '0 8px 18px rgba(37,99,235,0.22)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy || !username || !password ? 0.6 : 1 }}>
          {busy ? <Loader2 size={16} className="payi-spin" /> : firstTime ? <UserPlus size={16} /> : <LogIn size={16} />}
          {firstTime ? 'สร้างบัญชีและเข้าสู่ระบบ' : 'เข้าสู่ระบบ'}
        </button>
      </form>
      <div style={{ marginTop: 18, fontSize: 11, color: 'var(--payi-text-faint)', textAlign: 'center' }}>PAYI Health Care © 2026</div>
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--payi-border)', background: 'var(--payi-surface-muted)',
  borderRadius: 10, padding: '11px 12px', fontSize: 14, color: 'var(--payi-text-strong)', outline: 'none',
}
