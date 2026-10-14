import { isoDate } from './dates.js'

const text = v => String(v ?? '').trim()
export const pricingProductKey = (business, sku) => JSON.stringify([text(business), text(sku).toUpperCase()])
export const pricingRecipeKey = (sku, variation) => JSON.stringify([text(sku).toUpperCase(), text(variation)])
const number = v => text(v) === '' ? null : Number(text(v).replace(/,/g, ''))
const positivePrice = v => { const n = number(v); return Number.isFinite(n) && n > 0 ? n : null }
const validCost = v => text(v) !== '' && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0

export function buildPricingCatalog({ aliases = [], inventory = [], recipes = [], master = [], redirects = [] }) {
  const redirect = new Map(redirects.map(r => [text(r.old_sku).toUpperCase(), text(r.new_sku).toUpperCase()]))
  const allRecipeKeys = new Set(recipes.map(r => pricingRecipeKey(r.set_sku, r.variation_name)))
  const canonical = (sku, variation = '') => {
    let current = text(sku).toUpperCase()
    if (allRecipeKeys.has(pricingRecipeKey(current, variation))) return current
    const seen = new Set()
    while (redirect.get(current) && !seen.has(current)) { seen.add(current); current = redirect.get(current) }
    return current
  }
  const metadata = new Map(master.map(p => [text(p.sku).toUpperCase(), p]))
  const stock = new Map(inventory.filter(p => text(p.active) !== '0' && p.category !== 'packaging').map(p => [text(p.sku).toUpperCase(), p]))
  const catalog = new Map()
  function add(sku, business, name, variation = '', platform = '') {
    sku = canonical(sku, variation)
    if (!sku) return
    business = text(business) || 'Payi'
    const key = pricingProductKey(business, sku)
    if (!catalog.has(key)) {
      const m = metadata.get(sku) || {}, item = stock.get(sku) || {}
      catalog.set(key, { key, sku, business, name: text(name) || text(item.display_name) || text(m.name_th || m.name_en) || sku,
        color: text(m.color || item.color), size: text(m.size || item.size), variations: [], platforms: [],
        referencePrice: positivePrice(item.retail_price), referencePriceSource: positivePrice(item.retail_price) === null ? null : 'inventory_items.retail_price', recipeVariations: [] })
    }
    const product = catalog.get(key)
    if (variation && !product.variations.includes(variation)) product.variations.push(variation)
    if (platform && !product.platforms.includes(platform)) product.platforms.push(platform)
  }
  for (const a of aliases) add(a.master_sku, a.business, a.display_name, text(a.alias_variation), text(a.platform))
  // Inventory has no business column. Do not assign an already-known SKU to a different business.
  for (const item of stock.values()) if (![...catalog.values()].some(p => p.sku === canonical(item.sku))) add(item.sku, 'Payi', item.display_name)
  const publicRecipes = recipes.filter(r => text(r.keep_set_sales) !== '0' && text(r.set_sku) && text(r.variation_name) && text(r.component_sku) && Number(r.qty_per_unit) > 0).map(r => ({ set_sku: text(r.set_sku).toUpperCase(), variation_name: text(r.variation_name), component_sku: canonical(r.component_sku), qty_per_unit: Number(r.qty_per_unit) }))
  for (const p of catalog.values()) p.recipeVariations = [...new Set(publicRecipes.filter(r => r.set_sku === p.sku).map(r => r.variation_name))]
  return { catalog: [...catalog.values()].sort((a,b) => a.business.localeCompare(b.business) || a.sku.localeCompare(b.sku, undefined, { numeric: true })), recipes: publicRecipes }
}

export function latestPricingPlans(revisions) {
  return [...new Map(revisions.map(r=>[r.scenarioId || r,r])).values()].reverse()
}

export function savedPricingCosts(revisions) {
  const costs = new Map()
  for (const record of latestPricingPlans(revisions).filter(r=>!r.deleted).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const d = record.draft
    if (!d || !d.sku || d.kind !== 'single' || !validCost(d.unitCost)) continue
    costs.set(pricingProductKey(d.business,d.sku), { cost: Number(d.unitCost), planName: d.name, createdAt: record.createdAt })
  }
  return costs
}

export function draftForPricingProduct(draft, product, costs = new Map()) {
  const saved = costs.get(pricingProductKey(product.business,product.sku))
  return { ...draft, sku: product.sku, productName: product.name, business: product.business, color: product.color || '', size: product.size || '', variationName: '',
    kind: product.recipeVariations?.length ? 'bundle' : 'single', unitCost: saved?.cost ?? '',
    components: [], monthlyVolume: 0, salesSnapshot: null,
    referencePrice: product.referencePrice ?? null, referencePriceSource: product.referencePriceSource || null,
    price: product.referencePrice ?? '',
  }
}

export function draftForPricingRecipe(draft, rows, catalog, costs = new Map()) {
  return { ...draft, kind: 'bundle', variationName: rows[0]?.variation_name || '', salesSnapshot: null,
    components: rows.map(r => ({ sku: r.component_sku, name: catalog.find(p => p.sku === r.component_sku && p.business === draft.business)?.name || r.component_sku,
      qty: Number(r.qty_per_unit), cost: costs.get(pricingProductKey(draft.business,r.component_sku))?.cost ?? '' })) }
}

export function dateOffset(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0,10) !== date) throw new Error('วันที่ไม่ถูกต้อง')
  value.setUTCDate(value.getUTCDate()+days)
  return value.toISOString().slice(0,10)
}

export function buildPricingSalesSummary(rows, { sku, business, platform = 'Shopee', variation = '', endDate, redirects = [], recipes = [], missingMonths = [] }) {
  const from90 = dateOffset(endDate,-89), from30 = dateOffset(endDate,-29)
  const redirect = new Map(redirects.map(r => [text(r.old_sku).toUpperCase(), text(r.new_sku).toUpperCase()]))
  const recipeKeys = new Set(recipes.map(r => pricingRecipeKey(r.set_sku,r.variation_name)))
  const corrections = new Set(recipes.filter(r => text(r.keep_set_sales) === '0').map(r => pricingRecipeKey(r.set_sku,r.variation_name)))
  const target = text(sku).toUpperCase(), seen = new Set()
  const windows = { days30: { days:30, from:from30, units:0, salesSatang:0, ids:new Set() }, days90: { days:90, from:from90, units:0, salesSatang:0, ids:new Set() } }
  let latestDataDate = null, skippedCorrections = 0
  for (const r of rows) {
    if (text(r.business) !== business || text(r.platform) !== platform) continue
    const date = isoDate(r.date)
    if (!date || date > endDate) continue
    const calendarDate=new Date(`${date}T00:00:00Z`)
    if(!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0,10)!==date) continue
    if (!latestDataDate || date > latestDataDate) latestDataDate = date
    if (date < from90) continue
    const originalSku = text(r.master_sku).toUpperCase(), rowVariation = text(r.variation_name)
    let resolved = originalSku
    if (!recipeKeys.has(pricingRecipeKey(originalSku,rowVariation))) {
      const chain = new Set()
      while (redirect.get(resolved) && !chain.has(resolved)) { chain.add(resolved); resolved = redirect.get(resolved) }
    }
    if (resolved !== target || (variation && rowVariation !== variation)) continue
    if (corrections.has(pricingRecipeKey(originalSku,rowVariation))) { skippedCorrections++; continue }
    if (/ยกเลิก|cancel|return|refund|คืนสินค้า|คืนเงิน/i.test(text(r.order_status))) continue
    const qty = number(r.qty), sales = number(r.revenue)
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty) || !Number.isFinite(sales) || sales < 0) continue
    const key = text(r.order_key) || (r.order_item_id ? JSON.stringify([r.business,r.platform,r.order_id,r.order_item_id]) : null)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    for (const window of Object.values(windows)) if (date >= window.from) {
      window.units += qty; window.salesSatang += Math.round(sales*100)
      if (r.order_id) window.ids.add(text(r.order_id))
    }
  }
  const summary = { sku:target, business, platform, variation, endDate, latestDataDate, missingMonths, skippedCorrections,
    scope: 'business-platform', basis: 'original-order-lines', fetchedAt: new Date().toISOString() }
  for (const [key, window] of Object.entries(windows)) summary[key] = { days:window.days, from:window.from, to:endDate, units:window.units,
    salesSatang:window.salesSatang, orders:window.ids.size, averagePriceSatang:window.units ? Math.round(window.salesSatang/window.units) : null,
    suggestedMonthlyVolume:Math.round(window.units*30/window.days) }
  return summary
}
