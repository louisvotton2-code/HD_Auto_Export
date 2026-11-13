import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('routine', Path(__file__).parent/'production/routine-backup.py')
routine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routine)


class RoutineBackupTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
