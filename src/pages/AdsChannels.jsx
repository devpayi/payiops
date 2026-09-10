import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend, Cell, PieChart, Pie, LabelList,
} from 'recharts'
import { Loader2, Info, Save, Megaphone } from 'lucide-react'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtBaht = (n) => '฿' + fmt(n)
const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : fmt(n))
const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthLabel = (ym) => (THAI_MONTH[parseInt(String(ym).slice(5, 7), 10) - 1] || ym) + ' ' + String(ym).slice(2, 4)

const BUSINESSES = ['Payi', 'Payi Outlet', 'กรอบรูป']
const PLATFORMS = ['Shopee', 'TikTok Shop', 'Lazada']
// ช่องทาง TikTok ที่แยกในรูป — Payi และ กรอบรูป
const TT_BUSINESSES = ['Payi', 'กรอบรูป']
const CHANNELS = [
  ['affiliate', 'Affiliate', '#2f6fe0'],
  ['live', 'Live', '#d64545'],
  ['vdo', 'VDO', '#e08a1e'],
  ['other', 'อื่น ๆ', '#c7ccd1'],
]
const STORE_COLORS = ['#e08a1e', '#d64545', '#e4c65a', '#4a90d9', '#3f7f6f', '#b5495b', '#7a6fce', '#7aa5c9']
const comboKey = (b, p) => `${b}|${p}`

export default function AdsChannels() {
  const [inputs, setInputs] = useState(null)   // /api/marketing?kind=inputs
  const [monthly, setMonthly] = useState(null) // /api/monthly
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selMonth, setSelMonth] = useState('')
  const [form, setForm] = useState({ ads: {}, tt: {} }) // ค่ากรอกของเดือนที่เลือก

  const load = () => {
    setLoading(true); setError(null)
    Promise.all([
      fetch('/api/marketing?kind=inputs').then((r) => r.json()),
      fetch('/api/monthly').then((r) => r.json()),
    ])
      .then(([mi, mo]) => {
        if (!mi.success) throw new Error(mi.error)
        if (!mo.success) throw new Error(mo.error)
        setInputs(mi); setMonthly(mo)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // รายชื่อเดือน (รวมจากทั้ง orders และที่กรอกไว้)
  const months = useMemo(() => {
    const s = new Set([...(monthly?.months || []), ...(inputs?.months || [])])
    return [...s].sort()
  }, [monthly, inputs])

  useEffect(() => {
    if (!selMonth && months.length) setSelMonth(months[months.length - 1])
  }, [months, selMonth])

  // pivot inputs → adsByMonth[m][combo], ttByMonth[m][business][channel]
  const { adsByMonth, ttByMonth } = useMemo(() => {
    const ads = {}, tt = {}
    for (const r of inputs?.inputs || []) {
      if (r.metric === 'ads') {
        (ads[r.month] ||= {})[comboKey(r.business, r.platform)] = r.value
      } else {
        (((tt[r.month] ||= {})[r.business] ||= {}))[r.metric] = r.value
      }
    }
    return { adsByMonth: ads, ttByMonth: tt }
  }, [inputs])

  // เมื่อเปลี่ยนเดือน/โหลดใหม่ → เติมฟอร์มจากข้อมูลที่มี
  useEffect(() => {
    if (!selMonth) return
    const ads = {}
    for (const b of BUSINESSES) for (const p of PLATFORMS) {
      const v = adsByMonth[selMonth]?.[comboKey(b, p)]
      ads[comboKey(b, p)] = v ? String(v) : ''
    }
    const tt = {}
    for (const b of TT_BUSINESSES) {
      tt[b] = {}
      for (const [id] of CHANNELS) {
        const v = ttByMonth[selMonth]?.[b]?.[id]
        tt[b][id] = v ? String(v) : ''
      }
      const g = ttByMonth[selMonth]?.[b]?.tt_gmv
      tt[b].gmv = g ? String(g) : ''
    }
    setForm({ ads, tt })
  }, [selMonth, adsByMonth, ttByMonth])

  const { ordersByMonth, salesByMonth } = useMemo(() => {
    const o = {}, s = {}
    for (const t of monthly?.trend || []) { o[t.month] = t.orders; s[t.month] = t.sales }
    return { ordersByMonth: o, salesByMonth: s }
  }, [monthly])

  // GMV TikTok ต่อร้านต่อเดือน จาก raw_orders — ใช้เป็น fallback ถ้าไม่ได้กรอก GMV รวมเอง
  const ttGmvByMonthBiz = useMemo(() => {
    const m = {}
    for (const [ym, arr] of Object.entries(monthly?.byStore || {})) {
      for (const s of arr) {
        if (s.platform === 'TikTok Shop') (m[ym] ||= {})[s.business] = s.sales
      }
    }
    return m
  }, [monthly])

  // GMV รวมที่ใช้คิด "อื่น ๆ" — เลขที่กรอกเอง (จาก Compass) ก่อน, ไม่มีค่อย fallback raw_orders
  const gmvBasis = (b) => {
    const typed = parseFloat(form.tt[b]?.gmv)
    return Number.isFinite(typed) && typed > 0 ? typed : (ttGmvByMonthBiz[selMonth]?.[b] || 0)
  }

  // "อื่น ๆ" ไม่ต้องกรอก — ส่วนที่เหลือของ GMV รวมหลังหัก Affiliate/Live/VDO
  const calcOther = (b) => {
    const rest = ['affiliate', 'live', 'vdo'].reduce((s, id) => s + (parseFloat(form.tt[b]?.[id]) || 0), 0)
    return Math.max(0, Math.round((gmvBasis(b) - rest) * 100) / 100)
  }

  // ── กราฟ: Ads รวมต่อเดือน เทียบกับ ยอดขาย และ Orders ──
  const adsVsSales = useMemo(() => months.map((m) => {
    const ads = Object.values(adsByMonth[m] || {}).reduce((s, v) => s + v, 0)
    const sales = salesByMonth[m] || 0
    return {
      label: monthLabel(m),
      ads,
      sales,
      orders: ordersByMonth[m] || 0,
      adsPct: sales > 0 ? Math.round((ads / sales) * 1000) / 10 : null, // Ads คิดเป็น % ของยอดขาย (null = ยังไม่มียอดขายเดือนนั้น)
    }
  }), [months, adsByMonth, ordersByMonth, salesByMonth])

  // ── Ads แยกร้าน (เดือนที่เลือก) ──
  const adsByStore = useMemo(() => {
    const row = adsByMonth[selMonth] || {}
    return Object.entries(row)
      .map(([k, v]) => ({ store: k.replace('|', ' '), value: v }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [adsByMonth, selMonth])

  // ── TikTok channel stacked (ต่อ business) ──
  const ttSeries = (business) => months.map((m) => {
    const c = ttByMonth[m]?.[business] || {}
    return { label: monthLabel(m), affiliate: c.affiliate || 0, live: c.live || 0, vdo: c.vdo || 0, other: c.other || 0 }
  })
  const ttPayi = useMemo(() => ttSeries('Payi'), [months, ttByMonth])
  const ttKitti = useMemo(() => ttSeries('กรอบรูป'), [months, ttByMonth])

  const setAds = (k, v) => setForm((f) => ({ ...f, ads: { ...f.ads, [k]: v } }))
  const setTt = (b, ch, v) => setForm((f) => ({ ...f, tt: { ...f.tt, [b]: { ...f.tt[b], [ch]: v } } }))

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const rows = []
      for (const b of BUSINESSES) for (const p of PLATFORMS) {
        const v = parseFloat(form.ads[comboKey(b, p)]) || 0
        if (v) rows.push({ business: b, platform: p, metric: 'ads', value: v })
      }
      for (const b of TT_BUSINESSES) {
        const g = parseFloat(form.tt[b]?.gmv) || 0
        if (g) rows.push({ business: b, platform: 'TikTok Shop', metric: 'tt_gmv', value: g })
        for (const [id] of CHANNELS) {
          const v = id === 'other' ? calcOther(b) : (parseFloat(form.tt[b]?.[id]) || 0)
          if (v) rows.push({ business: b, platform: 'TikTok Shop', metric: id, value: v })
        }
      }
      const res = await fetch('/api/marketing?kind=inputs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selMonth, rows }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  if (loading && !inputs) return <Center><Loader2 size={18} className="payi-spin" /> กำลังโหลด...</Center>
  if (error && !inputs) return <Center danger><Info size={18} /> โหลดไม่สำเร็จ: {error}</Center>

  const adsTotalSel = Object.values(adsByMonth[selMonth] || {}).reduce((s, v) => s + v, 0)

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ padding: '10px 12px', background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', border: '1px solid var(--payi-danger)', borderRadius: 8, fontSize: 13 }}>{error}</div>}

      {/* ── กรอกมือ ── */}
      <Card title="กรอกค่า Ads & TikTok Channel (รายเดือน)" sub="ตัวเลขพวกนี้ไม่มีในออเดอร์ ต้องกรอกเอง · เลือกเดือนแล้วกรอก แล้วกดบันทึก">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
          {months.map((m) => (
            <button key={m} onClick={() => setSelMonth(m)} style={pillStyle(selMonth === m)}>{monthLabel(m)}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          {/* Ads grid */}
          <div>
            <SectionLabel>ค่า Ads (บาท) — แยกร้าน/แพลตฟอร์ม</SectionLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: 'var(--payi-text-muted)', fontSize: 11 }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>ร้าน</th>
                  {PLATFORMS.map((p) => <th key={p} style={{ ...thStyle, textAlign: 'right' }}>{p.replace(' Shop', '')}</th>)}
                </tr>
              </thead>
              <tbody>
                {BUSINESSES.map((b) => (
                  <tr key={b} style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{b}</td>
                    {PLATFORMS.map((p) => (
                      <td key={p} style={{ ...tdStyle, textAlign: 'right' }}>
                        <input inputMode="numeric" value={form.ads[comboKey(b, p)] ?? ''} onChange={(e) => setAds(comboKey(b, p), e.target.value.replace(/[^\d.]/g, ''))}
                          placeholder="0" style={cellInput} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* TikTok channel grid */}
          <div style={{ overflowX: 'auto' }}>
            <SectionLabel>TikTok GMV แยก channel (บาท)</SectionLabel>
            <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: 'var(--payi-text-muted)', fontSize: 11 }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>ร้าน</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>GMV รวม</th>
                  {CHANNELS.map(([id, lbl]) => <th key={id} style={{ ...thStyle, textAlign: 'right' }}>{lbl}</th>)}
                </tr>
              </thead>
              <tbody>
                {TT_BUSINESSES.map((b) => (
                  <tr key={b} style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{b}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input inputMode="numeric" value={form.tt[b]?.gmv ?? ''} onChange={(e) => setTt(b, 'gmv', e.target.value.replace(/[^\d.]/g, ''))}
                        placeholder={ttGmvByMonthBiz[selMonth]?.[b] ? fmt(Math.round(ttGmvByMonthBiz[selMonth][b])) : '0'} style={cellInput} />
                    </td>
                    {CHANNELS.map(([id]) => (
                      <td key={id} style={{ ...tdStyle, textAlign: 'right' }}>
                        {id === 'other' ? (
                          <span title="คำนวณอัตโนมัติ = GMV รวม − Affiliate − Live − VDO"
                            style={{ ...cellInput, display: 'inline-block', background: 'var(--payi-surface-dark)', color: 'var(--payi-text-muted)', cursor: 'default' }}>
                            {fmt(calcOther(b))}
                          </span>
                        ) : (
                          <input inputMode="numeric" value={form.tt[b]?.[id] ?? ''} onChange={(e) => setTt(b, id, e.target.value.replace(/[^\d.]/g, ''))}
                            placeholder="0" style={cellInput} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 6 }}>
              GMV รวม = เลข GMV จาก Compass (การวิเคราะห์ร้านค้า, ทั้งเดือน) · ถ้าไม่กรอกจะใช้ยอดจาก orders แทน<br />
              อื่น ๆ = GMV รวม − Affiliate − Live − VDO (คำนวณอัตโนมัติ ไม่ต้องกรอก)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button onClick={save} disabled={saving || !selMonth} style={{ ...primaryBtn, opacity: saving || !selMonth ? 0.6 : 1 }}>
            {saving ? <Loader2 size={15} className="payi-spin" /> : <Save size={15} />} บันทึกเดือน {selMonth && monthLabel(selMonth)}
          </button>
          <span style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>Ads รวมเดือนนี้: <b style={{ color: 'var(--payi-text-strong)' }}>{fmtBaht(adsTotalSel)}</b></span>
        </div>
      </Card>

      {/* ── Ads เทียบ ยอดขาย + Orders ── */}
      <Card title="Ads เทียบยอดขาย & Orders (รายเดือน)" sub="แท่ง = ค่า Ads · เส้นเขียว = ยอดขาย · เส้นส้ม = จำนวนออเดอร์ · ตัวเลขบนแท่ง = Ads คิดเป็น % ของยอดขาย">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={adsVsSales} margin={{ top: 18, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v) => '฿' + fmtShort(v)} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
            <Tooltip content={<TipBox moneyKeys={['Ads', 'ยอดขาย']} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="ads" name="Ads" fill="#d64545" radius={[5, 5, 0, 0]} maxBarSize={40}>
              <LabelList dataKey="adsPct" position="top" formatter={(v) => (v ? v + '%' : '')} style={{ fontSize: 10, fill: 'var(--payi-text-muted)', fontWeight: 700 }} />
            </Bar>
            <Line yAxisId="l" dataKey="sales" name="ยอดขาย" stroke="#2f8f6f" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line yAxisId="r" dataKey="orders" name="Orders" stroke="#e08a1e" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16 }}>
        {/* Ads by store */}
        <Card title={`Ads แยกร้าน · ${selMonth ? monthLabel(selMonth) : ''}`} sub="เดือนที่เลือกด้านบน">
          {adsByStore.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, adsByStore.length * 40)}>
              <BarChart data={adsByStore} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v) => '฿' + fmtShort(v)} />
                <YAxis type="category" dataKey="store" tick={{ fontSize: 11, fill: 'var(--payi-text)' }} axisLine={false} tickLine={false} width={130} />
                <Tooltip content={<TipBox moneyKeys={['value', 'Ads']} />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="value" name="Ads" radius={[0, 5, 5, 0]} barSize={20}
                  label={{ position: 'right', fontSize: 11, fill: 'var(--payi-text-muted)', formatter: (v) => '฿' + fmtShort(v) }}>
                  {adsByStore.map((_, i) => <Cell key={i} fill={STORE_COLORS[i % STORE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyBox text="ยังไม่มีค่า Ads ของเดือนนี้ — กรอกด้านบนแล้วบันทึก" />}
        </Card>

        {/* Ads pie */}
        <Card title="สัดส่วนค่า Ads" sub={selMonth ? monthLabel(selMonth) : ''}>
          {adsByStore.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={adsByStore} dataKey="value" nameKey="store" cx="50%" cy="50%" innerRadius={48} outerRadius={82} paddingAngle={2}>
                  {adsByStore.map((_, i) => <Cell key={i} fill={STORE_COLORS[i % STORE_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<TipBox moneyKeys={adsByStore.map((s) => s.store)} />} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyBox text="ยังไม่มีข้อมูล" />}
        </Card>
      </div>

      {/* ── TikTok channel stacks ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <ChannelStack title="TikTok — PAYI" data={ttPayi} />
        <ChannelStack title="TikTok — กรอบรูป" data={ttKitti} />
      </div>
    </div>
  )
}

function ChannelStack({ title, data }) {
  const hasData = data.some((d) => d.affiliate || d.live || d.vdo || d.other)
  // เติม: total ต่อเดือน, สัดส่วน % ของแต่ละ channel, และ % เทียบเดือนก่อน (MoM)
  const enriched = useMemo(() => data.map((d, i) => {
    const prev = data[i - 1]
    const total = (d.affiliate || 0) + (d.live || 0) + (d.vdo || 0) + (d.other || 0)
    const e = { ...d, _total: total }
    for (const [id] of CHANNELS) {
      e[`_pct_${id}`] = total ? (d[id] || 0) / total : 0
      e[`_mom_${id}`] = prev && prev[id] ? ((d[id] || 0) - prev[id]) / prev[id] : null
    }
    return e
  }), [data])
  return (
    <Card title={title} sub="GMV แยก channel รายเดือน · ชี้เมาส์ดู % สัดส่วน + % เทียบเดือนก่อน">
      {hasData ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={enriched} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} tickFormatter={(v) => '฿' + fmtShort(v)} />
            <Tooltip content={<ChannelTip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {CHANNELS.map(([id, lbl, color]) => (
              <Bar key={id} dataKey={id} name={lbl} stackId="a" fill={color} radius={id === 'other' ? [4, 4, 0, 0] : 0} maxBarSize={46} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <EmptyBox text="ยังไม่มีข้อมูล channel — กรอกด้านบนแล้วบันทึก" />}
    </Card>
  )
}

function ChannelTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload || {}
  return (
    <div style={{ background: 'var(--payi-surface-dark)', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: '#fff', minWidth: 230 }}>
      <div style={{ color: 'var(--payi-line)', marginBottom: 7, fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span>{label}</span><span>รวม {fmtBaht(row._total)}</span>
      </div>
      {CHANNELS.map(([id, lbl, color]) => {
        const mom = row[`_mom_${id}`]
        return (
          <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ color: '#cbd5e1', flex: 1 }}>{lbl}</span>
            <span style={{ fontWeight: 700, width: 78, textAlign: 'right' }}>{fmtBaht(row[id])}</span>
            <span style={{ color: '#94a3b8', width: 34, textAlign: 'right' }}>{Math.round((row[`_pct_${id}`] || 0) * 100)}%</span>
            <span style={{ width: 52, textAlign: 'right', fontWeight: 700, color: mom == null ? '#64748b' : mom >= 0 ? '#4ade80' : '#f87171' }}>
              {mom == null ? '–' : (mom >= 0 ? '▲' : '▼') + Math.abs(Math.round(mom * 100)) + '%'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TipBox({ active, payload, label, moneyKeys = [] }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--payi-surface-dark)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fff', maxWidth: 260 }}>
      {label && <div style={{ color: 'var(--payi-line)', marginBottom: 6, fontWeight: 700 }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill || p.stroke, flexShrink: 0 }} />
          <span style={{ color: '#cbd5e1', flex: 1 }}>{p.name}:</span>
          <span style={{ fontWeight: 700 }}>{moneyKeys.includes(p.dataKey) || moneyKeys.includes(p.name) ? fmtBaht(p.value) : fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function Card({ title, sub, children }) {
  return (
    <div className="payi-glass-card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)', display: 'flex', alignItems: 'center', gap: 7 }}><Megaphone size={15} color="var(--payi-mint)" /> {title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--payi-text)', marginBottom: 8 }}>{children}</div>
}
function EmptyBox({ text }) {
  return <div style={{ padding: 30, textAlign: 'center', fontSize: 12.5, color: 'var(--payi-text-faint)', border: '1px dashed var(--payi-border)', borderRadius: 10 }}>{text}</div>
}
function Center({ children, danger }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: '50vh', fontSize: 14, color: danger ? 'var(--payi-danger)' : 'var(--payi-text-muted)' }}>{children}</div>
}

function pillStyle(active) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: active ? 800 : 600, borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--payi-mint)' : 'var(--payi-border)'}`,
    background: active ? 'var(--payi-mint-soft)' : 'var(--payi-surface)',
    color: active ? 'var(--payi-mint-strong)' : 'var(--payi-text)',
  }
}
const primaryBtn = {
  border: 'none', borderRadius: 10, background: 'var(--payi-gradient-primary)', boxShadow: '0 8px 18px rgba(37,99,235,0.22)', color: '#fff', padding: '10px 16px',
  fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
}
const cellInput = {
  width: 90, textAlign: 'right', border: '1px solid var(--payi-border)', background: 'var(--payi-surface)',
  borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: 'var(--payi-text-strong)', outline: 'none',
}
const thStyle = { padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' }
const tdStyle = { padding: '6px 8px' }
