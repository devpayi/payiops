import {readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import process from 'node:process'
import {requireManager,authEnabled} from './auth.js'
import {getSheet} from './sheets.js'
import {reportScope} from '../../shared/marketingReadModels.js'
import {reportStoreConfigured,readStoredReports,readStoredReportHistory} from './marketingReportStore.js'

// Local review data never enters the client bundle, public directory, or Sheets.
export async function readLocalMonthlyReports(directory=process.env.MARKETING_REPORTS_LOCAL_DIR) {
  if(!directory || process.env.VERCEL || process.env.NODE_ENV==='production')return []
  const root=resolve(directory)
  let manifest
  try {manifest=JSON.parse(await readFile(join(root,'active.json'),'utf8'))}
  catch(error) {if(error.code==='ENOENT')return [];throw error}
  if(manifest.version!==1 || !Array.isArray(manifest.entries))throw Error('รูปแบบชุดรายงานในเครื่องไม่ถูกต้อง')
  const reports=await Promise.all(manifest.entries.map(async entry=>{
    if(!/^report-[a-f0-9]{64}\.json$/.test(entry.file || '') || !/^[a-f0-9]{64}$/.test(entry.sha256 || ''))throw Error('ชื่อไฟล์รายงานไม่ถูกต้อง')
    const raw=await readFile(join(root,entry.file),'utf8')
    if(createHash('sha256').update(raw).digest('hex')!==entry.sha256)throw Error('ไฟล์รายงานเปลี่ยนจากชุดที่ตรวจไว้')
    const report=JSON.parse(raw)
    if(report.schemaVersion!==1 || report.synthetic || report.status!=='reconciled' || !report.fingerprints?.length)throw Error('รายงานในเครื่องยังไม่ผ่านการตรวจยอด')
    return report
  }))
  const keys=reports.map(reportScope)
  if(new Set(keys).size!==keys.length)throw Error('มีรายงานเดือนและร้านเดียวกันซ้ำในชุดที่เปิดใช้')
  return reports
}

export const reportsAvailable=()=>reportStoreConfigured()||(Boolean(process.env.MARKETING_REPORTS_LOCAL_DIR) && !(process.env.VERCEL || process.env.NODE_ENV==='production'))
const readConfiguredReports=()=>reportStoreConfigured()?readStoredReports():readLocalMonthlyReports()
const readConfiguredHistory=()=>reportStoreConfigured()?readStoredReportHistory():[]

export function createMarketingMonthlyRead({authorize=requireManager,available=reportsAvailable,persistent=reportStoreConfigured,readReports=readConfiguredReports,readHistory=readConfiguredHistory,readInputs=()=>getSheet('marketing_inputs'),production=()=>Boolean(process.env.VERCEL || process.env.NODE_ENV==='production'),hasAuth=authEnabled}={}) {
  return async function handler(req,res) {
    if(production() && !hasAuth())return res.status(503).json({success:false,error:'ต้องตั้งค่าการเข้าสู่ระบบก่อนเปิดรายงานส่วนตัว'})
    if(!authorize(req,res))return
    res.setHeader('Cache-Control','no-store')
    if(req.method!=='GET')return res.status(405).json({success:false,error:'รายงานนี้เปิดให้อ่านอย่างเดียว'})
    try {
      if(req.query.kind==='report-history')return res.status(200).json({success:true,history:await readHistory()})
      if(req.query.kind==='monthly-reports')return res.status(200).json({success:true,reports:await readReports(),storage:persistent()?'private-sheets':'local-read-only',available:Boolean(available()),writeAvailable:Boolean(persistent()&&hasAuth())})
      // Deliberately no ensureSheet, append, update, or migration on GET.
      const source=await readInputs()
      const inputs=source.map(row=>({month:String(row.month || '').slice(0,7),business:String(row.business || '').trim(),platform:String(row.platform || '').trim(),metric:String(row.metric || '').trim(),value:row.value})).filter(r=>r.month && r.metric)
      return res.status(200).json({success:true,inputs,months:[...new Set(inputs.map(r=>r.month))].sort()})
    } catch(error) {
      return res.status(500).json({success:false,error:error.message || 'อ่านรายงานไม่สำเร็จ'})
    }
  }
}
export default createMarketingMonthlyRead()
