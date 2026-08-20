import { useEffect, useState } from 'react'

export default function DemographicDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sheet-tools?op=demographic&view=province')
      .then((r) => r.json())
      .then((d) => { if (d.success) setData(d); else setError(d.error || 'โหลดไม่สำเร็จ') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const card = { background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: 20 }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
  if (error) return <div style={{ padding: 16, borderRadius: 12, background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' }}>เกิดข้อผิดพลาด: {error}</div>
  if (!data) return null

  const top = data.provinces.slice(0, 15)
  const max = Math.max(1, ...top.map((p) => p.orders))
  const coverage = data.totalOrders ? Math.round((data.withProvince / data.totalOrders) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5, padding: '10px 14px', borderRadius: 10 }}>
        มีจังหวัดครบ {coverage}% ของออเดอร์ทั้งหมด ({data.withProvince.toLocaleString()} / {data.totalOrders.toLocaleString()}) —
        ออเดอร์เก่าก่อน 2026-08 ไม่มีข้อมูลจังหวัด (เพิ่งเริ่มเก็บ) เพศ/อายุยังไม่มีทางดึงได้เลยจากทุกแพลตฟอร์ม
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>ลูกค้าตามจังหวัด <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>Top 15 จากออเดอร์จริง</span></h3>
        {top.length ? top.map((p) => (
          <div key={p.province} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, fontSize: 12.5 }}>
            <div style={{ width: 160, flexShrink: 0 }}>{p.province}</div>
            <div style={{ flex: 1, background: '#eef2f7', borderRadius: 6, height: 16, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--payi-mint)', borderRadius: 6, width: `${(p.orders / max) * 100}%` }} />
            </div>
            <div style={{ width: 60, textAlign: 'right', color: 'var(--payi-text-muted)', fontSize: 11.5 }}>{p.orders.toLocaleString()}</div>
          </div>
        )) : <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ยังไม่มีข้อมูลจังหวัดเลย (รอ import ออเดอร์ใหม่หลัง 2026-08)</div>}
      </div>
    </div>
  )
}
