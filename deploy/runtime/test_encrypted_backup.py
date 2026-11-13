"""Authenticated encryption and refusal boundaries; synthetic data, no server access."""
from datetime import datetime, timezone, timedelta
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from collections import namedtuple

spec = importlib.util.spec_from_file_location('encrypted_backup', Path(__file__).parent / 'production/encrypted-backup.py')
backup_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_tool)


class EncryptedBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.openssl = os.environ.get('HD_TEST_OPENSSL', 'openssl')
        cls.keys = tempfile.TemporaryDirectory()
        root = Path(cls.keys.name).resolve()
        cls.key, cls.cert, cls.pw = root / 'key.pem', root / 'recipient.crt', root / 'passphrase'
        cls.pw.write_text('synthetic-test-only\n')
        cls.pw.chmod(0o600)
        subprocess.run([cls.openssl, 'req', '-new', '-x509', '-newkey', 'rsa:2048',
                        '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
                        '-passout', 'file:' + str(cls.pw), '-subj', '/CN=Synthetic-Backup-Test'],
                       check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.keys.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.backup = self.root / 'backup'
        (self.backup / 'controls').mkdir(parents=True)
        for name in ['database.dump', 'media.tar', 'controls/regular-files.tar']:
            (self.backup / name).write_bytes(b'synthetic-private-data\n' + name.encode())
        stamp = datetime.now(timezone.utc).isoformat()
        (self.backup / 'manifest.json').write_text(json.dumps({
            'createdAt': stamp, 'sourceDatabase': 'hd_synthetic',
            'databaseSha256': backup_tool.digest_file(self.backup / 'database.dump'),
            'mediaTarSha256': backup_tool.digest_file(self.backup / 'media.tar'),
        }))
        (self.backup / 'routine-restore-proof.json').write_text(json.dumps({
            'sourceDatabase': 'hd_synthetic', 'backup': str(self.backup), 'verifiedAt': stamp,
            'restoredTablesAndSequences': [{'name': 'synthetic', 'rows': 1, 'digest': 'fixture'}],
            'allRetainedDataMatched': True, 'sourceUnchangedDuringVerification': True, 'scratchRemoved': True,
        }))
        (self.backup / 'controls/proof.json').write_text(json.dumps({
            'restoreVerified': True,
            'archiveSha256': backup_tool.digest_file(self.backup / 'controls/regular-files.tar'),
        }))
        self.bind_proof()
        self.output = self.root / 'offsite.cms'

    def bind_proof(self):
        f = self.backup / 'routine-restore-proof.json'
        proof = json.loads(f.read_text())
        proof['archiveDigests'] = {
            'manifestSha256': backup_tool.digest_file(self.backup / 'manifest.json'),
            'databaseSha256': backup_tool.digest_file(self.backup / 'database.dump'),
            'mediaTarSha256': backup_tool.digest_file(self.backup / 'media.tar'),
            'controlsArchiveSha256': backup_tool.digest_file(self.backup / 'controls/regular-files.tar'),
        }
        f.write_text(json.dumps(proof))

    def encrypt(self):
        return backup_tool.encrypt(self.backup, self.cert, self.output, self.openssl)

    def verify(self):
        return backup_tool.verify(self.output, self.cert, self.key, self.pw, self.root, backup_tool.digest_file(self.output), self.openssl)

    def test_complete_roundtrip_preserves_files_and_metadata_without_plaintext_leftover(self):
        proof = self.encrypt()
        self.assertNotIn(b'synthetic-private-data', self.output.read_bytes())
        verified = self.verify()
        self.assertEqual(proof['files'], verified['allFilesAndMetadataVerified'])
        self.assertTrue(verified['authenticatedDecryption'])
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertFalse(list(self.root.glob('hd-backup-*')))

    def test_corrupted_authentication_tag_cannot_be_accepted_and_temp_is_removed(self):
        self.encrypt()
        data = bytearray(self.output.read_bytes())
        data[-10] ^= 1
        self.output.write_bytes(data)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()
        self.assertFalse(list(self.root.glob('hd-backup-*')))

    def test_changed_database_cannot_be_encrypted(self):
        (self.backup / 'database.dump').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.encrypt()
        self.assertFalse(self.output.exists())

    def test_missing_actual_restore_proof_cannot_be_encrypted(self):
        (self.backup / 'routine-restore-proof.json').unlink()
        with self.assertRaises(FileNotFoundError):
            self.encrypt()

    def test_unverified_restore_and_mismatched_backup_path_are_rejected(self):
        f = self.backup / 'routine-restore-proof.json'
        proof = json.loads(f.read_text())
        proof['backup'] = str(self.root / 'different-backup')
        f.write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError, 'Restore proof'):
            self.encrypt()

    def test_symlink_or_existing_destination_never_overwrites_other_material(self):
        (self.backup / 'controls/unsafe').symlink_to(self.cert)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.encrypt()
        (self.backup / 'controls/unsafe').unlink()
        self.output.write_bytes(b'existing')
        with self.assertRaises(FileExistsError):
            self.encrypt()
        self.assertEqual(self.output.read_bytes(), b'existing')

    def test_false_restore_flags_and_replaced_manifest_cannot_reuse_old_proof(self):
        f = self.backup / 'routine-restore-proof.json'
        old = json.loads(f.read_text())
        for flag in ['allRetainedDataMatched', 'sourceUnchangedDuringVerification', 'scratchRemoved']:
            f.write_text(json.dumps({**old, flag: False}))
            with self.assertRaisesRegex(ValueError, 'must all have succeeded'):
                self.encrypt()
        f.write_text(json.dumps(old))
        m = self.backup / 'manifest.json'
        m.write_text(m.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'bind this exact'):
            self.encrypt()

    def test_key_permissions_and_colocation_are_rejected(self):
        self.encrypt()
        local = self.root / 'secrets'
        local.mkdir(mode=0o700)
        key, pw = local / 'key', local / 'pass'
        key.write_bytes(self.key.read_bytes())
        pw.write_bytes(self.pw.read_bytes())
        key.chmod(0o644)
        pw.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'mode0600'):
            backup_tool.verify(self.output, self.cert, key, pw, self.root, backup_tool.digest_file(self.output), self.openssl)
        key.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'must be separate'):
            backup_tool.verify(self.output, self.cert, key, pw, self.root, backup_tool.digest_file(self.output), self.openssl)

    def test_disk_budget_counts_tar_overhead_and_decrypt_plaintext(self):
        usage = namedtuple('usage', 'total used free')
        # Logical payload fits, but padded tar/CMS/manifest would exceed70%.
        with patch.object(backup_tool.shutil, 'disk_usage', return_value=usage(10**9, 700000000 - 1024 * 1024 - 1024, 0)):
            with self.assertRaisesRegex(ValueError, 'Encryption staging'):
                self.encrypt()
        self.encrypt()
        with patch.object(backup_tool.shutil, 'disk_usage', return_value=usage(10**9, 700000000, 0)):
            with self.assertRaisesRegex(ValueError, 'Decryption staging'):
                self.verify()

    def test_output_replacement_never_redirects_encryption_or_deletes_replacement(self):
        victim = self.root / 'must-not-overwrite'
        victim.write_bytes(b'keep')
        original_run = subprocess.run

        def replace_output(*args, **kwargs):
            self.output.unlink()
            self.output.symlink_to(victim)
            return original_run(*args, **kwargs)

        with patch.object(backup_tool.subprocess, 'run', side_effect=replace_output):
            with self.assertRaisesRegex(ValueError, 'Output path replaced'):
                self.encrypt()
        self.assertEqual(victim.read_bytes(), b'keep')
        self.assertTrue(self.output.is_symlink())

    def test_archived_stream_hash_rejects_source_swapped_back_before_path_recheck(self):
        path = self.backup / 'database.dump'
        original = path.read_bytes()
        original_read = backup_tool.HashReader.read
        fired = False

        def altered_read(reader, size=-1):
            nonlocal fired
            if not fired and os.fstat(reader.source.fileno()).st_ino == path.stat().st_ino:
                fired = True
                path.write_bytes(b'X' + original[1:])
                data = original_read(reader, size)
                path.write_bytes(original)
                return data
            return original_read(reader, size)

        with patch.object(backup_tool.HashReader, 'read', altered_read):
            with self.assertRaisesRegex(ValueError, 'Archived bytes differ'):
                self.encrypt()
        self.assertTrue(fired)
        self.assertFalse(self.output.exists())

    def test_transferred_ciphertext_requires_original_server_hash(self):
        proof = self.encrypt()
        data = bytearray(self.output.read_bytes())
        data[-10] ^= 1
        self.output.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'does not match source encryption proof'):
            backup_tool.verify(self.output, self.cert, self.key, self.pw, self.root, proof['cipherSha256'], self.openssl)

    def test_future_restore_proof_is_not_accepted(self):
        f = self.backup / 'routine-restore-proof.json'
        proof = json.loads(f.read_text())
        proof['verifiedAt'] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        f.write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError, 'future dated'):
            self.encrypt()

    def test_decryptable_unauthenticated_cbc_is_never_claimed_authenticated(self):
        self.encrypt()
        plain = self.root / 'synthetic.tar'
        subprocess.run([self.openssl, 'cms', '-decrypt', '-binary', '-inform', 'DER',
                        '-in', str(self.output), '-recip', str(self.cert), '-inkey', str(self.key),
                        '-passin', 'file:' + str(self.pw), '-out', str(plain)], check=True, capture_output=True)
        subprocess.run([self.openssl, 'cms', '-encrypt', '-binary', '-aes-256-cbc',
                        '-in', str(plain), '-out', str(self.output), '-outform', 'DER', str(self.cert)],
                       check=True, capture_output=True)
        with self.assertRaisesRegex(ValueError, 'Require authenticated CMS'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
