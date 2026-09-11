import type { Request, RequestHandler } from 'express';
import Stripe from 'stripe';
import { jwtVerify } from 'jose';
import { sql, uuid, type TenantDatabase } from '../../../../../packages/db/src/index.js';
import { HttpError } from '../../http/errors.js';
import { object, text, canonical, sha256, type JsonObject } from '../../http/json.js';

export type Provider = 'STRIPE' | 'OMISE' | '2C2P';
export interface VerifiedWebhook {
  readonly companyId: string; readonly connectionId: string; readonly provider: Provider;
  readonly eventId: string; readonly eventType: string; readonly payload: JsonObject;
  readonly fingerprint: string; readonly verifiedAt: Date;
}
export type SecretResolver = (reference: string) => Promise<JsonObject>;
const verified = new WeakMap<Request, VerifiedWebhook>();
export function verifiedWebhook(req: Request): VerifiedWebhook {
  const event = verified.get(req);
  if (!event) throw new HttpError(401,'UNVERIFIED_WEBHOOK','Webhook verification is required');
  return event;
}
export const environmentSecrets: SecretResolver = async reference => {
  if (!/^env:[A-Z][A-Z0-9_]*$/.test(reference)) throw new Error('Unsupported secret reference; use env:VARIABLE_NAME');
  const value = process.env[reference.slice(4)];
  if (!value) throw new Error('Integration secret is unavailable');
  return object(JSON.parse(value) as unknown);
};
interface Connection {
  id: string; provider: Provider; external_account_id: string; credentials_secret_ref: string;
}
async function omiseGet(path: string, key: string): Promise<JsonObject> {
  const response = await fetch(`https://api.omise.co${path}`, { headers: {
    authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    'Omise-Version': '2019-05-29',
  }, signal: AbortSignal.timeout(8_000), redirect: 'error' });
  if (!response.ok) throw new HttpError(502,'GATEWAY_VERIFICATION_FAILED','Unable to verify event with Omise');
  return object(await response.json() as unknown);
}

export function verifyPaymentWebhook(db: TenantDatabase, provider: Provider, secrets: SecretResolver): RequestHandler {
  return async (req, res, next) => {
    let companyId: string; let routeId: string;
    try { companyId = uuid(text(req.params['companyId'],'companyId')); routeId = uuid(text(req.params['routeId'],'routeId')); }
    catch { throw new HttpError(404,'WEBHOOK_NOT_FOUND','Webhook endpoint not found'); }
    const raw: unknown = req.body;
    if (!Buffer.isBuffer(raw)) throw new HttpError(400,'RAW_BODY_REQUIRED','Raw application/json body required');
    const controller = new AbortController();
    res.once('close', () => controller.abort(new Error('Request disconnected')));
    res.once('finish', () => controller.abort(new Error('Request finished')));
    await db.runAsTenant(companyId, async () => {
      const result = await db.query<Connection>(sql`
        SELECT i.id,i.provider,i.external_account_id,i.credentials_secret_ref
        FROM app.integration_connections i JOIN app.companies c ON c.company_id=i.company_id
        WHERE i.company_id=${companyId} AND i.webhook_route_id=${routeId}
          AND i.provider=${provider} AND i.is_active AND c.status='ACTIVE'`);
      const connection = result.rows[0];
      if (!connection) throw new HttpError(404,'WEBHOOK_NOT_FOUND','Webhook endpoint not found');
      const secret = await secrets(connection.credentials_secret_ref);
      let payload: JsonObject; let eventId: string; let eventType: string;
      try {
        if (provider === 'STRIPE') {
          const stripe = new Stripe(text(secret['apiKey'],'apiKey'));
          const event = stripe.webhooks.constructEvent(raw, req.get('stripe-signature') ?? '', text(secret['webhookSecret'],'webhookSecret'), 300);
          if (typeof secret['livemode'] !== 'boolean' || event.livemode !== secret['livemode']) throw new Error('Mode mismatch');
          if (event.account && event.account !== connection.external_account_id) throw new Error('Account mismatch');
          payload = object(event); eventId = event.id; eventType = event.type;
        } else if (provider === 'OMISE') {
          const delivered = object(JSON.parse(raw.toString('utf8')) as unknown);
          const id = text(delivered['id'],'id');
          if (!/^evnt_[a-zA-Z0-9_]+$/.test(id)) throw new Error('Invalid event id');
          payload = await omiseGet(`/events/${encodeURIComponent(id)}`,text(secret['secretKey'],'secretKey'));
          eventId = text(payload['id'],'id'); eventType = text(payload['key'],'key');
          if (eventId !== id || typeof secret['livemode'] !== 'boolean' || payload['livemode'] !== secret['livemode']) throw new Error('Event account/mode mismatch');
          const charge=object(payload['data']);
          if (['charge.complete','charge.capture','charge.create'].includes(eventType) && charge['paid']===true) {
            const chargeId=text(charge['id'],'charge id');
            if (!/^chrg_[a-zA-Z0-9_]+$/.test(chargeId)) throw new Error('Invalid charge id');
            const current=await omiseGet(`/charges/${encodeURIComponent(chargeId)}`,text(secret['secretKey'],'secretKey'));
            if (current['id']!==chargeId || current['paid']!==true || current['status']!=='successful' ||
                current['amount']!==charge['amount'] || current['currency']!==charge['currency'] || current['livemode']!==secret['livemode']) {
              throw new HttpError(409,'CHARGE_RECONCILIATION_REQUIRED','Current Omise charge disagrees with the event');
            }
          }
          // Never trust the unsigned delivery body. The authenticated Events API
          // supplies the complete canonical event, under this merchant's key.
        } else {
          if (secret['transactionTimezone'] !== 'Asia/Bangkok') throw new Error('2C2P merchant transaction timezone must be configured as Asia/Bangkok');
          const envelope = object(JSON.parse(raw.toString('utf8')) as unknown);
          const token = text(envelope['payload'],'payload',65_536);
          const result = await jwtVerify(token,new TextEncoder().encode(text(secret['merchantSecret'],'merchantSecret')), { algorithms: ['HS256'] });
          payload = object(result.payload);
          if (payload['merchantID'] !== connection.external_account_id) throw new Error('Merchant mismatch');
          // PGW v4 backend payment responses have no event UUID. Scope their
          // stable identity by merchant/transaction/response status. Token iat,
          // exp and jti can change on retries and are not payment identity.
          delete payload['iat']; delete payload['exp']; delete payload['nbf']; delete payload['jti'];
          eventType = `payment.${text(payload['respCode'],'respCode')}`;
          eventId = `${text(payload['invoiceNo'],'invoiceNo')}:${text(payload['tranRef'],'tranRef')}:${eventType}`;
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(401,'INVALID_WEBHOOK','Webhook authenticity verification failed');
      }
      // Provider identity is canonical. An arbitrary header must never create a
      // second processing key for the same signed payment event.
      const headerKey = req.get('idempotency-key');
      eventId=text(eventId,'event identity');eventType=text(eventType,'event type');
      if (headerKey && headerKey !== eventId) throw new HttpError(409,'IDEMPOTENCY_KEY_MISMATCH','Header key differs from verified event identity');
      if (eventId.length > 255) eventId = sha256(eventId);
      verified.set(req,Object.freeze({ companyId, connectionId: connection.id, provider,
        eventId,eventType,payload,fingerprint:sha256(canonical(payload)),verifiedAt:new Date() }));
      next();
    },controller.signal);
  };
}
