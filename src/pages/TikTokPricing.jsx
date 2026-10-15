import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, FolderOpen, LockKeyhole, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PRODUCT_MASTER from '../data/productMaster.json'
import { buildPricingCatalog, latestPricingPlans } from '../../shared/pricingCatalog.js'
import { buildPricingFamilies } from '../../shared/pricingFamilies.js'
import { calculateTikTok, isTikTokPlan, newTikTokDraft, normalizeTikTokDraft } from '../../shared/tiktokPricing.js'

const endpoint='/api/sheet-tools?op=pricing'
const money=cents=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(cents/100)
const feeLabels={transaction:'Transaction Fee',commission:'ค่าคอมมิชชัน Platform',campaign:'Campaigns ส่งฟรี',deals:'Brand Crazy Deals / แฟลชเซล',vat:'VAT / ภาระเพิ่มตามชีต'}
function Field({label,value,onChange,unit='บาท',max=1e7,step='0.01'}) {
  const id=useId()
  return <label className="pricing-field" htmlFor={id}><span>{label}</span><span className="pricing-input-wrap"><input id={id} type="number" inputMode="decimal" min="0" max={max} step={step} value={Number.isNaN(value)?'':value} onChange={e=>onChange(e.target.value)}/><span>{unit}</span></span></label>
}

export default function TikTokPricing({access,onAccessRevoked}) {
  const [draft,setDraft]=useState(newTikTokDraft)
  const [view,setView]=useState('calculator')
  const [groups,setGroups]=useState(()=>access?.demo?buildPricingFamilies(buildPricingCatalog({aliases:PRODUCT_MASTER.map(p=>({master_sku:p.sku,display_name:p.name_th||p.name_en,business:'Payi'})),master:PRODUCT_MASTER}).catalog):[])
  const [revisions,setRevisions]=useState([])
  const [active,setActive]=useState(null)
  const [query,setQuery]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(!access?.demo)
  const [pending,setPending]=useState(null)
  const [trash,setTrash]=useState(false)
  const [deleteId,setDeleteId]=useState(null)
  const [dirty,setDirty]=useState(false)
  const [openCandidate,setOpenCandidate]=useState(null)
  const requestRef=useRef(null)
  const alive=useRef(true)
  const result=calculateTikTok(draft)
  const plans=latestPricingPlans(revisions).filter(r=>isTikTokPlan(r.draft))
  const shown=plans.filter(r=>Boolean(r.deleted)===trash && `${r.draft.productName} ${r.draft.name}`.toLowerCase().includes(query.toLowerCase()))
  const update=(key,value)=>{setDraft(prev=>({...prev,[key]:value}));setDirty(true);setMessage('')}
  function deny(response) {
    if(response.status!==401 && response.status!==403) return false
    setDraft(newTikTokDraft());setRevisions([]);setGroups([]);setActive(null);setPending(null);requestRef.current=null
    onAccessRevoked?.();return true
  }
  useEffect(()=>{
    alive.current=true
    const controller=new AbortController()
    if(access?.allowed && !access.demo) {
      fetch(endpoint,{signal:controller.signal}).then(async response=>{
        if(deny(response)) return
        const data=await response.json()
        if(!data.success) throw Error(data.error)
        if(!controller.signal.aborted) {setGroups(data.productGroups||buildPricingFamilies(data.catalog));setRevisions(data.revisions||[]);setError(data.storageError||'')}
      }).catch(e=>{if(e.name!=='AbortError' && alive.current) setError(e.message||'อ่านข้อมูลไม่สำเร็จ')}).finally(()=>{if(alive.current)setLoading(false)})
    }
    return ()=>{alive.current=false;controller.abort()}
    // Access changes unmount this private page through the parent access boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[access?.allowed,access?.demo])

  function applyRecord(record) {
    setRevisions(prev=>prev.some(r=>r.revisionId===record.revisionId)?prev:[...prev,record])
    if(record.operation==='delete-scenario'||record.operation==='restore-scenario') {
      if(active?.scenarioId===record.scenarioId) setActive(record.deleted?null:record)
    } else {setActive(record);setDirty(false)}
    setPending(null);requestRef.current=null
  }
  async function submit(body) {
    if(busy||requestRef.current) return
    setBusy(true);setError('');setMessage('')
    if(access?.demo) {
      const previous=revisions.findLast(r=>r.scenarioId===body.scenarioId)
      const record=body.action==='save-scenario'?{...body,draft:normalizeTikTokDraft(body.draft),result:calculateTikTok(body.draft)}:{...previous,...body,operation:body.action,deleted:body.action==='delete-scenario'}
      applyRecord({...record,scenarioId:body.scenarioId||crypto.randomUUID(),revisionId:crypto.randomUUID(),createdAt:new Date().toISOString(),createdBy:'ตัวอย่าง'})
      setMessage('เก็บการเปลี่ยนแปลงตัวอย่างแล้ว · รีเฟรชหน้าจะหาย');setBusy(false);return
    }
    if(!access?.configured) {setError('ยังไม่เชื่อมที่เก็บแผนส่วนตัว');setBusy(false);return}
    requestRef.current=body;setPending(body)
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
      if(deny(response)||!alive.current) return
      const data=await response.json()
      if(data.unknown) throw Error(data.error)
      if(!data.success){setPending(null);requestRef.current=null;throw Error(data.error)}
      applyRecord(data.record);setMessage('บันทึกการเปลี่ยนแปลงแล้ว')
    } catch(e) {if(alive.current)setError(e.message||'ยังยืนยันผลบันทึกไม่ได้ กรุณาตรวจสอบผลก่อนลองใหม่')}
    finally {if(alive.current)setBusy(false)}
  }
  async function recover() {
    setBusy(true);setError('')
    try {
      const response=await fetch(`${endpoint}&action=recover&requestId=${encodeURIComponent(pending.requestId)}`,{signal:AbortSignal.timeout(30000)})
      if(deny(response)||!alive.current)return
      const data=await response.json()
      if(!data.success)throw Error(data.error)
      if(data.record){applyRecord(data.record);setMessage('พบรายการที่บันทึกสำเร็จแล้ว')}
      else setError('ยังไม่พบรายการ กรุณาตรวจซ้ำอีกครั้ง ข้อมูลที่กรอกยังอยู่')
    }catch(e){if(alive.current)setError(e.message||'ตรวจสอบผลไม่ได้')}
    finally{if(alive.current)setBusy(false)}
  }
  function save(asNew=false) {
    if(!result.valid)return
    submit({action:'save-scenario',requestId:crypto.randomUUID(),scenarioId:asNew?null:active?.scenarioId,parentRevisionId:asNew?null:active?.revisionId,draft:normalizeTikTokDraft(draft)})
  }
  function open(record,force=false) {
    if(dirty&&!force){setOpenCandidate(record);return}
    setDraft(normalizeTikTokDraft(record.draft));setActive(record);setDirty(false);setView('calculator');setOpenCandidate(null);setMessage('เปิดแผน TikTok Mall แล้ว');setError('')
  }
  function selectFamily(key) {
    const family=groups.find(g=>g.key===key)
    if(!family)return
    const previous=plans.filter(r=>!r.deleted&&r.draft.productGroupId===key).at(-1)
    setDraft({...newTikTokDraft(),...(previous?.draft||{}),name:'แผนราคาปกติ',productName:family.name,business:family.business,sku:family.skus[0],productGroupId:key,productSkus:family.skus,price:previous?.draft.price??family.referencePrice??'',cost:previous?.draft.cost??''})
    setActive(null);setDirty(true);setMessage('เลือกสินค้าแล้ว ตรวจราคาและต้นทุนสำหรับ TikTok Mall')
  }
  const chart=result.valid?[500,750,1000,1250,1500].map(units=>({units,profit:result.unitProfit*units/100})):[]
  return <div className="pricing-page pricing-tiktok">
    <header className="pricing-heading"><h1>คำนวณราคาและกำไร TikTok Mall</h1><span className="pricing-private"><LockKeyhole size={14}/> เฉพาะ dev และ boss</span></header>
    <div className="pricing-toolbar"><div className="pricing-tabs" role="group" aria-label="มุมมอง TikTok Mall"><button className={view==='calculator'?'active':''} aria-pressed={view==='calculator'} onClick={()=>setView('calculator')}><SlidersHorizontal size={16}/> เครื่องคำนวณ</button><button className={view==='plans'?'active':''} aria-pressed={view==='plans'} onClick={()=>setView('plans')}><FolderOpen size={16}/> แผนที่บันทึก <span>{plans.filter(r=>!r.deleted).length}</span></button></div></div>
    <div className="pricing-notice"><span>{access?.demo?'ข้อมูลตัวอย่าง · แผนจะหายเมื่อรีเฟรช':'แผนราคาส่วนตัว · TikTok Mall'}</span><span>ไม่เก็บเงินรับจริง</span></div>
    {error&&<div className="pricing-feedback error" role="alert">{error}</div>}{message&&<div className="pricing-feedback" role="status"><Check size={16}/>{message}</div>}
    {pending&&<div className="pricing-feedback"><span>มีคำขอรอตรวจสอบ กรุณาคงหน้านี้ไว้</span><button className="pricing-button" disabled={busy} onClick={recover}>ตรวจสอบผลบันทึก</button></div>}
    {openCandidate&&<div className="pricing-feedback"><span>มีข้อมูลยังไม่บันทึก เปิดแผนอื่นแทนหรือไม่?</span><button className="pricing-button" onClick={()=>open(openCandidate,true)}>เปิดแผน</button><button className="pricing-button" onClick={()=>setOpenCandidate(null)}>ยกเลิก</button></div>}
    <fieldset className="pricing-editor" disabled={busy||!!pending||loading}>
    {view==='plans'?<section className="pricing-saved"><div className="pricing-section-heading"><h2>{trash?'ถังขยะ TikTok Mall':'แผนราคา TikTok Mall'}</h2><button className="pricing-button subtle" onClick={()=>setTrash(!trash)}>{trash?'กลับรายการแผน':`ถังขยะ (${plans.filter(r=>r.deleted).length})`}</button><label className="pricing-search">ค้นหาแผน<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ชื่อสินค้า / ชื่อแผน"/></label></div>{!shown.length?<div className="pricing-empty"><FolderOpen size={32}/><h3>{trash?'ไม่มีแผนในถังขยะ':'ยังไม่มีแผน TikTok Mall'}</h3><p>คำนวณแล้วบันทึกไว้เปิดใช้ครั้งถัดไป</p></div>:<div className="pricing-plan-grid">{shown.map(record=><article className="pricing-plan-card" key={record.revisionId}><div className="pricing-plan-meta"><span>TikTok Mall</span><span>{record.draft.productSkus?.length?`รวม ${record.draft.productSkus.length} ตัวเลือก`:''}</span></div><h3>{record.draft.productName}</h3><p>{record.draft.name}</p><div className="pricing-plan-numbers"><div><small>ราคาขาย</small><strong>{money(record.result.unitPrice)}</strong></div><div><small>กำไรเป้าหมาย / ชิ้น</small><strong>{money(record.result.unitProfit)}</strong></div></div><small>{new Date(record.createdAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})} · {record.createdBy}</small><div className="pricing-plan-actions">{!trash&&<button className="pricing-button" onClick={()=>open(record)}>แก้ไข</button>}<button className="pricing-button subtle" onClick={()=>trash?submit({action:'restore-scenario',requestId:crypto.randomUUID(),scenarioId:record.scenarioId,parentRevisionId:record.revisionId}):setDeleteId(record.scenarioId)}><Trash2 size={14}/>{trash?'กู้คืน':'ลบ'}</button></div>{deleteId===record.scenarioId&&<div className="pricing-delete-confirm"><span>ลบแผนนี้? กู้คืนได้จากถังขยะ</span><button className="pricing-button" onClick={()=>{setDeleteId(null);submit({action:'delete-scenario',requestId:crypto.randomUUID(),scenarioId:record.scenarioId,parentRevisionId:record.revisionId})}}>ยืนยันลบ</button><button className="pricing-button" onClick={()=>setDeleteId(null)}>ยกเลิก</button></div>}</article>)}</div>}</section>:<>
    <div className="pricing-workspace"><div className="pricing-form-stack">
      <section className="pricing-panel"><div className="pricing-section-heading"><h2>สินค้าและต้นทุน</h2><span className="pricing-pill">รายสินค้า</span></div><div className="pricing-fields"><label className="pricing-field">ธุรกิจ<select value={draft.business} onChange={e=>{setDraft({...newTikTokDraft(),business:e.target.value});setActive(null);setDirty(true)}}>{['Payi','Payi Outlet','กรอบรูป'].map(b=><option key={b}>{b}</option>)}</select></label><label className="pricing-field">เลือกสินค้าจาก Payi Ops<select value={draft.productGroupId} onChange={e=>selectFamily(e.target.value)}><option value="">เลือกสินค้า (รวมสี / ไซซ์)</option>{groups.filter(g=>g.business===draft.business&&g.kind==='single').map(g=><option key={g.key} value={g.key}>{g.name}</option>)}</select></label></div><label className="pricing-field">ชื่อสินค้า<input value={draft.productName} onChange={e=>update('productName',e.target.value)} maxLength={300}/></label>{draft.productSkus.length>0&&<p className="pricing-help">ราคาเดียวกัน รวม {draft.productSkus.length} ตัวเลือก</p>}<div className="pricing-fields tiktok-cost-fields">{[['cost','ต้นทุนสินค้า (รับจากโรงงาน)'],['packing','กล่อง / ซอง / เทป'],['overhead','พนักงาน / ค่าเช่า / น้ำไฟ'],['extraCost','ต้นทุนเพิ่มเติมตามชีต']].map(([key,label])=><Field key={key} label={label} value={draft[key]} onChange={v=>update(key,v)}/>)}</div></section>
      <section className="pricing-panel"><div className="pricing-section-heading"><h2>ค่าธรรมเนียม Platform</h2><span className="pricing-pill">แก้ไขได้</span></div><div className="pricing-fields">{Object.entries(feeLabels).map(([key,label])=><Field key={key} label={label} value={draft[key]} max={100} unit="%" onChange={v=>update(key,v)}/>)}</div><details className="pricing-fold"><summary>วิธีคำนวณตามชีตต้นแบบ <ChevronDown size={15}/></summary><p className="pricing-help">รวมเปอร์เซ็นต์ค่าธรรมเนียมและ VAT แล้วคิดจากราคาขาย ตามชีต Mall ค่า VAT 7% และต้นทุนเพิ่ม 1.06 บาทเป็นสมมติฐานที่แก้ได้ ไม่ได้ดึงอัตราล่าสุดจาก TikTok</p></details></section>
      <section className="pricing-panel"><div className="pricing-section-heading"><h2>กำไรเป้าหมายและ Affiliate</h2></div><div className="pricing-fields"><Field label="กำไรที่อยากได้" value={draft.targetMargin} max={100} unit="%" onChange={v=>update('targetMargin',v)}/><Field label="ค่าคอมนายหน้าผ่าน Ads" value={draft.affiliate} max={100} unit="%" onChange={v=>update('affiliate',v)}/></div><p className="pricing-help">งบ Ads ที่รับได้ = ราคาขาย − ต้นทุน − ค่าธรรมเนียม − Affiliate − กำไรเป้าหมาย</p></section>
    </div><div className="pricing-summary-stack"><section className="pricing-panel pricing-price-panel"><span className="pricing-eyebrow">ลองปรับราคาขาย</span><Field label="ราคาต่อชิ้น" value={draft.price} onChange={v=>update('price',v)}/><input className="pricing-slider" type="range" aria-label="เลื่อนราคาขาย TikTok" min={1} max={Math.max(1000,Number(draft.price)||1)} value={draft.price||1} onChange={e=>update('price',e.target.value)}/></section>
    <section className="pricing-receipt"><div className="pricing-receipt-header"><span>ประมาณการต่อชิ้น · TikTok Mall</span><LockKeyhole size={15}/></div><div className="pricing-receipt-body"><div className="pricing-receipt-title"><h2>{draft.productName}</h2><span>ราคาขายและงบโฆษณาตามกำไรเป้าหมาย</span></div>{!result.valid?<div role="status">{result.errors.map(e=><p key={e}>{e}</p>)}</div>:<><dl className="pricing-ledger"><div><dt>ราคาขาย</dt><dd>{money(result.unitPrice)}</dd></div><div><dt>ต้นทุนรวม / ชิ้น</dt><dd>{money(result.unitCost)}</dd></div></dl><dl className="pricing-ledger deductions">{result.fees.map(f=><div key={f.key}><dt>{feeLabels[f.key]} <small>{f.rate}%</small></dt><dd>−{money(f.amount)}</dd></div>)}<div><dt>Affiliate {draft.affiliate}%</dt><dd>−{money(result.affiliate)}</dd></div></dl><dl className="pricing-ledger pricing-totals"><div><dt>ค่าธรรมเนียมรวม</dt><dd>{money(result.platformFees)}</dd></div><div><dt>งบ Ads ที่รับได้ / ชิ้น</dt><dd>{money(result.availableAds)}</dd></div><div><dt>ROI / ROAS เป้าหมายขั้นต่ำ</dt><dd>{result.roi===null?'—':`${result.roi.toFixed(3)} เท่า`}</dd></div></dl>{result.availableAds<=0&&<div className="pricing-feedback error">{result.availableAds<0?`ต้นทุนเกินงบ ${money(-result.availableAds)} ต่อชิ้น ต้องปรับราคาหรือลดต้นทุนเพื่อถึงกำไรเป้าหมาย`:'ไม่มีงบเหลือสำหรับ Ads ตามกำไรเป้าหมายนี้'}</div>}<div className="pricing-profit"><span>กำไรเป้าหมาย / ชิ้น</span><strong>{money(result.unitProfit)}</strong><span>Margin {Number(draft.targetMargin).toFixed(2)}% ของราคาขาย</span></div><p className="pricing-help tiktok-profit-note">จะถึงกำไรนี้เมื่อค่า Ads ไม่เกินงบที่คำนวณได้ และสมมติฐานอื่นเป็นไปตามแผน</p></>}
    <div className="pricing-save"><label className="pricing-field">ชื่อแผนราคา<input maxLength={300} value={draft.name} onChange={e=>update('name',e.target.value)}/></label><button className="pricing-button primary" disabled={!result.valid} onClick={()=>save()}><Save size={16}/>{access?.demo?'เก็บแผนตัวอย่าง':active?'บันทึกการแก้ไข':'บันทึกแผน'}</button>{active&&<button className="pricing-button" onClick={()=>save(true)}>บันทึกเป็นแผนใหม่</button>}<small>{dirty?'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก':'บันทึกสูตรและสมมติฐานไว้เปิดใช้ครั้งถัดไป'}</small></div></div></section></div></div>
    <details className="pricing-panel pricing-simulation pricing-fold"><summary>งบโฆษณาต่อวันและจำลองยอดขาย <ChevronDown size={16}/></summary>{result.valid&&<><div className="pricing-fields"><Field label="ยอดขายจำลอง / เดือน" value={draft.monthlyVolume} step="1" unit="ชิ้น" onChange={v=>update('monthlyVolume',v)}/><div className="pricing-monthly"><span>กำไรตามเป้าหมาย / เดือน</span><strong>{money(result.monthlyProfit)}</strong><small>งบ Ads สูงสุด {money(result.monthlyAds)} / เดือน</small></div></div><dl className="pricing-ledger"><div><dt>Learning phase (50 ชิ้น / 5 วัน)</dt><dd>{money(result.learningBudget)} / วัน</dd></div><div><dt>Hero (30 ชิ้น / วัน)</dt><dd>{money(result.heroBudget)} / วัน</dd></div><div><dt>Evergreen (50 ชิ้น / วัน)</dt><dd>{money(result.evergreenBudget)} / วัน</dd></div></dl><p className="pricing-help">ตัวคูณงบตามชีตต้นแบบ ใช้จำลองงบเท่านั้น ไม่รับประกันผลโฆษณา</p><div className="tiktok-chart" role="img" aria-label="กราฟกำไรเป้าหมายตามจำนวนขาย"><ResponsiveContainer width="100%" height={240}><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="units"/><YAxis/><Tooltip formatter={value=>money(Number(value)*100)}/><Bar dataKey="profit" name="กำไรเป้าหมาย" fill="var(--payi-mint)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div></>}</details>
    </>}
    </fieldset><p className="pricing-footer">ค่าพื้นฐานจากชีต Mall · ปัดรายรายการถึงสตางค์ · ใช้สำหรับวางแผนตั้งราคา</p>
  </div>
}
