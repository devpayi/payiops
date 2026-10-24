export const salesProductSkuKey=(business,sku)=>JSON.stringify([String(business||'').trim(),String(sku||'').trim().toUpperCase()])

export function resolveSalesProductFamily(sourceKeys,families) {
  if(!families)return {familyKey:null,familyLinkStatus:'unavailable'}
  const bySku=new Map()
  for(const family of families)for(const sku of family.skus||[]) {
    const key=salesProductSkuKey(family.business,sku)
    const matches=bySku.get(key)||new Set()
    matches.add(family.key)
    bySku.set(key,matches)
  }
  const keys=[...sourceKeys]
  if(!keys.length)return {familyKey:null,familyLinkStatus:'unmatched'}
  const matches=keys.map(key=>bySku.get(key))
  if(matches.some(value=>!value?.size))return {familyKey:null,familyLinkStatus:'unmatched'}
  const familyKeys=new Set(matches.flatMap(value=>[...value]))
  if(familyKeys.size!==1)return {familyKey:null,familyLinkStatus:'ambiguous'}
  return {familyKey:[...familyKeys][0],familyLinkStatus:'linked'}
}
