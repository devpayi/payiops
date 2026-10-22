import {useState} from 'react'
import {History,FolderCheck,RotateCcw} from 'lucide-react'
import useMarketingRead from '../../hooks/useMarketingRead.js'
import './ReportUploadHistory.css'

const ALL='__all__'
const monthLabel=value=>new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${value}-01T00:00:00Z`))
const dateLabel=value=>{
  const date=value?new Date(value):null
  return date&&!Number.isNaN(+date)?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(date):'ไม่ระบุเวลา'
}
const period=row=>`${row.dateFrom?.split('-').reverse().join('/')||'—'} – ${row.dateTo?.split('-').reverse().join('/')||'—'}`
const coverage=row=>row.productCoverage==='complete'?'รายละเอียดสินค้าครบ':row.productCount>0?'มีรายละเอียดสินค้าบางส่วน':'ยังไม่มีรายละเอียดสินค้า'
const money=value=>Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})

export default function ReportUploadHistory({reports,onOpen}) {
  const source=useMarketingRead('report-history')
  const [view,setView]=useState('available'),[business,setBusiness]=useState(ALL),[platform,setPlatform]=useState(ALL),[month,setMonth]=useState(ALL)
  const [page,setPage]=useState(0),[size,setSize]=useState('20')
  const loadedReports=reports.filter(report=>report.persisted).map(report=>({...report,platform:report.platform||'Shopee',files:(report.sources||[]).map(file=>file.filename),productCount:report.products?.length||0,productCoverage:report.coverage?.productDetail||'unknown'}))
  const history=source.data?.history||[]
  const latest=(source.data?history.filter(row=>row.current):loadedReports).sort((a,b)=>b.month.localeCompare(a.month)||a.business.localeCompare(b.business)||a.platform.localeCompare(b.platform)||a.shopId.localeCompare(b.shopId))
  const months=[...new Set([...latest,...history].map(row=>row.month))].sort().reverse()
  const matches=row=>(business===ALL||row.business===business)&&(platform===ALL||row.platform===platform)&&(month===ALL||row.month===month)
  const available=latest.filter(matches),events=history.filter(matches),rows=view==='available'?available:events
  const pageSize=size==='all'?Math.max(1,rows.length):20,pages=Math.max(1,Math.ceil(rows.length/pageSize)),currentPage=Math.min(page,pages-1)
  const visible=rows.slice(currentPage*pageSize,(currentPage+1)*pageSize)
  const filter=(setter,value)=>{setter(value);setPage(0)}
  return <section className="mm-panel report-history" aria-label="ข้อมูลและประวัติการอัปโหลด">
    <header className="report-history-heading"><div><h2><History size={21}/>ข้อมูลและประวัติ</h2><p>เช็กเดือนที่มีข้อมูลแล้วก่อนอัปโหลด · เวลาแสดงตามประเทศไทย</p></div><button onClick={source.refresh} disabled={source.loading}><RotateCcw size={15}/>โหลดประวัติใหม่</button></header>
    <div className="report-history-filters">
      <label>ธุรกิจ<select value={business} onChange={event=>filter(setBusiness,event.target.value)}><option value={ALL}>ทุกธุรกิจ</option>{['Payi','Payi Outlet','กรอบรูป'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>แพลตฟอร์ม<select value={platform} onChange={event=>filter(setPlatform,event.target.value)}><option value={ALL}>ทุกแพลตฟอร์ม</option>{['Shopee','TikTok Shop','Lazada'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>เดือนข้อมูล<select value={month} onChange={event=>filter(setMonth,event.target.value)}><option value={ALL}>ทุกเดือนที่มีข้อมูล</option>{months.map(value=><option key={value} value={value}>{monthLabel(value)}</option>)}</select></label>
    </div>
    <nav className="mm-view-tabs" aria-label="ดูข้อมูลและประวัติ"><button aria-pressed={view==='available'} onClick={()=>filter(setView,'available')}><FolderCheck size={16}/>ข้อมูลที่มีแล้ว ({available.length} ชุด)</button><button aria-pressed={view==='history'} onClick={()=>filter(setView,'history')}>ประวัติการบันทึก{source.data?` (${events.length} ครั้ง)`:''}</button></nav>
    <p className="mm-note">{view==='available'?'แสดงชุดล่าสุดที่บันทึกแล้วของแต่ละธุรกิจ / ร้าน / แพลตฟอร์ม / เดือน ไฟล์ที่เปิดดูชั่วคราวจะไม่รวมในรายการนี้':'แสดงทุกรอบที่บันทึกสำเร็จ รวมชุดเก่าที่ถูกแทนที่แล้ว ชุดที่เปิดตรวจแต่ยังไม่บันทึกหรือบันทึกไม่สำเร็จจะไม่อยู่ในประวัติ'}</p>
    {source.error&&<p className="mm-feedback mm-error" role="alert">โหลดประวัติไม่ได้: {source.error} <button onClick={source.refresh}>ลองอีกครั้ง</button></p>}
    {view==='history'&&source.loading?<p role="status">กำลังโหลดประวัติการบันทึก…</p>:view==='history'&&source.error?null:!rows.length?<div className="report-history-empty"><FolderCheck size={30}/><h3>{view==='history'?'ยังไม่มีประวัติการบันทึกในขอบเขตนี้':'ยังไม่มีรายงานที่บันทึกในขอบเขตนี้'}</h3><p>ลองเลือกทุกธุรกิจ ทุกแพลตฟอร์ม และทุกเดือน หรืออัปโหลดรายงานแล้วกดบันทึก</p></div>:<>
      <div className="mm-table-wrap"><table><thead><tr><th>เดือน / ช่วงข้อมูล</th><th>ธุรกิจ / ร้าน</th><th>แพลตฟอร์ม / รายละเอียด</th><th>ค่าแอด</th><th>{view==='available'?'บันทึกล่าสุด':'เวลาบันทึก'}</th><th>{view==='available'?'ดูรายงาน':'รายการบันทึก / สถานะ'}</th></tr></thead><tbody>{visible.map(row=><tr key={row.eventId||JSON.stringify([row.platform,row.business,row.shopId,row.month])}>
        <td><strong>{monthLabel(row.month)}</strong><small>{period(row)}</small></td>
        <td><strong>{row.business} · {row.shopName||row.shopId}</strong><small>รหัสร้าน {row.shopId}</small></td>
        <td><strong>{row.platform}</strong><small>{row.productCount} สินค้า · {coverage(row)}</small><details><summary>ไฟล์ที่บันทึก ({row.files.length})</summary>{row.files.map((name,index)=><p key={`${index}:${name}`}>{name}</p>)}</details></td>
        <td>{money(row.spend)}</td><td>{dateLabel(row.savedAt)}<small>โดย {row.savedBy||'ไม่ระบุผู้บันทึก'}</small></td>
        <td>{view==='available'?<button onClick={()=>onOpen(row)}>เปิดรายงาน</button>:<><span>{row.action==='created'?'บันทึกครั้งแรก':row.action==='repeated'?'บันทึกชุดเดิมซ้ำ':'บันทึกแทนชุดก่อน'}</span><small className={`report-history-status ${row.current?'is-current':''}`}>{row.current?'ใช้งานอยู่':'ถูกแทนที่แล้ว'}</small></>}</td>
      </tr>)}</tbody></table></div>
      <footer className="report-history-pagination"><span>{currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,rows.length)} จาก {rows.length} {view==='available'?'ชุด':'ครั้ง'}</span><label>แสดง<select aria-label="จำนวนรายการประวัติต่อหน้า" value={size} onChange={event=>filter(setSize,event.target.value)}><option value="20">20 รายการ</option><option value="all">ทั้งหมด</option></select></label><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>ก่อนหน้า</button><span>{currentPage+1} / {pages}</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>ถัดไป</button></footer>
    </>}
    <p className="mm-note">การบันทึกชุดใหม่ของร้านและเดือนเดิมแทนชุดที่ใช้คำนวณ ประวัติเก่ายังอยู่ แต่ยอดจะนับเฉพาะชุดล่าสุด</p>
  </section>
}
