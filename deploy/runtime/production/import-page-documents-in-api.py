"""Stream one private hourly snapshot into the selected API slot's importer."""

import argparse
import json
import os
import re
import stat
import subprocess
from pathlib import Path


# docker exec does not inherit the API entrypoint's dynamically created URL.
# Reuse the slot identity and mounted password without rerunning media setup.
IMPORT_IN_SLOT = r"""
import { chown, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { deploymentDatabaseIdentity } from '/app/database-name.mjs';
import { readLocalSecret } from '/app/apps/api/dist/local-secrets.js';

const [expected, release] = process.argv.slice(1);
const { database, user } = deploymentDatabaseIdentity(process.env.HD_DATABASE_NAME);
const uid = Number(process.env.APP_UID);
const gid = Number(process.env.APP_GID);
const modeFile = process.env.API_SERVING_MODE_FILE;
if (database !== expected || process.env.HD_RELEASE_ID !== release || !modeFile ||
    !Number.isSafeInteger(uid) || uid <= 0 ||
    !Number.isSafeInteger(gid) || gid < 0) process.exit(1);
if (readLocalSecret(modeFile, 32) !== 'active') process.exit(1);
const password = (await readFile('/run/secrets/app_db_password', 'utf8')).trim();
if (!password) process.exit(1);
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 16384) process.exit(1);
  chunks.push(chunk);
}
const scratch = await mkdtemp('/tmp/hd-page-document-');
try {
  const snapshot = scratch + '/snapshot.json';
  await writeFile(snapshot, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
  await chown(snapshot, uid, gid);
  await chown(scratch, uid, gid);
  const env = { ...process.env,
    DATABASE_URL: 'postgresql://' + user + ':' + encodeURIComponent(password) + '@postgres:5432/' + database,
    ANALYTICS_IMPORT_DATABASE: expected,
  };
  delete env.DATABASE_URL_FILE;
  if (readLocalSecret(modeFile, 32) !== 'active') throw new Error('API slot is not active');
  const result = spawnSync(process.execPath, ['dist/analytics/traffic-import-cli.js', snapshot],
    { cwd: '/app/apps/api', env, uid, gid, timeout: 12_000, maxBuffer: 4_096 });
  if (result.status === 0) process.stdout.write(result.stdout);
  else if (result.stderr?.toString().trim() === 'Analytics document snapshot import failed (HOUR_CONFLICT).') {
    process.exitCode = 12;
  } else process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
"""


def read_snapshot(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or not 0 < info.st_size <= 16384):
            raise ValueError('Invalid private snapshot')
        content = source.read(16385)
        if len(content) != info.st_size:
            raise ValueError('Snapshot changed during read')
        return content


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('snapshot', type=Path)
    args = parser.parse_args()
    if (not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', args.container)
            or not re.fullmatch(r'hd_auto|hd_release_[a-f0-9]{12,40}', args.database)
            or not re.fullmatch(r'[a-f0-9]{40,64}|sha256:[a-f0-9]{64}', args.release)):
        parser.error('Supply the exact API container, deployment database and release')
    try:
        completed = subprocess.run(['docker', 'exec', '-i', args.container, 'node', '--input-type=module',
                                    '-e', IMPORT_IN_SLOT, args.database, args.release],
                                   input=read_snapshot(args.snapshot), stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, timeout=20)
        if completed.returncode == 12:
            parser.exit(12, 'Closed page-document hour already has a different snapshot.\n')
        completed.check_returncode()
        reply = json.loads(completed.stdout)
        if (not isinstance(reply, dict) or set(reply) != {'outcome', 'hour', 'status', 'rows'}
                or reply['outcome'] not in ('imported', 'duplicate')):
            raise ValueError('Unexpected import receipt')
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, 'Page-document import did not produce a valid receipt.\n')
    print(json.dumps(reply, separators=(',', ':')))


if __name__ == '__main__':
    main()
