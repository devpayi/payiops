import { access, mkdir, readFile, writeFile, unlink, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, randomUUID, generateKeyPairSync, scryptSync, createHash } from 'node:crypto';
import pg from 'pg';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url)),local=path.join(root,'.local'),configFile=path.join(local,'runtime.json');
const fullBinary=path.join(local,'postgresql/runtime/pgsql/bin');
const binary=existsSync(path.join(fullBinary,'pg_dump.exe'))?fullBinary:path.join(root,'database/tests/node_modules/@embedded-postgres/windows-x64/native/bin'),data=path.join(local,'postgres'),port=55432;
interface Config {companyId:string;userId:string;adminPassword:string;runtimePassword:string;env:Record<string,string>}
async function control(args:string[]):Promise<number>{return new Promise((resolve,reject)=>{const p=spawn(path.join(binary,'pg_ctl.exe'),args,{stdio:'ignore',windowsHide:true});p.once('error',reject);p.once('exit',code=>resolve(code??1));});}
async function start():Promise<void>{if(await control(['-D',data,'status'])!==0&&await control(['-D',data,'-l',path.join(local,'postgres.log'),'-o',`-p ${port} -c listen_addresses=127.0.0.1 -c timezone=Asia/Bangkok`,'start','-w','-t','30'])!==0)throw new Error('PostgreSQL startup failed; inspect .local/postgres.log');}
async function config():Promise<Config>{return JSON.parse(await readFile(configFile,'utf8')) as Config;}
async function setup():Promise<void>{
 await access(path.join(binary,'initdb.exe'));await mkdir(local,{recursive:true});
 let c:Config;
 try{c=await config();}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  const keys=generateKeyPairSync('rsa',{modulusLength:3072}),kid=randomUUID(),companyId=randomUUID(),userId=randomUUID(),runtimePassword=randomBytes(32).toString('hex');
  c={companyId,userId,adminPassword:randomBytes(32).toString('hex'),runtimePassword,env:{DATABASE_URL:`postgresql://mona_runtime:${runtimePassword}@127.0.0.1:${port}/mona_ops`,JWT_ISSUER:'mona-local',JWT_AUDIENCE:'mona-core',JWT_PUBLIC_JWK:JSON.stringify({...keys.publicKey.export({format:'jwk'}),kid,alg:'RS256'}),LOCAL_JWT_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),LOCAL_JWT_KEY_ID:kid,LOCAL_COMPANY_IDS:companyId,PUBLIC_WEB_URL:'http://localhost:3000',LINE_SEND_ENABLED:'false',PORT:'3001',HOST:'127.0.0.1',TZ:'Asia/Bangkok'}};
  await writeFile(configFile,JSON.stringify(c,null,2),{mode:0o600,flag:'wx'});
 }
 try{await access(path.join(data,'PG_VERSION'));}catch{
  const passwordFile=path.join(local,'init-password');await writeFile(passwordFile,c.adminPassword,{mode:0o600});
  try{await exec(path.join(binary,'initdb.exe'),['-D',data,'-U','postgres','--auth=scram-sha-256',`--pwfile=${passwordFile}`,'--encoding=UTF8','--locale=C'],{windowsHide:true});}finally{await unlink(passwordFile);}
 }
 await start();
 const admin=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:c.adminPassword,database:'postgres'});await admin.connect();
 try{if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='mona_ops'")).rowCount)await admin.query('CREATE DATABASE mona_ops');}finally{await admin.end();}
 const db=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:c.adminPassword,database:'mona_ops'});await db.connect();
 try{
  await db.query('CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of ['bootstrap.sql','migrations/0001_initial.sql','migrations/0002_backend_core.sql','migrations/0003_procurement.sql']){
   const source=await readFile(path.join(root,'database',name),'utf8'),hash=createHash('sha256').update(source).digest('hex'),old=await db.query<{sha256:string}>('SELECT sha256 FROM public.schema_migrations WHERE name=$1',[name]);
   if(old.rows[0]){if(old.rows[0].sha256!==hash)throw new Error('Applied migration changed: '+name);continue;}
   await db.query(source.replace(/COMMIT;\s*$/,`SET LOCAL ROLE NONE;\nINSERT INTO public.schema_migrations(name,sha256) VALUES(${pg.escapeLiteral(name)},${pg.escapeLiteral(hash)});\nCOMMIT;`));
  }
  if(!(await db.query("SELECT 1 FROM pg_roles WHERE rolname='mona_runtime'")).rowCount)await db.query(`CREATE ROLE mona_runtime LOGIN PASSWORD ${pg.escapeLiteral(c.runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT`);
  await db.query('GRANT cmo_runtime TO mona_runtime');
  if(!(await db.query('SELECT 1 FROM app.companies WHERE company_id=$1',[c.companyId])).rowCount){
   const password=randomBytes(18).toString('base64url'),salt=randomBytes(24).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
   await db.query('BEGIN');try{
    await db.query("INSERT INTO app.companies(company_id,slug,legal_name) VALUES($1,'mona','MONA')",[c.companyId]);
    await db.query("INSERT INTO app.users(company_id,id,auth_issuer,auth_subject,email,display_name) VALUES($1,$2,'mona-local','owner','owner@local.invalid','เจ้าของร้าน')",[c.companyId,c.userId]);
    await db.query('INSERT INTO app.local_credentials(company_id,user_id,password_hash,salt) VALUES($1,$2,$3,$4)',[c.companyId,c.userId,hash,salt]);
    const grants:Record<string,string[]>={OWNER:['procurement.read','procurement.request','procurement.manage','finance.profit.read','finance.manage','users.manage'],BOSS:['procurement.read','procurement.request','procurement.manage'],STAFF:['procurement.read','procurement.request'],FINANCE:['procurement.read','procurement.request','finance.profit.read','finance.manage']};
    for(const permission of grants['OWNER']!)await db.query('INSERT INTO app.permissions(company_id,code,description) VALUES($1,$2,$2)',[c.companyId,permission]);
    for(const[role,permissions]of Object.entries(grants)){
     const roleId=randomUUID();await db.query('INSERT INTO app.roles(company_id,id,code,name) VALUES($1,$2,$3,$3)',[c.companyId,roleId,role]);
     await db.query('INSERT INTO app.role_permissions(company_id,role_id,permission_id) SELECT $1,$2,id FROM app.permissions WHERE company_id=$1 AND code=ANY($3::text[])',[c.companyId,roleId,permissions]);
     if(role==='OWNER')await db.query('INSERT INTO app.user_roles(company_id,user_id,role_id,granted_by) VALUES($1,$2,$3,$2)',[c.companyId,c.userId,roleId]);
    }
    const accounts:Record<string,string>={};
    for(const[code,name,type,group]of [['1000','เงินสด / ธนาคาร','ASSET','CASH'],['1100','ลูกหนี้','ASSET','RECEIVABLE'],['1200','สินค้าคงเหลือ','ASSET','INVENTORY'],['2100','เจ้าหนี้จัดซื้อ','LIABILITY','PAYABLE'],['2200','ภาษีขาย','LIABILITY','OUTPUT_VAT'],['3000','ทุน','EQUITY','EQUITY'],['4100','รายได้ขาย','REVENUE','SALES'],['5100','ต้นทุนขาย','EXPENSE','COGS'],['5200','ค่าธรรมเนียม','EXPENSE','GATEWAY_FEES'],['5300','ค่าโฆษณา','EXPENSE','AD_SPEND'],['5400','ค่าใช้จ่ายคงที่','EXPENSE','FIXED_COST'],['5500','ค่าใช้จ่ายจิปาถะ','EXPENSE','OTHER_EXPENSE']]){
     const account=randomUUID();accounts[group!]=account;await db.query('INSERT INTO app.accounts(company_id,id,code,name,account_type,reporting_group) VALUES($1,$2,$3,$4,$5,$6)',[c.companyId,account,code,name,type,group]);
    }
    await db.query('INSERT INTO app.procurement_accounts(company_id,expense_account_id,payable_account_id,cash_account_id) VALUES($1,$2,$3,$4)',[c.companyId,accounts['OTHER_EXPENSE'],accounts['PAYABLE'],accounts['CASH']]);
    await writeFile(path.join(local,'owner-login.txt'),`MONA Local Operations\nURL: http://localhost:3000\nCompany ID: ${c.companyId}\nUsername: owner\nPassword: ${password}\n\nKeep this file private. No sales or opening balances have been imported.\n`,{mode:0o600,flag:'wx'});
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}
  }
 }finally{await db.end();}
 await mkdir(path.join(root,'apps/web'),{recursive:true});
 await writeFile(path.join(root,'apps/web/.env.local'),`CORE_URL=http://127.0.0.1:3001\nNEXT_PUBLIC_COMPANY_ID=${c.companyId}\nTZ=Asia/Bangkok\n`,{mode:0o600});
 console.log('Local PostgreSQL ready on 127.0.0.1:55432. Login details: backend/core/.local/owner-login.txt');
}
async function backup():Promise<void>{
 const c=await config();await start();const folder=path.join(local,'backups',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(folder,{recursive:true});
 await exec(path.join(binary,'pg_dump.exe'),['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','mona_ops','-Fc','-f',path.join(folder,'database.dump')],{env:{...process.env,PGPASSWORD:c.adminPassword},windowsHide:true});
 await copyFile(configFile,path.join(folder,'runtime.json'));const dump=await readFile(path.join(folder,'database.dump'));
 await writeFile(path.join(folder,'SHA256.txt'),createHash('sha256').update(dump).digest('hex')+'  database.dump\n');
 console.log('Backup saved under backend/core/.local/backups. Contains credentials; keep private and copy to another disk.');
}
async function verifyBackup():Promise<void>{
 const c=await config(),folders=(await readdir(path.join(local,'backups'))).sort(),latest=folders.at(-1);
 if(!latest)throw new Error('No backup available');const folder=path.join(local,'backups',latest),dump=path.join(folder,'database.dump');
 const expected=(await readFile(path.join(folder,'SHA256.txt'),'utf8')).split(' ')[0];
 if(createHash('sha256').update(await readFile(dump)).digest('hex')!==expected)throw new Error('Backup checksum mismatch');
 const name='mona_restore_'+randomBytes(8).toString('hex'),admin=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:c.adminPassword,database:'postgres'});await admin.connect();
 try{await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  try{await exec(path.join(binary,'pg_restore.exe'),['-h','127.0.0.1','-p',String(port),'-U','postgres','-d',name,'--exit-on-error',dump],{env:{...process.env,PGPASSWORD:c.adminPassword},windowsHide:true});
   const restored=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:c.adminPassword,database:name});await restored.connect();
   try{const result=await restored.query('SELECT count(*) AS n FROM app.companies');if(Number(result.rows[0]?.n)<1)throw new Error('Restored database has no companies');}finally{await restored.end();}
   console.log('Backup SHA256 verified and restored successfully into an isolated temporary database.');
  }finally{if(!/^mona_restore_[a-f0-9]{16}$/.test(name))throw new Error('Unsafe temporary database name');await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)}`);}
 }finally{await admin.end();}
}
async function startAI(c:Config):Promise<ReturnType<typeof spawn>|undefined>{
 if(!c.env['OLLAMA_URL']||!c.env['OLLAMA_MODEL'])return undefined;
 try{const response=await fetch(c.env['OLLAMA_URL']+'/api/version',{signal:AbortSignal.timeout(1500)});if(response.ok)return undefined;}catch{}
 const executable=path.join(local,'ollama/runtime/ollama.exe');await access(executable);
 const child=spawn(executable,['serve'],{cwd:local,env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_MODELS:path.join(local,'ollama/models'),OLLAMA_NO_CLOUD:'1',OLLAMA_CONTEXT_LENGTH:'2048'},stdio:'ignore',windowsHide:true});
 child.once('error',()=>{console.error('Local AI did not start; requests will require manual categorization.');});return child;
}
const action=process.argv[2];
if(action==='setup')await setup();
else if(action==='backup')await backup();
else if(action==='verify-backup')await verifyBackup();
else if(action==='stop'){if(await control(['-D',data,'stop','-m','fast','-w'])!==0)throw new Error('PostgreSQL stop failed');}
else if(action==='start'){
 const c=await config();await start();const ai=await startAI(c);
 const api=spawn(process.execPath,[path.join(root,'dist/apps/api/src/server.js')],{cwd:root,env:{...process.env,...c.env,LOCAL_RUNTIME_FILE:configFile},stdio:'inherit',windowsHide:true});
 const web=spawn(process.execPath,[path.join(root,'apps/web/node_modules/next/dist/bin/next'),'start','-p','3000','-H','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:{...process.env,PUBLIC_WEB_URL:c.env['PUBLIC_WEB_URL'],TZ:'Asia/Bangkok'},stdio:'inherit',windowsHide:true});
 const close=():void=>{api.kill();web.kill();ai?.kill();};process.once('SIGINT',close);process.once('SIGTERM',close);
 api.once('exit',code=>{if(code)process.exitCode=code;web.kill();ai?.kill();});web.once('exit',code=>{if(code)process.exitCode=code;api.kill();ai?.kill();});
}else throw new Error('Usage: local.ts setup|start|stop|backup');
