import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrdersUploadStore, hash, normalize } from '../scripts/lib/orders-upload-store.mjs';

const row = (sku='A', order='0001', item='L1') => [`Shopee:${order}:${item}`,order,item,'2026-08-01','Shopee','Payi',sku,`Product ${sku}`,'M',sku,sku,1,'100.25','completed','','file.xlsx','old','',''];
const manifest = (rows, chunks=1) => ({ platform: 'Shopee', business: 'Payi', parserVersion: 'sheet-v3', expectedRows: rows.length, expectedChunks: chunks, payloadHash: hash(rows) });
function upload(s, rows, key='key') {
  const id = s.create('mo', key, manifest(rows)); s.putChunk('mo', id, 0, rows);
  return { id, result: s.finalize('mo', id) };
}
function store(t) { const s = new OrdersUploadStore(); t.after(() => s.close()); return s; }
const code = expected => e => e.code === expected;

test('refuses an unrelated database without modifying any bytes', t => {
  const dir=mkdtempSync(join(tmpdir(),'payi-protected-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'existing.sqlite'), db=new DatabaseSync(path);
  db.exec("CREATE TABLE important_data(value TEXT); INSERT INTO important_data VALUES('keep');"); db.close();
  const before=readFileSync(path);
  assert.throws(() => new OrdersUploadStore(path),code('TRIAL_ONLY'));
  assert.deepEqual(readFileSync(path),before);
});

test('production runtime cannot start trial importer', () => {
  const previous=process.env.NODE_ENV;
  try {
    process.env.NODE_ENV='production';
    assert.throws(() => new OrdersUploadStore(),code('TRIAL_ONLY'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous;
  }
});

test('partial uploads stay invisible; restart, out-of-order chunks and retries are durable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'payi-upload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'trial.sqlite'); let s = new OrdersUploadStore(path);
  const rows = [row(), row('B')], m = manifest(rows, 2);
  const id = s.create('mo','restart',m);
  assert.equal(s.create('mo','restart',m),id);
  s.putChunk('mo',id,1,[rows[1]]);
  assert.equal(s.totals().rows,0);
  assert.throws(() => s.finalize('mo',id),code('INCOMPLETE'));
  s.close(); s = new OrdersUploadStore(path);
  try {
    assert.deepEqual(s.status('mo',id).receivedChunks,[1]);
    assert.equal(s.putChunk('mo',id,1,[rows[1]]).repeated,true);
    s.putChunk('mo',id,0,[rows[0]]);
    const result = s.finalize('mo',id);
    assert.equal(result.inserted,2);
    assert.deepEqual(s.finalize('mo',id),result);
    assert.deepEqual({...s.totals()},{rows:2,cents:20050,units:2});
    const again = upload(s,[rows[1],rows[0]],'reordered');
    assert.equal(again.result.replayed,true);
  } finally { s.close(); }
});

test('owner checks protect chunk, status and finalization', t => {
  const s=store(t), rows=[row()], id=s.create('mo','owner',manifest(rows));
  for (const fn of [() => s.status('other',id), () => s.putChunk('other',id,0,rows), () => s.finalize('other',id)]) assert.throws(fn,code('NOT_FOUND'));
  assert.equal(s.totals().rows,0);
});

test('request and chunk conflicts cannot replace earlier content', t => {
  const s=store(t), rows=[row()], id=s.create('mo','key',manifest(rows));
  assert.throws(() => s.create('mo','key',manifest([row('B')])),code('CONFLICT'));
  s.putChunk('mo',id,0,rows);
  assert.throws(() => s.putChunk('mo',id,0,[row('B')]),code('CONFLICT'));
  s.finalize('mo',id); assert.equal(s.totals().cents,10025);
});

test('ambiguous rows across chunks block the whole file', t => {
  const s=store(t), a=row(), b=row(); b[12]='200';
  const id=s.create('mo','ambiguous',manifest([a,b],2));
  s.putChunk('mo',id,0,[a]); s.putChunk('mo',id,1,[b]);
  assert.throws(() => s.finalize('mo',id),code('REVIEW'));
  assert.equal(s.status('mo',id).status,'blocked'); assert.equal(s.totals().rows,0);
});

test('scope and manifest hash mismatch publish nothing', t => {
  const s=store(t), a=row(), b=row('B');
  const id=s.create('mo','hash',manifest([a])); s.putChunk('mo',id,0,[b]);
  assert.throws(() => s.finalize('mo',id),code('INVALID'));
  b[5]='Outlet'; const id2=s.create('mo','scope',manifest([b])); s.putChunk('mo',id2,0,[b]);
  assert.throws(() => s.finalize('mo',id2),code('INVALID')); assert.equal(s.totals().rows,0);
});

test('status and amount update preserve identity; undo restores or deletes only latest batch', t => {
  const s=store(t), a=row(), first=upload(s,[a]);
  a[12]='90.10'; a[13]='cancelled';
  const second=upload(s,[a],'update');
  assert.equal(second.result.updated,1); assert.equal(s.totals().cents,0);
  assert.throws(() => s.undoLatest(first.result.batchId),code('CONFLICT'));
  assert.equal(s.undoLatest(second.result.batchId),1); assert.equal(s.totals().cents,10025);
  assert.equal(s.status('mo',second.id).status,'undone');
  assert.throws(() => s.finalize('mo',second.id),code('CONFLICT'));
  assert.throws(() => upload(s,[a],'replay-undone'),code('REVIEW'));
  s.undoLatest(first.result.batchId); assert.equal(s.totals().rows,0);
});

test('unmatched fallback item in existing order blocks unrelated new order as well', t => {
  const s=store(t); upload(s,[row()]);
  assert.throws(() => upload(s,[row('C','new'),row('renamed')],'mixed'),code('REVIEW'));
  assert.equal(s.totals().rows,1);
});

test('native item id supports product rename without creating another line', t => {
  const s=store(t), a=row('A','0001','000009'); upload(s,[a]);
  a[7]='Renamed'; a[6]='New SKU';
  assert.equal(upload(s,[a],'renamed').result.updated,1); assert.equal(s.totals().rows,1);
});

test('v3 scientific notation restores full text IDs; bad IDs/dates/money rejected', () => {
  const a=row(); a[0]='Shopee:1123456789012345:1123456789012346'; a[1]='1.12E+15'; a[2]='1.12E+15';
  const r=normalize(a); assert.equal(r.data.order_id,'1123456789012345'); assert.equal(r.data.order_item_id,'1123456789012346');
  for (const [column,value] of [[3,'2026-02-30'],[12,'NaN'],[11,'1.2'],[1,Number.MAX_SAFE_INTEGER+1]]) {
    const bad=row(); bad[column]=value; assert.throws(() => normalize(bad),code('INVALID'));
  }
  const money=row(); money[12]='1.005'; assert.equal(normalize(money).cents,101);
});

test('second connection cannot publish same batch twice', t => {
  const dir=mkdtempSync(join(tmpdir(),'payi-two-writers-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'trial.sqlite'), a=new OrdersUploadStore(path), b=new OrdersUploadStore(path);
  try {
    const rows=[row()], id=a.create('mo','shared',manifest(rows));
    b.putChunk('mo',id,0,rows); const one=a.finalize('mo',id), two=b.finalize('mo',id);
    assert.deepEqual(one,two); assert.equal(b.totals().rows,1);
  } finally { a.close(); b.close(); }
});

test('database failure during writes rolls back lines, batch, history and session result', t => {
  const s=store(t), rows=[row(),row('B')], id=s.create('mo','failure',manifest(rows));
  s.putChunk('mo',id,0,rows);
  s.db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON order_lines
    WHEN (SELECT count(*) FROM order_lines)>0 BEGIN SELECT RAISE(ABORT,'injected failure'); END;`);
  assert.throws(() => s.finalize('mo',id),/injected failure/);
  assert.equal(s.totals().rows,0);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM order_batches').get().n,0);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM order_changes').get().n,0);
  assert.equal(s.status('mo',id).status,'receiving');
  s.db.exec('DROP TRIGGER fail_second');
  assert.equal(s.finalize('mo',id).inserted,2);
});
