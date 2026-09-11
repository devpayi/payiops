import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initdb, pg_ctl } from '@embedded-postgres/windows-x64';
import pg from 'pg';

const root = fileURLToPath(new URL('../../', import.meta.url));
const password = randomBytes(32).toString('hex');
const port = 55439;
const dataDir = path.join(root, '.local', `schema-test-${randomUUID()}`);
await mkdir(dataDir, { recursive: true });
const exec = promisify(execFile);
// Windows daemon processes may inherit pipe handles. pg_ctl's exit, rather
// than inherited stream closure, determines completion; PostgreSQL logs to file.
function control(args) {
  return new Promise((resolve,reject) => {
    const child = spawn(pg_ctl,args,{windowsHide:true,stdio:'ignore'});
    child.once('error',reject);
    child.once('exit',code => code === 0 ? resolve() : reject(new Error(`pg_ctl exited ${code}; see ${dataDir}/server.log`)));
  });
}
const passwordFile = path.join(root,'.local',`pg-test-password-${randomUUID()}`);
const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
let started = false;
let connected = false;
const results = [];
const A = '10000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000002';
const user = randomUUID();
const prodA = randomUUID();
const prodB = randomUUID();
const cost = randomUUID();
const order = randomUUID();
const item = randomUUID();
const account1 = randomUUID();
const account2 = randomUUID();
async function query(sql, args) { return client.query(sql, args); }
function pass(name) { results.push(name); console.log(`PASS ${name}`); }
async function tenant(company, fn, role = 'cmo_runtime') {
  await query('BEGIN');
  try {
    await query(`SET LOCAL ROLE ${role}`);
    if (company) await query("SELECT set_config('app.company_id',$1,true)", [company]);
    await fn();
    await query('COMMIT');
  } catch (e) { await query('ROLLBACK'); throw e; }
}
async function rejects(name, sql, args, code) {
  await query('SAVEPOINT expected_failure');
  let thrown;
  try { await query(sql,args); } catch (e) { thrown = e; }
  await query('ROLLBACK TO SAVEPOINT expected_failure');
  assert.ok(thrown, `Expected rejection: ${name}`);
  assert.equal(thrown.code,code, thrown.message);
  pass(name);
}
try {
  await writeFile(passwordFile,password,{mode:0o600});
  try {
    await exec(initdb,['-D',dataDir,'--username=postgres','--auth=scram-sha-256',
      `--pwfile=${passwordFile}`,'--encoding=UTF8','--locale=C'],{windowsHide:true});
  } finally { await unlink(passwordFile); }
  await control(['-D',dataDir,'-l',path.join(dataDir,'server.log'),'-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c timezone=Asia/Bangkok`,
    'start','-w','-t','30']); started = true;
  await client.connect(); connected = true;
  await query(await readFile(path.join(root,'database/bootstrap.sql'),'utf8'));
  await query(await readFile(path.join(root,'database/migrations/0001_initial.sql'),'utf8'));
  pass('Bootstrap and migration execute on real PostgreSQL');
  const version = (await query('SELECT version()')).rows[0].version;
  assert.equal((await query('SHOW timezone')).rows[0].TimeZone,'Asia/Bangkok');
  pass('Database timezone is Asia/Bangkok');
  const tables = (await query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='app'")).rows[0].n;
  assert.equal((await query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity")).rows[0].n,tables);
  pass(`All ${tables} tables ENABLE and FORCE RLS`);
  assert.equal((await query(`SELECT count(*)::int AS n FROM information_schema.tables t
    WHERE t.table_schema='app' AND NOT EXISTS (SELECT FROM information_schema.columns c
    WHERE c.table_schema=t.table_schema AND c.table_name=t.table_name AND c.column_name='company_id' AND c.is_nullable='NO')`)).rows[0].n,0);
  pass('Every table has mandatory company_id');
  assert.equal((await query(`SELECT count(*)::int AS n FROM pg_constraint c
    JOIN pg_namespace ns ON ns.oid=c.connamespace WHERE ns.nspname='app' AND c.contype='f'
    AND NOT EXISTS (SELECT FROM unnest(c.conkey,c.confkey) AS k(local_key,remote_key)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.local_key
    JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.remote_key
    WHERE a.attname='company_id' AND b.attname='company_id')`)).rows[0].n,0);
  pass('Every foreign key includes company_id on both sides');
  await query('INSERT INTO app.companies(company_id,slug,legal_name) VALUES ($1,\'company-a\',\'A\'),($2,\'company-b\',\'B\')',[A,B]);
  await query("INSERT INTO app.users(company_id,id,auth_issuer,auth_subject,email,display_name) VALUES ($1,$2,'https://id.example.test','employee','employee@example.test','Employee')",[A,user]);
  await query("INSERT INTO app.products(company_id,id,sku,slug,name,price_ex_vat) VALUES ($1,$2,'SKU-A','item-a','Item A',100),($3,$4,'SKU-B','item-b','Item B',100)",[A,prodA,B,prodB]);
  await tenant(null,async () => {
    assert.equal((await query('SELECT * FROM app.products')).rowCount,0);
    pass('Missing tenant context reads zero rows');
    await rejects('Missing context blocks writes',"INSERT INTO app.products(company_id,sku,slug,name,price_ex_vat) VALUES ($1,'X','x','X',1)",[A],'42501');
  });
  await tenant(A,async () => {
    assert.deepEqual((await query('SELECT id FROM app.products')).rows.map(r=>r.id),[prodA]);
    pass('Query without WHERE cannot see another tenant');
    assert.equal((await query('UPDATE app.products SET name=\'hidden\' WHERE company_id=$1',[B])).rowCount,0);
    pass('Cross-tenant update affects zero rows');
    await rejects('Cross-tenant insert denied',"INSERT INTO app.products(company_id,sku,slug,name,price_ex_vat) VALUES ($1,'X','x','X',1)",[B],'42501');
    await rejects('Cross-tenant foreign key rejected',"INSERT INTO app.product_costs(company_id,product_id,valid_from,unit_cost,reason,created_by) VALUES ($1,$2,'2026-01-01+07',10,'initial',$3)",[A,prodB,user],'23503');
    await rejects('TRUNCATE is denied','TRUNCATE app.audit_logs',[],'42501');
    await rejects('Runtime cannot create tables','CREATE TABLE app.forbidden (n int)',[],'42501');
    await rejects('Runtime cannot change companies',"UPDATE app.companies SET legal_name='changed'",[],'42501');
    await query("INSERT INTO app.product_costs(company_id,id,product_id,valid_from,unit_cost,reason,created_by) VALUES ($1,$2,$3,'2026-01-01 00:00+07',40,'initial',$4)",[A,cost,prodA,user]);
    await rejects('Overlapping cost ranges rejected',"INSERT INTO app.product_costs(company_id,product_id,valid_from,unit_cost,reason,created_by) VALUES ($1,$2,'2026-02-01 00:00+07',50,'overlap',$3)",[A,prodA,user],'23P01');
    await query("UPDATE app.product_costs SET valid_to='2026-02-01 00:00+07' WHERE company_id=$1 AND id=$2",[A,cost]);
    await query("INSERT INTO app.product_costs(company_id,product_id,valid_from,unit_cost,reason,created_by) VALUES ($1,$2,'2026-02-01 00:00+07',50,'next',$3)",[A,prodA,user]);
    assert.equal((await query("SELECT unit_cost FROM app.product_costs WHERE valid_during @> '2026-02-01 00:00+07'::timestamptz")).rows[0].unit_cost,'50.000000');
    pass('Adjacent half-open cost ranges select exactly the new cost');
    await query("INSERT INTO app.orders(company_id,id,order_number,source) VALUES ($1,$2,'ORD-1','WEB')",[A,order]);
    await query("INSERT INTO app.order_items(company_id,id,order_id,line_number,product_id,description,quantity,unit_price_ex_vat) VALUES ($1,$2,$3,1,$4,'Item A',2,100)",[A,item,order,prodA]);
    await rejects('Recognition without cost snapshot rejected',"UPDATE app.orders SET status='RECOGNIZED',recognized_at='2026-01-15 00:30+07' WHERE id=$1",[order],'23514');
    await query('UPDATE app.order_items SET cost_version_id=$1,unit_cost_snapshot=40 WHERE id=$2',[cost,item]);
    await query("UPDATE app.orders SET status='RECOGNIZED',recognized_at='2026-01-15 00:30+07' WHERE id=$1",[order]);
    assert.equal((await query("SELECT recognition_date::text AS d FROM app.orders WHERE id=$1",[order])).rows[0].d,'2026-01-15');
    pass('Recognition uses Bangkok business date across UTC midnight');
    await rejects('Recognized item cannot change','UPDATE app.order_items SET quantity=3 WHERE id=$1',[item],'23514');
    await rejects('Historical cost amount cannot change','UPDATE app.product_costs SET unit_cost=41 WHERE id=$1',[cost],'23514');
    await rejects('Cost interval cannot exclude recognized sale',"UPDATE app.product_costs SET valid_to='2026-01-10 00:00+07' WHERE id=$1",[cost],'23514');
    await query("INSERT INTO app.accounts(company_id,id,code,name,account_type,reporting_group) VALUES ($1,$2,'1100','Receivable','ASSET','RECEIVABLE'),($1,$3,'4100','Sales','REVENUE','SALES')",[A,account1,account2]);
    const entry = randomUUID();
    await query("INSERT INTO app.journal_entries(company_id,id,entry_number,source_kind,source_id,source_event_key,accounting_date,description) VALUES ($1,$2,'JE-1','ORDER',$3,'recognize','2026-01-15','sale')",[A,entry,order]);
    await query("INSERT INTO app.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit) VALUES ($1,$2,1,$3,'receivable',200)",[A,entry,account1]);
    await query("SAVEPOINT bad_balance");
    await query("UPDATE app.journal_entries SET status='POSTED',posted_at=now() WHERE id=$1",[entry]);
    let imbalance;
    try { await query('SET CONSTRAINTS ALL IMMEDIATE'); } catch (e) { imbalance=e; }
    await query('ROLLBACK TO SAVEPOINT bad_balance');
    assert.equal(imbalance?.code,'23514'); pass('Deferred constraint rejects unbalanced posting');
    await query("INSERT INTO app.journal_lines(company_id,journal_entry_id,line_number,account_id,description,credit) VALUES ($1,$2,2,$3,'sales',200)",[A,entry,account2]);
    await query("UPDATE app.journal_entries SET status='POSTED',posted_at=now() WHERE id=$1",[entry]);
    await query('SET CONSTRAINTS ALL IMMEDIATE');
    pass('Balanced journal posts successfully');
    await rejects('Posted journal cannot change',"UPDATE app.journal_entries SET description='edited' WHERE id=$1",[entry],'23514');
    await rejects('Posted lines cannot change','UPDATE app.journal_lines SET debit=201 WHERE journal_entry_id=$1 AND line_number=1',[entry],'23514');
    await rejects('Used account cannot change reporting classification',"UPDATE app.accounts SET reporting_group='SALES_RETURNS' WHERE id=$1",[account2],'23514');
    await rejects('Journal source cannot post twice',"INSERT INTO app.journal_entries(company_id,entry_number,source_kind,source_id,source_event_key,accounting_date,description) VALUES ($1,'JE-2','ORDER',$2,'recognize','2026-01-15','duplicate')",[A,order],'23505');
    const connection = randomUUID();
    await query("INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,credentials_secret_ref) VALUES ($1,$2,'STRIPE','acct_test','vault://test/stripe')",[A,connection]);
    const webhookSql = "INSERT INTO app.webhook_events(company_id,connection_id,provider_event_id,event_type,payload_sha256,payload,signature_verified_at) VALUES ($1,$2,'evt_once','payment.succeeded',repeat('a',64),'{}',now())";
    await query(webhookSql,[A,connection]);
    await rejects('Webhook event identity is unique',webhookSql,[A,connection],'23505');
    const payee = randomUUID();
    const batch = randomUUID();
    const payout = randomUUID();
    const request = randomUUID();
    await query("INSERT INTO app.payees(company_id,id,kind,name,user_id) VALUES ($1,$2,'EMPLOYEE','Employee',$3)",[A,payee,user]);
    await query("INSERT INTO app.procurement_batches(company_id,id,business_date) VALUES ($1,$2,'2026-01-15')",[A,batch]);
    await query("INSERT INTO app.procurement_payouts(company_id,id,batch_id,payee_id,payment_method,amount,destination_ref_snapshot) VALUES ($1,$2,$3,$4,'REIMBURSEMENT',100,'vault://test/payee')",[A,payout,batch,payee]);
    await query("INSERT INTO app.purchase_requests(company_id,id,request_number,requested_by,title,suggested_location,payment_method,payee_id,estimated_amount) VALUES ($1,$2,'PR-1',$3,'กระดาษ','LOCAL_SHOP','REIMBURSEMENT',$4,100)",[A,request,user,payee]);
    const batchItemSql = 'INSERT INTO app.procurement_batch_items(company_id,payout_id,request_id,amount) VALUES ($1,$2,$3,100)';
    await query(batchItemSql,[A,payout,request]);
    await rejects('Request cannot enter two active payout items',batchItemSql,[A,payout,request],'23505');
    await rejects('Paid payout requires journal and payment evidence',"UPDATE app.procurement_payouts SET status='PAID',paid_at=now() WHERE id=$1",[payout],'23514');
    await rejects('Unknown procurement location is rejected',"UPDATE app.purchase_requests SET suggested_location='UNKNOWN' WHERE id=$1",[request],'23514');
    await rejects('File object key must use tenant prefix',"INSERT INTO app.files(company_id,object_key,original_name,media_type,byte_size,sha256,uploaded_by) VALUES ($1,$2,'bill.png','image/png',100,repeat('a',64),$3)",[A,`${B}/bill.png`,user],'23514');
    await rejects('Company row cannot change timezone',"UPDATE app.companies SET timezone='UTC' WHERE company_id=$1",[A],'42501');
    await query("INSERT INTO app.audit_logs(company_id,action,entity_type,entity_id) VALUES ($1,'TEST','ORDER',$2)",[A,order]);
    await rejects('Audit history cannot be deleted','DELETE FROM app.audit_logs',[],'42501');
  });
  await tenant(A,async () => {
    assert.equal((await query('SELECT * FROM app.products')).rowCount,1);
    pass('FORCE RLS also constrains table owner');
  },'cmo_owner');
  await tenant(B,async () => {
    assert.deepEqual((await query('SELECT id FROM app.products')).rows.map(r=>r.id),[prodB]);
    pass('Reused connection switches tenant without stale visibility');
  });
  await tenant(null,async () => {
    assert.equal((await query('SELECT * FROM app.products')).rowCount,0);
    pass('SET LOCAL tenant context expires after transaction');
  });
  const report = `# Schema verification\n\nExecuted: ${new Date().toISOString()}\n\nEngine: ${version}\n\n${results.length} checks passed.\n\n${results.map(r=>`- PASS: ${r}`).join('\n')}\n\nScope: real PostgreSQL schema and integrity tests; no application, gateway, AI or LINE integration tests in step 1.\n`;
  await writeFile(path.join(root,'database/tests/RESULTS.md'),report);
  console.log(`${results.length} checks passed`);
} finally {
  if (connected) await client.end();
  if (started) await control(['-D',dataDir,'stop','-m','fast','-w','-t','30']);
}
