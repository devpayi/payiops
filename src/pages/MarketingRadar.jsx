import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock3, Film, Loader2, Megaphone,
  PackagePlus, Pencil, RefreshCw, Search, Send, Sparkles, Trash2, TrendingUp, X,
} from 'lucide-react'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtBaht = (n) => '฿' + fmt(n)
const todayIso = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const EVENT_TYPES = [
  ['image_change', 'แก้รูปสินค้า'],
  ['new_product', 'ลงสินค้าใหม่'],
  ['package_change', 'ปรับแพ็คเกจ'],
  ['video_posted', 'ลงคลิป'],
  ['content_push', 'ดันคอนเทนต์'],
  ['boss_sent', 'ส่งให้บอสแล้ว'],
]

const COLUMNS = [
  { id: 'waiting', title: 'Waiting', icon: Clock3, tone: '#d97706' },
  { id: 'live', title: 'Live', icon: CheckCircle2, tone: '#20b8a6' },
  { id: 'check7', title: '7-Day Check', icon: TrendingUp, tone: '#2f5fd0' },
  { id: 'check30', title: '30-Day Check', icon: RefreshCw, tone: '#7c3aed' },
  { id: 'content', title: 'Push Content', icon: Megaphone, tone: '#db2777' },
]

const BUSINESSES = ['all', 'Payi', 'กรอบรูป']
const PLATFORMS = ['all', 'Shopee', 'TikTok Shop', 'Lazada']

// ความคืบหน้าตาม stage ของงาน (pipeline) — ใช้ทำ progress bar แบบ Notion
const STAGE_PCT = { waiting: 10, live: 40, check7: 65, check30: 85, content: 95, done: 100 }
const stageColor = (status) => (COLUMNS.find((c) => c.id === status)?.tone) || (status === 'done' ? '#16a34a' : 'var(--payi-mint)')

export default function MarketingRadar() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(null)
  const [view, setView] = useState('board')      // board | list
  const [typeFilter, setTypeFilter] = useState('all') // กรองตามประเภทงาน

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    fetch('/api/marketing')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error(d.error || 'โหลดข้อมูลไม่สำเร็จ')
        const dueCount = Number(d.dueReviewCount || 0)
        localStorage.setItem('payi-marketing-due-count', String(dueCount))
        window.dispatchEvent(new CustomEvent('payi-marketing-due', { detail: dueCount }))
        if (d.productOptions?.length) {
          setData(d)
          return
        }
        return fetch('/api/products')
          .then((r) => r.json())
          .then((products) => {
            const fallbackOptions = (products.groups || []).map((item) => ({
              product_key: item.key,
              master_sku: '',
              display_name: item.label || item.key,
              revenue: item.revenue || 0,
              units: item.units || 0,
              skuCount: item.skuCount || item.members?.length || 0,
            }))
            setData({ ...d, productOptions: fallbackOptions })
          })
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // Existing pages in this app load server data this way; keep this page aligned.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const events = useMemo(() => data?.events || [], [data])
  const radar = useMemo(() => data?.radar || {}, [data])
  const signals = useMemo(() => data?.productSignals || [], [data])
  const signalWindow = data?.signalWindow
  const reviewQueue = useMemo(() => events.filter((event) => event.needs_review), [events])

  // กรองตามประเภทงาน — ใช้ทั้งบอร์ดและรายการ
  const radarFiltered = useMemo(() => {
    if (typeFilter === 'all') return radar
    const out = {}
    for (const k of Object.keys(radar)) out[k] = (radar[k] || []).filter((e) => e.event_type === typeFilter)
    return out
  }, [radar, typeFilter])
  const listEvents = useMemo(
    () => events.filter((e) => typeFilter === 'all' || e.event_type === typeFilter),
    [events, typeFilter]
  )

  const filteredSignals = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return signals
    return signals.filter((item) =>
      String(item.display_name || '').toLowerCase().includes(q) ||
      String(item.master_sku || '').toLowerCase().includes(q)
    )
  }, [signals, query])

  const updateEvent = async (eventId, patch) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/marketing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, ...patch }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const createEvent = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setDraft(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // บันทึก: มี event_id = แก้ไข (PATCH) ไม่งั้น = สร้างใหม่ (POST)
  const saveEvent = async (payload) => {
    if (payload.event_id) {
      await updateEvent(payload.event_id, {
        event_type: payload.event_type,
        event_date: payload.event_date,
        platform: payload.platform,
        business: payload.business,
        note: payload.note,
      })
      setDraft(null)
    } else {
      await createEvent(payload)
    }
  }

  const deleteEvent = async (eventId) => {
    if (!window.confirm('ลบเหตุการณ์นี้?')) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/marketing?event_id=${encodeURIComponent(eventId)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'ลบไม่สำเร็จ')
      if (draft?.event_id === eventId) setDraft(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (event) => setDraft({
    event_id: event.event_id,
    product_key: event.product_key,
    master_sku: event.master_sku,
    display_name: event.display_name,
    business: event.business || 'all',
    platform: event.platform || 'all',
    event_type: event.event_type || 'image_change',
    event_date: event.event_date || todayIso(),
    status: event.status,
    confirmed_at: event.confirmed_at || '',
    note: event.note || '',
  })

  const onDropStatus = (status, event) => {
    const eventId = event.dataTransfer.getData('event_id')
    if (eventId) updateEvent(eventId, { status })
  }

  const decideEvent = (event, decision, note = '') => updateEvent(event.event_id, {
    review_day: event.due_review_day,
    decision,
    decision_note: note,
  })

  if (loading && !data) return <Center><Loader2 size={18} className="payi-spin" /> กำลังโหลดเรดาร์การตลาด...</Center>

  return (
    <div className="marketing-radar-page" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 16 }}>
        <section className="marketing-hero-card" style={{ background: 'var(--payi-surface-dark)', color: '#fff', borderRadius: 8, padding: 22, minHeight: 168, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', fontWeight: 700, marginBottom: 8 }}>MARKETING CHANGE TRACKER</div>
              <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.12, letterSpacing: 0 }}>Marketing Radar</h2>
              <p style={{ margin: '10px 0 0', maxWidth: 640, color: 'rgba(255,255,255,0.76)', fontSize: 13, lineHeight: 1.7 }}>
                ตูนบันทึกสิ่งที่เปลี่ยน ระบบเทียบจำนวนชิ้นต่อวัน และส่งเฉพาะงานที่ถึงเวลาตัดสินใจให้ Boss
              </p>
            </div>
            <button onClick={load} disabled={saving} title="Sync sales" style={iconButton('#fff', 'rgba(255,255,255,0.14)')}>
              <RefreshCw size={17} className={saving ? 'payi-spin' : ''} />
            </button>
          </div>
          <div className="app-kpi-grid marketing-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 24 }}>
            <Metric label="ต้องตัดสินใจ" value={reviewQueue.length} />
            <Metric label="กำลังวัดผล" value={(radar.live?.length || 0) + (radar.content?.length || 0)} />
            <Metric label="รอยืนยัน" value={radar.waiting?.length || 0} />
            <Metric label="ข้อมูลถึง" value={data?.dataThrough?.slice(5) || '-'} compact />
          </div>
        </section>

        <section className="payi-glass-card marketing-capture-card" style={{ padding: 18, borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PackagePlus size={17} color="var(--payi-mint)" />
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>
                {draft?.event_id ? 'แก้ไขงาน' : 'บันทึกสิ่งที่เปลี่ยน'}
              </div>
            </div>
            {draft?.event_id && (
              <button onClick={() => setDraft(null)} title="ยกเลิกแก้ไข" style={cardIconBtn}><X size={13} /> ยกเลิก</button>
            )}
          </div>
          <QuickCapture draft={draft} setDraft={setDraft} onSave={saveEvent} saving={saving} productOptions={data?.productOptions || []} />
        </section>
      </div>

      {error && (
        <div style={{ padding: '10px 12px', background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', border: '1px solid var(--payi-danger)', borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      <DecisionQueue events={reviewQueue} onDecide={decideEvent} saving={saving} dataThrough={data?.dataThrough} />

      {/* Toolbar: สลับมุมมอง + กรองประเภทงาน (แบบ Notion) */}
      <div className="marketing-view-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--payi-surface-muted)', padding: 3, borderRadius: 9 }}>
          {[['board', 'บอร์ด'], ['list', 'รายการ'], ['basket', 'จัดคู่สินค้า']].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={segStyle(view === id)}>{label}</button>
          ))}
        </div>
        {view !== 'basket' && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--payi-border)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text-muted)' }}>ประเภทงาน:</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button onClick={() => setTypeFilter('all')} style={typePill(typeFilter === 'all')}>ทั้งหมด</button>
              {EVENT_TYPES.map(([id, label]) => (
                <button key={id} onClick={() => setTypeFilter(id)} style={typePill(typeFilter === id)}>{label}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {view === 'basket' ? (
        <BasketAnalysis />
      ) : (
      <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, alignItems: 'start' }}>
        {view === 'board' ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(160px, 1fr))', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {COLUMNS.map((column) => (
              <RadarColumn
                key={column.id}
                column={column}
                items={radarFiltered[column.id] || []}
                onDropStatus={onDropStatus}
                updateEvent={updateEvent}
                onEdit={startEdit}
                onDelete={deleteEvent}
              />
            ))}
          </section>
        ) : (
          <ListView events={listEvents} updateEvent={updateEvent} onEdit={startEdit} onDelete={deleteEvent} />
        )}

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="payi-glass-card marketing-signal-panel" style={{ padding: 14, borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>Products to Push</div>
              <Film size={16} color="var(--payi-text-muted)" />
            </div>
            {signalWindow && (
              <div style={{ fontSize: 10.5, color: 'var(--payi-text-muted)', marginBottom: 10 }}>
                Last 7 data days · {signalWindow.start} – {signalWindow.end}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              <Search size={15} color="var(--payi-text-muted)" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา SKU / สินค้า" style={{ minWidth: 0, flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
              {filteredSignals.slice(0, 12).map((item) => (
                <SignalItem key={item.product_key} item={item} onTrack={() => setDraft({
                  product_key: item.product_key,
                  master_sku: item.master_sku,
                  display_name: item.display_name,
                  business: 'all',
                  platform: 'all',
                  event_type: 'content_push',
                  event_date: todayIso(),
                  status: 'live',
                  confirmed_at: todayIso(),
                })} />
              ))}
              {!filteredSignals.length && <EmptyLine text="ยังไม่มีสัญญาณสินค้า รอข้อมูลยอดขายหลังนำเข้าออเดอร์" />}
            </div>
          </div>

        </aside>
      </div>
      )}

      {view !== 'basket' && (
      <section className="payi-glass-card marketing-history-card" style={{ padding: 16, borderRadius: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)', marginBottom: 12 }}>Event History</div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gap: 8, minWidth: 560 }}>
            {events.slice(0, 30).map((event) => <TimelineRow key={event.event_id} event={event} onEdit={startEdit} onDelete={deleteEvent} />)}
            {!events.length && <EmptyLine text="ยังไม่มีเหตุการณ์การตลาด เริ่มจากจดสินค้าใหม่ แก้รูป หรือลงคลิปได้เลย" />}
          </div>
        </div>
      </section>
      )}
    </div>
  )
}

function DecisionQueue({ events, onDecide, saving, dataThrough }) {
  return (
    <section className="payi-glass-card marketing-review-shell" aria-labelledby="marketing-review-title" style={{ padding: 16, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: events.length ? 12 : 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={17} color="var(--payi-warning)" aria-hidden="true" />
            <h3 id="marketing-review-title" style={{ margin: 0, fontSize: 16, color: 'var(--payi-text-strong)' }}>
              งานที่ Boss ต้องตัดสินใจ
            </h3>
          </div>
          <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--payi-text-muted)' }}>
            ระบบเรียงงานครบกำหนดให้ก่อน · ใช้จำนวนชิ้นเฉลี่ยต่อวัน · ข้อมูลถึง {dataThrough || '-'}
          </p>
        </div>
        <span style={{
          minWidth: 28,
          height: 28,
          padding: '0 8px',
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          background: events.length ? 'var(--payi-warning-bg)' : 'var(--payi-mint-soft)',
          color: events.length ? 'var(--payi-warning)' : 'var(--payi-mint-strong)',
          fontSize: 12,
          fontWeight: 900,
          fontVariantNumeric: 'tabular-nums',
        }}>{events.length}</span>
      </div>
      {events.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {events.map((event) => (
            <DecisionCard key={event.event_id} event={event} onDecide={onDecide} saving={saving} />
          ))}
        </div>
      ) : (
        <div style={{ padding: '18px 14px', borderRadius: 8, background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)', fontSize: 13, fontWeight: 700 }}>
          ไม่มีงานค้างตัดสินใจ ตอนนี้ทีมทำงานต่อได้เลย
        </div>
      )}
    </section>
  )
}

function DecisionCard({ event, onDecide, saving }) {
  const [note, setNote] = useState('')
  const recommendation = event.recommendation
  const reviewDay = event.due_review_day || 7
  const after = reviewDay === 30 ? event.snapshot?.after30 : event.snapshot?.after7
  const recommendationTone = recommendation?.code === 'scale'
    ? 'var(--payi-success)'
    : recommendation?.code === 'stop'
      ? 'var(--payi-danger)'
      : 'var(--payi-warning)'

  return (
    <article className="marketing-decision-card" style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1fr) minmax(230px, 1.15fr) minmax(250px, 1fr)',
      gap: 12,
      alignItems: 'center',
      padding: 12,
      border: '1px solid var(--payi-border)',
      borderRadius: 10,
      background: 'var(--payi-surface)',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 6px 18px rgba(15,23,42,0.04)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ padding: '3px 7px', borderRadius: 6, background: 'var(--payi-warning-bg)', color: 'var(--payi-warning)', fontSize: 10, fontWeight: 900 }}>
            REVIEW {reviewDay} วัน
          </span>
          <span style={{ fontSize: 10, color: 'var(--payi-text-muted)' }}>{event.event_label}</span>
        </div>
        <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.4, fontWeight: 900, color: 'var(--payi-text-strong)' }}>
          {event.display_name || event.master_sku || event.product_key}
        </div>
        <div style={{ marginTop: 3, fontSize: 10, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>
          {event.master_sku || event.product_key}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
          <Tiny label="ก่อนเปลี่ยน" value={`${fmt(event.snapshot?.before7?.units)} ชิ้น`} />
          <span aria-hidden="true" style={{ color: 'var(--payi-text-faint)', fontWeight: 900 }}>→</span>
          <Tiny label={`หลัง ${reviewDay} วัน`} value={`${fmt(after?.units)} ชิ้น`} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: recommendationTone, fontWeight: 800 }}>
          ระบบแนะนำ: {recommendation?.label || 'รอข้อมูล'}
        </div>
        <div style={{ marginTop: 2, fontSize: 11, lineHeight: 1.45, color: 'var(--payi-text-muted)' }}>
          {recommendation?.reason}
        </div>
        {recommendation?.confidence === 'low' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 10.5, color: 'var(--payi-warning)', fontWeight: 800 }}>
            <AlertTriangle size={13} aria-hidden="true" /> ความมั่นใจต่ำ · Boss ต้องรีเช็ก
          </div>
        )}
      </div>

      <div>
        <label style={fieldLabelStyle}>หมายเหตุของ Boss (ไม่บังคับ)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลสั้น ๆ"
            style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
          <DecisionButton label="ทำต่อ" tone="success" disabled={saving} onClick={() => onDecide(event, 'scale', note)} />
          <DecisionButton label="ปรับใหม่" tone="warning" disabled={saving} onClick={() => onDecide(event, 'iterate', note)} />
          <DecisionButton label="หยุด" tone="danger" disabled={saving} onClick={() => onDecide(event, 'stop', note)} />
        </div>
      </div>
    </article>
  )
}

function DecisionButton({ label, tone, disabled, onClick }) {
  const colors = {
    success: ['var(--payi-mint-soft)', 'var(--payi-success)'],
    warning: ['var(--payi-warning-bg)', 'var(--payi-warning)'],
    danger: ['var(--payi-danger-bg)', 'var(--payi-danger)'],
  }
  const [background, color] = colors[tone]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 44,
        border: `1px solid ${color}`,
        borderRadius: 8,
        background,
        color,
        fontSize: 11,
        fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  )
}

function RadarColumn({ column, items, onDropStatus, updateEvent, onEdit, onDelete }) {
  const Icon = column.icon
  return (
    <div
      className="marketing-radar-column"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropStatus(column.id, event)}
      style={{ minWidth: 170, background: 'rgba(255,255,255,0.55)', border: '1px solid var(--payi-border)', borderRadius: 8, padding: 10, minHeight: 360 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon size={15} color={column.tone} />
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{column.title}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: column.tone, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 6, padding: '2px 6px' }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((event) => <EventCard key={event.event_id} event={event} updateEvent={updateEvent} onEdit={onEdit} onDelete={onDelete} />)}
        {!items.length && <EmptyLine text="Drop cards here" compact />}
      </div>
    </div>
  )
}

function EventCard({ event, updateEvent, onEdit, onDelete }) {
  const lift = event.snapshot?.lift7
  return (
    <article
      className="marketing-event-card"
      draggable
      onDragStart={(dragEvent) => dragEvent.dataTransfer.setData('event_id', event.event_id)}
      style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 8, padding: 10, boxShadow: '0 8px 22px rgba(15,23,42,0.05)', cursor: 'grab' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--payi-text-strong)', lineHeight: 1.35 }}>{event.display_name || event.master_sku || event.product_key}</div>
          <div style={{ fontSize: 10, color: 'var(--payi-text-muted)', marginTop: 3, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.master_sku || event.product_key}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--payi-mint-strong)', background: 'var(--payi-mint-soft)', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }}>{event.event_label}</span>
      </div>
      <ProgressBar status={event.status} label={event.status_label} style={{ marginTop: 10 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
        <Tiny label="ก่อน 7 วัน" value={`${fmt(event.snapshot?.before7?.units)} ชิ้น`} />
        <Tiny label="หลัง 7 วัน" value={`${fmt(event.snapshot?.after7?.units)} ชิ้น`} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 9 }}>
        <span style={{ fontSize: 11, color: lift == null ? 'var(--payi-text-muted)' : lift >= 0 ? 'var(--payi-success)' : 'var(--payi-danger)', fontWeight: 800 }}>
          {lift == null ? 'ยังไม่มีฐานเทียบ' : `${lift >= 0 ? '+' : ''}${lift}% จำนวนชิ้น`}
        </span>
        {!event.confirmed_at ? (
          <button onClick={() => updateEvent(event.event_id, { status: 'live', confirmed_at: todayIso() })} title="ยืนยันว่าขึ้นร้านแล้ว" style={smallActionStyle}>
            <CheckCircle2 size={13} /> ขึ้นแล้ว
          </button>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--payi-text-faint)' }}>ขึ้นแล้ว {event.snapshot?.daysLive ?? 0} วัน</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--payi-border)' }}>
        <button onClick={() => onEdit(event)} title="แก้ไข" style={cardIconBtn}><Pencil size={12} /></button>
        {event.status !== 'done' && (
          <button onClick={() => updateEvent(event.event_id, { status: 'done' })} title="ทำเสร็จ (เอาออกจากบอร์ด)" style={cardIconBtn}><CheckCircle2 size={12} /> เสร็จ</button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => onDelete(event.event_id)} title="ลบ" style={{ ...cardIconBtn, color: 'var(--payi-danger)' }}><Trash2 size={12} /></button>
      </div>
    </article>
  )
}

function ProgressBar({ status, label, style }) {
  const pct = STAGE_PCT[status] ?? 0
  return (
    <div style={style}>
      {label !== false && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--payi-text-muted)', marginBottom: 3 }}>
          <span>{label || status}</span><span style={{ fontWeight: 700 }}>{pct}%</span>
        </div>
      )}
      <div style={{ height: 5, borderRadius: 999, background: 'var(--payi-surface-muted)', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: stageColor(status), borderRadius: 999 }} />
      </div>
    </div>
  )
}

// มุมมองรายการ (Notion database style)
function ListView({ events, updateEvent, onEdit, onDelete }) {
  if (!events.length) return <div className="payi-glass-card" style={{ padding: 30, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>ยังไม่มีงาน — เพิ่มจาก Quick Capture ด้านขวา</div>
  return (
    <div className="payi-glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
          <thead>
            <tr style={{ color: 'var(--payi-text-muted)', fontSize: 11, textAlign: 'left' }}>
              <th style={lTh}>งาน</th><th style={lTh}>ประเภท</th><th style={lTh}>สถานะ</th>
              <th style={{ ...lTh, width: 150 }}>ความคืบหน้า</th>
              <th style={{ ...lTh, textAlign: 'right' }}>lift 7 วัน</th>
              <th style={{ ...lTh, textAlign: 'right' }}>วันที่</th><th style={lTh} />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const lift = e.snapshot?.lift7
              return (
                <tr key={e.event_id} style={{ borderTop: '1px solid var(--payi-border)' }}>
                  <td style={lTd}>
                    <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{e.display_name || e.master_sku || e.product_key}</div>
                    <div style={{ fontSize: 10, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{e.master_sku || e.product_key}</div>
                  </td>
                  <td style={lTd}><span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--payi-mint-strong)', background: 'var(--payi-mint-soft)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{e.event_label}</span></td>
                  <td style={{ ...lTd, whiteSpace: 'nowrap' }}>{e.status_label}</td>
                  <td style={lTd}><ProgressBar status={e.status} label={false} /></td>
                  <td style={{ ...lTd, textAlign: 'right', fontWeight: 800, color: lift == null ? 'var(--payi-text-muted)' : lift >= 0 ? 'var(--payi-success)' : 'var(--payi-danger)' }}>{lift == null ? '-' : `${lift >= 0 ? '+' : ''}${lift}%`}</td>
                  <td style={{ ...lTd, textAlign: 'right', color: 'var(--payi-text-muted)', whiteSpace: 'nowrap' }}>{e.event_date}</td>
                  <td style={{ ...lTd, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {e.status !== 'done' && <button onClick={() => updateEvent(e.event_id, { status: 'done' })} title="ทำเสร็จ" style={cardIconBtn}><CheckCircle2 size={12} /></button>}
                    <button onClick={() => onEdit(e)} title="แก้ไข" style={{ ...cardIconBtn, marginLeft: 4 }}><Pencil size={12} /></button>
                    <button onClick={() => onDelete(e.event_id)} title="ลบ" style={{ ...cardIconBtn, marginLeft: 4, color: 'var(--payi-danger)' }}><Trash2 size={12} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SignalItem({ item, onTrack }) {
  const lift = item.lift7
  return (
    <div className="marketing-signal-item" style={{ border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.display_name}</div>
          <div style={{ fontSize: 10, color: 'var(--payi-text-muted)', fontFamily: 'monospace' }}>{item.master_sku || item.product_key}</div>
        </div>
        <button onClick={onTrack} title="จดเป็นงานดันคอนเทนต์" style={iconButton('var(--payi-mint-strong)', 'var(--payi-mint-soft)')}>
          <Send size={14} />
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11 }}>
        <span style={{ color: 'var(--payi-text-muted)' }}>{fmt(item.units7)} ชิ้นใน 7 วัน</span>
        <span style={{ color: lift == null ? 'var(--payi-text-faint)' : lift >= 0 ? 'var(--payi-success)' : 'var(--payi-danger)', fontWeight: 800 }}>{lift == null ? 'ใหม่' : `${lift >= 0 ? '+' : ''}${lift}%`}</span>
      </div>
    </div>
  )
}

function QuickCapture({ draft, setDraft, onSave, saving, productOptions = [] }) {
  const [productOpen, setProductOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const isEditing = Boolean(draft?.event_id)
  const value = draft || {
    product_key: '',
    master_sku: '',
    display_name: '',
    business: 'all',
    platform: 'all',
    event_type: 'image_change',
    event_date: todayIso(),
    status: 'live',
    confirmed_at: todayIso(),
    note: '',
  }
  const set = (patch) => setDraft({ ...value, ...patch })
  const productValue = value.master_sku || value.display_name || value.product_key
  const productQuery = productValue.trim().toLowerCase()
  const productChoices = productOptions
    .filter((item) => item.product_key || item.master_sku || item.display_name)
    .filter((item) => {
      if (!productQuery) return true
      return [item.display_name, item.master_sku, item.product_key]
        .some((part) => String(part || '').toLowerCase().includes(productQuery))
    })
    .slice(0, 80)
  const pickProduct = (picked) => {
    set({
      display_name: picked.display_name || picked.master_sku || picked.product_key,
      master_sku: picked.master_sku || '',
      product_key: picked.product_key || picked.master_sku || picked.display_name,
    })
    setProductOpen(false)
  }
  const setProduct = (raw) => {
    set({
      display_name: raw,
      master_sku: raw,
      product_key: raw,
    })
    setProductOpen(true)
  }
  const platformOptions = value.business === 'Payi' ? [...PLATFORMS, 'Payi Outlet'] : PLATFORMS
  const canSave = value.product_key || value.master_sku

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <label style={fieldLabelStyle}>1. สินค้า</label>
        <input
          value={productValue}
          onChange={(e) => setProduct(e.target.value)}
          onFocus={() => !isEditing && setProductOpen(true)}
          onBlur={() => window.setTimeout(() => setProductOpen(false), 140)}
          placeholder="ค้นหาสินค้า / SKU"
          readOnly={isEditing}
          title={isEditing ? 'แก้ไขสินค้าไม่ได้ (ลบแล้วสร้างใหม่ถ้าต้องเปลี่ยน)' : undefined}
          style={{ ...inputStyle, ...(isEditing ? { background: 'var(--payi-surface-muted)', color: 'var(--payi-text-muted)' } : null) }}
        />
        {productOpen && !isEditing && (
          <div style={dropdownStyle}>
            {productChoices.slice(0, 8).map((item) => (
              <button key={item.product_key || item.master_sku || item.display_name} type="button" onMouseDown={() => pickProduct(item)} style={dropdownItemStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.display_name || item.master_sku || item.product_key}</span>
                <span style={{ fontSize: 10, color: 'var(--payi-text-muted)', fontFamily: 'monospace' }}>
                  {item.skuCount ? `รวม ${item.skuCount} SKU` : (item.master_sku || item.product_key)}
                </span>
              </button>
            ))}
            {!productChoices.length && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--payi-text-muted)' }}>
                ไม่พบสินค้าเดิม กดบันทึกเพื่อใช้เป็นสินค้าใหม่ได้
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={fieldLabelStyle}>2. สิ่งที่เปลี่ยน
          <select value={value.event_type} onChange={(e) => set({ event_type: e.target.value })} style={{ ...inputStyle, marginTop: 4 }}>
            {EVENT_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label style={fieldLabelStyle}>3. วันที่ขึ้นจริง
          <input
            type="date"
            max={todayIso()}
            value={value.event_date}
            onChange={(e) => set({ event_date: e.target.value, confirmed_at: e.target.value, status: 'live' })}
            style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
      </div>
      <button type="button" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen} style={advancedToggleStyle}>
        รายละเอียดเพิ่มเติม (ไม่บังคับ)
        <ChevronDown size={14} style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none' }} />
      </button>
      {advancedOpen && (
        <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, background: 'var(--payi-surface-muted)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={fieldLabelStyle}>ธุรกิจ
              <select
                value={value.business}
                onChange={(e) => set({
                  business: e.target.value,
                  platform: e.target.value === 'Payi' ? value.platform : (value.platform === 'Payi Outlet' ? 'all' : value.platform),
                })}
                style={{ ...inputStyle, marginTop: 4 }}
              >
                {BUSINESSES.map((item) => <option key={item} value={item}>{optionLabel(item)}</option>)}
              </select>
            </label>
            <label style={fieldLabelStyle}>ช่องทาง
              <select value={value.platform} onChange={(e) => set({ platform: e.target.value })} style={{ ...inputStyle, marginTop: 4 }}>
                {platformOptions.map((item) => <option key={item} value={item}>{optionLabel(item)}</option>)}
              </select>
            </label>
          </div>
          <label style={fieldLabelStyle}>หมายเหตุ
            <textarea value={value.note} onChange={(e) => set({ note: e.target.value })} placeholder="ใส่เมื่อมีบริบทที่ Boss ควรรู้" rows={2} style={{ ...inputStyle, marginTop: 4, resize: 'vertical' }} />
          </label>
        </div>
      )}
      <button className="marketing-primary-btn" disabled={!canSave || saving} onClick={() => onSave(value)} style={{ ...primaryBtnStyle, opacity: !canSave || saving ? 0.55 : 1 }}>
        {saving ? <Loader2 size={15} className="payi-spin" /> : <PackagePlus size={15} />} {isEditing ? 'อัปเดตงาน' : 'เริ่มวัดผล'}
      </button>
    </div>
  )
}

function TimelineRow({ event, onEdit, onDelete }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 110px 80px 78px', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--payi-border)', fontSize: 12 }}>
      <div style={{ color: 'var(--payi-text-muted)', fontWeight: 700 }}>{event.event_date}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.display_name || event.master_sku || event.product_key}</div>
        <div style={{ color: 'var(--payi-text-muted)', fontFamily: 'monospace', fontSize: 10 }}>{event.event_label} · {optionLabel(event.platform || 'all')}{event.status === 'done' ? ' · เสร็จ' : ''}</div>
      </div>
      <div style={{ color: 'var(--payi-text)' }}>{event.confirmed_at || 'ยังไม่ยืนยัน'}</div>
      <div style={{ textAlign: 'right', fontWeight: 800, color: (event.snapshot?.lift7 ?? 0) >= 0 ? 'var(--payi-success)' : 'var(--payi-danger)' }}>
        {event.snapshot?.lift7 == null ? '-' : `${event.snapshot.lift7 >= 0 ? '+' : ''}${event.snapshot.lift7}%`}
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button onClick={() => onEdit(event)} title="แก้ไข" style={cardIconBtn}><Pencil size={12} /></button>
        <button onClick={() => onDelete(event.event_id)} title="ลบ" style={{ ...cardIconBtn, color: 'var(--payi-danger)' }}><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

function Metric({ label, value, compact }) {
  return (
    <div className="marketing-hero-metric" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.64)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: compact ? 16 : 22, fontWeight: 900, marginTop: compact ? 7 : 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function Tiny({ label, value }) {
  return (
    <div className="marketing-tiny-metric" style={{ border: '1px solid var(--payi-border)', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: 7 }}>
      <div style={{ fontSize: 9, color: 'var(--payi-text-muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--payi-text-strong)', fontWeight: 900, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function EmptyLine({ text, compact }) {
  return <div style={{ padding: compact ? 10 : 14, fontSize: 12, color: 'var(--payi-text-faint)', textAlign: 'center', border: '1px dashed var(--payi-border)', borderRadius: 8 }}>{text}</div>
}

function Center({ children }) {
  return <div style={{ height: '52vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--payi-text-muted)', fontSize: 14 }}>{children}</div>
}

function optionLabel(value) {
  if (value === 'all') return 'ทั้งหมด'
  if (value === 'Payi Outlet') return 'Outlet'
  return value
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--payi-border)',
  background: 'var(--payi-surface)',
  borderRadius: 8,
  padding: '9px 10px',
  fontSize: 12,
  color: 'var(--payi-text-strong)',
  outline: 'none',
}

const fieldLabelStyle = {
  display: 'block',
  fontSize: 11,
  lineHeight: 1.35,
  fontWeight: 800,
  color: 'var(--payi-text-muted)',
}

const advancedToggleStyle = {
  minHeight: 36,
  padding: '6px 8px',
  border: 0,
  background: 'transparent',
  color: 'var(--payi-text-muted)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const dropdownStyle = {
  position: 'absolute',
  zIndex: 30,
  left: 0,
  right: 0,
  top: 'calc(100% + 4px)',
  maxHeight: 260,
  overflowY: 'auto',
  background: 'var(--payi-surface)',
  border: '1px solid var(--payi-border)',
  borderRadius: 8,
  boxShadow: '0 18px 42px rgba(15,23,42,0.12)',
}

const dropdownItemStyle = {
  width: '100%',
  border: 'none',
  borderBottom: '1px solid var(--payi-border)',
  background: 'transparent',
  padding: '9px 11px',
  display: 'grid',
  gap: 2,
  textAlign: 'left',
  cursor: 'pointer',
}

const primaryBtnStyle = {
  border: 'none',
  borderRadius: 10,
  background: 'var(--payi-gradient-primary)',
  boxShadow: '0 8px 18px rgba(37,99,235,0.22)',
  color: '#fff',
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
}

const smallActionStyle = {
  border: '1px solid var(--payi-border)',
  background: 'var(--payi-mint-soft)',
  color: 'var(--payi-mint-strong)',
  borderRadius: 7,
  padding: '4px 7px',
  fontSize: 10,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
}

const cardIconBtn = {
  border: '1px solid var(--payi-border)',
  background: 'var(--payi-surface)',
  color: 'var(--payi-text-muted)',
  borderRadius: 7,
  padding: '4px 7px',
  fontSize: 10,
  fontWeight: 800,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  cursor: 'pointer',
}

function segStyle(active) {
  return {
    padding: '6px 16px', fontSize: 12.5, fontWeight: active ? 800 : 600, border: 'none', borderRadius: 7, cursor: 'pointer',
    background: active ? 'var(--payi-surface)' : 'transparent', color: active ? 'var(--payi-text-strong)' : 'var(--payi-text-muted)',
    boxShadow: active ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
  }
}
function typePill(active) {
  return {
    padding: '5px 11px', fontSize: 11.5, fontWeight: active ? 800 : 600, borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--payi-mint)' : 'var(--payi-border)'}`,
    background: active ? 'var(--payi-mint-soft)' : 'var(--payi-surface)', color: active ? 'var(--payi-mint-strong)' : 'var(--payi-text)',
  }
}
const lTh = { padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }
const lTd = { padding: '10px 12px', verticalAlign: 'middle' }

// "ออเดอร์ที่ซื้อพ่วง" — สินค้ากลุ่มไหนถูกซื้อคู่กับกลุ่มไหนบ่อยสุด แยกตามแพลตฟอร์ม
// เดิมเจ้าของทำมือใน Google Sheet ต่อแพลตฟอร์ม — ย้ายมาคำนวณสดจาก raw_orders (api/_lib/marketingBasket.js)
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}
const bucketLabel = (bucket) => (bucket === 'all' ? 'ทุกแพลตฟอร์ม' : bucket)

function BasketAnalysis() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [platform, setPlatform] = useState('')
  const [month, setMonth] = useState('all')
  const [productKey, setProductKey] = useState('')
  const [productData, setProductData] = useState(null)
  const [productLoading, setProductLoading] = useState(false)
  const [pairDetail, setPairDetail] = useState(null) // { a, b, examples, loading } | null

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetch(`/api/marketing?kind=basket&month=${month}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return
        if (!d.success) throw new Error(d.error || 'โหลดข้อมูลไม่สำเร็จ')
        setData(d)
        const order = d.bucketOrder || []
        const plats = order.filter((p) => d.platforms?.[p])
        setPlatform((cur) => (cur && plats.includes(cur) ? cur : plats[0] || ''))
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [month])

  // ดูรายสินค้าเดียว — โหลดใหม่ทุกครั้งที่เปลี่ยนสินค้า/บัคเก็ต/เดือน
  useEffect(() => {
    if (!productKey || !platform) { setProductData(null); return }
    let active = true
    setProductLoading(true)
    fetch(`/api/marketing?kind=basket&action=product&month=${month}&bucket=${encodeURIComponent(platform)}&product=${encodeURIComponent(productKey)}`)
      .then((r) => r.json())
      .then((d) => { if (active && d.success) setProductData(d) })
      .finally(() => active && setProductLoading(false))
    return () => { active = false }
  }, [productKey, platform, month])

  const openPairDetail = (pair) => {
    setPairDetail({ a: pair.a, b: pair.b, examples: [], loading: true })
    fetch(`/api/marketing?kind=basket&action=pair-detail&month=${month}&bucket=${encodeURIComponent(platform)}&a=${encodeURIComponent(pair.keyA)}&b=${encodeURIComponent(pair.keyB)}`)
      .then((r) => r.json())
      .then((d) => setPairDetail({ a: pair.a, b: pair.b, examples: d.success ? d.examples : [], loading: false }))
      .catch(() => setPairDetail({ a: pair.a, b: pair.b, examples: [], loading: false }))
  }

  if (error) return <div style={{ padding: '10px 12px', background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', border: '1px solid var(--payi-danger)', borderRadius: 8, fontSize: 13 }}>{error}</div>

  const bucketOrder = data?.bucketOrder || []
  const platforms = bucketOrder.filter((p) => data?.platforms?.[p])
  const current = data?.platforms?.[platform]
  const groupOptions = data?.groupOptions || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ minHeight: 36, border: '1px solid var(--payi-border)', borderRadius: 9, padding: '6px 11px', background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', fontWeight: 700, fontSize: 12.5 }}
        >
          <option value="all">ทั้งหมด (ทุกเดือน)</option>
          {(data?.months || []).slice().reverse().map((ym) => (
            <option key={ym} value={ym}>{monthLabel(ym)}</option>
          ))}
        </select>
        <div style={{ width: 1, height: 20, background: 'var(--payi-border)' }} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {platforms.map((p) => (
            <button key={p} onClick={() => setPlatform(p)} style={typePill(platform === p)}>
              {bucketLabel(p)} ({fmt(data.platforms[p].totalOrders)} ออเดอร์)
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--payi-border)' }} />
        <select
          value={productKey}
          onChange={(e) => setProductKey(e.target.value)}
          style={{ minHeight: 36, border: '1px solid var(--payi-border)', borderRadius: 9, padding: '6px 11px', background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', fontWeight: 700, fontSize: 12.5, maxWidth: 260 }}
        >
          <option value="">เลือกสินค้า — ดูว่าขายคู่กับอะไร</option>
          {groupOptions.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        {productKey && (
          <button onClick={() => setProductKey('')} style={{ border: 'none', background: 'transparent', color: 'var(--payi-text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ล้าง</button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>กำลังโหลด...</div>
      ) : productKey ? (
        <section className="payi-glass-card" style={{ padding: 16, borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)', marginBottom: 4 }}>
            {productData?.product || '...'} ขายคู่กับอะไรมากที่สุด ({bucketLabel(platform)})
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginBottom: 12 }}>
            {productLoading ? 'กำลังโหลด...' : productData
              ? `จากทั้งหมด ${fmt(productData.totalOrders)} ออเดอร์ที่มีสินค้านี้ — ${fmt(productData.soloOrders)} ออเดอร์ (${productData.totalOrders ? Math.round(productData.soloOrders / productData.totalOrders * 1000) / 10 : 0}%) ซื้อเดี่ยวไม่พ่วงอะไรเลย`
              : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>
                  <th style={lTh}>#</th>
                  <th style={lTh}>ขายคู่กับ</th>
                  <th style={{ ...lTh, textAlign: 'right' }}>จำนวนออเดอร์</th>
                  <th style={{ ...lTh, textAlign: 'right' }}>% ของออเดอร์ที่มีสินค้านี้</th>
                </tr>
              </thead>
              <tbody>
                {(productData?.pairs || []).map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={lTd}>{i + 1}</td>
                    <td style={{ ...lTd, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{p.label}</td>
                    <td style={{ ...lTd, textAlign: 'right', fontWeight: 800 }}>{fmt(p.orders)}</td>
                    <td style={{ ...lTd, textAlign: 'right', color: 'var(--payi-text-muted)' }}>{p.percentOfProductOrders}%</td>
                  </tr>
                ))}
                {!productLoading && !(productData?.pairs || []).length && (
                  <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: 'var(--payi-text-faint)' }}>ไม่พบว่าซื้อคู่กับสินค้าอื่นในช่วงนี้</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : !current ? (
        <EmptyLine text="ยังไม่มีข้อมูลออเดอร์สำหรับแพลตฟอร์มนี้" />
      ) : (
        <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <section className="payi-glass-card" style={{ padding: 16, borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)', marginBottom: 4 }}>คู่สินค้าที่ซื้อพ่วงกันบ่อยสุด</div>
            <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginBottom: 12 }}>นับจากออเดอร์ที่มีสินค้า ≥ 2 กลุ่มขึ้นไป (ไม่รวมยกเลิก/ตีคืน) — คลิกแถวเพื่อดูตัวอย่างออเดอร์จริง</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>
                    <th style={lTh}>#</th>
                    <th style={lTh}>คู่สินค้า</th>
                    <th style={{ ...lTh, textAlign: 'right' }}>จำนวนออเดอร์</th>
                    <th style={{ ...lTh, textAlign: 'right' }}>% ของออเดอร์รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {current.pairs.map((pair, i) => (
                    <tr key={i} onClick={() => openPairDetail(pair)} style={{ borderTop: '1px solid var(--payi-border)', cursor: 'pointer' }}>
                      <td style={lTd}>{i + 1}</td>
                      <td style={lTd}>
                        <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{pair.a}</div>
                        <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>+ {pair.b}</div>
                      </td>
                      <td style={{ ...lTd, textAlign: 'right', fontWeight: 800 }}>{fmt(pair.orders)}</td>
                      <td style={{ ...lTd, textAlign: 'right', color: 'var(--payi-text-muted)' }}>{pair.percentOfOrders}%</td>
                    </tr>
                  ))}
                  {!current.pairs.length && (
                    <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: 'var(--payi-text-faint)' }}>ยังไม่พบคู่สินค้าที่ซื้อพ่วงกัน</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="payi-glass-card" style={{ padding: 16, borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)', marginBottom: 4 }}>ขายเดี่ยวบ่อยสุด (ไม่พ่วง)</div>
            <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginBottom: 12 }}>ออเดอร์ที่มีสินค้ากลุ่มนี้กลุ่มเดียว — ถ้าติดอันดับสูงและไม่ค่อยพ่วงใคร อาจเป็นตัวเลือกที่เหมาะจะดันเข้า Set ใหม่</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>
                    <th style={lTh}>#</th>
                    <th style={lTh}>สินค้า</th>
                    <th style={{ ...lTh, textAlign: 'right' }}>จำนวนออเดอร์</th>
                  </tr>
                </thead>
                <tbody>
                  {current.topSingles.map((s, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--payi-border)' }}>
                      <td style={lTd}>{i + 1}</td>
                      <td style={{ ...lTd, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{s.label}</td>
                      <td style={{ ...lTd, textAlign: 'right', fontWeight: 800 }}>{fmt(s.orders)}</td>
                    </tr>
                  ))}
                  {!current.topSingles.length && (
                    <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: 'var(--payi-text-faint)' }}>ไม่มีข้อมูล</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {pairDetail && (
        <div onClick={() => setPairDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 22, width: 480, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{pairDetail.a} + {pairDetail.b}</div>
                <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginTop: 2 }}>ตัวอย่างออเดอร์จริง (ล่าสุด {DETAIL_LIMIT_LABEL} รายการ)</div>
              </div>
              <button onClick={() => setPairDetail(null)} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 26, height: 26, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)', flexShrink: 0 }}>
                <X size={13} />
              </button>
            </div>
            {pairDetail.loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>กำลังโหลด...</div>
            ) : pairDetail.examples.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pairDetail.examples.map((ex) => (
                  <div key={ex.orderId} style={{ border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--payi-text-muted)', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'monospace' }}>{ex.orderId}</span>
                      <span>{ex.date}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--payi-text-strong)' }}>{ex.items.join(', ')}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text="ไม่พบตัวอย่างออเดอร์" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
const DETAIL_LIMIT_LABEL = 30

function iconButton(color, background) {
  return {
    width: 32,
    height: 32,
    border: '1px solid var(--payi-border)',
    borderRadius: 8,
    color,
    background,
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  }
}
