// Local SQLite rehearsal on Node 24. No production API or remote DB connection.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

export const HEADERS = 'order_key order_id order_item_id date platform business sku_platform product_name variation_name master_sku display_name qty revenue order_status imported_at source_file import_id alias_key province shipping_option fulfillment_type buyer_hash'.split(' ');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export class ImportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new ImportError(code, message); }
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID', label);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 250) fail('INVALID', label);
  return value;
}
function cents(value) {
  const s = String(value || 0).replaceAll(',', '');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) fail('INVALID', 'Invalid money');
  const fraction = (m[3] || '').padEnd(3, '0');
  let n = BigInt(m[2]) * 100n + BigInt(fraction.slice(0, 2));
  if (fraction[2] >= '5') n++;
  if (m[1]) n = -n;
  const result = Number(n);
  if (!Number.isSafeInteger(result)) fail('INVALID', 'Money exceeds safe integer range');
  return result;
}
export function normalize(row) {
  if (!Array.isArray(row) || row.length < 14 || row.length > 22 || row.some(x => x !== null && !['string', 'number'].includes(typeof x))) fail('INVALID', 'Expected normalized sheet row');
  const d = Object.fromEntries(HEADERS.map((k, i) => [k, row[i] ?? '']));
  for (const k of ['order_key', 'order_id', 'order_item_id', 'sku_platform']) {
    if (typeof d[k] === 'number' && !Number.isSafeInteger(d[k])) fail('INVALID', 'Unsafe numeric identifier');
    d[k] = String(d[k]).replace(/^'/, '');
  }
  for (const k of ['order_key', 'order_id', 'business', 'platform']) text(d[k], k);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(Date.parse(d.date)) || new Date(d.date).toISOString().slice(0, 10) !== d.date) fail('INVALID', 'Invalid date');
  const parts = d.order_key.split(':');
  for (const [k, i] of [['order_id', 1], ['order_item_id', 2]]) {
    if (/^\d(?:\.\d+)?E\+\d+$/i.test(d[k])) {
      if (parts.length !== 3 || parts[0] !== d.platform || !parts[i] || /^\d(?:\.\d+)?E\+\d+$/i.test(parts[i])) fail('REVIEW', 'Cannot restore full identifier');
      d[k] = parts[i];
    }
  }
  const q = String(d.qty).replaceAll(',', '');
  if (!/^-?\d+(?:\.0+)?$/.test(q)) fail('INVALID', 'Invalid quantity');
  const qty = Number(q);
  integer(qty, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Quantity');
  const money = cents(d.revenue);
  if (/^L\d+$/.test(d.order_item_id)) d.order_item_id = '';
  for (const k of ['imported_at', 'import_id', 'source_file', 'order_key']) delete d[k];
  return { data: d, qty, cents: money, excluded: /cancel|ยกเลิก|return/i.test(String(d.order_status)) ? 1 : 0 };
}
function scope(r) { return canonical(['business', 'platform', 'order_id'].map(k => r.data[k])); }
function identity(r) {
  const d = r.data;
  if (!d.order_item_id && !d.sku_platform && !d.product_name) fail('REVIEW', 'Missing product identity');
  return hash([scope(r), ...(d.order_item_id ? ['native', d.order_item_id] : ['fallback', d.sku_platform, d.product_name, d.variation_name])]);
}

export class OrdersUploadStore {
  constructor(path = ':memory:') {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') fail('TRIAL_ONLY', 'Local trial cannot run in production');
    if (path !== ':memory:' && existsSync(path)) {
      // Inspect existing files read-only BEFORE creating tables or issuing writes.
      const check = new DatabaseSync(path, { readOnly: true });
      try {
        const table = check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payi_trial_identity'").get();
        if (!table || check.prepare('SELECT marker FROM payi_trial_identity WHERE id=1').get()?.marker !== 'orders-upload-local-v1') {
          fail('TRIAL_ONLY', 'Refusing an existing database without the local trial marker');
        }
      } finally { check.close(); }
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS payi_trial_identity(id INTEGER PRIMARY KEY CHECK(id=1), marker TEXT NOT NULL);
      INSERT OR IGNORE INTO payi_trial_identity VALUES(1,'orders-upload-local-v1');
      CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, manifest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error_code TEXT, UNIQUE(owner,request_key));
      CREATE TABLE IF NOT EXISTS upload_chunks(upload_id TEXT REFERENCES uploads(id), idx INTEGER, hash TEXT NOT NULL, row_count INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(upload_id,idx));
      CREATE TABLE IF NOT EXISTS order_batches(seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS order_lines(id TEXT PRIMARY KEY, scope TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS order_lines_scope ON order_lines(scope);
      CREATE TABLE IF NOT EXISTS order_changes(batch_id TEXT REFERENCES order_batches(id), line_id TEXT, before_payload TEXT, PRIMARY KEY(batch_id,line_id));
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  authorized(owner, id) {
    text(owner, 'Authenticated owner required');
    const u = this.db.prepare('SELECT * FROM uploads WHERE id=? AND owner=?').get(id, owner);
    if (!u) fail('NOT_FOUND', 'Upload not found for this owner');
    return u;
  }
  create(owner, requestKey, manifest) {
    text(owner, 'Authenticated owner required'); text(requestKey, 'Request key required');
    const { platform, business, expectedChunks, expectedRows, payloadHash, parserVersion } = manifest;
    text(platform, 'Platform'); text(business, 'Business');
    if (parserVersion !== 'sheet-v3') fail('INVALID', 'Only normalized sheet-v3 is implemented');
    integer(expectedChunks, 1, 10000, 'Chunk count'); integer(expectedRows, 1, 200000, 'Row count');
    if (expectedChunks > expectedRows || !/^[a-f0-9]{64}$/.test(payloadHash)) fail('INVALID', 'Invalid manifest');
    const payload = canonical({ platform, business, expectedChunks, expectedRows, payloadHash, parserVersion });
    return this.transaction(() => {
      const old = this.db.prepare('SELECT id,manifest FROM uploads WHERE owner=? AND request_key=?').get(owner, requestKey);
      if (old) {
        if (old.manifest !== payload) fail('CONFLICT', 'Request key already used with different manifest');
        return old.id;
      }
      const id = randomUUID();
      this.db.prepare("INSERT INTO uploads(id,owner,request_key,manifest,status) VALUES(?,?,?,?,'receiving')").run(id, owner, requestKey, payload);
      return id;
    });
  }
  status(owner, id) {
    const u = this.authorized(owner, id);
    const chunks = this.db.prepare('SELECT idx,row_count FROM upload_chunks WHERE upload_id=? ORDER BY idx').all(id);
    return { id, status: u.status, receivedChunks: chunks.map(c => c.idx), receivedRows: chunks.reduce((n,c) => n+c.row_count,0), manifest: JSON.parse(u.manifest), result: u.result ? JSON.parse(u.result) : null, errorCode: u.error_code };
  }
  putChunk(owner, id, index, rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) fail('INVALID', 'Chunk requires 1..1000 rows');
    const payload = canonical(rows);
    if (Buffer.byteLength(payload) > 2_000_000) fail('INVALID', 'Chunk too large');
    const digest = hash(rows);
    return this.transaction(() => {
      const u = this.authorized(owner, id); const m = JSON.parse(u.manifest);
      integer(index, 0, m.expectedChunks - 1, 'Chunk index');
      const old = this.db.prepare('SELECT hash FROM upload_chunks WHERE upload_id=? AND idx=?').get(id, index);
      if (old) {
        if (old.hash !== digest) fail('CONFLICT', 'Chunk content changed');
        return { repeated: true };
      }
      if (u.status !== 'receiving') fail('CONFLICT', 'Upload is no longer receiving');
      const count = this.db.prepare('SELECT coalesce(sum(row_count),0) AS n FROM upload_chunks WHERE upload_id=?').get(id).n;
      if (count + rows.length > m.expectedRows) fail('INVALID', 'Too many rows');
      this.db.prepare('INSERT INTO upload_chunks VALUES(?,?,?,?,?)').run(id, index, digest, rows.length, payload);
      return { repeated: false };
    });
  }
  finalize(owner, id) {
    try {
      return this.transaction(() => {
        const u = this.authorized(owner, id);
        if (u.status === 'complete') return JSON.parse(u.result);
        if (u.status !== 'receiving') fail('CONFLICT', 'Upload requires review; start a corrected session');
        const m = JSON.parse(u.manifest);
        const chunks = this.db.prepare('SELECT payload FROM upload_chunks WHERE upload_id=? ORDER BY idx').all(id);
        if (chunks.length !== m.expectedChunks) fail('INCOMPLETE', 'Missing chunks');
        const rows = chunks.flatMap(c => JSON.parse(c.payload));
        if (rows.length !== m.expectedRows) fail('INCOMPLETE', 'Row count differs');
        if (hash(rows) !== m.payloadHash) fail('INVALID', 'Payload hash differs');
        const incoming = rows.map(normalize);
        for (const r of incoming) if (r.data.platform !== m.platform || r.data.business !== m.business) fail('INVALID', 'Row is outside session scope');
        const keys = incoming.map(identity);
        if (new Set(keys).size !== keys.length) fail('REVIEW', 'Multiple rows share identity');
        const batchId = hash(incoming.map(canonical).sort());
        const prior = this.db.prepare('SELECT active FROM order_batches WHERE id=?').get(batchId);
        if (prior && !prior.active) fail('REVIEW', 'Previously undone batch requires explicit replay');
        let inserted = 0, updated = 0; const plan = [];
        if (!prior) {
          for (let i = 0; i < incoming.length; i++) {
            const r = incoming[i], key = keys[i], payload = canonical(r);
            const old = this.db.prepare('SELECT payload FROM order_lines WHERE id=?').get(key);
            if (!old && !r.data.order_item_id && this.db.prepare('SELECT 1 FROM order_lines WHERE scope=? LIMIT 1').get(scope(r))) fail('REVIEW', 'Unmatched fallback product in existing order');
            if (old?.payload !== payload) {
              plan.push({ key, r, payload, before: old?.payload ?? null });
              if (old) updated++; else inserted++;
            }
          }
          // No writes to live lines until every incoming row has passed preflight.
          this.db.prepare('INSERT INTO order_batches(id) VALUES(?)').run(batchId);
          for (const p of plan) {
            this.db.prepare('INSERT INTO order_changes VALUES(?,?,?)').run(batchId, p.key, p.before);
            this.db.prepare('INSERT INTO order_lines VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,payload=excluded.payload').run(p.key, scope(p.r), p.payload);
          }
        }
        const result = { batchId, inserted, updated, unchanged: incoming.length-inserted-updated, replayed: Boolean(prior) };
        this.db.prepare("UPDATE uploads SET status='complete',result=?,error_code=NULL WHERE id=?").run(canonical(result), id);
        return result;
      });
    } catch (error) {
      if (['REVIEW', 'INVALID'].includes(error.code)) this.db.prepare("UPDATE uploads SET status='blocked',error_code=? WHERE id=? AND owner=? AND status='receiving'").run(error.code, id, owner);
      throw error;
    }
  }
  undoLatest(batchId) {
    // Internal trusted operation only: no public route until permission guard exists.
    return this.transaction(() => {
      const latest = this.db.prepare('SELECT id FROM order_batches WHERE active=1 ORDER BY seq DESC LIMIT 1').get();
      if (latest?.id !== batchId) fail('CONFLICT', 'Only latest active batch can be undone');
      const changes = this.db.prepare('SELECT * FROM order_changes WHERE batch_id=?').all(batchId);
      for (const c of changes) {
        if (c.before_payload === null) this.db.prepare('DELETE FROM order_lines WHERE id=?').run(c.line_id);
        else {
          const r = JSON.parse(c.before_payload);
          this.db.prepare('UPDATE order_lines SET scope=?,payload=? WHERE id=?').run(scope(r), c.before_payload, c.line_id);
        }
      }
      this.db.prepare('UPDATE order_batches SET active=0 WHERE id=?').run(batchId);
      this.db.prepare("UPDATE uploads SET status='undone' WHERE status='complete' AND json_extract(result,'$.batchId')=?").run(batchId);
      return changes.length;
    });
  }
  totals() {
    return this.db.prepare(`SELECT count(*) AS rows,
      coalesce(sum(CASE WHEN json_extract(payload,'$.excluded')=0 THEN json_extract(payload,'$.cents') ELSE 0 END),0) AS cents,
      coalesce(sum(CASE WHEN json_extract(payload,'$.excluded')=0 THEN json_extract(payload,'$.qty') ELSE 0 END),0) AS units FROM order_lines`).get();
  }
}
