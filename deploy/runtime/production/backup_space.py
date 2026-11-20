"""Capacity evidence from normal recovery points, with no extra database dumps."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import os
import re
import stat

from first_party_data import FULL_SCOPE, SCOPE, scope as backup_scope

OVERHEAD = 128 * 1024**2


def _read_private(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > limit:
        raise ValueError('Invalid recovery point metadata')
    return json.loads(path.read_text())


def recovery_samples(root, database, now=None, *, scope=FULL_SCOPE):
    """Use finalized points for the same database and backup scope."""
    scope = backup_scope(scope)
    now = now or datetime.now(timezone.utc)
    samples = []
    for point in sorted(Path(root).glob('daily-*')):
        if not re.fullmatch(r'daily-[0-9TZ.]+', point.name) or point.is_symlink() or not point.is_dir():
            continue
        try:
            proof = _read_private(point/'routine.json', 65536)
            if (proof.get('name') != point.name or proof.get('kind') != 'daily' or
                    proof.get('complete') is not True or proof.get('phase') != 'finalized' or proof.get('format') != 2):
                continue
            completed = datetime.fromisoformat(proof['completedAt'])
            if not now-timedelta(hours=48) <= completed <= now:
                continue
            manifest = _read_private(point/'manifest.json', 8 * 1024**2)
            if (manifest.get('format') != 2 or manifest.get('sourceDatabase') != database or
                    manifest.get('createdAt') != proof.get('createdAt')):
                continue
            if (backup_scope(proof.get('backupScope')) != scope or
                    backup_scope(manifest.get('backupScope')) != scope):
                continue
            db = proof['preflight']['databaseBytes']
            dump = manifest['files']['database.dump']['bytes']
            if type(dump) is not int or dump <= 0:
                continue
            if scope == SCOPE:
                supplement = manifest['files']['first-party.sql']['bytes']
                if type(supplement) is not int or supplement <= 0:
                    continue
                dump += supplement
            cipher = proof['ciphertextBytes']
            if (any(type(n) is not int or n <= 0 for n in (db, dump, cipher)) or dump > cipher or
                    not re.fullmatch(r'[a-f0-9]{64}', proof.get('ciphertextSha256', ''))):
                continue
            artifact = (point/'recovery.cms').lstat()
            if not stat.S_ISREG(artifact.st_mode) or artifact.st_uid != 0 or artifact.st_mode & 0o022 or artifact.st_size != cipher:
                continue
            samples.append((db, dump))
        except (KeyError, AttributeError, TypeError, ValueError, OSError):
            continue
    return samples


def projected_dump_bytes(database, live_database, samples):
    """Scale the largest comparable observed ratio, leaving 25% growth margin."""
    if any(type(n) is not int or n < 0 for n in (database, live_database)):
        raise ValueError('Invalid database size')
    comparable = [(db, dump) for db, dump in samples if db * 2 >= live_database]
    if not comparable:
        return database
    return max(max(dump, (5 * database * dump + 4 * db - 1) // (4 * db)) for db, dump in comparable)


def recovery_point_bytes(dump, inputs):
    if any(type(n) is not int or n < 0 for n in (dump, inputs)):
        raise ValueError('Invalid recovery component size')
    return dump + inputs + OVERHEAD


def check_disk_budget(path, additional=0):
    fs = os.statvfs(path)
    total = fs.f_blocks * fs.f_frsize
    used = (fs.f_blocks - fs.f_bavail) * fs.f_frsize
    allocated = (additional + fs.f_frsize - 1) // fs.f_frsize * fs.f_frsize
    if 10 * (used + allocated) >= 7 * total:
        raise ValueError('Recovery point transient peak would exceed 70% disk budget')
    return total, used
