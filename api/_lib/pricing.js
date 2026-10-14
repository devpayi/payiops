import { createHash, randomUUID } from 'node:crypto'
import { authEnabled } from './auth.js'
import { loadPricingCatalog, loadPricingSales, bangkokDate } from './pricingData.js'
import { appendPricingRevision, listPricingRevisions, pricingConfigured } from './pricingStore.js'
import { calculatePricing, normalizePricingDraft, PRICING_ENGINE_VERSION, PRICING_SCHEMA_VERSION } from '../../shared/pricing.js'

export function pricingAccounts() {
  // Owner-approved accounts only. A broad role never grants Pricing access.
  return String(process.env.PRICING_ALLOWED_USERS ?? 'dev,boss').split(',').map(v => v.trim().toLowerCase()).filter(v => ['dev', 'boss'].includes(v))
}

export function hasPricingAccess(user) {
  return Boolean(user?.u && pricingAccounts().includes(String(user.u).trim().toLowerCase()))
}

export async function opPricing(req, res, services = {}) {
  const listRevisions = services.listRevisions || listPricingRevisions
  const appendRevision = services.appendRevision || appendPricingRevision
  res.setHeader('Cache-Control', 'no-store')
  const action = req.query.action || (req.method === 'GET' ? 'bootstrap' : req.body?.action)
  const demo = !authEnabled()
  const allowed = demo || hasPricingAccess(req.user)
  if (req.method === 'GET' && action === 'access') return res.status(200).json({ success: true, allowed, demo, configured: !demo && allowed && pricingConfigured() })
  if (!allowed) return res.status(403).json({ success: false, error: 'บัญชีนี้ไม่มีสิทธิ์ใช้เครื่องมือตั้งราคา', revoked: true })
  if (demo) return res.status(409).json({ success: false, demo: true, error: 'โหมดทดลองใช้ข้อมูลตัวอย่าง เปิดระบบล็อกอินก่อนเชื่อมข้อมูลจริง' })
  try {
    if (req.method === 'GET' && action === 'bootstrap') {
      const [source, history] = await Promise.all([
        (services.loadCatalog || loadPricingCatalog)(services),
        pricingConfigured() ? listRevisions().then(revisions=>({revisions})).catch(()=>({revisions:[],storageError:'อ่านแผนส่วนตัวไม่ได้ กรุณาตรวจการตั้งค่าชีต'})) : Promise.resolve({revisions:[]}),
      ])
      return res.status(200).json({ success:true,...source,...history,storageConfigured:pricingConfigured(),today:bangkokDate(),catalogSource:'payi-ops' })
    }
    if (req.method === 'GET' && action === 'sales') {
      const sku=String(req.query.sku || '').trim(),business=String(req.query.business || ''),variation=String(req.query.variation || '').trim()
      const endDate=String(req.query.endDate || bangkokDate())
      if(!sku || sku.length>80 || !['Payi','Payi Outlet','กรอบรูป'].includes(business) || variation.length>300 || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate>bangkokDate()) return res.status(400).json({success:false,error:'เลือกสินค้า ธุรกิจ และวันที่ให้ถูกต้อง'})
      try { const summary=await (services.loadSales || loadPricingSales)({sku,business,variation,endDate,platform:'Shopee'},services);return res.status(200).json({success:true,summary}) }
      catch(e) { if(e.message==='วันที่ไม่ถูกต้อง') return res.status(400).json({success:false,error:e.message});throw e }
    }
    if (!pricingConfigured()) return res.status(409).json({ success: false, setupRequired: true, error: 'ตั้งค่า PRICING_SHEET_ID เป็นชีตส่วนตัวแยกจากชีตหลักเพื่อบันทึกแผนราคา' })
    if (req.method === 'GET' && action === 'recover') {
      const found = (await listRevisions()).filter(r => r.requestId === String(req.query.requestId || ''))
      if (new Set(found.map(r => r.hash)).size > 1) return res.status(409).json({ success: false, error: 'พบรายการบันทึกขัดแย้ง กรุณาโหลดประวัติใหม่' })
      return res.status(200).json({ success: true, record: found[0] || null })
    }
    if (req.method === 'POST' && ['delete-scenario','restore-scenario'].includes(action)) {
      const body=req.body || {}
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '') || !body.scenarioId || !body.parentRevisionId) return res.status(400).json({success:false,error:'รหัสแผนหรือคำขอไม่ถูกต้อง'})
      const hash=createHash('sha256').update(JSON.stringify({action,scenarioId:body.scenarioId,parentRevisionId:body.parentRevisionId})).digest('hex')
      const revisions=await listRevisions(),existing=revisions.find(r=>r.requestId===body.requestId)
      if(existing) return res.status(existing.hash===hash?200:409).json(existing.hash===hash?{success:true,record:existing}:{success:false,error:'รหัสคำขอนี้ถูกใช้แล้ว'})
      const latest=revisions.filter(r=>r.scenarioId===body.scenarioId).at(-1)
      if(!latest) return res.status(404).json({success:false,error:'ไม่พบแผนนี้'})
      if(latest.revisionId!==body.parentRevisionId) return res.status(409).json({success:false,conflict:true,error:'แผนนี้มีการแก้ไขแล้ว กรุณาโหลดรายการใหม่'})
      const record={...latest,requestId:body.requestId,hash,revisionId:randomUUID(),parentRevisionId:latest.revisionId,createdAt:new Date().toISOString(),createdBy:req.user.u,deleted:action==='delete-scenario',operation:action}
      try { await appendRevision(record) } catch { return res.status(503).json({success:false,unknown:true,error:'ยังยืนยันผลไม่ได้ กดตรวจสอบผลบันทึกก่อนลองใหม่',requestId:body.requestId}) }
      return res.status(200).json({success:true,record})
    }
    if (req.method === 'POST' && action === 'save-scenario') {
      const body = req.body || {}
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '')) return res.status(400).json({ success: false, error: 'รหัสคำขอบันทึกไม่ถูกต้อง' })
      if (!body.draft || typeof body.draft !== 'object' || Array.isArray(body.draft) || (Array.isArray(body.draft.components) && body.draft.components.length > 30)) return res.status(400).json({ success: false, error: 'รูปแบบแผนราคาไม่ถูกต้อง หรือส่วนประกอบเกิน 30 รายการ' })
      const draft = normalizePricingDraft(body.draft)
      const result = calculatePricing(draft)
      if (!draft.name || !draft.productName || !result.valid) return res.status(400).json({ success: false, error: result.errors?.[0] || 'กรอกชื่อสินค้าและชื่อแผนก่อนบันทึก' })
      const hash = createHash('sha256').update(JSON.stringify({ draft, scenarioId: body.scenarioId || null, parentRevisionId: body.parentRevisionId || null })).digest('hex')
      const revisions = await listRevisions()
      const existing = revisions.find(r => r.requestId === body.requestId)
      if (existing) return res.status(existing.hash === hash ? 200 : 409).json(existing.hash === hash ? { success: true, record: existing } : { success: false, error: 'รหัสคำขอนี้ถูกใช้กับข้อมูลคนละชุด' })
      if (body.scenarioId) {
        const history = revisions.filter(r => r.scenarioId === body.scenarioId)
        if (!history.length || history.at(-1).deleted || history.at(-1).revisionId !== body.parentRevisionId) return res.status(409).json({ success: false, conflict: true, error: 'แผนนี้ถูกลบหรือมีการแก้ไขแล้ว กรุณาโหลดใหม่หรือบันทึกเป็นแผนใหม่' })
      }
      const record = { requestId: body.requestId, hash, scenarioId: body.scenarioId || randomUUID(), revisionId: randomUUID(), parentRevisionId: body.parentRevisionId || null, createdAt: new Date().toISOString(), createdBy: req.user.u, schemaVersion: PRICING_SCHEMA_VERSION, engineVersion: PRICING_ENGINE_VERSION, draft, result }
      try { await appendRevision(record) } catch { return res.status(503).json({ success: false, unknown: true, error: 'ยังยืนยันผลบันทึกไม่ได้ กดตรวจสอบผลบันทึกก่อนลองใหม่', requestId: body.requestId }) }
      return res.status(200).json({ success: true, record })
    }
    return res.status(400).json({ success: false, error: 'ไม่รองรับคำขอนี้' })
  } catch {
    return res.status(503).json({ success: false, error: ['bootstrap','sales'].includes(action) ? 'อ่านข้อมูล Payi Ops ไม่สำเร็จ กรุณาลองโหลดใหม่หรือตรวจสิทธิ์ของ service account' : 'เชื่อมข้อมูลตั้งราคาไม่ได้ ตรวจการแชร์ชีตส่วนตัวให้ service account แล้วลองอีกครั้ง' })
  }
}
