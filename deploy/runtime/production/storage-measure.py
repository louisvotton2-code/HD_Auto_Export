"""Read-only production checkpoint measurements; no credentials or business rows emitted."""
import argparse
import json
import re
import subprocess
import os
from pathlib import Path

ROOT = Path('/srv/hd-auto')


def checked_output(argv):
    return subprocess.check_output(argv, text=True, timeout=45).strip()


def durable_path(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or not path.exists():
        raise ValueError('Expected an existing absolute data path')
    # Resolve symlinks only after allowing the stable data/backups/staging roots.
    if not any(path == ROOT/name or (ROOT/name) in path.parents for name in ('data', 'backups', 'staging')):
        raise ValueError('Storage input must be under a stable HD Auto data root')
    if os.stat(path).st_dev != os.stat(ROOT/'data').st_dev:
        raise ValueError('Storage input is not on the data filesystem')
    return path


def allocated_bytes(path):
    line = checked_output(['du', '-s', '-B1', '--', str(path)])
    return int(line.split()[0])


def measure(*, database, expected_uuid, archives, staging):
    if not re.fullmatch(r'hd_release_[a-f0-9]{16}', database):
        raise ValueError('Use the explicit current release database')
    if not re.fullmatch(r'[a-f0-9-]{36}', expected_uuid):
        raise ValueError('Expected an explicit data filesystem UUID')
    for path in [ROOT/'data', ROOT/'backups', ROOT/'staging']:
        actual = checked_output(['findmnt', '--mountpoint', str(path), '-n', '-o', 'UUID'])
        if actual != expected_uuid:
            raise ValueError('Data filesystem identity mismatch')
    info = json.loads(checked_output(['docker', 'inspect', 'hd-auto-postgres-1']))[0]
    if not info['State']['Running'] or not any(m['Source'] == '/srv/hd-auto/data/current/postgres' and m['Destination'] == '/var/lib/postgresql' for m in info['Mounts']):
        raise ValueError('Unexpected production PostgreSQL mount')
    query = "SELECT json_build_object('databaseBytes',pg_database_size(current_database()),'indexBytes',coalesce((SELECT sum(pg_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='i' AND n.nspname NOT IN ('pg_catalog','information_schema')),0));"
    sizes = json.loads(checked_output(['docker', 'exec', '-u', 'postgres', 'hd-auto-postgres-1', 'psql', '-X', '-U', 'postgres', '-d', database, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', query]))
    stats = os.statvfs(ROOT/'data')
    return {
        'diskTotalBytes': stats.f_blocks*stats.f_frsize,
        'diskUsedBytes': (stats.f_blocks-stats.f_bfree)*stats.f_frsize,
        **sizes,
        'walBytes': allocated_bytes(durable_path(ROOT/'data/current/postgres/18/docker/pg_wal')),
        'archiveBytes': sum(allocated_bytes(durable_path(p)) for p in archives),
        'archivesInDatabase': not archives,
        'stagingBytes': allocated_bytes(durable_path(staging)),
        'backupBytes': allocated_bytes(durable_path(ROOT/'backups')),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--expected-uuid', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive', action='append', type=Path)
    mode.add_argument('--archives-in-database', action='store_true', help='raw archives already included in databaseBytes')
    parser.add_argument('--staging', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(measure(database=args.database, expected_uuid=args.expected_uuid, archives=args.archive or [], staging=args.staging), indent=2))


if __name__ == '__main__':
    main()
