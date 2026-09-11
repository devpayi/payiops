import type { ErrorRequestHandler } from 'express';
import { TenantContextError } from '../../../../packages/db/src/index.js';
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  if (error instanceof HttpError) {
    if(error.code==='IDEMPOTENCY_IN_PROGRESS')res.set('Retry-After','2');
    res.status(error.status).json({ error: error.code, message: error.message }); return;
  }
  if (error instanceof TenantContextError) { res.status(403).json({ error: 'TENANT_SCOPE_DENIED' }); return; }
  if(error && typeof error==='object' && 'type' in error){
    if(error.type==='entity.too.large'){res.status(413).json({error:'BODY_TOO_LARGE'});return;}
    if(error.type==='entity.parse.failed'){res.status(400).json({error:'INVALID_JSON'});return;}
    if(error.type==='encoding.unsupported'){res.status(415).json({error:'UNSUPPORTED_ENCODING'});return;}
  }
  // Never return SQL text, driver details, tokens, or gateway response bodies.
  console.error(JSON.stringify({event:'http_error',requestId:res.get('X-Request-Id'),name:error instanceof Error?error.name:'UnknownError'}));
  res.status(500).json({ error: 'INTERNAL_ERROR' });
};
