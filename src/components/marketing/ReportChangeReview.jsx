import {useEffect,useRef,useState} from 'react'
import './ReportChangeReview.css'

const titles={import:'ตรวจชุดเดิมและชุดใหม่ก่อนบันทึก',restore:'ตรวจรายงานที่จะย้อนกลับมาใช้',cancel:'ยกเลิกการใช้งานรายงาน'}
const date=value=>value?.split('-').reverse().join('/')||'—'
const value=(amount,type)=>amount===null?'ไม่มีข้อมูล':Number(amount).toLocaleString('th-TH',type==='money'?{style:'currency',currency:'THB'}:{maximumFractionDigits:0})

export default function ReportChangeReview({payload,onSaved,onClose,onBusyChange,modal=false}) {
  const [request,setRequest]=useState(()=>({...payload,requestId:crypto.randomUUID()}))
  const [review,setReview]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[uncertain,setUncertain]=useState(false),[ack,setAck]=useState(false)
  const dialog=useRef(null)
  useEffect(()=>{
    if(!modal)return
    const previous=document.activeElement,element=dialog.current
    element.showModal()
    return ()=>{element.close();if(previous?.isConnected)previous.focus()}
  },[modal])
  useEffect(()=>{
    const controller=new AbortController()
    fetch('/api/marketing?kind=review-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}).then(async response=>{
      const result=await response.json()
      if(!response.ok||!result.success)throw Error(result.error||'โหลดชุดล่าสุดเพื่อตรวจเทียบไม่ได้')
      if(!controller.signal.aborted)setReview(result.review)
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[request])
  function refresh(){setLoading(true);setReview(null);setError('');setAck(false);setConflict(false);setUncertain(false);setRequest(previous=>({...previous,requestId:crypto.randomUUID()}))}
  async function save() {
    setBusy(true);onBusyChange?.(true);setError('')
    try {
      const response=await fetch(`/api/marketing?kind=${request.action==='import'?'save-report':'report-action'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,expectedEventId:review.expectedEventId,reviewHash:review.hash,confirmed:true,acknowledgeReduction:ack})})
      const result=await response.json()
      if(!response.ok||!result.success){setConflict(response.status===409);throw Object.assign(Error(result.error||'ยังยืนยันผลบันทึกไม่ได้'),{definitive:response.status<500})}
      onSaved(result)
    } catch(error){setError(error.message);if(!error.definitive)setUncertain(true)}
    finally {setBusy(false);onBusyChange?.(false)}
  }
  const context=review?.context,action=request.action||'import'
  const content=<section className="report-change-review" aria-label="ตรวจเทียบก่อนเปลี่ยนรายงาน" aria-busy={loading||busy}>
    <h2>{titles[action]}</h2>
    {loading?<p role="status">กำลังอ่านชุดล่าสุดจากระบบเพื่อเทียบก่อนยืนยัน…</p>:review&&<>
      <p className="report-change-context"><strong>{context.business} · {context.platform} · {context.shopName}</strong><br/>รหัสร้าน {context.shopId} · ช่วงข้อมูล {date(context.dateFrom)} – {date(context.dateTo)}</p>
      <p>{action==='cancel'?'ชุดนี้จะออกจากยอดที่คำนวณ ไฟล์และประวัติยังอยู่ และคืนกลับมาใช้ได้จากประวัติ':review.before?'เมื่อยืนยัน จะใช้ชุดด้านขวาแทนทั้งชุดเดิม ประวัติเดิมยังอยู่และย้อนกลับได้':'ยังไม่มีชุดที่ใช้งานในร้านและเดือนนี้ เมื่อยืนยันจะใช้ชุดด้านขวา'}</p>
      {review.identical&&<p className="mm-feedback" role="status">ไฟล์ชุดนี้ตรงกับชุดที่ใช้งานอยู่แล้ว ไม่ต้องบันทึกซ้ำ</p>}
      <div className="mm-table-wrap"><table><thead><tr><th>รายการ</th><th>ชุดที่ใช้อยู่</th><th>{action==='cancel'?'หลังยกเลิก':action==='restore'?'ชุดที่จะคืนกลับ':'ชุดใหม่'}</th><th>เปลี่ยนแปลง</th></tr></thead><tbody>{review.metrics.map(metric=><tr key={metric.key}><td>{metric.label}</td><td>{value(metric.before,metric.type)}</td><td>{action==='cancel'?'ไม่นำมาคำนวณ':value(metric.after,metric.type)}</td><td>{metric.difference===null?'—':`${Number(metric.difference)>0?'+':''}${value(metric.difference,metric.type)}`}</td></tr>)}</tbody></table></div>
      <div className="report-change-files">{[['ไฟล์ชุดที่ใช้อยู่',review.before],['ไฟล์ชุดที่จะใช้',review.after]].map(([label,summary])=>summary&&<details key={label}><summary>{label} ({summary.files.length})</summary>{summary.files.map((name,index)=><p key={index}>{name}</p>)}</details>)}</div>
      {!!review.warnings.length&&<div className="report-change-warning" role="status"><strong>รายละเอียดบางส่วนจะหายจากชุดที่ใช้คำนวณ</strong><ul>{review.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul><label><input type="checkbox" checked={ack} disabled={busy||uncertain} onChange={event=>setAck(event.target.checked)}/>ฉันตรวจแล้วและต้องการใช้ชุดนี้ แม้รายละเอียดบางส่วนลดลง</label></div>}
    </>}
    {error&&<p className="mm-feedback mm-error" role="alert">{error}</p>}
    {uncertain&&<p className="mm-note">คำขอก่อนหน้าอาจบันทึกสำเร็จแล้ว ปุ่มด้านล่างจะตรวจ/ส่งคำขอเดิมซ้ำโดยไม่บันทึกเพิ่ม อย่าเริ่มคำขอใหม่จนกว่าจะทราบผล</p>}
    <div className="report-change-buttons">
      {conflict||(!loading&&!review)?<button className="mm-primary" disabled={busy} onClick={refresh}>โหลดชุดล่าสุดและตรวจเทียบใหม่</button>:review&&!review.identical&&<button className={action==='cancel'?'report-change-cancel':'mm-primary'} disabled={loading||busy||(!ack&&review.warnings.length>0)} onClick={save}>{busy?'กำลังยืนยันผล…':uncertain?'ตรวจผลด้วยคำขอเดิม':action==='cancel'?'ยืนยันยกเลิกการใช้งาน':action==='restore'?'ยืนยันคืนรายงานชุดนี้':review.before?'ยืนยันแทนที่ชุดเดิม':'บันทึกชุดนี้'}</button>}
      <button disabled={busy} onClick={onClose}>{uncertain?'ปิดและตรวจประวัติ':'ยังไม่เปลี่ยนข้อมูล'}</button>
    </div>
  </section>
  return modal?<dialog ref={dialog} aria-label={titles[action]} className="report-change-dialog" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>{content}</dialog>:content
}
