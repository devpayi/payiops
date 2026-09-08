import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Info, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import Mascot from '../components/Mascot.jsx'
import Sparkline from '../components/Sparkline.jsx'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtBaht = (n) => '฿' + fmt(n)
const fmtShort = (n) => '฿' + (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : Math.round(n))
const PLATFORM_COLORS = { Shopee: '#D9784A', 'TikTok Shop': '#6a63e8', Lazada: '#4F7FC8' }
const platColor = (p) => PLATFORM_COLORS[p] || '#a78bfa'

// auto-refresh ทุก 5 นาที — ข้อมูลสดเท่าที่ import xlsx เข้ามาล่าสุด (ไม่มี feed สดจาก platform)
const REFRESH_MS = 300000

const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const dayLabel = (iso) => {
  if (!iso) return '-'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${THAI_MONTH[m - 1]} ${(y + 543) % 100}`
}
const pct = (cur, base) => (base > 0 ? Math.round(((cur - base) / base) * 100) : null)

export default function DailyDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const aliveRef = useRef(true)

  const load = useCallback((soft) => {
    if (soft) setRefreshing(true); else setLoading(true)
    setError(null)
    // no-store + cache-bust — หน้านี้ต้องได้ข้อมูลสดทุกครั้งที่ auto-refresh
    fetch(`/api/dashboard?view=daily&_=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!aliveRef.current) return
        if (!d.success) throw new Error(d.error)
        setData(d)
      })
      .catch((e) => aliveRef.current && setError(e.message))
      .finally(() => { if (aliveRef.current) { setLoading(false); setRefreshing(false) } })
  }, [])

  useEffect(() => {
    aliveRef.current = true
    load(false)
    const iv = setInterval(() => load(true), REFRESH_MS)
    const onFocus = () => load(true)
    window.addEventListener('focus', onFocus)
    return () => { aliveRef.current = false; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [load])

  if (loading && !data) return <Center><Loader2 size={18} className="payi-spin" /> กำลังโหลดข้อมูล...</Center>
  if (error && !data) return <Center danger><Info size={18} /> โหลดไม่สำเร็จ: {error}</Center>
  if (!data) return null

  const { today, todayStats, yesterdayStats, avg7, byStore = [], topToday = [], risers = [], decliners = [], recentDays = [] } = data
  const t = todayStats || { revenue: 0, orders: 0, units: 0 }
  const y = yesterdayStats || { revenue: 0, orders: 0, units: 0 }
  const revP = pct(t.revenue, y.revenue)
  const ordP = pct(t.orders, y.orders)
  const unitP = pct(t.units, y.units)
  const revVsAvg = avg7 ? pct(t.revenue, avg7.revenue) : null
  const avgRatio = avg7 && avg7.revenue > 0 ? Math.round((t.revenue / avg7.revenue) * 100) : null

  const realToday = new Date(); realToday.setHours(0, 0, 0, 0)
  const dataDate = today ? new Date(today + 'T00:00:00') : null
  const staleDays = dataDate ? Math.round((realToday - dataDate) / 86400000) : null
  const isStale = staleDays !== null && staleDays >= 1

  const maxStore = Math.max(1, ...byStore.map((s) => s.revenue))
  const spark = recentDays.map((d) => ({ d: d.date.slice(8, 10), rev: d.revenue }))

  return (
    <div className="daily-glass-page" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
      <Mascot pose="cheer" size={52} style={{ position: 'absolute', top: -20, right: 4, zIndex: 3, pointerEvents: 'none', transform: 'rotate(9deg)' }} />
      <Mascot pose="run" size={50} style={{ position: "absolute", bottom: 4, left: -18, zIndex: 3, pointerEvents: 'none' }} />

      {/* ── KPI แถวบน ── */}
      <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <div className="dd-card dd-card--grad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.9 }}>ยอดขาย {dayLabel(today)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {isStale && <span className="dd-pill dd-pill--on-grad">เก่า {staleDays} วัน</span>}
              <button onClick={() => load(true)} disabled={refreshing} title="รีเฟรช"
                style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: '#fff', cursor: refreshing ? 'default' : 'pointer', padding: 0, opacity: 0.9 }}>
                <RefreshCw size={13} className={refreshing ? 'payi-spin' : ''} />
              </button>
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 850, letterSpacing: '-0.02em', margin: '2px 0 1px' }}>{fmtBaht(t.revenue)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, opacity: 0.92 }}>
            <Pill p={revP} onGrad /> <span>vs เมื่อวาน {fmtShort(y.revenue)}</span>
          </div>
          <Sparkline data={spark.map((s) => ({ label: `วันที่ ${s.d}`, value: s.rev }))} formatValue={fmtBaht} height={22} />
        </div>

        <KpiCard label="ออเดอร์" value={fmt(t.orders)} p={ordP} sub={`เมื่อวาน ${fmt(y.orders)}`} />
        <KpiCard label="จำนวนชิ้น" value={fmt(t.units)} p={unitP} sub={`เมื่อวาน ${fmt(y.units)}`} />

        <div className="dd-card" style={{ alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--dd-sub)', alignSelf: 'flex-start' }}>เทียบเฉลี่ย {avg7?.days || 7} วัน</div>
          <Ring value={avgRatio} />
          <div style={{ fontSize: 10.5, color: 'var(--dd-sub)' }}>เฉลี่ย {avg7 ? fmtShort(avg7.revenue) : '-'}</div>
        </div>
      </div>

      {/* ── แถวกลาง: กราฟ 14 วัน + ยอดขายแยกร้าน ── */}
      <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 6fr) minmax(0, 4fr)', gap: 11 }}>
        <div className="dd-card">
          <Head title="ยอดขาย 14 วันล่าสุด" sub="พื้นที่ = ยอดขายรายวัน" right={revVsAvg !== null && <Pill p={revVsAvg} suffix=" vs เฉลี่ย" />} />
          <ResponsiveContainer width="100%" height={152}>
            <AreaChart data={spark} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="ddArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2f86cf" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#2f86cf" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: 'var(--dd-sub)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--dd-sub)' }} axisLine={false} tickLine={false} width={52} tickFormatter={fmtShort}
                domain={[(min) => Math.max(0, Math.floor((min * 0.88) / 1000) * 1000), (max) => Math.ceil((max * 1.05) / 1000) * 1000]} />
              <Tooltip cursor={{ stroke: '#2f86cf', strokeDasharray: '3 3' }} content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div style={{ background: 'var(--payi-surface-dark)', borderRadius: 8, padding: '7px 11px', fontSize: 11.5, color: '#fff' }}>
                    <div style={{ opacity: 0.8 }}>วันที่ {label}</div>
                    <div style={{ fontWeight: 700 }}>{fmtBaht(payload[0].value)}</div>
                  </div>
                )
              }} />
              <Area type="monotone" dataKey="rev" stroke="#1f6fb2" strokeWidth={2.5} fill="url(#ddArea)"
                dot={false} activeDot={{ r: 4, fill: '#e5342b', stroke: '#16181d', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="dd-card">
          <Head title="ยอดขายแยกร้าน" sub={dayLabel(today)} right={<Mascot pose="wave" size={30} style={{ marginTop: -2 }} />} />
          {byStore.length === 0 ? <Empty /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2, maxHeight: 240, overflowY: 'auto' }}>
              {byStore.map((s) => {
                const p = pct(s.revenue, s.prevRevenue)
                return (
                  <div key={s.store}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: platColor(s.platform), flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 11.5, color: 'var(--dd-ink)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.store.replace('TikTok Shop', 'TikTok').replace('Payi Outlet', 'Outlet')}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--dd-ink)' }}>{fmtShort(s.revenue)}</span>
                      {p !== null && <Pill p={p} />}
                    </div>
                    <div style={{ height: 7, borderRadius: 999, background: 'rgba(20,22,28,0.10)', border: '1px solid rgba(20,22,28,0.18)', overflow: 'hidden' }}>
                      <div style={{ width: `${(s.revenue / maxStore) * 100}%`, height: '100%', borderRadius: 999, background: platColor(s.platform) }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── แถวล่าง: ขายดี / ขายดีขึ้น / ยอดลด ── */}
      <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <div className="dd-card">
          <Head title="สินค้าขายดีวันนี้" sub={`Top ${Math.min(5, topToday.length)} · กลุ่มสินค้า`} />
          <RowList rows={topToday.slice(0, 5)} keyFn={(p) => p.name} render={(p, i) => (
            <>
              <span className="dd-rank" style={{ fontSize: 10, fontWeight: 800, width: 17, height: 17, borderRadius: 6, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{i + 1}</span>
              <Name>{p.name}</Name>
              <span style={{ fontSize: 10.5, color: 'var(--dd-sub)' }}>{fmt(p.qty)} ชิ้น</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--dd-ink)', width: 60, textAlign: 'right' }}>{fmtBaht(p.revenue)}</span>
            </>
          )} />
        </div>

        <div className="dd-card">
          <Head title="สินค้าขายดีขึ้น" sub="วันนี้ > เฉลี่ย 7 วัน · ชิ้น = งานแพ็ค" />
          {risers.length === 0 ? <Empty text="ไม่มีสินค้าที่ยอดพุ่งผิดปกติ" /> : (
            <RowList rows={risers.slice(0, 5)} keyFn={(d) => d.name} render={(d) => (
              <>
                <TrendingUp size={13} style={{ color: 'var(--dd-up)', flexShrink: 0 }} />
                <Name>{d.name}</Name>
                <span style={{ fontSize: 10.5, color: 'var(--dd-sub)' }}>{fmt(d.todayQty)}{d.avgQty ? `/${fmt(d.avgQty)}` : ''} ชิ้น</span>
                <span className="dd-pill dd-pill--up" style={{ width: 46, justifyContent: 'center' }}>{d.gainPct === null ? 'ใหม่' : `+${d.gainPct}%`}</span>
              </>
            )} />
          )}
        </div>

        <div className="dd-card">
          <Head title="สินค้าที่ยอดลด" sub="วันนี้ต่ำกว่าเฉลี่ย 7 วันมาก" />
          {decliners.length === 0 ? <Empty text="ไม่มีสินค้าที่ยอดลดผิดปกติ" /> : (
            <RowList rows={decliners.slice(0, 5)} keyFn={(d) => d.name} render={(d) => (
              <>
                <TrendingDown size={13} style={{ color: 'var(--dd-down)', flexShrink: 0 }} />
                <Name>{d.name}</Name>
                <span style={{ fontSize: 10.5, color: 'var(--dd-sub)' }}>{fmt(d.todayQty)}/{fmt(d.avgQty)} ชิ้น</span>
                <span className="dd-pill dd-pill--down" style={{ width: 46, justifyContent: 'center' }}>-{d.dropPct}%</span>
              </>
            )} />
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, p, sub }) {
  return (
    <div className="dd-card" style={{ gap: 3 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--dd-sub)' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 850, color: 'var(--dd-ink)', letterSpacing: '-0.01em' }}>{value}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2 }}>
        <Pill p={p} />
        <span style={{ fontSize: 10.5, color: 'var(--dd-sub)' }}>{sub}</span>
      </div>
    </div>
  )
}

function Pill({ p, onGrad, suffix = '' }) {
  if (p === null || p === undefined) return <span className={`dd-pill ${onGrad ? 'dd-pill--on-grad' : 'dd-pill--flat'}`}>–</span>
  const cls = onGrad ? 'dd-pill--on-grad' : p >= 0 ? 'dd-pill--up' : 'dd-pill--down'
  return <span className={`dd-pill ${cls}`}>{p >= 0 ? '▲' : '▼'} {p >= 0 ? '+' : ''}{p}%{suffix}</span>
}

function Ring({ value }) {
  const r = 30, c = 2 * Math.PI * r
  const v = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value))
  const col = value === null ? '#c4c4d4' : value >= 95 ? '#12915a' : value >= 75 ? '#ffce1f' : '#e5342b'
  return (
    <svg width="86" height="86" viewBox="0 0 86 86">
      <circle cx="43" cy="43" r={r} fill="none" stroke="rgba(20,22,28,0.12)" strokeWidth="8" />
      <circle cx="43" cy="43" r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform="rotate(-90 43 43)" />
      <text x="43" y="43" textAnchor="middle" dominantBaseline="central" fontSize="19" fontWeight="850" fill="var(--dd-ink)">
        {value === null ? '–' : `${value}%`}
      </text>
    </svg>
  )
}

function Head({ title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--dd-ink)' }}>{title}</div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--dd-sub)', marginTop: 1 }}>{sub}</div>}
      </div>
      {right || null}
    </div>
  )
}

function RowList({ rows, keyFn, render }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <div key={keyFn(r)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < rows.length - 1 ? '1px solid rgba(120,120,150,0.14)' : 'none' }}>
          {render(r, i)}
        </div>
      ))}
    </div>
  )
}

function Name({ children }) {
  return <span style={{ flex: 1, fontSize: 12, color: 'var(--dd-ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
}

function Empty({ text = 'ยังไม่มีข้อมูลวันล่าสุด' }) {
  return <div style={{ fontSize: 12, color: 'var(--dd-sub)', padding: '6px 0' }}>{text}</div>
}

function Center({ children, danger }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: '50vh', fontSize: 14, color: danger ? 'var(--payi-danger)' : 'var(--payi-text-muted)' }}>
      {children}
    </div>
  )
}
