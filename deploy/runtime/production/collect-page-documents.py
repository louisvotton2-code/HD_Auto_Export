"""Finalize closed public document hours and retry their exact private snapshots."""

import argparse
from datetime import datetime, timedelta, timezone
import fcntl
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import runpy
import stat
import subprocess
import tempfile


AGGREGATOR = runpy.run_path(str(Path(__file__).resolve().with_name('aggregate-page-documents.py')))
BEIJING = AGGREGATOR['BEIJING']
HOUR = 3600
LOOK_AROUND = 60
HEARTBEAT_GAP = 45
MAX_LOG_BYTES = 64 * 1024**2
MAX_PRIVATE_BYTES = 16_384
MAX_HOURS_PER_RUN = 3
HEARTBEAT = b'{"kind":"page_document_coverage_v1"'


class CollectorError(ValueError):
    """A fixed diagnostic safe to emit to the service journal."""


def private_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise CollectorError('Expected a private regular collector file')
        payload = handle.read(MAX_PRIVATE_BYTES + 1)
        if not payload or len(payload) > MAX_PRIVATE_BYTES:
            raise CollectorError('Collector file exceeded its size bound')
    return json.loads(payload)


def persist(path, value, mode=0o600):
    with tempfile.NamedTemporaryFile('w', encoding='ascii', dir=path.parent,
                                     prefix='.collector-stage-', delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(value, handle, separators=(',', ':'))
            handle.write('\n')
            handle.flush()
            os.fchmod(handle.fileno(), mode)
            os.fsync(handle.fileno())
            temporary.replace(path)
            sync_directory(path.parent)
        finally:
            temporary.unlink(missing_ok=True)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def snapshot(log, hour):
    start = hour.timestamp()
    end = start + HOUR
    beats = set()
    for raw in BytesIO(log):
        if not raw.startswith(HEARTBEAT):
            continue
        try:
            if len(raw) > 128 or not raw.endswith(b'\n'):
                raise ValueError
            entry = json.loads(raw)
            time = entry['time']
            if (entry.keys() != {'kind', 'time'} or entry['kind'] != 'page_document_coverage_v1'
                    or type(time) not in (float, int) or not math.isfinite(time)):
                raise ValueError
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            raise CollectorError('Malformed page-document coverage') from error
        if start - LOOK_AROUND <= time <= end + LOOK_AROUND:
            beats.add(time)
    before = max((beat for beat in beats if beat <= start), default=None)
    after = min((beat for beat in beats if beat >= end), default=None)
    complete = False
    if before is not None and after is not None:
        chain = sorted(beat for beat in beats if before <= beat <= after)
        complete = all(right-left <= HEARTBEAT_GAP for left, right in zip(chain, chain[1:]))
    status = 'complete' if complete else 'partial'
    document = AGGREGATOR['aggregate'](BytesIO(log), hour, status)
    if status == 'partial' and not document['rows'] and not any(start <= beat < end for beat in beats):
        return None
    return document


def gateway_logs(container, hour):
    start = hour.astimezone(timezone.utc)
    arguments = ['docker', 'logs', '--since', (start-timedelta(seconds=LOOK_AROUND)).isoformat(),
                 '--until', (start+timedelta(seconds=HOUR+LOOK_AROUND)).isoformat(), container]
    result = subprocess.run(arguments, capture_output=True, timeout=30)
    if result.returncode or len(result.stdout) > MAX_LOG_BYTES:
        raise CollectorError('Could not read this gateway hour')
    return result.stdout


def send(import_command, path, expected):
    result = subprocess.run([*import_command, str(path)], capture_output=True, timeout=30)
    if result.returncode == 12:
        hour = AGGREGATOR['beijing_hour'](expected['hour']).isoformat()
        raise CollectorError(f'Conflicting finalized snapshot for {hour}; preserved for review')
    if result.returncode or len(result.stdout) > MAX_PRIVATE_BYTES:
        raise CollectorError('Page-document snapshot import failed')
    reply = json.loads(result.stdout)
    if (reply['outcome'] not in ('imported', 'duplicate') or reply['status'] != expected['status']
            or reply['rows'] != len(expected['rows'])
            or AGGREGATOR['beijing_hour'](reply['hour']) != AGGREGATOR['beijing_hour'](expected['hour'])):
        raise CollectorError('Page-document import returned an inconsistent acknowledgement')
    return reply['outcome']


def validate_config(config):
    if isinstance(config, dict) and config.get('enabled') is False:
        return None
    required = {'enabled', 'gatewayContainer', 'stateDirectory', 'importCommand'}
    if (not isinstance(config, dict) or config.get('enabled') is not True
            or not required <= config.keys() or config.keys()-required-{'visitAuditDirectory'}):
        raise CollectorError('Invalid page-document collector configuration')
    container, state, argv = (config[key] for key in ('gatewayContainer', 'stateDirectory', 'importCommand'))
    if (not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', container) or not isinstance(argv, list)
            or not argv or any(not isinstance(arg, str) or not arg or '\0' in arg for arg in argv)
            or not Path(argv[0]).is_absolute()):
        raise CollectorError('Expected a named gateway and reviewed importer command')
    directory = Path(state)
    if not directory.is_absolute() or directory.resolve() != directory:
        raise CollectorError('Expected a canonical collector directory')
    info = directory.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise CollectorError('Expected a private collector directory')
    audit = None
    if 'visitAuditDirectory' in config:
        audit = Path(config['visitAuditDirectory'])
        if not audit.is_absolute() or audit.resolve(strict=True) != audit:
            raise CollectorError('Expected a canonical document audit directory')
        info = audit.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o027:
            raise CollectorError('Expected an owner-managed document audit directory')
    return container, directory, argv, audit


def collect(config):
    parameters = validate_config(config)
    if parameters is None:
        return {'enabled': False}
    container, state, command, audit = parameters
    lock_fd = os.open(state/'collector.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'wb') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        for stale in state.glob('.collector-stage-*'):
            stale.unlink()
        return process_hours(container, state, command, audit)


def publish_visit_audit(directory, hour, document):
    stamp = int(hour.timestamp())
    if document is not None:
        persist(directory/f'hour-{stamp}.json', {'hour': stamp, 'status': document['status'],
            'requests': sum(row['requests'] for row in document['rows'])}, mode=0o640)
    for entry in directory.glob('hour-*.json'):
        match = re.fullmatch(r'hour-(\d{10})\.json', entry.name)
        if match and int(match[1]) < stamp-24*HOUR:
            entry.unlink()


def process_hours(container, state, command, audit):
    now = datetime.now(BEIJING)
    latest = (now-timedelta(seconds=LOOK_AROUND)).replace(minute=0, second=0, microsecond=0)-timedelta(hours=1)
    oldest = (now-timedelta(days=89)).replace(hour=0, minute=0, second=0, microsecond=0)
    checkpoint, pending = state/'next-hour.json', state/'pending.json'
    try:
        cursor = AGGREGATOR['beijing_hour'](private_file(checkpoint)['hour'])
    except FileNotFoundError:
        cursor = latest
        persist(checkpoint, {'hour': cursor.isoformat()})
    cursor = max(cursor, oldest)
    outcomes = []
    for _ in range(MAX_HOURS_PER_RUN):
        try:
            document = private_file(pending)
        except FileNotFoundError:
            document = None
        if document is not None:
            prepared_hour = AGGREGATOR['beijing_hour'](document['hour'])
            if prepared_hour > cursor:
                raise CollectorError('Pending page-document snapshot is ahead of the saved cursor')
            if prepared_hour < cursor:
                pending.unlink()
                sync_directory(state)
                document = None
        if cursor > latest:
            break
        if document is None:
            document = snapshot(gateway_logs(container, cursor), cursor)
            if document is not None:
                persist(pending, document)
        outcome = send(command, pending, document) if document is not None else 'missing'
        if audit is not None:
            publish_visit_audit(audit, cursor, document)
        outcomes.append({'hour': cursor.isoformat(), 'outcome': outcome})
        cursor += timedelta(hours=1)
        persist(checkpoint, {'hour': cursor.isoformat()})
        if document is not None:
            pending.unlink()
            sync_directory(state)
    return {'enabled': True, 'hours': outcomes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(collect(private_file(args.config)), separators=(',', ':')))
    except (OSError, ValueError, TypeError, KeyError, OverflowError, subprocess.TimeoutExpired) as error:
        # Do not emit child stdout/stderr, config contents or credentials.
        message = str(error) if isinstance(error, CollectorError) else 'Invalid state or subprocess failure'
        parser.exit(1, 'Page-document collector failed. ' + message + '\n')


if __name__ == '__main__':
    main()
