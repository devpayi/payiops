import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import * as XLSX from 'xlsx';
import { createTrialServer } from '../scripts/orders-trial-server.mjs';
import { parseTrialRows } from '../scripts/lib/marketplace-trial-parser.mjs';
import { hash } from '../scripts/lib/orders-upload-store.mjs';

const fixtures={
  Shopee:{'หมายเลขคำสั่งซื้อ':'S-0001','วันที่ทำการสั่งซื้อ':'03/08/2026','ชื่อสินค้า':'ตัวอย่าง','จำนวน':'2','ราคาขายสุทธิ':'199.50','สถานะคำสั่งซื้อ':'สำเร็จ','เลขอ้างอิง SKU (SKU Reference No.)':'A'},
  'TikTok Shop':{'Order ID':'T-0001','Created Time':'2026-08-03 10:00','Product Name':'ตัวอย่าง','Quantity':'2','SKU Subtotal After Discount':'199.50','SKU Subtotal Before Discount':'999','Order Status':'Completed','Seller SKU':'A'},
  Lazada:{orderNumber:'L-0001',orderItemId:'0002',createTime:'2026-08-03',itemName:'ตัวอย่าง',quantity:'2',paidPrice:'199.50',status:'delivered',sellerSku:'A'},
};
for(const [platform,row] of Object.entries(fixtures)) test(`XLSX round trip and parser: ${platform}`,()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([row]),'Orders');
  const back=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const input=XLSX.utils.sheet_to_json(back.Sheets.Orders,{raw:false,defval:''});
  const result=parseTrialRows(input,{platform,business:'Payi'});
  assert.equal(result.summary.cents,19950);assert.equal(result.summary.units,2);
  assert.equal(result.rows[0][3],'2026-08-03');assert.equal(result.summary.unmapped,1);
});
test('ambiguous order-level revenue and invalid rows are not silently imported',()=>{
  const a={...fixtures['TikTok Shop']};delete a['SKU Subtotal After Discount'];a['Order Amount']='500';
  assert.throws(()=>parseTrialRows([a,a],{platform:'TikTok Shop',business:'Payi'}),/ยอดต่อรายการ/);
  const bad={...fixtures.Shopee,'จำนวน':''};
  assert.throws(()=>parseTrialRows([bad],{platform:'Shopee',business:'Payi'}),/แถว 2/);
});
test('UTF-8 CSV preserves Thai headers and text order identifiers',()=>{
  const csv='หมายเลขคำสั่งซื้อ,วันที่ทำการสั่งซื้อ,ชื่อสินค้า,จำนวน,ราคาขายสุทธิ,สถานะคำสั่งซื้อ\n000123,2026-08-03,สินค้าภาษาไทย,1,99.50,สำเร็จ';
  const book=XLSX.read(csv,{type:'string',raw:true});
  const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{raw:false,defval:''});
  const p=parseTrialRows(rows,{platform:'Shopee',business:'Payi'});
  assert.equal(p.rows[0][1],'000123');assert.equal(p.rows[0][7],'สินค้าภาษาไทย');assert.equal(p.summary.cents,9950);
});
test('isolated HTTP flow blocks foreign origin/missing token and imports only to trial',async t=>{
  const app=createTrialServer({dbPath:':memory:',port:0});const origin=await app.start();t.after(()=>app.close());
  const html=await(await fetch(origin)).text();assert.match(html,/ไม่มีการเชื่อมต่อ Google Sheets/);
  const token=html.match(/name="trial-token" content="([a-f0-9]+)"/)[1];
  assert.equal((await fetch(origin+'/trial/state')).status,403);
  assert.equal((await fetch(origin+'/trial/state',{headers:{'x-trial-token':token,Origin:'https://other.example'}})).status,403);
  const badHost=await new Promise((ok,no)=>{const req=request(origin+'/trial/state',{headers:{Host:'evil.example','x-trial-token':token}},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});req.on('error',no);req.end();});
  assert.equal(badHost,403);
  assert.equal((await fetch(origin+'/api/import-orders',{headers:{'x-trial-token':token}})).status,404);
  async function post(path,body){const res=await fetch(origin+'/trial/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'x-trial-token':token},body:JSON.stringify(body)});assert.equal(res.status,200,await res.clone().text());return res.json();}
  const p=await post('parse',{rows:[fixtures.Shopee],platform:'Shopee',business:'Payi'});
  assert.equal(app.store.totals().rows,0);
  const {id}=await post('create',{requestKey:'http-test',manifest:{platform:'Shopee',business:'Payi',parserVersion:'sheet-v3',expectedChunks:1,expectedRows:1,payloadHash:hash(p.rows)}});
  await post('chunk',{id,index:0,rows:p.rows});assert.equal(app.store.totals().rows,0);
  const result=await post('finalize',{id});assert.equal(result.inserted,1);
  assert.equal(app.store.totals().cents,19950);
  assert.equal((await post('finalize',{id})).inserted,1);assert.equal(app.store.totals().rows,1);
});
