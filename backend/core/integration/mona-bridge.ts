import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

interface BridgeRequest {
  method?: string;
  headers: IncomingHttpHeaders;
  query: Record<string, unknown>;
}
interface BridgeResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): BridgeResponse;
  json(body: unknown): unknown;
}
interface Dependencies {
  verifySession(token: string): unknown;
  loadUsers(): Promise<readonly Record<string, unknown>[]>;
  normalizeRole(role: unknown): string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}
const requiredKeys = ['MONA_CORE_URL', 'MONA_CORE_COMPANY_ID', 'MONA_CORE_JWT_PRIVATE_KEY',
  'MONA_CORE_JWT_ISSUER', 'MONA_CORE_JWT_AUDIENCE', 'MONA_CORE_JWT_KEY_ID'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const norm = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase() : '';
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createMonaBridge(dependencies: Dependencies) {
  return async (req: BridgeRequest, res: BridgeResponse): Promise<unknown> => {
    res.setHeader('Cache-Control', 'no-store');
    const env = dependencies.env ?? process.env;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!env['AUTH_SECRET']) return res.status(503).json({ error: 'AUTH_CONFIGURATION_REQUIRED' });
    const token = req.headers['x-api-token'];
    if (typeof token !== 'string' || token.split('.').length !== 2) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const session = dependencies.verifySession(token);
    if (!object(session) || !norm(session['u'])) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (dependencies.normalizeRole(session['role']) !== 'dev') return res.status(403).json({ error: 'DEV_REQUIRED' });
    try {
      const subject = norm(session['u']);
      const users = await dependencies.loadUsers();
      const user = users.find(row => norm(row['username']) === subject);
      if (!user || dependencies.normalizeRole(user['role']) !== 'dev') return res.status(403).json({ error: 'DEV_REQUIRED' });
      const missing = requiredKeys.filter(key => !env[key]?.trim());
      if (req.query['view'] === 'status') {
        return res.status(200).json({ configured: missing.length === 0, missing,
          databaseConnectionVerified: false, timezone: 'Asia/Bangkok' });
      }
      if (req.query['view'] !== 'profit') return res.status(400).json({ error: 'INVALID_VIEW' });
      const orderId = req.query['orderId'];
      if (typeof orderId !== 'string' || !uuidPattern.test(orderId)) return res.status(400).json({ error: 'INVALID_ORDER_ID' });
      if (missing.length) return res.status(503).json({ error: 'CORE_CONFIGURATION_REQUIRED', missing });
      const companyId = env['MONA_CORE_COMPANY_ID'] ?? '';
      if (!uuidPattern.test(companyId)) throw new Error('Invalid configured company');
      const base = new URL(env['MONA_CORE_URL'] ?? '');
      if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid configured origin');
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
      if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) throw new Error('HTTPS required');
      const key = createPrivateKey((env['MONA_CORE_JWT_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n'));
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('RSA 2048 required');
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: env['MONA_CORE_JWT_KEY_ID'] })}.${encode({
        iss: env['MONA_CORE_JWT_ISSUER'], aud: env['MONA_CORE_JWT_AUDIENCE'], sub: subject,
        company_id: companyId, iat: now, exp: now + 60, jti: randomUUID(),
      })}`;
      const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
      const response = await (dependencies.fetch ?? globalThis.fetch)(new URL(`/api/orders/${orderId}/profit`, base), {
        method: 'GET', headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid upstream response');
      const body: unknown = await response.json();
      if (!object(body)) throw new Error('Invalid upstream response');
      if (response.status >= 500) return res.status(502).json({ error: 'CORE_UNAVAILABLE' });
      if (response.status < 200 || response.status >= 500) throw new Error('Unexpected upstream status');
      return res.status(response.status).json(body);
    } catch {
      return res.status(502).json({ error: 'CORE_UNAVAILABLE' });
    }
  };
}
