import type { Request, RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { sql, uuid, type TenantDatabase } from '../../../../packages/db/src/index.js';
import { HttpError } from '../http/errors.js';

export interface Principal { readonly companyId: string; readonly userId: string; readonly subject: string }
const principals = new WeakMap<Request, Principal>();
export function principalFor(req: Request): Principal {
  const principal = principals.get(req);
  if (!principal) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  return principal;
}
export interface TenantOptions {
  readonly issuer: string; readonly audience: string;
  readonly key: JWTVerifyGetKey;
}
export function remoteJwtKey(url: string): JWTVerifyGetKey {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('JWKS URL must use HTTPS');
  return createRemoteJWKSet(parsed, { timeoutDuration: 5_000, cooldownDuration: 30_000 });
}
export function tenant(db: TenantDatabase, options: TenantOptions): RequestHandler {
  if (!options.issuer || !options.audience) throw new Error('JWT issuer and audience are required');
  return async (req, res, next) => {
    const authorization = req.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'MISSING_TOKEN', 'Bearer token required');
    let payload;
    try {
      ({ payload } = await jwtVerify(authorization.slice(7), options.key, {
        issuer: options.issuer, audience: options.audience, algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub','iss','aud','exp','iat'], clockTolerance: 5, maxTokenAge:'1h',
      }));
    } catch { throw new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired access token'); }
    const claim = payload['company_id'];
    const header = req.get('x-company-id');
    if (claim !== undefined && typeof claim !== 'string') throw new HttpError(401, 'INVALID_TENANT_CLAIM', 'Invalid company claim');
    let companyId: string;
    try {
      if (claim && header && uuid(claim) !== uuid(header)) throw new Error('Mismatch');
      companyId = uuid(claim || header || '');
    } catch { throw new HttpError(403, 'INVALID_TENANT', 'A matching company claim or header is required'); }
    const controller = new AbortController();
    const close = (): void => { controller.abort(new Error('HTTP request finished')); };
    res.once('finish', close); res.once('close', close);
    await db.runAsTenant(companyId, async () => {
      const member = await db.query<{ id: string }>(sql`
        SELECT u.id FROM app.users u JOIN app.companies c ON c.company_id=u.company_id
        WHERE u.company_id=${companyId} AND u.auth_issuer=${options.issuer}
          AND u.auth_subject=${payload.sub ?? ''} AND u.status='ACTIVE' AND c.status='ACTIVE'`);
      const user = member.rows[0];
      if (!user) throw new HttpError(403, 'NOT_A_MEMBER', 'No active membership in this company');
      principals.set(req, Object.freeze({ companyId, userId: user.id, subject: payload.sub ?? '' }));
      next();
    }, controller.signal);
  };
}
export function requirePermission(db: TenantDatabase, permission: string): RequestHandler {
  return async (req, _res, next) => {
    const user = principalFor(req);
    const result = await db.query(sql`
      SELECT 1 FROM app.user_roles ur JOIN app.role_permissions rp
        ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id
      JOIN app.permissions p ON p.company_id=rp.company_id AND p.id=rp.permission_id
      WHERE ur.company_id=${user.companyId} AND ur.user_id=${user.userId} AND p.code=${permission} LIMIT 1`);
    if (!result.rowCount) throw new HttpError(403,'PERMISSION_DENIED','Insufficient permission');
    next();
  };
}
