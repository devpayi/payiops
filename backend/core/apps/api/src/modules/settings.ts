import { readFile,writeFile,rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { sql,type TenantDatabase } from '../../../../packages/db/src/index.js';
import { principalFor,requirePermission } from '../middleware/tenant.js';
import { HttpError } from '../http/errors.js';
import { record,string } from './procurement/input.js';
let configQueue:Promise<void>=Promise.resolve();
export function settingsRoutes(db:TenantDatabase):Router{
 const r=Router();r.use(requirePermission(db,'users.manage'));
 r.get('/',async(_req,res)=>{
  const company=db.currentCompanyId(),connections=(await db.query(sql`SELECT id,external_account_id,webhook_route_id,is_active FROM app.integration_connections WHERE company_id=${company} AND provider='LINE'`)).rows;
  const events=(await db.query(sql`SELECT status,last_error,created_at,delivered_at FROM app.outbox_events WHERE company_id=${company} AND topic='LINE_PROCUREMENT' ORDER BY created_at DESC LIMIT 10`)).rows;
  res.json({connections,events,localConfiguration:!!process.env['LOCAL_RUNTIME_FILE'],sendEnabled:process.env['LINE_SEND_ENABLED']==='true',publicWebUrl:process.env['PUBLIC_WEB_URL']??'http://localhost:3000',ai:{url:process.env['OLLAMA_URL']??null,model:process.env['OLLAMA_MODEL']??null},timezone:'Asia/Bangkok'});
 });
 r.post('/line',async(req,res)=>{
  const file=process.env['LOCAL_RUNTIME_FILE'];if(!file)throw new HttpError(503,'ENV_CONFIGURATION_REQUIRED','การติดตั้งนี้ต้องกำหนด LINE ผ่าน environment ของเซิร์ฟเวอร์');
  const b=record(req.body),company=db.currentCompanyId(),actor=principalFor(req).userId,accessToken=string(b['accessToken'],'Access Token',4096),channelSecret=string(b['channelSecret'],'Channel Secret',512),lineUserId=string(b['lineUserId'],'LINE User ID',100);
  if(!/^U[a-f0-9]{32}$/.test(lineUserId))throw new HttpError(400,'INVALID_LINE_USER','LINE User ID ต้องขึ้นต้นด้วย U และตามด้วย hex 32 ตัว');
  const web=new URL(string(b['publicWebUrl'],'Web URL',500));if(web.protocol!=='https:'||web.username||web.password||web.pathname!=='/'||web.search||web.hash)throw new HttpError(400,'PUBLIC_HTTPS_REQUIRED','ต้องเป็น HTTPS origin ที่ LINE และมือถือเข้าถึงได้');
  const info=await fetch('https://api.line.me/v2/bot/info',{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(8000),redirect:'error'});if(!info.ok)throw new HttpError(400,'LINE_TOKEN_REJECTED','LINE ไม่ยอมรับ Access Token');
  const bot=record(await info.json()),botId=string(bot['userId'],'bot id'),reference='LINE_'+company.replace(/-/g,'').toUpperCase(),connection=randomUUID(),route=randomUUID();
  const save=configQueue.then(async()=>{
   const config=JSON.parse(await readFile(file,'utf8')) as {companyId:string;env:Record<string,string>};
   if(config.companyId!==company)throw new HttpError(403,'LOCAL_OWNER_REQUIRED','การตั้งค่าเครื่องนี้จำกัดสำหรับบริษัทเจ้าของเครื่อง');
   config.env[reference]=JSON.stringify({accessToken,channelSecret});config.env['PUBLIC_WEB_URL']=web.origin;config.env['LINE_SEND_ENABLED']=b['enabled']===true?'true':'false';
   const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(config,null,2),{mode:0o600});await rename(temporary,file);
   process.env[reference]=config.env[reference];
  });configQueue=save.catch(()=>{});await save;
  const result=await db.transaction(async()=>{
   await db.query(sql`UPDATE app.integration_connections SET is_active=false WHERE company_id=${company} AND provider='LINE' AND external_account_id<>${botId}`);
   const row=(await db.query<{id:string;webhook_route_id:string}>(sql`INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,webhook_route_id,credentials_secret_ref) VALUES(${company},${connection},'LINE',${botId},${route},${'env:'+reference}) ON CONFLICT(company_id,provider,external_account_id) DO UPDATE SET credentials_secret_ref=EXCLUDED.credentials_secret_ref,is_active=true RETURNING id,webhook_route_id`)).rows[0]!;
   await db.query(sql`INSERT INTO app.line_recipients(company_id,connection_id,line_user_id,user_id) VALUES(${company},${row.id},${lineUserId},${actor}) ON CONFLICT(company_id,connection_id,line_user_id) DO UPDATE SET user_id=EXCLUDED.user_id,daily_summary_enabled=true`);
   await db.query(sql`INSERT INTO app.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,changes) VALUES(${company},${actor},'LINE_CONFIGURED','INTEGRATION',${row.id},'{}'::jsonb)`);
   return row;
  });
  res.json({ok:true,webhookPath:`/webhooks/line/${company}/${result.webhook_route_id}`,message:'บันทึก LINE Bot จัดซื้อแยกตัวแล้ว กรุณาเริ่ม ops:start ใหม่ และตั้ง Webhook Path นี้ใน Messaging API Channel ของบอทจัดซื้อตัวใหม่เท่านั้น'});
 });return r;
}
