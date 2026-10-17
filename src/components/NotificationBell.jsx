import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, ChevronRight, Clock, PackageCheck, Sparkles } from 'lucide-react'
import { CHANGELOG } from '../changelog.js'

const REFRESH_MS = 5 * 60 * 1000
const SEEN_KEY = 'payi-changelog-seen'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])) } catch { /* ignore */ } }

// ไอคอน + โทนสีต่อหมวดงานค้าง (key ตรงกับ groups[].key จาก op=notifications)
const GROUP_STYLE = {
  leave: { Icon: CalendarClock, fg: '#2563eb', bg: '#eaf3ff' },
  arrival: { Icon: PackageCheck, fg: '#0d9f6e', bg: '#e8f8f1' },
  overdue: { Icon: Clock, fg: '#d97706', bg: '#fff4e0' },
  low: { Icon: AlertTriangle, fg: '#e5484d', bg: '#feecec' },
}

const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso || ''
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${Number(m[1]) + 543}`
}

// วัน-เวลาที่แจ้งเตือนครั้งแรก (เวลาไทย) เช่น "17 ต.ค. 13:29" ; ค่าว่าง/อ่านไม่ออก → ไม่โชว์
const fmtDateTime = (iso) => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

// กระดิ่งแจ้งเตือน (dev + boss เท่านั้น — App.jsx ไม่ render ให้ role อื่น) :
// แท็บ "งานค้าง" ดึงจาก /api/sheet-tools?op=notifications, แท็บ "มีอะไรใหม่" มาจาก src/changelog.js
export default function NotificationBell({ color, onNavigate }) {
  const [data, setData] = useState({ total: 0, groups: [] })
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState('tasks')
  const wrapRef = useRef(null)
  const bellRef = useRef(null)
  const panelRef = useRef(null)
  const [panelTop, setPanelTop] = useState(0)
  const [panelRight, setPanelRight] = useState(12)
  const [seen, setSeen] = useState(readSeen)
  // ตอนเปิดกระดิ่ง จำไว้ว่าอันไหนยังใหม่ (ติดป้าย "ใหม่") แล้วค่อย mark ว่าอ่านแล้ว ปิดแล้วเปิดใหม่ป้ายหาย
  const [freshIds, setFreshIds] = useState(() => new Set())
  const unseenCount = CHANGELOG.filter((c) => !seen.has(c.id)).length

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
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggle = () => {
    if (!open) {
      // มือถือ: panel เป็น fixed เต็มความกว้าง (ดู .nb-panel ใน theme.css) ต้องรู้ว่ากระดิ่งอยู่สูงแค่ไหน เพราะแถวปุ่มห่อบรรทัดได้
      const rect = bellRef.current?.getBoundingClientRect()
      setPanelTop(rect ? Math.round(rect.bottom + 8) : 70)
      setPanelRight(rect ? Math.max(12, Math.round(window.innerWidth - rect.right)) : 12)
      const fresh = CHANGELOG.filter((c) => !seen.has(c.id)).map((c) => c.id)
      setFreshIds(new Set(fresh))
      // ไม่มีงานค้างแต่มีของใหม่ → เปิดแท็บ "มีอะไรใหม่" ให้เลย
      setTab(data.total === 0 && fresh.length ? 'news' : 'tasks')
      const next = new Set([...seen, ...CHANGELOG.map((c) => c.id)])
      setSeen(next)
      writeSeen(next)
      load()
    }
    setOpen((v) => !v)
  }

  const badge = data.total + unseenCount

  return (
    <div ref={wrapRef} className="nb-wrap">
      <button ref={bellRef} className="nb-bell" title="การแจ้งเตือน" aria-label="การแจ้งเตือน" aria-expanded={open} onClick={toggle}>
        <Bell size={18} color={color} />
        {badge > 0 && <span className="nb-badge">{badge > 99 ? '99+' : badge}</span>}
      </button>

      {/* portal ไป body: ไม่งั้นโดน stacking context ของ header/การ์ดหน้าเพจทับ (เจอจริงบนมือถือ) */}
      {open && createPortal(
        <div ref={panelRef} className="nb-panel" style={{ '--nb-top': `${panelTop}px`, '--nb-right': `${panelRight}px` }} role="dialog" aria-label="การแจ้งเตือน">
          <div className="nb-head">
            <div>
              <div className="nb-title">การแจ้งเตือน</div>
              <div className="nb-sub">{data.total > 0 ? `มีงานค้าง ${data.total} รายการ` : 'ไม่มีงานค้างตอนนี้'}</div>
            </div>
          </div>

          <div className="nb-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'tasks'} className={`nb-tab${tab === 'tasks' ? ' is-on' : ''}`} onClick={() => setTab('tasks')}>
              งานค้าง{data.total > 0 && <span className="nb-tab-count">{data.total}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'news'} className={`nb-tab${tab === 'news' ? ' is-on' : ''}`} onClick={() => setTab('news')}>
              มีอะไรใหม่{freshIds.size > 0 && <span className="nb-tab-count is-new">{freshIds.size}</span>}
            </button>
          </div>

          <div className="nb-body">
            {tab === 'tasks' && (
              failed ? (
                <div className="nb-empty"><div className="nb-empty-icon is-warn"><AlertTriangle size={22} /></div>โหลดไม่สำเร็จ ลองกดกระดิ่งใหม่อีกครั้ง</div>
              ) : !data.groups.length ? (
                <div className="nb-empty">
                  <div className="nb-empty-icon"><CheckCircle2 size={24} /></div>
                  {loading ? 'กำลังโหลด…' : 'เคลียร์หมดแล้ว ไม่มีงานค้าง'}
                </div>
              ) : data.groups.map((g) => {
                const st = GROUP_STYLE[g.key] || GROUP_STYLE.leave
                const Icon = st.Icon
                return (
                  <button key={g.key} className="nb-card" onClick={() => { setOpen(false); onNavigate?.(g.tab) }}>
                    <span className="nb-ico" style={{ background: st.bg, color: st.fg }}><Icon size={18} /></span>
                    <span className="nb-card-main">
                      <span className="nb-card-top">
                        <span className="nb-card-title">{g.title}</span>
                        <span className="nb-pill" style={{ background: st.bg, color: st.fg }}>{g.count}</span>
                      </span>
                      {g.items.map((line, i) => <span key={i} className="nb-line">{line.text}</span>)}
                      {fmtDateTime(g.latestAt) && <span className="nb-date">ล่าสุด {fmtDateTime(g.latestAt)}</span>}
                      {g.count > g.items.length && <span className="nb-more">+ อีก {g.count - g.items.length} รายการ</span>}
                    </span>
                    <ChevronRight size={16} className="nb-chev" />
                  </button>
                )
              })
            )}

            {tab === 'news' && (CHANGELOG.length ? CHANGELOG.slice(0, 10).map((c) => {
              const fresh = freshIds.has(c.id)
              return (
                <button key={c.id} className={`nb-card nb-news${fresh ? ' is-fresh' : ''}`} style={{ cursor: c.tab ? 'pointer' : 'default' }} onClick={() => { if (c.tab) { setOpen(false); onNavigate?.(c.tab) } }}>
                  <span className="nb-ico" style={{ background: '#f1ecff', color: '#7c5ce0' }}><Sparkles size={18} /></span>
                  <span className="nb-card-main">
                    <span className="nb-card-top">
                      <span className="nb-card-title">{c.title}</span>
                      {fresh && <span className="nb-new">ใหม่</span>}
                    </span>
                    <span className="nb-line is-wrap">{c.detail}</span>
                    <span className="nb-date">{fmtDate(c.date)}</span>
                  </span>
                  {c.tab && <ChevronRight size={16} className="nb-chev" />}
                </button>
              )
            }) : <div className="nb-empty">ยังไม่มีรายการใหม่</div>)}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
