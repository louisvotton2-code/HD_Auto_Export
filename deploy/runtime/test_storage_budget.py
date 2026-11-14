import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('budget', Path(__file__).parent/'production/storage-budget.py')
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)
G = 1024**3


def sample(**updates):
    value = dict(diskTotalBytes=400*G, diskUsedBytes=G, databaseBytes=G//4, indexBytes=G//16, sqlStagingBytes=0,
                 walBytes=G//8, archiveBytes=G//8, stagingBytes=G//8, backupBytes=G//8)
    return {**value, **updates}


class StorageBudgetTests(unittest.TestCase):
    def test_projection_accounts_for_two_backups_and_no_index_double_count(self):
        before = sample()
        now = sample(diskUsedBytes=4*G, databaseBytes=G, indexBytes=G//2, archiveBytes=G)
        result = budget.estimate(before, now, processed=10000, target=20000)
        self.assertAlmostEqual(result['remainingGrowthBytes'], 2*G, delta=1)
        self.assertAlmostEqual(result['futureRecoveryReserveBytes'], 25*G, delta=2)
        self.assertFalse(result['pauseHeavyWork'])

    def test_projected_exhaustion_pauses_before_current_usage_is_high(self):
        result = budget.estimate(sample(), sample(databaseBytes=2*G, archiveBytes=2*G), processed=10000, target=1000000)
        self.assertTrue(result['pauseHeavyWork'])
        self.assertLess(result['currentRatio'], .60)

    def test_exact_projected_thresholds(self):
        for percent, warning, pause in [(59, False, False), (60, True, False), (70, True, True)]:
            # Account for the fixed 2 GiB WAL reserve to isolate projected thresholds.
            v = sample(diskUsedBytes=percent*4*G-2*G, databaseBytes=0, indexBytes=0, archiveBytes=0, walBytes=0, stagingBytes=0)
            result = budget.estimate(v, v, processed=10000, target=10000)
            self.assertEqual((result['warning'], result['pauseHeavyWork']), (warning, pause))

    def test_embedded_archives_reserve_whole_database_history_conservatively(self):
        before = sample(archivesInDatabase=True, archiveBytes=0)
        now = sample(archivesInDatabase=True, archiveBytes=0, databaseBytes=G)
        result = budget.estimate(before, now, processed=10000, target=20000)
        self.assertAlmostEqual(result['archiveHistoryReserveBytes'], 2*G, delta=1)

    def test_complete_sql_stage_is_fixed_not_extrapolated_per_detail(self):
        before = sample()
        now = sample(diskUsedBytes=4*G, databaseBytes=3*G, sqlStagingBytes=2*G, archiveBytes=0)
        result = budget.estimate(before, now, processed=10000, target=1000000)
        self.assertEqual(result['remainingGrowthBytes'], 99*G)
        self.assertEqual(result['fixedAdditionalStagingBytes'], 4*G+G//8)
        self.assertEqual(result['bytesPerSource']['databaseBytes'], G/10000)
        with self.assertRaises(ValueError):
            budget.estimate(before, sample(sqlStagingBytes=2*G), processed=10000, target=10000)

    def test_invalid_or_unmeasured_inputs_refuse(self):
        for kwargs in [dict(processed=9999, target=20000), dict(processed=10000, target=9999)]:
            with self.assertRaises(ValueError): budget.estimate(sample(), sample(), **kwargs)
        with self.assertRaises(ValueError): budget.estimate(sample(), sample(indexBytes=9*G), processed=10000, target=10000)
        with self.assertRaises(ValueError): budget.estimate(sample(), sample(diskTotalBytes=500*G), processed=10000, target=10000)


if __name__ == '__main__':
    unittest.main()
