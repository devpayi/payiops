import process from 'node:process'
import {loadPricingCatalog} from './pricingData.js'

let cache

// Both dashboards resolve product families from the same Ops catalog snapshot.
export async function readProductFamilies() {
  const key=process.env.SHEET_ID
  if(cache?.key===key&&Date.now()-cache.at<60000)return cache.families
  const {productGroups}=await loadPricingCatalog()
  const families=productGroups.map(({key,business,name,skus})=>({key,business,name,skus}))
  cache={key,at:Date.now(),families}
  return families
}
