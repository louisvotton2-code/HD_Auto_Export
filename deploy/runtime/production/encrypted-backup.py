"""Encrypt a verified runtime backup; verify its off-host copy without restoring production.

The recipient certificate is public. Keep its encrypted private key and passphrase
off the server, in a different directory from the transferred ciphertext.
Requires OpenSSL 3 CMS AuthEnvelopedData (AES-256-GCM).
"""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile


def digest_file(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def regular(path):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
        raise ValueError('Expected an unlinked regular file: ' + str(path))
    return s


def private_parent(path):
    if not path.is_absolute():
        raise ValueError('Use an absolute path')
    for parent in [path.parent, *path.parent.parents]:
        if parent.is_symlink():
            raise ValueError('Symlink ancestor rejected')
    s = path.parent.stat()
    if s.st_uid != os.getuid() or s.st_mode & 0o077:
        raise ValueError('Output parent must be owned by this user and mode0700')


def open_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    f = os.fdopen(fd, 'rb', buffering=0)
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        f.close()
        raise ValueError('Expected a no-follow regular input')
    return f


def new_output(path):
    private_parent(path)
    return os.fdopen(os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'w+b')


def member_info(name, expected):
    member = tarfile.TarInfo(name)
    member.size, member.mode = expected['size'], expected['mode']
    member.uid, member.gid = expected['uid'], expected['gid']
    return member


class HashReader:
    def __init__(self, source):
        self.source, self.hash = source, hashlib.sha256()

    def read(self, size=-1):
        data = self.source.read(size)
        self.hash.update(data)
        return data


def verified_files(backup):
    if not backup.is_absolute() or backup.is_symlink():
        raise ValueError('Use an absolute, non-symlink backup directory')
    for parent in backup.parents:
        if parent.is_symlink():
            raise ValueError('Symlink ancestor rejected')
    if (backup / 'controls').is_symlink():
        raise ValueError('Symlink control directory rejected')
    for name in ['manifest.json', 'routine-restore-proof.json', 'controls/proof.json']:
        regular(backup / name)
    manifest = json.loads((backup / 'manifest.json').read_text())
    proof = json.loads((backup / 'routine-restore-proof.json').read_text())
    controls = json.loads((backup / 'controls/proof.json').read_text())
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(manifest['createdAt'])).total_seconds()
    if not 0 <= age <= 86400 or not controls.get('restoreVerified'):
        raise ValueError('Require a fresh backup and completed actual control restore proof')
    if proof['sourceDatabase'] != manifest['sourceDatabase'] or not proof.get('restoredTablesAndSequences'):
        raise ValueError('Require matching actual database restore proof')
    if not all(proof.get(flag) is True for flag in ['allRetainedDataMatched', 'sourceUnchangedDuringVerification', 'scratchRemoved']):
        raise ValueError('Actual restore and source preservation must all have succeeded')
    if datetime.fromisoformat(proof['verifiedAt']) > datetime.now(timezone.utc):
        raise ValueError('Restore proof cannot be future dated')
    if proof['backup'] != str(backup) or not 0 <= (datetime.fromisoformat(proof['verifiedAt']) - datetime.fromisoformat(manifest['createdAt'])).total_seconds() <= 86400:
        raise ValueError('Restore proof does not belong to this fresh backup')
    for name, key in [('database.dump', 'databaseSha256'), ('media.tar', 'mediaTarSha256')]:
        regular(backup / name)
        if digest_file(backup / name) != manifest[key]:
            raise ValueError('Backup checksum mismatch')
    if digest_file(backup / 'controls/regular-files.tar') != controls['archiveSha256']:
        raise ValueError('Control archive checksum mismatch')
    bound = {'manifestSha256': digest_file(backup / 'manifest.json'),
             'databaseSha256': manifest['databaseSha256'], 'mediaTarSha256': manifest['mediaTarSha256'],
             'controlsArchiveSha256': controls['archiveSha256']}
    if proof.get('archiveDigests') != bound:
        raise ValueError('Restore proof must bind this exact manifest and all original archives')
    # Derived restore directories are redundant; the original archives and proofs
    # remain included. Never traverse or archive their recreated control symlinks.
    paths = [backup / n for n in ['manifest.json', 'database.dump', 'media.tar', 'routine-restore-proof.json']]
    for path in (backup / 'controls').rglob('*'):
        if 'restore-check' in path.relative_to(backup / 'controls').parts:
            continue
        if path.is_symlink():
            raise ValueError('Control backup contains a symlink outside restore-check')
        if path.is_dir():
            continue
        paths.append(path)
    files = {}
    for path in sorted(paths):
        s = regular(path)
        files[str(path.relative_to(backup))] = {
            'sha256': digest_file(path), 'size': s.st_size,
            'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid,
        }
    return manifest, files


def tar_size_bound(backup, files):
    """Include actual PAX headers,512-byte data padding and final tar blocking."""
    total = 0
    for name, item in files.items():
        member = member_info(name, item)
        total += len(member.tobuf(tarfile.PAX_FORMAT)) + (item['size'] + 511) // 512 * 512
    data = json.dumps({'format': 1, 'files': files}, sort_keys=True).encode()
    total += 512 + (len(data) + 511) // 512 * 512 + 1024
    return (total + tarfile.RECORDSIZE - 1) // tarfile.RECORDSIZE * tarfile.RECORDSIZE


def require_authenticated_cms(source, openssl):
    """Read only the bounded structural prefix printed by OpenSSL's CMS parser."""
    source.seek(0)
    child = subprocess.Popen([openssl, 'cms', '-cmsout', '-print', '-noout', '-inform', 'DER'],
                             stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    correct_type = False
    encryption_algorithm = False
    try:
        total = 0
        while total < 65536:
            line = child.stdout.readline(1024)
            total += len(line)
            if not line:
                break
            text = line.decode('ascii', errors='replace').strip()
            if text.startswith('contentType:') and not correct_type:
                if text != 'contentType: id-smime-ct-authEnvelopedData (1.2.840.113549.1.9.16.1.23)':
                    raise ValueError('Require authenticated CMS AuthEnvelopedData')
                correct_type = True
            if encryption_algorithm:
                if not correct_type or text != 'algorithm: aes-256-gcm (2.16.840.1.101.3.4.1.46)':
                    raise ValueError('Require AES-256-GCM content encryption')
                return
            if text == 'contentEncryptionAlgorithm:':
                encryption_algorithm = True
        raise ValueError('CMS structural prefix missing or oversized')
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=10)
        source.seek(0)


def encrypt(backup, certificate, output, openssl='openssl'):
    os.umask(0o077)
    regular(certificate)
    manifest, files = verified_files(backup)
    private_parent(output)
    usage = shutil.disk_usage(output.parent)
    # Original backup is already in used. Allow tar plus streaming CMS overhead,
    # including small files/PAX/padding/manifest rather than logical payload only.
    estimated = tar_size_bound(backup, files)
    if usage.used + estimated * 3 + 1024 * 1024 > usage.total * .70:
        raise ValueError('Encryption staging would exceed the70% disk budget')
    output_file = new_output(output)
    output_identity = os.fstat(output_file.fileno())
    try:
        with ExitStack() as stack:
            certificate_file = stack.enter_context(open_regular(certificate))
            certificate_hash = hashlib.file_digest(certificate_file, 'sha256').hexdigest()
            certificate_file.seek(0)
            plain = stack.enter_context(tempfile.TemporaryFile(mode='w+b', buffering=0, dir=output.parent))
            with tarfile.open(fileobj=plain, mode='w') as archive:
                for name, expected in files.items():
                    path = backup / name
                    with open_regular(path) as source:
                        st = os.fstat(source.fileno())
                        if (st.st_size, stat.S_IMODE(st.st_mode), st.st_uid, st.st_gid) != (expected['size'], expected['mode'], expected['uid'], expected['gid']):
                            raise ValueError('Source metadata changed before archive')
                        consumed = HashReader(source)
                        archive.addfile(member_info(name, expected), consumed)
                        if consumed.hash.hexdigest() != expected['sha256']:
                            raise ValueError('Archived bytes differ from verified source')
                        current = path.lstat()
                        if (current.st_dev, current.st_ino) != (st.st_dev, st.st_ino):
                            raise ValueError('Source path replaced during archive')
                data = json.dumps({'format': 1, 'files': files}, sort_keys=True).encode()
                member = tarfile.TarInfo('offsite-manifest.json')
                member.size = len(data)
                member.mode = 0o600
                archive.addfile(member, io.BytesIO(data))
            plain.flush()
            if plain.tell() > estimated:
                raise ValueError('Archive exceeds staging estimate')
            plain.seek(0)
            subprocess.run([openssl, 'cms', '-encrypt', '-stream', '-binary', '-aes-256-gcm',
                            '-outform', 'DER', '/dev/fd/' + str(certificate_file.fileno())],
                           stdin=plain, stdout=output_file, stderr=subprocess.PIPE,
                           pass_fds=(certificate_file.fileno(),), check=True)
        output_file.flush()
        os.fsync(output_file.fileno())
        output_file.seek(0)
        ciphertext_hash = hashlib.file_digest(output_file, 'sha256').hexdigest()
        current = output.lstat()
        if (current.st_dev, current.st_ino) != (output_identity.st_dev, output_identity.st_ino):
            raise ValueError('Output path replaced; encrypted descriptor was not redirected')
        return {'algorithm': 'CMS AES-256-GCM/RSA recipient', 'cipherSha256': ciphertext_hash,
                'cipherBytes': os.fstat(output_file.fileno()).st_size, 'files': len(files),
                'sourceDatabase': manifest['sourceDatabase'], 'backupCreatedAt': manifest['createdAt'],
                'recipientCertificateSha256': certificate_hash, 'privateKeyOnServer': False}
    except BaseException:
        try:
            current = output.lstat()
            if (current.st_dev, current.st_ino) == (output_identity.st_dev, output_identity.st_ino):
                output.unlink()
        except FileNotFoundError:
            pass
        raise
    finally:
        output_file.close()


def verify(ciphertext, certificate, key, passphrase, temporary_root, expected_sha256, openssl='openssl'):
    os.umask(0o077)
    for path in [ciphertext, certificate, key, passphrase]:
        regular(path)
    private_parent(temporary_root / 'probe')
    for secret in [key, passphrase]:
        private_parent(secret)
        if secret.stat().st_uid != os.getuid() or stat.S_IMODE(secret.stat().st_mode) != 0o600:
            raise ValueError('Decryption key and passphrase must be owner-only mode0600')
        for data_root in [ciphertext.parent, temporary_root]:
            secret_root = secret.parent.resolve()
            data_root = data_root.resolve()
            if secret_root.is_relative_to(data_root) or data_root.is_relative_to(secret_root):
                raise ValueError('Decryption materials must be separate from ciphertext and temporary plaintext')
    if b'-----BEGIN ENCRYPTED PRIVATE KEY-----' not in key.read_bytes()[:128]:
        raise ValueError('Require an encrypted private key')
    usage = shutil.disk_usage(temporary_root)
    if usage.used + ciphertext.stat().st_size * 3 + 1024 * 1024 > usage.total * .70:
        raise ValueError('Decryption staging would exceed the70% disk budget')
    if len(expected_sha256) != 64 or any(c not in '0123456789abcdef' for c in expected_sha256):
        raise ValueError('Require the source encryption proof SHA256')
    with ExitStack() as stack:
        # Bind the consumed ciphertext, even if its external pathname changes.
        frozen = stack.enter_context(tempfile.TemporaryFile(mode='w+b', buffering=0, dir=temporary_root))
        with open_regular(ciphertext) as source:
            consumed = hashlib.sha256()
            remaining = os.fstat(source.fileno()).st_size
            while remaining:
                data = source.read(min(1024 * 1024, remaining))
                if not data:
                    raise ValueError('Ciphertext truncated during transfer verification')
                frozen.write(data)
                consumed.update(data)
                remaining -= len(data)
            if source.read(1):
                raise ValueError('Ciphertext grew during transfer verification')
        if consumed.hexdigest() != expected_sha256:
            raise ValueError('Transferred ciphertext does not match source encryption proof')
        frozen.flush()
        frozen.seek(0)
        require_authenticated_cms(frozen, openssl)
        certificate_file = stack.enter_context(open_regular(certificate))
        key_file = stack.enter_context(open_regular(key))
        pass_file = stack.enter_context(open_regular(passphrase))
        for secret_file in [key_file, pass_file]:
            st = os.fstat(secret_file.fileno())
            if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o600:
                raise ValueError('Opened decryption material must be mode0600')
        if b'-----BEGIN ENCRYPTED PRIVATE KEY-----' not in key_file.read(128):
            raise ValueError('Opened private key must be encrypted')
        key_file.seek(0)
        plain = stack.enter_context(tempfile.TemporaryFile(mode='w+b', buffering=0, dir=temporary_root))
        subprocess.run([openssl, 'cms', '-decrypt', '-binary', '-inform', 'DER',
                        '-recip', '/dev/fd/' + str(certificate_file.fileno()),
                        '-inkey', '/dev/fd/' + str(key_file.fileno()),
                        '-passin', 'fd:' + str(pass_file.fileno())],
                       stdin=frozen, stdout=plain, stderr=subprocess.PIPE,
                       pass_fds=(certificate_file.fileno(), key_file.fileno(), pass_file.fileno()), check=True)
        plain.flush()
        plain.seek(0)
        with tarfile.open(fileobj=plain) as archive:
            members = archive.getmembers()
            if len(members) > 100000 or len({m.name for m in members}) != len(members):
                raise ValueError('Invalid archive member count')
            for m in members:
                if not m.isfile() or m.name.startswith('/') or '..' in Path(m.name).parts:
                    raise ValueError('Unsafe archive member')
            member = archive.getmember('offsite-manifest.json')
            if member.size > 16 * 1024 * 1024:
                raise ValueError('Oversized manifest')
            manifest = json.load(archive.extractfile(member))
            expected = manifest['files']
            if manifest['format'] != 1 or set(expected) != {m.name for m in members} - {'offsite-manifest.json'}:
                raise ValueError('Incomplete archive')
            for name, item in expected.items():
                m = archive.getmember(name)
                if (m.size, m.mode, m.uid, m.gid) != (item['size'], item['mode'], item['uid'], item['gid']):
                    raise ValueError('Archive metadata mismatch')
                with archive.extractfile(m) as source:
                    if hashlib.file_digest(source, 'sha256').hexdigest() != item['sha256']:
                        raise ValueError('Archive data mismatch')
    return {'authenticatedDecryption': True, 'allFilesAndMetadataVerified': len(expected),
            'cipherSha256': consumed.hexdigest(), 'plaintextTemporaryRemoved': True,
            'restoredToProduction': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    enc = sub.add_parser('encrypt')
    for name in ['backup', 'certificate', 'output']:
        enc.add_argument('--' + name, type=Path, required=True)
    dec = sub.add_parser('verify')
    for name in ['ciphertext', 'certificate', 'key', 'passphrase', 'temporary-root']:
        dec.add_argument('--' + name, type=Path, required=True)
    dec.add_argument('--expected-sha256', required=True)
    parser.add_argument('--openssl', default='openssl')
    args = vars(parser.parse_args())
    action = args.pop('action')
    print(json.dumps(encrypt(**args) if action == 'encrypt' else verify(**args), indent=2))
