import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../helpers/postgres.js';
import { fixtures,A,B,ids } from '../helpers/fixtures.js';
import { LineNotes, noteSummaryRound } from '../../apps/api/src/modules/procurement/line-notes.js';
import { sql } from '../../packages/db/src/index.js';
import type { JsonObject } from '../../apps/api/src/http/json.js';
let cluster:Awaited<ReturnType<typeof testDatabase>>,notes:LineNotes;
const connection={id:randomUUID(),external_account_id:'bot-id'},boss='boss-line',group='store-group',sender='employee-line';
const sent:{replyToken:string;messages:{text:string}[]}[]=[];
let failReply=false;
const scope=<T>(work:()=>Promise<T>)=>cluster.db.runAsTenant(A,work);
before(async()=>{cluster=await testDatabase();await fixtures(cluster.admin);
 const role=(await cluster.admin.query<{role_id:string}>('SELECT role_id FROM app.user_roles WHERE company_id=$1 AND user_id=$2',[A,ids.user])).rows[0]!.role_id,p=randomUUID();
 await cluster.admin.query("INSERT INTO app.permissions(company_id,id,code,description) VALUES($1,$2,'procurement.manage','Manage')",[A,p]);await cluster.admin.query('INSERT INTO app.role_permissions(company_id,role_id,permission_id) VALUES($1,$2,$3)',[A,role,p]);
 await cluster.admin.query("INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,credentials_secret_ref) VALUES($1,$2,'LINE','bot-id','env:TEST')",[A,connection.id]);
 await cluster.admin.query('INSERT INTO app.line_recipients(company_id,connection_id,line_user_id,user_id) VALUES($1,$2,$3,$4)',[A,connection.id,boss,ids.user]);
 notes=new LineNotes(cluster.db,async(_url,init)=>{const body=JSON.parse(String(init?.body)) as typeof sent[number];if(failReply)return new Response(null,{status:503});
  const existing=await cluster.admin.query('SELECT 1 FROM app.line_notes WHERE company_id=$1',[A]);assert.ok(existing.rowCount,'ack must follow committed storage');sent.push(body);return Response.json({});});
});
after(async()=>{await cluster.close();});
function message(text:string,user=sender,extra:Record<string,unknown>={}):JsonObject{return{type:'message',webhookEventId:randomUUID(),timestamp:Date.now(),source:{type:'group',groupId:group,userId:user},message:{type:'text',id:randomUUID(),text,quoteToken:'quote-'+randomUUID(),mention:{mentionees:[{type:'user',isSelf:true,index:0,length:text.split(' ')[0]!.length}]},...extra} as JsonObject};}
async function handle(e:JsonObject){return scope(()=>notes.handle(e,connection,'test-token'));}
test('any employee binds the first group; a native mention survives bot rename',async()=>{
 await handle(message('@เหมียว'));assert.equal((await cluster.admin.query('SELECT * FROM app.line_notes')).rowCount,0);
 await handle(message('@เหมียว',boss));
 await handle(message('@ชื่อใหม่ พี่หยกสั่งกล่องถุงเท้าส้นให้ด้วยค่ะ'));
 const row=(await cluster.admin.query<{original_text:string}>('SELECT original_text FROM app.line_notes')).rows[0];assert.equal(row?.original_text,'@ชื่อใหม่ พี่หยกสั่งกล่องถุงเท้าส้นให้ด้วยค่ะ');
 const e=message('@เหมียว ซื้อของ');(e['source'] as JsonObject)['groupId']='other-group';await handle(e);assert.equal((await cluster.admin.query('SELECT * FROM app.line_notes')).rowCount,1);
});
test('ordinary chat, fake name mentions and images are ignored',async()=>{
 const e=message('@เหมียว คุยเล่น');(e['message'] as JsonObject)['mention']={mentionees:[{type:'user',isSelf:false}]};await handle(e);
 const image=message('@เหมียว');(image['message'] as JsonObject)['type']='image';assert.equal(await handle(image),false);
 assert.equal((await cluster.admin.query('SELECT * FROM app.line_notes')).rowCount,1);
});
test('concurrent redelivery stores one note and acknowledges with short text after commit',async()=>{
 const e=message('@เหมียว ถุง 200 ใบ');e['replyToken']='one-reply';await Promise.all([handle(e),handle(e)]);
 const m=e['message'] as JsonObject;assert.equal((await cluster.admin.query('SELECT * FROM app.line_notes WHERE message_id=$1',[m['id']])).rowCount,1);
 assert.ok(sent.every(r=>r.messages.length===1&&r.messages[0]?.text==='จดแล้ว'));
 const count=(await cluster.admin.query('SELECT * FROM app.line_notes')).rowCount;
 await cluster.db.runAsTenant(B,async()=>assert.equal((await cluster.db.query(sql`SELECT * FROM app.line_notes`)).rowCount,0));assert.equal(count,2);
});
test('quoted changes preserve original text and amendments; only requester or boss can amend',async()=>{
 const original=message('@เหมียว ถุงแบบเดิม');await handle(original);const mid=(original['message'] as JsonObject)['id'];
 const change=message('@เหมียว เปลี่ยนเป็น 300 ใบ',sender,{quotedMessageId:mid});change['timestamp']=Number(original['timestamp'])+1;await handle(change);
 let row=(await cluster.admin.query<{amendments:string[];status:string}>('SELECT amendments,status FROM app.line_notes WHERE message_id=$1',[mid])).rows[0]!;assert.equal(row.amendments[0],'@เหมียว เปลี่ยนเป็น 300 ใบ');
 const bad=message('@เหมียว ยกเลิก','someone-else',{quotedMessageId:mid});bad['timestamp']=Number(original['timestamp'])+2;await handle(bad);
 const cancel=message('@เหมียว ยกเลิก',sender,{quotedMessageId:mid});cancel['timestamp']=Number(original['timestamp'])+3;await handle(cancel);
 row=(await cluster.admin.query<{amendments:string[];status:string}>('SELECT amendments,status FROM app.line_notes WHERE message_id=$1',[mid])).rows[0]!;assert.equal(row.status,'CANCELLED');assert.equal(row.amendments.length,2);
});
test('failed acknowledgement keeps note durable and retry does not create another request',async()=>{
 const e=message('@เหมียว อีกกล่อง');e['replyToken']='retry';failReply=true;await assert.rejects(handle(e));failReply=false;await handle(e);
 assert.equal((await cluster.admin.query('SELECT * FROM app.line_notes WHERE message_id=$1',[(e['message'] as JsonObject)['id']])).rowCount,1);
});
test('summary is private and deduplicated; boss action stays private without accounting',async()=>{
 assert.equal(await scope(()=>notes.prepare('2026-09-11')),1);assert.equal(await scope(()=>notes.prepare('2026-09-11')),0);
 const queue=(await cluster.admin.query<{payload:JsonObject}>("SELECT payload FROM app.outbox_events WHERE deduplication_key LIKE 'notes-v2:%'")).rows[0]!.payload;assert.equal(queue['to'],boss);
 const token=JSON.stringify(queue).match(/note:([A-Za-z0-9_-]+)/)?.[1];assert.ok(token);
 const action=(user:string):JsonObject=>({type:'postback',webhookEventId:randomUUID(),source:{type:'user',userId:user},postback:{data:'note:'+token}});
 await handle(action('stranger'));assert.equal((await cluster.admin.query("SELECT * FROM app.line_notes WHERE status='ORDERED'")).rowCount,0);
 const journals=(await cluster.admin.query('SELECT * FROM app.journal_entries')).rowCount;
 await handle(action(boss));await handle(action(boss));
 const dots=(await cluster.admin.query<{payload:{to:string;messages:{text:string;quoteToken:string}[]}}>("SELECT payload FROM app.outbox_events WHERE deduplication_key LIKE 'note-acted:%'")).rows;assert.equal(dots.length,0);
 assert.equal((await cluster.admin.query('SELECT * FROM app.journal_entries')).rowCount,journals);
});

function direct(text:string,user=boss):JsonObject{return {type:'message',webhookEventId:randomUUID(),replyToken:randomUUID(),source:{type:'user',userId:user},message:{type:'text',id:randomUUID(),text}};}
function tokens(value:unknown):{label:string;data:string}[]{
 if(!value||typeof value!=='object')return [];
 const o=value as Record<string,unknown>;
 const own=o['type']==='postback'&&typeof o['data']==='string'&&typeof o['label']==='string'?[{label:o['label'],data:o['data']}]:[];
 return [...own,...Object.values(o).flatMap(tokens)];
}
async function latestCards(){await handle(direct('ต้องสั่ง'));return sent.at(-1)!.messages;}
function click(data:string):JsonObject{return {type:'postback',webhookEventId:randomUUID(),replyToken:randomUUID(),source:{type:'user',userId:boss},postback:{data}};}
test('Bangkok scheduler switches to evening at 17:00 and catches late startup',()=>{
 assert.equal(noteSummaryRound(new Date('2026-09-14T09:59:59+07:00')),null);
 assert.equal(noteSummaryRound(new Date('2026-09-14T10:00:00+07:00')),'morning');
 assert.equal(noteSummaryRound(new Date('2026-09-14T16:59:59+07:00')),'morning');
 assert.equal(noteSummaryRound(new Date('2026-09-14T17:00:00+07:00')),'evening');
 assert.equal(noteSummaryRound(new Date('2026-09-14T20:30:00+07:00')),'evening');
 assert.equal(noteSummaryRound(new Date('2026-09-15T00:00:00+07:00')),null);
});
test('on-demand list is private, vertical, and does not push; redelivery preserves action tokens',async()=>{
 const before=sent.length;await handle(direct('ต้องสั่ง','stranger'));assert.equal(sent.length,before);
 const e=direct('ต้องสั่ง');await handle(e);const first=sent.at(-1)!;await handle(e);assert.deepEqual(sent.at(-1),first);
 const payload=JSON.stringify(first);assert.ok(payload.includes('ทำแล้วทั้งหมด'));assert.ok(payload.includes('"type":"bubble"'));assert.ok(!payload.includes('carousel'));assert.ok(!payload.includes('ติดตาม'));
 assert.equal((await cluster.admin.query("SELECT * FROM app.outbox_events WHERE payload->>'to'=$1",[group])).rowCount,0);
});
test('bulk completion skips edited rows and never includes requests created after the card',async()=>{
 const original=message('@เหมียว bulk original');await handle(original);
 const card=await latestCards(),all=tokens(card).filter(t=>t.label==='ทำแล้วทั้งหมด').at(-1)!;assert.ok(all);
 const newer=message('@เหมียว new after card');await handle(newer);
 const change=message('@เหมียว bulk changed',sender,{quotedMessageId:(original['message'] as JsonObject)['id']});change['timestamp']=Number(original['timestamp'])+10;await handle(change);
 await handle(click(all.data));await handle(click(all.data));
 for(const e of [original,newer])assert.equal((await cluster.admin.query<{status:string}>('SELECT status FROM app.line_notes WHERE message_id=$1',[(e['message'] as JsonObject)['id']])).rows[0]!.status,'OPEN');
 assert.equal(sent.at(-1)!.messages[0]!.text,'รายการเปลี่ยนแปลงหรือจัดการไปแล้ว พิมพ์ “ต้องสั่ง” เพื่อดูรายการล่าสุด');
});
test('snooze hides until tomorrow 17:00 Bangkok and an amendment brings the request back',async()=>{
 const card=await latestCards(),snooze=tokens(card).find(t=>t.label==='เลื่อนเตือน')!;await handle(click(snooze.data));
 const row=(await cluster.admin.query<{id:string;message_id:string;event_timestamp:string;correct:boolean}>("SELECT id,message_id,event_timestamp,snoozed_until=(((now() AT TIME ZONE 'Asia/Bangkok')::date+1+time '17:00') AT TIME ZONE 'Asia/Bangkok') AS correct FROM app.line_notes WHERE snoozed_until IS NOT NULL")).rows[0]!;assert.ok(row.correct);
 const change=message('@เหมียว แก้ไขหลังเลื่อน',sender,{quotedMessageId:row.message_id});change['timestamp']=Number(row.event_timestamp)+1;await handle(change);
 assert.equal((await cluster.admin.query<{snoozed_until:unknown}>('SELECT snoozed_until FROM app.line_notes WHERE id=$1',[row.id])).rows[0]!.snoozed_until,null);
});
test('pickup ends reminders, cancel ends reminders, and neither sends to group',async()=>{
 for(const label of ['รอไปเอา','ยกเลิก']){const card=await latestCards();await handle(click(tokens(card).find(t=>t.label===label)!.data));}
 assert.equal((await cluster.admin.query("SELECT * FROM app.line_notes WHERE status='PICKUP'")).rowCount,1);
 assert.equal((await cluster.admin.query("SELECT * FROM app.outbox_events WHERE payload->>'to'=$1",[group])).rowCount,0);
});
test('morning reminder excludes new requests after previous evening; empty run remains deduplicated',async()=>{
 await cluster.admin.query("UPDATE app.line_notes SET status='ORDERED' WHERE company_id=$1",[A]);
 const old=message('@เหมียว yesterday outstanding');await handle(old);
 await cluster.admin.query("UPDATE app.line_notes SET created_at='2026-09-13T16:00:00+07:00' WHERE message_id=$1",[(old['message'] as JsonObject)['id']]);
 const fresh=message('@เหมียว new morning');await handle(fresh);
 await cluster.admin.query("UPDATE app.line_notes SET created_at='2026-09-14T09:00:00+07:00' WHERE message_id=$1",[(fresh['message'] as JsonObject)['id']]);
 assert.equal(await scope(()=>notes.prepare('2026-09-14','morning',new Date('2026-09-14T10:00:00+07:00'))),1);
 assert.equal(await scope(()=>notes.prepare('2026-09-14','morning')),0);
 const payload=(await cluster.admin.query<{payload:JsonObject}>("SELECT payload FROM app.outbox_events WHERE deduplication_key LIKE 'notes-v2:2026-09-14:morning:%'")).rows[0]!.payload;
 assert.ok(JSON.stringify(payload).includes('yesterday outstanding'));assert.ok(!JSON.stringify(payload).includes('new morning'));
 await cluster.admin.query("UPDATE app.line_notes SET status='ORDERED' WHERE company_id=$1",[A]);
 assert.equal(await scope(()=>notes.prepare('2026-09-14','evening')),0);
 await handle(message('@เหมียว after empty evening'));
 assert.equal(await scope(()=>notes.prepare('2026-09-14','evening')),0);
});

test('more than 25 requests paginate without exceeding LINE reply or bubble limits',async()=>{
 await cluster.admin.query("UPDATE app.line_notes SET status='ORDERED' WHERE company_id=$1",[A]);
 for(let i=0;i<26;i++)await handle(message('@เหมียว '+i+' '+ 'ถุง😀'.repeat(300)));
 const first=await latestCards();assert.equal(first.length,5);
 for(const m of first){const bubble=(m as unknown as JsonObject)['contents'];assert.ok(Buffer.byteLength(JSON.stringify(bubble))<30000);}
 const next=tokens(first).find(t=>t.label==='ดูรายการถัดไป');assert.ok(next);
 await handle(click(next.data));assert.equal(sent.at(-1)!.messages.length,1);
 const all=tokens(sent.at(-1)!.messages).find(t=>t.label==='ทำแล้วทั้งหมด')!;await handle(click(all.data));
 assert.equal((await cluster.admin.query("SELECT * FROM app.line_notes WHERE status='OPEN'")).rowCount,25);
});
