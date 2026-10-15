// Planning only. All monetary totals are integer satang; rates are user assumptions.
export const PRICING_ENGINE_VERSION = 3
export const PRICING_SCHEMA_VERSION = 1
export const PRICING_PROGRAMS = [
  { key: 'prime', name: 'PRIME Seller', hint: 'ลดคอมมิชชัน (จุดเปอร์เซ็นต์)', type: 'reduction', defaultRate: 1.07 },
  { key: 'xtra', name: 'ร้านโค้ดคุ้ม / Xtra', hint: 'Service Fee (% ของราคาขาย)', type: 'fee', defaultRate: 8.56 },
  { key: 'small', name: 'ยอดขาย ≤ 10,000 บาท / 30 วัน', hint: 'ส่วนลดคอมมิชชัน (จุดเปอร์เซ็นต์)', type: 'reduction', defaultRate: 1 },
  { key: 'campaign', name: 'แคมเปญ Shopee', hint: 'งบแคมเปญ (% ของราคาขาย)', type: 'discount', defaultRate: 5 },
  { key: 'flash', name: 'Seller Flash Sale', hint: 'งบ Flash Sale (% ของราคาขาย)', type: 'fee', defaultRate: 5 },
  { key: 'dynamic', name: 'Flash Sale Dynamic', hint: 'งบ Flash Sale Dynamic (% ของราคาขาย)', type: 'fee', defaultRate: 3.21 },
  { key: 'affiliate', name: 'Affiliate Commission', hint: 'ค่าคอมมิชชัน (% ของราคาขาย)', type: 'fee', defaultRate: 10 },
  { key: 'ads', name: 'Shopee Ads', hint: 'งบโฆษณา (% ของราคาขาย)', type: 'fee', defaultRate: 5 },
]

export function newPricingDraft() {
  return {
    name: 'แผนราคาปกติ', productName: 'เสื้อยืดคอกลม (ตัวอย่าง)', sku: '', business: 'Payi', store: 'ร้าน Shopee',
    kind: 'single', components: [{ sku: '', name: 'สินค้าตัวอย่าง', qty: 1, cost: 200 }],
    calculationModel: 'reference-v2',
    color: '', size: '', variationName: '', productGroupId: '', productSkus: [], referencePrice: null, referencePriceSource: null, salesSnapshot: null,
    price: 500, unitCost: 200, packing: 15, parcel: 0, unitsPerOrder: 1,
    customerShipping: 38, actualShipping: 38, shippingSubsidy: 0,
    commission: 17.12, transaction: 3.21, transactionCap: 0, platformFee: 1.07,
    transactionIncludesShipping: true, storeType: 'normal', category: 'แฟชั่น (ต่ำสุด)', payment: 'normal',
    voucherEnabled: false, voucher: 0, exclusiveEnabled: false, exclusivePrice: 0,
    voucherPct: 5, exclusivePct: 5,
    programs: Object.fromEntries(PRICING_PROGRAMS.map(p => [p.key, { enabled: false, rate: p.defaultRate }])),
    monthlyVolume: 1000, fixedCost: 0, targetType: 'amount', target: 100,
    feeNote: 'พื้นฐานจากเว็บอ้างอิง · อัตรามีผล 4 ส.ค. 2569 · แก้ตัวเลขเองได้',
  }
}

const moneyFields = ['price', 'unitCost', 'packing', 'parcel', 'customerShipping', 'actualShipping', 'shippingSubsidy', 'platformFee', 'voucher', 'exclusivePrice', 'fixedCost']
const textFields = ['name', 'productName', 'sku', 'business', 'store', 'storeType', 'category', 'payment', 'feeNote', 'color', 'size', 'variationName', 'productGroupId']
const num = v => v === '' || v === null || v === undefined ? NaN : Number(v)
export const satang = value => {
  // Decimal shift avoids binary rounding such as 10.075 * 100 = 1007.4999…
  const [coefficient, exponent = '0'] = String(Number(value)).split('e')
  return Math.round(Number(`${coefficient}e${Number(exponent) + 2}`))
}
const charge = (base, percent) => Math.round(base * Math.round(percent * 1e6) / 1e8)

export function normalizePricingDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('รูปแบบแผนราคาไม่ถูกต้อง')
  const out = newPricingDraft()
  for (const key of textFields) out[key] = String(value[key] ?? out[key]).trim().slice(0, 300)
  for (const key of [...moneyFields, 'commission', 'transaction', 'transactionCap', 'unitsPerOrder', 'monthlyVolume', 'target', 'voucherPct', 'exclusivePct']) if (key in value) out[key] = num(value[key])
  // Existing files keep their old meaning until the user explicitly converts them.
  out.calculationModel = value.calculationModel === 'reference-v2' ? 'reference-v2' : 'legacy-v1'
  out.productSkus=Array.isArray(value.productSkus) ? [...new Set(value.productSkus.slice(0,500).map(v=>String(v).trim().toUpperCase().slice(0,80)).filter(Boolean))] : []
  out.referencePrice = Number.isFinite(num(value.referencePrice)) && num(value.referencePrice)>0 ? num(value.referencePrice) : null
  out.referencePriceSource = value.referencePriceSource === 'inventory_items.retail_price' ? value.referencePriceSource : null
  const snapshot=value.salesSnapshot
  if(snapshot && [30,90].includes(snapshot.days) && Number.isInteger(snapshot.units) && snapshot.units>=0 && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.from) && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.to)) out.salesSnapshot={days:snapshot.days,units:snapshot.units,from:snapshot.from,to:snapshot.to,sku:String(snapshot.sku || '').slice(0,80),business:String(snapshot.business || '').slice(0,80),variation:String(snapshot.variation || '').slice(0,300),suggestedMonthlyVolume:Number.isInteger(snapshot.suggestedMonthlyVolume) && snapshot.suggestedMonthlyVolume>=0 ? snapshot.suggestedMonthlyVolume : Math.round(snapshot.units*30/snapshot.days)}
  out.kind = value.kind === 'bundle' ? 'bundle' : 'single'
  if(out.kind==='bundle' && !Number.isFinite(out.unitCost)) out.unitCost=''
  out.targetType = value.targetType === 'margin' ? 'margin' : 'amount'
  for (const key of ['voucherEnabled', 'exclusiveEnabled', 'transactionIncludesShipping']) if (key in value) out[key] = value[key] === true
  out.components = Array.isArray(value.components) ? value.components.slice(0, 30).map(c => ({ sku: String(c?.sku ?? '').slice(0, 80), name: String(c?.name ?? '').slice(0, 160), qty: num(c?.qty), cost: num(c?.cost) })) : out.components
  for (const p of PRICING_PROGRAMS) {
    const given = value.programs?.[p.key]
    if (given) out.programs[p.key] = { enabled: given.enabled === true, rate: num(given.rate) }
  }
  return out
}

export function validatePricingDraft(draft) {
  const errors = []
  for (const key of moneyFields) {
    if(key==='unitCost' && draft.kind==='bundle') continue
    if (!Number.isFinite(num(draft[key])) || num(draft[key]) < 0 || num(draft[key]) > 1e7) errors.push('กรอกจำนวนเงินให้ครบและไม่ติดลบ')
  }
  if (!(num(draft.price) > 0)) errors.push('ราคาขายต้องมากกว่า 0')
  if (!Number.isInteger(num(draft.unitsPerOrder)) || num(draft.unitsPerOrder) < 1 || num(draft.unitsPerOrder) > 1000) errors.push('จำนวนหน่วยต่อออเดอร์ต้องเป็นจำนวนเต็ม 1–1,000')
  for (const key of ['commission', 'transaction']) if (!Number.isFinite(num(draft[key])) || num(draft[key]) < 0 || num(draft[key]) > 100) errors.push('อัตราค่าธรรมเนียมต้องอยู่ระหว่าง 0–100%')
  if (!Number.isFinite(num(draft.transactionCap)) || num(draft.transactionCap) < 0 || num(draft.transactionCap) > 1e7) errors.push('เพดานค่าธรรมเนียมต้องไม่ติดลบ')
  if (!Number.isInteger(num(draft.monthlyVolume)) || num(draft.monthlyVolume) < 0 || num(draft.monthlyVolume) > 1e7) errors.push('ยอดขายจำลองต้องเป็นจำนวนเต็มที่ไม่ติดลบ')
  const reference = draft.calculationModel === 'reference-v2'
  if (!reference && draft.exclusiveEnabled && !(num(draft.exclusivePrice) > 0)) errors.push('กรอกราคา Exclusive Price มากกว่า 0')
  if (reference) for (const [enabled,key] of [['voucherEnabled','voucherPct'],['exclusiveEnabled','exclusivePct']]) if (draft[enabled] && (!Number.isFinite(num(draft[key])) || num(draft[key]) < 0 || num(draft[key]) > 100)) errors.push('กรอกเปอร์เซ็นต์การตลาดระหว่าง 0–100%')
  if (draft.kind === 'bundle' && (!draft.components?.length || draft.components.some(c => !Number.isInteger(num(c.qty)) || num(c.qty) < 1 || num(c.qty) > 1000 || !Number.isFinite(num(c.cost)) || num(c.cost) < 0 || num(c.cost) > 1e7 || !String(c.name || c.sku).trim()))) errors.push('ระบุสินค้า จำนวน และต้นทุนส่วนประกอบให้ครบ')
  for (const p of PRICING_PROGRAMS) if (draft.programs?.[p.key]?.enabled && (!Number.isFinite(num(draft.programs[p.key].rate)) || num(draft.programs[p.key].rate) < 0 || num(draft.programs[p.key].rate) > 100)) errors.push(`กรอกอัตรา ${p.name} ระหว่าง 0–100%`)
  if (!reference && draft.programs?.flash?.enabled && draft.programs?.dynamic?.enabled) errors.push('เลือก Flash Sale หรือ Flash Sale Dynamic อย่างใดอย่างหนึ่ง')
  return [...new Set(errors)]
}

export function calculatePricing(input) {
  const errors = validatePricingDraft(input)
  if (errors.length) return { valid: false, errors }
  const d = input, qty = Number(d.unitsPerOrder), reference = d.calculationModel === 'reference-v2'
  const unitCost = d.kind === 'bundle' ? d.components.reduce((sum, c) => sum + satang(c.cost) * Number(c.qty), 0) : satang(d.unitCost)
  const unitPrice = satang(!reference && d.exclusiveEnabled ? d.exclusivePrice : d.price)
  const gross = unitPrice * qty
  const program = key => d.programs?.[key]?.enabled ? Number(d.programs[key].rate) : 0
  const campaign = reference ? 0 : charge(gross, program('campaign'))
  const voucher = !reference && d.voucherEnabled ? Math.min(satang(d.voucher), Math.max(0, gross - campaign)) : 0
  const sales = gross - campaign - voucher
  const customerShipping = satang(d.customerShipping), subsidy = reference ? 0 : satang(d.shippingSubsidy)
  const commissionRate = Math.max(0, Number(d.commission) - program('prime') - program('small'))
  const transactionBase = sales + (d.transactionIncludesShipping ? customerShipping : 0)
  const rawTransaction = charge(transactionBase, Number(d.transaction))
  const transaction = Number(d.transactionCap) > 0 ? Math.min(rawTransaction, satang(d.transactionCap)) : rawTransaction
  const rows = [
    { key: 'cost', label: d.kind === 'bundle' ? 'ต้นทุนส่วนประกอบเซ็ต' : 'ต้นทุนสินค้า', amount: unitCost * qty, group: 'cost' },
    { key: 'packing', label: 'แพ็ค / เตรียมสินค้า', amount: satang(d.packing) * qty, group: 'cost' },
    { key: 'parcel', label: 'กล่องพัสดุต่อออเดอร์', amount: satang(d.parcel), group: 'cost' },
    { key: 'shipping', label: reference ? 'ค่าส่งลูกค้าชำระ (ส่งผ่านให้ขนส่ง)' : 'ค่าขนส่งที่จ่าย', amount: reference ? customerShipping : satang(d.actualShipping), group: 'cost' },
    { key: 'commission', label: 'Commission', amount: charge(sales, commissionRate), rate: commissionRate, group: 'fee' },
    { key: 'transaction', label: 'Transaction Fee', amount: transaction, rate: Number(d.transaction), group: 'fee' },
    { key: 'platform', label: 'Platform Fee / ออเดอร์', amount: satang(d.platformFee), group: 'fee' },
    ...PRICING_PROGRAMS.filter(p => (p.type === 'fee' || (reference && p.type === 'discount')) && d.programs?.[p.key]?.enabled).map(p => ({ key: p.key, label: p.name, amount: charge(sales, program(p.key)), rate: program(p.key), group: reference ? p.key === 'xtra' ? 'fee' : 'marketing' : p.key === 'ads' ? 'ads' : 'fee' })),
    ...(reference && d.voucherEnabled ? [{ key: 'voucher', label: 'Seller Voucher', amount: charge(gross, Number(d.voucherPct)), rate: Number(d.voucherPct), group: 'marketing' }] : []),
    ...(reference && d.exclusiveEnabled ? [{ key: 'exclusive', label: 'Exclusive Price', amount: charge(gross, Number(d.exclusivePct)), rate: Number(d.exclusivePct), group: 'marketing' }] : []),
  ]
  const revenue = sales + customerShipping + subsidy
  const expenses = rows.reduce((sum, row) => sum + row.amount, 0)
  const profit = revenue - expenses
  return { valid: true, errors: [], qty, unitCost, unitPrice, gross, campaign, voucher, sales, revenue, customerShipping, subsidy, expenses, profit, unitProfit: Math.round(profit / qty), margin: sales > 0 ? profit / sales * 100 : null, fees: rows.filter(r => r.group === 'fee').reduce((sum, r) => sum + r.amount, 0), marketing: rows.filter(r => r.group === 'marketing').reduce((sum, r) => sum + r.amount, 0), rows }
}

export function monthlyProfit(input, volume = input.monthlyVolume) {
  const result = calculatePricing(input)
  if (!result.valid || !Number.isInteger(Number(volume)) || Number(volume) < 0) return null
  const fullOrders = Math.floor(Number(volume) / result.qty), remainder = Number(volume) % result.qty
  const partial = remainder ? calculatePricing({ ...input, unitsPerOrder: remainder }).profit : 0
  return { orders: fullOrders + (remainder ? 1 : 0), contribution: result.profit * fullOrders + partial, afterFixed: result.profit * fullOrders + partial - satang(input.fixedCost) }
}

export function solvePricingTarget(input) {
  if (input.calculationModel !== 'reference-v2' && input.exclusiveEnabled) return { error: 'ปิด Exclusive Price ก่อนหาราคาเป้าหมาย' }
  // Price is the output of this solver, so it need not already be supplied.
  if (!calculatePricing({ ...input, price: 1 }).valid) return { error: 'กรอกข้อมูลต้นทุนและค่าธรรมเนียมให้ครบก่อน' }
  const target = num(input.target)
  if (!Number.isFinite(target) || target < 0 || (input.targetType === 'margin' && target >= 100)) return { error: 'กรอกกำไรเป้าหมายที่ไม่ติดลบ และ margin ต้องต่ำกว่า 100%' }
  const passes = price => {
    const r = calculatePricing({ ...input, price })
    return input.targetType === 'margin' ? r.margin !== null && r.margin >= target : r.profit >= satang(target) * r.qty
  }
  let lo = 1, hi = 100000
  if (passes(lo)) return { price: lo, result: calculatePricing({ ...input, price: lo }) }
  if (!passes(hi)) return { error: 'ไม่พบราคาที่ถึงเป้าหมายภายใน 100,000 บาท' }
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (passes(mid)) hi = mid; else lo = mid + 1 }
  if (!passes(lo) || (lo > 1 && passes(lo - 1))) return { error: 'ตรวจสอบราคาเป้าหมายไม่สำเร็จ โปรดปรับสมมติฐาน' }
  return { price: lo, result: calculatePricing({ ...input, price: lo }) }
}
