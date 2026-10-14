// Only compare the same sellable item. Never silently use another product's
// costs after changing the business, SKU, or bundle variation.
export function pricingComparisonDraft(current, baseline, mode) {
  const identity = d => JSON.stringify([
    d.business, d.kind, String(d.sku || '').trim().toUpperCase() || String(d.productName || '').trim(),
    String(d.variationName || '').trim(),
  ])
  if (identity(current) !== identity(baseline)) return null
  return mode === 'price' ? { ...current, price: Number(baseline.price) > 0 ? baseline.price : current.price } : baseline
}
