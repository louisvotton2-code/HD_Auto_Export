"""Verify a first-party recovery point in a disposable PostgreSQL database."""
import argparse
from contextlib import nullcontext
from datetime import datetime, timezone
import fcntl
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tarfile

from first_party_data import SCOPE, fingerprint_sql

HERE = Path(__file__).resolve().parent
COMPONENTS = {'database.dump', 'media.tar.gz', 'first-party.sql', 'controls.tar.gz'}
UUID = r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
SAFETY_SQL = """
SELECT jsonb_build_object(
  'workerDisabled', (SELECT NOT enabled AND receive_cursor IS NULL AND since_at IS NULL
    FROM external_full_sync WHERE id=1),
  'supplierDataEmpty', NOT EXISTS (SELECT FROM external_catalog)
    AND NOT EXISTS (SELECT FROM external_catalog_search)
    AND NOT EXISTS (SELECT FROM external_media)
    AND NOT EXISTS (SELECT FROM external_full_stage)
    AND NOT EXISTS (SELECT FROM external_full_snapshots)
    AND NOT EXISTS (SELECT FROM external_source_blobs)
    AND NOT EXISTS (SELECT FROM backup_gc_leases),
  'media', (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM media_assets
    WHERE state IN ('uploaded','ready')),
  'migrationLedger', (SELECT count(*) FROM drizzle.__drizzle_migrations)
);
"""


def need(condition, message):
    if not condition:
        raise ValueError(message)


def routine():
    spec = spec_from_file_location('routine_backup', HERE/'routine-backup.py')
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def private_file(point, name):
    path = point/name
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
         'Recovery input must be an owner-only regular file')
    return path


def load_point(point, runtime):
    need(point.is_absolute() and point.resolve(strict=True) == point and point.is_dir()
         and point.stat().st_uid == os.getuid() and not point.stat().st_mode & 0o077,
         'Use a private recovery point with no symbolic links')
    manifest_path = private_file(point, 'manifest.json')
    manifest = json.loads(manifest_path.read_bytes())
    need(manifest['format'] == 2 and manifest['backupScope'] == SCOPE
         and set(manifest['files']) == COMPONENTS and manifest['retainedData'],
         'The recovery point has no first-party manifest')
    return manifest, runtime.digest(manifest_path)


def verified_components(point, manifest, runtime, *, allow_removed=False):
    files = []
    for name, expected in manifest['files'].items():
        try:
            path = private_file(point, name)
        except FileNotFoundError:
            if allow_removed:
                continue
            raise
        need(path.stat().st_size == expected['bytes'] and runtime.digest(path) == expected['sha256'],
             'A recovery component failed its checksum')
        files.append(path)
    return files


def verify_media(archive, expected, required):
    originals = set()
    with tarfile.open(archive, 'r:gz') as images:
        members = images.getmembers()
        need(len(members) == len(expected) and {member.name for member in members} == set(expected),
             'Media members differ from the backup manifest')
        for member in members:
            entry = expected[member.name]
            if member.isdir() and entry['type'] == 'directory':
                continue
            need(member.isfile() and entry['type'] == 'file'
                 and member.size == entry['bytes'] and re.fullmatch(UUID + r'\.webp', Path(member.name).name),
                 'Unexpected media type or filename in the recovery point')
            with images.extractfile(member) as source:
                need(hashlib.file_digest(source, 'sha256').hexdigest() == entry['sha256'],
                     'A recovered original failed its checksum')
            originals.add(Path(member.name).stem)
    need(set(required) <= originals, 'A saved media record is missing its original file')
    return len(originals)


def verify_database(point, container, user, manifest):
    need(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', container)
         and re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}', user)
         and not any(os.getenv(name) for name in ('DOCKER_HOST', 'DOCKER_CONTEXT')),
         'Use an explicit local PostgreSQL container and user')
    database = 'hd_first_party_restore_' + secrets.token_hex(8)
    need(database != manifest['sourceDatabase'], 'Refusing to use the source database')
    exec_pg = ['docker', 'exec', '-i', container]
    psql = [*exec_pg, 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', user]
    pg_restore = [*exec_pg, 'pg_restore', '-U', user, '-d', database, '--no-acl',
                  '--no-owner', '--exit-on-error', '--single-transaction']

    def read(sql, target=database):
        return subprocess.run([*psql, '-d', target, '-c', sql], check=True,
                              capture_output=True, timeout=90).stdout

    read(f'CREATE DATABASE {database} TEMPLATE template0', target='postgres')
    try:
        for section in ('pre-data', 'data'):
            with (point/'database.dump').open('rb') as dump:
                subprocess.run([*pg_restore, '--section', section], stdin=dump, check=True,
                               capture_output=True, timeout=360)
        with (point/'first-party.sql').open('rb') as supplement:
            subprocess.run([*psql, '-d', database, '--single-transaction', '-f', '-'],
                           stdin=supplement, check=True, capture_output=True, timeout=180)
        with (point/'database.dump').open('rb') as dump:
            subprocess.run([*pg_restore, '--section', 'post-data'], stdin=dump, check=True,
                           capture_output=True, timeout=360)
        retained = json.loads(read(fingerprint_sql(restored=True)))
        need(retained == manifest['retainedData'], 'Restored data differs from the protected snapshot')
        safety = json.loads(read(SAFETY_SQL))
        need(safety['workerDisabled'] is True and safety['supplierDataEmpty'] is True
             and safety['migrationLedger'] > 0, 'The restored database cannot start safely')
        return retained, safety
    finally:
        read(f'DROP DATABASE {database}', target='postgres')


def check(point, container, user, finalize=False):
    runtime = routine()
    lock_path = point.parent/'routine.lock'
    lock_context = (os.fdopen(os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW), 'rb')
                    if finalize else nullcontext())
    with lock_context as lock:
        if finalize:
            info = os.fstat(lock.fileno())
            need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                 and not info.st_mode & 0o077, 'Unexpected backup lock')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest, manifest_hash = load_point(point, runtime)
        state = None
        captured_proof = None
        if finalize:
            state = json.loads(private_file(point, 'routine.json').read_bytes())
            proof_path = point/'routine-restore-proof.json'
            need(state['complete'] is True and state['phase'] == 'finalized'
                 and state['backupScope'] == SCOPE and state['name'] == point.name
                 and state['createdAt'] == manifest['createdAt']
                 and state['plaintextRetention'] in ('temporary-for-one-time-restore',
                                                     'removed-after-verified-restore'),
                 'Expected the finalized first-party verification backup')
            cipher = private_file(point, 'recovery.cms')
            need(cipher.stat().st_size == state['ciphertextBytes']
                 and runtime.digest(cipher) == state['ciphertextSha256'],
                 'Encrypted recovery point failed its checksum')
            if proof_path.exists() or proof_path.is_symlink():
                saved_proof = private_file(point, proof_path.name)
                review = dict(state, restoreValidation='verified',
                              restoreProofSha256=runtime.digest(saved_proof))
                need(runtime.verified_scoped_restore(point, review, manifest['sourceDatabase']),
                     'The saved restore proof differs from this recovery point')
                if state.get('restoreProofSha256'):
                    need(review['restoreProofSha256'] == state['restoreProofSha256'],
                         'The committed restore proof changed')
                captured_proof = json.loads(saved_proof.read_bytes())
        if captured_proof is None:
            verified_components(point, manifest, runtime)
            retained, safety = verify_database(point, container, user, manifest)
            media_count = verify_media(point/'media.tar.gz', manifest['media'], safety['media'])
            result = {'backupScope':SCOPE, 'input':'plaintext-components', 'allRetainedDataMatched':True,
                      'databaseSha256':manifest['files']['database.dump']['sha256'],
                      'manifestSha256':manifest_hash, 'retainedTables':len(retained),
                      'mediaOriginalsVerified':media_count, 'mediaReferencesVerified':len(safety['media']),
                      'migrationLedger':safety['migrationLedger'], 'supplierWorkerDisabled':True,
                      'supplierRawDataExcluded':True, 'verifiedAt':datetime.now(timezone.utc).isoformat()}
        else:
            result = captured_proof
        if finalize:
            need(runtime.digest(point/'manifest.json') == manifest_hash, 'Backup manifest changed during restore')
            if captured_proof is None:
                runtime.atomic_json(proof_path, result)
            for remaining in verified_components(point, manifest, runtime, allow_removed=True):
                remaining.unlink()
            state.update(restoreValidation='verified', restoreProofSha256=runtime.digest(proof_path),
                         plaintextRetention='removed-after-verified-restore')
            runtime.atomic_json(point/'routine.json', state)
        return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--point', required=True, type=Path)
    parser.add_argument('--container', required=True)
    parser.add_argument('--user', default='postgres')
    parser.add_argument('--finalize', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.point, args.container, args.user, args.finalize), sort_keys=True))
    except ValueError as error:
        if type(error) is ValueError:
            raise SystemExit(str(error)) from None
        raise SystemExit('First-party restore evidence could not be decoded') from None
    except (OSError, KeyError, TypeError, subprocess.SubprocessError):
        raise SystemExit('First-party restore verification did not complete') from None


if __name__ == '__main__':
    main()
