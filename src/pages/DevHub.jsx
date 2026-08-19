import { useState } from 'react'
import { Database, Rocket, GitBranch, Boxes, Code2, Triangle, Bot, MessageCircle, Cloud, Receipt, ExternalLink } from 'lucide-react'

// ลิงก์ด่วนไปเครื่องมือ/บัญชีที่ dev ใช้บ่อย — เอามาจาก bookmark bar ของเจ้าของ
// สี = สีแบรนด์จริงของแต่ละบริการ ให้แยกออกจากกันง่ายด้วยตา ไม่ใช่โทนเดียวกันหมด
const quickLinks = [
  { label: 'mona-ops-db', desc: 'Google Sheet ฐานข้อมูลหลักของระบบ (raw_orders, claims, product_aliases ฯลฯ)', icon: Database, url: 'https://docs.google.com/spreadsheets/d/13eMPa3ISNd8HwrlsK-CtQsmzRvzqxpimy67cJVRBZGg/edit', color: '#0f9d58' },
  { label: 'Payi Ops', desc: 'เว็บแอปที่ใช้งานจริง (production)', icon: Rocket, url: 'https://payiops.vercel.app/', color: '#2563eb' },
  { label: 'GitHub', desc: 'โค้ด repository ทั้งหมดของระบบ', icon: GitBranch, url: 'https://github.com/devpayi/payiops', color: '#24292f' },
  { label: 'Turso', desc: 'ฐานข้อมูล SQL แยกต่างหาก (ใช้กับโปรเจกต์อื่นนอก Payi Ops)', icon: Boxes, url: 'https://app.turso.tech/monalll13', color: '#4ff8d2' },
  { label: 'Apps Script', desc: 'จัดการโปรเจกต์ Google Apps Script', icon: Code2, url: 'https://script.google.com/home/?hl=th', color: '#4285f4' },
  { label: 'Vercel', desc: 'Dashboard ดู deploy / build log ของเว็บ', icon: Triangle, url: 'https://vercel.com/devpayis-projects', color: '#000000' },
  { label: 'LINE Developers', desc: 'จัดการ LINE bot / Messaging API', icon: Bot, url: 'https://developers.line.biz/console/', color: '#06c755' },
  { label: 'Line oa', desc: 'จัดการ LINE Official Account (ข้อความ/broadcast)', icon: MessageCircle, url: 'https://manager.line.biz/account/@924byetu', color: '#00b900' },
  { label: 'Google Cloud', desc: 'จัดการ service account ที่ระบบใช้ต่อ Google Sheets', icon: Cloud, url: 'https://console.cloud.google.com/iam-admin/serviceaccounts/details/112495795638398129224/keys?project=mona-ops', color: '#ea4335' },
  { label: 'ออกใบกำกับภาษี', desc: 'เครื่องมือออกใบกำกับภาษี', icon: Receipt, url: 'https://script.google.com/macros/s/AKfycby-unnrh8gMNJDvWYK7n3FA-eTFhPJIoq4GOKEeEns9oNMslRDwUZ-tHh8O3JEM8Ns-/exec', color: '#f59e0b' },
]

const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function QuickLinkCard({ l }) {
  const [hover, setHover] = useState(false)
  const Icon = l.icon
  return (
    <a
      href={l.url} target="_blank" rel="noopener noreferrer"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '16px 18px', borderRadius: 14, textDecoration: 'none',
        background: hover ? hexToRgba(l.color, 0.08) : 'var(--payi-surface)',
        border: `1px solid ${hover ? hexToRgba(l.color, 0.5) : 'var(--payi-border)'}`,
        borderTop: `3px solid ${l.color}`,
        boxShadow: hover ? `0 10px 22px ${hexToRgba(l.color, 0.18)}` : 'none',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: hexToRgba(l.color, 0.14), color: l.color, flexShrink: 0 }}>
          <Icon size={17} />
        </span>
        <ExternalLink size={13} style={{ flexShrink: 0, opacity: hover ? 0.8 : 0.35, color: hover ? l.color : 'inherit', transition: 'all 0.15s ease' }} />
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--payi-text-strong)', marginBottom: 3 }}>{l.label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', lineHeight: 1.5 }}>{l.desc}</div>
      </div>
    </a>
  )
}

export default function DevHub() {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 13, color: 'var(--payi-text-muted)', marginBottom: 20 }}>
        คู่มือสำหรับ developer และคนใหม่ที่เข้ามาช่วยพัฒนาระบบ Payi Ops
      </div>

      <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {quickLinks.map((l) => <QuickLinkCard key={l.label} l={l} />)}
      </div>
    </div>
  )
}
