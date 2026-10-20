import {buildAdsSpendOverview} from './adsSpendOverview.js'
import {adProductKey,groupAdProducts} from './adProductMappings.js'

// Calendar months only. Missing reports/products stay null, never invented as zero.
export function buildAdProductHistory(reports,{groupKey,month,business,platform,shopId,mappings=[],families=[]}) {
  const months=Array.from({length:6},(_,index)=>{
    const date=new Date(`${month}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth()-5+index)
    return date.toISOString().slice(0,7)
  })
  const grouped=months.map(value=>{
    const overview=buildAdsSpendOverview(reports,{month:value,business,platform,shopId})
    return groupAdProducts(overview.products,mappings,families).find(group=>group.key===groupKey)
  })
  const sources=new Map()
  for(const group of grouped)for(const row of group?.rows||[])sources.set(adProductKey(row),row.platform)
  const platforms=[...new Set(sources.values())]
  return {platforms,points:months.map((value,index)=>{
    const group=grouped[index]
    const point={month:value,values:{},incomplete:{}}
    for(const name of platforms){
      const row=group?.platforms.find(row=>row.platform===name)
      const found=new Set((row?.rows||[]).map(adProductKey))
      const complete=[...sources].filter(([,platform])=>platform===name).every(([key])=>found.has(key))
      point.values[name]=row&&complete?Number(row.spend):null
      point.incomplete[name]=Boolean(row&&!complete)
    }
    return point
  })}
}
