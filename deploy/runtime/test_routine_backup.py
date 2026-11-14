import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('routine', Path(__file__).parent/'production/routine-backup.py')
routine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routine)


class RoutineBackupTests(unittest.TestCase):
    def test_transient_peak_includes_components_container_and_cipher(self):
        self.assertEqual(routine.reserve_bytes(1000, 1000), 6600+128*1024**2)
        for invalid in [-1, True, '100']:
            with self.assertRaises(ValueError): routine.reserve_bytes(invalid, 0)
        with self.assertRaises(ValueError): routine.control_root(Path('/'))
        with self.assertRaises(ValueError): routine.control_root(Path('/srv/hd-auto/data'))
        with self.assertRaises(ValueError): routine.control_root(Path('/srv/hd-auto/secrets/../../../../etc/passwd'))
        self.assertEqual(routine.control_root(Path('/etc/fstab')), Path('/etc/fstab'))

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
