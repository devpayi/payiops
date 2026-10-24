import {google} from 'googleapis'
import process from 'node:process'
import {pricingSheetId} from './pricingStore.js'
import {REPORT_HEADERS,decodeReportRevisions,decodeReportState,encodeReportRevision} from './marketingReportRevisions.js'

const TAB='report_revisions'
let client
export function reportStoreConfigured(env=process.env) {
  const id=String(env.MARKETING_REPORTS_SHEET_ID || '').trim()
  const blocked=['SHEET_ID','ARCHIVE_SHEET_ID','HR_SHEET_ID','PRICING_SHEET_ID'].map(key=>String(env[key] || '').trim())
  blocked.push(pricingSheetId(),'18vxUJ1bpJdj3DuxbCkOsnvzhDW1z5Vt0lAGhRP0krXY')
  return env.MARKETING_REPORTS_STORE_APPROVED==='true'&&Boolean(id)&&!blocked.includes(id)
}
function sheets() {
  if(!reportStoreConfigured())throw Error('ยังไม่ได้ตั้งค่าที่เก็บรายงานส่วนตัวแยกจากชีตเดิม')
  if(!client)client=google.sheets({version:'v4',auth:new google.auth.GoogleAuth({credentials:{
    client_email:String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g,''),
    private_key:String(process.env.GOOGLE_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g,'').replace(/\\n/g,'\n'),
  },scopes:['https://www.googleapis.com/auth/spreadsheets']})})
  return client
}
// Same approved private report store; mappings use their own append-only tab.
export const reportSheetsClient=()=>sheets()
async function readRevisionRows() {
  const response=await sheets().spreadsheets.values.get({spreadsheetId:process.env.MARKETING_REPORTS_SHEET_ID.trim(),range:`${TAB}!A:I`,valueRenderOption:'UNFORMATTED_VALUE'})
  return response.data.values || []
}
export const readStoredReportRecords=async()=>decodeReportRevisions(await readRevisionRows())
export const readStoredReportHistory=async()=>decodeReportRevisions(await readRevisionRows(),{history:true})
export const readStoredReportState=async()=>decodeReportState(await readRevisionRows())
export async function readStoredReports() {
  return (await readStoredReportRecords()).map(record=>({...record.report,eventId:record.eventId,revisionId:record.revisionId,savedAt:record.savedAt,savedBy:record.savedBy,localOnly:false,persisted:true}))
}
export async function appendStoredReport(record,by) {
  const api=sheets(),spreadsheetId=process.env.MARKETING_REPORTS_SHEET_ID.trim()
  const meta=await api.spreadsheets.get({spreadsheetId,fields:'sheets.properties'})
  const tab=meta.data.sheets?.find(sheet=>sheet.properties.title===TAB)?.properties
  if(!tab)throw Error('ไม่พบแท็บ report_revisions ในที่เก็บรายงาน')
  const header=await api.spreadsheets.values.get({spreadsheetId,range:`${TAB}!A1:I1`})
  if(REPORT_HEADERS.some((value,index)=>header.data.values?.[0]?.[index]!==value))throw Error('หัวตารางที่เก็บรายงานไม่ตรงรูปแบบ')
  const rows=encodeReportRevision(record,{by})
  // A single atomic Sheets batch commits chunks and their marker together.
  // Literal stringValue prevents source names/text becoming formulas.
  await api.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{appendCells:{sheetId:tab.sheetId,rows:rows.map(row=>({values:row.map(value=>({userEnteredValue:{stringValue:value}}))})),fields:'userEnteredValue'}}]}})
  return {revisionId:rows.at(-1)[1]}
}
