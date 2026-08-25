import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import App from './App.jsx'
import Login from './pages/Login.jsx'

const WorkforceOTPreview = lazy(() => import('./pages/WorkforceOT.jsx'))
const HRMobile = lazy(() => import('./pages/HRMobile.jsx'))

// ── API auth: แนบ token กับทุก fetch ที่ยิง /api (จุดเดียว ครอบทุกหน้า) ──
// token มาจากการ login (/api/auth) เก็บใน localStorage — ถ้า server ตอบ 401 (token หมดอายุ/ผิด)
// จะล้าง token แล้ว reload เพื่อกลับไปหน้า login (บนเครื่อง dev ไม่ตั้ง AUTH_SECRET = ไม่บังคับ)
const TOKEN_KEY = 'payi-api-token'
const USER_KEY = 'payi-user'
const origFetch = window.fetch.bind(window)
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || ''
  const isApi = url.startsWith('/api/') || url.startsWith('/api?')
  if (!isApi) return origFetch(input, init)

  const headers = new Headers(init.headers || {})
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.set('x-api-token', token)
  const res = await origFetch(input, { ...init, headers })

  // token ใช้ไม่ได้แล้ว (ยกเว้นตอนกำลัง login เอง) → เด้งกลับหน้า login
  // สำคัญ: reload เฉพาะตอน "เคยมี token" (หมดอายุ/ถูกเปลี่ยน secret) และไม่เกิน 1 ครั้ง/5 วิ
  // — ถ้าไม่มี token อยู่แล้ว การ reload ไม่ช่วยอะไรและจะกลายเป็นรีเฟรชวนไม่จบ
  if (res.status === 401 && !url.startsWith('/api/auth')) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    const last = Number(sessionStorage.getItem('payi-401-at') || 0)
    if (token && Date.now() - last > 5000) {
      sessionStorage.setItem('payi-401-at', String(Date.now()))
      window.location.reload()
    }
  }
  return res
}

// PROTOTYPE switch
const showOTPreview = new URLSearchParams(window.location.search).has('ot-preview')
const showHrMobile = new URLSearchParams(window.location.search).has('hr')

// ── ประตู login: เช็คสถานะระบบก่อน — ปิด auth อยู่ (local dev) ก็เข้าแอปตรงๆ ──
function Root() {
  if (showOTPreview) return <Suspense fallback={<div style={{ padding: 40 }}>กำลังโหลด…</div>}><div style={{ minHeight: '100vh', background: '#f7fbff', padding: 28 }}><WorkforceOTPreview preview /></div></Suspense>
  const [status, setStatus] = useState(null) // { enabled, hasUsers }
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
  })

  useEffect(() => {
    fetch('/api/auth?action=status')
      .then((r) => r.json())
      .then((d) => setStatus(d.success ? d : { error: true }))
      // เช็คสถานะไม่ได้ → โชว์จอ error ให้กด retry — ห้ามเดาว่า "ไม่ต้อง login" แล้วปล่อยแอปยิง API
      // (เดาผิดตอน auth เปิดอยู่ = 401 ทุกเส้น → เคยทำให้หน้าเว็บรีเฟรชวนไม่จบ)
      .catch(() => setStatus({ error: true }))
  }, [])

  if (!status) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--payi-text-muted)', fontSize: 14 }}>กำลังโหลด...</div>
  }

  if (status.error) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div style={{ textAlign: 'center', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--payi-text-strong)' }}>เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</div>
          <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>เช็คอินเทอร์เน็ต หรือค่า env บนเซิร์ฟเวอร์ (Google key / SHEET_ID) แล้วลองใหม่</div>
          <button onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '10px 18px', background: 'var(--payi-gradient-primary)', boxShadow: '0 8px 18px rgba(37,99,235,0.22)', color: '#fff', fontWeight: 800, cursor: 'pointer', justifySelf: 'center' }}>ลองใหม่</button>
        </div>
      </div>
    )
  }

  const needLogin = status.enabled && !(localStorage.getItem(TOKEN_KEY) && user)
  if (needLogin) return <Login firstTime={!status.hasUsers} onLogin={setUser} />

  if (showHrMobile) return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--payi-text-muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
      <HRMobile />
    </Suspense>
  )
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
