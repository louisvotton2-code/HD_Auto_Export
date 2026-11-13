"""EXT07 daily compressed recovery points; only configured backup points are pruned.

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
    temp.chmod(0o600)
    temp.rename(path)


def selected_old_points(points, keep=2):
    """Only completed routine points compete for retention; release points never do."""
    completed = sorted((p for p in points if p.get('kind') == 'daily' and p.get('complete') is True),
                       key=lambda p: p['createdAt'], reverse=True)
    return completed[keep:]


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
    # Original verified components, temporary compressed container and ciphertext
    # coexist briefly. Keep this transient peak below the same 70% data budget.
    return (database + files) * 33 // 10 + 128 * 1024**2


def control_root(path):
    path = Path(path)
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
    parser.add_argument('--kind', choices=['daily', 'release'], default='daily')
    args = parser.parse_args()
    config_stat = args.config.lstat()
    if os.getuid() != 0 or not stat.S_ISREG(config_stat.st_mode) or config_stat.st_uid != 0 or stat.S_IMODE(config_stat.st_mode) & 0o077:
        raise ValueError('Use a root-owned private regular configuration')
    config = json.loads(args.config.read_text())
    if not re.fullmatch(r'hd_release_[a-f0-9]{16}', config['database']):
        raise ValueError('Explicit current production database required')
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
    point_name = args.kind+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
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
            if ROOT/'data' not in path.parents or path.is_symlink() or not path.is_dir():
                raise ValueError('Media must use an existing stable data directory')
            measured_roots.append(path)
        file_bytes = sum(int(subprocess.check_output(['du', '-s', '-B1', '--', str(path)], text=True).split()[0]) for path in measured_roots)
        fs = os.statvfs(backup_root)
        total, used = fs.f_blocks*fs.f_frsize, (fs.f_blocks-fs.f_bfree)*fs.f_frsize
        reserve = reserve_bytes(database_bytes, file_bytes)
        if used + reserve > total * .70:
            raise ValueError('Recovery point transient peak would exceed 70% disk budget')
        state['preflight'] = dict(databaseBytes=database_bytes, fileBytes=file_bytes, reserveBytes=reserve, diskUsedBytes=used, diskTotalBytes=total)
        paused = [name for name in ('full-worker', 'web') if name in running]
        try:
            for service in paused:
                call(compose+['stop', '--timeout', '90', service])
            archive_control('archive-pin', reference)
            call(runtime+['backup', '--keep-stopped', '--backup', str(point)])
            manifest = json.loads((point/'manifest.json').read_text())
            if manifest['sourceDatabase'] != config['database']:
                raise ValueError('Recovery point database mismatch')
            for name, key in [('database.dump', 'databaseSha256'), ('media.tar', 'mediaTarSha256')]:
                if digest(point/name) != manifest[key]:
                    raise ValueError('Runtime backup checksum mismatch')
            state['archives'] = pack_roots(point/'source-archives.tar.gz', [archive_root])
            state['controls'] = pack_roots(point/'controls.tar.gz', controls)
            # The legacy runtime emits an uncompressed media tar. Compress it here;
            # preserve original until off-host decrypt/restore verification succeeds.
            state['databaseSha256'] = manifest['databaseSha256']
            state['mediaTarSha256'] = manifest['mediaTarSha256']
            state['sourceArchivesSha256'] = digest(point/'source-archives.tar.gz')
            state['controlsSha256'] = digest(point/'controls.tar.gz')
        finally:
            failures = []
            for service in ['api', *reversed(paused)]:
                if service not in running:
                    continue
                try: call(compose+['start', service])
                except subprocess.CalledProcessError: failures.append(service)
            if failures:
                raise RuntimeError('Failed to resume: '+', '.join(failures))
        # Encryption happens after query services have resumed. The private key
        # stays off host; this is not an off-host/decryption success claim.
        payload = point/'recovery.tar.gz'
        with tarfile.open(payload, 'x:gz', compresslevel=6) as tar:
            for name in ['database.dump', 'media.tar', 'source-archives.tar.gz', 'controls.tar.gz', 'manifest.json']:
                tar.add(point/name, arcname=name, recursive=False)
        cipher = point/'recovery.cms'
        call(['openssl', 'cms', '-encrypt', '-binary', '-outform', 'DER', '-aes-256-gcm', '-in', str(payload), '-out', str(cipher), str(config['certificate'])])
        payload.unlink()  # temporary outer container; original verified components remain
        state.update(complete=True, ciphertextSha256=digest(cipher), ciphertextBytes=cipher.stat().st_size, completedAt=datetime.now(timezone.utc).isoformat())
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
