"""Independent comparison of a JS rehearsal report against a read-only Python v3 DB."""
import argparse
import collections
import json
from pathlib import Path
import sqlite3


def verify(report_path, db_path, js_db_path):
    report = json.loads(report_path.read_text(encoding='utf8'))
    with sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        expected = {
            tuple(r[:4]): tuple(r[4:]) for r in db.execute('''
                SELECT date,platform,business,sku,count(*),
                sum(CASE WHEN excluded=0 THEN cents ELSE 0 END),
                sum(CASE WHEN excluded=0 THEN qty ELSE 0 END)
                FROM lines GROUP BY date,platform,business,sku''')}
        python_records = collections.Counter(json.dumps(json.loads(r[0]), sort_keys=True) for r in db.execute('SELECT payload FROM lines'))
    with sqlite3.connect(js_db_path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        js_records = collections.Counter(json.dumps(json.loads(r[0]), sort_keys=True) for r in db.execute('SELECT payload FROM order_lines'))
    assert python_records == js_records, 'Normalized JS records differ from Python v3'
    actual = {
        tuple(r[k] for k in ['date', 'platform', 'business', 'sku']):
        tuple(r[k] for k in ['rows', 'cents', 'units']) for r in report['groups']}
    assert len(actual) == len(report['groups']), 'Duplicate groups in JS report'
    assert actual == expected, 'JS differs from Python v3 group totals'
    totals = tuple(sum(r[i] for r in expected.values()) for i in range(3))
    assert tuple(report[k] for k in ['rows', 'cents', 'units']) == totals
    result = {'python_v3_match': True, 'normalized_records_match': True, 'groups_checked': len(expected),
              'rows': totals[0], 'cents': totals[1], 'units': totals[2]}
    report_path.with_suffix('.verified.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps(result))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('report', type=Path)
    p.add_argument('python_db', type=Path)
    p.add_argument('js_db', type=Path)
    a = p.parse_args()
    verify(a.report, a.python_db, a.js_db)
