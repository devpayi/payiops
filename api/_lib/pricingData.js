import productMaster from '../../src/data/productMaster.json' with { type: 'json' }
import { batchGetValues, getMetaCached, getSheet } from './sheets.js'
import { buildPricingCatalog, buildPricingSalesSummary, dateOffset } from '../../shared/pricingCatalog.js'

export function bangkokDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
}

async function optionalSheet(readSheet, name) {
  try { return await readSheet(name) } catch (e) {
    if (/unable to parse range|range .*not found/i.test(e.message || '')) return []
    throw e
  }
}

export async function loadPricingCatalog(services = {}) {
  const readSheet = services.readSheet || getSheet
  const [aliases,inventory,recipes,redirects] = await Promise.all(['product_aliases','inventory_items','set_recipes','sku_redirects'].map(name=>optionalSheet(readSheet,name)))
  return buildPricingCatalog({ aliases,inventory,recipes,redirects,master:services.master || productMaster })
}

const recentRows = new Map(), inflight = new Map()
async function readRecentRows(endDate, services) {
  const start = dateOffset(endDate,-89), firstMonth = start.slice(0,7), lastMonth=endDate.slice(0,7)
  const getMeta = services.getMeta || getMetaCached, batchRead = services.batchRead || batchGetValues
  const meta = await getMeta()
  const tabs = (meta.sheets || []).map(s=>s.properties.title).filter(t=>t==='raw_orders' || (/^raw_orders_\d{4}_\d{2}$/.test(t) && t.slice(11).replace('_','-') >= firstMonth && t.slice(11).replace('_','-') <= lastMonth)).sort()
  const missingMonths=[]
  for(let month=firstMonth;month<=lastMonth;) {
    if(!tabs.includes(`raw_orders_${month.replace('-','_')}`) && !tabs.includes('raw_orders')) missingMonths.push(month)
    const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);month=d.toISOString().slice(0,7)
  }
  if(!tabs.length) return {rows:[],missingMonths}
  const values = await batchRead(tabs.map(t=>`${t}!A:N`))
  const rows=[]
  for(const range of values) {
    const [headers,...data]=range.values || []
    if(!headers) continue
    const fields=['order_key','order_id','order_item_id','date','platform','business','master_sku','variation_name','qty','revenue','order_status']
    const indices=fields.map(f=>headers.indexOf(f))
    if(['date','platform','business','master_sku','qty','revenue','order_status'].some(f=>!headers.includes(f))) throw new Error('โครงสร้างออเดอร์ไม่ครบ')
    for(const row of data) rows.push(Object.fromEntries(fields.map((f,i)=>[f,indices[i]>=0 ? row[indices[i]] ?? '' : ''])))
  }
  return {rows,missingMonths}
}

export async function loadPricingSales(options, services = {}) {
  const endDate=options.endDate || bangkokDate()
  dateOffset(endDate,0)
  if(endDate>bangkokDate()) throw new Error('วันที่ต้องไม่เกินวันนี้')
  const readSheet=services.readSheet || getSheet
  const key=JSON.stringify([process.env.SHEET_ID,process.env.ARCHIVE_SHEET_ID,endDate])
  let source
  if(services.batchRead || services.getMeta) source=await readRecentRows(endDate,services)
  else {
    const cached=recentRows.get(key)
    if(cached && Date.now()-cached.at<60000) source=cached.value
    else {
      if(!inflight.has(key)) inflight.set(key,readRecentRows(endDate,services).then(value=>{if(recentRows.size>=2) recentRows.delete(recentRows.keys().next().value);recentRows.set(key,{at:Date.now(),value});return value}).finally(()=>inflight.delete(key)))
      source=await inflight.get(key)
    }
  }
  const [redirects,recipes]=await Promise.all(['sku_redirects','set_recipes'].map(name=>optionalSheet(readSheet,name)))
  return buildPricingSalesSummary(source.rows,{...options,endDate,redirects,recipes,missingMonths:source.missingMonths})
}
