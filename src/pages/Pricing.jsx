import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Copy, FolderOpen, Layers3, LockKeyhole, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, TrendingUp } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PRODUCT_MASTER from '../data/productMaster.json'
import { calculatePricing, monthlyProfit, newPricingDraft, normalizePricingDraft, PRICING_PROGRAMS, solvePricingTarget } from '../../shared/pricing.js'
import { applyPricingPreset, PRICING_CATEGORIES, PRICING_PAYMENTS, PRICING_REFERENCE } from '../../shared/pricingPresets.js'
import { buildPricingCatalog, pricingProductKey, pricingRecipeKey, latestPricingPlans, savedPricingCosts, draftForPricingProduct, draftForPricingRecipe } from '../../shared/pricingCatalog.js'
import { pricingDemoData, pricingDemoSales } from '../data/pricingDemo.js'
import { pricingComparisonDraft } from '../../shared/pricingComparison.js'
import { buildPricingFamilies, draftForPricingFamily, pricingFamilyCost } from '../../shared/pricingFamilies.js'
import './Pricing.css'

const money = cents => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 }).format(cents / 100)
const integer = n => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const sampleCatalog = [...pricingDemoData.catalog,...buildPricingCatalog({aliases:PRODUCT_MASTER.map(p=>({master_sku:p.sku,display_name:p.name_th || p.name_en,business:'Payi'})),master:PRODUCT_MASTER}).catalog]
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const chartColors = { current: 'var(--payi-mint)', original: 'var(--payi-cyan)', axis: 'var(--payi-text-muted)', border: 'var(--payi-border)' }
const endpoint = '/api/sheet-tools?op=pricing'
const dateLabel = date => new Date(date).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

function Field({ label, value, onChange, unit = 'บาท', min = 0, max = 10000000, step = '0.01', hint, ...props }) {
  const id = useId()
  return <label className="pricing-field" htmlFor={id}><span>{label}</span><span className="pricing-input-wrap"><input id={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} onChange={e => onChange(e.target.value)} {...props} /><span>{unit}</span></span>{hint && <small>{hint}</small>}</label>
}

function Program({ program, setting, onChange }) {
  const id = useId()
  return <div className={`pricing-program ${setting.enabled ? 'is-on' : ''}`}>
    <label className="pricing-program-label" htmlFor={id}><span><strong>{program.name}</strong><small>{program.hint}</small></span><input id={id} type="checkbox" checked={setting.enabled} onChange={e => onChange({ ...setting, enabled: e.target.checked })} /></label>
    {setting.enabled && <Field label={`อัตรา ${program.name}`} value={setting.rate} onChange={rate => onChange({ ...setting, rate })} unit={program.type === 'reduction' ? 'จุด %' : '%'} max={100} />}
  </div>
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  return <div className="pricing-chart-tooltip"><strong>{integer(label)} {unit}</strong>{payload.map(p => <div key={p.dataKey}>{p.name}: {money(p.value * 100)}</div>)}</div>
}

export default function Pricing({ access, onAccessRevoked }) {
  const [draft, setDraft] = useState(newPricingDraft)
  const [reference, setReference] = useState(newPricingDraft)
  const [comparisonMode,setComparisonMode] = useState('snapshot')
  const [view, setView] = useState('calculator')
  const [catalog, setCatalog] = useState(() => access?.demo ? sampleCatalog : [])
  const [productGroups,setProductGroups] = useState(()=>access?.demo ? buildPricingFamilies(sampleCatalog) : [])
  const [recipes, setRecipes] = useState(() => access?.demo ? pricingDemoData.recipes : [])
  const [revisions, setRevisions] = useState([])
  const [activeRecord, setActiveRecord] = useState(null)
  const [search, setSearch] = useState('')
  const [showDeleted,setShowDeleted] = useState(false)
  const [deleteCandidate,setDeleteCandidate] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const pendingRef = useRef(null)
  const [dirty, setDirty] = useState(false)
  const [catalogSearch,setCatalogSearch] = useState('')
  const [sourceInfo,setSourceInfo] = useState(null)
  const [refreshKey,setRefreshKey] = useState(0)
  const [salesState,setSalesState] = useState(null)
  const [salesEndDate,setSalesEndDate] = useState(today)
  const autoSales = useRef(null)
  const catalogId = useId()
  const alive = useRef(true)
  const receiptRef = useRef(null)
  const [receiptTop,setReceiptTop] = useState(18)
  const canPersist = access?.configured && !access.demo
  const canReadOps = Boolean(access?.allowed && !access.demo)
  const costMemory = useMemo(()=>savedPricingCosts(revisions),[revisions])
  const selectedFamily=productGroups.find(p=>p.key===draft.productGroupId)
  const rawSelectedProduct=catalog.find(p=>p.key===pricingProductKey(draft.business,draft.sku))
  const selectedProduct=selectedFamily ? {...rawSelectedProduct,name:selectedFamily.name,referencePrice:selectedFamily.referencePrice,referencePriceSource:selectedFamily.referencePriceSource} : rawSelectedProduct
  const rememberedCost=selectedFamily ? pricingFamilyCost(selectedFamily,costMemory) : costMemory.get(pricingProductKey(draft.business,draft.sku))
  const visibleCatalog = productGroups.filter(p=>p.business===draft.business && `${p.name} ${p.members.map(m=>`${m.sku} ${m.name} ${m.color} ${m.size}`).join(' ')}`.toLowerCase().includes(catalogSearch.toLowerCase()))
  const selectionIdentity=JSON.stringify([draft.business,draft.sku,draft.variationName,draft.productGroupId])
  const salesKey=JSON.stringify([draft.business,draft.sku,draft.variationName,draft.productGroupId,salesEndDate])
  const hasSalesSelection=Boolean(draft.sku && (draft.kind!=='bundle' || draft.variationName))
  const sales = salesState?.key===salesKey ? salesState : null
  const update = (key, value) => {
    if(key==='monthlyVolume') autoSales.current=null
    if (key === 'kind') setReference(normalizePricingDraft({ ...draft, kind: value }))
    setDraft(prev => key==='business' && prev.business!==value ? {...prev,business:value,sku:'',productGroupId:'',productSkus:[],productName:'',variationName:'',color:'',size:'',unitCost:'',components:[],referencePrice:null,referencePriceSource:null,salesSnapshot:null,monthlyVolume:0} : ['storeType', 'category', 'payment'].includes(key) && prev.calculationModel === 'reference-v2' ? applyPricingPreset(prev, { [key]: value }) : { ...prev, [key]: value })
    setDirty(true); setMessage('')
  }
  const result = useMemo(() => calculatePricing(draft), [draft])
  const monthly = useMemo(() => monthlyProfit(draft), [draft])
  const comparisonDraft = useMemo(()=>pricingComparisonDraft(draft,reference,comparisonMode),[comparisonMode,draft,reference])
  const baseline = useMemo(() => comparisonDraft ? calculatePricing(comparisonDraft) : {valid:false}, [comparisonDraft])
  const latestPlans = useMemo(() => latestPricingPlans(revisions), [revisions])
  const plans = latestPlans.filter(r=>!r.deleted)
  const deletedPlans = latestPlans.filter(r=>r.deleted)
  const filteredPlans = (showDeleted ? deletedPlans : plans).filter(p => `${p.draft.name} ${p.draft.productName} ${p.draft.sku}`.toLowerCase().includes(search.toLowerCase()))

  const denied = response => {
    if (response.status === 403 || response.status === 401) {
      setDraft(newPricingDraft()); setReference(newPricingDraft()); setRevisions([]); setActiveRecord(null); setCatalog([]); setRecipes([]);setProductGroups([])
      setPending(null); pendingRef.current = null
      onAccessRevoked?.()
      return true
    }
    return false
  }

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(()=>{
    if(!receiptRef.current) return
    const positionReceipt=()=>{if(receiptRef.current) setReceiptTop(Math.min(18,window.innerHeight-receiptRef.current.getBoundingClientRect().height-18))}
    const observer=new ResizeObserver(positionReceipt)
    observer.observe(receiptRef.current)
    window.addEventListener('resize',positionReceipt)
    return ()=>{observer.disconnect();window.removeEventListener('resize',positionReceipt)}
  },[view])

  useEffect(() => {
    if (!canReadOps) return
    const controller = new AbortController()
    fetch(`${endpoint}&action=bootstrap`, { signal: controller.signal }).then(async response => {
      if (controller.signal.aborted || !alive.current) return
      if (response.status === 403 || response.status === 401) { onAccessRevoked?.(); return }
      const data = await response.json()
      if (!data.success) throw new Error(data.error)
      if (!controller.signal.aborted && alive.current) { setCatalog(data.catalog);setProductGroups(data.productGroups || buildPricingFamilies(data.catalog)); setRecipes(data.recipes); setRevisions(data.revisions); setSourceInfo({at:new Date().toISOString(),source:data.catalogSource}); setError(data.storageError || '') }
    }).catch(e => { if (e.name !== 'AbortError' && alive.current) setError(e.message || 'โหลดข้อมูลไม่สำเร็จ') })
    return () => controller.abort()
  }, [canReadOps, onAccessRevoked, refreshKey])

  useEffect(()=>{
    if(!hasSalesSelection) return
    const controller=new AbortController()
    const options={sku:draft.sku,business:draft.business,variation:draft.variationName,productGroupId:draft.productGroupId || '',endDate:salesEndDate}
    const work=canReadOps ? fetch(`${endpoint}&action=sales&${new URLSearchParams(options)}`,{signal:controller.signal}).then(async response=>{
      if(response.status===401 || response.status===403) {onAccessRevoked?.();throw new Error('สิทธิ์ถูกถอน')}
      const data=await response.json();if(!data.success) throw new Error(data.error);return data.summary
    }) : Promise.resolve(pricingDemoSales(options))
    work.then(summary=>{
      if(controller.signal.aborted || !alive.current) return
      setSalesState({key:salesKey,summary})
      if(summary && autoSales.current===selectionIdentity) {
        const period=summary.days30
        setDraft(prev=>JSON.stringify([prev.business,prev.sku,prev.variationName,prev.productGroupId])===selectionIdentity ? {...prev,monthlyVolume:period.suggestedMonthlyVolume,salesSnapshot:{...period,sku:summary.sku,business:summary.business,variation:summary.variation}} : prev)
        autoSales.current=null
      }
    }).catch(e=>{if(e.name!=='AbortError' && !controller.signal.aborted && alive.current) setSalesState({key:salesKey,error:e.message || 'โหลดยอดขายไม่ได้'})})
    return ()=>controller.abort()
  },[canReadOps,draft.sku,draft.business,draft.variationName,draft.productGroupId,hasSalesSelection,salesEndDate,salesKey,selectionIdentity,onAccessRevoked,refreshKey])

  const priceData = useMemo(() => {
    if (!result.valid) return []
    const center = Number(draft.price)
    const from = Math.max(1, Math.floor(center * .65)), to = Math.max(from + 20, Math.ceil(center * 1.35))
    const prices = new Set(Array.from({ length: 21 }, (_, i) => Math.round(from + (to - from) * i / 20)))
    prices.add(center)
    return [...prices].sort((a, b) => a - b).map(price => ({ price, profit: calculatePricing({ ...draft, price }).unitProfit / 100 }))
  }, [draft, result.valid])
  const volumeData = useMemo(() => {
    if (!result.valid || !baseline.valid || !comparisonDraft) return []
    const chosen = Number(draft.monthlyVolume)
    const volumes = new Set([500, 750, 1000, 1250, 1500, chosen])
    return [...volumes].sort((a,b) => a-b).map(volume => ({ volume, current: monthlyProfit(draft, volume).afterFixed / 100, original: monthlyProfit(comparisonDraft, volume).afterFixed / 100 }))
  }, [draft, comparisonDraft, result.valid, baseline.valid])

  function selectProduct(sku, family = null) {
    const product = catalog.find(p => p.sku.toUpperCase() === sku.toUpperCase() && p.business === draft.business)
    let next=family ? draftForPricingFamily(draft,family,costMemory) : product ? draftForPricingProduct(draft,product,costMemory) : {...draft,sku,productGroupId:'',productSkus:[],productName:'',kind:'single',components:[],unitCost:'',color:'',size:'',variationName:'',salesSnapshot:null,referencePrice:null,referencePriceSource:null,monthlyVolume:0}
    if(product?.recipeVariations?.length===1) next=draftForPricingRecipe(next,recipes.filter(r=>r.set_sku===product.sku && r.variation_name===product.recipeVariations[0]),catalog,costMemory)
    setDraft(next);setReference({...next});setComparisonMode('price');setActiveRecord(null);setMessage('');setError('')
    autoSales.current=JSON.stringify([next.business,next.sku,next.variationName,next.productGroupId])
    setDirty(true)
  }

  function componentUpdate(index, field, value) {
    update('components', draft.components.map((c, i) => i === index ? { ...c, [field]: value, ...(field === 'sku' ? { name: catalog.find(p => p.sku === value && p.business===draft.business)?.name || c.name, cost: costMemory.get(pricingProductKey(draft.business,value))?.cost ?? '' } : {}) } : c))
  }

  function applyRecipe(key) {
    if (!key) return
    const rows = recipes.filter(r => pricingRecipeKey(r.set_sku,r.variation_name) === key)
    const next=draftForPricingRecipe(draft,rows,catalog,costMemory)
    setDraft(next);setReference({...next});setComparisonMode('price');autoSales.current=JSON.stringify([next.business,next.sku,next.variationName,next.productGroupId])
    setDirty(true)
    setMessage('นำสูตรมาให้ตรวจแล้ว กรุณายืนยันส่วนประกอบและกรอกต้นทุนทุกตัว')
  }

  function applySalesPeriod(period) {
    const summary=sales?.summary
    if(!summary) return
    autoSales.current=null
    setDraft(prev=>({...prev,monthlyVolume:period.suggestedMonthlyVolume,salesSnapshot:{days:period.days,units:period.units,from:period.from,to:period.to,suggestedMonthlyVolume:period.suggestedMonthlyVolume,sku:summary.sku,business:summary.business,variation:summary.variation}}))
    setDirty(true);setMessage(`ใช้ยอดขาย ${period.days} วันเป็นฐานจำลอง ${integer(period.suggestedMonthlyVolume)} หน่วยต่อ 30 วันแล้ว`)
  }

  function openPlan(record, copy = false) {
    if (pending) { setError('ตรวจสอบผลบันทึกที่ค้างก่อนเปลี่ยนแผน'); return }
    if (dirty && !window.confirm('เปิดแผนนี้โดยไม่เก็บสิ่งที่แก้ไขอยู่หรือไม่?')) return
    const next = normalizePricingDraft(record.draft)
    if (copy) next.name = `${next.name} (สำเนา)`
    setDraft(next); setReference(normalizePricingDraft(record.draft));setComparisonMode('snapshot');autoSales.current=null; setActiveRecord(copy ? null : record); setDirty(copy); setView('calculator'); setMessage(copy ? 'สร้างสำเนาแล้ว ปรับสมมติฐานก่อนบันทึกเป็นแผนใหม่ได้' : 'เปิดแผนที่บันทึกไว้แล้ว'); setError('')
  }

  function addRecord(record) {
    setRevisions(prev => prev.some(r => r.revisionId === record.revisionId) ? prev : [...prev, record])
    if(['delete-scenario','restore-scenario'].includes(record.operation)) {
      if(activeRecord?.scenarioId===record.scenarioId) setActiveRecord(record.deleted ? null : record)
      setPending(null);pendingRef.current=null
      return
    }
    setActiveRecord(record); setDirty(false); setPending(null); pendingRef.current = null
  }

  async function changePlanStatus(record, deleted) {
    if(pendingRef.current || saving) return
    setDeleteCandidate(null)
    const body={action:deleted?'delete-scenario':'restore-scenario',requestId:crypto.randomUUID(),scenarioId:record.scenarioId,parentRevisionId:record.revisionId}
    const message=deleted?'ลบแผนแล้ว กู้คืนได้จากถังขยะ':'กู้คืนแผนแล้ว'
    setSaving(true);setError('');setMessage('')
    if(access?.demo) {
      addRecord({...record,...body,operation:body.action,revisionId:crypto.randomUUID(),createdAt:new Date().toISOString(),createdBy:'ตัวอย่าง',deleted})
      setMessage(message);setSaving(false);return
    }
    pendingRef.current=body;setPending(body)
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
      if(denied(response) || !alive.current) return
      const data=await response.json()
      if(data.unknown) throw new Error(data.error)
      if(!data.success) {pendingRef.current=null;setPending(null);throw new Error(data.error)}
      addRecord(data.record);setMessage(message)
    } catch(e) {if(alive.current) setError(e.message || 'ยังยืนยันผลไม่ได้ กรุณาตรวจสอบก่อนลองใหม่')}
    finally {if(alive.current) setSaving(false)}
  }

  async function savePlan(asNew = false) {
    if (!result.valid || !draft.name.trim() || !draft.productName.trim()) { setError(result.errors[0] || 'กรอกชื่อสินค้าและชื่อแผนก่อนบันทึก'); return }
    if (pendingRef.current) return
    setSaving(true); setError(''); setMessage('')
    const snapshot = normalizePricingDraft(draft)
    const body = { action: 'save-scenario', requestId: crypto.randomUUID(), scenarioId: asNew ? null : activeRecord?.scenarioId, parentRevisionId: asNew ? null : activeRecord?.revisionId, draft: snapshot }
    if (!canPersist) {
      if (!access?.demo) { setSaving(false); setError('ยังไม่เชื่อมที่เก็บแผน กรุณาติดต่อผู้ดูแลระบบ'); return }
      addRecord({ ...body, scenarioId: body.scenarioId || crypto.randomUUID(), revisionId: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: 'ตัวอย่าง', result, draft: snapshot })
      setMessage('เก็บแผนตัวอย่างในหน้านี้แล้ว · รีเฟรชหน้าจะหาย'); setSaving(false); return
    }
    pendingRef.current = body; setPending(body)
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
      if (denied(response) || !alive.current) return
      const data = await response.json()
      if (data.unknown) throw new Error(data.error)
      if (!data.success) { setPending(null); pendingRef.current = null; throw new Error(data.error) }
      addRecord(data.record); setMessage('บันทึกแผนราคาแล้ว พร้อมต้นทุนและสมมติฐานชุดนี้')
    } catch (e) { if (alive.current) setError(e.message || 'ยังยืนยันผลบันทึกไม่ได้ กรุณาตรวจสอบก่อนลองใหม่') }
    finally { if (alive.current) setSaving(false) }
  }

  async function recoverSave() {
    if (!pending) return
    setLoading(true); setError('')
    try {
      const response = await fetch(`${endpoint}&action=recover&requestId=${encodeURIComponent(pending.requestId)}`)
      if (denied(response) || !alive.current) return
      const data = await response.json()
      if (!data.success) throw new Error(data.error)
      if (data.record) { addRecord(data.record); setMessage('พบแผนที่บันทึกสำเร็จแล้ว') }
      else setError('ยังไม่พบรายการ อาจยังประมวลผลอยู่ กรุณาตรวจซ้ำอีกครั้ง ข้อมูลที่กรอกยังอยู่')
    } catch (e) { if (alive.current) setError(e.message || 'ตรวจสอบผลบันทึกไม่ได้') }
    finally { if (alive.current) setLoading(false) }
  }

  function findTarget() {
    const solved = solvePricingTarget(draft)
    if (solved.error) { setError(solved.error); return }
    update('price', solved.price); setError(''); setMessage(`ราคา ${money(solved.price * 100)} ถึงเป้าหมายตามสมมติฐานนี้ (ขั้นราคา 1 บาท)`)
  }

  function restoreReferenceRates() {
    const defaults = newPricingDraft()
    const next = applyPricingPreset({ ...draft, calculationModel: 'reference-v2', platformFee: 1.07, transactionCap: 0, transactionIncludesShipping: true, voucherPct: 5, exclusivePct: 5, feeNote: defaults.feeNote, programs: Object.fromEntries(PRICING_PROGRAMS.map(p => [p.key, { enabled: draft.programs[p.key].enabled, rate: p.defaultRate }])) }, { category: PRICING_CATEGORIES.some(c => c.name === draft.category) ? draft.category : defaults.category, storeType: draft.storeType, payment: PRICING_PAYMENTS.some(p => p.id === draft.payment) ? draft.payment : defaults.payment })
    setDraft(next); setDirty(true); setError(''); setMessage('โหลดค่าพื้นฐานตามเว็บอ้างอิงแล้ว · แผนฐานที่ใช้เทียบยังอยู่')
  }

  const componentTotal = draft.kind === 'bundle' && result.valid ? result.unitCost : null
  const unitLabel = draft.kind === 'bundle' ? 'เซ็ต' : 'ชิ้น'
  const activeRecipeKeys = [...new Set(recipes.filter(r => r.set_sku === draft.sku).map(r => pricingRecipeKey(r.set_sku,r.variation_name)))]

  return <div className="pricing-page">
    <header className="pricing-heading"><div><h1>คำนวณราคาและกำไร Shopee</h1></div><span className="pricing-private"><LockKeyhole size={14} /> เฉพาะ dev และ boss</span></header>
    <div className="pricing-toolbar"><div className="pricing-tabs" role="group" aria-label="มุมมองตั้งราคา"><button type="button" className={view === 'calculator' ? 'active' : ''} aria-pressed={view === 'calculator'} onClick={() => setView('calculator')}><SlidersHorizontal size={16} /> เครื่องคำนวณ</button><button type="button" className={view === 'plans' ? 'active' : ''} aria-pressed={view === 'plans'} onClick={() => setView('plans')}><FolderOpen size={16} /> แผนที่บันทึก <span>{plans.length}</span></button></div></div>
    <div className={`pricing-notice ${access?.demo ? 'demo' : ''}`}><span>{access?.demo ? 'ข้อมูลตัวอย่าง · แผนจะหายเมื่อรีเฟรช' : canPersist ? 'แผนราคาส่วนตัว' : 'ยังไม่เชื่อมที่เก็บแผน กรุณาติดต่อผู้ดูแลระบบ'}</span><span>ไม่เก็บเงินรับจริง</span></div>
    {error && <div className="pricing-feedback error" role="alert">{error}</div>}
    {message && <div className="pricing-feedback" role="status"><Check size={16} />{message}</div>}
    {pending && <div className="pricing-feedback"><span>มีคำขอบันทึกที่รอตรวจสอบ กรุณาคงหน้านี้ไว้</span><button className="pricing-button" onClick={recoverSave} disabled={loading || saving}>{loading ? 'กำลังตรวจสอบ…' : 'ตรวจสอบผลบันทึก'}</button></div>}
    {draft.calculationModel !== 'reference-v2' && <div className="pricing-feedback"><span>แผนเก่านี้ยังใช้สูตรเดิม เปลี่ยนเป็นค่าพื้นฐานตามเว็บได้โดยสร้างการแก้ไขใหม่</span><button className="pricing-button" onClick={restoreReferenceRates} disabled={saving || !!pending}>ใช้สูตรตามเว็บอ้างอิง</button></div>}
    <datalist id={catalogId}>{catalog.map(p => <option key={`${p.business}|${p.sku}`} value={p.sku}>{p.name} · {p.business}</option>)}</datalist>

    <fieldset className="pricing-editor" disabled={saving || !!pending}>
    {view === 'plans' ? <section className="pricing-saved"><div className="pricing-section-heading"><div><h2>{showDeleted ? 'ถังขยะ' : 'แผนราคาของคุณ'}</h2><p>เปิดแผนเดิม หรือทำสำเนาเพื่อเปรียบเทียบราคาใหม่</p></div><button className="pricing-button subtle" onClick={()=>setShowDeleted(v=>!v)}>{showDeleted ? 'กลับรายการแผน' : `ถังขยะ (${deletedPlans.length})`}</button><label className="pricing-search">ค้นหาแผน<input value={search} onChange={e => setSearch(e.target.value)} placeholder="ชื่อสินค้า / SKU / ชื่อแผน" /></label></div>
      {!filteredPlans.length ? <div className="pricing-empty"><FolderOpen size={36} /><h3>{search ? 'ไม่พบแผนที่ตรงกับคำค้น' : showDeleted ? 'ไม่มีแผนในถังขยะ' : 'เริ่มจากแผนราคาของสินค้าหนึ่งตัว'}</h3><p>{search ? 'ลองค้นด้วยชื่อสินค้าหรือ SKU อื่น' : showDeleted ? 'แผนที่ลบจะอยู่ที่นี่และกู้คืนได้' : 'คำนวณต้นทุน ลองราคา แล้วบันทึกไว้เปิดใช้ครั้งถัดไป'}</p><button className="pricing-button primary" onClick={() => {setView('calculator');setSearch('')}}>ไปเครื่องคำนวณ <ArrowRight size={16} /></button></div> : <div className="pricing-plan-grid">{filteredPlans.map(record => <article key={record.revisionId} className="pricing-plan-card"><div className="pricing-plan-meta"><span>{record.draft.kind === 'bundle' ? 'เซ็ตสินค้า' : 'สินค้าเดี่ยว'}</span><span>{record.draft.productGroupId ? `รวม ${record.draft.productSkus.length} ตัวเลือก` : record.draft.sku || 'ไม่ระบุ SKU'}</span></div><h3>{record.draft.productName}</h3><p>{record.draft.name}</p><div className="pricing-plan-numbers"><div><small>ราคาขาย</small><strong>{money(record.result.unitPrice)}</strong></div><div><small>กำไร / {record.draft.kind === 'bundle' ? 'เซ็ต' : 'ชิ้น'}</small><strong>{money(record.result.unitProfit)}</strong></div></div><small>{dateLabel(record.createdAt)} · {record.createdBy}</small><div className="pricing-plan-actions">{showDeleted ? <button className="pricing-button" onClick={()=>changePlanStatus(record,false)}>กู้คืน</button> : <><button className="pricing-button" onClick={() => openPlan(record)}>แก้ไข</button><button className="pricing-button subtle" onClick={() => openPlan(record, true)}><Copy size={14} /> สำเนา</button><button className="pricing-button subtle" onClick={() => {setReference(normalizePricingDraft(record.draft));setComparisonMode('snapshot');setView('calculator');setMessage(`ใช้ “${record.draft.name}” เป็นฐานเปรียบเทียบกราฟแล้ว`)}}>เทียบกราฟ</button><button className="pricing-button subtle" onClick={()=>setDeleteCandidate(record.scenarioId)}><Trash2 size={14} /> ลบ</button></>}</div>{deleteCandidate===record.scenarioId && <div className="pricing-delete-confirm" role="group" aria-label="ยืนยันการลบแผน"><span>ลบแผนนี้? กู้คืนได้จากถังขยะ</span><button className="pricing-button" onClick={()=>changePlanStatus(record,true)}>ยืนยันลบ</button><button className="pricing-button subtle" onClick={()=>setDeleteCandidate(null)}>ยกเลิก</button></div>}</article>)}</div>}
    </section> : <>
      <div className="pricing-workspace">
        <div className="pricing-form-stack">
          <section className="pricing-panel"><div className="pricing-section-title"><span>01</span><h2>สินค้าและต้นทุน</h2><span className="pricing-pill">{draft.kind === 'bundle' ? 'จัดเซ็ต' : 'รายสินค้า'}</span></div><div className="pricing-segmented" role="group" aria-label="ประเภทสินค้า"><button aria-pressed={draft.kind === 'single'} className={draft.kind === 'single' ? 'active' : ''} onClick={() => update('kind','single')}>สินค้าเดี่ยว</button><button aria-pressed={draft.kind === 'bundle'} className={draft.kind === 'bundle' ? 'active' : ''} onClick={() => update('kind','bundle')}><Layers3 size={15} /> เซ็ตสินค้า</button></div>
            <div className="pricing-ops-picker">
              <div className="pricing-ops-title"><strong>{access?.demo ? 'ทดลองเลือกสินค้า' : 'เลือกสินค้าจาก Payi Ops'}</strong>{canReadOps && <button className="pricing-button subtle" onClick={()=>{setRefreshKey(v=>v+1);setSalesState(null)}}><RotateCcw size={14} /> โหลดใหม่</button>}</div>
              <label className="pricing-field">ค้นหาสินค้า<input value={catalogSearch} onChange={e=>setCatalogSearch(e.target.value)} placeholder="ค้นหาชื่อสินค้า" /></label>
              <label className="pricing-field">สินค้าในธุรกิจ {draft.business}<select value={selectedFamily?.key || ''} onChange={e=>{const p=productGroups.find(p=>p.key===e.target.value);if(p) selectProduct(p.skus[0],p)}}><option value="">เลือกสินค้า (รวมสี / ไซซ์)</option>{visibleCatalog.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
              {!visibleCatalog.length && <p className="pricing-help">ไม่พบสินค้าที่ตรงคำค้นในธุรกิจนี้ ลองเปลี่ยนคำค้นหรือธุรกิจ</p>}
              <p className="pricing-help">{canReadOps ? sourceInfo ? `อ่านจาก Ops เมื่อ ${dateLabel(sourceInfo.at)}` : 'กำลังโหลดทะเบียนจาก Ops…' : 'DEMO เป็นข้อมูลตัวอย่างสำหรับลองราคาและยอดขาย ไม่มีการอ่านยอดขายจริงขณะปิดล็อกอิน'}</p>
            </div>
            <label className="pricing-field">ชื่อสินค้า / เซ็ต<input value={draft.productName} onChange={e => update('productName',e.target.value)} maxLength={300} /></label><details className="pricing-details pricing-product-details"><summary>รายละเอียดสินค้า / สี / ไซซ์ <ChevronDown size={14} /></summary>{selectedFamily ? <div className="pricing-family-members"><p>แผนราคาเดียวสำหรับทุกตัวเลือก:</p>{selectedFamily.members.map(p=><span key={p.sku}>{p.name} · {p.sku}</span>)}</div> : <div className="pricing-fields"><label className="pricing-field">SKU<input value={draft.sku} list={catalogId} onChange={e => selectProduct(e.target.value)} placeholder="ค้นหา SKU หรือกรอกรหัสใหม่" /></label></div>}
            {!draft.productGroupId && <div className="pricing-fields"><label className="pricing-field">สี<input value={draft.color || ''} onChange={e=>update('color',e.target.value)} placeholder="ไม่ได้ระบุในทะเบียน" maxLength={300} /></label><label className="pricing-field">ไซซ์<input value={draft.size || ''} onChange={e=>update('size',e.target.value)} placeholder="ไม่ได้ระบุในทะเบียน" maxLength={300} /></label></div>}
            </details>
            {!draft.productGroupId && draft.kind==='single' && !!selectedProduct?.variations?.length && <label className="pricing-field pricing-variation">ตัวเลือกจากออเดอร์<select value={draft.variationName || ''} onChange={e=>{const variationName=e.target.value;setDraft(prev=>({...prev,variationName,salesSnapshot:null,monthlyVolume:0}));autoSales.current=JSON.stringify([draft.business,draft.sku,variationName,draft.productGroupId]);setDirty(true)}}><option value="">รวมตัวเลือกของ SKU นี้ (แผนเดิม)</option>{selectedProduct.variations.map(v=><option key={v}>{v}</option>)}</select></label>}
            {selectedProduct && <div className="pricing-reference-row"><div><small>ราคาอ้างอิง{access?.demo ? ' (ตัวอย่าง)' : 'จากคลัง'}</small><strong>{selectedProduct.referencePrice===null ? selectedFamily?.priceConflict ? 'ราคาในคลังต่างกัน กรุณากรอกราคาขาย' : 'ยังไม่มีราคาในคลัง' : money(selectedProduct.referencePrice*100)}</strong></div>{selectedProduct.referencePrice!==null && <button className="pricing-button" onClick={()=>{update('price',selectedProduct.referencePrice);setReference({...draft,price:selectedProduct.referencePrice});setComparisonMode('price')}}>ใช้ราคาอ้างอิง</button>}</div>}
            {selectedProduct && <p className="pricing-help pricing-cost-note">{rememberedCost ? `ต้นทุนจากแผน “${rememberedCost.planName}” · แก้เลขได้` : 'กรอกต้นทุนสำหรับแผนนี้ · หากต้นทุนต่างกันแต่ละไซซ์ ให้ตรวจต้นทุนที่จะใช้ร่วมกันก่อน'}</p>}
            {draft.kind === 'single' ? <div className="pricing-fields"><Field label="ต้นทุนสินค้า / ชิ้น" value={draft.unitCost} onChange={v => update('unitCost',v)} /><Field label="แพ็ค / ดำเนินการต่อชิ้น" value={draft.packing} onChange={v => update('packing',v)} /></div> : <div className="pricing-bundle">
              {!!activeRecipeKeys.length && <label className="pricing-field">นำสูตรเดิมมาประกอบการตั้งราคา<select value={draft.variationName ? pricingRecipeKey(draft.sku,draft.variationName) : ""} onChange={e => applyRecipe(e.target.value)}><option value="">เลือกสูตรแล้วตรวจส่วนประกอบ</option>{activeRecipeKeys.map(key => <option key={key} value={key}>{JSON.parse(key)[1]}</option>)}</select></label>}
              {draft.components.map((c,index) => <div className="pricing-component" key={index}><label className="pricing-field">SKU ส่วนประกอบ {index+1}<input value={c.sku} list={catalogId} onChange={e => componentUpdate(index,'sku',e.target.value)} placeholder="SKU" /></label><label className="pricing-field">ชื่อสินค้า<input value={c.name} onChange={e => componentUpdate(index,'name',e.target.value)} placeholder="ชื่อส่วนประกอบ" /></label><Field label="จำนวน" value={c.qty} onChange={v => componentUpdate(index,'qty',v)} step="1" min={1} max={1000} unit="ชิ้น" /><Field label="ต้นทุน / ชิ้น" value={c.cost} onChange={v => componentUpdate(index,'cost',v)} /><button className="pricing-icon-button" aria-label={`ลบส่วนประกอบ ${index+1}`} onClick={() => update('components',draft.components.filter((_,i) => i !== index))}><Trash2 size={17} /></button></div>)}
              <button className="pricing-button subtle" disabled={draft.components.length >= 30} onClick={() => update('components',[...draft.components,{sku:'',name:'',qty:1,cost:''}])}><Plus size={16} /> เพิ่มส่วนประกอบ</button><div className="pricing-bundle-total"><span>ต้นทุนส่วนประกอบ / เซ็ต</span><strong>{componentTotal === null ? 'รอข้อมูลครบ' : money(componentTotal)}</strong></div><Field label="แพ็ค / เตรียมเซ็ต" value={draft.packing} onChange={v => update('packing',v)} hint="รวมเฉพาะค่าใช้จ่ายที่ยังไม่รวมในต้นทุนส่วนประกอบ" />
            </div>}
            <div className="pricing-fields"><Field label="ค่าส่งที่ลูกค้าจ่าย" value={draft.customerShipping} onChange={v => update('customerShipping',v)} /></div><details className="pricing-details"><summary>ค่าใช้จ่ายต่อออเดอร์ <ChevronDown size={15} /></summary><div className="pricing-fields"><Field label={`จำนวน${unitLabel}ต่อออเดอร์`} value={draft.unitsPerOrder} onChange={v => update('unitsPerOrder',v)} unit={unitLabel} min={1} max={1000} step="1" /><Field label="กล่องพัสดุ / ออเดอร์" value={draft.parcel} onChange={v => update('parcel',v)} />{draft.calculationModel !== 'reference-v2' && <><Field label="ค่าส่งที่จ่ายให้ขนส่ง" value={draft.actualShipping} onChange={v => update('actualShipping',v)} /><Field label="เงินสนับสนุนค่าส่งที่ร้านได้รับ" value={draft.shippingSubsidy} onChange={v => update('shippingSubsidy',v)} /></>}</div><p className="pricing-help">ค่าส่งและกล่องคิดครั้งเดียวต่อออเดอร์ · สูตรพื้นฐานส่งผ่านค่าส่งลูกค้าจ่ายให้ขนส่ง ไม่รวมค่าส่งเป็นกำไร</p></details>
          </section>

          <details className="pricing-panel pricing-sales-panel pricing-fold"><summary>ยอดขายย้อนหลัง 30 / 90 วัน <ChevronDown size={14} /></summary>
            <label className="pricing-field pricing-sales-date">นับย้อนหลังถึงวันที่<input type="date" value={salesEndDate} max={today()} onChange={e=>{if(e.target.value) setSalesEndDate(e.target.value);autoSales.current=null}} /></label>
            {!draft.sku ? <p className="pricing-help">เลือกสินค้าจากทะเบียนเพื่อดูยอดขายและเติมฐานจำลอง</p> : !hasSalesSelection ? <p className="pricing-help">เลือกสูตรเซ็ตก่อน เพื่อใช้ยอดขายของเซ็ตและตัวเลือกที่ตรงกัน</p> : !sales ? <p className="pricing-help" role="status">กำลังอ่านยอดขาย 30 / 90 วัน…</p> : sales.error ? <div className="pricing-feedback error" role="alert">{sales.error}</div> : !sales.summary ? <p className="pricing-help">ยังไม่เชื่อมยอดขายจริง ลองเลือก SKU ที่ขึ้นต้น DEMO เพื่อดูตัวอย่างการทำงาน</p> : <>
              <p className="pricing-help">{sales.summary.demo ? 'ข้อมูลตัวอย่าง · ' : ''}จำนวนขายสินค้า{draft.kind==='bundle' ? 'เป็นเซ็ตโดยตรง' : draft.productGroupId ? 'รวมทุกสีและไซซ์ในรุ่นนี้' : 'ตาม SKU'} ไม่รวมยกเลิก/คืนสินค้า · ขอบเขตธุรกิจและช่องทาง ยังไม่แยกร้าน</p>
              <div className="pricing-sales-grid">{[sales.summary.days30,sales.summary.days90].map(period=><article key={period.days}><span>{period.days} วันย้อนหลัง</span><strong>{integer(period.units)} <small>{unitLabel}</small></strong><div>ขายเฉลี่ย {period.averagePriceSatang===null ? '—' : money(period.averagePriceSatang)} / {unitLabel}</div><small>{period.from} ถึง {period.to}</small><button className="pricing-button" onClick={()=>applySalesPeriod(period)}>ใช้ฐาน {integer(period.suggestedMonthlyVolume)} {unitLabel}/30 วัน</button></article>)}</div>
              <p className="pricing-help">ราคาขายเฉลี่ย = ยอดขายจากออเดอร์ ÷ จำนวนหน่วย เป็นคนละค่ากับราคาอ้างอิงในคลัง</p>
              <p className="pricing-help">ข้อมูลออเดอร์ล่าสุดที่พบ: {sales.summary.latestDataDate || 'ไม่พบในช่วงที่อ่าน'} · ฐาน 90 วันหาร 3 เพื่อจำลอง 30 วัน</p>
              {!!sales.summary.missingMonths.length && <p className="pricing-data-warning">ไม่พบแท็บข้อมูลเดือน {sales.summary.missingMonths.join(', ')} ฐานจำลองอาจยังไม่ครบ</p>}
              {sales.summary.skippedCorrections>0 && <p className="pricing-data-warning">ข้าม {sales.summary.skippedCorrections} รายการที่เป็นการแก้รหัสเก่า เพื่อไม่ปนกับยอดเซ็ต</p>}
            </>}
          </details>

          <section className="pricing-panel"><div className="pricing-section-title"><span>02</span><h2>ร้านและค่าธรรมเนียม</h2></div><div className="pricing-fields"><label className="pricing-field">ธุรกิจ<select value={draft.business} onChange={e => update('business',e.target.value)}><option>Payi</option><option>Payi Outlet</option><option>กรอบรูป</option></select></label><label className="pricing-field">ชื่อร้าน<input value={draft.store} onChange={e => update('store',e.target.value)} /></label><label className="pricing-field">ประเภทร้าน<select value={draft.storeType} onChange={e => update('storeType',e.target.value)}><option value="normal">ร้านทั่วไป</option><option value="mall">Shopee Mall</option></select></label><label className="pricing-field">หมวดสินค้า<select value={draft.category} onChange={e => update('category',e.target.value)}>{!PRICING_CATEGORIES.some(c => c.name === draft.category) && <option>{draft.category}</option>}{PRICING_CATEGORIES.map(c => <option key={c.name}>{c.name}</option>)}</select></label><label className="pricing-field">วิธีชำระเงิน<select value={draft.payment} onChange={e => update('payment',e.target.value)}>{!PRICING_PAYMENTS.some(p => p.id === draft.payment) && <option value={draft.payment}>วิธีชำระเงินจากแผนเดิม</option>}{PRICING_PAYMENTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
            <details className="pricing-details pricing-fee-details"><summary>ปรับค่าธรรมเนียม / ตัวเลือกเพิ่มเติม <ChevronDown size={14} /></summary><p className="pricing-assumption">ใช้ค่าพื้นฐานตาม <a href={PRICING_REFERENCE.url} target="_blank" rel="noreferrer">เว็บอ้างอิง</a> · มีผล 4 ส.ค. 2569<br />เลือกหมวด/ประเภทร้าน/วิธีจ่ายแล้วโหลดอัตราให้ แก้ตัวเลขเองได้ทุกช่อง</p>
            <div className="pricing-fields"><Field label="Commission" value={draft.commission} onChange={v => update('commission',v)} max={100} unit="%" /><Field label="Transaction Fee" value={draft.transaction} onChange={v => update('transaction',v)} max={100} unit="%" /><Field label="Platform Fee / ออเดอร์" value={draft.platformFee} onChange={v => update('platformFee',v)} /><Field label="เพดาน Transaction / ออเดอร์" value={draft.transactionCap} onChange={v => update('transactionCap',v)} hint="0 = ไม่กำหนดเพดาน" /></div>
            <label className="pricing-check"><input type="checkbox" checked={draft.transactionIncludesShipping} onChange={e => update('transactionIncludesShipping',e.target.checked)} /> คิด Transaction Fee รวมค่าส่งที่ลูกค้าจ่าย</label><label className="pricing-field pricing-source">ที่มา / หมายเหตุกติกา<input value={draft.feeNote} onChange={e => update('feeNote',e.target.value)} maxLength={300} /></label><p className="pricing-help">อัตราพื้นฐานรวม VAT แล้ว · เปลี่ยนหมวดหรือวิธีจ่ายจะโหลดค่าเริ่มต้นใหม่</p><button className="pricing-button subtle" onClick={restoreReferenceRates}><RotateCcw size={14} /> คืนค่าพื้นฐานตามเว็บ</button></details>{PRICING_PROGRAMS.slice(0,3).map(p => <Program key={p.key} program={p} setting={draft.programs[p.key]} onChange={setting => update('programs',{...draft.programs,[p.key]:setting})} />)}
          </section>

          <section className="pricing-panel"><div className="pricing-section-title"><span>03</span><h2>งบการตลาด</h2><span className="pricing-pill">เปิดเฉพาะที่ใช้</span></div>{PRICING_PROGRAMS.slice(3,4).map(p => <Program key={p.key} program={p} setting={draft.programs[p.key]} onChange={setting => update('programs',{...draft.programs,[p.key]:setting})} />)}
            <div className="pricing-program"><label className="pricing-program-label"><span><strong>Seller Voucher</strong><small>{draft.calculationModel === 'reference-v2' ? 'โค้ดส่วนลดที่ร้านออกเอง (% ของราคาขาย)' : 'ส่วนลดที่ร้านออกต่อออเดอร์'}</small></span><input type="checkbox" checked={draft.voucherEnabled} onChange={e => update('voucherEnabled',e.target.checked)} /></label>{draft.voucherEnabled && (draft.calculationModel === 'reference-v2' ? <Field label="อัตรา Seller Voucher" value={draft.voucherPct} onChange={v => update('voucherPct',v)} max={100} unit="%" /> : <Field label="ส่วนลด Voucher / ออเดอร์" value={draft.voucher} onChange={v => update('voucher',v)} />)}</div>
            {PRICING_PROGRAMS.slice(4,6).map(p => <Program key={p.key} program={p} setting={draft.programs[p.key]} onChange={setting => update('programs',{...draft.programs,[p.key]:setting})} />)}
            <div className="pricing-program"><label className="pricing-program-label"><span><strong>Exclusive Price</strong><small>{draft.calculationModel === 'reference-v2' ? 'งบราคาพิเศษเฉพาะแคมเปญ / ช่องทาง (% ของราคาขาย)' : 'ใช้ราคาเฉพาะนี้แทนราคาขายปกติ (สูตรเดิม)'}</small></span><input type="checkbox" checked={draft.exclusiveEnabled} onChange={e => update('exclusiveEnabled',e.target.checked)} /></label>{draft.exclusiveEnabled && (draft.calculationModel === 'reference-v2' ? <Field label="อัตรา Exclusive Price" value={draft.exclusivePct} onChange={v => update('exclusivePct',v)} max={100} unit="%" /> : <Field label="ราคาขายเฉพาะ / หน่วย" value={draft.exclusivePrice} onChange={v => update('exclusivePrice',v)} />)}</div>
            {PRICING_PROGRAMS.slice(6).map(p => <Program key={p.key} program={p} setting={draft.programs[p.key]} onChange={setting => update('programs',{...draft.programs,[p.key]:setting})} />)}
          </section>
        </div>

        <aside className="pricing-summary-stack">
          <section className="pricing-price-panel"><div className="pricing-eyebrow">ลองปรับราคาขาย</div><div className="pricing-price-control"><span>ราคาต่อ{unitLabel}</span><div><span>฿</span><input aria-label={`ราคาขายต่อ${unitLabel}`} type="number" min="1" max="10000000" step="1" value={draft.price} onChange={e => update('price',e.target.value)} /></div></div><input className="pricing-slider" aria-label="เลื่อนราคาขาย" type="range" min={Math.max(1,Math.floor(Number(reference.price)*.5))} max={Math.max(1000,Math.ceil(Number(reference.price)*2),Number(draft.price)||0)} value={Number(draft.price)||1} onChange={e => update('price',e.target.value)} disabled={draft.calculationModel !== 'reference-v2' && draft.exclusiveEnabled} /><div className="pricing-price-caption"><span>ฐานเปรียบเทียบ {Number(reference.price)>0 ? money(Number(reference.price)*100) : "ยังไม่มีราคาอ้างอิง"}</span><button disabled={!(Number(reference.price)>0)} onClick={() => {update('price',reference.price);if(draft.calculationModel !== 'reference-v2') update('exclusiveEnabled',false)}}><RotateCcw size={13} /> คืนราคา</button></div>
            <details className="pricing-target"><summary><TrendingUp size={15} /> หาราคาจากกำไรเป้าหมาย <ChevronDown size={15} /></summary><div className="pricing-fields"><label className="pricing-field">รูปแบบเป้าหมาย<select value={draft.targetType} onChange={e => update('targetType',e.target.value)}><option value="amount">กำไรบาทต่อหน่วย</option><option value="margin">Margin ต่อราคาขาย</option></select></label><Field label="กำไรเป้าหมาย" value={draft.target} onChange={v => update('target',v)} unit={draft.targetType === 'margin' ? '%' : 'บาท'} max={draft.targetType === 'margin' ? 99.99 : 10000000} /></div><button className="pricing-button" onClick={findTarget}>คำนวณราคาเป้าหมาย <ArrowRight size={15} /></button></details>
          </section>

          <section className="pricing-receipt" ref={receiptRef} style={{top:receiptTop}}><div className="pricing-receipt-header"><span>ประมาณการต่อออเดอร์</span><LockKeyhole size={15} /></div><div className="pricing-receipt-body"><div className="pricing-receipt-title"><h2>{draft.productName || 'สินค้าของคุณ'}</h2><span>{draft.productGroupId ? `รวม ${draft.productSkus.length} ตัวเลือก · ราคาเดียวกัน` : draft.sku || 'ยังไม่ระบุ SKU'} · {draft.unitsPerOrder || '—'} {unitLabel} / ออเดอร์</span></div>
            {!result.valid ? <div className="pricing-invalid" role="status"><h3>รอข้อมูลให้ครบก่อนสรุปกำไร</h3>{result.errors.map(e => <p key={e}>{e}</p>)}</div> : <>
              <dl className="pricing-ledger"><div><dt>ราคาขายรวม</dt><dd>{money(result.gross)}</dd></div>{result.campaign > 0 && <div><dt>ส่วนลดแคมเปญ</dt><dd>−{money(result.campaign)}</dd></div>}{result.voucher > 0 && <div><dt>Seller Voucher</dt><dd>−{money(result.voucher)}</dd></div>}<div><dt>ค่าส่งที่ลูกค้าจ่าย</dt><dd>{money(result.customerShipping)}</dd></div>{result.subsidy > 0 && <div><dt>สนับสนุนค่าส่ง</dt><dd>{money(result.subsidy)}</dd></div>}</dl>
              <details className="pricing-receipt-costs"><summary>ต้นทุนสินค้า แพ็ค และขนส่ง <span>{money(result.rows.filter(r => r.group === 'cost').reduce((sum,r) => sum + r.amount,0))}</span></summary><dl className="pricing-ledger">{result.rows.filter(r => r.group === 'cost' && r.amount > 0).map(row => <div key={row.key}><dt>{row.label}</dt><dd>{money(row.amount)}</dd></div>)}</dl></details><dl className="pricing-ledger deductions">{result.rows.filter(r => r.amount > 0 && r.group !== 'marketing' && r.group !== 'cost').map(row => <div key={row.key}><dt>{row.label}{row.rate !== undefined && <small>{row.rate.toFixed(2)}%</small>}</dt><dd>−{money(row.amount)}</dd></div>)}</dl>{result.rows.some(r => r.group === 'marketing') && <><h3 className="pricing-marketing-heading">งบการตลาด</h3><dl className="pricing-ledger deductions">{result.rows.filter(r => r.group === 'marketing').map(row => <div key={row.key}><dt>{row.label}<small>{row.rate.toFixed(2)}%</small></dt><dd>−{money(row.amount)}</dd></div>)}</dl></>}<dl className="pricing-ledger pricing-totals"><div><dt>รวมค่าธรรมเนียมและงบการตลาด</dt><dd>{money(result.fees + (result.marketing || 0))}</dd></div><div><dt>รวมต้นทุนและค่าใช้จ่ายทั้งหมด</dt><dd>{money(result.expenses)}</dd></div></dl>
              <div className={`pricing-profit ${result.profit < 0 ? 'loss' : ''}`} aria-live="polite"><span>{result.profit < 0 ? 'ขาดทุน' : 'กำไร'}ประมาณการ / {unitLabel}</span><strong>{money(result.unitProfit)}</strong><span>Margin {result.margin === null ? '—' : `${result.margin.toFixed(2)}%`} · {draft.calculationModel === 'reference-v2' ? 'ของราคาขาย' : 'ยอดหลังส่วนลดร้าน'}</span><small>หลังค่าใช้จ่ายผันแปร ก่อนค่าใช้จ่ายคงที่</small></div>
            </>}
            <div className="pricing-save"><label className="pricing-field">ชื่อแผนราคา<input value={draft.name} onChange={e => update('name',e.target.value)} maxLength={300} placeholder="เช่น ราคาปกติ / แคมเปญ 11.11" /></label><button className="pricing-button primary" onClick={() => savePlan()} disabled={!result.valid || saving || !!pending || (!canPersist && !access?.demo)}><Save size={17} />{saving ? 'กำลังบันทึก…' : access?.demo ? 'เก็บแผนตัวอย่าง' : 'บันทึกแผนราคา'}</button>{activeRecord && <button className="pricing-button" disabled={saving || !!pending} onClick={() => savePlan(true)}><Plus size={15} /> บันทึกเป็นแผนใหม่</button>}<small>{dirty ? 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก' : activeRecord ? `บันทึกโดย ${activeRecord.createdBy}` : 'บันทึกต้นทุนและสูตรชุดนี้ไว้เปิดใช้ครั้งต่อไป'}</small>{activeRecord && <details className="pricing-history"><summary>ประวัติแผนนี้</summary>{revisions.filter(r => r.scenarioId === activeRecord.scenarioId).slice().reverse().map(r => <button key={r.revisionId} onClick={() => openPlan(r)}>{dateLabel(r.createdAt)} · {money(r.result.unitPrice)}</button>)}</details>}</div>
          </div></section>
        </aside>
      </div>

      <details className="pricing-simulation pricing-fold"><summary>จำลองยอดขายและดูกราฟ <ChevronDown size={14} /></summary><div className="pricing-section-heading"><div><div className="pricing-eyebrow">WHAT IF</div><h2>ถ้าเปลี่ยนราคา กำไรจะเป็นอย่างไร?</h2><p>ปรับยอดขายเพื่อจำลองผล ไม่ใช่การทำนายว่ายอดจะเพิ่มหรือลด</p></div><button className="pricing-button" disabled={!result.valid} onClick={() => {setReference(normalizePricingDraft(draft));setComparisonMode('snapshot');setMessage('ตั้งแผนปัจจุบันเป็นฐานเปรียบเทียบแล้ว')}}><Check size={15} /> ใช้แผนนี้เป็นฐานเทียบ</button></div>
        <p className="pricing-sales-basis">{!comparisonDraft ? 'แผนฐานเป็นคนละสินค้า/ตัวเลือก กดใช้แผนนี้เป็นฐานเทียบก่อนดูกราฟ' : comparisonMode==='price' ? 'แผนฐานใช้ราคาอ้างอิง โดยใช้ต้นทุนและค่าธรรมเนียมเดียวกับแผนปัจจุบัน' : `แผนฐาน: ${reference.name} · ราคา ${money(Number(reference.price)*100)} · ล็อกต้นทุนและค่าธรรมเนียมไว้`}</p>
        {draft.salesSnapshot && <p className="pricing-sales-basis">ฐานจำลอง: {draft.salesSnapshot.units.toLocaleString('th-TH')} หน่วย จาก {draft.salesSnapshot.days} วัน ({draft.salesSnapshot.from} ถึง {draft.salesSnapshot.to}){Number(draft.monthlyVolume)!==draft.salesSnapshot.suggestedMonthlyVolume ? ' · ปรับจำนวนจำลองเองแล้ว' : ''}</p>}
        <div className="pricing-simulation-controls"><Field label={`ยอดขายจำลอง / เดือน (${unitLabel})`} value={draft.monthlyVolume} onChange={v => update('monthlyVolume',v)} unit={unitLabel} step="1" /><Field label="ค่าใช้จ่ายคงที่ที่จัดสรรให้แผน / เดือน" value={draft.fixedCost} onChange={v => update('fixedCost',v)} /><div className="pricing-monthly" aria-live="polite"><span>{Number(draft.fixedCost)>0 ? 'กำไรจำลองหลังค่าใช้จ่ายคงที่' : 'กำไรจำลองก่อนค่าใช้จ่ายคงที่'}</span><strong>{monthly ? money(monthly.afterFixed) : 'รอข้อมูลครบ'}</strong><small>{monthly ? `${integer(monthly.orders)} ออเดอร์ / เดือน ตามจำนวนหน่วยต่อออเดอร์ที่ตั้งไว้` : 'กรอกสมมติฐานก่อนดูกราฟ'}</small></div></div>
        <div className="pricing-chart-grid"><article className="pricing-chart"><h3>ราคาขายกับกำไรต่อ{unitLabel}</h3><p>{draft.calculationModel !== 'reference-v2' && draft.exclusiveEnabled ? 'กำลังใช้ Exclusive Price กำไรจึงคงที่เมื่อปรับราคาปกติ' : 'จุดตัดศูนย์คือราคาที่เริ่มครอบคลุมค่าใช้จ่ายผันแปร'}</p><div className="pricing-chart-area">{priceData.length ? <ResponsiveContainer width="100%" height={260}><LineChart data={priceData} margin={{top:16,right:20,bottom:24,left:4}} accessibilityLayer><CartesianGrid stroke={chartColors.border} vertical={false} /><XAxis dataKey="price" type="number" domain={['dataMin','dataMax']} tickCount={4} tick={{fill:chartColors.axis,fontSize:12}} label={{value:'ราคาขาย (บาท / หน่วย)',position:'bottom',offset:6,fill:chartColors.axis}} /><YAxis width={62} tick={{fill:chartColors.axis,fontSize:12}} label={{value:'กำไร (บาท)',angle:-90,position:'insideLeft',fill:chartColors.axis}} /><Tooltip content={<ChartTooltip unit="บาท / หน่วย" />} /><ReferenceLine y={0} stroke={chartColors.axis} /><ReferenceLine x={Number(draft.price)} stroke={chartColors.current} strokeDasharray="3 3" /><Line name="กำไรต่อหน่วย" type="linear" dataKey="profit" stroke={chartColors.current} strokeWidth={2.5} dot={false} activeDot={{r:5}} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <div className="pricing-chart-placeholder">กรอกข้อมูลให้ครบเพื่อดูกราฟ</div>}</div></article>
          <article className="pricing-chart"><h3>ยอดขายกับกำไรต่อเดือน</h3><p>เทียบแผนฐานกับแผนที่กำลังปรับ · รวมค่าใช้จ่ายคงที่ที่ระบุ</p><div className="pricing-chart-area">{volumeData.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={volumeData} margin={{top:16,right:12,bottom:24,left:4}} accessibilityLayer><CartesianGrid stroke={chartColors.border} vertical={false} /><XAxis dataKey="volume" tick={{fill:chartColors.axis,fontSize:12}} interval="preserveStartEnd" label={{value:`ยอดขาย (${unitLabel} / เดือน)`,position:'bottom',offset:6,fill:chartColors.axis}} /><YAxis width={62} tickFormatter={v => Math.abs(v)>=1000?`${v/1000}k`:v} tick={{fill:chartColors.axis,fontSize:12}} /><Tooltip content={<ChartTooltip unit={`${unitLabel} / เดือน`} />} /><Legend verticalAlign="top" height={30} /><ReferenceLine y={0} stroke={chartColors.axis} /><Bar name="แผนฐาน" dataKey="original" fill={chartColors.original} radius={[4,4,0,0]} isAnimationActive={false} /><Bar name="แผนปัจจุบัน" dataKey="current" fill={chartColors.current} radius={[4,4,0,0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <div className="pricing-chart-placeholder">กรอกข้อมูลให้ครบเพื่อดูกราฟ</div>}</div></article></div>
      </details><footer className="pricing-footer">ปัดเงินทีละรายการถึงสตางค์ · อัตราเป็นสมมติฐานสำหรับวางแผนตั้งราคา</footer>
    </>}
    </fieldset>
  </div>
}
