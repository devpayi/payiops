import { spawn } from 'node:child_process';
import { generateKeyPair,exportJWK,exportPKCS8,createLocalJWKSet } from 'jose';
import { testDatabase } from '../tests/helpers/postgres.js';
import { fixtures,A,ids } from '../tests/helpers/fixtures.js';
import { hashPassword } from '../apps/api/src/modules/auth.js';
import { createApp } from '../apps/api/src/app.js';
import { randomUUID } from 'node:crypto';
import { access,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const cluster=await testDatabase();await fixtures(cluster.admin);
const hash=await hashPassword('Mona-ui-test-only-2026!');
await cluster.admin.query('INSERT INTO app.local_credentials(company_id,user_id,password_hash,salt) VALUES($1,$2,$3,$4)',[A,ids.user,hash.hash,hash.salt]);
const role=(await cluster.admin.query<{role_id:string}>('SELECT role_id FROM app.user_roles WHERE company_id=$1 AND user_id=$2',[A,ids.user])).rows[0]!.role_id;
for(const code of ['procurement.read','procurement.request','procurement.manage','finance.manage','users.manage']){const permission=randomUUID();await cluster.admin.query('INSERT INTO app.permissions(company_id,id,code,description) VALUES($1,$2,$3,$3)',[A,permission,code]);await cluster.admin.query('INSERT INTO app.role_permissions(company_id,role_id,permission_id) VALUES($1,$2,$3)',[A,role,permission]);}
await cluster.admin.query("INSERT INTO app.payees(company_id,id,kind,name) VALUES($1,$2,'SUPPLIER','ร้านทดสอบ UI ห้ามโอนเงินจริง')",[A,randomUUID()]);
const keys=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(keys.publicKey);jwk.kid='ui-check';
const jwt={issuer:'https://identity.test',audience:'ui-check',key:createLocalJWKSet({keys:[jwk]})};
const server=createApp({db:cluster.db,jwt,secrets:async()=>{throw new Error('No live integrations in UI tests');},localAuth:{privateKey:await exportPKCS8(keys.privateKey),kid:'ui-check',issuer:jwt.issuer,audience:jwt.audience}}).listen(3003,'127.0.0.1');
const web=spawn(process.execPath,[fileURLToPath(new URL('../apps/web/node_modules/next/dist/bin/next',import.meta.url)),'start','-p','3002','-H','127.0.0.1'],{cwd:new URL('../apps/web/',import.meta.url),env:{...process.env,CORE_URL:'http://127.0.0.1:3003'},stdio:'inherit',windowsHide:true});
let stopping=false;
async function stop():Promise<void>{if(stopping)return;stopping=true;clearInterval(timer);web.kill();await new Promise<void>(r=>server.close(()=>r()));await cluster.close();}
const timer=setInterval(()=>{void access('.local/ui-check.stop').then(async()=>{await unlink('.local/ui-check.stop');await stop();}).catch(()=>{});},1000);
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
web.once('exit',()=>{void stop();});
console.log('Isolated UI test: http://localhost:3002 — company '+A+' — employee-1 — password is the fixture in scripts/ui-check.ts');
