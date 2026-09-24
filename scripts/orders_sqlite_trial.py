"""Local-only migration rehearsal; preserves source duplicates, quarantines ambiguous keys."""
import argparse, collections, datetime, decimal, hashlib, json, pathlib, re, sqlite3

HEADERS='order_key order_id order_item_id date platform business sku_platform product_name variation_name master_sku display_name qty revenue order_status imported_at source_file import_id alias_key province shipping_option fulfillment_type buyer_hash'.split()
EXCLUDED=re.compile(r'cancel|ยกเลิก|return',re.I)
def money(value):
    d=decimal.Decimal(str(value or 0).replace(',',''))
    if not d.is_finite(): raise ValueError('Nonfinite money')
    return int((d*100).quantize(decimal.Decimal('1'),rounding=decimal.ROUND_HALF_UP))
def normalize(row):
    row=list(row)+['']*max(0,22-len(row))
    d=dict(zip(HEADERS,row))
    datetime.date.fromisoformat(str(d['date']))
    for name in ['order_key','order_id','order_item_id','sku_platform']:
        d[name]=str(d[name]).removeprefix("'")
    if not all(d[k] for k in ['order_key','order_id','platform','business']):raise ValueError('Missing identity')
    q=decimal.Decimal(str(d['qty']).replace(',',''))
    if not q.is_finite() or q!=q.to_integral_value():raise ValueError('Invalid quantity')
    return d,int(q),money(d['revenue']),int(bool(EXCLUDED.search(str(d['order_status']))))
def schema(db):
    db.executescript('''
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, source_tab TEXT, fetched_at TEXT, raw_count INTEGER);
    CREATE TABLE IF NOT EXISTS source_rows(snapshot_id TEXT REFERENCES snapshots(id), source_row INTEGER, raw_json TEXT NOT NULL, PRIMARY KEY(snapshot_id,source_row));
    CREATE TABLE IF NOT EXISTS orders(business TEXT, platform TEXT, order_key TEXT, order_id TEXT NOT NULL, date TEXT NOT NULL, sku TEXT, qty INTEGER NOT NULL, revenue_cents INTEGER NOT NULL, excluded INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(business,platform,order_key));
    CREATE TABLE IF NOT EXISTS quarantine(snapshot_id TEXT, source_row INTEGER, reason TEXT, PRIMARY KEY(snapshot_id,source_row));
    CREATE TABLE IF NOT EXISTS order_history(id INTEGER PRIMARY KEY, business TEXT, platform TEXT, order_key TEXT, old_payload TEXT, new_payload TEXT);
    CREATE INDEX IF NOT EXISTS orders_date_channel ON orders(date,business,platform);
    CREATE INDEX IF NOT EXISTS orders_sku_date ON orders(sku,date);
    ''')
def upsert(db,d,q,c,e):
    key=tuple(str(d[k]) for k in ['business','platform','order_key'])
    payload=json.dumps(d,ensure_ascii=False,sort_keys=True)
    old=db.execute('SELECT payload FROM orders WHERE business=? AND platform=? AND order_key=?',key).fetchone()
    if old and old[0]==payload:return 'unchanged'
    if old:db.execute('INSERT INTO order_history(business,platform,order_key,old_payload,new_payload) VALUES(?,?,?,?,?)',(*key,old[0],payload))
    db.execute('''INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(business,platform,order_key) DO UPDATE SET order_id=excluded.order_id,date=excluded.date,sku=excluded.sku,qty=excluded.qty,revenue_cents=excluded.revenue_cents,excluded=excluded.excluded,payload=excluded.payload''',(*key,d['order_id'],d['date'],d['master_sku'],q,c,e,payload))
    return 'updated' if old else 'inserted'
def selftest():
    db=sqlite3.connect(':memory:');schema(db)
    row=['key','26060480584E43','001','2026-08-01','Shopee','Payi','000123','test','','SKU','test',2,'100.25','completed']
    args=normalize(row)
    with db:
        assert upsert(db,*args)=='inserted'
        assert upsert(db,*args)=='unchanged'
    row[12]='90.10';row[13]='canceled'
    with db:assert upsert(db,*normalize(row))=='updated'
    assert db.execute('SELECT count(*),sum(revenue_cents),sum(excluded) FROM orders').fetchone()==(1,9010,1)
    assert db.execute('SELECT order_id FROM orders').fetchone()[0]=='26060480584E43'
    assert db.execute('SELECT count(*) FROM order_history').fetchone()[0]==1
    row[5]='Payi Outlet'
    try:
        with db:
            upsert(db,*normalize(row));raise RuntimeError('rollback')
    except RuntimeError:pass
    assert db.execute('SELECT count(*) FROM orders').fetchone()[0]==1
    with db:upsert(db,*normalize(row))
    assert db.execute('SELECT count(*) FROM orders').fetchone()[0]==2
    try:normalize(row[:3]+['bad-date']+row[4:]);raise AssertionError('Accepted invalid date')
    except ValueError:pass
    db.close();return ['repeat import','status and amount update','text identifiers','history','rollback','business isolation','invalid date rejection']
def main():
    p=argparse.ArgumentParser();p.add_argument('snapshot',nargs='?');p.add_argument('--db',default='tmp/orders-sqlite/orders-trial.sqlite');a=p.parse_args()
    tests=selftest()
    if not a.snapshot:print(json.dumps({'tests_passed':tests}));return
    src=json.loads(pathlib.Path(a.snapshot).read_text(encoding='utf8'));header=src['values'][0]
    if len(header)<18 or len(header)>22 or header!=HEADERS[:len(header)]:raise ValueError('Header mismatch: stop before importing')
    content=json.dumps(src['values'],ensure_ascii=False,separators=(',',':'))
    sid=hashlib.sha256((src['tab']+content).encode()).hexdigest()
    path=pathlib.Path(a.db);path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path);schema(db)
    prior=db.execute('SELECT id FROM snapshots').fetchall()
    if prior and prior!=[(sid,)]:raise ValueError('Trial DB holds a different snapshot; choose another --db path')
    rows=src['values'][1:];groups=collections.defaultdict(list);invalid={};all_valid=[]
    for i,r in enumerate(rows,2):
        try:
            v=normalize(r)
            if not v[0]['date'].startswith(src['month']+'-'):raise ValueError('Outside selected month')
            groups[tuple(v[0][k] for k in ['business','platform','order_key'])].append((i,v));all_valid.append(v)
        except (ValueError,decimal.InvalidOperation) as err:invalid[i]=str(err)
    counts=collections.Counter()
    with db:
        db.execute('INSERT OR IGNORE INTO snapshots VALUES(?,?,?,?)',(sid,src['tab'],src['fetched_at'],len(rows)))
        for i,r in enumerate(rows,2):db.execute('INSERT OR IGNORE INTO source_rows VALUES(?,?,?)',(sid,i,json.dumps(r,ensure_ascii=False)))
        for i,reason in invalid.items():db.execute('INSERT OR IGNORE INTO quarantine VALUES(?,?,?)',(sid,i,reason))
        for entries in groups.values():
            if len(entries)>1:
                for i,v in entries:db.execute('INSERT OR IGNORE INTO quarantine VALUES(?,?,?)',(sid,i,'duplicate business/platform/order_key; no winner selected'))
            else:counts[upsert(db,*entries[0][1])]+=1
    expected=[len(all_valid),sum(v[2] for v in all_valid if not v[3]),sum(v[1] for v in all_valid if not v[3])]
    restored=[normalize(json.loads(r[0])) for r in db.execute('SELECT raw_json FROM source_rows WHERE snapshot_id=? ORDER BY source_row',(sid,)) if r[0]] if not invalid else []
    actual=[len(restored),sum(v[2] for v in restored if not v[3]),sum(v[1] for v in restored if not v[3])] if not invalid else None
    canonical=db.execute('SELECT count(*),coalesce(sum(CASE WHEN excluded=0 THEN revenue_cents ELSE 0 END),0),coalesce(sum(CASE WHEN excluded=0 THEN qty ELSE 0 END),0) FROM orders').fetchone()
    quarantine=db.execute('SELECT count(*) FROM quarantine').fetchone()[0]
    assert db.execute('SELECT count(*) FROM source_rows').fetchone()[0]==len(rows)
    if actual is not None:assert actual==expected
    # A repeat upsert must change neither row count nor history.
    history_before=db.execute('SELECT count(*) FROM order_history').fetchone()[0]
    with db:
        for entries in groups.values():
            if len(entries)==1:assert upsert(db,*entries[0][1])=='unchanged'
    assert db.execute('SELECT count(*) FROM order_history').fetchone()[0]==history_before
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    report={'source_tab':src['tab'],'fetched_at':src['fetched_at'],'source_rows':len(rows),'source_sales_cents':expected[1],'source_units':expected[2],'snapshot_exact_totals_match':actual==expected,'canonical_rows':canonical[0],'canonical_sales_cents':canonical[1],'canonical_units':canonical[2],'quarantined_rows':quarantine,'duplicate_key_groups':sum(len(x)>1 for x in groups.values()),'invalid_rows':len(invalid),'writes':dict(counts),'tests_passed':tests+['real snapshot repeat import','SQLite integrity'],'production_ready':False,'reason':'Local rehearsal only; duplicate keys require review before switching readers.'}
    backup=path.with_suffix('.backup.sqlite')
    with sqlite3.connect(backup) as dest:db.backup(dest)
    db.close()
    with sqlite3.connect(backup) as check:assert check.execute('SELECT count(*) FROM source_rows').fetchone()[0]==len(rows);assert check.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    report['backup_verified']=True;report['database_bytes']=path.stat().st_size
    report['missing_optional_source_columns']=HEADERS[len(header):]
    path.with_suffix('.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report,ensure_ascii=True,indent=2))
if __name__=='__main__':main()
