import { useEffect, useMemo, useState } from 'react'
import { Package, DollarSign, Layers, Boxes, Loader2, Info, X, Search } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts'
import KpiCard from '../components/KpiCard.jsx'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtBaht = (n) => '฿' + fmt(n)
const fmtShort = (n) => '฿' + (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : Math.round(n))
const PLATFORM_COLORS = { Shopee: '#F0662C', 'TikTok Shop': '#2AA79B', Lazada: '#2F5FD0' }
const platColor = (p) => PLATFORM_COLORS[p] || '#94a3b8'
// จานสีสำหรับกราฟเส้นแนวโน้ม (top groups)
const LINE_COLORS = ['#2AA79B', '#F0662C', '#2F5FD0', '#9333EA', '#DB2777', '#0891B2', '#CA8A04', '#65A30D']
const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthLabel = (ym) => (ym === 'all' ? 'ทั้งหมด' : THAI_MONTH[parseInt(String(ym).slice(5, 7), 10) - 1] || ym)
// ป้ายช่วงเวลาไว้ต่อท้ายหัวข้อการ์ด — "all" = "ทั้งหมด" เฉยๆ, เดือนอื่นนำหน้าด้วย "เดือน"
const periodLabel = (ym) => (ym === 'all' ? 'ทั้งหมด' : `เดือน${monthLabel(ym)}`)

const BUSINESSES = ['Payi', 'กรอบรูป']
const PLATFORMS = ['Shopee', 'TikTok Shop', 'Lazada']

function TooltipBox({ active, payload, label, moneyKeys = [] }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--payi-surface-dark)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fff', maxWidth: 260 }}>
      <div style={{ color: 'var(--payi-line)', marginBottom: 6, fontWeight: 700 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill || p.stroke, flexShrink: 0 }} />
          <span style={{ color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}:</span>
          <span style={{ fontWeight: 700 }}>{moneyKeys.includes(p.dataKey) || moneyKeys.includes(p.name) ? fmtBaht(p.value) : fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ProductDashboard() {
  const [business, setBusiness] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [month, setMonth] = useState('') // '' = ให้ server เลือกเดือนล่าสุดให้
  const [metric, setMetric] = useState('revenue') // revenue | units
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null) // กลุ่มที่เปิด drawer
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    const params = new URLSearchParams()
    if (business !== 'all') params.set('business', business)
    if (platform !== 'all') params.set('platform', platform)
    if (month) params.set('month', month)
    fetch(`/api/products${params.toString() ? '?' + params : ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (!d.success) throw new Error(d.error)
        setData(d) // ไม่ setMonth ทับที่นี่ — กัน fetch ซ้ำรอบสอง ใช้ activeMonth (ด้านล่าง) แทน
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [business, platform, month])

  const totals = data?.totals || {}
  const groups = useMemo(() => data?.groups || [], [data])
  const availableMonths = data?.months || []
  const activeMonth = month || data?.month || '' // เดือนที่กำลังแสดงจริง (ผู้ใช้เลือก หรือ server เลือกเดือนล่าสุดให้)
  const prevMonthLabel = totals.prevMonth ? monthLabel(totals.prevMonth) : null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.label.toLowerCase().includes(q) || g.members.some((m) => (m.master_sku || '').toLowerCase().includes(q)))
  }, [groups, search])

  const topChart = useMemo(() => {
    const key = metric === 'units' ? 'units' : 'revenue'
    return [...filtered].sort((a, b) => b[key] - a[key]).slice(0, 12).map((g) => ({
      label: g.label.length > 22 ? g.label.slice(0, 21) + '…' : g.label,
      fullLabel: g.label,
      value: g[key],
      key: g.key,
    }))
  }, [filtered, metric])

  const trendChart = useMemo(() => {
    const series = data?.trendTopGroups || []
    const months = data?.months || []
    return months.map((ym) => {
      const row = { label: monthLabel(ym) }
      series.forEach((s) => {
        const pt = s.monthly.find((p) => p.month === ym)
        row[s.key] = pt ? pt.revenue : 0
      })
      return row
    })
  }, [data])

  if (loading && !data) return <Center><Loader2 size={18} className="payi-spin" /> กำลังโหลดข้อมูลสินค้า...</Center>
  if (error) return <Center danger><Info size={18} /> โหลดไม่สำเร็จ: {error}</Center>

  return (
    <div style={{ width: '100%' }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <FilterGroup label="ร้าน" value={business} setValue={setBusiness} options={BUSINESSES} />
        <FilterGroup label="แพลตฟอร์ม" value={platform} setValue={setPlatform} options={PLATFORMS} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 240, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 8, padding: '8px 12px' }}>
          <Search size={15} color="var(--payi-text-muted)" />
          <input placeholder="ค้นหาสินค้า / SKU" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13, background: 'transparent', color: 'var(--payi-text-strong)' }} />
        </div>
      </div>

      {/* Month selector */}
      {availableMonths.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text-muted)' }}>เดือน:</span>
          <select value={activeMonth} onChange={(e) => setMonth(e.target.value)} className="payi-select" style={{ padding: '7px 12px', fontSize: 13 }}>
            <option value="all">ทั้งหมด</option>
            {availableMonths.map((ym) => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
          </select>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
        <KpiCard
          title="ยอดขายรวม"
          value={fmtBaht(totals.revenue)}
          subtitle={prevMonthLabel ? `${prevMonthLabel}: ${fmtBaht(totals.prevRevenue)}` : `${periodLabel(activeMonth)}`}
          icon={DollarSign}
          trend={totals.revenueMoM !== null && totals.revenueMoM !== undefined ? `${totals.revenueMoM >= 0 ? '+' : ''}${totals.revenueMoM}%` : null}
          isPositive={totals.revenueMoM === null || totals.revenueMoM === undefined || totals.revenueMoM >= 0}
        />
        <KpiCard
          title="จำนวนชิ้น"
          value={fmt(totals.units)}
          subtitle={prevMonthLabel ? `${prevMonthLabel}: ${fmt(totals.prevUnits)}` : `${periodLabel(activeMonth)}`}
          icon={Package}
          trend={totals.unitsMoM !== null && totals.unitsMoM !== undefined ? `${totals.unitsMoM >= 0 ? '+' : ''}${totals.unitsMoM}%` : null}
          isPositive={totals.unitsMoM === null || totals.unitsMoM === undefined || totals.unitsMoM >= 0}
        />
        <KpiCard title="กลุ่มสินค้า" value={fmt(totals.groupCount)} subtitle={`${periodLabel(activeMonth)} · หลังรวมไซส์/รุ่นย่อย`} icon={Layers} />
        <KpiCard title="SKU ที่ขายได้" value={fmt(totals.skuCount)} subtitle={`${periodLabel(activeMonth)} · ก่อนรวมกลุ่ม`} icon={Boxes} />
      </div>

      {/* Best sellers */}
      <Card
        title="สินค้าขายดี (รวมไซส์เป็นกลุ่มเดียว)"
        sub={`${periodLabel(activeMonth)} · Top 12 · ${metric === 'units' ? 'ตามจำนวนชิ้น' : 'ตามยอดขาย'}`}
        right={
          <div style={{ display: 'flex', gap: 4 }}>
            {[['revenue', 'ยอดขาย'], ['units', 'จำนวนชิ้น']].map(([m, lbl]) => (
              <button key={m} onClick={() => setMetric(m)} style={pillStyle(metric === m)}>{lbl}</button>
            ))}
          </div>
        }
        mb
      >
        <ResponsiveContainer width="100%" height={Math.max(240, topChart.length * 38)}>
          <BarChart data={topChart} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false}
              tickFormatter={(v) => (metric === 'units' ? fmt(v) : fmtShort(v))} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: 'var(--payi-text)' }} axisLine={false} tickLine={false} width={160} />
            <Tooltip content={<TooltipBox moneyKeys={metric === 'units' ? [] : ['value']} />} cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              labelFormatter={(_, p) => p?.[0]?.payload?.fullLabel || ''} />
            <Bar dataKey="value" name={metric === 'units' ? 'จำนวนชิ้น' : 'ยอดขาย'} radius={[0, 6, 6, 0]} barSize={20}
              onClick={(d) => setSelected(groups.find((g) => g.key === d.key))} style={{ cursor: 'pointer' }}
              label={{ position: 'right', fontSize: 11, fill: 'var(--payi-text-muted)', formatter: (v) => (metric === 'units' ? fmt(v) : fmtShort(v)) }}>
              {topChart.map((_, i) => <Cell key={i} fill="var(--payi-mint)" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Trend of top groups */}
      {trendChart.length > 1 && (
        <Card title="แนวโน้มยอดขายรายเดือน" sub={`กลุ่มสินค้าขายดี Top 8 ของ${periodLabel(activeMonth)} · แยกตามเดือน`} mb>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendChart} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtShort(v)} />
              <Tooltip content={<TooltipBox moneyKeys={(data?.trendTopGroups || []).map((s) => s.key)} />} />
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }}
                formatter={(key) => (data?.trendTopGroups || []).find((s) => s.key === key)?.label || key} />
              {(data?.trendTopGroups || []).map((s, i) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Product table */}
      <Card title="ตารางสินค้าทั้งหมด" sub={`${periodLabel(activeMonth)} · ${filtered.length} กลุ่ม · คลิกเพื่อดูรายละเอียดและ SKU ในกลุ่ม`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={thStyle}>สินค้า</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>SKU</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ชิ้น</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ออเดอร์</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ราคาเฉลี่ย</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ยอดขาย</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>MoM</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 60).map((g) => (
                <tr key={g.key} onClick={() => setSelected(g)} style={{ borderTop: '1px solid var(--payi-border)', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--payi-surface-muted)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{g.label}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)' }}>{g.skuCount}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {fmt(g.units)}
                    {g.unitsFromSet > 0 && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--payi-mint-strong)' }} title={`ขายเดี่ยว ${fmt(g.directUnits)} + จาก Set ${fmt(g.unitsFromSet)}`}>
                        รวม Set แล้ว
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(g.orders)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--payi-text-muted)' }}>{fmtBaht(g.avgPrice)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: 'var(--payi-text-strong)' }}>{fmtBaht(g.revenue)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <MomBadge value={g.revenueMoM} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && <ProductDrawer group={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ─── Drawer: รายละเอียดกลุ่มสินค้า + SKU สมาชิก + ช่องทาง ───
function ProductDrawer({ group, onClose }) {
  const platformEntries = Object.entries(group.platforms || {})
    .map(([name, revenue]) => ({ name, revenue, fill: platColor(name) }))
    .sort((a, b) => b.revenue - a.revenue)
  const totalPlat = platformEntries.reduce((s, p) => s + p.revenue, 0)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.15)', backdropFilter: 'blur(4px)', zIndex: 998 }} />
      <div className="payi-drawer-slide-in" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, maxWidth: '92vw', background: 'var(--payi-surface)', boxShadow: '-10px 0 40px rgba(15,23,42,0.08)', zIndex: 999, display: 'flex', flexDirection: 'column', padding: 28, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div style={{ maxWidth: '85%' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)', borderRadius: 6 }}>{group.skuCount} SKU ในกลุ่ม</span>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--payi-text-strong)', marginTop: 10, lineHeight: 1.4 }}>{group.label}</h3>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', padding: 6, borderRadius: '50%', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--payi-text-muted)' }}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, paddingRight: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <MiniStat label="ยอดขายเดือนนี้" value={fmtBaht(group.revenue)} trend={<MomBadge value={group.revenueMoM} />} />
            <MiniStat
              label={group.unitsFromSet > 0 ? 'ขายได้ (รวม Set แล้ว)' : 'ขายได้'}
              value={`${fmt(group.units)} ชิ้น`}
              trend={<MomBadge value={group.unitsMoM} />}
            />
          </div>
          {group.unitsFromSet > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginTop: -8 }}>
              ขายเดี่ยว {fmt(group.directUnits)} ชิ้น + แตกยอดจาก Set {fmt(group.unitsFromSet)} ชิ้น
            </div>
          )}

          {totalPlat > 0 && (
            <div>
              <SectionLabel>สัดส่วนช่องทางขาย</SectionLabel>
              {platformEntries.map((p, i) => {
                const pct = Math.round((p.revenue / totalPlat) * 100)
                return (
                  <div key={p.name} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: 'var(--payi-text-strong)' }}>{p.name}</span>
                      <span style={{ color: 'var(--payi-text-muted)' }}>{fmtBaht(p.revenue)} · {pct}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--payi-surface-muted)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: p.fill, borderRadius: 999 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div>
            <SectionLabel>SKU ในกลุ่มนี้ ({group.members.length})</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.members.map((m) => (
                <div key={m.master_sku} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.display_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontFamily: 'monospace' }}>{m.master_sku}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{fmtBaht(m.revenue)}</div>
                    <div style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>{fmt(m.units)} ชิ้น</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ป้าย %MoM (เทียบเดือนก่อนหน้า) — เขียว = ขึ้น, ส้ม = ลง, จาง = ไม่มีข้อมูลเดือนก่อนเทียบ
function MomBadge({ value }) {
  if (value === null || value === undefined) return <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>—</span>
  const up = value >= 0
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
      background: up ? 'var(--payi-success-bg)' : 'var(--payi-danger-bg)',
      color: up ? 'var(--payi-success)' : 'var(--payi-danger)',
    }}>
      {up ? '+' : ''}{value}%
    </span>
  )
}

function MiniStat({ label, value, trend }) {
  return (
    <div style={{ background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', padding: 16, borderRadius: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{value}</div>
        {trend}
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--payi-text)', marginBottom: 12 }}>{children}</div>
}

function FilterGroup({ label, value, setValue, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text-muted)' }}>{label}:</span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button onClick={() => setValue('all')} style={pillStyle(value === 'all')}>ทั้งหมด</button>
        {options.map((o) => <button key={o} onClick={() => setValue(o)} style={pillStyle(value === o)}>{o}</button>)}
      </div>
    </div>
  )
}

function pillStyle(active) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: active ? 800 : 600, borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--payi-mint)' : 'var(--payi-border)'}`,
    background: active ? 'var(--payi-mint-soft)' : 'var(--payi-surface)',
    color: active ? 'var(--payi-mint-strong)' : 'var(--payi-text)',
  }
}

const thStyle = { padding: '8px 10px', fontWeight: 700 }
const tdStyle = { padding: '11px 10px' }

function Card({ title, sub, children, right, mb }) {
  return (
    <div className="payi-glass-card" style={{ padding: 18, marginBottom: mb ? 20 : 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Center({ children, danger }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: '50vh', fontSize: 14, color: danger ? 'var(--payi-danger)' : 'var(--payi-text-muted)' }}>
      {children}
    </div>
  )
}
