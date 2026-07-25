import { useEffect, useMemo, useState } from 'react'
import { DollarSign, ShoppingBag, Package, Loader2, Info } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, ComposedChart, Line, Legend,
} from 'recharts'
import KpiCard from '../components/KpiCard.jsx'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtBaht = (n) => '฿' + fmt(n)
const fmtShort = (n) => '฿' + (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : Math.round(n))
const PLATFORM_COLORS = {
  Shopee: '#D9784A',
  'TikTok Shop': '#374151',
  Lazada: '#4F7FC8',
}
const CHART_COLORS = {
  sales: '#4F9B82',
  orders: '#B49A6A',
  grid: 'rgba(100, 116, 139, 0.10)',
}
const platColor = (p) => PLATFORM_COLORS[p] || '#94a3b8'
const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthLabel = (ym) => (ym === 'all' ? 'ทั้งหมด' : THAI_MONTH[parseInt(String(ym).slice(5, 7), 10) - 1] || ym)
const periodLabel = (ym) => (ym === 'all' ? 'ทั้งหมด' : `เดือน${monthLabel(ym)}`)

// ป้ายท้ายแท่ง: ค่า + %MoM (เทียบเดือนก่อนหน้า) — ใช้กับกราฟ "แยกร้าน" ทั้งยอดขายและออเดอร์
function StoreBarLabel({ x, y, width, height, index, items, prevMap, dataKey, formatValue, globalLatestDay }) {
  const item = items?.[index]
  if (!item) return null
  const curVal = item[dataKey]
  const prevItem = prevMap.get(item.store)
  const pct = prevItem && prevItem[dataKey] > 0 ? Math.round(((curVal - prevItem[dataKey]) / prevItem[dataKey]) * 100) : null
  const capDiffers = prevItem?.capDay && globalLatestDay && prevItem.capDay !== globalLatestDay
  return (
    <g>
      <text x={x + width + 8} y={y + height / 2} dy={4} fontSize={11} fontWeight={600} fill="var(--payi-text-muted)">{formatValue(curVal)}</text>
      {pct !== null && (
        <text x={x + width + 62} y={y + height / 2} dy={4} fontSize={10} fontWeight={800} fill={pct >= 0 ? '#16a34a' : '#dc2626'}>
          {pct >= 0 ? '+' : ''}{pct}%{capDiffers ? ` (1-${prevItem.capDay})` : ''}
        </text>
      )}
    </g>
  )
}

function TooltipBox({ active, payload, label, moneyKeys = [] }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--payi-surface-dark)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fff' }}>
      <div style={{ color: 'var(--payi-line)', marginBottom: 6, fontWeight: 700 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill || p.stroke }} />
          <span style={{ color: '#cbd5e1' }}>{p.name}:</span>
          <span style={{ fontWeight: 700 }}>{moneyKeys.includes(p.dataKey) ? fmtBaht(p.value) : fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function PlatformPieLabel({ cx, cy, midAngle, outerRadius, percent }) {
  if (!percent || percent < 0.03) return null
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 20
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x}
      y={y}
      fill="var(--payi-text-strong)"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={800}
    >
      {`${Math.round(percent * 100)}%`}
    </text>
  )
}

function PlatformTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0]?.payload
  if (!item) return null
  return (
    <div style={{ background: 'var(--payi-surface-dark)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fff' }}>
      <div style={{ color: '#cbd5e1', marginBottom: 6, fontWeight: 700 }}>{item.name}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: platColor(item.name) }} />
        <span style={{ color: '#cbd5e1' }}>ยอดขาย:</span>
        <span style={{ fontWeight: 800 }}>{fmtBaht(item.value)} ({item.percentLabel})</span>
      </div>
    </div>
  )
}

export default function MonthlyDashboard() {
  const [year, setYear] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [month, setMonth] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    fetch(`/api/monthly${year ? `?year=${year}` : ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (!d.success) throw new Error(d.error)
        setData(d)
        if (!year && d.years?.length) setYear(d.years[d.years.length - 1])
        setMonth((prev) => (d.months?.includes(prev) ? prev : d.months?.[d.months.length - 1] || ''))
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [year])

  const isAll = month === 'all'
  const trend = data?.trend || []
  const idx = trend.findIndex((t) => t.month === month)
  const cur = isAll
    ? trend.reduce((a, t) => ({ sales: a.sales + t.sales, orders: a.orders + t.orders, units: a.units + t.units }), { sales: 0, orders: 0, units: 0 })
    : (idx >= 0 ? trend[idx] : null)
  // เดือนล่าสุดที่ยังไม่ครบเดือน (เช่น อัพแค่ 1-19) เทียบเต็มเดือนก่อนหน้าจะดูตกหนักเกินจริงเพราะ
  // จำนวนวันไม่เท่ากัน — ใช้ partialMonth.prevMonthCapped (เดือนก่อนนับแค่วันที่ 1..latestDay
  // เท่ากัน) แทนเดือนก่อนแบบเต็มเดือน เฉพาะตอนกำลังดูเดือนที่ยังไม่ครบนี้เท่านั้น
  const partial = !isAll && data?.partialMonth?.month === month ? data.partialMonth : null
  const prev = isAll ? null : partial
    ? { month: partial.prevMonthCapped.month, ...partial.prevMonthCapped.trend }
    : (idx > 0 ? trend[idx - 1] : null)
  const mom = (c, p) => (p > 0 ? Math.round(((c - p) / p) * 100) : null)

  // "ทั้งหมด" = รวมยอดทุกเดือนต่อร้าน (byStore มีแยกรายเดือนอยู่แล้ว รวมเองฝั่ง client)
  const stores = useMemo(() => {
    if (!data) return []
    if (!isAll) return data.byStore?.[month] || []
    const merged = new Map()
    for (const ym of data.months || []) {
      for (const s of data.byStore?.[ym] || []) {
        let m = merged.get(s.store)
        if (!m) merged.set(s.store, (m = { store: s.store, business: s.business, platform: s.platform, sales: 0, units: 0, orders: 0 }))
        m.sales += s.sales; m.units += s.units; m.orders += s.orders
      }
    }
    return [...merged.values()].sort((a, b) => b.sales - a.sales)
  }, [data, month, isAll])
  const storesByOrders = useMemo(() => [...stores].sort((a, b) => b.orders - a.orders), [stores])
  // ยอด/ออเดอร์เดือนก่อนหน้า ต่อร้าน — ไว้คำนวณ %MoM รายร้าน (ไม่มีถ้าเลือก "ทั้งหมด")
  const prevStoreMap = useMemo(() => {
    if (!prev) return new Map()
    const list = partial ? partial.prevMonthCapped.byStore : (data?.byStore?.[prev.month] || [])
    return new Map(list.map((s) => [s.store, s]))
  }, [data, prev, partial])
  const platformShare = useMemo(() => {
    const m = {}
    for (const s of stores) m[s.platform] = (m[s.platform] || 0) + s.sales
    const total = Object.values(m).reduce((sum, value) => sum + value, 0)
    return Object.entries(m)
      .map(([name, value]) => {
        const pct = total > 0 ? (value / total) * 100 : 0
        return { name, value, pct, percentLabel: `${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%` }
      })
      .sort((a, b) => b.value - a.value)
  }, [stores])
  const trendChart = useMemo(() => trend.map((t) => ({ label: monthLabel(t.month), sales: t.sales, orders: t.orders })), [trend])

  if (loading && !data) return <Center><Loader2 size={18} className="payi-spin" /> กำลังโหลดข้อมูล...</Center>
  if (error) return <Center danger><Info size={18} /> โหลดไม่สำเร็จ: {error}</Center>

  const salesMoM = cur && prev ? mom(cur.sales, prev.sales) : null
  const ordersMoM = cur && prev ? mom(cur.orders, prev.orders) : null
  const unitsMoM = cur && prev ? mom(cur.units, prev.units) : null

  return (
    <div style={{ width: '100%' }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <select value={year} onChange={(e) => setYear(e.target.value)} className="payi-select" style={{ padding: '8px 12px', fontSize: 13 }}>
          {(data?.years || []).map((y) => <option key={y} value={y}>ปี {y}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="payi-select" style={{ padding: '8px 12px', fontSize: 13 }}>
          <option value="all">ทั้งหมด</option>
          {(data?.months || []).map((ym) => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
        </select>
      </div>

      {partial && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--payi-warning-bg, #fffbeb)', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#92400e' }}>
          <Info size={15} style={{ flexShrink: 0 }} />
          <span>
            ข้อมูลเดือนนี้อัพเดตถึงวันที่ {partial.latestDay} เท่านั้น (จาก {partial.daysInMonth} วัน) — %MoM ด้านล่างเทียบกับ{' '}
            <b>วันที่ 1-{partial.latestDay} ของ{monthLabel(partial.prevMonthCapped.month)}</b> (ไม่ใช่ทั้งเดือน) เพื่อให้เทียบกันแบบยุติธรรม
            แต่ละร้านอัพไฟล์คนละวันกันได้ — %MoM ต่อร้านจะเทียบตามวันล่าสุดที่ร้านนั้นมีข้อมูลจริง (ดูวงเล็บท้ายแท่งกราฟถ้าร้านไหนวันไม่ตรงกับข้างบน)
          </span>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
        <KpiCard title="ยอดขายรวม" value={fmtBaht(cur?.sales || 0)} subtitle={prev ? `${monthLabel(prev.month)}${partial ? ` (1-${partial.latestDay})` : ''}: ${fmtBaht(prev.sales)}` : periodLabel(month)} icon={DollarSign} trend={salesMoM !== null ? `${salesMoM >= 0 ? '+' : ''}${salesMoM}%` : null} isPositive={salesMoM === null || salesMoM >= 0} />
        <KpiCard title="จำนวนออเดอร์" value={fmt(cur?.orders || 0)} subtitle={prev ? `${monthLabel(prev.month)}${partial ? ` (1-${partial.latestDay})` : ''}: ${fmt(prev.orders)}` : periodLabel(month)} icon={ShoppingBag} trend={ordersMoM !== null ? `${ordersMoM >= 0 ? '+' : ''}${ordersMoM}%` : null} isPositive={ordersMoM === null || ordersMoM >= 0} />
        <KpiCard title="จำนวนชิ้น" value={fmt(cur?.units || 0)} subtitle={prev ? `${monthLabel(prev.month)}${partial ? ` (1-${partial.latestDay})` : ''}: ${fmt(prev.units)}` : periodLabel(month)} icon={Package} trend={unitsMoM !== null ? `${unitsMoM >= 0 ? '+' : ''}${unitsMoM}%` : null} isPositive={unitsMoM === null || unitsMoM >= 0} />
      </div>

      {/* Sales by store + Platform donut */}
      <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(240px, 1fr)', gap: 16, marginBottom: 20 }}>
        <Card title="ยอดขายแยกร้าน" sub={`${periodLabel(month)} · เรียงจากมากไปน้อย${prev ? ` · %MoM เทียบ ${monthLabel(prev.month)}${partial ? ` (1-${partial.latestDay})` : ''}` : ''}`}>
          <ResponsiveContainer width="100%" height={Math.max(200, stores.length * 42)}>
            <BarChart data={stores} layout="vertical" margin={{ left: 8, right: 95, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v) => `฿${v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : Math.round(v / 1000) + 'k'}`} />
              <YAxis type="category" dataKey="store" tick={{ fontSize: 12, fill: 'var(--payi-text)' }} axisLine={false} tickLine={false} width={110} />
              <Tooltip content={<TooltipBox moneyKeys={['sales']} />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Bar dataKey="sales" name="ยอดขาย" radius={[0, 6, 6, 0]} barSize={20}
                label={<StoreBarLabel items={stores} prevMap={prevStoreMap} dataKey="sales" formatValue={fmtShort} globalLatestDay={partial?.latestDay} />}>
                {stores.map((s, i) => <Cell key={i} fill={platColor(s.platform)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="สัดส่วนแพลตฟอร์ม" sub={periodLabel(month)}>
          <ResponsiveContainer width="100%" height={290}>
            <PieChart>
              <Pie
                data={platformShare}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="47%"
                innerRadius={68}
                outerRadius={108}
                paddingAngle={2}
                labelLine={{ stroke: 'var(--payi-border)' }}
                label={PlatformPieLabel}
              >
                {platformShare.map((p, i) => <Cell key={i} fill={platColor(p.name)} />)}
              </Pie>
              <Tooltip content={<PlatformTooltip />} />
              <Legend
                verticalAlign="bottom"
                height={24}
                formatter={(v) => {
                  const item = platformShare.find((entry) => entry.name === v)
                  return <span style={{ fontSize: 12, color: 'var(--payi-text)' }}>{v}{item ? ` ${item.percentLabel}` : ''}</span>
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Monthly trend combo */}
      <Card title="แนวโน้มรายเดือน" sub="แท่ง = ยอดขาย · เส้น = จำนวนออเดอร์" mb>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={trendChart} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v) => `฿${v >= 1000000 ? (v / 1000000).toFixed(0) + 'M' : Math.round(v / 1000) + 'k'}`} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
            <Tooltip content={<TooltipBox moneyKeys={['sales']} />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar yAxisId="l" dataKey="sales" name="ยอดขาย" fill={CHART_COLORS.sales} radius={[6, 6, 0, 0]} barSize={38} />
            <Line yAxisId="r" dataKey="orders" name="ออเดอร์" stroke={CHART_COLORS.orders} strokeWidth={2.5} dot={{ r: 3, fill: '#ffffff', strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Orders by store — ใช้วางแผนแพ็กของ/OT ต่อร้าน */}
      <Card title="จำนวนออเดอร์แยกร้าน" sub={`${periodLabel(month)} · ไว้วางแผนแพ็กของ/OT${prev ? ` · %MoM เทียบ ${monthLabel(prev.month)}${partial ? ` (1-${partial.latestDay})` : ''}` : ''}`}>
        <ResponsiveContainer width="100%" height={Math.max(180, storesByOrders.length * 42)}>
          <BarChart data={storesByOrders} layout="vertical" margin={{ left: 8, right: 95, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="store" tick={{ fontSize: 12, fill: 'var(--payi-text)' }} axisLine={false} tickLine={false} width={110} />
            <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar dataKey="orders" name="ออเดอร์" radius={[0, 6, 6, 0]} barSize={20}
              label={<StoreBarLabel items={storesByOrders} prevMap={prevStoreMap} dataKey="orders" formatValue={fmt} globalLatestDay={partial?.latestDay} />}>
              {storesByOrders.map((s, i) => <Cell key={i} fill={platColor(s.platform)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '10px 14px', background: 'var(--payi-surface-muted)', borderRadius: 10, fontSize: 12, color: 'var(--payi-text-muted)' }}>
        <Info size={15} />
        ค่า Ads และยอด TikTok แยกช่อง (Affiliate/Live/VDO) ยังไม่รวม — ต้องต่อแหล่งข้อมูลเพิ่ม
      </div>
    </div>
  )
}

function Card({ title, sub, children, mb }) {
  return (
    <div className="payi-glass-card" style={{ padding: 18, marginBottom: mb ? 20 : 0 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 2 }}>{sub}</div>}
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
