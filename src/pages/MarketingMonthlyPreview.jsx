import {useRef,useState} from 'react'
import {BarChart3,CalendarDays,CheckCircle2,FileCheck2,FileUp,Info,Layers3,Package,Trash2} from 'lucide-react'
import {buildShopeeMonthlyReport,parseShopeeMonthlyReport} from '../../shared/monthlyAdsReports.js'
import {previousMarketingMonth,selectMonthlyReport,sumVerifiedReportMetric} from '../../shared/marketingReadModels.js'
import TikTokSalesChannels from '../components/marketing/TikTokSalesChannels.jsx'
import TikTokProductReport from '../components/marketing/TikTokProductReport.jsx'
import AdsSpendDashboard from '../components/marketing/AdsSpendDashboard.jsx'
import {monthlyAdsExample} from '../data/monthlyAdsExample.js'
import {buildTikTokMonthlyReport} from '../../shared/tiktokAdsReport.js'
import {buildLazadaMonthlyReport} from '../../shared/lazadaAdsReport.js'
import {buildAdsWorkbookReport} from '../../shared/adsWorkbookImport.js'
import './MarketingMonthlyPreview.css'

const money=value=>value===null?'ยังไม่มีข้อมูล':Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
const period=report=>`${report.dateFrom.split('-').reverse().join('/')} – ${report.dateTo.split('-').reverse().join('/')}`
const platformOf=report=>report.platform || 'Shopee'
const reportKey=report=>JSON.stringify([platformOf(report),report.business,report.shopId,report.month])
const ALL='__all__' // ตัวเลือก "รวมทั้งหมด" ของธุรกิจ/ช่องทาง (เฉพาะแท็บวิเคราะห์โฆษณา)
const viewLabels={overview:'ภาพรวม',campaigns:'แคมเปญ / กลุ่มโฆษณา',products:'รายสินค้า',sources:'แหล่งข้อมูล'}
const lastClosedMonth=()=>{
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]))
  return previousMarketingMonth(`${values.year}-${values.month}`)
}

export default function MarketingMonthlyPreview({embedded=false,serverReports=[],sourceLoading=false,sourceError='',denied=false,canSave=false,onSaved,mappingState}) {
  const [area,setArea]=useState('ads')
  const [month,setMonth]=useState(lastClosedMonth)
  const [business,setBusiness]=useState('Payi')
  const [platform,setPlatform]=useState(ALL)
  const [dashboard,setDashboard]=useState(true)
  const [view,setView]=useState('overview')
  const [sets,setSets]=useState({})
  const [candidate,setCandidate]=useState(null)
  const [reading,setReading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [sourceFiles,setSourceFiles]=useState([])
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [query,setQuery]=useState('')
  const [shopId,setShopId]=useState('')
  const [importOpen,setImportOpen]=useState(false)
  const [importPlatform,setImportPlatform]=useState('Shopee')
  const [importShop,setImportShop]=useState('')
  const [importShopName,setImportShopName]=useState('')
  const readVersion=useRef(0)
  const picker=useRef(null)
  const allSets={...Object.fromEntries(serverReports.map(r=>[reportKey(r),r])),...sets}
  const report=selectMonthlyReport(Object.values(allSets),{month,business,shopId,platform},candidate)
  const isTikTok=platform==='TikTok Shop'
  const isLazada=platform==='Lazada'
  const dailyExport=report?.verification==='daily-export'
  const isAll=area==='ads'&&(business===ALL||platform===ALL)
  const combinedRows=isAll?Object.values(allSets).filter(r=>r.month===month&&(business===ALL||r.business===business)&&(platform===ALL||platformOf(r)===platform)).sort((a,b)=>String(a.business).localeCompare(String(b.business))||platformOf(a).localeCompare(platformOf(b))):[]
  const verifiedCount=combinedRows.filter(r=>r.status==='reconciled').length
  const sumOf=key=>sumVerifiedReportMetric(combinedRows,key)
  const shops=Object.values(allSets).filter(r=>r.month===month && r.business===business && platformOf(r)===platform)
  const recentMonths=[lastClosedMonth()]
  for(let i=1;i<12;i++)recentMonths.push(previousMarketingMonth(recentMonths[i-1]))
  const monthOptions=[...new Set([month,...recentMonths,...Object.values(allSets).map(r=>r.month)])].sort().reverse()
  const visibleProducts=report?.products.filter(row=>`${row.name} ${row.itemId}`.toLowerCase().includes(query.toLowerCase())) || []
  const importShops=[...new Map(Object.values(allSets).filter(r=>r.business===business&&platformOf(r)==='TikTok Shop').map(r=>[r.shopId,r])).values()]
  async function openFiles(event) {
    const files=Array.from(event.target.files || [])
    event.target.value=''
    if(!files.length)return
    const version=++readVersion.current
    setReading(true);setError('');setMessage('');setCandidate(null);setSourceFiles([])
    try {
      if(files.length>25||files.reduce((sum,file)=>sum+file.size,0)>1_200_000)throw Error('เลือกได้ไม่เกิน 25 ไฟล์ ขนาดรวมไม่เกิน 1.2 MB')
      const decoded=await Promise.all(files.map(async file=>{
        if(file.size>1_000_000 || !/\.(csv|json|xlsx)$/i.test(file.name))throw Error('รองรับไฟล์ Excel (.xlsx) / CSV ขนาดไฟล์ละไม่เกิน 1 MB')
        const buffer=await file.arrayBuffer()
        const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('')
        if(/\.xlsx$/i.test(file.name)) {
          let binary=''
          const bytes=new Uint8Array(buffer)
          for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192))
          return {name:file.name,base64:btoa(binary),fingerprint}
        }
        const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer)
        return {name:file.name,text,fingerprint}
      }))
      if(version!==readVersion.current)return
      let next,nextPlatform
      if(decoded.some(file=>file.base64!==undefined)) {
        if(!decoded.every(file=>file.base64!==undefined))throw Error('เลือก Excel แยกจาก CSV')
        next=buildAdsWorkbookReport(decoded,{business,shopId:importShop,shopName:importShopName})
        nextPlatform=next.platform
        next.fingerprints=decoded.map(file=>`xlsx:${file.fingerprint}`).sort()
      } else if(decoded.length===1&&/\.json$/i.test(decoded[0].name)) {
        const input=JSON.parse(decoded[0].text.replace(/^\uFEFF/,''))
        nextPlatform=input.platform==='Lazada'?'Lazada':'TikTok Shop'
        next={...(nextPlatform==='Lazada'?buildLazadaMonthlyReport:buildTikTokMonthlyReport)(input,{business}),fingerprints:[`${nextPlatform==='Lazada'?'lazada-export-bundle':'seller-center-dashboard'}:${decoded[0].fingerprint}`]}
      } else {
        if(decoded.length>2)throw Error('Shopee เลือกภาพรวมหนึ่งไฟล์และรายละเอียดกลุ่มได้อีกหนึ่งไฟล์')
        nextPlatform='Shopee'
        const parsed=decoded.map(file=>({...parseShopeeMonthlyReport(file.text,{filename:file.name}),fingerprint:file.fingerprint}))
        const overview=parsed.find(r=>r.kind==='overview'),detail=parsed.find(r=>r.kind==='group-detail')
        if(!overview || (parsed.length===2 && !detail))throw Error('เลือกไฟล์ภาพรวมหนึ่งไฟล์ และรายละเอียดกลุ่มได้อีกหนึ่งไฟล์')
        next={...buildShopeeMonthlyReport(overview,detail,{business}),fingerprints:parsed.map(r=>`${r.kind}:${r.fingerprint}`).sort()}
      }
      const existing=allSets[reportKey(next)]
      if(existing?.persisted && JSON.stringify(existing.fingerprints)===JSON.stringify(next.fingerprints)) {setMessage('ไฟล์ชุดนี้บันทึกไว้แล้ว ไม่เพิ่มยอดซ้ำ');return}
      setSourceFiles(decoded.map(file=>file.base64===undefined?{name:file.name,text:file.text}:{name:file.name,base64:file.base64}));setCandidate(next);setPlatform(nextPlatform);setMonth(next.month);setShopId(next.shopId);setView('overview');setQuery('');setDashboard(false);setImportOpen(false)
    } catch(e) {if(version===readVersion.current){setError(e.message || 'อ่านไฟล์ไม่ได้');setCandidate(null)}}
    finally {if(version===readVersion.current)setReading(false)}
  }
  function useCandidate() {
    setSets(prev=>({...prev,[reportKey(candidate)]:candidate}));setCandidate(null);setMessage('ใช้ชุดรายงานชั่วคราวในหน้านี้แล้ว · ยังไม่ส่งขึ้นชีต')
  }
  function clearPreview() {setCandidate(null);setSets({});setShopId('');setMessage('ยกเลิกไฟล์ที่เปิดเพิ่มชั่วคราวแล้ว รายงานที่ระบบอ่านไว้ยังอยู่');setError('')}
  async function saveCandidate() {
    setSaving(true);setError('')
    try {
      const response=await fetch('/api/marketing?kind=save-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform,business,shopId:candidate.shopId,shopName:candidate.shopName,files:sourceFiles})})
      const result=await response.json()
      if(!response.ok||!result.success)throw Error(result.error || 'บันทึกรายงานไม่สำเร็จ')
      setSets(previous=>{const next={...previous};delete next[reportKey(result.report)];return next})
      setCandidate(null);setSourceFiles([]);setMessage('บันทึกรายงานแล้ว');onSaved?.()
    } catch(error){setError(error.message)}
    finally {setSaving(false)}
  }
  function useExample() {
    const next={...buildShopeeMonthlyReport(parseShopeeMonthlyReport(monthlyAdsExample.overview,{filename:'ข้อมูลสมมติ-ภาพรวม.csv'}),parseShopeeMonthlyReport(monthlyAdsExample.detail,{filename:'ข้อมูลสมมติ-กลุ่ม.csv'}),{business}),synthetic:true,fingerprints:['synthetic-example-v1']}
    setSets(prev=>({...prev,[reportKey(next)]:next}));setCandidate(null);setPlatform('Shopee');setMonth(next.month);setShopId(next.shopId);setView('overview');setMessage('');setError('')
  }
  if(denied)return <p className="mm-feedback mm-error" role="alert">{sourceError || 'บัญชีนี้ไม่มีสิทธิ์อ่านรายงาน'}</p>
  return <main className={`mm-page${embedded?' mm-embedded':''}`}>
    {!embedded&&<div className="mm-preview-strip"><Info size={16}/><span>ตัวอย่างในเครื่อง · อ่านไฟล์ในเบราว์เซอร์ · ไม่ส่งขึ้นชีต · รีเฟรชแล้วไฟล์ที่เปิดจะหาย</span></div>}
    {!embedded&&<><header className="mm-header"><div className="mm-brand"><span className="mm-brand-mark">P</span><span>Payi Ops<small>รายงานรายเดือน</small></span></div><span className="mm-mode">ตรวจตัวเลขก่อนเปิดใช้จริง</span></header>
    <nav className="mm-area-tabs" aria-label="พื้นที่ข้อมูล"><button aria-pressed={area==='ads'} onClick={()=>setArea('ads')}><BarChart3 size={18}/> วิเคราะห์โฆษณา</button><button aria-pressed={area==='sales'} onClick={()=>{setArea('sales');setBusiness(b=>b===ALL?'Payi':b)}}><Package size={18}/> ช่องทางขาย TikTok <small>ใต้ Dashboard ยอดขาย</small></button></nav></>}
    {!embedded&&<section className="mm-intro"><div><p className="mm-eyebrow">{area==='ads'?'MONTHLY ADS REPORT':'TIKTOK SALES CHANNELS'}</p><h1>{area==='ads'?'ค่าแอดเดือนนี้ ไปอยู่ตรงไหนบ้าง':'ยอดขายมาจากช่องทางไหน'}</h1><p>{area==='ads'?'เลือกเดือนเดียวกัน แล้วค่อยดูภาพรวม แคมเปญ และสินค้า':'แยกที่มาของยอดขายออกจากรูปแบบคอนเทนต์'}</p></div></section>}
    {area==='ads'&&<nav className="mm-view-tabs ads-summary-switch" aria-label="รูปแบบรายงานค่าแอด"><button aria-pressed={dashboard} onClick={()=>{setDashboard(true);setCandidate(null);setShopId('')}}>สรุปค่าแอด</button><button aria-pressed={!dashboard} onClick={()=>setDashboard(false)}>รายงานต้นทาง</button></nav>}
    <input ref={picker} type="file" accept=".csv,.xlsx,.json" multiple onChange={openFiles} hidden aria-label="ไฟล์รายงานโฆษณา"/>
    <fieldset className="mm-filters" disabled={reading||saving}>
      <label><CalendarDays size={16}/> เดือนปฏิทิน<select value={month} onChange={e=>{setMonth(e.target.value);setCandidate(null);setShopId('');setQuery('')}}>{monthOptions.map(value=><option key={value} value={value}>{new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${value}-01T00:00:00Z`))}</option>)}</select></label>
      <label>ธุรกิจ<select value={business} onChange={e=>{setBusiness(e.target.value);setCandidate(null);setShopId('')}}>{area==='ads'&&<option value={ALL}>รวมทั้งหมด</option>}{['Payi','Payi Outlet','กรอบรูป'].map(b=><option key={b}>{b}</option>)}</select></label>
      {area==='ads'&&<label>ช่องทาง<select value={platform} onChange={e=>{setPlatform(e.target.value);setCandidate(null);setShopId('');setView('overview');setQuery('')}}><option value={ALL}>รวมทั้งหมด</option><option value="Shopee">Shopee</option><option value="TikTok Shop">TikTok Shop</option><option value="Lazada">Lazada</option></select></label>}
      {!embedded&&<span className="mm-platform">{area==='ads'?'Shopee · โฆษณาสินค้า':'TikTok Shop'}</span>}
      {area==='ads'&&!dashboard&&shops.length>1&&<label>ร้าน<select value={shopId} onChange={e=>{setCandidate(null);setShopId(e.target.value)}}>{shops.map(s=><option key={s.shopId} value={s.shopId}>{s.shopName} · {s.shopId}</option>)}</select></label>}
      {area==='ads'&&<button className="mm-import" disabled={reading||business===ALL} title={business===ALL?'เลือกธุรกิจก่อนเปิดไฟล์':'อัปโหลดไฟล์จากแพลตฟอร์ม'} onClick={()=>{setImportPlatform(platform===ALL?'Shopee':platform);setImportOpen(value=>!value)}}><FileUp size={16}/>{reading?'กำลังตรวจไฟล์…':'อัปโหลดรายงาน'}</button>}
    </fieldset>
    {importOpen&&<section className="mm-panel mm-upload-guide" aria-label="อัปโหลดรายงานจากแพลตฟอร์ม">
      <h2>ดาวน์โหลดจากแพลตฟอร์ม แล้วอัปโหลดได้เลย</h2>
      <p>เลือกวันที่ 1 ถึงวันสุดท้ายของเดือนย้อนหลังที่ต้องการ ระบบจะอ่านเดือนจากไฟล์ให้เอง</p>
      <label className="mm-upload-platform">แพลตฟอร์ม<select value={importPlatform} disabled={reading} onChange={event=>setImportPlatform(event.target.value)}><option>Shopee</option><option>TikTok Shop</option><option>Lazada</option></select></label>
      <ul>
        {importPlatform==='Shopee'&&<li><strong>Shopee · CSV 1–2 ไฟล์</strong> — Marketing Centre → Shopee Ads → โฆษณาสินค้า → ดาวน์โหลดข้อมูล → ภาพรวมข้อมูลโฆษณา และข้อมูลกลุ่มโฆษณา</li>}
        {importPlatform==='TikTok Shop'&&<li><strong>TikTok · Excel</strong> — Seller Center → การตลาด → โฆษณาร้านค้า → เลือกช่วงวันที่ → กดส่งออกด้านข้างช่วงวันที่ จะได้ Campaign overview data ส่วน Product data ดาวน์โหลดจากรายละเอียดแคมเปญสินค้าและเลือกเพิ่มพร้อมกันได้</li>}
        {importPlatform==='Lazada'&&<li><strong>Lazada · Excel 3 ไฟล์</strong> — เครื่องมือโปรโมทสินค้า → การโปรโมตบนแพลตฟอร์ม → รายงานข้อมูล → เลือกเดือนเดียวกันและคอนเวอร์ชันตามวันที่ซื้อ → ดาวน์โหลดภาพรวมร้าน และใน Sponsored Max ดาวน์โหลดแท็บแคมเปญ (Campaign) กับสินค้าโปรโมต (Promoted Product)</li>}
      </ul>
      <p className="mm-note">ทุกไฟล์ที่เลือกพร้อมกันต้องมาจากร้านเดียวกันและเดือนเดียวกัน · ไฟล์ละไม่เกิน 1 MB รวมไม่เกิน 1.2 MB{importPlatform==='TikTok Shop'?' · ต้องระบุร้านด้านล่าง เพราะไฟล์ไม่มีรหัสร้าน':''}</p>
      <div className="mm-upload-controls">
        {importPlatform==='TikTok Shop'&&<label>ร้าน TikTok<select disabled={reading} value={importShops.some(shop=>shop.shopId===importShop)?importShop:importShop?'new':''} onChange={event=>{const value=event.target.value;setImportShop(value);setImportShopName(importShops.find(shop=>shop.shopId===value)?.shopName||'')}}><option value="">เลือกร้านที่ดาวน์โหลดไฟล์มา</option>{importShops.map(shop=><option key={shop.shopId} value={shop.shopId}>{shop.shopName||shop.shopId} · {shop.shopId}</option>)}<option value="new">เพิ่มร้านอื่น</option></select></label>}
        {importPlatform==='TikTok Shop'&&(importShop==='new'||(importShop&&!importShops.some(shop=>shop.shopId===importShop)))&&<><label>รหัสร้าน TikTok<input disabled={reading} inputMode="numeric" value={importShop==='new'?'':importShop} onChange={event=>setImportShop(event.target.value||'new')} placeholder="รหัสร้านตาม Seller Center"/></label><label>ชื่อร้าน<input disabled={reading} value={importShopName} onChange={event=>setImportShopName(event.target.value)} placeholder="ชื่อร้าน"/></label></>}
        <button className="mm-primary" disabled={reading||(importPlatform==='TikTok Shop'&&(!/^\d+$/.test(importShop)||!importShopName.trim()))} onClick={()=>picker.current?.click()}><FileUp size={16}/>เลือกไฟล์จากเครื่อง</button>
        <button disabled={reading} onClick={()=>setImportOpen(false)}>ปิด</button>
      </div>
      <p className="mm-note">เปิดไฟล์แล้วตรวจยอดก่อนกดบันทึก หากมีรายงานร้านและเดือนนี้อยู่แล้ว ชุดใหม่จะแทนที่ชุดเดิม ไม่บวกยอดซ้ำ</p>
    </section>}
    {sourceLoading&&<p className="mm-feedback" role="status">กำลังอ่านชุดรายงาน…</p>}
    {sourceError&&(!dashboard||area!=='ads')&&<p className="mm-feedback mm-error" role="alert">{sourceError}</p>}
    {error&&<p className="mm-feedback mm-error" role="alert">{error} · รายงานที่เคยเลือกไว้ไม่ถูกเขียนทับ</p>}
    {message&&<p className="mm-feedback" role="status">{message}</p>}
    {area==='sales'?<TikTokSalesChannels month={month} business={business}/>:dashboard?<AdsSpendDashboard key={JSON.stringify([month,business,platform,shopId])} mappingState={mappingState} reports={Object.values(allSets)} month={month} business={business} platform={platform} shopId={shopId} loading={sourceLoading} error={sourceError} onRetry={onSaved} onPlatformChange={value=>{setPlatform(value);setShopId('');setCandidate(null)}}/>:isAll?<section className="mm-panel"><div className="mm-section-title"><div><h2>รวมทั้งหมด</h2><p>{business===ALL?'ทุกธุรกิจ':business} · {platform===ALL?'ทุกช่องทาง':platform} · เดือนที่เลือก</p></div></div>{!combinedRows.length?<p className="mm-note">ยังไม่มีรายงานเดือนนี้ในขอบเขตที่เลือก</p>:<><div className="mm-kpis"><section><span>ค่าแอดรวม</span><strong>{money(sumOf('spend'))}</strong><small>{verifiedCount} ชุดที่ตรวจยอดผ่าน จาก {combinedRows.length} ชุดรายงาน · ยังไม่ปรับ VAT</small></section><section><span>ยอดขายตามรายงานโฆษณา</span><strong>{money(sumOf('sales'))}</strong><small>ยอดให้เครดิตโฆษณา · อาจซ้ำข้ามแพลตฟอร์ม</small></section></div><div className="mm-table-wrap" style={{overflowX:"auto"}}><table><thead><tr><th>ธุรกิจ</th><th>ช่องทาง</th><th>ร้าน</th><th>ค่าแอด</th><th>ยอดขายตามรายงาน</th><th>สถานะ</th></tr></thead><tbody>{combinedRows.map(r=><tr key={reportKey(r)}><td>{r.business}</td><td>{platformOf(r)}</td><td>{r.shopName||r.shopId}</td><td>{money(r.spend)}</td><td>{money(r.sales)}</td><td>{r.status==='reconciled'?(platformOf(r)==='Lazada'?'ค่าแอดตรง':'ยอดตรง'):'ต้องตรวจยอด'}</td></tr>)}</tbody></table></div></>}<p className="mm-note">เลือกธุรกิจและช่องทางให้ครบเพื่อดูรายแคมเปญ / รายสินค้า และเปิดไฟล์รายงาน</p></section>:<>
      {candidate&&<section className="mm-candidate"><div><strong>{allSets[reportKey(candidate)]?'พบรายงานเดือนนี้อยู่แล้ว — ตรวจชุดใหม่ก่อนแทนที่':'ตรวจไฟล์แล้ว — ยังเป็นชุดรอตรวจในหน้านี้'}</strong><p>{candidate.shopName} · ธุรกิจที่เลือก: {business} · {period(candidate)} · {candidate.sources.length} ไฟล์</p></div><div>{canSave&&<button className="mm-primary" disabled={saving||candidate.status!=='reconciled'} onClick={saveCandidate}>{saving?'กำลังบันทึก…':'บันทึกรายงาน'}</button>}<button disabled={saving} onClick={useCandidate}>ดูชั่วคราว</button><button disabled={saving} onClick={()=>setCandidate(null)}>ยกเลิกชุดใหม่</button></div></section>}
      {!report?<section className="mm-empty mm-first-run"><div className="mm-empty-icon"><FileCheck2 size={32}/></div><h2>ยังไม่มีรายงานเดือนนี้</h2>{isLazada?<p>อัปโหลด Excel ต้นฉบับ 3 ไฟล์: ภาพรวมร้าน, Campaign และ Promoted Product ของเดือนเดียวกัน</p>:isTikTok?<p>อัปโหลด Campaign overview data (.xlsx) ที่ดาวน์โหลดจาก Seller Center<br/>เลือกร้านก่อนเปิดไฟล์ และเพิ่ม Product data ของเดือนเดียวกันได้เพื่อดูรายสินค้า</p>:<><p>เปิด CSV ภาพรวม และรายละเอียดกลุ่มโฆษณาของเดือนเดียวกัน<br/>ช่วงวันที่ต้องเริ่มวันที่ 1 และจบวันสุดท้ายของเดือน</p><button className="mm-primary" disabled={reading} onClick={()=>setImportOpen(true)}><FileUp size={17}/> เลือกไฟล์รายงาน</button></>}{!embedded&&!isTikTok&&!isLazada&&<button disabled={reading} onClick={useExample}>ลองหน้าจอด้วยข้อมูลสมมติ</button>}{!isTikTok&&<small>ไฟล์ที่เปิดเพิ่มใช้ชั่วคราวในหน้านี้ ยังไม่ส่งขึ้นชีต และไม่เปลี่ยนยอดเดิม</small>}</section>:<>
        {(isLazada||dailyExport)&&report.attributionNote&&<p className="mm-feedback">{report.attributionNote}{isLazada&&<> · ออเดอร์ภาพรวม {report.orders} / Sponsored Max {report.campaignTotals.orders}</>}</p>}
        {report.synthetic&&<p className="mm-feedback mm-warning">ข้อมูลสมมติเพื่อทดสอบหน้าจอ · ไม่ใช่ยอดธุรกิจจริง</p>}
        <div className="mm-report-heading"><div><strong>{report.shopName || `ร้าน ${report.shopId}`}</strong><span>{period(report)} · รหัสร้าน {report.shopId}</span></div><span className={`mm-badge ${report.status==='reconciled'?'mm-good':'mm-warn'}`}>{report.status==='reconciled'?<CheckCircle2 size={15}/>:<Info size={15}/>}{report.status==='reconciled'?(dailyExport?'รายวันครบเดือน · ค่าแอดตรงแถวรวม':isTikTok?'ยอดรายแคมเปญตรงยอดรวม':isLazada?'ค่าแอดรายสินค้าตรงภาพรวม':'ยอดรายสินค้าตรงภาพรวม'):'รายละเอียดยังไม่ครบ / ต้องตรวจยอด'}</span></div>
        <div className="mm-kpis"><section><span>ค่าแอดตามรายงาน</span><strong>{money(report.spend)}</strong><small>{isTikTok?(dailyExport?'GMV Max · ผลรวมจาก Excel รายวัน · ยังไม่ปรับ VAT':'GMV Max สินค้า + LIVE · ยังไม่ปรับ VAT'):isLazada?'ภาพรวมร้าน Lazada · ยังไม่ปรับ VAT':'โฆษณาสินค้า Shopee · ยังไม่ปรับ VAT'}</small></section><section><span>ยอดขายตามรายงานโฆษณา</span><strong>{money(report.sales)}</strong><small>เป็นยอดที่แพลตฟอร์มให้เครดิตโฆษณา</small></section>{isTikTok?<section><span>คำสั่งซื้อ SKU</span><strong>{Number(report.orders).toLocaleString('th-TH')} <em>รายการ</em></strong><small>ตามรายงาน Seller Center{!dailyExport&&<> · {report.campaigns.length} แคมเปญ</>}{report.products.length>0?` · ${report.products.length} สินค้า`:null}</small></section>:<section><span>สินค้าในรายละเอียด</span><strong>{report.products.length.toLocaleString('th-TH')} <em>รายการ</em></strong><small>{report.coverage.productDetail==='complete'?'รวมครบตามภาพรวมชุดนี้':'ยังขาดรายละเอียดบางกลุ่ม'} · ยังไม่จับคู่ Ops</small></section>}</div>
        {isTikTok&&report.productReconciliation&&<p className="mm-note">รายสินค้า {money(report.productSpend)} · ผลต่างจากแคมเปญสินค้า {money(report.productReconciliation.unallocatedProductSpend)} · LIVE {money(report.productReconciliation.liveSpend)} ยังไม่จัดสรรให้สินค้า</p>}
        {!!report.roundingNotes?.length&&<p className="mm-feedback">{report.roundingNotes.join(" · ")}</p>}
        {!!report.issues.length&&<div className="mm-feedback mm-warning" role="status">{report.issues.map(issue=><p key={issue}>{issue}</p>)}</div>}
        <nav className="mm-view-tabs" aria-label="มุมมองรายงาน">{Object.entries(viewLabels).map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label}</button>)}</nav>
        {view==='overview'&&<div className="mm-summary-grid"><section className="mm-panel"><h2>ยอดรวมตรวจอย่างไร</h2>{dailyExport?<><div className="mm-check-row"><span>ผลรวมทุกวันใน Excel</span><strong>{money(report.spend)}</strong></div><div className="mm-check-row"><span>ค่าแอดที่มีไฟล์รายสินค้า</span><strong>{money(report.productSpend)}</strong></div><p className="mm-note">ตรวจว่ามีทุกวันครบเดือน ไม่มีวันที่ซ้ำ ค่าแอดตรงแถวรวมท้ายไฟล์ และใช้ THB · ยังไม่ได้เทียบกับยอดรายแคมเปญ สินค้าที่ไม่มีไฟล์รายละเอียดจะไม่ถูกจัดสรรยอดให้</p></>:isTikTok?<><div className="mm-check-row"><span>ยอดรวมที่แดชบอร์ดแสดง</span><strong>{money(report.reportedTotals?.spend ?? null)}</strong></div><div className="mm-check-row"><span>ผลรวมรายแคมเปญ (สินค้า + LIVE)</span><strong>{money(report.spend)}</strong></div><p className="mm-note">แคมเปญสินค้ารวมทุกหน้า และบวกแคมเปญ LIVE GMV Max ซึ่งอยู่คนละแท็บ</p><button className="mm-inline-link" onClick={()=>setView('campaigns')}>ดูค่าแอดรายแคมเปญ →</button></>:<><div className="mm-check-row"><span>{isLazada?'ภาพรวมร้าน Lazada':'ภาพรวม: สินค้าเดี่ยว + ยอดกลุ่ม'}</span><strong>{money(report.spend)}</strong></div><div className="mm-check-row"><span>{isLazada?'รายละเอียด: Sponsored Max รายสินค้า':'รายละเอียด: สินค้าเดี่ยว + สมาชิกในกลุ่ม'}</span><strong>{money(report.productSpend)}</strong></div><p className="mm-note">{isLazada?'เปรียบเทียบค่าแอดจากไฟล์ภาพรวมร้าน แคมเปญ และรายสินค้า โดยไม่บวกยอดรวมซ้ำกับรายละเอียด':'ไม่บวกยอดกลุ่มซ้ำกับสมาชิก สินค้าเดียวลงหลายแคมเปญยังนับค่าแอดตามจริงทุกก้อน'}</p><button className="mm-inline-link" onClick={()=>setView('products')}>ดูค่าแอดแยกรายสินค้า →</button></>}</section><section className="mm-panel"><h2>ขอบเขตของข้อมูล</h2><dl className="mm-scope"><div><dt>ช่วงวันที่</dt><dd>เต็มเดือนปฏิทิน</dd></div><div><dt>ประเภทโฆษณา</dt><dd>{isTikTok?(dailyExport?report.coverage.adTypes:'GMV Max (สินค้า + LIVE)'):isLazada?report.coverage.adTypes:'โฆษณาสินค้าเท่านั้น'}</dd></div><div><dt>VAT / ฐานยอดขายให้เครดิต</dt><dd>ยังไม่ยืนยัน</dd></div><div><dt>ยอดขายออเดอร์ / กำไร</dt><dd>ยังไม่เชื่อมในหน้าตัวอย่าง</dd></div></dl></section></div>}
        {view==='campaigns'&&<section className="mm-panel"><div className="mm-section-title"><div><h2>รายโฆษณาและกลุ่มโฆษณา</h2><p>{isTikTok?(dailyExport?'ยอดรวมจากแถวในไฟล์ Product data ที่เลือก ไม่ใช่ยอดแคมเปญจากแดชบอร์ด':'แต่ละแถวเป็นหนึ่งแคมเปญจากแดชบอร์ด Seller Center'):isLazada?'ยอดรวมตามประเภทโฆษณา ไฟล์นี้ไม่ระบุ Campaign ID ที่ระดับยอดรวม':'แต่ละแถวเป็นยอดรวมจากไฟล์ภาพรวม ไม่บวกสมาชิกซ้ำ'}</p></div><Layers3 size={21}/></div><div className="mm-table-wrap" style={{overflowX:"auto"}}><table><thead><tr><th>ชื่อโฆษณา</th><th>ประเภทแถว</th><th>ค่าแอด</th><th>ยอดขายที่ให้เครดิต</th><th>ROAS ต้นฉบับ</th></tr></thead><tbody>{report.campaigns.map(row=><tr key={row.id}><td>{row.name}{row.platformCampaignId&&<small className="mm-unmapped">Campaign ID {row.platformCampaignId}</small>}</td><td>{row.grain==='ad-type'?'ประเภทโฆษณา':row.grain==='group'?'กลุ่มโฆษณา':row.grain==='live'?'LIVE GMV Max':row.grain==='product-export'?'รวมแถว Product data':isTikTok?'GMV Max สินค้า':'สินค้าเดี่ยว'}</td><td>{money(row.spend)}</td><td>{money(row.sales)}</td><td>{row.sourceRoas??'ไม่มีข้อมูล'}</td></tr>)}</tbody></table></div><p className="mm-note">{dailyExport?'ภาพรวมรายวันไม่มีข้อมูลรายแคมเปญ · แถวที่แสดงมาจาก Product data เท่านั้น':isTikTok&&report.campaigns.every(row=>row.platformCampaignId)?'Campaign ID มาจากหน้ารายละเอียดของ TikTok ใช้แยกจากชื่อแคมเปญที่อาจเปลี่ยนได้':'ไฟล์นี้ไม่มี Campaign ID ที่ยืนยันได้ ชื่อโฆษณาใช้แสดงผล ไม่ใช้เป็น ID ถาวรข้ามเดือน'}</p></section>}
        {view==='products'&&isTikTok&&<TikTokProductReport report={report}/>}
        {view==='products'&&!isTikTok&&<section className="mm-panel"><div className="mm-section-title"><div><h2>ค่าแอดรายสินค้า</h2><p>รวมตามรหัสสินค้า {platform} · ยังไม่จับคู่กลุ่มสินค้าใน Ops</p></div><label className="mm-search">ค้นหา<input placeholder={`ชื่อสินค้า / รหัสสินค้า ${platform}`} value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="mm-table-wrap" style={{overflowX:"auto"}}><table><thead><tr><th>สินค้า</th><th>รหัส {platform}</th><th>ค่าแอด</th><th>ที่มาของค่าแอด</th></tr></thead><tbody>{visibleProducts.map(row=><tr key={row.itemId}><td>{row.name}<small className="mm-unmapped">ยังไม่จับคู่ทะเบียน Ops</small></td><td>{row.itemId}</td><td>{money(row.spend)}</td><td><details><summary>{row.sources.length} แหล่งโฆษณา</summary>{row.sources.map(s=><p key={s.rowId}>{s.campaignName}{s.platformCampaignId?` · Campaign ID ${s.platformCampaignId}`:null} · {money(s.spend)}</p>)}</details></td></tr>)}{!visibleProducts.length&&<tr><td colSpan={4}>ไม่พบสินค้าที่ตรงกับคำค้น ลองค้นด้วยชื่อหรือรหัสสินค้าอีกครั้ง</td></tr>}</tbody></table></div></section>}
        {view==='sources'&&<section className="mm-panel"><h2>แหล่งข้อมูลของชุดนี้</h2><p className="mm-note">{isTikTok?(dailyExport?'อ่านจาก Excel ต้นฉบับ · ตรวจวันครบเดือน · ร้านยืนยันโดยผู้ใช้ เพราะไฟล์ไม่ระบุร้าน':'ยอดอ่านจากแดชบอร์ดโฆษณา Seller Center ตามช่วงวันที่ของรายงาน ตรวจยอดรวมกับผลรวมรายแคมเปญก่อนเก็บ'):'ภาพรวมและรายละเอียดถูกเลือกเป็นชุดเดียวกัน ผลต่างต้องตรวจใหม่เมื่อใช้ไฟล์ส่งออกรอบใหม่'}</p>{report.sources.map(s=><div className="mm-source" key={`${s.kind}:${s.filename}`}><FileCheck2 size={21}/><div><strong>{s.filename}</strong><p>{s.kind==='tiktok-daily-overview'?'ภาพรวมรายวัน TikTok':s.kind==='tiktok-product-export'?'รายสินค้า TikTok':s.kind==='lazada-overview'?'ภาพรวมร้าน Lazada':s.kind==='lazada-campaigns'?'ประเภทโฆษณา Sponsored Max':s.kind==='lazada-products'?'สินค้าโปรโมต':s.kind==='overview'?'ภาพรวม':s.kind==='seller-center-dashboard'?'แดชบอร์ดโฆษณา':s.kind==='seller-center-product-details'?'รายละเอียดรายสินค้า':'รายละเอียดกลุ่ม'} · ส่งออก {s.exportedAt || 'ไม่ระบุ'}</p></div></div>)}<p>{report.persisted?'บันทึกในที่เก็บรายงานส่วนตัวแล้ว · ไม่แทนยอด Dashboard/CFO':report.localOnly?'ชุดรายงานนี้อ่านจากไฟล์ส่วนตัวในเครื่อง ยังไม่ได้ส่งขึ้นระบบจริงหรือนำไปแทนยอด Dashboard/CFO':'ชุดรายงานนี้อยู่ในหน่วยความจำของหน้าเว็บ ยังไม่ได้บันทึกหรือนำไปแทนยอดใดในระบบเดิม'}</p></section>}
      </>}
      {!!Object.keys(sets).length&&<button className="mm-clear" onClick={clearPreview}><Trash2 size={15}/> ยกเลิกไฟล์ที่เปิดเพิ่มชั่วคราว</button>}
    </>}
  </main>
}
