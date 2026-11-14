import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import json
import os
import stat
import tempfile
import threading
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('decision', Path(__file__).parent/'production/capacity-decision.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class CapacityDecisionTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 11, 14, tzinfo=dt.timezone.utc)
        self.input = dict(snapshotId='snapshot-1', targetRows=10000, sampleRows=1000,
                          evidenceHash='a'*64, diskTotalBytes=1000, currentUsedBytes=200,
                          projectedPeakBytes=699, sampleEvidenceSufficient=True,
                          components={'databaseBytes': 200})

    def test_binding_and_allow(self):
        result = m.decision(self.input, self.now)
        self.assertEqual(result['decision'], 'allow')
        self.assertEqual(result['evidenceHash'], 'a'*64)
        self.assertEqual(result['expiresAt'], '2026-11-14T00:10:00Z')

    def test_exact_threshold_blocks(self):
        self.input['projectedPeakBytes'] = 700
        self.assertEqual(m.decision(self.input, self.now)['decision'], 'blocked')

    def test_missing_and_insufficient_wait(self):
        self.assertEqual(m.decision(None, self.now)['decision'], 'wait')
        self.input['sampleEvidenceSufficient'] = False
        self.assertEqual(m.decision(self.input, self.now)['reason'], 'SYNC_CAPACITY_INSUFFICIENT_SAMPLE')

    def test_invalid_values_and_private_components_rejected(self):
        for key, value in [('sampleRows', True), ('evidenceHash', 'bad'), ('projectedPeakBytes', -1)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.decision({**self.input, key: value}, self.now)
        with self.assertRaises(ValueError):
            m.decision({**self.input, 'components': {'secret': 'not allowed'}}, self.now)

class AtomicDecisionTests(unittest.TestCase):
    def test_readers_observe_only_complete_old_or_new_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'decision.json'
            old = {'decision': 'allow', 'payload': 'old' * 4096}
            new = {'decision': 'wait', 'payload': 'new' * 4096}
            m.atomic_write(path, old, os.getgid())
            ready, stop = threading.Event(), threading.Event()
            errors, observations = [], []
            def read():
                while not stop.is_set():
                    try:
                        value = json.loads(path.read_text())
                        if value not in (old, new):
                            errors.append('partial or unexpected JSON')
                        observations.append(value['decision'])
                    except Exception as error:
                        errors.append(type(error).__name__)
                    ready.set()
            reader = threading.Thread(target=read)
            reader.start()
            try:
                self.assertTrue(ready.wait(5))
                for value in (new, old, new, old, new):
                    m.atomic_write(path, value, os.getgid())
            finally:
                stop.set(); reader.join(5)
            self.assertFalse(reader.is_alive())
            self.assertTrue(observations)
            self.assertEqual(errors, [])
            self.assertEqual(json.loads(path.read_text()), new)
            info = path.stat()
            self.assertEqual(stat.S_IMODE(info.st_mode), 0o640)
            self.assertEqual(info.st_gid, os.getgid())
            self.assertEqual(list(Path(directory).glob('.decision-*')), [])

    def test_replace_failure_preserves_complete_previous_file_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'decision.json'
            old = {'decision': 'wait'}
            m.atomic_write(path, old, os.getgid())
            with patch.object(m.os, 'replace', side_effect=OSError('fixture failure')):
                with self.assertRaises(OSError):
                    m.atomic_write(path, {'decision': 'allow'}, os.getgid())
            self.assertEqual(json.loads(path.read_text()), old)
            self.assertEqual(list(Path(directory).glob('.decision-*')), [])

    def test_measurement_failure_replaces_prior_allow_with_wait(self):
        self.assertEqual(os.getuid(), 0, 'Run controller filesystem tests in isolated root container')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'decision.json'
            m.atomic_write(path, {'decision': 'allow', 'evidenceHash': 'a'*64}, os.getgid())
            with patch.object(m, 'ROOT', root), patch.object(
                    m.importlib.util, 'spec_from_file_location', side_effect=RuntimeError('measurement unavailable')):
                m.main()
            value = json.loads(path.read_text())
            self.assertEqual(value['decision'], 'wait')
            self.assertIsNone(value['evidenceHash'])
            self.assertIsNone(value['projectedPeakBytes'])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o640)
            root.chmod(0o770)
            with patch.object(m, 'ROOT', root), self.assertRaises(ValueError):
                m.main()

if __name__ == '__main__':
    unittest.main()
