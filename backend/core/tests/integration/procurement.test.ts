import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { generateKeyPair,exportJWK,createLocalJWKSet,SignJWT } from 'jose';
import sharp from 'sharp';
import { testDatabase } from '../helpers/postgres.js';
import { fixtures,A,B,ids } from '../helpers/fixtures.js';
import { ProcurementService } from '../../apps/api/src/modules/procurement/service.js';
import { ProcurementLine,flexSummary } from '../../apps/api/src/modules/procurement/line.js';
import { classify } from '../../apps/api/src/modules/procurement/classifier.js';
import { bangkokDate } from '../../apps/api/src/modules/procurement/input.js';
import { createApp } from '../../apps/api/src/app.js';
import { sql } from '../../packages/db/src/index.js';
let cluster:Awaited<ReturnType<typeof testDatabase>>,service:ProcurementService,server:Server,base:string,token:string,photo:string;
const payee=randomUUID(),cash=randomUUID(),payable=randomUUID(),connection=randomUUID(),route=randomUUID(),recipient=randomUUID(),secret='test-line-secret';
const scope=<T>(work:()=>Promise<T>)=>cluster.db.runAsTenant(A,work);
before(async()=>{
 cluster=await testDatabase();await fixtures(cluster.admin);service=new ProcurementService(cluster.db);
 await cluster.admin.query("INSERT INTO app.accounts(company_id,id,code,name,account_type,reporting_group) VALUES($1,$2,'1000','Cash','ASSET','CASH'),($1,$3,'2300','Payable','LIABILITY','PAYABLE')",[A,cash,payable]);
 await cluster.admin.query('INSERT INTO app.procurement_accounts(company_id,expense_account_id,payable_account_id,cash_account_id) VALUES($1,$2,$3,$4)',[A,ids.accounts.other,payable,cash]);
 await cluster.admin.query("INSERT INTO app.payees(company_id,id,kind,name) VALUES($1,$2,'SUPPLIER','ร้านทดสอบ')",[A,payee]);
 const role=(await cluster.admin.query<{role_id:string}>('SELECT role_id FROM app.user_roles WHERE company_id=$1 AND user_id=$2',[A,ids.user])).rows[0]!.role_id;
 for(const p of ['procurement.read','procurement.request','procurement.manage','finance.manage']){const pid=randomUUID();await cluster.admin.query('INSERT INTO app.permissions(company_id,id,code,description) VALUES($1,$2,$3,$3)',[A,pid,p]);await cluster.admin.query('INSERT INTO app.role_permissions(company_id,role_id,permission_id) VALUES($1,$2,$3)',[A,role,pid]);}
 await cluster.admin.query("INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,webhook_route_id,credentials_secret_ref) VALUES($1,$2,'LINE','bot-test',$3,'env:LINE_TEST')",[A,connection,route]);
 await cluster.admin.query("INSERT INTO app.line_recipients(company_id,id,connection_id,line_user_id,user_id) VALUES($1,$2,$3,'line-boss',$4)",[A,recipient,connection,ids.user]);
 const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='test';
 const jwt={issuer:'https://identity.test',audience:'test',key:createLocalJWKSet({keys:[jwk]})};
 token=await new SignJWT({company_id:A}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('employee-1').setIssuer(jwt.issuer).setAudience(jwt.audience).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
 server=createApp({db:cluster.db,jwt,secrets:async()=>({channelSecret:secret,accessToken:'test-token'})}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address==='object');base=`http://127.0.0.1:${address.port}`;
 photo=(await sharp({create:{width:12,height:12,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64');
});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(cluster)await cluster.close();});
async function post(path:string,body:unknown){const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:response.status,body:await response.json() as Record<string,unknown>};}
const input=()=>({clientRequestId:randomUUID(),title:'กระดาษจากแม็คโคร',text:'กระดาษและอุปกรณ์สำนักงาน',paymentMethod:'COD',payeeId:payee,estimatedAmount:'100.25'});
test('classification distinguishes domains, Thai locations and an unavailable local AI honestly',async()=>{
 assert.equal((await classify('ของใช้','https://shopee.co.th/a')).location,'MARKETPLACE');
 assert.equal((await classify('หยิบจากบ้านใหญ่',null)).location,'MAIN_HOUSE');
 assert.equal((await classify('ของใช้','https://shopee.co.th.evil.test/a')).confidence,0);
 assert.equal((await classify('กระดาษ',null,{ollamaUrl:'http://localhost:11434',model:'test',fetch:async()=>{throw new Error();}})).engine,'RULES');
});
test('parallel request retries create one request; a changed payload with same key conflicts',async()=>{
 const b=input();const results=await Promise.all([scope(()=>service.create(ids.user,b)),scope(()=>service.create(ids.user,b))]);assert.equal(results[0]!.id,results[1]!.id);
 await assert.rejects(scope(()=>service.create(ids.user,{...b,title:'changed'})),/รหัสรายการ/);
 const other=await cluster.db.runAsTenant(B,()=>cluster.db.query(sql`SELECT id FROM app.purchase_requests`));assert.equal(other.rowCount,0);
});
test('receipt recognition and settlement post once and reconcile cash/payable without double expense',async()=>{
 await scope(async()=>{
  const file=await service.file(ids.user,{name:'receipt.png',base64:photo});
  const request=await service.create(ids.user,{...input(),fileIds:[file.id]});
  const approved=await service.action(ids.user,request.id,{action:'approve',version:1,location:'MAKRO',payeeId:payee});
  await assert.rejects(service.action(ids.user,request.id,{action:'receive',version:1}),/โหลดใหม่/);
  await service.action(ids.user,request.id,{action:'receive',version:approved.version,actualAmount:'100.25',recognitionDate:bangkokDate(),receiptFileId:file.id});
  const batch=await service.batch(ids.user,bangkokDate());assert.equal(batch.total,'100.25');
  const payout=(await cluster.db.query<{id:string}>(sql`SELECT id FROM app.procurement_payouts WHERE company_id=${A} AND batch_id=${batch.id}`)).rows[0]!;
  await assert.rejects(service.pay(ids.user,payout.id,file.id),/อนุมัติ/);
  await service.approveBatch(ids.user,batch.id);
  await Promise.all([service.pay(ids.user,payout.id,file.id),service.pay(ids.user,payout.id,file.id)]);
  const expense=(await cluster.db.query(sql`SELECT id FROM app.expenses WHERE company_id=${A} AND request_id=${request.id}`));assert.equal(expense.rowCount,1);
  const settlements=await cluster.db.query(sql`SELECT id FROM app.journal_entries WHERE company_id=${A} AND source_kind='PROCUREMENT_PAYOUT' AND source_id=${payout.id}`);assert.equal(settlements.rowCount,1);
  const balances=(await cluster.db.query<{account_id:string;balance:string}>(sql`SELECT account_id,sum(debit-credit)::text AS balance FROM app.journal_lines WHERE company_id=${A} AND account_id IN(${cash},${payable}) GROUP BY account_id`)).rows;
  assert.equal(balances.find(b=>b.account_id===payable)?.balance,'0.00');assert.equal(balances.find(b=>b.account_id===cash)?.balance,'-100.25');
 });
});
test('images are decoded and re-encoded, malformed images fail, tenant cannot read another file',async()=>{
 const file=await scope(()=>service.file(ids.user,{name:'safe.png',base64:photo}));
 await assert.rejects(scope(()=>service.file(ids.user,{name:'bad.png',base64:Buffer.from('not a photo').toString('base64')})),/JPEG/);
 assert.equal((await cluster.db.runAsTenant(B,()=>cluster.db.query(sql`SELECT * FROM app.file_contents WHERE file_id=${file.id}`))).rowCount,0);
});
test('HTTP sales entry uses dated costs and public catalog excludes unpublished products',async()=>{
 const product=randomUUID(),order=randomUUID();
 const created=await post('/api/ops/products',{id:product,name:'Private Product',sku:product,price:'200',cost:'50',costStartsOn:bangkokDate(),published:false});assert.equal(created.status,201,JSON.stringify(created.body));
 const sale=await post('/api/ops/orders',{id:order,orderNumber:order,recognizedOn:bangkokDate(),items:[{productId:product,quantity:'2',price:'200',vat:'0'}]});assert.equal(sale.status,201,JSON.stringify(sale.body));
 const response=await fetch(base+'/api/orders/'+order+'/profit',{headers:{Authorization:'Bearer '+token}});const profit=await response.json() as {netCogs:string};assert.equal(response.status,200);assert.equal(profit.netCogs,'100.00');
 const catalog=await(await fetch(base+'/catalog/'+A)).json() as {products:{id:string}[]};assert.equal(catalog.products.some(p=>p.id===product),false);
});
test('API date-only values retain the Bangkok accounting day',async()=>{
 const response=await fetch(base+'/api/ops/data',{headers:{Authorization:'Bearer '+token}});
 assert.equal(response.status,200);
 const data=await response.json() as {orders:{order_number:string;recognition_date:string}[];ledger:{accounting_date:string}[];ads:{spend_date:string}[];fixedCosts:{starts_on:string}[]};
 assert.equal(data.orders.find(o=>o.order_number==='ORDER-0')?.recognition_date,'2024-02-29');
 for(const value of [...data.ledger.map(r=>r.accounting_date),...data.ads.map(r=>r.spend_date),...data.fixedCosts.map(r=>r.starts_on)])assert.match(value,/^\d{4}-\d{2}-\d{2}$/);
 const snapshot=await scope(()=>service.snapshot(ids.user,true));
 for(const row of [...snapshot.requests,...snapshot.batches])assert.match(String(row['business_date']),/^\d{4}-\d{2}-\d{2}$/);
});

test('daily Flex queue is idempotent and refuses sends above free shared quota',async()=>{
 let pushes=0;
 const line=new ProcurementLine(service,async()=>({accessToken:'token'}),'http://localhost:3000',async(url)=>{
  if(String(url).endsWith('/quota'))return Response.json({type:'limited',value:300});
  if(String(url).endsWith('/consumption'))return Response.json({totalUsage:300});pushes++;return Response.json({});
 });
 await scope(async()=>{assert.equal(await line.prepare(),1);assert.equal(await line.prepare(),0);await line.dispatch();});assert.equal(pushes,0);
 const output=flexSummary([{id:randomUUID(),title:'ขนม',location:'LOCAL_SHOP',status:'APPROVED',amount:'10.00',shop_url:null}],bangkokDate(),'http://localhost:3000');assert.equal(output['type'],'flex');assert.ok(JSON.stringify(output).includes('ร้านหน้าปากซอย'));
});
test('LINE signature validation and intended-recipient binding prevent unauthorized actions',async()=>{
 const tokenValue='secret-action',batch=randomUUID();
 await cluster.admin.query('INSERT INTO app.procurement_batches(company_id,id,business_date,round_number) VALUES($1,$2,current_date,99)',[A,batch]);
 const {sha256}=await import('../../apps/api/src/http/json.js');
 await cluster.admin.query("INSERT INTO app.line_action_tokens(company_id,token_sha256,recipient_id,batch_id,action,expires_at) VALUES($1,$2,$3,$4,'APPROVE_BATCH',now()+interval '1 hour')",[A,sha256(tokenValue),recipient,batch]);
 const send=async(user:string,valid=true)=>{const body=JSON.stringify({destination:'bot-test',events:[{type:'postback',webhookEventId:randomUUID(),source:{userId:user},postback:{data:'proc:'+tokenValue}}]});return fetch(base+`/webhooks/line/${A}/${route}`,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':valid?createHmac('sha256',secret).update(body).digest('base64'):'invalid'},body});};
 assert.equal((await send('line-boss',false)).status,401);assert.equal((await send('wrong-user')).status,200);
 assert.equal((await cluster.admin.query<{status:string}>('SELECT status FROM app.procurement_batches WHERE company_id=$1 AND id=$2',[A,batch])).rows[0]!.status,'DRAFT');
 assert.equal((await send('line-boss')).status,200);
 assert.equal((await cluster.admin.query<{status:string}>('SELECT status FROM app.procurement_batches WHERE company_id=$1 AND id=$2',[A,batch])).rows[0]!.status,'APPROVED');
 assert.equal((await send('line-boss')).status,200);
});
