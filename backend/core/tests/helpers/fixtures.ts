import { randomUUID } from 'node:crypto';
import type pg from 'pg';
export const A='10000000-0000-4000-8000-000000000001', B='20000000-0000-4000-8000-000000000002';
export const ids={user:randomUUID(),product:randomUUID(),cost:randomUUID(),oldCost:randomUUID(),
  order:randomUUID(),other1:randomUUID(),other2:randomUUID(),item:randomUUID(),payment:randomUUID(),
  connection:randomUUID(),route:randomUUID(),campaign:randomUUID(),
  accounts:{receivable:randomUUID(),sales:randomUUID(),cogs:randomUUID(),inventory:randomUUID(),vat:randomUUID(),
    fee:randomUUID(),liability:randomUUID(),clearing:randomUUID(),other:randomUUID()}};
export async function journal(admin:pg.Client,source:string,sourceId:string,lines:readonly {account:string;debit:string;credit:string}[],date='2024-02-29'):Promise<string>{
  const id=randomUUID();
  await admin.query('BEGIN');
  try{
    await admin.query("INSERT INTO app.journal_entries(company_id,id,entry_number,source_kind,source_id,source_event_key,accounting_date,description) VALUES ($1,$2,$3,$4,$5,'test',$6,'Integration fixture')",[A,id,id,source,sourceId,date]);
    for(const [index,line] of lines.entries()) await admin.query('INSERT INTO app.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit) VALUES ($1,$2,$3,$4,$5,$6,$7)',[A,id,index+1,line.account,'Fixture',line.debit,line.credit]);
    await admin.query("UPDATE app.journal_entries SET status='POSTED',posted_at=now() WHERE company_id=$1 AND id=$2",[A,id]);
    await admin.query('COMMIT');return id;
  }catch(error){await admin.query('ROLLBACK');throw error;}
}
export async function fixtures(admin:pg.Client):Promise<void>{
  await admin.query("INSERT INTO app.companies(company_id,slug,legal_name) VALUES ($1,'tenant-a','Company A'),($2,'tenant-b','Company B')",[A,B]);
  await admin.query("INSERT INTO app.users(company_id,id,auth_issuer,auth_subject,email,display_name) VALUES ($1,$2,'https://identity.test','employee-1','employee@example.test','Employee')",[A,ids.user]);
  const role=randomUUID(),permission=randomUUID();
  await admin.query("INSERT INTO app.roles(company_id,id,code,name) VALUES ($1,$2,'CFO','CFO')",[A,role]);
  await admin.query("INSERT INTO app.permissions(company_id,id,code,description) VALUES ($1,$2,'finance.profit.read','Read profit')",[A,permission]);
  await admin.query('INSERT INTO app.role_permissions(company_id,role_id,permission_id) VALUES ($1,$2,$3)',[A,role,permission]);
  await admin.query('INSERT INTO app.user_roles(company_id,user_id,role_id,granted_by) VALUES ($1,$2,$3,$2)',[A,ids.user,role]);
  await admin.query("INSERT INTO app.products(company_id,id,sku,slug,name,price_ex_vat) VALUES ($1,$2,'SKU-A','a','A',500),($3,$4,'SKU-B','b','B',900)",[A,ids.product,B,randomUUID()]);
  await admin.query("INSERT INTO app.product_costs(company_id,id,product_id,valid_from,valid_to,unit_cost,reason,created_by) VALUES ($1,$2,$3,'2024-02-01 00:00+07','2024-02-28 00:00+07',100,'Old cost',$4),($1,$5,$3,'2024-02-28 00:00+07',NULL,200,'New cost',$4)",[A,ids.oldCost,ids.product,ids.user,ids.cost]);
  const accountRows:readonly [string,string,string,string][]=[
    [ids.accounts.receivable,'1100','ASSET','RECEIVABLE'],[ids.accounts.sales,'4100','REVENUE','SALES'],
    [ids.accounts.cogs,'5100','EXPENSE','COGS'],[ids.accounts.inventory,'1200','ASSET','INVENTORY'],
    [ids.accounts.vat,'2100','LIABILITY','OUTPUT_VAT'],[ids.accounts.fee,'5200','EXPENSE','GATEWAY_FEES'],
    [ids.accounts.liability,'2200','LIABILITY','OTHER_LIABILITY'],[ids.accounts.clearing,'1300','ASSET','OTHER_ASSET'],
    [ids.accounts.other,'5500','EXPENSE','OTHER_EXPENSE']];
  for(const [id,code,type,group] of accountRows) await admin.query('INSERT INTO app.accounts(company_id,id,code,name,account_type,reporting_group) VALUES ($1,$2,$3,$3,$4,$5)',[A,id,code,type,group]);
  for(const [index,id] of [ids.order,ids.other1,ids.other2].entries()){
    await admin.query("INSERT INTO app.orders(company_id,id,order_number,source,ordered_at) VALUES ($1,$2,$3,'WEB','2024-02-27 12:00+07')",[A,id,`ORDER-${index}`]);
    await admin.query("INSERT INTO app.order_items(company_id,id,order_id,line_number,product_id,description,quantity,unit_price_ex_vat,vat_amount,cost_version_id,unit_cost_snapshot) VALUES ($1,$2,$3,1,$4,'Product',2,500,70,$5,200)",[A,index===0?ids.item:randomUUID(),id,ids.product,ids.cost]);
    await admin.query("UPDATE app.orders SET status='RECOGNIZED',recognized_at=$3 WHERE company_id=$1 AND id=$2",[A,id,`2024-02-29T00:1${index}:00+07:00`]);
    await journal(admin,'ORDER',id,[
      {account:ids.accounts.receivable,debit:'1070',credit:'0'},{account:ids.accounts.sales,debit:'0',credit:'1000'},
      {account:ids.accounts.vat,debit:'0',credit:'70'},{account:ids.accounts.cogs,debit:'400',credit:'0'},
      {account:ids.accounts.inventory,debit:'0',credit:'400'}]);
  }
  await admin.query("INSERT INTO app.integration_connections(company_id,id,provider,external_account_id,webhook_route_id,credentials_secret_ref) VALUES ($1,$2,'STRIPE','acct_fixture',$3,'env:STRIPE_FIXTURE')",[A,ids.connection,ids.route]);
  await admin.query('INSERT INTO app.gateway_account_mappings(company_id,connection_id,clearing_account_id,receivable_account_id,advance_account_id) VALUES ($1,$2,$3,$4,$5)',[A,ids.connection,ids.accounts.clearing,ids.accounts.receivable,ids.accounts.liability]);
  await admin.query("INSERT INTO app.payments(company_id,id,order_id,connection_id,external_payment_id,status,amount) VALUES ($1,$2,$3,$4,'pi_fixture','PENDING',1070)",[A,ids.payment,ids.order,ids.connection]);
  const feeId=randomUUID();const feeJournal=await journal(admin,'GATEWAY_FEE',feeId,[{account:ids.accounts.fee,debit:'30',credit:'0'},{account:ids.accounts.liability,debit:'0',credit:'30'}]);
  await admin.query("INSERT INTO app.gateway_fees(company_id,id,payment_id,external_fee_id,recognition_date,amount_ex_vat,journal_entry_id) VALUES ($1,$2,$3,'fee_fixture','2024-02-29',30,$4)",[A,feeId,ids.payment,feeJournal]);
  await admin.query("INSERT INTO app.marketing_campaigns(company_id,id,platform,external_account_id,external_campaign_id,name) VALUES ($1,$2,'META','ad-account','campaign','Campaign')",[A,ids.campaign]);
  await admin.query("INSERT INTO app.ad_spends(company_id,campaign_id,spend_date,source_timezone,amount_ex_vat,revision) VALUES ($1,$2,'2024-02-28','Asia/Bangkok',90,1),($1,$2,'2024-02-28','Asia/Bangkok',100,2)",[A,ids.campaign]);
  await admin.query("INSERT INTO app.fixed_costs(company_id,name,amount_ex_vat,frequency,starts_on,created_by) VALUES ($1,'Rent',2900,'MONTHLY','2024-01-01',$2),($1,'Annual fee',3660,'YEARLY','2024-01-01',$2),($1,'Daily',5,'DAILY','2024-01-01',$2)",[A,ids.user]);
  await journal(admin,'MANUAL',randomUUID(),[{account:ids.accounts.other,debit:'15',credit:'0'},{account:ids.accounts.liability,debit:'0',credit:'15'}]);
}
