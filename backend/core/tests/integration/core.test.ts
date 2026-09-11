import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import Stripe from 'stripe';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { TenantDatabase, sql } from '../../packages/db/src/index.js';
import { calculateActualProfit, allocate, Decimal } from '../../packages/money/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { verifyPaymentWebhook, type SecretResolver } from '../../apps/api/src/modules/integrations/verification.js';
import { idempotency, transactionalWebhookHandler } from '../../apps/api/src/middleware/idempotency.js';
import { paymentProcessor } from '../../apps/api/src/modules/integrations/payments.js';
import { errorHandler } from '../../apps/api/src/http/errors.js';
import { testDatabase } from '../helpers/postgres.js';
import { A,B,ids,fixtures,journal } from '../helpers/fixtures.js';

let cluster:Awaited<ReturnType<typeof testDatabase>>;
let db:TenantDatabase;
let server:Server,guardServer:Server,base:string,guardBase:string;
const keys=await generateKeyPair('RS256');
const jwk=await exportJWK(keys.publicKey);jwk.kid='integration-key';jwk.alg='RS256';
const jwtConfig={issuer:'https://identity.test',audience:'cmo-api',key:createLocalJWKSet({keys:[jwk]})};
const signingSecret=`whsec_${randomBytes(32).toString('hex')}`;
const stripe=new Stripe(`sk_test_${randomBytes(24).toString('hex')}`);
const twoSecret=randomBytes(32).toString('hex');
const secrets:SecretResolver=async reference=>reference==='env:TWO_FIXTURE'
  ?{merchantSecret:twoSecret,transactionTimezone:'Asia/Bangkok'}
  :reference==='env:OMISE_FIXTURE'?{secretKey:'skey_test_'+twoSecret,livemode:false}
  :{apiKey:`sk_test_${randomBytes(24).toString('hex')}`,webhookSecret:signingSecret,livemode:false};
function deferred():{promise:Promise<void>;resolve:()=>void}{let resolve:()=>void=()=>{throw new Error('Deferred not initialized');};const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
let entered=deferred(),release=deferred();
let behavior:'NORMAL'|'WAIT'|'FAIL'|'BAD_COMMIT'='NORMAL';
const marker=randomUUID();
async function start(app:express.Express):Promise<{server:Server;base:string}>{
  const running=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>running.once('listening',resolve));
  const address=running.address();assert.ok(address&&typeof address==='object');
  return{server:running,base:`http://127.0.0.1:${address.port}`};
}
async function token(company:string|null=A,extra:Record<string,unknown>={}):Promise<string>{
  return new SignJWT({...company?{company_id:company}:{},...extra}).setProtectedHeader({alg:'RS256',kid:'integration-key'})
    .setIssuer(jwtConfig.issuer).setAudience(jwtConfig.audience).setSubject('employee-1').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
function event(id:string,payment='pi_fixture',amount=107000):string{return JSON.stringify({id,object:'event',type:'payment_intent.succeeded',
  created:Math.floor(Date.now()/1000),livemode:false,account:'acct_fixture',data:{object:{id:payment,object:'payment_intent',status:'succeeded',currency:'thb',amount_received:amount}}});}
function post(raw:string,path=`${base}/webhooks/stripe/${A}/${ids.route}`,headers:Record<string,string>={}):Promise<Response>{
  return fetch(path,{method:'POST',headers:{'content-type':'application/json','stripe-signature':stripe.webhooks.generateTestHeaderString({payload:raw,secret:signingSecret}),...headers},body:raw});
}
async function count(table:'payments'|'journal_entries'|'audit_logs',where:string,values:unknown[]=[]):Promise<number>{
  return Number((await cluster.admin.query(`SELECT count(*) FROM app.${table} WHERE ${where}`,values)).rows[0]?.count);
}
async function pendingPayment(externalId:string):Promise<{order:string;payment:string}>{
  const order=randomUUID(),payment=randomUUID();
  await cluster.admin.query("INSERT INTO app.orders(company_id,id,order_number,source,status) VALUES ($1,$2,$3,'WEB','CONFIRMED')",[A,order,externalId]);
  await cluster.admin.query("INSERT INTO app.order_items(company_id,order_id,line_number,product_id,description,quantity,unit_price_ex_vat,vat_amount) VALUES ($1,$2,1,$3,'Payment test',1,1000,70)",[A,order,ids.product]);
  await cluster.admin.query("INSERT INTO app.payments(company_id,id,order_id,connection_id,external_payment_id,status,amount) VALUES ($1,$2,$3,$4,$5,'PENDING',1070)",[A,payment,order,ids.connection,externalId]);
  return{order,payment};
}
before(async()=>{
  cluster=await testDatabase();db=cluster.db;await fixtures(cluster.admin);
  ({server,base}=await start(createApp({db,jwt:jwtConfig,secrets})));
  const app=express();
  app.post('/guard/:companyId/:routeId',express.raw({type:'application/json'}),verifyPaymentWebhook(db,'STRIPE',secrets),idempotency(db),transactionalWebhookHandler(db,async e=>{
    await db.query(sql`INSERT INTO app.audit_logs(company_id,action,entity_type,entity_id) VALUES (${A},'IDEMPOTENCY_TEST','TEST',${marker})`);
    if(behavior==='WAIT'){entered.resolve();await release.promise;}
    const result=await paymentProcessor(db)(e);
    if(behavior==='FAIL')throw new Error('Injected failure after financial writes');
    if(behavior==='BAD_COMMIT'){
      const id=randomUUID();await db.query(sql`INSERT INTO app.journal_entries(company_id,id,entry_number,source_kind,source_id,source_event_key,accounting_date,description)
        VALUES (${A},${id},${id},'MANUAL',${id},'bad','2024-02-29','Deferred balance test')`);
      await db.query(sql`UPDATE app.journal_entries SET status='POSTED',posted_at=clock_timestamp() WHERE company_id=${A} AND id=${id}`);
    }
    return result;
  }));app.use(errorHandler);({server:guardServer,base:guardBase}=await start(app));
});
after(async()=>{
  for(const s of [server,guardServer])if(s)await new Promise<void>((resolve,reject)=>{s.close(error=>error?reject(error):resolve());s.closeAllConnections();});
  if(cluster)await cluster.close();
});

test('step 2 migration preserves and backfills legacy completed responses under FORCE RLS',async()=>{
  const result=(await cluster.admin.query("SELECT response_text FROM app.idempotency_keys WHERE scope='migration' AND key='legacy'")).rows[0];
  assert.equal(result?.response_text,'{"ok": true}');
});

test('scope required; nested tenant switching and company argument mismatch fail',async()=>{
  await assert.rejects(db.query(sql`SELECT id FROM app.products`),/scope/i);
  await db.runAsTenant(A,async()=>{
    assert.throws(()=>db.runAsTenant(B,()=>0),/switch tenant/);
    await assert.rejects(calculateActualProfit(B,ids.order),/match active scope/);
  });
});
test('50 concurrent scopes cannot read another company with unfiltered SQL',async()=>{
  await Promise.all(Array.from({length:50},(_,i)=>{const company=i%2?A:B;return db.runAsTenant(company,async()=>{
    const rows=await db.query<{company_id:string}>(sql`SELECT company_id FROM app.products`);
    assert.equal(rows.rowCount,1);assert.equal(rows.rows[0]?.company_id,company);
    const zone=await db.query<{zone:string}>(sql`SELECT current_setting('TimeZone') AS zone`);assert.equal(zone.rows[0]?.zone,'Asia/Bangkok');
  });}));
});
test('cross-company writes are blocked by RLS and rollback leaves pooled connections usable',async()=>{
  await assert.rejects(db.runAsTenant(A,()=>db.query(sql`INSERT INTO app.products(company_id,sku,slug,name,price_ex_vat) VALUES (${B},'bad','bad','bad',1)`)),/row-level security/);
  await db.runAsTenant(B,async()=>assert.equal((await db.query(sql`SELECT id FROM app.products`)).rowCount,1));
});
test('rolled-back transactions, including swallowed nested failures, do not persist writes',async()=>{
  const id=randomUUID();await assert.rejects(db.runAsTenant(A,()=>db.transaction(async()=>{
    await db.query(sql`INSERT INTO app.audit_logs(company_id,action,entity_type,entity_id) VALUES (${A},'ROLLBACK','TEST',${id})`);
    try{await db.transaction(async()=>{throw new Error('nested failure');});}catch{}
  })),/nested failure/);assert.equal(await count('audit_logs','entity_id=$1',[id]),0);
});
test('parameterized values cannot inject SQL or session context',async()=>{
  await db.runAsTenant(A,async()=>{const attack="x'; SET app.company_id='"+B+"'; --";
    const row=await db.query<{value:string}>(sql`SELECT ${attack}::text AS value`);assert.equal(row.rows[0]?.value,attack);assert.equal(db.currentCompanyId(),A);
    assert.throws(()=>sql`SELECT set_config('app.company_id','evil',true)`,/single parameterized/);
    assert.throws(()=>sql`SELECT 1; SELECT 2`,/single parameterized/);
  });
});
test('aborted request scope cannot commit or run later queries',async()=>{
  const controller=new AbortController(),id=randomUUID();
  await assert.rejects(db.runAsTenant(A,()=>db.transaction(async()=>{
    await db.query(sql`INSERT INTO app.audit_logs(company_id,action,entity_type,entity_id) VALUES (${A},'ABORT','TEST',${id})`);controller.abort(new Error('Disconnected'));
  }),controller.signal),/Disconnected/);assert.equal(await count('audit_logs','entity_id=$1',[id]),0);
});
test('JWT must be signed, unexpired, correct issuer/audience, and bound to active membership',async()=>{
  const path=`${base}/api/orders/${ids.order}/profit`;
  assert.equal((await fetch(path)).status,401);
  assert.equal((await fetch(path,{headers:{authorization:'Bearer invalid'}})).status,401);
  const expired=await new SignJWT({company_id:A}).setProtectedHeader({alg:'RS256',kid:'integration-key'}).setIssuer(jwtConfig.issuer).setAudience(jwtConfig.audience).setSubject('employee-1').setIssuedAt().setExpirationTime(1).sign(keys.privateKey);
  assert.equal((await fetch(path,{headers:{authorization:`Bearer ${expired}`}})).status,401);
  assert.equal((await fetch(path,{headers:{authorization:`Bearer ${await token(B)}`}})).status,403);
  assert.equal((await fetch(path,{headers:{authorization:`Bearer ${await token(A)}`,'x-company-id':B}})).status,403);
  assert.equal((await fetch(path,{headers:{authorization:`Bearer ${await token(null)}`,'x-company-id':A}})).status,200);
  for(const [issuer,audience] of [['https://wrong.test',jwtConfig.audience],[jwtConfig.issuer,'wrong-audience']]){
    const bad=await new SignJWT({company_id:A}).setProtectedHeader({alg:'RS256',kid:'integration-key'}).setIssuer(issuer ?? '').setAudience(audience ?? '').setSubject('employee-1').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    assert.equal((await fetch(path,{headers:{authorization:`Bearer ${bad}`}})).status,401);
  }
});
test('profit is exact, excludes VAT, uses recognition-time cost, latest ads revision and leap-year daily costs',async()=>{
  const result=await db.runAsTenant(A,()=>calculateActualProfit(A,ids.order));
  assert.equal(result.recognitionDate,'2024-02-29');assert.equal(result.cogsSnapshot,'400.00');
  assert.equal(result.salesExVat,'1000.00');assert.equal(result.vatAfterCredits,'70.00');
  assert.equal(result.netSalesAfterGatewayFees,'970.00');assert.equal(result.allocation.adSpendPoolExVat,'100.00');
  assert.equal(result.allocation.fixedCostDayPoolExVat,'115.00');assert.equal(result.allocatedAdSpend,'33.34');
  assert.equal(result.allocatedFixedCost,'38.34');assert.equal(result.allocatedOtherExpense,'5.00');
  assert.equal(result.netProfit,'493.32');assert.equal(result.netMarginPercent,'49.3320');
  assert.equal(result.cash.netGatewayCollected,'0.00');assert.equal(result.reportStatus,'PROVISIONAL_ALLOCATION');
});
test('allocations reconcile to the pool down to the satang without repeating monthly ad costs',async()=>{
  const results=await db.runAsTenant(A,()=>Promise.all([ids.order,ids.other1,ids.other2].map(id=>calculateActualProfit(A,id))));
  assert.equal(results.reduce((total,r)=>total.plus(r.allocatedAdSpend),new Decimal(0)).toFixed(2),'100.00');
  assert.equal(results.reduce((total,r)=>total.plus(r.allocatedFixedCost),new Decimal(0)).toFixed(2),'115.00');
  assert.equal(allocate('9007199254740993.01','1','2'),'4503599627370496.51');
  assert.equal(allocate('-0.01','1','3'),'-0.01');assert.equal(allocate('-0.01','2','3'),'0.00');
});
test('invalid signature, altered payload, wrong Stripe account, and arbitrary header cannot reserve keys',async()=>{
  const raw=event('evt_security');
  assert.equal((await post(raw,undefined,{'stripe-signature':'invalid'})).status,401);
  assert.equal((await post(raw.replace('acct_fixture','acct_other'))).status,401);
  assert.equal((await post(raw,undefined,{'idempotency-key':'another-key'})).status,409);
  assert.equal((await cluster.admin.query("SELECT count(*) FROM app.idempotency_keys WHERE key='evt_security'")).rows[0]?.count,'0');
});
test('simultaneous duplicate returns 409; transaction commits payment, ledger and exact cached response together',async()=>{
  behavior='WAIT';entered=deferred();release=deferred();const raw=event('evt_concurrent');
  const path=`${guardBase}/guard/${A}/${ids.route}`;const first=post(raw,path);await entered.promise;
  const duplicate=await post(raw,path);assert.equal(duplicate.status,409);
  release.resolve();const response=await first;assert.equal(response.status,200);const body=await response.text();behavior='NORMAL';
  const cached=await post(raw,path);assert.equal(cached.status,200);assert.equal(await cached.text(),body);
  assert.equal(await count('journal_entries',"source_kind='PAYMENT' AND source_id=$1",[ids.payment]),1);
  assert.equal(await count('audit_logs','entity_id=$1',[marker]),1);
});
test('different Stripe event IDs for the same payment cannot duplicate collection or profit',async()=>{
  const result=await post(event('evt_semantic_duplicate'));assert.equal(result.status,200);
  assert.equal(await count('journal_entries',"source_kind='PAYMENT' AND source_id=$1",[ids.payment]),1);
  const profit=await db.runAsTenant(A,()=>calculateActualProfit(A,ids.order));assert.equal(profit.netProfit,'493.32');assert.equal(profit.cash.netGatewayCollected,'1070.00');
});
test('same event ID with changed verified data returns 409 instead of silently replaying',async()=>{
  const response=await post(event('evt_concurrent','pi_fixture',99900));assert.equal(response.status,409);
  assert.equal(await count('journal_entries',"source_kind='PAYMENT' AND source_id=$1",[ids.payment]),1);
});
test('processor failure rolls back work, releases claim, and retry succeeds once',async()=>{
  const payment=await pendingPayment('pi_rollback');
  const raw=event('evt_rollback','pi_rollback'),path=`${guardBase}/guard/${A}/${ids.route}`;
  const initial=await count('audit_logs','entity_id=$1',[marker]);behavior='FAIL';assert.equal((await post(raw,path)).status,500);
  assert.equal(await count('audit_logs','entity_id=$1',[marker]),initial);
  assert.equal(await count('journal_entries',"source_kind='PAYMENT' AND source_id=$1",[payment.payment]),0);
  assert.equal(await count('payments',"id=$1 AND status='PENDING'",[payment.payment]),1);
  assert.equal((await cluster.admin.query("SELECT count(*) FROM app.webhook_events WHERE provider_event_id='evt_rollback'")).rows[0]?.count,'0');
  behavior='NORMAL';assert.equal((await post(raw,path)).status,200);
  assert.equal(await count('audit_logs','entity_id=$1',[marker]),initial+1);
  assert.equal(await count('payments',"id=$1 AND status='SUCCEEDED'",[payment.payment]),1);
  assert.equal(await count('journal_entries',"source_kind='PAYMENT' AND source_id=$1",[payment.payment]),1);
});
test('deferred COMMIT failure never sends a successful response or caches success',async()=>{
  const payment=await pendingPayment('pi_commit_fail');
  const raw=event('evt_commit_fail','pi_commit_fail'),path=`${guardBase}/guard/${A}/${ids.route}`;
  behavior='BAD_COMMIT';assert.equal((await post(raw,path)).status,500);behavior='NORMAL';
  const row=(await cluster.admin.query("SELECT status,response_text FROM app.idempotency_keys WHERE key='evt_commit_fail'")).rows[0];
  assert.equal(row?.status,'PROCESSING');assert.equal(row?.response_text,null);
  assert.equal(await count('payments',"id=$1 AND status='PENDING'",[payment.payment]),1);
  assert.equal(await count('journal_entries',"source_kind='PAYMENT' AND source_id=$1",[payment.payment]),0);
  assert.equal((await post(raw,path)).status,200);
});
test('concurrent distinct payment IDs cannot collect more than the order total',async()=>{
  const original=await pendingPayment('pi_overpay_a');const second=randomUUID();
  await cluster.admin.query("INSERT INTO app.payments(company_id,id,order_id,connection_id,external_payment_id,status,amount) VALUES ($1,$2,$3,$4,'pi_overpay_b','PENDING',1070)",[A,second,original.order,ids.connection]);
  const results=await Promise.all([post(event('evt_overpay_a','pi_overpay_a')),post(event('evt_overpay_b','pi_overpay_b'))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(await count('payments',"order_id=$1 AND status='SUCCEEDED'",[original.order]),1);
});
test('expired abandoned claim can be reclaimed, while completed keys persist without TTL expiry',async()=>{
  const raw=event('evt_abandoned');const {canonical,sha256}=await import('../../apps/api/src/http/json.js');
  await cluster.admin.query("INSERT INTO app.idempotency_keys(company_id,scope,key,request_sha256,locked_until,expires_at) VALUES ($1,$2,'evt_abandoned',$3,now()-interval '1 second','infinity')",[A,`webhook:STRIPE:${ids.connection}`,sha256(canonical(JSON.parse(raw)))]);
  assert.equal((await post(raw)).status,200);
  const expiry=(await cluster.admin.query("SELECT expires_at::text FROM app.idempotency_keys WHERE key='evt_abandoned'")).rows[0]?.expires_at;assert.equal(expiry,'infinity');
});
test('2C2P PGW verifies HS256, merchant identity, long JWT and stable transaction identity',async()=>{
  const connection=randomUUID(),route=randomUUID();await cluster.admin.query("INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,webhook_route_id,credentials_secret_ref) VALUES ($1,$2,'2C2P','merchant-fixture',$3,'env:TWO_FIXTURE')",[A,connection,route]);
  const payload={merchantID:'merchant-fixture',invoiceNo:'ORDER-0',tranRef:'ref-fixture',respCode:'1001',amount:'1070.00',currencyCode:'THB',transactionDateTime:'20240229000100',respDesc:'Pending',extra:'x'.repeat(600)};
  const signed=await new SignJWT(payload).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode(twoSecret));
  const url=`${base}/webhooks/2c2p/${A}/${route}`;
  const send=(jwt:string):Promise<Response>=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payload:jwt})});
  assert.equal((await send(signed)).status,200);
  const retry=await new SignJWT(payload).setIssuedAt().setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode(twoSecret));assert.equal((await send(retry)).status,200);
  const forged=await new SignJWT(payload).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode('different-key'));
  assert.equal((await send(forged)).status,401);
  const wrongMerchant=await new SignJWT({...payload,merchantID:'other-company'}).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode(twoSecret));
  assert.equal((await send(wrongMerchant)).status,401);
});
test('Omise ignores unsigned delivery data and verifies event and charge before capturing customer advances',async()=>{
  const connection=randomUUID(),route=randomUUID(),order=randomUUID(),payment=randomUUID();
  await cluster.admin.query("INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,webhook_route_id,credentials_secret_ref) VALUES ($1,$2,'OMISE','omise-fixture',$3,'env:OMISE_FIXTURE')",[A,connection,route]);
  await cluster.admin.query('INSERT INTO app.gateway_account_mappings(company_id,connection_id,clearing_account_id,receivable_account_id,advance_account_id) VALUES ($1,$2,$3,$4,$5)',[A,connection,ids.accounts.clearing,ids.accounts.receivable,ids.accounts.liability]);
  await cluster.admin.query("INSERT INTO app.orders(company_id,id,order_number,source,status) VALUES ($1,$2,'OMISE-ORDER','WEB','CONFIRMED')",[A,order]);
  await cluster.admin.query("INSERT INTO app.order_items(company_id,order_id,line_number,product_id,description,quantity,unit_price_ex_vat,vat_amount) VALUES ($1,$2,1,$3,'Advance',2,500,70)",[A,order,ids.product]);
  await cluster.admin.query("INSERT INTO app.payments(company_id,id,order_id,connection_id,external_payment_id,status,amount) VALUES ($1,$2,$3,$4,'chrg_test_fixture','PENDING',1070)",[A,payment,order,connection]);
  const charge={id:'chrg_test_fixture',amount:214000,captured_amount:107000,currency:'THB',paid:true,status:'successful',paid_at:'2024-02-28T17:00:00Z',livemode:false};
  const remoteEvent={id:'evnt_test_fixture',key:'charge.complete',livemode:false,data:charge};
  const originalFetch=globalThis.fetch;let eventReads=0,chargeReads=0;
  globalThis.fetch=async(input,init)=>{
    const url=input instanceof Request?input.url:String(input);
    if(url==='https://api.omise.co/events/evnt_test_fixture'){eventReads++;assert.ok(init?.headers);return Response.json(remoteEvent);}
    if(url==='https://api.omise.co/charges/chrg_test_fixture'){chargeReads++;return Response.json(charge);}
    return originalFetch(input,init);
  };
  try{
    const response=await fetch(`${base}/webhooks/omise/${A}/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'evnt_test_fixture',data:{amount:99999999}})});
    assert.equal(response.status,200);assert.equal(eventReads,1);assert.equal(chargeReads,1);
  }finally{globalThis.fetch=originalFetch;}
  const line=(await cluster.admin.query("SELECT a.reporting_group,l.credit::text FROM app.payments p JOIN app.journal_lines l ON l.company_id=p.company_id AND l.journal_entry_id=p.settlement_journal_id JOIN app.accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE p.id=$1 AND l.credit>0",[payment])).rows[0];
  assert.equal(line?.reporting_group,'OTHER_LIABILITY');assert.equal(line?.credit,'1070.00');
  assert.equal(await count('journal_entries',"source_kind='ORDER' AND source_id=$1",[order]),0);
});
test('posted credit notes reduce revenue/COGS, while refunds change collection only',async()=>{
  const cn=randomUUID();const entry=await journal(cluster.admin,'CREDIT_NOTE',cn,[
    {account:ids.accounts.sales,debit:'500',credit:'0'},{account:ids.accounts.vat,debit:'35',credit:'0'},
    {account:ids.accounts.receivable,debit:'0',credit:'535'},{account:ids.accounts.inventory,debit:'200',credit:'0'},{account:ids.accounts.cogs,debit:'0',credit:'200'}]);
  await cluster.admin.query("INSERT INTO app.credit_notes(company_id,id,order_id,credit_note_number,recognized_on,reason,journal_entry_id) VALUES ($1,$2,$3,'CN-1','2024-02-29','Return',$4)",[A,cn,ids.order,entry]);
  await cluster.admin.query('INSERT INTO app.credit_note_items(company_id,credit_note_id,order_item_id,quantity,net_amount,vat_amount,restored_cogs,restock) VALUES ($1,$2,$3,1,500,35,200,true)',[A,cn,ids.item]);
  const result=await db.runAsTenant(A,()=>calculateActualProfit(A,ids.order));assert.equal(result.netRevenueExVat,'500.00');assert.equal(result.netCogs,'200.00');assert.equal(result.netProfit,'193.32');
  assert.equal(result.cash.netGatewayCollected,'1070.00');
  const refund=randomUUID();const refundJournal=await journal(cluster.admin,'REFUND',refund,[{account:ids.accounts.receivable,debit:'535',credit:'0'},{account:ids.accounts.clearing,debit:'0',credit:'535'}]);
  await cluster.admin.query("INSERT INTO app.refunds(company_id,id,payment_id,credit_note_id,external_refund_id,amount,refunded_at,settlement_journal_id) VALUES ($1,$2,$3,$4,'refund-fixture',535,now(),$5)",[A,refund,ids.payment,cn,refundJournal]);
  const after=await db.runAsTenant(A,()=>calculateActualProfit(A,ids.order));assert.equal(after.netProfit,result.netProfit);assert.equal(after.cash.netGatewayCollected,'535.00');
});
test('unrecognized orders, nonexistent orders and users without finance permission are rejected',async()=>{
  const draft=randomUUID();await cluster.admin.query("INSERT INTO app.orders(company_id,id,order_number,source) VALUES ($1,$2,'DRAFT-CHECK','WEB')",[A,draft]);
  await assert.rejects(db.runAsTenant(A,()=>calculateActualProfit(A,draft)),/recognized sale/);
  await assert.rejects(db.runAsTenant(A,()=>calculateActualProfit(A,randomUUID())),/not visible/);
  const userWithoutRole=randomUUID();await cluster.admin.query("INSERT INTO app.users(company_id,id,auth_issuer,auth_subject,email,display_name) VALUES ($1,$2,'https://identity.test','no-role','norole@example.test','No role')",[A,userWithoutRole]);
  const jwt=await new SignJWT({company_id:A}).setProtectedHeader({alg:'RS256',kid:'integration-key'}).setIssuer(jwtConfig.issuer).setAudience(jwtConfig.audience).setSubject('no-role').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  assert.equal((await fetch(`${base}/api/orders/${ids.order}/profit`,{headers:{authorization:`Bearer ${jwt}`}})).status,403);
});
test('source sale without its posted journal is rejected, even with a valid cost snapshot',async()=>{
  const id=randomUUID();await cluster.admin.query("INSERT INTO app.orders(company_id,id,order_number,source) VALUES ($1,$2,'UNPOSTED','WEB')",[A,id]);
  await cluster.admin.query("INSERT INTO app.order_items(company_id,order_id,line_number,product_id,description,quantity,unit_price_ex_vat,cost_version_id,unit_cost_snapshot) VALUES ($1,$2,1,$3,'Unposted',1,500,$4,200)",[A,id,ids.product,ids.cost]);
  await cluster.admin.query("UPDATE app.orders SET status='RECOGNIZED',recognized_at='2024-03-01 00:00+07' WHERE company_id=$1 AND id=$2",[A,id]);
  await assert.rejects(db.runAsTenant(A,()=>calculateActualProfit(A,id)),/reconcile/);
});
