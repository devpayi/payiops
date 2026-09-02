import { useEffect, useState } from 'react'

const thb = (n) => `฿${Math.round(n || 0).toLocaleString()}`

// ── Liquid glass (light theme) ──
const card = {
  background: 'rgba(255,255,255,0.62)',
  backdropFilter: 'blur(16px) saturate(180%)',
  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.75)',
  borderRadius: 16,
  padding: 22,
  boxShadow: '0 12px 32px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.65)',
}
const glassInput = {
  background: 'rgba(255,255,255,0.55)',
  border: '1px solid rgba(255,255,255,0.7)',
  borderRadius: 10,
  boxShadow: 'inset 0 2px 5px rgba(15,23,42,0.07)',
  outline: 'none',
}
const glowDot = (c) => ({ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0, boxShadow: c.startsWith('#') ? `0 0 6px ${c}66` : 'none' })
// แท่งกราฟ — โทนโปร่ง นุ่ม เข้ากับ glass (ไม่ใช่สีทึบจัด)
const BAR = { main: 'rgba(79,110,247,0.55)', soft: 'rgba(100,116,139,0.28)', alert: 'rgba(225,90,70,0.6)', ok: 'rgba(34,160,110,0.55)' }
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

  const { capacity: cap, weekday: wd, prepWindow: pw, fbsUsage: fbs, byProduct = [], otMonthly: ot, fbsRetention: fr, verdict: v, stockoutNote, breakeven: be, campaign: camp } = data
  const otMax = ot?.ready ? Math.max(1, ...ot.series.map((s) => s.otHours)) : 1
  const feedMax = ot?.hasFeedData ? Math.max(1, ...ot.series.map((s) => s.feedUnits)) : 1
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
      <div style={{ ...card, background: VERDICT_TINT[v.level].bg, border: '1px solid rgba(255,255,255,0.6)', boxShadow: VERDICT_TINT[v.level].glow }}>
        <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 4 }}>คำแนะนำ — ย้ายงานแพ็คเข้า Fulfillment?</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: VERDICT_COLOR[v.level], marginBottom: 8, letterSpacing: '-0.01em' }}>{VERDICT_LABEL[v.level]}</div>
        <div style={{ fontSize: 13, color: 'var(--payi-text)', lineHeight: 1.65 }}>{v.text}</div>
        {stockoutNote && <div style={{ fontSize: 12, color: '#15803d', marginTop: 10 }}>✓ {stockoutNote}</div>}
      </div>

      {/* CAPACITY — monthly */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>กำลังทีมแพ็ค — เวลาเลิกงานรายเดือน</h3>
        {cap.ready && cap.series.length < 2 ? (
          <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>เลือกเดือนเดียว — กราฟกำลังทีมต้องดูหลายเดือน เลือก "3 เดือนล่าสุด" หรือ "ทั้งหมด"</div>
        ) : cap.ready ? (
          <>
            <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
              อัตราแพ็ค ~{cap.ordersPerPersonHour} ออเดอร์/คน/ชม. (calibrate จากเดือน {mLabel(cap.calMonth)}{cap.calMonthPartial ? ' — ยังไม่จบเดือน' : ''} + เวลาเลิกที่กรอก).
              เพดาน {cap.capacityPerDay.toLocaleString()} ออเดอร์/วัน = เลิกตรง {cap.maxFinish}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, borderBottom: '1px solid var(--payi-border)', position: 'relative' }}>
              {/* เส้นเพดาน */}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(cap.capacityPerDay / capMax) * 100}%`, borderTop: '1px dashed rgba(220,38,38,0.38)' }}>
                <span style={{ fontSize: 9, color: 'rgba(220,38,38,0.75)', position: 'absolute', right: 0, top: -12 }}>เพดาน {cap.maxFinish}</span>
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
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>FBS คุ้มเรื่องเงินไหม?</h3>
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
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>วันแคมเปญ (9.9 / 11.11 / 12.12) <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>วันที่ทีมเครียดสุด</span></h3>
          {camp.next && camp.next.predictedOrders != null && (
            <div style={{ fontSize: 13.5, marginBottom: 12, lineHeight: 1.6, padding: '10px 12px', borderRadius: 10, background: camp.next.overCeiling ? '#fef2f2' : '#f0fdf4' }}>
              <b>{camp.next.date}</b> (อีก {camp.next.daysUntil} วัน) — คาดออเดอร์ ~<b>{camp.next.predictedOrders.toLocaleString()}</b> (พุ่ง {camp.avgMultiplier}× จากปกติ) →
              ทีมเลิกงาน ~<b style={{ color: camp.next.overCeiling ? '#dc2626' : '#16a34a' }}>{camp.next.predictedFinish}</b>
              {camp.next.overCeiling ? ` — เกินเพดาน ${cap.maxFinish}! เตรียมส่ง FBS ก่อน / จัด OT ล่วงหน้า` : ' — ยังไหว'}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginBottom: 6 }}>ประวัติวันแคมเปญ (เทียบวันปกติรอบๆ)</div>
          {camp.observed.map((o) => (
            <div key={o.date} style={{ display: 'flex', gap: 12, fontSize: 12.5, marginBottom: 3 }}>
              <span style={{ width: 90 }}>{o.date}</span>
              <span style={{ width: 130 }}>{o.orders.toLocaleString()} ออเดอร์</span>
              <span style={{ color: 'var(--payi-text-strong)', fontWeight: 700 }}>{o.multiplier}× </span>
              <span style={{ color: 'var(--payi-text-muted)' }}>(ปกติ ~{o.baseline.toLocaleString()})</span>
            </div>
          ))}
        </div>
      )}

      {/* WEEKDAY */}
      {wd?.ready && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>โหลดตามวันในสัปดาห์ <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>ทุกเดือน — วันพีคคือตัวจริง</span></h3>
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
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>วันเตรียมของเข้า FBS <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>ทุกเดือน — เติมเดือนละครั้ง</span></h3>
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

      {/* FBS RETENTION */}
      {fr?.ready && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>FBS ช่วยให้ลูกค้ากลับมาซื้อซ้ำไหม <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>Shopee — สังเกต ไม่ใช่ข้อพิสูจน์</span></h3>
          {fr.enoughSample ? (
            <>
              <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>เคยได้ FBS</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{fr.fbsRepeatPct}%</div>
                  <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>ซื้อซ้ำ ({fr.fbsBuyers.toLocaleString()} คน)</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>ได้แต่แพ็คเอง</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{fr.selfRepeatPct}%</div>
                  <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>ซื้อซ้ำ ({fr.selfBuyers.toLocaleString()} คน)</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#92400e', marginTop: 10, lineHeight: 1.5 }}>
                ⚠️ มี bias: ลูกค้าที่ซื้อหลายครั้งมีโอกาสเจอออเดอร์ FBS สักครั้งอยู่แล้ว → ตัวเลขเอียงสูงเกินจริง ดูเป็นสัญญาณคร่าวๆ
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--payi-text-muted)', fontSize: 12.5, marginTop: 6 }}>
              ข้อมูลยังไม่พอ (FBS {fr.fbsBuyers.toLocaleString()} / แพ็คเอง {fr.selfBuyers.toLocaleString()} คน — ต้องการฝั่งละ ≥100) — จะมีความหมายในอีก 2-3 เดือน
            </div>
          )}
        </div>
      )}

      {/* FBS USAGE */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Fulfilled By Shopee ตอนนี้ <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>Shopee เท่านั้น</span></h3>
        <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
          มีข้อมูลตัวเลือกจัดส่ง {fbs.coveragePct}% ของออเดอร์ Shopee ในช่วงนี้ ({fbs.coveredOrders?.toLocaleString()} / {fbs.shopeeOrders?.toLocaleString()})
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 13, marginBottom: 12 }}>
          <span>ผ่าน FBS <b style={{ color: '#c2410c' }}>{fbs.fbsOrderPct}%</b></span>
          <span>ชิ้น <b>{fbs.fbsUnitPct}%</b></span>
          <span>ยอดขาย <b>{fbs.fbsRevenuePct}%</b></span>
        </div>
        {fbs.trend?.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 50 }}>
            {fbs.trend.map((m) => (
              <div key={m.month} style={{ flex: 1, textAlign: 'center' }} title={`${mLabel(m.month)}: ${m.fbsPct}%`}>
                <div style={{ background: BAR.main, height: `${Math.max(2, m.fbsPct * 0.6)}px`, borderRadius: barRadius }} />
                <div style={{ fontSize: 9, color: 'var(--payi-text-muted)', marginTop: 2 }}>{mLabel(m.month)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BY PRODUCT */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>ควร / ไม่ควร ย้ายเข้า FBS — รายกลุ่มสินค้า</h3>
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

      {/* OT MONTHLY */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>OT รายเดือน <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>ชั่วโมง / บาท</span></h3>
        {ot.ready ? (
          <>
            <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
              OT ส่วนใหญ่เป็นงานฟีด/รีแพ็คของ (ขึ้นกับ FG ที่ต้องเตรียม) ไม่ใช่การแพ็คออเดอร์ — แพ็คเสร็จ พัก 1 ชม. แล้วมาฟีดต่อจนเลิกงาน
            </div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>OT รวมช่วงนี้ <b>{ot.totalHours} ชม.</b> ({thb(ot.totalCost)})</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 90, borderBottom: '1px solid var(--payi-border)' }}>
              {ot.series.map((s) => (
                <div key={s.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}
                  title={`${mLabel(s.month)}: ${s.otHours} ชม. (${thb(s.otCost)})${ot.hasFeedData ? ` — ฟีด ${s.feedUnits.toLocaleString()}` : ''}`}>
                  <div style={{ fontSize: 9, fontWeight: 600 }}>{s.otHours}</div>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', width: '80%', height: '100%' }}>
                    <div style={{ flex: 1, background: 'rgba(225,140,70,0.6)', height: `${(s.otHours / otMax) * 72}px`, borderRadius: barRadius }} />
                    {ot.hasFeedData && <div style={{ flex: 1, background: BAR.main, height: `${(s.feedUnits / feedMax) * 72}px`, borderRadius: barRadius }} title="ปริมาณฟีด" />}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              {ot.series.map((s) => <div key={s.month} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--payi-text-muted)' }}>{mLabel(s.month)}</div>)}
            </div>
            {ot.hasFeedData
              ? <div style={{ fontSize: 10, color: 'var(--payi-text-muted)', marginTop: 4 }}><span style={{ color: 'rgba(225,140,70,0.9)' }}>■</span> OT ชม. &nbsp; <span style={{ color: 'rgba(79,110,247,0.9)' }}>■</span> ปริมาณฟีด (planner_daily) — เดือนที่ฟีดเยอะควรมี OT เยอะตาม</div>
              : <div style={{ fontSize: 10, color: 'var(--payi-text-muted)', marginTop: 4 }}>ยังไม่มีข้อมูลปริมาณฟีดรายวัน (planner_daily ว่าง) — กรอกในหน้า Planner Control แล้วจะเทียบ OT กับปริมาณฟีดได้</div>}
          </>
        ) : <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ยังไม่มีข้อมูล OT ในช่วงนี้</div>}
      </div>

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
        <div style={{ width: `${p.standardPct}%`, background: 'var(--payi-mint)' }} title={`ธรรมดา ${p.standardPct}%`} />
        <div style={{ width: `${p.fastPct}%`, background: '#c2410c' }} title={`ด่วน ${p.fastPct}%`} />
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
