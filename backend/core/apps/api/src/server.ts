import { readFile } from 'node:fs/promises';
import { createLocalJWKSet } from 'jose';
import { TenantDatabase } from '../../../packages/db/src/index.js';
import { createApp } from './app.js';
import { remoteJwtKey } from './middleware/tenant.js';
import { environmentSecrets } from './modules/integrations/verification.js';
import { ProcurementService } from './modules/procurement/service.js';
import { ProcurementLine, startProcurementScheduler } from './modules/procurement/line.js';

function required(name:string):string {
  const value=process.env[name];
  if (!value) throw new Error(`Required configuration missing: ${name}`);
  return value;
}
process.env['TZ']='Asia/Bangkok';
const databaseUrl=required('DATABASE_URL');
const parsed=new URL(databaseUrl);
const local=['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
if (!local && [...parsed.searchParams.keys()].some(key=>key.startsWith('ssl'))) throw new Error('Use DATABASE_CA_FILE for verified TLS; URL SSL overrides are not allowed');
const caFile=process.env['DATABASE_CA_FILE'];
const db=new TenantDatabase({connectionString:databaseUrl,
  ssl:local?false:{rejectUnauthorized:true,...(caFile?{ca:await readFile(caFile,'utf8')}:{})},
  onPoolError:error=>{console.error(JSON.stringify({event:'database_pool_error',name:error.name}));},
});
await db.verifyRuntimeRole();
const publicJwk=process.env['JWT_PUBLIC_JWK'];
if (publicJwk && process.env['JWT_JWKS_URL']) throw new Error('Configure only one JWT key source');
const key=publicJwk ? createLocalJWKSet({keys:[JSON.parse(publicJwk)]}) : remoteJwtKey(required('JWT_JWKS_URL'));
const classifier={...(process.env['OLLAMA_URL']?{ollamaUrl:process.env['OLLAMA_URL']}:{}),...(process.env['OLLAMA_MODEL']?{model:process.env['OLLAMA_MODEL']}:{})};
const publicWebUrl=process.env['PUBLIC_WEB_URL']??'http://localhost:3000';
const localAuth=process.env['LOCAL_JWT_PRIVATE_KEY']?{privateKey:process.env['LOCAL_JWT_PRIVATE_KEY'],kid:required('LOCAL_JWT_KEY_ID'),issuer:required('JWT_ISSUER'),audience:required('JWT_AUDIENCE')}:undefined;
const app=createApp({db,jwt:{issuer:required('JWT_ISSUER'),audience:required('JWT_AUDIENCE'),key},secrets:environmentSecrets,classifier,publicWebUrl,...(localAuth?{localAuth}:{})});
const stopScheduler=startProcurementScheduler(new ProcurementLine(new ProcurementService(db,classifier),environmentSecrets,publicWebUrl),(process.env['LOCAL_COMPANY_IDS']??'').split(',').filter(Boolean),process.env['LINE_SEND_ENABLED']==='true');
const port=Number(process.env['PORT'] ?? '3001');
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PORT');
const server=app.listen(port,process.env['HOST'] ?? '127.0.0.1',()=>{console.info(JSON.stringify({event:'api_listening',port,timezone:'Asia/Bangkok'}));});
server.requestTimeout=30_000; server.headersTimeout=15_000; server.keepAliveTimeout=5_000;
let stopping=false;
async function shutdown():Promise<void> {
  if (stopping) return; stopping=true;
  stopScheduler();
  const timeout=setTimeout(()=>{server.closeAllConnections();},30_000);timeout.unref();
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  clearTimeout(timeout);await db.close();
}
for (const signal of ['SIGTERM','SIGINT'] as const) process.once(signal,()=>{void shutdown().catch(()=>{process.exitCode=1;});});
