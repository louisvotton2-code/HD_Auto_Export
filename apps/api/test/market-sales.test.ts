import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, mock, test } from 'node:test';
import { makePublicVehicleFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { MarketPriceResponseSchema, SalesVehicleListResponseSchema, SalesVehicleLookupResponseSchema } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { adaptChinaCarSample } from '../src/external/china-car-sample.js';
import { applyFullSource, bindAlias, ensureMember } from '../src/external/full-sync/apply.js';
import { configureFullSync } from '../src/external/full-sync/engine.js';
import type { Source } from '../src/external/full-sync/types.js';
import { chinaCarSampleProfile } from '../src/external/profiles.js';
import type { SourceDocument } from '../src/external/sources/index.js';
import { ExternalStore } from '../src/external/store.js';

const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
assert.ok(['postgres:', 'postgresql:'].includes(maintenanceUrl.protocol) && maintenanceUrl.hostname === '127.0.0.1' &&
  maintenanceUrl.pathname === '/postgres' && !maintenanceUrl.hash && !maintenanceUrl.search);
const databaseName = `hd_market_sales_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(maintenanceUrl);
databaseUrl.pathname = `/${databaseName}`;
const maintenance = createDatabase(maintenanceUrl.toString(), 1);
const db = createDatabase(databaseUrl.toString(), 2);
const origin = 'http://127.0.0.1:3363';
const token = randomBytes(32).toString('hex');
const headers = { authorization: `Bearer ${token}` };
const markets = '/api/v1/public/market-prices?locale=en&make=fixture_make&model=fixture_model';
const mixedMarket = '/api/v1/public/market-prices?locale=en&make=cca-make-31001&model=cca-model-41001';
const sales = '/api/v1/integrations/sales/vehicles';
const operator = 'market-sales-fixture-admin';
const remote = mock.method(globalThis, 'fetch', async () => { throw new Error('Market and sales must not use remote fetch'); });
let created = false;
let privateDir: string | undefined;
let runtime: Awaited<ReturnType<typeof buildApp>>;
const available: string[] = [];
let sold: string;
let reserved: string;
let outside: string;
let code: string;
let mixedManual: string;
let packageQuote: string;

async function publication(index: number, options: {
  availability?: 'available'|'reserved'|'sold'; country?: string; extras?: string[]; unpriced?: boolean;
  mixedModel?: boolean; modelId?: string; currency?: 'CNY' | 'USD'; amount?: string;
} = {}) {
  const id = randomUUID(), revision = randomUUID();
  const draft = makeVehicleDraftFixture();
  draft.facts.location = { country: options.country ?? 'CN', city: null, displayName: null };
  draft.facts.mileageKm = 1_000 + 1_000 * index;
  if (options.mixedModel) {
    draft.facts.make = { id: 'cca-make-31001', name: 'Mixed market brand' };
    draft.facts.model = { id: 'cca-model-41001', name: 'Mixed market model' };
  } else if (options.modelId) {
    draft.facts.model = { id: options.modelId, name: 'Test market model' };
  }
  draft.price = options.unpriced ? { kind: 'on_request', money: null, includes: [] } :
    { kind: 'asking', money: { amount: options.amount ?? String((index + 1) * 10_000), currency: options.currency ?? 'CNY' },
      includes: options.extras ?? [] };
  const drivetrain = index === 0 ? 'four_wd' : index === 1 ? 'awd' : 'fwd';
  const image = { ...makePublicVehicleFixture().images[0]!, id: randomUUID() };
  const snapshot = { source: draft.source, facts: { ...draft.facts, drivetrain }, price: draft.price,
    content: draft.content, images: [image], configuration: { version: 1, items: [
      { name: 'Drive type', value: drivetrain }, { name: 'Number of doors', value: '4' },
    ] } };
  await db.transaction(async tx => {
    await tx.query('INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,$2,now())', [id, options.availability ?? 'available']);
    await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)', [id, JSON.stringify(draft)]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [revision, id, JSON.stringify(snapshot)]);
    await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [id, revision]);
  });
  return id;
}

async function supplierListing(source: Source, operation: 'upsert' | 'withdraw' | 'legacy' = 'upsert') {
  const externalId = source === 'che168' ? '910091' : '910092';
  const at = '2026-11-26T01:00:00.000Z';
  const locales = ['zh', 'en', 'ru'] as const;
  const documents: SourceDocument[] = locales.map(locale => ({
    identity: { provider: 'chinacarapi', source, externalId }, kind: 'detail', locale, observedAt: at, sourceUpdatedAt: at,
    payload: {
      source, id: externalId, status: 'active', updatedAt: at,
      url: source === 'che168' ? `https://www.che168.com/dealer/1/${externalId}.html` : `https://www.dongchedi.com/usedcar/${externalId}`,
      title: { zh: '合成行情车辆', en: 'Synthetic market vehicle', ru: 'Тестовый автомобиль' }[locale],
      make: { id: '31001', name: 'Mixed market brand' }, model: { id: '41001', name: 'Mixed market model' },
      modelYear: 2024, mileageKm: 12000, price: { cny: 70000 }, fuel: 'Petrol', transmission: 'Automatic',
      specs: { displacementCc: 1998 }, photos: ['https://erscglobal2.autoimg.cn/synthetic-market.jpg'],
      hasInspectionReport: false, seller: { phone: 'PRIVATE_TEST_SUPPLIER_PHONE' },
    },
  }));
  if (operation === 'legacy') {
    const [zh, en, ru] = documents.map(document => document.payload as Record<string,unknown>);
    const candidate = adaptChinaCarSample(en!, at, { zh, en, ru });
    assert.ok(candidate);
    const receipt = await new ExternalStore(db, chinaCarSampleProfile).importBatch({
      provider: chinaCarSampleProfile.id, records: [{ raw: JSON.stringify(en), candidate }],
    }, randomUUID(), { id: operator, requestId: randomUUID() });
    assert.equal(receipt.counts.applied, 1);
    const legacy = await db.pool.query<{ id: string; inquiry_number: string }>(`SELECT id,inquiry_number::text FROM external_listings
      WHERE provider=$1 AND platform_id=$2 AND external_id=$3`, [chinaCarSampleProfile.id, source, externalId]);
    return legacy.rows[0]!;
  }
  await db.transaction(async tx => {
    if (source === 'dongchedi' && operation === 'upsert') {
      await bindAlias(tx, source, externalId, { source: 'che168', id: '910091' }, at);
    }
    const member = await ensureMember(tx, source, externalId);
    await tx.query(`UPDATE external_full_members SET state=$3,locales=$4,applied_generation=desired_generation,last_detail_at=$5
      WHERE source=$1 AND external_id=$2`, [source, externalId, operation === 'withdraw' ? 'withdrawn' : 'active', [...locales], at]);
    await applyFullSource(tx, { source, externalId, canonicalId: member.canonical_id, operation,
      documents: operation === 'upsert' ? documents : [], at, batchId: randomUUID() });
  });
  const result = await db.pool.query<{ id: string; inquiry_number: string }>(`SELECT id,inquiry_number::text FROM external_listings
    WHERE provider='chinacarapi' AND platform_id=$1 AND external_id=$2`, [source, externalId]);
  return result.rows[0]!;
}

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrateDatabase(db);
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Fixture admin','market-sales@example.invalid','admin',false)", [operator]);
  await configureFullSync(db, { id: operator, requestId: randomUUID() }, 'full');
  for (let i = 0; i < 10; i++) available.push(await publication(i));
  sold = await publication(10, { availability: 'sold' });
  reserved = await publication(11, { availability: 'reserved' });
  outside = await publication(12, { country: 'RU' });
  packageQuote = await publication(13, { extras: ['Transport and duties included'] });
  await publication(14, { unpriced: true });
  mixedManual = await publication(4, { mixedModel: true });
  const result = await db.pool.query<{ stock_number: string }>('SELECT stock_number::text FROM vehicles WHERE id=$1', [sold]);
  code = `HD-${result.rows[0]!.stock_number.padStart(6, '0')}`;
  await db.pool.query(`INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates)
    VALUES(1,'exchange_rate_api',now()-interval '1 minute',now()+interval '1 hour','{"USD":"1","CNY":"7"}')`);
  privateDir = await mkdtemp(path.join(tmpdir(), 'hd-market-sales-'));
  const tokenFile = path.join(privateDir, 'sales-token');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl.toString(), AUTH_SECRET: 'isolated-market-sales-auth-secret-only',
    AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin, MEDIA_ROOT: privateDir, CATALOG_READ_MODE: 'combined',
    SALES_API_TOKEN_FILE: tokenFile, SALES_API_SITE_ORIGIN: origin });
  runtime = await buildApp(config);
});

after(async () => {
  try { await runtime?.app.close(); await db.close(); if (created) await maintenance.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
  finally { await maintenance.close(); if (privateDir) await rm(privateDir, { recursive: true, force: true }); }
  assert.equal(remote.mock.callCount(), 0);
  remote.mock.restore();
});

test('market uses the full eligible CNY population and real, stable extrema', async () => {
  const bad = await runtime.app.inject('/api/v1/public/market-prices?locale=en&make=fixture_make');
  assert.equal(bad.statusCode, 400);
  const result = await runtime.app.inject(markets);
  assert.equal(result.statusCode, 200, result.body);
  const data = MarketPriceResponseSchema.parse(result.json()).data;
  assert.equal(data.sampleCount, 10);
  assert.deepEqual(Object.values(data.statistics).map(row => Number(row?.cny.amount)), [10_000,100_000,55_000,55_000,32_500,77_500]);
  assert.equal(Number(data.statistics.min?.usd?.amount), 1428.57);
  assert.equal(data.extremes.min?.vehicle.id, available[0]);
  assert.equal(data.extremes.max?.detailPath, `/en/cars/${available[9]}/`);
  const restricted = MarketPriceResponseSchema.parse((await runtime.app.inject(`${markets}&mileageMax=5000`)).json()).data;
  assert.equal(restricted.sampleCount, 5);
  assert.equal(restricted.asOf, data.asOf);
  assert.equal(restricted.statistics.p25, null);
  assert.equal(restricted.statistics.p75, null);
  const empty = MarketPriceResponseSchema.parse((await runtime.app.inject(`${markets}&yearMin=2091`)).json()).data;
  assert.equal(empty.sampleCount, 0);
  assert.equal(empty.asOf, data.asOf);
  assert.equal(empty.extremes.max, null);
});

test('a model snapshot keeps ties and half-cent rounding exact and reloads when a selected extreme is sold', async () => {
  const modelId = 'fixture_equal_price_model';
  const lower = [await publication(30, { modelId, amount: '10000.01' }),
    await publication(31, { modelId, amount: '10000.01' })].sort();
  const upper = [await publication(32, { modelId, amount: '30000.02' }),
    await publication(33, { modelId, amount: '30000.02' })].sort();
  const readMarket = async (query = '') => {
    const response = await runtime.app.inject(`/api/v1/public/market-prices?locale=en&make=fixture_make&model=${modelId}${query}`);
    assert.equal(response.statusCode, 200, response.body);
    return MarketPriceResponseSchema.parse(response.json()).data;
  };
  const initial = await readMarket();
  assert.equal(initial.sampleCount, 4);
  assert.equal(initial.statistics.mean?.cny.amount, '20000.02');
  assert.equal(initial.statistics.median?.cny.amount, '20000.02');
  assert.equal(initial.extremes.min?.vehicle.id, lower[0]);
  assert.equal(initial.extremes.max?.vehicle.id, upper[1]);
  const tied = await readMarket('&mileageMax=32000');
  assert.equal(tied.sampleCount, 2);
  assert.equal(tied.asOf, initial.asOf);
  assert.equal(tied.extremes.min?.vehicle.id, lower[0]);
  assert.equal(tied.extremes.max?.vehicle.id, lower[1]);

  await db.pool.query("UPDATE vehicles SET availability='sold',availability_checked_at=now() WHERE id=$1", [lower[0]]);
  const narrowRefresh = await readMarket('&mileageMax=32000');
  assert.equal(narrowRefresh.sampleCount, 1);
  assert.equal(narrowRefresh.extremes.min?.vehicle.id, lower[1]);
  assert.equal(narrowRefresh.extremes.max?.vehicle.id, lower[1]);
  const fullRefresh = await readMarket();
  assert.equal(fullRefresh.sampleCount, 3);
  // The narrow request can refill its own scope after the retired model snapshot.
  // A full refresh still observes the sale and reports its own snapshot time.
  assert.ok(Date.parse(fullRefresh.asOf) >= Date.parse(narrowRefresh.asOf));
  assert.equal(fullRefresh.extremes.min?.vehicle.id, lower[1]);
  assert.equal(fullRefresh.extremes.max?.vehicle.id, upper[1]);
});

test('sales requires bearer authentication before parsing and uses strict budget and drivetrain evidence', async () => {
  const query = `${sales}?locale=en&drivetrain=four_wheel&priceCurrency=CNY&priceMax=30000&limit=1`;
  assert.equal((await runtime.app.inject(`${sales}?limit=bad`)).statusCode, 401);
  assert.equal((await runtime.app.inject({ url: `${sales}?limit=bad`, headers })).statusCode, 400);
  const first = await runtime.app.inject({ url: query, headers });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers['cache-control'], 'no-store');
  const page = SalesVehicleListResponseSchema.parse(first.json()).data;
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const second = await runtime.app.inject({ url: `${query}&cursor=${page.nextCursor}`, headers });
  const last = SalesVehicleListResponseSchema.parse(second.json()).data;
  assert.deepEqual(new Set([...page.items,...last.items].map(item => item.id)), new Set(available.slice(0,2)));
  assert.equal(last.nextCursor, null);
  assert.ok(!first.body.includes('INTERNAL_FIXTURE_NOT_PUBLIC'));
  assert.ok(!Object.hasOwn(page.items[0]!, 'images'));
  const inventory = await runtime.app.inject({ url: `${sales}?locale=en&limit=20`, headers });
  assert.equal(inventory.statusCode, 200, inventory.body);
  const items = SalesVehicleListResponseSchema.parse(inventory.json()).data.items;
  assert.ok(items.length > 0);
  assert.ok(items.every(item => item.availability === 'available' && item.id !== sold && item.id !== reserved));
});

test('sales lookup keeps visible sold vehicles and only resolves a trusted exact detail URL', async () => {
  const lookup = `${sales}/lookup?locale=en&stockCode=${code}&configurationLimit=1`;
  const first = await runtime.app.inject({ url: lookup, headers });
  assert.equal(first.statusCode, 200, first.body);
  const body = SalesVehicleLookupResponseSchema.parse(first.json()).data;
  assert.equal(body.vehicle.id, sold);
  assert.equal(body.vehicle.availability, 'sold');
  assert.equal(body.configuration.items.length, 1);
  assert.ok(body.configuration.nextCursor);
  const last = SalesVehicleLookupResponseSchema.parse((await runtime.app.inject({ url: `${lookup}&configurationCursor=${body.configuration.nextCursor}`, headers })).json()).data;
  assert.equal(last.configuration.items.length, 1);
  assert.equal(last.configuration.nextCursor, null);
  for (const value of [`https://other.example/en/cars/${outside}/`, `${origin}/en/cars/${outside}/?ref=x`]) {
    const refused = await runtime.app.inject({ url: `${sales}/lookup?detailUrl=${encodeURIComponent(value)}`, headers });
    assert.equal(refused.statusCode, 400, refused.body);
  }
  const exact = await runtime.app.inject({ url: `${sales}/lookup?locale=en&detailUrl=${encodeURIComponent(`${origin}/en/cars/${sold}/`)}`, headers });
  assert.equal(SalesVehicleLookupResponseSchema.parse(exact.json()).data.vehicle.id,sold);
  const reservedLookup = await runtime.app.inject({
    url: `${sales}/lookup?locale=en&detailUrl=${encodeURIComponent(`${origin}/en/cars/${reserved}/`)}`, headers,
  });
  assert.equal(reservedLookup.statusCode, 200, reservedLookup.body);
  assert.equal(SalesVehicleLookupResponseSchema.parse(reservedLookup.json()).data.vehicle.availability, 'reserved');
  const packageLookup = await runtime.app.inject({
    url: `${sales}/lookup?locale=en&detailUrl=${encodeURIComponent(`${origin}/en/cars/${packageQuote}/`)}`, headers,
  });
  assert.equal(packageLookup.statusCode, 200, packageLookup.body);
  assert.deepEqual(SalesVehicleLookupResponseSchema.parse(packageLookup.json()).data.vehicle.price.includes,
    ['Transport and duties included']);
});

test('mixed market counts one canonical supplier quote, and exact HX lookup respects immediate withdrawal', async () => {
  const readMarket = async () => {
    const response = await runtime.app.inject(mixedMarket);
    assert.equal(response.statusCode, 200, response.body);
    return MarketPriceResponseSchema.parse(response.json()).data;
  };
  const exact = (number: string) => runtime.app.inject({ url: `${sales}/lookup?locale=en&stockCode=HX${number}`, headers });
  const byLink = (id: string) => runtime.app.inject({
    url: `${sales}/lookup?locale=en&detailUrl=${encodeURIComponent(`${origin}/en/cars/ext-${id}/`)}`, headers,
  });
  const legacy = await supplierListing('che168', 'legacy');
  const lookupLegacy = () => Promise.all([exact(legacy.inquiry_number), byLink(legacy.id)]);
  for (const response of await lookupLegacy()) {
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(SalesVehicleLookupResponseSchema.parse(response.json()).data.vehicle.id, `ext-${legacy.id}`);
  }
  const legacyMarket = await readMarket();
  assert.equal(legacyMarket.sampleCount, 2);
  assert.equal(legacyMarket.extremes.max?.vehicle.id, `ext-${legacy.id}`);
  const primary = await supplierListing('che168');
  const backup = await supplierListing('dongchedi');
  const initial = await readMarket();
  assert.equal(initial.sampleCount, 2);
  assert.equal(initial.extremes.min?.vehicle.id, mixedManual);
  assert.equal(initial.extremes.max?.vehicle.id, `ext-${primary.id}`);
  const lookup = await exact(primary.inquiry_number);
  assert.equal(lookup.statusCode, 200, lookup.body);
  assert.equal(SalesVehicleLookupResponseSchema.parse(lookup.json()).data.vehicle.id, `ext-${primary.id}`);
  assert.doesNotMatch(lookup.body, /PRIVATE_TEST_SUPPLIER_PHONE|che168\.com|910091|synthetic-market\.jpg/);
  assert.equal((await exact(backup.inquiry_number)).statusCode, 404);
  const sourceFeed = () => runtime.app.inject({
    url: `${sales}?locale=en&make=cca-make-31001&model=cca-model-41001`, headers,
  });
  const current = await sourceFeed();
  assert.equal(current.statusCode, 200, current.body);
  assert.deepEqual(new Set(SalesVehicleListResponseSchema.parse(current.json()).data.items.map(item => item.id)),
    new Set([mixedManual, `ext-${primary.id}`]));

  const store = new ExternalStore(db);
  const setHidden = async (hidden: boolean) => {
    const id = `ext-${primary.id}`;
    const listing = await store.getListing(id, 'en');
    await store.saveOverrides(id, { version: listing.version, overrides: { ...listing.overrides, hidden } },
      randomUUID(), { id: operator, requestId: randomUUID() });
  };
  await setHidden(true);
  assert.equal((await exact(primary.inquiry_number)).statusCode, 404);
  assert.deepEqual((await lookupLegacy()).map(response => response.statusCode), [404, 404], 'hidden formal listing');
  await setHidden(false);
  assert.equal((await exact(primary.inquiry_number)).statusCode, 200);
  assert.deepEqual((await lookupLegacy()).map(response => response.statusCode), [404, 404], 'formal listing owns this source identity');

  await supplierListing('che168', 'withdraw');
  assert.equal((await exact(primary.inquiry_number)).statusCode, 404);
  assert.deepEqual((await lookupLegacy()).map(response => response.statusCode), [404, 404], 'withdrawn formal listing');
  assert.equal((await db.pool.query('SELECT 1 FROM external_catalog WHERE listing_id=$1', [legacy.id])).rowCount, 1);
  for (const response of await Promise.all([exact(backup.inquiry_number), byLink(backup.id)])) {
    assert.equal(response.statusCode, 200, response.body);
    const { vehicle } = SalesVehicleLookupResponseSchema.parse(response.json()).data;
    assert.equal(vehicle.id, `ext-${backup.id}`);
    assert.equal(vehicle.availability, 'unknown');
  }
  assert.equal((await readMarket()).extremes.max?.vehicle.id, `ext-${backup.id}`);
});

test('market converts historical bare USD asking prices and omits them when no rate can compare them', async () => {
  const modelId = 'fixture_currency_model';
  const nativeCny = await publication(2, { modelId, amount: '10000' });
  const nativeUsd = await publication(3, { modelId, amount: '20000', currency: 'USD' });
  const narrowed = `/api/v1/public/market-prices?locale=en&make=fixture_make&model=${modelId}&mileageMax=5000`;
  const first = MarketPriceResponseSchema.parse((await runtime.app.inject(narrowed)).json()).data;
  assert.equal(first.sampleCount, 2);
  assert.equal(first.extremes.max?.vehicle.id, nativeUsd);
  assert.equal(first.statistics.max?.cny.amount, '140000.00');
  assert.equal(first.statistics.max?.usd?.amount, '20000.00');
  await db.pool.query("UPDATE public_fx_quote SET as_of=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=1");
  const expired = MarketPriceResponseSchema.parse((await runtime.app.inject(narrowed)).json()).data;
  assert.equal(expired.sampleCount, 1);
  assert.equal(expired.statistics.max?.usd, null);
  assert.equal(expired.extremes.max?.vehicle.id, nativeCny);
});

test('ordinary mixed market reads use a bounded queue instead of rejecting distinct keys immediately', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    runtime.app.inject({ url: `${markets}&mileageMax=${1000 + index * 1000}`, remoteAddress: '127.0.0.3' })));
  assert.deepEqual(responses.map(response => response.statusCode), Array(20).fill(200));
  assert.deepEqual(responses.map(response => MarketPriceResponseSchema.parse(response.json()).data.sampleCount),
    Array.from({ length: 20 }, (_, index) => Math.min(index + 1, 10)));
});

test('twenty authenticated sales searches and lookups complete within the existing request budget', async t => {
  const requests = Array.from({ length: 20 }, (_, index) => index % 2 === 0
    ? `${sales}?locale=en&drivetrain=four_wheel&priceCurrency=CNY&priceMax=${30_000 + index * 100}`
    : index % 4 === 1
      ? `${sales}/lookup?locale=en&stockCode=${code}`
      : `${sales}/lookup?locale=en&detailUrl=${encodeURIComponent(`${origin}/en/cars/${reserved}/`)}`);
  const measured = await Promise.all(requests.map(async url => {
    const start = performance.now();
    const response = await runtime.app.inject({ url, headers, remoteAddress: '127.0.0.2' });
    return { response, elapsedMs: performance.now() - start };
  }));
  const sorted = measured.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  const failures = measured.filter(({ response }) => response.statusCode !== 200).length;
  t.diagnostic(JSON.stringify({ requests: measured.length, failures, p95Ms: Number(sorted[18]!.toFixed(1)) }));
  assert.deepEqual(measured.map(({ response }) => response.statusCode), Array(20).fill(200));
  for (const [index, { response }] of measured.entries()) {
    assert.equal(response.headers['cache-control'], 'no-store');
    if (index % 2 === 0) {
      const items = SalesVehicleListResponseSchema.parse(response.json()).data.items;
      assert.deepEqual(new Set(items.map(vehicle => vehicle.id)), new Set(available.slice(0, 2)));
    } else {
      const { vehicle } = SalesVehicleLookupResponseSchema.parse(response.json()).data;
      assert.equal(vehicle.id, index % 4 === 1 ? sold : reserved);
    }
  }
});

test('market includes qualifying rows across cursor pages and shares the full snapshot with a narrow filter', async () => {
  await db.transaction(async tx => {
    await tx.query(`CREATE TEMP TABLE paged_market_fixture ON COMMIT DROP AS
      SELECT n, gen_random_uuid() AS vehicle_id,gen_random_uuid() AS publication_id
      FROM generate_series(1,257) n`);
    await tx.query(`INSERT INTO vehicles(id,availability,availability_checked_at)
      SELECT vehicle_id,'available',now() FROM paged_market_fixture`);
    await tx.query(`INSERT INTO vehicle_publications(id,vehicle_id,data)
      SELECT fixture.publication_id,fixture.vehicle_id,
        jsonb_set(jsonb_set(jsonb_set(p.data,'{facts,model,id}','"paged_market_model"'),
          '{facts,mileageKm}',to_jsonb(fixture.n)), '{price,money,amount}',to_jsonb((10000+fixture.n)::text))
      FROM paged_market_fixture fixture CROSS JOIN vehicle_publications p WHERE p.vehicle_id=$1`, [available[0]]);
    await tx.query(`UPDATE vehicles v SET published_revision_id=f.publication_id,publication_state='published',published_at=now()
      FROM paged_market_fixture f WHERE v.id=f.vehicle_id`);
  });
  const url = '/api/v1/public/market-prices?locale=en&make=fixture_make&model=paged_market_model';
  const read = async (suffix: string) => {
    const response = await runtime.app.inject({ url: url + suffix, remoteAddress: '127.0.0.4' });
    assert.equal(response.statusCode, 200, response.body);
    return MarketPriceResponseSchema.parse(response.json()).data;
  };
  const [whole, tail] = await Promise.all([read(''), read('&mileageMin=255')]);
  assert.equal(whole.sampleCount, 257);
  assert.equal(whole.statistics.median?.cny.amount, '10129.00');
  assert.equal(tail.sampleCount, 3);
  assert.equal(tail.statistics.min?.cny.amount, '10255.00');
  assert.equal(tail.statistics.max?.cny.amount, '10257.00');
  assert.equal(whole.asOf, tail.asOf);
});

test('cold Mercedes E-Class returns an exact default and a scoped result beyond the row-cache cap', async () => {
  await db.transaction(async tx => {
    await tx.query(`CREATE TEMP TABLE market_large_model ON COMMIT DROP AS
      SELECT n,gen_random_uuid() AS vehicle_id,gen_random_uuid() AS publication_id
      FROM generate_series(1,8194) n`);
    await tx.query(`INSERT INTO vehicles(id,availability,availability_checked_at)
      SELECT vehicle_id,'available',now() FROM market_large_model`);
    await tx.query(`INSERT INTO vehicle_publications(id,vehicle_id,data)
      SELECT f.publication_id,f.vehicle_id,jsonb_set(jsonb_set(jsonb_set(jsonb_set(p.data,
        '{facts,make,id}','"mercedes-benz"'), '{facts,model,id}','"cca-model-214"'),
        '{facts,modelYear}',to_jsonb(CASE WHEN f.n>8190 THEN 2024 ELSE 2018 END)),
        '{price,money,amount}',to_jsonb((10000+f.n)::text))
      FROM market_large_model f CROSS JOIN vehicle_publications p WHERE p.vehicle_id=$1`, [available[0]]);
    await tx.query(`UPDATE vehicles v SET published_revision_id=f.publication_id,publication_state='published',published_at=now()
      FROM market_large_model f WHERE v.id=f.vehicle_id`);
  });

  const url = '/api/v1/public/market-prices?make=mercedes-benz&model=cca-model-214&locale=zh';
  const [broad, narrow] = await Promise.all([
    runtime.app.inject({ url, remoteAddress: '127.0.0.5' }),
    runtime.app.inject({ url: url + '&yearMin=2024', remoteAddress: '127.0.0.5' }),
  ]);
  assert.equal(broad.statusCode, 200, broad.body);
  const full = MarketPriceResponseSchema.parse(broad.json()).data;
  assert.equal(full.sampleCount, 8194);
  assert.equal(full.statistics.min?.cny.amount, '10001.00');
  assert.equal(full.statistics.max?.cny.amount, '18194.00');
  assert.equal(full.statistics.mean?.cny.amount, '14097.50');
  assert.equal(full.statistics.median?.cny.amount, '14097.50');
  assert.equal(full.statistics.p25?.cny.amount, '12049.25');
  assert.equal(full.statistics.p75?.cny.amount, '16145.75');
  assert.equal(narrow.statusCode, 200, narrow.body);
  const result = MarketPriceResponseSchema.parse(narrow.json()).data;
  assert.equal(result.sampleCount, 4);
  assert.equal(result.statistics.min?.cny.amount, '18191.00');
  assert.equal(result.statistics.median?.cny.amount, '18192.50');
  assert.equal(result.statistics.max?.cny.amount, '18194.00');
  assert.equal(result.statistics.p25, null);
  assert.equal(result.extremes.max?.vehicle.id, full.extremes.max?.vehicle.id);
  assert.notEqual(result.extremes.min?.vehicle.id, full.extremes.min?.vehicle.id);
  const read = async (query = url) => {
    const response = await runtime.app.inject({ url: query, remoteAddress: '127.0.0.5' });
    assert.equal(response.statusCode, 200, response.body);
    return MarketPriceResponseSchema.parse(response.json()).data;
  };
  assert.deepEqual(await read(), full);
  const sellMax = async (data: typeof full) => {
    await db.pool.query("UPDATE vehicles SET availability='sold',availability_checked_at=now() WHERE id=$1",
      [data.extremes.max!.vehicle.id]);
  };
  await sellMax(full);
  const stillOversized = await read();
  assert.equal(stillOversized.sampleCount, 8193);
  assert.equal(stillOversized.statistics.max?.cny.amount, '18193.00');
  await sellMax(stillOversized);
  const rowSnapshot = await read();
  assert.equal(rowSnapshot.sampleCount, 8192);
  assert.equal(rowSnapshot.statistics.max?.cny.amount, '18192.00');
  assert.equal(rowSnapshot.statistics.p25?.cny.amount, '12048.75');
  const narrowedAfterSales = await read(url + '&yearMin=2024');
  assert.equal(narrowedAfterSales.sampleCount, 2);
  assert.equal(narrowedAfterSales.extremes.max?.vehicle.id, rowSnapshot.extremes.max?.vehicle.id);
});
