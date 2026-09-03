import { useEffect, useState } from 'react'

const thb = (n) => `฿${Math.round(n || 0).toLocaleString()}`

// ── Glass surface (ขับเคลื่อนด้วย CSS var + fallback — เผื่อ theme อื่น) ──
const card = {
  position: 'relative',
  background: 'var(--card-bg, rgba(255,255,255,0.7))',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid var(--card-border, rgba(255,255,255,0.4))',
  borderRadius: 16,
  padding: 22,
  boxShadow: '0 10px 30px -5px rgba(0,0,0,0.05), 0 4px 6px -2px rgba(0,0,0,0.02)',
}
const glassInput = {
  background: 'var(--input-bg, rgba(255,255,255,0.5))',
  border: '1px solid var(--card-border, rgba(255,255,255,0.45))',
  borderRadius: 10,
  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)',
  outline: 'none',
}
const glowDot = (c) => ({ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0, boxShadow: c.startsWith('#') ? `0 0 6px ${c}66` : 'none' })
// แท่งกราฟ — ไล่โปร่งแสง 0.88 -> 0.6 (เข้ากับทุกธีม ไม่ผูกสีพื้น)
const bar = (r, g, b) => `linear-gradient(180deg, rgba(${r},${g},${b},0.9), rgba(${r},${g},${b},0.6))`
const BAR = {
  main: bar(85, 102, 230),
  soft: bar(148, 163, 184),
  alert: bar(229, 98, 76),
  ok: bar(31, 160, 110),
  amber: bar(230, 146, 53),
}
const barRadius = '6px 6px 0 0'
const VERDICT_COLOR = { act: '#dc2626', watch: '#c2410c', hold: '#16a34a', unknown: '#94a3b8' }
const VERDICT_LABEL = { act: 'ถึงจังหวะแล้ว', watch: 'ใกล้ถึง', hold: 'ยังไม่ถึง', unknown: 'ข้อมูลไม่พอ' }
const VERDICT_TINT = {
  hold: { bg: 'rgba(34,197,94,0.09)', glow: '0 10px 30px rgba(22,163,74,0.14), inset 0 0 0 1px rgba(34,197,94,0.28), inset 0 1px 0 rgba(255,255,255,0.6)' },
  watch: { bg: 'rgba(234,88,12,0.09)', glow: '0 10px 30px rgba(194,65,12,0.14), inset 0 0 0 1px rgba(234,88,12,0.28), inset 0 1px 0 rgba(255,255,255,0.6)' },
  act: { bg: 'rgba(220,38,38,0.09)', glow: '0 10px 30px rgba(220,38,38,0.16), inset 0 0 0 1px rgba(220,38,38,0.3), inset 0 1px 0 rgba(255,255,255,0.6)' },
  unknown: { bg: 'rgba(148,163,184,0.09)', glow: '0 10px 30px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.6)' },
}
const PVERDICT = {
  'fbs-candidate': { t: 'ลอง FBS ได้', c: '#16a34a' },
  'keep-self': { t: 'เก็บแพ็คเอง', c: '#c2410c' },
  'review': { t: 'ดูเพิ่ม', c: '#94a3b8' },
}
const CONFIG_FIELDS = [
  ['pack_headcount', 'จำนวนคนแพ็ค'],
  ['pack_start', 'เข้างาน (ชม. เช่น 8)'],
  ['normal_finish', 'เลิกปกติเดือนล่าสุด (เช่น 14.5)'],
  ['max_finish', 'เลิกช้าสุดที่รับได้ (เช่น 17)'],
  ['daily_wage', 'ค่าแรง/คน/วัน'],
  ['ot_rate_per_hour', 'ค่า OT/ชม.'],
  ['fbs_fee_per_piece', 'ค่าธรรมเนียม FBS/ชิ้น'],
  ['fbs_storage_monthly', 'ค่าเก็บของ FBS/เดือน'],
]
const mLabel = (ym) => { const [y, m] = ym.split('-'); return `${['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][+m]} ${String(y).slice(2)}` }

// ⓘ กดแล้วอธิบายวิธีคิด/คำนวณ — โน้ตดันเนื้อหาลง (flow) ไม่ทับข้อความ
function InfoTip({ note }) {
  const [open, setOpen] = useState(false)
  if (!note) return null
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="วิธีคิด"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, marginLeft: 6, borderRadius: '50%', border: '1px solid var(--payi-border)', background: open ? 'rgba(15,23,42,0.08)' : 'transparent', color: 'var(--payi-text-muted)', fontSize: 10, fontWeight: 700, cursor: 'pointer', lineHeight: 1, padding: 0, verticalAlign: 'middle' }}>i</button>
      {open && (
        <span style={{ display: 'block', margin: '8px 0 2px', padding: '10px 13px', borderRadius: 10, background: 'rgba(15,23,42,0.045)', fontSize: 11.5, lineHeight: 1.75, color: 'var(--payi-text-muted)', whiteSpace: 'pre-line', fontWeight: 400 }}>{note}</span>
      )}
    </>
  )
}
const NOTE = {
  verdict: 'รวมผลจากการ์ดล่างเป็นคำเดียว:\n• "ยังไม่ถึง" — เดือนล่าสุดทีมเลิกก่อนเพดาน + ยังไม่ชนใน 4 เดือน\n• "ใกล้ถึง" — จะชนเพดานใน ≤4 เดือน หรือวันพีคเกินเพดานแล้ว\n• "ถึงจังหวะ" — เดือนล่าสุดเลิกงานเกินเพดานแล้ว',
  capacity: 'อัตราแพ็ค = ออเดอร์เฉลี่ย/วัน เดือนล่าสุดที่จบ ÷ จำนวนคน ÷ ชม.ทำงานปกติ (เข้างาน→เลิกปกติ)\nเวลาเลิกแต่ละเดือน = เข้างาน + (ออเดอร์/วันเดือนนั้น ÷ (คน × อัตราแพ็ค))\nอัตราโต = ความชันเส้นตรง (least-squares) ของออเดอร์/วัน เฉพาะเดือนที่จบแล้ว\nชนเพดานใน = (เพดาน − ออเดอร์ล่าสุด) ÷ อัตราโต',
  breakeven: 'แพ็คเอง = ถูกสุดของ 2 ทาง —\n• OT ต่อไป = ค่า OT/ชม. ÷ อัตราแพ็ค\n• จ้างคนที่ 5 = (ค่าจ้าง/เดือน − OT ที่ลดได้) ÷ กำลังแพ็คที่เพิ่ม/เดือน\nFBS = ค่าธรรมเนียม/ชิ้น × ชิ้นเฉลี่ย/ออเดอร์ (ส่งธรรมดา Shopee)',
  campaign: 'ตัวคูณ = median ของ 4 วันแคมเปญ (วันที่=เดือน) ล่าสุด เทียบค่ากลางของวันปกติรอบๆ (±3–12 วัน ตัดวันแคมเปญออก) — ตัด 1.1 ที่ยอดตก\nออเดอร์คาด = ออเดอร์/วัน เดือนล่าสุด × ตัวคูณ\nเวลาเลิก = เข้างาน + (ออเดอร์คาด ÷ (คน × อัตราแพ็ค))',
  weekday: 'ออเดอร์เฉลี่ยต่อวันในสัปดาห์ จากทุกเดือน\nวันพีค = วันที่เฉลี่ยสูงสุด → คำนวณเวลาเลิกของวันนั้นด้วยอัตราแพ็คเดียวกัน\nถ้าวันพีคเกินเพดาน = วันนั้นคือคอขวดจริง แม้ค่าเฉลี่ยทั้งเดือนยังไหว',
  prep: 'ออเดอร์เฉลี่ยตามวันที่ของเดือน (1–31) จากทุกเดือน\nแนะนำ = ช่วง 4 วันติดกันที่ค่าเฉลี่ยรวมต่ำสุด — ส่งของเข้า FBS ช่วงนั้น ทีมมีเวลาแพ็ค outbound เพิ่ม',
  retention: 'ลูกค้า Shopee ที่มี buyer_hash แบ่งเป็น เคยได้ FBS ≥1 ครั้ง vs ได้แต่แพ็คเอง\n% ซื้อซ้ำ = คนที่มี ≥2 ออเดอร์ ÷ คนทั้งหมดในกลุ่ม\n⚠️ bias: คนซื้อบ่อยมีโอกาสเจอ FBS อยู่แล้ว → ตัวเลขเอียงสูง ดูเป็นสัญญาณ ไม่ใช่ข้อพิสูจน์',
  fbsUsage: 'เฉพาะ Shopee ที่ export มีคอลัมน์ "ตัวเลือกการจัดส่ง" (เก็บตั้งแต่ ก.ย. 2026)\n% = ออเดอร์/ชิ้น/ยอดขาย ที่ตัวเลือกขึ้นต้น "Fulfilled By Shopee" ÷ ทั้งหมดในกลุ่มนั้น\nTikTok ไม่มีข้อมูลในไฟล์ export',
  byProduct: 'จัดกลุ่มสินค้าด้วย deriveGroup (รวมสี/ไซส์) — ต่อกลุ่มดู % ส่งด่วน / ธรรมดา / FBS\n• ควร FBS: ส่งด่วน <20% และ (ธรรมดา+FBS) ≥55%\n• เก็บแพ็คเอง: ส่งด่วน ≥25%\nส่ง ~X/รอบ = ชิ้นส่งธรรมดา ÷ จำนวนเดือนของข้อมูล',
  ot: 'ชม. OT รวมต่อเดือน จาก workforce_ot (ใช้ actual ก่อน planned) × ค่า OT/ชม.\nทับด้วยปริมาณฟีดต่อเดือนจาก planner_daily (planned_feed)\nOT ส่วนใหญ่เป็นงานฟีด/รีแพ็คของ ขึ้นกับ FG ไม่ผูกกับจำนวนออเดอร์',
}

// 🦸 สานฝันวัยเด็ก — chibi Ultraman ท่าตั้งการ์ดสู้ (fighting stance) + เอฟเฟกต์กระแทกแดง + ออร่าเหลือง
function ChibiHero({ size = 168 }) {
  const S = '#1c1c1c'
  return (
    <>
      <style>{`
@keyframes heroBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes heroImpact{0%,100%{opacity:.55;transform:scale(.92)}50%{opacity:1;transform:scale(1.08)}}
@keyframes heroAura{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes heroTimer{0%,100%{fill:#7ec8ff}50%{fill:#f47c6b}}`}</style>
      <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden="true"
        style={{ animation: 'heroBob 3s ease-in-out infinite', filter: 'drop-shadow(0 8px 12px rgba(15,23,42,0.18))', overflow: 'visible' }}>

        {/* ── ออร่าเหลือง-ส้ม หมุนช้าๆ ใต้เท้า ── */}
        <g style={{ transformOrigin: '95px 205px', animation: 'heroAura 9s linear infinite' }} opacity="0.9">
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1="95" y1="205" x2="95" y2={168 - (i % 2) * 12}
              stroke={i % 2 ? '#f5a623' : '#ffd23e'} strokeWidth={i % 2 ? 3 : 5} strokeLinecap="round"
              transform={`rotate(${i * 36} 95 205)`} />
          ))}
        </g>

        {/* ── เส้นกระแทกแดง (comic impact) ข้างกำปั้นหน้า ── */}
        <g style={{ transformOrigin: '176px 116px', animation: 'heroImpact 0.45s ease-in-out infinite' }}>
          {[[-8, -34], [14, -28], [30, -6], [26, 20], [4, 30]].map(([dx, dy], i) => (
            <path key={i} d={`M176 116 L${176 + dx * 1.9} ${116 + dy * 1.9} L${176 + dx * 1.1 + (dy > 0 ? 8 : -8)} ${116 + dy * 1.1 + 6} Z`}
              fill="#e5231d" stroke="#a3140f" strokeWidth="2" strokeLinejoin="round" />
          ))}
        </g>

        {/* ── ขา — ย่อกว้าง ── */}
        <g stroke={S} strokeWidth="5" strokeLinejoin="round">
          {/* ต้นขาซ้าย */}
          <path d="M96 150 q-30 8 -34 40 q0 10 12 12 q14 -2 18 -18 q6 -22 4 -34 Z" fill="#eef1f4" />
          {/* ต้นขาขวา */}
          <path d="M120 150 q30 6 36 34 q0 12 -14 14 q-14 0 -18 -16 q-6 -20 -4 -30 Z" fill="#eef1f4" />
          {/* หน้าแข้ง + แถบแดง + เท้า ซ้าย */}
          <path d="M70 196 q-6 18 2 30 q4 6 14 4 q8 -4 8 -16 l-4 -20 Z" fill="#eef1f4" />
          <path d="M86 226 q-16 4 -22 0 q-2 -8 6 -12 l14 2 Z" fill="#d8dde2" />
          {/* หน้าแข้ง + เท้า ขวา */}
          <path d="M154 190 q10 16 4 32 q-4 6 -14 4 q-8 -4 -6 -16 l4 -22 Z" fill="#eef1f4" />
          <path d="M144 222 q16 6 24 2 q2 -8 -6 -12 l-16 0 Z" fill="#d8dde2" />
        </g>
        {/* แถบแดงหน้าแข้ง */}
        <path d="M68 200 q12 5 24 0 l-2 10 q-10 4 -20 0 Z" fill="#e5231d" stroke={S} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M148 196 q12 5 22 2 l0 10 q-10 4 -20 1 Z" fill="#e5231d" stroke={S} strokeWidth="3.5" strokeLinejoin="round" />

        {/* ── กางเกงแดง ── */}
        <path d="M86 138 q22 14 44 0 l4 20 q-26 16 -52 0 Z" fill="#e5231d" stroke={S} strokeWidth="5" strokeLinejoin="round" />

        {/* ── ลำตัว เอนหน้า ── */}
        <path d="M84 78 q24 -12 48 0 q6 4 4 30 q-2 22 -6 34 q-22 12 -44 0 q-6 -16 -8 -36 q-2 -22 6 -28 Z"
          fill="#eef1f4" stroke={S} strokeWidth="5" strokeLinejoin="round" />
        <path d="M126 76 q8 6 6 32 q-2 22 -8 36 l-6 -2 q6 -18 7 -38 q1 -20 -5 -26 Z" fill="#d3d9df" opacity="0.85" />
        {/* ไหล่แดง */}
        <path d="M78 84 q10 -14 26 -12 l-2 12 q-14 -1 -22 8 Z" fill="#e5231d" stroke={S} strokeWidth="4" strokeLinejoin="round" />
        <path d="M138 84 q-10 -14 -26 -12 l2 12 q14 -1 22 8 Z" fill="#e5231d" stroke={S} strokeWidth="4" strokeLinejoin="round" />
        {/* color timer */}
        <ellipse cx="108" cy="104" rx="8" ry="9" fill="#7ec8ff" stroke={S} strokeWidth="3.5" style={{ animation: 'heroTimer 1.6s ease-in-out infinite' }} />
        <ellipse cx="105" cy="100" rx="2.5" ry="3" fill="#eaf6ff" />

        {/* ── แขนขวา (หลัง/ล่าง) กำปั้นที่สะโพก ── */}
        <path d="M132 96 q26 6 32 34 q2 12 -10 16 q-14 2 -20 -12 q-6 -18 -10 -30 Z" fill="#eef1f4" stroke={S} strokeWidth="5" strokeLinejoin="round" />
        <circle cx="150" cy="146" r="15" fill="#eef1f4" stroke={S} strokeWidth="5" />
        <path d="M138 140 q12 8 24 0" fill="none" stroke={S} strokeWidth="3" opacity="0.5" />
        <path d="M134 100 q10 -6 20 2 l-3 9 q-9 -6 -16 -2 Z" fill="#e5231d" stroke={S} strokeWidth="3" strokeLinejoin="round" />

        {/* ── แขนซ้าย (การ์ดหน้า) กำปั้นชูข้างคาง ── */}
        <path d="M92 92 q34 -4 56 8 q10 6 6 20 q-6 12 -22 8 q-24 -8 -46 -14 Z" fill="#eef1f4" stroke={S} strokeWidth="5" strokeLinejoin="round" />
        <circle cx="150" cy="120" r="17" fill="#f4f6f8" stroke={S} strokeWidth="5" />
        <path d="M137 112 q13 10 26 2" fill="none" stroke={S} strokeWidth="3.4" opacity="0.55" />
        <path d="M143 128 q7 4 14 0" fill="none" stroke={S} strokeWidth="3" opacity="0.4" />
        <path d="M96 96 q14 -6 26 2 l-4 10 q-12 -7 -20 -3 Z" fill="#e5231d" stroke={S} strokeWidth="3.5" strokeLinejoin="round" />

        {/* ── หัว เอียงเล็กน้อย ── */}
        <g transform="rotate(-6 112 52)">
          {/* ครีบแดง */}
          <path d="M112 2 q-9 20 -8 30 l16 0 q1 -10 -8 -30 Z" fill="#e5231d" stroke={S} strokeWidth="4" strokeLinejoin="round" />
          {/* กะโหลกเงิน */}
          <path d="M78 44 q0 -30 34 -32 q34 2 34 32 q0 22 -14 34 q-9 8 -20 8 q-11 0 -20 -8 q-14 -12 -14 -34 Z"
            fill="#d7dde3" stroke={S} strokeWidth="5" strokeLinejoin="round" />
          {/* หน้าขาว */}
          <path d="M86 44 q0 -22 26 -24 q26 2 26 24 q0 18 -12 30 q-6 6 -14 6 q-8 0 -14 -6 q-12 -12 -12 -30 Z" fill="#f4f6f8" />
          {/* ตาเหลือง — อัลมอนด์ เอียงออกนอก (ไม่เหล่) */}
          <g stroke={S} strokeWidth="3">
            <ellipse cx="99" cy="45" rx="10" ry="13.5" fill="#ffd23e" transform="rotate(-20 99 45)" />
            <ellipse cx="125" cy="45" rx="10" ry="13.5" fill="#ffd23e" transform="rotate(20 125 45)" />
          </g>
          <ellipse cx="95" cy="40" rx="3" ry="4" fill="#fff6d5" transform="rotate(-20 95 40)" />
          <ellipse cx="129" cy="40" rx="3" ry="4" fill="#fff6d5" transform="rotate(20 129 40)" />
        </g>
      </svg>
    </>
  )
}

export default function Fulfillment() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('3')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [feeSim, setFeeSim] = useState('')

  const load = (rng) => {
    setLoading(true)
    fetch(`/api/sheet-tools?op=fulfillment&range=${encodeURIComponent(rng)}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) { setData(d); setForm(d.config); setError('') } else setError(d.error || 'โหลดไม่สำเร็จ') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(range) }, [range])

  const saveConfig = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/sheet-tools?op=fulfillment&action=save-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      load(range)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  if (loading && !data) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
  if (error) return <div style={{ padding: 16, borderRadius: 12, background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' }}>เกิดข้อผิดพลาด: {error}</div>
  if (!data) return null

  const { capacity: cap, weekday: wd, prepWindow: pw, byProduct = [], otMonthly: ot, verdict: v, stockoutNote, breakeven: be, campaign: camp } = data
  const candidates = byProduct.filter((p) => p.verdict === 'fbs-candidate')
  const keepSelf = byProduct.filter((p) => p.verdict === 'keep-self')
  const pwMax = pw?.ready ? Math.max(...pw.series.map((s) => s.avgOrders)) : 1
  const wdMax = wd?.ready ? Math.max(...wd.series.map((s) => s.avgOrders)) : 1
  const capMax = cap?.ready ? Math.max(cap.capacityPerDay, ...cap.series.map((s) => s.avgPerDay)) : 1

  // ── แถวสรุป (ดึงประโยคสรุปจากแต่ละการ์ด) ──
  // ใช้สีสถานะเดียวกับที่การ์ดในหน้านี้ใช้อยู่แล้ว (เขียว=ดี ส้ม=จับตา แดง=ต้องทำ)
  const C = { ok: '#16a34a', warn: '#c2410c', bad: '#dc2626', mute: 'var(--payi-text-muted)' }
  const tiles = []
  tiles.push({
    dot: VERDICT_COLOR[v.level], label: 'ย้ายเข้า FBS', big: VERDICT_LABEL[v.level],
    sub: cap.ready ? `เดือนล่าสุดเลิก ~${cap.finishLastMonth} (เพดาน ${cap.maxFinish})` : '',
  })
  if (cap.ready) {
    const m2c = cap.monthsToCap
    tiles.push({
      dot: m2c == null ? C.ok : m2c <= 3 ? C.bad : m2c <= 6 ? C.warn : C.ok,
      label: 'เวลาเลิกงานทีมแพ็ค',
      big: m2c == null ? 'ยังไม่ชนเพดาน' : `ชนเพดาน ${cap.maxFinish} ใน ~${m2c} เดือน`,
      sub: `โตเดือนละ ~${cap.growthPerDay > 0 ? '+' : ''}${cap.growthPerDay} ออเดอร์/วัน (${cap.monthlyGrowthPct}%)`,
    })
  }
  if (be?.ready) {
    const fee = feeSim !== '' && parseFloat(feeSim) > 0 ? parseFloat(feeSim) : be.fbsFeePerPiece
    const fbsPO = fee > 0 ? Math.round(fee * be.piecesPerOrder * 100) / 100 : null
    const self = Math.round((be.cheapestAlt || 0) * 100) / 100
    if (fbsPO == null) {
      tiles.push({ dot: C.mute, label: 'FBS คุ้มเงินไหม', big: 'ยังไม่ได้กรอกค่าธรรมเนียม', sub: 'ใส่ในการ์ด "FBS คุ้มเรื่องเงินไหม" ด้านล่าง' })
    } else {
      const cheaper = fbsPO <= self
      tiles.push({
        dot: cheaper ? C.ok : C.bad, label: 'FBS คุ้มเงินไหม',
        big: cheaper ? 'FBS ถูกกว่า — คุ้ม' : `แพงกว่าแพ็คเอง ${Math.round((fbsPO / self) * 10) / 10} เท่า`,
        sub: `แพ็คเอง ฿${self} vs FBS ฿${fbsPO} /ออเดอร์`,
      })
    }
  }
  if (camp?.ready && camp.next?.predictedFinish) {
    const over = camp.next.overCeiling
    tiles.push({
      dot: over && camp.next.daysUntil <= 14 ? C.bad : over ? C.warn : C.ok,
      label: `วันแคมเปญ ${camp.next.date.slice(5).replace('-', '.')}`,
      big: `ทีมเลิก ~${camp.next.predictedFinish}`,
      sub: `อีก ${camp.next.daysUntil} วัน — ${over ? 'เตรียมส่ง FBS / จัด OT' : 'ยังไหว'}`,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* RANGE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--payi-text-muted)' }}>ช่วงข้อมูล:</span>
        <select value={range} onChange={(e) => setRange(e.target.value)}
          style={{ ...glassInput, padding: '6px 10px', fontSize: 13 }}>
          <option value="3">3 เดือนล่าสุด</option>
          <option value="6">6 เดือนล่าสุด</option>
          <option value="all">ทั้งหมด</option>
          {(data.availableMonths || []).slice().reverse().map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
        {loading && <span style={{ color: 'var(--payi-text-muted)', fontSize: 12 }}>กำลังโหลด...</span>}
        <span style={{ color: 'var(--payi-text-muted)', fontSize: 11 }}>(กราฟกำลังทีม / วันในเดือน / วันในสัปดาห์ ใช้ข้อมูลทุกเดือนเสมอ)</span>
      </div>

      {/* SUMMARY ROW */}
      {tiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))`, gap: 10 }}>
          {tiles.map((t, i) => (
            <div key={i} style={{ ...card, padding: '14px 16px', borderRadius: 14, borderTop: `2px solid ${t.dot}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 7 }}>
                <span style={glowDot(t.dot)} />{t.label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--payi-text-strong)', lineHeight: 1.35, letterSpacing: '-0.01em' }}>{t.big}</div>
              {t.sub && <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 5 }}>{t.sub}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 -4px' }}>
        <span style={{ fontSize: 11, color: 'var(--payi-text-muted)', letterSpacing: '.03em' }}>รายละเอียด</span>
        <div style={{ flex: 1, height: 1, background: 'var(--payi-border)' }} />
      </div>

      {/* VERDICT */}
      <div style={{ ...card, position: 'relative', background: VERDICT_TINT[v.level].bg, border: '1px solid rgba(255,255,255,0.6)', boxShadow: VERDICT_TINT[v.level].glow }}>
        <div style={{ position: 'absolute', top: -84, right: -22, pointerEvents: 'none', zIndex: 2 }}>
          <ChibiHero size={158} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 4 }}>คำแนะนำ — ย้ายงานแพ็คเข้า Fulfillment?<InfoTip note={NOTE.verdict} /></div>
        <div style={{ fontSize: 19, fontWeight: 700, color: VERDICT_COLOR[v.level], marginBottom: 8, letterSpacing: '-0.01em' }}>{VERDICT_LABEL[v.level]}</div>
        <div style={{ fontSize: 13, color: 'var(--payi-text)', lineHeight: 1.65 }}>{v.text}</div>
        {stockoutNote && <div style={{ fontSize: 12, color: '#15803d', marginTop: 10 }}>✓ {stockoutNote}</div>}
      </div>

      {/* CAPACITY — monthly */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>กำลังทีมแพ็ค — เวลาเลิกงานรายเดือน<InfoTip note={NOTE.capacity} /></h3>
        {cap.ready && cap.series.length < 2 ? (
          <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>เลือกเดือนเดียว — กราฟกำลังทีมต้องดูหลายเดือน เลือก "3 เดือนล่าสุด" หรือ "ทั้งหมด"</div>
        ) : cap.ready ? (
          <>
            <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
              อัตราแพ็ค ~{cap.ordersPerPersonHour} ออเดอร์/คน/ชม. (calibrate จากเดือน {mLabel(cap.calMonth)}{cap.calMonthPartial ? ' — ยังไม่จบเดือน' : ''} + เวลาเลิกที่กรอก).
              เพดาน {cap.capacityPerDay.toLocaleString()} ออเดอร์/วัน = เลิกตรง {cap.maxFinish}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, borderBottom: '1px solid rgba(15,23,42,0.06)', position: 'relative' }}>
              {/* เส้นเพดาน */}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(cap.capacityPerDay / capMax) * 100}%`, borderTop: '1px dashed rgba(229,98,76,0.32)' }}>
                <span style={{ fontSize: 9, color: 'rgba(229,98,76,0.7)', position: 'absolute', right: 0, top: -12 }}>เพดาน {cap.maxFinish}</span>
              </div>
              {cap.series.map((m) => (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${mLabel(m.month)}: ~${m.avgPerDay}/วัน เลิก ${m.finish}`}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: m.finish > cap.maxFinish ? '#dc2626' : 'var(--payi-text)' }}>{m.finish}</div>
                  <div style={{ width: '68%', background: m.partial ? BAR.soft : (m.finish > cap.maxFinish ? BAR.alert : BAR.main), height: `${Math.max(2, (m.avgPerDay / capMax) * 88)}px`, borderRadius: barRadius }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              {cap.series.map((m) => (
                <div key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--payi-text-muted)' }}>{mLabel(m.month)}{m.partial ? '*' : ''}</div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <span>โต ~<b>{cap.growthPerDay > 0 ? '+' : ''}{cap.growthPerDay.toLocaleString()}</b> ออเดอร์/วัน ต่อเดือน ({cap.monthlyGrowthPct}%)</span>
              <span>อีก 3 เดือนเลิก ~<b>{cap.finishIn3mo}</b></span>
              <span>ชนเพดานใน <b>{cap.monthsToCap != null ? `~${cap.monthsToCap} เดือน` : 'ยังไม่ชน'}</b></span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--payi-text-muted)', marginTop: 4 }}>* เดือนที่ยังไม่จบ (สีเทา) ไม่นับในการคิดอัตราโต</div>
          </>
        ) : <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ข้อมูลออเดอร์ยังไม่พอ</div>}
      </div>

      {/* BREAK-EVEN — แว็ปเดียว */}
      {be?.ready && (() => {
        const feeVal = feeSim !== '' ? parseFloat(feeSim) : be.fbsFeePerPiece
        const self = Math.round((be.cheapestAlt || 0) * 100) / 100
        const fbsPO = feeVal > 0 ? Math.round(feeVal * be.piecesPerOrder * 100) / 100 : null
        const cheaper = fbsPO != null && self > 0 && fbsPO <= self
        const ratio = fbsPO != null && self > 0 ? Math.round((fbsPO / self) * 10) / 10 : null
        return (
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>FBS คุ้มเรื่องเงินไหม?<InfoTip note={NOTE.breakeven} /></h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13, flexWrap: 'wrap' }}>
              <span>ค่าธรรมเนียม FBS ต่อชิ้น</span>
              <input type="number" step="any" placeholder="0" value={feeSim}
                onChange={(e) => setFeeSim(e.target.value)}
                onFocus={(e) => { e.target.style.boxShadow = 'inset 0 2px 5px rgba(15,23,42,0.07), 0 0 0 3px rgba(37,99,235,0.18)' }}
                onBlur={(e) => { e.target.style.boxShadow = glassInput.boxShadow }}
                style={{ ...glassInput, width: 80, padding: '6px 8px', fontSize: 13 }} />
              <span style={{ color: 'var(--payi-text-muted)' }}>บาท</span>
            </div>
            {fbsPO == null ? (
              <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ใส่ค่าธรรมเนียมด้านบนเพื่อเทียบ</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div><div style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>แพ็คเอง</div><div style={{ fontSize: 24, fontWeight: 700 }}>฿{self}<span style={{ fontSize: 12, fontWeight: 400 }}> /ออเดอร์</span></div></div>
                  <div><div style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>FBS</div><div style={{ fontSize: 24, fontWeight: 700, color: cheaper ? '#16a34a' : '#dc2626' }}>฿{fbsPO}<span style={{ fontSize: 12, fontWeight: 400 }}> /ออเดอร์</span></div></div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--payi-text-muted)', marginTop: 4 }}>FBS/ออเดอร์ = ฿{feeVal} × {be.piecesPerOrder} ชิ้น/ออเดอร์</div>
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: cheaper ? '#f0fdf4' : '#fef2f2', color: cheaper ? '#16a34a' : '#dc2626' }}>
                  {cheaper ? `FBS ถูกกว่า — คุ้มเรื่องเงิน` : `FBS แพงกว่า ${ratio} เท่า — ไม่คุ้มเรื่องเงิน`}
                </div>
                {!cheaper && <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginTop: 6 }}>เหตุผลเดียวที่จะใช้ FBS = ไม่ต้องจัดการคนเพิ่ม / รับพีควันแคมเปญ — ไม่ใช่ประหยัดเงิน</div>}
              </>
            )}
          </div>
        )
      })()}

      {/* CAMPAIGN */}
      {camp?.ready && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>วันแคมเปญ (9.9 / 11.11 / 12.12) <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>วันที่ทีมเครียดสุด</span><InfoTip note={NOTE.campaign} /></h3>
          {camp.next && camp.next.predictedOrders != null && (() => {
            const c = camp.next.overCeiling ? [229, 98, 76] : [31, 160, 110]
            return (
              <div style={{
                fontSize: 13.5, margin: '4px 0 14px', lineHeight: 1.65, padding: '12px 16px', borderRadius: 14,
                background: `rgba(${c},0.1)`, border: `1px solid rgba(${c},0.28)`,
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              }}>
                <b>{camp.next.date}</b> (อีก {camp.next.daysUntil} วัน) — คาดออเดอร์ ~<b>{camp.next.predictedOrders.toLocaleString()}</b> (พุ่ง {camp.avgMultiplier}× จากปกติ) →
                ทีมเลิกงาน ~<b style={{ color: `rgb(${c})` }}>{camp.next.predictedFinish}</b>
                {camp.next.overCeiling ? ` — เกินเพดาน ${cap.maxFinish}! เตรียมส่ง FBS ก่อน / จัด OT ล่วงหน้า` : ' — ยังไหว'}
              </div>
            )
          })()}
          <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginBottom: 8 }}>ประวัติวันแคมเปญ (เทียบวันปกติรอบๆ)</div>
          {camp.observed.map((o) => (
            <div key={o.date} style={{ display: 'flex', gap: 14, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--card-border, rgba(15,23,42,0.06))', letterSpacing: '0.01em' }}>
              <span style={{ width: 90, color: 'var(--payi-text-muted)' }}>{o.date}</span>
              <span style={{ width: 120 }}>{o.orders.toLocaleString()} ออเดอร์</span>
              <span style={{ width: 52, color: 'var(--payi-text-muted)', fontWeight: 600 }}>{o.multiplier}×</span>
              <span style={{ color: 'var(--payi-text-muted)' }}>ปกติ ~{o.baseline.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* WEEKDAY */}
      {wd?.ready && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>โหลดตามวันในสัปดาห์ <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>ทุกเดือน — วันพีคคือตัวจริง</span><InfoTip note={NOTE.weekday} /></h3>
          <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
            วัน{wd.peakDay} ~{wd.peakAvgOrders.toLocaleString()} ({wd.peakRatio}× ค่าเฉลี่ย {wd.overallAvg.toLocaleString()}) — เลิกวันนั้น ~
            <b style={{ color: wd.peakOverCeiling ? '#dc2626' : 'inherit' }}>{wd.finishOnPeakDay}</b>{wd.peakOverCeiling ? ` (เกิน ${cap.maxFinish})` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 56 }}>
            {wd.series.map((s) => (
              <div key={s.day} style={{ flex: 1, textAlign: 'center' }} title={`${s.day}: ~${s.avgOrders}`}>
                <div style={{ background: s.day === wd.peakDay ? BAR.alert : BAR.main, height: `${Math.max(2, (s.avgOrders / wdMax) * 42)}px`, borderRadius: barRadius }} />
                <div style={{ fontSize: 9, color: 'var(--payi-text-muted)', marginTop: 2 }}>{s.day.slice(0, 2)}</div>
                <div style={{ fontSize: 9, fontWeight: 600 }}>{s.avgOrders.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PREP WINDOW */}
      {pw?.ready && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>วันเตรียมของเข้า FBS <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>ทุกเดือน — เติมเดือนละครั้ง</span><InfoTip note={NOTE.prep} /></h3>
          {pw.bestWindow && (
            <div style={{ fontSize: 14, fontWeight: 600, color: '#16a34a', marginBottom: 10 }}>
              แนะนำ: วันที่ {pw.bestWindow.start}–{pw.bestWindow.end} ของเดือน
              <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}> (~{pw.bestWindow.avgOrders.toLocaleString()} ออเดอร์/วัน เทียบเฉลี่ย {pw.overallAvg.toLocaleString()})</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
            {pw.series.map((s) => {
              const inWin = pw.bestWindow && s.day >= pw.bestWindow.start && s.day <= pw.bestWindow.end
              return (
                <div key={s.day} style={{ flex: 1, textAlign: 'center' }} title={`วันที่ ${s.day}: ~${s.avgOrders}`}>
                  <div style={{ background: inWin ? BAR.ok : BAR.soft, height: `${Math.max(2, (s.avgOrders / pwMax) * 46)}px`, borderRadius: '4px 4px 0 0' }} />
                  <div style={{ fontSize: 8, color: 'var(--payi-text-muted)', marginTop: 1 }}>{s.day}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* BY PRODUCT */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>ควร / ไม่ควร ย้ายเข้า FBS — รายกลุ่มสินค้า<InfoTip note={NOTE.byProduct} /></h3>
        <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
          ควร FBS = ส่งด่วน &lt;20% + ส่งธรรมดา/FBS รวม ≥55%. เก็บแพ็คเอง = ส่งด่วน ≥25%.
          "ส่ง ~X/รอบ" = ชิ้นแนะนำส่ง FBS ต่อรอบเติม (≈ demand ส่งธรรมดา 1 เดือน{data.byProductMeta?.dataMonths ? `, จากข้อมูล ${data.byProductMeta.dataMonths} เดือน` : ''})
        </div>
        {candidates.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', margin: '4px 0 6px' }}>ลอง FBS ได้ ({candidates.length})</div>}
        {candidates.map((p) => <ProductRow key={p.label} p={p} />)}
        {keepSelf.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: '#c2410c', margin: '12px 0 6px' }}>เก็บแพ็คเอง ({keepSelf.length})</div>}
        {keepSelf.map((p) => <ProductRow key={p.label} p={p} />)}
        {byProduct.filter((p) => p.verdict === 'review').length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 10 }}>
            + อีก {byProduct.filter((p) => p.verdict === 'review').length} กลุ่มที่ต้องดูเพิ่ม
          </div>
        )}
        {byProduct.length === 0 && <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ยังไม่มีข้อมูลตัวเลือกจัดส่งในช่วงนี้</div>}
      </div>

      {/* OT รวม — บรรทัดเดียว (ใช้ในการคิด break-even จ้างคนที่ 5) */}
      {ot?.ready && (
        <div style={{ ...card, padding: '14px 20px', fontSize: 12.5, color: 'var(--payi-text-muted)' }}>
          OT รวมช่วงนี้ <b style={{ color: 'var(--payi-text)' }}>{ot.totalHours} ชม.</b> ({thb(ot.totalCost)}) — ส่วนใหญ่เป็นงานฟีด/รีแพ็คของ ขึ้นกับ FG ไม่ใช่การแพ็คออเดอร์
        </div>
      )}

      {/* CONFIG */}
      {form && (
        <form onSubmit={saveConfig} style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>ตั้งค่า</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {CONFIG_FIELDS.map(([k, label]) => (
              <label key={k} style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>
                {label}
                <input type="number" step="any" value={form[k] ?? ''}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  style={{ ...glassInput, width: '100%', marginTop: 4, padding: '6px 8px', fontSize: 13 }} />
              </label>
            ))}
          </div>
          <button type="submit" disabled={saving} style={{ marginTop: 12, padding: '8px 20px', background: 'var(--payi-mint)', color: '#fff', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'บันทึก...' : 'บันทึก'}
          </button>
        </form>
      )}
    </div>
  )
}

function ProductRow({ p }) {
  const pv = PVERDICT[p.verdict]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 12.5 }}>
      <div style={{ width: 170, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.label}>{p.label}</div>
      <div style={{ flex: 1, background: '#eef2f7', borderRadius: 6, height: 14, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${p.standardPct}%`, background: 'var(--payi-mint)' }} />
        <div style={{ width: `${p.fastPct}%`, background: '#c2410c' }} />
      </div>
      <div style={{ width: 96, textAlign: 'right', fontSize: 10.5, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--payi-mint)' }}>ปกติ {p.standardPct}%</span>
        <span style={{ color: '#c2410c' }}> · ด่วน {p.fastPct}%</span>
        {p.fbsPct > 0 && <><br /><span style={{ color: 'var(--payi-text-muted)' }}>FBS {p.fbsPct}%</span></>}
      </div>
      <div style={{ width: 70, textAlign: 'right', color: 'var(--payi-text-muted)', fontSize: 11 }}>{p.orders} ออเดอร์</div>
      <div style={{ width: 100, textAlign: 'right', fontSize: 11 }}>
        <div style={{ fontWeight: 600, color: pv.c }}>{pv.t}</div>
        {p.verdict === 'fbs-candidate' && p.fbsSendUnits > 0 && (
          <div style={{ color: 'var(--payi-text-muted)', fontSize: 10 }}>ส่ง ~{p.fbsSendUnits.toLocaleString()}/รอบ</div>
        )}
      </div>
    </div>
  )
}
