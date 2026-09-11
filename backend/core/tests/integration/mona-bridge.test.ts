import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { createMonaBridge } from '../../integration/mona-bridge.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const company = '10000000-0000-4000-8000-000000000001';
const order = '20000000-0000-4000-8000-000000000001';
const env: NodeJS.ProcessEnv = {
  AUTH_SECRET: 'test', MONA_CORE_URL: 'http://127.0.0.1:3001', MONA_CORE_COMPANY_ID: company,
  MONA_CORE_JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  MONA_CORE_JWT_ISSUER: 'mona-test', MONA_CORE_JWT_AUDIENCE: 'core-test', MONA_CORE_JWT_KEY_ID: 'test-key',
};
async function invoke(options: { config?: NodeJS.ProcessEnv; session?: unknown; role?: string; query?: Record<string, unknown>; fetch?: typeof fetch } = {}) {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  const handler = createMonaBridge({ env: options.config ?? env,
    verifySession: () => options.session === undefined ? { u: ' DEV ', role: 'dev' } : options.session,
    loadUsers: async () => [{ username: 'dev', role: options.role ?? 'dev' }],
    normalizeRole: role => String(role),
    fetch: options.fetch ?? (async () => { throw new Error('Unexpected network request'); }),
  });
  const res = { setHeader: (name: string, value: string) => { headers[name] = value; },
    status: (value: number) => { status = value; return res; }, json: (value: unknown) => { body = value; } };
  await handler({ method: 'GET', headers: { 'x-api-token': 'signed.session' },
    query: options.query ?? { view: 'profit', orderId: order } }, res);
  return { status, body, headers };
}
test('bridge fails closed without legacy auth, valid session, or current Dev role', async () => {
  assert.equal((await invoke({ config: {} })).status, 503);
  assert.equal((await invoke({ session: null })).status, 401);
  assert.equal((await invoke({ session: { u: 'dev', role: 'boss' } })).status, 403);
  assert.equal((await invoke({ role: 'staff' })).status, 403);
});
test('bridge reports missing configuration without exposing secrets or claiming DB readiness', async () => {
  const result = await invoke({ config: { AUTH_SECRET: 'test' }, query: { view: 'status' } });
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal((result.body as { databaseConnectionVerified: boolean }).databaseConnectionVerified, false);
  assert.equal((await invoke({ config: { AUTH_SECRET: 'test' } })).status, 503);
});
test('bridge signs server-controlled tenant and normalized identity; forwards financial conflicts', async () => {
  const result = await invoke({ query: { view: 'profit', orderId: order, companyId: 'attacker' }, fetch: async (input, init) => {
    assert.equal(String(input), `http://127.0.0.1:3001/api/orders/${order}/profit`);
    assert.equal(init?.redirect, 'error');
    const authorization = new Headers(init?.headers).get('Authorization') ?? '';
    const verified = await jwtVerify(authorization.slice(7), createLocalJWKSet({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key' }] }),
      { issuer: 'mona-test', audience: 'core-test', algorithms: ['RS256'] });
    assert.equal(verified.payload['company_id'], company);
    assert.equal(verified.payload.sub, 'dev');
    assert.equal((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0), 60);
    return Response.json({ error: 'MISSING_COST_HISTORY' }, { status: 409 });
  } });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: 'MISSING_COST_HISTORY' });
});
test('bridge rejects path injection and insecure remote origin, and hides upstream server failures', async () => {
  assert.equal((await invoke({ query: { view: 'profit', orderId: '../users' } })).status, 400);
  assert.equal((await invoke({ config: { ...env, MONA_CORE_URL: 'http://remote.example' } })).status, 502);
  const result = await invoke({ fetch: async () => Response.json({ password: 'sensitive' }, { status: 500 }) });
  assert.deepEqual(result.body, { error: 'CORE_UNAVAILABLE' });
  assert.equal(result.status, 502);
});
