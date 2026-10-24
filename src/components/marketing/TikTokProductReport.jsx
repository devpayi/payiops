import {useState} from 'react'

const money=value=>Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
export default function TikTokProductReport({report}) {
  const [query,setQuery]=useState('')
  const check=report.productReconciliation
  const daily=report.verification==='daily-export'
  if(!check&&!daily)return <section className="mm-panel"><h2>ยังไม่มีรายสินค้าในชุดนี้</h2><p>ชุดรายงานนี้มีเฉพาะรายแคมเปญ ต้องนำเข้ารายละเอียดสินค้าของเดือนเดียวกันก่อน</p></section>
  if(daily&&!report.products.length)return <section className="mm-panel"><h2>ยังไม่มีไฟล์รายสินค้า</h2><p>อัปโหลด Campaign overview data พร้อม Product data ของเดือนและร้านเดียวกัน เพื่อเพิ่มรายละเอียดสินค้า ยอดรวมยังแสดงเป็นค่าแอดที่ยังระบุสินค้าไม่ได้</p></section>
  const products=report.products.filter(row=>`${row.name} ${row.itemId}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="mm-panel">
    <div className="mm-section-title"><div><h2>ค่าแอดรายสินค้า TikTok</h2><p>{report.products.length} Product ID · รวมค่าแอดข้ามแคมเปญ · ยังไม่จับคู่สินค้า Ops</p></div><label className="mm-search">ค้นหา<input placeholder="ชื่อสินค้า / Product ID" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
    {daily?<p className="mm-note">แสดงเฉพาะสินค้าจาก Product data ที่เลือก · ยังไม่ยืนยันว่าครบทุกแคมเปญหรือแยกค่าแอด LIVE ได้ · ยอดที่ไม่มีรายละเอียดอยู่ในค่าแอดที่ยังระบุสินค้าไม่ได้</p>:<><div className="mm-check-row"><span>ยอดที่ระบุ Product ID ได้</span><strong>{money(check.productSpend)}</strong></div>
    <div className="mm-check-row"><span>ผลต่างจากแคมเปญสินค้า · ยังไม่จัดสรร</span><strong>{money(check.unallocatedProductSpend)}</strong></div>
    <div className="mm-check-row"><span>ค่าแอด LIVE · รายงานแยกตามสตรีม</span><strong>{money(check.liveSpend)}</strong></div>
    <div className="mm-check-row"><span>ค่าแอดรวมเดือนนี้</span><strong>{money(report.spend)}</strong></div>
    <p className="mm-note">คงยอดตามต้นฉบับ ไม่กระจายผลต่างหรือค่าแอด LIVE ให้สินค้า สีและไซซ์จะรวมเป็นสินค้าของ Ops หลังยืนยันการจับคู่</p></>}
    <div className="mm-table-wrap"><table><thead><tr><th>สินค้า</th><th>Product ID</th><th>ค่าแอด</th><th>แหล่งแคมเปญ</th></tr></thead><tbody>
      {products.map(row=><tr key={row.itemId}><td>{row.name}<small className="mm-unmapped">ยังไม่จับคู่ทะเบียน Ops</small></td><td>{row.itemId}</td><td>{money(row.spend)}</td><td><details><summary>{row.sources.length} แคมเปญ</summary>{row.sources.map(source=><p key={source.rowId}>{source.campaignName} · {money(source.spend)}<small className="mm-unmapped">Campaign ID {source.campaignId||source.platformCampaignId} · {source.status || 'ไม่ระบุสถานะ'}</small></p>)}</details></td></tr>)}
      {!products.length&&<tr><td colSpan={4}>ไม่พบสินค้าที่ตรงกับคำค้น</td></tr>}
    </tbody></table></div>
    {check&&<details><summary>ตรวจยอดรายแคมเปญสินค้า ({check.campaigns.length})</summary><div className="mm-table-wrap"><table><thead><tr><th>แคมเปญ</th><th>ยอดแคมเปญ</th><th>รวมรายสินค้า</th><th>ผลต่าง</th></tr></thead><tbody>{check.campaigns.map(campaign=><tr key={campaign.campaignId}><td>{campaign.name}<small className="mm-unmapped">{campaign.campaignId}</small></td><td>{money(campaign.spend)}</td><td>{money(campaign.productSpend)}</td><td>{money(campaign.difference)}</td></tr>)}</tbody></table></div></details>}
  </section>
}
