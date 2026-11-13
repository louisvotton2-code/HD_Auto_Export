"""Publish a bounded, atomic capacity decision; measurement is owned by OPS."""
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile

ROOT = Path('/srv/hd-auto/data/full-sync-capacity')
MAX_INT = 9007199254740991


def integer(value, positive=False):
    if type(value) is not int or not (1 if positive else 0) <= value <= MAX_INT:
        raise ValueError('Invalid measurement')
    return value


def decision(measurement, now):
    result = dict(schemaVersion=1, model='hd-ext07-peak-v1', snapshotId=None,
                  targetRows=0, sampleRows=0, evidenceHash=None,
                  measuredAt=now.isoformat().replace('+00:00', 'Z'),
                  expiresAt=(now + dt.timedelta(minutes=10)).isoformat().replace('+00:00', 'Z'),
                  decision='wait', reason='SYNC_CAPACITY_WAITING_MEASUREMENT',
                  projectedPeakBytes=None, diskTotalBytes=0, currentUsedBytes=0, components={})
    if measurement is None:
        return result
    # Only explicit numeric component names cross this boundary; never copy raw inputs.
    snapshot = measurement['snapshotId']
    digest = measurement['evidenceHash']
    if not isinstance(snapshot, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', snapshot):
        raise ValueError('Invalid snapshot')
    if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('Invalid binding')
    result.update(snapshotId=snapshot, evidenceHash=digest,
                  targetRows=integer(measurement['targetRows'], True),
                  sampleRows=integer(measurement['sampleRows'], True),
                  diskTotalBytes=integer(measurement['diskTotalBytes'], True),
                  currentUsedBytes=integer(measurement['currentUsedBytes']))
    components = measurement['components']
    if not isinstance(components, dict) or len(components) > 64:
        raise ValueError('Invalid components')
    for name, value in components.items():
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9]{0,63}Bytes', name):
            raise ValueError('Invalid component name')
        result['components'][name] = integer(value)
    if measurement.get('sampleEvidenceSufficient') is not True:
        result['reason'] = 'SYNC_CAPACITY_INSUFFICIENT_SAMPLE'
        return result
    peak = integer(measurement['projectedPeakBytes'])
    if peak < result['currentUsedBytes'] or result['sampleRows'] > result['targetRows']:
        raise ValueError('Inconsistent measurement')
    result['projectedPeakBytes'] = peak
    blocked = max(peak, result['currentUsedBytes']) * 10 >= result['diskTotalBytes'] * 7
    result.update(decision='blocked' if blocked else 'allow',
                  reason='SYNC_CAPACITY_LIMIT' if blocked else 'SYNC_CAPACITY_VERIFIED')
    return result


def atomic_write(path, value, gid):
    fd, temporary = tempfile.mkstemp(prefix='.decision-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o640)
            os.fchown(stream.fileno(), -1, gid)
            json.dump(value, stream, allow_nan=False)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if os.getuid() != 0 or ROOT.is_symlink() or not ROOT.is_dir():
        raise ValueError('Provision root-owned capacity directory first')
    info = ROOT.stat()
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('Capacity directory must not be writable by worker')
    with (ROOT / '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        now = dt.datetime.now(dt.timezone.utc)
        try:
            path = Path(__file__).with_name('capacity-measure.py')
            spec = importlib.util.spec_from_file_location('capacity_measure', path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            value = decision(module.measure(), now)
        except Exception:
            value = decision(None, now)
        atomic_write(ROOT / 'decision.json', value, info.st_gid)
        print(json.dumps({'decision': value['decision'], 'reason': value['reason']}))


if __name__ == '__main__':
    main()
