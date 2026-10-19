import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {buildAdsSpendOverview,adsRoasStatus,adsSpendPercent} from '../../../shared/adsSpendOverview.js'
import {adProductKey,groupAdProducts} from '../../../shared/adProductMappings.js'
import AdProductMappingEditor from './AdProductMappingEditor.jsx'
import './AdsSpendDashboard.css'

const money=value=>value===null?'ยังไม่มีรายงาน':Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
const percent=value=>value===null?'—':value!==0&&Math.abs(value)<0.01?(value>0?'< 0.01%':'> -0.01%'):`${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}%`
const tone=platform=>platform==='Shopee'?'shopee':platform==='TikTok Shop'?'tiktok':'lazada'
const roas=value=>!Number.isFinite(value)||value<0?'—':value<4&&value>=3.995?'< 4.00×':value<6&&value>=5.995?'< 6.00×':`${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}×`

function RoasBadge({value}) {
  const status=adsRoasStatus(value)
  return <span className={`ads-roas-badge ads-roas-${status.key}`} aria-label={`ROAS ${roas(value)} ${status.label}`}><strong>{roas(value)}</strong></span>
}

function AdProductDrawer({group,monthLabel,total,onClose,onMap,canMap}) {
  const dialogRef=useRef(null)
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
      <h3>สัดส่วนค่าแอดแต่ละแพลตฟอร์ม</h3>
      <div className="ad-product-drawer-platforms">{group.platforms.map(row=>{
        const share=adsSpendPercent(row.spend,group.spend)
        return <section key={row.platform} className={`ad-product-drawer-platform ads-tone-${tone(row.platform)}`} aria-label={`ค่าแอด ${row.platform}`}>
          <div className="ad-product-drawer-platform-heading"><strong>{row.platform}</strong><span>{money(row.spend)} · {percent(share)}</span></div>
          <span className="ads-spend-track" aria-hidden="true"><i style={{width:`${Math.max(0,Math.min(100,share||0))}%`}}/></span>
          <div className="ad-product-drawer-roas"><span>ROAS</span><RoasBadge value={row.roas}/></div>
        </section>
      })}</div>
      <footer><button type="button" disabled={!canMap} onClick={onMap}>{group.mapped?'แก้ Map สินค้า':'Map สินค้านี้'}</button></footer>
    </div>
  </dialog>,document.body)
}

export default function AdsSpendDashboard({reports,month,business,platform,shopId,onPlatformChange,loading,error,mappingState}) {
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(0)
  const [selected,setSelected]=useState(null),[editing,setEditing]=useState(null),[message,setMessage]=useState('')
  const editorRef=useRef(null)
  useEffect(()=>{if(editing!==null)editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'})},[editing])
  const data=buildAdsSpendOverview(reports,{month,business,platform,shopId})
  const groups=groupAdProducts(data.products,mappingState?.data?.mappings||[],mappingState?.data?.families||[])
  const selectedGroup=groups.find(group=>group.key===selected)
  const search=query.trim().toLowerCase()
  const products=groups.filter(group=>`${group.name} ${group.business} ${group.rows.map(row=>`${row.name} ${row.itemId} ${row.platform} ${row.shopName}`).join(' ')}`.toLowerCase().includes(search))
  const unmapped=groups.filter(group=>!group.mapped).length
  const canMap=mappingState?.data?.writeAvailable&&!mappingState.loading
  const currentPage=Math.min(page,Math.max(0,Math.ceil(products.length/10)-1))
  const shownProducts=products.slice(currentPage*10,currentPage*10+10)
  const selectedLabel=platform==='__all__'?'ทุกแพลตฟอร์ม':platform
  const monthLabel=new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${month}-01T00:00:00Z`))
  if(loading&&!data.reports)return <p className="mm-feedback" role="status">กำลังอ่านค่าแอดรายเดือน…</p>
  if(error)return null
  return <section className="ads-spend-dashboard" aria-label="สรุปค่าแอดรายสินค้า">
    <header className="ads-spend-heading"><div><p>ค่าแอดรวม</p><h2>{money(data.spend)}</h2><span>{monthLabel} · {selectedLabel} · {business==='__all__'?'ทุกธุรกิจ':business}</span></div><div className="ads-spend-count"><strong>{groups.length}</strong><span>รายการสินค้า</span></div></header>
    <div className="ads-spend-platforms" aria-label="สัดส่วนค่าแอดแต่ละแพลตฟอร์ม">
      {data.platforms.map(row=><button key={row.platform} className={`ads-spend-platform ads-tone-${tone(row.platform)}`} aria-pressed={platform===row.platform} onClick={()=>onPlatformChange(platform===row.platform?'__all__':row.platform)}>
        <span className="ads-spend-platform-name">{row.platform}<span>{percent(row.percent)}</span></span><strong>{money(row.spend)}</strong><span className="ads-spend-roas-line" title={row.sales===null?'ยังไม่มีข้อมูลยอดขายครบ':`ยอดขายจากแอด ${money(row.sales)} ÷ ค่าแอด ${money(row.spend)}`}><span>ROAS</span><RoasBadge value={row.roas}/></span><span className="ads-spend-track" aria-hidden="true"><i style={{width:`${row.percent||0}%`}}/></span><small>{row.spend===null?'ยังไม่มีรายงานเดือนนี้':'สัดส่วนจากค่าแอดทุกแพลตฟอร์ม'}</small>
      </button>)}
    </div>
    {platform!=='__all__'&&<button className="mm-inline-link" onClick={()=>onPlatformChange('__all__')}>ดูทุกแพลตฟอร์ม</button>}
    {data.unverified>0&&<p className="mm-feedback mm-warning">มี {data.unverified} ชุดรายงานที่ยังตรวจยอดไม่ผ่าน จึงยังไม่รวมในสรุปนี้</p>}
    {mappingState?.error&&<p className="mm-feedback mm-error" role="alert">{mappingState.error} <button onClick={()=>mappingState.refresh().catch(()=>{})}>โหลด Map ล่าสุด</button></p>}
    {message&&<p className="mm-feedback" role="status">{message}</p>}
    {editing!==null&&<div ref={editorRef}><AdProductMappingEditor key={JSON.stringify(editing)} products={data.products} mappingState={mappingState} initialKeys={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setMessage('บันทึก Map แล้ว รวมค่าแอดตามสินค้าให้แล้ว')}}/></div>}
    {!data.reports?<section className="mm-empty"><h2>ยังไม่มีรายงานในขอบเขตที่เลือก</h2><p>เลือกเดือนหรือแพลตฟอร์มอื่น หรือเปิดรายงานของเดือนนี้</p></section>:<>
      <section className="mm-panel ads-spend-products">
        <div className="mm-section-title"><div><h2>ค่าแอดรายสินค้า</h2><p>รวมตามสินค้าที่คุณ Map · กดดูเพื่อแยกแพลตฟอร์ม{unmapped?` · ยังไม่ได้ Map ${unmapped} รายการ`:''}</p></div><div className="ad-group-tools"><button className="mm-primary" disabled={!canMap} onClick={()=>{setMessage('');setEditing([])}}>{mappingState?.loading?'กำลังโหลด Map…':'Map สินค้า'}</button><label className="mm-search">ค้นหาสินค้า<input value={query} onChange={event=>{setQuery(event.target.value);setPage(0)}} placeholder="ชื่อสินค้า / Product ID"/></label></div></div>
        <div className="mm-table-wrap"><table className="ad-group-table"><thead><tr><th scope="col">สินค้า</th><th scope="col">ค่าแอดรวม</th><th scope="col">% ของ{platform==='__all__'?'ค่าแอดรวม':platform}</th><th scope="col">แพลตฟอร์ม</th><th scope="col">ROAS</th><th scope="col">รายละเอียด</th></tr></thead><tbody>
          {shownProducts.map((group,index)=><tr key={group.key}><td><div className="ads-spend-product-name"><span className="ads-spend-rank">{search?'':currentPage*10+index+1}</span><div><strong>{group.name}</strong><small>{group.business}{group.mapped?'':' · ยังไม่ได้ Map'}</small></div></div></td><td className="ads-spend-value">{money(group.spend)}</td><td className="ads-spend-share"><strong>{percent(group.percent)}</strong><span className="ads-spend-track" aria-hidden="true"><i style={{width:`${Math.max(0,Math.min(100,group.percent||0))}%`}}/></span></td><td><div className="ad-group-platforms">{group.platforms.map(row=><span key={row.platform} className={`ads-spend-tag ads-tone-${tone(row.platform)}`}>{row.platform}</span>)}</div></td><td className="ads-spend-roas">{group.platforms.length===1?<RoasBadge value={group.roas}/>:<span className="ad-group-split">ดูแยกแพลตฟอร์ม</span>}</td><td><button aria-haspopup="dialog" aria-label={`ดูรายละเอียด ${group.name}`} onClick={()=>setSelected(group.key)}>ดู</button></td></tr>)}
          {!products.length&&<tr><td colSpan={6}>{search?'ไม่พบสินค้าที่ตรงกับคำค้น':'ยังไม่มีรายละเอียดรายสินค้าในชุดนี้'}</td></tr>}
        </tbody></table></div>
        {products.length>10&&<nav className="ads-spend-pagination" aria-label="หน้ารายการค่าแอดสินค้า"><span>{currentPage*10+1}–{Math.min(products.length,currentPage*10+10)} จาก {products.length} รายการ</span><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>ก่อนหน้า</button><button disabled={(currentPage+1)*10>=products.length} onClick={()=>setPage(currentPage+1)}>ถัดไป</button></nav>}
        <p className="mm-note">% คิดจากค่าแอด{selectedLabel}ในขอบเขตที่เลือก {money(data.spend)} · ค้นหาสินค้าแล้วฐาน % คงเดิม</p>
        <p className="mm-note">ROAS รับได้ตั้งแต่ 4× · เป้าตั้งแต่ 6× · ยอดขายจากแอด ÷ ค่าแอด ไม่ใช่กำไร · แสดงแยกแพลตฟอร์มเพื่อไม่รวมยอดขายที่อาจให้เครดิตซ้ำกัน</p>
      </section>
      {data.unassigned.length>0&&<section className="ads-spend-unassigned"><h3>ค่าแอดที่แสดงแยกจากสินค้า</h3><p>รวมอยู่ในค่าแอดด้านบนแล้ว</p>{data.unassigned.map(row=><div className="ads-spend-other-row" key={row.key}><span>{row.label}<small>{row.platform} · {row.business} · {row.shopName}</small></span><strong>{money(row.spend)}</strong><span>{percent(row.percent)}</span></div>)}</section>}
      <p className="mm-note">อ่านจากรายงานค่าแอดของเดือนที่เลือก · ยังไม่ปรับ VAT</p>
    </>}
    {selectedGroup&&<AdProductDrawer group={selectedGroup} monthLabel={monthLabel} total={data.spend} canMap={canMap} onClose={()=>setSelected(null)} onMap={()=>{setSelected(null);setEditing(selectedGroup.rows.map(adProductKey))}}/>}
  </section>
}
