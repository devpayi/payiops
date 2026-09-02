import { useEffect, useState } from 'react'

const thb = (n) => `฿${Math.round(n || 0).toLocaleString()}`
const card = { background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: 20 }
const VERDICT_COLOR = { act: '#dc2626', watch: '#c2410c', hold: '#16a34a', unknown: '#94a3b8' }
const VERDICT_LABEL = { act: 'ถึงจังหวะแล้ว', watch: 'ใกล้ถึง', hold: 'ยังไม่ถึง', unknown: 'ข้อมูลไม่พอ' }
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

  const { capacity: cap, weekday: wd, prepWindow: pw, fbsUsage: fbs, byProduct = [], otAudit: ot, fbsRetention: fr, verdict: v, stockoutNote, breakeven: be, campaign: camp } = data
  const candidates = byProduct.filter((p) => p.verdict === 'fbs-candidate')
  const keepSelf = byProduct.filter((p) => p.verdict === 'keep-self')
  const pwMax = pw?.ready ? Math.max(...pw.series.map((s) => s.avgOrders)) : 1
  const wdMax = wd?.ready ? Math.max(...wd.series.map((s) => s.avgOrders)) : 1
  const capMax = cap?.ready ? Math.max(cap.capacityPerDay, ...cap.series.map((s) => s.avgPerDay)) : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* RANGE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--payi-text-muted)' }}>ช่วงข้อมูล:</span>
        <select value={range} onChange={(e) => setRange(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--payi-border)', borderRadius: 8, fontSize: 13 }}>
          <option value="3">3 เดือนล่าสุด</option>
          <option value="6">6 เดือนล่าสุด</option>
          <option value="all">ทั้งหมด</option>
          {(data.availableMonths || []).slice().reverse().map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
        {loading && <span style={{ color: 'var(--payi-text-muted)', fontSize: 12 }}>กำลังโหลด...</span>}
        <span style={{ color: 'var(--payi-text-muted)', fontSize: 11 }}>(กราฟกำลังทีม / วันในเดือน / วันในสัปดาห์ ใช้ข้อมูลทุกเดือนเสมอ)</span>
      </div>

      {/* VERDICT */}
      <div style={{ ...card, borderLeft: `4px solid ${VERDICT_COLOR[v.level]}` }}>
        <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 4 }}>คำแนะนำ — ย้ายงานแพ็คเข้า Fulfillment?</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: VERDICT_COLOR[v.level], marginBottom: 6 }}>{VERDICT_LABEL[v.level]}</div>
        <div style={{ fontSize: 13, color: 'var(--payi-text)', lineHeight: 1.6 }}>{v.text}</div>
        {stockoutNote && <div style={{ fontSize: 12, color: '#16a34a', marginTop: 8 }}>✓ {stockoutNote}</div>}
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
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(cap.capacityPerDay / capMax) * 100}%`, borderTop: '1px dashed #dc2626' }}>
                <span style={{ fontSize: 9, color: '#dc2626', position: 'absolute', right: 0, top: -12 }}>เพดาน {cap.maxFinish}</span>
              </div>
              {cap.series.map((m) => (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${mLabel(m.month)}: ~${m.avgPerDay}/วัน เลิก ${m.finish}`}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: m.finish > cap.maxFinish ? '#dc2626' : 'var(--payi-text)' }}>{m.finish}</div>
                  <div style={{ width: '70%', background: m.partial ? '#cbd5e1' : (m.finish > cap.maxFinish ? '#dc2626' : 'var(--payi-mint)'), height: `${Math.max(2, (m.avgPerDay / capMax) * 88)}px`, borderRadius: '3px 3px 0 0' }} />
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

      {/* BREAK-EVEN */}
      {be?.ready && (() => {
        const feeVal = feeSim !== '' ? parseFloat(feeSim) : be.fbsFeePerPiece
        const fbsPO = feeVal > 0 ? Math.round(feeVal * be.piecesPerOrder * 100) / 100 : null
        const alt = be.cheapestAlt
        const bars = [
          { label: 'OT (4 คน)', v: be.otCostPerOrder, c: '#94a3b8' },
          { label: 'จ้างคนที่ 5', v: be.hireCostPerOrder, c: '#94a3b8' },
          { label: 'FBS', v: fbsPO, c: fbsPO != null && alt != null ? (fbsPO <= alt ? '#16a34a' : '#dc2626') : '#cbd5e1' },
        ]
        const bmax = Math.max(0.1, ...bars.map((b) => b.v || 0))
        return (
          <div style={card}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>ต้นทุนส่วนเพิ่ม/ออเดอร์ <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>เมื่อโตเกินทีม</span></h3>
            <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
              ค่าแรง 4 คน fixed อยู่แล้ว ไม่นับ. ที่นับคือส่วนที่เพิ่มเมื่อรับออเดอร์เกินกำลัง — ~{be.piecesPerOrder} ชิ้น/ออเดอร์ (ส่งธรรมดา Shopee)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12.5 }}>
              <span>ลองใส่ค่าธรรมเนียม FBS/ชิ้น:</span>
              <input type="number" step="any" placeholder={be.fbsFeePerPiece || '0'} value={feeSim}
                onChange={(e) => setFeeSim(e.target.value)}
                style={{ width: 90, padding: '5px 8px', border: '1px solid var(--payi-border)', borderRadius: 8, fontSize: 13 }} />
              <span style={{ color: 'var(--payi-text-muted)', fontSize: 11 }}>= ฿{fbsPO ?? '?'}/ออเดอร์</span>
            </div>
            {bars.map((b) => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12.5 }}>
                <div style={{ width: 90, flexShrink: 0 }}>{b.label}</div>
                <div style={{ flex: 1, background: '#eef2f7', borderRadius: 6, height: 16, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${((b.v || 0) / bmax) * 100}%`, background: b.c, borderRadius: 6 }} />
                </div>
                <div style={{ width: 70, textAlign: 'right', fontWeight: 600 }}>{b.v != null ? `฿${b.v}` : '—'}</div>
              </div>
            ))}
            {fbsPO != null && alt != null && (
              <div style={{ fontSize: 12, marginTop: 8, color: fbsPO <= alt ? '#16a34a' : '#92400e', lineHeight: 1.5 }}>
                {fbsPO <= alt
                  ? `FBS ถูกกว่า — คุ้มตามต้นทุน ต่างกัน ~฿${Math.round((alt - fbsPO) * 100) / 100}/ออเดอร์`
                  : `FBS แพงกว่า ~฿${Math.round((fbsPO - alt) * 100) / 100}/ออเดอร์ — ไม่คุ้มถ้าดูแค่ต้นทุน. เหตุผลที่ยังควรใช้ = ไม่ต้องจัดการคนเพิ่ม / รับพีควันแคมเปญ / OT มีเพดาน (คนล้า, กฎหมาย)`}
              </div>
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
              <span style={{ color: '#c2410c', fontWeight: 600 }}>{o.multiplier}× </span>
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
                <div style={{ background: s.day === wd.peakDay ? '#dc2626' : '#cbd5e1', height: `${Math.max(2, (s.avgOrders / wdMax) * 42)}px`, borderRadius: 3 }} />
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
                  <div style={{ background: inWin ? '#16a34a' : '#cbd5e1', height: `${Math.max(2, (s.avgOrders / pwMax) * 46)}px`, borderRadius: 2 }} />
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
                <div style={{ background: 'var(--payi-mint)', height: `${Math.max(2, m.fbsPct * 0.6)}px`, borderRadius: 3 }} />
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

      {/* OT AUDIT */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>OT เฟ้อ?</h3>
        {ot.ready ? (
          <>
            <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 10 }}>
              วันที่มี OT แต่ออเดอร์น้อยกว่า 80% ของค่ากลาง ({ot.medianDailyOrders} ออเดอร์/วัน) = น่าสงสัย
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 13, marginBottom: 12 }}>
              <span>OT รวม <b>{ot.totalOtHours} ชม.</b> ({thb(ot.totalOtCost)})</span>
              <span style={{ color: '#dc2626' }}>น่าสงสัย <b>{ot.suspiciousOtHours} ชม.</b> ({thb(ot.suspiciousOtCost)})</span>
            </div>
            {ot.flaggedDays?.length > 0 ? (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--payi-text-muted)', textAlign: 'left' }}><th style={{ padding: '4px 0' }}>วันที่</th><th>OT (ชม.)</th><th>ออเดอร์วันนั้น</th></tr></thead>
                <tbody>
                  {ot.flaggedDays.map((d) => (
                    <tr key={d.date} style={{ borderTop: '1px solid var(--payi-border)' }}>
                      <td style={{ padding: '5px 0' }}>{d.date}</td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{d.otHours}</td>
                      <td>{d.orders} <span style={{ color: 'var(--payi-text-muted)' }}>(กลาง {d.medianOrders})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ color: '#16a34a', fontSize: 13 }}>ไม่พบวัน OT ที่น่าสงสัยในช่วงนี้</div>}
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
                  style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--payi-border)', borderRadius: 8, fontSize: 13 }} />
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
