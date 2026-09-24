"""Build a fresh local v2 database and compare per-day/channel/SKU with source."""
import argparse
import collections
import json
from pathlib import Path
import sqlite3
from orders_sqlite_import import apply_import, bootstrap, identity, open_db, record, totals, undo
from orders_sqlite_trial import normalize


def run(snapshot, path):
    if path.exists():
        raise ValueError('Choose a new --db path; previous evidence is preserved')
    src = json.loads(snapshot.read_text(encoding='utf8'))
    rows = src['values'][1:]
    path.parent.mkdir(parents=True, exist_ok=True)
    db = open_db(path)
    try:
        bootstrap(db, src)
        expected = collections.defaultdict(lambda: [0, 0, 0])
        identities = collections.defaultdict(list)
        for r in rows:
            d, q, cents, excluded = normalize(r)
            key = (d['date'], d['platform'], d['business'], d['master_sku'])
            expected[key][0] += 1
            if not excluded:
                expected[key][1] += cents
                expected[key][2] += q
            identities[identity(record(r))].append(r)
        actual = {tuple(v[:4]): list(v[4:]) for v in db.execute('''
            SELECT date,platform,business,sku,count(*),
            sum(CASE WHEN excluded=0 THEN cents ELSE 0 END),
            sum(CASE WHEN excluded=0 THEN qty ELSE 0 END)
            FROM lines GROUP BY date,platform,business,sku''')}
        assert actual == dict(expected), 'Grouped totals differ'
        original = totals(db)
        assert original == tuple(sum(v[i] for v in expected.values()) for i in range(3))
        unique = [v[0] for v in identities.values() if len(v) == 1]
        # Full preflight includes every selected row even when delivered in small chunks.
        backwards = list(reversed(unique))
        replay = apply_import(db, [backwards[i:i+37] for i in range(0, len(backwards), 37)])
        assert replay['changed'] == 0 and totals(db) == original
        changed = list(unique[0]); changed[13] = 'cancelled'
        if changed[13] == unique[0][13]: changed[13] = 'completed'
        result = apply_import(db, [[changed]])
        assert result['updated'] == 1
        assert undo(db, result['batch_id']) == 1 and totals(db) == original
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        backup = path.with_suffix('.backup.sqlite')
        with sqlite3.connect(backup) as dest:
            db.backup(dest)
        with sqlite3.connect(backup) as check:
            assert totals(check) == original
            assert check.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        report = {
            'source_tab': src['tab'], 'source_fetched_at': src['fetched_at'],
            'rows': original[0], 'sales_cents': original[1], 'units': original[2],
            'grouped_totals_match': True, 'groups_checked': len(expected),
            'repeat_reordered_chunked_rows': len(unique),
            'ambiguous_identity_groups': sum(len(v)>1 for v in identities.values()),
            'ambiguous_identity_rows': sum(len(v) for v in identities.values() if len(v)>1),
            'status_update_and_latest_batch_undo': True, 'backup_verified': True,
            'production_ready': False,
            'limitations': ['Normalized sheet rows only; marketplace parsers not connected',
                'Complete-file staging required before import; no HTTP upload API yet',
                'Ambiguous identities and unmatched fallback products require review',
                'Bootstrap preserves source totals, not a certification of source accounting accuracy',
                'Only latest active batch can be undone']}
        path.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps(report, ensure_ascii=True, indent=2))
    finally:
        db.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('snapshot', type=Path)
    p.add_argument('--db', type=Path, default=Path('tmp/orders-sqlite/orders-import-v2.sqlite'))
    a = p.parse_args()
    run(a.snapshot, a.db)
