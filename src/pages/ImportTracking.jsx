import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, FileWarning, Send, Plus, Pencil, Trash2, X } from 'lucide-react'
import KpiCard from '../components/KpiCard'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })

const DOC_STYLE = {
  'ครบ': { bg: 'var(--payi-success-bg)', color: 'var(--payi-success)' },
  'ค้าง': { bg: '#fff7ed', color: '#c2410c' },
  'ยังไม่เริ่ม': { bg: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' },
}

function DocBadge({ status }) {
  const style = DOC_STYLE[status] || DOC_STYLE['ยังไม่เริ่ม']
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: style.bg, color: style.color }}>
      {status}
    </span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 540, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{title}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputStyle = { width: '100%', border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 5, display: 'block' }
const iconBtnStyle = (color) => ({
  border: '1px solid var(--payi-border)', background: 'var(--payi-surface-muted)', color,
  width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center',
  cursor: 'pointer', lineHeight: 1,
})

const DOC_FIELDS = [
  ['draft_doc', 'ใบดราฟ'],
  ['customs_draft', 'ใบขน (ดราฟ)'],
  ['customs_actual', 'ใบขน (ใช้จริง)'],
  ['tax_invoice', 'ใบกำกับภาษี'],
  ['withholding_tax', 'หัก ณ ที่จ่าย'],
  ['accounting_notice', 'ใบทักบัญชี'],
]
const HANDOVER_FIELDS = [
  ['sent_accounting', 'ส่งบัญชีแล้ว'],
  ['sent_joy', 'ส่งคุณจอยแล้ว'],
  ['printed', 'พิมพ์แล้ว (PRNT)'],
]

export default function ImportTracking() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyPendingDocs, setOnlyPendingDocs] = useState(false)
  const [modal, setModal] = useState(null) // null | 'new' | order object

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    fetch('/api/sheet-tools?op=import-tracking')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error(d.error || 'โหลดข้อมูลไม่สำเร็จ')
        setData(d)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const items = data?.items || []
  const totals = data?.totals || { totalOrders: 0, pendingDocs: 0, pendingHandover: 0 }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = items
    if (q) rows = rows.filter((it) => it.item_name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q) || it.bill_no.toLowerCase().includes(q) || it.customs_no.toLowerCase().includes(q))
    if (onlyPendingDocs) rows = rows.filter((it) => it.docStatus !== 'ครบ')
    return rows
  }, [items, query, onlyPendingDocs])

  const save = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=import-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setModal(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleField = (order, field) => save({ id: order.id, [field]: !order[field] })

  const remove = async (order) => {
    if (!window.confirm(`ลบรายการ "${order.item_name}" ?`)) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=import-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: order.id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'ลบไม่สำเร็จ')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {error && (
        <div style={{ background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{error}</div>
      )}

      <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KpiCard title="รายการนำเข้า" value={fmt(totals.totalOrders)} subtitle="ทั้งหมด" icon={Package} trend={null} />
        <KpiCard title="เอกสารค้าง" value={fmt(totals.pendingDocs)} subtitle="ยังไม่ครบ" icon={FileWarning} trend={null} />
        <KpiCard title="ยังไม่ส่งต่อ" value={fmt(totals.pendingHandover)} subtitle="บัญชี/คุณจอย" icon={Send} trend={null} />
      </div>

      <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 20, padding: 20, boxShadow: '0 14px 36px rgba(15,23,42,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>รายการนำเข้า ({filtered.length})</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyPendingDocs} onChange={(e) => setOnlyPendingDocs(e.target.checked)} />
              เฉพาะเอกสารค้าง
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาสินค้า/เลขบิล/เลขใบขน..." style={{ ...inputStyle, width: 240 }} />
            <button
              onClick={() => setModal('new')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}
            >
              <Plus size={14} /> เพิ่มรายการนำเข้า
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>ยังไม่มีรายการนำเข้า — กด "เพิ่มรายการนำเข้า" เพื่อเริ่มต้น</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '28%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px' }}>วันที่</th>
                  <th style={{ padding: '8px 10px' }}>สินค้า</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>จำนวน</th>
                  <th style={{ padding: '8px 10px' }}>เอกสาร</th>
                  <th style={{ padding: '8px 10px' }}>ส่งต่อ</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={{ padding: '10px', color: 'var(--payi-text-muted)' }}>{it.date}</td>
                    <td style={{ padding: '10px', overflow: 'hidden' }}>
                      <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.item_name}>{it.item_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>
                        {it.sku || '—'}{it.bill_no ? ` · บิล ${it.bill_no}` : ''}{it.customs_no ? ` · ใบขน ${it.customs_no}` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{fmt(it.qty)}</td>
                    <td style={{ padding: '10px' }}>
                      <button onClick={() => setModal(it)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                        <DocBadge status={it.docStatus} />
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {HANDOVER_FIELDS.map(([field, label]) => (
                          <button
                            key={field}
                            onClick={() => toggleField(it, field)}
                            title={label}
                            style={{
                              fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999, border: 'none', cursor: 'pointer',
                              background: it[field] ? 'var(--payi-success-bg)' : 'var(--payi-surface-muted)',
                              color: it[field] ? 'var(--payi-success)' : 'var(--payi-text-faint)',
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModal(it)} title="แก้ไข" style={iconBtnStyle('var(--payi-text-muted)')}><Pencil size={13} /></button>
                        <button onClick={() => remove(it)} title="ลบ" style={iconBtnStyle('var(--payi-danger)')}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <OrderModal
          initial={modal === 'new' ? null : modal}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

function OrderModal({ initial, saving, onClose, onSave }) {
  const isEdit = Boolean(initial)
  const [date, setDate] = useState(initial?.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))
  const [itemName, setItemName] = useState(initial?.item_name || '')
  const [sku, setSku] = useState(initial?.sku || '')
  const [qty, setQty] = useState(initial?.qty ?? '')
  const [billNo, setBillNo] = useState(initial?.bill_no || '')
  const [customsNo, setCustomsNo] = useState(initial?.customs_no || '')
  const [trackingNo, setTrackingNo] = useState(initial?.tracking_no || '')
  const [note, setNote] = useState(initial?.note || '')
  const [flags, setFlags] = useState(() => Object.fromEntries(
    [...DOC_FIELDS, ...HANDOVER_FIELDS].map(([f]) => [f, initial?.[f] || false])
  ))

  const submit = (e) => {
    e.preventDefault()
    if (!itemName.trim()) return
    onSave({
      id: initial?.id,
      date, item_name: itemName.trim(), sku: sku.trim(), qty,
      bill_no: billNo, customs_no: customsNo, tracking_no: trackingNo, note,
      ...flags,
    })
  }

  return (
    <Modal title={isEdit ? 'แก้ไขรายการนำเข้า' : 'เพิ่มรายการนำเข้า'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>วันที่</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>รหัสสินค้า (SKU) — ไม่บังคับ</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} style={inputStyle} placeholder="เช่น PY006" />
          </div>
        </div>
        <div>
          <label style={labelStyle}>ชื่อสินค้า</label>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} required style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>จำนวน</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} placeholder="0" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>เลขบิล</label>
            <input value={billNo} onChange={(e) => setBillNo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>เลขที่ใบขน — ไม่บังคับ</label>
            <input value={customsNo} onChange={(e) => setCustomsNo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>เลขพัสดุ</label>
            <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ background: 'var(--payi-surface-muted)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>เอกสาร/ภาษี</div>
          {DOC_FIELDS.map(([field, label]) => (
            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={flags[field]} onChange={(e) => setFlags((d) => ({ ...d, [field]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>

        <div style={{ background: 'var(--payi-surface-muted)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>ส่งต่องาน</div>
          {HANDOVER_FIELDS.map(([field, label]) => (
            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={flags[field]} onChange={(e) => setFlags((d) => ({ ...d, [field]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>

        <div>
          <label style={labelStyle}>หมายเหตุ</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} placeholder="ไม่บังคับ" />
        </div>
        <button type="submit" disabled={saving} style={{ marginTop: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </form>
    </Modal>
  )
}
