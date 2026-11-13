import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('measure',Path(__file__).parent/'production/capacity-measure.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Peak(unittest.TestCase):
    def data(self):
        return dict(distinctProcessed=10000,targetRows=500000,sampleEvidenceSufficient=True,businessBytes=10000000,projectedBytesPerDetail=1000,sqlStagingBytes=20000000,archiveDirectoryBytes=1000000,walBytes=100000)
    def calculate(self,e):
        return m.project(e,dict(processedRows=10000,businessDumpBytes=1000000,rawDumpBytes=200000),used=50000000,total=400*1024**3,media=100000,controls=1000,daily=0,raw=2000000)
    def test_fixed_stage_not_scaled_by_details(self):
        e=self.data();r=self.calculate(e);self.assertEqual(r['components']['sqlSnapshotsBytes'],60000000)
        self.assertEqual(r['components']['recoveryPointBytes'],123101000)
    def test_history_and_compressed_backup_separate(self):
        r=self.calculate(self.data());self.assertEqual(r['components']['historyBytes'],100000000)
        self.assertEqual(r['components']['recoveryPeakBytes'],898637300)
    def test_incomplete_fails_closed(self):
        e=self.data();e['sampleEvidenceSufficient']=False
        with self.assertRaises(ValueError):self.calculate(e)
if __name__=='__main__':unittest.main()
