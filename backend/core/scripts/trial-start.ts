import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
const root=fileURLToPath(new URL('../',import.meta.url)),configPath=root+'.local/runtime.json';
const children:ChildProcess[]=[];let stopping=false,ready=false,webhookActive=false,url='',failure='',healthTimer:ReturnType<typeof setInterval>|undefined;
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const occupied=(port:number)=>new Promise<boolean>(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
interface Config{companyId:string;adminPassword:string;env:Record<string,string>}
async function load():Promise<Config>{return JSON.parse(await readFile(configPath,'utf8')) as Config;}
function launch(args:string[],env:NodeJS.ProcessEnv=process.env,cwd=root):ChildProcess{
 const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});children.push(child);
 child.once('error',()=>stop('เปิดโปรแกรมประกอบไม่สำเร็จ'));
 child.once('exit',()=>{if(!stopping)stop('โปรแกรมประกอบหยุด กรุณาเปิด npm run ops:start ใหม่');});return child;
}
function stop(message?:string):void{if(stopping)return;stopping=true;ready=false;if(healthTimer)clearInterval(healthTimer);if(message){failure=message;console.error(message);process.exitCode=1;}for(const child of children)child.kill();guard.close();}
const guard=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({application:'mona-trial',ready,url,failure}));});
process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
async function check(target:string,expected=200):Promise<void>{const response=await fetch(target,{signal:AbortSignal.timeout(8000)});if(response.status!==expected)throw new Error('Service unavailable');}
async function waitFor(target:string,expected=200):Promise<void>{for(let attempt=0;attempt<30;attempt++){if(stopping)throw new Error('Startup stopped');try{await check(target,expected);return;}catch{await pause(500);}}throw new Error('Service startup timed out');}
async function connectLine(origin:string):Promise<void>{
 const config=await load(),db=new pg.Client({host:'127.0.0.1',port:55432,user:'postgres',database:'mona_ops',password:config.adminPassword});await db.connect();
 let row:{credentials_secret_ref:string;external_account_id:string;webhook_route_id:string};
 try{const rows=(await db.query<typeof row>("SELECT credentials_secret_ref,external_account_id,webhook_route_id FROM app.integration_connections WHERE company_id=$1 AND provider='LINE' AND is_active",[config.companyId])).rows;if(rows.length!==1)throw new Error('ต้องตั้งค่าบอทใหม่หนึ่งตัวก่อน');row=rows[0]!;}finally{await db.end();}
 const secret=JSON.parse(config.env[row.credentials_secret_ref.replace(/^env:/,'')]??'{}') as {accessToken:string;channelSecret:string};
 if(!secret.accessToken||!secret.channelSecret)throw new Error('ต้องตั้งค่า Token และ Secret ก่อน');
 const endpoint=origin+'/webhooks/line/'+config.companyId+'/'+row.webhook_route_id,body=JSON.stringify({destination:row.external_account_id,events:[]});
 for(let attempt=0;;attempt++){try{
  const probe=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':createHmac('sha256',secret.channelSecret).update(body).digest('base64')},body,signal:AbortSignal.timeout(10000)});if(probe.status!==200)throw new Error('HTTPS ยังไม่พร้อม');break;
 }catch(error){if(attempt>=40)throw error instanceof Error?new Error('HTTPS probe failed: '+error.message):new Error('HTTPS probe failed');await pause(3000);}}
 await check(origin+'/',404);await check(origin+'/api/core/auth/login',404);
 const headers={Authorization:'Bearer '+secret.accessToken,'Content-Type':'application/json'};
 const updated=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{method:'PUT',headers,body:JSON.stringify({endpoint}),signal:AbortSignal.timeout(10000)});if(!updated.ok)throw new Error('ตั้ง LINE Webhook ไม่สำเร็จ');
 const tested=await fetch('https://api.line.me/v2/bot/channel/webhook/test',{method:'POST',headers,body:JSON.stringify({endpoint}),signal:AbortSignal.timeout(20000)});
 const result=await tested.json() as {success?:boolean};if(!tested.ok||!result.success)throw new Error('LINE ทดสอบ Webhook ไม่ผ่าน');
 const status=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{headers,signal:AbortSignal.timeout(8000)});if(!status.ok)throw new Error('ตรวจสถานะ LINE ไม่สำเร็จ');const setting=await status.json() as {active:boolean};
 const latest=await load();latest.env['PUBLIC_WEB_URL']=origin;const temporary=configPath+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(latest,null,2),{mode:0o600});await rename(temporary,configPath);
 url=origin;webhookActive=setting.active;ready=setting.active;failure=setting.active?'':'ยังต้องเปิด Use webhook ใน LINE Developers';
 console.log(setting.active?'พร้อมทดลองในกลุ่ม LINE แล้ว ✅':'HTTPS ผ่านแล้ว แต่ยังต้องเปิด Use webhook ใน LINE Developers');
 console.log('หน้าเว็บในเครื่อง: http://localhost:3000');console.log('HTTPS เฉพาะ Webhook: '+origin);console.log('เปิดหน้าต่างนี้ค้างไว้ระหว่างทดลอง กด Ctrl+C เพื่อหยุดเว็บและการเชื่อมต่อ');
}
async function main():Promise<void>{
 if(await occupied(3006)){const response=await fetch('http://127.0.0.1:3006',{signal:AbortSignal.timeout(2000)});const state=await response.json() as {application:string;ready:boolean;failure:string};if(state.application!=='mona-trial')throw new Error('พอร์ต 3006 ถูกใช้โดยโปรแกรมอื่น');console.log(state.ready?'ระบบเปิดอยู่แล้ว ใช้ http://localhost:3000 ได้เลย':'ระบบกำลังเปิดหรือรอการตั้งค่า: '+state.failure);return;}
 await new Promise<void>((resolve,reject)=>{guard.once('error',reject);guard.listen(3006,'127.0.0.1',resolve);});
 console.log('กำลังเปิดฐานข้อมูล…');
 await new Promise<void>((resolve,reject)=>{const setup=spawn(process.execPath,[root+'node_modules/tsx/dist/cli.mjs',root+'scripts/local.ts','setup'],{cwd:root,stdio:'inherit',windowsHide:true});setup.once('error',reject);setup.once('exit',code=>code===0?resolve():reject(new Error('เปิดฐานข้อมูลไม่สำเร็จ')));});
 const config=await load();const webRunning=await occupied(3000),apiRunning=await occupied(3001);
 if(webRunning!==apiRunning)throw new Error('มีเว็บหรือ API เปิดค้างบางส่วน กรุณาปิดหน้าต่าง ops:start เดิมก่อน');
 if(webRunning){await check('http://127.0.0.1:3001/health/live');const html=await(await fetch('http://127.0.0.1:3000')).text();if(!html.includes('MONA'))throw new Error('พอร์ต 3000 ไม่ใช่เว็บ MONA');console.log('ใช้เว็บ MONA ที่เปิดอยู่แล้ว');}
 else{launch([root+'dist/apps/api/src/server.js'],{...process.env,...config.env,LOCAL_RUNTIME_FILE:configPath});launch([root+'apps/web/node_modules/next/dist/bin/next','start','-p','3000','-H','127.0.0.1'],{...process.env,TZ:'Asia/Bangkok'},root+'apps/web');}
 await waitFor('http://127.0.0.1:3001/health/live');await waitFor('http://127.0.0.1:3000');
 if(await occupied(3005))throw new Error('พอร์ต Webhook 3005 เปิดค้างอยู่ กรุณาปิด ops:line-tunnel เดิมก่อน');
 launch([root+'node_modules/tsx/dist/cli.mjs',root+'scripts/line-webhook-tunnel.ts','--proxy-only']);await waitFor('http://127.0.0.1:3005',404);
 const tunnel=spawn(root+'.local/cloudflared.exe',['tunnel','--url','http://127.0.0.1:3005','--no-autoupdate'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(tunnel);
 let buffer='',started=false;const consume=(chunk:Buffer):void=>{buffer=(buffer+chunk.toString()).slice(-16000);const found=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(found&&!started){started=true;void connectLine(found[0]).catch(error=>stop(error instanceof Error?'ตรวจ LINE/HTTPS ไม่ผ่าน: '+error.message:'ตรวจ LINE/HTTPS ไม่ผ่าน กรุณาเปิดใหม่หรือตรวจ Token และอินเทอร์เน็ต'));}};
 tunnel.stdout?.on('data',consume);tunnel.stderr?.on('data',consume);tunnel.once('error',()=>stop('เปิด cloudflared ไม่สำเร็จ'));tunnel.once('exit',()=>{if(!stopping)stop('ช่องรับ LINE หยุด กรุณาเปิดระบบใหม่');});
 const deadline=setTimeout(()=>{if(!url&&!stopping)stop('HTTPS เปิดไม่สำเร็จภายในสองนาที');},210000);deadline.unref();
 let checking=false;healthTimer=setInterval(()=>{if(!url||stopping||checking)return;checking=true;void Promise.all([check('http://127.0.0.1:3001/health/live'),check(url+'/',404)]).then(()=>{if(failure==='การเชื่อมต่อขาดช่วง'){console.log('การเชื่อมต่อกลับมาแล้ว');failure=webhookActive?'':'ยังต้องเปิด Use webhook ใน LINE Developers';ready=webhookActive;}}).catch(()=>{if(failure!=='การเชื่อมต่อขาดช่วง')console.error('การเชื่อมต่อขาดช่วง อย่าเพิ่งส่งคำขอ');failure='การเชื่อมต่อขาดช่วง';ready=false;}).finally(()=>{checking=false;});},30000);
}
void main().catch(error=>stop(error instanceof Error?error.message:'เปิดระบบไม่สำเร็จ'));



