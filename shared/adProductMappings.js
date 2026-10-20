import {sumReportMoney} from './monthlyAdsReports.js'
import {adsRoas} from './adsSpendOverview.js'

export const adProductKey=source=>JSON.stringify([source.platform||'Shopee',source.business,source.shopId,source.itemId])
export function availableAdMappingSources(products,mappings,families,initialKeys=[],query='') {
  const links=new Map(mappings.map(mapping=>[mapping.sourceKey,mapping]))
  const targets=new Map(families.map(family=>[family.key,family]))
  const editing=new Set(initialKeys),term=query.trim().toLowerCase()
  return products.filter(product=>{
    const key=adProductKey(product),family=targets.get(links.get(key)?.familyKey)
    const mapped=family?.business===product.business
    return (!mapped||editing.has(key))&&`${product.name} ${product.itemId} ${product.platform} ${product.shopName}`.toLowerCase().includes(term)
  })
}
export function applyAdMappingBatches(batches) {
  const latest=new Map(),seen=new Map(),accepted=[],conflicts=[]
  for(const batch of batches) {
    const encoded=JSON.stringify(batch)
    if(seen.has(batch.id)){if(seen.get(batch.id)!==encoded)throw Error('รหัสบันทึก Map ซ้ำแต่ข้อมูลต่างกัน');continue}
    seen.set(batch.id,encoded)
    if(!batch.changes.every(change=>(latest.get(change.sourceKey)?.revision||null)===change.expectedRevision)){conflicts.push(batch.id);continue}
    for(const change of batch.changes)latest.set(change.sourceKey,{...change,revision:batch.id})
    accepted.push(batch.id)
  }
  return {mappings:[...latest.values()],accepted,conflicts,receipts:[...seen].map(([id,payload])=>({id,payload}))}
}

// Explicit mappings only. Similar product names or SKUs never merge automatically.
export function groupAdProducts(products,mappings=[],catalog=[]) {
  const targets=new Map(catalog.map(family=>[family.key,family]))
  const links=new Map(mappings.map(mapping=>[mapping.sourceKey,mapping]))
  const groups=new Map()
  for(const product of products) {
    const link=links.get(adProductKey(product)),family=targets.get(link?.familyKey)
    const mapped=Boolean(family&&family.business===product.business)
    const key=mapped?`family:${family.key}`:`unmapped:${adProductKey(product)}`
    if(!groups.has(key))groups.set(key,{key,name:mapped?family.name:product.name,business:product.business,familyKey:mapped?family.key:null,mapped,rows:[]})
    groups.get(key).rows.push(product)
  }
  return [...groups.values()].map(group=>{
    const spend=sumReportMoney(group.rows.map(row=>row.spend))
    const percent=group.rows.every(row=>row.percent!==null)?group.rows.reduce((sum,row)=>sum+row.percent,0):null
    const platforms=[...new Set(group.rows.map(row=>row.platform))].map(platform=>{
      const rows=group.rows.filter(row=>row.platform===platform)
      const spend=sumReportMoney(rows.map(row=>row.spend))
      const sales=rows.every(row=>row.sales!==null&&row.sales!==undefined&&String(row.sales).trim()!=='')?sumReportMoney(rows.map(row=>row.sales)):null
      return {platform,spend,sales,roas:adsRoas(sales,spend),rows}
    })
    return {...group,spend,percent,platforms,
      // Attributed sales across platforms can overlap. No cross-platform combined ROAS.
      sales:platforms.length===1?platforms[0].sales:null,roas:platforms.length===1?platforms[0].roas:null}
  }).sort((a,b)=>Number(b.spend)-Number(a.spend)||a.key.localeCompare(b.key))
}
