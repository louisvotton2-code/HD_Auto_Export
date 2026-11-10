import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import type { ExternalCandidate } from '@hd/contracts/admin';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { claimSyncLease, enqueueFakeEvents, SyntheticSyncWorker, syncHealth } from '../src/external/sync/worker.js';

const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(maintenanceUrl.protocol) || maintenanceUrl.hostname !== '127.0.0.1' ||
    maintenanceUrl.pathname !== '/postgres' || maintenanceUrl.search || maintenanceUrl.hash) throw new Error('Expected local maintenance database.');
const maintenance = createDatabase(maintenanceUrl.toString(), 1);
const databaseName = 'hd_ext_scale_sync_' + randomBytes(8).toString('hex');
const databaseUrl = new URL(maintenanceUrl);
databaseUrl.pathname = '/' + databaseName;
let db: Database;
let secondDb: Database;
let created = false;
let first: SyntheticSyncWorker;
let second: SyntheticSyncWorker;

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  db = createDatabase(databaseUrl.toString(), 2);
  secondDb = createDatabase(databaseUrl.toString(), 2);
  await migrateDatabase(db);
  first = new SyntheticSyncWorker(db);
  second = new SyntheticSyncWorker(secondDb);
});
after(async () => {
  try {
    await Promise.all([db?.close(), secondDb?.close()]);
    if (created) await maintenance.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  } finally { await maintenance.close(); }
});

function upsert(id: string, revision = 1, expired = false) {
  const candidate = makeExternalCandidateFixture(1);
  candidate.externalId = id;
  candidate.revision = revision;
  if (expired) candidate.images[0]!.expiresAt = '2001-01-01T00:00:00Z';
  return candidate;
}
function withdraw(candidate: ReturnType<typeof upsert>): ExternalCandidate {
  return {
    operation: 'withdraw', platformId: candidate.platformId, externalId: candidate.externalId,
    fetchedAt: candidate.fetchedAt, sourceUpdatedAt: candidate.sourceUpdatedAt, revision: candidate.revision + 1,
  };
}

test('checkpoint fences an expired worker and advances only after priority withdrawal and ordered replay', async () => {
  const a = upsert('worker-checkpoint-a');
  const b = upsert('worker-checkpoint-b');
  const input = [
    { key: 'a.upsert', lane: 'delta' as const, candidate: a },
    { key: 'a.withdraw', lane: 'delta' as const, candidate: withdraw(a) },
    { key: 'b.reconcile', lane: 'reconcile' as const, candidate: b },
  ];
  assert.deepEqual(await enqueueFakeEvents(db, input, true), { inserted: 3, head: '3' });
  assert.deepEqual(await enqueueFakeEvents(db, input), { inserted: 0, head: '3' });
  await assert.rejects(enqueueFakeEvents(db, [{ ...input[0]!, candidate: { ...a, revision: 8 } }]), /identity/);
  const abandoned = await claimSyncLease(db, first.owner);
  assert.ok(abandoned);
  assert.equal(await claimSyncLease(secondDb, second.owner), null);
  await db.pool.query("UPDATE external_sync_state SET lease_expires_at=clock_timestamp()-interval '1 second'");
  const acquired = await claimSyncLease(secondDb, second.owner);
  assert.ok(acquired);
  assert.ok(BigInt(acquired.fence) > BigInt(abandoned.fence));
  assert.deepEqual(await first.runLease(abandoned), { action: 'leased', processed: 0 });
  assert.deepEqual(await second.runLease(acquired), { action: 'withdrawals', processed: 1, checkpoint: '0' });
  assert.deepEqual(await first.tick(), { action: 'delta', processed: 1, checkpoint: '2' });
  const tombstone = await db.pool.query('SELECT upstream_state,source_revision FROM external_listings WHERE external_id=$1', [a.externalId]);
  assert.deepEqual(tombstone.rows, [{ upstream_state: 'withdrawn', source_revision: '2' }]);
  assert.deepEqual(await second.tick(), { action: 'reconcile', processed: 1, checkpoint: '3' });
  const schedule = await db.pool.query(`SELECT next_delta_at>clock_timestamp()+interval '4 minutes' AS delta,
    next_reconcile_at>clock_timestamp()+interval '6 days' AS reconcile FROM external_sync_state`);
  assert.deepEqual(schedule.rows, [{ delta: true, reconcile: true }]);
  assert.deepEqual(await syncHealth(db), { ready: false, checkpoint: '3', enqueued: '3' });
  await second.heartbeat('ready');
  assert.deepEqual(await syncHealth(db), { ready: true, checkpoint: '3', enqueued: '3' });
  await second.removeHeartbeat();
  assert.equal((await syncHealth(db)).ready, false);
});

test('a failed completion rolls back the archive and projection; restart retries exactly once', async () => {
  const candidate = upsert('worker-failure-replay');
  await enqueueFakeEvents(db, [{ key: 'failure.replay', lane: 'delta', candidate }], true);
  await db.pool.query(`CREATE FUNCTION ext02_test_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated interruption after import'; END $$`);
  await db.pool.query('CREATE TRIGGER ext02_test_fail BEFORE UPDATE ON external_sync_events FOR EACH ROW EXECUTE FUNCTION ext02_test_fail_completion()');
  try {
    const archiveBefore = await db.pool.query('SELECT count(*)::integer AS n FROM external_import_batches');
    await assert.rejects(first.tick(), /simulated interruption/);
    assert.deepEqual(await second.tick(), { action: 'leased', processed: 0 });
    assert.equal((await db.pool.query('SELECT 1 FROM external_listings WHERE external_id=$1', [candidate.externalId])).rowCount, 0);
    const archiveAfter = await db.pool.query('SELECT count(*)::integer AS n FROM external_import_batches');
    assert.deepEqual(archiveAfter.rows, archiveBefore.rows);
  } finally {
    await db.pool.query('DROP TRIGGER ext02_test_fail ON external_sync_events');
    await db.pool.query('DROP FUNCTION ext02_test_fail_completion()');
    await db.pool.query("UPDATE external_sync_state SET retry_at='-infinity'");
  }
  assert.deepEqual(await second.tick(), { action: 'delta', processed: 1, checkpoint: '4' });
  const receipts = await db.pool.query(`SELECT r.status FROM external_sync_events e
    JOIN external_import_records r ON r.batch_id=e.batch_id WHERE e.event_key='failure.replay'`);
  assert.deepEqual(receipts.rows, [{ status: 'applied' }]);
  assert.deepEqual(await first.tick(), { action: 'idle', processed: 0, checkpoint: '4' });
});

test('known expiry and versioned photo hints refresh fake media; withdrawal makes the old hint obsolete', async () => {
  const asset = upsert('worker-media', 1, true);
  await enqueueFakeEvents(db, [{ key: 'media.upsert', lane: 'delta', candidate: asset }], true);
  assert.equal((await first.tick()).action, 'delta');
  const media = (await db.pool.query<{ id: string; revision: number }>(`SELECT m.id,m.revision FROM external_media m
    JOIN external_listings l ON l.id=m.listing_id WHERE l.external_id=$1`, [asset.externalId])).rows[0]!;
  // Remove the importer's automatic expiry hint so the worker's due scanner must recreate it.
  await db.pool.query('DELETE FROM external_media_refresh_requests WHERE media_id=$1', [media.id]);
  const version = async () => BigInt((await db.pool.query<{ revision: string }>('SELECT revision FROM public_catalog_state')).rows[0]!.revision);
  const previous = await version();
  assert.deepEqual(await second.tick(), { action: 'media', processed: 1, checkpoint: '5' });
  assert.equal(await version(), previous + 1n);
  const fresh = await db.pool.query<{ revision: number; current: boolean; url: string }>(`SELECT revision,url,
    expires_at>clock_timestamp() AS current FROM external_media WHERE id=$1`, [media.id]);
  assert.equal(fresh.rows[0]!.revision, media.revision + 1);
  assert.equal(fresh.rows[0]!.current, true);
  assert.match(fresh.rows[0]!.url, /^https:\/\/photos\.example\.invalid\/refresh\//);
  await db.pool.query('INSERT INTO external_media_refresh_requests(media_id,media_revision) VALUES($1,$2)', [media.id, media.revision + 1]);
  await enqueueFakeEvents(db, [{ key: 'media.withdraw', lane: 'delta', candidate: withdraw(asset) }]);
  assert.equal((await first.tick()).action, 'withdrawals');
  assert.equal((await second.tick()).action, 'media');
  const requests = await db.pool.query('SELECT outcome FROM external_media_refresh_requests WHERE media_id=$1 ORDER BY media_revision', [media.id]);
  assert.deepEqual(requests.rows, [{ outcome: 'refreshed' }, { outcome: 'obsolete' }]);
  const updated = await db.pool.query('SELECT revision FROM external_media WHERE id=$1', [media.id]);
  assert.equal(updated.rows[0]!.revision, media.revision + 1);
});


test('the foreground worker publishes readiness and drains its independent pool on SIGTERM', { timeout: 20_000 }, async () => {
  const entry = fileURLToPath(new URL('../src/external/sync/cli.ts', import.meta.url));
  const processHandle = spawn(process.execPath, ['--import', 'tsx', entry, '--run'], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', DATABASE_URL: databaseUrl.toString(),
      EXTERNAL_CATALOG_MODE: 'synthetic-scale', TRANSLATION_PROVIDER: 'disabled', EXTERNAL_SYNC_IDLE_MS: '250' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const exited = once(processHandle, 'exit');
  try {
    let ready = false;
    for (let i = 0; i < 60 && processHandle.exitCode === null; i++) {
      if ((await syncHealth(db)).ready) { ready = true; break; }
      await delay(100);
    }
    assert.equal(ready, true);
    assert.equal(processHandle.kill('SIGTERM'), true);
    assert.deepEqual(await exited, [0, null]);
    assert.equal((await syncHealth(db)).ready, false);
  } finally {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      processHandle.kill('SIGKILL');
      await exited;
    }
  }
});
