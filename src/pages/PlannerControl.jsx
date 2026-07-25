import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Pencil, X } from 'lucide-react'

const STORAGE_KEY = 'payi-planner-products-mockup'
const EXCLUDED_PRODUCTS_KEY = 'payi-planner-excluded-products'
const DEMAND_MODE_KEY = 'payi-planner-demand-mode'
const SALES_CACHE_KEY = 'payi-planner-sales-30d-gross-v3'
const SALES_REFRESH_MS = 6 * 60 * 60 * 1000
const MANPOWER_CACHE_KEY = 'payi-manpower-today-cache'
const MANPOWER_REFRESH_MS = 30 * 60 * 1000
const RESERVE_DAY_OPTIONS = [0.5, 1, 1.5, 2, 3, 5, 7]
const todayBangkok = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const DEMAND_MODES = {
  normal: { label: 'ปกติ', multiplier: 1, note: 'ใช้ยอดเฉลี่ยย้อนหลัง' },
  surge: { label: 'ยอดพุ่ง +50%', multiplier: 1.5, note: 'ใช้เมื่อรู้ว่าจะมีไลฟ์หรือยิงแอดแรง' },
  promo: { label: 'วันโปร ×2', multiplier: 2, note: 'ใช้ก่อนวันโปรหรือแคมเปญใหญ่' },
}
const normalizeProductName = (value) => String(value || '').trim().toLowerCase().replace(/[\s()[\]{}._\-/]+/g, '')
const productNamesMatch = (left, right) => {
  const a = normalizeProductName(left); const b = normalizeProductName(right)
  if (!a || !b) return false
  return a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)))
}
const plannerProduct = (mapped, saved = {}) => ({
  ...saved,
  id: `sku-${mapped.masterSku}`,
  masterSku: mapped.masterSku,
  name: mapped.displayName,
  group: saved.group || 'C',
  feeders: Array.isArray(saved.feeders) ? saved.feeders : [],
  reserveDays: RESERVE_DAY_OPTIONS.includes(Number(saved.reserveDays)) ? Number(saved.reserveDays) : 1,
  stock: Number(saved.stock) || 0,
  daily: Number(saved.daily) || 0,
  targetDays: 1,
  safetyPercent: Number.isFinite(Number(saved.safetyPercent)) ? Number(saved.safetyPercent) : 30,
  dayFeed: Number(saved.dayFeed) || 0,
  otFeed: Number(saved.otFeed) || 0,
  claimRate: Number(saved.claimRate) || 0,
  note: saved.note || '',
})
const loadProducts = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    const snapshot = JSON.parse(localStorage.getItem(SALES_CACHE_KEY) || 'null')
    const mapping = snapshot?.productMapping || []
    const bySku = new Map((Array.isArray(saved) ? saved : []).filter((item) => item.masterSku).map((item) => [item.masterSku, item]))
    const byName = new Map((Array.isArray(saved) ? saved : []).map((item) => [normalizeProductName(item.name), item]))
    return mapping.map((mapped) => plannerProduct(mapped, bySku.get(mapped.masterSku) || byName.get(normalizeProductName(mapped.displayName))))
  } catch { return [] }
}

const fmt = (value) => Number(value || 0).toLocaleString('th-TH')
const roundUp10 = (value) => value > 0 ? Math.ceil(Number(value) / 10) * 10 : 0
const groupColor = { A: '#dc2626', B: '#d97706', C: '#2563eb', NEW: '#64748b' }
const panel = { background: '#fff', border: '1px solid #dce8f5', borderRadius: 20, boxShadow: '0 12px 32px rgba(37,99,235,.05)' }
const input = { width: 76, border: '1px solid #cfe0f3', borderRadius: 8, padding: '8px 9px', fontSize: 14, textAlign: 'right', outline: 'none', boxSizing: 'border-box' }

export default function PlannerControl({ onNavigate }) {
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('payi-user') || 'null') } catch { return null } })()
  const [products, setProducts] = useState(loadProducts)
  const [message, setMessage] = useState('')
  const [modal, setModal] = useState(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [feedPeopleFor, setFeedPeopleFor] = useState(null)
  const [plannerData, setPlannerData] = useState(null)
  const [plannerStatus, setPlannerStatus] = useState('loading')
  const [plannerSaving, setPlannerSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [excludedSkus, setExcludedSkus] = useState(() => {
    try { return JSON.parse(localStorage.getItem(EXCLUDED_PRODUCTS_KEY) || '[]') }
    catch { return [] }
  })
  const [demandMode, setDemandMode] = useState(() => localStorage.getItem(DEMAND_MODE_KEY) || 'normal')
  const [salesSnapshot, setSalesSnapshot] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SALES_CACHE_KEY) || 'null') }
    catch { return null }
  })
  const [manpowerSnapshot, setManpowerSnapshot] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MANPOWER_CACHE_KEY) || 'null') }
    catch { return null }
  })
  const [selectedDate, setSelectedDate] = useState(todayBangkok)
  const [masterOrder, setMasterOrder] = useState(() => [])
  const [mergedOnce, setMergedOnce] = useState(false)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(products)) }, [products])
  useEffect(() => { localStorage.setItem(EXCLUDED_PRODUCTS_KEY, JSON.stringify(excludedSkus)) }, [excludedSkus])
  useEffect(() => { localStorage.setItem(DEMAND_MODE_KEY, demandMode) }, [demandMode])
  useEffect(() => {
    let active = true
    setPlannerStatus('loading')
    setMergedOnce(false)
    fetch(`/api/sheet-tools?op=planner&date=${selectedDate}`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!active || !ok || !data?.success) throw new Error(data?.error || 'โหลด Planner ไม่สำเร็จ')
        setPlannerData(data)
        const disabled = (data.config || []).filter((row) => String(row.enabled) === '0').map((row) => String(row.master_sku).toUpperCase())
        if (data.config?.length) setExcludedSkus(disabled)
        if (data.daily?.[0]?.demand_mode) setDemandMode(data.daily[0].demand_mode)
        if (!data.config?.length && !data.daily?.length) setDirty(true)
        setPlannerStatus('ready')
      })
      .catch(() => { if (active) setPlannerStatus('offline') })
    return () => { active = false }
  }, [selectedDate])
  useEffect(() => {
    const fetchedAt = new Date(salesSnapshot?.fetchedAt || 0).getTime()
    const mappedSkus = new Set((salesSnapshot?.productMapping || []).map((item) => String(item.masterSku || '').toUpperCase()))
    const hasMappedSales = (salesSnapshot?.items || []).some((item) => mappedSkus.has(String(item.masterSku || '').toUpperCase()))
    if (fetchedAt && Date.now() - fetchedAt < SALES_REFRESH_MS && mappedSkus.size && hasMappedSales) return undefined
    let active = true
    fetch('/api/planner-sales?days=30')
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data?.success) return
        setSalesSnapshot(data)
        localStorage.setItem(SALES_CACHE_KEY, JSON.stringify(data))
      })
      .catch(() => {})
    return () => { active = false }
  }, [salesSnapshot?.fetchedAt])
  useEffect(() => {
    if (salesSnapshot?.productMapping?.length) return
    let active = true
    fetch('/api/claims?view=mapping-options')
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data?.success) return
        const productMapping = (data.products || [])
          .map((item) => ({ masterSku: String(item.master_sku || '').trim().toUpperCase(), displayName: String(item.display_name || item.master_sku || '').trim() }))
          .filter((item) => /^PY/.test(item.masterSku))
        if (!productMapping.length) return
        setSalesSnapshot((current) => {
          const next = { ...(current || {}), success: true, productMapping, fetchedAt: current?.fetchedAt || new Date().toISOString() }
          localStorage.setItem(SALES_CACHE_KEY, JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
    return () => { active = false }
  }, [salesSnapshot?.productMapping?.length])
  useEffect(() => {
    // รายชื่ออาจโหลดจาก Product Mapping ได้ แม้ planner-sales ล้มเหลว/ติด quota
    // ถ้ายังไม่มียอด ให้ใช้ข้อมูลที่ Dashboard Import มีอยู่แล้วและรวมตาม Master SKU (PY...)
    const mappedSkus = new Set((salesSnapshot?.productMapping || []).map((item) => String(item.masterSku || '').toUpperCase()))
    const hasMappedSales = (salesSnapshot?.items || []).some((item) => mappedSkus.has(String(item.masterSku || '').toUpperCase()))
    if (mappedSkus.size && hasMappedSales) return
    let active = true
    fetch('/api/sheet-tools?op=summary')
      .then((response) => response.json())
      .then((data) => {
        if (!active || !Array.isArray(data?.skus)) return
        const dates = (data.daily || []).map((row) => String(row.date || '').slice(0, 10)).filter(Boolean).sort()
        const start = dates[0] || ''
        const anchor = dates[dates.length - 1] || ''
        const days = start && anchor ? Math.max(1, Math.round((new Date(`${anchor}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1) : 90
        const bySku = new Map()
        for (const row of data.skus) {
          const masterSku = String(row.sku || '').trim().toUpperCase()
          if (!/^PY/.test(masterSku)) continue
          let item = bySku.get(masterSku)
          if (!item) bySku.set(masterSku, (item = { key: masterSku, masterSku, name: row.name || masterSku, units90: 0, lastDate: anchor }))
          item.units90 += Number(row.grossQty ?? row.qty ?? 0)
        }
        const items = [...bySku.values()].map((item) => ({ ...item, dailyAverage: item.units90 / days }))
        if (!items.length) return
        setSalesSnapshot((current) => {
          const next = { ...(current || {}), success: true, items, start, anchor, days, source: 'dashboard-import', fetchedAt: new Date().toISOString() }
          localStorage.setItem(SALES_CACHE_KEY, JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
    return () => { active = false }
  }, [salesSnapshot?.items?.length, salesSnapshot?.productMapping?.length])
  useEffect(() => {
    const mapping = salesSnapshot?.productMapping || []
    if (!mapping.length) return
    setProducts((current) => {
      const bySku = new Map(current.filter((item) => item.masterSku).map((item) => [item.masterSku, item]))
      const byName = new Map(current.map((item) => [normalizeProductName(item.name), item]))
      const configBySku = new Map((plannerData?.config || []).map((row) => [String(row.master_sku).toUpperCase(), row]))
      const dailyBySku = new Map((plannerData?.daily || []).map((row) => [String(row.master_sku).toUpperCase(), row]))
      const latestBySku = new Map(Object.entries(plannerData?.latestBySku || {}).map(([sku, row]) => [sku.toUpperCase(), row]))
      // เคยมีปัญหา: สลับไปดูวันอื่นที่ยังไม่เคยกรอก FG/ฟีดวันนี้ แล้วเห็นเลขของวันก่อนหน้าค้างอยู่แบบไม่รู้ตัว (ไม่มีป้ายเตือน)
      // ตอนนี้แก้เป็น "ยกยอด FG จากวันล่าสุดที่มีมาให้อัตโนมัติ" (ไม่ต้องพิมพ์ใหม่ทุกวัน) แต่ติดป้ายเตือนว่าไม่ได้อัปเดตวันนี้ (stockStaleDays)
      // จะ fallback ไป saved เฉพาะตอนยังโหลดจากเซิร์ฟเวอร์ไม่สำเร็จเลย (plannerData เป็น null) เพื่อไม่ให้หน้าจอว่างเปล่าตอนออฟไลน์
      const hasServerData = Boolean(plannerData)
      return mapping.map((mapped) => {
        const saved = bySku.get(mapped.masterSku) || byName.get(normalizeProductName(mapped.displayName)) || {}
        const config = configBySku.get(mapped.masterSku) || {}
        const daily = dailyBySku.get(mapped.masterSku) || {}
        const hasTodayRow = dailyBySku.has(mapped.masterSku)
        const carried = latestBySku.get(mapped.masterSku)
        const stockStaleDays = hasServerData && !hasTodayRow && carried ? Math.max(0, Math.round((new Date(`${selectedDate}T00:00:00`) - new Date(`${carried.date}T00:00:00`)) / 86400000)) : 0
        return plannerProduct(mapped, {
          ...saved,
          reserveDays: config.reserve_days ?? saved.reserveDays,
          safetyPercent: config.safety_percent ?? saved.safetyPercent,
          stock: hasTodayRow ? (Number(daily.fg) || 0) : (hasServerData ? Number(carried?.fg ?? 0) : saved.stock),
          stockStaleDays,
          dayFeed: daily.planned_feed ?? (hasServerData ? 0 : saved.dayFeed),
          feeders: daily.feeders ? String(daily.feeders).split('·').map((name) => name.trim()).filter(Boolean) : (hasServerData ? [] : saved.feeders),
        })
      })
    })
    if (plannerData) setMergedOnce(true)
  }, [salesSnapshot?.productMapping, plannerData, selectedDate])
  useEffect(() => {
    const fetchedAt = Number(manpowerSnapshot?.fetchedAt || 0)
    if (fetchedAt && Date.now() - fetchedAt < MANPOWER_REFRESH_MS) return undefined
    let active = true
    fetch('/api/sheet-tools?op=workforce&sourceOnly=1')
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data?.success) return
        const snapshot = { fetchedAt: Date.now(), rows: data.sourceManpower || [] }
        setManpowerSnapshot(snapshot)
        localStorage.setItem(MANPOWER_CACHE_KEY, JSON.stringify(snapshot))
      })
      .catch(() => {})
    return () => { active = false }
  }, [manpowerSnapshot?.fetchedAt])

  const salesByName = useMemo(() => {
    const matched = products.map((product) => {
      const rows = (salesSnapshot?.items || []).filter((item) => product.masterSku ? String(item.masterSku).toUpperCase() === product.masterSku : productNamesMatch(product.name, item.name))
      const units90 = rows.reduce((sum, item) => sum + Number(item.units90 || 0), 0)
      const lastDate = rows.reduce((latest, item) => item.lastDate > latest ? item.lastDate : latest, '')
      const dailyAverage = rows.reduce((sum, item) => sum + Number(item.dailyAverage || 0), 0)
      return { key: normalizeProductName(product.name), units90, dailyAverage, lastDate }
    }).filter((item) => item.units90 > 0).sort((a, b) => b.units90 - a.units90)
    const totalUnits = matched.reduce((sum, item) => sum + item.units90, 0)
    let cumulative = 0
    return new Map(matched.map((item) => {
      const before = totalUnits ? cumulative / totalUnits : 1
      const abc = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'
      cumulative += item.units90
      const dailyAverage = item.dailyAverage || (item.units90 / Number(salesSnapshot?.days || 90))
      return [item.key, { ...item, abc, dailyAverage: Math.round(dailyAverage * 10) / 10 }]
    }))
  }, [products, salesSnapshot])
  const peopleAtWork = useMemo(() => {
    const byName = new Map()
    for (const row of manpowerSnapshot?.rows || []) {
      if (row.date !== selectedDate || !row.employee) continue
      if (!byName.has(row.employee)) byName.set(row.employee, { name: row.employee, group: row.group || 'อื่น ๆ' })
    }
    return [...byName.values()]
  }, [manpowerSnapshot, selectedDate])

  const rows = useMemo(() => products.map((item) => {
    const mode = DEMAND_MODES[demandMode] || DEMAND_MODES.normal
    const sales = salesByName.get(normalizeProductName(item.name))
    const daily = roundUp10(Number(sales?.dailyAverage || item.daily || 0))
    const abc = sales?.abc || 'NEW'
    const reserveDays = RESERVE_DAY_OPTIONS.includes(Number(item.reserveDays)) ? Number(item.reserveDays) : 1
    const averageTarget = daily * reserveDays
    const surgeTarget = averageTarget * mode.multiplier
    const safetyStock = roundUp10(averageTarget * (Number(item.safetyPercent || 0) / 100))
    const targetStock = roundUp10(surgeTarget + safetyStock)
    const need = roundUp10(Math.max(0, targetStock - item.stock))
    const remaining = roundUp10(Math.max(0, need - item.dayFeed))
    const cover = daily ? item.stock / daily : 0
    return { ...item, daily, abc, reserveDays, salesUnits90: sales?.units90 || 0, salesDays: Number(salesSnapshot?.days || 90), salesLastDate: sales?.lastDate || '', need, remaining, cover, targetStock, averageTarget, surgeTarget, safetyStock, demandMode, demandLabel: mode.label }
  }), [products, demandMode, salesByName])

  const activeRows = rows.filter((item) => !excludedSkus.includes(item.masterSku))
  // ล็อคทั้งรายชื่อและลำดับของทุกแถวไว้ ณ ตอนโหลดข้อมูล/เปลี่ยนวันที่ — กันไม่ให้แถวที่เพิ่งเติม
  // FG จนครบหายวับออกจากลิสต์ หรือลำดับขยับเด้งไปมาต่อหน้าคนกำลังกรอก (บอสแจ้งว่างงมาก อยากให้อยู่กับที่)
  // เรียงตาม master SKU (PY001, PY002, ...) เป๊ะๆ แบบเดียวกับหน้า Inventory.jsx
  // (บรรทัด `String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true })`)
  useEffect(() => {
    // รอให้ merge ค่า FG/stock จริงจากเซิร์ฟเวอร์เสร็จก่อน (mergedOnce) ไม่ใช่แค่ plannerStatus พร้อม —
    // เคยพลาด: plannerStatus เป็น 'ready' ก่อน products จะอัปเดตค่าจริงหนึ่ง render เสมอ (คนละ effect กัน)
    // ถ้าล็อคลำดับตอนนั้นเลย ค่า need/remaining ที่ใช้จัดลำดับจะเป็นค่าเก่า/ค่า default ยังไม่ใช่ของจริง
    if (!mergedOnce) return
    const sorted = [...activeRows].sort((a, b) => String(a.masterSku).localeCompare(String(b.masterSku), undefined, { numeric: true }))
    setMasterOrder(sorted.map((item) => item.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, mergedOnce])
  const orderIndex = new Map(masterOrder.map((id, index) => [id, index]))
  const indexOf = (item) => orderIndex.has(item.id) ? orderIndex.get(item.id) : masterOrder.length
  const visible = [...activeRows].sort((a, b) => indexOf(a) - indexOf(b) || a.name.localeCompare(b.name, 'th'))
  const totalRemaining = activeRows.reduce((sum, item) => sum + item.remaining, 0)
  const urgent = activeRows.filter((item) => item.remaining > 0).length

  const update = (id, key, value) => { setProducts((current) => current.map((item) => item.id === id ? { ...item, [key]: Math.max(0, Number(value) || 0) } : item)); setDirty(true) }
  const updateFeeders = (id, feeders) => { setProducts((current) => current.map((item) => item.id === id ? { ...item, feeders } : item)); setDirty(true) }
  const toggleExcluded = (masterSku) => { setExcludedSkus((current) => current.includes(masterSku) ? current.filter((sku) => sku !== masterSku) : [...current, masterSku]); setDirty(true) }
  const changeDemandMode = (key) => {
    if (key === demandMode) return
    if (key !== 'normal' && !window.confirm(`ยืนยันใช้โหมด “${DEMAND_MODES[key].label}” กับสินค้าทั้งตาราง?`)) return
    setDemandMode(key); setDirty(true)
  }
  const saveProduct = (product) => {
    const name = product.name.trim()
    if (!name) return setMessage('กรุณาระบุชื่อสินค้า')
    if (products.some((item) => item.id !== product.id && item.name.trim().toLowerCase() === name.toLowerCase())) return setMessage('มีสินค้านี้ในรายการแล้ว')
    const normalized = { ...product, id: product.id || `planner-${Date.now()}`, name, group: product.group || 'C', feeders: Array.isArray(product.feeders) ? product.feeders : [], reserveDays: RESERVE_DAY_OPTIONS.includes(Number(product.reserveDays)) ? Number(product.reserveDays) : 1, stock: Number(product.stock) || 0, daily: Number(product.daily) || 0, targetDays: Math.max(1, Number(product.targetDays) || 1), safetyPercent: Math.max(0, Number(product.safetyPercent) || 0), dayFeed: Number(product.dayFeed) || 0, otFeed: Number(product.otFeed) || 0, claimRate: Number(product.claimRate) || 0, note: product.note?.trim() || '' }
    setProducts((current) => product.id ? current.map((item) => item.id === product.id ? normalized : item) : [...current, normalized])
    setDirty(true); setModal(null); setMessage(product.id ? `แก้ไข ${name} แล้ว` : `เพิ่ม ${name} ในแผนแล้ว`)
  }
  const createOt = (item) => {
    localStorage.setItem('payi-planner-ot-draft', JSON.stringify({ productId: item.id, product: item.name, remaining: item.remaining, createdAt: new Date().toISOString() }))
    if (onNavigate) onNavigate('Workforce OT')
    else setMessage(`เตรียมแผน OT: ${item.name} · ${fmt(item.remaining)} ชิ้น`)
  }
  const savePlanner = async () => {
    setPlannerSaving(true); setMessage('')
    try {
      const response = await fetch('/api/sheet-tools?op=planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'save-all',
        date: selectedDate,
        updated_by: currentUser?.display_name || currentUser?.name || currentUser?.username || 'Planner',
        config: products.map((item) => ({ master_sku: item.masterSku, enabled: !excludedSkus.includes(item.masterSku), reserve_days: item.reserveDays, safety_percent: item.safetyPercent })),
        daily: activeRows.map((item) => ({ date: selectedDate, master_sku: item.masterSku, fg: item.stock, sales_average: item.daily, demand_mode: demandMode, recommended_feed: item.need, planned_feed: item.dayFeed, feeders: item.feeders || [] })),
      }) })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'บันทึก Planner ไม่สำเร็จ')
      setDirty(false); setPlannerStatus('saved')
    } catch (error) { setPlannerStatus('offline'); setMessage(error.message) }
    finally { setPlannerSaving(false) }
  }
  // แก้ตารางแล้วเซฟให้อัตโนมัติ (ไม่ต้องกดปุ่ม) — รอ 1.2s หลังหยุดพิมพ์ค่อยยิง กันยิง API รัวทุกตัวอักษร
  useEffect(() => {
    if (!dirty || plannerStatus === 'loading' || !products.length) return undefined
    const timer = setTimeout(() => { savePlanner() }, 1200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, products, excludedSkus, demandMode, selectedDate, plannerStatus])

  return <div className="planner-control-page" style={{ display: 'grid', gap: 14 }}>
    <div style={{ ...panel, padding: 18, background: 'linear-gradient(135deg,#eef8ff,#ffffff 70%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><b style={{ fontSize: 21, color: '#102a43' }}>{selectedDate === todayBangkok() ? 'แผนผลิตวันนี้' : 'แผนผลิต'}</b><span style={{ borderRadius: 999, padding: '4px 9px', background: plannerStatus === 'offline' ? '#fff1f2' : '#e7f7f2', color: plannerStatus === 'offline' ? '#be123c' : '#087765', fontSize: 11, fontWeight: 900 }}>{plannerSaving ? 'กำลังบันทึก…' : plannerStatus === 'loading' ? 'กำลังเชื่อมต่อ' : plannerStatus === 'offline' ? 'ยังไม่บันทึกส่วนกลาง' : dirty ? 'มีการแก้ไข · รอบันทึกอัตโนมัติ' : 'บันทึกส่วนกลางแล้ว'}</span></div>
        <div style={{ color: '#64748b', fontSize: 13, marginTop: 5 }}>ยอดเฉลี่ยย้อนหลัง + ของกันพุ่ง − FG → ระบบแนะนำจำนวนฟีดให้ · แก้แล้วบันทึกให้อัตโนมัติ</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input type="date" value={selectedDate} onChange={(event) => event.target.value && setSelectedDate(event.target.value)} style={{ ...formInput, width: 150 }} />
        {selectedDate !== todayBangkok() && <button type="button" onClick={() => setSelectedDate(todayBangkok())} style={secondaryButton}>วันนี้</button>}
      </div>
    </div>

    {message && <div style={{ padding: '11px 14px', borderRadius: 10, background: '#e7f7f2', color: '#087765', fontWeight: 800 }}>{message}</div>}

    <div style={{ ...panel, padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <QuickStat label="ต้องทำวันนี้" value={`${urgent} SKU`} color="#dc2626" />
      <QuickStat label="ยังขาด" value={`${fmt(totalRemaining)} ชิ้น`} color="#d97706" />
      <QuickStat label="Manpower" value="4 คน" color="#2563eb" />
      {!salesSnapshot?.anchor && <div style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>ยังไม่มีประวัติยอดขาย · สินค้าจะแสดง NEW</div>}
    </div>

    <div style={{ ...panel, padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ marginRight: 4 }}><b style={{ color: '#102a43' }}>พรุ่งนี้คาดว่า</b><div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{DEMAND_MODES[demandMode]?.note}</div></div>
      {Object.entries(DEMAND_MODES).map(([key, mode]) => <button key={key} type="button" onClick={() => changeDemandMode(key)} style={{ ...simpleTab(demandMode === key), padding: '9px 13px' }}>{mode.label}</button>)}
      <div style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>เปลี่ยนเฉพาะวันที่มีเหตุการณ์พิเศษ · ระบบจำค่าที่เลือกไว้</div>
    </div>

    <section style={{ ...panel, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><b style={{ color: '#102a43', fontSize: 17 }}>สิ่งที่ต้องทำวันนี้</b><div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>ใส่จำนวนผลิตวันนี้ แล้วดูว่ายังต้องเปิด OT หรือไม่</div></div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <button type="button" onClick={() => setManageOpen(true)} style={secondaryButton}>จัดการสินค้า</button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 900, tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 14 }}>
        <colgroup><col style={{ width: '22%' }}/><col style={{ width: '8%' }}/><col style={{ width: '8%' }}/><col style={{ width: '8%' }}/><col style={{ width: '9%' }}/><col style={{ width: '11%' }}/><col style={{ width: '16%' }}/><col style={{ width: '9%' }}/><col style={{ width: '9%' }}/></colgroup>
        <thead><tr style={{ background: '#f1f7fd', color: '#52677a' }}>{['สินค้า','FG','เฉลี่ย/วัน','เผื่อวัน','กันพุ่ง','แนะนำฟีด','ฟีดวันนี้','ยังขาด',''].map((head, index) => <th key={`${head}-${index}`} style={{ padding: '11px 8px', whiteSpace: 'nowrap', textAlign: index === 0 ? 'left' : 'center' }}>{head}</th>)}</tr></thead>
        <tbody>{visible.map((item) => <tr key={item.id} style={{ borderTop: '1px solid #e7eef6', background: item.remaining > 0 ? '#fff' : '#fbfefc' }}>
          <td style={{ ...td, minWidth: 210 }}><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span title={item.abc === 'NEW' ? 'ยังไม่พบยอดขายย้อนหลัง' : `ขาย ${fmt(item.salesUnits90)} ชิ้นใน ${item.salesDays} วัน`} style={{ display: 'inline-grid', placeItems: 'center', minWidth: item.abc === 'NEW' ? 38 : 25, height: 25, padding: '0 5px', borderRadius: 7, background: `${groupColor[item.abc]}16`, color: groupColor[item.abc], fontWeight: 900, fontSize: item.abc === 'NEW' ? 10 : 13 }}>{item.abc}</span><div style={{ minWidth: 0 }}><b style={{ display: 'block', color: '#102a43', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</b><span style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>{item.masterSku}</span></div></div></td>
          <td style={{ ...td, textAlign: 'center' }}>
            <LockedNumberInput value={item.stock} onChange={(value) => update(item.id, 'stock', value)} label={`FG ${item.name}`} stale={item.stockStaleDays >= 2 ? 'danger' : item.stockStaleDays >= 1 ? 'warning' : null}/>
            {item.stockStaleDays > 0 && <div style={{ marginTop: 3, fontSize: 10, fontWeight: 800, color: item.stockStaleDays >= 2 ? '#dc2626' : '#b45309' }}>ยกยอด {item.stockStaleDays} วันก่อน</div>}
          </td>
          <td style={{ ...td, textAlign: 'center' }}>{fmt(item.daily)}</td>
          <td style={{ ...td, textAlign: 'center' }}><LockedDaysSelect value={item.reserveDays} onChange={(value) => update(item.id, 'reserveDays', value)}/></td>
          <td style={{ ...td, textAlign: 'center', color: '#b45309', fontWeight: 850 }}>+{fmt(item.safetyStock)}</td>
          <td style={{ ...td, textAlign: 'center', color: '#155f98', fontWeight: 900 }}>{fmt(item.need)}</td>
          <td style={{ ...td, textAlign: 'center' }}><div style={{ display: 'grid', gridTemplateColumns: 'minmax(58px,1fr) auto', gap: 5, alignItems: 'center' }}><LockedNumberInput value={item.dayFeed} onChange={(value) => update(item.id, 'dayFeed', value)} label={`ฟีดวันนี้ ${item.name}`}/><button type="button" onClick={() => setFeedPeopleFor(item.id)} style={{ ...secondaryButton, padding: '8px 8px', whiteSpace: 'nowrap' }}>{item.feeders?.length ? `${item.feeders.length} คน` : 'เลือกคน'}</button></div>{item.feeders?.length > 0 && <div title={item.feeders.join(' · ')} style={{ marginTop: 5, color: '#64748b', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.feeders.join(' · ')}</div>}</td>
          <td style={{ ...td, textAlign: 'center' }}>{item.remaining > 0 ? <span style={{ color: '#dc2626', background: '#fff1f2', borderRadius: 999, padding: '5px 9px', fontWeight: 900 }}>{fmt(item.remaining)}</span> : <span style={{ color: '#16866f', fontWeight: 900 }}>ครบ</span>}</td>
          <td style={td}><div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}><button onClick={() => setModal({ mode: 'detail', item })} style={{ ...secondaryButton, padding: '7px 9px' }}>ดู</button>{item.remaining > 0 && <button onClick={() => createOt(item)} style={{ ...primaryButton, padding: '7px 9px' }}>วาง OT</button>}</div></td>
        </tr>)}</tbody>
      </table>{!visible.length && <div style={{ padding: 36, textAlign: 'center', color: '#16866f', fontWeight: 850 }}>วันนี้ไม่มีสินค้าที่ต้องจัดการเพิ่ม</div>}</div>
    </section>
    {modal && <ProductModal key={`${modal.mode}-${modal.item?.id || 'new'}`} modal={modal} onClose={() => setModal(null)} onSave={saveProduct} onEdit={() => setModal({ mode: 'edit', item: modal.item })} onCreateOt={() => { createOt(modal.item); setModal(null) }} />}
    {manageOpen && <ManageMappedProducts products={rows} excludedSkus={excludedSkus} onToggle={toggleExcluded} onClose={() => setManageOpen(false)} />}
    {feedPeopleFor && <FeedPeopleModal item={products.find((item) => item.id === feedPeopleFor)} people={peopleAtWork} date={selectedDate} onChange={(feeders) => updateFeeders(feedPeopleFor, feeders)} onClose={() => setFeedPeopleFor(null)} />}
  </div>
}

function QuickStat({ label, value, color }) { return <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><span style={{ color: '#64748b', fontSize: 12 }}>{label}</span><b style={{ color, fontSize: 18 }}>{value}</b></div> }

function ManageMappedProducts({ products, excludedSkus, onToggle, onClose }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState('active')
  const filtered = products.filter((item) => {
    const excluded = excludedSkus.includes(item.masterSku)
    const matchesView = view === 'all' || (view === 'hidden' ? excluded : !excluded)
    const q = query.trim().toLowerCase()
    return matchesView && (!q || item.name.toLowerCase().includes(q) || item.masterSku.toLowerCase().includes(q))
  })
  const activeCount = products.length - excludedSkus.length
  return <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2550, background: 'rgba(15,23,42,.34)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 18 }}><div onMouseDown={(event) => event.stopPropagation()} style={{ width: 650, maxWidth: '100%', maxHeight: '88vh', display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr)', background: '#fff', borderRadius: 18, boxShadow: '0 28px 80px rgba(15,23,42,.25)', overflow: 'hidden' }}>
    <div style={{ padding: '16px 18px', borderBottom: '1px solid #e7eef6', display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><b style={{ color: '#102a43', fontSize: 18 }}>จัดการสินค้า</b><div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>ใช้ใน Planner {activeCount} รายการ · เอาออกแล้ว {excludedSkus.length} รายการ</div></div><button type="button" onClick={onClose} aria-label="ปิด" style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}><X size={20}/></button></div>
    <div style={{ padding: 12, display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #e7eef6' }}><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือ PY..." style={{ ...formInput, flex: 1, minWidth: 190 }}/>{[['active','ใช้งาน'],['hidden','เอาออกแล้ว'],['all','ทั้งหมด']].map(([key, label]) => <button key={key} type="button" onClick={() => setView(key)} style={simpleTab(view === key)}>{label}</button>)}</div>
    <div style={{ padding: 10, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 6 }}>{filtered.map((item) => { const excluded = excludedSkus.includes(item.masterSku); return <div key={item.masterSku} style={{ minWidth: 0, padding: '9px 10px', border: '1px solid #e7eef6', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, opacity: excluded ? .65 : 1 }}><span style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', minWidth: 48 }}>{item.masterSku}</span><b title={item.name} style={{ minWidth: 0, flex: 1, color: '#102a43', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</b><button type="button" onClick={() => { if (!excluded && !window.confirm(`เอา ${item.masterSku} ${item.name} ออกจาก Planner?`)) return; onToggle(item.masterSku) }} style={{ ...secondaryButton, padding: '7px 9px', color: excluded ? '#16866f' : '#b42318', borderColor: excluded ? '#b7eadb' : '#fecdd3' }}>{excluded ? 'นำกลับ' : 'เอาออก'}</button></div> })}{!filtered.length && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>ไม่พบสินค้า</div>}</div>
  </div></div>
}

function LockedNumberInput({ value, onChange, label, stale }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? 0))
  useEffect(() => { if (!editing) setDraft(String(value ?? 0)) }, [value, editing])
  const commit = () => { onChange(Math.max(0, Number(draft) || 0)); setEditing(false) }
  const staleBorder = stale === 'danger' ? '#f87171' : stale === 'warning' ? '#fbbf24' : '#cbd5e1'
  if (!editing) return <button type="button" onClick={() => setEditing(true)} aria-label={`แก้ไข ${label}`} title={stale ? 'ยกยอดจากวันก่อนหน้า — กดเพื่อยืนยัน/แก้ไขของวันนี้' : 'กดเพื่อแก้ไข'} style={{ width: '100%', minHeight: 38, border: `1px solid ${staleBorder}`, borderWidth: stale ? 2 : 1, borderRadius: 8, background: stale ? (stale === 'danger' ? '#fff1f2' : '#fffbeb') : '#e9eef5', color: '#334155', fontWeight: 850, cursor: 'pointer' }}>{fmt(value)}</button>
  return <input autoFocus type="number" min="0" inputMode="numeric" value={draft} onFocus={(event) => event.currentTarget.select()} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value ?? 0)); setEditing(false) } }} aria-label={label} style={{ ...input, width: '100%', minHeight: 38, background: '#fff' }}/>
}

function LockedDaysSelect({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const days = RESERVE_DAY_OPTIONS.includes(Number(value)) ? Number(value) : 1
  if (!editing) return <button type="button" onClick={() => setEditing(true)} title="กดเพื่อเปลี่ยนจำนวนวัน" style={{ width: '100%', minHeight: 38, border: '1px solid #cbd5e1', borderRadius: 8, background: '#e9eef5', color: '#334155', fontWeight: 850, cursor: 'pointer', whiteSpace: 'nowrap' }}>{days} วัน</button>
  return <select autoFocus value={days} onChange={(event) => { onChange(Number(event.target.value)); setEditing(false) }} onBlur={() => setEditing(false)} style={{ ...input, width: '100%', minHeight: 38, padding: '6px 3px', textAlign: 'center', background: '#fff', cursor: 'pointer' }}>{RESERVE_DAY_OPTIONS.map((option) => <option key={option} value={option}>{option} วัน</option>)}</select>
}

function FeedPeopleModal({ item, people, date, onChange, onClose }) {
  if (!item) return null
  const selected = Array.isArray(item.feeders) ? item.feeders : []
  const toggle = (name) => onChange(selected.includes(name) ? selected.filter((person) => person !== name) : [...selected, name])
  return <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2600, background: 'rgba(15,23,42,.32)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 18 }}><div onMouseDown={(event) => event.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: '#fff', borderRadius: 18, boxShadow: '0 28px 80px rgba(15,23,42,.24)' }}>
    <div style={{ padding: '16px 18px', borderBottom: '1px solid #e7eef6', display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><b style={{ color: '#102a43', fontSize: 18 }}>เลือกคนฟีด</b><div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{item.name} · คนเข้างานวันที่ {date}</div></div><button type="button" onClick={onClose} aria-label="ปิด" style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}><X size={20}/></button></div>
    <div style={{ padding: 18 }}>
      {people.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{people.map((person) => { const active = selected.includes(person.name); return <button key={person.name} type="button" onClick={() => toggle(person.name)} style={{ border: `1px solid ${active ? '#5ca8df' : '#d7e3ef'}`, background: active ? '#eaf5ff' : '#fff', color: active ? '#155f98' : '#475569', borderRadius: 999, padding: '8px 11px', fontWeight: 850, cursor: 'pointer' }}>{active ? '✓ ' : ''}{person.name}<span style={{ marginLeft: 5, color: '#94a3b8', fontSize: 10 }}>{person.group}</span></button> })}</div> : <div style={{ padding: 18, borderRadius: 11, background: '#fff7ed', color: '#9a5b08', textAlign: 'center' }}>ยังไม่พบรายชื่อ Manpower ของวันนี้</div>}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><span style={{ color: '#64748b', fontSize: 12 }}>เลือกได้หลายคน รวมพาร์ทไทม์</span><button type="button" onClick={onClose} style={primaryButton}>เสร็จแล้ว · {selected.length} คน</button></div>
    </div>
  </div></div>
}

function ProductModal({ modal, onClose, onSave, onEdit, onCreateOt }) {
  const blank = { id: '', group: 'A', name: '', stock: 0, daily: 0, targetDays: 2, reserveDays: 1, safetyPercent: 30, dayFeed: 0, otFeed: 0, claimRate: 0, note: '' }
  const [form, setForm] = useState(modal.item ? { ...modal.item } : blank)
  const isDetail = modal.mode === 'detail'
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  return <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(15,23,42,.34)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 18 }}>
    <div onMouseDown={(event) => event.stopPropagation()} style={{ width: isDetail ? 500 : 590, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 18, boxShadow: '0 28px 80px rgba(15,23,42,.25)' }}>
      <div style={{ padding: '17px 19px', borderBottom: '1px solid #e7eef6', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
        <div><div style={{ fontSize: 18, fontWeight: 900, color: '#102a43' }}>{isDetail ? 'สรุปการผลิต' : modal.mode === 'edit' ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าเข้ารายการแพลน'}</div>{!isDetail && <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>กำหนดข้อมูลตั้งต้นและกติกาการวางแผนรายสินค้า</div>}</div>
        <button onClick={onClose} aria-label="ปิด" style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}><X size={20}/></button>
      </div>

      {isDetail ? <div style={{ padding: 19, display: 'grid', gap: 13 }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}><span style={{ display: 'inline-grid', placeItems: 'center', minWidth: form.abc === 'NEW' ? 42 : 30, height: 30, padding: '0 6px', borderRadius: 8, background: `${groupColor[form.abc || 'NEW']}16`, color: groupColor[form.abc || 'NEW'], fontWeight: 900, fontSize: form.abc === 'NEW' ? 10 : 14 }}>{form.abc || 'NEW'}</span><b style={{ fontSize: 20, color: '#102a43' }}>{form.name}</b></div>

        <div style={{ padding: '16px 18px', borderRadius: 14, background: form.remaining > 0 ? '#fff7f7' : '#f0fdf7', border: `1px solid ${form.remaining > 0 ? '#fecdd3' : '#bbf7d0'}` }}>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>แนะนำให้ฟีด</div>
          <div style={{ color: form.need > 0 ? '#dc2626' : '#16866f', fontSize: 30, lineHeight: 1.15, fontWeight: 900, marginTop: 4 }}>{fmt(form.need)} ชิ้น</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>เฉลี่ย {fmt(form.daily)} ชิ้น/วัน × เผื่อ {form.reserveDays || 1} วัน × {form.demandLabel || 'ปกติ'} + กันพุ่ง {form.safetyPercent || 0}% − FG {fmt(form.stock)}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 11, background: '#f8fbff', border: '1px solid #e6eef7' }}>
          <div><div style={detailLabel}>วางผลิตวันนี้แล้ว</div><b style={{ color: '#102a43', fontSize: 17 }}>{fmt(form.dayFeed)} ชิ้น</b></div>
          <div style={{ color: '#94a3b8', fontWeight: 900 }}>→</div>
          <div style={{ textAlign: 'right' }}><div style={detailLabel}>ยังขาด</div><b style={{ color: form.remaining > 0 ? '#dc2626' : '#16866f', fontSize: 17 }}>{form.remaining > 0 ? `${fmt(form.remaining)} ชิ้น` : 'ครบแล้ว'}</b></div>
        </div>

        {form.claimRate >= 1 && <div style={{ color: '#be185d', background: '#fdf2f8', borderRadius: 10, padding: '10px 12px', fontWeight: 850 }}>Claims {Number(form.claimRate).toFixed(2)}% · ตรวจสาเหตุก่อนเร่งผลิต</div>}
        {form.note && <div style={{ color: '#475569', fontSize: 12 }}>หมายเหตุ: {form.note}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><button onClick={onEdit} style={secondaryButton}><Pencil size={15}/> แก้ไข</button>{form.remaining > 0 && <button onClick={onCreateOt} style={primaryButton}><CalendarClock size={15}/> วาง OT</button>}</div>
      </div> : <form onSubmit={(event) => { event.preventDefault(); onSave(form) }} style={{ padding: 19, display: 'grid', gap: 13 }}>
        <div className="planner-form-grid" style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
          <FormField label="ABC จากยอดขาย"><div style={{ ...formInput, background: '#f8fafc', color: groupColor[form.abc || 'NEW'], fontWeight: 900 }}>{form.abc || 'NEW'}</div></FormField>
          <FormField label="สินค้าจาก Product Mapping"><div style={{ ...formInput, background: '#f1f5f9' }}><b>{form.masterSku}</b><span style={{ marginLeft: 8 }}>{form.name}</span></div></FormField>
        </div>
        <div className="planner-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          <FormField label="FG ตอนนี้ (ชิ้น)"><input type="number" min="0" value={form.stock} onChange={(e) => set('stock', e.target.value)} style={formInput}/></FormField>
          <FormField label="ยอดขายเฉลี่ยย้อนหลัง/วัน"><input type="number" min="0" value={form.daily} onChange={(e) => set('daily', e.target.value)} style={formInput}/></FormField>
          <FormField label="กันยอดพุ่ง (%)"><input type="number" min="0" step="5" value={form.safetyPercent} onChange={(e) => set('safetyPercent', e.target.value)} style={formInput}/></FormField>
          <FormField label="ผลิตวันนี้"><input type="number" min="0" value={form.dayFeed} onChange={(e) => set('dayFeed', e.target.value)} style={formInput}/></FormField>
          <FormField label="Claim rate (%)"><input type="number" min="0" step="0.01" value={form.claimRate} onChange={(e) => set('claimRate', e.target.value)} style={formInput}/></FormField>
        </div>
        <FormField label="หมายเหตุ"><textarea value={form.note} onChange={(e) => set('note', e.target.value)} rows={3} placeholder="ข้อควรระวัง, QC, เงื่อนไขวันโปร..." style={{ ...formInput, resize: 'vertical' }}/></FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" onClick={onClose} style={secondaryButton}>ยกเลิก</button><button type="submit" style={primaryButton}>{modal.mode === 'edit' ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}</button></div>
      </form>}
    </div>
  </div>
}

function FormField({ label, children }) { return <label style={{ display: 'grid', gap: 5, color: '#475569', fontSize: 12, fontWeight: 850 }}>{label}{children}</label> }
function Detail({ label, value, danger }) { return <div style={{ padding: 11, borderRadius: 10, background: danger ? '#fff7f7' : '#f8fbff', border: `1px solid ${danger ? '#fecdd3' : '#e6eef7'}` }}><div style={detailLabel}>{label}</div><b style={{ display: 'block', marginTop: 4, color: danger ? '#dc2626' : '#102a43' }}>{value}</b></div> }

const td = { padding: '9px', color: '#334155', verticalAlign: 'middle' }
const primaryButton = { border: 0, borderRadius: 10, padding: '9px 11px', background: 'var(--payi-gradient-primary)', boxShadow: '0 8px 18px rgba(37,99,235,0.22)', color: '#fff', fontWeight: 850, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }
const secondaryButton = { border: '1px solid #cfe0f3', borderRadius: 9, padding: '9px 11px', background: '#fff', color: '#155f98', fontWeight: 850, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }
const formInput = { width: '100%', boxSizing: 'border-box', border: '1px solid #cfe0f3', borderRadius: 9, padding: '9px 10px', background: '#fff', color: '#0f172a', fontSize: 14, outline: 'none' }
const detailLabel = { color: '#64748b', fontSize: 11, fontWeight: 800 }
const simpleTab = (active) => ({ border: `1px solid ${active ? '#5ca8df' : '#d7e3ef'}`, background: active ? '#eaf5ff' : '#fff', color: active ? '#155f98' : '#64748b', borderRadius: 9, padding: '8px 11px', fontWeight: 850, cursor: 'pointer' })
