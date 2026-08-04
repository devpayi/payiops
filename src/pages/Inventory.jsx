import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Layers, AlertTriangle, ArrowLeftRight, Plus, Pencil, X, Eye, EyeOff, Download } from 'lucide-react'
import KpiCard from '../components/KpiCard'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })

// ป้ายมุมหน้า "อัพเดทสต็อกล่าสุด วันที่/เวลา" — สรุปทั้งระบบจุดเดียว (ไม่ใช่ต่อรายการสินค้า)
// จาก created_at ของรายการเข้า-ออก/ปรับยอดล่าสุดสุดในทั้งชีต stock_movements
const fmtLastMovementAt = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

// เหมือน statusOf ฝั่ง api/_lib/inventory.js — แต่รับ safety stock ที่คำนวณสดจากสูตร lead time
// ด้วย (effectiveSafety) ไม่ใช่แค่เลขที่เซฟไว้ในชีต ไม่งั้นสถานะ/แนะนำสั่งซื้อจะไม่ขยับตามสูตรเลย
const statusOf = (balance, safetyStock) => {
  if (balance <= 0) return 'หมด'
  if (safetyStock > 0 && balance <= safetyStock) return 'ใกล้หมด'
  return 'ปกติ'
}

const STATUS_STYLE = {
  'ปกติ': { bg: 'var(--payi-success-bg)', color: 'var(--payi-success)' },
  'ใกล้หมด': { bg: '#fff7ed', color: '#c2410c' },
  'หมด': { bg: 'var(--payi-danger-bg)', color: 'var(--payi-danger)' },
}

function StatusBadge({ status }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE['ปกติ']
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: style.bg, color: style.color }}>
      {status}
    </span>
  )
}

// ฟอร์มกลาง ใช้ทั้งเพิ่มสินค้าใหม่ และรับเข้า/เบิกออกด่วนจากตาราง
function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--payi-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(15,23,42,0.2)' }}>
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

// จัดกลุ่มวัสดุแพ็คเกจจิ้งตาม prefix ของ sku ที่ seed ไว้ — อิงตาม 3 หมวดเดิมจากไฟล์ Excel "Something"
// (Safety Sticker / กล่อง Package หมิงจึ / กล่องพัสดุ MOQ 10,000) เพื่อให้ดูแยกหมวดง่ายเหมือนต้นฉบับ
const PACKAGING_GROUP_ORDER = ['สติกเกอร์', 'กล่อง Package หมิงจึ', 'กล่องพัสดุ', 'อื่นๆ']
const packagingGroupOf = (sku) => {
  const s = String(sku).toUpperCase()
  if (s.startsWith('STK-')) return 'สติกเกอร์'
  if (s.startsWith('BOXMJ-')) return 'กล่อง Package หมิงจึ'
  if (s.startsWith('BOXP-')) return 'กล่องพัสดุ'
  return 'อื่นๆ'
}

// แปลง rows เป็น CSV แล้วดาวน์โหลดเป็นไฟล์ — ใช้ export ทั้งแท็บสินค้า/วัสดุแพ็คเกจจิ้ง
const exportCsv = (filename, rows, columns) => {
  const escape = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => escape(c.label)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => escape(c.get(row))).join(','))
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const inputStyle = { width: '100%', border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 5, display: 'block' }

// SS = ยอดขายเฉลี่ย/วัน × (lead time total + ครึ่งนึงถ้าเป็นของเรือ) — สูตรจากไฟล์ Safety UP177 เดิม
// เรือใช้เวลานานและแปรผัน เผื่อเพิ่มอีกครึ่งของ lead time ไปเลย (ROP รวมอยู่ใน SS ตัวนี้แล้ว ไม่แยกช่อง)
const calcSuggestedSafety = (dailyAvg, leadTimeTotal, shipFreight) => {
  if (!dailyAvg || !leadTimeTotal) return null
  const days = leadTimeTotal + (shipFreight ? leadTimeTotal / 2 : 0)
  return Math.round(dailyAvg * days)
}

// แนะนำสั่งซื้อ = ควรมี(SS) - ของที่คาดว่าจะเหลือตอนของมาถึง (คงเหลือตอนนี้ - ใช้ไประหว่างรอ)
const calcRecommendedOrder = (safetyStock, balance, dailyAvg, leadTimeTotal) => {
  const projectedAtArrival = balance - dailyAvg * leadTimeTotal
  return Math.max(0, Math.round(safetyStock - projectedAtArrival))
}

export default function Inventory() {
  const [data, setData] = useState(null)
  const [salesBySku, setSalesBySku] = useState(new Map()) // sku -> { dailyAverage, abc, units90 }
  const [packagingRecipes, setPackagingRecipes] = useState([]) // [{ packaging_sku, product_sku, product_name, qty_per_unit }]
  const [plannerSafetyBySku, setPlannerSafetyBySku] = useState(new Map()) // master_sku -> safety_percent (จาก Planner Control)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyRecommended, setOnlyRecommended] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [itemModal, setItemModal] = useState(null) // null | 'new' | item object (edit)
  const [categoryTab, setCategoryTab] = useState('product') // 'product' | 'packaging' (วัสดุแพ็คเกจจิ้ง — สติกเกอร์/กล่อง)
  const [moveModal, setMoveModal] = useState(null) // { sku, display_name, unit, type }

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([
      fetch('/api/sheet-tools?op=inventory&view=items&includeHidden=1').then((r) => r.json()),
      fetch('/api/planner-sales?days=30').then((r) => r.json()).catch(() => null),
      fetch('/api/sheet-tools?op=inventory&view=packaging-recipes').then((r) => r.json()).catch(() => null),
      fetch('/api/sheet-tools?op=planner').then((r) => r.json()).catch(() => null),
    ])
      .then(([d, planner, recipes, plannerConfig]) => {
        if (!d.success) throw new Error(d.error || 'โหลดข้อมูลไม่สำเร็จ')
        setData(d)
        setSalesBySku(new Map((planner?.items || []).map((p) => [String(p.masterSku || '').toUpperCase(), p])))
        setPackagingRecipes(recipes?.recipes || [])
        setPlannerSafetyBySku(new Map((plannerConfig?.config || [])
          .filter((c) => Number(c.safety_percent) > 0)
          .map((c) => [String(c.master_sku).toUpperCase(), Number(c.safety_percent)])))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const items = data?.items || []
  const totals = data?.totals || { totalProducts: 0, totalStock: 0, lowStockCount: 0, transactionsToday: 0 }

  // ผูกยอดขาย 30 วัน + ABC เข้ากับแต่ละสินค้า แล้วคำนวณขั้นต่ำแนะนำ/แนะนำสั่งซื้อสดๆ ที่นี่ที่เดียว
  // (ตารางกับ modal แก้ไขใช้ตัวเลขชุดเดียวกัน ไม่แยกคำนวณคนละที่)
  //
  // SKU ที่แยกสี/ไซส์เอง (เช่น PY066-B, PY051-C) ไม่มียอดขายของตัวเองตรงๆ เพราะ raw_orders
  // บันทึกรวมเป็น master_sku ฐานเดียว (PY066) มาตั้งแต่ต้น ไม่เคยแยกสีตอนขาย — fallback โดย
  // เฉลี่ยยอดของฐานตามสัดส่วนคงเหลือ (balance) ของแต่ละตัวในกลุ่ม ดีกว่าไม่มีข้อมูลเลย
  // แต่เป็นการประมาณ ไม่ใช่ยอดขายจริงแยกสี
  const baseSkuOf = (sku) => sku.replace(/-[A-Z]$/, '')
  const allocatedSales = useMemo(() => {
    const childrenByBase = new Map()
    for (const it of items) {
      const sku = String(it.sku).toUpperCase()
      if (salesBySku.has(sku)) continue
      const base = baseSkuOf(sku)
      if (base === sku || !salesBySku.has(base)) continue
      if (!childrenByBase.has(base)) childrenByBase.set(base, [])
      childrenByBase.get(base).push(it)
    }
    const result = new Map()
    for (const [base, children] of childrenByBase) {
      const baseItem = items.find((it) => String(it.sku).toUpperCase() === base)
      const group = baseItem ? [baseItem, ...children] : children
      const baseSales = salesBySku.get(base)
      const totalBalance = group.reduce((s, it) => s + (it.balance || 0), 0)
      for (const it of group) {
        const share = totalBalance > 0 ? (it.balance || 0) / totalBalance : 1 / group.length
        result.set(String(it.sku).toUpperCase(), {
          dailyAverage: Math.round(baseSales.dailyAverage * share * 10) / 10,
          units90: Math.round(baseSales.units90 * share),
          abc: baseSales.abc,
          estimated: true,
        })
      }
    }
    return result
  }, [items, salesBySku])

  const DEFAULT_BUFFER_PERCENT = 30

  // % เผื่อแนะนำต่อวัสดุ — เฉลี่ย safety_percent (ตั้งไว้ใน Planner Control) ของสินค้าทุกตัวที่ผูกไว้
  // เหตุผลที่ต้องเผื่อ: ของจริงเบิกวัสดุไปฟีดการผลิตล่วงหน้า ไม่ใช่ใช้ตามยอดขายวันต่อวันตรงๆ
  // ไม่มีข้อมูล Planner ของ SKU ไหนเลย = fallback 30% เจ้าของแก้ทับเองได้เสมอ (เก็บใน buffer_percent)
  const packagingBufferSuggestion = useMemo(() => {
    const recipesBySku = new Map()
    for (const r of packagingRecipes) {
      if (!recipesBySku.has(r.packaging_sku)) recipesBySku.set(r.packaging_sku, [])
      recipesBySku.get(r.packaging_sku).push(r)
    }
    const result = new Map()
    for (const it of items) {
      if (it.category !== 'packaging') continue
      const sku = String(it.sku).toUpperCase()
      const recipes = recipesBySku.get(sku) || []
      const percents = recipes.map((r) => plannerSafetyBySku.get(r.product_sku)).filter((v) => v > 0)
      result.set(sku, percents.length ? Math.round(percents.reduce((s, v) => s + v, 0) / percents.length) : DEFAULT_BUFFER_PERCENT)
    }
    return result
  }, [items, packagingRecipes, plannerSafetyBySku])

  // ยอดใช้วัสดุแพ็คเกจจิ้งเฉลี่ย/วัน (หน่วย: แผ่น/แพ็ค ไม่ใช่ชิ้น) — รวมยอดขายเฉลี่ยของสินค้าทุกตัว
  // ที่ผูกไว้ใน packaging_recipes (× qty_per_unit) แล้วหารด้วย units_per_batch เพื่อแปลงชิ้น→แผ่น/แพ็ค
  // เก็บทั้งค่า "base" (ไม่เผื่อ) และ "buffered" (เผื่อแล้ว) แยกกัน — ไว้โชว์ในโมดัลให้เห็นชัดว่า
  // ระบบคำนวณล้วนๆ ได้เท่าไหร่ vs เผื่อ % แล้วได้เท่าไหร่ ไม่ปนกันจนดูไม่ออกว่าเลขไหนมาจากไหน
  const packagingDailyAvg = useMemo(() => {
    const recipesBySku = new Map()
    for (const r of packagingRecipes) {
      if (!recipesBySku.has(r.packaging_sku)) recipesBySku.set(r.packaging_sku, [])
      recipesBySku.get(r.packaging_sku).push(r)
    }
    const result = new Map()
    for (const it of items) {
      if (it.category !== 'packaging') continue
      const sku = String(it.sku).toUpperCase()
      const recipes = recipesBySku.get(sku)
      if (!recipes?.length || !it.units_per_batch) continue
      const piecesPerDay = recipes.reduce((sum, r) => {
        const productSales = salesBySku.get(r.product_sku) || allocatedSales.get(r.product_sku)
        return sum + (productSales?.dailyAverage || 0) * r.qty_per_unit
      }, 0)
      const bufferPercent = it.buffer_percent ?? packagingBufferSuggestion.get(sku) ?? DEFAULT_BUFFER_PERCENT
      const base = Math.round((piecesPerDay / it.units_per_batch) * 100) / 100
      const buffered = Math.round((piecesPerDay * (1 + bufferPercent / 100) / it.units_per_batch) * 100) / 100
      result.set(sku, { base, buffered, bufferPercent })
    }
    return result
  }, [items, packagingRecipes, salesBySku, allocatedSales, packagingBufferSuggestion])

  const enriched = useMemo(() => {
    return items.map((it) => {
      const sku = String(it.sku).toUpperCase()
      const isPackaging = it.category === 'packaging'
      const sales = salesBySku.get(sku) || allocatedSales.get(sku)
      const packagingAvg = packagingDailyAvg.get(sku)
      const dailyAvg = isPackaging ? (packagingAvg?.buffered || 0) : (sales?.dailyAverage || 0)
      const units90 = sales?.units90 || 0
      const abc = sales?.abc || null
      const salesEstimated = Boolean(sales?.estimated)
      const leadTimeTotal = (it.lead_time_production || 0) + (it.lead_time_transport || 0)
      const computedSafety = calcSuggestedSafety(dailyAvg, leadTimeTotal, it.ship_freight)
      const effectiveSafety = computedSafety !== null ? computedSafety : it.safety_stock
      // วัสดุแพ็คเกจจิ้ง — ไม่ track ยอดคงเหลือจริง (คนหน้างานเช็คสต็อกเอง) ระบบเก็บแค่ขั้นต่ำ/lead time
      // ไว้อ้างอิง ไม่คำนวณสถานะหมด/ใกล้หมดจากยอด balance ที่ไม่มีความหมาย (นิ่งอยู่ 0 ตลอด)
      const effectiveStatus = isPackaging ? null : statusOf(it.balance, effectiveSafety)
      // วัสดุแพ็คเกจจิ้งไม่มี balance จริงให้หัก ไม่คำนวณแนะนำสั่งซื้อแบบสินค้า — "ขั้นต่ำ" (คำนวณจากยอดขาย)
      // ก็คือตัวเลขอ้างอิงพอแล้ว ให้คนหน้างานเทียบกับของบนชั้นเอง
      const recommendedOrder = isPackaging ? null : (effectiveStatus !== 'ปกติ' && dailyAvg && leadTimeTotal
        ? calcRecommendedOrder(effectiveSafety, it.balance, dailyAvg, leadTimeTotal)
        : null)
      const dailyAvgBase = isPackaging ? (packagingAvg?.base || 0) : dailyAvg
      const bufferPercentUsed = isPackaging ? (packagingAvg?.bufferPercent ?? DEFAULT_BUFFER_PERCENT) : null
      return { ...it, dailyAvg, dailyAvgBase, bufferPercentUsed, units90, abc, salesEstimated, leadTimeTotal, computedSafety, effectiveSafety, effectiveStatus, recommendedOrder }
    })
  }, [items, salesBySku, allocatedSales, packagingDailyAvg])

  // นับ Low Stock จาก effectiveStatus (สูตรสด) ไม่ใช้ totals.lowStockCount จาก server ตรงๆ
  // เพราะอันนั้นนับจาก safety_stock ที่เซฟไว้ในชีตเท่านั้น จะไม่ตรงกับสถานะที่โชว์ในตาราง
  const activeEnriched = useMemo(() => enriched.filter((it) => it.active), [enriched])
  const lowStockCount = useMemo(() => activeEnriched.filter((it) => it.category !== 'packaging' && it.effectiveStatus !== 'ปกติ').length, [activeEnriched])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = enriched.filter((it) => (showHidden ? !it.active : it.active))
    rows = rows.filter((it) => (it.category || 'product') === categoryTab)
    if (q) rows = rows.filter((it) => it.display_name.toLowerCase().includes(q) || String(it.sku).toLowerCase().includes(q))
    if (onlyRecommended) rows = rows.filter((it) => (it.recommendedOrder || 0) > 0)
    return [...rows].sort((a, b) => {
      if (categoryTab === 'packaging') {
        const groupDiff = PACKAGING_GROUP_ORDER.indexOf(packagingGroupOf(a.sku)) - PACKAGING_GROUP_ORDER.indexOf(packagingGroupOf(b.sku))
        if (groupDiff) return groupDiff
      }
      return String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true })
    })
  }, [enriched, query, onlyRecommended, showHidden, categoryTab])

  const setItemHidden = async (sku, hidden) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert-item', sku, active: !hidden }),
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

  const saveRecipe = async (packagingSku, productSku, qtyPerUnit) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert-recipe', packaging_sku: packagingSku, product_sku: productSku, qty_per_unit: qtyPerUnit }),
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

  const deleteRecipe = async (packagingSku, productSku) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-recipe', packaging_sku: packagingSku, product_sku: productSku }),
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

  // payload.balanceCorrection (ถ้ามี) มาจากช่อง "นับสต็อกจริง" ในป็อปอัพแก้ไขเดียวกัน —
  // บันทึกแยกเป็นรายการ adjust ใน stock_movements เสมอ (ประวัติแยกดูได้ที่ Stock Movement)
  // ไม่ใช่การเขียนทับ opening_balance ตรงๆ
  const saveItem = async ({ balanceCorrection, ...payload }) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/sheet-tools?op=inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert-item', ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ')

      if (balanceCorrection?.delta) {
        const res2 = await fetch('/api/sheet-tools?op=inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add-movement',
            sku: payload.sku,
            type: 'adjust',
            qty: balanceCorrection.delta,
            date: balanceCorrection.date,
            note: balanceCorrection.note,
          }),
        })
        const json2 = await res2.json()
        if (!json2.success) throw new Error(json2.error || 'ปรับยอดคงเหลือไม่สำเร็จ')
      }

      setItemModal(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

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
      setMoveModal(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="swan-pastel-page inventory-pastel-page" style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {error && (
        <div style={{ background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KpiCard title="Total Products" value={fmt(totals.totalProducts)} subtitle="รายการสินค้า" icon={Boxes} trend={null} />
        <KpiCard title="Total Stock" value={fmt(totals.totalStock)} subtitle="รวมทุกหน่วย" icon={Layers} trend={null} />
        <KpiCard title="Low Stock" value={fmt(lowStockCount)} subtitle="รายการใกล้หมด/หมด" icon={AlertTriangle} trend={null} />
        <KpiCard title="Transactions" value={fmt(totals.transactionsToday)} subtitle="วันนี้" icon={ArrowLeftRight} trend={null} />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ key: 'product', label: 'สินค้า' }, { key: 'packaging', label: 'วัสดุแพ็คเกจจิ้ง' }].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setCategoryTab(tab.key)}
              style={{
                border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                background: categoryTab === tab.key ? 'var(--payi-gradient-primary)' : 'var(--payi-surface-muted)',
                color: categoryTab === tab.key ? '#fff' : 'var(--payi-text-muted)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {fmtLastMovementAt(totals.lastMovementAt) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--payi-text-muted)', background: 'var(--payi-success-bg)', borderRadius: 999, padding: '5px 12px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--payi-success)', flexShrink: 0 }} />
            อัพเดทสต็อกล่าสุด {fmtLastMovementAt(totals.lastMovementAt)}
          </div>
        )}
      </div>

      <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 20, padding: 20, boxShadow: '0 14px 36px rgba(15,23,42,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--payi-text-strong)' }}>{categoryTab === 'packaging' ? 'วัสดุแพ็คเกจจิ้ง' : 'สินค้า'} ({filtered.length} รายการ)</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {categoryTab !== 'packaging' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyRecommended} onChange={(e) => setOnlyRecommended(e.target.checked)} />
                เฉพาะที่แนะนำสั่ง
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              แสดงสินค้าที่ซ่อนไว้
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาสินค้า..." style={{ ...inputStyle, width: 220 }} />
            <button
              onClick={() => exportCsv(
                categoryTab === 'packaging' ? 'วัสดุแพ็คเกจจิ้ง.csv' : 'สินค้า.csv',
                filtered,
                categoryTab === 'packaging'
                  ? [
                      { label: 'หมวด', get: (r) => packagingGroupOf(r.sku) },
                      { label: 'SKU', get: (r) => r.sku },
                      { label: 'ชื่อ', get: (r) => r.display_name },
                      { label: 'ขั้นต่ำ', get: (r) => r.effectiveSafety },
                      { label: 'หน่วย', get: (r) => r.unit },
                      { label: 'วันเติมสินค้า/รอเช็ค', get: (r) => r.reorder_date },
                    ]
                  : [
                      { label: 'SKU', get: (r) => r.sku },
                      { label: 'ชื่อ', get: (r) => r.display_name },
                      { label: 'ABC', get: (r) => r.abc },
                      { label: 'คงเหลือ', get: (r) => r.balance },
                      { label: 'หน่วย', get: (r) => r.unit },
                      { label: 'ขั้นต่ำ', get: (r) => r.effectiveSafety },
                      { label: 'สถานะ', get: (r) => r.effectiveStatus },
                      { label: 'แนะนำสั่งซื้อ', get: (r) => r.recommendedOrder },
                      { label: 'วันเติมสินค้า/รอเช็ค', get: (r) => r.reorder_date },
                    ]
              )}
              title="ดาวน์โหลดเป็น CSV"
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-surface-muted)', color: 'var(--payi-text-muted)', border: '1px solid var(--payi-border)', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
            >
              <Download size={14} /> Export
            </button>
            <button
              onClick={() => setItemModal('new')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}
            >
              <Plus size={14} /> {categoryTab === 'packaging' ? 'เพิ่มวัสดุ' : 'เพิ่มสินค้า'}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>
            ยังไม่มี{categoryTab === 'packaging' ? 'วัสดุ' : 'สินค้า'}ในระบบ — กด "{categoryTab === 'packaging' ? 'เพิ่มวัสดุ' : 'เพิ่มสินค้า'}" เพื่อเริ่มต้น
          </div>
        ) : categoryTab === 'packaging' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
            {PACKAGING_GROUP_ORDER.map((group) => {
              const rows = filtered.filter((it) => packagingGroupOf(it.sku) === group)
              if (!rows.length) return null
              return (
                <div key={group} style={{ border: '1px solid var(--payi-border)', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', fontWeight: 800, fontSize: 13, color: 'var(--payi-text-strong)', background: 'var(--payi-surface-muted)' }}>{group} ({rows.length})</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', minWidth: 300, borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <th style={{ padding: '6px 10px' }}>สินค้า</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right' }}>ขั้นต่ำ</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right' }}>จัดการ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((it) => (
                          <tr key={it.sku} style={{ borderTop: '1px solid var(--payi-border)' }}>
                            <td style={{ padding: '8px 10px', opacity: it.active ? 1 : 0.5 }} title={it.reorder_date || undefined}>
                              <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)' }}>{it.display_name}{!it.active && ' (ซ่อนอยู่)'}</div>
                              <div style={{ fontSize: 10, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{it.sku}</div>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                              <button onClick={() => setItemModal(it)} title="กดเพื่อแก้ไข" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--payi-text-muted)', fontWeight: 800 }}>
                                {fmt(it.effectiveSafety)} {it.unit}
                              </button>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                {it.active ? (
                                  <>
                                    <button onClick={() => setItemModal(it)} title="แก้ไข" style={iconBtnStyle('var(--payi-text-muted)')}><Pencil size={12} /></button>
                                    <button onClick={() => setItemHidden(it.sku, true)} title="ซ่อน" style={iconBtnStyle('var(--payi-text-muted)')}><EyeOff size={12} /></button>
                                  </>
                                ) : (
                                  <button onClick={() => setItemHidden(it.sku, false)} title="กู้คืน" style={iconBtnStyle('var(--payi-mint-strong)')}><Eye size={12} /></button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--payi-text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px' }}>ABC</th>
                  <th style={{ padding: '8px 10px' }}>สินค้า</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>คงเหลือ</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>ขั้นต่ำ</th>
                  <th style={{ padding: '8px 10px' }}>หน่วย</th>
                  <th style={{ padding: '8px 10px' }}>สถานะ</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>แนะนำสั่งซื้อ</th>
                  <th style={{ padding: '8px 10px' }}>วันเติมสินค้า/รอเช็ค</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => {
                  const recommendedOrder = it.recommendedOrder
                  return (
                  <Fragment key={it.sku}>
                    <tr style={{ borderTop: '1px solid var(--payi-border)' }}>
                    <td style={{ padding: '10px' }}>
                      {it.abc && (
                        <span
                          title={it.salesEstimated ? 'ประมาณจากยอดขายรวมของ SKU หลัก แบ่งตามสัดส่วนคงเหลือ ไม่ใช่ยอดขายแยกจริง' : undefined}
                          style={{
                            fontSize: 11, fontWeight: 800, padding: it.ship_freight ? '2px 7px' : 0, borderRadius: 999,
                            background: it.ship_freight ? '#fde047' : 'transparent',
                            color: it.ship_freight ? '#713f12' : 'var(--payi-text-faint)',
                          }}
                        >
                          {it.salesEstimated ? '≈' : ''}{it.abc}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px', opacity: it.active ? 1 : 0.5, overflow: 'hidden' }}>
                      <div style={{ fontWeight: 700, color: 'var(--payi-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.display_name}>{it.display_name}{!it.active && ' (ซ่อนอยู่)'}</div>
                      <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>{it.sku}</div>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 800, color: it.balance <= 0 ? 'var(--payi-danger)' : 'var(--payi-text-strong)' }}>{fmt(it.balance)}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      <button
                        onClick={() => setItemModal(it)}
                        title="กดเพื่อแก้ไข"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--payi-text-muted)' }}
                      >
                        {fmt(it.effectiveSafety)}
                      </button>
                    </td>
                    <td style={{ padding: '10px', color: 'var(--payi-text-muted)' }}>{it.unit}</td>
                    <td style={{ padding: '10px' }}>
                      <StatusBadge status={it.effectiveStatus} />
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      {recommendedOrder !== null && (
                        <span style={{ fontWeight: 800, color: recommendedOrder > 0 ? '#c2410c' : 'var(--payi-text-faint)' }}>
                          {recommendedOrder > 0 ? `+${fmt(recommendedOrder)}` : '-'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px', overflow: 'hidden' }}>
                      <button
                        onClick={() => setItemModal(it)}
                        title={it.reorder_date || 'กดเพื่อแก้ไข'}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--payi-text)', width: '100%', display: 'block', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {it.reorder_date || ''}
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {it.active ? (
                          <>
                            <button onClick={() => setMoveModal({ sku: it.sku, display_name: it.display_name, unit: it.unit, type: 'in' })} title="รับเข้า" style={iconBtnStyle('var(--payi-success)')}>+</button>
                            <button onClick={() => setMoveModal({ sku: it.sku, display_name: it.display_name, unit: it.unit, type: 'out' })} title="เบิกออก" style={iconBtnStyle('var(--payi-danger)')}>−</button>
                            <button onClick={() => setItemModal(it)} title="แก้ไข (รวมปรับยอดคงเหลือ)" style={iconBtnStyle('var(--payi-text-muted)')}><Pencil size={13} /></button>
                            <button onClick={() => setItemHidden(it.sku, true)} title="ซ่อนสินค้านี้ (ไม่ได้ใช้ track สต็อก)" style={iconBtnStyle('var(--payi-text-muted)')}><EyeOff size={13} /></button>
                          </>
                        ) : (
                          <button onClick={() => setItemHidden(it.sku, false)} title="ยกเลิกซ่อน" style={{ ...iconBtnStyle('var(--payi-mint-strong)'), width: 'auto', padding: '0 10px', gap: 6, display: 'flex', alignItems: 'center' }}>
                            <Eye size={13} /> กู้คืน
                          </button>
                        )}
                      </div>
                    </td>
                    </tr>
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {itemModal && (
        <ItemModal
          initial={itemModal === 'new' ? null : itemModal}
          newCategory={categoryTab}
          dailyAvg={itemModal === 'new' ? 0 : itemModal.dailyAvg || 0}
          dailyAvgBase={itemModal === 'new' ? 0 : itemModal.dailyAvgBase || 0}
          bufferPercentUsed={itemModal === 'new' ? null : itemModal.bufferPercentUsed}
          saving={saving}
          onClose={() => setItemModal(null)}
          onSave={saveItem}
          recipes={itemModal === 'new' ? [] : packagingRecipes.filter((r) => r.packaging_sku === String(itemModal.sku).toUpperCase())}
          productOptions={items.filter((it) => it.category !== 'packaging')}
          onSaveRecipe={saveRecipe}
          onDeleteRecipe={deleteRecipe}
          suggestedBufferPercent={itemModal === 'new' ? 30 : (packagingBufferSuggestion.get(String(itemModal.sku).toUpperCase()) ?? 30)}
        />
      )}

      {moveModal && (
        <MovementModal
          target={moveModal}
          saving={saving}
          onClose={() => setMoveModal(null)}
          onSave={saveMovement}
        />
      )}

    </div>
  )
}

const iconBtnStyle = (color) => ({
  border: '1px solid var(--payi-border)', background: 'var(--payi-surface-muted)', color,
  width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center',
  fontSize: 16, fontWeight: 800, cursor: 'pointer', lineHeight: 1,
})

function ItemModal({ initial, newCategory, dailyAvg, dailyAvgBase = 0, bufferPercentUsed = null, saving, onClose, onSave, recipes = [], productOptions = [], onSaveRecipe, onDeleteRecipe, suggestedBufferPercent = 30 }) {
  const isEdit = Boolean(initial)
  const isPackaging = (initial?.category || newCategory) === 'packaging'
  const [sku, setSku] = useState(initial?.sku || '')
  const [displayName, setDisplayName] = useState(initial?.display_name || '')
  const [unit, setUnit] = useState(initial?.unit || 'ชิ้น')
  const [unitsPerBatch, setUnitsPerBatch] = useState(initial?.units_per_batch || '')
  // ว่าง = ยังไม่เคยตั้งเอง ใช้ค่าแนะนำจาก Planner Control (safety_percent ของสินค้าที่ผูกไว้ เฉลี่ยกัน)
  const [bufferPercent, setBufferPercent] = useState(initial?.buffer_percent ?? '')
  const [newRecipeSku, setNewRecipeSku] = useState('')
  const [newRecipeQty, setNewRecipeQty] = useState('1')
  const [leadProd, setLeadProd] = useState(initial?.lead_time_production ?? '')
  const [leadTransport, setLeadTransport] = useState(initial?.lead_time_transport ?? '')
  const [shipFreight, setShipFreight] = useState(initial?.ship_freight ?? false)
  // เปิดมาแล้วมี lead time เดิมอยู่แล้ว = ใช้ค่าที่สูตรคำนวณให้เลยตั้งแต่เปิด ไม่ต้องรอแก้ lead time ก่อน
  const [safetyStock, setSafetyStock] = useState(
    initial?.computedSafety ?? initial?.safety_stock ?? ''
  )
  const [openingBalance, setOpeningBalance] = useState(isEdit ? '' : '0')
  const [reorderNote, setReorderNote] = useState(initial?.reorder_date || '')
  // แท็กกลุ่มสำหรับหน้า "สั่งของ" เท่านั้น (ไม่เกี่ยวกับการนับสต็อก/ยอดขาย) — ตั้งเองเพราะ deriveGroup
  // อัตโนมัติจับไซส์ตัวเลข/สีแปลกๆ ของกลุ่มพวกนี้ไม่ได้ ว่าง = สั่งได้เฉพาะเลือกทีละ SKU
  const [orderGroup, setOrderGroup] = useState(initial?.order_group || '')
  // นับสต็อกจริงไม่ตรง — แก้ตรงนี้เลยแทนป็อปอัพแยก บันทึกเป็นรายการ adjust แยกประวัติเสมอ
  const [actualBalance, setActualBalance] = useState(initial?.balance ?? '')
  const [correctionNote, setCorrectionNote] = useState('')

  // แก้ lead time/ทางเรือแล้ว คำนวณขั้นต่ำแนะนำให้ใหม่อัตโนมัติ (ยังแก้เลขเองทับได้เสมอ)
  const leadTimeTotal = (Number(leadProd) || 0) + (Number(leadTransport) || 0)
  const suggestedSafety = calcSuggestedSafety(dailyAvg, leadTimeTotal, shipFreight)
  // ขั้นต่ำ "ไม่เผื่อ" ล้วนๆ (ก่อนคูณ % เผื่อ) — ไว้โชว์แยกจากตัวที่เผื่อแล้ว ให้เห็นชัดว่าเลขไหนมาจากไหน
  const baseSafety = isPackaging ? calcSuggestedSafety(dailyAvgBase, leadTimeTotal, shipFreight) : null
  const effectiveBufferPercent = bufferPercent !== '' ? Number(bufferPercent) : (bufferPercentUsed ?? suggestedBufferPercent)
  useEffect(() => {
    if (suggestedSafety !== null) setSafetyStock(suggestedSafety)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadProd, leadTransport, shipFreight])

  const balanceDelta = isEdit && actualBalance !== '' ? Number(actualBalance) - initial.balance : 0

  const submit = (e) => {
    e.preventDefault()
    if (!sku.trim() || !displayName.trim()) return
    const payload = { sku: sku.trim(), display_name: displayName.trim(), unit, safety_stock: safetyStock }
    if (!isEdit) { payload.opening_balance = openingBalance; payload.category = newCategory }
    if (isPackaging) { payload.units_per_batch = unitsPerBatch; payload.buffer_percent = bufferPercent }
    if (!isPackaging) payload.order_group = orderGroup.trim()
    if (isEdit) {
      payload.reorder_date = reorderNote
      payload.lead_time_production = leadProd
      payload.lead_time_transport = leadTransport
      payload.ship_freight = shipFreight
      if (balanceDelta) {
        payload.balanceCorrection = {
          delta: balanceDelta,
          date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
          note: correctionNote.trim() || `ปรับยอดจากนับสต็อกจริง (เดิม ${fmt(initial.balance)} → ${fmt(Number(actualBalance))})`,
        }
      }
    }
    onSave(payload)
  }

  return (
    <Modal title={isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={labelStyle}>รหัสสินค้า (SKU)</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} disabled={isEdit} required style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }} placeholder={newCategory === 'packaging' ? 'เช่น PKG-STICKER-01' : 'เช่น PY006'} />
        </div>
        <div>
          <label style={labelStyle}>ชื่อสินค้า</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required style={inputStyle} placeholder="เช่น ถุงเท้าเจล 2in1 M" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isPackaging ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>หน่วย</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle} placeholder="คู่ / ชิ้น / แพ็ค" />
          </div>
          <div>
            <label style={labelStyle}>ขั้นต่ำ (safety stock)</label>
            <input type="number" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} style={inputStyle} placeholder="0" />
          </div>
          {isPackaging && (
            <div>
              <label style={labelStyle}>1 {unit || 'แพ็ค'} มีกี่ชิ้น</label>
              <input type="number" value={unitsPerBatch} onChange={(e) => setUnitsPerBatch(e.target.value)} style={inputStyle} placeholder="เช่น 400" />
            </div>
          )}
        </div>
        {isEdit && isPackaging && (
          dailyAvgBase ? (
            <div style={{ fontSize: 11.5, color: 'var(--payi-text-muted)', marginTop: -6 }}>
              ระบบคำนวณ (ไม่เผื่อ): <b style={{ color: 'var(--payi-text-strong)' }}>{baseSafety ?? '—'} {unit || 'แพ็ค'}</b>
              {' · '}เผื่อ {effectiveBufferPercent}%: <b style={{ color: 'var(--payi-mint-strong)' }}>{suggestedSafety ?? '—'} {unit || 'แพ็ค'}</b>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: -6 }}>ยังไม่มีข้อมูลยอดใช้ — เชื่อมกับสินค้าด้านล่าง + กรอก "1 แพ็คมีกี่ชิ้น" ก่อนถึงจะคำนวณอัตโนมัติได้</div>
          )
        )}
        {isPackaging && (
          <div>
            <label style={labelStyle}>% เผื่อ (เบิกไปฟีดล่วงหน้ามากกว่าที่ขายจริง)</label>
            <input
              type="number"
              value={bufferPercent}
              onChange={(e) => setBufferPercent(e.target.value)}
              style={inputStyle}
              placeholder={`แนะนำ ${suggestedBufferPercent}% (จาก Planner Control)`}
            />
          </div>
        )}
        {isEdit && isPackaging && (
          <div style={{ background: 'var(--payi-surface-muted)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>เชื่อมกับสินค้า (ไว้คำนวณยอดใช้เฉลี่ยจากยอดขายจริง)</div>
            {recipes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recipes.map((r) => (
                  <div key={r.product_sku} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ flex: 1, color: 'var(--payi-text-strong)' }}>{r.product_name} <span style={{ color: 'var(--payi-text-faint)', fontFamily: 'monospace' }}>({r.product_sku})</span></span>
                    <span style={{ color: 'var(--payi-text-muted)' }}>× {r.qty_per_unit}</span>
                    <button type="button" onClick={() => onDeleteRecipe(sku, r.product_sku)} style={{ border: 'none', background: 'none', color: 'var(--payi-danger)', cursor: 'pointer', padding: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>SKU สินค้า</label>
                <input
                  list="product-sku-options"
                  value={newRecipeSku}
                  onChange={(e) => setNewRecipeSku(e.target.value)}
                  style={inputStyle}
                  placeholder="เช่น PY006"
                />
                <datalist id="product-sku-options">
                  {productOptions.map((p) => <option key={p.sku} value={p.sku}>{p.display_name}</option>)}
                </datalist>
              </div>
              <div style={{ width: 70 }}>
                <label style={labelStyle}>ต่อชิ้น</label>
                <input type="number" value={newRecipeQty} onChange={(e) => setNewRecipeQty(e.target.value)} style={inputStyle} />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!newRecipeSku.trim()) return
                  onSaveRecipe(sku, newRecipeSku.trim().toUpperCase(), Number(newRecipeQty) || 1)
                  setNewRecipeSku(''); setNewRecipeQty('1')
                }}
                style={{ height: 38, padding: '0 12px', border: 'none', borderRadius: 8, background: 'var(--payi-gradient-primary)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
              >
                เพิ่ม
              </button>
            </div>
            {!dailyAvg && !recipes.length && (
              <div style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>ยังไม่เชื่อมกับสินค้าไหน — "ขั้นต่ำ" จะกรอกเองล้วนๆ ไม่คำนวณอัตโนมัติ</div>
            )}
          </div>
        )}
        {isEdit && (
          <div style={{ background: 'var(--payi-surface-muted)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>Lead time (ไว้คำนวณขั้นต่ำแนะนำอัตโนมัติ)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>ผลิต (วัน)</label>
                <input type="number" value={leadProd} onChange={(e) => setLeadProd(e.target.value)} style={inputStyle} placeholder="0" />
              </div>
              <div>
                <label style={labelStyle}>ขนส่ง (วัน)</label>
                <input type="number" value={leadTransport} onChange={(e) => setLeadTransport(e.target.value)} style={inputStyle} placeholder="0" />
              </div>
            </div>
            {!isPackaging && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={shipFreight} onChange={(e) => setShipFreight(e.target.checked)} />
                ส่งทางเรือ (เผื่อเวลาเพิ่มอีกครึ่งของ lead time)
              </label>
            )}
            {!isPackaging && (
              <div style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>
                {dailyAvg
                  ? `ยอดขายเฉลี่ย ${dailyAvg.toFixed(1)}/วัน${suggestedSafety !== null ? ` — แนะนำขั้นต่ำ ${suggestedSafety}` : ' — กรอก lead time เพื่อคำนวณ'}`
                  : 'ไม่มีข้อมูลยอดขาย 30 วันล่าสุดของ SKU นี้ — คำนวณอัตโนมัติไม่ได้ ต้องกรอกขั้นต่ำเอง'}
              </div>
            )}
            {isPackaging && (
              <div>
                <label style={labelStyle}>วันเติมสินค้า/รอเช็ค</label>
                <input
                  value={reorderNote}
                  onChange={(e) => setReorderNote(e.target.value)}
                  style={inputStyle}
                  placeholder="เช่น สั่งแล้ว 2 ล็อต ล็อตแรกมา 200/500 รออีก 300 ต้นเดือน"
                />
              </div>
            )}
          </div>
        )}
        {!isEdit && !isPackaging && (
          <div>
            <label style={labelStyle}>ยอดคงเหลือเริ่มต้น</label>
            <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} style={inputStyle} placeholder="0" />
          </div>
        )}
        {!isPackaging && (
          <div>
            <label style={labelStyle}>กลุ่มสำหรับสั่งของ (ไม่บังคับ)</label>
            <input
              value={orderGroup}
              onChange={(e) => setOrderGroup(e.target.value)}
              style={inputStyle}
              placeholder="เช่น รองเท้าเพื่อสุขภาพ — ตั้งชื่อเดียวกันทุกไซส์/สีที่อยากสั่งพร้อมกันได้"
            />
            <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', marginTop: 4 }}>
              สินค้าที่ตั้งชื่อกลุ่มเดียวกัน จะเลือก "สั่งทั้งกลุ่ม" ได้จากหน้า Stock Movement/ไลน์ แทนที่ต้องเลือกทีละ SKU
            </div>
          </div>
        )}
        {isEdit && !isPackaging && (
          <div>
            <label style={labelStyle}>วันเติมสินค้า/รอเช็ค</label>
            <input
              value={reorderNote}
              onChange={(e) => setReorderNote(e.target.value)}
              style={inputStyle}
              placeholder="เช่น สั่งแล้ว 2 ล็อต ล็อตแรกมา 200/500 รออีก 300 ต้นเดือน"
            />
          </div>
        )}
        {isEdit && !isPackaging && (
          <div style={{ background: 'var(--payi-surface-muted)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)' }}>
              ปรับยอดคงเหลือ (นับสต็อกจริงไม่ตรง) — ในระบบตอนนี้ {fmt(initial.balance)} {unit}
            </div>
            <input
              type="number"
              value={actualBalance}
              onChange={(e) => setActualBalance(e.target.value)}
              style={inputStyle}
              placeholder="นับจริงได้เท่าไหร่"
            />
            {balanceDelta !== 0 && (
              <div style={{ fontSize: 12, fontWeight: 700, color: balanceDelta > 0 ? 'var(--payi-success)' : 'var(--payi-danger)' }}>
                ส่วนต่าง: {balanceDelta > 0 ? '+' : ''}{fmt(balanceDelta)} {unit}
              </div>
            )}
            {balanceDelta !== 0 && (
              <input
                value={correctionNote}
                onChange={(e) => setCorrectionNote(e.target.value)}
                style={inputStyle}
                placeholder="หมายเหตุ — ไม่บังคับ (ไม่กรอกจะบันทึกอัตโนมัติ)"
              />
            )}
          </div>
        )}
        <button type="submit" disabled={saving} style={{ marginTop: 2, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 8px 18px rgba(37,99,235,0.22)' }}>
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </form>
    </Modal>
  )
}

function MovementModal({ target, saving, onClose, onSave }) {
  const [type, setType] = useState(target.type || 'in')
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))
  const [note, setNote] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!qty || Number(qty) === 0) return
    onSave({ sku: target.sku, type, qty, date, note })
  }

  return (
    <Modal title={`บันทึกรายการ — ${target.display_name}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <label style={labelStyle}>{type === 'adjust' ? `จำนวนที่ปรับ (${target.unit}) — ใส่ลบถ้าลดยอด` : `จำนวน (${target.unit})`}</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} required style={inputStyle} placeholder="0" />
        </div>
        <div>
          <label style={labelStyle}>วันที่</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
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
