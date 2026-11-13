import datetime as dt
import importlib.util
from pathlib import Path
import unittest

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

if __name__ == '__main__':
    unittest.main()
