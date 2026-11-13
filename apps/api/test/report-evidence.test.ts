import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { mock, test } from 'node:test';
import { makeExternalStructuredCandidateFixture, makeExternalVehicleDraftFixture, makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { InventoryService } from '../src/vehicles/service.js';
import { createDatabase } from '../src/db/index.js';
import { ExternalStore } from '../src/external/store.js';
import { getExternalPublic } from '../src/external/catalog.js';
import { exportReportManifest, importReportResults, projectReportAccess, type ReportManifest, type ReportObservation } from '../src/external/report-evidence.js';
import { getExternalReport, getStaffReport } from '../src/external/reports.js';
import { enrichArchivedInspections } from '../src/external/inspection-enrichment.js';
import { adaptChinaCarSample } from '../src/external/china-car-sample.js';
import { chinaCarSampleProfile } from '../src/external/profiles.js';
import { PublicCatalogCache, readPublicCatalogRevision } from '../src/external/public-cache.js';

function maintenanceAddress() {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.pathname !== '/postgres' || url.search || url.hash) {
    throw new Error('Report tests require a local PostgreSQL maintenance URL without options.');
  }
  return url;
}
async function localTransport(url: URL) {
  const socket = process.env.API_TEST_DATABASE_SOCKET;
  if (socket === undefined) return url.toString();
  if (!path.isAbsolute(socket) || !(await stat(path.join(socket, `.s.PGSQL.${url.port || '5432'}`))).isSocket()) throw new Error('Expected a local PostgreSQL socket directory.');
  const transport = new URL(url); transport.searchParams.set('host', socket); return transport.toString();
}

test('offline report evidence and archived enrichment use only an isolated synthetic database', async t => {
  const address = maintenanceAddress(), name = `hd_api_test_report_${randomBytes(16).toString('hex')}`;
  const databaseAddress = new URL(address); databaseAddress.pathname = `/${name}`;
  const maintenance = createDatabase(await localTransport(address), 1), db = createDatabase(await localTransport(databaseAddress), 4);
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('Report tests must never perform network requests.'); });
  let created = false;
  const actor = { id: randomUUID(), requestId: 'synthetic-report-test' }, editor = randomUUID();
  const now = Date.parse('2026-11-12T00:00:00Z');
  const iso = (offset: number) => new Date(now + offset).toISOString();
  const revision = async () => (await readPublicCatalogRevision(db)).revision;
  const store = new ExternalStore(db);
  const candidate = makeExternalStructuredCandidateFixture(1), other = makeExternalStructuredCandidateFixture(2);
  const input = { provider: 'synthetic-feed', records: [candidate, other].map(value => ({ candidate: value, raw: JSON.stringify(value) })) };
  let id: string, otherId: string, manifest: ReportManifest;
  const observation = (exported: ReportManifest, offset = 0, outcome: 'available' | 'unavailable' = 'available'): ReportObservation => ({
    listingId: exported.entries[0]!.listingId, checkedAt: iso(offset), expiresAt: iso(offset + 1000), outcome,
    httpStatus: outcome === 'available' ? 200 : 403, finalUrl: outcome === 'available' ? exported.entries[0]!.reportUrl : null,
    verifiedReportContent: outcome === 'available', matchedVehicle: outcome === 'available', evidenceHash: 'a'.repeat(64),
  });
  const results = (exported: ReportManifest, observed: ReportObservation[]) => ({ version: 1, manifest: exported, observations: observed });
  const internalAccess = async (time = now) => projectReportAccess((await db.pool.query('SELECT * FROM external_listings WHERE id=$1', [id])).rows[0],
    (await db.pool.query('SELECT * FROM external_report_evidence WHERE listing_id=$1', [id])).rows[0], time);
  const read = (time = now) => getExternalPublic(db.pool, id, 'en', time);
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`); created = true;
    const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { idx: number; tag: string }[] };
    // Exercise the complete local migration chain, including the employee translation workspace.
    for (const migration of journal.entries) await db.pool.query(await readFile(new URL(`../migrations/${migration.tag}.sql`, import.meta.url), 'utf8'));
    await db.pool.query("INSERT INTO staff(id,name,email,role) VALUES($1,'Synthetic operator','report-operator@example.invalid','admin'),($2,'Synthetic editor','report-editor@example.invalid','editor')", [actor.id, editor]);
    await store.importBatch(input, randomUUID(), actor);
    id = (await db.pool.query('SELECT id FROM external_listings WHERE external_id=$1', [candidate.externalId])).rows[0].id;
    otherId = (await db.pool.query('SELECT id FROM external_listings WHERE external_id=$1', [other.externalId])).rows[0].id;

    await t.test('unverified URL stays private while source history and structured findings are public', async () => {
      const vehicle = (await read())!;
      assert.equal(vehicle.external!.detail!.inspection!.reportUrl, null);
      assert.equal(vehicle.external!.detail!.inspection!.reportAccess!.status, 'unknown');
      assert.deepEqual(vehicle.report, { hasReport: true });
      assert.deepEqual((await store.getListing(`ext-${id}`, 'en')).report, { hasReport: true, url: candidate.inspection!.reportUrl });
      assert.deepEqual(vehicle.external!.detail!.history, { ownershipTransfers: 0 });
      assert.equal(vehicle.external!.detail!.inspection!.checks![0]!.groups[0]!.items[0]!.ok, false);
      assert.doesNotMatch(JSON.stringify(vehicle), /evidenceHash|sourceHash|reports\.example|photos"/);
      manifest = await exportReportManifest(db, [id], now);
      assert.equal(manifest.entries.length, 1); assert.equal(manifest.entries[0]!.listingId, id);
    });

    await t.test('offline proof remains internal while public presence and safe authenticated links do not depend on it', async () => {
      const before = await revision(), payload = results(manifest, [observation(manifest)]);
      assert.deepEqual(await importReportResults(db, payload, actor.id, now), { applied: 1, unchanged: 0 });
      assert.notEqual(await revision(), before);
      const after = await revision();
      assert.deepEqual(await importReportResults(db, payload, actor.id, now), { applied: 0, unchanged: 1 });
      assert.equal(await revision(), after);
      const inspection = (await read())!.external!.detail!.inspection!;
      assert.equal((await internalAccess()).status, 'available');
      assert.equal(inspection.reportAccess!.status, 'unknown'); assert.equal(inspection.reportUrl, null);
      assert.deepEqual((await read())!.report, { hasReport: true });
      assert.deepEqual(await getExternalReport(db.pool, id), { hasReport: true, url: manifest.entries[0]!.reportUrl });
      const expired = (await read(now + 1000))!.external!.detail!.inspection!;
      assert.equal((await internalAccess(now + 1000)).status, 'expired');
      assert.equal(expired.reportAccess!.status, 'unknown'); assert.equal(expired.reportUrl, null);
    });

    await t.test('database evidence bindings cannot be empty and eligibility changes invalidate public revision', async () => {
      await assert.rejects(db.pool.query("UPDATE external_report_evidence SET binding='{}'::jsonb WHERE listing_id=$1", [id]), { code: '23514' });
      await assert.rejects(db.pool.query("UPDATE external_report_evidence SET observation=jsonb_set(observation,'{listingId}','null') WHERE listing_id=$1", [id]), { code: '23514' });
      const before = await revision(), hash = (await db.pool.query('SELECT observation_hash FROM external_report_evidence WHERE listing_id=$1', [id])).rows[0].observation_hash;
      await db.pool.query('UPDATE external_report_evidence SET imported_at=imported_at WHERE listing_id=$1', [id]);
      assert.equal(await revision(), before);
      await db.pool.query('UPDATE external_report_evidence SET observation_hash=$2 WHERE listing_id=$1', [id, '0'.repeat(64)]);
      assert.notEqual(await revision(), before);
      assert.equal((await read())!.external!.detail!.inspection!.reportAccess!.status, 'unknown');
      await db.pool.query('UPDATE external_report_evidence SET observation_hash=$2 WHERE listing_id=$1', [id, hash]);
      assert.equal((await internalAccess()).status, 'available');
      assert.equal((await read())!.external!.detail!.inspection!.reportAccess!.status, 'unknown');
    });

    await t.test('staff rights, future times and non-report HTTP 200 cannot manufacture availability', async () => {
      const payload = results(manifest, [observation(manifest, 1)]);
      await assert.rejects(importReportResults(db, payload, editor, now + 1), { status: 403 });
      await assert.rejects(importReportResults(db, payload, actor.id, now), { status: 400 });
      await assert.rejects(importReportResults(db, results(manifest, [{ ...observation(manifest, 1), verifiedReportContent: false }]), actor.id, now + 1), { status: 409 });
      await assert.rejects(importReportResults(db, results(manifest, [{ ...observation(manifest, 1), finalUrl: 'https://reports.example.invalid/other' }]), actor.id, now + 1), { status: 409 });
      assert.equal((await internalAccess()).status, 'available');
      assert.equal((await read())!.external!.detail!.inspection!.reportAccess!.status, 'unknown');
    });

    await t.test('new negative proof wins and equal-time conflicts or older proof cannot overwrite it', async () => {
      await importReportResults(db, results(manifest, [observation(manifest, 2, 'unavailable')]), actor.id, now + 2);
      const before = await revision();
      await assert.rejects(importReportResults(db, results(manifest, [observation(manifest)]), actor.id, now + 2), { status: 409 });
      await assert.rejects(importReportResults(db, results(manifest, [observation(manifest, 2)]), actor.id, now + 2), { status: 409 });
      assert.equal(await revision(), before);
      const inspection = (await read(now + 2))!.external!.detail!.inspection!;
      assert.equal((await internalAccess(now + 2)).status, 'unavailable');
      assert.equal(inspection.reportAccess!.status, 'unknown'); assert.equal(inspection.reportUrl, null);
    });

    await t.test('a source-only revision change invalidates warm availability and rejects the old manifest', async () => {
      await importReportResults(db, results(manifest, [observation(manifest, 3)]), actor.id, now + 3);
      const cache = new PublicCatalogCache({ namespace: 'hd:report-db' }, { readRevision: () => readPublicCatalogRevision(db), now: () => now + 3 });
      const load = () => read(now + 3);
      assert.equal((await internalAccess(now + 3)).status, 'available');
      assert.deepEqual((await cache.get('detail', { id }, load))!.report, { hasReport: true });
      const before = await revision(), details = (await db.pool.query('SELECT details FROM external_catalog WHERE listing_id=$1', [id])).rows[0].details;
      const newer = { ...candidate, revision: candidate.revision + 1 };
      await store.importBatch({ provider: 'synthetic-feed', records: [{ candidate: newer, raw: JSON.stringify(newer) }] }, randomUUID(), actor);
      assert.deepEqual((await db.pool.query('SELECT details FROM external_catalog WHERE listing_id=$1', [id])).rows[0].details, details);
      assert.notEqual(await revision(), before);
      assert.equal((await cache.get('detail', { id }, load))!.external!.detail!.inspection!.reportAccess!.status, 'unknown');
      await assert.rejects(importReportResults(db, results(manifest, [observation(manifest, 4)]), actor.id, now + 4), { status: 409 });
      manifest = await exportReportManifest(db, [id], now + 4); await cache.close();
    });

    await t.test('a batch with one bad identity rolls back evidence and public revision together', async () => {
      const both = await exportReportManifest(db, [id, otherId], now + 4);
      const entries = both.entries.map(binding => ({ ...observation({ ...both, entries: [binding] }, 5), listingId: binding.listingId }));
      entries[1]!.finalUrl = 'https://reports.example.invalid/mismatched';
      const before = await revision(), rows = (await db.pool.query('SELECT listing_id,observation FROM external_report_evidence ORDER BY listing_id')).rows;
      await assert.rejects(importReportResults(db, results(both, entries), actor.id, now + 5), { status: 409 });
      assert.equal(await revision(), before);
      assert.deepEqual((await db.pool.query('SELECT listing_id,observation FROM external_report_evidence ORDER BY listing_id')).rows, rows);
    });

    await t.test('concurrent old and new evidence always leaves the newer observation', async () => {
      const settled = await Promise.allSettled([importReportResults(db, results(manifest, [observation(manifest, 6, 'unavailable')]), actor.id, now + 7),
        importReportResults(db, results(manifest, [observation(manifest, 7)]), actor.id, now + 7)]);
      assert.ok(settled.some(item => item.status === 'fulfilled'));
      assert.equal((await internalAccess(now + 7)).status, 'available');
      assert.equal((await read(now + 7))!.external!.detail!.inspection!.reportAccess!.status, 'unknown');
      assert.equal((await db.pool.query('SELECT checked_at FROM external_report_evidence WHERE listing_id=$1', [id])).rows[0].checked_at.toISOString(), iso(7));
    });

    await t.test('HTTP 200 application-shell evidence remains unknown with null public URL and times', async () => {
      const shell = { ...observation(manifest, 8), outcome: 'unknown' as const, verifiedReportContent: false, matchedVehicle: false };
      await importReportResults(db, results(manifest, [shell]), actor.id, now + 8);
      const inspection = (await read(now + 8))!.external!.detail!.inspection!;
      assert.deepEqual(inspection.reportAccess, { status: 'unknown', url: null, checkedAt: null, expiresAt: null });
      assert.equal(inspection.reportUrl, null);
    });

    await t.test('presence-only source updates invalidate warm detail while unsafe links remain admin-null', async () => {
      const initial = { ...other, revision: 2, inspection: { ...other.inspection!, hasReport: false, reportUrl: null } };
      await store.importBatch({ provider: 'synthetic-feed', records: [{ candidate: initial, raw: JSON.stringify(initial) }] }, randomUUID(), actor);
      const cache = new PublicCatalogCache({ namespace: 'hd:report-presence-only' }, { readRevision: () => readPublicCatalogRevision(db), now: () => now });
      const load = () => getExternalPublic(db.pool, otherId, 'en', now);
      assert.deepEqual((await cache.get('detail', { id: otherId }, load))!.report, { hasReport: false });
      const before = await revision(), oldDetails = (await db.pool.query('SELECT details FROM external_catalog WHERE listing_id=$1', [otherId])).rows[0].details;
      const flagged = { ...initial, revision: 3, inspection: { ...initial.inspection, hasReport: true } };
      await store.importBatch({ provider: 'synthetic-feed', records: [{ candidate: flagged, raw: JSON.stringify(flagged) }] }, randomUUID(), actor);
      assert.notEqual(await revision(), before);
      assert.deepEqual((await db.pool.query('SELECT details FROM external_catalog WHERE listing_id=$1', [otherId])).rows[0].details, oldDetails);
      assert.deepEqual((await cache.get('detail', { id: otherId }, load))!.report, { hasReport: true });
      assert.deepEqual(await getExternalReport(db.pool, otherId), { hasReport: true, url: null });
      const unsafe = { ...flagged, revision: 4, inspection: { ...flagged.inspection, hasReport: false, reportUrl: 'http://unsafe.example.invalid/private-report' } };
      await store.importBatch({ provider: 'synthetic-feed', records: [{ candidate: unsafe, raw: JSON.stringify(unsafe) }] }, randomUUID(), actor);
      assert.deepEqual(await getExternalReport(db.pool, otherId), { hasReport: true, url: null });
      const vehicle = (await load())!;
      assert.deepEqual(vehicle.report, { hasReport: true }); assert.doesNotMatch(JSON.stringify(vehicle), /unsafe\.example|private-report/);
      await cache.close();
    });

    await t.test('staff copies require one exact provider identity triple and published-source references invalidate cache', async () => {
      const source = { kind: 'external' as const, platform: { id: candidate.platformId, name: 'Synthetic Market' }, externalId: candidate.externalId,
        listingUrl: candidate.listingUrl, collectedAt: candidate.fetchedAt, sourceUpdatedAt: null };
      assert.deepEqual(await getStaffReport(db.pool, source), { hasReport: true, url: candidate.inspection!.reportUrl });
      for (const patch of [{ externalId: 'another' }, { platform: { ...source.platform, id: 'synthetic-market-alt' } }, { listingUrl: source.listingUrl + '/' }])
        assert.deepEqual(await getStaffReport(db.pool, { ...source, ...patch }), { hasReport: false, url: null });
      assert.deepEqual(await getStaffReport(db.pool, { kind: 'manual' }), { hasReport: false, url: null });
      const vehicleId = randomUUID(), publicationId = randomUUID();
      // Explicit historical publication seed tests database invalidation, not the current publication workflow.
      await db.pool.query('INSERT INTO vehicles(id) VALUES($1)', [vehicleId]);
      await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [publicationId, vehicleId, { source }]);
      await db.pool.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [vehicleId, publicationId]);
      const duplicate = randomUUID(), before = await revision();
      await db.pool.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
        SELECT $2,'unknown-second-provider',platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at FROM external_listings WHERE id=$1`, [id, duplicate]);
      assert.notEqual(await revision(), before);
      assert.deepEqual(await getStaffReport(db.pool, source), { hasReport: false, url: null });
      const duplicateRevision = await revision(); await db.pool.query('DELETE FROM external_listings WHERE id=$1', [duplicate]);
      assert.notEqual(await revision(), duplicateRevision);
      assert.deepEqual(await getStaffReport(db.pool, source), { hasReport: true, url: candidate.inspection!.reportUrl });
    });

    await t.test('staff admin and bundle expose safe links while preview and published-source detail only expose presence', async () => {
      const inventory = new InventoryService(db), draft = makeExternalVehicleDraftFixture(); draft.media = [];
      draft.source = { kind: 'external', platform: { id: candidate.platformId, name: 'Synthetic Market' }, externalId: candidate.externalId,
        listingUrl: candidate.listingUrl, collectedAt: candidate.fetchedAt, sourceUpdatedAt: null };
      const created = await inventory.create(draft, actor, randomUUID());
      const expected = { hasReport: true, url: candidate.inspection!.reportUrl };
      assert.deepEqual((await inventory.getAdmin(created.id)).report, expected);
      const bundle = await inventory.getTranslationBundle(created.id, actor);
      assert.deepEqual(bundle.vehicle.report, expected);
      const saved = await inventory.saveTranslationBundle(created.id, { version: bundle.vehicle.version, localizationRevision: bundle.localization.revision,
        content: bundle.vehicle.draft.content, localization: bundle.localization.data, sourceLanguageConfirmations: [] }, actor);
      assert.deepEqual(saved.vehicle.report, expected);
      const preview = await inventory.publicationPreview(created.id, 'en', actor);
      assert.deepEqual(preview.vehicle.report, { hasReport: true });
      assert.doesNotMatch(JSON.stringify(preview), /reports\.example/);
      const publicationId = randomUUID(), { source, facts, content, price } = saved.vehicle.draft;
      // Explicit pre-feature immutable snapshot fixture; current media/confirmation gates are tested in publication-preview.test.ts.
      await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',
        [publicationId, created.id, { source, facts, content, price, images: makePublicVehicleFixture().images }]);
      await db.pool.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [created.id, publicationId]);
      for (const locale of ['zh', 'en', 'ru'] as const) {
        const published = await inventory.getPublic(created.id, locale);
        assert.deepEqual(published.report, { hasReport: true }); assert.doesNotMatch(JSON.stringify(published), /reports\.example/);
      }
      const current = await inventory.getAdmin(created.id);
      assert.equal(current.draft.source.kind, 'external');
      if (current.draft.source.kind === 'external') current.draft.source.listingUrl += '/unpublished-metadata';
      await inventory.save(current.id, current.version, current.draft, actor);
      assert.deepEqual((await inventory.getAdmin(created.id)).report, { hasReport: false, url: null });
      const changedPreview = await inventory.publicationPreview(created.id, 'en', actor);
      assert.deepEqual(changedPreview.vehicle.report, { hasReport: false }); assert.notEqual(changedPreview.fingerprint, preview.fingerprint);
      assert.deepEqual((await inventory.getPublic(created.id, 'en')).report, { hasReport: true });
      const listed = await inventory.listPublic({ locale: 'en', catalog: 'curated', page: 1, pageSize: 24 }, 'report-test');
      const listedVehicle = listed.data.items.find(item => item.id === created.id);
      assert.ok(listedVehicle);
      // Lists/home remain lightweight; public report entries are read through the separate paged endpoint.
      assert.equal(Object.hasOwn(listedVehicle, 'report'), false);
      await inventory.saveHome({ version: (await inventory.getHome()).version, sections: [{ id: 'report-fixture', title: { zh: '合成报告样例', en: 'Synthetic report fixture', ru: 'Синтетический пример' }, vehicleIds: [created.id] }] }, actor);
      const home = await inventory.publicHome('en');
      assert.equal(home.sections[0]!.vehicles[0]!.id, created.id);
      assert.equal(home.sections.some(section => section.vehicles.some(item => Object.hasOwn(item, 'report'))), false);
    });

    await t.test('legacy nested report URLs are cleared at public projection even without modern access metadata', async () => {
      const previous = (await db.pool.query('SELECT details FROM external_catalog WHERE listing_id=$1', [id])).rows[0].details;
      const legacy = structuredClone(previous); legacy.inspection.reportUrl = candidate.inspection!.reportUrl; delete legacy.inspection.reportAccess;
      await db.pool.query('UPDATE external_catalog SET details=$2 WHERE listing_id=$1', [id, legacy]);
      const vehicle = (await read())!;
      assert.equal(vehicle.external!.detail!.inspection!.reportUrl, null);
      assert.equal(vehicle.external!.detail!.inspection!.reportAccess!.url, null);
      assert.deepEqual(vehicle.report, { hasReport: true });
      assert.doesNotMatch(JSON.stringify(vehicle), /reports\.example/);
      await db.pool.query('UPDATE external_catalog SET details=$2 WHERE listing_id=$1', [id, previous]);
    });

    await t.test('archived enrichment restores only agreed content without rewriting upstream versions', async () => {
      const source = { source: 'che168', id: 'S-ARCHIVED-REPORT', status: 'active', updatedAt: iso(0),
        lifecycle: { detailFetchedAt: iso(0) }, url: 'https://www.che168.com/synthetic/archive', title: 'Synthetic archive vehicle', ownershipTransfers: 0 };
      const report = { id: source.id, source: source.source, checks: [{ category: 'Body', defects: 0, groups: [{ name: 'Exterior', defects: 0,
        items: [{ part: 'Door', result: null, ok: false }] }] }], defects: [] };
      const legacy = adaptChinaCarSample(source, iso(0), {}, [], report)!;
      delete legacy.history; delete legacy.inspection!.hasReport; delete legacy.inspection!.checks; delete legacy.inspection!.defects;
      const archiveStore = new ExternalStore(db, chinaCarSampleProfile);
      const batch = await archiveStore.importBatch({ provider: chinaCarSampleProfile.id, records: [{ candidate: legacy,
        raw: JSON.stringify({ sourceLine: JSON.stringify(source), inspection: report, evidence: [] }) }] }, randomUUID(), actor);
      const row = (await db.pool.query('SELECT * FROM external_listings WHERE external_id=$1', [source.id])).rows[0];
      assert.deepEqual((await getExternalPublic(db.pool, row.id, 'en', now))!.report, { hasReport: false });
      const before = { source_data: row.source_data, source_revision: row.source_revision, source_hash: row.source_hash };
      assert.equal((await getExternalPublic(db.pool, row.id, 'en', now))!.external!.detail!.history, undefined);
      assert.deepEqual(await enrichArchivedInspections(db, [{ batchId: batch.id, row: 1 }], actor.id), { applied: 1, unchanged: 0 });
      const after = await getExternalPublic(db.pool, row.id, 'en', now);
      assert.deepEqual(after!.report, { hasReport: true });
      assert.deepEqual(await getExternalReport(db.pool, row.id), { hasReport: true, url: null });
      assert.deepEqual(after!.external!.detail!.history, { ownershipTransfers: 0 });
      assert.equal(after!.external!.detail!.inspection!.checks![0]!.groups[0]!.items[0]!.ok, false);
      assert.equal(after!.external!.detail!.inspection!.reportAccess!.status, 'unknown');
      assert.deepEqual((await db.pool.query('SELECT source_data,source_revision,source_hash FROM external_listings WHERE id=$1', [row.id])).rows[0], before);
      const publicRevision = await revision();
      assert.deepEqual(await enrichArchivedInspections(db, [{ batchId: batch.id, row: 1 }], actor.id), { applied: 0, unchanged: 1 });
      assert.equal(await revision(), publicRevision);
      await archiveStore.saveOverrides(`ext-${row.id}`, { version: row.version, overrides: { hidden: false, facts: { mileageKm: 123 }, text: [] } }, randomUUID(), actor);
      assert.deepEqual((await getExternalPublic(db.pool, row.id, 'en', now))!.external!.detail!.history, { ownershipTransfers: 0 });
      const updated = { ...legacy, revision: legacy.revision + 1 };
      await archiveStore.importBatch({ provider: chinaCarSampleProfile.id, records: [{ candidate: updated, raw: JSON.stringify(updated) }] }, randomUUID(), actor);
      assert.equal((await getExternalPublic(db.pool, row.id, 'en', now))!.external!.detail!.history, undefined);
      assert.deepEqual((await getExternalPublic(db.pool, row.id, 'en', now))!.report, { hasReport: false });
      await assert.rejects(enrichArchivedInspections(db, [{ batchId: batch.id, row: 1 }], actor.id), { status: 409 });
    });
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    fetch.mock.restore(); await db.close();
    if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await maintenance.close();
  }
});
