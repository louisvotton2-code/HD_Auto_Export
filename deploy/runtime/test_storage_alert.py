import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

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

    def test_80_percent_pause_preserves_60_percent_warning(self):
        for available,level in [(41,'ok'),(40,'warning'),(21,'warning'),(20,'paused')]:
            with self.subTest(available=available):
                self.assertEqual(alert.classify(100,available,stop_percent=80)['level'],level)

    def test_system_disk_gate_alerts_at_75_and_blocks_at_80(self):
        cases = [(26, 'ok', 0), (25, 'warning', 0), (21, 'warning', 0), (20, 'release-limit', 1)]
        for available, level, exit_code in cases:
            filesystem = SimpleNamespace(f_blocks=100, f_frsize=1024, f_bavail=available)
            with (
                self.subTest(available=available),
                patch('sys.argv', ['storage-alert', '--release-gate']),
                patch.object(alert.os, 'statvfs', return_value=filesystem),
                patch.object(alert, 'write_alert') as write,
                patch('sys.stdout', new_callable=io.StringIO) as output,
            ):
                self.assertEqual(alert.main(), exit_code)
                result=json.loads(output.getvalue())
                self.assertEqual(result['event'], 'hd_auto.system_disk')
                self.assertEqual(result['level'], level)
                self.assertEqual(result['blockRelease'], bool(exit_code))
                write.assert_not_called()


if __name__=='__main__':unittest.main()
