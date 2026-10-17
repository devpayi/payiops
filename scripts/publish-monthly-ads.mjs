// Dry-run by default. Publishing requires the explicitly approved private store.
import {readFile} from 'node:fs/promises'
import {basename,resolve} from 'node:path'
import process from 'node:process'
import {loadEnv} from 'vite'
import {buildReportImport} from '../api/_lib/marketingReportImport.js'
import {appendStoredReport,reportStoreConfigured} from '../api/_lib/marketingReportStore.js'

const args=process.argv.slice(2)
const publish=args.includes('--publish')
const option=name=>args[args.indexOf(name)+1]
if(!args.includes('--platform')||!args.includes('--business')||!args.includes('--file'))throw Error('ระบุ --platform Shopee หรือ "TikTok Shop" --business Payi --file <ไฟล์> [--file <รายละเอียด>] [--publish]')
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
    const result=await appendStoredReport(record,'dev:verified-file-import')
    console.log(JSON.stringify({saved:true,revisionId:result.revisionId}))
  } catch(error) {
    // API error objects may contain credentials or complete request payloads.
    console.error(JSON.stringify({saved:'unconfirmed',status:error.response?.status || null,error:'ยืนยันผลบันทึกไม่ได้ ต้องอ่านรายงานกลับมาตรวจก่อนลองใหม่'}))
    process.exitCode=1
  }
}
