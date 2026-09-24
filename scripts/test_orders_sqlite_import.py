import copy
import unittest
from orders_sqlite_import import apply_import, bootstrap, open_db, ReviewRequired, totals, undo
from orders_sqlite_trial import HEADERS


def row(sku='A', order='000123', item='L1'):
    return [f'Shopee:{order}:{item}', order, item, '2026-08-01', 'Shopee',
            'Payi', sku, 'Product ' + sku, 'M', sku, 'Product ' + sku,
            1, '100.25', 'completed', '2026-09-01', 'file.xlsx', 'old-batch', '', '']


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.db = open_db()
        self.addCleanup(self.db.close)

    def test_split_and_reorder_preserve_distinct_products(self):
        a, b = row(), row('B')
        result = apply_import(self.db, [[a], [b]])
        self.assertEqual(totals(self.db), (2, 20050, 2))
        b[2] = 'L9'; b[0] = 'changed-legacy'; b[16] = 'new-batch'
        again = apply_import(self.db, [[b, a]])
        self.assertTrue(again['replayed'])
        self.assertEqual(again['batch_id'], result['batch_id'])
        self.assertEqual(totals(self.db), (2, 20050, 2))

    def test_update_and_undo_restore_state(self):
        a, b = row(), row('B')
        first = apply_import(self.db, [[a, b]])
        a[12] = '90.10'; a[13] = 'cancelled'
        changed = apply_import(self.db, [[a]])
        self.assertEqual(changed['updated'], 1)
        self.assertEqual(totals(self.db), (2, 10025, 1))
        with self.assertRaises(ReviewRequired): undo(self.db, first['batch_id'])
        self.assertEqual(undo(self.db, changed['batch_id']), 1)
        self.assertEqual(totals(self.db), (2, 20050, 2))
        with self.assertRaises(ReviewRequired): apply_import(self.db, [[a]])
        undo(self.db, first['batch_id'])
        self.assertEqual(totals(self.db), (0, 0, 0))

    def test_ambiguous_file_rolls_back_everything(self):
        a = row(); duplicate = copy.deepcopy(a); duplicate[12] = '500'
        with self.assertRaises(ReviewRequired):
            apply_import(self.db, [[row('C')], [a], [duplicate]])
        self.assertEqual(totals(self.db), (0, 0, 0))

    def test_unknown_fallback_does_not_duplicate_existing_order(self):
        apply_import(self.db, [[row()]])
        with self.assertRaises(ReviewRequired):
            apply_import(self.db, [[row('New', 'new-order'), row('renamed')]])
        self.assertEqual(totals(self.db), (1, 10025, 1))

    def test_native_identity_allows_product_rename(self):
        a = row(item='000789')
        apply_import(self.db, [[a]])
        a[7] = 'New title'; a[6] = 'new SKU'
        self.assertEqual(apply_import(self.db, [[a]])['updated'], 1)
        self.assertEqual(totals(self.db), (1, 10025, 1))

    def test_business_and_platform_are_separate(self):
        a = row(); b = row(); b[5] = 'Outlet'
        c = row(); c[4] = 'Lazada'
        apply_import(self.db, [[a, b, c]])
        self.assertEqual(totals(self.db), (3, 30075, 3))

    def test_historical_ambiguity_is_preserved_but_not_auto_updated(self):
        a = row(); b = copy.deepcopy(a); b[12] = '50'
        src = {'tab': 'raw_orders_2026_08', 'month': '2026-08',
               'values': [HEADERS[:19], a, b]}
        sid = bootstrap(self.db, src)
        self.assertEqual(totals(self.db), (2, 15025, 2))
        with self.assertRaises(ReviewRequired): apply_import(self.db, [[a]])
        with self.assertRaises(ReviewRequired): undo(self.db, sid)
        self.assertEqual(self.db.execute('SELECT count(*) FROM origins').fetchone()[0], 2)

    def test_scientific_notation_ids_restored_from_order_key(self):
        # Sheets shows old numeric Lazada ids as 1.12E+15; two real orders must stay apart
        a = row('A', '1120000000000001', '1120000000000011')
        b = row('B', '1120000000000002', '1120000000000022')
        for r in (a, b):
            r[1] = '1.12E+15'; r[2] = '1.12E+15'; r[4] = 'Lazada'; r[0] = r[0].replace('Shopee', 'Lazada')
        apply_import(self.db, [[a, b]])
        self.assertEqual(totals(self.db), (2, 20050, 2))
        a[13] = 'cancelled'
        self.assertEqual(apply_import(self.db, [[a]])['updated'], 1)

    def test_invalid_later_row_does_not_partially_commit(self):
        bad = row('B'); bad[3] = 'bad-date'
        with self.assertRaises(ValueError): apply_import(self.db, [[row()], [bad]])
        self.assertEqual(totals(self.db), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
