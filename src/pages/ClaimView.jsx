import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Upload, ChevronDown, X, ExternalLink, Pencil, Check } from 'lucide-react'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const API_BASE_C = '/api'
const fmtC = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const FLAG_COLORS = { damaged: '#ef4444', incomplete: '#f59e0b', wrong: '#8b5cf6', unspecified: '#94a3b8' }
const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const pctColor = pct => {
  if (pct === null || pct === undefined) return '#94a3b8'
  if (pct > 0) return '#dc2626'
  if (pct < 0) return '#16a34a'
  return '#94a3b8'
}
const fmtPct = pct => {
  if (pct === null || pct === undefined) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct}%`
}

// ต้องตรงกับ candidate keys ใน pick() ของ api/claims-import.js —
// ชีตต้นทางเคลมมักมีคอลัมน์เยอะ (dropdown validation, สูตรช่วยกรอก ฯลฯ) เกินกว่าที่ backend ใช้จริง
// ไม่กรองก่อนส่ง payload ใหญ่เกิน limit ของ serverless function แล้วได้ "Request Entity Too Large"
// กลับมาเป็น HTML แทน JSON (เหมือนที่ Upload.jsx เจอกับไฟล์ order มาก่อน)
const CLAIM_HEADER_HINTS = [
  'date', 'วันที่',
  'business', 'ธุรกิจ', 'แบรนด์', 'brand',
  'product_name', 'ชื่อสินค้า', 'สินค้า', 'product',
  'alias_variation', 'variation_name', 'variation', 'ตัวเลือกสินค้า', 'ประเภทสินค้า', 'แบบ', 'ไซซ์', 'ขนาด', 'สี',
  'master_sku', 'sku_platform', 'seller_sku', 'sku', 'รหัสสินค้า', 'รหัส sku',
  'free_item', 'ของแถม', 'สินค้าที่แถม', 'เสียฟรี',
  'claim_value', 'มูลค่า', 'มูลค่าเคลม', 'value',
  'is_damaged', 'เสียหาย', 'พัง', 'damaged',
  'is_incomplete', 'ส่งไม่ครบ', 'ไม่ครบ', 'incomplete',
  'is_wrong_item', 'ส่งผิด', 'ผิด', 'wrong',
  'note', 'หมายเหตุ', 'remark',
]
const normalizeClaimHeader = (s) => String(s || '').trim().toLowerCase()
function slimClaimRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    const nk = normalizeClaimHeader(k)
    if (CLAIM_HEADER_HINTS.some((h) => nk === h || nk.includes(h))) out[k] = v
  }
  return out
}
const CLAIM_BATCH_SIZE = 3000
const hasValues = row => Object.values(row || {}).some(value => String(value ?? '').trim() !== '')

function ClaimRateCell({ item, padding = '11px 14px' }) {
  const ready = item.claimRate != null
  return <td style={{ padding, textAlign: 'right', fontWeight: 700, color: ready ? '#dc2626' : '#94a3b8' }}>
    <div>{ready ? `${item.claimRate.toFixed(2)}%` : '—'}</div>
    <div style={{ marginTop: 2, fontSize: 10, fontWeight: 500, color: '#94a3b8', whiteSpace: 'nowrap' }}>
      {ready ? `${fmtC(item.count)} ÷ ${fmtC(item.outgoingUnits)}` : `Map ${item.mappingCoverage || 0}% · ออก ${fmtC(item.outgoingUnits)}`}
    </div>
  </td>
}

// ============================================================
// COMPONENT: เครื่องมือลบประวัติล็อตไฟล์แบบซ่อนจิ๋ว
// ============================================================
function ClearClaimsPanel({ onResetSuccess }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [selectedFileId, setSelectedFileId] = useState('')

  const loadUploadedFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_C}/claims?view=imports-list`)
      const data = await res.json()
      if (data.success && Array.isArray(data.files)) setUploadedFiles(data.files)
    } catch (err) { console.error(err) }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(loadUploadedFiles, 0)
    return () => clearTimeout(timer)
  }, [isOpen, loadUploadedFiles])

  const handleClearSelectedClaim = async () => {
    if (!selectedFileId) return
    if (!window.confirm("⚠️ ยืนยันต้องการลบข้อมูลล็อตไฟล์นี้ออกจากตารางหลัก?")) return
    setIsDeleting(true)
    try {
      const res = await fetch(`${API_BASE_C}/claims?view=import&importId=${encodeURIComponent(selectedFileId)}`, { method: 'DELETE' })
      const resData = await res.json()
      if (resData.success) {
        alert("🗑️ ลบข้อมูลล็อตไฟล์เรียบร้อย"); setSelectedFileId(''); loadUploadedFiles(); onResetSuccess()
      }
    } catch (err) { alert(err.message) } finally { setIsDeleting(false) }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setIsOpen(!isOpen)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
        {isOpen ? '🔽 ซ่อนเมนูลบไฟล์' : '⚙️ ลบประวัติไฟล์ล็อตเฉพาะชุด'}
      </button>
      {isOpen && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginTop: 6, display: 'flex', gap: 8 }}>
          <select value={selectedFileId} onChange={(e) => setSelectedFileId(e.target.value)} style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 11 }}>
            <option value="">-- เลือกไฟล์เคลมที่จะลบ --</option>
            {uploadedFiles.map((f, i) => <option key={i} value={f.import_id}>📄 {f.file_name || f.import_id} ({f.row_count} แถว)</option>)}
          </select>
          <button onClick={handleClearSelectedClaim} disabled={isDeleting || !selectedFileId} style={{ background: !selectedFileId ? '#cbd5e1' : '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>
            ลบ
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// COMPONENT: Accordion ทั่วไป
// ============================================================
function AccordionSection({ title, icon, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, marginBottom: 16, overflow: 'hidden' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', padding: '16px 20px',
          fontSize: 13, fontWeight: 700, color: '#111827',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{icon} {title}</span>
        <ChevronDown size={16} style={{ color: '#94a3b8', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {isOpen && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  )
}

// ============================================================
// COMPONENT: ตาราง 1 — สรุปเคลมรายเดือน
// ============================================================
function MonthlyClaimSummary({ data }) {
  if (!data) return <div style={{ fontSize: 12, color: '#94a3b8' }}>กำลังโหลดข้อมูล...</div>
  const { monthly, monthlyTotal } = data

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left' }}>เดือน</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>จำนวนรายการ</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>สินค้าออก</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>% เคลม/ออก</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>มูลค่ารวม (฿)</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', color: FLAG_COLORS.damaged }}>เสียหาย</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', color: FLAG_COLORS.incomplete }}>ส่งไม่ครบ</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', color: FLAG_COLORS.wrong }}>ส่งผิด</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', color: FLAG_COLORS.unspecified }}>ไม่ระบุ</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>%เปลี่ยนแปลง</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((m, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '11px 14px', color: '#1e293b' }}>{THAI_MONTHS[i]}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>{fmtC(m.count)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>{fmtC(m.outgoingUnits)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: m.claimRate == null ? '#94a3b8' : '#dc2626' }}>{m.claimRate == null ? '—' : `${m.claimRate.toFixed(2)}%`}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: m.value > 0 ? '#dc2626' : '#cbd5e1', background: m.value > 0 ? '#fef2f2' : 'transparent' }}>
                {m.value > 0 ? `฿${fmtC(m.value)}` : '฿0'}
              </td>
              <td style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>{fmtC(m.damaged)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>{fmtC(m.incomplete)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>{fmtC(m.wrong)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', color: '#94a3b8' }}>{fmtC(m.unspecified)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 600, color: pctColor(m.pctChange) }}>{fmtPct(m.pctChange)}</td>
            </tr>
          ))}
          <tr style={{ background: '#f8fafc', fontWeight: 800, color: '#111827' }}>
            <td style={{ padding: '12px 14px' }}>รวมทั้งปี</td>
            <td style={{ padding: '12px 14px', textAlign: 'right' }}>{fmtC(monthlyTotal.count)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right' }}>{fmtC(monthlyTotal.outgoingUnits)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right', color: '#dc2626' }}>{monthlyTotal.claimRate == null ? '—' : `${monthlyTotal.claimRate.toFixed(2)}%`}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right', color: '#dc2626' }}>฿{fmtC(monthlyTotal.value)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right' }}>{fmtC(monthlyTotal.damaged)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right' }}>{fmtC(monthlyTotal.incomplete)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right' }}>{fmtC(monthlyTotal.wrong)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right', color: '#94a3b8' }}>{fmtC(monthlyTotal.unspecified)}</td>
            <td style={{ padding: '12px 14px', textAlign: 'right', color: pctColor(monthlyTotal.pctChange) }}>{fmtPct(monthlyTotal.pctChange)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ============================================================
// COMPONENT: ตาราง 2 — สรุปเคลมแยกตามแบรนด์
// ============================================================
function BrandClaimSummary({ data }) {
  if (!data) return <div style={{ fontSize: 12, color: '#94a3b8' }}>กำลังโหลดข้อมูล...</div>
  const { businesses, byBusinessMonthly, byBusinessTotal } = data
  if (!businesses || businesses.length === 0) {
    return <div style={{ fontSize: 12, color: '#94a3b8' }}>ยังไม่มีข้อมูลแบรนด์</div>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th rowSpan={2} style={{ padding: '10px 14px', textAlign: 'left', verticalAlign: 'bottom' }}>เดือน</th>
            {businesses.map(b => (
              <th key={b} colSpan={3} style={{ padding: '10px 14px', textAlign: 'center', borderLeft: '1px solid #e2e8f0' }}>{b}</th>
            ))}
          </tr>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#94a3b8', fontSize: 11 }}>
            {businesses.map(b => (
              <>
                <th key={`${b}-value`} style={{ padding: '6px 14px', textAlign: 'right', borderLeft: '1px solid #e2e8f0' }}>มูลค่า (฿)</th>
                <th key={`${b}-count`} style={{ padding: '6px 14px', textAlign: 'right' }}>รายการ</th>
                <th key={`${b}-pct`} style={{ padding: '6px 14px', textAlign: 'right' }}>%MoM</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {byBusinessMonthly.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '11px 14px', color: '#1e293b' }}>{THAI_MONTHS[i]}</td>
              {businesses.map(b => (
                <>
                  <td key={`${b}-value-${i}`} style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: row[b].value > 0 ? '#2563eb' : '#cbd5e1', borderLeft: '1px solid #f1f5f9' }}>
                    {row[b].value > 0 ? `฿${fmtC(row[b].value)}` : '฿0'}
                  </td>
                  <td key={`${b}-count-${i}`} style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>{fmtC(row[b].count)}</td>
                  <td key={`${b}-pct-${i}`} style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 600, color: pctColor(row[b].pctChange) }}>{fmtPct(row[b].pctChange)}</td>
                </>
              ))}
            </tr>
          ))}
          <tr style={{ background: '#f8fafc', fontWeight: 800, color: '#111827' }}>
            <td style={{ padding: '12px 14px' }}>รวมทั้งปี</td>
            {businesses.map(b => (
              <>
                <td key={`${b}-total-value`} style={{ padding: '12px 14px', textAlign: 'right', color: '#2563eb', borderLeft: '1px solid #e2e8f0' }}>฿{fmtC(byBusinessTotal[b].value)}</td>
                <td key={`${b}-total-count`} style={{ padding: '12px 14px', textAlign: 'right' }}>{fmtC(byBusinessTotal[b].count)}</td>
                <td key={`${b}-total-pct`} style={{ padding: '12px 14px', textAlign: 'right', color: '#94a3b8' }}>—</td>
              </>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}


// ============================================================
// COMPONENT: Product Detail Popup Panel (เหมือนหน้ายอดขาย)
// ============================================================
function SkuDetailPanel({ masterSku, productKey, displayName, skuCount, startDate, endDate, business, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [freeItemProducts, setFreeItemProducts] = useState([])

  useEffect(() => {
    fetch(`${API_BASE_C}/claims?view=mapping-options`).then((r) => r.json()).then((d) => {
      if (d.success) setFreeItemProducts(d.products || [])
    }).catch(() => {})
  }, [])

  const buildParams = () => {
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (business) params.set('business', business)
    params.set('view', 'sku')
    if (productKey) params.set('productKey', productKey)
    else params.set('sku', masterSku)
    return params
  }

  const reload = async () => {
    try {
      const response = await fetch(`${API_BASE_C}/claims?${buildParams()}`)
      const result = await response.json()
      if (result.success) setDetail(result); else setErr(result.error)
    } catch (error) { setErr(error.message) }
  }

  useEffect(() => {
    if (!masterSku && !productKey) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setErr(null)
      try {
        const response = await fetch(`${API_BASE_C}/claims?${buildParams()}`, { signal: controller.signal })
        const result = await response.json()
        if (result.success) setDetail(result); else setErr(result.error)
      } catch (error) {
        if (error.name !== 'AbortError') setErr(error.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [masterSku, productKey, startDate, endDate, business])

  const startEdit = (rec) => { setEditingId(rec.id); setEditDraft({ is_damaged: rec.is_damaged, is_incomplete: rec.is_incomplete, is_wrong_item: rec.is_wrong_item, note: rec.note || '', free_item: rec.free_item || '', claim_value: rec.claim_value || '' }) }
  const cancelEdit = () => { setEditingId(''); setEditDraft({}) }
  const saveEdit = async (id) => {
    setSaving(true)
    try {
      const r = await fetch(`${API_BASE_C}/claims?view=update-claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...editDraft }) })
      const d = await r.json()
      if (!d.success) { alert(d.error || 'บันทึกไม่สำเร็จ'); return }
      setEditingId(''); setEditDraft({}); await reload()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(3px)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 20, width: 'min(1120px, 94vw)', maxWidth: 1120,
        maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>{productKey ? 'สินค้า' : 'MASTER SKU'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, fontFamily: productKey ? 'inherit' : 'monospace', fontWeight: 800, color: '#2563eb' }}>{productKey ? (displayName || masterSku) : masterSku}</span>
              {productKey && skuCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 999, padding: '3px 8px' }}>รวม {fmtC(skuCount)} SKU</span>}
              {!productKey && <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{displayName}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: '#94a3b8', fontSize: 13 }}>
              กำลังโหลดข้อมูล...
            </div>
          )}
          {err && (
            <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px', color: '#dc2626', fontSize: 12 }}>
              ⚠️ {err}
            </div>
          )}
          {detail && !loading && (
            <>
              {/* KPI Cards */}
              <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'เคสเคลมทั้งหมด', value: fmtC(detail.totalCount), color: '#2563eb', bg: '#eff6ff' },
                  { label: 'มูลค่าความเสียหาย', value: `฿${fmtC(detail.totalValue)}`, color: '#dc2626', bg: '#fef2f2' },
                ].map((k, i) => (
                  <div key={i} style={{ background: k.bg, borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{k.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* สรุปตามเหตุผล */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10 }}>สาเหตุของการเคลม</div>
                <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { key: 'damaged',     label: '🔴 เสียหาย',     color: FLAG_COLORS.damaged },
                    { key: 'incomplete',  label: '🟡 ส่งไม่ครบ',   color: FLAG_COLORS.incomplete },
                    { key: 'wrong',       label: '🟣 ส่งผิด',      color: FLAG_COLORS.wrong },
                    { key: 'unspecified', label: '⚪ ไม่ระบุ',     color: FLAG_COLORS.unspecified },
                  ].map(r => {
                    const d = detail.reasonSummary?.[r.key] || { count: 0, value: 0 }
                    return (
                      <div key={r.key} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', borderLeft: `3px solid ${r.color}` }}>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{r.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: r.color }}>{fmtC(d.count)}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>฿{fmtC(d.value)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* แยกตามแบรนด์ */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>แนวโน้มเคลมรายเดือน</div>
                {detail.monthlyTrend?.length ? <ResponsiveContainer width="100%" height={170}><LineChart data={detail.monthlyTrend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis allowDecimals={false}/><Tooltip/><Line type="monotone" dataKey="count" name="จำนวนเคลม" stroke="#ef4444" strokeWidth={2} dot/></LineChart></ResponsiveContainer> : <div style={{ padding: 18, borderRadius: 10, background: '#f8fafc', color: '#94a3b8', fontSize: 12 }}>ยังไม่มีข้อมูลรายเดือนสำหรับสินค้านี้</div>}
              </div>

              {/* รายการเคลม */}
              {detail.records?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10 }}>
                    รายการเคลมทั้งหมด ({fmtC(detail.records.length)} รายการ)
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', minWidth: 640, tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', color: '#64748b' }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', width: 92 }}>วันที่</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', width: 74 }}>แบรนด์</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left' }}>สินค้าที่เคลม</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', width: 86 }}>มูลค่า (฿)</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center', width: 54 }}>เสียหาย</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center', width: 54 }}>ไม่ครบ</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center', width: 42 }}>ผิด</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left' }}>เสียฟรี/หมายเหตุ</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center', width: 56 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.records.map((rec, i) => {
                          const isEditing = rec.id && editingId === rec.id
                          return (
                          <tr key={rec.id || i} style={{ borderBottom: '1px solid #f8fafc', background: isEditing ? '#eff6ff' : 'transparent' }}
                            onMouseEnter={e => { if (!isEditing) e.currentTarget.style.background = '#f8fafc' }}
                            onMouseLeave={e => { if (!isEditing) e.currentTarget.style.background = 'transparent' }}
                          >
                            <td style={{ padding: '8px 10px', color: '#64748b' }}>{rec.date}</td>
                            <td style={{ padding: '8px 10px', color: '#1e293b' }}>{rec.business}</td>
                            <td style={{ padding: '8px 10px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rec.display_name || rec.product_name || rec.master_sku}>
                              {rec.display_name || rec.product_name || rec.master_sku || '—'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>
                              {isEditing
                                ? <input type="number" value={editDraft.claim_value} onChange={e => setEditDraft({ ...editDraft, claim_value: e.target.value })} style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', textAlign: 'right' }} placeholder="0" />
                                : (rec.claim_value > 0 ? <span style={{ color: '#dc2626' }}>{`฿${fmtC(rec.claim_value)}`}</span> : <span style={{ color: '#cbd5e1' }}>—</span>)}
                            </td>
                            {isEditing ? <>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}><input type="checkbox" checked={!!editDraft.is_damaged} onChange={e => setEditDraft({ ...editDraft, is_damaged: e.target.checked })} /></td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}><input type="checkbox" checked={!!editDraft.is_incomplete} onChange={e => setEditDraft({ ...editDraft, is_incomplete: e.target.checked })} /></td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}><input type="checkbox" checked={!!editDraft.is_wrong_item} onChange={e => setEditDraft({ ...editDraft, is_wrong_item: e.target.checked })} /></td>
                              <td style={{ padding: '8px 10px' }}>
                                <input
                                  list="sku-detail-free-items"
                                  value={editDraft.free_item}
                                  onChange={e => {
                                    const value = e.target.value
                                    const matched = freeItemProducts.find((p) => p.display_name.toLowerCase() === value.toLowerCase())
                                    const patch = { ...editDraft, free_item: value }
                                    if (matched?.retail_price && (!editDraft.claim_value || Number(editDraft.claim_value) === 0)) patch.claim_value = String(matched.retail_price)
                                    setEditDraft(patch)
                                  }}
                                  style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', marginBottom: 4 }}
                                  placeholder="เสียฟรี"
                                />
                                <input value={editDraft.note} onChange={e => setEditDraft({ ...editDraft, note: e.target.value })} style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px' }} placeholder="หมายเหตุ" />
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <button onClick={() => saveEdit(rec.id)} disabled={saving} title="บันทึก" style={{ border: 0, background: '#16a34a', color: '#fff', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', marginRight: 4 }}><Check size={12} /></button>
                                <button onClick={cancelEdit} disabled={saving} title="ยกเลิก" style={{ border: 0, background: '#e2e8f0', color: '#475569', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}><X size={12} /></button>
                              </td>
                            </> : <>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>{rec.is_damaged ? <span style={{ color: FLAG_COLORS.damaged, fontWeight: 700 }}>●</span> : <span style={{ color: '#e2e8f0' }}>○</span>}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>{rec.is_incomplete ? <span style={{ color: FLAG_COLORS.incomplete, fontWeight: 700 }}>●</span> : <span style={{ color: '#e2e8f0' }}>○</span>}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>{rec.is_wrong_item ? <span style={{ color: FLAG_COLORS.wrong, fontWeight: 700 }}>●</span> : <span style={{ color: '#e2e8f0' }}>○</span>}</td>
                              <td style={{ padding: '8px 10px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={[rec.free_item, rec.note].filter(Boolean).join(' · ')}>
                                {[rec.free_item, rec.note].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                {rec.id && <button onClick={() => startEdit(rec)} title="แก้ไข" style={{ border: 0, background: '#f1f5f9', color: '#2563eb', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}><Pencil size={12} /></button>}
                              </td>
                            </>}
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <datalist id="sku-detail-free-items">
                      {[...new Set(freeItemProducts.map((p) => p.display_name).filter(Boolean))].map((name) => <option key={name} value={name} />)}
                    </datalist>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// COMPONENT: กรอกเคลมเองจากหน้าเว็บ (ไม่ต้องผ่าน Excel import) — owner ขอ 2026-08-01
// ============================================================
const BUSINESS_OPTIONS = ['Payi', 'Payi Outlet', 'กรอบรูป']
// แถวว่างใหม่ — สืบ วันที่/ธุรกิจ จากแถวล่าสุด (สะดวกเวลากรอกทีละหลายแถวของวันเดียวกัน) เหมือนลากสูตรในชีท
const emptyClaimRow = (last) => ({
  _key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  date: last?.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
  business: last?.business || BUSINESS_OPTIONS[0],
  master_sku: '', claim_value: '', free_item: '',
  is_damaged: false, is_incomplete: false, is_wrong_item: false, note: '',
})

function AddClaimModal({ onClose, onSaved }) {
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [rows, setRows] = useState([emptyClaimRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_BASE_C}/claims?view=mapping-options`).then((r) => r.json()).then((d) => {
      if (d.success) setProducts(d.products || [])
    }).catch(() => {}).finally(() => setProductsLoading(false))
  }, [])

  const productByKey = (sku) => products.find((p) => p.master_sku === sku)
  const patchRow = (key, patch) => setRows((current) => current.map((r) => (r._key === key ? { ...r, ...patch } : r)))
  const addRow = () => setRows((current) => [...current, emptyClaimRow(current[current.length - 1])])
  const removeRow = (key) => setRows((current) => (current.length > 1 ? current.filter((r) => r._key !== key) : current))

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  // วางจากชีต/Excel — แต่ละแถวคั่นด้วย tab ลำดับคอลัมน์: วันที่, SKU, มูลค่า, เสียฟรี, หมายเหตุ (เว้นได้)
  // จับคู่ SKU ด้วยการหาคำที่ขึ้นต้นตรงกับ master_sku ก่อน ไม่ตรงค่อย fallback ไปหาในชื่อสินค้า
  const handlePaste = (e) => {
    const text = e.clipboardData?.getData('text') || ''
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return // แถวเดียว/พิมพ์ปกติ ปล่อยให้พฤติกรรม paste เดิมของ input ทำงานต่อ
    e.preventDefault()
    const pasted = lines.map((line) => {
      const cols = line.split('\t')
      const [date, skuRaw, claimValue, freeItem, note] = cols
      const skuGuess = String(skuRaw || '').trim()
      const match = products.find((p) => p.master_sku.toLowerCase() === skuGuess.toLowerCase())
        || products.find((p) => p.display_name.toLowerCase().includes(skuGuess.toLowerCase()))
      return {
        ...emptyClaimRow(),
        date: date?.trim() || emptyClaimRow().date,
        master_sku: match?.master_sku || '',
        claim_value: (claimValue || '').trim(),
        free_item: (freeItem || '').trim(),
        note: (note || '').trim(),
      }
    })
    setRows((current) => {
      const withoutBlankLast = current.length === 1 && !current[0].master_sku && !current[0].claim_value ? [] : current
      return [...withoutBlankLast, ...pasted]
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    const missing = rows.findIndex((r) => !r.master_sku)
    if (missing !== -1) { setError(`แถวที่ ${missing + 1}: กรุณาเลือกสินค้า`); return }
    setSaving(true); setError('')
    try {
      const r = await fetch(`${API_BASE_C}/claims?view=create-claims-bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map(({ _key, ...rest }) => rest) }),
      })
      const d = await r.json()
      if (!d.success) { setError(d.error || 'บันทึกไม่สำเร็จ'); return }
      onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const cellStyle = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, width: '100%', boxSizing: 'border-box' }
  const thStyle = { fontSize: 11, fontWeight: 700, color: '#64748b', textAlign: 'left', padding: '0 6px 6px', whiteSpace: 'nowrap' }
  const tdStyle = { padding: '4px 6px', verticalAlign: 'top' }

  return (
    <div onClick={handleBackdrop} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} onPaste={handlePaste} style={{ background: '#fff', borderRadius: 20, width: 'min(1080px, 96vw)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>เพิ่มเคลม</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>เพิ่มได้หลายรายการพร้อมกัน หรือคัดลอกจากชีต/Excel มาวางได้เลย (คอลัมน์: วันที่, SKU, มูลค่า, เสียฟรี, หมายเหตุ)</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
        </div>

        <div style={{ padding: '14px 24px', overflow: 'auto', flex: 1 }}>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', color: '#dc2626', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
          {productsLoading && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>กำลังโหลดรายชื่อสินค้า...</div>}

          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 130 }}>วันที่</th>
                <th style={{ ...thStyle, width: 110 }}>ธุรกิจ</th>
                <th style={{ ...thStyle, width: 220 }}>สินค้า</th>
                <th style={{ ...thStyle, width: 100 }}>มูลค่า</th>
                <th style={{ ...thStyle, width: 140 }}>เสียฟรี</th>
                <th style={{ ...thStyle, width: 150 }}>สาเหตุ</th>
                <th style={thStyle}>หมายเหตุ</th>
                <th style={{ ...thStyle, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const product = productByKey(row.master_sku)
                return (
                  <tr key={row._key}>
                    <td style={tdStyle}><input type="date" required value={row.date} onChange={(e) => patchRow(row._key, { date: e.target.value })} style={cellStyle} /></td>
                    <td style={tdStyle}>
                      <select value={row.business} onChange={(e) => patchRow(row._key, { business: e.target.value })} style={cellStyle}>
                        {BUSINESS_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input
                        list="add-claim-products"
                        value={product ? `${product.master_sku} · ${product.display_name}` : row.master_sku}
                        onChange={(e) => {
                          const raw = e.target.value
                          const sku = raw.split(' · ')[0].trim()
                          const match = products.find((p) => p.master_sku === sku)
                          patchRow(row._key, { master_sku: match ? match.master_sku : raw })
                        }}
                        placeholder="พิมพ์ค้นหา SKU/ชื่อ"
                        style={{ ...cellStyle, borderColor: row.master_sku && !product ? '#fca5a5' : '#e2e8f0' }}
                      />
                    </td>
                    <td style={tdStyle}><input type="number" min="0" step="0.01" value={row.claim_value} onChange={(e) => patchRow(row._key, { claim_value: e.target.value })} style={cellStyle} placeholder="0" /></td>
                    <td style={tdStyle}>
                      <input
                        list="add-claim-free-items"
                        value={row.free_item}
                        onChange={(e) => {
                          const value = e.target.value
                          const matched = products.find((p) => p.display_name.toLowerCase() === value.toLowerCase())
                          const patch = { free_item: value }
                          // เจอสินค้าตรงชื่อ + ยังไม่ได้กรอกมูลค่าเอง → เด้งราคาขายปลีกให้ (แก้ทับเองได้เสมอ)
                          if (matched?.retail_price && (!row.claim_value || Number(row.claim_value) === 0)) patch.claim_value = String(matched.retail_price)
                          patchRow(row._key, patch)
                        }}
                        style={cellStyle}
                        placeholder="พิมพ์ค้นหาชื่อสินค้า"
                      />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <label title="เสียหาย" style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, cursor: 'pointer' }}><input type="checkbox" checked={row.is_damaged} onChange={(e) => patchRow(row._key, { is_damaged: e.target.checked })} />เสีย</label>
                        <label title="ส่งไม่ครบ" style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, cursor: 'pointer' }}><input type="checkbox" checked={row.is_incomplete} onChange={(e) => patchRow(row._key, { is_incomplete: e.target.checked })} />ไม่ครบ</label>
                        <label title="ส่งผิด" style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, cursor: 'pointer' }}><input type="checkbox" checked={row.is_wrong_item} onChange={(e) => patchRow(row._key, { is_wrong_item: e.target.checked })} />ผิด</label>
                      </div>
                    </td>
                    <td style={tdStyle}><input value={row.note} onChange={(e) => patchRow(row._key, { note: e.target.value })} style={cellStyle} /></td>
                    <td style={tdStyle}>
                      <button type="button" onClick={() => removeRow(row._key)} disabled={rows.length === 1} style={{ background: 'none', border: 'none', color: rows.length === 1 ? '#cbd5e1' : '#ef4444', cursor: rows.length === 1 ? 'default' : 'pointer', padding: 4 }}><X size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="add-claim-products">
            {products.map((p) => <option key={p.master_sku} value={`${p.master_sku} · ${p.display_name}`} />)}
          </datalist>
          <datalist id="add-claim-free-items">
            {[...new Set(products.map((p) => p.display_name).filter(Boolean))].map((name) => <option key={name} value={name} />)}
          </datalist>

          <button type="button" onClick={addRow} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
            + เพิ่มแถว
          </button>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} รายการ</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>ยกเลิก</button>
            <button type="submit" disabled={saving} style={{ background: 'var(--payi-gradient-primary)', border: 'none', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'กำลังบันทึก...' : `บันทึก ${rows.length} รายการ`}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ============================================================
// COMPONENT: All SKUs Modal (ดูทั้งหมด)
// ============================================================
function AllSkusModal({ topSkus, onClose, onSelectSku }) {
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(3px)', zIndex: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 760,
        maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>
            🏆 อันดับสินค้าเสียทั้งหมด ({fmtC(topSkus.length)} สินค้า)
          </div>
          <button
            onClick={onClose}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>
        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', width: 36 }}>#</th>
                <th style={{ padding: '10px 16px', textAlign: 'left' }}>สินค้า</th>
                <th style={{ padding: '10px 16px', textAlign: 'right' }}>จำนวนเคส</th>
                <th style={{ padding: '10px 16px', textAlign: 'right' }}>% เคลม/สินค้าออก</th>
                <th style={{ padding: '10px 16px', textAlign: 'right' }}>มูลค่าทุนเสียหาย</th>
              </tr>
            </thead>
            <tbody>
              {topSkus.map((s, i) => (
                <tr
                  key={i}
                  onClick={() => { onSelectSku({ product_key: s.product_key, master_sku: s.master_sku || 'UNMAPPED', display_name: s.display_name || 'ชื่อสินค้าหลุดแมพ', skuCount: s.skuCount || 0 }); onClose() }}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '11px 16px', color: i < 3 ? '#f59e0b' : '#94a3b8', fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ padding: '11px 16px', color: '#1e293b', fontWeight: 700 }}>{s.display_name || 'ไม่ระบุชื่อสินค้า'}</td>
                  <td style={{ padding: '11px 16px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{fmtC(s.count)}</td>
                  <ClaimRateCell item={s} padding="11px 16px" />
                  <td style={{ padding: '11px 16px', textAlign: 'right', color: '#475569' }}>฿{fmtC(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function ClaimView() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState(null)
  const [startDate, setStart]   = useState('')
  const [endDate, setEnd]       = useState('')
  const [business] = useState('')
  const [productInput, setProductInput] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')
  const [ts, setTs]             = useState('')

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const [monthlyData, setMonthlyData] = useState(null)
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [selectedSku, setSelectedSku] = useState(null)
  const [showAllSkus, setShowAllSkus] = useState(false)
  const [mapTarget, setMapTarget] = useState('')
  const [mapOptions, setMapOptions] = useState([])
  const [mapSearch, setMapSearch] = useState('')
  const [mapSaving, setMapSaving] = useState(false)
  const [showAddClaim, setShowAddClaim] = useState(false)

  const loadMonthly = useCallback(async () => {
    setMonthlyLoading(true)
    try {
      const r = await fetch(`${API_BASE_C}/claims?view=monthly&year=${new Date().getFullYear()}`)
      const d = await r.json()
      if (d.success) setMonthlyData(d)
    } catch (e) { console.error(e) } finally { setMonthlyLoading(false) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(loadMonthly, 0)
    return () => clearTimeout(timer)
  }, [loadMonthly])

  useEffect(() => {
    const timer = setTimeout(() => setProductFilter(productInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [productInput])


  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate', endDate)
      if (business)  params.set('business', business)
      if (productFilter) params.set('product', productFilter)
      if (reasonFilter) params.set('reason', reasonFilter)
      
      params.set('view', 'summary')
      const r = await fetch(`${API_BASE_C}/claims?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setData(d)
      setTs(new Date().toLocaleTimeString('th-TH'))
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [startDate, endDate, business, productFilter, reasonFilter])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setImportResult(null)
    try {
      // xlsx มีขนาดใหญ่ — โหลดเฉพาะตอนผู้ใช้เลือกไฟล์ ไม่ถ่วงการเปิดหน้า Claims ปกติ
      const XLSX = await import('xlsx')
      // parse Excel ฝั่ง client แล้วส่ง JSON (ทำงานได้บน serverless โดยไม่ต้องมี multipart)
      const buf = await file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buf)
      const fileHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      // ชีตต้นทางบางไฟล์มีชื่อเรื่อง/คำอธิบายอยู่เหนือแถวหัวตารางจริง (เช่น "Row 5" ในไฟล์เคลม)
      // ถ้าอ่านแบบเดาว่าแถว 1 คือหัวตารางเลย ทุกคอลัมน์จะจับคู่ไม่ได้เลยสักคอลัมน์ — หาแถวหัวตารางจริงก่อน
      const arr = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      let headerRowIdx = 0, bestScore = -1
      for (let i = 0; i < Math.min(arr.length, 20); i++) {
        const score = (arr[i] || []).filter((cell) => {
          const nk = normalizeClaimHeader(cell)
          return nk && CLAIM_HEADER_HINTS.some((h) => nk === h || nk.includes(h))
        }).length
        if (score > bestScore) { bestScore = score; headerRowIdx = i }
      }
      // raw: false — เซลล์วันที่ในชีตต้นทางเป็น date type จริง (ไม่ใช่ข้อความ) ถ้าไม่บังคับ raw:false
      // จะได้ Excel serial number (เช่น 46000 กว่าๆ) แทนข้อความ "28/6/2026" แล้ว parse วันที่ฝั่ง backend ไม่ออก
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, range: headerRowIdx })
      const slim = rows.map(slimClaimRow).filter(hasValues)
      if (!slim.length) throw new Error('ไม่พบแถวข้อมูลเคลมในไฟล์')
      const batches = []
      for (let i = 0; i < slim.length; i += CLAIM_BATCH_SIZE) batches.push(slim.slice(i, i + CLAIM_BATCH_SIZE))

      let rowsImported = 0, mappedCount = 0, unmappedCount = 0, skippedInvalid = 0, skippedBlank = 0
      const importId = `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const skippedSamples = []
      const unmappedSamples = []
      for (let i = 0; i < batches.length; i++) {
        setImportResult({ success: true, inProgress: true, note: `กำลังนำเข้า batch ${i + 1}/${batches.length}...` })
        const r = await fetch(`${API_BASE_C}/claims-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileHash, importId, rows: batches[i] }),
        })
        const d = await r.json()
        if (!d.success) {
          setImportResult({ ...d, error: d.duplicate ? `ไฟล์ “${file.name}” เคยนำเข้าแล้ว (Import ID: ${d.existingImportId || 'ไม่ระบุ'})` : d.error })
          setImporting(false); return
        }
        rowsImported += d.rowsImported || 0
        mappedCount += d.mappedCount || 0
        unmappedCount += d.unmappedCount || 0
        skippedInvalid += d.skippedInvalid || 0
        skippedBlank += d.skippedBlank || 0
        if (skippedSamples.length < 5) skippedSamples.push(...(d.skippedSamples || []))
        for (const name of (d.unmappedSamples || [])) if (unmappedSamples.length < 20 && !unmappedSamples.includes(name)) unmappedSamples.push(name)
      }
      setImportResult({ success: true, importId, rowsImported, mappedCount, unmappedCount, unmappedSamples, skippedInvalid, skippedSamples: skippedSamples.slice(0, 5), skippedBlank })
      load()
      loadMonthly()
    } catch (e) {
      setImportResult({ success: false, error: e.message })
    } finally {
      setImporting(false)
    }
    e.target.value = '' // reset เผื่ออัปโหลดไฟล์เดิมซ้ำ
  }

  const total = data?.totalClaims || 0;
  const value = data?.claimValue ?? data?.totalValue ?? 0;
  const damaged    = data?.damageCount    || 0
  const incomplete = data?.incompleteCount || 0
  const wrong      = data?.wrongItemCount  || 0
  const unspecified = data?.unspecifiedCount || 0
  // API จัดกลุ่มด้วย deriveGroup/product_aliases แบบเดียวกับ Product Dashboard
  // fallback ชื่อเดิมไว้ชั่วคราว เผื่อ response เก่ายังค้างอยู่ใน CDN cache
  const topProducts = data?.topClaimProducts || data?.topClaimSkus || []
  const trend   = data?.claimByDate || []
  const runBackfill = async () => {
    if (!window.confirm('จับคู่ข้อมูลเคลมเดิมกับ product_aliases ตอนนี้?')) return
    const r = await fetch(`${API_BASE_C}/claims?view=backfill`, { method: 'POST' })
    const d = await r.json()
    if (!d.success) return alert(d.error || 'Backfill ไม่สำเร็จ')
    alert(`จับคู่ข้อมูลเดิมสำเร็จ ${d.updated} แถว${d.fuzzyUpdated ? ` (จับชื่อใกล้เคียงอัตโนมัติ ${d.fuzzyUpdated} แถว)` : ''}`); load()
  }
  const addProductMap = async (claimName) => {
    const optionsRes = await fetch(`${API_BASE_C}/claims?view=mapping-options`)
    const optionsData = await optionsRes.json()
    if (!optionsData.success) return alert(optionsData.error || 'โหลดรายการสินค้าไม่สำเร็จ')
    setMapTarget(claimName); setMapOptions(optionsData.products || []); setMapSearch('')
  }
  const saveProductMap = async (chosen) => {
    const claimName = mapTarget
    if (!window.confirm(`ยืนยัน Map\n${claimName}\n→ ${chosen.master_sku} ${chosen.display_name}`)) return
    setMapSaving(true)
    try {
      const r = await fetch(`${API_BASE_C}/claims?view=map-product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claimName, masterSku: chosen.master_sku }) })
      const d = await r.json()
      if (!d.success) return alert(d.error || 'เพิ่ม Map ไม่สำเร็จ')
      await fetch(`${API_BASE_C}/claims?view=backfill`, { method: 'POST' })
      setMapTarget(''); load()
      alert(`เพิ่ม Map สำเร็จ: ${claimName} → ${d.display_name}`)
    } finally { setMapSaving(false) }
  }

  return (
    <div style={{ width: '100%', fontFamily: 'system-ui, sans-serif', padding: '10px 4px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>อัปเดตล่าสุด {ts || '—'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input type="date" value={startDate} onChange={e => setStart(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#334155', background: '#f8fafc' }} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>ถึง</span>
          <input type="date" value={endDate} onChange={e => setEnd(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#334155', background: '#f8fafc' }} />
          <input value={productInput} onChange={e => setProductInput(e.target.value)} placeholder="ค้นหาสินค้า" style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 12 }} />
          <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 12 }}><option value="">ทุกสาเหตุ</option><option value="damaged">เสียหาย</option><option value="incomplete">ส่งไม่ครบ</option><option value="wrong">ส่งผิด</option><option value="unspecified">ไม่ระบุ</option></select>
          
          <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#111827', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> รีเฟรช
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
            <Upload size={14} /> {importing ? 'กำลังนำเข้าไฟล์...' : 'Import Excel ใบเคลม'}
            <input type="file" accept=".xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} disabled={importing} />
          </label>

          <button onClick={() => setShowAddClaim(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', color: '#2563eb', border: '1.5px solid #2563eb', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + เพิ่มเคลม
          </button>
        </div>
      </div>

      {showAddClaim && <AddClaimModal onClose={() => setShowAddClaim(false)} onSaved={() => { setShowAddClaim(false); load(); loadMonthly() }} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 18px', color: '#dc2626', fontSize: 12, marginBottom: 16 }}>⚠️ เกิดข้อผิดพลาด: {err}</div>}
      {importResult && (
        <div style={{ background: importResult.success ? '#f0fdf4' : '#fef2f2', border: `1px solid ${importResult.success ? '#bbf7d0' : '#fecaca'}`, borderRadius: 10, padding: '12px 18px', fontSize: 13, color: importResult.success ? '#15803d' : '#dc2626', marginBottom: 16 }}>
          {!importResult.success ? `❌ ผิดพลาด: ${importResult.error}`
            : importResult.inProgress ? `⏳ ${importResult.note}`
            : `✅ นำเข้าข้อมูลเคลมเรียบร้อยและเพิ่มเข้าตารางสำเร็จแล้วครับ (${importResult.rowsImported} แถว${importResult.skippedInvalid ? ` · ข้าม ${importResult.skippedInvalid} แถวที่วันที่อ่านไม่ออก` : ''}${importResult.skippedBlank ? ` · ข้าม ${importResult.skippedBlank} แถวว่าง` : ''})`}
          {importResult.skippedSamples?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
              ตัวอย่างค่าวันที่ที่อ่านไม่ออก (สูงสุด 5 แถว):
              {importResult.skippedSamples.map((s, i) => (
                <div key={i} style={{ fontFamily: 'monospace', marginTop: 2 }}>{i + 1}. "{String(s.dateRaw)}" (type: {s.dateRawType})</div>
              ))}
            </div>
          )}
          {importResult.success && !importResult.inProgress && (
            <div style={{ marginTop: 8, fontSize: 12 }}>จับคู่สำเร็จ <b>{fmtC(importResult.mappedCount)}</b> · ยังไม่จับคู่ <b style={{ color: importResult.unmappedCount ? '#dc2626' : 'inherit' }}>{fmtC(importResult.unmappedCount)}</b>
              {importResult.unmappedSamples?.length > 0 && (
                <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {importResult.unmappedSamples.map((name) => (
                    <span key={name} style={{ padding: '5px 8px', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8, color: '#92400e', fontSize: 11.5 }}>
                      {name} <button onClick={() => addProductMap(name)} style={{ marginLeft: 5, border: 0, background: '#eff6ff', color: '#2563eb', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontWeight: 700 }}>+ เพิ่ม Map</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* บล็อกพับเก็บปุ่มลบไฟล์ */}
      <ClearClaimsPanel onResetSuccess={() => { load(); loadMonthly() }} />

      {data?.mapping && (
        <div style={{ marginBottom: 16, padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <b>คุณภาพ Mapping</b><span style={{ color: '#15803d' }}>จับคู่แล้ว {fmtC(data.mapping.mapped)}</span><span style={{ color: '#dc2626' }}>ยังไม่จับคู่ {fmtC(data.mapping.unmapped)}</span>
          {data.mapping.unmapped > 0 && <button onClick={runBackfill} style={{ border: 0, borderRadius: 8, padding: '7px 12px', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>จับคู่ข้อมูลเดิมใหม่</button>}
          {data.mapping.unmappedProducts?.length > 0 && <button onClick={() => { const csv = ['product_name,count', ...data.mapping.unmappedProducts.map(x => `"${String(x.product_name).replaceAll('"','""')}",${x.count}`)].join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'claims-unmapped.csv'; a.click(); URL.revokeObjectURL(a.href) }} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', background: '#fff', cursor: 'pointer' }}>Export unmapped</button>}
          {data.mapping.unmappedProducts?.length > 0 && <div style={{ width: '100%', display: 'flex', gap: 7, flexWrap: 'wrap' }}>{data.mapping.unmappedProducts.slice(0, 10).map(x => <span key={x.product_name} style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 8, color: '#64748b' }}>{x.product_name} ({x.count}) <button onClick={() => addProductMap(x.product_name)} style={{ marginLeft: 5, border: 0, background: '#eff6ff', color: '#2563eb', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontWeight: 700 }}>+ เพิ่ม Map</button></span>)}</div>}
        </div>
      )}

      {/* Accordion: สรุปเคลมรายเดือน + สรุปเคลมแยกตามแบรนด์ */}
      <AccordionSection title={`สรุปเคลมรายเดือน (ทั้งปี ${new Date().getFullYear()})`} icon="📊">
        {monthlyLoading && !monthlyData ? <div style={{ fontSize: 12, color: '#94a3b8' }}>กำลังโหลด...</div> : <MonthlyClaimSummary data={monthlyData} />}
      </AccordionSection>

      <AccordionSection title="สรุปเคลมแยกตามแบรนด์ (รายเดือน)" icon="🏷️">
        {monthlyLoading && !monthlyData ? <div style={{ fontSize: 12, color: '#94a3b8' }}>กำลังโหลด...</div> : <BrandClaimSummary data={monthlyData} />}
      </AccordionSection>

      {/* สถิติการ์ดแดชบอร์ดหลัก */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        {[
          { title: 'เคสเคลมรวมทั้งหมด', value: fmtC(total), accent: '#2563eb' },
          { title: 'มูลค่ารวมความเสียหาย', value: `฿${fmtC(value)}`, accent: '#ef4444' },
          { title: 'สินค้าเสีย/พัง', value: fmtC(damaged), accent: FLAG_COLORS.damaged, pct: total > 0 ? Math.round(damaged/total*100) : 0 },
          { title: 'ส่งของไม่ครบชิ้น', value: fmtC(incomplete), accent: FLAG_COLORS.incomplete, pct: total > 0 ? Math.round(incomplete/total*100) : 0 },
          { title: 'คลังส่งของผิด', value: fmtC(wrong), accent: FLAG_COLORS.wrong, pct: total > 0 ? Math.round(wrong/total*100) : 0 },
          { title: 'ไม่ระบุสาเหตุ', value: fmtC(unspecified), accent: FLAG_COLORS.unspecified, pct: total > 0 ? Math.round(unspecified/total*100) : 0 },
        ].map((t, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>{t.title}</span>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{t.value}</div>
            {t.pct != null && <div style={{ fontSize: 10, color: t.accent, fontWeight: 600, marginTop: 2 }}>{t.pct}% ของงานเคลม</div>}
          </div>
        ))}
      </div>

      {/* กราฟแนวโน้มแสดงผลอย่างถูกต้อง */}
      {trend.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 14 }}>แนวโน้มสถิติบันทึกยอดเคลมสินค้า (รายวัน)</div>
          <div style={{ width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ตารางจัดอันดับ Top 10 */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>ตารางจัดอันดับสินค้าเคลมสูงสุด (Top 10 สินค้า)</div>
          {topProducts.length > 10 && (
            <button
              onClick={() => setShowAllSkus(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#2563eb',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bfdbfe' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = '#e2e8f0' }}
            >
              <ExternalLink size={12} /> ดูทั้งหมด ({fmtC(topProducts.length)} สินค้า)
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left' }}>#</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' }}>สินค้า</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>จำนวนเคส</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>% เคลม/สินค้าออก</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>มูลค่าทุนเสียหาย</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.slice(0, 10).map((s, i) => (
                <tr
                  key={i}
                  onClick={() => setSelectedSku({ product_key: s.product_key, master_sku: s.master_sku || 'UNMAPPED', display_name: s.display_name || 'ชื่อสินค้าหลุดแมพ', skuCount: s.skuCount || 0 })}
                  style={{ borderBottom: '1px solid #f1f5f9', background: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '11px 14px', color: i < 3 ? '#f59e0b' : '#94a3b8', fontWeight: i < 3 ? 800 : 400 }}>{i + 1}</td>
                  <td style={{ padding: '11px 14px', color: '#1e293b', fontWeight: 700 }}>{s.display_name || 'ไม่ระบุชื่อสินค้า'}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{fmtC(s.count)}</td>
                  <ClaimRateCell item={s} />
                  <td style={{ padding: '11px 14px', textAlign: 'right', color: '#475569' }}>฿{fmtC(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {topProducts.length > 10 && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button
              onClick={() => setShowAllSkus(true)}
              style={{
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '8px 20px', fontSize: 12, fontWeight: 600, color: '#475569',
                cursor: 'pointer', width: '100%',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc' }}
            >
              ดูทั้งหมด {fmtC(topProducts.length)} สินค้า →
            </button>
          </div>
        )}
      </div>

      {/* Modal: ดูทั้งหมด */}
      {showAllSkus && (
        <AllSkusModal
          topSkus={topProducts}
          onClose={() => setShowAllSkus(false)}
          onSelectSku={(sku) => setSelectedSku(sku)}
        />
      )}

      {mapTarget && (() => {
        const query = mapSearch.trim().toLowerCase()
        const matches = mapOptions.filter(p => !query || p.master_sku.toLowerCase().includes(query) || p.display_name.toLowerCase().includes(query)).slice(0, 40)
        return <div onClick={e => { if (e.target === e.currentTarget && !mapSaving) setMapTarget('') }} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.36)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 'min(620px, 100%)', maxHeight: '80vh', background: '#fff', borderRadius: 14, boxShadow: '0 20px 50px rgba(15,23,42,.25)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><div style={{ fontWeight: 800 }}>เพิ่ม Map สินค้า</div><div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{mapTarget}</div></div><button disabled={mapSaving} onClick={() => setMapTarget('')} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}><X size={18} /></button></div>
            <input autoFocus value={mapSearch} onChange={e => setMapSearch(e.target.value)} placeholder="กรอกชื่อสินค้า หรือ Master SKU เช่น PY001" style={{ border: '1px solid #cbd5e1', borderRadius: 9, padding: '10px 12px', fontSize: 13 }} />
            <div style={{ overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 9 }}>
              {matches.map(product => <button key={product.master_sku} disabled={mapSaving} onClick={() => saveProductMap(product)} style={{ width: '100%', border: 0, borderBottom: '1px solid #f1f5f9', background: '#fff', padding: '10px 12px', textAlign: 'left', cursor: 'pointer' }}><strong style={{ color: '#2563eb' }}>{product.master_sku}</strong><span style={{ marginLeft: 10, color: '#334155' }}>{product.display_name}</span></button>)}
              {!matches.length && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>ไม่พบสินค้าใน product_aliases</div>}
            </div>
          </div>
        </div>
      })()}

      {/* Modal: รายละเอียด SKU */}
      {selectedSku && (
        <SkuDetailPanel
          masterSku={selectedSku.master_sku}
          productKey={selectedSku.product_key}
          displayName={selectedSku.display_name}
          skuCount={selectedSku.skuCount}
          startDate={startDate}
          endDate={endDate}
          business={business}
          onClose={() => setSelectedSku(null)}
        />
      )}

    </div>
  )
}
