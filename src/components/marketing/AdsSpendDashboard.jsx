import {useState} from 'react'
import {buildAdsSpendOverview} from '../../../shared/adsSpendOverview.js'
import './AdsSpendDashboard.css'

const money=value=>value===null?'ยังไม่มีรายงาน':Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
const percent=value=>value===null?'—':value!==0&&Math.abs(value)<0.01?(value>0?'< 0.01%':'> -0.01%'):`${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}%`
const tone=platform=>platform==='Shopee'?'shopee':platform==='TikTok Shop'?'tiktok':'lazada'
const roas=value=>value===null?'—':`${value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}×`

export default function AdsSpendDashboard({reports,month,business,platform,shopId,onPlatformChange,loading,error}) {
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(0)
  const data=buildAdsSpendOverview(reports,{month,business,platform,shopId})
  const search=query.trim().toLowerCase()
  const products=data.products.filter(row=>`${row.name} ${row.itemId} ${row.platform} ${row.business} ${row.shopName}`.toLowerCase().includes(search))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(products.length/10)-1))
  const shownProducts=products.slice(currentPage*10,currentPage*10+10)
  const selectedLabel=platform==='__all__'?'ทุกแพลตฟอร์ม':platform
  if(loading&&!data.reports)return <p className="mm-feedback" role="status">กำลังอ่านค่าแอดรายเดือน…</p>
  if(error)return null
  return <section className="ads-spend-dashboard" aria-label="สรุปค่าแอดรายสินค้า">
    <header className="ads-spend-heading"><div><p>ค่าแอดเดือนนี้</p><h2>{money(data.spend)}</h2><span>{selectedLabel} · {business==='__all__'?'ทุกธุรกิจ':business} · เดือนปฏิทิน</span></div><div className="ads-spend-count"><strong>{data.products.length}</strong><span>รายการสินค้าจากรายงาน</span></div></header>
    <div className="ads-spend-platforms" aria-label="สัดส่วนค่าแอดแต่ละแพลตฟอร์ม">
      {data.platforms.map(row=><button key={row.platform} className={`ads-spend-platform ads-tone-${tone(row.platform)}`} aria-pressed={platform===row.platform} onClick={()=>onPlatformChange(platform===row.platform?'__all__':row.platform)}>
        <span className="ads-spend-platform-name">{row.platform}<span>{percent(row.percent)}</span></span><strong>{money(row.spend)}</strong><span className="ads-spend-roas-line" title={row.sales===null?'ยังไม่มีข้อมูลยอดขายครบ':`ยอดขายจากแอด ${money(row.sales)} ÷ ค่าแอด ${money(row.spend)}`}><span>ROAS</span><b>{roas(row.roas)}</b></span><span className="ads-spend-track" aria-hidden="true"><i style={{width:`${row.percent||0}%`}}/></span><small>{row.spend===null?'ยังไม่มีรายงานเดือนนี้':'สัดส่วนจากค่าแอดทุกแพลตฟอร์ม'}</small>
      </button>)}
    </div>
    {platform!=='__all__'&&<button className="mm-inline-link" onClick={()=>onPlatformChange('__all__')}>ดูทุกแพลตฟอร์ม</button>}
    {data.unverified>0&&<p className="mm-feedback mm-warning">มี {data.unverified} ชุดรายงานที่ยังตรวจยอดไม่ผ่าน จึงยังไม่รวมในสรุปนี้</p>}
    {!data.reports?<section className="mm-empty"><h2>ยังไม่มีรายงานในขอบเขตที่เลือก</h2><p>เลือกเดือนหรือแพลตฟอร์มอื่น หรือเปิดรายงานของเดือนนี้</p></section>:<>
      <section className="mm-panel ads-spend-products">
        <div className="mm-section-title"><div><h2>สินค้าไหนใช้ค่าแอดเท่าไหร่</h2><p>เรียงจากมากไปน้อย · ใช้ชื่อสินค้าตามรายงาน</p></div><label className="mm-search">ค้นหาสินค้า<input value={query} onChange={event=>{setQuery(event.target.value);setPage(0)}} placeholder="ชื่อสินค้า / Product ID"/></label></div>
        <div className="mm-table-wrap"><table><thead><tr><th scope="col">สินค้า</th><th scope="col">แพลตฟอร์ม</th><th scope="col">ค่าแอด</th><th scope="col">% ของ{platform==='__all__'?'ค่าแอดรวม':platform}</th><th scope="col">ยอดขายจากแอด</th><th scope="col">ROAS</th></tr></thead><tbody>
          {shownProducts.map((row,index)=><tr key={row.key}><td><div className="ads-spend-product-name"><span className="ads-spend-rank">{search?'':currentPage*10+index+1}</span><div><strong>{row.name}</strong><small>{row.business} · {row.shopName} · ID {row.itemId}</small></div></div></td><td><span className={`ads-spend-tag ads-tone-${tone(row.platform)}`}>{row.platform}</span></td><td className="ads-spend-value">{money(row.spend)}</td><td className="ads-spend-share"><strong>{percent(row.percent)}</strong><span className={`ads-spend-track ads-tone-${tone(row.platform)}`} aria-hidden="true"><i style={{width:`${Math.max(0,Math.min(100,row.percent||0))}%`}}/></span></td><td className="ads-spend-sales">{row.sales===null?'—':money(row.sales)}</td><td className="ads-spend-roas">{roas(row.roas)}</td></tr>)}
          {!products.length&&<tr><td colSpan={6}>{search?'ไม่พบสินค้าที่ตรงกับคำค้น':'ยังไม่มีรายละเอียดรายสินค้าในชุดนี้'}</td></tr>}
        </tbody></table></div>
        {products.length>10&&<nav className="ads-spend-pagination" aria-label="หน้ารายการค่าแอดสินค้า"><span>{currentPage*10+1}–{Math.min(products.length,currentPage*10+10)} จาก {products.length} รายการ</span><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>ก่อนหน้า</button><button disabled={(currentPage+1)*10>=products.length} onClick={()=>setPage(currentPage+1)}>ถัดไป</button></nav>}
        <p className="mm-note">% คิดจากค่าแอด{selectedLabel}ในขอบเขตที่เลือก {money(data.spend)} · ค้นหาสินค้าแล้วฐาน % คงเดิม · ชื่อหรือรหัสข้ามแพลตฟอร์มยังแสดงแยกกัน</p>
        <p className="mm-note">ROAS = ยอดขายที่รายงานให้เครดิตโฆษณา ÷ ค่าแอด · ไม่ใช่กำไร · — หมายถึงข้อมูลยอดขายไม่ครบหรือค่าแอดเป็นศูนย์</p>
      </section>
      {data.unassigned.length>0&&<section className="ads-spend-unassigned"><h3>ค่าแอดที่แสดงแยกจากสินค้า</h3><p>รวมอยู่ในค่าแอดด้านบนแล้ว</p>{data.unassigned.map(row=><div className="ads-spend-other-row" key={row.key}><span>{row.label}<small>{row.platform} · {row.business} · {row.shopName}</small></span><strong>{money(row.spend)}</strong><span>{percent(row.percent)}</span></div>)}</section>}
      <p className="mm-note">อ่านจากรายงานค่าแอดของเดือนที่เลือก · ยังไม่ปรับ VAT</p>
    </>}
  </section>
}
