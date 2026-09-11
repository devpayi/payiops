import { mkdir, writeFile, unlink, readFile, access } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { TenantDatabase } from '../../packages/db/src/index.js';
const exec=promisify(execFile);
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function testDatabase():Promise<{admin:pg.Client;db:TenantDatabase;url:string;close:()=>Promise<void>}> {
  const native=path.join(root,'database/tests/node_modules/@embedded-postgres/windows-x64/native/bin');
  const initdb=path.join(native,'initdb.exe'),ctl=path.join(native,'pg_ctl.exe');
  await access(initdb);
  const password=randomBytes(24).toString('hex'),dataDir=path.join(root,'.local',`core-test-${randomUUID()}`);
  const passwordFile=path.join(root,'.local',`password-${randomUUID()}`);
  await mkdir(dataDir,{recursive:true});
  await writeFile(passwordFile,password,{mode:0o600});
  try {await exec(initdb,['-D',dataDir,'--username=postgres','--auth=scram-sha-256',`--pwfile=${passwordFile}`,'--encoding=UTF8','--locale=C'],{windowsHide:true});}
  finally {await unlink(passwordFile);}
  const control=(args:string[]):Promise<void>=>new Promise((resolve,reject)=>{
    const process=spawn(ctl,args,{stdio:'ignore',windowsHide:true});
    process.once('error',reject);process.once('exit',code=>code===0?resolve():reject(new Error(`pg_ctl ${code}: ${dataDir}/server.log`)));
  });
  const port=55440;
  await control(['-D',dataDir,'-l',path.join(dataDir,'server.log'),'-o',`-p ${port} -c listen_addresses=127.0.0.1 -c timezone=UTC`,'start','-w','-t','30']);
  const admin=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
  await admin.connect();
  try {
    for(const migration of ['bootstrap.sql','migrations/0001_initial.sql','migrations/0002_backend_core.sql','migrations/0003_procurement.sql']) {
      if(migration==='migrations/0002_backend_core.sql'){
        const tenant='30000000-0000-4000-8000-000000000003';
        await admin.query("INSERT INTO app.companies(company_id,slug,legal_name) VALUES ($1,'migration-probe','Migration probe')",[tenant]);
        await admin.query("INSERT INTO app.idempotency_keys(company_id,scope,key,request_sha256,status,response_status,response_body,locked_until,expires_at) VALUES ($1,'migration','legacy',repeat('a',64),'COMPLETED',200,'{\"ok\":true}',now(),'infinity')",[tenant]);
      }
      await admin.query(await readFile(path.join(root,'database',migration),'utf8'));
    }
    await admin.query(`CREATE ROLE core_runtime_login LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT`);
    await admin.query('GRANT cmo_runtime TO core_runtime_login');
    const url=`postgresql://core_runtime_login:${password}@127.0.0.1:${port}/postgres`;
    const db=new TenantDatabase({connectionString:url,max:8,onPoolError:()=>{}});
    await db.verifyRuntimeRole();
    return {admin,db,url,close:async()=>{await db.close();await admin.end();await control(['-D',dataDir,'stop','-m','fast','-w','-t','30']);}};
  } catch(error){await admin.end();await control(['-D',dataDir,'stop','-m','fast','-w','-t','30']);throw error;}
}
