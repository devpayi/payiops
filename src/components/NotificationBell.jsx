import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

import { CHANGELOG } from '../changelog.js'

const REFRESH_MS = 5 * 60 * 1000
const SEEN_KEY = 'payi-changelog-seen'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])) } catch { /* ignore */ } }

// กระดิ่งแจ้งเตือน — ดึงจาก /api/sheet-tools?op=notifications (boss/dev เห็นงานค้าง role อื่นได้ list ว่าง)
export default function NotificationBell({ color, onNavigate }) {
  const [data, setData] = useState({ total: 0, groups: [] })
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const wrapRef = useRef(null)
  const [seen, setSeen] = useState(readSeen)
  // ตอนเปิดกระดิ่ง จำไว้ว่าอันไหนยังใหม่ (ติดป้าย "ใหม่") แล้วค่อย mark ว่าอ่านแล้ว ปิดแล้วเปิดใหม่ป้ายหาย
  const [freshIds, setFreshIds] = useState(() => new Set())
  const unseenCount = CHANGELOG.filter((c) => !seen.has(c.id)).length

  const toggle = () => {
    if (!open) {
      setFreshIds(new Set(CHANGELOG.filter((c) => !seen.has(c.id)).map((c) => c.id)))
      const next = new Set([...seen, ...CHANGELOG.map((c) => c.id)])
      setSeen(next)
      writeSeen(next)
      load()
    }
    setOpen((v) => !v)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/sheet-tools?op=notifications')
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'load failed')
      setData({ total: d.total || 0, groups: d.groups || [] })
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        title="การแจ้งเตือน"
        aria-label="การแจ้งเตือน"
        onClick={toggle}
        style={{ position: 'relative', width: 40, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.6)', display: 'grid', placeItems: 'center', boxShadow: '0 8px 20px rgba(16,24,40,0.06)', cursor: 'pointer' }}
      >
        <Bell size={18} color={color} />
        {data.total + unseenCount > 0 && (
          <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--payi-danger, #e5484d)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center', boxSizing: 'border-box' }}>
            {data.total + unseenCount > 99 ? '99+' : data.total + unseenCount}
          </span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 48, right: 0, width: 'min(340px, 92vw)', maxHeight: '70vh', overflowY: 'auto', background: '#fff', border: '1px solid var(--payi-border, #e5e7eb)', borderRadius: 16, boxShadow: '0 18px 40px rgba(16,24,40,0.16)', padding: 12, zIndex: 60 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: 'var(--payi-text-strong)' }}>การแจ้งเตือน</div>
          {failed ? (
            <div style={{ fontSize: 13, color: 'var(--payi-text-muted)', padding: '8px 4px' }}>โหลดไม่สำเร็จ ลองกดใหม่อีกครั้ง</div>
          ) : !data.groups.length ? (
            <div style={{ fontSize: 13, color: 'var(--payi-text-muted)', padding: '8px 4px' }}>{loading ? 'กำลังโหลด…' : 'ไม่มีงานค้าง 🎉'}</div>
          ) : data.groups.map((g) => (
            <button
              key={g.key}
              onClick={() => { setOpen(false); onNavigate?.(g.tab) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid var(--payi-border, #e5e7eb)', borderRadius: 12, background: '#fff', padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)' }}>
                <span>{g.title}</span>
                <span style={{ color: 'var(--payi-danger, #e5484d)' }}>{g.count}</span>
              </div>
              {g.items.map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</div>
              ))}
              {g.count > g.items.length && <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 3 }}>+ อีก {g.count - g.items.length} รายการ</div>}
            </button>
          ))}
          {!!CHANGELOG.length && (
            <>
              <div style={{ fontSize: 13, fontWeight: 800, margin: '10px 0 8px', color: 'var(--payi-text-strong)' }}>มีอะไรใหม่</div>
              {CHANGELOG.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setOpen(false); if (c.tab) onNavigate?.(c.tab) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid var(--payi-border, #e5e7eb)', borderRadius: 12, background: freshIds.has(c.id) ? 'var(--payi-mint-soft, #ecfdf5)' : '#fff', padding: '10px 12px', marginBottom: 8, cursor: c.tab ? 'pointer' : 'default' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)' }}>
                    <span>{c.title}</span>
                    {freshIds.has(c.id) && <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: 'var(--payi-mint-strong, #10b981)', borderRadius: 999, padding: '1px 8px', flexShrink: 0 }}>ใหม่</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 3 }}>{c.detail}</div>
                  <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 3 }}>{c.date}</div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
