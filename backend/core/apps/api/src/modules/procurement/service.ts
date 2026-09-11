import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql, type TenantDatabase } from '../../../../../packages/db/src/index.js';
import { decimal, money } from '../../../../../packages/money/src/decimal.js';
import { sha256, canonical } from '../../http/json.js';
import { HttpError } from '../../http/errors.js';
import { classify, type ClassifierOptions } from './classifier.js';
import { amount, bangkokDate, date, id, location, record, shopUrl, string } from './input.js';

export interface PurchaseRow {id:string;title:string;status:string;version:number;requested_by:string;payee_id:string|null;payment_method:string;actual_amount:string|null;estimated_amount:string;business_date:string;shop_url:string|null;suggested_location:string;confirmed_location:string|null}
export class ProcurementService {
 constructor(readonly db:TenantDatabase,readonly classifier:ClassifierOptions={}){}
 async audit(actor:string,action:string,entity:string,entityId:string,changes:Record<string,unknown>={}):Promise<void>{
  await this.db.query(sql`INSERT INTO app.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,changes) VALUES(${this.db.currentCompanyId()},${actor},${action},${entity},${entityId},${JSON.stringify(changes)}::jsonb)`);
 }
 async file(actor:string,input:unknown):Promise<{id:string}>{
  const b=record(input),name=string(b['name'],'ชื่อไฟล์',150),encoded=string(b['base64'],'รูปภาพ',7500000);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new HttpError(400,'INVALID_IMAGE','รูปภาพไม่ถูกต้อง');
  const source=Buffer.from(encoded,'base64');if(source.length>5242880)throw new HttpError(413,'IMAGE_TOO_LARGE','รูปต้องไม่เกิน 5 MB');
  let content:Buffer;
  try{content=await sharp(source,{limitInputPixels:24000000,animated:false}).rotate().resize(2400,2400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();}
  catch{throw new HttpError(400,'INVALID_IMAGE','รองรับภาพ JPEG PNG WebP ที่เปิดอ่านได้เท่านั้น');}
  const fileId=randomUUID(),company=this.db.currentCompanyId();
  return this.db.transaction(async()=>{
   await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+'files'},0))`);
   const usage=(await this.db.query<{bytes:string}>(sql`SELECT coalesce(sum(byte_size),0)::text AS bytes FROM app.files WHERE company_id=${company}`)).rows[0];
   if(BigInt(usage?.bytes??'0')+BigInt(content.length)>1073741824n)throw new HttpError(409,'STORAGE_LIMIT','พื้นที่ไฟล์ของบริษัทครบ 1 GB กรุณาจัดการพื้นที่ก่อน');
   await this.db.query(sql`INSERT INTO app.files(company_id,id,object_key,original_name,media_type,byte_size,sha256,scan_status,uploaded_by) VALUES(${company},${fileId},${company+'/'+fileId},${name},'image/jpeg',${content.length},${sha256(content)},'CLEAN',${actor})`);
   await this.db.query(sql`INSERT INTO app.file_contents(company_id,file_id,content) VALUES(${company},${fileId},${content})`);
   return{id:fileId};
  });
 }
 async create(actor:string,input:unknown):Promise<PurchaseRow>{
  const b=record(input),client=id(b['clientRequestId']),title=string(b['title'],'รายการ',180),raw=typeof b['text']==='string'?b['text'].slice(0,4000):'',url=shopUrl(b['shopUrl']);
  const method=string(b['paymentMethod'],'วิธีจ่าย');if(!['COD','REIMBURSEMENT','PREPAID','INTERNAL_STOCK'].includes(method))throw new HttpError(400,'INVALID_METHOD','วิธีจ่ายไม่ถูกต้อง');
  const estimated=amount(b['estimatedAmount'],true),fileIds=Array.isArray(b['fileIds'])?b['fileIds'].map(id):[];
  if(fileIds.length>5)throw new HttpError(400,'TOO_MANY_FILES','แนบได้สูงสุด 5 รูป');
  const payee=b['payeeId']?id(b['payeeId']):null;
  const company=this.db.currentCompanyId(),hash=sha256(canonical({title,raw,url,method,estimated,payee,fileIds}));
  const previous=(await this.db.query<PurchaseRow&{input_sha256:string}>(sql`SELECT * FROM app.purchase_requests WHERE company_id=${company} AND requested_by=${actor} AND client_request_id=${client}`)).rows[0];
  if(previous){if(previous.input_sha256!==hash)throw new HttpError(409,'REQUEST_CONFLICT','รหัสรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว');return previous;}
  let image:string|undefined;
  if(fileIds[0]){const row=(await this.db.query<{content:Buffer}>(sql`SELECT c.content FROM app.file_contents c JOIN app.files f ON f.company_id=c.company_id AND f.id=c.file_id WHERE c.company_id=${company} AND c.file_id=${fileIds[0]} AND f.uploaded_by=${actor}`)).rows[0];image=row?.content.toString('base64');}
  const suggestion=await classify(title+' '+raw,url,this.classifier,image);
  return this.db.transaction(async()=>{
   await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+actor+client},0))`);
   const existing=(await this.db.query<PurchaseRow&{input_sha256:string}>(sql`SELECT * FROM app.purchase_requests WHERE company_id=${company} AND requested_by=${actor} AND client_request_id=${client}`)).rows[0];
   if(existing){if(existing.input_sha256!==hash)throw new HttpError(409,'REQUEST_CONFLICT','รหัสรายการนี้ถูกใช้แล้ว');return existing;}
   const requestId=randomUUID();
   if(payee&&! (await this.db.query(sql`SELECT 1 FROM app.payees WHERE company_id=${company} AND id=${payee}`)).rowCount)throw new HttpError(400,'INVALID_PAYEE','ไม่พบผู้รับเงิน');
   const result=(await this.db.query<PurchaseRow>(sql`INSERT INTO app.purchase_requests(company_id,id,request_number,requested_by,title,raw_text,shop_url,suggested_location,payment_method,payee_id,estimated_amount,status,client_request_id,input_sha256)
    VALUES(${company},${requestId},${'PR-'+requestId},${actor},${title},${raw},${url},${suggestion.location},${method},${payee},${estimated}::numeric,'NEEDS_REVIEW',${client},${hash}) RETURNING *`)).rows[0]!;
   for(const fileId of fileIds){
    if(!(await this.db.query(sql`SELECT 1 FROM app.files WHERE company_id=${company} AND id=${fileId} AND uploaded_by=${actor} AND scan_status='CLEAN'`)).rowCount)throw new HttpError(403,'FILE_DENIED','ไม่พบไฟล์ที่คุณอัปโหลด');
    await this.db.query(sql`INSERT INTO app.purchase_request_files(company_id,request_id,file_id,purpose) VALUES(${company},${requestId},${fileId},'REFERENCE')`);
   }
   await this.db.query(sql`INSERT INTO app.procurement_classifications(company_id,request_id,request_version,engine,model,prompt_version,input_sha256,location,confidence,explanation)
    VALUES(${company},${requestId},1,${suggestion.engine},${suggestion.model},${suggestion.engine==='AI'?'v1':null},${hash},${suggestion.location},${suggestion.confidence},${suggestion.explanation})`);
   await this.audit(actor,'REQUEST_CREATED','PURCHASE_REQUEST',requestId);return result;
  });
 }
 async accounts(){
  const company=this.db.currentCompanyId();
  const row=(await this.db.query<{expense_account_id:string;payable_account_id:string;cash_account_id:string}>(sql`SELECT m.* FROM app.procurement_accounts m
   JOIN app.accounts e ON e.company_id=m.company_id AND e.id=m.expense_account_id AND e.reporting_group='OTHER_EXPENSE' AND e.is_active
   JOIN app.accounts p ON p.company_id=m.company_id AND p.id=m.payable_account_id AND p.reporting_group='PAYABLE' AND p.is_active
   JOIN app.accounts c ON c.company_id=m.company_id AND c.id=m.cash_account_id AND c.reporting_group='CASH' AND c.is_active
   WHERE m.company_id=${company} FOR SHARE OF m,e,p,c`)).rows[0];
  if(!row)throw new HttpError(409,'ACCOUNT_MAPPING_REQUIRED','ยังไม่ได้ตั้งผังบัญชีจัดซื้อ');return row;
 }
 async journal(actor:string,kind:string,source:string,day:string,value:string,debit:string,credit:string,description:string):Promise<string>{
  const company=this.db.currentCompanyId(),entry=randomUUID();
  await this.db.query(sql`INSERT INTO app.journal_entries(company_id,id,entry_number,source_kind,source_id,source_event_key,accounting_date,description,posted_by) VALUES(${company},${entry},${'JE-'+entry},${kind},${source},'recognition',${day}::date,${description},${actor})`);
  await this.db.query(sql`INSERT INTO app.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit) VALUES(${company},${entry},1,${debit},${description},${value}::numeric,0),(${company},${entry},2,${credit},${description},0,${value}::numeric)`);
  await this.db.query(sql`UPDATE app.journal_entries SET status='POSTED',posted_at=now() WHERE company_id=${company} AND id=${entry}`);return entry;
 }
 async action(actor:string,requestId:string,input:unknown):Promise<PurchaseRow>{
  const b=record(input),action=string(b['action'],'การดำเนินการ'),company=this.db.currentCompanyId();
  return this.db.transaction(async()=>{
   const r=(await this.db.query<PurchaseRow>(sql`SELECT * FROM app.purchase_requests WHERE company_id=${company} AND id=${id(requestId)} FOR UPDATE`)).rows[0];
   if(!r)throw new HttpError(404,'NOT_FOUND','ไม่พบรายการ');
   if(b['version']!==r.version)throw new HttpError(409,'STALE_VERSION','รายการถูกแก้ไขแล้ว กรุณาโหลดใหม่');
   if(action==='approve'){
    if(!['SUBMITTED','NEEDS_REVIEW'].includes(r.status))throw new HttpError(409,'INVALID_STATE','รายการนี้อนุมัติไม่ได้');
    const where=location(b['location']),payee=r.payment_method==='INTERNAL_STOCK'?null:id(b['payeeId']??r.payee_id);
    if(payee&&!(await this.db.query(sql`SELECT 1 FROM app.payees WHERE company_id=${company} AND id=${payee}`)).rowCount)throw new HttpError(400,'INVALID_PAYEE','ไม่พบผู้รับเงิน');
    if((where==='MAIN_HOUSE')!==(r.payment_method==='INTERNAL_STOCK'))throw new HttpError(400,'METHOD_LOCATION_MISMATCH','บ้านใหญ่ต้องใช้วิธีเบิกของภายใน');
    await this.db.query(sql`UPDATE app.purchase_requests SET status='APPROVED',confirmed_location=${where},payee_id=${payee},approved_by=${actor},approved_at=now(),version=version+1 WHERE company_id=${company} AND id=${r.id}`);
   }else if(action==='reject'){
    if(!['SUBMITTED','NEEDS_REVIEW','APPROVED'].includes(r.status))throw new HttpError(409,'INVALID_STATE','รายการมีบัญชีแล้ว ปฏิเสธไม่ได้');
    await this.db.query(sql`UPDATE app.purchase_requests SET status='REJECTED',version=version+1 WHERE company_id=${company} AND id=${r.id}`);
   }else if(action==='receive'){
    if(r.status!=='APPROVED')throw new HttpError(409,'INVALID_STATE','ต้องอนุมัติก่อนรับของ');
    if(r.payment_method==='INTERNAL_STOCK')await this.db.query(sql`UPDATE app.purchase_requests SET status='FULFILLED',purchased_at=now(),version=version+1 WHERE company_id=${company} AND id=${r.id}`);
    else{
     const actual=amount(b['actualAmount']),day=date(b['recognitionDate']);
     if(day>bangkokDate())throw new HttpError(400,'FUTURE_DATE','วันที่รับของต้องไม่เป็นอนาคต');
     const receipt=id(b['receiptFileId']);
     if(!(await this.db.query(sql`SELECT 1 FROM app.files WHERE company_id=${company} AND id=${receipt} AND scan_status='CLEAN' AND (uploaded_by=${actor} OR id IN(SELECT file_id FROM app.purchase_request_files WHERE company_id=${company} AND request_id=${r.id}))`)).rowCount)throw new HttpError(403,'FILE_DENIED','ต้องแนบบิลที่เข้าถึงได้');
     const m=await this.accounts(),expense=randomUUID(),journal=await this.journal(actor,'EXPENSE',expense,day,actual,m.expense_account_id,m.payable_account_id,r.title);
     await this.db.query(sql`INSERT INTO app.expenses(company_id,id,expense_number,payee_id,request_id,recognition_date,description,amount_ex_vat,recognition_journal_id,receipt_file_id,created_by) VALUES(${company},${expense},${'EXP-'+expense},${r.payee_id},${r.id},${day}::date,${r.title},${actual}::numeric,${journal},${receipt},${actor})`);
     await this.db.query(sql`INSERT INTO app.purchase_request_files(company_id,request_id,file_id,purpose) VALUES(${company},${r.id},${receipt},'CASH_RECEIPT') ON CONFLICT(company_id,request_id,file_id) DO UPDATE SET purpose='CASH_RECEIPT'`);
     await this.db.query(sql`UPDATE app.purchase_requests SET status='PURCHASED',actual_amount=${actual}::numeric,purchased_at=${day+'T12:00:00+07:00'}::timestamptz,version=version+1 WHERE company_id=${company} AND id=${r.id}`);
    }
   }else throw new HttpError(400,'INVALID_ACTION','ไม่รองรับการดำเนินการนี้');
   await this.audit(actor,action.toUpperCase(),'PURCHASE_REQUEST',r.id);
   return(await this.db.query<PurchaseRow>(sql`SELECT * FROM app.purchase_requests WHERE company_id=${company} AND id=${r.id}`)).rows[0]!;
  });
 }
 async batch(actor:string,day:string):Promise<{id:string;total:string}>{
  const company=this.db.currentCompanyId();date(day);
  return this.db.transaction(async()=>{
   await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+'batch'+day},0))`);
   const requests=(await this.db.query<PurchaseRow>(sql`SELECT r.* FROM app.purchase_requests r WHERE r.company_id=${company} AND r.business_date<=${day}::date AND r.status='PURCHASED' AND r.actual_amount>0
    AND NOT EXISTS(SELECT 1 FROM app.procurement_batch_items i WHERE i.company_id=r.company_id AND i.request_id=r.id AND i.released_at IS NULL) ORDER BY r.id FOR UPDATE OF r`)).rows;
   if(!requests.length)throw new HttpError(409,'EMPTY_BATCH','ไม่มีรายการรับของแล้วที่ยังไม่เข้ารอบจ่าย');
   const round=(await this.db.query<{n:number}>(sql`SELECT coalesce(max(round_number),0)+1 AS n FROM app.procurement_batches WHERE company_id=${company} AND business_date=${day}::date`)).rows[0]!.n;
   const batch=randomUUID();await this.db.query(sql`INSERT INTO app.procurement_batches(company_id,id,business_date,round_number) VALUES(${company},${batch},${day}::date,${round})`);
   const groups=new Map<string,PurchaseRow[]>();for(const r of requests){const key=r.payee_id+r.payment_method;groups.set(key,[...(groups.get(key)??[]),r]);}
   let total=decimal('0');
   for(const rows of groups.values()){
    const first=rows[0]!,payee=(await this.db.query<{name:string;payout_destination_ref:string|null}>(sql`SELECT name,payout_destination_ref FROM app.payees WHERE company_id=${company} AND id=${first.payee_id}`)).rows[0];
    if(!payee)throw new HttpError(409,'PAYEE_REQUIRED','ไม่พบผู้รับเงิน');
    const sum=rows.reduce((sum,r)=>sum.plus(r.actual_amount??'0'),decimal('0')),payout=randomUUID();total=total.plus(sum);
    await this.db.query(sql`INSERT INTO app.procurement_payouts(company_id,id,batch_id,payee_id,payment_method,amount,destination_ref_snapshot) VALUES(${company},${payout},${batch},${first.payee_id},${first.payment_method},${money(sum)}::numeric,${payee.payout_destination_ref??'MANUAL:'+payee.name})`);
    for(const r of rows)await this.db.query(sql`INSERT INTO app.procurement_batch_items(company_id,payout_id,request_id,amount) VALUES(${company},${payout},${r.id},${r.actual_amount}::numeric)`);
   }
   await this.audit(actor,'BATCH_CREATED','PROCUREMENT_BATCH',batch,{total:money(total)});return{id:batch,total:money(total)};
  });
 }
 async approveBatch(actor:string,batch:string):Promise<void>{
  const company=this.db.currentCompanyId();await this.db.transaction(async()=>{
   const r=(await this.db.query<{status:string}>(sql`SELECT status FROM app.procurement_batches WHERE company_id=${company} AND id=${id(batch)} FOR UPDATE`)).rows[0];
   if(!r)throw new HttpError(404,'NOT_FOUND','ไม่พบรอบจ่าย');if(r.status==='APPROVED')return;
   if(r.status!=='DRAFT')throw new HttpError(409,'INVALID_STATE','อนุมัติรอบนี้ไม่ได้');
   await this.db.query(sql`UPDATE app.procurement_batches SET status='APPROVED',approved_by=${actor},approved_at=now() WHERE company_id=${company} AND id=${batch}`);
   await this.audit(actor,'BATCH_APPROVED','PROCUREMENT_BATCH',batch);
  });
 }
 async pay(actor:string,payoutId:string,proofId:string):Promise<void>{
  const company=this.db.currentCompanyId();await this.db.transaction(async()=>{
   const identity=(await this.db.query<{batch_id:string}>(sql`SELECT batch_id FROM app.procurement_payouts WHERE company_id=${company} AND id=${id(payoutId)}`)).rows[0];
   if(!identity)throw new HttpError(404,'NOT_FOUND','ไม่พบยอดจ่าย');
   await this.db.query(sql`SELECT id FROM app.procurement_batches WHERE company_id=${company} AND id=${identity.batch_id} FOR UPDATE`);
   const p=(await this.db.query<{id:string;batch_id:string;status:string;amount:string;prepared_proof_file_id:string|null}>(sql`SELECT * FROM app.procurement_payouts WHERE company_id=${company} AND id=${id(payoutId)} FOR UPDATE`)).rows[0];
   if(!p)throw new HttpError(404,'NOT_FOUND','ไม่พบยอดจ่าย');if(p.status==='PAID')return;
   const batch=(await this.db.query<{status:string}>(sql`SELECT status FROM app.procurement_batches WHERE company_id=${company} AND id=${p.batch_id} FOR UPDATE`)).rows[0];
   if(!batch||!['APPROVED','PARTIALLY_PAID'].includes(batch.status)||p.status!=='PENDING')throw new HttpError(409,'INVALID_STATE','รอบจ่ายยังไม่อนุมัติ');
   if(!(await this.db.query(sql`SELECT 1 FROM app.files WHERE company_id=${company} AND id=${id(proofId)} AND scan_status='CLEAN' AND (uploaded_by=${actor} OR id=${p.prepared_proof_file_id})`)).rowCount)throw new HttpError(403,'PROOF_REQUIRED','ต้องแนบหลักฐานการโอน');
   const m=await this.accounts(),entry=await this.journal(actor,'PROCUREMENT_PAYOUT',p.id,bangkokDate(),p.amount,m.payable_account_id,m.cash_account_id,'ชำระค่าจัดซื้อ');
   await this.db.query(sql`UPDATE app.procurement_payouts SET status='PAID',paid_at=now(),confirmed_by=${actor},transfer_proof_file_id=${proofId},settlement_journal_id=${entry} WHERE company_id=${company} AND id=${p.id}`);
   await this.db.query(sql`UPDATE app.purchase_requests SET status='PAID',paid_at=now(),version=version+1 WHERE company_id=${company} AND id IN(SELECT request_id FROM app.procurement_batch_items WHERE company_id=${company} AND payout_id=${p.id} AND released_at IS NULL)`);
   await this.db.query(sql`UPDATE app.procurement_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM app.procurement_payouts WHERE company_id=${company} AND batch_id=${p.batch_id} AND status<>'PAID') THEN 'PARTIALLY_PAID' ELSE 'PAID' END WHERE company_id=${company} AND id=${p.batch_id}`);
   await this.audit(actor,'PAYMENT_CONFIRMED','PROCUREMENT_PAYOUT',p.id,{amount:p.amount,proofId});
  });
 }
 async snapshot(actor:string,manager:boolean){
  const company=this.db.currentCompanyId();
  const requests=(await this.db.query(sql`SELECT r.*,r.business_date::text AS business_date,u.display_name AS requester,p.name AS payee_name,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.file_id,'purpose',f.purpose)) FROM app.purchase_request_files f WHERE f.company_id=r.company_id AND f.request_id=r.id),'[]'::jsonb) AS files
    FROM app.purchase_requests r JOIN app.users u ON u.company_id=r.company_id AND u.id=r.requested_by LEFT JOIN app.payees p ON p.company_id=r.company_id AND p.id=r.payee_id
    WHERE r.company_id=${company} AND (${manager} OR r.requested_by=${actor}) ORDER BY r.requested_at DESC LIMIT 300`)).rows;
  const payees=(await this.db.query(sql`SELECT id,name,kind FROM app.payees WHERE company_id=${company} ORDER BY name`)).rows;
  const batches=manager?(await this.db.query(sql`SELECT b.*,b.business_date::text AS business_date,coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',y.name,'method',p.payment_method,'amount',p.amount::text,'status',p.status,'proofId',p.prepared_proof_file_id)) FROM app.procurement_payouts p JOIN app.payees y ON y.company_id=p.company_id AND y.id=p.payee_id WHERE p.company_id=b.company_id AND p.batch_id=b.id),'[]'::jsonb) AS payouts FROM app.procurement_batches b WHERE b.company_id=${company} ORDER BY b.created_at DESC LIMIT 60`)).rows:[];
  return{requests,payees,batches,today:bangkokDate(),manager,aiConfigured:Boolean(this.classifier.model&&this.classifier.ollamaUrl),currency:'THB',timezone:'Asia/Bangkok'};
 }
}
