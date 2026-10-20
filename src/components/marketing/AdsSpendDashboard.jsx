import {Fragment,useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {ShoppingBag,Music2,Package,ChartNoAxesCombined,ChevronLeft,ChevronRight,Link2,Search,ArrowDownUp,SlidersHorizontal,AlertCircle,RotateCcw,Check,ChevronDown} from 'lucide-react'
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,Legend} from 'recharts'
import {buildAdProductHistory} from '../../../shared/adProductHistory.js'
import {buildAdsSpendOverview,adsRoasStatus,adsSpendPercent} from '../../../shared/adsSpendOverview.js'
import {adProductKey,groupAdProducts} from '../../../shared/adProductMappings.js'
import AdProductMappingEditor from './AdProductMappingEditor.jsx'
import './AdsSpendDashboard.css'
import './AdsSpendDashboard.theme.css'

const PAGE_SIZE=6
// Shorten only the visible marketplace title; IDs, mapping and stored names stay intact.
const displayProductName=name=>name.replace(/^PAYI HEALTH CARE\s*(?:แท้\s*100%\s*)?/i,'').trim()||name
const money=value=>value===null?'ยังไม่มีรายงาน':Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
const percent=value=>value===null?'—':value!==0&&Math.abs(value)<0.01?(value>0?'< 0.01%':'> -0.01%'):`${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}%`
const shortMonth=value=>new Intl.DateTimeFormat('th-TH',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${value}-01T00:00:00Z`))
const platformColor=name=>name==='Shopee'?'#ed6d67':name==='TikTok Shop'?'#7658cc':'#268dbd'
const tone=platform=>platform==='Shopee'?'shopee':platform==='TikTok Shop'?'tiktok':'lazada'
const roas=value=>!Number.isFinite(value)||value<0?'—':value<4&&value>=3.995?'< 4.00×':value<6&&value>=5.995?'< 6.00×':`${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}×`

function RoasBadge({value}) {
  const status=adsRoasStatus(value)
  return <span className={`ads-roas-badge ads-roas-${status.key}`} aria-label={`ROAS ${roas(value)} ${status.label}`}><strong>{roas(value)}</strong></span>
}

function AdProductDrawer({group,monthLabel,total,history,onClose,onMap,canMap}) {
  const dialogRef=useRef(null)
  const [chartMetric,setChartMetric]=useState('roas')
  const comparableMonths=history.points.filter(point=>history.platforms.some(name=>point[chartMetric][name]!==null)).length
  useEffect(()=>{
    const dialog=dialogRef.current,previous=document.activeElement,overflow=document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow='hidden'
    return ()=>{dialog.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()}
  },[])
  return createPortal(<dialog ref={dialogRef} className="ad-product-drawer" aria-labelledby="ad-product-drawer-title" onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
    <div className="ad-product-drawer-content">
      <header className="ad-product-drawer-header"><span>ค่าแอดรายสินค้า · {monthLabel}</span><button type="button" className="ad-product-drawer-close" aria-label="ปิดรายละเอียดสินค้า" onClick={onClose}>×</button></header>
      <h2 id="ad-product-drawer-title">{group.name}</h2><p className="ad-product-drawer-business">{group.business}</p>
      <div className="ad-product-drawer-stats"><section><span>ค่าแอดเดือนนี้</span><strong>{money(group.spend)}</strong></section><section><span>สัดส่วนค่าแอดรวม</span><strong>{percent(adsSpendPercent(group.spend,total))}</strong></section></div>
      <div className="ad-product-drawer-summary"><span>ROAS รวม · {monthLabel}</span><RoasBadge value={group.roas}/><small>{group.sales===null?'ยังไม่มีข้อมูลยอดขายจากแอดครบทุกแพลตฟอร์ม':`${money(group.sales)} ยอดขายที่แพลตฟอร์มให้เครดิต ÷ ${money(group.spend)} ค่าแอด`}</small></div>
      <h3>ROAS แยกแพลตฟอร์ม</h3>
      <div className="ad-product-drawer-platforms">{group.platforms.map(row=><section key={row.platform} className="ad-product-drawer-platform"><span className={`ad-platform-chip ads-tone-${tone(row.platform)}`}>{row.platform}</span><span>ค่าแอด {money(row.spend)}<small>ยอดขายจากแอด {money(row.sales)}</small></span><RoasBadge value={row.roas}/></section>)}</div>
      <div className="ad-product-chart-heading"><h3>แนวโน้มย้อนหลัง 6 เดือน</h3><div role="group" aria-label="เลือกข้อมูลกราฟ"><button type="button" aria-pressed={chartMetric==='roas'} onClick={()=>setChartMetric('roas')}>ROAS</button><button type="button" aria-pressed={chartMetric==='values'} onClick={()=>setChartMetric('values')}>ค่าแอด</button></div></div>
      <div className="ad-product-history-chart" role="img" aria-label={`กราฟ${chartMetric==='roas'?'ROAS':'ค่าแอด'}ย้อนหลัง 6 เดือน แยกแพลตฟอร์ม`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={history.points} margin={{top:12,right:16,bottom:4,left:0}}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month" tickFormatter={shortMonth} tick={{fontSize:11}}/><YAxis width={55} domain={[0,'auto']} tickFormatter={value=>chartMetric==='roas'?`${Number(value).toLocaleString('th-TH',{maximumFractionDigits:1})}×`:Number(value).toLocaleString('th-TH',{notation:'compact'})} tick={{fontSize:11}}/><Tooltip labelFormatter={shortMonth} formatter={(value,name)=>[chartMetric==='roas'?roas(value):money(value),name]}/><Legend wrapperStyle={{fontSize:12}}/>{history.platforms.map(name=><Line key={`${chartMetric}-${name}`} name={name} dataKey={point=>point[chartMetric][name]} stroke={platformColor(name)} strokeWidth={2.5} dot={{r:4}} activeDot={{r:6}} connectNulls={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer>
      </div>
      <p className="ad-product-history-note">{comparableMonths===0?'ยังไม่มีข้อมูลครบสำหรับเทียบรายเดือน':comparableMonths===1?'มีข้อมูลที่เทียบได้เพียงเดือนเดียว · เพิ่มรายงานเดือนอื่นเพื่อดูแนวโน้ม':'เดือนปฏิทิน · เว้นช่วงเมื่อยังไม่มีข้อมูลครบ'}</p>
      <details className="ad-product-history-values"><summary>ดูตัวเลข{chartMetric==='roas'?' ROAS':'ค่าแอด'}รายเดือน</summary><div><table><thead><tr><th>เดือน</th>{history.platforms.map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{history.points.map(point=><tr key={point.month}><th>{shortMonth(point.month)}</th>{history.platforms.map(name=><td key={name}>{point[chartMetric][name]===null?(point.incomplete[name]?'ข้อมูลไม่ครบ':'—'):chartMetric==='roas'?roas(point.roas[name]):money(point.values[name])}</td>)}</tr>)}</tbody></table></div></details>
      <p className="ad-product-history-note">ROAS รวมใช้ยอดขายที่แต่ละแพลตฟอร์มให้เครดิตรวมกันหารด้วยค่าแอดรวม ยอดขายที่ให้เครดิตอาจซ้ำกันระหว่างแพลตฟอร์ม</p>
      <footer><button type="button" disabled={!canMap} onClick={onMap}>{group.mapped?'แก้ Map สินค้า':'Map สินค้านี้'}</button></footer>
    </div>
  </dialog>,document.body)
}

function PlatformMark({platform,size=22}) {
  return <span className={`ads-platform-icon ads-tone-${tone(platform)}`} aria-hidden="true">{platform==='Shopee'?<ShoppingBag size={size}/>:platform==='TikTok Shop'?<Music2 size={size}/>:<Package size={size}/>}</span>
}

function DashboardState({kind,onRetry}) {
  if(kind==='loading')return <section className="ads-spend-dashboard ads-state-loading" aria-busy="true" aria-label="กำลังอ่านรายงานค่าแอด"><span className="ads-sr-only" role="status">กำลังอ่านค่าแอดรายเดือน…</span><div className="ads-skeleton ads-skeleton-hero"/><div className="ads-skeleton-cards">{[0,1,2].map(key=><div key={key} className="ads-skeleton"/>)}</div><div className="ads-skeleton ads-skeleton-table"/></section>
  return <section className="ads-spend-dashboard"><div className="ads-state" role="alert"><AlertCircle size={36}/><h2>ยังโหลดรายงานไม่ได้</h2><p>ข้อมูลล่าสุดยังไม่พร้อม กรุณาลองโหลดอีกครั้ง</p>{onRetry&&<button className="ads-ui-button" onClick={onRetry}><RotateCcw size={16}/>ลองอีกครั้ง</button>}</div></section>
}

export default function AdsSpendDashboard({reports,month,business,platform,shopId,onPlatformChange,loading,error,mappingState,onRetry}) {
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(0)
  const [sort,setSort]=useState('spend-desc')
  const [mapFilter,setMapFilter]=useState('all')
  const [roasFilter,setRoasFilter]=useState('all')
  const [expanded,setExpanded]=useState(null)
  const [selected,setSelected]=useState(null),[editing,setEditing]=useState(null),[message,setMessage]=useState('')
  const editorRef=useRef(null)
  useEffect(()=>{
    if(editing!==null){
      editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'})
      editorRef.current?.querySelector('input')?.focus({preventScroll:true})
    }
  },[editing])
  const data=buildAdsSpendOverview(reports,{month,business,platform,shopId})
  const groups=groupAdProducts(data.products,mappingState?.data?.mappings||[],mappingState?.data?.families||[])
  const selectedGroup=groups.find(group=>group.key===selected)
  const history=selectedGroup?buildAdProductHistory(reports,{groupKey:selectedGroup.key,month,business,platform,shopId,mappings:mappingState?.data?.mappings||[],families:mappingState?.data?.families||[]}):null
  const search=query.trim().toLowerCase()
  const products=groups.filter(group=>`${group.name} ${group.business} ${group.rows.map(row=>`${row.name} ${row.itemId} ${row.platform} ${row.shopName}`).join(' ')}`.toLowerCase().includes(search))
    .filter(group=>mapFilter==='all'||(mapFilter==='mapped'?group.mapped:!group.mapped))
    .filter(group=>roasFilter==='all'||adsRoasStatus(group.roas).key===roasFilter)
    .sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'th'):sort==='spend-asc'?Number(a.spend)-Number(b.spend):Number(b.spend)-Number(a.spend))
  const unmapped=groups.filter(group=>!group.mapped).length
  const canMap=mappingState?.data?.writeAvailable&&!mappingState.loading
  const currentPage=Math.min(page,Math.max(0,Math.ceil(products.length/PAGE_SIZE)-1))
  const pageCount=Math.ceil(products.length/PAGE_SIZE)
  const pageStart=Math.max(0,Math.min(currentPage-1,pageCount-3))
  const shownProducts=products.slice(currentPage*PAGE_SIZE,currentPage*PAGE_SIZE+PAGE_SIZE)
  const selectedLabel=platform==='__all__'?'ทุกแพลตฟอร์ม':platform
  const monthLabel=new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${month}-01T00:00:00Z`))
  const clearFilters=()=>{setQuery('');setMapFilter('all');setRoasFilter('all');setPage(0)}
  if(loading&&!data.reports)return <DashboardState kind="loading"/>
  if(error)return <DashboardState kind="error" onRetry={onRetry}/>
  return <section className="ads-spend-dashboard" aria-label="สรุปค่าแอดรายสินค้า" aria-busy={loading||undefined}>
    <header className="ads-spend-heading">
      <span className="ads-hero-icon" aria-hidden="true"><ChartNoAxesCombined size={32}/></span>
      <div className="ads-hero-main"><p>ค่าแอดรวมทั้งหมด</p><h2>{money(data.spend)}</h2><span>{monthLabel} <i>·</i> {selectedLabel} <i>·</i> {business==='__all__'?'ทุกธุรกิจ':business}</span></div>
      <div className="ads-spend-count"><Package size={26} aria-hidden="true"/><div><strong>{groups.length.toLocaleString('th-TH')} <span>รายการสินค้า</span></strong><small>ในขอบเขตที่เลือก</small></div></div>
      <div className="ads-hero-share" aria-label="สัดส่วนค่าแอดทุกแพลตฟอร์มของธุรกิจ">{data.platforms.filter(row=>row.spend!==null).map(row=><span key={row.platform} className={`ads-tone-${tone(row.platform)}`} style={{flexGrow:Math.max(0,row.percent||0)}} title={`${row.platform} ${percent(row.percent)}`}/>)}</div>
    </header>
    <div className="ads-spend-platforms" aria-label="สัดส่วนค่าแอดแต่ละแพลตฟอร์ม">
      {data.platforms.map(row=><button key={row.platform} className={`ads-spend-platform ads-tone-${tone(row.platform)}`} aria-pressed={platform===row.platform} onClick={()=>onPlatformChange(platform===row.platform?'__all__':row.platform)}>
        <div className="ads-card-top"><PlatformMark platform={row.platform}/><div className="ads-card-name"><strong>{row.platform}</strong><small>ค่าแอดจาก {row.platform}</small></div><div className="ads-card-share"><span className="ads-share-ring" style={{'--share':`${Math.max(0,Math.min(100,row.percent||0))}%`}} aria-hidden="true"/><div><strong>{percent(row.percent)}</strong><small>สัดส่วนค่าแอด</small></div></div></div>
        <div className="ads-card-value"><strong>{money(row.spend)}</strong><span className="ads-spend-roas-line" title={row.sales===null?'ยังไม่มีข้อมูลยอดขายครบ':`ยอดขายจากแอด ${money(row.sales)} ÷ ค่าแอด ${money(row.spend)}`}><span>ROAS</span><RoasBadge value={row.roas}/></span></div>
        <span className="ads-spend-track" aria-hidden="true"><i style={{width:`${row.percent||0}%`}}/></span>
        {row.spend===null&&<small className="ads-card-missing">ยังไม่มีรายงานเดือนนี้</small>}
      </button>)}
    </div>
    {platform!=='__all__'&&<button className="ads-back-all" onClick={()=>onPlatformChange('__all__')}><ChevronLeft size={15}/>ทุกแพลตฟอร์ม</button>}
    {data.unverified>0&&<p className="ads-notice ads-notice-warning" role="status"><AlertCircle size={16}/>มี {data.unverified} ชุดรายงานที่ยังตรวจยอดไม่ผ่าน จึงยังไม่รวมในสรุปนี้</p>}
    {mappingState?.error&&<div className="ads-notice ads-notice-error" role="alert"><AlertCircle size={16}/><span>{mappingState.error}</span><button onClick={()=>mappingState.refresh().catch(()=>{})}>โหลด Map ล่าสุด</button></div>}
    {message&&<p className="ads-notice" role="status"><Check size={16}/>{message}</p>}
    {editing!==null&&<div ref={editorRef}><AdProductMappingEditor key={JSON.stringify(editing)} products={data.products} mappingState={mappingState} initialKeys={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setMessage('บันทึก Map แล้ว')}}/></div>}
    {!data.reports?<section className="ads-state"><Package size={40}/><h2>ยังไม่มีรายงานเดือนนี้</h2><p>เลือกเดือนหรือแพลตฟอร์มอื่น หรือเปิดไฟล์รายงานด้วยปุ่มด้านบน</p></section>:<>
      <section id="ads-products" className="ads-spend-products">
        <div className="ads-products-toolbar"><div className="ads-products-title"><span aria-hidden="true"><ChartNoAxesCombined size={24}/></span><div><h2>ค่าแอดรายสินค้า</h2><p>{groups.length.toLocaleString('th-TH')} สินค้า{unmapped?` · รอ Map ${unmapped.toLocaleString('th-TH')} รายการ`:''}</p></div></div><div className="ad-group-tools"><button className="ads-ui-button ads-map-button" disabled={!canMap} onClick={()=>{setMessage('');setEditing([])}}><Link2 size={17}/>{mappingState?.loading?'กำลังโหลด…':'Map สินค้า'}</button><label className="ads-search"><Search size={17} aria-hidden="true"/><span className="ads-sr-only">ค้นหาสินค้า</span><input value={query} onChange={event=>{setQuery(event.target.value);setPage(0)}} placeholder="ชื่อสินค้า / Product ID"/></label></div></div>
        <div className="ads-table-filters"><SlidersHorizontal size={15} aria-hidden="true"/><label><span className="ads-sr-only">สถานะ Map</span><select value={mapFilter} onChange={event=>{setMapFilter(event.target.value);setPage(0)}}><option value="all">สถานะ Map ทั้งหมด</option><option value="mapped">Map แล้ว</option><option value="unmapped">ยังไม่ได้ Map</option></select></label><label><span className="ads-sr-only">เกณฑ์ ROAS</span><select value={roasFilter} onChange={event=>{setRoasFilter(event.target.value);setPage(0)}}><option value="all">ROAS ทั้งหมด</option><option value="below">ต่ำกว่า 4×</option><option value="acceptable">4× – ต่ำกว่า 6×</option><option value="target">ตั้งแต่ 6×</option><option value="unavailable">ยังประเมินไม่ได้</option></select></label><label className="ads-sort-select"><ArrowDownUp size={14}/><span className="ads-sr-only">เรียงสินค้า</span><select value={sort} onChange={event=>{setSort(event.target.value);setPage(0)}}><option value="spend-desc">ค่าแอดมากไปน้อย</option><option value="spend-asc">ค่าแอดน้อยไปมาก</option><option value="name">ชื่อสินค้า</option></select></label>{(query||mapFilter!=='all'||roasFilter!=='all')&&<button className="ads-clear-filter" onClick={clearFilters}>ล้างตัวกรอง</button>}</div>
        <div className="ads-table-wrap"><table className="ad-group-table"><thead><tr><th scope="col">สินค้า</th><th scope="col" aria-sort={sort==='spend-desc'?'descending':sort==='spend-asc'?'ascending':'none'}><button className="ads-sort-heading" onClick={()=>{setSort(sort==='spend-desc'?'spend-asc':'spend-desc');setPage(0)}}>ค่าแอดรวม<ArrowDownUp size={13}/></button></th><th scope="col">ROAS รวม</th><th scope="col">รายละเอียด</th></tr></thead><tbody>
          {shownProducts.map((group,index)=><Fragment key={group.key}><tr className={expanded===group.key?'ads-row-is-open':''} onClick={event=>{if(!event.target.closest('button,a,input,select'))setExpanded(expanded===group.key?null:group.key)}}>
            <td><div className="ads-spend-product-name"><span className="ads-spend-rank">{currentPage*PAGE_SIZE+index+1}</span><span className="ads-product-avatar" aria-hidden="true"><Package size={22}/></span><div><button className="ads-product-name-button" title={group.name} aria-expanded={expanded===group.key} aria-controls={`ads-row-detail-${index}`} onClick={()=>setExpanded(expanded===group.key?null:group.key)}>{displayProductName(group.name)}</button><small>{business==='__all__'?`${group.business} · `:''}{group.mapped?<span className="ads-mapped-mark"><Check size={11}/>Map แล้ว</span>:'รอ Map'}</small></div></div></td>
            <td className="ads-spend-value" data-label="ค่าแอดรวม"><strong>{money(group.spend)}</strong><small>{percent(group.percent)} ของค่าแอดรวม</small></td>
            <td className="ads-platform-cell ads-total-roas-cell" data-label="ROAS รวม"><RoasBadge value={group.roas}/><small>{group.roas===null?'ข้อมูลยอดขายจากแอดไม่ครบ':`${group.platforms.length} แพลตฟอร์ม · ยอดขายจากแอด ${money(group.sales)}`}</small></td>
            <td className="ads-actions-cell"><button aria-haspopup="dialog" aria-label={`ดูกราฟ ROAS ${group.name}`} className="ad-chart-button" onClick={()=>setSelected(group.key)}><ChartNoAxesCombined size={16}/><span>ดูกราฟ</span></button><button className="ads-expand-button" aria-label={`${expanded===group.key?'ย่อ':'ขยาย'}รายละเอียด ${group.name}`} aria-expanded={expanded===group.key} onClick={()=>setExpanded(expanded===group.key?null:group.key)}><ChevronDown size={15}/></button></td>
          </tr>{expanded===group.key&&<tr className="ads-row-expanded"><td colSpan={4}><section id={`ads-row-detail-${index}`} className="ads-inline-detail" aria-label={`รายละเอียดสินค้า ${group.name}`}><div><h3>{group.name}</h3><p>รวม {group.rows.length} รายการจากรายงาน · {monthLabel}</p></div><div className="ads-detail-actions"><button className="ads-ui-button" aria-haspopup="dialog" onClick={()=>setSelected(group.key)}><ChartNoAxesCombined size={16}/>กราฟรายเดือน</button><button className="ads-ui-button ads-button-secondary" disabled={!canMap} onClick={()=>setEditing(group.rows.map(adProductKey))}><Link2 size={16}/>{group.mapped?'แก้ Map':'Map สินค้านี้'}</button></div></section></td></tr>}</Fragment>)}
          {!products.length&&<tr><td colSpan={4}><div className="ads-table-empty"><Search size={28}/><h3>{groups.length?'ไม่พบสินค้าที่ตรงกับตัวกรอง':'ยังไม่มีรายละเอียดรายสินค้า'}</h3><p>{groups.length?'ลองค้นหาด้วยชื่ออื่น หรือเปลี่ยนตัวกรอง':'รายงานชุดนี้ยังไม่มีค่าแอดแยกรายสินค้า'}</p>{groups.length>0&&<button className="ads-ui-button ads-button-secondary" onClick={clearFilters}>ล้างตัวกรอง</button>}</div></td></tr>}
        </tbody></table></div>
        <footer className="ads-table-footer"><span>{products.length?`${currentPage*PAGE_SIZE+1}–${Math.min(products.length,(currentPage+1)*PAGE_SIZE)} จาก ${products.length} สินค้า`:'0 สินค้า'}</span>{pageCount>1&&<nav className="ads-spend-pagination" aria-label="หน้ารายการค่าแอดสินค้า"><button aria-label="หน้าก่อนหน้า" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button>{Array.from({length:Math.min(3,pageCount)},(_,index)=>pageStart+index).map(value=><button key={value} aria-label={`หน้าที่ ${value+1}`} aria-current={currentPage===value?'page':undefined} onClick={()=>setPage(value)}>{value+1}</button>)}<button aria-label="หน้าถัดไป" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></nav>}</footer>
      </section>
      <p className="ads-footnote">% คิดจากค่าแอด{selectedLabel} {money(data.spend)} · ค้นหาและกรองสินค้าแล้วฐาน % คงเดิม · ROAS รวม = ยอดขายจากแอดที่แต่ละแพลตฟอร์มให้เครดิตรวมกัน ÷ ค่าแอดรวม กดดูกราฟเพื่อดูแยกแพลตฟอร์ม</p>
      {data.unassigned.length>0&&<details className="ads-spend-unassigned"><summary>ค่าแอดนอกกลุ่มสินค้า <span>{data.unassigned.length} รายการ · รวมอยู่ในยอดด้านบนแล้ว</span></summary>{data.unassigned.map(row=><div className="ads-spend-other-row" key={row.key}><span>{row.label}<small>{row.platform} · {row.business} · {row.shopName}</small></span><strong>{money(row.spend)}</strong><span>{percent(row.percent)}</span></div>)}</details>}
      <p className="ads-footnote">เดือนปฏิทิน · ยังไม่ปรับ VAT · ROAS คือยอดขายที่แพลตฟอร์มให้เครดิต ÷ ค่าแอด ไม่ใช่กำไร</p>
    </>}
    {selectedGroup&&<AdProductDrawer group={selectedGroup} history={history} monthLabel={monthLabel} total={data.spend} canMap={canMap} onClose={()=>setSelected(null)} onMap={()=>{setSelected(null);setEditing(selectedGroup.rows.map(adProductKey))}}/>}
  </section>
}
