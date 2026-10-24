// Dry-run by default. Publishing requires the explicitly approved private store.
import {readFile} from 'node:fs/promises'
import {basename,resolve} from 'node:path'
import process from 'node:process'
import {randomUUID} from 'node:crypto'
import {loadEnv} from 'vite'
import {buildReportImport} from '../api/_lib/marketingReportImport.js'
import {appendStoredReport,reportStoreConfigured,readStoredReportState} from '../api/_lib/marketingReportStore.js'
import {reportScope} from '../shared/marketingReadModels.js'
import {compareReportReplacement} from '../shared/reportReplacement.js'

const args=process.argv.slice(2)
const publish=args.includes('--publish')
const option=name=>args[args.indexOf(name)+1]
if(!args.includes('--platform')||!args.includes('--business')||!args.includes('--file'))throw Error('ระบุ --platform Shopee หรือ "TikTok Shop" หรือ Lazada --business Payi --file <ไฟล์> [--file <รายละเอียด>] [--publish]')
const paths=args.flatMap((value,index)=>value==='--file'?[args[index+1]]:[])
if(paths.some(path=>!path||path.startsWith('--')))throw Error('ไม่พบชื่อไฟล์ต้นทาง')
const files=await Promise.all(paths.map(async path=>({name:basename(path),text:await readFile(resolve(path),'utf8')})))
const record=buildReportImport({platform:option('--platform'),business:option('--business'),files})
console.log(JSON.stringify({dryRun:!publish,platform:record.report.platform,month:record.report.month,shopId:record.report.shopId,status:record.report.status,spend:record.report.spend,campaigns:record.report.campaigns.length,products:record.report.products.length}))
if(publish) {
  // Never print credentials or source file contents.
  const env=loadEnv('production',process.cwd(),'')
  for(const key of ['MARKETING_REPORTS_SHEET_ID','MARKETING_REPORTS_STORE_APPROVED','SHEET_ID','ARCHIVE_SHEET_ID','HR_SHEET_ID','PRICING_SHEET_ID','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY'])if(process.env[key]===undefined&&env[key]!==undefined)process.env[key]=env[key]
  if(!reportStoreConfigured())throw Error('ยังไม่มีที่เก็บรายงานที่อนุมัติ ห้ามเผยแพร่ไปชีตเดิม')
  try {
    const state=await readStoredReportState(),scope=reportScope(record.report),head=state.heads.get(scope)
    const previous=head?.active?state.versions.get(head.eventId).resolved:null
    if(compareReportReplacement(previous,record).warnings.length)throw Error('รายละเอียดลดลง กรุณาตรวจและยืนยันผ่านหน้าเว็บ')
    const id=randomUUID(),guarded={...record,version:2,mutation:{id,action:'import',expectedEventId:head?.eventId||null}}
    const result=await appendStoredReport(guarded,'dev:verified-file-import')
    if(!(await readStoredReportState()).receipts.get(id)?.accepted)throw Error('รายงานเปลี่ยนก่อนบันทึก')
    console.log(JSON.stringify({saved:true,revisionId:result.revisionId}))
  } catch(error) {
    // API error objects may contain credentials or complete request payloads.
    console.error(JSON.stringify({saved:'unconfirmed',status:error.response?.status || null,error:'ยืนยันผลบันทึกไม่ได้ ต้องอ่านรายงานกลับมาตรวจก่อนลองใหม่'}))
    process.exitCode=1
  }
}
