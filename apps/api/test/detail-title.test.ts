import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeExternalCandidateFixture, makeExternalImportFixture, makePublicVehicleFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { PublicVehicleInlineResponseSchema, PublicVehicleResponseSchema, type Locale } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createStaff } from '../src/staff-cli.js';

test('localized detail projects the optional English title from the same visible publication', async t => {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/postgres' || url.search || url.hash) throw new Error('Isolated local maintenance database only');
  const maintenance = createDatabase(url.toString(), 1);
  const name = `hd_ext_detail_title_${randomBytes(8).toString('hex')}`;
  const media = await mkdtemp(path.join(tmpdir(), 'hd-detail-title-'));
  let runtime: Awaited<ReturnType<typeof buildApp>> | undefined;
  let created = false;
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    const origin = 'http://127.0.0.1:3318';
    runtime = await buildApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), AUTH_SECRET: randomBytes(32).toString('hex'),
      MEDIA_ROOT: media, AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin, EXTERNAL_CATALOG_MODE: 'synthetic' }));
    const { app, db, inventory, auth } = runtime;
    await migrateDatabase(db);
    let requestCount = 0;
    const request = (id: string, query: string) => app.inject({ url: `/api/v1/vehicles/${id}?${query}`,
      remoteAddress: `198.51.100.${++requestCount}` });
    const inline = async (id: string, locale: Locale, title = false) => {
      const response = await request(id, `locale=${locale}&view=localized&projection=detail-inline-v1${title ? '&titleView=english' : ''}`);
      assert.equal(response.statusCode, 200, response.body);
      return PublicVehicleInlineResponseSchema.parse(response.json()).data;
    };

    const staffId = randomUUID(), publication = randomUUID(), draft = makeVehicleDraftFixture();
    const snapshot = { source: draft.source, facts: draft.facts, price: draft.price, content: draft.content, images: makePublicVehicleFixture().images };
    await db.transaction(async tx => {
      await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())", [staffId]);
      await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)', [staffId, { ...draft, content: {
        ...draft.content, title: { ...draft.content.title, translations: { ...draft.content.title.translations,
          en: { ...draft.content.title.translations.en!, text: 'Unpublished English change' } } },
      } }]);
      await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [publication, staffId, snapshot]);
      await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [staffId, publication]);
    });
    const staffEnglish = (await inline(staffId, 'en')).content.title;
    assert.equal(staffEnglish.text, 'Synthetic test vehicle');
    assert.equal(staffEnglish.reviewed, true);
    for (const locale of ['zh', 'ru'] as const) {
      const opted = await inline(staffId, locale, true);
      assert.deepEqual(opted.englishTitle, staffEnglish);
      const previous = await inline(staffId, locale);
      assert.equal(previous.englishTitle, undefined);
      assert.deepEqual(opted.content, previous.content);
    }
    const legacy = await request(staffId, 'locale=ru&view=localized');
    assert.equal(legacy.statusCode, 200, legacy.body);
    PublicVehicleResponseSchema.parse(legacy.json());
    assert.equal((await request(staffId, 'locale=ru&view=localized&titleView=english')).statusCode, 400);

    const email = 'detail-title@example.invalid', password = 'Synthetic-detail-title-only!';
    await createStaff(auth, { name: 'Synthetic admin', email, password, role: 'admin' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email, password } });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = login.cookies.map(item => `${item.name}=${item.value}`).join('; ');
    const batch = makeExternalImportFixture(3);
    const fallback = makeExternalCandidateFixture(2);
    const missing = makeExternalCandidateFixture(3);
    fallback.copy.title!.translations.en = { text: 'Che168 internal label', contentLocale: 'en' };
    fallback.copy.model!.translations.en = { text: 'Toyota R1', contentLocale: 'en' };
    missing.disputes = [];
    missing.copy.model = null;
    missing.facts.model = { id: 'model-without-english', name: '孤立车型' };
    batch.records[1] = { raw: JSON.stringify(fallback), candidate: fallback };
    batch.records[2] = { raw: JSON.stringify(missing), candidate: missing };
    const imported = await app.inject({ method: 'POST', url: '/api/v1/admin/external/batches', headers: { origin, cookie, 'idempotency-key': randomUUID() }, payload: batch });
    assert.equal(imported.statusCode, 201, imported.body);
    const listings = await db.pool.query<{ id: string }>('SELECT id FROM external_listings ORDER BY external_id');
    const [supplierId, fallbackId, missingId] = listings.rows.map(({ id }) => `ext-${id}`);
    assert.ok(supplierId && fallbackId && missingId);
    const supplierEnglish = (await inline(supplierId, 'en')).content.title;
    assert.equal(supplierEnglish.kind, 'supplier');
    assert.equal(supplierEnglish.reviewed, false);
    for (const locale of ['zh', 'en', 'ru'] as const) {
      const opted = await inline(supplierId, locale, true);
      const previous = await inline(supplierId, locale);
      assert.deepEqual(opted.englishTitle, supplierEnglish);
      assert.equal(previous.englishTitle, undefined);
      assert.deepEqual(opted.content, previous.content);
    }
    assert.deepEqual((await inline(fallbackId, 'ru', true)).englishTitle, {
      text: 'Toyota R1 2024', requestedLocale: 'en', contentLocale: 'en', kind: 'catalog', reviewed: false,
    });
    assert.equal((await inline(missingId, 'zh', true)).englishTitle, undefined);

    const sql: Array<{ text: string; rows: number }> = [];
    const transaction = db.transaction;
    t.mock.method(db, 'transaction', <T>(work: Parameters<typeof transaction<T>>[0]) => transaction<T>(tx => {
      const wrapped = Object.create(tx) as typeof tx;
      wrapped.query = (async (text: string, values?: unknown[]) => {
        const result = await tx.query(text, values);
        sql.push({ text, rows: result.rows.length });
        return result;
      }) as typeof tx.query;
      return work(wrapped);
    }));
    const read = (locale: Locale, title?: 'english') => inventory.getPublic(supplierId, locale, 'localized', undefined, 'detail-inline-v1', 'verified', title);
    const baseline = await Promise.all([read('ru'), read('en')]);
    const baselineCount = sql.length;
    sql.length = 0;
    const single = await read('ru', 'english');
    assert.equal(sql.length * 2, baselineCount);
    assert.equal(sql.filter(statement => statement.text.includes('AS english') && statement.rows === 1).length, 1);
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    assert.ok(bytes(single) < baseline.reduce((sum, value) => sum + bytes(value), 0));
    t.diagnostic(`Supplier detail snapshot queries: ${baselineCount} across ru + en, ${sql.length} with title; DTO bytes: ${baseline.reduce((sum, value) => sum + bytes(value), 0)} vs ${bytes(single)}.`);
    t.mock.restoreAll();

    await db.pool.query("DELETE FROM external_catalog_search WHERE listing_id=$1 AND locale='en'", [supplierId.slice(4)]);
    const withoutEnglishVisibility = await read('ru', 'english');
    assert.equal('englishTitle' in withoutEnglishVisibility, false);
    await assert.rejects(read('en'), { status: 404 });
  } finally {
    if (runtime) await runtime.app.close();
    if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);
    await maintenance.close();
    await rm(media, { recursive: true, force: true });
  }
});
