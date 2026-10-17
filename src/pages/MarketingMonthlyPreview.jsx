import {useRef,useState} from 'react'
import {BarChart3,CalendarDays,CheckCircle2,FileCheck2,FileUp,Info,Layers3,Package,Trash2} from 'lucide-react'
import {buildShopeeMonthlyReport,parseShopeeMonthlyReport} from '../../shared/monthlyAdsReports.js'
import {previousMarketingMonth,selectMonthlyReport} from '../../shared/marketingReadModels.js'
import TikTokSalesChannels from '../components/marketing/TikTokSalesChannels.jsx'
import {monthlyAdsExample} from '../data/monthlyAdsExample.js'
import {buildTikTokMonthlyReport} from '../../shared/tiktokAdsReport.js'
import './MarketingMonthlyPreview.css'

const money=value=>value===null?'ยังไม่มีข้อมูล':Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
const period=report=>`${report.dateFrom.split('-').reverse().join('/')} – ${report.dateTo.split('-').reverse().join('/')}`
const platformOf=report=>report.platform || 'Shopee'
const reportKey=report=>JSON.stringify([platformOf(report),report.business,report.shopId,report.month])
const viewLabels={overview:'ภาพรวม',campaigns:'แคมเปญ / กลุ่มโฆษณา',products:'รายสินค้า',sources:'แหล่งข้อมูล'}
const lastClosedMonth=()=>{
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]))
  return previousMarketingMonth(`${values.year}-${values.month}`)
}

export default function MarketingMonthlyPreview({embedded=false,serverReports=[],sourceLoading=false,sourceError='',denied=false,canSave=false,onSaved}) {
  const [area,setArea]=useState('ads')
  const [month,setMonth]=useState(lastClosedMonth)
  const [business,setBusiness]=useState('Payi')
  const [platform,setPlatform]=useState('Shopee')
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
  const picker=useRef(null)
  const allSets={...Object.fromEntries(serverReports.map(r=>[reportKey(r),r])),...sets}
  const report=selectMonthlyReport(Object.values(allSets),{month,business,shopId,platform},candidate)
  const isTikTok=platform==='TikTok Shop'
  const shops=Object.values(allSets).filter(r=>r.month===month && r.business===business && platformOf(r)===platform)
  const recentMonths=[lastClosedMonth()]
  for(let i=1;i<12;i++)recentMonths.push(previousMarketingMonth(recentMonths[i-1]))
  const monthOptions=[...new Set([month,...recentMonths,...Object.values(allSets).map(r=>r.month)])].sort().reverse()
  const visibleProducts=report?.products.filter(row=>`${row.name} ${row.itemId}`.toLowerCase().includes(query.toLowerCase())) || []
  async function openFiles(event) {
    const files=Array.from(event.target.files || [])
    event.target.value=''
    if(!files.length)return
    setReading(true);setError('');setMessage('')
    try {
      if(files.length>2)throw Error('เลือกได้ไม่เกินสองไฟล์: ภาพรวมและรายละเอียดกลุ่มของเดือนเดียวกัน')
      const decoded=await Promise.all(files.map(async file=>{
        if(file.size>2_000_000 || !/\.(csv|json)$/i.test(file.name))throw Error('รองรับไฟล์ CSV / JSON ขนาดไม่เกิน 2 MB')
        const buffer=await file.arrayBuffer()
        const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer)
        const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('')
        return {name:file.name,text,fingerprint}
      }))
      let next,nextPlatform
      if(decoded.length===1&&/\.json$/i.test(decoded[0].name)) {
        nextPlatform='TikTok Shop'
        next={...buildTikTokMonthlyReport(JSON.parse(decoded[0].text.replace(/^\uFEFF/,'')),{business}),fingerprints:[`seller-center-dashboard:${decoded[0].fingerprint}`]}
      } else {
        nextPlatform='Shopee'
        const parsed=decoded.map(file=>({...parseShopeeMonthlyReport(file.text,{filename:file.name}),fingerprint:file.fingerprint}))
        const overview=parsed.find(r=>r.kind==='overview'),detail=parsed.find(r=>r.kind==='group-detail')
        if(!overview || (parsed.length===2 && !detail))throw Error('เลือกไฟล์ภาพรวมหนึ่งไฟล์ และรายละเอียดกลุ่มได้อีกหนึ่งไฟล์')
        next={...buildShopeeMonthlyReport(overview,detail,{business}),fingerprints:parsed.map(r=>`${r.kind}:${r.fingerprint}`).sort()}
      }
      const existing=allSets[reportKey(next)]
      if(existing?.persisted && JSON.stringify(existing.fingerprints)===JSON.stringify(next.fingerprints)) {setMessage('ไฟล์ชุดนี้บันทึกไว้แล้ว ไม่เพิ่มยอดซ้ำ');return}
      setSourceFiles(decoded.map(({name,text})=>({name,text})));setCandidate(next);setPlatform(nextPlatform);setMonth(next.month);setShopId(next.shopId);setView('overview');setQuery('')
    } catch(e) {setError(e.message || 'อ่านไฟล์ไม่ได้');setCandidate(null)}
    finally {setReading(false)}
  }
  function useCandidate() {
    setSets(prev=>({...prev,[reportKey(candidate)]:candidate}));setCandidate(null);setMessage('ใช้ชุดรายงานชั่วคราวในหน้านี้แล้ว · ยังไม่ส่งขึ้นชีต')
  }
  function clearPreview() {setCandidate(null);setSets({});setShopId('');setMessage('ยกเลิกไฟล์ที่เปิดเพิ่มชั่วคราวแล้ว รายงานที่ระบบอ่านไว้ยังอยู่');setError('')}
  async function saveCandidate() {
    setSaving(true);setError('')
    try {
      const response=await fetch('/api/marketing?kind=save-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform,business,files:sourceFiles})})
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
    <nav className="mm-area-tabs" aria-label="พื้นที่ข้อมูล"><button aria-pressed={area==='ads'} onClick={()=>setArea('ads')}><BarChart3 size={18}/> วิเคราะห์โฆษณา</button><button aria-pressed={area==='sales'} onClick={()=>setArea('sales')}><Package size={18}/> ช่องทางขาย TikTok <small>ใต้ Dashboard ยอดขาย</small></button></nav></>}
    {!embedded&&<section className="mm-intro"><div><p className="mm-eyebrow">{area==='ads'?'MONTHLY ADS REPORT':'TIKTOK SALES CHANNELS'}</p><h1>{area==='ads'?'ค่าแอดเดือนนี้ ไปอยู่ตรงไหนบ้าง':'ยอดขายมาจากช่องทางไหน'}</h1><p>{area==='ads'?'เลือกเดือนเดียวกัน แล้วค่อยดูภาพรวม แคมเปญ และสินค้า':'แยกที่มาของยอดขายออกจากรูปแบบคอนเทนต์'}</p></div></section>}
    <input ref={picker} type="file" accept=".csv,.json,text/csv,application/json" multiple onChange={openFiles} hidden aria-label="ไฟล์รายงานโฆษณา"/>
    <fieldset className="mm-filters" disabled={reading||saving}>
      <label><CalendarDays size={16}/> เดือนปฏิทิน<select value={month} onChange={e=>{setMonth(e.target.value);setCandidate(null);setShopId('');setQuery('')}}>{monthOptions.map(value=><option key={value} value={value}>{new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${value}-01T00:00:00Z`))}</option>)}</select></label>
      <label>ธุรกิจ<select value={business} onChange={e=>{setBusiness(e.target.value);setCandidate(null);setShopId('')}}>{['Payi','Payi Outlet','กรอบรูป'].map(b=><option key={b}>{b}</option>)}</select></label>
      {area==='ads'&&<label>ช่องทาง<select value={platform} onChange={e=>{setPlatform(e.target.value);setCandidate(null);setShopId('');setView('overview');setQuery('')}}><option value="Shopee">Shopee</option><option value="TikTok Shop">TikTok Shop</option></select></label>}
      {!embedded&&<span className="mm-platform">{area==='ads'?'Shopee · โฆษณาสินค้า':'TikTok Shop'}</span>}
      {area==='ads'&&shops.length>1&&<label>ร้าน<select value={shopId} onChange={e=>{setCandidate(null);setShopId(e.target.value)}}>{shops.map(s=><option key={s.shopId} value={s.shopId}>{s.shopName} · {s.shopId}</option>)}</select></label>}
      {area==='ads'&&<button className="mm-import" disabled={reading} onClick={()=>picker.current?.click()}><FileUp size={16}/>{reading?'กำลังตรวจไฟล์…':'เปิดไฟล์รายงาน'}</button>}
    </fieldset>
    {sourceLoading&&<p className="mm-feedback" role="status">กำลังอ่านชุดรายงาน…</p>}
    {sourceError&&<p className="mm-feedback mm-error" role="alert">{sourceError}</p>}
    {error&&<p className="mm-feedback mm-error" role="alert">{error} · รายงานที่เคยเลือกไว้ไม่ถูกเขียนทับ</p>}
    {message&&<p className="mm-feedback" role="status">{message}</p>}
    {area==='sales'?<TikTokSalesChannels month={month} business={business}/>:<>
      {candidate&&<section className="mm-candidate"><div><strong>{allSets[reportKey(candidate)]?'พบรายงานเดือนนี้อยู่แล้ว — ตรวจชุดใหม่ก่อนแทนที่':'ตรวจไฟล์แล้ว — ยังเป็นชุดรอตรวจในหน้านี้'}</strong><p>{candidate.shopName} · ธุรกิจที่เลือก: {business} · {period(candidate)} · {candidate.sources.length} ไฟล์</p></div><div>{canSave&&<button className="mm-primary" disabled={saving||candidate.status!=='reconciled'} onClick={saveCandidate}>{saving?'กำลังบันทึก…':'บันทึกรายงาน'}</button>}<button disabled={saving} onClick={useCandidate}>ดูชั่วคราว</button><button disabled={saving} onClick={()=>setCandidate(null)}>ยกเลิกชุดใหม่</button></div></section>}
      {!report?<section className="mm-empty mm-first-run"><div className="mm-empty-icon"><FileCheck2 size={32}/></div><h2>ยังไม่มีรายงานเดือนนี้</h2>{isTikTok?<p>รายงาน TikTok นำเข้าจากแดชบอร์ดโฆษณา Seller Center ด้วยสคริปต์ในเครื่อง<br/>ต้องเป็นยอดเต็มเดือนและยอดรวมรายแคมเปญตรงกับยอดรวมบนแดชบอร์ด</p>:<><p>เปิด CSV ภาพรวม และรายละเอียดกลุ่มโฆษณาของเดือนเดียวกัน<br/>ช่วงวันที่ต้องเริ่มวันที่ 1 และจบวันสุดท้ายของเดือน</p><button className="mm-primary" disabled={reading} onClick={()=>picker.current?.click()}><FileUp size={17}/> เลือกไฟล์รายงาน</button></>}{!embedded&&!isTikTok&&<button disabled={reading} onClick={useExample}>ลองหน้าจอด้วยข้อมูลสมมติ</button>}{!isTikTok&&<small>ไฟล์ที่เปิดเพิ่มใช้ชั่วคราวในหน้านี้ ยังไม่ส่งขึ้นชีต และไม่เปลี่ยนยอดเดิม</small>}</section>:<>
        {report.synthetic&&<p className="mm-feedback mm-warning">ข้อมูลสมมติเพื่อทดสอบหน้าจอ · ไม่ใช่ยอดธุรกิจจริง</p>}
        <div className="mm-report-heading"><div><strong>{report.shopName || `ร้าน ${report.shopId}`}</strong><span>{period(report)} · รหัสร้าน {report.shopId}</span></div><span className={`mm-badge ${report.status==='reconciled'?'mm-good':'mm-warn'}`}>{report.status==='reconciled'?<CheckCircle2 size={15}/>:<Info size={15}/>}{report.status==='reconciled'?(isTikTok?'ยอดรายแคมเปญตรงยอดรวม':'ยอดรายสินค้าตรงภาพรวม'):'รายละเอียดยังไม่ครบ / ต้องตรวจยอด'}</span></div>
        <div className="mm-kpis"><section><span>ค่าแอดตามรายงาน</span><strong>{money(report.spend)}</strong><small>{isTikTok?'GMV Max สินค้า + LIVE · ยังไม่ปรับ VAT':'โฆษณาสินค้า Shopee · ยังไม่ปรับ VAT'}</small></section><section><span>ยอดขายตามรายงานโฆษณา</span><strong>{money(report.sales)}</strong><small>เป็นยอดที่แพลตฟอร์มให้เครดิตโฆษณา</small></section>{isTikTok?<section><span>คำสั่งซื้อ SKU</span><strong>{Number(report.orders).toLocaleString('th-TH')} <em>รายการ</em></strong><small>ตามรายงาน Seller Center · {report.campaigns.length} แคมเปญ</small></section>:<section><span>สินค้าในรายละเอียด</span><strong>{report.products.length.toLocaleString('th-TH')} <em>รายการ</em></strong><small>{report.coverage.productDetail==='complete'?'รวมครบตามภาพรวมชุดนี้':'ยังขาดรายละเอียดบางกลุ่ม'} · ยังไม่จับคู่ Ops</small></section>}</div>
        {!!report.issues.length&&<div className="mm-feedback mm-warning" role="status">{report.issues.map(issue=><p key={issue}>{issue}</p>)}</div>}
        <nav className="mm-view-tabs" aria-label="มุมมองรายงาน">{Object.entries(viewLabels).filter(([key])=>!(isTikTok&&key==='products')).map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label}</button>)}</nav>
        {view==='overview'&&<div className="mm-summary-grid"><section className="mm-panel"><h2>ยอดรวมตรวจอย่างไร</h2>{isTikTok?<><div className="mm-check-row"><span>ยอดรวมที่แดชบอร์ดแสดง</span><strong>{money(report.reportedTotals?.spend ?? null)}</strong></div><div className="mm-check-row"><span>ผลรวมรายแคมเปญ (สินค้า + LIVE)</span><strong>{money(report.spend)}</strong></div><p className="mm-note">แคมเปญสินค้ารวมทุกหน้า และบวกแคมเปญ LIVE GMV Max ซึ่งอยู่คนละแท็บ</p><button className="mm-inline-link" onClick={()=>setView('campaigns')}>ดูค่าแอดรายแคมเปญ →</button></>:<><div className="mm-check-row"><span>ภาพรวม: สินค้าเดี่ยว + ยอดกลุ่ม</span><strong>{money(report.spend)}</strong></div><div className="mm-check-row"><span>รายละเอียด: สินค้าเดี่ยว + สมาชิกในกลุ่ม</span><strong>{money(report.productSpend)}</strong></div><p className="mm-note">ไม่บวกยอดกลุ่มซ้ำกับสมาชิก สินค้าเดียวลงหลายแคมเปญยังนับค่าแอดตามจริงทุกก้อน</p><button className="mm-inline-link" onClick={()=>setView('products')}>ดูค่าแอดแยกรายสินค้า →</button></>}</section><section className="mm-panel"><h2>ขอบเขตของข้อมูล</h2><dl className="mm-scope"><div><dt>ช่วงวันที่</dt><dd>เต็มเดือนปฏิทิน</dd></div><div><dt>ประเภทโฆษณา</dt><dd>{isTikTok?'GMV Max (สินค้า + LIVE)':'โฆษณาสินค้าเท่านั้น'}</dd></div><div><dt>VAT / ฐานยอดขายให้เครดิต</dt><dd>ยังไม่ยืนยัน</dd></div><div><dt>ยอดขายออเดอร์ / กำไร</dt><dd>ยังไม่เชื่อมในหน้าตัวอย่าง</dd></div></dl></section></div>}
        {view==='campaigns'&&<section className="mm-panel"><div className="mm-section-title"><div><h2>รายโฆษณาและกลุ่มโฆษณา</h2><p>{isTikTok?'แต่ละแถวเป็นหนึ่งแคมเปญจากแดชบอร์ด Seller Center':'แต่ละแถวเป็นยอดรวมจากไฟล์ภาพรวม ไม่บวกสมาชิกซ้ำ'}</p></div><Layers3 size={21}/></div><div className="mm-table-wrap"><table><thead><tr><th>ชื่อโฆษณา</th><th>ประเภทแถว</th><th>ค่าแอด</th><th>ยอดขายที่ให้เครดิต</th><th>ROAS ต้นฉบับ</th></tr></thead><tbody>{report.campaigns.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.grain==='group'?'กลุ่มโฆษณา':row.grain==='live'?'LIVE GMV Max':isTikTok?'GMV Max สินค้า':'สินค้าเดี่ยว'}</td><td>{money(row.spend)}</td><td>{money(row.sales)}</td><td>{row.sourceRoas??'ไม่มีข้อมูล'}</td></tr>)}</tbody></table></div><p className="mm-note">ไฟล์นี้ไม่มี Campaign ID ที่ยืนยันได้ ชื่อโฆษณาใช้แสดงผล ไม่ใช้เป็น ID ถาวรข้ามเดือน</p></section>}
        {view==='products'&&<section className="mm-panel"><div className="mm-section-title"><div><h2>ค่าแอดรายสินค้า</h2><p>รวมตามรหัสสินค้า Shopee · ยังไม่จับคู่กลุ่มสินค้าใน Ops</p></div><label className="mm-search">ค้นหา<input placeholder="ชื่อสินค้า / รหัสสินค้า Shopee" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="mm-table-wrap"><table><thead><tr><th>สินค้า</th><th>รหัส Shopee</th><th>ค่าแอด</th><th>ที่มาของค่าแอด</th></tr></thead><tbody>{visibleProducts.map(row=><tr key={row.itemId}><td>{row.name}<small className="mm-unmapped">ยังไม่จับคู่ทะเบียน Ops</small></td><td>{row.itemId}</td><td>{money(row.spend)}</td><td><details><summary>{row.sources.length} แหล่งโฆษณา</summary>{row.sources.map(s=><p key={s.rowId}>{s.campaignName} · {money(s.spend)}</p>)}</details></td></tr>)}{!visibleProducts.length&&<tr><td colSpan={4}>ไม่พบสินค้าที่ตรงกับคำค้น ลองค้นด้วยชื่อหรือรหัสสินค้าอีกครั้ง</td></tr>}</tbody></table></div></section>}
        {view==='sources'&&<section className="mm-panel"><h2>แหล่งข้อมูลของชุดนี้</h2><p className="mm-note">{isTikTok?'ยอดอ่านจากแดชบอร์ดโฆษณา Seller Center ตามช่วงวันที่ของรายงาน ตรวจยอดรวมกับผลรวมรายแคมเปญก่อนเก็บ':'ภาพรวมและรายละเอียดถูกเลือกเป็นชุดเดียวกัน ผลต่างต้องตรวจใหม่เมื่อใช้ไฟล์ส่งออกรอบใหม่'}</p>{report.sources.map(s=><div className="mm-source" key={s.kind}><FileCheck2 size={21}/><div><strong>{s.filename}</strong><p>{s.kind==='overview'?'ภาพรวม':s.kind==='seller-center-dashboard'?'แดชบอร์ดโฆษณา':'รายละเอียดกลุ่ม'} · ส่งออก {s.exportedAt || 'ไม่ระบุ'}</p></div></div>)}<p>{report.persisted?'บันทึกในที่เก็บรายงานส่วนตัวแล้ว · ไม่แทนยอด Dashboard/CFO':report.localOnly?'ชุดรายงานนี้อ่านจากไฟล์ส่วนตัวในเครื่อง ยังไม่ได้ส่งขึ้นระบบจริงหรือนำไปแทนยอด Dashboard/CFO':'ชุดรายงานนี้อยู่ในหน่วยความจำของหน้าเว็บ ยังไม่ได้บันทึกหรือนำไปแทนยอดใดในระบบเดิม'}</p></section>}
      </>}
      {!!Object.keys(sets).length&&<button className="mm-clear" onClick={clearPreview}><Trash2 size={15}/> ยกเลิกไฟล์ที่เปิดเพิ่มชั่วคราว</button>}
    </>}
  </main>
}
