import importlib.util
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).parent/'production'))
spec = importlib.util.spec_from_file_location('routine', Path(__file__).parent/'production/routine-backup.py')
routine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routine)


class RoutineBackupTests(unittest.TestCase):
    def test_transient_peak_includes_components_container_and_cipher(self):
        self.assertEqual(routine.reserve_bytes(1000, 1000), 4000+256*1024**2)
        for invalid in [-1, True, '100']:
            with self.assertRaises(ValueError): routine.reserve_bytes(invalid, 0)
        with self.assertRaises(ValueError): routine.control_root(Path('/'))
        with self.assertRaises(ValueError): routine.control_root(Path('/srv/hd-auto/data'))
        with self.assertRaises(ValueError): routine.control_root(Path('/srv/hd-auto/secrets/../../../../etc/passwd'))
        self.assertEqual(routine.control_root(Path('/etc/fstab')), Path('/etc/fstab'))

    def test_projected_backup_counts_new_dump_and_cipher_once_each(self):
        self.assertEqual(routine.reserve_bytes(2000,100,[(1500,300)]),1200+256*1024**2)

    def test_output_guard_fails_before_reaching_seventy_percent(self):
        import io
        stream=io.BytesIO()
        with patch.object(routine.os,'statvfs',return_value=SimpleNamespace(f_blocks=1000,f_bavail=310,f_frsize=1)):
            writer=routine.BudgetWriter(stream,Path('/fixture'))
            self.assertEqual(writer.write(b'1'*9),9)
            with self.assertRaises(ValueError):
                writer.write(b'1'*10)
        self.assertEqual(stream.getvalue(),b'1'*9)

    @unittest.skipUnless(os.getuid()==0,'recovery evidence must be root-owned')
    def test_backup_evidence_requires_finalized_matching_point_and_cipher(self):
        import json
        from datetime import datetime, timezone
        now=datetime(2026,11,17,tzinfo=timezone.utc)
        database='hd_release_'+'a'*16
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            point=root/'daily-20261116T120000Z'
            point.mkdir()
            proof=dict(kind='daily',name=point.name,complete=True,phase='finalized',format=2,
                       createdAt='2026-11-16T12:00:00+00:00',completedAt='2026-11-16T12:05:00+00:00',
                       preflight={'databaseBytes':2000},ciphertextBytes=500,ciphertextSha256='a'*64)
            (point/'routine.json').write_text(json.dumps(proof))
            (point/'manifest.json').write_text(json.dumps(dict(format=2,sourceDatabase=database,
                createdAt=proof['createdAt'],files={'database.dump':{'bytes':400}})))
            (point/'recovery.cms').write_bytes(b'x'*500)
            self.assertEqual(routine.recovery_samples(root,database,now),[(2000,400)])
            self.assertEqual(routine.recovery_samples(root,database+'1',now),[])
            (point/'recovery.cms').write_bytes(b'x'*499)
            self.assertEqual(routine.recovery_samples(root,database,now),[])

    def test_retention_only_two_successful_daily_points(self):
        points = [dict(name=str(i), kind='daily', complete=True, createdAt=str(i)) for i in range(4)]
        points += [dict(name='release', kind='release', complete=True, createdAt='0'),
                   dict(name='failed', kind='daily', complete=False, createdAt='0')]
        self.assertEqual([p['name'] for p in routine.selected_old_points(points)], ['1', '0'])

    def test_archive_preserves_content_permissions_and_safe_relative_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'input';root.mkdir(mode=0o700)
            data = root/'secret';data.write_bytes(b'synthetic-only');data.chmod(0o600)
            (root/'current').symlink_to('secret')
            files = routine.pack_roots(Path(tmp)/'out.tar.gz', [root])
            self.assertEqual(files[str(data).lstrip('/')]['mode'], 0o600)
            self.assertEqual(files[str(root/'current').lstrip('/')]['target'], 'secret')
            self.assertTrue((Path(tmp)/'out.tar.gz').is_file())

    def test_escape_symlink_hardlink_and_missing_root_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'input';root.mkdir()
            (root/'escape').symlink_to('../outside')
            with self.assertRaises(ValueError): routine.regular_files([root])
            (root/'escape').unlink();(root/'file').write_bytes(b'a')
            os.link(root/'file', root/'other')
            with self.assertRaises(ValueError): routine.regular_files([root])
            with self.assertRaises(ValueError): routine.regular_files([root/'missing'])


class OnlineInputs(unittest.TestCase):
    def test_known_temporaries_and_thumbnails_are_not_archived(self):
        uid='12345678-1234-1234-1234-123456789abc'
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'media';root.mkdir()
            (root/(uid+'.webp')).write_bytes(b'original')
            for name in ['.'+uid+'.'+uid+'.tmp','.'+uid+'.'+uid+'.thumb.tmp',uid+'.thumb.webp']:
                (root/name).write_bytes(b'changing')
            files=routine.pack_roots(Path(temp)/'media.tar.gz',[root],'media')
            self.assertEqual({Path(p).name for p in files},{'media',uid+'.webp'})
            (root/'unknown.tmp').write_bytes(b'unknown')
            with self.assertRaises(ValueError):routine.regular_files([root],'media')

    def test_csv_partial_excluded_but_controls_not_filtered(self):
        uid='12345678-1234-1234-1234-123456789abc'
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'archive';root.mkdir()
            (root/(uid+'.csv')).write_bytes(b'complete')
            (root/(uid+'.csv.partial')).write_bytes(b'incomplete')
            self.assertEqual(len(routine.regular_files([root],'archive',{root/(uid+'.csv')})),2)
            self.assertEqual(len(routine.regular_files([root],'controls')),3)


    def test_only_committed_gzip_selected_and_missing_refused(self):
        uid='12345678-1234-1234-1234-123456789abc'
        other='22345678-1234-1234-1234-123456789abc'
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'archives';root.mkdir()
            (root/(uid+'.csv.gz')).write_bytes(b'complete')
            (root/(other+'.csv.gz')).write_bytes(b'in-progress')
            self.assertEqual(routine.archive_selection([dict(path='/private/full-sync/'+other+'.csv',state='downloading')],root),set())
            selected=routine.archive_selection([dict(path='/private/full-sync/'+uid+'.csv.gz',state='failed')],root)
            files=routine.regular_files([root],'archive',selected)
            self.assertIn(str(root/(uid+'.csv.gz')).lstrip('/'),files)
            self.assertNotIn(str(root/(other+'.csv.gz')).lstrip('/'),files)
            (root/(uid+'.csv.gz')).unlink()
            with self.assertRaises(ValueError):routine.regular_files([root],'archive',selected)
            (root/'unknown.csv.gz').write_bytes(b'bad')
            with self.assertRaises(ValueError):routine.regular_files([root],'archive',set())


class IncompleteJobs(unittest.TestCase):
    def test_pack_encrypt_and_interrupted_jobs_block_next_copy(self):
        import json
        for phase in ['dump-and-pack','encrypting',None]:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as temp:
                root=Path(temp);point=root/'daily-20261114T000000Z';point.mkdir()
                (point/'database.dump').write_bytes(b'partial-owned-material')
                if phase is not None:
                    (point/'routine.json').write_text(json.dumps(dict(kind='daily',name=point.name,complete=False,phase=phase)))
                with self.assertRaises(ValueError):routine.require_no_incomplete_points(root)
                self.assertEqual((point/'database.dump').read_bytes(),b'partial-owned-material')

    def test_unfinished_retention_blocks_another_point(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for n in range(3):
                point=root/f'daily-20261114T00000{n}Z';point.mkdir()
                (point/'routine.json').write_text(json.dumps(dict(kind='daily',name=point.name,complete=True)))
            with self.assertRaises(ValueError):routine.require_no_incomplete_points(root)

    def test_successful_point_does_not_block_next_job(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);point=root/'daily-20261114T000000Z';point.mkdir()
            (point/'routine.json').write_text(json.dumps(dict(kind='daily',name=point.name,complete=True)))
            routine.require_no_incomplete_points(root)


class Envelope(unittest.TestCase):
    def test_corrupt_survivor_blocks_retention(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); point=root/'daily-20261114T000000Z'; point.mkdir()
            (point/'recovery.cms').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                routine.verify_completed_points(root,[dict(name=point.name,complete=True,ciphertextSha256='0'*64)])

    def test_envelope_rejects_path_traversal(self):
        import tarfile, io
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); bundle=root/'bad.tar'
            with tarfile.open(bundle,'w') as archive:
                info=tarfile.TarInfo('../escape');info.size=1
                archive.addfile(info,io.BytesIO(b'x'))
            with self.assertRaises(ValueError): routine.unpack_verified_bundle(bundle,root/'restore')
            self.assertFalse((root/'escape').exists())

    def test_cleanup_preserves_all_components_when_one_changed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);names=['database.dump','media.tar.gz','source-archives.tar.gz','controls.tar.gz']
            for name in names:(root/name).write_bytes(b'fixture')
            manifest=dict(format=2,files={name:dict(bytes=7,sha256=routine.digest(root/name)) for name in names})
            (root/'controls.tar.gz').write_bytes(b'changed')
            with self.assertRaises(ValueError):routine.remove_verified_components(root,manifest)
            self.assertTrue(all((root/name).exists() for name in names))

    def test_verified_format_two_roundtrip(self):
        import json, tarfile
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); names=['database.dump','media.tar.gz','source-archives.tar.gz','controls.tar.gz']
            for name in names:(root/name).write_bytes(b'synthetic-'+name.encode())
            manifest=dict(format=2,files={name:dict(bytes=(root/name).stat().st_size,sha256=routine.digest(root/name)) for name in names})
            (root/'manifest.json').write_text(json.dumps(manifest))
            with tarfile.open(root/'bundle.tar','w') as archive:
                for name in [*names,'manifest.json']: archive.add(root/name,arcname=name)
            self.assertEqual(routine.unpack_verified_bundle(root/'bundle.tar',root/'restore'),manifest)
            routine.remove_verified_components(root/'restore',manifest)
            self.assertTrue((root/'restore/manifest.json').exists())
            self.assertFalse((root/'restore/database.dump').exists())


if __name__ == '__main__':
    unittest.main()
