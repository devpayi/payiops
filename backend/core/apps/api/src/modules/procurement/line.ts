import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sql } from '../../../../../packages/db/src/index.js';
import { sha256, type JsonObject } from '../../http/json.js';
import { HttpError } from '../../http/errors.js';
import type { SecretResolver } from '../integrations/verification.js';
import { ProcurementService } from './service.js';
import { hasPermission } from './routes.js';
import { bangkokDate, id, locationNames, record, string, type Location } from './input.js';

interface Connection {id:string;credentials_secret_ref:string;external_account_id:string}
interface Recipient {id:string;user_id:string;line_user_id:string}
interface SummaryItem {id:string;title:string;shop_url:string|null;location:Location;status:string;amount:string}
export function flexSummary(items:SummaryItem[],day:string,webUrl:string,buttons:JsonObject[]=[]):JsonObject{
 const groups=(Object.keys(locationNames) as Location[]).map(where=>({where,rows:items.filter(r=>r.location===where)})).filter(g=>g.rows.length);
 const bubbles:JsonObject[]=groups.map(group=>({type:'bubble',size:'mega',header:{type:'box',layout:'vertical',contents:[{type:'text',text:locationNames[group.where],weight:'bold',size:'lg',color:'#135745'},{type:'text',text:`${day} · ${group.rows.length} รายการ`,size:'sm',color:'#666666'}]},
  body:{type:'box',layout:'vertical',spacing:'lg',contents:group.rows.slice(0,6).map(row=>({type:'box',layout:'vertical',spacing:'sm',contents:[{type:'text',text:`☐ ${row.title.slice(0,100)}`,wrap:true,weight:'bold',size:'sm'},{type:'text',text:`฿${row.amount} · ${row.status==='PURCHASED'?'รับของแล้ว รอจ่าย':'รอดำเนินการ'}`,size:'xs',color:'#666666'},
   {type:'button',height:'sm',action:{type:'uri',label:row.shop_url?'เปิดร้านค้า':'เปิดรายการ',uri:row.shop_url??`${webUrl}/?request=${row.id}`}}]}))},
  footer:{type:'box',layout:'vertical',contents:[{type:'button',style:'primary',color:'#135745',action:{type:'uri',label:group.rows.length>6?`ดูครบ ${group.rows.length} รายการ`:'ซื้อแล้ว / แนบบิล',uri:webUrl}}]}}));
 if(buttons.length)bubbles.push({type:'bubble',header:{type:'box',layout:'vertical',contents:[{type:'text',text:'รอบอนุมัติและโอนเงิน',weight:'bold'}]},body:{type:'box',layout:'vertical',contents:[{type:'text',text:'กดยืนยันโอนเฉพาะยอดที่จ่ายจริงและแนบหลักฐานแล้ว ระบบจะบันทึกบัญชีให้',wrap:true,size:'sm'}]},footer:{type:'box',layout:'vertical',contents:buttons.slice(0,6)}});
 if(!bubbles.length)bubbles.push({type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:'ไม่มีรายการจัดซื้อค้าง',wrap:true}]}});
 return{type:'flex',altText:`รายการจัดซื้อ ${day} · ${items.length} รายการ`,contents:{type:'carousel',contents:bubbles}};
}
export class ProcurementLine {
 constructor(readonly service:ProcurementService,readonly secrets:SecretResolver,readonly webUrl:string,readonly transport:typeof fetch=fetch){
  const u=new URL(webUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Invalid web URL');
 }
 get db(){return this.service.db;}
 async prepare(day=bangkokDate()):Promise<number>{
  const company=this.db.currentCompanyId();
  return this.db.transaction(async()=>{
   await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+'summary'+day},0))`);
   const rows=(await this.db.query<SummaryItem>(sql`SELECT id,title,shop_url,coalesce(confirmed_location,suggested_location,'LOCAL_SHOP') AS location,status,coalesce(actual_amount,estimated_amount)::text AS amount FROM app.purchase_requests WHERE company_id=${company} AND business_date<=${day}::date AND status IN('SUBMITTED','NEEDS_REVIEW','APPROVED','PURCHASED') ORDER BY business_date,requested_at LIMIT 1000`)).rows;
   const recipients=(await this.db.query<Recipient&{connection_id:string}>(sql`SELECT r.id,r.user_id,r.line_user_id,r.connection_id FROM app.line_recipients r JOIN app.users u ON u.company_id=r.company_id AND u.id=r.user_id AND u.status='ACTIVE' JOIN app.integration_connections c ON c.company_id=r.company_id AND c.id=r.connection_id AND c.is_active AND c.provider='LINE' WHERE r.company_id=${company} AND r.daily_summary_enabled`)).rows;
   let created=0;
   for(const recipient of recipients){
    if(!await hasPermission(this.db,recipient.user_id,'procurement.manage'))continue;
    const dedup=`${day}:${recipient.id}`;
    if((await this.db.query(sql`SELECT 1 FROM app.outbox_events WHERE company_id=${company} AND topic='LINE_PROCUREMENT' AND deduplication_key=${dedup}`)).rowCount)continue;
    const batches=(await this.db.query<{id:string;status:string}>(sql`SELECT id,status FROM app.procurement_batches WHERE company_id=${company} AND status IN('DRAFT','APPROVED','PARTIALLY_PAID') ORDER BY created_at LIMIT 3`)).rows;
    const buttons:JsonObject[]=[];
    for(const batch of batches){
     const action=batch.status==='DRAFT'?'APPROVE_BATCH':'CONFIRM_TRANSFER',token=randomBytes(32).toString('base64url');
     await this.db.query(sql`INSERT INTO app.line_action_tokens(company_id,token_sha256,recipient_id,batch_id,action,expires_at) VALUES(${company},${sha256(token)},${recipient.id},${batch.id},${action},now()+interval '23 hours')`);
     buttons.push({type:'button',height:'sm',style:'secondary',action:{type:'postback',label:action==='APPROVE_BATCH'?'อนุมัติรอบ '+batch.id.slice(0,6):'โอนแล้ว '+batch.id.slice(0,6),data:'proc:'+token}});
    }
    if(!rows.length&&!buttons.length)continue;
    const message=flexSummary(rows,day,this.webUrl,buttons);
    await this.db.query(sql`INSERT INTO app.outbox_events(company_id,topic,deduplication_key,payload) VALUES(${company},'LINE_PROCUREMENT',${dedup},${JSON.stringify({connectionId:recipient.connection_id,to:recipient.line_user_id,messages:[message]})}::jsonb)`);created++;
   }return created;
  });
 }
 async dispatch():Promise<void>{
  const company=this.db.currentCompanyId();
  const event=await this.db.transaction(async()=>{
   const candidate=(await this.db.query<{id:string;payload:JsonObject;created_at:Date}>(sql`SELECT id,payload,created_at FROM app.outbox_events WHERE company_id=${company} AND topic='LINE_PROCUREMENT' AND available_at<=now() AND (status='PENDING' OR(status='SENDING' AND locked_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
   if(!candidate)return null;
   const lock=randomUUID();await this.db.query(sql`UPDATE app.outbox_events SET status='SENDING',lock_token=${lock},locked_until=now()+interval '60 seconds',attempts=attempts+1 WHERE company_id=${company} AND id=${candidate.id}`);return{...candidate,lock};
  });
  if(!event)return;
  let outcome:'DELIVERED'|'PENDING'|'DEAD'='PENDING',error:string|null=null;
  try{
   if(Date.now()-event.created_at.getTime()>23*3600000){outcome='DEAD';throw new Error('SUMMARY_EXPIRED');}
   const connection=(await this.db.query<Connection>(sql`SELECT id,credentials_secret_ref,external_account_id FROM app.integration_connections WHERE company_id=${company} AND id=${id(event.payload['connectionId'])} AND provider='LINE' AND is_active`)).rows[0];
   if(!connection)throw new Error('LINE_NOT_CONFIGURED');const secret=await this.secrets(connection.credentials_secret_ref),token=string(secret['accessToken'],'LINE token',4096);
   const headers={Authorization:`Bearer ${token}`};
   const quotaResponse=await this.transport('https://api.line.me/v2/bot/message/quota',{headers,signal:AbortSignal.timeout(8000),redirect:'error'});
   const useResponse=await this.transport('https://api.line.me/v2/bot/message/quota/consumption',{headers,signal:AbortSignal.timeout(8000),redirect:'error'});
   if(!quotaResponse.ok||!useResponse.ok)throw new Error('QUOTA_UNAVAILABLE');
   const quota=record(await quotaResponse.json()),usage=record(await useResponse.json());
   if(quota['type']!=='limited'||typeof quota['value']!=='number'||typeof usage['totalUsage']!=='number'||usage['totalUsage']>=Math.min(300,quota['value']))throw new Error('FREE_QUOTA_EXHAUSTED');
   const response=await this.transport('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Line-Retry-Key':event.id},body:JSON.stringify({to:event.payload['to'],messages:event.payload['messages']}),signal:AbortSignal.timeout(8000),redirect:'error'});
   if(response.ok||(response.status===409&&response.headers.has('x-line-accepted-request-id')))outcome='DELIVERED';else throw new Error(`LINE_HTTP_${response.status}`);
  }catch(e){error=e instanceof Error?e.message:'LINE_FAILED';}
  await this.db.query(sql`UPDATE app.outbox_events SET status=${outcome},last_error=${error},delivered_at=CASE WHEN ${outcome}='DELIVERED' THEN now() ELSE NULL END,available_at=now()+interval '15 minutes',lock_token=NULL,locked_until=NULL WHERE company_id=${company} AND id=${event.id} AND lock_token=${event.lock}`);
 }
 webhook:RequestHandler=async(req,res)=>{
  const raw:unknown=req.body;if(!Buffer.isBuffer(raw))throw new HttpError(400,'RAW_BODY_REQUIRED','Raw body required');
  await this.db.runAsTenant(id(req.params['companyId']),async()=>{
   const company=this.db.currentCompanyId(),connection=(await this.db.query<Connection>(sql`SELECT id,credentials_secret_ref,external_account_id FROM app.integration_connections WHERE company_id=${company} AND webhook_route_id=${id(req.params['routeId'])} AND provider='LINE' AND is_active`)).rows[0];
   if(!connection)throw new HttpError(404,'NOT_FOUND','LINE connection missing');
   const secret=await this.secrets(connection.credentials_secret_ref),expected=createHmac('sha256',string(secret['channelSecret'],'secret')).update(raw).digest(),signature=Buffer.from(req.get('x-line-signature')??'','base64');
   if(expected.length!==signature.length||!timingSafeEqual(expected,signature))throw new HttpError(401,'INVALID_SIGNATURE','LINE signature invalid');
   const payload=record(JSON.parse(raw.toString('utf8')) as unknown);
   if(payload['destination']!==connection.external_account_id)throw new HttpError(401,'WRONG_CHANNEL','LINE destination mismatch');
   if(!Array.isArray(payload['events']))throw new HttpError(400,'INVALID_EVENTS','Invalid events');
   for(const input of payload['events']){
    const event=record(input);if(event['type']!=='postback')continue;
    const postback=record(event['postback']),data=string(postback['data'],'postback');if(!data.startsWith('proc:'))continue;
    const source=record(event['source']),userId=string(source['userId'],'LINE user'),eventId=string(event['webhookEventId'],'event id');
    await this.db.transaction(async()=>{
     await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+connection.id+eventId},0))`);
     if((await this.db.query(sql`SELECT 1 FROM app.line_event_receipts WHERE company_id=${company} AND connection_id=${connection.id} AND event_id=${eventId}`)).rowCount)return;
     const token=(await this.db.query<{id:string;batch_id:string;action:string;user_id:string;consumed_at:Date|null}>(sql`SELECT t.id,t.batch_id,t.action,t.consumed_at,r.user_id FROM app.line_action_tokens t JOIN app.line_recipients r ON r.company_id=t.company_id AND r.id=t.recipient_id JOIN app.users u ON u.company_id=r.company_id AND u.id=r.user_id AND u.status='ACTIVE' WHERE t.company_id=${company} AND t.token_sha256=${sha256(data.slice(5))} AND t.expires_at>now() AND r.line_user_id=${userId} AND r.connection_id=${connection.id} FOR UPDATE OF t`)).rows[0];
     let outcome='IGNORED';
     if(token&&!token.consumed_at&&await hasPermission(this.db,token.user_id,'procurement.manage')){
      if(token.action==='APPROVE_BATCH'){await this.service.approveBatch(token.user_id,token.batch_id);outcome='APPROVED';}
      if(token.action==='CONFIRM_TRANSFER'){
       const payouts=(await this.db.query<{id:string;prepared_proof_file_id:string|null}>(sql`SELECT id,prepared_proof_file_id FROM app.procurement_payouts WHERE company_id=${company} AND batch_id=${token.batch_id} AND status='PENDING' ORDER BY id`)).rows;
       if(payouts.length&&payouts.every(p=>p.prepared_proof_file_id)){for(const p of payouts)await this.service.pay(token.user_id,p.id,p.prepared_proof_file_id!);outcome='PAID';}
       else outcome='PROOF_REQUIRED';
      }
      if(outcome!=='PROOF_REQUIRED')await this.db.query(sql`UPDATE app.line_action_tokens SET consumed_at=now() WHERE company_id=${company} AND id=${token.id}`);
     }
     await this.db.query(sql`INSERT INTO app.line_event_receipts(company_id,connection_id,event_id,outcome) VALUES(${company},${connection.id},${eventId},${outcome})`);
    });
    if(typeof event['replyToken']==='string'){
     const outcome=(await this.db.query<{outcome:string}>(sql`SELECT outcome FROM app.line_event_receipts WHERE company_id=${company} AND connection_id=${connection.id} AND event_id=${eventId}`)).rows[0]?.outcome;
     const feedback=outcome==='PAID'?'บันทึกจ่ายและบัญชีแล้ว ✅':outcome==='APPROVED'?'อนุมัติรอบจ่ายแล้ว ✅':outcome==='PROOF_REQUIRED'?'ยังไม่บันทึกจ่าย กรุณาแนบหลักฐานให้ครบทุกยอดในหน้าเว็บก่อน แล้วกดโอนแล้วอีกครั้ง':'รายการนี้ใช้แล้ว หมดอายุ หรือคุณไม่มีสิทธิ์ กรุณาเปิดหน้าเว็บเพื่อตรวจสถานะ';
     try{const reply=await this.transport('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:`Bearer ${string(secret['accessToken'],'access token',4096)}`,'Content-Type':'application/json'},body:JSON.stringify({replyToken:event['replyToken'],messages:[{type:'text',text:feedback}]}),signal:AbortSignal.timeout(8000),redirect:'error'});if(!reply.ok)console.warn(JSON.stringify({event:'line_reply_failed',status:reply.status}));}catch{console.warn(JSON.stringify({event:'line_reply_unavailable'}));}
    }
   }
  });res.json({received:true});
 };
}
export function startProcurementScheduler(line:ProcurementLine,companies:readonly string[],sendEnabled:boolean):()=>void{
 let running=false;
 const tick=async():Promise<void>=>{
  if(running)return;running=true;
  try{const now=new Date(),hour=new Date(now.getTime()+25200000).getUTCHours();
   for(const company of companies)await line.db.runAsTenant(company,async()=>{if(hour>=17)await line.prepare(bangkokDate(now));if(sendEnabled)await line.dispatch();});
  }catch(e){console.error(JSON.stringify({event:'procurement_scheduler_error',name:e instanceof Error?e.name:'Error'}));}finally{running=false;}
 };
 const timer=setInterval(()=>{void tick();},60000);timer.unref();void tick();return()=>clearInterval(timer);
}
