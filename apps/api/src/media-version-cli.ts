import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { physicalCleanupAllowed } from './backup-lease.js';
import { createDatabase, type Database } from './db/index.js';
import { readDatabaseEnvironment } from './local-secrets.js';
import { LocalMediaStore, MediaStorageError } from './media/storage.js';
import { lockPublicManualMedia, mediaUuidPattern, saveMediaContentDigests, selectPublicMediaBackfillIds,
  type MediaContentDigests } from './media/versions.js';
import { ServingGate } from './serving-gate.js';

const defaultBatchSize = 10;
const maxBatchSize = 25;
type BackfillStore = { hashPublicRepresentations(id: string): Promise<MediaContentDigests> };
type BackfillOptions = {
  after?: string;
  limit?: number;
  apply?: boolean;
  reconcile?: boolean;
  canApply?: () => boolean;
};
type BackfillResult = {
  mode: 'apply' | 'dry-run';
  selected: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  skipped: number;
  nextAfter: string | null;
};

class BackfillBlocked extends Error {
  constructor(readonly reason: 'active-slot-required' | 'backup-lease' | 'already-running') {
    super(reason);
  }
}

export async function backfillMediaContentVersions(db: Database, store: BackfillStore, options: BackfillOptions = {}): Promise<BackfillResult> {
  const { after, limit = defaultBatchSize, apply = false, reconcile = false, canApply } = options;
  if (after !== undefined && !mediaUuidPattern.test(after)) throw new Error('Invalid media backfill cursor');
  if (!Number.isInteger(limit) || limit < 1 || limit > maxBatchSize) throw new Error('Invalid media backfill limit');

  return db.transaction(async tx => {
    const assertActive = () => {
      if (canApply && !canApply()) throw new BackfillBlocked('active-slot-required');
    };
    if (apply) {
      assertActive();
      const lease = await tx.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(86147,49) AS acquired');
      if (!lease.rows[0]?.acquired) throw new BackfillBlocked('already-running');
      // Stay protected through generating files and committing their metadata.
      if (!await physicalCleanupAllowed(tx)) throw new BackfillBlocked('backup-lease');
      await tx.query("SET LOCAL lock_timeout='1s'");
    } else {
      await tx.query('SET TRANSACTION READ ONLY');
    }

    const ids = await selectPublicMediaBackfillIds(tx, after ?? null, limit + 1, reconcile);
    const batch = ids.slice(0, limit);
    const result: BackfillResult = { mode: apply ? 'apply' : 'dry-run', selected: batch.length,
      updated: 0, unchanged: 0, unavailable: 0, skipped: 0, nextAfter: ids.length > limit ? batch.at(-1)! : null };
    if (!apply) return result;

    for (const id of batch) {
      assertActive();
      if (!await lockPublicManualMedia(tx, id)) {
        result.skipped++;
        continue;
      }
      let digests: MediaContentDigests;
      try { digests = await store.hashPublicRepresentations(id); }
      catch (error) {
        if (!(error instanceof MediaStorageError)) throw error;
        result.unavailable++;
        continue;
      }
      if (await saveMediaContentDigests(tx, id, digests)) result.updated++;
      else result.unchanged++;
    }
    assertActive();
    if (result.updated) await tx.query('SELECT queue_public_catalog_metadata_change()');
    return result;
  });
}

async function run() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    reconcile: { type: 'boolean' }, database: { type: 'string' }, after: { type: 'string' }, limit: { type: 'string' } },
  allowPositionals: false });
  const env = readDatabaseEnvironment();
  const address = new URL(env.DATABASE_URL ?? '');
  if (!values.database || !['postgres:', 'postgresql:'].includes(address.protocol) ||
    decodeURIComponent(address.pathname.slice(1)) !== values.database || (values.apply && values['dry-run']) ||
    (values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit))) throw new Error('Explicit database and valid options are required');
  if (values.apply && env.NODE_ENV === 'production' &&
    (!/^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/.test(env.HD_RELEASE_ID ?? '') || !path.isAbsolute(env.MEDIA_ROOT ?? ''))) {
    throw new Error('A production release and configured media directory are required');
  }
  const store = new LocalMediaStore(path.resolve(env.MEDIA_ROOT ?? '.data/media'));
  const slot = new ServingGate(env.API_SERVING_MODE_FILE);
  const db = createDatabase(address.toString(), 2);
  try {
    const target = await db.pool.query<{ name: string }>('SELECT current_database() AS name');
    if (target.rows[0]?.name !== values.database) throw new Error('Database mismatch');
    const result = await backfillMediaContentVersions(db, store, { after: values.after, apply: values.apply,
      reconcile: values.reconcile, limit: values.limit === undefined ? undefined : Number(values.limit),
      canApply: () => slot.mode() === 'active' });
    console.log(JSON.stringify(result));
    if (result.unavailable) process.exitCode = 2;
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run().catch(error => {
    console.error(error instanceof BackfillBlocked ? `Media version backfill paused (${error.reason}).`
      : 'Media version backfill failed. Verify the explicit database, release, media directory and batch cursor.');
    process.exitCode = 1;
  });
}
