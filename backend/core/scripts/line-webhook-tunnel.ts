import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLineWebhookPath(path:string):boolean{
 const parts=path.split('/');
 return parts.length===5&&parts[0]===''&&parts[1]==='webhooks'&&parts[2]==='line'&&uuid.test(parts[3]??'')&&uuid.test(parts[4]??'');
}

const server=createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const path=req.url??'';
 const accepted=req.method==='POST'&&isLineWebhookPath(path);
 console.log(JSON.stringify({event:'line_ingress_request',method:req.method,path,accepted}));
 if(!accepted){res.writeHead(404).end();req.resume();return;}
 const started=Date.now();
 const signature=req.headers['x-line-signature'];
 if(typeof signature!=='string'||signature.length>256){console.warn(JSON.stringify({event:'line_ingress_rejected',reason:'missing_signature',path}));res.writeHead(401).end();req.resume();return;}
 if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json'||(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')){console.warn(JSON.stringify({event:'line_ingress_rejected',reason:'content_type',path,contentType:req.headers['content-type']}));res.writeHead(415).end();req.resume();return;}
 try{
  let length=0;const chunks:Buffer[]=[];
  for await(const data of req){
   const part:Buffer=Buffer.isBuffer(data)?data:Buffer.from(data as string);
   length+=part.length;
   if(length>262144){console.warn(JSON.stringify({event:'line_ingress_rejected',reason:'body_too_large',path,length}));res.writeHead(413).end();req.destroy();return;}
   chunks.push(part);
  }
  console.log(JSON.stringify({event:'line_ingress_received',path,length}));
  const body=Buffer.concat(chunks);
  const response=await fetch('http://127.0.0.1:3001'+path,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':signature},body,redirect:'error',signal:AbortSignal.timeout(10000)});
  const responseBody=Buffer.from(await response.arrayBuffer());
  console.log(JSON.stringify({event:'line_ingress_forwarded',path,status:response.status,ms:Date.now()-started}));
  res.writeHead(response.status,{'Content-Type':'application/json'});res.end(responseBody);
 }catch(error){console.error(JSON.stringify({event:'line_ingress_failed',path,message:error instanceof Error?error.message:'unknown'}));if(!res.headersSent)res.writeHead(502);res.end();}
});

server.listen(3005,'127.0.0.1',()=>{
 console.log('Webhook-only ingress v3 on 127.0.0.1:3005; all UI, catalog and API routes are blocked.');
 if(process.argv.includes('--proxy-only'))return;
 const child=spawn(fileURLToPath(new URL('../.local/cloudflared.exe',import.meta.url)),['tunnel','--url','http://127.0.0.1:3005','--no-autoupdate'],{stdio:'inherit',windowsHide:true});
 const stop=():void=>{child.kill();server.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 child.once('error',()=>{console.error('Cloudflared could not start');server.close();process.exitCode=1;});child.once('exit',()=>server.close());
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
