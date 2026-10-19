import {createHash} from 'node:crypto'
import process from 'node:process'
import {reportSheetsClient,reportStoreConfigured} from './marketingReportStore.js'
import {applyAdMappingBatches} from '../../shared/adProductMappings.js'

export const AD_MAPPING_TAB='ad_product_mappings'
export const AD_MAPPING_HEADERS=['batch_id','sha256','created_at','created_by','payload']
const hash=value=>createHash('sha256').update(value).digest('hex')
export function encodeAdMappingBatch(batch,by='',now=new Date().toISOString()) {
  const payload=JSON.stringify(batch)
  if(payload.length>30000)throw Error('รายการที่ Map มากเกินไป กรุณาแบ่งบันทึก')
  return [batch.id,hash(payload),now,String(by),payload]
}
export function decodeAdMappingRows(rows) {
  if(!rows.length)return applyAdMappingBatches([])
  if(AD_MAPPING_HEADERS.some((value,index)=>rows[0][index]!==value))throw Error('หัวตาราง Map ไม่ถูกต้อง')
  const batches=rows.slice(1).filter(row=>row.some(cell=>String(cell??'').trim())).map(row=>{
    if(hash(row[4]||'')!==row[1])throw Error('ข้อมูล Map เปลี่ยนจากชุดที่บันทึก')
    const batch=JSON.parse(row[4])
    if(batch.version!==1||batch.id!==row[0]||!Array.isArray(batch.changes)||!batch.changes.length||batch.changes.length>50)throw Error('รูปแบบข้อมูล Map ไม่ถูกต้อง')
    const keys=new Set()
    for(const change of batch.changes){
      if(typeof change.sourceKey!=='string'||keys.has(change.sourceKey)||!(change.expectedRevision===null||typeof change.expectedRevision==='string')||!(change.familyKey===null||typeof change.familyKey==='string'))throw Error('รายการ Map ไม่ถูกต้องหรือซ้ำ')
      keys.add(change.sourceKey)
    }
    return batch
  })
  return applyAdMappingBatches(batches)
}
export async function readAdProductMappings() {
  if(!reportStoreConfigured())return applyAdMappingBatches([])
  try {
    const response=await reportSheetsClient().spreadsheets.values.get({spreadsheetId:process.env.MARKETING_REPORTS_SHEET_ID.trim(),range:`${AD_MAPPING_TAB}!A:E`,valueRenderOption:'UNFORMATTED_VALUE'})
    return decodeAdMappingRows(response.data.values||[])
  }catch(error){if(/unable to parse range|range .*not found/i.test(error.message||''))return applyAdMappingBatches([]);throw error}
}
export async function ensureAdMappingTab() {
  const api=reportSheetsClient(),spreadsheetId=process.env.MARKETING_REPORTS_SHEET_ID.trim()
  const readMeta=()=>api.spreadsheets.get({spreadsheetId,fields:'sheets.properties'})
  let meta=await readMeta(),tab=meta.data.sheets?.find(sheet=>sheet.properties.title===AD_MAPPING_TAB)?.properties
  if(!tab){
    try{await api.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{addSheet:{properties:{title:AD_MAPPING_TAB,gridProperties:{rowCount:1000,columnCount:5}}}}]}})}
    catch(error){if(!/already exists/i.test(error.message||''))throw error}
    meta=await readMeta();tab=meta.data.sheets?.find(sheet=>sheet.properties.title===AD_MAPPING_TAB)?.properties
  }
  if(!tab)throw Error('สร้างแท็บ Map ไม่สำเร็จ')
  const header=await api.spreadsheets.values.get({spreadsheetId,range:`${AD_MAPPING_TAB}!A1:E1`})
  if(!header.data.values?.length)await api.spreadsheets.values.update({spreadsheetId,range:`${AD_MAPPING_TAB}!A1:E1`,valueInputOption:'RAW',requestBody:{values:[AD_MAPPING_HEADERS]}})
  else if(AD_MAPPING_HEADERS.some((value,index)=>header.data.values[0][index]!==value))throw Error('หัวตาราง Map ไม่ถูกต้อง')
  return tab.sheetId
}
export async function appendAdMappingBatch(batch,by) {
  const sheetId=await ensureAdMappingTab(),row=encodeAdMappingBatch(batch,by)
  await reportSheetsClient().spreadsheets.batchUpdate({spreadsheetId:process.env.MARKETING_REPORTS_SHEET_ID.trim(),requestBody:{requests:[{appendCells:{sheetId,rows:[{values:row.map(value=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}}]}})
}
