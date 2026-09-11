import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { sql, type TenantDatabase } from '../../../../packages/db/src/index.js';
import { HttpError } from '../http/errors.js';
import type { JsonValue } from '../http/json.js';
import { verifiedWebhook, type VerifiedWebhook } from '../modules/integrations/verification.js';

export interface WebhookResult { readonly status: number; readonly body: JsonValue }
export type WebhookProcessor = (event: VerifiedWebhook) => Promise<WebhookResult>;
interface Claim { readonly scope: string; readonly token: string; readonly event: VerifiedWebhook }
interface Stored { status: string; request_sha256: string; response_status: number | null;
  response_text: string | null; lock_token: string; expired: boolean }
const claims = new WeakMap<Request, Claim>();
function busy(): HttpError { return new HttpError(409,'IDEMPOTENCY_IN_PROGRESS','This event is already being processed'); }
function locked(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === '55P03';
}

export function idempotency(db: TenantDatabase): RequestHandler {
  return async (req,res,next) => {
    const event = verifiedWebhook(req);
    db.assertCompany(event.companyId);
    const scope = `webhook:${event.provider}:${event.connectionId}`;
    const token = randomUUID();
    let cached: { status: number; body: string } | undefined;
    try {
      await db.transaction(async () => {
        // Non-blocking lock also covers the initial INSERT race. Hash collisions
        // only cause a retryable 409, never share data or authorize another key.
        const lock = await db.query<{ acquired: boolean }>(sql`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`${event.companyId}:${scope}:${event.eventId}`},0)) AS acquired`);
        if (!lock.rows[0]?.acquired) throw busy();
        const old = await db.query<Stored>(sql`
          SELECT status,request_sha256,response_status,response_text,lock_token,locked_until<=clock_timestamp() AS expired
          FROM app.idempotency_keys WHERE company_id=${event.companyId} AND scope=${scope} AND key=${event.eventId} FOR UPDATE NOWAIT`);
        const row = old.rows[0];
        if (row) {
          if (row.request_sha256 !== event.fingerprint) throw new HttpError(409,'IDEMPOTENCY_PAYLOAD_CONFLICT','Event identity was reused with different verified data');
          if (row.status === 'COMPLETED') {
            if (row.response_status === null || row.response_text === null) throw new Error('Corrupt idempotency cache');
            cached={status:row.response_status,body:row.response_text}; return;
          }
          if (!row.expired) throw busy();
          await db.query(sql`UPDATE app.idempotency_keys SET lock_token=${token},locked_until=clock_timestamp()+interval '30 seconds'
            WHERE company_id=${event.companyId} AND scope=${scope} AND key=${event.eventId}`);
        } else {
          await db.query(sql`INSERT INTO app.idempotency_keys
            (company_id,scope,key,request_sha256,lock_token,locked_until,expires_at)
            VALUES (${event.companyId},${scope},${event.eventId},${event.fingerprint},${token},clock_timestamp()+interval '30 seconds','infinity')`);
        }
      });
    } catch (error) { if (locked(error)) throw busy(); throw error; }
    if (cached) { res.status(cached.status).type('application/json').send(cached.body); return; }
    claims.set(req,{scope,token,event});
    next();
  };
}

/** Pair with idempotency() on the same route. The processor receives no Response:
 * it returns data, and this adapter sends it only AFTER the database commits.
 * Every db.query/db.transaction in the processor joins this ambient transaction.
 */
export function transactionalWebhookHandler(db: TenantDatabase, processor: WebhookProcessor): RequestHandler {
  return async (req,res) => {
    const claim = claims.get(req);
    if (!claim) throw new Error('Idempotency middleware must precede this handler');
    claims.delete(req);
    const {event,scope,token}=claim;
    try {
      const reply = await db.transaction(async () => {
        const lock = await db.query<Stored>(sql`
          SELECT status,request_sha256,response_status,response_text,lock_token,locked_until<=clock_timestamp() AS expired
          FROM app.idempotency_keys WHERE company_id=${event.companyId} AND scope=${scope} AND key=${event.eventId} FOR UPDATE NOWAIT`);
        if (lock.rows[0]?.lock_token !== token || lock.rows[0].status !== 'PROCESSING') throw busy();
        // This row remains locked until commit; lease expiry cannot let another
        // worker steal a transaction that is still doing financial work.
        const inbox = await db.query<{ id: string; payload_sha256: string }>(sql`
          INSERT INTO app.webhook_events(company_id,connection_id,provider_event_id,event_type,payload_sha256,payload,signature_verified_at,status)
          VALUES (${event.companyId},${event.connectionId},${event.eventId},${event.eventType},${event.fingerprint},${JSON.stringify(event.payload)}::jsonb,${event.verifiedAt},'PROCESSING')
          ON CONFLICT (company_id,connection_id,provider_event_id) DO NOTHING RETURNING id,payload_sha256`);
        if (!inbox.rowCount) throw new HttpError(409,'EVENT_ALREADY_RECORDED','Event exists without its cache; reconcile before replay');
        const result = await processor(event);
        if (!Number.isInteger(result.status) || result.status < 200 || result.status > 299) {
          throw new HttpError(502,'WEBHOOK_PROCESSING_FAILED','Processing did not succeed; all changes were rolled back');
        }
        const body = JSON.stringify(result.body);
        if (Buffer.byteLength(body) > 64*1024) throw new Error('Webhook response exceeds cache limit');
        await db.query(sql`UPDATE app.webhook_events SET status='PROCESSED',processed_at=clock_timestamp(),attempts=attempts+1
          WHERE company_id=${event.companyId} AND connection_id=${event.connectionId} AND provider_event_id=${event.eventId}`);
        const updated = await db.query(sql`UPDATE app.idempotency_keys SET status='COMPLETED',response_status=${result.status},
          response_body=${body}::jsonb,response_text=${body},locked_until=clock_timestamp()
          WHERE company_id=${event.companyId} AND scope=${scope} AND key=${event.eventId} AND lock_token=${token}`);
        if (updated.rowCount !== 1) throw busy();
        return { status:result.status,body };
      });
      if (!res.destroyed) res.status(reply.status).type('application/json').send(reply.body);
    } catch (error) {
      // A disconnect may revoke this HTTP scope. In that case the bounded lease
      // recovers the claim. Never use a new privileged context to bypass abort.
      try {
        await db.transaction(async () => {
          await db.query(sql`SELECT key FROM app.idempotency_keys WHERE company_id=${event.companyId}
            AND scope=${scope} AND key=${event.eventId} FOR UPDATE NOWAIT`);
          await db.query(sql`UPDATE app.idempotency_keys SET locked_until=clock_timestamp()
            WHERE company_id=${event.companyId} AND scope=${scope} AND key=${event.eventId} AND lock_token=${token} AND status='PROCESSING'`);
        });
      } catch { /* Lease recovery is authoritative when the connection is gone. */ }
      if (locked(error)) throw busy();
      throw error;
    }
  };
}
