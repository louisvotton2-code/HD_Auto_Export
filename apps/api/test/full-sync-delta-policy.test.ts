import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { FullSyncClient } from '../src/external/full-sync/client.js';
import { armDeltaPolicy, prepareDeltaPolicy, readDeltaPolicy, requestDeltaReconciliation, resumeDeltaAudit } from '../src/external/full-sync/delta-policy.js';
import { configureFullSync, FullSyncWorker } from '../src/external/full-sync/engine.js';
import { FullSyncError, type Change, type FullApply, type Locale, type Source } from '../src/external/full-sync/types.js';
import { canonicalJson, jsonHash } from '../src/external/normalize.js';
import { decodeSourceBlob } from '../src/external/sources/archive.js';
import { catalogColumns, loadSourceDocumentRefs } from '../src/external/sources/index.js';

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

async function fixture(t: TestContext, platform: Source = 'che168') {
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
          id, source, status: 'active', updatedAt: detail.at,
          url: source === 'che168' ? `https://www.che168.com/dealer/1/${id}.html` : `https://www.dongchedi.com/usedcar/${id}`,
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
        VALUES($1,$2,$4,$3,
          jsonb_build_object('source',$4::text,'id',$3::text,'has_report','false'))`,
      [id, ordinal, identity, platform]);
    }
    await db.pool.query("UPDATE external_full_members SET last_snapshot=$1 WHERE source=$3 AND external_id=$2", [id, rows[0]![1], platform]);
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
      JOIN external_catalog c ON c.listing_id=l.id WHERE l.provider='chinacarapi' AND l.platform_id=$2 AND l.external_id=$1`, [id, platform])).rows[0];
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

async function historicalPriceAudit(t: TestContext, publicPrice: number) {
  const f = await fixture(t);
  const priceAt = '2024-10-03T00:01:00.000Z';
  const vehicleId = '702';
  const priceEvent = {
    ...change(2001, vehicleId, 'price', priceAt),
    oldPrice: { cny: 70000 }, newPrice: { cny: 68000 },
  };
  let worker = await f.start();
  f.details.set(vehicleId, { price: publicPrice, at: priceAt });
  await f.ingest(worker, [change(1, '701', 'new', baseAt), change(2, vehicleId, 'new', baseAt)]);
  assert.equal(await worker.applyEvents(), 2);
  assert.equal(await worker.details(), 2);
  assert.deepEqual(await f.published(vehicleId), { price: publicPrice });
  const snapshotId = await f.seedSnapshot([[1, '701'], [2, vehicleId]]);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshotId);
  worker = await f.start();
  // Model an already retained event history ahead of the two live fixture events.
  // Both audit cursors are written only by the real worker.
  await f.db.pool.query(`INSERT INTO external_full_events
    (event_id,payload_hash,source,external_id,operation,business_at,document_refs,applied_at,source_type,public_outcome)
    SELECT n,repeat('a',64),'che168',(800000+n)::text,'withdraw',$1,'[]',$1,'removed','not_public'
    FROM generate_series(3,2000) n`, [baseAt]);
  await f.ingest(worker, [priceEvent]);
  assert.equal(await worker.applyEvents(), 1);
  assert.deepEqual(await f.event(priceEvent.id), { applied: true, public_outcome: 'pending' });
  assert.equal(await worker.details(), 1);
  assert.deepEqual(await f.event(priceEvent.id), { applied: true, public_outcome: 'not_public' });
  assert.equal(await worker.promoteSnapshot(snapshotId), 1);
  await worker.tick();
  await worker.tick();
  assert.equal((await f.policy())?.phase, 'draining');
  assert.equal((await f.policy())?.audit_missing, '0');
  assert.equal((await f.policy())?.event_audit_cursor, '2000');
  assert.equal((await f.policy())?.high_water, '2001');

  const observation = async () => (await f.db.pool.query(`SELECT e.payload_hash,e.prior_public_price::int,e.was_public,
    e.public_outcome,e.applied_at,e.detail_updated_at,e.public_effective_at,
    l.source_updated_at,(l.source_data#>>'{price,cny}')::numeric::int AS supplier_price,c.price_cny::int AS public_price,
    m.applied_generation=m.desired_generation AS generation_complete
    FROM external_full_events e
    JOIN external_full_members m ON m.source=e.source AND m.external_id=e.external_id
    JOIN external_listings l ON l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
    JOIN external_catalog c ON c.listing_id=l.id WHERE e.event_id=$1`, [priceEvent.id])).rows[0]!;
  const receipt = (await f.db.pool.query(`SELECT next_cursor::text,event_count,complete
    FROM external_full_receipts WHERE cursor_key='cursor:2'`)).rows[0]!;
  assert.deepEqual(receipt, { next_cursor: '2001', event_count: 1, complete: true });
  const expectedPage = { cursor: 2, nextCursor: 2001, hasMore: false, changes: [priceEvent] };
  const documentId = await f.db.transaction(async tx => {
    const event = (await tx.query('SELECT document_refs FROM external_full_events WHERE event_id=$1', [priceEvent.id])).rows[0]!;
    const [document] = await loadSourceDocumentRefs(tx, event.document_refs);
    assert.ok(document);
    assert.deepEqual(document.identity, { provider: 'chinacarapi', source: 'che168', externalId: vehicleId });
    assert.equal(document.kind, 'event');
    assert.equal(document.eventSequence, '2001');
    assert.deepEqual(document.payload, priceEvent);
    const expectedHash = raw(expectedPage).hash;
    assert.equal(document.rawResponse?.hash, expectedHash);
    const response = (await tx.query('SELECT hash,payload,raw_text,compressed,raw_exact FROM external_source_blobs WHERE hash=$1',
      [expectedHash])).rows[0]!;
    assert.deepEqual(decodeSourceBlob(response).payload, expectedPage);
    return event.document_refs[0].id as string;
  });
  const original = await observation();
  assert.equal(original.payload_hash, jsonHash(priceEvent));
  assert.equal(original.prior_public_price, publicPrice);
  assert.equal(original.public_price, publicPrice);
  assert.equal(original.supplier_price, publicPrice);
  assert.equal(original.was_public, true);
  assert.deepEqual(original.source_updated_at, new Date(priceAt));
  assert.equal(original.generation_complete, true);
  assert.equal(original.public_outcome, 'not_public');
  assert.equal(original.public_effective_at, null);

  const state = async () => (await f.db.pool.query(`SELECT s.id,s.sha256,s.rows::text,s.apply_cursor::text,s.completed_at,
    w.receive_cursor::text,w.since_at,p.high_water::text,p.audit_cursor::text
    FROM external_full_snapshots s JOIN external_full_delta_policy p ON p.snapshot_id=s.id
    JOIN external_full_sync w ON w.id=p.id WHERE s.id=$1`, [snapshotId])).rows[0]!;
  const baseline = await state();
  const resumeRequest = {
    snapshotId, snapshotSha256: baseline.sha256 as string, highWater: '2001',
    eventAuditCursor: '2000', evidence: 'fixture-confirmed-price-archive',
  };
  return { f, worker, snapshotId, documentId, observation, original, state, baseline, resumeRequest };
}

test('historical price audit accepts an archived requested price already materialized at receipt', async t => {
  const h = await historicalPriceAudit(t, 68000);
  await h.worker.tick();
  const proof = await h.f.policy();
  assert.equal(proof?.phase, 'ready');
  assert.equal(proof?.event_audit_cursor, '2001');
  assert.deepEqual(await h.state(), h.baseline);
  assert.deepEqual(await h.observation(), h.original, 'Audit evidence must not rewrite historical timing');
});

test('historical price audit keeps a truly old public and supplier price blocked', async t => {
  const h = await historicalPriceAudit(t, 70000);
  await h.worker.tick();
  const proof = await h.f.policy();
  assert.equal(proof?.phase, 'blocked');
  assert.equal(proof?.reason, 'audit_gap');
  assert.equal(proof?.event_audit_cursor, '2000');
  await assert.rejects(armDeltaPolicy(h.f.db, actor, h.snapshotId), /SYNC_DELTA_NOT_READY/);
  const { resumeDeltaAudit } = await import('../src/external/full-sync/delta-policy.js');
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, h.resumeRequest), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
  assert.deepEqual(await h.f.policy(), proof);
  assert.deepEqual(await h.state(), h.baseline);
  assert.deepEqual(await h.observation(), h.original);
});

test('resuming needs archived price proof and rechecks the same frontier after a worker restart', async t => {
  const h = await historicalPriceAudit(t, 68000);
  // Simulate a missing event archive without altering the received event or its stored hash.
  const parked = await h.f.db.pool.query("UPDATE external_source_documents SET kind='csv' WHERE id=$1 AND kind='event'", [h.documentId]);
  assert.equal(parked.rowCount, 1);
  await h.worker.tick();
  const blocked = await h.f.policy();
  assert.equal(blocked?.phase, 'blocked');
  assert.equal(blocked?.reason, 'audit_gap');
  assert.equal(blocked?.event_audit_cursor, '2000');
  await h.worker.close();

  const { resumeDeltaAudit } = await import('../src/external/full-sync/delta-policy.js');
  const resume = h.resumeRequest;
  await h.f.db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('audit-editor','Fixture editor','audit-editor@example.invalid','editor',false)");
  await assert.rejects(resumeDeltaAudit(h.f.db, { id: 'audit-editor', requestId: 'deny-audit' }, resume), /SYNC_ADMIN_REQUIRED/);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...resume, eventAuditCursor: '1999' }), /SYNC_DELTA_STATE_CONFLICT/);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...resume, highWater: '2002' }), /SYNC_DELTA_STATE_CONFLICT/);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...resume, snapshotSha256: 'b'.repeat(64) }), /SYNC_DELTA_SNAPSHOT_MISMATCH/);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, resume), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
  assert.deepEqual(await h.f.policy(), blocked);
  const resumeAudit = async () => (await h.f.db.pool.query(`SELECT actor_id,changes FROM audit_events
    WHERE operation='external.sync.delta.resumeAudit'`)).rows;
  assert.deepEqual(await resumeAudit(), []);

  await h.f.db.pool.query("UPDATE external_source_documents SET kind='event' WHERE id=$1 AND kind='csv'", [h.documentId]);
  const archived = (await h.f.db.pool.query<{ hash: string; compressed: Buffer }>(`
    SELECT b.hash,b.compressed FROM external_source_documents d
    JOIN external_source_blobs b ON b.hash=d.hash WHERE d.id=$1`, [h.documentId])).rows[0]!;
  const originalPayload = JSON.parse(gunzipSync(archived.compressed).toString('utf8')) as Record<string, unknown>;
  const corrupt = gzipSync(canonicalJson({ ...originalPayload, oldPrice: { cny: 69000 } }));
  await h.f.db.pool.query('UPDATE external_source_blobs SET compressed=$2 WHERE hash=$1', [archived.hash, corrupt]);
  try {
    await assert.rejects(resumeDeltaAudit(h.f.db, actor, resume), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
    assert.deepEqual(await h.f.policy(), blocked);
    assert.deepEqual(await resumeAudit(), []);
  } finally {
    await h.f.db.pool.query('UPDATE external_source_blobs SET compressed=$2 WHERE hash=$1', [archived.hash, archived.compressed]);
  }
  const resumed = await resumeDeltaAudit(h.f.db, actor, resume);
  assert.equal(resumed.phase, 'draining');
  assert.equal(resumed.event_audit_cursor, '2000');
  assert.deepEqual(await h.state(), h.baseline);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, resume), /SYNC_DELTA_STATE_CONFLICT/);
  const audits = await resumeAudit();
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.actor_id, actor.id);
  const changes = Object.fromEntries((audits[0]!.changes as Array<{path: string; after: unknown}>).map(item => [item.path, item.after]));
  assert.equal(changes['sync.delta.resumeEvidence'], resume.evidence);
  assert.deepEqual(changes['sync.delta.resumeBoundary'], {
    snapshotId: resume.snapshotId, snapshotSha256: resume.snapshotSha256, highWater: resume.highWater,
    eventAuditCursor: '2000', checkedThrough: '2001',
  });

  const restarted = await h.f.start();
  await restarted.tick();
  const ready = await h.f.policy();
  assert.equal(ready?.phase, 'ready');
  assert.equal(ready?.event_audit_cursor, '2001');
  assert.deepEqual(await h.state(), h.baseline);
  assert.deepEqual(await h.observation(), h.original);
  assert.equal(h.f.exportCalls(), 0);
});

async function historicalRelistAudit(t: TestContext, count = 2, source: Source = 'che168') {
  const f = await fixture(t, source);
  const identities = Array.from({ length: count + 1 }, (_, index) => String(801 + index));
  const relisted = identities.slice(1);
  const rows = identities.map((id, index): [number, string] => [index + 1, id]);
  const applyPayload = (snapshotId: string, observedAt: string) => f.db.pool.query(`UPDATE external_full_stage
    SET payload=payload||jsonb_build_object('duplicate_of','','detail_fetched_at',$2::text,'price_cny','70000')
    WHERE snapshot_id=$1`, [snapshotId, observedAt]);

  let worker = await f.start();
  await f.ingest(worker, identities.map((id, index) => ({ ...change(index + 1, id, 'new', baseAt), source })));
  assert.equal(await worker.applyEvents(), identities.length);
  assert.equal(await worker.details(), identities.length);
  const earlierSnapshot = await f.seedSnapshot(rows);
  await applyPayload(earlierSnapshot, baseAt);
  assert.equal(await worker.promoteSnapshot(earlierSnapshot), count);
  assert.equal(await worker.details(), count);

  const removals = relisted.map((id, index) => ({ ...change(index + identities.length + 1, id, 'removed', changedAt), source }));
  await f.ingest(worker, removals);
  assert.equal(await worker.applyEvents(), count);
  for (const e of removals) {
    assert.equal(await f.published(e.vehicleId), undefined);
    assert.deepEqual(await f.event(e.id), { applied: true, public_outcome: 'effective' });
  }

  await f.db.pool.query(`INSERT INTO external_full_events
    (event_id,payload_hash,source,external_id,operation,business_at,document_refs,applied_at,source_type,public_outcome)
    SELECT n,repeat('a',64),'che168',(800000+n)::text,'withdraw',$1,'[]',$1,'removed','not_public'
    FROM generate_series($2::integer,2000) n`, [baseAt, 2 * count + 2]);
  const relistEvents = relisted.map((id, index) => ({
    ...change(2001 + index, id, 'relisted', laterAt), source,
    oldPrice: { cny: 70000 }, newPrice: { cny: 70000 },
  }));
  const highWater = String(relistEvents.at(-1)!.id);
  await f.ingest(worker, relistEvents);
  assert.equal(await worker.applyEvents(), count);
  assert.equal(await worker.details(), count);

  const observations = async () => (await f.db.pool.query<{
    event_id: string; external_id: string; applied_at: Date; detail_updated_at: Date;
    public_effective_at: Date | null; generation: string; generation_bound: boolean;
    source_updated_at: Date; evidence_locales: number; payload_hash: string;
  }>(`SELECT e.event_id::text,e.external_id,e.applied_at,e.detail_updated_at,e.public_effective_at,
    e.detail_generation::text AS generation,e.payload_hash,
    m.applied_generation=e.detail_generation AND m.desired_generation=e.detail_generation AND m.event_order=e.event_id
      AND m.business_at=e.business_at AND m.state='active' AND l.formal_primary AND l.upstream_state='active'
      AND f.active AND f.locale_mask=7 AS generation_bound,l.source_updated_at,
    (SELECT count(*)::integer FROM external_source_heads h
      WHERE h.provider=l.provider AND h.source=e.source AND h.external_id=e.external_id AND h.kind='detail'
        AND h.observed_at BETWEEN e.applied_at AND e.detail_updated_at) AS evidence_locales
    FROM external_full_events e JOIN external_full_members m ON (m.source,m.external_id)=(e.source,e.external_id)
    JOIN external_listings l ON l.provider='chinacarapi' AND (l.platform_id,l.external_id)=(e.source,e.external_id)
    JOIN external_catalog_filter f ON f.listing_id=l.id
    WHERE e.event_id BETWEEN 2001 AND $1 ORDER BY e.event_id`, [highWater])).rows;
  const original = await observations();
  assert.deepEqual(original.map(row => row.event_id), relistEvents.map(e => String(e.id)));
  for (const [index, row] of original.entries()) {
    assert.ok(row.generation_bound && row.detail_updated_at >= row.applied_at);
    assert.equal(row.evidence_locales, 3);
    assert.equal(row.public_effective_at, null);
    assert.deepEqual(row.source_updated_at, new Date(baseAt));
    assert.equal(row.payload_hash, jsonHash(relistEvents[index]));
    assert.deepEqual(await f.event(Number(row.event_id)), { applied: true, public_outcome: 'not_public' });
    assert.deepEqual(await f.published(row.external_id), { price: 70000 });
  }
  const csvAt = new Date(original.at(-1)!.detail_updated_at.getTime() + 2).toISOString();
  const generatedAt = new Date(Date.parse(csvAt) + 1).toISOString();
  const snapshotId = await f.seedSnapshot(rows);
  await applyPayload(snapshotId, csvAt);
  await f.db.pool.query('UPDATE external_full_snapshots SET generated_at=$2 WHERE id=$1', [snapshotId, generatedAt]);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshotId);
  worker = await f.start();
  await f.ingest(worker, []);
  assert.equal(await worker.promoteSnapshot(snapshotId), count);
  assert.deepEqual(await f.snapshot(snapshotId), { state: 'complete', apply_cursor: String(identities.length) });
  await worker.tick();
  await worker.tick();

  const before = await f.policy();
  assert.equal(before?.phase, 'draining');
  assert.equal(before?.audit_cursor, String(identities.length));
  assert.equal(before?.audit_missing, '0');
  assert.equal(before?.event_audit_cursor, '2000');
  assert.equal(before?.high_water, highWater);
  assert.deepEqual(await observations(), original);
  const resumeRequest = { snapshotId, snapshotSha256: 'a'.repeat(64), eventAuditCursor: '2000',
    highWater, evidence: 'fixture-confirmed-relist-archive' };
  const updateStage = (key: string, value: string) => f.db.pool.query(`UPDATE external_full_stage
    SET payload=payload||jsonb_build_object($2::text,$3::text)
    WHERE snapshot_id=$1 AND source='che168' AND external_id='803'`, [snapshotId, key, value]);
  return { f, worker, original, observations, resumeRequest, updateStage };
}

test('historical relists prove the exact materialized generation without rewriting source clocks', async t => {
  const h = await historicalRelistAudit(t, 15, 'dongchedi');
  await h.worker.tick();
  const first = await h.f.policy();
  assert.equal(first?.phase, 'draining');
  assert.equal(first?.event_audit_cursor, '2008');
  assert.equal(first?.high_water, '2015');
  assert.deepEqual(await h.observations(), h.original);
  await h.worker.tick();
  const proof = await h.f.policy();
  assert.equal(proof?.phase, 'ready');
  assert.equal(proof?.event_audit_cursor, '2015');
  assert.equal(proof?.high_water, '2015');
  assert.deepEqual(await h.observations(), h.original);
  assert.equal(h.f.exportCalls(), 0);
});

test('historical relist audit cannot resume with conflicting CSV, wrong identity, or superseded generation', async t => {
  const h = await historicalRelistAudit(t);
  await h.updateStage('price_cny', '69000');
  await h.worker.tick();
  const blocked = await h.f.policy();
  assert.equal(blocked?.phase, 'blocked');
  assert.equal(blocked?.reason, 'audit_gap');
  assert.equal(blocked?.event_audit_cursor, '2000');
  assert.equal(blocked?.high_water, '2002');
  await h.worker.close();
  const refused = async () => {
    await assert.rejects(resumeDeltaAudit(h.f.db, actor, h.resumeRequest), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
    assert.deepEqual(await h.f.policy(), blocked);
  };
  await refused();
  await h.updateStage('price_cny', '70000');
  await h.updateStage('duplicate_of', 'che168:802');
  await refused();
  await h.updateStage('duplicate_of', '');

  const heads = (await h.f.db.pool.query<{ document_id: string; observed_at: string }>(`SELECT document_id,observed_at::text
    FROM external_source_heads WHERE provider='chinacarapi' AND source='che168'
    AND external_id IN ('802','803') AND kind='detail' AND locale='ru' ORDER BY external_id`)).rows;
  assert.equal(heads.length, 2);
  const updateHead = (document: string, observedAt: string) => h.f.db.pool.query(`UPDATE external_source_heads
    SET document_id=$1,observed_at=$2
    WHERE provider='chinacarapi' AND source='che168' AND external_id='803' AND kind='detail' AND locale='ru'`, [document, observedAt]);
  await updateHead(heads[0]!.document_id, heads[1]!.observed_at);
  await refused();
  await updateHead(heads[1]!.document_id, baseAt);
  await refused();
  await updateHead(heads[1]!.document_id, heads[1]!.observed_at);

  const ref = (await h.f.db.pool.query<{ document_id: string; hash: string }>(`SELECT
    document_refs->0->>'id' AS document_id,document_refs->0->>'responseHash' AS hash
    FROM external_full_events WHERE event_id=2002`)).rows[0]!;
  const markPage = (rawExact: boolean) => h.f.db.pool.query('UPDATE external_source_blobs SET raw_exact=$2 WHERE hash=$1',
    [ref.hash, rawExact]);
  assert.equal((await markPage(false)).rowCount, 1);
  await refused();
  await markPage(true);
  const markEvent = (kind: string) => h.f.db.pool.query('UPDATE external_source_documents SET kind=$2 WHERE id=$1',
    [ref.document_id, kind]);
  assert.equal((await markEvent('csv')).rowCount, 1);
  await refused();
  await markEvent('event');

  const generation = h.original[1]!.generation;
  const updateGeneration = (next: string) => h.f.db.pool.query(`UPDATE external_full_members SET desired_generation=$1
    WHERE source='che168' AND external_id='803'`, [next]);
  await updateGeneration((BigInt(generation) + 1n).toString());
  await refused();
  await updateGeneration(generation);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...h.resumeRequest, eventAuditCursor: '1999' }), /SYNC_DELTA_STATE_CONFLICT/);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...h.resumeRequest, snapshotSha256: 'b'.repeat(64) }),
    /SYNC_DELTA_SNAPSHOT_MISMATCH/);
  assert.equal((await h.f.db.pool.query("SELECT 1 FROM audit_events WHERE operation='external.sync.delta.resumeAudit'")).rowCount, 0);

  const resumed = await resumeDeltaAudit(h.f.db, actor, h.resumeRequest);
  assert.equal(resumed.phase, 'draining');
  assert.equal(resumed.event_audit_cursor, '2000');
  assert.equal(resumed.high_water, '2002');
  assert.equal(resumed.snapshot_id, h.resumeRequest.snapshotId);
  const restarted = await h.f.start();
  await restarted.tick();
  assert.equal((await h.f.policy())?.event_audit_cursor, '2002');
  assert.equal((await h.f.policy())?.phase, 'ready');
  assert.deepEqual(await h.observations(), h.original);
  assert.equal(h.f.exportCalls(), 0);
});

test('historical relist audit yields to a later received withdrawal outside the fixed high water', async t => {
  const h = await historicalRelistAudit(t);
  await h.updateStage('price_cny', '69000');
  await h.worker.tick();
  assert.equal((await h.f.policy())?.phase, 'blocked');
  await h.updateStage('price_cny', '70000');
  await h.f.ingest(h.worker, [change(2003, '803', 'removed', latestAt)]);
  assert.equal((await h.f.sync()).receive_cursor, '2003');
  assert.equal((await h.f.event(2003)).applied, false);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, h.resumeRequest), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
  assert.equal((await h.f.policy())?.event_audit_cursor, '2000');
  assert.equal(await h.worker.applyEvents(true), 1);
  assert.deepEqual(await h.f.event(2003), { applied: true, public_outcome: 'effective' });
  assert.equal(await h.f.published('803'), undefined);

  const resumed = await resumeDeltaAudit(h.f.db, actor, h.resumeRequest);
  assert.equal(resumed.event_audit_cursor, '2000');
  assert.equal(resumed.high_water, '2002');
  await h.worker.tick();
  assert.equal((await h.f.policy())?.phase, 'ready');
  assert.equal((await h.f.policy())?.event_audit_cursor, '2002');
  assert.equal((await h.f.sync()).receive_cursor, '2003');
  assert.equal(await h.f.published('803'), undefined);
});

async function postSnapshotLifecycle(t: TestContext, standaloneRelists = false) {
  const source = 'dongchedi' as const;
  const f = await fixture(t, source);
  const changed = ['902', '903'];
  const relisted = standaloneRelists ? [...changed, '904', '905'] : changed;
  const ids = ['901', ...relisted];
  const staged = standaloneRelists ? ['901', '902', '904'] : ['901', '902'];
  const priceAt = '2024-10-03T00:01:00.000Z';
  const upstream = (eventId: number, id: string, kind: Change['type'], at: string) =>
    ({ ...change(eventId, id, kind, at), source });
  const ingestAndRetain = async (worker: FullSyncWorker, events: Change[]) => {
    await f.ingest(worker, events);
    // Keep independently retained audit evidence available through ordinary
    // archive cleanup after live work releases its own pending references.
    const { rows: [pinned] } = await f.db.pool.query<{ documents: number; blobs: number }>(`WITH originals AS MATERIALIZED (
      SELECT d.id,d.hash,d.response_hash
      FROM external_full_events e JOIN external_source_documents d ON d.id=(e.document_refs->0->>'id')::uuid
      WHERE e.event_id=ANY($1::numeric[]) AND d.event_sequence=e.event_id AND d.kind='event'
    ), document_pins AS (
      INSERT INTO external_source_document_refs(document_id,kind,reference)
      SELECT id,'audit','fixture-post-snapshot-lifecycle' FROM originals RETURNING document_id
    ), blob_pins AS (
      INSERT INTO external_source_blob_refs(hash,kind,reference)
      SELECT hash,'audit','fixture-post-snapshot-lifecycle'
      FROM (SELECT hash FROM originals UNION SELECT response_hash FROM originals) hashes RETURNING hash
    )
    SELECT (SELECT count(*)::int FROM document_pins) AS documents,(SELECT count(*)::int FROM blob_pins) AS blobs`,
    [events.map(event => event.id)]);
    assert.deepEqual(pinned, { documents: events.length, blobs: events.length + 1 });
  };
  const changeArchivedKind = async (doc: string, kind: 'csv' | 'event') => {
    const updated = await f.db.pool.query('UPDATE external_source_documents SET kind=$2 WHERE id=$1', [doc, kind]);
    assert.equal(updated.rowCount, 1, 'The negative fixture must change a retained original.');
  };
  let worker = await f.start();
  for (const id of relisted) f.details.set(id, { price: 68000, at: priceAt });
  await f.ingest(worker, ids.map((id, i) => upstream(i + 1, id, 'new', baseAt)));
  assert.equal(await worker.applyEvents(), ids.length);
  assert.equal(await worker.details(), ids.length);
  await f.db.pool.query(`INSERT INTO external_full_events
    (event_id,payload_hash,source,external_id,operation,business_at,document_refs,applied_at,source_type,public_outcome)
    SELECT n,repeat('a',64),'che168',(800000+n)::text,'withdraw',$1,'[]',$1,'removed','not_public'
    FROM generate_series($2::integer,2000) n`, [baseAt, ids.length + 1]);
  const prices = changed.map((id, i) => ({ ...upstream(2001 + i, id, 'price', priceAt),
    oldPrice: { cny: 70000 }, newPrice: { cny: 68000 } }));
  await ingestAndRetain(worker, prices);
  assert.equal(await worker.applyEvents(), 2);
  assert.equal(await worker.details(), 2);
  for (const e of prices) {
    assert.deepEqual(await f.event(e.id), { applied: true, public_outcome: 'not_public' });
    assert.deepEqual(await f.published(e.vehicleId), { price: 68000 });
  }

  // The fixed export is older than both successors. One identity is present
  // with its already normalized price; the other is absent from the export.
  const snapshotId = await f.seedSnapshot(staged.map((id, i) => [i + 1, id]));
  const generatedAt = new Date(Date.now() + 1).toISOString();
  const withdrawalAt = new Date(Date.parse(generatedAt) + 1).toISOString();
  const relistAt = new Date(Date.parse(generatedAt) + 2).toISOString();
  await f.db.pool.query('UPDATE external_full_snapshots SET generated_at=$2 WHERE id=$1', [snapshotId, generatedAt]);
  await f.db.pool.query(`UPDATE external_full_stage SET payload=payload||jsonb_build_object(
    'price_cny','68000','detail_fetched_at',$2::text,'duplicate_of','')
    WHERE snapshot_id=$1 AND row_number>1`, [snapshotId, priceAt]);
  await worker.close();
  await prepareDeltaPolicy(f.db, actor, snapshotId);
  worker = await f.start();
  assert.equal(await worker.promoteSnapshot(snapshotId), staged.length - 1);
  assert.equal(await worker.details(), staged.length - 1);
  await delay(Math.max(0, Date.parse(relistAt) - Date.now()));
  const removes = relisted.map((id, i) => upstream(2003 + i, id, 'removed', withdrawalAt));
  await ingestAndRetain(worker, removes);
  assert.equal(await worker.applyEvents(), relisted.length);
  for (const e of removes) {
    assert.deepEqual(await f.event(e.id), { applied: true, public_outcome: 'effective' });
    assert.equal(await f.published(e.vehicleId), undefined);
  }
  const relists = relisted.map((id, i) => ({ ...upstream(2003 + removes.length + i, id, 'relisted', relistAt),
    oldPrice: { cny: 68000 }, newPrice: { cny: 68000 } }));
  const highWater = String(relists.at(-1)!.id);
  await ingestAndRetain(worker, relists);
  assert.equal(await worker.applyEvents(), relisted.length);
  assert.equal(await worker.details(), relisted.length);
  for (const e of relists) assert.deepEqual(await f.event(e.id), { applied: true, public_outcome: 'not_public' });

  const observations = async () => (await f.db.pool.query(`SELECT e.event_id::text,e.external_id,e.detail_generation::text,e.business_at,e.applied_at,
    e.detail_updated_at,e.public_effective_at,e.public_outcome,e.payload_hash,e.prior_public_price::int,
    l.source_updated_at,(l.source_data#>>'{price,cny}')::numeric::int AS source_price,c.price_cny::int AS public_price,
    m.event_order::text,m.applied_generation::text,m.desired_generation::text,
    EXISTS(SELECT 1 FROM external_full_stage r WHERE r.snapshot_id=$1 AND (r.source,r.external_id)=(e.source,e.external_id)) AS in_csv,
    (SELECT count(*)::integer FROM external_source_heads h WHERE h.provider=l.provider AND h.source=e.source
      AND h.external_id=e.external_id AND h.kind='detail' AND h.observed_at BETWEEN e.applied_at AND e.detail_updated_at) AS in_generation_heads
    FROM external_full_events e JOIN external_full_members m ON (m.source,m.external_id)=(e.source,e.external_id)
    JOIN external_listings l ON l.provider='chinacarapi' AND (l.platform_id,l.external_id)=(e.source,e.external_id)
    JOIN external_catalog c ON c.listing_id=l.id JOIN external_catalog_filter f ON f.listing_id=l.id
    WHERE e.event_id BETWEEN 2001 AND $2 AND l.formal_primary AND l.upstream_state='active' AND f.active AND f.locale_mask=7
    ORDER BY e.event_id`, [snapshotId, highWater])).rows;
  const original = await observations();
  assert.deepEqual(original.map(row => row.event_id), [...prices, ...removes, ...relists].map(e => String(e.id)));
  for (const row of original) assert.equal(row.in_csv, staged.includes(row.external_id));
  for (const [i, e] of prices.entries()) {
    const price = original[i]!;
    assert.ok(price.detail_updated_at >= price.applied_at);
    assert.ok(price.detail_updated_at < new Date(generatedAt));
    assert.equal(price.prior_public_price, 68000);
    assert.equal(price.payload_hash, jsonHash(e));
  }
  for (const [i, e] of relists.entries()) {
    const removed = original[prices.length + i]!, relist = original[prices.length + removes.length + i]!;
    assert.ok(removed.business_at > new Date(generatedAt));
    assert.ok(removed.business_at < relist.business_at && relist.applied_at >= relist.business_at);
    assert.deepEqual(relist.source_updated_at, new Date(priceAt));
    assert.equal(relist.source_price, 68000);
    assert.equal(relist.public_price, 68000);
    assert.equal(relist.payload_hash, jsonHash(e));
    assert.equal(relist.event_order, String(e.id));
    assert.equal(relist.in_generation_heads, 3);
    assert.equal(relist.applied_generation, relist.desired_generation);
    assert.equal(relist.applied_generation, relist.detail_generation);
    assert.equal(BigInt(relist.detail_generation), BigInt(removed.detail_generation) + 1n);
  }

  await worker.tick();
  await worker.tick();
  const policy = await f.policy();
  assert.equal(policy?.phase, 'draining');
  assert.equal(policy?.audit_cursor, String(staged.length));
  assert.equal(policy?.audit_missing, '0');
  assert.equal(policy?.event_audit_cursor, '2000');
  assert.equal(policy?.high_water, highWater);
  assert.deepEqual(await observations(), original);
  const resumeRequest = { snapshotId, snapshotSha256: 'a'.repeat(64), eventAuditCursor: '2000',
    highWater, evidence: 'fixture-confirmed-post-snapshot-lifecycle' };
  return { f, worker, resumeRequest, observations, original, source, relistAt, changeArchivedKind };
}

test('historical price audits through its proven post-snapshot withdrawal and relist', async t => {
  const h = await postSnapshotLifecycle(t, true);
  await h.worker.tick();
  const ready = await h.f.policy();
  assert.equal(ready?.phase, 'ready');
  assert.equal(ready?.event_audit_cursor, '2010');
  assert.equal(ready?.high_water, '2010');
  assert.equal(ready?.snapshot_id, h.resumeRequest.snapshotId);
  assert.deepEqual(await h.observations(), h.original);
  assert.equal(h.f.exportCalls(), 0);
});

test('post-snapshot lifecycle audit refuses mismatched or missing evidence before named resume', async t => {
  const h = await postSnapshotLifecycle(t);
  const docs = (await h.f.db.pool.query<{ event_id: string; document_id: string }>(`SELECT
    event_id::text,document_refs->0->>'id' AS document_id FROM external_full_events
    WHERE event_id IN (2001,2003,2005,2006) ORDER BY event_id`)).rows;
  const [price, removed, relist, other] = docs;
  assert.ok(price && removed && relist && other);
  const changeKind = h.changeArchivedKind;
  await changeKind(relist.document_id, 'csv');
  await h.worker.tick();
  const blocked = await h.f.policy();
  assert.equal(blocked?.phase, 'blocked');
  assert.equal(blocked?.reason, 'audit_gap');
  assert.equal(blocked?.event_audit_cursor, '2000');
  await h.worker.close();
  const refused = async () => {
    await assert.rejects(resumeDeltaAudit(h.f.db, actor, h.resumeRequest), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
    assert.deepEqual(await h.f.policy(), blocked);
  };
  await refused();
  await changeKind(relist.document_id, 'event');
  await changeKind(price.document_id, 'csv');
  await refused();
  await changeKind(price.document_id, 'event');
  await changeKind(removed.document_id, 'csv');
  await refused();
  await changeKind(removed.document_id, 'event');

  const linkRelist = (document: string) => h.f.db.pool.query(`UPDATE external_full_events
    SET document_refs=jsonb_set(document_refs,'{0,id}',to_jsonb($1::text)) WHERE event_id=2005`, [document]);
  await linkRelist(other.document_id);
  await refused();
  await linkRelist(relist.document_id);

  const changePublicPrice = (delta: number) => h.f.db.pool.query(`UPDATE external_catalog c
    SET price_cny=c.price_cny+$2 FROM external_listings l
    WHERE c.listing_id=l.id AND l.provider='chinacarapi' AND l.platform_id=$1 AND l.external_id='902'`,
    [h.source, delta]);
  assert.equal((await changePublicPrice(-5000)).rowCount, 1);
  await refused();
  assert.equal((await changePublicPrice(5000)).rowCount, 1);

  const generation = h.original[4]!.detail_generation;
  const setGeneration = (value: string) => h.f.db.pool.query(`UPDATE external_full_members
    SET desired_generation=$2 WHERE source=$1 AND external_id='902'`, [h.source, value]);
  await setGeneration((BigInt(generation) + 1n).toString());
  await refused();
  await setGeneration(generation);

  const withdrawal = (await h.f.db.pool.query<{ applied_at: string }>(
    'SELECT applied_at::text FROM external_full_events WHERE event_id=2003')).rows[0]!;
  const setWithdrawal = (at: string | null) =>
    h.f.db.pool.query('UPDATE external_full_events SET applied_at=$1 WHERE event_id=2003', [at]);
  await setWithdrawal(null);
  await refused();
  await setWithdrawal(withdrawal.applied_at);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...h.resumeRequest, highWater: '2007' }), /SYNC_DELTA_STATE_CONFLICT/);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, { ...h.resumeRequest, snapshotSha256: 'b'.repeat(64) }),
    /SYNC_DELTA_SNAPSHOT_MISMATCH/);
  assert.equal((await h.f.db.pool.query("SELECT 1 FROM audit_events WHERE operation='external.sync.delta.resumeAudit'")).rowCount, 0);

  const resumed = await resumeDeltaAudit(h.f.db, actor, h.resumeRequest);
  assert.equal(resumed.phase, 'draining');
  assert.equal(resumed.event_audit_cursor, '2000');
  assert.equal(resumed.high_water, '2006');
  assert.equal(resumed.snapshot_id, h.resumeRequest.snapshotId);
  const restarted = await h.f.start();
  await restarted.tick();
  assert.equal((await h.f.policy())?.phase, 'ready');
  assert.equal((await h.f.policy())?.event_audit_cursor, '2006');
  assert.deepEqual(await h.observations(), h.original);
});

test('post-snapshot lifecycle audit cannot revive an identity with a later received withdrawal', async t => {
  const h = await postSnapshotLifecycle(t);
  const withheld = (await h.f.db.pool.query<{ id: string }>(
    "SELECT document_refs->0->>'id' AS id FROM external_full_events WHERE event_id=2006")).rows[0]!;
  const restore = (kind: 'csv' | 'event') => h.changeArchivedKind(withheld.id, kind);
  await restore('csv');
  await h.worker.tick();
  assert.equal((await h.f.policy())?.phase, 'blocked');
  await restore('event');

  const withdrawnAt = new Date(Math.max(Date.now(), Date.parse(h.relistAt) + 1)).toISOString();
  await h.f.ingest(h.worker, [{ ...change(2007, '903', 'removed', withdrawnAt), source: h.source }]);
  assert.equal((await h.f.sync()).receive_cursor, '2007');
  assert.equal((await h.f.event(2007)).applied, false);
  await assert.rejects(resumeDeltaAudit(h.f.db, actor, h.resumeRequest), /SYNC_DELTA_AUDIT_NOT_CLEAR/);
  assert.equal((await h.f.policy())?.event_audit_cursor, '2000');
  assert.equal(await h.worker.applyEvents(true), 1);
  assert.deepEqual(await h.f.event(2007), { applied: true, public_outcome: 'effective' });
  assert.equal(await h.f.published('903'), undefined);

  const resumed = await resumeDeltaAudit(h.f.db, actor, h.resumeRequest);
  assert.equal(resumed.event_audit_cursor, '2000');
  assert.equal(resumed.high_water, '2006');
  await h.worker.tick();
  assert.equal((await h.f.policy())?.phase, 'ready');
  assert.equal((await h.f.policy())?.event_audit_cursor, '2006');
  assert.equal((await h.f.sync()).receive_cursor, '2007');
  assert.equal(await h.f.published('903'), undefined);
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
