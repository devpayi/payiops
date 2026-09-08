import { useState } from 'react'

// มินิกราฟแท่ง + tooltip ตอนเอาเมาส์ชี้ (โชว์ label + ค่า)
// data: [{ label, value }]  — ใช้ในการ์ด hero หน้า Dashboard สไตล์ .daily-glass-page
export default function Sparkline({ data = [], formatValue = (v) => String(v), height = 30 }) {
  const [hi, setHi] = useState(null)
  if (data.length < 2) return null
  const max = Math.max(1, ...data.map((d) => d.value || 0))
  const active = hi != null ? data[hi] : null

  return (
    <div style={{ position: 'relative', marginTop: 12 }}>
      {active && (
        <div style={{
          position: 'absolute', bottom: '100%', left: `${((hi + 0.5) / data.length) * 100}%`,
          transform: 'translateX(-50%)', marginBottom: 5, zIndex: 5, pointerEvents: 'none',
          background: 'rgba(20,22,28,0.92)', color: '#fff', fontSize: 10.5, fontWeight: 700,
          padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
        }}>
          {active.label} · {formatValue(active.value)}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }} onMouseLeave={() => setHi(null)}>
        {data.map((d, i) => (
          <div
            key={i}
            onMouseEnter={() => setHi(i)}
            style={{
              flex: 1,
              height: `${Math.max(8, ((d.value || 0) / max) * 100)}%`,
              background: i === hi || i === data.length - 1 ? '#fff' : 'rgba(255,255,255,0.42)',
              borderRadius: '2px 2px 0 0',
              transition: 'background 120ms',
              cursor: 'default',
            }}
          />
        ))}
      </div>
    </div>
  )
}
