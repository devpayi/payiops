import { buildPricingCatalog, buildPricingSalesSummary, dateOffset } from '../../shared/pricingCatalog.js'

// Explicit examples for the disconnected preview. Never mixed into live Ops responses.
const aliases = [
  {master_sku:'DEMO-TEE',display_name:'เสื้อยืดคอกลม (ตัวอย่าง)',business:'Payi',platform:'Shopee',alias_variation:'ขาว / M'},
  {master_sku:'DEMO-SOCK',display_name:'ถุงเท้า (ตัวอย่าง)',business:'Payi',platform:'Shopee',alias_variation:'ขาว / ฟรีไซซ์'},
  {master_sku:'DEMO-SET',display_name:'เซ็ตเสื้อและถุงเท้า (ตัวอย่าง)',business:'Payi',platform:'Shopee',alias_variation:'เสื้อ M + ถุงเท้า 2 คู่'},
]
const recipes=[{set_sku:'DEMO-SET',variation_name:'เสื้อ M + ถุงเท้า 2 คู่',component_sku:'DEMO-TEE',qty_per_unit:1},{set_sku:'DEMO-SET',variation_name:'เสื้อ M + ถุงเท้า 2 คู่',component_sku:'DEMO-SOCK',qty_per_unit:2}]
export const pricingDemoData=buildPricingCatalog({aliases,recipes,inventory:[{sku:'DEMO-TEE',retail_price:500},{sku:'DEMO-SOCK',retail_price:89},{sku:'DEMO-SET',retail_price:599}],master:[{sku:'DEMO-TEE',color:'ขาว',size:'M'},{sku:'DEMO-SOCK',color:'ขาว',size:'ฟรีไซซ์'}]})

export function pricingDemoSales({sku,business,variation,endDate}) {
  if(!sku.startsWith('DEMO-')) return null
  const price=pricingDemoData.catalog.find(p=>p.sku===sku)?.referencePrice || 500
  const rows=[{order_key:`demo-${sku}-1`,order_id:'demo-order-1',date:endDate,platform:'Shopee',business,master_sku:sku,variation_name:variation,qty:120,revenue:120*price,order_status:'completed'},
    {order_key:`demo-${sku}-2`,order_id:'demo-order-2',date:dateOffset(endDate,-45),platform:'Shopee',business,master_sku:sku,variation_name:variation,qty:180,revenue:180*price,order_status:'completed'}]
  return {...buildPricingSalesSummary(rows,{sku,business,variation,endDate,recipes}),demo:true}
}
