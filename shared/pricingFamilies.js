import { deriveGroup, buildOverrideMap, normalizeGroupLabel, groupKey } from './productGroup.js'
import { pricingProductKey, draftForPricingProduct } from './pricingCatalog.js'

export const pricingFamilyCostKey = key => `family:${key}`

// Pricing plans share a price across shoe sizes/colors. Keep the model name,
// and leave grouping used by other Ops pages unchanged.
function pricingGroup(product, overrides) {
  // Keep stored family IDs stable when correcting a redirected SKU's display name.
  if (product.legacyGroupName) return pricingGroup({...product,name:product.legacyGroupName,legacyGroupName:undefined},overrides)
  if (!overrides.has(product.sku) && ['Payi','Payi Outlet'].includes(product.business) && /^รองเท้า/.test(product.name)) {
    const sizeSuffix = /\s+(\d{2}(?:[\s/-]+\d{2})*)$/
    const sizes = product.name.match(sizeSuffix)
    if (sizes && sizes[1].split(/[\s/-]+/).every(n=>Number(n)>=20 && Number(n)<=50)) {
      const base = product.name.replace(sizeSuffix,'').replace(/\(([^)]+)\)/g,(_,value)=>
        /^(?:สี)?(?:ฟ้า(?:อ่อน|เบบี้บลู)?|ดำ|ขาว|แดง|ชมพู|เทา|น้ำเงิน|เขียว|เหลือง)$/.test(value.trim()) ? ' ' : ` ${value} `)
      const label = normalizeGroupLabel(base)
      return {key:groupKey(label),label}
    }
  }
  return deriveGroup(product.name,product.sku,overrides)
}

export function buildPricingFamilies(catalog, aliases = []) {
  const overrides = new Map()
  const families = new Map()
  for (const p of catalog) {
    if (!overrides.has(p.business)) overrides.set(p.business, buildOverrideMap(aliases.filter(a=>(a.business || 'Payi')===p.business)))
    const bundle = Boolean(p.recipeVariations?.length)
    const group = bundle ? {key:`bundle:${p.sku}`,label:p.name} : pricingGroup(p,overrides.get(p.business))
    const key = JSON.stringify([p.business,group.key])
    if (!families.has(key)) families.set(key,{key,business:p.business,name:group.label,kind:bundle?'bundle':'single',skus:[],members:[]})
    const family=families.get(key)
    family.skus.push(p.sku);family.members.push(p)
  }
  for(const f of families.values()) {
    const member = f.members[0]
    if (f.kind === 'single' && f.skus.length === 1 && member.legacyGroupName && !overrides.get(f.business).has(member.sku)) {
      f.name = member.name
    }
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
