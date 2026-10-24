import {Buffer} from 'node:buffer'
import process from 'node:process'
import {requireManager,authEnabled} from './auth.js'
import {readProductFamilies} from './productFamilyCatalog.js'
import {reportStoreConfigured,readStoredReports} from './marketingReportStore.js'
import {readAdProductMappings,appendAdMappingBatch,encodeAdMappingBatch} from './adProductMappingStore.js'
import {adProductKey} from '../../shared/adProductMappings.js'

async function readFamilies() {
  return (await readProductFamilies()).map(({key,business,name})=>({key,business,name}))
}
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const conflict=res=>res.status(409).json({success:false,error:'มีการเปลี่ยน Map จากอีกหน้าต่างแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก'})
export function createAdProductMappingHandler({authorize=requireManager,hasAuth=authEnabled,production=()=>Boolean(process.env.VERCEL||process.env.NODE_ENV==='production'),configured=reportStoreConfigured,readState=readAdProductMappings,readReports=readStoredReports,loadFamilies=readFamilies,append=appendAdMappingBatch}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    if(production()&&!hasAuth())return res.status(503).json({success:false,error:'ต้องเปิดการเข้าสู่ระบบก่อนอ่าน Map'})
    if(!authorize(req,res))return
    if(!['GET','POST'].includes(req.method))return res.status(405).json({success:false,error:'ใช้ GET หรือ POST'})
    if(!configured())return res.status(req.method==='GET'?200:409).json({success:req.method==='GET',available:false,writeAvailable:false,mappings:[],families:[],error:req.method==='POST'?'ยังไม่มีที่เก็บ Map ที่อนุมัติ':undefined})
    if(req.method==='POST'&&!hasAuth())return res.status(503).json({success:false,error:'ต้องเข้าสู่ระบบก่อนบันทึก Map'})
    try {
      const [state,families]=await Promise.all([readState(),loadFamilies()])
      if(req.method==='GET')return res.status(200).json({success:true,available:true,writeAvailable:hasAuth(),mappings:state.mappings,families})
      const reports=await readReports(),sources=new Map()
      for(const report of reports)for(const product of report.products||[])sources.set(adProductKey({platform:report.platform||'Shopee',business:report.business,shopId:report.shopId,itemId:product.itemId}),{business:report.business})
      let batch
      try {
        const body=typeof req.body==='string'?JSON.parse(req.body):req.body
        if(!body||Buffer.byteLength(JSON.stringify(body),'utf8')>100000||!uuid(body.id)||!Array.isArray(body.items)||body.items.length<1||body.items.length>50)throw Error('เลือกรายการที่จะ Map ตั้งแต่ 1 ถึง 50 รายการ')
        if(!(body.familyKey===null||typeof body.familyKey==='string'))throw Error('เลือกกลุ่มสินค้าปลายทาง')
        const family=body.familyKey===null?null:families.find(family=>family.key===body.familyKey)
        if(body.familyKey!==null&&!family)throw Error('ไม่พบกลุ่มสินค้าในทะเบียน Ops')
        const seen=new Set()
        const changes=body.items.map(item=>{
          const source=sources.get(item.sourceKey)
          if(!source||seen.has(item.sourceKey)||!(item.expectedRevision===null||uuid(item.expectedRevision)))throw Error('รายการสินค้าขาด ซ้ำ หรือข้อมูลที่เปิดแก้ไม่ถูกต้อง')
          seen.add(item.sourceKey)
          if(family&&family.business!==source.business)throw Error('ต้อง Map ภายในธุรกิจเดียวกัน')
          return {sourceKey:item.sourceKey,expectedRevision:item.expectedRevision,familyKey:family?.key||null}
        })
        batch={version:1,id:body.id,changes};encodeAdMappingBatch(batch)
      }catch(error){return res.status(400).json({success:false,error:error.message})}
      const receipt=state.receipts?.find(receipt=>receipt.id===batch.id)
      if(receipt){
        if(receipt.payload!==JSON.stringify(batch)||!state.accepted.includes(batch.id))return conflict(res)
        return res.status(200).json({success:true,mappings:state.mappings,alreadyApplied:true})
      }
      const previous=new Map(state.mappings.map(mapping=>[mapping.sourceKey,mapping.revision]))
      if(!batch.changes.every(change=>(previous.get(change.sourceKey)||null)===change.expectedRevision))return conflict(res)
      await append(batch,req.user?.username||req.user?.role||'')
      const confirmed=await readState()
      if(!confirmed.accepted.includes(batch.id))return conflict(res)
      return res.status(200).json({success:true,mappings:confirmed.mappings})
    }catch{return res.status(503).json({success:false,error:'ยังยืนยันผล Map ไม่ได้ กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง'})}
  }
}
export default createAdProductMappingHandler()
