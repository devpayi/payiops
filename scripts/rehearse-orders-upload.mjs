import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { HEADERS, OrdersUploadStore, hash } from './lib/orders-upload-store.mjs';

const [snapshotPath, dbPath] = process.argv.slice(2);
if (!snapshotPath || !dbPath) throw new Error('Usage: node scripts/rehearse-orders-upload.mjs <snapshot.json> <new-db.sqlite>');
if (existsSync(dbPath)) throw new Error('Choose a new database path; existing evidence is preserved');
const src=JSON.parse(readFileSync(snapshotPath,'utf8'));
assert.deepEqual(src.values[0],HEADERS.slice(0,src.values[0].length));
const byScope=new Map();
for (const r of src.values.slice(1)) {
  const key=JSON.stringify([r[4],r[5]]);
  if (!byScope.has(key)) byScope.set(key,[]);
  byScope.get(key).push(r);
}
const s=new OrdersUploadStore(dbPath);
try {
  let replayed=0;
  for (const [key,rows] of byScope) {
    for (let pass=0;pass<2;pass++) {
      const input=pass ? [...rows].reverse() : rows;
      const chunks=[]; for (let i=0;i<input.length;i+=500) chunks.push(input.slice(i,i+500));
      const [platform,business]=JSON.parse(key);
      const id=s.create('local-rehearsal',`${key}:${pass}`,{platform,business,parserVersion:'sheet-v3',expectedChunks:chunks.length,expectedRows:input.length,payloadHash:hash(input)});
      // Deliberately deliver chunks in reverse order and retry one.
      for (let i=chunks.length-1;i>=0;i--) s.putChunk('local-rehearsal',id,i,chunks[i]);
      s.putChunk('local-rehearsal',id,0,chunks[0]);
      const result=s.finalize('local-rehearsal',id);
      if (pass) { assert.equal(result.replayed,true); replayed+=input.length; }
    }
  }
  const groups=s.db.prepare(`SELECT json_extract(payload,'$.data.date') AS date,
    json_extract(payload,'$.data.platform') AS platform,json_extract(payload,'$.data.business') AS business,
    json_extract(payload,'$.data.master_sku') AS sku,count(*) AS rows,
    sum(CASE WHEN json_extract(payload,'$.excluded')=0 THEN json_extract(payload,'$.cents') ELSE 0 END) AS cents,
    sum(CASE WHEN json_extract(payload,'$.excluded')=0 THEN json_extract(payload,'$.qty') ELSE 0 END) AS units
    FROM order_lines GROUP BY date,platform,business,sku ORDER BY date,platform,business,sku`).all();
  const result={source:src.tab,sourceFetchedAt:src.fetched_at,...s.totals(),replayedRows:replayed,groups,productionReady:false};
  assert.equal(result.rows,src.values.length-1);
  assert.equal(s.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  writeFileSync(`${dbPath}.report.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,groups:groups.length},null,2));
} finally { s.close(); }
