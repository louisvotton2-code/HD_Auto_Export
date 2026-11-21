import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';
import { AnalyticsDocumentImportError, importAnalyticsDocumentSnapshot } from './traffic-import.js';

const MAX_SNAPSHOT_BYTES = 16_384;

function readFinalizedSnapshot(file: string): unknown {
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES || (stat.mode & 0o077) !== 0) {
      throw new AnalyticsDocumentImportError('INVALID_SNAPSHOT');
    }
    const bytes = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = readSync(handle, bytes, length, bytes.length - length, null);
      if (chunk === 0) break;
      length += chunk;
    }
    if (length !== stat.size || length > MAX_SNAPSHOT_BYTES) throw new AnalyticsDocumentImportError('INVALID_SNAPSHOT');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } catch {
      throw new AnalyticsDocumentImportError('INVALID_SNAPSHOT');
    }
  } finally {
    closeSync(handle);
  }
}

async function main() {
  const [file, ...extras] = process.argv.slice(2);
  if (!file || extras.length) throw new AnalyticsDocumentImportError('INVALID_SNAPSHOT');
  const env = readDatabaseEnvironment();
  const databaseUrl = env.DATABASE_URL;
  const expected = env.ANALYTICS_IMPORT_DATABASE;
  if (!databaseUrl || !expected) throw new AnalyticsDocumentImportError('DATABASE_MISMATCH');
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || decodeURIComponent(parsed.pathname.slice(1)) !== expected) {
    throw new AnalyticsDocumentImportError('DATABASE_MISMATCH');
  }
  const snapshot = readFinalizedSnapshot(file);
  const database = createDatabase(databaseUrl, 1, false, 1000);
  try {
    console.log(JSON.stringify(await importAnalyticsDocumentSnapshot(database, snapshot, expected)));
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = error instanceof AnalyticsDocumentImportError ? error.code : 'IMPORT_FAILED';
    // Never log the file contents, path, database address, or a low-level error.
    console.error(`Analytics document snapshot import failed (${code}).`);
    process.exitCode = 1;
  });
}
