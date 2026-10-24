import {Buffer} from 'node:buffer'
import {requireManager,authEnabled} from './auth.js'
import {reportStoreConfigured,readStoredReportState,appendStoredReport} from './marketingReportStore.js'
import {reportRecordHash} from './marketingReportRevisions.js'
import {reportScope} from '../../shared/marketingReadModels.js'
import {compareReportReplacement} from '../../shared/reportReplacement.js'
import {buildReportImport} from './marketingReportImport.js'

const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const conflict=()=>Object.assign(Error('รายงานชุดนี้มีการเปลี่ยนแปลงแล้ว กรุณาโหลดและตรวจเทียบใหม่ก่อนยืนยัน ข้อมูลล่าสุดไม่ถูกเขียนทับ'),{status:409})
function prepare(body,state,reviewing) {
  if(!body||Buffer.byteLength(JSON.stringify(body),'utf8')>2_000_000||!uuid(body.requestId))throw Error('กรุณารีเฟรชหน้าเว็บ แล้วเปิดไฟล์เพื่อตรวจเทียบก่อนบันทึก')
  const action=body.action||'import'
  let source,record
  if(action==='import'){source=buildReportImport(body);record={...source,version:2}}
  else if(['restore','cancel'].includes(action)) {
    const target=state.versions.get(body.targetEventId)
    if(!target?.accepted||target.action==='cancelled')throw Error('ไม่พบรายงานต้นฉบับที่ใช้คืนกลับได้')
    source={...target.resolved,savedAt:target.savedAt,savedBy:target.savedBy}
    const {platform,business,shopId,shopName,month,dateFrom,dateTo}=source.report
    record={version:2,report:{platform:platform||'Shopee',business,shopId,shopName,month,dateFrom,dateTo}}
  } else throw Error('ไม่รองรับรายการนี้')
  const scope=reportScope(source.report),head=state.heads.get(scope),expected=reviewing?head?.eventId||null:body.expectedEventId
  if(!(expected===null||typeof expected==='string'))throw Error('ต้องตรวจเทียบกับชุดล่าสุดก่อนบันทึก')
  if(reviewing&&action==='cancel'&&(!head?.active||head.eventId!==body.targetEventId))throw conflict()
  if(reviewing&&action==='restore'&&head?.active&&head.eventId===body.targetEventId)throw Error('ชุดนี้กำลังใช้งานอยู่แล้ว')
  record.mutation={id:body.requestId,action,expectedEventId:expected,...(action==='import'?{}:{targetEventId:body.targetEventId})}
  const previous=head?.active?{...state.versions.get(head.eventId).resolved,savedAt:head.savedAt,savedBy:head.savedBy}:null
  const comparison=compareReportReplacement(previous,action==='cancel'?null:source)
  const identical=action==='import'&&previous?.report.fingerprints?.length>0&&JSON.stringify(previous.report.fingerprints)===JSON.stringify(source.report.fingerprints)
  return {record,scope,comparison,review:{...comparison,identical:Boolean(identical),action,requestId:body.requestId,expectedEventId:expected,hash:reportRecordHash(record),context:comparison.after||comparison.before}}
}

// Both preview and write use source data from the server. A commit is accepted
// only after journal replay confirms the expected head, even for concurrent appends.
export function createReportActions({authorize=requireManager,hasAuth=authEnabled,configured=reportStoreConfigured,readState=readStoredReportState,append=appendStoredReport}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    if(!hasAuth())return res.status(503).json({success:false,error:'ต้องเข้าสู่ระบบก่อนเปลี่ยนรายงาน'})
    if(!authorize(req,res))return
    if(req.method!=='POST')return res.status(405).json({success:false,error:'ใช้ POST เพื่อตรวจหรือเปลี่ยนรายงาน'})
    if(!configured())return res.status(409).json({success:false,error:'ยังไม่มีที่เก็บรายงานที่อนุมัติ'})
    try {
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body,reviewing=req.query?.kind==='review-report'
      const state=await readState()
      let prepared
      try{prepared=prepare(body,state,reviewing)}catch(error){return res.status(error.status||400).json({success:false,error:error.message})}
      const {record,scope,review}=prepared
      if(reviewing)return res.status(200).json({success:true,review})
      const prior=state.receipts.get(body.requestId)
      if(prior) {
        if(prior.payload!==JSON.stringify(record)||!prior.accepted)throw conflict()
        return res.status(200).json({success:true,alreadyApplied:true,action:record.mutation.action,current:state.heads.get(scope)?.eventId===prior.eventId})
      }
      if((state.heads.get(scope)?.eventId||null)!==record.mutation.expectedEventId)throw conflict()
      if(record.mutation.action==='cancel'&&(!state.heads.get(scope)?.active||state.heads.get(scope)?.eventId!==body.targetEventId))throw conflict()
      if(body.reviewHash!==review.hash||body.confirmed!==true)return res.status(400).json({success:false,error:'ตรวจชุดเดิมและชุดใหม่ แล้วกดยืนยันก่อนบันทึก'})
      if(review.identical)return res.status(200).json({success:true,alreadyApplied:true,action:'import',current:true})
      if(review.warnings.length&&body.acknowledgeReduction!==true)return res.status(400).json({success:false,error:'ชุดใหม่มีรายละเอียดลดลง กรุณาตรวจคำเตือนและยืนยันก่อนบันทึก'})
      await append(record,req.user?.username||req.user?.role||'')
      const confirmed=await readState(),receipt=confirmed.receipts.get(body.requestId)
      if(!receipt)return res.status(503).json({success:false,error:'ยังยืนยันผลบันทึกไม่ได้ กดตรวจสถานะอีกครั้งด้วยคำขอเดิมก่อนเริ่มชุดใหม่'})
      if(!receipt.accepted||receipt.payload!==JSON.stringify(record))throw conflict()
      return res.status(200).json({success:true,action:record.mutation.action,current:confirmed.heads.get(scope)?.eventId===receipt.eventId})
    } catch(error){return res.status(error.status||503).json({success:false,error:error.status?error.message:'ยังยืนยันผลบันทึกไม่ได้ กรุณาตรวจสถานะด้วยคำขอเดิมหรือโหลดข้อมูลล่าสุด'})}
  }
}
export default createReportActions()
