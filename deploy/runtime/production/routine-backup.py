"""EXT09 online daily compressed recovery points; only configured backup points are pruned.

The root-owned private configuration supplies the existing compose/runtime argument
arrays and public encryption certificate. No password values belong in this file.
Off-host transfer is explicitly pending until separately verified by OPS.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import stat
import subprocess
import tarfile
import time

from backup_space import (OVERHEAD, check_disk_budget, projected_dump_bytes, recovery_point_bytes, recovery_samples)

ROOT = Path('/srv/hd-auto')


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def atomic_json(path, value):
    temp = path.with_suffix(path.suffix+'.tmp')
    with temp.open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())
    temp.chmod(0o600)
    temp.rename(path)
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def selected_old_points(points, keep=2):
    """Only completed routine points compete for retention; release points never do."""
    completed = sorted((p for p in points if p.get('kind') == 'daily' and p.get('complete') is True),
                       key=lambda p: p['createdAt'], reverse=True)
    return completed[keep:]


def verify_completed_points(root, points):
    for point in points:
        if point.get('complete') is not True:
            continue
        cipher = root/point['name']/'recovery.cms'
        if cipher.is_symlink() or not cipher.is_file() or digest(cipher) != point.get('ciphertextSha256'):
            raise ValueError('Completed recovery point failed checksum; retain all points')


def retire_completed_points(root, points, psql):
    verify_completed_points(root, points)
    retired = selected_old_points(points)
    for point in retired:
        reference = point['reference']
        sql = """BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT EXISTS (
    SELECT 1 FROM backup_gc_leases WHERE reference=:'backup_reference'
    UNION ALL SELECT 1 FROM external_full_archive_pins WHERE reference=:'backup_reference'
    UNION ALL SELECT 1 FROM external_source_blob_refs WHERE kind='backup' AND reference=:'backup_reference'
    UNION ALL SELECT 1 FROM external_source_document_refs WHERE kind='backup' AND reference=:'backup_reference'
);
COMMIT;"""
        if recovery_point_sql(psql, reference, sql) != 'f':
            raise ValueError('An older recovery point still has protection; retain all points')
    for point in retired:
        path = root/point['name']
        if digest(path/'recovery.cms') != point['ciphertextSha256']:
            raise ValueError('Retained recovery point checksum changed; refuse deletion')
        shutil.rmtree(path)


def remove_verified_components(point, manifest):
    """Remove only known, checksum-matching temporary components, never proofs."""
    allowed = {'database.dump', 'media.tar.gz', 'source-archives.tar.gz', 'controls.tar.gz'}
    if manifest.get('format') != 2 or set(manifest.get('files', {})) != allowed:
        raise ValueError('Invalid cleanup manifest')
    # Validate all first: a failure preserves every remaining component.
    for name, expected in manifest['files'].items():
        path = point/name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != expected['bytes'] or digest(path) != expected['sha256']:
            raise ValueError('Temporary component changed; refuse cleanup')
    for name in allowed:
        (point/name).unlink()


def unpack_verified_bundle(bundle, destination):
    """After authenticated CMS decryption, extract only the format-2 envelope.

    Does not restore DB or unpack root-addressed nested archives. Those require
    an isolated restore target; never extract these directly over production.
    """
    names = {'database.dump', 'media.tar.gz', 'source-archives.tar.gz', 'controls.tar.gz', 'manifest.json'}
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    with tarfile.open(bundle, 'r:*') as archive:
        members = archive.getmembers()
        if len(members) != len(names) or {m.name for m in members} != names or any(not m.isfile() for m in members):
            raise ValueError('Invalid recovery envelope')
        for member in members:
            with archive.extractfile(member) as src, (destination/member.name).open('xb') as dst:
                shutil.copyfileobj(src, dst)
    manifest = json.loads((destination/'manifest.json').read_text())
    if manifest.get('format') != 2 or set(manifest.get('files', {})) != names-{'manifest.json'}:
        raise ValueError('Unsupported recovery manifest')
    for name, expected in manifest['files'].items():
        path = destination/name
        if path.stat().st_size != expected['bytes'] or digest(path) != expected['sha256']:
            raise ValueError('Recovered component checksum mismatch')
    return manifest


def require_no_incomplete_points(root):
    """Lock must be held. Never pile a new dump on an unresolved failed job.

    Do not infer that a timed-out docker exec's server-side dump has stopped.
    Operator recovery must verify processes/FDs, clean only owned components,
    then release that exact pin/lease and archive the failed job evidence.
    """
    completed_count = 0
    for point in root.iterdir():
        if not re.fullmatch(r'daily-[0-9TZ.]+(?:\.partial)?', point.name):
            continue
        if point.is_symlink() or not point.is_dir():
            raise ValueError('Unresolved daily backup path; no new backup created')
        proof = point/'routine.json'
        if proof.is_symlink() or not proof.is_file():
            raise ValueError('Incomplete daily backup requires explicit recovery')
        try:
            state = json.loads(proof.read_text())
        except (ValueError, OSError) as error:
            raise ValueError('Unreadable daily proof; no new backup created') from error
        if state.get('name') != point.name or state.get('kind') != 'daily' or state.get('complete') is not True:
            raise ValueError('Incomplete daily backup requires explicit recovery')
        if state.get('format') == 2 and state.get('phase') != 'finalized':
            raise ValueError('Backup cleanup/protection finalization requires explicit recovery')
        if state.get('plaintextRetention') == 'temporary-for-one-time-restore':
            # An intentionally retained verification copy must be resolved too.
            raise ValueError('One-time restore components still require explicit cleanup')
        completed_count += 1
    if completed_count > 2:
        raise ValueError('Previous retention incomplete; resolve before creating another point')


def archive_selection(paths, root):
    if not isinstance(paths, list):
        raise ValueError('Invalid archive SQL result')
    pattern = r'/private/full-sync/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv(?:\.gz)?'
    selected = set()
    for item in paths:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str) or not re.fullmatch(pattern, item['path']):
            raise ValueError('Unexpected worker archive path')
        path = root/Path(item['path']).name
        if not path.exists() and item.get('state') in ('downloading', 'failed'):
            continue
        if not path.exists():
            raise ValueError('Referenced archive missing')
        selected.add(path)
    return selected


def recovery_point_sql(psql, reference, sql):
    if not re.fullmatch(r'backup:ext07:daily-[0-9TZ.]+', reference):
        raise ValueError('Invalid routine backup reference')
    return subprocess.check_output(
        [*psql, '-v', 'ON_ERROR_STOP=1', '-v', 'backup_reference='+reference, '-f', '-'],
        input=sql, text=True, timeout=20,
    ).strip()


def snapshot_backup_pins(psql, reference, acquire):
    """Pin retained CSVs while the persistent global GC lease protects all source rows."""
    change = (
        """INSERT INTO external_full_archive_pins(snapshot_id,reference)
        SELECT s.id,lease.reference FROM external_full_snapshots s CROSS JOIN lease
        WHERE s.archive_pruned_at IS NULL
        ON CONFLICT DO NOTHING RETURNING 1"""
        if acquire else
        """DELETE FROM external_full_archive_pins p USING lease
        WHERE p.reference=lease.reference RETURNING 1"""
    )
    # Same lock order as snapshot pruning. The shared lock keeps an operator's
    # lease release from racing this checked pin change.
    sql = f"""BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='10s';
SELECT pg_advisory_xact_lock_shared(78291335);
SELECT pg_advisory_xact_lock(78291334);
WITH lease AS MATERIALIZED (
  SELECT reference FROM backup_gc_leases WHERE reference=:'backup_reference'
), changed AS (
  {change}
)
SELECT (SELECT count(*) FROM lease), (SELECT count(*) FROM changed);
COMMIT;"""
    matches = re.fullmatch(r'1\|([0-9]+)', recovery_point_sql(psql, reference, sql))
    if not matches:
        raise ValueError('Exact persistent backup lease is required for snapshot pins')
    return int(matches[1])


def regular_files(roots, profile='controls', selected=None):
    if profile not in ('controls', 'media', 'archive'):
        raise ValueError('Unknown archive profile')
    uuid = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

    if profile == 'archive' and selected is None:
        raise ValueError('Archive SQL selection required')
    selected = set(selected or [])
    files = {}
    for root in roots:
        root = Path(root)
        if not root.is_absolute() or not root.exists() or root.is_symlink():
            raise ValueError('Configured archive root is missing or is a symlink')
        for path in ([root, *root.rglob('*')] if root.is_dir() else [root]):
            if path != root and profile != 'controls':
                # Only known in-flight names and regenerable image derivatives are
                # omitted. Unknown files/directories fail closed.
                if profile == 'media':
                    if re.fullmatch(rf'\.{uuid}\.{uuid}(?:\.(?:thumb|card))?\.tmp|{uuid}\.(?:thumb|card)\.webp', path.name):
                        continue
                    valid = re.fullmatch(rf'{uuid}\.webp', path.name)
                else:
                    if re.fullmatch(rf'{uuid}\.csv\.partial', path.name):
                        continue
                    valid = re.fullmatch(rf'{uuid}\.csv(?:\.gz)?', path.name)
                    if valid and path.parent == root and path not in selected:
                        continue
                if path.parent != root or not valid:
                    raise ValueError('Unexpected immutable archive input')
            st = path.lstat()
            if profile != 'controls' and path != root and not stat.S_ISREG(st.st_mode):
                raise ValueError('Immutable source must be a regular file')
            if profile == 'media' and path != root:
                # Upload publishes an immutable original via link then unlinks
                # its private temporary name. Wait only for this bounded window.
                for attempt in range(10):
                    if st.st_nlink != 2: break
                    time.sleep(0.05)
                    st = path.lstat()

            name = str(path).lstrip('/')
            common = dict(mode=stat.S_IMODE(st.st_mode), uid=st.st_uid, gid=st.st_gid)
            if stat.S_ISDIR(st.st_mode):
                files[name] = dict(type='directory', **common)
            elif stat.S_ISLNK(st.st_mode):
                target = os.readlink(path)
                if os.path.isabs(target) or not path.resolve().is_relative_to(root.resolve()):
                    raise ValueError('Archive symlink escapes its configured root')
                files[name] = dict(type='symlink', target=target, **common)
            elif stat.S_ISREG(st.st_mode) and st.st_nlink == 1:
                files[name] = dict(type='file', sha256=digest(path), bytes=st.st_size, **common)
            else:
                raise ValueError('Archive input contains a hard link or special file')
    if profile == 'archive' and not selected.issubset({Path('/'+name) for name in files}):
        raise ValueError('Selected archive is missing')
    return files


class BudgetWriter:
    def __init__(self, stream, filesystem):
        self.stream = stream
        self.filesystem = filesystem

    def write(self, block):
        if self.filesystem is not None:
            check_disk_budget(self.filesystem, len(block))
        return self.stream.write(block)

    def __getattr__(self, name):
        return getattr(self.stream, name)


def copy_dump(argv, output, log, filesystem, timeout=5400):
    deadline = time.monotonic()+timeout
    with subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=log) as process:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                writer = BudgetWriter(output, filesystem)
                while True:
                    remaining = deadline-time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(argv, timeout)
                    if not selector.select(min(remaining, 1)):
                        check_disk_budget(filesystem)
                        continue
                    block = os.read(process.stdout.fileno(), 1024**2)
                    if not block:
                        break
                    writer.write(block)
            if process.wait(timeout=max(0,deadline-time.monotonic())):
                raise subprocess.CalledProcessError(process.returncode, argv)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def pack_roots(output, roots, profile='controls', selected=None, filesystem=None):
    files = regular_files(roots, profile, selected)
    with output.open('xb') as stream:
        with tarfile.open(fileobj=BudgetWriter(stream, filesystem), mode='w:gz', compresslevel=6) as archive:
            for name in sorted(files):
                archive.add('/'+name, arcname=name, recursive=False)
    # Verify the produced compressed archive, without extracting secrets.
    with tarfile.open(output, 'r:gz') as archive:
        seen = set()
        for member in archive:
            if member.name not in files or member.name in seen:
                raise ValueError('Produced archive has unexpected members')
            expected = files[member.name]
            if (member.mode, member.uid, member.gid) != (expected['mode'], expected['uid'], expected['gid']):
                raise ValueError('Compressed archive metadata mismatch')
            if expected['type'] == 'file':
                if not member.isfile() or member.size != expected['bytes']:
                    raise ValueError('Compressed archive file type/size mismatch')
                with archive.extractfile(member) as source:
                    actual = hashlib.file_digest(source, 'sha256').hexdigest()
                if actual != expected['sha256']:
                    raise ValueError('Compressed archive verification failed')
            elif expected['type'] == 'symlink':
                if not member.issym() or member.linkname != expected['target']:
                    raise ValueError('Compressed archive symlink mismatch')
            elif not member.isdir():
                raise ValueError('Compressed archive directory mismatch')
            seen.add(member.name)
        if seen != set(files):
            raise ValueError('Produced archive is incomplete')
    return files


def reserve_bytes(database, files, samples=()):
    dump = projected_dump_bytes(database, database, samples)
    # Existing retention is already in the live filesystem measurement.
    return 2 * recovery_point_bytes(dump, files)


def control_root(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Control root must be canonical and absolute')
    directories = [ROOT/'secrets', ROOT/'data/current/secrets', ROOT/'data/current/tls', ROOT/'data/current/acme', Path('/etc/hd-auto'), Path('/etc/letsencrypt')]
    exact = [
        Path('/etc/fstab'),
        Path('/etc/systemd/system/docker.service.d/hd-auto-storage.conf'),
        Path('/etc/systemd/system/hd-auto-ext07-backup.service.d/20-card-media.conf'),
        Path('/usr/local/sbin/hd-auto-storage-check'),
    ]
    if path in exact or any(path == root or root in path.parents for root in directories):
        return path
    if path.is_file() and (ROOT/'staging' in path.parents or ROOT/'releases' in path.parents and '/deploy/runtime/' in str(path)):
        return path
    raise ValueError('Control root is outside the explicit runtime configuration scope')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--kind', choices=['daily'], default='daily')
    parser.add_argument('--retain-for-restore', action='store_true',
                        help='Keep this point components for one explicit isolated restore; never the routine default')
    args = parser.parse_args()
    config_stat = args.config.lstat()
    if os.getuid() != 0 or not stat.S_ISREG(config_stat.st_mode) or config_stat.st_uid != 0 or stat.S_IMODE(config_stat.st_mode) & 0o077:
        raise ValueError('Use a root-owned private regular configuration')
    config = json.loads(args.config.read_text())
    if not re.fullmatch(r'hd_release_[a-f0-9]{16}', config['database']):
        raise ValueError('Explicit current production database required')
    if not re.fullmatch(r'[a-f0-9]{40}', config.get('releaseId', '')):
        raise ValueError('Reviewed active release binding required')
    backup_root = Path(config['backupRoot'])
    if backup_root != ROOT/'backups/ext07' or backup_root.is_symlink():
        raise ValueError('Use the dedicated EXT07 backup root')
    archive_root = Path(config['archiveRoot'])
    if archive_root != ROOT/'data/full-sync' or archive_root.is_symlink():
        raise ValueError('Use the dedicated full-sync archive root')
    for path in [ROOT/'data', ROOT/'backups', ROOT/'staging']:
        actual = subprocess.check_output(['findmnt', '--mountpoint', str(path), '-n', '-o', 'UUID'], text=True).strip()
        if actual != config['filesystemUuid']:
            raise ValueError('Persistent filesystem identity mismatch')
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'):
        raise ValueError('Remote Docker overrides refused')
    controls = [control_root(p) for p in config['controlRoots']]
    compose = config['compose']
    runtime = config['runtime']
    if not isinstance(compose, list) or compose[:2] != ['docker', 'compose'] or not isinstance(runtime, list) or runtime[0] != 'python3':
        raise ValueError('Use the actual configured compose and runtime argument arrays')
    backup_root.mkdir(mode=0o700, exist_ok=True)
    lock = (backup_root/'routine.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    require_no_incomplete_points(backup_root)
    point_name = args.kind+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    point = backup_root/point_name
    if point.exists() or point.with_suffix('.partial').exists():
        raise ValueError('Recovery point already exists')
    reference = 'backup:ext07:'+point_name
    log_path = backup_root/(point_name+'.log')
    state = dict(kind=args.kind, name=point_name, reference=reference, createdAt=datetime.now(timezone.utc).isoformat(), complete=False, offsite='pending')
    with log_path.open('x') as log:
        def call(argv):
            subprocess.run(argv, check=True, stdout=log, stderr=subprocess.STDOUT)
        psql = compose+['exec', '-T', 'postgres', 'psql', '-X', '-U', 'postgres',
                        '-d', config['database'], '-Atq']
        running = subprocess.check_output(compose+['ps', '--status', 'running', '--services'], text=True).split()
        if 'worker' in running or 'migrate' in running:
            raise ValueError('Stop other maintenance/ingestion writers first')
        # Fail before pausing any service if a full recovery point could exceed
        # budget. Existing points are never deleted to make this preflight pass.
        database_bytes = int(subprocess.check_output(psql+['-c', 'SELECT pg_database_size(current_database())'], text=True))
        media_roots = config['mediaRoots']
        if not isinstance(media_roots, list) or not media_roots:
            raise ValueError('Explicit existing media paths required')
        measured_roots = [archive_root, *controls]
        for media in media_roots:
            path = Path(media)
            if not path.is_absolute() or '..' in path.parts or ROOT/'data' not in path.parents or path.is_symlink() or not path.is_dir():
                raise ValueError('Media must use an existing stable data directory')
            measured_roots.append(path)
        file_bytes = sum(int(subprocess.check_output(['du', '-s', '-B1', '--', str(path)], text=True).split()[0]) for path in measured_roots)
        samples=recovery_samples(backup_root,config['database'])
        reserve=reserve_bytes(database_bytes,file_bytes,samples)
        total, used=check_disk_budget(backup_root,reserve)
        state['preflight'] = dict(databaseBytes=database_bytes, fileBytes=file_bytes, reserveBytes=reserve, diskUsedBytes=used, diskTotalBytes=total)
        # The BE lease serializes acquisition with ALL physical media purges.
        # Persisted until explicit release: a killed backup remains protective.
        lease = config.get('mediaLeaseCommand')
        if not isinstance(lease, list) or not lease or not all(isinstance(x, str) for x in lease):
            raise ValueError('Reviewed media deletion lease command required')
        point.mkdir(mode=0o700)
        state.update(phase='acquiring-protection', ownerPid=os.getpid())
        atomic_json(point/'routine.json', state)
        call(lease+['acquire', '--reference', reference])
        pins = snapshot_backup_pins(psql, reference, acquire=True)
        state['archiveProtection'] = dict(mode='persistent-global-lease', snapshotPins=pins)
        state['phase'] = 'dump-and-pack'
        atomic_json(point/'routine.json', state)
        # pg_dump owns one MVCC snapshot; no web/API/worker stop or live-table
        # comparison. The archive manifest belongs to this dump, not later SQL.
        with (point/'database.dump').open('xb') as dump:
            copy_dump(compose+['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres',
                '-d', config['database'], '-Fc', '-Z', '6', '--no-owner', '--no-acl',
                '--lock-wait-timeout=5000'],dump,log,backup_root)
        with (point/'database.dump').open('rb') as dump:
            subprocess.run(compose+['exec', '-T', 'postgres', 'pg_restore', '--list'],
                check=True, stdin=dump, stdout=log, stderr=log, timeout=120)
        media = pack_roots(point/'media.tar.gz', media_roots, 'media', filesystem=backup_root)
        paths = json.loads(subprocess.check_output(psql+['-v', 'ON_ERROR_STOP=1', '-c',
            "SELECT coalesce(json_agg(json_build_object('path',path,'state',state)),'[]'::json) FROM external_full_snapshots WHERE archive_pruned_at IS NULL"], text=True, timeout=30))
        selected = archive_selection(paths, archive_root)
        archives = pack_roots(point/'source-archives.tar.gz', [archive_root], 'archive', selected, filesystem=backup_root)
        controls_manifest = pack_roots(point/'controls.tar.gz', controls, filesystem=backup_root)
        manifest = dict(format=2, sourceDatabase=config['database'], release=config['releaseId'], snapshot='pg_dump-mvcc',
            createdAt=state['createdAt'], media=media, archives=archives, controls=controls_manifest,
            files={name: dict(sha256=digest(point/name), bytes=(point/name).stat().st_size)
                   for name in ['database.dump', 'media.tar.gz', 'source-archives.tar.gz', 'controls.tar.gz']})
        atomic_json(point/'manifest.json', manifest)
        # Stream the outer tar directly into encryption: do not write another
        # full plaintext container. Inputs remain until ciphertext is complete.
        state['phase'] = 'encrypting'
        atomic_json(point/'routine.json', state)
        cipher = point/'recovery.cms'
        total, used = check_disk_budget(backup_root, OVERHEAD)
        cipher_limit = (7*total-10*(used+OVERHEAD)-1)//10

        def constrain_cipher():
            resource.setrlimit(resource.RLIMIT_FSIZE, (cipher_limit, cipher_limit))

        encryption = subprocess.Popen(['openssl', 'cms', '-encrypt', '-binary', '-outform', 'DER',
            '-aes-256-gcm', '-stream', '-out', str(cipher), str(config['certificate'])], stdin=subprocess.PIPE,
            stdout=log, stderr=log, preexec_fn=constrain_cipher)
        try:
            with tarfile.open(fileobj=BudgetWriter(encryption.stdin,backup_root), mode='w|') as tar:
                for name in [*manifest['files'], 'manifest.json']:
                    tar.add(point/name, arcname=name, recursive=False)
            encryption.stdin.close()
            if encryption.wait(timeout=300) != 0:
                raise ValueError('Encryption failed')
        finally:
            if encryption.stdin and not encryption.stdin.closed:
                encryption.stdin.close()
            if encryption.poll() is None:
                encryption.terminate()
                try: encryption.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    encryption.kill(); encryption.wait(timeout=10)
        if cipher.stat().st_size <= 0:
            raise ValueError('Empty encrypted point')
        with cipher.open('rb') as persisted:
            os.fsync(persisted.fileno())
        state.update(complete=True, phase='encrypted', archiveValidation='checksums-and-dump-directory',
            restoreValidation='not-run', offsite='pending', format=2,
            plaintextRetention='temporary-for-one-time-restore' if args.retain_for_restore else 'remove-after-encryption',
            ciphertextSha256=digest(cipher), ciphertextBytes=cipher.stat().st_size,
            completedAt=datetime.now(timezone.utc).isoformat())
        atomic_json(point/'routine.json', state)
        # Successful ciphertext + independently checked source archive is a
        # creation proof, NOT a decrypt/restore proof. Keep known baseline.
        if not args.retain_for_restore:
            remove_verified_components(point, manifest)
        # Failed or interrupted jobs retain protection for explicit recovery.
        # The encrypted point now owns the archived data. Release only this job's pins and lease.
        snapshot_backup_pins(psql, reference, acquire=False)
        call(lease+['release', '--reference', reference])
        state['phase'] = 'finalized'
        atomic_json(point/'routine.json', state)
        # Retention is narrow: failed/incomplete/unknown and release points stay.
        points = []
        for child in backup_root.iterdir():
            if child.is_dir() and not child.is_symlink() and re.fullmatch(r'daily-[0-9TZ.]+', child.name):
                proof = child/'routine.json'
                if proof.is_file() and not proof.is_symlink():
                    item = json.loads(proof.read_text())
                    if item.get('name') == child.name and item.get('reference') == 'backup:ext07:'+child.name:
                        points.append(item)
        # Verify every survivor before considering an old point for deletion. A
        # complete flag alone must never retire the last usable recovery point.
        retire_completed_points(backup_root, points, psql)
    print(json.dumps({k: state[k] for k in ['name', 'complete', 'offsite', 'ciphertextBytes', 'ciphertextSha256']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'complete': False, 'error': type(error).__name__, 'offsite': 'unconfirmed'}))
        raise SystemExit(1)
