import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { PublicVehicleInlineSchema, PublicVehicleInspectionResponseSchema, PublicVehicleSchema, type Locale } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { applyFullSource, ensureMember } from '../src/external/full-sync/apply.js';
import { configureFullSync } from '../src/external/full-sync/engine.js';
import { reprojectStoredInspections, withholdUnverifiableInspections } from '../src/external/inspection-reproject.js';
import { persistSourceDocument, type SourceDocument } from '../src/external/sources/index.js';
import { ExternalStore } from '../src/external/store.js';

const at = '2026-11-14T00:00:00.000Z';
const locales = ['zh', 'en', 'ru'] as const;
const finding = 'Synthetic dent at the front edge';

async function publishReportFixture(db: Database, externalId: string, available = true) {
  const identity = { provider: 'chinacarapi', source: 'che168', externalId } as const;
  const report: SourceDocument = { identity, kind: 'report', locale: 'en', observedAt: at, sourceUpdatedAt: null,
    payload: { id: externalId, source: identity.source, available,
      summary: [{ area: 'Body', result: 'Synthetic archive summary' }],
      counts: [{ category: 'Accident items', checked: 4, faults: 1 }],
      checks: [{ category: 'Major accident check', groups: [{ name: 'Body', items: [
        { part: 'Hood', result: finding, ok: false }, { part: 'Door', result: 'Factory finish', ok: true },
      ] }] }] } };
  const details: SourceDocument[] = locales.map(locale => ({ identity, kind: 'detail', locale, observedAt: at, sourceUpdatedAt: at,
    payload: { id: externalId, source: identity.source, status: 'active', updatedAt: at,
      url: `https://www.che168.com/dealer/1/${externalId}.html`,
      title: { zh: '隔离测试车', en: 'Synthetic archived vehicle', ru: 'Синтетический автомобиль' }[locale],
      make: { id: 'fixture-make', name: 'Example', nameZh: '示例' }, model: { id: 'fixture-model', name: 'Model', nameZh: '车型' },
      modelYear: 2024, mileageKm: 12000, price: { cny: 70000 }, fuel: 'Petrol', transmission: 'Automatic',
      priceHistory: [{ observedAt: at, price: { cny: 68000 } }], hasInspectionReport: true } }));
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    const member = await ensureMember(tx, identity.source, externalId);
    await tx.query(`UPDATE external_full_members SET state='active',locales=$3,last_detail_at=$4,
      applied_generation=desired_generation WHERE source=$1 AND external_id=$2`, [identity.source, externalId, locales, at]);
    await applyFullSource(tx, { source: identity.source, externalId, canonicalId: member.canonical_id, operation: 'upsert',
      documents: [...details, report], at, batchId: randomUUID() });
  });
  const { id } = (await db.pool.query<{id: string}>('SELECT id FROM external_listings WHERE provider=$1 AND platform_id=$2 AND external_id=$3',
    [identity.provider, identity.source, externalId])).rows[0]!;
  return { id, externalId, report, details };
}

test('withholds only selected unverifiable public inspection reports, invalidates cached reads and permits trusted repair', async t => {
  const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1' ||
    address.pathname !== '/postgres' || address.search || address.hash) throw new Error('Isolated local maintenance PostgreSQL required.');
  const maintenance = createDatabase(address.href, 1);
  const name = `hd_ext_inspection_withhold_${randomBytes(8).toString('hex')}`;
  const media = await mkdtemp(path.join(tmpdir(), 'hd-inspection-withhold-'));
  let runtime: Awaited<ReturnType<typeof buildApp>> | undefined;
  let created = false;
  t.after(async () => {
    try { await runtime?.app.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(media, { recursive: true, force: true }); }
    }
  });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No supplier or translation requests'); });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  address.pathname = `/${name}`;
  const peer = '192.0.2.10', secret = 'inspection-withhold-isolated-ssr-placeholder';
  const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: address.href, MEDIA_ROOT: media,
    AUTH_SECRET: randomBytes(32).toString('hex'), CATALOG_READ_MODE: 'combined', PUBLIC_CATALOG_CACHE: 'memory',
    HD_DEPLOYMENT_ENV: 'test', HD_RELEASE_ID: 'a'.repeat(40) });
  runtime = await buildApp({ ...config, ssrService: { secret, peers: [`${peer}/32`] } });
  const { app, db, inventory } = runtime;
  await migrateDatabase(db);
  const actor = { id: 'inspection-withhold-admin', requestId: randomUUID() };
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Isolated staff','inspection-withhold@example.invalid','admin',false)", [actor.id]);
  await configureFullSync(db, actor, 'full');
  const missing = await publishReportFixture(db, '990001');
  const mismatched = await publishReportFixture(db, '990002');
  const valid = await publishReportFixture(db, '990003');
  const unavailable = await publishReportFixture(db, '990004', false);
  const hidden = await publishReportFixture(db, '990005');
  const unselected = await publishReportFixture(db, '990006');
  const malformed = await publishReportFixture(db, '990007');
  const newerUnavailable = await publishReportFixture(db, '990008');
  const store = new ExternalStore(db);
  const hiddenBefore = await store.getListing(`ext-${hidden.id}`, 'en');
  await store.saveOverrides(`ext-${hidden.id}`, { version: hiddenBefore.version, overrides: { ...hiddenBefore.overrides, hidden: true } }, randomUUID(), actor);
  const missingBefore = await store.getListing(`ext-${missing.id}`, 'en');
  await store.saveOverrides(`ext-${missing.id}`, { version: missingBefore.version,
    overrides: { ...missingBefore.overrides, facts: { ...missingBefore.overrides.facts, mileageKm: 4321 } } }, randomUUID(), actor);

  await db.pool.query("DELETE FROM external_source_heads WHERE provider='chinacarapi' AND source='che168' AND external_id=$1", [missing.externalId]);
  const removedDetail = await db.pool.query("DELETE FROM external_source_heads WHERE provider='chinacarapi' AND source='che168' AND external_id=$1 AND kind='detail'", [valid.externalId]);
  assert.equal(removedDetail.rowCount, locales.length, 'a matching report can remain even when all detail heads are missing');
  await db.pool.query("DELETE FROM external_source_heads WHERE provider='chinacarapi' AND source='che168' AND external_id=$1 AND kind='report'", [unselected.externalId]);
  // The head's own tuple and payload match. Its document reference belongs to a different listing.
  await db.pool.query(`UPDATE external_source_heads h SET document_id=d.document_id FROM external_source_heads d
    WHERE (h.provider,h.source,h.external_id,h.kind,h.locale)=('chinacarapi','che168',$1,'report','en')
    AND (d.provider,d.source,d.external_id,d.kind,d.locale)=('chinacarapi','che168',$2,'report','en')`, [mismatched.externalId, valid.externalId]);
  await db.pool.query(`UPDATE external_source_heads SET merged_payload=$2 WHERE provider='chinacarapi' AND source='che168'
    AND external_id=$1 AND kind='report' AND locale='en'`, [malformed.externalId,
    JSON.stringify({ id: malformed.externalId, source: 'che168', checks: [{}], counts: [null] })]);
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    // A newer authoritative unavailability observation must not reuse the head's retained older arrays.
    await persistSourceDocument(tx, { ...newerUnavailable.report, observedAt: '2026-11-14T01:00:00.000Z',
      payload: { id: newerUnavailable.externalId, source: 'che168', available: false } });
  });
  await db.pool.query("UPDATE external_vehicle_evidence_sets SET status='unavailable' WHERE listing_id=$1 AND kind='inspection' AND locale='ru'", [missing.id]);

  const inspectionSets = async () => (await db.pool.query<{ listing_id: string; locale: Locale; source_revision: string; status: string }>(
    "SELECT * FROM external_vehicle_evidence_sets WHERE kind='inspection' ORDER BY listing_id,locale")).rows;
  const untouched = async () => {
    const statements = [
      'SELECT * FROM external_listings ORDER BY id', 'SELECT * FROM external_catalog ORDER BY listing_id',
      'SELECT * FROM external_listing_overrides ORDER BY listing_id', 'SELECT * FROM external_override_events ORDER BY id',
      'SELECT * FROM audit_events ORDER BY id', 'SELECT * FROM external_media ORDER BY id',
      'SELECT * FROM external_source_heads ORDER BY provider,source,external_id,kind,locale', 'SELECT * FROM external_source_documents ORDER BY id',
      'SELECT * FROM external_source_blobs ORDER BY hash',
      "SELECT * FROM external_vehicle_evidence_sets WHERE kind='price-history' ORDER BY listing_id,locale",
      'SELECT * FROM external_vehicle_evidence ORDER BY listing_id,locale,kind,position',
    ];
    return Promise.all(statements.map(async sql => (await db.pool.query(sql)).rows));
  };
  const rawBefore = await untouched();
  const setsBefore = await inspectionSets();
  const catalogRevision = async () => (await db.pool.query('SELECT epoch,revision,filter_revision FROM public_catalog_state WHERE id=1')).rows[0];
  const precedingListing = async (id: string) => (await db.pool.query<{id: string}>(
    'SELECT id FROM external_listings WHERE id<$1 ORDER BY id DESC LIMIT 1', [id])).rows[0]?.id;
  const detail = (id: string, locale: Locale, inline = false, internal = false) => app.inject({
    url: `${internal ? '/internal/public-catalog' : '/api/v1'}/vehicles/ext-${id}?locale=${locale}&view=localized${inline ? '&projection=detail-inline-v1' : ''}`,
    ...(internal ? { remoteAddress: peer, headers: { 'x-hd-ssr-key': secret } } : {}),
  });
  const evidence = (id: string, locale: Locale, cursor?: string) => app.inject({
    url: `/api/v1/vehicles/ext-${id}/inspection?locale=${locale}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
  });
  const inspect = PublicVehicleInspectionResponseSchema.shape.data;
  const oldPage = await evidence(missing.id, 'en');
  assert.equal(oldPage.statusCode, 200, oldPage.body);
  const old = inspect.parse(oldPage.json().data);
  assert.equal(old.status, 'available');
  assert.ok(old.nextCursor);
  const calls = t.mock.method(inventory, 'getPublic');
  const views = [{ inline: false, internal: false }, { inline: true, internal: false }, { inline: true, internal: true }];
  for (const { inline, internal } of views) {
    const before = await detail(missing.id, 'en', inline, internal);
    assert.equal(before.statusCode, 200, before.body);
    assert.equal(before.json().data.inspectionSummary.status, 'available');
    if (inline) assert.equal(PublicVehicleInlineSchema.parse(before.json().data).inspectionInline.defects[0]?.value.text, finding);
    const warmed = calls.mock.callCount();
    assert.equal((await detail(missing.id, 'en', inline, internal)).statusCode, 200);
    assert.equal(calls.mock.callCount(), warmed, 'the same view uses its warm cache before withholding');
  }
  const revisionBefore = await catalogRevision();
  const listingIds = [missing.id, mismatched.id, malformed.id, newerUnavailable.id, valid.id, unavailable.id, hidden.id, randomUUID()];
  await t.test('a later write failure rolls back an earlier report in the same maintenance batch', async () => {
    const [first, later] = [missing.id, mismatched.id].sort();
    await db.pool.query(`ALTER TABLE external_vehicle_evidence_sets ADD CONSTRAINT withhold_test_reject_later
      CHECK (listing_id<>'${later}'::uuid OR kind<>'inspection' OR status<>'unavailable') NOT VALID`);
    try {
      await assert.rejects(withholdUnverifiableInspections(db, { listingIds: [later!, first!] }), { code: '23514' });
      assert.deepEqual(await inspectionSets(), setsBefore);
      assert.deepEqual(await catalogRevision(), revisionBefore);
    } finally {
      await db.pool.query('ALTER TABLE external_vehicle_evidence_sets DROP CONSTRAINT withhold_test_reject_later');
    }
  });
  const result = await withholdUnverifiableInspections(db, { listingIds });
  const reports = new Map(result.reports.map(item => [item.listingId, item]));
  assert.deepEqual(listingIds.map(id => reports.get(id)?.result), ['withheld', 'withheld', 'withheld', 'withheld', 'rebuildable', 'skipped', 'skipped', 'skipped']);
  assert.deepEqual(reports.get(missing.id)?.revisions.map(row => row.locale).sort(), ['en', 'zh']);
  assert.deepEqual(reports.get(mismatched.id)?.revisions.map(row => row.locale).sort(), ['en', 'ru', 'zh']);
  assert.deepEqual(reports.get(malformed.id)?.revisions.map(row => row.locale).sort(), ['en', 'ru', 'zh']);
  assert.deepEqual(reports.get(newerUnavailable.id)?.revisions.map(row => row.locale).sort(), ['en', 'ru', 'zh']);
  assert.deepEqual(await untouched(), rawBefore);
  const setsAfter = await inspectionSets();
  assert.deepEqual(setsAfter, setsBefore.map(row => {
    const applied = reports.get(row.listing_id)?.revisions.find(change => change.locale === row.locale);
    if (!applied) return row;
    assert.equal(applied.previousRevision, row.source_revision);
    assert.notEqual(applied.revision, row.source_revision);
    return { ...row, status: 'unavailable', source_revision: applied.revision };
  }));
  const revisionAfter = await catalogRevision();
  assert.equal(BigInt(revisionAfter.revision), BigInt(revisionBefore.revision) + 1n);

  for (const { inline, internal } of views) {
    const response = await detail(missing.id, 'en', inline, internal);
    assert.equal(response.statusCode, 200, response.body);
    const car = (inline ? PublicVehicleInlineSchema : PublicVehicleSchema).parse(response.json().data);
    assert.equal(car.inspectionSummary?.status, 'unavailable');
    assert.deepEqual(car.inspectionSummary?.categories, []);
    assert.equal(car.facts.mileageKm, 4321);
    if ('inspectionInline' in car) assert.deepEqual(car.inspectionInline, {
      defects: [], conclusions: [], normalItemCount: 0, hasMoreConclusions: false, hasMoreDefects: false,
    });
    assert.doesNotMatch(response.body, /Synthetic dent|Synthetic archive summary|Factory finish/);
  }
  const newPage = await evidence(missing.id, 'en');
  assert.equal(newPage.statusCode, 200, newPage.body);
  const updated = inspect.parse(newPage.json().data);
  assert.deepEqual([updated.status, updated.total, updated.items, updated.conclusions, updated.nextCursor], ['unavailable', 0, [], [], null]);
  assert.equal((await evidence(missing.id, 'en', old.nextCursor!)).statusCode, 409);
  assert.equal(inspect.parse((await evidence(valid.id, 'en')).json().data).status, 'available');
  assert.equal(inspect.parse((await evidence(unselected.id, 'en')).json().data).status, 'available');
  assert.equal((await evidence(hidden.id, 'en')).statusCode, 404);
  const repeated = await withholdUnverifiableInspections(db, { listingIds });
  assert.ok(repeated.reports.every(item => !item.revisions.length));
  assert.deepEqual(await inspectionSets(), setsAfter);
  assert.deepEqual(await catalogRevision(), revisionAfter);

  await t.test('CLI requires the explicit write confirmation and listing scope', async () => {
    const cli = promisify(execFile);
    const args = ['--import', 'tsx', 'src/external/inspection-reproject-cli.ts', '--database', name, '--withhold-unverifiable'];
    const opts = { cwd: new URL('..', import.meta.url),
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: address.href, DATABASE_URL_FILE: undefined } };
    const listingArgs = ['--listing-id', valid.id];
    await assert.rejects(cli(process.execPath, [...args, ...listingArgs], opts), { code: 1 });
    await assert.rejects(cli(process.execPath, [...args, '--apply'], opts), { code: 1 });
    await assert.rejects(cli(process.execPath, [...args, '--apply', ...listingArgs], {
      ...opts, env: { ...opts.env, DATABASE_URL: new URL('/different_database', address).href },
    }), { code: 1 });
    const ok = await cli(process.execPath, [...args, '--apply', ...listingArgs], opts);
    assert.deepEqual(JSON.parse(ok.stdout), { reports: [{ listingId: valid.id, result: 'rebuildable', revisions: [] }] });
    assert.deepEqual(await inspectionSets(), setsAfter);
    assert.deepEqual(await catalogRevision(), revisionAfter);
  });

  await t.test('reprojects a matching report without detail heads and replaces the warm public report', async () => {
    const reportSummary = 'Rebuilt synthetic report summary';
    const reportFinding = 'Synthetic repair marks at the rear edge';
    const oldReportPage = await evidence(valid.id, 'en');
    assert.equal(oldReportPage.statusCode, 200, oldReportPage.body);
    const oldReport = inspect.parse(oldReportPage.json().data);
    assert.equal(oldReport.items[0]?.value.text, 'Synthetic archive summary');
    assert.ok(oldReport.nextCursor);
    for (const { inline, internal } of views) {
      const cached = await detail(valid.id, 'en', inline, internal);
      assert.equal(cached.statusCode, 200, cached.body);
      assert.equal(cached.json().data.inspectionSummary.checked, 4);
      if (inline) assert.equal(PublicVehicleInlineSchema.parse(cached.json().data).inspectionInline.defects[0]?.value.text, finding);
      const loads = calls.mock.callCount();
      assert.equal((await detail(valid.id, 'en', inline, internal)).statusCode, 200);
      assert.equal(calls.mock.callCount(), loads, 'the legacy projection is warm on this route');
    }
    const before = await catalogRevision();
    await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(78291332)');
      await persistSourceDocument(tx, { ...valid.report, observedAt: '2026-11-14T02:00:00.000Z',
        payload: { id: valid.externalId, source: 'che168', available: true,
          summary: [{ area: 'Body', result: reportSummary }],
          counts: [{ category: 'Accident items', checked: 9, faults: 2 }],
          checks: [{ category: 'Major accident check', groups: [{ name: 'Body', items: [
            { part: 'Rear door', result: reportFinding, ok: false },
          ] }] }] } });
    });
    assert.equal((await db.pool.query(`SELECT 1 FROM external_source_heads
      WHERE provider='chinacarapi' AND source='che168' AND external_id=$1 AND kind='detail'`, [valid.externalId])).rowCount, 0);
    assert.deepEqual(await catalogRevision(), before, 'archiving alone must not publish a new report');
    const options = { after: await precedingListing(valid.id), limit: 1 };
    const allBefore = await inspectionSets();
    assert.deepEqual(await reprojectStoredInspections(db, options), { scanned: 1, changed: 1, nextCursor: valid.id });
    const after = await catalogRevision();
    assert.equal(BigInt(after.revision), BigInt(before.revision) + 1n);
    assert.deepEqual((await inspectionSets()).filter(row => row.listing_id !== valid.id), allBefore.filter(row => row.listing_id !== valid.id));
    for (const { inline, internal } of views) {
      const projected = await detail(valid.id, 'en', inline, internal);
      assert.equal(projected.statusCode, 200, projected.body);
      const data = projected.json().data;
      const inlineData = inline ? PublicVehicleInlineSchema.parse(data) : null;
      const car = inlineData ?? PublicVehicleSchema.parse(data);
      assert.deepEqual([car.inspectionSummary?.status, car.inspectionSummary?.checked, car.inspectionSummary?.faults], ['available', 9, 2]);
      if (inlineData) {
        assert.deepEqual(inlineData.inspectionInline.defects.map(item => item.value.text), [reportFinding]);
        assert.deepEqual(inlineData.inspectionInline.conclusions.map(item => item.value.text), [reportSummary]);
      }
      assert.doesNotMatch(projected.body, /Synthetic dent at the front edge|Synthetic archive summary/);
    }
    assert.equal((await evidence(valid.id, 'en', oldReport.nextCursor!)).statusCode, 409);
    const currentResponse = await evidence(valid.id, 'en');
    assert.equal(currentResponse.statusCode, 200, currentResponse.body);
    const current = inspect.parse(currentResponse.json().data);
    assert.deepEqual([current.status, current.total, current.summary?.checked, current.items[0]?.value.text],
      ['available', 2, 9, reportSummary]);
    assert.ok(current.nextCursor);
    const remaining = await evidence(valid.id, 'en', current.nextCursor);
    assert.equal(remaining.statusCode, 200, remaining.body);
    const last = inspect.parse(remaining.json().data);
    assert.deepEqual([last.items[0]?.value.text, last.nextCursor], [reportFinding, null]);

    const repaired = await inspectionSets();
    assert.deepEqual(await reprojectStoredInspections(db, options), { scanned: 1, changed: 0, nextCursor: valid.id });
    assert.deepEqual(await withholdUnverifiableInspections(db, { listingIds: [valid.id] }), {
      reports: [{ listingId: valid.id, result: 'rebuildable', revisions: [] }],
    });
    assert.deepEqual(await inspectionSets(), repaired);
    assert.deepEqual(await catalogRevision(), after);
  });

  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    for (const doc of [...missing.details, missing.report]) await persistSourceDocument(tx, doc);
  });
  const previous = await precedingListing(missing.id);
  const repaired = await reprojectStoredInspections(db, { after: previous, limit: 1 });
  assert.equal(repaired.changed, 1);
  assert.equal(repaired.nextCursor, missing.id);
  assert.equal(inspect.parse((await evidence(missing.id, 'en')).json().data).status, 'available');
  const restored = await detail(missing.id, 'en', true, true);
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(PublicVehicleInlineSchema.parse(restored.json().data).inspectionInline.defects[0]?.value.text, finding);

  await t.test('rechecks archive coverage after waiting for a concurrent supplier writer', async () => {
    const writer = await db.pool.connect();
    let attempt: ReturnType<typeof withholdUnverifiableInspections> | undefined;
    let committed = false;
    const beforeRace = await catalogRevision();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT pg_advisory_xact_lock(78291332)');
      const { pid } = (await writer.query<{pid: number}>('SELECT pg_backend_pid() AS pid')).rows[0]!;
      await persistSourceDocument(writer, unselected.report);
      attempt = withholdUnverifiableInspections(db, { listingIds: [unselected.id] });
      let waiting = false;
      const deadline = Date.now() + 750;
      while (!waiting && Date.now() < deadline) {
        waiting = (await db.pool.query<{waiting: boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory'
            AND $1=ANY(pg_blocking_pids(pid))) AS waiting`, [pid])).rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      assert.equal(waiting, true, 'withholding must wait for the supplier advisory lock');
      await writer.query('COMMIT');
      committed = true;
    } finally {
      try { if (!committed) await writer.query('ROLLBACK'); }
      finally { writer.release(); }
      if (!committed) await attempt?.catch(() => {});
    }
    assert.deepEqual(await attempt, { reports: [{ listingId: unselected.id, result: 'rebuildable', revisions: [] }] });
    assert.deepEqual(await catalogRevision(), beforeRace);
    assert.equal(inspect.parse((await evidence(unselected.id, 'en')).json().data).status, 'available');
  });

  await t.test('report-only reprojection keeps wrong-bound and hidden reports out of public reads', async () => {
    const removed = await db.pool.query(`DELETE FROM external_source_heads
      WHERE provider='chinacarapi' AND source='che168' AND external_id=ANY($1::text[]) AND kind='detail'`,
    [[mismatched.externalId, hidden.externalId]]);
    assert.equal(removed.rowCount, 2 * locales.length);
    const theseSets = async () => (await inspectionSets()).filter(row => row.listing_id === mismatched.id || row.listing_id === hidden.id);
    const before = await theseSets();
    assert.deepEqual(await reprojectStoredInspections(db, { after: await precedingListing(mismatched.id), limit: 1 }),
      { scanned: 1, changed: 0, nextCursor: mismatched.id });
    // Run this scan last because skipping the hidden target may advance to a different listing.
    const result = await reprojectStoredInspections(db, { after: await precedingListing(hidden.id), limit: 1 });
    assert.notEqual(result.nextCursor, hidden.id);
    assert.deepEqual(await theseSets(), before);
    const withheld = await evidence(mismatched.id, 'en');
    assert.equal(withheld.statusCode, 200, withheld.body);
    const report = inspect.parse(withheld.json().data);
    assert.deepEqual([report.status, report.items, report.conclusions], ['unavailable', [], []]);
    assert.equal((await evidence(hidden.id, 'en')).statusCode, 404);
  });
  assert.equal(network.mock.callCount(), 0);
});
