import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Check, Download, Pencil, Plus, Search, Truck, X } from 'lucide-react'
import { canManageOperations } from '../../shared/roles.js'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtDateTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

const TYPE_LABEL = { in: 'รับเข้า', out: 'เบิกออก', adjust: 'ปรับยอด' }
const TYPE_STYLE = {
  in: { bg: 'var(--payi-success-bg)', color: 'var(--payi-success)' },
  out: { bg: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' },
  adjust: { bg: '#eef2ff', color: '#4338ca' },
}

function TypeBadge({ type }) {
  const s = TYPE_STYLE[type] || TYPE_STYLE.adjust
  return <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: s.bg, color: s.color }}>{TYPE_LABEL[type] || type}</span>
}

const inputStyle = { border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 5, display: 'block' }

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
          .filter((it) => it.category !== 'packaging')
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {orderOnlyRequests.map((r) => (
                  <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--payi-border)', borderRadius: 12, padding: '10px 14px' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name} <span style={{ fontWeight: 800, color: 'var(--payi-text-muted)' }}>{fmt(r.qty)}</span></div>
                      <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)' }}>สั่งโดย {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => finishOrder(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                        <Check size={13} /> เสร็จสิ้น
                      </button>
                      <button onClick={() => setEditingRequest(r)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-surface-muted)', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'var(--payi-text)' }}>
                        <Pencil size={13} /> แก้ไข
                      </button>
                      <button onClick={() => setRejecting(r)} style={{ background: 'var(--payi-surface-muted)', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'var(--payi-danger)' }}>
                        ยกเลิก
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingRequests.map((r) => (
                  <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--payi-border)', borderRadius: 12, padding: '10px 14px' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name} <span style={{ fontWeight: 800, color: 'var(--payi-mint-strong)' }}>+{fmt(r.qty)}</span></div>
                      <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)' }}>
                        เข้า {r.arrival_date || '-'} · นับ {r.count_date || '-'} · แจ้งโดย {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => setMatching(r)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                        <Check size={13} /> Match
                      </button>
                      <button onClick={() => setRejecting(r)} style={{ background: 'var(--payi-surface-muted)', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'var(--payi-danger)' }}>
                        ปฏิเสธ
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingRequests.map((r) => (
              <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--payi-border)', borderRadius: 12, padding: '10px 14px' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name} <span style={{ fontWeight: 800, color: 'var(--payi-mint-strong)' }}>+{fmt(r.qty)}</span></div>
                  <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)' }}>
                    เข้า {r.arrival_date || '-'} · นับ {r.count_date || '-'} · แจ้งโดย {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rejectedRequests.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, border: '1px solid var(--payi-border)', borderRadius: 12, padding: '10px 14px' }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{r.display_name} <span style={{ fontWeight: 800, color: 'var(--payi-text-muted)' }}>{fmt(r.qty)}</span></div>
                  <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)' }}>
                    เข้า {r.arrival_date || '-'} · นับ {r.count_date || '-'} · แจ้งโดย {r.created_by || '-'}{r.note ? ` · ${r.note}` : ''}
                  </div>
                  {r.reject_reason && (
                    <div style={{ fontSize: 11.5, color: 'var(--payi-danger)', marginTop: 3 }}>เหตุผลปฏิเสธ: {r.reject_reason}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setEditingRequest(r)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                    <Pencil size={13} /> แก้ไข & ส่งใหม่
                  </button>
                  {isBoss && (
                    <button onClick={() => deleteRequest(r.id)} style={{ background: 'var(--payi-surface-muted)', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'var(--payi-danger)' }}>
                      ลบ
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
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', color: m.qty < 0 ? 'var(--payi-danger)' : 'var(--payi-success)' }}>
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
  const [note, setNote] = useState(initial?.note || '')

  const submit = (e) => {
    e.preventDefault()
    if (!sku || !qty || Number(qty) <= 0) return
    onSave({ sku, qty, note })
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
              <select value={sku} onChange={(e) => setSku(e.target.value)} required style={{ ...inputStyle, width: '100%' }}>
                {items.length === 0 && <option value="">ยังไม่มีสินค้า</option>}
                {items.map((it) => (
                  <option key={it.sku} value={it.sku}>{it.abc ? `[${it.abc}] ` : ''}{it.display_name} ({it.sku})</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label style={labelStyle}>จำนวนที่สั่ง</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required style={{ ...inputStyle, width: '100%' }} placeholder="0" />
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
            <select value={sku} onChange={(e) => setSku(e.target.value)} required style={{ ...inputStyle, width: '100%' }}>
              {items.length === 0 && <option value="">ยังไม่มีสินค้า</option>}
              {items.map((it) => (
                <option key={it.sku} value={it.sku}>{it.abc ? `[${it.abc}] ` : ''}{it.display_name} ({it.sku})</option>
              ))}
            </select>
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

  const submit = (e) => {
    e.preventDefault()
    if (!qty || Number(qty) <= 0) return
    onSave({ qty, note })
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
              <select value={sku} onChange={(e) => setSku(e.target.value)} required style={{ ...inputStyle, width: '100%' }}>
                {items.length === 0 && <option value="">ยังไม่มีสินค้า — ไปเพิ่มที่หน้า Inventory ก่อน</option>}
                {items.map((it) => (
                  <option key={it.sku} value={it.sku}>{it.abc ? `[${it.abc}] ` : ''}{it.display_name} ({it.sku})</option>
                ))}
              </select>
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
