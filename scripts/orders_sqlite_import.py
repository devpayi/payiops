"""Local prototype for normalized sheet rows. Never writes Sheets or Turso.

Transport chunks must be collected into a complete file before apply_import.
Uncertain identity rejects the entire file. Historical bootstrap preserves all rows.
"""
import collections
import hashlib
import json
import re
import sqlite3

from orders_sqlite_trial import HEADERS, normalize


class ReviewRequired(ValueError):
    pass


def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(packed(value).encode()).hexdigest()


SCI = re.compile(r'\d(\.\d+)?E\+\d+', re.I)


def restore_ids(d):
    """Older imports stored order_id/order_item_id as numbers, so Sheets shows them
    as 1.12E+15 and distinct orders collapse. order_key (platform:order_id:item)
    kept the full text; take the lost parts back from it."""
    parts = str(d.get('order_key') or '').split(':', 2)
    if len(parts) != 3 or parts[0] != d['platform']:
        return
    if SCI.fullmatch(str(d['order_id'])):
        d['order_id'] = parts[1]
    if SCI.fullmatch(str(d['order_item_id'])):
        d['order_item_id'] = parts[2]


def record(row):
    d, qty, cents, excluded = normalize(row)
    restore_ids(d)
    # Transport metadata and old batch-local identifiers are not business changes.
    for key in ('imported_at', 'import_id', 'source_file', 'order_key'):
        d.pop(key, None)
    if re.fullmatch(r'L\d+', d['order_item_id']):
        d['order_item_id'] = ''
    return {'data': d, 'qty': qty, 'cents': cents, 'excluded': excluded}


def order_scope(r):
    d = r['data']
    return tuple(str(d[k]) for k in ('business', 'platform', 'order_id'))


def identity(r):
    d = r['data']
    # L<n> is conservatively treated as legacy synthetic, never as a native ID.
    part = ['native', d['order_item_id']] if d['order_item_id'] else [
        'fallback', d['sku_platform'], d['product_name'], d['variation_name']]
    if not d['order_item_id'] and not (d['sku_platform'] or d['product_name']):
        raise ReviewRequired('Missing product identity')
    return digest([*order_scope(r), *part])


def open_db(path=':memory:'):
    db = sqlite3.connect(path)
    db.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS imports (
            seq INTEGER PRIMARY KEY, batch_id TEXT UNIQUE NOT NULL,
            source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS lines (
            id TEXT PRIMARY KEY, identity_key TEXT NOT NULL,
            scope TEXT NOT NULL, date TEXT NOT NULL, platform TEXT NOT NULL,
            business TEXT NOT NULL, sku TEXT NOT NULL,
            qty INTEGER NOT NULL, cents INTEGER NOT NULL, excluded INTEGER NOT NULL,
            payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS lines_identity ON lines(identity_key);
        CREATE INDEX IF NOT EXISTS lines_date ON lines(date, platform, business, sku);
        CREATE TABLE IF NOT EXISTS changes (
            batch_id TEXT REFERENCES imports(batch_id), line_id TEXT,
            before_payload TEXT, after_payload TEXT NOT NULL,
            PRIMARY KEY(batch_id,line_id));
        CREATE TABLE IF NOT EXISTS origins (
            line_id TEXT PRIMARY KEY REFERENCES lines(id), snapshot_id TEXT,
            source_row INTEGER, legacy_key TEXT, raw_json TEXT NOT NULL);
    ''')
    return db


def put(db, line_id, r):
    d = r['data']
    db.execute('''INSERT INTO lines VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET identity_key=excluded.identity_key,
        scope=excluded.scope,date=excluded.date,platform=excluded.platform,
        business=excluded.business,sku=excluded.sku,qty=excluded.qty,
        cents=excluded.cents,excluded=excluded.excluded,payload=excluded.payload''',
        (line_id, identity(r), packed(order_scope(r)), d['date'], d['platform'],
         d['business'], d['master_sku'], r['qty'], r['cents'], r['excluded'], packed(r)))


def bootstrap(db, src):
    """One initial snapshot only; never deduplicate legacy rows silently."""
    header = src['values'][0]
    if not 18 <= len(header) <= 22 or header != HEADERS[:len(header)]:
        raise ValueError('Unexpected snapshot headers')
    sid = digest([src['tab'], src['values']])
    if db.execute('SELECT count(*) FROM imports').fetchone()[0]:
        raise ValueError('Bootstrap requires an empty database')
    with db:
        db.execute('INSERT INTO imports(batch_id,source) VALUES(?,?)', (sid, 'bootstrap'))
        for n, row in enumerate(src['values'][1:], 2):
            r = record(row)
            if not r['data']['date'].startswith(src['month'] + '-'):
                raise ValueError('Snapshot contains a different month')
            line_id = 'migration:' + digest([sid, n])
            put(db, line_id, r)
            db.execute('INSERT INTO origins VALUES(?,?,?,?,?)',
                       (line_id, sid, n, row[0], packed(row)))
    return sid


def apply_import(db, chunks, source='normalized trial file'):
    """Collect the COMPLETE input first; commit once after checking every line.

    In this prototype callers must supply a complete file, not call per HTTP chunk.
    A future upload API needs durable staging and an explicit finalize operation.
    """
    incoming = [record(row) for chunk in chunks for row in chunk]
    if not incoming:
        raise ValueError('Empty import')
    keys = [identity(r) for r in incoming]
    if len(set(keys)) != len(keys):
        raise ReviewRequired('Multiple lines share identity; explicit line mapping required')
    batch_id = digest(sorted(packed(r) for r in incoming))
    counts = collections.Counter()
    with db:
        # Lock before reading identity/state: two writers cannot both preflight then insert.
        db.execute('BEGIN IMMEDIATE')
        prior = db.execute('SELECT active FROM imports WHERE batch_id=?', (batch_id,)).fetchone()
        if prior:
            if not prior[0]:
                raise ReviewRequired('This batch was undone; explicit replay required')
            return {'batch_id': batch_id, 'replayed': True, 'changed': 0}
        plan = []
        for key, r in zip(keys, incoming):
            matches = db.execute('SELECT id,payload FROM lines WHERE identity_key=?', (key,)).fetchall()
            if len(matches) > 1:
                raise ReviewRequired('Historical identity is ambiguous; explicit mapping required')
            if matches:
                line_id, old = matches[0]
            else:
                existing = db.execute('SELECT 1 FROM lines WHERE scope=? LIMIT 1',
                                      (packed(order_scope(r)),)).fetchone()
                if existing and not r['data']['order_item_id']:
                    raise ReviewRequired('Unmatched product in existing order; review rename/new item')
                line_id, old = 'line:' + key, None
            new = packed(r)
            if old != new:
                plan.append((line_id, old, new, r))
                counts['updated' if old else 'inserted'] += 1
        if not plan:
            return {'batch_id': None, 'changed': 0, 'unchanged': len(incoming)}
        db.execute('INSERT INTO imports(batch_id,source) VALUES(?,?)', (batch_id, source))
        for line_id, old, new, r in plan:
            put(db, line_id, r)
            db.execute('INSERT INTO changes VALUES(?,?,?,?)', (batch_id, line_id, old, new))
    return {'batch_id': batch_id, 'changed': len(plan), **counts}


def undo(db, batch_id):
    """Only latest active import can be undone; bootstrap is protected."""
    with db:
        db.execute('BEGIN IMMEDIATE')
        latest = db.execute('SELECT batch_id,source FROM imports WHERE active=1 ORDER BY seq DESC LIMIT 1').fetchone()
        if not latest or latest[0] != batch_id or latest[1] == 'bootstrap':
            raise ReviewRequired('Only the latest non-bootstrap batch can be undone')
        events = db.execute('SELECT line_id,before_payload FROM changes WHERE batch_id=?', (batch_id,)).fetchall()
        for line_id, old in events:
            if old is None:
                db.execute('DELETE FROM lines WHERE id=?', (line_id,))
            else:
                put(db, line_id, json.loads(old))
        db.execute('UPDATE imports SET active=0 WHERE batch_id=?', (batch_id,))
    return len(events)


def totals(db):
    return db.execute('''SELECT count(*),
        coalesce(sum(CASE WHEN excluded=0 THEN cents ELSE 0 END),0),
        coalesce(sum(CASE WHEN excluded=0 THEN qty ELSE 0 END),0) FROM lines''').fetchone()
