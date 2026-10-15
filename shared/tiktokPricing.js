// Explicit baseline from the owner's Mall worksheet, not a live TikTok fee feed.
export const TIKTOK_PRICING_VERSION = 2
export const isTikTokPlan = draft => draft?.calculationModel === 'tiktok-mall-v1'
export function newTikTokDraft() {
  return {calculationModel:'tiktok-mall-v1',name:'แผนราคาปกติ',productName:'สินค้า A',business:'Payi',sku:'',productGroupId:'',productSkus:[],kind:'single',price:395,cost:100,packing:5,overhead:2,extraCost:1.06,transaction:3.21,commission:11.77,campaign:8.03,deals:3.21,vat:7,affiliate:15,targetMargin:10,monthlyVolume:1000}
}
const amounts=['price','cost','packing','overhead','extraCost']
const rates=['transaction','commission','campaign','deals','vat','affiliate','targetMargin']
export function normalizeTikTokDraft(input) {
  const out=newTikTokDraft()
  for(const k of ['name','productName','business','sku','productGroupId']) out[k]=String(input[k] ?? out[k]).trim().slice(0,300)
  out.productSkus=Array.isArray(input.productSkus)?[...new Set(input.productSkus.slice(0,500).map(v=>String(v).trim().toUpperCase().slice(0,80)).filter(Boolean))]:[]
  for(const k of [...amounts,...rates,'monthlyVolume']) if(k in input) out[k]=input[k]===''||input[k]===null?NaN:Number(input[k])
  return out
}
export function calculateTikTok(input) {
  const d=normalizeTikTokDraft(input),errors=[]
  if(!d.productName || !d.name) errors.push('กรอกชื่อสินค้าและชื่อแผน')
  if(amounts.some(k=>!Number.isFinite(d[k])||d[k]<0||d[k]>1e7)||d.price<=0) errors.push('กรอกราคาและต้นทุนให้ครบ ราคาขายต้องมากกว่า 0')
  if(rates.some(k=>!Number.isFinite(d[k])||d[k]<0||d[k]>100)) errors.push('เปอร์เซ็นต์ต้องอยู่ระหว่าง 0–100')
  if(!Number.isInteger(d.monthlyVolume)||d.monthlyVolume<0||d.monthlyVolume>1e7) errors.push('ยอดขายต้องเป็นจำนวนเต็มที่ไม่ติดลบ')
  if(errors.length) return {valid:false,errors}
  // Mall has no ROUND in its formulas. Preserve sub-satang values through ROI
  // and totals; only the UI formats decimals. Amount fields remain in satang units.
  const precise=value=>Number(value.toFixed(8))
  const unitPrice=precise(d.price*100),unitCost=precise((d.cost+d.packing+d.overhead+d.extraCost)*100)
  const keys=['transaction','commission','campaign','deals','vat']
  const fees=keys.map(key=>({key,rate:d[key],amount:precise(unitPrice*d[key]/100)}))
  const platformFees=precise(unitPrice*keys.reduce((sum,k)=>sum+d[k]/100,0)),affiliate=precise(unitPrice*d.affiliate/100),unitProfit=precise(unitPrice*d.targetMargin/100)
  const availableAds=precise(unitPrice-unitCost-platformFees-affiliate-unitProfit)
  return {valid:true,errors:[],precision:'worksheet-unrounded',unitPrice,unitCost,fees,platformFees,affiliate,unitProfit,availableAds,margin:d.targetMargin,roi:availableAds>0?unitPrice/availableAds:null,monthlyProfit:precise(unitProfit*d.monthlyVolume),monthlyAds:precise(Math.max(0,availableAds)*d.monthlyVolume),learningBudget:precise(Math.max(0,availableAds)*50/5),heroBudget:precise(Math.max(0,availableAds)*30),evergreenBudget:precise(Math.max(0,availableAds)*50)}
}
