import {createHash} from 'node:crypto'
import {Buffer} from 'node:buffer'
import {reportScope} from '../../shared/marketingReadModels.js'

export const REPORT_HEADERS=['kind','revision_id','scope','part','parts','sha256','created_at','created_by','payload']
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

export function decodeReportRevisions(rows) {
  if(!rows.length)return []
  if(REPORT_HEADERS.some((header,index)=>rows[0][index]!==header))throw Error('หัวตารางที่เก็บรายงานไม่ตรงรูปแบบ')
  const latest=new Map()
  let pending=[]
  for(const row of rows.slice(1)) {
    if(row.every(value=>!String(value ?? '').trim()))continue
    if(row[0]==='chunk') {
      if(Number(row[3])!==pending.length)throw Error('ส่วนประกอบรายงานไม่ครบหรือไม่เรียงลำดับ')
      if(pending.length&&[1,2,4,5].some(index=>row[index]!==pending[0][index]))throw Error('ส่วนประกอบรายงานปะปนกัน')
      pending.push(row);continue
    }
    if(row[0]!=='commit'||!pending.length||Number(row[4])!==pending.length||[1,2,4,5].some(index=>row[index]!==pending[0][index]))throw Error('รายงานยังไม่มีรายการยืนยันที่สมบูรณ์')
    const json=pending.map(part=>part[8] || '').join('')
    if(hash(json)!==row[5]||row[1]!==row[5])throw Error('ข้อมูลรายงานเปลี่ยนจากชุดที่ยืนยันไว้')
    const record=JSON.parse(json)
    if(record.report?.status!=='reconciled'||record.report.synthetic||reportScope(record.report)!==row[2])throw Error('ขอบเขตหรือสถานะรายงานไม่ถูกต้อง')
    latest.set(row[2],{...record,revisionId:row[1],savedAt:row[6],savedBy:row[7]})
    pending=[]
  }
  if(pending.length)throw Error('รายงานมีส่วนประกอบที่ยังไม่ยืนยันครบ')
  return [...latest.values()]
}
