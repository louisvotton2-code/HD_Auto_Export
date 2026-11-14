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
import shutil
import stat
import subprocess
import tarfile

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


def regular_files(roots):
    files = {}
    for root in roots:
        root = Path(root)
        if not root.is_absolute() or not root.exists() or root.is_symlink():
            raise ValueError('Configured archive root is missing or is a symlink')
        for path in ([root, *root.rglob('*')] if root.is_dir() else [root]):
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
    return files


def pack_roots(output, roots):
    files = regular_files(roots)
    with tarfile.open(output, 'x:gz', compresslevel=6) as archive:
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


def reserve_bytes(database, files):
    if any(isinstance(n, bool) or not isinstance(n, int) or n < 0 for n in (database, files)):
        raise ValueError('Invalid backup size measurement')
    # Compressed components plus streaming ciphertext coexist. Conservative
    # current-size headroom also covers WAL/growth; never use full-catalog demand.
    return (database + files) * 33 // 10 + 128 * 1024**2


def control_root(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Control root must be canonical and absolute')
    directories = [ROOT/'secrets', ROOT/'data/current/secrets', ROOT/'data/current/tls', ROOT/'data/current/acme', Path('/etc/hd-auto'), Path('/etc/letsencrypt')]
    exact = [Path('/etc/fstab'), Path('/etc/systemd/system/docker.service.d/hd-auto-storage.conf'), Path('/usr/local/sbin/hd-auto-storage-check')]
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
        def archive_control(operation, ref):
            call(compose+['run', '--rm', '-T', '--no-deps', 'full-worker', 'full-sync', operation, '--reference', ref])
        running = subprocess.check_output(compose+['ps', '--status', 'running', '--services'], text=True).split()
        if 'worker' in running or 'migrate' in running:
            raise ValueError('Stop other maintenance/ingestion writers first')
        # Fail before pausing any service if a full recovery point could exceed
        # budget. Existing points are never deleted to make this preflight pass.
        database_bytes = int(subprocess.check_output(compose+['exec', '-T', 'postgres', 'psql', '-X', '-U', 'postgres', '-d', config['database'], '-Atqc', 'SELECT pg_database_size(current_database())'], text=True))
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
        fs = os.statvfs(backup_root)
        total, used = fs.f_blocks*fs.f_frsize, (fs.f_blocks-fs.f_bfree)*fs.f_frsize
        # Backup protects data that exists now. A future full-catalog budget
        # must never prevent a current daily recovery point from being created.
        reserve = reserve_bytes(database_bytes, file_bytes)
        if used + reserve >= total * .70:
            raise ValueError('Recovery point transient peak would exceed 70% disk budget')
        state['preflight'] = dict(databaseBytes=database_bytes, fileBytes=file_bytes, reserveBytes=reserve, diskUsedBytes=used, diskTotalBytes=total)
        # The BE lease serializes acquisition with ALL physical media purges.
        # Persisted until explicit release: a killed backup remains protective.
        lease = config.get('mediaLeaseCommand')
        if not isinstance(lease, list) or not lease or not all(isinstance(x, str) for x in lease):
            raise ValueError('Reviewed media deletion lease command required')
        point.mkdir(mode=0o700)
        call(lease+['acquire', '--reference', reference])
        pinned = False
        try:
            archive_control('archive-pin', reference)
            pinned = True
            # pg_dump owns one MVCC snapshot; no web/API/worker stop or live-table
            # comparison. The archive manifest belongs to this dump, not later SQL.
            with (point/'database.dump').open('xb') as dump:
                subprocess.run(compose+['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres',
                    '-d', config['database'], '-Fc', '-Z', '6', '--no-owner', '--no-acl',
                    '--lock-wait-timeout=5000'], check=True, stdout=dump, stderr=log, timeout=1800)
            with (point/'database.dump').open('rb') as dump:
                subprocess.run(compose+['exec', '-T', 'postgres', 'pg_restore', '--list'],
                    check=True, stdin=dump, stdout=log, stderr=log, timeout=120)
            media = pack_roots(point/'media.tar.gz', media_roots)
            archives = pack_roots(point/'source-archives.tar.gz', [archive_root])
            controls_manifest = pack_roots(point/'controls.tar.gz', controls)
            manifest = dict(format=2, sourceDatabase=config['database'], release=config['releaseId'], snapshot='pg_dump-mvcc',
                createdAt=state['createdAt'], media=media, archives=archives, controls=controls_manifest,
                files={name: dict(sha256=digest(point/name), bytes=(point/name).stat().st_size)
                       for name in ['database.dump', 'media.tar.gz', 'source-archives.tar.gz', 'controls.tar.gz']})
            atomic_json(point/'manifest.json', manifest)
            # Stream the outer tar directly into encryption: do not write another
            # full plaintext container. Inputs remain until ciphertext is complete.
            cipher = point/'recovery.cms'
            encryption = subprocess.Popen(['openssl', 'cms', '-encrypt', '-binary', '-outform', 'DER',
                '-aes-256-gcm', '-stream', '-out', str(cipher), str(config['certificate'])], stdin=subprocess.PIPE,
                stdout=log, stderr=log)
            try:
                with tarfile.open(fileobj=encryption.stdin, mode='w|') as tar:
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
            state.update(complete=True, archiveValidation='checksums-and-dump-directory',
                restoreValidation='not-run', offsite='pending', format=2,
                plaintextRetention='temporary-for-one-time-restore' if args.retain_for_restore else 'remove-after-encryption',
                ciphertextSha256=digest(cipher), ciphertextBytes=cipher.stat().st_size,
                completedAt=datetime.now(timezone.utc).isoformat())
            atomic_json(point/'routine.json', state)
            # Successful ciphertext + independently checked source archive is a
            # creation proof, NOT a decrypt/restore proof. Keep known baseline.
            if not args.retain_for_restore:
                remove_verified_components(point, manifest)
        finally:
            # Release only our lease; stale references from an interrupted job
            # require explicit recovery, never automatic expiry during a dump.
            call(lease+['release', '--reference', reference])
        # Retained point embeds the sources. Pins can now be released; failed
        # jobs retain their archive pin until partial recovery material is handled.
        if pinned:
            archive_control('archive-release', reference)
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
        verify_completed_points(backup_root, points)
        for old in selected_old_points(points):
            old_point = backup_root/old['name']
            if digest(old_point/'recovery.cms') != old['ciphertextSha256']:
                raise ValueError('Retained recovery point checksum changed; refuse deletion')
            shutil.rmtree(old_point)
            # Release pins only after the point is actually deleted. If this
            # operation fails, excess pins remain protective and are reported.
            archive_control('archive-release', old['reference'])
    print(json.dumps({k: state[k] for k in ['name', 'complete', 'offsite', 'ciphertextBytes', 'ciphertextSha256']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'complete': False, 'error': type(error).__name__, 'offsite': 'unconfirmed'}))
        raise SystemExit(1)
