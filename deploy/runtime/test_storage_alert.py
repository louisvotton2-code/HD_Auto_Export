import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('storage_alert', Path(__file__).parent/'production/storage-alert.py')
alert=importlib.util.module_from_spec(spec)
spec.loader.exec_module(alert)


class StorageAlertTests(unittest.TestCase):
    def test_exact_thresholds_and_recovery_keep_queries_outside_monitor(self):
        for available, level in [(41,'ok'),(40,'warning'),(31,'warning'),(30,'paused'),(0,'paused'),(45,'ok')]:
            result=alert.classify(100,available)
            self.assertEqual(result['level'],level)
            self.assertEqual(result['pauseHeavyWork'],level=='paused')

    def test_unknown_or_invalid_capacity_is_never_healthy(self):
        for total,available in [(0,0),(100,-1),(100,101),(True,1),(100,1.5)]:
            with self.assertRaises(ValueError):alert.classify(total,available)


if __name__=='__main__':unittest.main()
