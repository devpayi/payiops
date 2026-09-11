import { randomUUID } from 'node:crypto';
import { sql, type TenantDatabase } from '../../../../../packages/db/src/index.js';
import { decimal, money } from '../../../../../packages/money/src/decimal.js';
import { HttpError } from '../../http/errors.js';
import { object, text } from '../../http/json.js';
import type { VerifiedWebhook } from './verification.js';
import type { WebhookProcessor } from '../../middleware/idempotency.js';

interface Receipt { id: string; amount: string; paidAt: Date; invoice: string | null }
function minorAmount(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new HttpError(422,'INVALID_AMOUNT','Invalid gateway minor-unit amount');
  return money(decimal(String(value)).div(100));
}
function timestamp(value: unknown): Date {
  const source=text(value,'payment timestamp');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(source)) throw new Error('Payment timestamp must include timezone');
  const date=new Date(source);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid payment timestamp');
  return date;
}
function receipt(event: VerifiedWebhook): Receipt | null {
  if (event.provider === 'STRIPE') {
    if (event.eventType !== 'payment_intent.succeeded') return null;
    const data=object(object(event.payload['data'])['object']);
    if (data['currency'] !== 'thb' || data['status'] !== 'succeeded') throw new HttpError(422,'INVALID_PAYMENT','Expected successful THB payment');
    const created=event.payload['created'];
    if (typeof created !== 'number' || !Number.isSafeInteger(created)) throw new Error('Invalid Stripe event time');
    return {id:text(data['id'],'payment id'),amount:minorAmount(data['amount_received']),paidAt:new Date(created*1000),invoice:null};
  }
  if (event.provider === 'OMISE') {
    if (!['charge.complete','charge.capture','charge.create'].includes(event.eventType)) return null;
    const charge=object(event.payload['data']);
    if (charge['status'] !== 'successful' || charge['paid'] !== true) return null;
    if (charge['currency'] !== 'THB' && charge['currency'] !== 'thb') throw new HttpError(422,'INVALID_CURRENCY','Only THB is supported');
    return {id:text(charge['id'],'charge id'),amount:minorAmount(charge['captured_amount'] ?? charge['amount']),paidAt:timestamp(charge['paid_at']),invoice:null};
  }
  if (event.payload['respCode'] !== '0000') return null;
  if (event.payload['currencyCode'] !== 'THB') throw new HttpError(422,'INVALID_CURRENCY','Only THB is supported');
  const amount=decimal(text(event.payload['amount'],'amount'));
  if (amount.lte(0) || amount.decimalPlaces()>2) throw new HttpError(422,'INVALID_AMOUNT','Expected positive THB amount');
  const time=text(event.payload['transactionDateTime'],'transactionDateTime');
  if (!/^\d{14}$/.test(time)) throw new Error('Invalid 2C2P date');
  const date=timestamp(`${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(8,10)}:${time.slice(10,12)}:${time.slice(12,14)}+07:00`);
  const roundTrip=new Date(date.getTime()+7*3600*1000).toISOString().replace(/[-:T]/g,'').slice(0,14);
  if (roundTrip !== time) throw new Error('Invalid 2C2P calendar date');
  return {id:text(event.payload['tranRef'],'tranRef'),amount:money(amount),paidAt:date,invoice:text(event.payload['invoiceNo'],'invoiceNo')};
}
interface PaymentRow { id:string;order_id:string;status:string;amount:string;currency:string }
interface OrderRow { status:string;order_number:string;total:string;collected:string }
interface Mapping { clearing_account_id:string;receivable_account_id:string;advance_account_id:string }

/** Capture payment collection, never recognize sales from a payment webhook. */
export function paymentProcessor(db: TenantDatabase): WebhookProcessor {
  return async event => {
    db.assertCompany(event.companyId);
    const received=receipt(event);
    if (!received) {
      // Refunds/disputes must remain retryable until a reconciliation workflow
      // handles them. They must never be silently acknowledged as settled.
      if (/refund|dispute|reverse|void/i.test(event.eventType)) throw new HttpError(422,'RECONCILIATION_REQUIRED','This financial event requires reconciliation');
      return {status:200,body:{received:true,outcome:'NO_PAYMENT_CAPTURE'}};
    }
    return db.transaction(async () => {
      const lookup=(await db.query<PaymentRow>(sql`SELECT id,order_id,status,amount,currency FROM app.payments
        WHERE company_id=${event.companyId} AND connection_id=${event.connectionId} AND external_payment_id=${received.id}`)).rows[0];
      if (!lookup) throw new HttpError(409,'PAYMENT_NOT_REGISTERED','Payment must be registered against an order before capture');
      // Lock the order first so different payment IDs cannot over-collect it.
      const parent=(await db.query<{status:string;order_number:string}>(sql`SELECT status,order_number FROM app.orders
        WHERE company_id=${event.companyId} AND id=${lookup.order_id} FOR UPDATE`)).rows[0];
      if (!parent) throw new Error('Payment order missing');
      const payment=(await db.query<PaymentRow>(sql`SELECT id,order_id,status,amount,currency FROM app.payments
        WHERE company_id=${event.companyId} AND id=${lookup.id} FOR UPDATE`)).rows[0];
      if (!payment || payment.order_id !== lookup.order_id) throw new Error('Payment order changed concurrently');
      if (!decimal(payment.amount).equals(received.amount) || payment.currency !== 'THB' || (received.invoice && received.invoice !== parent.order_number)) {
        throw new HttpError(409,'PAYMENT_DETAILS_MISMATCH','Verified payment does not match the registered order amount/currency/invoice');
      }
      if (payment.status === 'SUCCEEDED') return {status:200,body:{received:true,paymentId:payment.id,outcome:'ALREADY_CAPTURED'}};
      if (parent.status==='CANCELLED' || parent.status==='DRAFT') throw new HttpError(409,'ORDER_NOT_PAYABLE','Order requires review before payment capture');
      const totals=(await db.query<OrderRow>(sql`SELECT
        (SELECT coalesce(sum(net_amount+vat_amount),0)::text FROM app.order_items WHERE company_id=${event.companyId} AND order_id=${payment.order_id}) AS total,
        (SELECT coalesce(sum(amount),0)::text FROM app.payments WHERE company_id=${event.companyId} AND order_id=${payment.order_id} AND status='SUCCEEDED') AS collected`)).rows[0];
      if (!totals || decimal(totals.collected).plus(received.amount).gt(totals.total)) throw new HttpError(409,'OVERPAYMENT','Capture exceeds the original order total');
      const mapping=(await db.query<Mapping>(sql`SELECT m.clearing_account_id,m.receivable_account_id,m.advance_account_id
        FROM app.gateway_account_mappings m
        JOIN app.accounts c ON c.company_id=m.company_id AND c.id=m.clearing_account_id
        JOIN app.accounts r ON r.company_id=m.company_id AND r.id=m.receivable_account_id
        JOIN app.accounts a ON a.company_id=m.company_id AND a.id=m.advance_account_id
        WHERE m.company_id=${event.companyId} AND m.connection_id=${event.connectionId}
          AND c.is_active AND r.is_active AND a.is_active
          AND c.reporting_group='OTHER_ASSET' AND r.reporting_group='RECEIVABLE' AND a.reporting_group='OTHER_LIABILITY'
        FOR SHARE OF m,c,r,a`)).rows[0];
      if (!mapping) throw new HttpError(409,'ACCOUNT_MAPPING_REQUIRED','Gateway clearing/receivable/advance account mapping is required');
      const entryId=randomUUID();
      await db.query(sql`INSERT INTO app.journal_entries(company_id,id,entry_number,source_kind,source_id,source_event_key,accounting_date,description)
        VALUES (${event.companyId},${entryId},${`PAY-${payment.id}`},'PAYMENT',${payment.id},'capture',(${received.paidAt}::timestamptz AT TIME ZONE 'Asia/Bangkok')::date,'Gateway collection')`);
      const creditAccount=parent.status==='RECOGNIZED'?mapping.receivable_account_id:mapping.advance_account_id;
      await db.query(sql`INSERT INTO app.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
        VALUES (${event.companyId},${entryId},1,${mapping.clearing_account_id},'Gateway clearing',${received.amount}::numeric,0),
               (${event.companyId},${entryId},2,${creditAccount},'Customer receivable or advance',0,${received.amount}::numeric)`);
      await db.query(sql`UPDATE app.journal_entries SET status='POSTED',posted_at=clock_timestamp() WHERE company_id=${event.companyId} AND id=${entryId}`);
      await db.query(sql`UPDATE app.payments SET status='SUCCEEDED',paid_at=${received.paidAt},settlement_journal_id=${entryId},
        last_webhook_event_id=(SELECT id FROM app.webhook_events WHERE company_id=${event.companyId} AND connection_id=${event.connectionId} AND provider_event_id=${event.eventId})
        WHERE company_id=${event.companyId} AND id=${payment.id}`);
      await db.query(sql`INSERT INTO app.audit_logs(company_id,action,entity_type,entity_id,changes)
        VALUES (${event.companyId},'PAYMENT_CAPTURED','PAYMENT',${payment.id},${JSON.stringify({provider:event.provider,eventId:event.eventId,amount:received.amount})}::jsonb)`);
      return {status:200,body:{received:true,paymentId:payment.id,outcome:'CAPTURED'}};
    });
  };
}
