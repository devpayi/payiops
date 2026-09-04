import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, PackageCheck, FileWarning, Layers, Plus, Pencil, Trash2, X, Check, FileSpreadsheet, SearchX } from 'lucide-react'
import KpiCard from '../components/KpiCard'
import PRODUCT_MASTER from '../data/productMaster.json'

// snapshot จาก product_master.xlsx (LK repo) — อัพเดตแล้ว redeploy. ใช้เป็น datalist ตอนแจ้งของเข้า
const PM_BY_SKU = Object.fromEntries(PRODUCT_MASTER.map((p) => [p.sku, p]))
// label ต้องแยกรุ่นออกจากกันได้ — ใช้ description_zh (มี รูปทรง/สี/ไซส์ อยู่แล้ว) เป็นตัวแยก
const pmLabel = (p) => {
  const tag = [p.color, p.size].filter(Boolean).join(' ') || (p.description_zh || '').slice(0, 46)
  return [p.name_en, tag].filter(Boolean).join(' · ')
}

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const baht = (n) => (n === null || n === undefined || n === '' ? '—' : '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }))
const API = '/api/sheet-tools?op=import-tracking'

const STAGE_LABELS = {
  draft: 'รวมของ', proforma: 'ทำ Proforma', customs_filed: 'ยื่นใบขน', paid: 'จ่ายเงิน',
  customs_done: 'ใบขนใช้จริง', docs_done: 'เอกสารครบ', handed_over: 'ส่งต่อ', closed: 'ปิดลอต',
}
const DOC_FIELDS = [
  ['draft_doc', 'ใบดราฟ (PROFORMA+packing)', 'ทำ Proforma'],
  ['customs_draft', 'ใบขนดราฟ', 'ยื่นใบขน'],
  ['customs_actual', 'ใบขนใช้จริง', 'ใบขนใช้จริง'],
  ['tax_invoice', 'ใบกำกับภาษี LK', 'ยื่นใบขน'],
  ['withholding_tax', 'หัก ณ ที่จ่าย (ภ.ง.ด.53)', 'จ่ายเงิน'],
  ['advance_payment_doc', 'ใบทดรองจ่าย (ตัวจริง)', 'หลังปล่อยของ'],
]
const HANDOVER_FIELDS = [
  ['sent_accounting', 'ส่งบัญชีเรา'],
  ['sent_lk', 'ส่ง LK (คุณจอย)'],
  ['printed', 'เก็บแฟ้ม'],
]
const FEE_FIELDS = [
  ['service_fee', 'ค่าบริการ LK (ตายตัว)'],
  ['advance_vat', 'เงินทดรองจ่าย (แปรตามลอต)'],
  ['other_fee', 'ค่าใช้จ่ายอื่น'],
]

const EMPTY = []
const DEFAULT_TOTALS = { arrivalsWaitingPink: 0, readyToLot: 0, lotTarget: 5, canSuggestLot: false, lots: 0, pendingDocs: 0, lkMissing: 0 }

const inputStyle = { width: '100%', border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--payi-surface)', color: 'var(--payi-text-strong)' }
const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 5, display: 'block' }
const iconBtn = (color) => ({ border: '1px solid var(--payi-border)', background: 'var(--payi-surface-muted)', color, width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer', lineHeight: 1 })
const primaryBtn = { background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{title}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function stageTone(stage, stages) {
  const i = stages.indexOf(stage)
  if (stage === 'closed') return { bg: 'var(--payi-success-bg)', color: 'var(--payi-success)' }
  if (i <= 0) return { bg: 'var(--payi-surface-muted)', color: 'var(--payi-text-muted)' }
  if (i >= stages.indexOf('customs_done')) return { bg: 'var(--payi-success-bg)', color: 'var(--payi-success)' }
  return { bg: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)' }
}
function StageChip({ stage, stages }) {
  const t = stageTone(stage, stages)
  return <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: t.bg, color: t.color, whiteSpace: 'nowrap' }}>{STAGE_LABELS[stage] || stage}</span>
}

function PinkChip({ on }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, ...(on
      ? { background: '#fce7f3', color: '#be185d' }
      : { background: 'var(--payi-surface-muted)', color: 'var(--payi-text-muted)' }) }}>
      {on ? 'ใบชมพูแล้ว' : 'รอใบชมพู'}
    </span>
  )
}

export default function ImportTracking() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(() => new Set())       // arrival ids selected in queue
  const [selectedLotId, setSelectedLotId] = useState(null)
  const [modal, setModal] = useState(null)

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(API).then((r) => r.json()).then((d) => {
      if (!d.success) throw new Error(d.error || 'โหลดข้อมูลไม่สำเร็จ')
      setData(d)
    }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const stages = data?.stages || EMPTY
  const arrivals = data?.arrivals || EMPTY
  const lots = data?.lots || EMPTY
  const totals = data?.totals || DEFAULT_TOTALS

  const selectedLot = useMemo(
    () => lots.find((l) => l.id === selectedLotId) || lots[0] || null,
    [lots, selectedLotId])

  const post = useCallback(async (body) => {
    setBusy(true); setError('')
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setModal(null); setSel(new Set()); load()
      return json
    } catch (e) { setError(e.message); throw e } finally { setBusy(false) }
  }, [load])

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const createLotFromSel = () => {
    if (!sel.size) return
    post({ action: 'upsert-lot', arrival_ids: [...sel] }).then((r) => r?.id && setSelectedLotId(r.id))
  }
  const addSelToLot = (lotId) => sel.size && post({ action: 'assign-arrivals', arrival_ids: [...sel], lot_id: lotId })
  const removeArrivalFromLot = (a) => post({ action: 'assign-arrivals', arrival_ids: [a.id], lot_id: '' })
  const togglePink = (a) => post({ action: 'upsert-arrival', id: a.id, pink_slip: !a.pink_slip })
  const setStage = (lot, stage) => post({ action: 'upsert-lot', id: lot.id, stage })
  const toggleDoc = (lot, field) => post({ action: 'upsert-lot', id: lot.id, [field]: !lot[field] })
  const removeArrival = (a) => window.confirm(`ลบของเข้า "${a.item_name}"?`) && post({ action: 'delete-arrival', id: a.id })
  const removeLot = (lot) => window.confirm(`ลบลอต "${lot.lot_ref || lot.id}"? (ของเข้ากลับไปคิวรอจัดลอต ไม่ถูกลบ)`) && post({ action: 'delete-lot', id: lot.id })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {error && <div style={{ background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
        <KpiCard title="รอใบชมพู" value={fmt(totals.arrivalsWaitingPink)} subtitle="ของเข้ายังไม่ครบ" icon={Package} trend={null} />
        <KpiCard title="พร้อมจัดลอต" value={fmt(totals.readyToLot)} subtitle={totals.canSuggestLot ? `≥ ${totals.lotTarget} — จัดลอตได้แล้ว` : `แนะนำที่ ~${totals.lotTarget}`} icon={PackageCheck} trend={null} />
        <KpiCard title="ลอตทั้งหมด" value={fmt(totals.lots)} subtitle="กำลังติดตาม" icon={Layers} trend={null} />
        {totals.lkMissing > 0
          ? <KpiCard title="ไม่เจอในชีท LK" value={fmt(totals.lkMissing)} subtitle="เช็คเลขในกลุ่มไลน์" icon={SearchX} trend={null} />
          : <KpiCard title="เอกสารค้าง" value={fmt(totals.pendingDocs)} subtitle="ลอตที่ยังไม่ปิด" icon={FileWarning} trend={null} />}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>เห็นเฉพาะ dev · boss</div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>กำลังโหลด...</div>
      ) : (
        <>
          <ArrivalsPanel
            arrivals={arrivals} sel={sel} lots={lots}
            onToggleSel={toggleSel} onTogglePink={togglePink}
            onAdd={() => setModal({ type: 'new-arrival' })}
            onEdit={(a) => setModal({ type: 'edit-arrival', arrival: a })}
            onDelete={removeArrival}
            onCreateLot={createLotFromSel} onAddToLot={addSelToLot}
            target={totals.lotTarget} readyCount={totals.readyToLot}
          />

          {lots.length === 0 ? null : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 18, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--payi-text-muted)' }}>ลอต ({lots.length})</div>
                {lots.map((l) => (
                  <button key={l.id} onClick={() => setSelectedLotId(l.id)} style={{
                    textAlign: 'left', width: '100%', background: 'var(--payi-surface)', cursor: 'pointer',
                    border: `1px solid ${selectedLot?.id === l.id ? 'var(--payi-mint)' : 'var(--payi-border)'}`,
                    boxShadow: selectedLot?.id === l.id ? '0 0 0 3px var(--payi-mint-soft)' : 'none',
                    borderRadius: 13, padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--payi-text-strong)', fontFamily: 'monospace' }}>{l.lot_ref || '(ยังไม่ตั้ง ref)'}</span>
                      <StageChip stage={l.stage} stages={stages} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 5 }}>
                      {l.arrival_count} อย่าง · {fmt(l.qty_total)} ชิ้น · {l.box_count} กล่อง
                    </div>
                    <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
                      {stages.map((s, i) => (
                        <i key={s} style={{ height: 4, flex: 1, borderRadius: 2, background: i < l.stage_index ? 'var(--payi-mint)' : i === l.stage_index ? 'var(--payi-warning)' : 'var(--payi-border)' }} />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
              {selectedLot && (
                <LotDetail
                  lot={selectedLot} stages={stages} busy={busy}
                  onSetStage={setStage} onToggle={toggleDoc}
                  onEditLot={() => setModal({ type: 'edit-lot', lot: selectedLot })}
                  onDeleteLot={() => removeLot(selectedLot)}
                  onRemoveArrival={removeArrivalFromLot}
                  onProforma={() => setModal({ type: 'proforma', lot: selectedLot })}
                />
              )}
            </div>
          )}
        </>
      )}

      {modal?.type === 'new-arrival' && <ArrivalModal busy={busy} onClose={() => setModal(null)} onSave={(b) => post({ action: 'upsert-arrival', ...b })} />}
      {modal?.type === 'edit-arrival' && <ArrivalModal busy={busy} initial={modal.arrival} onClose={() => setModal(null)} onSave={(b) => post({ action: 'upsert-arrival', id: modal.arrival.id, ...b })} />}
      {modal?.type === 'edit-lot' && <LotModal busy={busy} initial={modal.lot} onClose={() => setModal(null)} onSave={(b) => post({ action: 'upsert-lot', id: modal.lot.id, ...b })} />}
      {modal?.type === 'proforma' && <ProformaModal lot={modal.lot} busy={busy} onClose={() => setModal(null)} onMarkDone={() => post({ action: 'upsert-lot', id: modal.lot.id, proforma_done: true, stage: modal.lot.stage_index < 1 ? 'proforma' : modal.lot.stage })} />}
    </div>
  )
}

function ArrivalsPanel({ arrivals, sel, lots, onToggleSel, onTogglePink, onAdd, onEdit, onDelete, onCreateLot, onAddToLot, target, readyCount }) {
  const [tab, setTab] = useState('queue') // queue | all
  const rows = tab === 'queue' ? arrivals.filter((a) => !a.lot_id) : arrivals
  const selCount = sel.size
  return (
    <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, boxShadow: '0 14px 36px rgba(15,23,42,0.05)' }}>
      <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--payi-surface-muted)', borderRadius: 10, padding: 3 }}>
          {[['queue', 'รอจัดลอต'], ['all', 'ทั้งหมด']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              border: 'none', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: tab === k ? 'var(--payi-surface)' : 'transparent', color: tab === k ? 'var(--payi-text-strong)' : 'var(--payi-text-muted)',
              boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: readyCount >= target ? 'var(--payi-success)' : 'var(--payi-text-muted)', fontWeight: 700 }}>
            พร้อมจัดลอต {readyCount}/{target}
          </span>
          <button onClick={onAdd} style={primaryBtn}><Plus size={14} /> เพิ่มของเข้า</button>
        </div>
      </div>

      {selCount > 0 && (
        <div style={{ padding: '10px 20px', background: 'var(--payi-mint-soft)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--payi-mint-strong)' }}>เลือก {selCount} รายการ</span>
          <button onClick={onCreateLot} style={{ ...primaryBtn, padding: '7px 13px' }}><Layers size={13} /> สร้างลอตใหม่</button>
          {lots.filter((l) => l.stage !== 'closed').map((l) => (
            <button key={l.id} onClick={() => onAddToLot(l.id)} style={{ border: '1px solid var(--payi-mint)', background: 'var(--payi-surface)', color: 'var(--payi-mint-strong)', borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + เข้าลอต {l.lot_ref || l.id.slice(-4)}
            </button>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto', padding: '0 8px 8px' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>
            {tab === 'queue' ? 'ไม่มีของเข้ารอจัดลอต — กด "เพิ่มของเข้า"' : 'ยังไม่มีของเข้า'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: 'var(--payi-text-faint)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', textAlign: 'left' }}>
              <th style={{ padding: '8px' }} />
              <th style={{ padding: '8px' }}>สินค้า</th>
              <th style={{ padding: '8px' }}>CTN</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>กล่อง</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>จำนวน</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>KG</th>
              <th style={{ padding: '8px' }}>วันถึง</th>
              <th style={{ padding: '8px' }}>ใบชมพู</th>
              <th style={{ padding: '8px' }}>ลอต</th>
              <th style={{ padding: '8px' }} />
            </tr></thead>
            <tbody>
              {rows.map((a) => {
                const inLot = lots.find((l) => l.id === a.lot_id)
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={{ padding: '8px' }}>
                      {!a.lot_id && <input type="checkbox" checked={sel.has(a.id)} onChange={() => onToggleSel(a.id)} />}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--payi-text-strong)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {a.item_name}
                        {a.lk_missing
                          ? <span style={{ fontSize: 10, fontWeight: 800, background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', padding: '1px 6px', borderRadius: 999 }}>✗ ไม่เจอ LK</span>
                          : !a.sku && <span style={{ fontSize: 10, fontWeight: 800, background: 'var(--payi-warning-bg)', color: 'var(--payi-warning)', padding: '1px 6px', borderRadius: 999 }}>รอใส่ SKU</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', fontFamily: 'monospace' }}>
                        {a.sku || '—'} · SHIPPING {a.shipping_no || '—'}
                        {a.codename ? <span style={{ marginLeft: 6, fontWeight: 800, background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)', padding: '1px 6px', borderRadius: 999 }}>{a.codename}</span> : null}
                      </div>
                      {a.lk_missing && <div style={{ fontSize: 11, color: 'var(--payi-danger)', marginTop: 3 }}>{a.note}</div>}
                    </td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 12 }}>{a.ctn_no || '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{a.box_count ?? '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{a.qty == null ? '—' : fmt(a.qty)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{a.weight_kg ?? '—'}</td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 12 }}>{a.arrive_date || '—'}</td>
                    <td style={{ padding: '8px' }}>
                      <button onClick={() => onTogglePink(a)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}><PinkChip on={a.pink_slip} /></button>
                    </td>
                    <td style={{ padding: '8px', fontSize: 12 }}>
                      {inLot ? <span style={{ fontFamily: 'monospace', color: 'var(--payi-mint-strong)', fontWeight: 700 }}>{inLot.lot_ref || inLot.id.slice(-4)}</span> : <span style={{ color: 'var(--payi-text-faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => onEdit(a)} title="แก้ไข" style={iconBtn('var(--payi-text-muted)')}><Pencil size={12} /></button>
                      <button onClick={() => onDelete(a)} title="ลบ" style={{ ...iconBtn('var(--payi-danger)'), marginLeft: 6 }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function LotDetail({ lot, stages, busy, onSetStage, onToggle, onEditLot, onDeleteLot, onRemoveArrival, onProforma }) {
  const card = { background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, boxShadow: '0 14px 36px rgba(15,23,42,0.05)', overflow: 'hidden' }
  const section = { padding: '18px 20px', borderTop: '1px solid var(--payi-border)' }
  const h3 = { fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--payi-text-muted)', marginBottom: 13 }

  return (
    <div style={card}>
      <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--payi-text-strong)', display: 'flex', alignItems: 'center', gap: 9 }}>
            {lot.lot_ref || '(ยังไม่ตั้ง ref)'} <StageChip stage={lot.stage} stages={stages} />
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--payi-text-muted)', marginTop: 5 }}>
            ใบขนดราฟ {lot.customs_no_draft || '—'} · ใบขนจริง {lot.customs_no || '—'} · สั่ง {lot.order_date || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onProforma} style={{ ...primaryBtn, padding: '7px 13px' }}><FileSpreadsheet size={13} /> สร้าง Proforma</button>
          <button onClick={onEditLot} title="แก้ไขลอต" style={iconBtn('var(--payi-text-muted)')}><Pencil size={13} /></button>
          <button onClick={onDeleteLot} title="ลบลอต" style={iconBtn('var(--payi-danger)')}><Trash2 size={13} /></button>
        </div>
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '2px 18px', padding: '14px 20px', background: 'var(--payi-surface-muted)', margin: 0 }}>
        {[
          ['จำนวนอย่าง', lot.arrival_count], ['รวมชิ้น', fmt(lot.qty_total)], ['กล่อง', lot.box_count],
          ['น้ำหนัก', `${lot.weight_kg} kg`], ['CBM', lot.cbm],
        ].map(([k, v]) => (
          <div key={k}>
            <dt style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--payi-text-faint)', marginTop: 8 }}>{k}</dt>
            <dd style={{ margin: '1px 0 0', fontFamily: 'monospace', fontSize: 13, color: 'var(--payi-text-strong)' }}>{v}</dd>
          </div>
        ))}
      </dl>

      <div style={section}>
        <div style={h3}>สถานะ ({lot.stage_index + 1}/{stages.length}) · กดขั้นเพื่อเลื่อน</div>
        <div style={{ display: 'flex', overflowX: 'auto', paddingBottom: 4 }}>
          {stages.map((s, i) => {
            const done = i < lot.stage_index, now = i === lot.stage_index
            return (
              <button key={s} onClick={() => onSetStage(lot, s)} disabled={busy} style={{ flex: 1, minWidth: 88, textAlign: 'center', position: 'relative', paddingTop: 22, border: 'none', background: 'none', cursor: 'pointer' }}>
                <span style={{ position: 'absolute', top: 7, left: i === 0 ? '50%' : 0, right: i === stages.length - 1 ? '50%' : 0, height: 2, background: (done || now) ? 'var(--payi-mint)' : 'var(--payi-border)' }} />
                <span style={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', width: 15, height: 15, borderRadius: '50%', background: done ? 'var(--payi-mint)' : now ? 'var(--payi-warning)' : 'var(--payi-surface)', border: `2px solid ${done ? 'var(--payi-mint)' : now ? 'var(--payi-warning)' : 'var(--payi-border)'}`, boxShadow: now ? '0 0 0 4px var(--payi-warning-bg)' : 'none' }} />
                <span style={{ fontSize: 10.5, lineHeight: 1.25, display: 'block', color: (done || now) ? 'var(--payi-text)' : 'var(--payi-text-faint)', fontWeight: (done || now) ? 700 : 400 }}>{STAGE_LABELS[s]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={section}>
        <div style={h3}>ของในลอต ({lot.arrival_count}){!lot.all_pink_slip && <span style={{ color: 'var(--payi-warning)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>⚠ ยังมีของที่ยังไม่ได้ใบชมพู</span>}</div>
        {lot.arrivals.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--payi-text-faint)' }}>ยังไม่มีของในลอตนี้ — เลือกจากตาราง "ของเข้า" ด้านบน</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lot.arrivals.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--payi-surface-muted)', borderRadius: 9 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, color: 'var(--payi-text-strong)' }}>{a.item_name}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--payi-text-muted)', marginLeft: 8 }}>{a.sku} · {fmt(a.qty)} ชิ้น · {a.box_count} กล่อง</span>
                  {a.codename ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)', padding: '1px 6px', borderRadius: 999 }}>{a.codename}</span> : null}
                </div>
                <PinkChip on={a.pink_slip} />
                <button onClick={() => onRemoveArrival(a)} title="เอาออกจากลอต" style={iconBtn('var(--payi-danger)')}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={section}>
        <div style={h3}>เอกสาร (6) · {lot.docs_done}/{lot.docs_total}</div>
        <CheckRow fields={DOC_FIELDS} lot={lot} onToggle={onToggle} />
      </div>
      <div style={section}>
        <div style={h3}>ส่งต่อเอกสาร — ทุกใบไป 3 ที่</div>
        <CheckRow fields={HANDOVER_FIELDS} lot={lot} onToggle={onToggle} />
      </div>

      <div style={section}>
        <div style={{ ...h3, color: 'var(--payi-mint-strong)' }}>ค่าใบขน / ภาษี (THB)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {FEE_FIELDS.map(([f, lbl]) => (
            <div key={f}>
              <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontWeight: 600 }}>{lbl}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--payi-text-strong)', marginTop: 2 }}>{baht(lot[f])}</div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontWeight: 600 }}>หัก ณ ที่จ่าย 3%</div>
            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--payi-text-strong)', marginTop: 2 }}>{baht(lot.wht_amount)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontWeight: 600 }}>รวมต้นทุนนำเข้า</div>
            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--payi-mint-strong)', marginTop: 2 }}>{baht(lot.import_cost_total)}</div>
          </div>
        </div>
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px dashed var(--payi-border)', fontSize: 12.5, color: 'var(--payi-text)' }}>
          {lot.cost_per_pc
            ? <>ถัวเฉลี่ยต่อชิ้น = {baht(lot.import_cost_total)} ÷ {fmt(lot.qty_total)} ชิ้น = <b style={{ fontFamily: 'monospace', color: 'var(--payi-mint-strong)', fontSize: 14 }}>฿{lot.cost_per_pc.toFixed(2)}</b></>
            : 'ยังกรอกค่าใบขน / ยังไม่มีของในลอต — ถัวเฉลี่ยยังคำนวณไม่ได้'}
          <button onClick={onEditLot} style={{ marginLeft: 12, fontSize: 12, fontWeight: 700, color: 'var(--payi-mint-strong)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>แก้ไขค่าใช้จ่าย</button>
        </div>
      </div>
    </div>
  )
}

function CheckRow({ fields, lot, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {fields.map(([f, lbl, tag]) => {
        const on = !!lot[f]
        return (
          <button key={f} onClick={() => onToggle(lot, f)} style={{
            border: '1px solid var(--payi-border)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: on ? 'var(--payi-success-bg)' : 'var(--payi-surface-muted)',
            color: on ? 'var(--payi-success)' : 'var(--payi-text-muted)',
          }}>
            <span style={{ width: 15, height: 15, borderRadius: 5, display: 'grid', placeItems: 'center', background: on ? 'var(--payi-success)' : 'transparent', border: `1.5px solid ${on ? 'var(--payi-success)' : 'var(--payi-border)'}`, color: '#fff' }}>{on ? <Check size={11} /> : null}</span>
            {lbl}
            {tag ? <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--payi-text-faint)', fontWeight: 500 }}>{tag}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

function ArrivalModal({ initial, busy, onClose, onSave }) {
  const isEdit = Boolean(initial)
  const [f, setF] = useState(() => ({
    sku: initial?.sku || '', item_name: initial?.item_name || '', codename: initial?.codename || '',
    ctn_no: initial?.ctn_no || '', shipping_no: initial?.shipping_no || '', invoice_no: initial?.invoice_no || '',
    box_count: initial?.box_count ?? '', qty: initial?.qty ?? '', weight_kg: initial?.weight_kg ?? '', cbm: initial?.cbm ?? '',
    arrive_date: initial?.arrive_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    pink_slip: initial?.pink_slip || false, note: initial?.note || '',
  }))
  const [lk, setLk] = useState(null) // null | 'loading' | {found,...}
  const set = (k) => (e) => setF((d) => ({ ...d, [k]: e.target.value }))
  const setSku = (e) => setF((d) => {
    const sku = e.target.value
    const p = PM_BY_SKU[sku]
    return { ...d, sku, item_name: (!d.item_name.trim() && p) ? (p.name_th || p.name_en) : d.item_name }
  })
  const submit = (e) => { e.preventDefault(); if (!f.item_name.trim()) return; onSave(f) }
  const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  const pullLk = async () => {
    const s = f.shipping_no.trim()
    if (!s) return
    setLk('loading')
    try {
      const q = new URLSearchParams({ view: 'lk-lookup', shipping_no: s, date: f.arrive_date || '' })
      const r = await fetch(`${API}&${q}`).then((x) => x.json())
      setLk(r)
      if (r.found) {
        setF((d) => ({
          ...d,
          ctn_no: r.ctn_no || d.ctn_no,
          box_count: r.box_count || d.box_count,
          qty: r.qty || d.qty,
          weight_kg: r.weight_kg || d.weight_kg,
          cbm: r.cbm || d.cbm,
          item_name: d.item_name || r.goods_zh || '',
          note: d.note || (r.goods_zh ? `LK: ${r.goods_zh}` : ''),
        }))
      }
    } catch (e) { setLk({ found: false, error: e.message }) }
  }

  return (
    <Modal title={isEdit ? 'แก้ไขของเข้า' : 'แจ้งของเข้า (1 รายการสินค้า = 1 ของเข้า)'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* เลข SHIPPING บนใบชมพู — key แมชเข้าชีท LK */}
        <div style={{ background: 'var(--payi-mint-soft)', borderRadius: 12, padding: 14 }}>
          <label style={labelStyle}>เลข SHIPPING (บนใบชมพู) *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={f.shipping_no} onChange={set('shipping_no')} style={{ ...inputStyle, fontFamily: 'monospace' }} placeholder="เช่น 5445476" />
            <button type="button" onClick={pullLk} disabled={!f.shipping_no.trim() || lk === 'loading'} style={{ ...primaryBtn, padding: '9px 14px', whiteSpace: 'nowrap' }}>
              {lk === 'loading' ? 'กำลังหา...' : 'ดึงจาก LK'}
            </button>
          </div>
          {lk && lk !== 'loading' && (
            lk.found
              ? <div style={{ fontSize: 12, color: 'var(--payi-success)', marginTop: 8, fontWeight: 600 }}>
                  ✓ เจอในชีท LK ({lk.tab}) — {lk.goods_zh} · {lk.box_count} กล่อง · {fmt(lk.qty)} ชิ้น · {lk.weight_kg} kg · {lk.cbm} cbm{lk.est_arrival ? ` · เข้าไทย ~${lk.est_arrival}` : ''}
                </div>
              : <div style={{ fontSize: 12, color: 'var(--payi-warning)', marginTop: 8 }}>
                  ไม่เจอในชีท LK{lk.error ? ` (${lk.error})` : ' — อาจยังไม่ขึ้นชีท กรอกมือได้'}
                </div>
          )}
        </div>

        <div style={grid}>
          <div>
            <label style={labelStyle}>SKU (product_master)</label>
            <input value={f.sku} onChange={setSku} list="pm-skus" style={inputStyle} placeholder="PM-15" />
            <datalist id="pm-skus">
              {PRODUCT_MASTER.map((p) => <option key={p.sku} value={p.sku}>{pmLabel(p)}</option>)}
            </datalist>
            {PM_BY_SKU[f.sku] && <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 4 }}>{pmLabel(PM_BY_SKU[f.sku])}</div>}
          </div>
          <div><label style={labelStyle}>ชื่อลับ</label><input value={f.codename} onChange={set('codename')} style={inputStyle} placeholder="กุ้งดำ" /></div>
        </div>
        <div><label style={labelStyle}>ชื่อสินค้า</label><input value={f.item_name} onChange={set('item_name')} required style={inputStyle} placeholder="เลือก SKU แล้วเติมให้ หรือพิมพ์เอง" /></div>
        <div><label style={labelStyle}>CTN number</label><input value={f.ctn_no} onChange={set('ctn_no')} style={inputStyle} placeholder="SPK2026...." /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
          <div><label style={labelStyle}>กล่อง</label><input type="number" value={f.box_count} onChange={set('box_count')} style={inputStyle} /></div>
          <div><label style={labelStyle}>จำนวน</label><input type="number" value={f.qty} onChange={set('qty')} style={inputStyle} /></div>
          <div><label style={labelStyle}>KG</label><input type="number" step="any" value={f.weight_kg} onChange={set('weight_kg')} style={inputStyle} /></div>
          <div><label style={labelStyle}>CBM</label><input type="number" step="any" value={f.cbm} onChange={set('cbm')} style={inputStyle} /></div>
        </div>
        <div style={grid}>
          <div><label style={labelStyle}>วันของถึง</label><input type="date" value={f.arrive_date} onChange={set('arrive_date')} style={inputStyle} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 24, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.pink_slip} onChange={(e) => setF((d) => ({ ...d, pink_slip: e.target.checked }))} /> ได้ใบชมพูแล้ว (ของครบ)
          </label>
        </div>
        <div><label style={labelStyle}>หมายเหตุ</label><input value={f.note} onChange={set('note')} style={inputStyle} placeholder="ไม่บังคับ" /></div>
        <button type="submit" disabled={busy} style={{ ...primaryBtn, justifyContent: 'center', padding: '11px 16px', fontSize: 14, opacity: busy ? 0.6 : 1 }}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </form>
    </Modal>
  )
}

const LOT_TEXT_FIELDS = [['lot_ref', 'Ref ลอต'], ['customs_no_draft', 'เลขใบขนดราฟ'], ['customs_no', 'เลขใบขนใช้จริง']]
function LotModal({ initial, busy, onClose, onSave }) {
  const [f, setF] = useState(() => ({
    lot_ref: initial?.lot_ref || '', customs_no_draft: initial?.customs_no_draft || '', customs_no: initial?.customs_no || '',
    order_date: initial?.order_date || '', service_fee: initial?.service_fee ?? 3900, advance_vat: initial?.advance_vat ?? '',
    other_fee: initial?.other_fee ?? '', note: initial?.note || '',
  }))
  const set = (k) => (e) => setF((d) => ({ ...d, [k]: e.target.value }))
  const submit = (e) => { e.preventDefault(); onSave(f) }
  const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
  return (
    <Modal title="แก้ไขลอต" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={grid}>
          {LOT_TEXT_FIELDS.map(([k, lbl]) => (
            <div key={k}><label style={labelStyle}>{lbl}</label><input value={f[k]} onChange={set(k)} style={inputStyle} /></div>
          ))}
          <div><label style={labelStyle}>วันสั่ง</label><input type="date" value={f.order_date} onChange={set('order_date')} style={inputStyle} /></div>
        </div>
        <div style={{ background: 'var(--payi-mint-soft)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-mint-strong)', marginBottom: 10 }}>ค่าใบขน / ภาษี (THB)</div>
          <div style={grid}>
            {FEE_FIELDS.map(([k, lbl]) => (
              <div key={k}><label style={labelStyle}>{lbl}</label><input type="number" step="any" value={f[k]} onChange={set(k)} style={inputStyle} /></div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', marginTop: 8 }}>หัก ณ ที่จ่าย 3% ของค่าบริการ = คำนวณอัตโนมัติ</div>
        </div>
        <div><label style={labelStyle}>หมายเหตุ</label><input value={f.note} onChange={set('note')} style={inputStyle} /></div>
        <button type="submit" disabled={busy} style={{ ...primaryBtn, justifyContent: 'center', padding: '11px 16px', fontSize: 14, opacity: busy ? 0.6 : 1 }}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </form>
    </Modal>
  )
}

// ค่าคงที่หัวเอกสาร proforma (แก้ที่เดียว)
const PROFORMA_SUPPLIER = '晋江熠晓贸易有限公司'
const PROFORMA_CONSIGNEE = 'บริษัท ปลาใหญ่ มาร์เก็ตติ้ง จำกัด (สำนักงานใหญ่)\n79 ซอยงามวงศ์วาน 23 ตำบลบางเขน อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000'

// จับกลุ่มกล่องเหมือนกัน (wt|l|w|h) จาก lk-lookup.cartons
function groupCartons(cartons) {
  const m = new Map()
  for (const c of cartons || []) {
    const key = `${c.wt}|${c.l}|${c.w}|${c.h}`
    const g = m.get(key) || { count: 0, wt: +c.wt || 0, l: +c.l || 0, w: +c.w || 0, h: +c.h || 0 }
    g.count += c.box || 1
    m.set(key, g)
  }
  return [...m.values()]
}

// เลือกสินค้าจากรูป — grid ทั้ง product_master + ช่องค้นหา
function ProductImagePicker({ images, current, onPick, onClose }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return PRODUCT_MASTER
    return PRODUCT_MASTER.filter((p) => `${p.sku} ${p.name_en} ${p.name_th} ${p.name_zh} ${p.description_zh} ${p.color} ${p.size}`.toLowerCase().includes(t))
  }, [q])
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 14, width: 'min(680px,100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--payi-border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาสินค้า (ชื่อ / สี / ไซส์ / รหัส)" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={onClose} style={{ ...primaryBtn, background: 'var(--payi-surface-muted)', color: 'var(--payi-text-strong)', border: '1px solid var(--payi-border)', padding: '8px 12px' }}>ปิด</button>
        </div>
        <div style={{ padding: 12, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
          {list.map((p) => (
            <button
              key={p.sku}
              type="button"
              onClick={() => onPick(p.sku)}
              style={{
                border: p.sku === current ? '2px solid var(--payi-mint-strong)' : '1px solid var(--payi-border)',
                borderRadius: 10, padding: 8, cursor: 'pointer', background: 'var(--payi-surface)', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <div style={{ width: '100%', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: 'var(--payi-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {images[p.sku]
                  ? <img src={images[p.sku]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>ไม่มีรูป</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{p.name_en}</div>
              <div style={{ fontSize: 10.5, color: 'var(--payi-text-muted)', lineHeight: 1.35 }}>
                {p.name_th}{[p.color, p.size].filter(Boolean).length ? ` · ${[p.color, p.size].filter(Boolean).join(' ')}` : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{p.sku}</div>
            </button>
          ))}
          {!list.length && <div style={{ color: 'var(--payi-text-muted)', gridColumn: '1/-1', padding: 20, textAlign: 'center' }}>ไม่เจอ — ถ้าเป็นสินค้าใหม่ ต้องเพิ่มใน product_master ก่อน</div>}
        </div>
      </div>
    </div>
  )
}

function ProformaModal({ lot, busy, onClose, onMarkDone }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const [rows, setRows] = useState(null) // null | [{ id, item_name, qty, sku, sku0, cartons, carton_src }]
  const [info, setInfo] = useState({ invoice_date: today, shipping_mark: lot.lot_ref ? `LK/${lot.lot_ref}` : '', consignee_to: PROFORMA_CONSIGNEE })
  const [gen, setGen] = useState('') // '' | 'working' | 'done' | error string
  const [images, setImages] = useState({}) // { sku: dataURL }
  const [picking, setPicking] = useState(null) // arrival id ที่กำลังเลือกสินค้าจากรูป

  useEffect(() => {
    let alive = true
    import('../data/productImages.json').then((m) => { if (alive) setImages(m.default || m) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // ── ดึงกล่องจากชีท LK ต่อ arrival (ครั้งเดียวตอนเปิด) ──
  const load = useCallback(async () => {
    const out = []
    for (const a of lot.arrivals) {
      let cartons = []
      let carton_src = ''
      if (a.shipping_no) {
        try {
          const q = new URLSearchParams({ view: 'lk-lookup', shipping_no: a.shipping_no, date: a.arrive_date || '' })
          const r = await fetch(`${API}&${q}`).then((x) => x.json())
          if (r.found && r.cartons?.length) { cartons = groupCartons(r.cartons); carton_src = 'LK' }
        } catch { /* noop */ }
      }
      out.push({ id: a.id, item_name: a.item_name || '', qty: a.qty || 0, sku: a.sku || '', sku0: a.sku || '', cartons, carton_src })
    }
    return out
  }, [lot])

  useEffect(() => {
    let alive = true
    load().then((d) => { if (alive) setRows(d) })
    return () => { alive = false }
  }, [load])

  const setSku = (id, sku) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, sku } : r)))

  // ── derive: ผูก product_master + กล่อง fallback + จัดกลุ่ม ──
  const view = useMemo(() => {
    if (!rows) return null
    const enriched = rows.map((r) => {
      const pm = r.sku ? PM_BY_SKU[r.sku] : null
      let cartons = r.cartons
      let cartonNote = r.carton_src === 'LK' ? '' : 'ไม่เจอกล่องในชีท LK'
      if (!cartons.length && pm && (pm.box_l_cm || pm.carton_weight_kg)) {
        cartons = [{ count: 1, wt: +pm.carton_weight_kg || 0, l: +pm.box_l_cm || 0, w: +pm.box_w_cm || 0, h: +pm.box_h_cm || 0 }]
        cartonNote = 'ใช้ขนาดกล่องจาก product_master (1 กล่อง)'
      }
      return {
        ...r, pm, cartons, cartonNote,
        name_en: pm?.name_en || r.item_name || r.sku || '',
        name_th: pm?.name_th || '',
        description: pm?.description_zh || pm?.description_th || r.item_name || '',
        boxes: cartons.reduce((s, c) => s + c.count, 0),
        wt: cartons.reduce((s, c) => s + c.count * c.wt, 0),
        cbm: cartons.reduce((s, c) => s + c.count * c.l * c.w * c.h / 1e6, 0),
      }
    })
    const groups = []
    for (const it of enriched) {
      const last = groups[groups.length - 1]
      if (last && it.name_en && last.name_en === it.name_en) last.rows.push(it)
      else groups.push({ name_en: it.name_en, rows: [it] })
    }
    groups.forEach((g, i) => { g.no = i + 1 })
    const warnings = []
    for (const it of enriched) {
      if (!it.sku) warnings.push(`"${it.item_name || 'ไม่มีชื่อ'}" — ยังไม่จับคู่ SKU`)
      else if (!it.pm) warnings.push(`${it.sku} — ไม่มีใน product_master (เพิ่มแถว + redeploy)`)
      else if (!it.cartons.length) warnings.push(`${it.name_en} — ไม่มีข้อมูลกล่องเลย`)
    }
    const totals = enriched.reduce((t, r) => ({
      qty: t.qty + Number(r.qty || 0), boxes: t.boxes + r.boxes, wt: t.wt + r.wt, cbm: t.cbm + r.cbm,
    }), { qty: 0, boxes: 0, wt: 0, cbm: 0 })
    const missingSku = enriched.filter((r) => !r.sku).length
    return { groups, enriched, warnings, totals, missingSku }
  }, [rows])

  const makeFile = async () => {
    if (!view) return
    setGen('working')
    try {
      // 1) จำ sku ที่เพิ่งจับคู่ (arrival + ชื่อ->sku ครั้งหน้าไม่ต้องเลือกซ้ำ)
      const changed = rows.filter((r) => r.sku && r.sku !== r.sku0).map((r) => ({ id: r.id, sku: r.sku }))
      if (changed.length) {
        await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-arrival-skus', items: changed }) })
      }
      // 2) สร้างไฟล์
      const { generateProforma } = await import('../lib/proformaXlsx')
      const groups = view.groups.map((g, i) => ({
        no: i + 1, name_en: g.name_en, name_th: g.rows[0].name_th,
        image: images[g.rows[0].sku] || null,
        rows: g.rows.map((r) => ({ sku: r.sku, qty: r.qty, description: r.description, cartons: r.cartons })),
      }))
      const { blob } = await generateProforma(
        { supplier_name_zh: PROFORMA_SUPPLIER, invoice_date: info.invoice_date, consignee_to: info.consignee_to },
        groups,
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `PROFORMA ${lot.lot_ref || lot.id} (${info.invoice_date}).xlsx`
      link.click()
      URL.revokeObjectURL(url)
      setGen('done')
      onMarkDone()
    } catch (e) {
      setGen('สร้างไฟล์ไม่สำเร็จ: ' + e.message)
    }
  }

  return (
    <Modal title="ออกไฟล์ Proforma Invoice + Packing List" onClose={onClose} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, color: 'var(--payi-text)' }}>
        {!lot.all_pink_slip && (
          <div style={{ background: 'var(--payi-warning-bg)', color: 'var(--payi-warning)', borderRadius: 10, padding: '10px 12px', fontWeight: 700 }}>
            ⚠ ลอตนี้ยังมีของที่ยังไม่ได้ใบชมพู — ออกไฟล์ได้ แต่ของอาจยังมาไม่ครบ
          </div>
        )}

        {!view && <div style={{ color: 'var(--payi-text-muted)' }}>กำลังดึงกล่องจากชีท LK...</div>}

        {view && (
          <>
            <datalist id="proforma-skus">
              {PRODUCT_MASTER.map((p) => <option key={p.sku} value={p.sku}>{pmLabel(p)}</option>)}
            </datalist>

            {/* รายการในลอต — จับคู่สินค้าจากรูปตรงนี้ได้เลย */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {view.groups.map((g, gi) => g.rows.map((r, ri) => (
                <div key={r.id} style={{ border: '1px solid var(--payi-border)', borderRadius: 10, padding: 10, display: 'flex', gap: 10, background: r.sku ? 'transparent' : 'var(--payi-warning-bg)' }}>
                  <button
                    type="button"
                    onClick={() => setPicking(r.id)}
                    title="เลือกสินค้าจากรูป"
                    style={{ flex: '0 0 56px', width: 56, height: 56, borderRadius: 8, border: '1px solid var(--payi-border)', padding: 0, cursor: 'pointer', overflow: 'hidden', background: 'var(--payi-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {images[r.sku]
                      ? <img src={images[r.sku]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 10, color: 'var(--payi-text-faint)' }}>เลือก<br />รูป</span>}
                  </button>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {ri === 0 ? `${gi + 1}. ` : ''}{r.pm?.name_en || <span style={{ color: 'var(--payi-danger)' }}>ยังไม่จับคู่</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--payi-text-muted)' }}>
                      {fmt(r.qty)} ชิ้น · {r.boxes} กล่อง · {r.wt.toFixed(1)} กก. · {r.cbm.toFixed(2)} CBM{r.cartonNote ? ` · ${r.cartonNote}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>ของเข้า (ชีท LK): {r.item_name || '(ไม่มีชื่อ)'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <input
                        value={r.sku}
                        onChange={(e) => setSku(r.id, e.target.value.trim())}
                        list="proforma-skus"
                        placeholder="พิมพ์ชื่อ/รหัส หรือกดรูปซ้าย"
                        style={{ ...inputStyle, flex: '0 0 200px', fontFamily: 'monospace', padding: '6px 10px' }}
                      />
                      {r.pm && <span style={{ fontSize: 11, color: 'var(--payi-success)' }}>✓ {r.description.slice(0, 40)}</span>}
                      {!r.pm && r.sku && <span style={{ fontSize: 11, color: 'var(--payi-danger)' }}>ไม่พบใน product_master</span>}
                    </div>
                  </div>
                </div>
              )))}
            </div>

            {picking && (
              <ProductImagePicker
                images={images}
                current={rows.find((r) => r.id === picking)?.sku || ''}
                onPick={(sku) => { setSku(picking, sku); setPicking(null) }}
                onClose={() => setPicking(null)}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, padding: '4px 2px' }}>
              <span>รวม {view.groups.length} รายการ</span>
              <span>{fmt(view.totals.qty)} ชิ้น · {view.totals.boxes} กล่อง · {view.totals.wt.toFixed(1)} กก. · {view.totals.cbm.toFixed(2)} CBM</span>
            </div>

            {view.warnings.length > 0 && (
              <div style={{ background: 'var(--payi-warning-bg)', color: 'var(--payi-warning)', borderRadius: 10, padding: '10px 12px', fontSize: 12, lineHeight: 1.6 }}>
                {view.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={labelStyle}>วันที่ออก (DATE)</label><input type="date" value={info.invoice_date} onChange={(e) => setInfo((d) => ({ ...d, invoice_date: e.target.value }))} style={inputStyle} /></div>
              <div><label style={labelStyle}>Shipping mark</label><input value={info.shipping_mark} onChange={(e) => setInfo((d) => ({ ...d, shipping_mark: e.target.value }))} style={inputStyle} placeholder="LK/A24xxx-1(EK)" /></div>
            </div>
            <div><label style={labelStyle}>ผู้รับ (To:)</label><textarea value={info.consignee_to} onChange={(e) => setInfo((d) => ({ ...d, consignee_to: e.target.value }))} style={{ ...inputStyle, minHeight: 54, resize: 'vertical' }} /></div>

            {gen && gen !== 'working' && gen !== 'done' && <div style={{ color: 'var(--payi-danger)', fontSize: 12 }}>{gen}</div>}
            {gen === 'done' && <div style={{ color: 'var(--payi-success)', fontSize: 12, fontWeight: 700 }}>✓ ดาวน์โหลดไฟล์แล้ว — เปิดไฟล์ใส่ Unit Price ให้พี่หยก แล้วส่ง LK</div>}

            <button onClick={makeFile} disabled={busy || gen === 'working' || view.missingSku > 0} style={{ ...primaryBtn, justifyContent: 'center', padding: '12px 16px', fontSize: 14, opacity: (busy || gen === 'working' || view.missingSku > 0) ? 0.5 : 1 }}>
              {gen === 'working' ? 'กำลังสร้างไฟล์...' : view.missingSku > 0 ? `จับคู่ SKU ให้ครบก่อน (เหลือ ${view.missingSku})` : 'คอนเฟิร์ม — สร้างไฟล์ Proforma'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', textAlign: 'center' }}>ไฟล์ที่ได้เหลือแค่ช่อง Unit Price ที่รอกรอก</div>
          </>
        )}
      </div>
    </Modal>
  )
}
