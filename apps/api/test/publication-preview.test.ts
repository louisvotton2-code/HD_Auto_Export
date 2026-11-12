import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { InjectOptions } from 'fastify';
import sharp from 'sharp';
import { makeDemoVehicleDraftFixture, makeExternalVehicleDraftFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { AdminVehicleResponseSchema, PublicationPreviewResponseSchema, PublishReadinessResponseSchema,
  VehicleLocalizationSchema, type AdminVehicle, type PublicationPreview, type PublicationPreviewText, type VehicleDraftInput } from '@hd/contracts/admin';
import { PublicVehicleResponseSchema, type Locale } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { ApiError } from '../src/errors.js';
import { seedSyntheticFx } from '../src/external/fx.js';
import { LocalMediaStore } from '../src/media/storage.js';
import { createStaff, setStaffEnabled } from '../src/staff-cli.js';
import { InventoryService } from '../src/vehicles/service.js';

function maintenanceAddress() {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/postgres' || url.search || url.hash) throw new Error('Preview tests require a local PostgreSQL maintenance URL without options.');
  return url;
}
async function localTransport(url: URL) {
  const socket = process.env.API_TEST_DATABASE_SOCKET;
  if (socket === undefined) return url.toString();
  if (!path.isAbsolute(socket) || !(await stat(path.join(socket, `.s.PGSQL.${url.port || '5432'}`))).isSocket()) {
    throw new Error('API_TEST_DATABASE_SOCKET must name an existing local PostgreSQL socket directory.');
  }
  const transport = new URL(url);
  transport.searchParams.set('host', socket);
  return transport.toString();
}

test('publication preview gates use current persisted data and an actor-specific confirmation', async t => {
  const maintenanceUrl = maintenanceAddress();
  const databaseName = `hd_ext_scale_preview_${randomBytes(8).toString('hex')}`;
  const databaseUrl = new URL(maintenanceUrl); databaseUrl.pathname = `/${databaseName}`;
  const maintenance = createDatabase(await localTransport(maintenanceUrl), 2);
  const mediaRoot = await mkdtemp(path.join(tmpdir(), 'hd-publication-preview-'));
  const fetchSpy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network is forbidden in publication integration tests.'); });
  let runtime: Awaited<ReturnType<typeof buildApp>> | undefined;
  let created = false;
  try {
    await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`); created = true;
    const origin = 'http://127.0.0.1:3318';
    const config = readConfig({ NODE_ENV: 'test', HOST: '127.0.0.1', DATABASE_URL: databaseUrl.toString(),
      AUTH_SECRET: randomBytes(32).toString('hex'), AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin,
      MEDIA_ROOT: mediaRoot, EXTERNAL_CATALOG_MODE: 'synthetic-scale', EXTERNAL_PUBLIC_CACHE: 'off', TRANSLATION_PROVIDER: 'disabled' });
    // The same isolated database and credentials use an explicitly validated local socket;
    // readConfig still validates the normal TCP URL, without relaxing production guards.
    const app = runtime = await buildApp({ ...config, databaseUrl: await localTransport(databaseUrl) });
    await migrateDatabase(app.db);
    await seedSyntheticFx(app.db, 'a');
    let requestCounter = 0;
    const call = (options: InjectOptions) => app.app.inject({ ...options,
      remoteAddress: `198.51.${Math.floor(requestCounter / 240)}.${++requestCounter % 240 + 1}` });
    const password = 'Isolated_preview_password_903!';
    async function staff(email: string) {
      const user = await createStaff(app.auth, { email, name: 'Preview test editor', role: 'editor', password });
      const response = await call({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email, password } });
      assert.equal(response.statusCode, 200, response.body);
      return { id: user.user.id, email, cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; ') };
    }
    const editor = await staff('preview-editor@example.invalid');
    const colleague = await staff('preview-colleague@example.invalid');
    const headers = (cookie = editor.cookie) => ({ cookie, origin });
    const endpoint = (id: string, suffix = '') => `/api/v1/admin/vehicles/${id}${suffix}`;
    const proof = (preview: PublicationPreview) => ({ version: preview.vehicleVersion,
      publicContentRevision: preview.publicContentRevision, fingerprint: preview.fingerprint, locale: preview.locale });
    async function get(id: string) { return app.inventory.getAdmin(id); }
    async function create(value: VehicleDraftInput) {
      const response = await call({ method: 'POST', url: '/api/v1/admin/vehicles', headers: { ...headers(), 'idempotency-key': randomUUID() }, payload: { draft: value } });
      assert.equal(response.statusCode, 201, response.body); return AdminVehicleResponseSchema.parse(response.json()).data;
    }
    async function save(vehicle: AdminVehicle) {
      const response = await call({ method: 'PATCH', url: endpoint(vehicle.id), headers: headers(), payload: { version: vehicle.version, draft: vehicle.draft } });
      assert.equal(response.statusCode, 200, response.body); return AdminVehicleResponseSchema.parse(response.json()).data;
    }
    async function preview(id: string, locale: Locale = 'zh', cookie = editor.cookie) {
      const response = await call({ url: endpoint(id, `/publication-preview?locale=${locale}`), headers: headers(cookie) });
      assert.equal(response.statusCode, 200, response.body); return PublicationPreviewResponseSchema.parse(response.json()).data;
    }
    async function readiness(id: string, locale: Locale = 'zh', cookie = editor.cookie) {
      const response = await call({ url: endpoint(id, `/publish-readiness?locale=${locale}`), headers: headers(cookie) });
      assert.equal(response.statusCode, 200, response.body); return PublishReadinessResponseSchema.parse(response.json()).data;
    }
    const confirm = (id: string, value: PublicationPreview, cookie = editor.cookie) => call({ method: 'POST',
      url: endpoint(id, '/publication-preview/confirm'), headers: headers(cookie), payload: proof(value) });
    async function confirmed(vehicle: AdminVehicle, locale: Locale = 'zh') {
      const value = await preview(vehicle.id, locale);
      const response = await confirm(vehicle.id, value);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(PublishReadinessResponseSchema.parse(response.json()).data.canPublish, true);
      return value;
    }
    const publish = (vehicle: AdminVehicle, key = randomUUID(), cookie = editor.cookie) => call({ method: 'POST',
      url: endpoint(vehicle.id, '/publish'), headers: { ...headers(cookie), 'idempotency-key': key }, payload: { version: vehicle.version } });
    async function published(vehicle: AdminVehicle) {
      await confirmed(vehicle); const response = await publish(vehicle);
      assert.equal(response.statusCode, 200, response.body); return AdminVehicleResponseSchema.parse(response.json()).data;
    }
    async function localization(id: string) {
      const response = await call({ url: endpoint(id, '/localization'), headers: headers() });
      assert.equal(response.statusCode, 200, response.body); return VehicleLocalizationSchema.parse(response.json().data);
    }
    async function saveLocalization(value: Awaited<ReturnType<typeof localization>>) {
      const response = await call({ method: 'PUT', url: endpoint(value.vehicleId, '/localization'), headers: headers(),
        payload: { vehicleVersion: value.vehicleVersion, revision: value.revision, data: value.data } });
      assert.equal(response.statusCode, 200, response.body); return get(value.vehicleId);
    }
    async function approveDisplay(id: string) {
      const value = await localization(id);
      for (const field of value.data.fields) for (const locale of ['zh', 'en', 'ru'] as const) {
        field.translations[locale] = { text: `${field.sourceText} (${locale})`, kind: 'human', reviewStatus: 'approved',
          sourceVersion: field.sourceVersion, humanEditVersion: field.translations[locale]?.humanEditVersion ?? 0, engineVersion: null };
      }
      return saveLocalization(value);
    }
    async function upload(vehicle: AdminVehicle) {
      const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#234567' } }).png().toBuffer();
      const source = vehicle.draft.source;
      const rights = source.kind === 'external' ? { basis: 'unverified' as const, note: 'Isolated synthetic image.',
        source: { listingUrl: source.listingUrl, imageUrl: 'https://example.invalid/synthetic.png', collectedAt: source.collectedAt } }
        : { basis: 'owned' as const, note: 'Generated for the isolated test.' };
      const actor = { id: editor.id, requestId: randomUUID() };
      const permit = await app.media.create({ vehicleId: vehicle.id, contentType: 'image/png', sizeBytes: png.length, rights }, actor);
      const uploaded = await app.media.upload(permit.media.id, permit.media.version, png, 'image/png', actor);
      return app.media.complete(uploaded.id, uploaded.version, actor);
    }
    function draft(kind: 'manual' | 'external' | 'demo' = 'manual') {
      const value = kind === 'manual' ? makeVehicleDraftFixture() : kind === 'external' ? makeExternalVehicleDraftFixture() : makeDemoVehicleDraftFixture();
      value.media = [];
      if (value.source.kind === 'external') {
        value.source.externalId = `preview-${randomUUID()}`;
        value.source.listingUrl = `https://example.invalid/listings/${value.source.externalId}`;
      }
      if (kind !== 'demo') {
        value.facts.trim = { id: 'test_trim', name: 'Synthetic configuration' };
        value.facts.mileageKm = 0;
        value.internal = { purchaseCost: { amount: '12345.67', currency: 'USD' }, notes: 'PRIVATE_PREVIEW_NOTE', supplierContact: 'PRIVATE_PREVIEW_CONTACT', vin: 'LTEST123456789012' };
        for (const field of Object.values(value.content)) for (const locale of ['zh', 'en', 'ru'] as const) {
          field.translations[locale]!.reviewStatus = 'approved';
        }
      }
      return value;
    }
    async function ready(kind: 'manual' | 'external' | 'demo' = 'manual', currency: 'USD' | 'CNY' = 'USD') {
      const value = draft(kind);
      if (value.price.money) value.price.money.currency = currency;
      let vehicle = await create(value); const media = await upload(vehicle);
      vehicle.draft.media = [{ id: media.id, alt: 'Synthetic cover', sortOrder: 0, isCover: true }];
      vehicle = await save(vehicle);
      if (kind === 'manual') {
        const response = await call({ method: 'POST', url: endpoint(vehicle.id, '/availability'), headers: headers(),
          payload: { version: vehicle.version, availability: 'available', checkedAt: new Date().toISOString() } });
        assert.equal(response.statusCode, 200, response.body); vehicle = AdminVehicleResponseSchema.parse(response.json()).data;
      }
      return approveDisplay(vehicle.id);
    }
    async function publicDetail(id: string, locale: Locale = 'zh') {
      const response = await call({ url: `/api/v1/vehicles/${id}?locale=${locale}&view=localized&priceView=usd` });
      assert.equal(response.statusCode, 200, response.body); return PublicVehicleResponseSchema.parse(response.json()).data;
    }
    async function allPreviews(vehicle: AdminVehicle) {
      const values: PublicationPreview[] = [];
      for (const locale of ['zh', 'en', 'ru'] as const) values.push(await preview(vehicle.id, locale));
      // Actual reviewed display text differs by language and from the raw source.
      // Comparing two raw responses would otherwise miss a shared projection regression.
      assert.equal(new Set(values.map(value => value.vehicle.facts.model?.name)).size, 3);
      for (const value of values) {
        assert.notEqual(value.vehicle.facts.model?.name, vehicle.draft.facts.model?.name);
        assert.notEqual(value.vehicle.images[0]!.alt, vehicle.draft.media[0]!.alt);
        if (vehicle.draft.price.includes.length) assert.notDeepEqual(value.vehicle.price.includes, vehicle.draft.price.includes);
        if (vehicle.draft.source.kind === 'external' && value.vehicle.source.kind === 'external') {
          assert.notEqual(value.vehicle.source.platform.name, vehicle.draft.source.platform.name);
        }
      }
      return values;
    }
    async function assertPublishedMatchesPreview(previews: PublicationPreview[]) {
      for (const value of previews) {
        const before = value.vehicle, after = await publicDetail(before.id, value.locale);
        assert.deepEqual(after.facts, before.facts); assert.deepEqual(after.source, before.source);
        const { status: _previewPriceStatus, displayPrice, ...price } = before.price;
        assert.deepEqual(after.price, price); assert.deepEqual(after.displayPrice, displayPrice);
        assert.deepEqual(after.images.map(({ id, alt, width, height, sortOrder, isCover }) => ({ id, alt, width, height, sortOrder, isCover })),
          before.images.map(({ id, alt, width, height, sortOrder, isCover }) => ({ id, alt, width, height, sortOrder, isCover })));
        assert.equal(after.availability, before.availability); assert.equal(after.availabilityCheckedAt, before.availabilityCheckedAt);
        for (const field of ['title', 'description'] as const) {
          const text = before.content[field];
          assert.deepEqual(after.content[field], { text: text.text, requestedLocale: text.requestedLocale,
            contentLocale: text.contentLocale, kind: text.kind, reviewed: before.source.kind === 'manual' && text.reviewStatus === 'approved' });
        }
        const displayed = (text: PublicationPreviewText) => ({ text: text.text, requestedLocale: text.requestedLocale,
          contentLocale: text.contentLocale, status: text.text === null ? 'missing' : 'ready', provenance: text.kind,
          reviewed: text.kind === 'catalog' || (before.source.kind === 'manual' && text.reviewStatus === 'approved') });
        assert.ok(after.display);
        for (const field of ['make', 'model', 'trim', 'generation', 'city', 'location', 'platform'] as const) {
          assert.deepEqual(after.display[field], displayed(before.display[field]));
        }
        assert.deepEqual(after.display.priceIncludes, before.display.priceIncludes.map(item => ({ id: item.id, value: displayed(item.value) })));
        assert.deepEqual(after.display.mediaAlt, before.display.mediaAlt.map(item => ({ mediaId: item.mediaId, value: displayed(item.value) })));
      }
    }
    async function rejectedPublish(vehicle: AdminVehicle) {
      const before = await get(vehicle.id);
      const count = (await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows[0].n;
      const response = await publish(vehicle);
      assert.equal(response.statusCode, 422, response.body);
      assert.deepEqual(await get(vehicle.id), before);
      assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows[0].n, count);
      return response;
    }
    async function rejectedStaleProof(operation: Promise<unknown>) {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422); assert.equal(error.code, 'PUBLISH_VALIDATION_FAILED');
        assert.ok(error.fields?.some(field => field.path === 'publicationPreview'));
        assert.ok(!error.fields?.some(field => field.path.startsWith('draft.media')));
        return true;
      });
    }

    await t.test('missing amounts persist without becoming zero and cannot be confirmed or published', async () => {
      const value = draft(); value.price = { kind: 'asking', money: { amount: null, currency: 'CNY' }, includes: [] };
      value.internal.purchaseCost = { amount: null, currency: 'USD' };
      let vehicle = await create(value);
      assert.deepEqual((await get(vehicle.id)).draft.price, value.price);
      assert.deepEqual((await get(vehicle.id)).draft.internal.purchaseCost, value.internal.purchaseCost);
      for (const money of [null, { amount: null, currency: 'CNY' as const }, { amount: '0', currency: 'CNY' as const }]) {
        vehicle.draft.price = { kind: 'asking', money, includes: [] }; vehicle = await save(vehicle);
        const state = await readiness(vehicle.id);
        assert.equal(state.requiredFieldsReady, false); assert.equal(state.canPublish, false);
        assert.ok(state.issues.some(issue => issue.path === 'draft.price'));
        assert.ok(state.issues.some(issue => issue.path === 'draft.internal.purchaseCost'));
        const view = await preview(vehicle.id);
        assert.equal(view.vehicle.price.status, money?.amount === '0' ? 'ready' : 'missing');
        if (money?.amount !== '0') assert.equal(view.vehicle.price.displayPrice, null);
        assert.equal((await confirm(vehicle.id, view)).statusCode, 422);
        await rejectedPublish(vehicle);
      }
      assert.equal((await call({ url: `/api/v1/vehicles/${vehicle.id}?locale=zh` })).statusCode, 404);
    });

    await t.test('preview is private, strict and locale-specific; confirmation requires a trusted authenticated caller', async () => {
      const vehicle = await ready();
      for (const suffix of ['/publish-readiness?locale=zh', '/publication-preview?locale=zh']) {
        assert.equal((await call({ url: endpoint(vehicle.id, suffix) })).statusCode, 401);
      }
      const view = await preview(vehicle.id, 'ru');
      assert.equal(view.locale, 'ru'); assert.equal(view.priceView, 'usd');
      assert.equal(view.vehicle.content.title.requestedLocale, 'ru');
      assert.equal(view.vehicle.facts.mileageKm, 0);
      assert.ok(view.vehicle.images.every(image => image.status === 'ready' && image.url?.startsWith('/api/v1/admin/media/')));
      const serialized = JSON.stringify(view);
      for (const secret of ['internal', 'purchaseCost', 'supplierContact', 'PRIVATE_PREVIEW_NOTE', 'PRIVATE_PREVIEW_CONTACT', 'LTEST123456789012', '12345.67']) assert.ok(!serialized.includes(secret), secret);
      const image = view.vehicle.images[0]!;
      assert.equal((await call({ url: image.url! })).statusCode, 401);
      assert.equal((await call({ url: image.url!, headers: headers() })).statusCode, 200);
      const url = endpoint(vehicle.id, '/publication-preview/confirm');
      assert.equal((await call({ method: 'POST', url, payload: proof(view) })).statusCode, 401);
      for (const originHeaders of [{ cookie: editor.cookie }, { cookie: editor.cookie, origin: 'https://untrusted.example' }]) {
        assert.equal((await call({ method: 'POST', url, headers: originHeaders, payload: proof(view) })).statusCode, 403);
      }
      assert.equal((await call({ url: endpoint(vehicle.id, '/publication-preview?locale=de'), headers: headers() })).statusCode, 400);
      assert.equal((await readiness(vehicle.id, 'ru')).previewConfirmed, false);
      await confirmed(vehicle, 'ru');
      assert.equal((await readiness(vehicle.id, 'ru')).canPublish, true);
      assert.equal((await readiness(vehicle.id, 'zh')).previewConfirmed, false);
      const response = await publish(vehicle); assert.equal(response.statusCode, 200, response.body);
    });

    await t.test('first publication requires confirmation, is actor-isolated and replays its historical receipt', async () => {
      let vehicle = await ready();
      vehicle.draft.facts.location = { country: 'CN', city: 'Original fixture city', displayName: 'Original fixture depot' };
      vehicle = await save(vehicle); vehicle = await approveDisplay(vehicle.id);
      const unconfirmed = await rejectedPublish(vehicle);
      assert.ok(unconfirmed.json().error.fields.some((issue: { path: string }) => issue.path === 'publicationPreview'));
      await confirmed(vehicle);
      assert.equal((await readiness(vehicle.id, 'zh', colleague.cookie)).previewConfirmed, false);
      assert.equal((await publish(vehicle, randomUUID(), colleague.cookie)).statusCode, 422);
      const views = await allPreviews(vehicle);
      const originalVersion = vehicle.version, key = randomUUID();
      const result = await publish(vehicle, key); assert.equal(result.statusCode, 200, result.body);
      const receipt = AdminVehicleResponseSchema.parse(result.json()).data;
      assert.equal(receipt.publicationState, 'published'); assert.ok(receipt.publishedRevisionId);
      const publicValue = await publicDetail(vehicle.id); assert.equal(publicValue.facts.mileageKm, 0);
      assert.equal(publicValue.price.money?.amount, '23500.00');
      await assertPublishedMatchesPreview(views);
      vehicle = await get(vehicle.id); vehicle.draft.internal.notes = 'A subsequent private edit'; vehicle = await save(vehicle);
      const replay = await publish({ ...vehicle, version: originalVersion }, key);
      assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json().data, receipt);
      assert.equal((await publish({ ...vehicle, version: originalVersion })).statusCode, 409);
      assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows[0].n, 1);
    });

    await t.test('archiving revokes confirmation and historical publish replay cannot put a vehicle back online', async () => {
      const original = await ready(); const oldPreview = await confirmed(original), oldKey = randomUUID();
      const first = await publish(original, oldKey); assert.equal(first.statusCode, 200, first.body);
      const receipt = AdminVehicleResponseSchema.parse(first.json()).data;
      const removed = await call({ method: 'POST', url: endpoint(receipt.id, '/archive'), headers: headers(), payload: { version: receipt.version } });
      assert.equal(removed.statusCode, 200, removed.body);
      const archived = AdminVehicleResponseSchema.parse(removed.json()).data;
      assert.equal(archived.publicationState, 'archived'); assert.ok(archived.version > receipt.version);
      const state = await readiness(archived.id);
      assert.ok(state.publicContentRevision > oldPreview.publicContentRevision); assert.equal(state.previewConfirmed, false);
      const blocked = await rejectedPublish(archived);
      assert.ok(blocked.json().error.fields.some((field: { path: string }) => field.path === 'publicationPreview'));
      assert.equal((await call({ url: `/api/v1/vehicles/${archived.id}?locale=zh` })).statusCode, 404);

      const replay = await publish(original, oldKey);
      assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json().data, receipt);
      assert.deepEqual(await get(archived.id), archived);
      assert.equal((await call({ url: `/api/v1/vehicles/${archived.id}?locale=zh` })).statusCode, 404);
      assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [archived.id])).rows[0].n, 1);

      const fresh = await confirmed(archived); assert.ok(fresh.publicContentRevision > oldPreview.publicContentRevision);
      const republished = await publish(archived, randomUUID()); assert.equal(republished.statusCode, 200, republished.body);
      const current = AdminVehicleResponseSchema.parse(republished.json()).data;
      assert.equal(current.publicationState, 'published'); assert.notEqual(current.publishedRevisionId, receipt.publishedRevisionId);
      assert.equal((await publicDetail(current.id)).id, current.id);
      assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [current.id])).rows[0].n, 2);
    });

    await t.test('private saves retain an existing confirmation and translations but reject an old vehicle-version proof', async () => {
      let vehicle = await ready(); const old = await confirmed(vehicle);
      const beforeLocalization = await localization(vehicle.id), beforeContent = structuredClone(vehicle.draft.content);
      vehicle.draft.internal.notes = 'Changed only internal metadata';
      vehicle.draft.internal.purchaseCost = { amount: '10000.00', currency: 'CNY' }; vehicle = await save(vehicle);
      const current = await readiness(vehicle.id);
      assert.equal(current.publicContentRevision, old.publicContentRevision); assert.equal(current.fingerprint, old.fingerprint);
      assert.equal(current.previewConfirmed, true); assert.equal(current.canPublish, true);
      assert.deepEqual(vehicle.draft.content, beforeContent);
      const afterLocalization = await localization(vehicle.id);
      // Save bookkeeping may advance the sidecar revision; no text, approval or source version changes.
      assert.deepEqual(afterLocalization.data, beforeLocalization.data);
      assert.equal((await confirm(vehicle.id, old)).statusCode, 409);
      const response = await publish(vehicle); assert.equal(response.statusCode, 200, response.body);
    });

    await t.test('public A to B to A cannot restore an old proof, while a rejected edit leaves the prior publication online', async () => {
      let vehicle = await published(await ready()); const live = await publicDetail(vehicle.id);
      const old = await confirmed(vehicle);
      assert.ok(vehicle.draft.price.money); vehicle.draft.price.money.amount = '25000.00'; vehicle = await save(vehicle);
      const changed = await readiness(vehicle.id); assert.ok(changed.publicContentRevision > old.publicContentRevision);
      assert.equal(changed.previewConfirmed, false); await rejectedPublish(vehicle);
      assert.deepEqual(await publicDetail(vehicle.id), live);
      assert.ok(vehicle.draft.price.money); vehicle.draft.price.money.amount = '23500.00'; vehicle = await save(vehicle);
      const restored = await readiness(vehicle.id); assert.ok(restored.publicContentRevision > changed.publicContentRevision);
      assert.notEqual(restored.fingerprint, old.fingerprint); assert.equal(restored.previewConfirmed, false);
      assert.equal((await confirm(vehicle.id, old)).statusCode, 409);
      assert.equal((await confirm(vehicle.id, { ...old, vehicleVersion: vehicle.version })).statusCode, 409);
      assert.deepEqual(await publicDetail(vehicle.id), live);
    });

    await t.test('sidecar review, image references and inventory changes each invalidate a fresh confirmation', async () => {
      let vehicle = await ready(); let old = await confirmed(vehicle);
      const display = await localization(vehicle.id), model = display.data.fields.find(field => field.ref === 'model')!;
      model.translations.ru!.reviewStatus = 'pending'; vehicle = await saveLocalization(display);
      let state = await readiness(vehicle.id);
      assert.equal(state.localizationReady, false); assert.equal(state.previewConfirmed, false);
      assert.ok(state.publicContentRevision > old.publicContentRevision);
      assert.ok(state.issues.some(issue => issue.path === 'localization.model.ru'));
      await rejectedPublish(vehicle); vehicle = await approveDisplay(vehicle.id); old = await confirmed(vehicle);
      const second = await upload(vehicle);
      vehicle.draft.media = [{ id: second.id, alt: 'New synthetic cover', sortOrder: 0, isCover: true }]; vehicle = await save(vehicle);
      state = await readiness(vehicle.id); assert.equal(state.previewConfirmed, false); assert.ok(state.publicContentRevision > old.publicContentRevision);
      assert.equal((await preview(vehicle.id)).vehicle.images[0]!.id, second.id);
      vehicle = await approveDisplay(vehicle.id); old = await confirmed(vehicle);
      const inventory = await call({ method: 'POST', url: endpoint(vehicle.id, '/availability'), headers: headers(),
        payload: { version: vehicle.version, availability: 'reserved', checkedAt: new Date().toISOString() } });
      assert.equal(inventory.statusCode, 200, inventory.body); vehicle = inventory.json().data;
      state = await readiness(vehicle.id); assert.equal(state.requiredFieldsReady, true); assert.equal(state.previewConfirmed, false);
      assert.ok(state.publicContentRevision > old.publicContentRevision); assert.equal((await preview(vehicle.id)).vehicle.availability, 'reserved');
      await rejectedPublish(vehicle);
    });

    await t.test('readable files and current FX are part of proof freshness even without a vehicle save', async () => {
      const vehicle = await ready('manual', 'CNY'); let old = await confirmed(vehicle);
      await seedSyntheticFx(app.db, 'b');
      const changed = await readiness(vehicle.id);
      assert.equal(changed.vehicleVersion, old.vehicleVersion); assert.equal(changed.publicContentRevision, old.publicContentRevision);
      assert.notEqual(changed.fingerprint, old.fingerprint); assert.equal(changed.previewConfirmed, false);
      assert.equal((await confirm(vehicle.id, old)).statusCode, 409); await rejectedPublish(vehicle);
      old = await confirmed(vehicle);
      const image = vehicle.draft.media[0]!; await unlink(path.join(mediaRoot, `${image.id}.webp`));
      const missing = await readiness(vehicle.id);
      assert.equal(missing.requiredFieldsReady, false); assert.equal(missing.previewConfirmed, false);
      assert.notEqual(missing.fingerprint, old.fingerprint);
      const view = await preview(vehicle.id); assert.equal(view.vehicle.images[0]!.status, 'missing'); assert.equal(view.vehicle.images[0]!.url, null);
      assert.equal((await confirm(vehicle.id, view)).statusCode, 422); await rejectedPublish(vehicle);
    });

    await t.test('staff-created external copies cannot bypass purchase cost, description, or three-language approval', async () => {
      let vehicle = await ready('external');
      assert.equal(vehicle.availability, 'unknown'); assert.equal(vehicle.availabilityCheckedAt, null);
      const old = await confirmed(vehicle);
      vehicle.draft.internal.purchaseCost = { amount: null, currency: 'CNY' }; vehicle = await save(vehicle);
      assert.equal((await readiness(vehicle.id)).requiredFieldsReady, false); await rejectedPublish(vehicle);
      vehicle.draft.internal.purchaseCost = { amount: '9000', currency: 'CNY' };
      vehicle.draft.content.description.translations.en!.reviewStatus = 'pending'; vehicle = await save(vehicle);
      const pending = await readiness(vehicle.id); assert.equal(pending.localizationReady, false); assert.equal(pending.previewConfirmed, false);
      assert.ok(pending.issues.some(issue => issue.path === 'draft.content.description.translations.en'));
      await rejectedPublish(vehicle);
      vehicle.draft.content.description.sourceText = null;
      vehicle.draft.content.description.translations = { zh: null, en: null, ru: null }; vehicle = await save(vehicle);
      assert.ok((await readiness(vehicle.id)).issues.some(issue => issue.path === 'draft.content.description.sourceText'));
      await rejectedPublish(vehicle); assert.equal((await confirm(vehicle.id, old)).statusCode, 409);
      const complete = await ready('external'); const response = await publish(await get(complete.id)); assert.equal(response.statusCode, 422);
      const views = await allPreviews(complete);
      const publishedCopy = await published(complete); const result = await publicDetail(publishedCopy.id);
      assert.equal(result.source.kind, 'external'); assert.equal(result.price.kind, 'reference'); assert.equal(result.availability, 'unknown');
      await assertPublishedMatchesPreview(views);
    });

    await t.test('demo keeps its existing data rules and still requires preview confirmation', async () => {
      const vehicle = await ready('demo'); const state = await readiness(vehicle.id);
      assert.equal(state.requiredFieldsReady, true); assert.equal(state.localizationReady, true); assert.equal(state.previewConfirmed, false);
      assert.equal(vehicle.draft.internal.purchaseCost, null); assert.equal(vehicle.draft.facts.mileageKm, null);
      await rejectedPublish(vehicle); const result = await published(vehicle);
      assert.equal((await publicDetail(result.id)).price.kind, 'on_request');
    });

    await t.test('confirmation expiring during image preparation is rechecked before committing publication', async () => {
      const vehicle = await ready(); await confirmed(vehicle);
      const realStore = new LocalMediaStore(mediaRoot); let entered = false, activeAtPreparation: boolean | undefined;
      const inventory = new InventoryService(app.db, false, { async prepareDelivery(id, variant) {
        entered = true;
        activeAtPreparation = (await app.db.pool.query('SELECT expires_at>clock_timestamp() AS active FROM publication_preview_confirmations WHERE vehicle_id=$1 AND actor_id=$2', [vehicle.id, editor.id])).rows[0].active;
        await delay(1100);
        return realStore.prepareDelivery(id, variant);
      } });
      await app.db.pool.query("UPDATE publication_preview_confirmations SET expires_at=clock_timestamp()+interval '1 second' WHERE vehicle_id=$1 AND actor_id=$2", [vehicle.id, editor.id]);
      const actor = { id: editor.id, requestId: randomUUID() }, key = randomUUID();
      await rejectedStaleProof(inventory.publish(vehicle.id, vehicle.version, actor, key));
      assert.equal(entered, true); assert.equal(activeAtPreparation, true); assert.deepEqual(await get(vehicle.id), vehicle);
      assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows[0].n, 0);
      assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [editor.id, key])).rows[0].n, 0);
      assert.equal((await readiness(vehicle.id)).previewConfirmed, false);
    });

    await t.test('uppercase UUID image references remain readable through preview, confirmation and publication', async () => {
      let vehicle = await ready(); const canonical = vehicle.draft.media[0]!.id;
      vehicle.draft.media[0]!.id = canonical.toUpperCase(); vehicle = await save(vehicle);
      const view = await preview(vehicle.id);
      assert.equal(view.vehicle.images[0]!.status, 'ready');
      assert.equal(view.vehicle.images[0]!.id.toLowerCase(), canonical);
      assert.equal((await call({ url: view.vehicle.images[0]!.url!, headers: headers() })).statusCode, 200);
      await confirmed(vehicle); const response = await publish(vehicle); assert.equal(response.statusCode, 200, response.body);
      const image = (await publicDetail(vehicle.id)).images[0]!;
      assert.equal(image.id.toLowerCase(), canonical); assert.equal((await call({ url: image.url })).statusCode, 200);
    });

    await t.test('FX expiring during image preparation invalidates the proof without changing the saved or published vehicle', async () => {
      await seedSyntheticFx(app.db, 'a');
      const vehicle = await published(await ready('manual', 'CNY'));
      const live = await publicDetail(vehicle.id); assert.equal(live.displayPrice?.status, 'ready');
      // Confirm the same short-lived quote the publishing transaction will read;
      // changing expires_at after confirmation would only test a changed quote.
      await app.db.pool.query("UPDATE public_fx_quote SET expires_at=clock_timestamp()+interval '1 second' WHERE id=1");
      const old = await confirmed(vehicle); assert.equal(old.vehicle.price.displayPrice?.status, 'ready');
      const realStore = new LocalMediaStore(mediaRoot); let entered = false, activeAtPreparation: boolean | undefined;
      const inventory = new InventoryService(app.db, false, { async prepareDelivery(id, variant) {
        entered = true;
        activeAtPreparation = (await app.db.pool.query('SELECT expires_at>clock_timestamp() AS active FROM public_fx_quote WHERE id=1')).rows[0].active;
        await delay(1100);
        return realStore.prepareDelivery(id, variant);
      } });
      try {
        await rejectedStaleProof(inventory.publish(vehicle.id, vehicle.version, { id: editor.id, requestId: randomUUID() }, randomUUID()));
        assert.equal(entered, true); assert.equal(activeAtPreparation, true); assert.deepEqual(await get(vehicle.id), vehicle);
        assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows[0].n, 1);
        const current = await publicDetail(vehicle.id); assert.equal(current.displayPrice?.status, 'unavailable');
        const { displayPrice: _previousConversion, ...before } = live;
        const { displayPrice: _expiredConversion, ...after } = current;
        assert.deepEqual(after, before); assert.equal((await readiness(vehicle.id)).previewConfirmed, false);
      } finally { await seedSyntheticFx(app.db, 'a'); }
    });

    await t.test('FX becoming active after transaction start invalidates an unavailable-price confirmation', async () => {
      await seedSyntheticFx(app.db, 'expired');
      const vehicle = await published(await ready('manual', 'CNY'));
      const live = await publicDetail(vehicle.id); assert.equal(live.displayPrice?.status, 'unavailable');
      const old = await confirmed(vehicle); assert.equal(old.vehicle.price.displayPrice?.status, 'unavailable');
      const realStore = new LocalMediaStore(mediaRoot);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const inventory = new InventoryService(app.db, false, { async prepareDelivery(id, variant) {
        enter(); await gate; return realStore.prepareDelivery(id, variant);
      } });
      // Catch immediately so a premature failure is reported instead of leaving the gate waiting.
      const pending = inventory.publish(vehicle.id, vehicle.version, { id: editor.id, requestId: randomUUID() }, randomUUID());
      const outcome = pending.then(value => ({ value }), error => ({ error }));
      try {
        await Promise.race([entered, outcome.then(() => { throw new Error('Publish completed before reaching the media gate.'); })]);
        // This separate transaction starts after publication BEGIN. Match the FX
        // writer's advisory lock while making the quote effective at its actual write time.
        await app.db.transaction(async tx => {
          await tx.query('SELECT pg_advisory_xact_lock(86147,9)');
          await tx.query(`WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS now)
            UPDATE public_fx_quote SET as_of=clock.now,expires_at=clock.now+interval '7 days'
            FROM clock WHERE id=1`);
        });
        release();
        await rejectedStaleProof(pending);
        assert.deepEqual(await get(vehicle.id), vehicle);
        assert.equal((await app.db.pool.query('SELECT count(*)::int AS n FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows[0].n, 1);
        const current = await publicDetail(vehicle.id); assert.equal(current.displayPrice?.status, 'ready');
        const { displayPrice: _unavailableConversion, ...before } = live;
        const { displayPrice: _readyConversion, ...after } = current;
        assert.deepEqual(after, before);
        const state = await readiness(vehicle.id);
        assert.equal(state.publicContentRevision, old.publicContentRevision); assert.notEqual(state.fingerprint, old.fingerprint);
        assert.equal(state.previewConfirmed, false);
      } finally { release(); await outcome; await seedSyntheticFx(app.db, 'a'); }
    });

    await t.test('concurrent save and publish commit one complete outcome with no partial snapshot', async () => {
      const vehicle = await ready(); await confirmed(vehicle); const changed = structuredClone(vehicle.draft);
      assert.ok(changed.price.money); changed.price.money.amount = '28000.00';
      const [saved, publication] = await Promise.all([
        call({ method: 'PATCH', url: endpoint(vehicle.id), headers: headers(), payload: { version: vehicle.version, draft: changed } }),
        publish(vehicle),
      ]);
      assert.deepEqual([saved.statusCode, publication.statusCode].sort(), [200, 409], `${saved.body}\n${publication.body}`);
      const current = await get(vehicle.id);
      const snapshots = (await app.db.pool.query('SELECT id,data FROM vehicle_publications WHERE vehicle_id=$1', [vehicle.id])).rows;
      const references = (await app.db.pool.query('SELECT count(*)::int AS n FROM publication_media pm JOIN vehicle_publications p ON p.id=pm.publication_id WHERE p.vehicle_id=$1', [vehicle.id])).rows[0].n;
      if (publication.statusCode === 200) {
        assert.equal(current.publicationState, 'published'); assert.equal(snapshots.length, 1); assert.equal(references, 1);
        assert.equal(current.publishedRevisionId, snapshots[0].id); assert.equal((await publicDetail(vehicle.id)).price.money?.amount, '23500.00');
        assert.equal(current.draft.price.money?.amount, '23500.00');
      } else {
        assert.equal(current.publicationState, 'draft'); assert.equal(current.publishedRevisionId, null);
        assert.equal(snapshots.length, 0); assert.equal(references, 0); assert.equal(current.draft.price.money?.amount, '28000.00');
        assert.equal((await call({ url: `/api/v1/vehicles/${vehicle.id}?locale=zh` })).statusCode, 404);
      }
    });

    await t.test('disabled employees lose preview, confirmation and publish access with their old session', async () => {
      const vehicle = await ready(); const value = await preview(vehicle.id, 'zh', colleague.cookie);
      await setStaffEnabled(app.db, colleague.email, false);
      for (const suffix of ['/publish-readiness?locale=zh', '/publication-preview?locale=zh']) {
        assert.equal((await call({ url: endpoint(vehicle.id, suffix), headers: headers(colleague.cookie) })).statusCode, 401);
      }
      assert.equal((await confirm(vehicle.id, value, colleague.cookie)).statusCode, 401);
      assert.equal((await publish(vehicle, randomUUID(), colleague.cookie)).statusCode, 401);
      assert.equal((await get(vehicle.id)).publicationState, 'draft');
    });

    await t.test('readiness rejects either missing publication migration dependency and recovers after restoration', async () => {
      assert.equal((await call({ url: '/health/ready' })).statusCode, 200);
      // Each rename commits so the separate HTTP request can observe it. This suite
      // owns only this random database, runs serially, and restores each name in finally.
      for (const [remove, restore] of [
        ['ALTER TABLE publication_preview_confirmations RENAME TO preview_confirmations_test_hidden',
          'ALTER TABLE preview_confirmations_test_hidden RENAME TO publication_preview_confirmations'],
        ['ALTER TABLE vehicles RENAME COLUMN public_content_revision TO preview_revision_test_hidden',
          'ALTER TABLE vehicles RENAME COLUMN preview_revision_test_hidden TO public_content_revision'],
      ]) {
        await app.db.pool.query(remove!);
        try {
          const response = await call({ url: '/health/ready' });
          assert.equal(response.statusCode, 503, response.body); assert.deepEqual(response.json(), { status: 'unavailable' });
          assert.equal((await call({ url: '/health/live' })).statusCode, 200);
        } finally { await app.db.pool.query(restore!); }
        assert.equal((await call({ url: '/health/ready' })).statusCode, 200);
      }
    });
    assert.equal(fetchSpy.mock.callCount(), 0, 'All previews, approvals and publication stay inside the isolated database and local media store.');
  } finally {
    try { await runtime?.app.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(mediaRoot, { recursive: true, force: true }); fetchSpy.mock.restore(); }
    }
  }
});
