import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
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
    def test_shrinking_catalog_never_shrinks_retained_data(self):
        e=self.data();e['targetRows']=5000
        r=self.calculate(e)
        self.assertGreaterEqual(r['components']['businessBytes'],e['businessBytes'])
        self.assertEqual(r['components']['historyBytes'],2000000)
        self.assertEqual(r['components']['recoveryPointBytes'],64301000)
        self.assertGreaterEqual(r['projectedPeakBytes'],r['currentUsedBytes'])
    def test_incomplete_fails_closed(self):
        e=self.data();e['sampleEvidenceSufficient']=False
        with self.assertRaises(ValueError):self.calculate(e)

class DumpBoundary(unittest.TestCase):
    def test_client_limits_private_network_and_readonly_credentials(self):
        c=dict(dumpNetwork='hd-auto-data',dumpHost='postgres',dumpUser='capacity_reader',database='hd_release_0123456789abcdef',dumpPgpassFile='/srv/hd-auto/secrets/capacity.pgpass')
        args=m.dump_command(c,'sha256:'+'a'*64,'probe-test',[])
        self.assertEqual(args[args.index('--cpus')+1],'0.25')
        self.assertEqual(args[args.index('--memory')+1],'256m')
        self.assertEqual(args[args.index('--network')+1],'hd-auto-data')
        self.assertIn('--read-only',args)
        self.assertIn('type=bind,src=/srv/hd-auto/secrets/capacity.pgpass,dst=/run/pgpass,readonly',args)
        self.assertFalse(any('PGPASSWORD=' in x for x in args))
        self.assertTrue(any('statement_timeout=600000' in x and 'default_transaction_read_only=on' in x for x in args))
        self.assertNotIn('-p',args)

class MeasurementRoots(unittest.TestCase):
    def test_exact_controls_and_site_paths_count_real_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); site=root/'site'; site.mkdir()
            control=root/'system-control'; control.mkdir()
            data=site/'data'; data.mkdir()
            (control/'config').write_bytes(b'x'*8192)
            (data/'payload').write_bytes(b'x'*8192)
            with patch.object(m,'ROOT',site), patch.object(m,'SYSTEM_CONTROL_ROOTS',frozenset([control])):
                self.assertGreaterEqual(m.allocated(control),8192)
                self.assertGreaterEqual(m.allocated(data),8192)
                # A named directory is allowed as one measured root, not a
                # blanket permission to add unrelated sibling/child roots.
                for invalid in [root,site,control/'config',root/'missing',Path('relative')]:
                    with self.assertRaises(ValueError):m.allocated(invalid)

    def test_links_parent_escape_and_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); site=root/'site'; site.mkdir()
            outside=root/'outside'; outside.mkdir(); (outside/'secret').write_text('fixture')
            (site/'escape').symlink_to(outside,target_is_directory=True)
            control=root/'control'; control.symlink_to(outside,target_is_directory=True)
            with patch.object(m,'ROOT',site), patch.object(m,'SYSTEM_CONTROL_ROOTS',frozenset([control])):
                for invalid in [site/'escape',site/'escape'/'secret',control,site/'..'/'outside']:
                    with self.assertRaises(ValueError):m.allocated(invalid)

    def test_host_allowlist_is_exact_and_bounded(self):
        self.assertEqual(m.SYSTEM_CONTROL_ROOTS,frozenset(map(Path,[
            '/etc/hd-auto','/etc/letsencrypt','/etc/fstab',
            '/etc/systemd/system/docker.service.d/hd-auto-storage.conf',
            '/usr/local/sbin/hd-auto-storage-check'])))
        for invalid in ['/','/etc','/usr','/etc/passwd','/etc/ssh','/tmp']:
            with self.assertRaises(ValueError):m.allocated(invalid)

class ProducerConsumer(unittest.TestCase):
    def test_shrinking_target_accepts_fixed_historical_sample(self):
        import datetime as dt
        spec=importlib.util.spec_from_file_location('controller',Path(__file__).parent/'production/capacity-decision.py')
        controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
        e=Peak().data();e['targetRows']=5000
        value=Peak().calculate(e)
        measured={**e,**value,'snapshotId':'snapshot-1','sampleRows':10000,'evidenceHash':'a'*64}
        result=controller.decision(measured,dt.datetime(2026,11,14,tzinfo=dt.timezone.utc))
        self.assertEqual(result['decision'],'allow')
        self.assertEqual(result['sampleRows'],10000)
        self.assertEqual(result['targetRows'],5000)

if __name__=='__main__':unittest.main()
