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
  ['normal_finish', 'เลิกปกติตอนนี้ (เช่น 14.5)'],
  ['max_finish', 'เลิกช้าสุดที่รับได้ (เช่น 17)'],
  ['daily_wage', 'ค่าแรง/คน/วัน'],
  ['ot_rate_per_hour', 'ค่า OT/ชม.'],
  ['fbs_fee_per_piece', 'ค่าธรรมเนียม FBS/ชิ้น'],
  ['fbs_storage_monthly', 'ค่าเก็บของ FBS/เดือน'],
]

export default function Fulfillment() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/sheet-tools?op=fulfillment')
      .then((r) => r.json())
      .then((d) => { if (d.success) { setData(d); setForm(d.config); setError('') } else setError(d.error || 'โหลดไม่สำเร็จ') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const saveConfig = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/sheet-tools?op=fulfillment&action=save-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
  if (error) return <div style={{ padding: 16, borderRadius: 12, background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' }}>เกิดข้อผิดพลาด: {error}</div>
  if (!data) return null

  const { fbsUsage: fbs, byProduct = [], capacity: cap, otAudit: ot, verdict: v } = data
  const candidates = byProduct.filter((p) => p.verdict === 'fbs-candidate')
  const keepSelf = byProduct.filter((p) => p.verdict === 'keep-self')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* VERDICT */}
      <div style={{ ...card, borderLeft: `4px solid ${VERDICT_COLOR[v.level]}` }}>
        <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 4 }}>คำแนะนำ — ย้ายงานแพ็คเข้า Fulfillment?</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: VERDICT_COLOR[v.level], marginBottom: 6 }}>{VERDICT_LABEL[v.level]}</div>
        <div style={{ fontSize: 13, color: 'var(--payi-text)', lineHeight: 1.6 }}>{v.text}</div>
      </div>

      {/* CAPACITY */}
      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>กำลังทีมแพ็ค</h3>
        {cap.ready ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
              {[
                ['ออเดอร์/วัน (ล่าสุด)', cap.recentAvgPerDay.toLocaleString()],
                ['เลิกงานตอนนี้ ~', cap.finishNow],
                ['วันพีคเลิก ~', `${cap.finishAtPeak} (${cap.peakDay?.orders?.toLocaleString()} ออเดอร์)`],
                ['อีก 3 เดือนเลิก ~', cap.finishIn3mo],
                ['โต/เดือน', `${cap.monthlyGrowthPct > 0 ? '+' : ''}${cap.monthlyGrowthPct}%`],
                ['ชนเพดาน (' + cap.maxFinish + ') ใน', cap.monthsToCap != null ? `~${cap.monthsToCap} เดือน` : 'ยังไม่ชน'],
              ].map(([k, val]) => (
                <div key={k} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>{k}</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
            {(() => {
              const util = Math.min(100, cap.utilizationPct)
              return (
                <div style={{ background: '#eef2f7', borderRadius: 8, height: 14, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${util}%`, background: cap.utilizationPct >= 100 ? '#dc2626' : cap.utilizationPct >= 85 ? '#c2410c' : 'var(--payi-mint)' }} />
                </div>
              )
            })()}
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 6 }}>
              อัตราแพ็คคำนวณจากข้อมูลจริง = ~{cap.ordersPerPersonHour} ออเดอร์/คน/ชม. (จากปริมาณล่าสุด + เวลาเลิกปกติที่กรอก). เพดาน {cap.capacityPerDay.toLocaleString()} ออเดอร์/วัน = เลิกตรง {cap.maxFinish}
            </div>
          </>
        ) : <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ข้อมูลออเดอร์ยังไม่พอ (ต้องมีอย่างน้อย 14 วัน)</div>}
      </div>

      {/* FBS USAGE */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Fulfilled By Shopee ตอนนี้ <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>Shopee เท่านั้น — TikTok ไม่มีข้อมูล</span></h3>
        <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
          มีข้อมูลตัวเลือกจัดส่ง {fbs.coveragePct}% ของออเดอร์ Shopee ({fbs.coveredOrders?.toLocaleString()} / {fbs.shopeeOrders?.toLocaleString()})
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 13, marginBottom: 12 }}>
          <span>ออเดอร์ผ่าน FBS <b style={{ color: '#c2410c' }}>{fbs.fbsOrderPct}%</b></span>
          <span>ชิ้น <b>{fbs.fbsUnitPct}%</b></span>
          <span>ยอดขาย <b>{fbs.fbsRevenuePct}%</b></span>
        </div>
        {fbs.trend?.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60 }}>
            {fbs.trend.map((m) => (
              <div key={m.month} style={{ flex: 1, textAlign: 'center' }} title={`${m.month}: ${m.fbsPct}% (${m.orders})`}>
                <div style={{ background: 'var(--payi-mint)', height: `${Math.max(2, m.fbsPct * 0.5)}px`, borderRadius: 3 }} />
                <div style={{ fontSize: 9, color: 'var(--payi-text-muted)', marginTop: 2 }}>{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BY PRODUCT */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>ควร / ไม่ควร ย้ายเข้า FBS — รายกลุ่มสินค้า</h3>
        <div style={{ color: 'var(--payi-text-muted)', fontSize: 11.5, marginBottom: 12 }}>
          ควร FBS = ส่งด่วนน้อย (&lt;20%) + ส่งธรรมดา/FBS อยู่แล้วรวมกัน ≥55%. เก็บแพ็คเอง = ส่งด่วนเยอะ (≥25% ความเร็วคือจุดขาย)
        </div>
        {candidates.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', margin: '4px 0 6px' }}>ลอง FBS ได้ ({candidates.length})</div>}
        {candidates.map((p) => <ProductRow key={p.label} p={p} />)}
        {keepSelf.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: '#c2410c', margin: '12px 0 6px' }}>เก็บแพ็คเอง ({keepSelf.length})</div>}
        {keepSelf.map((p) => <ProductRow key={p.label} p={p} />)}
        {byProduct.filter((p) => p.verdict === 'review').length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 10 }}>
            + อีก {byProduct.filter((p) => p.verdict === 'review').length} กลุ่มที่ต้องดูเพิ่ม (ส่งด่วน 20–25% หรือส่งธรรมดายังไม่ถึง 55%)
          </div>
        )}
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
                <thead><tr style={{ color: 'var(--payi-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 0' }}>วันที่</th><th>OT (ชม.)</th><th>ออเดอร์วันนั้น</th>
                </tr></thead>
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
            ) : <div style={{ color: '#16a34a', fontSize: 13 }}>ไม่พบวัน OT ที่น่าสงสัย</div>}
          </>
        ) : <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ยังไม่มีข้อมูล OT (`workforce_ot`)</div>}
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
      <div style={{ width: 74, textAlign: 'right', color: 'var(--payi-text-muted)', fontSize: 11 }}>{p.orders} ออเดอร์</div>
      <div style={{ width: 84, textAlign: 'right', fontSize: 11, fontWeight: 600, color: pv.c }}>{pv.t}</div>
    </div>
  )
}
