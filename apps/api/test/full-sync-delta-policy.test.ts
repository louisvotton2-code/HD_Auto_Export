import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test, type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { FullSyncClient } from '../src/external/full-sync/client.js';
import { armDeltaPolicy, prepareDeltaPolicy, readDeltaPolicy, requestDeltaReconciliation } from '../src/external/full-sync/delta-policy.js';
import { configureFullSync, FullSyncWorker } from '../src/external/full-sync/engine.js';
import { FullSyncError, type Change, type FullApply, type Locale, type Source } from '../src/external/full-sync/types.js';
import { jsonHash } from '../src/external/normalize.js';
import { catalogColumns } from '../src/external/sources/index.js';

const actor = { id: 'delta-policy-admin', requestId: 'delta-policy-test' };
const archiveAt = '2024-10-04T00:00:00.000Z';
const baseAt = '2024-10-03T00:00:00.000Z';
const changedAt = '2024-10-04T00:01:00.000Z';
const laterAt = '2024-10-04T00:02:00.000Z';
const latestAt = '2024-10-04T00:03:00.000Z';

function raw(value: unknown) {
  const body = JSON.stringify(value);
  return { body, hash: createHash('sha256').update(body).digest('hex') };
}

function change(id: number, vehicleId: string, type: Change['type'], at = changedAt): Change {
  return { id, source: 'che168', vehicleId, type, at };
}

function latch() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}

test('only a 410 from the changes endpoint invalidates the delta cursor', async () => {
  const client = new FullSyncClient('isolated-delta-fixture', {
    fetch: async () => new Response(null, { status: 410 }),
    wait: async () => {},
  });
  await assert.rejects(client.changes(baseAt, '1'), /SYNC_CURSOR_EXPIRED/);
  await assert.rejects(client.probeExport(), /SYNC_HTTP_410/);
});

async function fixture(t: TestContext) {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' &&
    url.pathname === '/postgres' && !url.search && !url.hash, 'Use isolated loopback maintenance PostgreSQL.');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network in delta policy tests'); });
  const name = `hd_delta_policy_${randomBytes(8).toString('hex')}`;
  const maintenance = createDatabase(url.toString(), 1);
  url.pathname = `/${name}`;
  const db = createDatabase(url.toString(), 2);
  const directory = await mkdtemp(path.join(tmpdir(), 'hd-delta-policy-'));
  let created = false;
  let running: FullSyncWorker | undefined;
  t.after(async () => {
    try {
      await running?.close();
      await db.close();
      if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await maintenance.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await migrateDatabase(db);
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Delta fixture','delta-policy@example.invalid','admin',false)", [actor.id]);
  await configureFullSync(db, actor, 'continuous');
  await db.pool.query("UPDATE external_full_sync SET since_at=$1,next_maintenance_at='infinity' WHERE id=1", [baseAt]);

  const feed = {
    changes: [] as Change[], expired: false, hasMore: false, sincePageCursor: 0,
    beforeChange: undefined as (() => Promise<void>) | undefined,
  };
  const details = new Map<string, { price: number; at: string }>();
  const requests: Array<{ since: string; cursor: string | null }> = [];
  let exportCalls = 0;
  const exportControl = { probeAt: null as string | null, csv: null as Buffer | null };
  const unexpectedExport = async () => {
    exportCalls++;
    throw new Error('An existing staged CSV must never be downloaded again');
  };
  const client = {
    async changes(since: string, cursor: string | null) {
      requests.push({ since, cursor });
      await feed.beforeChange?.();
      if (feed.expired) throw new FullSyncError('SYNC_CURSOR_EXPIRED');
      const current = cursor === null ? feed.sincePageCursor : Number(cursor);
      const changes = feed.changes.filter(event => event.id > current);
      const page = { cursor: current, nextCursor: changes.at(-1)?.id ?? current, hasMore: feed.hasMore, changes };
      return { ...page, rawResponse: raw(page) };
    },
    async *bulk(source: Source, ids: string[], locale: Locale) {
      const results = ids.map(id => {
        const detail = details.get(id) ?? { price: 70000, at: baseAt };
        return {
          id, source, status: 'active', updatedAt: detail.at, url: `https://www.che168.com/dealer/1/${id}.html`,
          title: locale === 'zh' ? '合成增量测试' : locale === 'ru' ? 'Проверка обновлений' : 'Synthetic delta fixture',
          make: { id: 'fixture-make', name: 'Example', nameZh: '示例' },
          model: { id: 'fixture-model', name: 'Model', nameZh: '测试车型' },
          price: { cny: detail.price }, modelYear: 2024, mileageKm: 10000, fuel: 'Petrol', transmission: 'Automatic',
          photos: ['https://erscglobal2.autoimg.cn/synthetic-delta-test.jpg'], hasInspectionReport: false,
        };
      });
      yield { results, notFound: [], rawResponse: raw({ results, notFound: [] }) };
    },
    async probeExport() {
      if (exportControl.probeAt === null) return unexpectedExport();
      exportCalls++;
      return exportControl.probeAt;
    },
    async downloadExport(file: string, checkSpace: () => Promise<void>) {
      if (exportControl.probeAt === null || exportControl.csv === null) return unexpectedExport();
      exportCalls++;
      await checkSpace();
      await writeFile(file, exportControl.csv, { mode: 0o600 });
      return {
        generatedAt: exportControl.probeAt, bytes: exportControl.csv.byteLength,
        sha256: createHash('sha256').update(exportControl.csv).digest('hex'),
      };
    },
  } as unknown as FullSyncClient;

  const start = async (syncClient = client, apply?: FullApply) => {
    const worker = new FullSyncWorker(db, syncClient, directory, apply);
    // This fixture isolates the cutover and polling logic from native host capacity receipts.
    worker.heavy = async () => {};
    worker.capacityGate = async () => false;
    worker.space = async () => ({ used: 0, available: 1024 ** 4, total: 1024 ** 4 });
    running = worker;
    assert.equal(await worker.acquire(), true);
    return worker;
  };
  const seedSnapshot = async (rows: Array<[number, string]>, total = rows.length) => {
    const id = randomUUID();
    await db.pool.query(`INSERT INTO external_full_snapshots
      (id,generated_at,state,path,sha256,bytes,rows,staged,apply_cursor)
      VALUES($1,$2,'applying',$3,$4,1024,$5,$5,1)`, [id, archiveAt, path.join(directory, id + '.csv.gz'), 'a'.repeat(64), total]);
    for (const [ordinal, identity] of rows) {
      await db.pool.query(`INSERT INTO external_full_stage(snapshot_id,row_number,source,external_id,payload)
        VALUES($1,$2,'che168',$3,jsonb_build_object('source','che168','id',$3::text,'has_report','false'))`,
      [id, ordinal, identity]);
    }
    await db.pool.query("UPDATE external_full_members SET last_snapshot=$1 WHERE source='che168' AND external_id=$2", [id, rows[0]![1]]);
    await db.pool.query('UPDATE external_full_sync SET last_capacity_sample=$1 WHERE id=1', [total]);
    return id;
  };
  const ingest = async (worker: FullSyncWorker, changes: Change[], hasMore = false) => {
    feed.changes = changes;
    feed.hasMore = hasMore;
    return worker.receiveDelta();
  };
  const duePoll = () => db.pool.query("UPDATE external_full_sync SET next_delta_at=clock_timestamp()-interval '1 second' WHERE id=1");
  const policy = () => readDeltaPolicy(db.pool);
  const snapshot = async (id: string) =>
    (await db.pool.query('SELECT state,apply_cursor::text FROM external_full_snapshots WHERE id=$1', [id])).rows[0]!;
  const sync = async () =>
    (await db.pool.query(`SELECT receive_cursor::text,received_events::text,applied_events::text,
      next_snapshot_at='infinity'::timestamptz AS no_periodic_export,
      next_delta_at>last_receive_at AND next_delta_at<=last_receive_at+interval '5 minutes'
        AND mod(extract(epoch FROM next_delta_at)::numeric,300)=0 AS next_slot
      FROM external_full_sync WHERE id=1`)).rows[0]!;
  const event = async (id: number) =>
    (await db.pool.query('SELECT applied_at IS NOT NULL AS applied,public_outcome FROM external_full_events WHERE event_id=$1', [id])).rows[0]!;
  const published = async (id: string) =>
    (await db.pool.query(`SELECT c.price_cny::numeric::int AS price FROM external_listings l
      JOIN external_catalog c ON c.listing_id=l.id WHERE l.provider='chinacarapi' AND l.platform_id='che168' AND l.external_id=$1`, [id])).rows[0];
  return { db, feed, details, requests, start, seedSnapshot, ingest, duePoll, policy, snapshot, sync, event, published, exportControl,
    exportCalls: () => exportCalls };
}

test('the original CSV drains to one fixed boundary and normal delta polling survives restart', async t => {
  const f = await fixture(t);
  let worker = await f.start();
  await f.ingest(worker, [change(1, '101', 'new', baseAt), change(2, '102', 'new', baseAt)]);
  assert.equal(await worker.applyEvents(), 2);
  assert.equal(await worker.details(), 2);
  assert.deepEqual(await f.published('102'), { price: 70000 });

  const snapshot = await f.seedSnapshot([[1, '101'], [2, '102'], [3, '103']]);
  await assert.rejects(prepareDeltaPolicy(f.db, actor, snapshot), /SYNC_DELTA_WORKER_RUNNING/);
  await worker.close();
  await assert.rejects(prepareDeltaPolicy(f.db, actor, randomUUID()), /SYNC_DELTA_SNAPSHOT_MISMATCH/);
  const prepared = await prepareDeltaPolicy(f.db, actor, snapshot);
  assert.equal(prepared.phase, 'draining');
  assert.deepEqual(await prepareDeltaPolicy(f.db, actor, snapshot), prepared);
  assert.equal((await f.sync()).no_periodic_export, true);
  await assert.rejects(armDeltaPolicy(f.db, actor, snapshot), /SYNC_DELTA_NOT_READY/);

  worker = await f.start();
  assert.deepEqual(await f.snapshot(snapshot), { state: 'applying', apply_cursor: '1' });
  f.details.set('101', { price: 65000, at: changedAt });
  f.details.set('201', { price: 70000, at: changedAt });
  await f.ingest(worker, [change(11, '201', 'new'), change(12, '101', 'price'), change(13, '102', 'removed')]);
  assert.equal(await worker.applyEvents(), 2);
  assert.equal((await f.event(11)).applied, false, 'Snapshot-first defers only the unseen identity');
  assert.deepEqual(await f.event(13), { applied: true, public_outcome: 'effective' });
  assert.equal(await f.published('102'), undefined);
  await worker.tick();
  assert.deepEqual(await f.snapshot(snapshot), { state: 'complete', apply_cursor: '3' });
  assert.equal((await f.policy())?.high_water, '13');
  assert.deepEqual(await f.published('101'), { price: 65000 });
  assert.equal(await f.published('102'), undefined, 'An older CSV cannot reverse a hot withdrawal');
  assert.equal((await f.policy())?.audit_cursor, '0', 'The CSV census waits for its newly queued details');
  await assert.rejects(armDeltaPolicy(f.db, actor, snapshot), /SYNC_DELTA_NOT_READY/);
  await worker.close();

  worker = await f.start();
  // Its older detail is above the fixed cutover watermark.
  f.feed.changes = [change(14, '202', 'new', laterAt)];
  const beforePoll = f.requests.length;
  // Move the persisted deadline to simulate the next wall-clock slot, then verify
  // the real DB schedules a future, five-minute-aligned deadline.
  await f.duePoll();
  await worker.tick();
  assert.equal(f.requests[beforePoll]?.cursor, '13');
  assert.equal((await f.sync()).receive_cursor, '14');
  assert.equal((await f.sync()).next_slot, true);
  assert.equal((await f.policy())?.high_water, '13');
  assert.equal((await f.event(11)).applied, true);
  await worker.tick();
  const ready = await f.policy();
  assert.equal(ready?.phase, 'ready');
  assert.equal(ready?.audit_missing, '0');
  assert.equal(ready?.event_audit_cursor, ready?.high_water);

  const activated = await armDeltaPolicy(f.db, actor, snapshot);
  assert.equal(activated.phase, 'delta');
  assert.deepEqual(await armDeltaPolicy(f.db, actor, snapshot), activated);
  const deadline = (await worker.state()).next_delta_at as Date;
  const beforeDeadline = t.mock.method(Date, 'now', () => deadline.getTime() - 1);
  try {
    await worker.tick();
  } finally {
    beforeDeadline.mock.restore();
  }
  assert.equal(f.requests.length, beforePoll + 1, 'No extra poll before the next deadline');
  await worker.close();
  worker = await f.start();

  f.feed.changes = [change(15, '102', 'relisted', latestAt)];
  f.details.set('102', { price: 68000, at: latestAt });
  await f.db.pool.query("UPDATE external_full_sync SET next_snapshot_at=clock_timestamp()-interval '1 day' WHERE id=1");
  await f.duePoll();
  await worker.tick();
  assert.equal(f.requests[beforePoll + 1]?.cursor, '14');
  assert.equal((await f.sync()).receive_cursor, '15');
  assert.equal((await f.sync()).next_slot, true);
  assert.equal((await f.policy())?.high_water, '13');
  assert.deepEqual(await f.published('102'), { price: 68000 });

  const counts = await f.sync();
  // Model resuming a page after staging it but before persisting its receipt.
  await f.db.pool.query('UPDATE external_full_sync SET receive_cursor=14 WHERE id=1');
  await worker.receiveDelta();
  assert.equal(await worker.applyEvents(), 0);
  assert.deepEqual(await f.sync(), counts);
  assert.ok((await f.published('201'))?.price);
  await f.db.pool.query("UPDATE external_full_members SET photo_expires_at=NULL,last_accessed_at=NULL WHERE external_id='201'");
  await worker.rotate();
  assert.equal((await f.db.pool.query("SELECT 1 FROM external_full_work WHERE source='che168' AND external_id='201'")).rowCount, 0);
  assert.equal(f.exportCalls(), 0);
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM external_full_snapshots')).rows[0]!.n, 1);
});

test('a physical hole below the CSV apply cursor prevents activating delta-only', async t => {
  const f = await fixture(t);
  let worker = await f.start();
  await f.ingest(worker, [change(1, '301', 'new', baseAt)]);
  assert.equal(await worker.applyEvents(), 1);
  assert.equal(await worker.details(), 1);
  const snapshot = await f.seedSnapshot([[1, '301'], [3, '303']], 3);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshot);
  worker = await f.start();
  assert.equal(await f.ingest(worker, [change(2, '309', 'removed')], true), true);
  await worker.promoteSnapshot(snapshot);
  assert.deepEqual(await f.snapshot(snapshot), { state: 'complete', apply_cursor: '3' });
  assert.equal((await f.sync()).receive_cursor, '2');
  assert.equal((await f.policy())?.high_water, null, 'A nonterminal page cannot establish the cutover frontier');
  assert.equal(await f.ingest(worker, []), false);
  await worker.tick();
  await worker.tick();
  const blocked = await f.policy();
  assert.equal(blocked?.phase, 'blocked');
  assert.equal(blocked?.reason, 'audit_gap');
  assert.equal(blocked?.audit_cursor, '3');
  assert.equal(blocked?.audit_missing, '1');
  assert.equal(blocked?.high_water, '2');
  await assert.rejects(armDeltaPolicy(f.db, actor, snapshot), /SYNC_DELTA_NOT_READY/);
  assert.equal(f.exportCalls(), 0);
});

test('a pre-export price event blocks cutover when its CSV replacement advances only the timestamp', async t => {
  const f = await fixture(t);
  let worker = await f.start();
  await f.ingest(worker, [change(1, '601', 'new', baseAt), change(2, '602', 'new', baseAt)]);
  assert.equal(await worker.applyEvents(), 2);
  assert.equal(await worker.details(), 2);
  const snapshot = await f.seedSnapshot([[1, '601'], [2, '602']]);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshot);
  worker = await f.start();

  const priceAt = '2024-10-03T00:01:00.000Z';
  await f.ingest(worker, [change(3, '602', 'price', priceAt)]);
  await f.db.pool.query("UPDATE external_full_events SET received_at='2024-10-03T00:02:00.000Z' WHERE event_id=3");
  assert.equal(await worker.applyEvents(), 1);
  assert.deepEqual(await f.event(3), { applied: true, public_outcome: 'pending' });
  assert.equal(await worker.promoteSnapshot(snapshot), 1);
  assert.deepEqual(await f.snapshot(snapshot), { state: 'complete', apply_cursor: '2' });
  assert.deepEqual(await f.event(3), { applied: true, public_outcome: 'superseded' });
  f.details.set('602', { price: 70000, at: priceAt });

  await worker.tick();
  await worker.tick();
  const blocked = await f.policy();
  assert.equal(blocked?.audit_cursor, '2');
  assert.equal(blocked?.audit_missing, '0');
  assert.equal(blocked?.high_water, '3');
  assert.equal(blocked?.phase, 'blocked');
  assert.equal(blocked?.reason, 'audit_gap');
  assert.deepEqual(await f.published('602'), { price: 70000 });
  const materialized = (await f.db.pool.query(`SELECT l.source_updated_at,e.business_at,
    e.received_at<s.generated_at AS received_before_csv,e.prior_public_price::int,
    m.applied_generation=m.desired_generation AS generation_complete
    FROM external_listings l JOIN external_full_members m ON m.source=l.platform_id AND m.external_id=l.external_id
    JOIN external_full_events e ON e.source=m.source AND e.external_id=m.external_id AND e.event_id=3
    CROSS JOIN external_full_snapshots s
    WHERE l.provider='chinacarapi' AND l.platform_id='che168' AND l.external_id='602' AND s.id=$1`, [snapshot])).rows[0]!;
  assert.deepEqual(materialized, {
    source_updated_at: new Date(priceAt), business_at: new Date(priceAt), received_before_csv: true,
    prior_public_price: 70000, generation_complete: true,
  });
  await assert.rejects(armDeltaPolicy(f.db, actor, snapshot), /SYNC_DELTA_NOT_READY/);
});

test('an expired cursor is recorded without discarding the active CSV or its already-received withdrawal', async t => {
  const f = await fixture(t);
  let worker = await f.start();
  await f.ingest(worker, [change(1, '401', 'new', baseAt)]);
  assert.equal(await worker.applyEvents(), 1);
  assert.equal(await worker.details(), 1);
  const snapshot = await f.seedSnapshot([[1, '401'], [2, '402']]);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshot);
  worker = await f.start();
  await f.ingest(worker, [change(2, '401', 'removed')]);
  f.feed.expired = true;
  assert.equal(await worker.receiveDelta(), false);
  assert.deepEqual(await f.snapshot(snapshot), { state: 'applying', apply_cursor: '1' });
  assert.equal((await f.sync()).receive_cursor, '2');
  assert.equal((await f.policy())?.cursor_invalid, true);
  assert.equal((await f.policy())?.reason, 'cursor_expired');
  const received = f.requests.length;
  assert.equal(await worker.receiveDelta(), false);
  assert.equal(f.requests.length, received, 'An invalid cursor is not sent repeatedly');
  assert.equal(await worker.applyEvents(true), 1);
  assert.deepEqual(await f.event(2), { applied: true, public_outcome: 'effective' });
  assert.equal(await f.published('401'), undefined);
  await assert.rejects(requestDeltaReconciliation(f.db, actor, 'confirmed-gap-1', archiveAt, '2'), /SYNC_DELTA_STATE_CONFLICT/);
  await worker.tick();
  await worker.tick();
  await worker.tick();
  assert.deepEqual(await f.snapshot(snapshot), { state: 'complete', apply_cursor: '2' });
  assert.equal((await f.policy())?.phase, 'blocked');
  assert.equal((await f.policy())?.high_water, null);
  assert.equal((await f.sync()).receive_cursor, '2');
  assert.equal(f.exportCalls(), 0);
});

async function activateForReconciliation(
  f: Awaited<ReturnType<typeof fixture>>,
  alreadyReceived = change(20, '598', 'removed'),
) {
  let worker = await f.start();
  await f.ingest(worker, [change(1, '501', 'new', baseAt)]);
  assert.equal(await worker.applyEvents(), 1);
  assert.equal(await worker.details(), 1);
  const snapshot = await f.seedSnapshot([[1, '501'], [2, '502']]);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshot);
  worker = await f.start();
  await f.ingest(worker, [change(10, '599', 'removed')]);
  if (alreadyReceived.type === 'price') {
    f.details.set(alreadyReceived.vehicleId, { price: 68000, at: alreadyReceived.at });
  }
  await f.ingest(worker, [alreadyReceived]);
  await worker.tick();
  await worker.tick();
  await worker.tick();
  assert.equal((await armDeltaPolicy(f.db, actor, snapshot)).phase, 'delta');
  return { worker, snapshot, alreadyReceived };
}

function supplyReplacementCsv(f: Awaited<ReturnType<typeof fixture>>, identities: string[], generatedAt: string) {
  const records = identities.map(id => {
    const row: Record<string, string> = {
      source: 'che168', id, make: 'Example', model: 'Model', make_zh: '示例', model_zh: '测试车型',
      model_year: '2024', price_cny: '70000', has_report: 'false', url: `https://www.che168.com/dealer/1/${id}.html`,
    };
    f.details.set(id, { price: 70000, at: generatedAt });
    return catalogColumns.map(column => row[column] ?? '').join(',');
  });
  const csv = Buffer.from([catalogColumns.join(','), ...records, ''].join('\n'));
  f.exportControl.probeAt = generatedAt;
  f.exportControl.csv = csv;
  return csv;
}

test('reconciliation fences stale receive failures and verifies overlap before probing an export', async t => {
  const f = await fixture(t);
  const { worker, alreadyReceived } = await activateForReconciliation(f);
  const requested = latch();
  const releaseRequest = latch();
  f.feed.beforeChange = async () => {
    requested.open();
    await releaseRequest.wait;
    throw new FullSyncError('SYNC_CURSOR_EXPIRED');
  };
  const oldRequest = worker.receiveDelta();
  await requested.wait;
  try {
    const queued = await requestDeltaReconciliation(f.db, actor, 'gap-while-receiving', archiveAt, '10');
    assert.equal(queued.phase, 'recovery');
  } finally {
    releaseRequest.open();
  }
  assert.equal(await oldRequest, false);
  f.feed.beforeChange = undefined;
  const queued = await f.policy();
  assert.equal(queued?.phase, 'recovery');
  assert.equal(queued?.evidence, 'gap-while-receiving');
  assert.equal(queued?.recovery_pending_receive, true);
  assert.equal(queued?.cursor_invalid, false);
  assert.equal((await f.sync()).receive_cursor, '20');

  f.feed.sincePageCursor = 15;
  await f.ingest(worker, [change(16, '597', 'removed')]);
  assert.deepEqual(f.requests.at(-1), { since: archiveAt, cursor: null });
  const insufficientOverlap = await f.policy();
  assert.equal(insufficientOverlap?.phase, 'blocked');
  assert.equal(insufficientOverlap?.cursor_invalid, false);
  assert.equal(insufficientOverlap?.reason, 'confirmed_gap');
  assert.equal((await f.sync()).receive_cursor, '20');
  assert.equal((await f.sync()).received_events, '3', 'Reject an unproved overlap before staging its contents');
  assert.equal(f.exportCalls(), 0);

  await requestDeltaReconciliation(f.db, actor, 'gap-with-proven-overlap', archiveAt, '10');
  f.feed.sincePageCursor = 10;
  assert.equal(await f.ingest(worker, [change(12, '596', 'removed')], true), true);
  assert.deepEqual(f.requests.at(-1), { since: archiveAt, cursor: null });
  assert.equal((await f.sync()).receive_cursor, '12');
  assert.equal((await f.policy())?.recovery_previous_cursor, '20');
  assert.equal((await f.policy())?.recovery_pending_receive, false);
  assert.equal((await worker.state()).since_at.toISOString(), archiveAt);
  await worker.snapshot();
  assert.equal(f.exportCalls(), 0, 'Do not probe before reaching the previous durable cursor');

  await f.ingest(worker, [alreadyReceived]);
  assert.deepEqual(f.requests.at(-1), { since: archiveAt, cursor: '12' });
  assert.equal((await f.sync()).receive_cursor, '20');
  assert.equal((await f.sync()).received_events, '4', 'A repeated event keeps its original durable row');
  f.exportControl.probeAt = archiveAt; // Supplier has not generated a newer export yet.
  await worker.snapshot();
  await worker.snapshot();
  assert.equal(f.exportCalls(), 1, 'Repeated ticks respect the persisted time before the next probe');
  assert.equal((await f.policy())?.recovery_attempts, 1);
  assert.equal((await f.policy())?.phase, 'recovery');
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM external_full_snapshots')).rows[0]!.n, 1);
});

test('confirmed reconciliation verifies one new CSV and keeps the old stage until reactivation', async t => {
  const f = await fixture(t);
  const { worker, snapshot: previous, alreadyReceived } = await activateForReconciliation(f);
  await requestDeltaReconciliation(f.db, actor, 'confirmed-gap-recovery', archiveAt, '10');
  await f.db.pool.query("UPDATE external_full_snapshots SET created_at=clock_timestamp()-interval '8 days' WHERE id=$1", [previous]);
  const stageCount = async (id: string) =>
    (await f.db.pool.query('SELECT count(*)::int AS n FROM external_full_stage WHERE snapshot_id=$1', [id])).rows[0]!.n;
  await worker.pruneStaging();
  assert.equal(await stageCount(previous), 2);

  f.feed.sincePageCursor = 10;
  await f.ingest(worker, [change(12, '596', 'removed'), alreadyReceived]);
  assert.deepEqual(f.requests.at(-1), { since: archiveAt, cursor: null });
  assert.equal((await f.sync()).receive_cursor, '20');
  assert.equal((await f.sync()).received_events, '4');
  assert.equal((await f.policy())?.recovery_pending_receive, false);

  const csv = supplyReplacementCsv(f, ['501', '503'], laterAt);
  await worker.snapshot();
  const imported = (await f.policy())?.snapshot_id;
  assert.ok(imported && imported !== previous);
  assert.deepEqual(await f.snapshot(imported), { state: 'complete', apply_cursor: '2' });
  assert.equal(f.exportCalls(), 2, 'One export probe and one download');
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM external_full_snapshots')).rows[0]!.n, 2);
  const verified = (await f.db.pool.query('SELECT sha256,path,source_counts FROM external_full_snapshots WHERE id=$1', [imported])).rows[0]!;
  assert.equal(verified.sha256, createHash('sha256').update(csv).digest('hex'));
  assert.deepEqual(verified.source_counts, { che168: 2, dongchedi: 0 });
  assert.deepEqual(gunzipSync(await readFile(verified.path)), csv);
  assert.equal(await stageCount(imported), 2);

  await worker.tick();
  await worker.tick();
  const ready = await f.policy();
  assert.equal(ready?.phase, 'ready');
  assert.equal(ready?.retained_snapshot_id, previous);
  assert.equal(ready?.high_water, '20');
  assert.equal(ready?.audit_missing, '0');
  assert.deepEqual(await f.published('503'), { price: 70000 });
  await worker.pruneStaging();
  assert.equal(await stageCount(previous), 2);

  const activated = await armDeltaPolicy(f.db, actor, imported);
  assert.equal(activated.phase, 'delta');
  assert.equal(activated.retained_snapshot_id, imported);
  f.feed.changes = [change(21, '503', 'removed', latestAt)];
  await f.duePoll();
  await worker.tick();
  assert.deepEqual(f.requests.at(-1), { since: archiveAt, cursor: '20' });
  assert.equal((await f.sync()).receive_cursor, '21');
  assert.equal((await f.sync()).next_slot, true);
  assert.equal((await f.policy())?.high_water, '20');
  assert.equal(await f.published('503'), undefined);
  assert.equal(await stageCount(imported), 2);
  assert.equal(f.exportCalls(), 2);
});

test('a recovered withdrawal superseded by a price needs affirmative evidence before cutover', async t => {
  const f = await fixture(t);
  const newerPrice = change(20, '501', 'price', laterAt);
  const { worker, snapshot: previous } = await activateForReconciliation(f, newerPrice);
  assert.deepEqual(await f.published('501'), { price: 68000 });
  assert.deepEqual(await f.event(20), { applied: true, public_outcome: 'effective' });

  await requestDeltaReconciliation(f.db, actor, 'known-withdrawal-gap', archiveAt, '10');
  f.feed.sincePageCursor = 10;
  await f.ingest(worker, [change(12, '501', 'removed'), newerPrice]);
  assert.equal((await f.sync()).receive_cursor, '20');
  supplyReplacementCsv(f, ['502', '503'], latestAt);
  await worker.snapshot();
  const replacement = (await f.policy())?.snapshot_id;
  assert.ok(replacement && replacement !== previous);
  assert.deepEqual(await f.event(12), { applied: true, public_outcome: 'superseded' });
  await worker.tick();
  await worker.tick();

  const policy = await f.policy();
  assert.equal(policy?.phase, 'blocked');
  assert.equal(policy?.reason, 'audit_gap');
  assert.equal(policy?.audit_missing, '0');
  assert.equal(policy?.audit_cursor, '2');
  assert.equal(policy?.high_water, '20');
  assert.equal(policy?.retained_snapshot_id, previous);
  assert.deepEqual(await f.published('501'), { price: 68000 });
  await assert.rejects(armDeltaPolicy(f.db, actor, replacement), /SYNC_DELTA_NOT_READY/);
  assert.equal(f.exportCalls(), 2);
});

test('a bounded same-source detail turn unblocks the current CSV census without widening provider work', async t => {
  const f = await fixture(t);
  const snapshot = randomUUID();
  const pickedCsv = (ordinal: number) => String(610000 + ordinal);
  const blockers = [2001, 2002, 2003, 2004, 2008].map(pickedCsv);
  const otherSource = pickedCsv(2005), tombstone = pickedCsv(2006), below = pickedCsv(2000), above = pickedCsv(4001);
  const pendingOrdinals = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2008, 4001];
  const older = Array.from({ length: 504 }, (_, i) => String(710001 + i));
  const fullyArchived = 485;
  const baseline = older.slice(fullyArchived, 500);
  const edited = [...blockers.slice(0, 4), ...baseline.slice(0, -4)];
  const localeOrder = ['zh', 'en', 'ru'] as const;
  await f.db.transaction(async tx => {
    await tx.query(`INSERT INTO external_full_snapshots
      (id,generated_at,state,path,sha256,bytes,rows,staged,apply_cursor,completed_at)
      VALUES($1,$2,'complete',$3,repeat('a',64),1024,4001,4001,4001,clock_timestamp())`,
    [snapshot, archiveAt, `/private/delta-fixture/${snapshot}.csv.gz`]);
    await tx.query(`INSERT INTO external_full_stage(snapshot_id,row_number,source,external_id,payload)
      SELECT $1,n,CASE WHEN n=2005 THEN 'dongchedi' ELSE 'che168' END,(610000+n)::text,'{}'
      FROM generate_series(1,4001) n`, [snapshot]);
    await tx.query(`INSERT INTO external_full_members
      (source,external_id,canonical_id,state,applied_generation,last_snapshot,last_detail_at,sampled)
      SELECT source,external_id,'audit:'||external_id,CASE WHEN row_number=ANY($2::int[]) THEN 'pending' ELSE 'active' END,
        CASE WHEN row_number=ANY($2::int[]) THEN 0 ELSE 1 END,$1,
        CASE WHEN row_number=ANY($2::int[]) THEN NULL ELSE clock_timestamp() END,true
      FROM external_full_stage WHERE snapshot_id=$1`, [snapshot, pendingOrdinals]);
    await tx.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,queued_at)
      SELECT source,external_id,'detail',1,50,
        $3::timestamptz+CASE WHEN source='dongchedi' THEN interval '1 minute' ELSE interval '0' END
      FROM external_full_stage WHERE snapshot_id=$1 AND row_number=ANY($2::int[])`, [snapshot, pendingOrdinals, archiveAt]);
    await tx.query(`INSERT INTO external_ingestion_identity_state
      (provider,source,external_id,withdrawn,observed_at,business_at)
      VALUES('chinacarapi','che168',$1,true,$2,$2)`, [tombstone, changedAt]);
    await tx.query(`INSERT INTO external_full_members
      (source,external_id,canonical_id,state,applied_generation,last_detail_at,sampled)
      SELECT 'che168',id,'older:'||id,'active',1,clock_timestamp(),true FROM unnest($1::text[]) id`, [older]);
    await tx.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,queued_at,locales)
      SELECT 'che168',id,'detail',1,50,$2::timestamptz+n*interval '1 second',
        CASE WHEN n<=$3 THEN ARRAY['zh','en','ru'] ELSE '{}'::text[] END
      FROM unnest($1::text[]) WITH ORDINALITY AS u(id,n)`, [older, baseAt, fullyArchived]);
    // Archive real, per-identity references set-wise to model the already fetched 485 jobs.
    const documents = older.slice(0, fullyArchived).flatMap(external_id => {
      const payload = { id: external_id, source: 'che168', status: 'active', updatedAt: baseAt, hasInspectionReport: false };
      return localeOrder.map(locale => ({ id: randomUUID(), external_id, locale, hash: jsonHash(payload), payload }));
    });
    const serialized = JSON.stringify(documents);
    await tx.query(`INSERT INTO external_source_blobs(hash,payload)
      SELECT DISTINCT hash,payload FROM jsonb_to_recordset($1) AS d(hash text,payload jsonb)`, [serialized]);
    await tx.query(`WITH saved AS (
      INSERT INTO external_source_documents
        (id,provider,source,external_id,kind,locale,hash,presence,first_observed_at,last_observed_at,source_updated_at)
      SELECT id,'chinacarapi','che168',external_id,'detail',locale,hash,'{}',$2,$2,$2
      FROM jsonb_to_recordset($1) AS d(id uuid,external_id text,locale text,hash text)
      RETURNING id,external_id,locale
    ), protected AS (
      INSERT INTO external_source_document_refs(document_id,kind,reference)
      SELECT id,'pending','full:che168:'||external_id||':detail' FROM saved RETURNING document_id
    ), grouped AS (
      SELECT external_id,jsonb_agg(jsonb_build_object('id',id,'observedAt',$2::timestamptz,
        'sourceUpdatedAt',$2::timestamptz) ORDER BY locale) AS refs
      FROM saved JOIN protected ON document_id=id GROUP BY external_id
    ) UPDATE external_full_work w SET document_refs=g.refs FROM grouped g
      WHERE w.source='che168' AND w.kind='detail' AND w.external_id=g.external_id`, [serialized, baseAt]);
    await tx.query("UPDATE external_full_sync SET last_capacity_sample=10000,next_delta_at='infinity' WHERE id=1");
  });
  const admitted = (await f.db.pool.query(`SELECT count(*)::int AS count FROM external_full_stage s
    JOIN external_formal_admissions a USING(source,external_id) WHERE s.snapshot_id=$1`, [snapshot])).rows[0]!;
  assert.equal(admitted.count, 4001);
  await prepareDeltaPolicy(f.db, actor, snapshot);
  await f.db.pool.query('UPDATE external_full_delta_policy SET audit_cursor=2000,high_water=0 WHERE id=1');

  const calls: Array<{ source: string; locale: string; ids: string[] }> = [];
  const quota: Array<{ source: Source; ids: number }> = [];
  const failures: Array<'timeout' | 413 | 429> = [];
  const client = new FullSyncClient('delta-census-fixture', {
    wait: async () => {},
    beforeBulk: async (ids, source) => { quota.push({ source, ids }); },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/vehicle/bulk');
      const source = url.searchParams.get('source')!;
      const locale = url.searchParams.get('lang') ?? 'en';
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      calls.push({ source, locale, ids });
      const failure = failures.shift();
      if (failure === 'timeout') throw new DOMException('Synthetic provider timeout', 'TimeoutError');
      if (failure) return new Response(null, { status: failure });
      return Response.json({ results: ids.map(id => ({ source, id, status: 'active', hasInspectionReport: false, updatedAt: changedAt })),
        notFound: [] });
    },
  });
  const applied: string[] = [];
  let monotonicMs = 0;
  t.mock.method(performance, 'now', () => monotonicMs);
  const worker = await f.start(client, async (_tx, input) => {
    applied.push(input.externalId);
    if (applied.length === 5) monotonicMs += 5000;
  });
  const setNextTurn = (turn: number) => f.db.pool.query('UPDATE external_full_sync SET detail_turn=$1 WHERE id=1', [turn - 1]);
  const request = (source: Source, ids: string[], locale: Locale = 'zh') => ({ source, locale, ids });
  const refusedTurn = async (turn: number, expected: ReturnType<typeof request>, sampleOnly = false) => {
    await setNextTurn(turn);
    calls.length = 0;
    failures.push(429);
    await assert.rejects(worker.details(sampleOnly), { code: 'SYNC_RATE_LIMITED' });
    assert.deepEqual(calls, [expected]);
  };
  await refusedTurn(4, request('che168', baseline));
  await refusedTurn(8, request('che168', baseline), true);
  const additionalMissing = older.slice(0, 11);
  await f.db.pool.query("UPDATE external_full_work SET locales='{}' WHERE source='che168' AND external_id=ANY($1::text[])", [additionalMissing]);
  await refusedTurn(8, request('che168', [...additionalMissing, ...baseline]));
  await f.db.pool.query("UPDATE external_full_work SET locales=ARRAY['zh','en','ru'] WHERE source='che168' AND external_id=ANY($1::text[])",
    [additionalMissing]);
  await f.db.pool.query("UPDATE external_full_work SET priority=100 WHERE source='dongchedi' AND external_id=$1", [otherSource]);
  await refusedTurn(8, request('che168', baseline));
  await refusedTurn(9, request('dongchedi', [otherSource]));
  await f.db.pool.query("UPDATE external_full_work SET priority=50 WHERE source='dongchedi' AND external_id=$1", [otherSource]);
  await refusedTurn(8, request('che168', edited));

  const queue = async () => (await f.db.pool.query(`SELECT source,external_id,attempts,locales,document_refs,due_at,last_error_code
    FROM external_full_work WHERE kind='detail' ORDER BY source,external_id`)).rows;
  const before = await queue();
  for (const failure of ['timeout', 413] as const) {
    await setNextTurn(8);
    calls.length = 0;
    quota.length = 0;
    failures.push(failure);
    await assert.rejects(worker.details(), { code: failure === 'timeout' ? 'SYNC_TIMEOUT' : 'SYNC_TOO_LARGE' });
    assert.deepEqual(calls, [request('che168', edited)], 'Do not split a substituted batch');
    assert.deepEqual(quota, [{ source: 'che168', ids: baseline.length }]);
    assert.deepEqual(await queue(), before, 'A failed substituted batch must not charge or reschedule any job');
    calls.length = 0;
    failures.push(413, 429);
    await assert.rejects(worker.details(), { code: 'SYNC_RATE_LIMITED' });
    assert.deepEqual(calls, [request('che168', baseline), request('che168', baseline.slice(0, Math.ceil(baseline.length / 2)))],
      'The next ordinary turn keeps source selection, original IDs and ordinary split behavior');
    assert.deepEqual(await queue(), before);
  }

  await setNextTurn(8);
  calls.length = 0;
  quota.length = 0;
  await worker.tick();
  assert.deepEqual(calls, localeOrder.map(locale => request('che168', edited, locale)));
  assert.deepEqual(quota, localeOrder.map(() => ({ source: 'che168', ids: baseline.length })));
  assert.deepEqual(applied, [older[0], ...blockers.slice(0, 4)], 'The oldest job and four audit blockers commit before the 5s budget ends');
  assert.equal((await f.policy())?.audit_cursor, '2000', 'The fifth blocker and other source remain pending');
  const oldAndUnrelated = [...older, below, tombstone];
  await f.db.pool.query("UPDATE external_full_work SET due_at=clock_timestamp()+interval '1 day' WHERE source='che168' AND external_id=ANY($1::text[])",
    [oldAndUnrelated]);
  await worker.tick();
  assert.equal((await f.policy())?.audit_cursor, '2000');
  await worker.tick();
  assert.equal((await f.policy())?.audit_cursor, '4000');
  assert.equal((await f.policy())?.audit_missing, '0');
  assert.ok(applied.includes(blockers[4]!) && applied.includes(otherSource));
});
