import {createHash} from 'node:crypto'
import {Buffer} from 'node:buffer'
import {parseShopeeMonthlyReport,buildShopeeMonthlyReport} from '../../shared/monthlyAdsReports.js'
import {buildTikTokMonthlyReport} from '../../shared/tiktokAdsReport.js'
import {buildLazadaMonthlyReport} from '../../shared/lazadaAdsReport.js'
import {requireManager,authEnabled} from './auth.js'
import {reportStoreConfigured,appendStoredReport} from './marketingReportStore.js'

export function buildReportImport(body) {
  if(!body||!Array.isArray(body.files)||body.files.length<1||body.files.length>2)throw Error('เลือกรายงานหนึ่งหรือสองไฟล์')
  if(Buffer.byteLength(JSON.stringify(body),'utf8')>2_000_000)throw Error('ไฟล์รายงานรวมกันต้องไม่เกิน 2 MB')
  const files=body.files.map(file=>{
    if(typeof file.text!=='string'||typeof file.name!=='string'||file.name.length>255)throw Error('รูปแบบไฟล์รายงานไม่ถูกต้อง')
    return {name:file.name,text:file.text,sha256:createHash('sha256').update(file.text).digest('hex')}
  })
  let report
  if(body.platform==='Shopee') {
    const parsed=files.map(file=>({...parseShopeeMonthlyReport(file.text,{filename:file.name}),fingerprint:file.sha256}))
    const overview=parsed.filter(item=>item.kind==='overview'),detail=parsed.filter(item=>item.kind==='group-detail')
    if(overview.length!==1||detail.length>1)throw Error('เลือกไฟล์ภาพรวมหนึ่งไฟล์และรายละเอียดกลุ่มได้อีกหนึ่งไฟล์')
    report={...buildShopeeMonthlyReport(overview[0],detail[0],{business:body.business}),platform:'Shopee',fingerprints:parsed.map(item=>`${item.kind}:${item.fingerprint}`).sort()}
  } else if(body.platform==='TikTok Shop') {
    if(files.length!==1)throw Error('เลือกรายงาน TikTok JSON หนึ่งไฟล์')
    report={...buildTikTokMonthlyReport(JSON.parse(files[0].text.replace(/^\uFEFF/,'')),{business:body.business}),fingerprints:[`seller-center-dashboard:${files[0].sha256}`]}
  } else if(body.platform==='Lazada') {
    if(files.length!==1)throw Error('เลือกรายงาน Lazada JSON หนึ่งไฟล์')
    report={...buildLazadaMonthlyReport(JSON.parse(files[0].text.replace(/^\uFEFF/,'')),{business:body.business}),fingerprints:[`lazada-export-bundle:${files[0].sha256}`]}
  } else throw Error('ยังไม่รองรับรายงานแพลตฟอร์มนี้')
  if(report.status!=='reconciled')throw Error(`ยอดรายงานยังไม่ตรง: ${report.issues.join(' · ')}`)
  return {version:1,report,sourceFiles:files}
}

export function createReportImport({authorize=requireManager,configured=reportStoreConfigured,append=appendStoredReport,hasAuth=authEnabled}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    if(!hasAuth())return res.status(503).json({success:false,error:'ต้องเปิดการเข้าสู่ระบบก่อนบันทึกรายงาน'})
    if(!authorize(req,res))return
    if(req.method!=='POST')return res.status(405).json({success:false,error:'ใช้ POST เพื่อบันทึกรายงาน'})
    if(!configured())return res.status(409).json({success:false,error:'ยังไม่ได้ตั้งค่าที่เก็บรายงานส่วนตัว'})
    let record
    try {record=buildReportImport(typeof req.body==='string'?JSON.parse(req.body):req.body)}
    catch(error){return res.status(400).json({success:false,error:error.message})}
    try {
      const saved=await append(record,req.user?.username || req.user?.role || '')
      return res.status(200).json({success:true,...saved,report:record.report})
    } catch {return res.status(503).json({success:false,error:'ยังยืนยันผลบันทึกไม่ได้ กรุณาโหลดรายงานใหม่ก่อนลองอีกครั้ง'})}
  }
}
export default createReportImport()
