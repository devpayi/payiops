import { useEffect, useState } from 'react'

// Workspace รุ่นแรก — หน้า "งานของฉัน" ต่อคน (ดู api/_lib/workspace.js)
// ตอนนี้เปิดเฉพาะ dev: มีตัวเลือก "ดูในมุมของ" ให้โมเช็คว่าแต่ละคนจะเห็นอะไรก่อนเปิดใช้จริง

const thb = (n) => `฿${Math.round(n || 0).toLocaleString('th-TH')}`
const mb = (n) => `${(n / 1_000_000).toLocaleString('th-TH', { maximumFractionDigits: 1 })} ล้าน`

const card = {
  background: 'var(--payi-surface, #fff)',
  border: '1px solid var(--payi-line, #e5e7eb)',
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 8px 24px -8px rgba(15,23,42,0.08)',
}
const sectionTitle = { fontSize: 13, fontWeight: 800, color: 'var(--payi-text-strong)', margin: '0 0 12px' }
const chip = (bg, fg) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color: fg })

const TAB_LABELS = {
  Executive: 'Dashboard สรุปยอดขาย', Products: 'Dashboard สินค้า', Fulfillment: 'Fulfillment', CFO: 'CFO Dashboard',
  MarketingRadar: 'Marketing Radar', AdsChannels: 'Ads & Channels', Demographic: 'เดโมกราฟฟิกลูกค้า',
  ContentOS: 'Content OS', Inventory: 'Inventory', 'Stock Movement': 'Stock Movement', 'WHT Cert': 'ใบหัก ณ ที่จ่าย',
}

function BoardCard({ item }) {
  return (
    <div style={{ ...card, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--payi-gradient-primary)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{item.no}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{item.title}</div>
        <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 4 }}>ฝ่าย {item.dept} · {item.ownerNames.join(' + ')}</div>
      </div>
    </div>
  )
}

function TargetCard({ target, sales }) {
  const months = sales || []
  const total = months.reduce((s, m) => s + m.revenue, 0)
  const avg = months.length ? total / months.length : 0
  const gap = target.monthly - avg
  const max = Math.max(target.monthly, ...months.map((m) => m.revenue)) * 1.08
  return (
    <div style={card}>
      <h3 style={sectionTitle}>เป้า {target.year}: {mb(target.total)} บาท</h3>
      <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['ต้องขายเดือนละ', thb(target.monthly), 'var(--payi-text-strong)'],
          [`เฉลี่ยจริง ${months.length} เดือนล่าสุด`, thb(avg), 'var(--payi-text-strong)'],
          ['ยังขาดต่อเดือน', gap > 0 ? `${thb(gap)} (${Math.round((gap / target.monthly) * 100)}%)` : 'ถึงเป้าแล้ว', gap > 0 ? '#c2410c' : '#16a34a'],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: 'var(--payi-bg, #f8fafc)', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '0 4px', borderBottom: '1px solid var(--payi-line, #e5e7eb)' }}>
        <div title={`เป้าเดือนละ ${thb(target.monthly)}`} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(target.monthly / max) * 100}%`, borderTop: '2px dashed #c2410c' }}>
          <span style={{ position: 'absolute', right: 0, top: -18, fontSize: 10, fontWeight: 700, color: '#c2410c' }}>เป้า 12.5 ล้าน/เดือน</span>
        </div>
        {months.map((m) => (
          <div key={m.month} title={`${m.month}: ${thb(m.revenue)}`} style={{ flex: 1, minWidth: 0, height: `${(m.revenue / max) * 100}%`, background: 'linear-gradient(180deg, rgba(85,102,230,0.9), rgba(85,102,230,0.55))', borderRadius: '6px 6px 0 0' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '6px 4px 0' }}>
        {months.map((m) => <div key={m.month} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, color: 'var(--payi-text-muted)' }}>{m.month.slice(5)}/{m.month.slice(2, 4)}</div>)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 10 }}>ยอดจริงปี 2026 จาก raw_orders (ไม่นับยกเลิก สูตรเดียวกับ Dashboard) · เห็นเฉพาะ CEO และหัวหน้าฝ่าย</div>
    </div>
  )
}

export default function Workspace({ onOpenTab }) {
  const [as, setAs] = useState('dev')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setError('')
    fetch(`/api/sheet-tools?op=workspace&as=${encodeURIComponent(as)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.success) setData(d); else setError(d.error || 'โหลดไม่สำเร็จ') })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [as])

  if (error) return <div style={{ ...card, color: 'var(--payi-danger)' }}>{error}</div>
  if (!data) return <div style={{ padding: 40, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
  const { me, people, departments, pending, target, sales } = data

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 18 }}>
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'rgba(14,165,233,0.06)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>ตัวอย่าง (เห็นแค่ Dev) · ดูในมุมของ</span>
        <select className="payi-select" value={as} onChange={(e) => setAs(e.target.value)} style={{ padding: '6px 10px', fontSize: 13 }}>
          {people.map((p) => <option key={p.key} value={p.key}>{p.name}{p.account ? '' : ' (ยังไม่มีบัญชี Ops)'}</option>)}
        </select>
      </div>

      <div style={{ ...card, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none' }}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>งานของฉัน</div>
        <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>{me.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {me.headOf.map((d) => <span key={d} style={chip('rgba(255,255,255,0.28)', '#fff')}>หัวหน้าฝ่าย {d}</span>)}
          {me.depts.filter((d) => !me.headOf.includes(d)).map((d) => <span key={d} style={chip('rgba(255,255,255,0.16)', '#fff')}>ฝ่าย {d}</span>)}
          {me.seesAllDepts && <span style={chip('rgba(255,255,255,0.16)', '#fff')}>เห็นทุกฝ่าย</span>}
          {!me.account && <span style={chip('#fff7ed', '#c2410c')}>ยังไม่มีบัญชีใน Ops</span>}
        </div>
      </div>

      <div>
        <h3 style={sectionTitle}>หัวข้อเป้า 2027 ที่รับผิดชอบ</h3>
        {me.board.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {me.board.map((b) => <BoardCard key={b.no} item={b} />)}
          </div>
        ) : <div style={{ ...card, color: 'var(--payi-text-muted)', fontSize: 13 }}>ยังไม่มีหัวข้อบนกระดานที่ถือโดยตรง — ดูงานของฝ่ายด้านล่าง</div>}
      </div>

      {me.links.length > 0 && (
        <div>
          <h3 style={sectionTitle}>ทางลัด</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {me.links.map((t) => (
              <button key={t} type="button" onClick={() => onOpenTab?.(t)} className="payi-btn-secondary" style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--payi-line, #e5e7eb)', background: 'var(--payi-surface, #fff)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--payi-text-strong)' }}>
                {TAB_LABELS[t] || t} →
              </button>
            ))}
          </div>
        </div>
      )}

      {target && <TargetCard target={target} sales={sales} />}

      <div>
        <h3 style={sectionTitle}>{me.seesAllDepts ? 'ทุกฝ่าย' : 'ฝ่ายของฉัน'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {departments.map((d) => (
            <div key={d.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{d.label}</div>
                <div style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>หัวหน้า: {d.headName || (d.pending ? 'รอคน' : 'ยังไม่มี')}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 4 }}>{d.duty}</div>
              {d.pending && <div style={{ fontSize: 12, color: '#c2410c', marginTop: 6 }}>{d.pending}</div>}
              {d.members.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {d.members.map((m) => <span key={m.key} style={chip('var(--payi-bg, #f1f5f9)', 'var(--payi-text)')}>{m.name}</span>)}
                </div>
              )}
              {d.board.length > 0 && (
                <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--payi-text)', lineHeight: 1.7 }}>
                  {d.board.map((b) => (
                    <li key={b.no}>
                      <b>{b.no}.</b> {b.title} <span style={{ color: 'var(--payi-text-muted)' }}>— {b.ownerNames.join(' + ')}</span>
                      {b.owners.some((o) => pending[o]) && <span style={{ color: '#c2410c', fontSize: 11 }}> ({b.owners.map((o) => pending[o]).filter(Boolean).join(', ')})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
