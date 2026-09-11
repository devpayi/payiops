import { Router } from 'express';
import { sql, type TenantDatabase } from '../../../../../packages/db/src/index.js';
import { principalFor, requirePermission } from '../../middleware/tenant.js';
import { HttpError } from '../../http/errors.js';
import { ProcurementService } from './service.js';
import { bangkokDate, id, record, string } from './input.js';
export async function hasPermission(db:TenantDatabase,user:string,permission:string):Promise<boolean>{
 return Boolean((await db.query(sql`SELECT 1 FROM app.user_roles ur JOIN app.role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id JOIN app.permissions p ON p.company_id=rp.company_id AND p.id=rp.permission_id WHERE ur.company_id=${db.currentCompanyId()} AND ur.user_id=${user} AND p.code=${permission} LIMIT 1`)).rowCount);
}
export function procurementRoutes(service:ProcurementService):Router{
 const router=Router(),db=service.db;
 router.get('/',requirePermission(db,'procurement.read'),async(req,res)=>{const user=principalFor(req).userId;res.json(await service.snapshot(user,await hasPermission(db,user,'procurement.manage')));});
 router.post('/requests',requirePermission(db,'procurement.request'),async(req,res)=>{res.status(201).json(await service.create(principalFor(req).userId,req.body));});
 router.post('/files',requirePermission(db,'procurement.request'),async(req,res)=>{res.status(201).json(await service.file(principalFor(req).userId,req.body));});
 router.get('/files/:id',requirePermission(db,'procurement.read'),async(req,res)=>{
  const user=principalFor(req).userId,company=db.currentCompanyId(),manager=await hasPermission(db,user,'procurement.manage');
  const f=(await db.query<{content:Buffer;media_type:string}>(sql`SELECT c.content,f.media_type FROM app.file_contents c JOIN app.files f ON f.company_id=c.company_id AND f.id=c.file_id WHERE c.company_id=${company} AND c.file_id=${id(req.params['id'])} AND (${manager} OR f.uploaded_by=${user} OR EXISTS(SELECT 1 FROM app.purchase_request_files rf JOIN app.purchase_requests r ON r.company_id=rf.company_id AND r.id=rf.request_id WHERE rf.company_id=${company} AND rf.file_id=f.id AND r.requested_by=${user}))`)).rows[0];
  if(!f)throw new HttpError(404,'NOT_FOUND','ไม่พบไฟล์');res.set('Content-Security-Policy',"default-src 'none'").type(f.media_type).send(f.content);
 });
 router.post('/requests/:id/action',requirePermission(db,'procurement.manage'),async(req,res)=>{res.json(await service.action(principalFor(req).userId,id(req.params['id']),req.body));});
 router.post('/payees',requirePermission(db,'procurement.manage'),async(req,res)=>{
  const body=record(req.body),name=string(body['name'],'ชื่อผู้รับเงิน',150),payee=id(body['id']);
  await db.query(sql`INSERT INTO app.payees(company_id,id,kind,name) VALUES(${db.currentCompanyId()},${payee},'SUPPLIER',${name}) ON CONFLICT(company_id,id) DO NOTHING`);
  res.status(201).json({id:payee});
 });
 router.post('/batches',requirePermission(db,'procurement.manage'),async(req,res)=>{res.status(201).json(await service.batch(principalFor(req).userId,bangkokDate()));});
 router.post('/batches/:id/approve',requirePermission(db,'procurement.manage'),async(req,res)=>{await service.approveBatch(principalFor(req).userId,id(req.params['id']));res.json({ok:true});});
 router.post('/payouts/:id/proof',requirePermission(db,'procurement.manage'),async(req,res)=>{
  const company=db.currentCompanyId(),user=principalFor(req).userId,proof=id(record(req.body)['fileId']),payout=id(req.params['id']);
  if(!(await db.query(sql`SELECT 1 FROM app.files WHERE company_id=${company} AND id=${proof} AND uploaded_by=${user} AND scan_status='CLEAN'`)).rowCount)throw new HttpError(403,'FILE_DENIED','ไม่พบหลักฐาน');
  const update=await db.query(sql`UPDATE app.procurement_payouts SET prepared_proof_file_id=${proof} WHERE company_id=${company} AND id=${payout} AND status='PENDING' RETURNING id`);
  if(!update.rowCount)throw new HttpError(409,'INVALID_STATE','ยอดนี้ไม่พร้อมแนบหลักฐาน');res.json({ok:true});
 });
 router.post('/payouts/:id/pay',requirePermission(db,'procurement.manage'),async(req,res)=>{await service.pay(principalFor(req).userId,id(req.params['id']),id(record(req.body)['fileId']));res.json({ok:true});});
 return router;
}
