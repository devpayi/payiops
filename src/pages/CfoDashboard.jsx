import { useEffect, useState } from 'react'

const thb = (n) => `฿${Math.round(n).toLocaleString()}`

export default function CfoDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingCapital, setSavingCapital] = useState(false)
  const [capitalForm, setCapitalForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', note: '' })
  const [fixCostForm, setFixCostForm] = useState({ item: '', amount: '' })

  const load = () => {
    setLoading(true)
    fetch('/api/sheet-tools?op=cfo&view=summary')
      .then((r) => r.json())
      .then((d) => { if (d.success) { setData(d); setError('') } else setError(d.error || 'โหลดข้อมูลไม่สำเร็จ') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const submitCapital = async (e) => {
    e.preventDefault()
    if (!capitalForm.amount) return
    setSavingCapital(true)
    try {
      const res = await fetch('/api/sheet-tools?op=cfo&action=add-capital', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capitalForm) })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setCapitalForm({ date: new Date().toISOString().slice(0, 10), amount: '', note: '' })
      load()
    } catch (e) { setError(e.message) } finally { setSavingCapital(false) }
  }

  const addFixCost = async (e) => {
    e.preventDefault()
    if (!fixCostForm.item || !fixCostForm.amount) return
    try {
      const res = await fetch('/api/sheet-tools?op=cfo&action=upsert-fixcost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fixCostForm, active: true }) })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setFixCostForm({ item: '', amount: '' })
      load()
    } catch (e) { setError(e.message) }
  }

  const deleteFixCost = async (id) => {
    try {
      const res = await fetch('/api/sheet-tools?op=cfo&action=delete-fixcost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      load()
    } catch (e) { setError(e.message) }
  }

  const card = { background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: 20 }
  const kpi = (extra = {}) => ({ ...card, padding: 16, ...extra })

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
  if (error) return <div style={{ padding: 16, borderRadius: 12, background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' }}>เกิดข้อผิดพลาด: {error}</div>
  if (!data) return null

  const maxTrend = Math.max(1, ...data.cashTrend.map((c) => c.amount))
  const isProfit = data.burnRate <= 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!data.capitalHistory.length && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5, padding: '10px 14px', borderRadius: 10 }}>
          ยังไม่มีข้อมูลเงินทุนเลย — กรอก snapshot แรกด้านล่างเพื่อเริ่มเห็นกราฟ/runway
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <div style={kpi()}>
          <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 6 }}>เงินทุนคงเหลือ</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{thb(data.latestCapital)}</div>
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 4 }}>{data.capitalHistory[0]?.date || '-'}</div>
        </div>
        <div style={kpi()}>
          <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 6 }}>Fix cost / เดือน</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{thb(data.fixCostMonthly)}</div>
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 4 }}>{data.fixCostItems.length} รายการ</div>
        </div>
        <div style={kpi({ color: isProfit ? 'var(--payi-success)' : 'var(--payi-danger)' })}>
          <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 6 }}>{isProfit ? 'กำไร/เดือน' : 'Burn rate (ขาดทุน)'}</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{isProfit ? `+${thb(-data.burnRate)}` : `-${thb(data.burnRate)}`}</div>
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 4 }}>เทียบยอดขายเฉลี่ย 3 เดือน</div>
        </div>
        <div style={kpi({ color: !isProfit && data.runwayMonths != null && data.runwayMonths < 6 ? 'var(--payi-danger)' : 'var(--payi-success)' })}>
          <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 6 }}>Runway</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{isProfit ? 'ไม่เผาเงิน' : data.runwayMonths != null ? `${data.runwayMonths} เดือน` : '∞'}</div>
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 4 }}>ถ้าไม่มีงานเข้าเพิ่ม</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .9fr', gap: 16 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>เงินทุนคงเหลือรายเดือน <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>({data.cashTrend.length} snapshot ล่าสุด)</span></h3>
          {data.cashTrend.length ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, paddingTop: 10 }}>
              {data.cashTrend.map((c) => (
                <div key={c.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--payi-text-muted)' }}>{Math.round(c.amount / 1000)}k</div>
                  <div style={{ width: '100%', borderRadius: '6px 6px 0 0', background: 'var(--payi-mint)', minHeight: 2, height: `${(c.amount / maxTrend) * 100}px` }} />
                  <div style={{ fontSize: 10.5, color: 'var(--payi-text-muted)' }}>{c.date.slice(5)}</div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--payi-text-muted)', fontSize: 13 }}>ยังไม่มีข้อมูล</div>}
        </div>

        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Fix cost แยกรายการ <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>กรอกเองได้</span></h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid var(--payi-border)' }}>รายการ</th><th style={{ textAlign: 'right', color: 'var(--payi-text-muted)', fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid var(--payi-border)' }}>บาท/เดือน</th><th style={{ borderBottom: '1px solid var(--payi-border)' }}></th></tr></thead>
            <tbody>
              {data.fixCostItems.map((it) => (
                <tr key={it.id}>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--payi-border)' }}>{it.item}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--payi-border)', textAlign: 'right' }}>{it.amount.toLocaleString()}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--payi-border)' }}><button onClick={() => deleteFixCost(it.id)} style={{ background: 'transparent', color: 'var(--payi-danger)', border: '1px solid var(--payi-danger-bg)', borderRadius: 8, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>ลบ</button></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td style={{ padding: '7px 8px' }}>รวม</td><td style={{ padding: '7px 8px', textAlign: 'right' }}>{data.fixCostMonthly.toLocaleString()}</td><td /></tr>
            </tbody>
          </table>
          <form onSubmit={addFixCost} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <input placeholder="ชื่อรายการ" value={fixCostForm.item} onChange={(e) => setFixCostForm({ ...fixCostForm, item: e.target.value })} style={{ border: '1px solid var(--payi-border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5 }} />
            <input placeholder="บาท/เดือน" type="number" style={{ width: 100, border: '1px solid var(--payi-border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5 }} value={fixCostForm.amount} onChange={(e) => setFixCostForm({ ...fixCostForm, amount: e.target.value })} />
            <button type="submit" style={{ background: 'var(--payi-mint)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>+ เพิ่ม</button>
          </form>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>บันทึกเงินทุน <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)', fontSize: 12 }}>snapshot รายเดือน — กรอกเล่นๆ ตามฟีล</span></h3>
        <form onSubmit={submitCapital} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input type="date" value={capitalForm.date} onChange={(e) => setCapitalForm({ ...capitalForm, date: e.target.value })} style={{ border: '1px solid var(--payi-border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5 }} />
          <input type="number" placeholder="เงินทุนคงเหลือ (บาท)" style={{ width: 160, border: '1px solid var(--payi-border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5 }} value={capitalForm.amount} onChange={(e) => setCapitalForm({ ...capitalForm, amount: e.target.value })} />
          <input placeholder="โน้ต (ไม่บังคับ)" style={{ width: 220, border: '1px solid var(--payi-border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5 }} value={capitalForm.note} onChange={(e) => setCapitalForm({ ...capitalForm, note: e.target.value })} />
          <button type="submit" disabled={savingCapital} style={{ background: 'var(--payi-mint)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{savingCapital ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </form>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr><th style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid var(--payi-border)' }}>วันที่</th><th style={{ textAlign: 'right', color: 'var(--payi-text-muted)', fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid var(--payi-border)' }}>เงินทุนคงเหลือ</th><th style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid var(--payi-border)' }}>โน้ต</th></tr></thead>
          <tbody>
            {data.capitalHistory.map((c) => (
              <tr key={c.id}>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--payi-border)' }}>{c.date}</td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--payi-border)', textAlign: 'right' }}>{Math.round(c.amount).toLocaleString()}</td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--payi-border)', color: 'var(--payi-text-muted)' }}>{c.note || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
