import { randomBytes } from 'node:crypto';
import { sql, type TenantDatabase } from '../../../../../packages/db/src/index.js';
import { sha256, type JsonObject } from '../../http/json.js';
import { HttpError } from '../../http/errors.js';
import { record, string } from './input.js';
import { hasPermission } from './routes.js';
interface Connection {id:string;external_account_id:string}
interface Boss {id:string;user_id:string;line_user_id:string}
interface Note {id:string;group_id:string;message_id:string;requester_line_id:string;original_text:string;quote_token:string|null;amendments:string[];status:string;version:number;track_arrival:boolean;event_timestamp:string}
export class LineNotes {
 constructor(readonly db:TenantDatabase,readonly transport:typeof fetch=fetch){}
 async boss(connection:string):Promise<Boss|undefined>{
  const rows=(await this.db.query<Boss>(sql`SELECT r.id,r.user_id,r.line_user_id FROM app.line_recipients r JOIN app.users u ON u.company_id=r.company_id AND u.id=r.user_id AND u.status='ACTIVE' WHERE r.company_id=${this.db.currentCompanyId()} AND r.connection_id=${connection} AND r.daily_summary_enabled ORDER BY r.id`)).rows;
  if(rows.length!==1)return undefined;
  return await hasPermission(this.db,rows[0]!.user_id,'procurement.manage')?rows[0]:undefined;
 }
 async handle(event:Record<string,unknown>,connection:Connection,accessToken:string):Promise<boolean>{
  const isText=event['type']==='message'&&record(event['message'])['type']==='text';
  const isAction=event['type']==='postback'&&/^(note:|notes-page:)/.test(String(record(event['postback'])['data']));
  if(!isText&&!isAction)return false;
  const source=record(event['source']),company=this.db.currentCompanyId(),eventId=string(event['webhookEventId'],'event id');
  const replies=await this.db.transaction(async()=>{
   await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+connection.id+'notes'},0))`);
   const receipt=(await this.db.query<{reply_messages:JsonObject[]|null}>(sql`SELECT reply_messages FROM app.line_event_receipts WHERE company_id=${company} AND connection_id=${connection.id} AND event_id=${eventId}`)).rows[0];
   if(receipt)return receipt.reply_messages??[];
   const boss=await this.boss(connection.id),text=isText?String(record(event['message'])['text']??''):'';
   let result:string,messages:JsonObject[]=[];
   const pageData=isAction?String(record(event['postback'])['data']):'';
   if((isText&&source['type']==='user'&&text.trim()==='ต้องสั่ง')||/^notes-page:\d{1,8}$/.test(pageData)){
    if(!boss||source['type']!=='user'||source['userId']!==boss.line_user_id)result='NOT_BOSS';
    else {result='SUMMARY';messages=await this.cards(connection.id,boss,new Date(),25,pageData?Number(pageData.slice(11)):0);if(!messages.length)messages=[{type:'text',text:'ไม่มีรายการรอจัดการค่ะ'}];}
   }else{
    result=isText&&source['type']==='user'&&text.includes('note:')?await this.action(event,source,connection,boss,text):isText?await this.message(event,source,connection,boss):await this.action(event,source,connection,boss);
    const feedback:Record<string,string>={NOTE_SAVED:'จดแล้ว',NOTE_CHANGED:'แก้ไขแล้ว',NOTE_CANCELLED:'ยกเลิกแล้ว',ORDERED:'บันทึกว่าสั่งแล้ว',PICKUP:'บันทึกว่ารอไปเอาแล้ว ไม่ต้องยืนยันรับของ',CANCELLED:'ยกเลิกแล้ว',SNOOZE:'เลื่อนเตือนถึงพรุ่งนี้ 17:00 น.',STALE_ACTION:'รายการเปลี่ยนแปลงหรือจัดการไปแล้ว พิมพ์ “ต้องสั่ง” เพื่อดูรายการล่าสุด'};
    let response=feedback[result];
    if(result.startsWith('ALL:')){const [,changed,skipped]=result.split(':');response=`ทำแล้ว ${changed} รายการ`+(skipped!=='0'?` · ข้าม ${skipped} รายการที่เปลี่ยนแปลงแล้ว`:'');}
    if(response)messages=[{type:'text',text:response}];
   }
   await this.db.query(sql`INSERT INTO app.line_event_receipts(company_id,connection_id,event_id,outcome,reply_messages) VALUES(${company},${connection.id},${eventId},${result},${JSON.stringify(messages)}::jsonb)`);
   return messages;
  });
  if(replies.length&&typeof event['replyToken']==='string'){
   // Commit first; redelivery reuses persisted messages and never repeats the mutation.
   const response=await this.transport('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({replyToken:event['replyToken'],messages:replies}),signal:AbortSignal.timeout(8000),redirect:'error'});
   if(!response.ok&&response.status!==400)throw new HttpError(503,'LINE_REPLY_RETRY','LINE acknowledgement unavailable');
   if(!response.ok)console.warn(JSON.stringify({event:'line_note_ack_expired',eventId,status:response.status}));
  }
  return true;
 }

 private async message(event:Record<string,unknown>,source:Record<string,unknown>,connection:Connection,boss:Boss|undefined):Promise<string>{
  if(source['type']!=='group'||typeof source['userId']!=='string'||typeof source['groupId']!=='string')return 'IGNORED';
  const message=record(event['message']),text=string(message['text'],'text',10000),mention=message['mention'];
  const mentions=mention&&typeof mention==='object'&&!Array.isArray(mention)?record(mention)['mentionees']:null;
  if(!Array.isArray(mentions))return 'IGNORED';
  const self=mentions.filter(m=>m&&typeof m==='object'&&!Array.isArray(m)&&m['type']==='user'&&m['isSelf']===true);
  if(!self.length)return 'IGNORED';
  const company=this.db.currentCompanyId(),group=source['groupId'];
  const binding=(await this.db.query<{group_id:string}>(sql`SELECT group_id FROM app.line_shop_groups WHERE company_id=${company} AND connection_id=${connection.id}`)).rows[0];
  // The first real bot mention in a group selects the store group. Later groups stay isolated.
 if(!binding){await this.db.query(sql`INSERT INTO app.line_shop_groups(company_id,connection_id,group_id) VALUES(${company},${connection.id},${group})`);}
  else if(binding.group_id!==group)return 'WRONG_GROUP';
  let command=text;
  const spans=self.map(m=>record(m)).filter(m=>Number.isInteger(m['index'])&&Number.isInteger(m['length'])).sort((a,b)=>Number(b['index'])-Number(a['index']));
  for(const span of spans){const start=Number(span['index']),length=Number(span['length']);if(start>=0&&length>0)command=command.slice(0,start)+command.slice(start+length);}
  command=command.trim();
  if(!command)return 'GROUP_BOUND';
  const timestamp=event['timestamp'];if(typeof timestamp!=='number'||!Number.isSafeInteger(timestamp))throw new HttpError(400,'INVALID_TIMESTAMP','Invalid LINE timestamp');
  if(typeof message['quotedMessageId']==='string'){
   const note=(await this.db.query<Note>(sql`SELECT * FROM app.line_notes WHERE company_id=${company} AND connection_id=${connection.id} AND group_id=${group} AND message_id=${message['quotedMessageId']} FOR UPDATE`)).rows[0];
   if(!note)return 'UNKNOWN_QUOTED_NOTE';
   if(note.requester_line_id!==source['userId']&&boss?.line_user_id!==source['userId'])return 'NOT_NOTE_OWNER';
   if(timestamp<=Number(note.event_timestamp))return 'STALE_CHANGE';
   const cancel=/^(ยกเลิก|ยกเลิกรายการนี้|ไม่เอาแล้ว)[\sค่ะครับ.!]*$/u.test(command);
   await this.db.query(sql`UPDATE app.line_notes SET amendments=amendments||${JSON.stringify([text])}::jsonb,status=${cancel?'CANCELLED':'OPEN'},snoozed_until=NULL,track_arrival=false,version=version+1,event_timestamp=${timestamp},updated_at=now() WHERE company_id=${company} AND id=${note.id}`);
   return cancel?'NOTE_CANCELLED':'NOTE_CHANGED';
  }
  const saved=await this.db.query(sql`INSERT INTO app.line_notes(company_id,connection_id,group_id,message_id,requester_line_id,original_text,quote_token,event_timestamp) VALUES(${company},${connection.id},${group},${string(message['id'],'message id')},${source['userId']},${text},${typeof message['quoteToken']==='string'?message['quoteToken']:null},${timestamp}) ON CONFLICT(company_id,connection_id,message_id) DO NOTHING`);
  return saved.rowCount?'NOTE_SAVED':'NOTE_DUPLICATE';
 }
 private async action(event:Record<string,unknown>,source:Record<string,unknown>,connection:Connection,boss:Boss|undefined,command?:string):Promise<string>{
  if(!boss||source['type']!=='user'||source['userId']!==boss.line_user_id)return 'NOT_BOSS';
  const token=command?.match(/note:([A-Za-z0-9_-]{20,})/)?.[1]??string(record(event['postback'])['data'],'action').slice(5);
  const company=this.db.currentCompanyId(),key=sha256(token);
  const action=(await this.db.query<{note_id:string;note_version:number;action:string;targets:{id:string;version:number}[]}>(sql`SELECT note_id,note_version,action,targets FROM app.line_note_actions WHERE company_id=${company} AND token_sha256=${key} AND recipient_id=${boss.id} AND expires_at>now() AND consumed_at IS NULL FOR UPDATE`)).rows[0];
  if(!action||!['ORDERED','PICKUP','CANCELLED','SNOOZE','ALL'].includes(action.action))return 'STALE_ACTION';
  const targets=action.action==='ALL'?action.targets:[{id:action.note_id,version:action.note_version}];
  let changed=0;
  for(const target of [...targets].sort((a,b)=>a.id.localeCompare(b.id))){
   const updated=action.action==='SNOOZE'
    ?await this.db.query(sql`UPDATE app.line_notes SET snoozed_until=((now() AT TIME ZONE 'Asia/Bangkok')::date+1+time '17:00') AT TIME ZONE 'Asia/Bangkok',version=version+1,updated_at=now() WHERE company_id=${company} AND connection_id=${connection.id} AND id=${target.id} AND version=${target.version} AND status='OPEN'`)
    :await this.db.query(sql`UPDATE app.line_notes SET status=${action.action==='ALL'?'ORDERED':action.action},track_arrival=false,snoozed_until=NULL,version=version+1,updated_at=now() WHERE company_id=${company} AND connection_id=${connection.id} AND id=${target.id} AND version=${target.version} AND status='OPEN'`);
   changed+=updated.rowCount??0;
  }
  await this.db.query(sql`UPDATE app.line_note_actions SET consumed_at=now() WHERE company_id=${company} AND token_sha256=${key}`);
  if(!changed)return 'STALE_ACTION';
  return action.action==='ALL'?`ALL:${changed}:${targets.length-changed}`:action.action;
 }
 private async enqueue(connectionId:string,to:string,key:string,messages:JsonObject[]):Promise<void>{
  await this.db.query(sql`INSERT INTO app.outbox_events(company_id,topic,deduplication_key,payload) VALUES(${this.db.currentCompanyId()},'LINE_PROCUREMENT',${key},${JSON.stringify({connectionId,to,messages})}::jsonb) ON CONFLICT(company_id,topic,deduplication_key) DO NOTHING`);
 }
 private async button(boss:Boss,note:Note,action:string,label:string,targets:{id:string;version:number}[]=[]):Promise<JsonObject>{
  const token=randomBytes(32).toString('base64url');
  await this.db.query(sql`INSERT INTO app.line_note_actions(company_id,token_sha256,note_id,recipient_id,note_version,action,targets,expires_at) VALUES(${this.db.currentCompanyId()},${sha256(token)},${note.id},${boss.id},${note.version},${action},${JSON.stringify(targets)}::jsonb,now()+interval '7 days')`);
  const red=action==='ORDERED'||action==='ALL';
  return {type:'box',layout:'vertical',height:'36px',cornerRadius:'5px',justifyContent:'center',alignItems:'center',backgroundColor:red?'#B92135':action==='SNOOZE'?'#E3EDF7':'#1761A5',action:{type:'postback',label,data:'note:'+token},contents:[{type:'text',text:label,size:'12px',color:action==='SNOOZE'?'#526174':'#FFFFFF',align:'center'}]};
 }
 private async cards(connectionId:string,boss:Boss,cutoff:Date,limit:number|null=null,start=0):Promise<JsonObject[]>{
  const notes=(await this.db.query<Note>(sql`SELECT * FROM app.line_notes WHERE company_id=${this.db.currentCompanyId()} AND connection_id=${connectionId} AND status='OPEN' AND created_at<=${cutoff} AND (snoozed_until IS NULL OR snoozed_until<=now()) ORDER BY created_at,id LIMIT ${limit===null?null:limit+1} OFFSET ${start}`)).rows;
  const hasMore=limit!==null&&notes.length>limit;if(hasMore)notes.pop();
  const messages:JsonObject[]=[];
  for(let offset=0;offset<notes.length;offset+=5){
   const page=notes.slice(offset,offset+5),contents:JsonObject[]=[];
   for(const note of page){
    if(contents.length)contents.push({type:'separator',margin:'sm',color:'#D8DEE7'});
    const display=(text:string):string=>text.replace(/^\s*@[^\s]+\s*/u,'').trim();
    const full=[display(note.original_text),...note.amendments.map(t=>'แก้ไข: '+display(t))].join('\n'),points=Array.from(full);
    const preview=points.length>600?points.slice(0,250).join('')+'\n…\n'+points.slice(-300).join('')+'\n(อ่านข้อความเต็มในกลุ่ม)':full;
    const cancel=await this.button(boss,note,'CANCELLED','ยกเลิก');
    contents.push({type:'box',layout:'vertical',spacing:'sm',margin:'sm',contents:[
     {type:'box',layout:'horizontal',spacing:'sm',alignItems:'center',contents:[
      {type:'text',text:preview||'คำขอในกลุ่ม',wrap:true,size:'16px',weight:'bold',color:'#1A1A1A',flex:1},
      {type:'box',layout:'vertical',width:'42px',height:'32px',justifyContent:'center',action:cancel['action']!,contents:[{type:'text',text:'ยกเลิก',size:'12px',color:'#505C6B',align:'end'}]}
     ]},
     {type:'box',layout:'horizontal',spacing:'xs',contents:[await this.button(boss,note,'ORDERED','สั่งแล้ว'),await this.button(boss,note,'PICKUP','รอไปเอา'),await this.button(boss,note,'SNOOZE','เลื่อนเตือน')]}
    ]});
   }
   const bubble:JsonObject={
    type:'bubble',size:'mega',
    styles:{body:{backgroundColor:'#FFFFFF'},footer:{backgroundColor:'#F0F3F8',separator:true,separatorColor:'#D8DEE7'}},
    header:{type:'box',layout:'vertical',backgroundColor:'#E7ECF2',paddingAll:'12px',spacing:'xs',contents:[
     {type:'box',layout:'horizontal',spacing:'sm',alignItems:'center',contents:[
      {type:'box',layout:'vertical',width:'14px',height:'14px',cornerRadius:'7px',backgroundColor:'#1761A5',borderColor:'#FFFFFF',borderWidth:'1px',contents:[]},
      {type:'text',text:'ULTRAMAN MISSIONS',weight:'bold',size:'sm',color:'#202B3B',flex:1},
      {type:'text',text:String(page.length)+' งาน',size:'xs',color:'#505C6B',flex:0}
     ]},
     {type:'box',layout:'vertical',height:'3px',backgroundColor:'#B92135',contents:[]}
    ]},
    body:{type:'box',layout:'vertical',backgroundColor:'#FFFFFF',paddingAll:'12px',paddingTop:'4px',contents},
    footer:{type:'box',layout:'vertical',paddingAll:'12px',spacing:'xs',contents:[
     await this.button(boss,page[0]!,'ALL','ทำแล้วทั้งหมด',page.map(n=>({id:n.id,version:n.version}))),
     {type:'text',text:'ทำทั้งหมดเฉพาะการ์ดนี้ • เลื่อน = พรุ่งนี้ 17:00',wrap:true,size:'xs',color:'#505C6B'}
    ]}
   };
   if(hasMore&&offset+5>=notes.length){const footer=bubble['footer'] as JsonObject;(footer['contents'] as JsonObject[]).push({type:'button',height:'sm',action:{type:'postback',label:'ดูรายการถัดไป',data:'notes-page:'+(start+notes.length)}});}
   if(Buffer.byteLength(JSON.stringify(bubble),'utf8')>30000)throw new Error('LINE_CARD_TOO_LARGE');
   messages.push({type:'flex',altText:`รายการรอจัดการ ${start+offset+1}–${start+offset+page.length}`,contents:bubble});
  }
  return messages;
 }
 async prepare(day:string,round:'evening'|'morning'='evening',now=new Date()):Promise<number>{
  return this.db.transaction(async()=>{
   const company=this.db.currentCompanyId();
   await this.db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+'notes-summary'+day+round},0))`);
   const connections=(await this.db.query<{connection_id:string}>(sql`SELECT g.connection_id FROM app.line_shop_groups g JOIN app.integration_connections c ON c.company_id=g.company_id AND c.id=g.connection_id AND c.is_active WHERE g.company_id=${company}`)).rows;
   let count=0;
   for(const c of connections){
    const boss=await this.boss(c.connection_id);if(!boss)continue;
    const key=`notes-v2:${day}:${round}:${c.connection_id}`;
    if((await this.db.query(sql`SELECT 1 FROM app.line_summary_runs WHERE company_id=${company} AND run_key=${key}`)).rowCount)continue;
    const cutoff=round==='morning'?new Date(new Date(day+'T17:00:00+07:00').getTime()-86400000):now;
    const messages=await this.cards(c.connection_id,boss,cutoff);
    for(let i=0;i<messages.length;i+=5){await this.enqueue(c.connection_id,boss.line_user_id,key+':'+i,messages.slice(i,i+5));count++;}
    await this.db.query(sql`INSERT INTO app.line_summary_runs(company_id,run_key) VALUES(${company},${key})`);
   }
   return count;
  });
 }
}

export function noteSummaryRound(now:Date):'evening'|'morning'|null{
 const hour=new Date(now.getTime()+7*3600000).getUTCHours();
 return hour>=17?'evening':hour>=10?'morning':null;
}
