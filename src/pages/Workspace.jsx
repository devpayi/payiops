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

const CI = {
  on: { label: 'ไปได้', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
  stuck: { label: 'ติด', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
  done: { label: 'เสร็จ', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
}
const ago = (d) => (d == null ? '' : d === 0 ? 'วันนี้' : `${d} วันก่อน`)
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--payi-line, #e5e7eb)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }

function CheckinForm({ item, asKey, onSaved, onCancel }) {
  const [status, setStatus] = useState(item.last?.status || 'on')
  const [done, setDone] = useState('')
  const [next, setNext] = useState('')
  const [blocker, setBlocker] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setSaving(true); setError('')
    try {
      const r = await fetch(`/api/sheet-tools?op=workspace&as=${encodeURIComponent(asKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkin', board_no: item.no, status, done, next, blocker }),
      })
      const d = await r.json()
      if (!d.success) { setError(d.error || 'บันทึกไม่สำเร็จ'); return }
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {Object.entries(CI).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} style={{ flex: 1, padding: '7px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: `1px solid ${status === k ? v.color : 'var(--payi-line, #e5e7eb)'}`, background: status === k ? v.bg : 'transparent', color: status === k ? v.color : 'var(--payi-text)' }}>{v.label}</button>
        ))}
      </div>
      <textarea rows={2} style={input} placeholder="สัปดาห์นี้ทำอะไรไปแล้ว" value={done} onChange={(e) => setDone(e.target.value)} />
      <textarea rows={2} style={input} placeholder="ขั้นต่อไป" value={next} onChange={(e) => setNext(e.target.value)} />
      <textarea rows={2} style={{ ...input, borderColor: status === 'stuck' ? '#fca5a5' : undefined }} placeholder={status === 'stuck' ? 'ติดอะไร (ต้องกรอก)' : 'ติดอะไรไหม (ถ้ามี)'} value={blocker} onChange={(e) => setBlocker(e.target.value)} />
      {error && <div style={{ fontSize: 12, color: 'var(--payi-danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid var(--payi-line, #e5e7eb)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
        <button type="button" disabled={saving} onClick={submit} className="payi-btn-primary" style={{ padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
    </div>
  )
}

function BoardCard({ item, asKey, onSaved }) {
  const [open, setOpen] = useState(false)
  const last = item.last
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--payi-gradient-primary)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{item.no}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{item.title}</div>
          <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 4 }}>ฝ่าย {item.dept} · {item.ownerNames.join(' + ')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
            {last ? <span style={chip(CI[last.status]?.bg, CI[last.status]?.color)}>{CI[last.status]?.label}</span> : <span style={chip('var(--payi-bg, #f1f5f9)', 'var(--payi-text-muted)')}>ยังไม่เคยอัปเดต</span>}
            {last && <span style={{ fontSize: 11, color: item.stale ? '#c2410c' : 'var(--payi-text-muted)' }}>อัปเดต {ago(item.ageDays)}{item.stale ? ' — ถึงรอบอัปเดตแล้ว' : ''}</span>}
          </div>
          {last?.next_text && <div style={{ fontSize: 12, color: 'var(--payi-text)', marginTop: 6 }}>ขั้นต่อไป: {last.next_text}</div>}
          {last?.status === 'stuck' && last.blocker && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>ติด: {last.blocker}</div>}
        </div>
      </div>
      {open
        ? <CheckinForm item={item} asKey={asKey} onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved() }} />
        : <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 10, border: '1px dashed var(--payi-line, #cbd5e1)', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--payi-text-strong)' }}>อัปเดตสัปดาห์นี้</button>}
    </div>
  )
}

function TrackerCard({ tracker }) {
  const rank = (t) => (t.waiting ? 4 : t.last?.status === 'stuck' ? 0 : t.stale ? 1 : t.last?.status === 'done' ? 3 : 2)
  const rows = [...tracker].sort((a, b) => rank(a) - rank(b) || a.no - b.no)
  const stuck = tracker.filter((t) => t.last?.status === 'stuck').length
  const stale = tracker.filter((t) => t.stale).length
  return (
    <div style={card}>
      <h3 style={sectionTitle}>ติดตามหัวข้อ ({tracker.length}) · ติด {stuck} · ไม่อัปเดตเกิน 7 วัน {stale}</h3>
      {rows.map((t) => (
        <div key={t.no} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 10, alignItems: 'start', padding: '9px 0', borderTop: '1px solid var(--payi-line, #eef2f7)', opacity: t.waiting ? 0.55 : 1 }}>
          <div style={{ fontWeight: 800, color: 'var(--payi-text-muted)', fontSize: 13 }}>{t.no}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{t.title} <span style={{ fontWeight: 400, color: 'var(--payi-text-muted)' }}>— {t.ownerNames.join(' + ')}</span></div>
            {t.last?.status === 'stuck' && t.last.blocker && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>ติด: {t.last.blocker}</div>}
            {t.last?.next_text && t.last.status !== 'stuck' && <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 2 }}>ขั้นต่อไป: {t.last.next_text}</div>}
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            {t.waiting ? <span style={chip('var(--payi-bg, #f1f5f9)', 'var(--payi-text-muted)')}>รอคน</span>
              : t.last ? <span style={chip(CI[t.last.status]?.bg, CI[t.last.status]?.color)}>{CI[t.last.status]?.label}</span>
              : <span style={chip('#fff7ed', '#c2410c')}>ยังไม่เคยอัปเดต</span>}
            {t.last && <div style={{ fontSize: 11, color: t.stale ? '#c2410c' : 'var(--payi-text-faint)', marginTop: 3 }}>{ago(t.ageDays)}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

const pct1 = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`)
const moverColor = (delta) => (delta >= 0 ? '#16a34a' : '#dc2626')

function MoverRow({ m }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--payi-line, #eef2f7)' }}>
      <div style={{ fontSize: 13, color: 'var(--payi-text-strong)', fontWeight: 600 }}>{m.name}</div>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: moverColor(m.delta) }}>{m.delta >= 0 ? '+' : ''}{thb(m.delta)}</span>
        <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>{thb(m.before)} → {thb(m.now)}</div>
      </div>
    </div>
  )
}

function BriefingCard({ briefing }) {
  const [showStatus, setShowStatus] = useState(false)
  const [showAllMovers, setShowAllMovers] = useState(false)
  if (!briefing) return null
  const { mtd, daily, platformMovers, productMovers, lowStock, dataStatus, narrative, asOfLabel, rangeLabel, prevRangeLabel, dayCapped } = briefing
  const platTop = showAllMovers ? platformMovers : platformMovers.slice(0, 3)
  const prodTop = showAllMovers ? productMovers : productMovers.slice(0, 3)
  const hasMore = platformMovers.length > 3 || productMovers.length > 3
  return (
    <div style={card}>
      <h3 style={sectionTitle}>สรุปก่อนเริ่มงาน</h3>

      {/* 1. ข้อมูลถึงเมื่อไร */}
      <div style={{ fontSize: 13, color: 'var(--payi-text)', marginBottom: 4 }}>
        ข้อมูลล่าสุด <b>{asOfLabel}</b>{dayCapped && <span style={{ color: '#c2410c' }}> — เทียบได้แค่ {briefing.comparableDays} วันแรก ({prevRangeLabel} มีวันน้อยกว่า)</span>}
      </div>
      <button type="button" onClick={() => setShowStatus((v) => !v)} style={{ fontSize: 11, color: 'var(--payi-text-muted)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', marginBottom: 14 }}>
        {showStatus ? 'ซ่อนรายละเอียดข้อมูล' : 'ข้อมูลอะไรยังขาด / ยังไม่รวม'}
      </button>
      {showStatus && (
        <div style={{ background: 'var(--payi-bg, #f8fafc)', borderRadius: 12, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: 'var(--payi-text)', display: 'grid', gap: 8 }}>
          <div>ข้อมูลถึงวันที่ต่อช่องทาง: {Object.entries(dataStatus.platformLatestDate).map(([p, d]) => `${p} ${d}`).join(' · ')}</div>
          {dataStatus.archivedMonths.length > 0 && <div>เดือนเก่า ({dataStatus.archivedMonths.map((t) => t.slice(11)).join(', ')}) ย้ายไปไฟล์เก็บแยก แต่ยังรวมในยอดทั้งหมดตามปกติ</div>}
          <div style={{ borderTop: '1px solid var(--payi-line, #e5e7eb)', paddingTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>ข้อมูลที่ยังไม่รวมในหน้านี้</div>
            {dataStatus.unconnected.map((u) => (
              <div key={u.source} style={{ marginBottom: 4 }}>
                <b>{u.source}</b> — <span style={{ color: u.state.includes('มีข้อมูลจริง') ? '#c2410c' : 'var(--payi-text-muted)' }}>{u.state}</span>
                <div style={{ color: 'var(--payi-text-muted)' }}>{u.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. ยอดรวมเป็นอย่างไร — เดือนเป็นตัวหลัก วันเป็นตัวรอง */}
      <div style={{ background: 'var(--payi-bg, #f8fafc)', borderRadius: 12, padding: '14px 16px', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>ยอดสะสม {rangeLabel}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--payi-text-strong)', marginTop: 2 }}>{thb(mtd.revenue)}</div>
        {prevRangeLabel && (
          <div style={{ fontSize: 12, color: mtd.deltaPct >= 0 ? '#16a34a' : '#dc2626', marginTop: 4 }}>
            {pct1(mtd.deltaPct)} เทียบ {prevRangeLabel} ({thb(mtd.prevRevenue)})
          </div>
        )}
        {narrative && <div style={{ fontSize: 12, color: 'var(--payi-text)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--payi-line, #e5e7eb)' }}>{narrative}</div>}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--payi-text-muted)', marginBottom: 18 }}>
        <span>{asOfLabel} <b style={{ color: 'var(--payi-text-strong)' }}>{thb(daily.revenue)}</b></span>
        <span>เมื่อวาน <b style={{ color: 'var(--payi-text-strong)' }}>{thb(daily.prevDayRevenue)}</b></span>
      </div>

      {/* 3. อะไรมีส่วนให้ยอดเปลี่ยนมากที่สุด */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 20, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>ช่องทางที่เปลี่ยนมากที่สุด</div>
          {platTop.map((m) => <MoverRow key={m.name} m={m} />)}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>สินค้าที่เปลี่ยนมากที่สุด</div>
          {prodTop.length ? prodTop.map((m) => <MoverRow key={m.name} m={m} />) : <div style={{ fontSize: 12, color: 'var(--payi-text-faint)', padding: '8px 0' }}>ไม่มีข้อมูล</div>}
        </div>
      </div>
      {hasMore && (
        <button type="button" onClick={() => setShowAllMovers((v) => !v)} style={{ fontSize: 12, color: 'var(--payi-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: '6px 0 0' }}>
          {showAllMovers ? 'ย่อรายการ' : 'ดูทั้งหมด'}
        </button>
      )}

      {/* 4. ควรตรวจต่อเรื่องไหน */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginTop: 18 }}>ควรตรวจต่อ</div>
      {lowStock.status === 'unknown' ? (
        <div style={{ fontSize: 13, color: 'var(--payi-text-muted)', marginTop: 6 }}>สต็อก — ยังประเมินไม่ได้ (เชื่อมข้อมูลสต็อกไม่สำเร็จ)</div>
      ) : lowStock.count > 0 ? (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 13, color: '#c2410c', fontWeight: 700 }}>สต็อกเสี่ยงหมด {lowStock.count} รายการ (ข้อมูล ณ {lowStock.asOfDate})</div>
          {lowStock.top.map((it) => (
            <div key={it.sku} style={{ fontSize: 12, color: 'var(--payi-text)', padding: '4px 0' }}>
              {it.display_name} ({it.sku}) — เหลือ {it.balance} {it.unit} {it.recommendedOrder ? `· แนะนำสั่ง ${it.recommendedOrder}` : ''}
            </div>
          ))}
        </div>
      ) : <div style={{ fontSize: 13, color: 'var(--payi-text-muted)', marginTop: 6 }}>สต็อก — ไม่มีรายการเสี่ยงหมด (ข้อมูล ณ {lowStock.asOfDate})</div>}

      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 14 }}>ตัวเลขบอกแค่ว่าอะไรเปลี่ยนมากที่สุด ไม่ได้บอกสาเหตุ — กดดูรายละเอียดต่อได้ที่ "ทางลัด" ด้านบน</div>
    </div>
  )
}

function TargetCard({ target, sales, okr }) {
  const months = sales || []
  const max = Math.max(...months.map((m) => m.revenue), 1) * 1.1
  const runRate = okr?.objective.runRate || 0
  const gap = target.total - runRate
  return (
    <div style={card}>
      <h3 style={sectionTitle}>เป้าทั้งปี {target.year}: {mb(target.total)} บาท</h3>
      <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['เป้าทั้งปี', mb(target.total), 'var(--payi-text-strong)'],
          ['ถ้าขายเท่าตอนนี้ทั้งปี', `≈ ${mb(runRate)}`, 'var(--payi-text-strong)'],
          ['ยังขาด', gap > 0 ? `≈ ${mb(gap)} (${Math.round((gap / target.total) * 100)}%)` : 'ถึงเป้าแล้ว', gap > 0 ? '#c2410c' : '#16a34a'],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: 'var(--payi-bg, #f8fafc)', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 8 }}>ยอดจริงรายเดือนปี 2026</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, padding: '0 4px', borderBottom: '1px solid var(--payi-line, #e5e7eb)' }}>
        {months.map((m) => (
          <div key={m.month} title={`${m.month}: ${thb(m.revenue)}`} style={{ flex: 1, minWidth: 0, height: `${(m.revenue / max) * 100}%`, background: 'linear-gradient(180deg, rgba(85,102,230,0.9), rgba(85,102,230,0.55))', borderRadius: '6px 6px 0 0' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '6px 4px 0' }}>
        {months.map((m) => <div key={m.month} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, color: 'var(--payi-text-muted)' }}>{m.month.slice(5)}/{m.month.slice(2, 4)}<br />{mb(m.revenue)}</div>)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 10 }}>เป้าเป็นรายปี ไม่ได้แบ่งรายเดือน · "ถ้าขายเท่าตอนนี้ทั้งปี" = ยอดเฉลี่ย 3 เดือนล่าสุด × 12 (ไม่นับยกเลิก สูตรเดียวกับ Dashboard) · เห็นเฉพาะ CEO และหัวหน้าฝ่าย</div>
    </div>
  )
}

const STATUS = {
  on: { label: 'ถึงเป้า', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  risk: { label: 'ใกล้เป้า', color: '#c2410c', bg: 'rgba(234,88,12,0.1)' },
  off: { label: 'ห่างเป้า', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
}

function KrRow({ kr }) {
  const st = STATUS[kr.status]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,1.2fr) minmax(120px,2fr) auto', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--payi-line, #eef2f7)' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{kr.name}</div>
        <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>สัดส่วนยอดปีนี้ {Math.round(kr.share * 100)}%</div>
      </div>
      <div>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--payi-bg, #f1f5f9)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, kr.pct * 100)}%`, height: '100%', background: st.color, borderRadius: 999 }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 4 }}>
          ถ้าขายเท่าตอนนี้ทั้งปี ≈ {mb(kr.runRate)} · เป้า {mb(kr.target)}{kr.growthNeeded != null && kr.growthNeeded > 0 ? ` · ต้องโต ${Math.round(kr.growthNeeded * 100)}%` : ''}
        </div>
      </div>
      <span style={{ ...chip(st.bg, st.color) }}>{Math.round(kr.pct * 100)}% {st.label}</span>
    </div>
  )
}

function OkrCard({ okr }) {
  const o = okr.objective
  const st = STATUS[o.status]
  return (
    <div style={card}>
      <h3 style={sectionTitle}>แตกเป้า (OKR)</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: st.bg }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>เป้าหมายบริษัท</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{o.title}</div>
        </div>
        <span style={chip('#fff', st.color)}>{Math.round(o.pct * 100)}% {st.label}</span>
      </div>
      {[['แยกตามช่องทาง', okr.platforms], ['แยกตามร้าน', okr.businesses]].map(([title, list]) => (
        <div key={title} style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 2 }}>{title}</div>
          {list.map((kr) => <KrRow key={kr.name} kr={kr} />)}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 12 }}>
        เป้าย่อยตั้งต้น = แบ่ง 150 ล้านตามสัดส่วนยอดจริงปี 2026 · ความคืบหน้า = ยอดเฉลี่ย {o.basis.join(', ')} คิดทั้งปี เทียบเป้าปี · ≥90% ถึงเป้า, 60–90% ใกล้เป้า, ต่ำกว่า 60% ห่างเป้า (ปี 2027 ยังไม่เริ่ม — วัดจากยอดปัจจุบัน) · ยังไม่ได้กำหนดคนรับผิดชอบรายช่องทาง (Platform = รอ 3)
      </div>
    </div>
  )
}

export default function Workspace({ onOpenTab }) {
  const [as, setAs] = useState('dev')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setError('')
    fetch(`/api/sheet-tools?op=workspace&as=${encodeURIComponent(as)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.success) setData(d); else setError(d.error || 'โหลดไม่สำเร็จ') })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [as, reloadKey])

  if (error) return <div style={{ ...card, color: 'var(--payi-danger)' }}>{error}</div>
  if (!data) return <div style={{ padding: 40, color: 'var(--payi-text-muted)' }}>กำลังโหลด...</div>
  const { me, people, departments, pending, target, sales, okr, tracker, briefing } = data
  const mine = tracker.filter((t) => t.owners.includes(me.key))
  const reload = () => setReloadKey((k) => k + 1)

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
        {mine.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {mine.map((b) => <BoardCard key={b.no} item={b} asKey={me.key} onSaved={reload} />)}
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

      {briefing && <BriefingCard briefing={briefing} />}

      {tracker.length > mine.length && <TrackerCard tracker={tracker} />}

      {target && <TargetCard target={target} sales={sales} okr={okr} />}
      {okr && <OkrCard okr={okr} />}

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
