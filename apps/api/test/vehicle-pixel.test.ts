import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EnabledPixelVehiclesResponseSchema } from '@hd/contracts/admin';
import { makeExternalCandidateFixture, makeExternalImportFixture, makeExternalWithdrawalFixture, makePublicVehicleFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import type { Locale } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createStaff } from '../src/staff-cli.js';

test('vehicle Pixel is an administrator setting with isolated detail and cache behavior', async t => {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
    url.pathname !== '/postgres' || url.search || url.hash) throw new Error('Isolated local maintenance database only');
  const maintenance = createDatabase(url.href, 1);
  const name = `hd_ext_scale_pixel_${randomBytes(8).toString('hex')}`;
  const media = await mkdtemp(path.join(tmpdir(), 'hd-vehicle-pixel-'));
  let runtime: Awaited<ReturnType<typeof buildApp>> | undefined;
  let created = false;
  t.after(async () => {
    try { await runtime?.app.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally {
        await maintenance.close();
        await rm(media, { recursive: true, force: true });
      }
    }
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external network calls in this test'); });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  const origin = 'http://127.0.0.1:3318';
  const peer = '192.0.2.10';
  const secret = randomBytes(32).toString('hex');
  const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: url.href, AUTH_SECRET: randomBytes(32).toString('hex'),
    MEDIA_ROOT: media, AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin, HD_DEPLOYMENT_ENV: 'test', HD_RELEASE_ID: 'a'.repeat(40),
    EXTERNAL_CATALOG_MODE: 'synthetic-scale', EXTERNAL_PUBLIC_CACHE: 'memory', TRUST_PROXY: `${peer}/32` });
  runtime = await buildApp({ ...config, ssrService: { secret, peers: [`${peer}/32`] } });
  const { app, db, auth } = runtime;
  await migrateDatabase(db);

  const login = async (role: 'admin' | 'editor') => {
    const email = `pixel-${role}@example.invalid`;
    const password = `${randomBytes(18).toString('hex')}!`;
    const account = await createStaff(auth, { email, password, name: `Isolated Pixel ${role}`, role });
    const reply = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email, password } });
    assert.equal(reply.statusCode, 200, reply.body);
    const cookie = reply.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    assert.ok(cookie);
    return { cookie, staffId: account.user.id };
  };
  const admin = await login('admin');
  const editor = await login('editor');
  const adminHeaders = { cookie: admin.cookie, origin };
  const staffId = randomUUID(), draftId = randomUUID(), publication = randomUUID();
  const draft = makeVehicleDraftFixture();
  const snapshot = { source: draft.source, facts: draft.facts, price: draft.price, content: draft.content, images: makePublicVehicleFixture().images };
  await db.transaction(async tx => {
    await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now()),($2,'available',now())", [staffId, draftId]);
    await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$3),($2,$3)', [staffId, draftId, JSON.stringify(draft)]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [publication, staffId, JSON.stringify(snapshot)]);
    await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [staffId, publication]);
  });
  const importVehicles = async (payload: ReturnType<typeof makeExternalImportFixture>) => {
    const reply = await app.inject({ method: 'POST', url: '/api/v1/admin/external/batches',
      headers: { ...adminHeaders, 'idempotency-key': randomUUID() }, payload });
    assert.equal(reply.statusCode, 201, reply.body);
    assert.equal(reply.json().data.counts.applied, 1, reply.body);
  };
  await importVehicles(makeExternalImportFixture(1));
  const { id: externalUuid, inquiry_number } = (await db.pool.query<{ id: string; inquiry_number: string }>(
    'SELECT id,inquiry_number::text FROM external_listings',
  )).rows[0]!;
  const externalId = `ext-${externalUuid}`;
  await db.pool.query('UPDATE home_config SET sections=$1 WHERE id=1', [JSON.stringify([
    { id: 'featured', title: { zh: '精选', en: 'Featured', ru: 'Избранное' }, vehicleIds: [staffId, externalId] },
    { id: 'recent', title: { zh: '新车', en: 'Recent', ru: 'Новое' }, vehicleIds: [] },
  ])]);

  const adminPath = (id: string) => id.startsWith('ext-') ? `/api/v1/admin/external/listings/${id}/pixel` : `/api/v1/admin/vehicles/${id}/pixel`;
  const read = (id: string, headers: Record<string, string> = adminHeaders) => app.inject({ url: adminPath(id), headers });
  const save = (id: string, version: number, pixelEnabled: boolean, headers: Record<string, string> = adminHeaders) =>
    app.inject({ method: 'PUT', url: adminPath(id), headers, payload: { version, pixelEnabled } });
  const assertSetting = (reply: Awaited<ReturnType<typeof read>>, vehicleId: string, version: number, pixelEnabled: boolean) => {
    assert.equal(reply.statusCode, 200, reply.body);
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.deepEqual(reply.json().data, { vehicleId, version, pixelEnabled });
    assert.equal(typeof reply.json().meta.requestId, 'string');
  };
  const enabled = (query = '?page=1&pageSize=12', headers: Record<string, string> = adminHeaders) =>
    app.inject({ url: `/api/v1/admin/vehicle-pixel/enabled${query}`, headers });
  const enabledPage = async (query?: string) => {
    const reply = await enabled(query);
    assert.equal(reply.statusCode, 200, reply.body);
    assert.equal(reply.headers['cache-control'], 'no-store');
    return EnabledPixelVehiclesResponseSchema.parse(reply.json()).data;
  };
  let visitor = 0;
  const publicRead = (route: string, internal = false) => app.inject({
    url: `${internal ? '/internal/public-catalog' : '/api/v1'}${route}`,
    remoteAddress: internal ? peer : `198.51.100.${(++visitor % 240) + 1}`,
    headers: internal ? { 'x-hd-ssr-key': secret, 'x-forwarded-for': `198.51.100.${(++visitor % 240) + 1}` } : undefined,
  });
  const detail = (id: string, locale: Locale, mode: 'legacy' | 'inline' | 'eligible' = 'eligible', internal = false) =>
    publicRead(`/vehicles/${id}?locale=${locale}&view=localized${mode === 'legacy' ? '' : '&projection=detail-inline-v1'}${mode === 'eligible' ? '&pixelView=eligible' : ''}`, internal);
  const assertDetail = async (id: string, locale: Locale, expected: boolean | undefined, mode?: 'legacy' | 'inline' | 'eligible', internal = false) => {
    const reply = await detail(id, locale, mode, internal);
    assert.equal(reply.statusCode, 200, reply.body);
    assert.equal(reply.json().data.pixelEnabled, expected);
    assert.equal(Object.hasOwn(reply.json().data, 'pixelEnabled'), expected !== undefined);
    return reply.json().meta.catalogCache.version as string;
  };
  const version = async (filters = false) => {
    const reply = await publicRead(`/version${filters ? '?scope=filters' : ''}`, true);
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json().data.version as string;
  };

  await t.test('only administrators can read the enabled index and empty pages are valid', async () => {
    assert.equal((await enabled(undefined, {})).statusCode, 401);
    assert.equal((await enabled(undefined, { cookie: editor.cookie })).statusCode, 403);
    for (const query of ['?page=0', '?pageSize=49', '?page=1&page=2', '?locale=zh']) {
      assert.equal((await enabled(query)).statusCode, 400, query);
    }
    assert.deepEqual(await enabledPage(), { page: 1, pageSize: 12, total: 0, items: [] });
    assert.deepEqual(await enabledPage(''), { page: 1, pageSize: 24, total: 0, items: [] });
  });

  await t.test('rejects unauthorized or ambiguous writes and defaults both identities to off', async () => {
    for (const id of [staffId, externalId]) {
      assert.equal((await read(id, {})).statusCode, 401);
      assert.equal((await read(id, { cookie: editor.cookie })).statusCode, 403);
      assert.equal((await save(id, 1, true, { cookie: editor.cookie, origin })).statusCode, 403);
      assert.equal((await save(id, 1, true, { ...adminHeaders, origin: 'https://elsewhere.example.invalid' })).statusCode, 403);
      const loose = await app.inject({ method: 'PUT', url: adminPath(id), headers: adminHeaders, payload: { version: 1, pixelEnabled: 'true' } });
      assert.equal(loose.statusCode, 400, loose.body);
      assertSetting(await read(id), id, 1, false);
      assertSetting(await save(id, 1, false), id, 1, false);
      await assertDetail(id, 'zh', false);
      await assertDetail(id, 'zh', undefined, 'inline');
    }
    assert.equal((await read(randomUUID())).statusCode, 404);
    assert.equal((await read(`ext-${randomUUID()}`)).statusCode, 404);
    const unsupported = await publicRead(`/vehicles/${staffId}?locale=zh&view=localized&pixelView=eligible`);
    assert.equal(unsupported.statusCode, 400, unsupported.body);
  });

  await t.test('committed changes refresh warm details for all locales and aliases with one audit per change', async () => {
    const filterVersion = await version(true);
    for (const [id, operation] of [[staffId, 'vehicle.pixel.update'], [externalId, 'external.pixel.update']] as const) {
      const before = await assertDetail(id, 'zh', false, 'eligible', true);
      for (const reply of await Promise.all([save(id, 1, true), save(id, 1, true)])) assertSetting(reply, id, 2, true);
      const after = await version();
      assert.notEqual(after, before);
      assert.equal(await version(true), filterVersion);
      assert.equal((await save(id, 1, false)).statusCode, 409);
      assertSetting(await save(id, 1, true), id, 2, true);
      assert.equal(await version(), after);
      for (const locale of ['zh', 'en', 'ru'] as const) {
        await assertDetail(id, locale, undefined, 'inline');
        assert.equal(await assertDetail(id, locale, true), after);
        assert.equal(await assertDetail(id, locale, true, 'eligible', true), after);
        await assertDetail(id, locale, undefined, 'inline', true);
        await assertDetail(id, locale, undefined, 'legacy');
      }
      const websiteDetail = `/vehicles/${id}?locale=zh&view=localized&projection=detail-inline-v1&priceView=usd&titleView=english&pixelView=eligible`;
      const websiteQuery = id === externalId ? `${websiteDetail}&technicalView=verified` : websiteDetail;
      for (const internal of [true, false]) {
        const reply = await publicRead(websiteQuery, internal);
        assert.equal(reply.statusCode, 200, reply.body);
        assert.equal(reply.json().data.pixelEnabled, true);
        assert.equal(reply.json().data.englishTitle.contentLocale, 'en');
      }
      const audit = (await db.pool.query(`SELECT actor_id,vehicle_id,old_version,new_version,changes FROM audit_events WHERE operation=$1`, [operation])).rows;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actor_id, admin.staffId);
      assert.equal(audit[0].vehicle_id, id === staffId ? staffId : null);
      assert.deepEqual([audit[0].old_version, audit[0].new_version], [1, 2]);
      assert.match(JSON.stringify(audit[0].changes), /pixelEnabled/);
      if (id === externalId) assert.ok(JSON.stringify(audit[0].changes).includes(externalUuid));
    }
    for (const query of ['/vehicles?locale=zh&view=localized', '/vehicles?locale=zh&view=localized&projection=card', '/home/vehicles?locale=zh&view=localized']) {
      const reply = await publicRead(query);
      assert.equal(reply.statusCode, 200, reply.body);
      const data = reply.json().data;
      const items: Array<{ id: string }> = data.items ?? data.sections.flatMap((section: { vehicles: unknown[] }) => section.vehicles);
      assert.deepEqual(new Set(items.map(item => item.id)), new Set([staffId, externalId]));
      assert.ok(items.every(item => !Object.hasOwn(item, 'pixelEnabled')));
    }
    assert.deepEqual((await db.pool.query('SELECT version,published_revision_id FROM vehicles WHERE id=$1', [staffId])).rows,
      [{ version: 1, published_revision_id: publication }]);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications')).rows[0]?.n, 1);
  });

  await t.test('the enabled index returns both types with public codes, Chinese titles and stable pagination', async () => {
    const { stock_number } = (await db.pool.query<{ stock_number: string }>(
      'SELECT stock_number::text FROM vehicles WHERE id=$1', [staffId],
    )).rows[0]!;
    const staffItem = { vehicleId: staffId, code: `HD-${stock_number.padStart(6, '0')}`, title: draft.content.title.sourceText };
    const externalItem = { vehicleId: externalId, code: `HX${inquiry_number}`, title: '示例 R1 混动' };
    assert.deepEqual(await enabledPage(), { page: 1, pageSize: 12, total: 2, items: [staffItem, externalItem] });
    assert.deepEqual(await enabledPage('?page=1&pageSize=1'), { page: 1, pageSize: 1, total: 2, items: [staffItem] });
    assert.deepEqual(await enabledPage('?page=2&pageSize=1'), { page: 2, pageSize: 1, total: 2, items: [externalItem] });
    assert.deepEqual(await enabledPage('?page=3&pageSize=1'), { page: 3, pageSize: 1, total: 2, items: [] });
  });

  await t.test('supplier refresh, hidden listings, drafts, disable and rollback preserve their respective state', async () => {
    const initial = makeExternalCandidateFixture();
    const candidate = { ...initial, revision: 2, sourceUpdatedAt: initial.fetchedAt };
    await importVehicles({ ...makeExternalImportFixture(1), records: [{ candidate, raw: JSON.stringify(candidate) }] });
    const listing = await app.inject({ url: `/api/v1/admin/external/listings/${externalId}?locale=zh`, headers: adminHeaders });
    assert.equal(listing.statusCode, 200, listing.body);
    assert.equal(listing.json().data.sourceRevision, 2);
    assertSetting(await read(externalId), externalId, 2, true);
    await assertDetail(externalId, 'zh', true);
    assertSetting(await save(externalId, 2, false), externalId, 3, false);
    await assertDetail(externalId, 'zh', false, 'eligible', true);
    assert.deepEqual((await enabledPage()).items.map(item => item.vehicleId), [staffId]);
    assertSetting(await save(externalId, 3, true), externalId, 4, true);
    const hidden = await app.inject({ method: 'POST', url: '/api/v1/admin/external/listings/bulk-visibility',
      headers: { ...adminHeaders, 'idempotency-key': randomUUID() }, payload: { hidden: true, items: [{ id: externalId, version: listing.json().data.version }] } });
    assert.equal(hidden.statusCode, 200, hidden.body);
    assert.equal(hidden.json().data.items[0].status, 'applied');
    assertSetting(await read(externalId), externalId, 4, true);
    assert.equal((await detail(externalId, 'zh')).statusCode, 404);
    assert.deepEqual((await enabledPage()).items.map(item => item.vehicleId), [staffId, externalId]);
    await importVehicles(makeExternalWithdrawalFixture(1, 3));
    assert.equal((await db.pool.query('SELECT listing_id FROM external_catalog WHERE listing_id=$1', [externalUuid])).rowCount, 0);
    const withdrawn = await enabledPage();
    assert.equal(withdrawn.total, 2);
    assert.deepEqual(withdrawn.items[1], { vehicleId: externalId, code: `HX${inquiry_number}`, title: '示例 R1 混动' });
    assertSetting(await save(externalId, 4, false), externalId, 5, false);
    assert.deepEqual((await enabledPage()).items.map(item => item.vehicleId), [staffId]);
    assertSetting(await save(draftId, 1, true), draftId, 2, true);
    assert.equal((await detail(draftId, 'zh')).statusCode, 404);
    assert.deepEqual((await db.pool.query('SELECT publication_state,published_revision_id FROM vehicles WHERE id=$1', [draftId])).rows,
      [{ publication_state: 'draft', published_revision_id: null }]);
    assert.deepEqual((await enabledPage()).items.map(item => item.vehicleId), [staffId, draftId].sort());
    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/admin/vehicles/${draftId}`,
      headers: { ...adminHeaders, 'idempotency-key': randomUUID() }, payload: { version: 1 } });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal((await read(draftId)).statusCode, 404);
    assert.equal((await save(draftId, 2, false)).statusCode, 404);
    assert.deepEqual((await enabledPage()).items.map(item => item.vehicleId), [staffId]);
    const restored = await app.inject({ method: 'POST', url: `/api/v1/admin/vehicles/${draftId}/restore`,
      headers: { ...adminHeaders, 'idempotency-key': randomUUID() }, payload: { version: deleted.json().data.version } });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.publicationState, 'draft');
    assertSetting(await read(draftId), draftId, 2, true);
    assert.equal((await detail(draftId, 'zh')).statusCode, 404);
    assert.deepEqual((await enabledPage()).items.map(item => item.vehicleId), [staffId, draftId].sort());

    const beforeDisable = await assertDetail(staffId, 'zh', true);
    assertSetting(await save(staffId, 2, false), staffId, 3, false);
    const afterDisable = await assertDetail(staffId, 'zh', false, 'eligible', true);
    assert.notEqual(afterDisable, beforeDisable);
    await db.pool.query("ALTER TABLE audit_events ADD CONSTRAINT pixel_test_reject_audit CHECK (operation <> 'vehicle.pixel.update') NOT VALID");
    try {
      assert.equal((await save(staffId, 3, true)).statusCode, 500);
      assertSetting(await read(staffId), staffId, 3, false);
      assert.equal(await version(), afterDisable);
      await assertDetail(staffId, 'zh', false);
    } finally {
      await db.pool.query('ALTER TABLE audit_events DROP CONSTRAINT pixel_test_reject_audit');
    }
  });
});
