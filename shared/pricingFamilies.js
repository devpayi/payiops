import { deriveGroup, buildOverrideMap } from './productGroup.js'
import { pricingProductKey, draftForPricingProduct } from './pricingCatalog.js'

export const pricingFamilyCostKey = key => `family:${key}`

export function buildPricingFamilies(catalog, aliases = []) {
  const overrides = new Map()
  const families = new Map()
  for (const p of catalog) {
    if (!overrides.has(p.business)) overrides.set(p.business, buildOverrideMap(aliases.filter(a=>(a.business || 'Payi')===p.business)))
    const bundle = Boolean(p.recipeVariations?.length)
    const group = bundle ? {key:`bundle:${p.sku}`,label:p.name} : deriveGroup(p.name,p.sku,overrides.get(p.business))
    const key = JSON.stringify([p.business,group.key])
    if (!families.has(key)) families.set(key,{key,business:p.business,name:group.label,kind:bundle?'bundle':'single',skus:[],members:[]})
    const family=families.get(key)
    family.skus.push(p.sku);family.members.push(p)
  }
  for(const f of families.values()) {
    const prices=[...new Set(f.members.map(p=>p.referencePrice).filter(p=>p!==null && p!==undefined))]
    f.referencePrice=prices.length===1?prices[0]:null
    f.priceConflict=prices.length>1
    f.referencePriceSource=f.referencePrice===null?null:'inventory_items.retail_price'
  }
  return [...families.values()].sort((a,b)=>a.business.localeCompare(b.business)||a.name.localeCompare(b.name,'th'))
}

export function pricingFamilyCost(family, costs) {
  const saved=costs.get(pricingFamilyCostKey(family.key))
  if(saved) return saved
  const members=family.skus.map(sku=>costs.get(pricingProductKey(family.business,sku))).filter(Boolean)
  const values=[...new Set(members.map(v=>v.cost))]
  return values.length===1 ? members[0] : null
}

export function draftForPricingFamily(draft,family,costs) {
  const seed={...family.members[0],name:family.name,referencePrice:family.referencePrice,referencePriceSource:family.referencePriceSource}
  const next=draftForPricingProduct(draft,seed,costs)
  return {...next,productGroupId:family.key,productSkus:[...family.skus],color:'',size:'',unitCost:pricingFamilyCost(family,costs)?.cost ?? ''}
}
