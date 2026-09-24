import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { OrdersUploadStore, ImportError } from './lib/orders-upload-store.mjs';
import { parseTrialRows } from './lib/marketplace-trial-parser.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ui=resolve(root,'scripts/orders-trial-ui');
const owner='local-mo';
export function createTrialServer({ dbPath, port=4179 } = {}) {
  if (process.env.VERCEL || process.env.NODE_ENV==='production') throw new Error('Local trial only');
  const path=dbPath || resolve(root,'tmp/orders-sqlite/ui-trial-v1.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
  const store=new OrdersUploadStore(path), token=randomBytes(32).toString('hex');
  let origin;
  const server=createServer(async(req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
    const json=(code,data) => {res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if (req.headers.host !== new URL(origin).host) return json(403,{error:'Host not allowed'});
      if (req.headers.origin && req.headers.origin !== origin) return json(403,{error:'Origin not allowed'});
      const url=new URL(req.url,origin);
      const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      if (req.method==='GET' && assets[url.pathname]) {
        const [file,type]=assets[url.pathname]; let body=readFileSync(resolve(ui,file),'utf8');
        if (file==='index.html') body=body.replace('__TRIAL_TOKEN__',token);
        res.writeHead(200,{'Content-Type':type});return res.end(body);
      }
      if (req.method==='GET' && url.pathname==='/xlsx.js') {
        res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(readFileSync(resolve(root,'node_modules/xlsx/dist/xlsx.full.min.js')));
      }
      if (req.headers['x-trial-token'] !== token) return json(403,{error:'เปิดหน้าทดลองใหม่เพื่อยืนยันการเชื่อมต่อ'});
      if (req.method==='GET' && url.pathname==='/trial/state') {
        const uploads=store.db.prepare('SELECT id,status FROM uploads WHERE owner=? ORDER BY rowid DESC LIMIT 20').all(owner);
        return json(200,{mode:'LOCAL TRIAL',totals:store.totals(),uploads:uploads.map(x=>store.status(owner,x.id))});
      }
      if (req.method!=='POST') return json(404,{error:'Not found'});
      if (req.headers.origin !== origin || !String(req.headers['content-type']).startsWith('application/json')) return json(403,{error:'Same-origin JSON required'});
      let size=0; const parts=[];
      for await (const chunk of req) {size+=chunk.length;if(size>50_000_000) throw new ImportError('INVALID','ไฟล์ใหญ่เกิน 50 MB');parts.push(chunk);}
      let body; try {body=JSON.parse(Buffer.concat(parts).toString('utf8'));} catch {throw new ImportError('INVALID','JSON ไม่ถูกต้อง');}
      if (url.pathname==='/trial/parse') return json(200,parseTrialRows(body.rows,body));
      if (url.pathname==='/trial/create') return json(200,{id:store.create(owner,body.requestKey,body.manifest)});
      if (url.pathname==='/trial/chunk') return json(200,store.putChunk(owner,body.id,body.index,body.rows));
      if (url.pathname==='/trial/finalize') return json(200,store.finalize(owner,body.id));
      return json(404,{error:'Not found'});
    } catch(e) {return json(e instanceof ImportError ? 400:500,{code:e.code || 'ERROR',error:e instanceof ImportError ? e.message:'เกิดข้อผิดพลาดในฐานทดลอง ข้อมูลจริงไม่ได้ถูกเชื่อมต่อ'});}
  });
  return {
    store,
    async start() { await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});origin=`http://127.0.0.1:${server.address().port}`;return origin; },
    async close() { await new Promise(ok=>server.close(ok));store.close(); },
  };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createTrialServer();
  console.log(`PAYI LOCAL TRIAL — ${await app.start()} — no Sheets/Turso connection`);
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
}
