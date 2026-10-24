import {createHash} from 'node:crypto'
import {Buffer} from 'node:buffer'
import {reportScope} from '../../shared/marketingReadModels.js'

export const REPORT_HEADERS=['kind','revision_id','scope','part','parts','sha256','created_at','created_by','payload']
export const reportRecordHash=record=>createHash('sha256').update(JSON.stringify(record)).digest('hex')
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const hash=text=>createHash('sha256').update(text).digest('hex')
export function encodeReportRevision(record,{by,now=new Date().toISOString()}={}) {
  const json=JSON.stringify(record)
  if(Buffer.byteLength(json,'utf8')>2_000_000)throw Error('รายงานมีขนาดเกิน 2 MB')
  const digest=hash(json),scope=reportScope(record.report)
  const parts=[]
  // Keep every cell below Sheets' character limit, including Thai text.
  for(let start=0;start<json.length;) {
    let end=Math.min(start+30000,json.length)
    if(end<json.length&&/[\uD800-\uDBFF]/.test(json[end-1]))end--
    parts.push(json.slice(start,end));start=end
  }
  return [...parts.map((part,index)=>['chunk',digest,scope,String(index),String(parts.length),digest,now,String(by || ''),part]),['commit',digest,scope,'',String(parts.length),digest,now,String(by || ''),'']]
}

function committedRecords(rows) {
  if(!rows.length)return []
  if(REPORT_HEADERS.some((header,index)=>rows[0][index]!==header))throw Error('หัวตารางที่เก็บรายงานไม่ตรงรูปแบบ')
  const records=[]
  let pending=[]
  for(const row of rows.slice(1)) {
    if(row.every(value=>!String(value??'').trim()))continue
    if(row[0]==='chunk') {
      if(Number(row[3])!==pending.length)throw Error('ส่วนประกอบรายงานไม่ครบหรือไม่เรียงลำดับ')
      if(pending.length&&[1,2,4,5].some(index=>row[index]!==pending[0][index]))throw Error('ส่วนประกอบรายงานปะปนกัน')
      pending.push(row);continue
    }
    if(row[0]!=='commit'||!pending.length||Number(row[4])!==pending.length||[1,2,4,5].some(index=>row[index]!==pending[0][index]))throw Error('รายงานยังไม่มีรายการยืนยันที่สมบูรณ์')
    const json=pending.map(part=>part[8]||'').join('')
    if(hash(json)!==row[5]||row[1]!==row[5])throw Error('ข้อมูลรายงานเปลี่ยนจากชุดที่ยืนยันไว้')
    const record=JSON.parse(json)
    if(!record.report||reportScope(record.report)!==row[2])throw Error('ขอบเขตรายงานไม่ถูกต้อง')
    records.push({record,revisionId:row[1],eventId:`${row[1]}:${records.length}`,scope:row[2],savedAt:row[6]||null,savedBy:row[7]||null})
    pending=[]
  }
  if(pending.length)throw Error('รายงานมีส่วนประกอบที่ยังไม่ยืนยันครบ')
  return records
}

// Atomic appends establish one order. Replay checks the expected head in that
// order, including cancelled heads, so concurrent/stale writes cannot win.
export function decodeReportState(rows) {
  const heads=new Map(),versions=new Map(),receipts=new Map(),history=[]
  for(const entry of committedRecords(rows)) {
    const {record,scope,eventId,revisionId}=entry,mutation=record.mutation,previous=heads.get(scope)
    let resolved=record,accepted,action
    if(record.version===2) {
      if(!mutation||!uuid(mutation.id)||!['import','restore','cancel'].includes(mutation.action)||!(mutation.expectedEventId===null||typeof mutation.expectedEventId==='string'))throw Error('รูปแบบการเปลี่ยนรายงานไม่ถูกต้อง')
      const prior=receipts.get(mutation.id),payload=JSON.stringify(record)
      if(prior?.payload===payload)continue
      accepted=!prior&&(previous?.eventId||null)===mutation.expectedEventId
      if(mutation.action!=='import') {
        const target=versions.get(mutation.targetEventId)
        if(!target?.accepted||target.scope!==scope||target.action==='cancelled')throw Error('ไม่พบชุดรายงานต้นฉบับในขอบเขตนี้')
        resolved=target.resolved
        if(mutation.action==='cancel'&&previous?.eventId!==target.eventId)accepted=false
      }
      action=mutation.action==='cancel'?'cancelled':mutation.action==='restore'?'restored':previous?.active?'replaced':'created'
      if(!prior)receipts.set(mutation.id,{id:mutation.id,payload,eventId,accepted})
    } else {
      // An old writer cannot overwrite a scope after guarded writes begin.
      accepted=!previous?.guarded
      action=!previous?'created':previous.revisionId===revisionId?'repeated':'replaced'
    }
    if(resolved.report?.status!=='reconciled'||resolved.report.synthetic)throw Error('สถานะรายงานไม่ถูกต้อง')
    const report=resolved.report
    const event={eventId,revisionId,scope,savedAt:entry.savedAt,savedBy:entry.savedBy,
      business:report.business,platform:report.platform||'Shopee',shopId:report.shopId,shopName:report.shopName||report.shopId,
      month:report.month,dateFrom:report.dateFrom,dateTo:report.dateTo,spend:report.spend,sales:report.sales??null,orders:report.orders??null,productCount:report.products?.length||0,
      productCoverage:report.coverage?.productDetail||'unknown',files:(resolved.sourceFiles||[]).map(file=>file.name),
      action:accepted?action:'conflict',accepted,current:false,latest:false,guarded:record.version===2,active:action!=='cancelled',
      ...(accepted&&action==='cancelled'?{restoreTargetEventId:mutation.targetEventId}:{})}
    if(accepted){
      if(previous){previous.current=false;previous.latest=false}
      event.current=event.active;event.latest=true;heads.set(scope,event)
    }
    versions.set(eventId,{...entry,resolved,accepted,action:event.action})
    history.push(event)
  }
  const records=[...heads.values()].filter(head=>head.active).map(head=>{
    const version=versions.get(head.eventId)
    return {...version.resolved,eventId:head.eventId,revisionId:head.revisionId,savedAt:head.savedAt,savedBy:head.savedBy}
  })
  return {records,heads,versions,receipts,history:history.reverse()}
}

export function decodeReportRevisions(rows,{history=false}={}) {
  const state=decodeReportState(rows)
  return history?state.history:state.records
}
