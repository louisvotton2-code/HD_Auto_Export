import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
import sys
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent/'production'))
import backup_space
spec=importlib.util.spec_from_file_location('measure',Path(__file__).parent/'production/capacity-measure.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Peak(unittest.TestCase):
    def data(self):
        return dict(distinctProcessed=10000,targetRows=500000,sampleEvidenceSufficient=True,businessBytes=10000000,projectedBytesPerDetail=1000,sqlStagingBytes=20000000,archiveDirectoryBytes=1000000,walBytes=100000)
    def calculate(self,e, *, wal_on_disk=100000, wal_configured=1024**3, samples=((30_000_000, 6_000_000),),
                  daily=0, **scope):
        return m.project(e,used=50_000_000,total=400*1024**3,available_reserve=0,media=100000,
                         controls=1000,daily=daily,database=30_000_000,wal_on_disk=wal_on_disk,
                         wal_configured=wal_configured,samples=samples,**scope)
    def test_cumulative_wal_does_not_replace_disk_usage(self):
        e=self.data() | {'walBytes': 150*1024**3}
        result=self.calculate(e)
        self.assertEqual(result,self.calculate(self.data()))
        self.assertEqual(result['components']['protectedBytes'],18800000)
        self.assertEqual(result['components']['walBytes'],2*1024**3)
    def test_retained_wal_or_configuration_can_exceed_minimum(self):
        for resident,configured in ((4,3),(3,4)):
            with self.subTest(resident=resident,configured=configured):
                result=self.calculate(self.data(),wal_on_disk=resident*1024**3,wal_configured=configured*1024**3)
                self.assertEqual(result['components']['walBytes'],4*1024**3)
    def test_fixed_stage_not_scaled_by_details(self):
        e=self.data();r=self.calculate(e);self.assertEqual(r['components']['sqlSnapshotsBytes'],60000000)
        self.assertEqual(r['components']['recoveryDumpBytes'],140_000_000)
    def test_raw_history_is_counted_inside_database_once(self):
        c=self.calculate(self.data())['components']
        self.assertNotIn('historyBytes',c)
        self.assertEqual(c['recoveryPeakBytes'],4*c['recoveryPointBytes'])
        self.assertEqual(self.calculate(self.data(),samples=())['components']['recoveryDumpBytes'],560_000_000)
    def test_small_backup_does_not_set_compression_for_a_much_larger_live_database(self):
        c=self.calculate(self.data(),samples=((10_000_000,1_000_000),))['components']
        self.assertEqual(c['recoveryDumpBytes'],560_000_000)
    def test_shrinking_catalog_never_shrinks_retained_data(self):
        e=self.data();e['targetRows']=5000
        r=self.calculate(e)
        self.assertGreaterEqual(r['components']['businessBytes'],e['businessBytes'])
        self.assertEqual(r['components']['recoveryDumpBytes'],17_500_000)
        self.assertGreaterEqual(r['projectedPeakBytes'],r['currentUsedBytes'])
    def test_incomplete_fails_closed(self):
        e=self.data();e['sampleEvidenceSufficient']=False
        with self.assertRaises(ValueError):self.calculate(e)

    def test_first_party_changes_only_the_backup_estimate_and_keeps_old_retention(self):
        retained=1_500_000_000
        full=self.calculate(self.data(),daily=retained)
        scoped=self.calculate(self.data(),daily=retained,samples=((500_000,100_000),),
                              backup_database=1_000_000,backup_files=200_000)
        full_parts,parts=full['components'],scoped['components']
        for name in ('protectedBytes','businessBytes','sqlSnapshotsBytes','csvSnapshotsBytes','walBytes'):
            self.assertEqual(parts[name],full_parts[name])
        self.assertEqual(parts['recoveryDumpBytes'],250_000)
        self.assertEqual(parts['recoveryPointBytes'],450_000+backup_space.OVERHEAD)
        self.assertEqual(parts['recoveryPeakBytes'],retained+2*parts['recoveryPointBytes'])
        forecast_parts=('protectedBytes','businessBytes','sqlSnapshotsBytes','csvSnapshotsBytes','mediaBytes',
                        'controlsBytes','walBytes','filesystemReservedBytes','recoveryPeakBytes')
        self.assertEqual(scoped['projectedPeakBytes'],sum(parts[name] for name in forecast_parts))

    def test_incomplete_first_party_backup_size_cannot_lower_forecast(self):
        for values in ({'backup_database':100_000}, {'backup_files':10_000},
                       {'backup_database':0,'backup_files':10_000}):
            with self.subTest(values=values), self.assertRaisesRegex(ValueError,'first-party'):
                self.calculate(self.data(),**values)

class BoundedAdmission(unittest.TestCase):
    def test_host_config_accepts_finite_expansion_only_within_database_ceiling(self):
        for value in (150_000, 459_009, m.MAX_ADMISSION_TARGET_ROWS):
            with self.subTest(value=value), patch.object(m, 'private_json', return_value={
                'database': 'hd_release_'+'a'*16, 'admissionTargetRows': value, 'filesystemUuid': 'fixture'}), \
                 patch.object(m.subprocess, 'check_output', return_value='fixture\n'):
                self.assertEqual(m.config()['admissionTargetRows'], value)
        for value in (True, 0, m.MAX_ADMISSION_TARGET_ROWS+1):
            with self.subTest(value=value), patch.object(m, 'private_json', return_value={
                'database': 'hd_release_'+'a'*16, 'admissionTargetRows': value}):
                with self.assertRaisesRegex(ValueError, 'Invalid bounded admission target'):
                    m.config()

    def test_full_csv_binding_is_rejected_before_probe(self):
        c = {'admissionTargetRows': 100_000}
        with patch.object(m, 'config', return_value=c), \
             patch.object(m, 'evidence', return_value=Peak().data()), \
             patch.object(m.subprocess, 'run') as run:
            self.assertIsNone(m.measure())
            run.assert_not_called()

    def test_bounded_target_reads_normal_backups_without_starting_probe(self):
        e = Peak().data() | {'targetRows': 100_000, 'evidenceHash': 'a'*64}
        c = {'database': 'hd_release_'+'a'*16, 'admissionTargetRows': 100_000, 'mediaRoots': [], 'controlRoots': []}
        with patch.object(m,'config',return_value=c), patch.object(m,'evidence',return_value=e), \
             patch.object(m,'backup_policy',return_value={}), \
             patch.object(m,'sql',return_value={'database':30_000_000,'walOnDisk':100000,'walConfigured':1024**3}), \
             patch.object(m,'daily_bytes',return_value=0), patch.object(m,'recovery_samples',return_value=[(30_000_000,6_000_000)]), \
             patch.object(m.os,'statvfs') as disk, patch.object(m.subprocess,'run') as run:
            disk.return_value.f_blocks=400*1024**2
            disk.return_value.f_bfree=350*1024**2
            disk.return_value.f_bavail=346*1024**2
            disk.return_value.f_frsize=1024
            result=m.measure()
            forecast=m.measure(prospective_target_rows=1_000_000)
            run.assert_not_called()
        self.assertEqual(result['targetRows'],100_000)
        self.assertEqual(result['components']['filesystemReservedBytes'],4*1024**3)
        self.assertEqual(result['components']['recoveryDumpBytes'],40_000_000)
        self.assertEqual(forecast['incumbent']['evidenceHash'],e['evidenceHash'])
        self.assertEqual(forecast['incumbent']['targetRows'],100_000)
        self.assertEqual(forecast['prospectiveTargetRows'],1_000_000)
        self.assertNotIn('evidenceHash',forecast['prospective'])
        self.assertGreater(forecast['prospective']['projectedPeakBytes'],result['projectedPeakBytes'])

    def test_bounded_target_waits_when_sample_is_insufficient(self):
        e=Peak().data() | {'sampleEvidenceSufficient': False}
        with patch.object(m,'config',return_value={'admissionTargetRows':500_000}), \
             patch.object(m,'evidence',return_value=e), patch.object(m,'recovery_samples') as backup:
            self.assertIsNone(m.measure())
            backup.assert_not_called()

    def test_scoped_measurement_uses_exact_backup_inputs_and_authority(self):
        evidence = Peak().data() | {'evidenceHash': 'a'*64}
        sizes = {'database':30_000_000,'walOnDisk':100_000,'walConfigured':1024**3}
        policy = {'backupScope':m.SCOPE,'mediaRoots':['first-party-media'],'controlRoots':['backup-controls']}
        config = {'database':'hd_release_'+'a'*16,'mediaRoots':['physical-media'],'controlRoots':['physical-controls']}
        fs = SimpleNamespace(f_blocks=400*1024**2,f_bfree=350*1024**2,f_bavail=346*1024**2,f_frsize=1024)
        for last in (policy, {}):
            with self.subTest(changed=last!=policy), patch.object(m,'config',return_value=config), \
                 patch.object(m,'evidence',return_value=evidence), \
                 patch.object(m,'backup_policy',side_effect=(policy,last)), \
                 patch.object(m,'sql',side_effect=(sizes,1_000_000)) as query, \
                 patch.object(m,'daily_bytes',return_value=2_000_000), \
                 patch.object(m,'recovery_samples',return_value=[(1_000_000,400_000)]) as samples, \
                 patch.object(m,'allocated',side_effect=lambda path,**_: 2_000 if path=='backup-controls' else 1_000), \
                 patch.object(m.os,'statvfs',return_value=fs):
                result=m.measure()
            self.assertEqual(query.call_args.args,(config,m.measurement_sql()))
            samples.assert_called_once_with(m.ROOT/'backups/ext07',config['database'],scope=m.SCOPE)
            if last==policy:
                self.assertEqual(result['components']['firstPartyFilesBytes'],3_000)
                self.assertEqual(result['components']['recoveryDumpBytes'],500_000)
            else:
                self.assertIsNone(result)


class RecoveryScope(unittest.TestCase):
    def test_policy_must_match_the_backup_unit_database_disk_and_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            backups=root/'backups/ext07';backups.mkdir(parents=True)
            config={'database':'hd_release_'+'a'*16,'filesystemUuid':'disk-a'}
            policy=config|{'backupRoot':str(backups),'backupScope':m.SCOPE}
            with patch.object(m,'ROOT',root), patch.object(m,'private_json',return_value=policy) as read:
                self.assertEqual(m.backup_policy(config),policy)
                read.assert_called_once_with(root/'secrets/ext07/backup.json',private=True)
            for altered in ({'database':'other'},{'filesystemUuid':'disk-b'},
                            {'backupRoot':str(backups.parent)},{'backupScope':'unrecognized'}):
                with self.subTest(altered=altered), patch.object(m,'ROOT',root), \
                     patch.object(m,'private_json',return_value=policy|altered), self.assertRaises(ValueError):
                    m.backup_policy(config)

    def test_backup_scope_separates_legacy_and_scoped_samples(self):
        now=datetime(2026,11,20,tzinfo=timezone.utc)
        database='hd_release_'+'a'*16
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            metadata={}
            for hour,proof_scope,manifest_scope in ((10,None,None),(11,m.SCOPE,m.SCOPE),(12,m.SCOPE,None)):
                point=root/f'daily-20261119T{hour}0000Z';point.mkdir()
                created=f'2026-11-19T{hour}:00:00+00:00'
                proof=dict(kind='daily',name=point.name,complete=True,phase='finalized',format=2,createdAt=created,
                           completedAt=created,preflight={'databaseBytes':2000},ciphertextBytes=800,ciphertextSha256='a'*64)
                if proof_scope is not None:
                    proof['backupScope']=proof_scope
                manifest=dict(format=2,sourceDatabase=database,createdAt=created,files={'database.dump':{'bytes':400}})
                if manifest_scope is not None:
                    manifest['backupScope']=manifest_scope
                    manifest['files']['first-party.sql']={'bytes':72}
                metadata[point/'routine.json']=proof
                metadata[point/'manifest.json']=manifest
                (point/'recovery.cms').write_bytes(b'x'*800)
            lstat=Path.lstat
            def owned_cipher(path):
                info=lstat(path)
                if path.name=='recovery.cms':
                    return SimpleNamespace(st_mode=info.st_mode,st_size=info.st_size,st_uid=0)
                return info
            with patch.object(Path,'lstat',owned_cipher), \
                 patch.object(backup_space,'_read_private',side_effect=lambda path,_: metadata[path]):
                self.assertEqual(backup_space.recovery_samples(root,database,now),[(2000,400)])
                self.assertEqual(backup_space.recovery_samples(root,database,now,scope=m.SCOPE),[(2000,472)])


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
    def test_individual_files_match_du_without_a_subprocess(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp).resolve()
            empty = site / 'empty'
            empty.touch()
            regular = site / 'regular'
            regular.write_bytes(b'x' * 8192)
            linked = site / 'linked'
            os.link(regular, linked)
            sparse = site / 'sparse'
            with sparse.open('wb') as f:
                f.seek(8 * 1024 * 1024)
                f.write(b'x')
            files = [empty, regular, linked, sparse]
            expected = [
                int(subprocess.check_output(['du', '-s', '-B1', '--', str(path)]).split()[0])
                for path in files
            ]
            with patch.object(m, 'ROOT', site), patch.object(m.subprocess, 'check_output') as du:
                self.assertEqual([m.allocated(path) for path in files], expected)
                du.assert_not_called()

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
