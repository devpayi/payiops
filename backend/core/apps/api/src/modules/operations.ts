import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { sql, type TenantDatabase } from '../../../../packages/db/src/index.js';
import { decimal, money } from '../../../../packages/money/src/decimal.js';
import { principalFor, requirePermission } from '../middleware/tenant.js';
import { HttpError } from '../http/errors.js';
import { amount, bangkokDate, date, id, record, string } from './procurement/input.js';
import { hashPassword } from './auth.js';
import { ProcurementService } from './procurement/service.js';
export function operationsRoutes(db:TenantDatabase,issuer:string):Router{
 const r=Router(),audit=new ProcurementService(db);
 r.get('/me',async(req,res)=>{
  const principal=principalFor(req);
  const user=(await db.query(sql`SELECT id,display_name,auth_subject FROM app.users WHERE company_id=${principal.companyId} AND id=${principal.userId}`)).rows[0];
  const permissions=(await db.query<{code:string}>(sql`SELECT DISTINCT p.code FROM app.user_roles ur JOIN app.role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id JOIN app.permissions p ON p.company_id=rp.company_id AND p.id=rp.permission_id WHERE ur.company_id=${principal.companyId} AND ur.user_id=${principal.userId}`)).rows.map(p=>p.code);
  res.json({user,permissions,companyId:principal.companyId});
 });
 r.get('/data',requirePermission(db,'finance.profit.read'),async(_req,res)=>{
  const company=db.currentCompanyId();
  res.json({
   products:(await db.query(sql`SELECT p.*,(SELECT unit_cost::text FROM app.product_costs c WHERE c.company_id=p.company_id AND c.product_id=p.id AND c.valid_during @> now()) AS current_cost FROM app.products p WHERE p.company_id=${company} ORDER BY p.name LIMIT 500`)).rows,
   orders:(await db.query(sql`SELECT o.id,o.order_number,o.recognition_date::text AS recognition_date,coalesce(sum(i.net_amount),0)::text AS revenue FROM app.orders o JOIN app.order_items i ON i.company_id=o.company_id AND i.order_id=o.id WHERE o.company_id=${company} GROUP BY o.company_id,o.id ORDER BY o.recognized_at DESC LIMIT 100`)).rows,
   campaigns:(await db.query(sql`SELECT * FROM app.marketing_campaigns WHERE company_id=${company} ORDER BY name`)).rows,
   ads:(await db.query(sql`SELECT DISTINCT ON(s.campaign_id,s.spend_date) s.*,s.spend_date::text AS spend_date,c.name FROM app.ad_spends s JOIN app.marketing_campaigns c ON c.company_id=s.company_id AND c.id=s.campaign_id WHERE s.company_id=${company} ORDER BY s.campaign_id,s.spend_date DESC,s.revision DESC LIMIT 100`)).rows,
   fixedCosts:(await db.query(sql`SELECT *,starts_on::text AS starts_on,ends_on::text AS ends_on FROM app.fixed_costs WHERE company_id=${company} ORDER BY app.fixed_costs.starts_on DESC LIMIT 100`)).rows,
   ledger:(await db.query(sql`SELECT e.accounting_date::text AS accounting_date,e.description,e.source_kind,e.id,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit FROM app.journal_entries e JOIN app.journal_lines l ON l.company_id=e.company_id AND l.journal_entry_id=e.id WHERE e.company_id=${company} AND e.status='POSTED' GROUP BY e.company_id,e.id ORDER BY e.created_at DESC LIMIT 100`)).rows,
   cash:(await db.query<{balance:string}>(sql`SELECT coalesce(sum(l.debit-l.credit),0)::text AS balance FROM app.journal_lines l JOIN app.journal_entries e ON e.company_id=l.company_id AND e.id=l.journal_entry_id AND e.status='POSTED' JOIN app.accounts a ON a.company_id=l.company_id AND a.id=l.account_id AND a.reporting_group='CASH' WHERE l.company_id=${company}`)).rows[0]?.balance??'0',
  });
 });
 r.post('/products',requirePermission(db,'finance.manage'),async(req,res)=>{
  const b=record(req.body),company=db.currentCompanyId(),product=id(b['id']),name=string(b['name'],'ชื่อสินค้า',180),sku=string(b['sku'],'SKU',100),price=amount(b['price'],true),cost=amount(b['cost'],true),start=date(b['costStartsOn']);
  await db.transaction(async()=>{
   await db.query(sql`INSERT INTO app.products(company_id,id,sku,slug,name,description,price_ex_vat,is_published) VALUES(${company},${product},${sku},${product},${name},${typeof b['description']==='string'?b['description'].slice(0,4000):''},${price}::numeric,${b['published']===true})`);
   await db.query(sql`INSERT INTO app.product_costs(company_id,product_id,valid_from,unit_cost,reason,created_by) VALUES(${company},${product},${start+'T00:00:00+07:00'}::timestamptz,${cost}::numeric,'ต้นทุนเริ่มต้น',${principalFor(req).userId})`);
  });res.status(201).json({id:product});
 });
 r.post('/products/:id/cost',requirePermission(db,'finance.manage'),async(req,res)=>{
  const b=record(req.body),company=db.currentCompanyId(),product=id(req.params['id']),cost=amount(b['cost'],true),start=date(b['startsOn']),effective=start+'T00:00:00+07:00';
  await db.transaction(async()=>{
   await db.query(sql`SELECT id FROM app.products WHERE company_id=${company} AND id=${product} FOR UPDATE`);
   if((await db.query(sql`SELECT 1 FROM app.order_items i JOIN app.orders o ON o.company_id=i.company_id AND o.id=i.order_id WHERE i.company_id=${company} AND i.product_id=${product} AND o.recognized_at>=${effective}::timestamptz LIMIT 1`)).rowCount)throw new HttpError(409,'COST_ALREADY_USED','มีการรับรู้รายได้หลังวันที่นี้แล้ว ต้องแก้บัญชีอย่างเป็นทางการ');
   const current=(await db.query<{id:string;valid_from:Date}>(sql`SELECT id,valid_from FROM app.product_costs WHERE company_id=${company} AND product_id=${product} AND valid_to IS NULL FOR UPDATE`)).rows[0];
   if(!current||current.valid_from.getTime()>=Date.parse(effective))throw new HttpError(409,'INVALID_COST_DATE','วันเริ่มต้องอยู่หลังต้นทุนรุ่นก่อน');
   await db.query(sql`UPDATE app.product_costs SET valid_to=${effective}::timestamptz WHERE company_id=${company} AND id=${current.id}`);
   await db.query(sql`INSERT INTO app.product_costs(company_id,product_id,valid_from,unit_cost,reason,created_by) VALUES(${company},${product},${effective}::timestamptz,${cost}::numeric,${string(b['reason'],'เหตุผล')},${principalFor(req).userId})`);
  });res.json({ok:true});
 });
 r.post('/orders',requirePermission(db,'finance.manage'),async(req,res)=>{
  const b=record(req.body),company=db.currentCompanyId(),order=id(b['id']),day=date(b['recognizedOn']),actor=principalFor(req).userId;
  if(day>bangkokDate())throw new HttpError(400,'FUTURE_DATE','ห้ามรับรู้ยอดขายในอนาคต');
  const recognizedAt=day===bangkokDate()?new Date().toISOString():day+'T12:00:00+07:00';
  if(!Array.isArray(b['items'])||!b['items'].length||b['items'].length>100)throw new HttpError(400,'INVALID_ITEMS','ต้องมีสินค้า 1–100 รายการ');
  const items=b['items'].map(record);
  await db.transaction(async()=>{
   await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+order},0))`);
   if((await db.query(sql`SELECT 1 FROM app.orders WHERE company_id=${company} AND id=${order}`)).rowCount)throw new HttpError(409,'ORDER_EXISTS','ออเดอร์นี้บันทึกแล้ว');
   await db.query(sql`INSERT INTO app.orders(company_id,id,order_number,source,created_by,ordered_at) VALUES(${company},${order},${string(b['orderNumber'],'เลขออเดอร์')},'MANUAL',${actor},${recognizedAt}::timestamptz)`);
   let sales=decimal('0'),cogs=decimal('0'),vat=decimal('0'),line=0;
   for(const item of items){
    const quantity=amount(item['quantity']),price=amount(item['price'],true),tax=amount(item['vat']??'0',true),product=id(item['productId']);
    const cost=(await db.query<{id:string;unit_cost:string;name:string}>(sql`SELECT c.id,c.unit_cost,p.name FROM app.product_costs c JOIN app.products p ON p.company_id=c.company_id AND p.id=c.product_id WHERE c.company_id=${company} AND c.product_id=${product} AND c.valid_during @> ${recognizedAt}::timestamptz AND p.is_active FOR SHARE OF c,p`)).rows[0];
    if(!cost)throw new HttpError(409,'COST_REQUIRED','ไม่พบต้นทุน ณ วันที่ขาย');
    await db.query(sql`INSERT INTO app.order_items(company_id,order_id,line_number,product_id,description,quantity,unit_price_ex_vat,vat_amount,cost_version_id,unit_cost_snapshot) VALUES(${company},${order},${++line},${product},${cost.name},${quantity}::numeric,${price}::numeric,${tax}::numeric,${cost.id},${cost.unit_cost}::numeric)`);
    sales=sales.plus(money(decimal(quantity).times(price)));cogs=cogs.plus(money(decimal(quantity).times(cost.unit_cost)));vat=vat.plus(tax);
   }
   if(sales.lte(0))throw new HttpError(400,'ZERO_SALE','ยอดขายต้องมากกว่า 0');
   const accounts=(await db.query<{id:string;reporting_group:string}>(sql`SELECT id,reporting_group FROM app.accounts WHERE company_id=${company} AND reporting_group IN('RECEIVABLE','SALES','COGS','INVENTORY','OUTPUT_VAT') AND is_active`)).rows;
   const account=(group:string):string=>{const a=accounts.filter(a=>a.reporting_group===group);if(a.length!==1)throw new HttpError(409,'ACCOUNT_MAPPING_REQUIRED','ต้องมีบัญชีใช้งานหนึ่งบัญชีต่อกลุ่ม '+group);return a[0]!.id;};
   const entry=randomUUID();await db.query(sql`INSERT INTO app.journal_entries(company_id,id,entry_number,source_kind,source_id,source_event_key,accounting_date,description,posted_by) VALUES(${company},${entry},${'SALE-'+order},'ORDER',${order},'recognition',${day}::date,'รับรู้รายได้จากการส่งมอบสินค้า',${actor})`);
   const postings=[{a:account('RECEIVABLE'),d:money(sales.plus(vat)),c:'0'},{a:account('SALES'),d:'0',c:money(sales)},{a:account('OUTPUT_VAT'),d:'0',c:money(vat)},{a:account('COGS'),d:money(cogs),c:'0'},{a:account('INVENTORY'),d:'0',c:money(cogs)}];
   let n=0;for(const p of postings)if(decimal(p.d).plus(p.c).gt(0))await db.query(sql`INSERT INTO app.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit) VALUES(${company},${entry},${++n},${p.a},'รับรู้ยอดขายและต้นทุน',${p.d}::numeric,${p.c}::numeric)`);
   await db.query(sql`UPDATE app.journal_entries SET status='POSTED',posted_at=now() WHERE company_id=${company} AND id=${entry}`);
   await db.query(sql`UPDATE app.orders SET status='RECOGNIZED',recognized_at=${recognizedAt}::timestamptz WHERE company_id=${company} AND id=${order}`);
  });res.status(201).json({id:order});
 });
 r.post('/campaigns',requirePermission(db,'finance.manage'),async(req,res)=>{
  const b=record(req.body),campaign=id(b['id']),platform=string(b['platform'],'แพลตฟอร์ม');if(!['META','TIKTOK'].includes(platform))throw new HttpError(400,'INVALID_PLATFORM','เลือก Meta หรือ TikTok');
  await db.query(sql`INSERT INTO app.marketing_campaigns(company_id,id,platform,external_account_id,external_campaign_id,name) VALUES(${db.currentCompanyId()},${campaign},${platform},'manual',${campaign},${string(b['name'],'ชื่อแคมเปญ')})`);res.status(201).json({id:campaign});
 });
 r.post('/ads',requirePermission(db,'finance.manage'),async(req,res)=>{
  const b=record(req.body),company=db.currentCompanyId(),campaign=id(b['campaignId']),day=date(b['date']),value=amount(b['amount'],true);
  await db.transaction(async()=>{
   await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company+campaign+day},0))`);
   const rev=(await db.query<{n:number}>(sql`SELECT coalesce(max(revision),0)+1 AS n FROM app.ad_spends WHERE company_id=${company} AND campaign_id=${campaign} AND spend_date=${day}::date`)).rows[0]!.n;
   await db.query(sql`INSERT INTO app.ad_spends(company_id,campaign_id,spend_date,source_timezone,amount_ex_vat,revision) VALUES(${company},${campaign},${day}::date,'Asia/Bangkok',${value}::numeric,${rev})`);
  });res.json({ok:true});
 });
 r.post('/fixed-costs',requirePermission(db,'finance.manage'),async(req,res)=>{
  const b=record(req.body),frequency=string(b['frequency'],'รอบค่าใช้จ่าย');if(!['DAILY','MONTHLY','YEARLY'].includes(frequency))throw new HttpError(400,'INVALID_FREQUENCY','รอบค่าใช้จ่ายไม่ถูกต้อง');
  await db.query(sql`INSERT INTO app.fixed_costs(company_id,name,amount_ex_vat,frequency,starts_on,created_by) VALUES(${db.currentCompanyId()},${string(b['name'],'รายการ')},${amount(b['amount'])}::numeric,${frequency},${date(b['startsOn'])}::date,${principalFor(req).userId})`);res.json({ok:true});
 });
 r.get('/users',requirePermission(db,'users.manage'),async(_req,res)=>{res.json((await db.query(sql`SELECT u.id,u.display_name,u.auth_subject,u.status,r.code AS role FROM app.users u LEFT JOIN app.user_roles ur ON ur.company_id=u.company_id AND ur.user_id=u.id LEFT JOIN app.roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE u.company_id=${db.currentCompanyId()} ORDER BY u.display_name`)).rows);});
 r.post('/users',requirePermission(db,'users.manage'),async(req,res)=>{
  const b=record(req.body),company=db.currentCompanyId(),username=string(b['username'],'ชื่อผู้ใช้',80).toLowerCase(),password=string(b['password'],'รหัสผ่าน',256),role=string(b['role'],'สิทธิ์');
  if(!/^[a-z0-9_.-]{3,80}$/.test(username)||password.length<12||!['BOSS','STAFF','FINANCE'].includes(role))throw new HttpError(400,'INVALID_USER','ชื่อผู้ใช้ 3–80 ตัว รหัสผ่านอย่างน้อย 12 ตัว และเลือกสิทธิ์ที่รองรับ');
  const user=randomUUID(),hashed=await hashPassword(password);
  await db.transaction(async()=>{
   const roleId=(await db.query<{id:string}>(sql`SELECT id FROM app.roles WHERE company_id=${company} AND code=${role}`)).rows[0]?.id;if(!roleId)throw new HttpError(409,'ROLE_REQUIRED','ยังไม่มี role');
   await db.query(sql`INSERT INTO app.users(company_id,id,auth_issuer,auth_subject,email,display_name) VALUES(${company},${user},${issuer},${username},${username+'@local.invalid'},${string(b['name'],'ชื่อแสดงผล')})`);
   await db.query(sql`INSERT INTO app.local_credentials(company_id,user_id,password_hash,salt) VALUES(${company},${user},${hashed.hash},${hashed.salt})`);
   await db.query(sql`INSERT INTO app.user_roles(company_id,user_id,role_id,granted_by) VALUES(${company},${user},${roleId},${principalFor(req).userId})`);
   await audit.audit(principalFor(req).userId,'USER_CREATED','USER',user,{role});
  });res.status(201).json({id:user});
 });
 return r;
}
export function catalogRoutes(db:TenantDatabase):Router{
 const r=Router();r.get('/:companyId',async(req,res)=>{await db.runAsTenant(id(req.params['companyId']),async()=>{
  const company=db.currentCompanyId();const owner=(await db.query(sql`SELECT legal_name FROM app.companies WHERE company_id=${company} AND status='ACTIVE'`)).rows[0];if(!owner)throw new HttpError(404,'NOT_FOUND','ไม่พบบริษัท');
  const products=(await db.query(sql`SELECT id,slug,name,description,price_ex_vat,unit,seo_title,seo_description FROM app.products WHERE company_id=${company} AND is_published AND is_active ORDER BY name LIMIT 500`)).rows;
  res.json({company:owner,products});
 });});return r;
}
