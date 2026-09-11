import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolConfig, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { assertStatement, type Statement } from './sql.js';

export class TenantContextError extends Error {}
const activeDatabase = new AsyncLocalStorage<TenantDatabase>();
export function databaseForScope(): TenantDatabase {
  const database = activeDatabase.getStore();
  if (!database) throw new TenantContextError('No active tenant database');
  database.currentCompanyId();
  return database;
}
export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new TenantContextError('Invalid UUID');
  }
  return value.toLowerCase();
}
interface Scope { readonly companyId: string; readonly signal?: AbortSignal }
interface Transaction {
  readonly client: PoolClient;
  readonly scope: Scope;
  readonly isolation: Isolation;
  readonly readOnly: boolean;
  active: boolean;
  failure: unknown;
  pending: number;
}
type Isolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
export interface TransactionOptions { readonly isolation?: Isolation; readonly readOnly?: boolean }
export interface DatabaseOptions extends PoolConfig { onPoolError: (error: Error) => void }

export class TenantDatabase {
  readonly #pool: Pool;
  readonly #scope = new AsyncLocalStorage<Scope>();
  readonly #transaction = new AsyncLocalStorage<Transaction>();

  constructor({ onPoolError, ...config }: DatabaseOptions) {
    this.#pool = new Pool({ max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000,
      application_name: 'cmo-api', ...config });
    this.#pool.on('error', onPoolError);
  }

  /** Run during startup; the production login must never be an owner/admin. */
  async verifyRuntimeRole(): Promise<void> {
    const client = await this.#pool.connect();
    try { await this.#checkRole(client); } finally { client.release(); }
  }
  async #checkRole(client: PoolClient): Promise<void> {
    const result = await client.query<{ safe: boolean }>(`
      SELECT pg_has_role(session_user, 'cmo_runtime', 'MEMBER')
        AND NOT pg_has_role(session_user, 'cmo_owner', 'MEMBER')
        AND NOT EXISTS (SELECT FROM pg_roles WHERE (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
          AND pg_has_role(session_user, oid, 'MEMBER'))
        AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='app' AND c.relkind IN ('r','p') AND
            (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR c.relowner=(SELECT oid FROM pg_roles WHERE rolname=session_user)))
        AS safe`);
    if (result.rows[0]?.safe !== true) throw new TenantContextError('Unsafe database role or tenant RLS configuration');
  }

  /** Trusted server entry point. HTTP callers must authenticate before use. */
  runAsTenant<T>(companyId: string, action: () => T, signal?: AbortSignal): T {
    const id = uuid(companyId);
    const old = this.#scope.getStore();
    if (old && old.companyId !== id) throw new TenantContextError('Cannot switch tenant inside an existing scope');
    const scope = old ?? Object.freeze(signal ? { companyId: id, signal } : { companyId: id });
    scope.signal?.throwIfAborted();
    if (activeDatabase.getStore() && activeDatabase.getStore() !== this) throw new TenantContextError('Cannot change database inside a scope');
    return activeDatabase.run(this, () => this.#scope.run(scope, action));
  }
  currentCompanyId(): string {
    const scope = this.#scope.getStore();
    if (!scope) throw new TenantContextError('A verified tenant scope is required');
    scope.signal?.throwIfAborted();
    return scope.companyId;
  }
  assertCompany(companyId: string): void {
    if (this.currentCompanyId() !== uuid(companyId)) throw new TenantContextError('Tenant argument does not match active scope');
  }
  async query<R extends QueryResultRow = QueryResultRow>(statement: Statement): Promise<QueryResult<R>> {
    assertStatement(statement);
    this.currentCompanyId();
    const transaction = this.#transaction.getStore();
    if (!transaction) return this.transaction(() => this.query<R>(statement));
    if (!transaction.active) throw new TenantContextError('Transaction has already finished');
    if (transaction.failure) throw new TenantContextError('Transaction has failed and must roll back');
    this.assertCompany(transaction.scope.companyId);
    transaction.pending++;
    try {
      const config = { text: statement.text, values: [...statement.values], queryMode: 'extended' as const };
      return await transaction.client.query<R>(config);
    } catch (error) { transaction.failure = error; throw error; }
    finally { transaction.pending--; }
  }
  async transaction<T>(action: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    this.currentCompanyId();
    const scope = this.#scope.getStore();
    if (!scope) throw new TenantContextError('Tenant scope missing');
    const existing = this.#transaction.getStore();
    if (existing) {
      if (!existing.active || existing.failure) throw new TenantContextError('Transaction is not usable');
      if (options.isolation && options.isolation !== existing.isolation) throw new TenantContextError('Cannot change nested transaction isolation');
      if (options.readOnly === false && existing.readOnly) throw new TenantContextError('Cannot write in a read-only transaction');
      try { return await action(); } catch (error) { existing.failure = error; throw error; }
    }
    const client = await this.#pool.connect();
    let begun = false;
    let destroy = false;
    const isolation = options.isolation ?? 'READ COMMITTED';
    if (!['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'].includes(isolation)) {
      client.release();
      throw new TenantContextError('Invalid isolation level');
    }
    const transaction: Transaction = { client, scope, isolation, readOnly: options.readOnly ?? false,
      active: true, failure: undefined, pending: 0 };
    try {
      // Check every checkout: do not reuse a connection whose login was escalated.
      await this.#checkRole(client);
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}${transaction.readOnly ? ' READ ONLY' : ''}`);
      begun = true;
      await client.query('SET LOCAL ROLE cmo_runtime');
      await client.query("SELECT set_config('app.company_id',$1,true), set_config('TimeZone','Asia/Bangkok',true), set_config('search_path','pg_catalog,app',true), set_config('statement_timeout','15000',true), set_config('lock_timeout','1500',true), set_config('idle_in_transaction_session_timeout','30000',true)", [scope.companyId]);
      const value = await this.#transaction.run(transaction, action);
      scope.signal?.throwIfAborted();
      if (transaction.failure) throw transaction.failure;
      if (transaction.pending !== 0) throw new TenantContextError('All database queries must be awaited before commit');
      transaction.active = false;
      await client.query('COMMIT');
      begun = false;
      return value;
    } catch (error) {
      transaction.active = false;
      if (begun) {
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
      }
      throw error;
    } finally { client.release(destroy); }
  }
  async close(): Promise<void> { await this.#pool.end(); }
}
