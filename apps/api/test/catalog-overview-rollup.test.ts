import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { PublicFilterQuerySchema, PublicVehicleFiltersSchema } from '@hd/contracts/public';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { applyFormalCandidate, ExternalStore } from '../src/external/store.js';
import { InventoryService } from '../src/vehicles/service.js';

const masks = [['zh', 1], ['en', 2], ['ru', 4]] as const;
const brand = 'rollup-fixture-make';
const groupKeys = 'powertrain,locale_mask,model_year,make_id,drivetrain';
const groupValues = `row_count::bigint,trim_count::bigint,generation_count::bigint,
  CASE WHEN make_id IS NOT NULL THEN label_order END AS label_order`;
const options = { locale: 'zh', catalog: 'curated', view: 'localized', powertrain: 'bev', yearMin: 2020 };
const filter = (extra = {}) => PublicFilterQuerySchema.parse({ ...options, ...extra });

test('supplier overview rollups backfill and stay exact with the public filter contract', async t => {
  const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
    url.pathname !== '/postgres' || url.search || url.hash) throw new Error('Only isolated loopback PostgreSQL is supported.');
  const database = `hd_overview_rollup_${randomBytes(8).toString('hex')}`;
  const maintenance = createDatabase(url.href, 1);
  const directory = await mkdtemp(path.join(tmpdir(), 'hd-overview-rollup-'));
  url.pathname = `/${database}`;
  const db = createDatabase(url.href, 3);
  let created = false;
  t.after(async () => {
    try { await db.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(directory, { recursive: true, force: true }); }
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${database}"`);
  created = true;
  const migrationSource = new URL('../migrations/', import.meta.url);
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrationSource), 'utf8'));
  const entries = (journal.entries as { idx: number; tag: string }[]).filter(entry => entry.idx < 47);
  await mkdir(path.join(directory, 'meta'));
  await Promise.all(entries.map(({ tag }) => copyFile(new URL(`${tag}.sql`, migrationSource), path.join(directory, `${tag}.sql`))));
  await writeFile(path.join(directory, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await migrate(db.orm, { migrationsFolder: directory });
  assert.equal((await db.pool.query("SELECT to_regclass('external_catalog_overview_groups') AS table_name")).rows[0].table_name, null);

  const actor = { id: 'overview-rollup-admin', requestId: randomUUID() };
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Overview fixture','overview@example.invalid','admin',false)", [actor.id]);
  const apply = (tx: PoolClient, number: number, revision = 1,
    { amount = '120000', withdraw = false, name = `合成品牌 ${number}` } = {}) => {
    const sample = makeExternalCandidateFixture();
    const externalId = String(996000 + number);
    const fetchedAt = new Date(Date.UTC(2026, 1, 1, 0, number, revision)).toISOString();
    const common = { externalId, platformId: 'che168', revision, fetchedAt, sourceUpdatedAt: fetchedAt };
    const title = { text: `汇总回归样车 ${number}`, contentLocale: 'zh' as const };
    return applyFormalCandidate(tx, withdraw ? { ...common, operation: 'withdraw' } : {
      ...sample, ...common, listingUrl: `https://www.che168.com/dealer/1/${externalId}.html`,
      relatedListingUrls: [], images: [], inspection: null, price: number === 8 ? null : { cny: amount },
      facts: { ...sample.facts, make: number === 2 ? null : { id: brand, name },
        drivetrain: number === 3 ? null : 'fwd', modelYear: number === 10 ? 2019 : 2020,
        powertrain: number === 11 ? 'hev' : 'bev',
        trim: number % 2 ? { id: 'overview-trim', name: '合成配置' } : null,
        generation: number >= 4 ? { id: 'overview-generation', name: '合成车系' } : null },
      copy: { ...sample.copy, title: { original: title, translations: {} } },
    }, actor, randomUUID(), { id: `chinacarapi:che168:${externalId}`, primary: true });
  };
  const fixtures: string[] = [];
  await db.transaction(async tx => {
    for (let number = 0; number <= 11; number++) {
      const { listingId } = await apply(tx, number);
      fixtures.push(listingId);
      const mask = number <= 7 ? number : 7;
      await tx.query('UPDATE external_catalog SET localized=localized-$2::text[],published_at=$3 WHERE listing_id=$1',
        [listingId, masks.filter(([, bit]) => !(mask & bit)).map(([locale]) => locale), new Date(Date.UTC(2026, 1, 1, 0, number)).toISOString()]);
      if (number === 9) await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1", [listingId]);
    }
  });
  const raw = new InventoryService(db, true);
  const fromFull = async (extra = {}) => {
    const { trims, generations, priceCurrencies, models, ...common } = await raw.filters(filter(extra));
    return { ...common, models: [], hasTrims: Boolean(trims?.length), hasGenerations: Boolean(generations?.length) };
  };
  const baseline = await fromFull();
  await migrateDatabase(db);

  const statements: string[] = [];
  const observed = { ...db, transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => db.transaction(tx => work({
    query: async (sql: string, params?: unknown[]) => { statements.push(sql); return tx.query(sql, params); },
  } as PoolClient)) } as Database;
  const service = new InventoryService(observed, true);
  const compare = async (extra = {}, usesRollup = true) => {
    statements.length = 0;
    const result = await service.filters(filter({ ...extra, projection: 'overview' }));
    assert.equal(statements.some(sql => sql.includes('FROM external_catalog_overview_groups f')), usesRollup, JSON.stringify(extra));
    assert.deepEqual(result, await fromFull(extra));
    return result;
  };
  const groups = async (reader: Pick<PoolClient, 'query'> = db.pool, version = false) => (await reader.query(
    `SELECT ${groupKeys},${groupValues}${version ? ',xmin::text AS version' : ''}
    FROM external_catalog_overview_groups ORDER BY ${groupKeys}`)).rows;
  const checkGroups = async (reader: Pick<PoolClient, 'query'> = db.pool) => {
    const expected = (await reader.query(`SELECT ${groupKeys},count(*) AS row_count,
       count(*) FILTER(WHERE make_id IS NOT NULL AND model_id IS NOT NULL AND trim_id IS NOT NULL) AS trim_count,
       count(*) FILTER(WHERE make_id IS NOT NULL AND model_id IS NOT NULL AND generation_id IS NOT NULL) AS generation_count,
       min(label_order COLLATE "C") FILTER(WHERE make_id IS NOT NULL) AS label_order
      FROM external_catalog_filter WHERE active AND locale_mask<>0 AND powertrain IS NOT NULL AND powertrain<>'unknown' AND model_year IS NOT NULL
      GROUP BY ${groupKeys} ORDER BY ${groupKeys}`)).rows;
    assert.deepEqual(await groups(reader), expected);
  };

  await t.test('backfill agrees with raw rows and public HTTP for every locale', async () => {
    await checkGroups();
    assert.deepEqual(await compare(), baseline);
    for (const [locale] of masks) assert.equal((await compare({ locale })).total, 5);
    assert.equal(baseline.makes[0]?.count, 5);
    assert.equal((await compare({ make: brand, drivetrain: 'fwd', yearMax: 2020 })).total, 4);
    assert.equal((await compare({ yearMin: undefined, yearMax: 2019 })).total, 1);
    assert.equal((await compare({ yearMin: 2099 })).total, 0);
    assert.equal((await db.pool.query('SELECT price_cny FROM external_catalog_filter WHERE listing_id=$1', [fixtures[8]])).rows[0].price_cny, null);
    const runtime = await buildApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: url.href, AUTH_SECRET: randomBytes(32).toString('hex'),
      MEDIA_ROOT: directory, AUTH_BASE_URL: 'http://127.0.0.1:3318', TRUSTED_ORIGINS: 'http://127.0.0.1:3318',
      CATALOG_READ_MODE: 'combined', PUBLIC_CATALOG_CACHE: 'memory', HD_DEPLOYMENT_ENV: 'test', HD_RELEASE_ID: 'a'.repeat(40) }));
    try {
      const result = await runtime.app.inject({ url: `/api/v1/vehicle-filters?${new URLSearchParams({ ...options, yearMin: '2020', projection: 'overview' })}` });
      assert.equal(result.statusCode, 200, result.body);
      assert.deepEqual(PublicVehicleFiltersSchema.parse(result.json()).data, baseline);
    } finally { await runtime.app.close(); }
  });

  await t.test('precise filters and different projections retain the raw path', async () => {
    for (const extra of [{ q: '汇总回归样车 8' }, { model: 'synthetic-r1' }, { mileageMin: 1000 },
      { priceMin: '100000', priceCurrency: 'CNY' }, { exportStatus: 'unknown' }, { yearMin: undefined }]) await compare(extra, false);
    statements.length = 0;
    const models = await service.filters(filter({ projection: 'overview-models' }));
    assert.ok(models.models.length > 0);
    assert.equal(statements.some(sql => sql.includes('external_catalog_overview_groups')), false);
  });

  await t.test('price and metadata preserve the group tuple; winner labels track overrides and withdrawal', async () => {
    const version = await groups(db.pool, true);
    await db.transaction(tx => apply(tx, 7, 2, { amount: '130000' }));
    assert.equal((await db.pool.query('SELECT price_cny FROM external_catalog_filter WHERE listing_id=$1', [fixtures[7]])).rows[0].price_cny, '130000.00');
    await db.pool.query("UPDATE external_listings SET fetched_at=fetched_at+interval '1 hour' WHERE id=$1", [fixtures[7]]);
    assert.deepEqual(await groups(db.pool, true), version);
    await db.transaction(async tx => {
      const swapTrims = () => tx.query(`UPDATE external_catalog_filter
        SET trim_id=CASE WHEN trim_id IS NULL THEN 'overview-trim' END WHERE listing_id=ANY($1::uuid[])`,
      [[fixtures[7], fixtures[8]]]);
      await swapTrims();
      assert.deepEqual(await groups(tx, true), version);
      await swapTrims();
    });
    const id = fixtures[8]!;
    await db.transaction(tx => apply(tx, 8, 2, { name: '供应商更新品牌' }));
    assert.equal((await compare()).makes[0]?.name, '供应商更新品牌');
    const store = new ExternalStore(db);
    const listing = await store.getListing(`ext-${id}`, 'zh');
    await store.saveOverrides(`ext-${id}`, { version: listing.version, overrides: {
      ...listing.overrides, facts: { ...listing.overrides.facts, make: { id: brand, name: '员工更正品牌' } },
    } }, randomUUID(), actor);
    assert.equal((await compare()).makes[0]?.name, '员工更正品牌');
    assert.deepEqual(await groups(db.pool, true), version);
    await db.pool.query("UPDATE external_catalog_search SET make_label=NULL WHERE listing_id=$1 AND locale='zh'", [id]);
    assert.notEqual((await compare()).makes[0]?.name, '员工更正品牌');
    assert.ok(statements.some(sql => sql.includes('jsonb_to_recordset')));
    await db.transaction(tx => apply(tx, 8, 3, { withdraw: true }));
    await checkGroups();
    assert.equal((await compare()).total, baseline.total! - 1);
    assert.equal((await compare()).makes[0]?.name, '合成品牌 7');
  });

  await t.test('group moves roll back and truncation clears the derived overview', async () => {
    const before = await groups(db.pool, true);
    const abort = new Error('Rollback synthetic overview move');
    await assert.rejects(db.transaction(async tx => {
      await tx.query("UPDATE external_catalog_filter SET model_year=2022 WHERE listing_id=$1", [fixtures[7]]);
      await tx.query("UPDATE external_catalog_filter SET locale_mask=1 WHERE listing_id=$1", [fixtures[3]]);
      await checkGroups(tx);
      assert.notDeepEqual(await groups(tx, true), before);
      assert.deepEqual(await groups(db.pool, true), before);
      throw abort;
    }), abort);
    assert.deepEqual(await groups(db.pool, true), before);
    await db.pool.query('TRUNCATE external_catalog_filter');
    await checkGroups();
    assert.deepEqual(await groups(), []);
    assert.equal((await compare()).total, 0);
    await db.pool.query('TRUNCATE external_catalog_filter');
    assert.deepEqual(await groups(), []);
  });
});
