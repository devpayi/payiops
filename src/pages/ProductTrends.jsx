import { Fragment, useEffect, useMemo, useState } from 'react'
import { Loader2, Info, Search, ChevronRight, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtBaht = (n) => '฿' + fmt(n)
const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : fmt(n))

const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthLabel = (ym) => {
  const mo = parseInt(String(ym).slice(5, 7), 10) - 1
  const yr = String(ym).slice(2, 4)
  return (THAI_MONTH[mo] || ym) + ' ' + yr
}

const BUSINESSES = ['Payi', 'กรอบรูป']
const PLATFORMS = ['Shopee', 'TikTok Shop', 'Lazada']

// % เปลี่ยนแปลงเทียบเดือนก่อน — คืน null ถ้าคำนวณไม่ได้ (เดือนก่อน = 0)
function pctChange(prev, cur) {
  if (prev === 0) return cur > 0 ? Infinity : null // Infinity = ของใหม่ (เพิ่งเริ่มขาย)
  return ((cur - prev) / prev) * 100
}

// สีพื้น/สีตัวอักษรของ % เปลี่ยนแปลง (เขียว = ขึ้น, แดง/ส้ม = ลง) — เลียนแบบชีท
function deltaStyle(pct) {
  if (pct === null) return { bg: 'transparent', color: 'var(--payi-text-faint)' }
  if (pct === Infinity) return { bg: 'rgba(47,111,224,0.10)', color: '#2F6FE0' }
  if (pct >= 0) return { bg: 'rgba(22,163,74,0.12)', color: '#15803d' }
  return { bg: 'rgba(234,88,12,0.12)', color: '#c2410c' }
}
function deltaText(pct) {
  if (pct === null) return '—'
  if (pct === Infinity) return 'ใหม่'
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

export default function ProductTrends() {
  const [business, setBusiness] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [metric, setMetric] = useState('units') // units | revenue
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    const params = new URLSearchParams()
    if (business !== 'all') params.set('business', business)
    if (platform !== 'all') params.set('platform', platform)
    fetch(`/api/product-trends${params.toString() ? '?' + params : ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (!d.success) throw new Error(d.error)
        setData(d)
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [business, platform])

  const months = useMemo(() => data?.months || [], [data])
  const groups = useMemo(() => data?.groups || [], [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) =>
      g.label.toLowerCase().includes(q) ||
      g.members.some((m) => (m.master_sku || '').toLowerCase().includes(q) || (m.display_name || '').toLowerCase().includes(q))
    )
  }, [groups, search])

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const valOf = (cell) => (metric === 'units' ? cell.units : cell.revenue)
  const fmtVal = (v) => (metric === 'units' ? fmt(v) : fmtShort(v))
  const total = (monthly) => monthly.reduce((s, c) => s + valOf(c), 0)

  if (loading && !data) return <Center><Loader2 size={18} className="payi-spin" /> กำลังโหลดข้อมูล...</Center>
  if (error) return <Center danger><Info size={18} /> โหลดไม่สำเร็จ: {error}</Center>

  const colCount = 2 + months.length + 1 // สินค้า + เดือน + รวม (สินค้ากิน 1, ปุ่มขยายกิน 1 รวมในคอลัมน์แรก)

  return (
    <div style={{ width: '100%' }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <FilterGroup label="ร้าน" value={business} setValue={setBusiness} options={BUSINESSES} />
        <FilterGroup label="แพลตฟอร์ม" value={platform} setValue={setPlatform} options={PLATFORMS} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[['units', 'จำนวนชิ้น'], ['revenue', 'ยอดขาย']].map(([m, lbl]) => (
            <button key={m} onClick={() => setMetric(m)} style={pillStyle(metric === m)}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 220, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 8, padding: '8px 12px' }}>
          <Search size={15} color="var(--payi-text-muted)" />
          <input placeholder="ค้นหาสินค้า / SKU" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13, background: 'transparent', color: 'var(--payi-text-strong)' }} />
        </div>
      </div>

      <div className="payi-glass-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>
              % เปลี่ยนแปลงรายเดือน · {metric === 'units' ? 'จำนวนชิ้น' : 'ยอดขาย'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 2 }}>
              {filtered.length} กลุ่ม · ตัวเลขบน = ค่าของเดือน, ตัวเลขล่าง = % เทียบเดือนก่อน · คลิกแถวเพื่อดู SKU แยก
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--payi-text-muted)', alignItems: 'center' }}>
            <Legend color="#15803d" text="เพิ่มขึ้น" />
            <Legend color="#c2410c" text="ลดลง" />
            <Legend color="#2F6FE0" text="เพิ่งเริ่มขาย" />
            {metric === 'units' && <Legend color="var(--payi-mint-strong)" text="* = รวมยอดจาก Set แล้ว" />}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 120 + months.length * 92 }}>
            <thead>
              <tr style={{ color: 'var(--payi-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--payi-surface)', zIndex: 2, minWidth: 220 }}>สินค้า</th>
                {months.map((ym) => (
                  <th key={ym} style={{ ...thStyle, textAlign: 'right' }}>{monthLabel(ym)}</th>
                ))}
                <th style={{ ...thStyle, textAlign: 'right', color: 'var(--payi-text)' }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const isOpen = expanded.has(g.key)
                return (
                  <Fragment key={g.key}>
                    <tr onClick={() => toggle(g.key)}
                      style={{ borderTop: '1px solid var(--payi-border)', cursor: 'pointer', background: isOpen ? 'var(--payi-surface-muted)' : 'transparent' }}
                      onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = 'var(--payi-surface-muted)' }}
                      onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ ...tdStyle, position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {g.skuCount > 1
                            ? (isOpen ? <ChevronDown size={15} color="var(--payi-text-muted)" /> : <ChevronRight size={15} color="var(--payi-text-muted)" />)
                            : <span style={{ width: 15, display: 'inline-block' }} />}
                          <span style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{g.label}</span>
                          {g.skuCount > 1 && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)' }}>{g.skuCount} SKU</span>
                          )}
                        </div>
                      </td>
                      {g.monthly.map((cell, i) => (
                        <MonthCell key={cell.month} cell={cell} prev={i > 0 ? g.monthly[i - 1] : null} valOf={valOf} fmtVal={fmtVal} metric={metric} strong />
                      ))}
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: 'var(--payi-text-strong)' }}>
                        {metric === 'units' ? fmt(total(g.monthly)) : fmtBaht(total(g.monthly))}
                      </td>
                    </tr>

                    {isOpen && g.members.map((m) => (
                      <tr key={g.key + '|' + m.master_sku} style={{ borderTop: '1px solid var(--payi-border)', background: 'var(--payi-surface)' }}>
                        <td style={{ ...tdStyle, position: 'sticky', left: 0, background: 'var(--payi-surface)', zIndex: 1, paddingLeft: 30 }}>
                          <div style={{ fontWeight: 600, color: 'var(--payi-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{m.display_name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{m.master_sku}</div>
                        </td>
                        {m.monthly.map((cell, i) => (
                          <MonthCell key={cell.month} cell={cell} prev={i > 0 ? m.monthly[i - 1] : null} valOf={valOf} fmtVal={fmtVal} metric={metric} />
                        ))}
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: 'var(--payi-text)' }}>
                          {metric === 'units' ? fmt(total(m.monthly)) : fmtBaht(total(m.monthly))}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: 'var(--payi-text-muted)', padding: 30 }}>ไม่พบสินค้าที่ค้นหา</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MonthCell({ cell, prev, valOf, fmtVal, metric, strong }) {
  const cur = valOf(cell)
  const pct = prev ? pctChange(valOf(prev), cur) : null
  const ds = deltaStyle(pct)
  return (
    <td style={{ ...tdStyle, textAlign: 'right', verticalAlign: 'top' }}>
      <div style={{ fontWeight: strong ? 700 : 600, color: cur > 0 ? 'var(--payi-text-strong)' : 'var(--payi-text-faint)' }}>
        {fmtVal(cur)}
        {metric === 'units' && cell.unitsFromSet > 0 && (
          <span title={`ขายเดี่ยว ${cell.directUnits} + จาก Set ${cell.unitsFromSet}`} style={{ marginLeft: 3, color: 'var(--payi-mint-strong)', fontWeight: 800 }}>*</span>
        )}
      </div>
      {prev && (
        <div style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 700, padding: pct === null ? 0 : '1px 5px', borderRadius: 5, background: ds.bg, color: ds.color }}>
          {deltaText(pct)}
        </div>
      )}
    </td>
  )
}

function Legend({ color, text }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} /> {text}
    </span>
  )
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

const thStyle = { padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap' }
const tdStyle = { padding: '9px 10px', whiteSpace: 'nowrap' }

function Center({ children, danger }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: '50vh', fontSize: 14, color: danger ? 'var(--payi-danger)' : 'var(--payi-text-muted)' }}>
      {children}
    </div>
  )
}
