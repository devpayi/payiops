// Explicit baseline from the owner's Mall worksheet, not a live TikTok fee feed.
import { satang } from './pricing.js'
export const TIKTOK_PRICING_VERSION = 1
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
  const unitPrice=satang(d.price),unitCost=satang(d.cost)+satang(d.packing)+satang(d.overhead)+satang(d.extraCost)
  const fees=['transaction','commission','campaign','deals','vat'].map(key=>({key,rate:d[key],amount:Math.round(unitPrice*d[key]/100)}))
  const platformFees=fees.reduce((sum,f)=>sum+f.amount,0),affiliate=Math.round(unitPrice*d.affiliate/100),unitProfit=Math.round(unitPrice*d.targetMargin/100)
  const availableAds=unitPrice-unitCost-platformFees-affiliate-unitProfit
  return {valid:true,errors:[],unitPrice,unitCost,fees,platformFees,affiliate,unitProfit,availableAds,margin:d.targetMargin,roi:availableAds>0?unitPrice/availableAds:null,monthlyProfit:unitProfit*d.monthlyVolume,monthlyAds:Math.max(0,availableAds)*d.monthlyVolume,learningBudget:Math.round(Math.max(0,availableAds)*50/5),heroBudget:Math.max(0,availableAds)*30,evergreenBudget:Math.max(0,availableAds)*50}
}
