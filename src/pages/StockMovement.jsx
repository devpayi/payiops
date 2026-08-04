import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Check, Download, Pencil, Plus, Search, Truck, X } from 'lucide-react'
import { canManageOperations } from '../../shared/roles.js'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
// รายการ "สั่งของ" (order_only) ที่กรอกไว้แบบไม่รู้จำนวน (เช่น ของเก่าก่อนเริ่มระบบ) เก็บ qty เป็น 0 —
// โชว์ "ไม่ระบุจำนวน" แทนเลข 0 เฉยๆ กันสับสนว่าสั่งไปศูนย์ชิ้น
const fmtOrderQty = (n) => (Number(n) > 0 ? fmt(n) : 'ไม่ระบุจำนวน')
const fmtDateTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

const TYPE_LABEL = { in: 'รับเข้า', out: 'เบิกออก', adjust: 'ปรับยอด' }
const TYPE_STYLE = {
  in: { bg: '#dcfce7', color: '#16a34a' },
  out: { bg: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' },
  adjust: { bg: '#eef2ff', color: '#4338ca' },
}

function TypeBadge({ type }) {
  const s = TYPE_STYLE[type] || TYPE_STYLE.adjust
  return <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: s.bg, color: s.color, whiteSpace: 'nowrap', display: 'inline-block' }}>{TYPE_LABEL[type] || type}</span>
}

const inputStyle = { border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 5, display: 'block' }

function itemLabel(it) { return `${it.abc ? `[${it.abc}] ` : ''}${it.display_name} (${it.sku})` }
const isPackagingItem = (item) => item.category === 'packaging' || /^(PKG-|BOXMJ-|BOXP-)/i.test(String(item.sku || ''))

function SkuPicker({ items, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = items.find((it) => it.sku === value)
  const filtered = query.trim()
    ? items.filter((it) => `${it.display_name} ${it.sku}`.toLowerCase().includes(query.trim().toLowerCase()))
    : items

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={open ? query : (selected ? itemLabel(selected) : '')}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setQuery(''); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || 'พิมพ์ชื่อสินค้าหรือ SKU เพื่อค้นหา...'}
        style={{ ...inputStyle, width: '100%' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 260, overflowY: 'auto', background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 1000 }}>
          {filtered.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--payi-text-faint)' }}>ไม่พบสินค้า</div>}
          {filtered.map((it) => (
            <div
              key={it.sku}
              onMouseDown={(e) => { e.preventDefault(); onChange(it.sku); setQuery(''); setOpen(false) }}
              style={{ padding: '9px 12px', fontSize: 13, cursor: 'pointer', background: it.sku === value ? 'var(--payi-mint-soft)' : 'transparent' }}
            >
              {itemLabel(it)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function toCsv(rows) {
  const header = ['วันที่', 'ประเภท', 'สินค้า', 'SKU', 'จำนวน', 'ผู้ทำรายการ', 'หมายเหตุ']
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [header.map(escape).join(',')]
  for (const r of rows) {
    lines.push([r.date, TYPE_LABEL[r.type] || r.type, r.display_name, r.sku, r.qty, r.created_by, r.note].map(escape).join(','))
  }
  return lines.join('\n')
}

const ABC_RANK = { A: 0, B: 1, C: 2 }

export default function StockMovement() {
  const [authEnabled, setAuthEnabled] = useState(true)
  useEffect(() => { fetch('/api/auth?action=status').then((r) => r.json()).then((d) => setAuthEnabled(!!d.enabled)).catch(() => {}) }, [])
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('payi-user') || 'null') } catch { return null } })()
  const isBoss = !authEnabled || canManageOperations(currentUser?.role)

  const [movements, setMovements] = useState([])
  const [items, setItems] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showAddRequest, setShowAddRequest] = useState(false)
  const [matching, setMatching] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [editingRequest, setEditingRequest] = useState(null)
  const [showOrderRequest, setShowOrderRequest] = useState(false)
  const [expandedRows, setExpandedRows] = useState(() => new Set())
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth <= 640)
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const toggleExpanded = (id) => setExpandedRows((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // order_only = พี่หยกกด "สั่งของ" ไว้ (คนละปุ่มกับ "แจ้งของเข้า") แต่ยังไม่มีคนแจ้งของเข้าจริง —
  // API กรองไม่ส่งมาให้ role ที่ไม่ใช่ boss/dev อยู่แล้ว (ไม่ให้ฟ้าเห็นจำนวนที่สั่งไว้ล่วงหน้า
  // จะได้นับสต็อกจริงแบบ blind ไม่ใช่แค่เช็คให้ตรงเลขที่คาดไว้)
  const orderOnlyRequests = useMemo(() => requests.filter((r) => r.status === 'pending' && r.order_only), [requests])
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === 'pending' && !r.order_only), [requests])
  const rejectedRequests = useMemo(() => requests.filter((r) => r.status === 'rejected'), [requests])

  const loadMovements = useCallback(() => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ view: 'movements' })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (query.trim()) params.set('q', query.trim())

    return fetch(`/api/sheet-tools?op=inventory&${params.toString()}`).then((r) => r.json())
      .then((moveData) => {
        if (!moveData.success) throw new Error(moveData.error || 'โหลดข้อมูลไม่สำเร็จ')
        setMovements(moveData.movements || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [typeFilter, fromDate, toDate, query])

  // สินค้า/ABC/คิว match ไม่ได้ขึ้นกับตัวกรองค้นหาเลย — แยกจาก loadMovements ไม่งั้นพิมพ์ค้นหา
  // ทีนึงจะยิง /api/sheet-tools + /api/planner-sales ซ้ำทุก keystroke โดยไม่จำเป็น (เจอ Sheets API
  // quota "Read requests per minute" เกินมาแล้วจากพฤติกรรมนี้) — โหลดแค่ตอน mount + หลัง mutation จริงๆ
  const loadSupporting = useCallback(() => {
    return Promise.all([
      fetch('/api/sheet-tools?op=inventory&view=items').then((r) => r.json()),
      fetch('/api/planner-sales?days=30').then((r) => r.json()).catch(() => null),
      fetch('/api/sheet-tools?op=inventory&view=stock-in-requests').then((r) => r.json()).catch(() => null),
    ])
      .then(([itemData, planner, requestData]) => {
        setRequests(requestData?.success ? requestData.requests || [] : [])

        // เรียงสินค้าตาม ABC (จาก /api/planner-sales — ยอดขาย 30 วันล่าสุด) ให้ของขายดี (A)
        // ขึ้นก่อนตอนเลือกสินค้าบันทึกรายการ — ของที่หยิบบ่อยควรอยู่บนสุด ไม่ใช่เรียงตามชื่อ
        const abcBySku = new Map((planner?.items || []).map((p) => [String(p.masterSku || '').toUpperCase(), p.abc]))
        // วัสดุแพ็คเกจจิ้ง (สติกเกอร์/กล่อง) ไม่ track ยอดคงเหลือจริง — คนหน้างานเช็คสต็อกเอง
        // ตัดออกจากรายการบันทึกรับเข้า-เบิกออกตรงนี้ไปเลย
        const withAbc = (itemData.items || [])
          .filter((it) => !isPackagingItem(it))
          .map((it) => ({ ...it, abc: abcBySku.get(String(it.sku).toUpperCase()) || null }))
        withAbc.sort((a, b) => {
          const rankA = ABC_RANK[a.abc] ?? 3
          const rankB = ABC_RANK[b.abc] ?? 3
          if (rankA !== rankB) return rankA - rankB
          return a.display_name.localeCompare(b.display_name, 'th')
        })
        setItems(withAbc)
      })
      .catch((e) => setError(e.message))
  }, [])

  // load() = รีเฟรชทั้งหน้า ใช้ตอน mount ครั้งแรก + หลัง mutation ใดๆ (เพิ่ม/แก้/match/ปฏิเสธ/ฯลฯ)
  const load = useCallback(() => {
    setLoading(true)
    return Promise.all([loadMovements(), loadSupporting()]).finally(() => setLoading(false))
  }, [loadMovements, loadSupporting])

  useEffect(() => {
    loadSupporting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(loadMovements, query ? 300 : 0) // debounce เฉพาะตอนพิมพ์ค้นหา
    return () => clearTimeout(t)
  }, [loadMovements, query])

  const saveMovement = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-movement', ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setShowAdd(false)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-movement', id: editing.id, ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setEditing(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveRequest = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-stock-in-request', ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setShowAddRequest(false)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const confirmMatch = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'match-stock-in-request', id: matching.id, ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'match ไม่สำเร็จ')
      setMatching(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const confirmReject = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject-stock-in-request', id: rejecting.id, ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'ปฏิเสธไม่สำเร็จ')
      setRejecting(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveOrderRequest = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-order-request', ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setShowOrderRequest(false)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const finishOrder = async (id) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finish-stock-in-request', id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'ปิดรายการไม่สำเร็จ')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveEditRequest = async (payload) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-stock-in-request', id: editingRequest.id, ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')
      setEditingRequest(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteRequest = async (id) => {
    if (!confirm('ลบรายการนี้ทิ้งถาวร?')) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-stock-in-request', id }),
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

  const exportCsv = () => {
    const csv = toCsv(movements)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="swan-pastel-page stock-movement-pastel-page" style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>{movements.length} รายการ</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {isBoss && (
            <button onClick={() => setShowOrderRequest(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', color: 'var(--payi-text)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={14} /> สั่งของ
            </button>
          )}
          <button onClick={() => setShowAddRequest(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', color: 'var(--payi-text)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            <Truck size={14} /> แจ้งของเข้า
          </button>
          <button onClick={exportCsv} disabled={!movements.length} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', color: 'var(--payi-text)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: movements.length ? 'pointer' : 'not-allowed', opacity: movements.length ? 1 : 0.5 }}>
            <Download size={14} /> Export CSV
          </button>
          <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
            <Plus size={14} /> เพิ่มรายการ
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{error}</div>
      )}

      {isBoss ? (
        <div className="app-two-col-fixed" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 18, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Truck size={16} style={{ color: 'var(--payi-text-muted)' }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>สั่งไว้ รอของเข้า ({orderOnlyRequests.length})</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--payi-text-faint)', marginBottom: 14 }}>เห็นเฉพาะ Boss/Dev</div>
            {orderOnlyRequests.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>ยังไม่มีรายการสั่งของ</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {orderOnlyRequests.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--payi-border)', fontSize: 12.5 }}>
                    <div style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={`${r.display_name} ${fmtOrderQty(r.qty)} · สั่งวันที่ ${r.order_date || '-'} · สั่งโดย ${r.created_by || '-'}${r.note ? ` · ${r.note}` : ''}`}>
                      <span style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name}</span>{' '}
                      <span style={{ fontWeight: 800, color: 'var(--payi-text-muted)' }}>{fmtOrderQty(r.qty)}</span>{' '}
                      <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>· {r.order_date || '-'} · {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => finishOrder(r.id)} title="เสร็จสิ้น" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'linear-gradient(135deg, #2563eb 0%, #34d399 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
                        <Check size={11} /> เสร็จสิ้น
                      </button>
                      <button onClick={() => setEditingRequest(r)} title="แก้ไข" style={{ border: 'none', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: 'var(--payi-text)' }}>
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => setRejecting(r)} title="ยกเลิก" style={{ border: 'none', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: 'var(--payi-danger)' }}>
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 18, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Truck size={16} style={{ color: 'var(--payi-mint-strong)' }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>ของเข้ารอ Match ({pendingRequests.length})</span>
            </div>
            {pendingRequests.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>ยังไม่มีของเข้ารอ match</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {pendingRequests.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--payi-border)', fontSize: 12.5 }}>
                    <div style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={`${r.display_name} +${fmt(r.qty)} · เข้า ${r.arrival_date || '-'} · นับ ${r.count_date || '-'} · แจ้งโดย ${r.created_by || '-'}${r.note ? ` · ${r.note}` : ''}`}>
                      <span style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name}</span>{' '}
                      <span style={{ fontWeight: 800, color: 'var(--payi-mint-strong)' }}>+{fmt(r.qty)}</span>{' '}
                      <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>· เข้า {r.arrival_date || '-'} · แจ้งโดย {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => setMatching(r)} title="Match" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'linear-gradient(135deg, #2563eb 0%, #34d399 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
                        <Check size={11} /> Match
                      </button>
                      <button onClick={() => setRejecting(r)} title="ปฏิเสธ" style={{ border: 'none', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: 'var(--payi-danger)' }}>
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : pendingRequests.length > 0 && (
        <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 18, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Truck size={16} style={{ color: 'var(--payi-mint-strong)' }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>ของเข้ารอ Match ({pendingRequests.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {pendingRequests.map((r) => (
              <div key={r.id} style={{ padding: '7px 4px', borderBottom: '1px solid var(--payi-border)', fontSize: 12.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={`${r.display_name} +${fmt(r.qty)} · เข้า ${r.arrival_date || '-'} · นับ ${r.count_date || '-'} · แจ้งโดย ${r.created_by || '-'}${r.note ? ` · ${r.note}` : ''}`}>
                <span style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name}</span>{' '}
                <span style={{ fontWeight: 800, color: 'var(--payi-mint-strong)' }}>+{fmt(r.qty)}</span>{' '}
                <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>· เข้า {r.arrival_date || '-'} · แจ้งโดย {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rejectedRequests.length > 0 && (
        <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-danger-bg)', borderRadius: 18, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <X size={16} style={{ color: 'var(--payi-danger)' }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>ถูกปฏิเสธ — แก้ไขแล้วส่งใหม่ได้ ({rejectedRequests.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rejectedRequests.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--payi-border)', fontSize: 12.5 }}>
                <div style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={`${r.display_name} ${fmt(r.qty)} · เข้า ${r.arrival_date || '-'} · แจ้งโดย ${r.created_by || '-'}${r.note ? ` · ${r.note}` : ''}${r.reject_reason ? ` · เหตุผล: ${r.reject_reason}` : ''}`}>
                  <span style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name}</span>{' '}
                  <span style={{ fontWeight: 800, color: 'var(--payi-text-muted)' }}>{fmt(r.qty)}</span>{' '}
                  <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>· {r.arrival_date || '-'} · {r.created_by || '-'}</span>
                  {r.reject_reason && <span style={{ fontSize: 11, color: 'var(--payi-danger)' }}> · {r.reject_reason}</span>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => setEditingRequest(r)} title="แก้ไข & ส่งใหม่" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
                    <Pencil size={11} /> แก้ไข
                  </button>
                  {isBoss && (
                    <button onClick={() => deleteRequest(r.id)} title="ลบ" style={{ border: 'none', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', color: 'var(--payi-danger)' }}>
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 18, padding: 20 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--payi-text-faint)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาสินค้า, ผู้ทำรายการ, หมายเหตุ..." style={{ ...inputStyle, width: '100%', paddingLeft: 34 }} />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inputStyle}>
            <option value="all">ทั้งหมด</option>
            <option value="in">รับเข้า</option>
            <option value="out">เบิกออก</option>
            <option value="adjust">ปรับยอด</option>
          </select>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>กำลังโหลด...</div>
        ) : movements.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>
            <ArrowLeftRight size={28} style={{ marginBottom: 10, opacity: 0.4 }} />
            <div>ยังไม่มีรายการเข้า-ออก</div>
          </div>
        ) : isNarrow ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {movements.map((m) => {
              const expanded = expandedRows.has(m.id)
              return (
                <div key={m.id} onClick={() => toggleExpanded(m.id)} style={{ border: '1px solid var(--payi-border)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--payi-text-muted)' }}>{fmtDateTime(m.created_at) || m.date}</span>
                    <TypeBadge type={m.type} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, marginTop: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.display_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{m.sku}</div>
                    </div>
                    <div style={{ fontWeight: 800, whiteSpace: 'nowrap', color: m.qty < 0 ? 'var(--payi-danger)' : '#16a34a' }}>
                      {m.qty > 0 ? '+' : ''}{fmt(m.qty)}
                    </div>
                  </div>
                  {expanded ? (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--payi-border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--payi-text-muted)' }}>ผู้ทำรายการ: {m.created_by || '-'}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--payi-text-muted)' }}>หมายเหตุ: {m.note || '-'}</div>
                      {m.updated_at && <div style={{ fontSize: 11, color: 'var(--payi-text-faint)' }} title={fmtDateTime(m.updated_at)}>แก้ไขล่าสุดโดย {m.updated_by || '-'}</div>}
                      <button onClick={(e) => { e.stopPropagation(); setEditing(m) }} aria-label={`แก้ไขรายการ ${m.display_name}`} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, border: 'none', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
                        <Pencil size={12} /> แก้ไข
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 6 }}>แตะเพื่อดูหมายเหตุ/ผู้ทำรายการ</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '27%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px' }}>วันที่</th>
                  <th style={{ padding: '8px 10px' }}>ประเภท</th>
                  <th style={{ padding: '8px 10px' }}>สินค้า</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>จำนวน</th>
                  <th style={{ padding: '8px 10px' }}>ผู้ทำรายการ</th>
                  <th style={{ padding: '8px 10px' }}>หมายเหตุ</th>
                  <th style={{ padding: '8px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={{ padding: '10px', color: 'var(--payi-text-muted)', whiteSpace: 'nowrap' }}>{fmtDateTime(m.created_at) || m.date}</td>
                    <td style={{ padding: '10px' }}><TypeBadge type={m.type} /></td>
                    <td style={{ padding: '10px', overflow: 'hidden' }}>
                      <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.display_name}>{m.display_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{m.sku}</div>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', color: m.qty < 0 ? 'var(--payi-danger)' : '#16a34a' }}>
                      {m.qty > 0 ? '+' : ''}{fmt(m.qty)}
                    </td>
                    <td style={{ padding: '10px', color: 'var(--payi-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.created_by || '-'}>{m.created_by || '-'}</td>
                    <td style={{ padding: '10px', color: 'var(--payi-text-muted)', overflow: 'hidden' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.note || undefined}>{m.note || '-'}</div>
                      {m.updated_at && <div style={{ fontSize: 10.5, color: 'var(--payi-text-faint)', marginTop: 2 }} title={fmtDateTime(m.updated_at)}>แก้ไขล่าสุดโดย {m.updated_by || '-'}</div>}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      <button onClick={() => setEditing(m)} aria-label={`แก้ไขรายการ ${m.display_name}`} style={{ border: 'none', background: 'var(--payi-surface-muted)', borderRadius: 8, padding: 7, cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddMovementModal items={items} saving={saving} onClose={() => setShowAdd(false)} onSave={saveMovement} />
      )}
      {editing && (
        <AddMovementModal items={items} saving={saving} initial={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
      )}
      {showAddRequest && (
        <StockInRequestModal items={items} saving={saving} onClose={() => setShowAddRequest(false)} onSave={saveRequest} />
      )}
      {showOrderRequest && (
        <OrderRequestModal items={items} saving={saving} onClose={() => setShowOrderRequest(false)} onSave={saveOrderRequest} />
      )}
      {matching && (
        <MatchRequestModal request={matching} saving={saving} onClose={() => setMatching(null)} onSave={confirmMatch} />
      )}
      {rejecting && (
        <RejectRequestModal request={rejecting} saving={saving} onClose={() => setRejecting(null)} onSave={confirmReject} />
      )}
      {editingRequest && editingRequest.order_only && (
        <OrderRequestModal items={items} saving={saving} initial={editingRequest} onClose={() => setEditingRequest(null)} onSave={saveEditRequest} />
      )}
      {editingRequest && !editingRequest.order_only && (
        <StockInRequestModal items={items} saving={saving} initial={editingRequest} onClose={() => setEditingRequest(null)} onSave={saveEditRequest} />
      )}
    </div>
  )
}

function RejectRequestModal({ request, saving, onClose, onSave }) {
  const [note, setNote] = useState('')

  const submit = (e) => {
    e.preventDefault()
    onSave({ note })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>ปฏิเสธ — {request.display_name}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>เหตุผลที่ปฏิเสธ (ฟ้าจะเห็นตอนแก้ไข)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="เช่น จำนวนไม่ตรง, สินค้าผิด" />
          </div>
          <button type="submit" disabled={saving} style={{ marginTop: 6, background: 'var(--payi-danger)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธ'}
          </button>
        </form>
      </div>
    </div>
  )
}

function OrderRequestModal({ items, saving, initial, onClose, onSave }) {
  const isEdit = !!initial
  const [sku, setSku] = useState(initial?.sku || items[0]?.sku || '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '')
  const [orderDate, setOrderDate] = useState(initial?.order_date || (() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))())
  const [note, setNote] = useState(initial?.note || '')

  const submit = (e) => {
    e.preventDefault()
    if (!sku) return
    if (qty !== '' && Number(qty) < 0) return
    onSave({ sku, qty, order_date: orderDate, note })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{isEdit ? `แก้ไขรายการสั่งของ — ${initial.display_name}` : 'สั่งของ'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--payi-text-faint)', marginBottom: 14 }}>เฉพาะ Boss/Dev เห็น — ฟ้าจะไม่เห็นจำนวนที่สั่งไว้จนกว่าจะแจ้งของเข้าเอง</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>สินค้า</label>
            {isEdit ? (
              <div style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', background: 'var(--payi-surface-muted)', color: 'var(--payi-text-muted)' }}>{initial.display_name} ({sku})</div>
            ) : (
              <SkuPicker items={items} value={sku} onChange={setSku} />
            )}
          </div>
          <div>
            <label style={labelStyle}>จำนวนที่สั่ง</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ไม่ทราบจำนวน (เว้นว่างได้)" />
            <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 4 }}>เว้นว่างได้ถ้ายังไม่รู้จำนวน เช่น คำสั่งซื้อเก่าก่อนเริ่มใช้ระบบนี้ — ยังนับว่า "สั่งแล้ว" กันแจ้งเตือนซ้ำในไลน์ ใส่จำนวนจริงตอน Match ของเข้าได้ทีหลัง</div>
          </div>
          <div>
            <label style={labelStyle}>วันที่สั่ง</label>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>หมายเหตุ</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ไม่บังคับ" />
          </div>
          <button type="submit" disabled={saving || (!isEdit && !items.length)} style={{ marginTop: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </form>
      </div>
    </div>
  )
}

function StockInRequestModal({ items, saving, initial, onClose, onSave }) {
  const isEdit = !!initial
  const [sku, setSku] = useState(initial?.sku || items[0]?.sku || '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '')
  const [arrivalDate, setArrivalDate] = useState(initial?.arrival_date || (() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))())
  const [countDate, setCountDate] = useState(initial?.count_date || '')
  const [note, setNote] = useState(initial?.note || '')

  const submit = (e) => {
    e.preventDefault()
    if (!sku || !qty || Number(qty) <= 0) return
    onSave({ sku, qty, arrival_date: arrivalDate, count_date: countDate, note })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{isEdit ? `แก้ไข & ส่งใหม่ — ${initial.display_name}` : 'แจ้งของเข้า'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
            <X size={14} />
          </button>
        </div>
        {isEdit && initial.reject_reason && (
          <div style={{ background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, marginBottom: 14 }}>
            เหตุผลที่ถูกปฏิเสธ: {initial.reject_reason}
          </div>
        )}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>สินค้า</label>
            <SkuPicker items={items} value={sku} onChange={setSku} />
          </div>
          <div>
            <label style={labelStyle}>จำนวนที่เข้า</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required style={{ ...inputStyle, width: '100%' }} placeholder="0" />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>วันของเข้า</label>
              <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>วันนับ</label>
              <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>หมายเหตุ</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ไม่บังคับ" />
          </div>
          <button type="submit" disabled={saving || !items.length} style={{ marginTop: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </form>
      </div>
    </div>
  )
}

function MatchRequestModal({ request, saving, onClose, onSave }) {
  const [qty, setQty] = useState(String(request.qty))
  const [note, setNote] = useState('')
  // available_orders มาจาก backend เรียง FIFO ไว้แล้ว (สั่งก่อนอยู่บนสุด) — ตัวแรกเป็นแค่ suggest
  // เริ่มต้น boss เลือกลอตอื่นแทนได้เสมอถ้าของจริงสลับลอตมา หรือเลือก "ไม่ผูกลอต" ถ้าไม่มีลอตให้จับคู่
  const orders = request.available_orders || []
  const [orderRequestId, setOrderRequestId] = useState(orders[0]?.id || '')
  const selectedOrder = orders.find((o) => o.id === orderRequestId)

  const submit = (e) => {
    e.preventDefault()
    if (!qty || Number(qty) <= 0) return
    onSave({ qty, note, order_request_id: orderRequestId || undefined })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>Match — {request.display_name}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--payi-text-muted)', marginBottom: 14 }}>
          เข้า {request.arrival_date || '-'} · นับ {request.count_date || '-'} · แจ้งโดย {request.created_by || '-'}{request.note ? ` · ${request.note}` : ''}
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {orders.length > 0 && (
            <div>
              <label style={labelStyle}>เทียบกับลอตที่สั่งไว้ (FIFO — สั่งก่อนอยู่บนสุด)</label>
              <select value={orderRequestId} onChange={(e) => setOrderRequestId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                <option value="">ไม่ผูกลอต (ไม่มีที่ตรง/ไม่ต้องเทียบ)</option>
                {orders.map((o, i) => (
                  <option key={o.id} value={o.id}>
                    ลอต {i + 1} — สั่งไว้ {fmtOrderQty(o.qty)} · {o.order_date || '-'} · โดย {o.created_by || '-'}{o.note ? ` · ${o.note}` : ''}
                  </option>
                ))}
              </select>
              {/* ลอตที่ไม่ระบุจำนวน (qty 0 — เช่น ของเก่าก่อนเริ่มระบบ) ไม่มีอะไรให้เทียบ ข้ามคำเตือนไม่ตรงไปเลย */}
              {selectedOrder && selectedOrder.qty > 0 && Number(qty) !== selectedOrder.qty && (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--payi-danger)' }}>
                  ไม่ตรง — สั่งไว้ {fmt(selectedOrder.qty)} แต่นับจริง {fmt(Number(qty) || 0)} (ส่วนต่าง {fmt((Number(qty) || 0) - selectedOrder.qty)})
                </div>
              )}
            </div>
          )}
          <div>
            <label style={labelStyle}>จำนวนที่นับจริง (แก้ได้ถ้าไม่ตรง)</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>หมายเหตุ</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ไม่บังคับ" />
          </div>
          <button type="submit" disabled={saving} style={{ marginTop: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
            {saving ? 'กำลังยืนยัน...' : 'ยืนยัน Match'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AddMovementModal({ items, saving, initial, onClose, onSave }) {
  const isEdit = !!initial
  const [sku, setSku] = useState(initial?.sku || items[0]?.sku || '')
  const [type, setType] = useState(initial?.type || 'in')
  const [qty, setQty] = useState(initial ? String(initial.type === 'adjust' ? initial.qty : Math.abs(initial.qty)) : '')
  const [date, setDate] = useState(initial?.date || (() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))())
  const [note, setNote] = useState(initial?.note || '')

  const submit = (e) => {
    e.preventDefault()
    if (!sku || !qty || Number(qty) === 0) return
    onSave({ sku, type, qty, date, note })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{isEdit ? `แก้ไขรายการ — ${initial.display_name}` : 'เพิ่มรายการเข้า-ออก'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--payi-text-muted)' }}>
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>สินค้า</label>
            {isEdit ? (
              <div style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', background: 'var(--payi-surface-muted)', color: 'var(--payi-text-muted)' }}>{initial.display_name} ({sku})</div>
            ) : (
              <SkuPicker items={items} value={sku} onChange={setSku} placeholder={items.length === 0 ? 'ยังไม่มีสินค้า — ไปเพิ่มที่หน้า Inventory ก่อน' : undefined} />
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['in', 'รับเข้า'], ['out', 'เบิกออก'], ['adjust', 'ปรับยอด']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setType(id)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  border: `1px solid ${type === id ? 'var(--payi-mint)' : 'var(--payi-border)'}`,
                  background: type === id ? 'var(--payi-mint-soft)' : 'var(--payi-surface)',
                  color: type === id ? 'var(--payi-mint-strong)' : 'var(--payi-text-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            <label style={labelStyle}>{type === 'adjust' ? 'จำนวนที่ปรับ — ใส่ลบถ้าลดยอด' : 'จำนวน'}</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required style={{ ...inputStyle, width: '100%' }} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>วันที่</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>หมายเหตุ</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="ไม่บังคับ" />
          </div>
          <button type="submit" disabled={saving || (!isEdit && !items.length)} style={{ marginTop: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </form>
      </div>
    </div>
  )
}
