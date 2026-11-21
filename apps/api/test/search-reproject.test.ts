import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { promisify } from 'node:util';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { buildProjection, emptyOverrides } from '../src/external/normalize.js';
import { reprojectStoredSearch } from '../src/external/search-reproject.js';

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

test('supplier search repair serializes, resumes and changes only unsafe or corrupted public index terms', async t => {
  const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(maintenanceUrl.protocol) || maintenanceUrl.hostname !== '127.0.0.1' ||
    maintenanceUrl.pathname !== '/postgres' || maintenanceUrl.search || maintenanceUrl.hash) {
    throw new Error('An isolated loopback PostgreSQL maintenance database is required.');
  }
  const maintenance = createDatabase(maintenanceUrl.href, 1);
  const name = `hd_ext_search_reproject_${randomBytes(8).toString('hex')}`;
  const address = new URL(maintenanceUrl.href);
  address.pathname = `/${name}`;
  let db: Database | undefined;
  let created = false;
  t.after(async () => {
    try { await db?.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await maintenance.close(); }
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  const target = db = createDatabase(address.href, 3);
  await migrateDatabase(target);

  const privateTitle = 'Dealer cost: CNY 73142';
  const privateContact = 'Seller contact: (202) 555-0142';
  for (let index = 1; index <= 3; index++) {
    const candidate = makeExternalCandidateFixture(index);
    const projection = buildProjection(candidate, emptyOverrides(), 'Synthetic Market');
    const { en } = projection.localized;
    if (index < 3) {
      en.title.text = privateTitle;
      en.display.model = { ...en.display.make, status: 'ready', text: privateContact,
        contentLocale: 'en', provenance: 'supplier', reviewed: false };
      en.display.generation = { ...en.display.model, text: 'Internal fees: CNY 73000' };
      en.display.trim = { ...en.display.model, text: 'Seller telephone' };
      projection.localized.zh.title.text = '内部采购成本 CNY 71092';
    } else {
      en.title.text = `${'A'.repeat(501)} ${privateContact}`;
    }
    en.display.make = { ...en.display.make, status: 'ready', text: 'Toyota Authorized',
      contentLocale: 'en', provenance: 'human', reviewed: true };
    await target.transaction(async tx => {
      await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
        VALUES($1,$2,$3,$4,1,$5,$6,'active',now(),now())`, [id(index), index === 2 ? 'synthetic-feed' : 'chinacarapi',
        index === 2 ? 'synthetic-market' : 'che168', String(index), 'a'.repeat(64), JSON.stringify(candidate)]);
      await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
        VALUES($1,now(),'Synthetic Market',$2,$3,$4,$5,$6,$7)`, [id(index), candidate.listingUrl, JSON.stringify(projection.facts),
        projection.priceCny, JSON.stringify(projection.issues), JSON.stringify(projection.localized), JSON.stringify(projection.details)]);
      await tx.query('INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,$2)', [id(index), JSON.stringify(emptyOverrides())]);
    });
  }
  await target.pool.query("UPDATE external_catalog_search SET stock_text=$2 WHERE listing_id=$1 AND locale='en'", [id(1), privateContact]);
  // A missing search row is outside the repair scope. The command must not create public rows or change visibility.
  await target.pool.query("DELETE FROM external_catalog_search WHERE listing_id=$1 AND locale='ru'", [id(3)]);
  const stored = async () => (await target.pool.query(`SELECT to_jsonb(l) AS listing,to_jsonb(c) AS catalog,o.data AS overrides,
    count(*) OVER() AS row_count FROM external_listings l JOIN external_catalog c ON c.listing_id=l.id
    JOIN external_listing_overrides o ON o.listing_id=l.id ORDER BY l.id`)).rows;
  const storedBefore = await stored();
  const search = async (listingId: string, locale = 'en') => (await target.pool.query(
    'SELECT * FROM external_catalog_search WHERE listing_id=$1 AND locale=$2', [listingId, locale])).rows[0];
  const revision = async () => (await target.pool.query<{revision: string; filter_revision: string}>(
    'SELECT revision,filter_revision FROM public_catalog_state WHERE id=1')).rows[0]!;
  const priors = await revision();
  assert.match((await search(id(1))).search_document, /73142|555-0142/);
  const secondHistoricalLocale = await search(id(1), 'zh');
  assert.match(secondHistoricalLocale.search_document, /71092/);
  const cleanLocaleBefore = await search(id(1), 'ru');
  const nonSupplierBefore = await search(id(2));

  const sync = await target.pool.connect();
  try {
    await sync.query('BEGIN');
    await sync.query('SELECT pg_advisory_xact_lock(78291332)');
    await assert.rejects(reprojectStoredSearch(target, { limit: 1 }), { code: '55P03' });
    assert.deepEqual(await revision(), priors);
    assert.match((await search(id(1))).search_document, /73142|555-0142/);
  } finally {
    try { await sync.query('ROLLBACK'); } finally { sync.release(); }
  }

  await target.pool.query(`ALTER TABLE external_catalog_search ADD CONSTRAINT reject_repair_test
    CHECK (locale<>'zh' OR title_text<>'') NOT VALID`);
  try {
    await assert.rejects(reprojectStoredSearch(target, { limit: 1 }), { code: '23514' });
    assert.deepEqual(await revision(), priors);
    assert.deepEqual(await search(id(1), 'zh'), secondHistoricalLocale);
    assert.match((await search(id(1))).search_document, /73142|555-0142/);
  } finally {
    await target.pool.query('ALTER TABLE external_catalog_search DROP CONSTRAINT reject_repair_test');
  }

  const first = await reprojectStoredSearch(target, { limit: 1 });
  assert.deepEqual(first, { scanned: 1, changedRows: 2, nextCursor: id(1) });
  const repaired = await search(id(1));
  assert.doesNotMatch(JSON.stringify(repaired), /73142|555-0142|73000|Seller telephone/);
  assert.equal(repaired.make_label, 'Toyota Authorized');
  assert.equal(repaired.make_text, 'Toyota Authorized');
  assert.equal(repaired.model_label, storedBefore[0].catalog.facts.model.name);
  assert.equal(repaired.model_text, '');
  assert.equal(repaired.title_text, '');
  assert.equal(repaired.stock_text, `EXT-${id(1).toUpperCase()}`);
  assert.equal((await search(id(1), 'zh')).title_text, '');
  assert.deepEqual(await search(id(1), 'ru'), cleanLocaleBefore);
  const afterFirst = await revision();
  assert.equal(BigInt(afterFirst.revision), BigInt(priors.revision) + 1n);
  assert.equal(BigInt(afterFirst.filter_revision), BigInt(priors.filter_revision) + 1n);

  assert.deepEqual(await reprojectStoredSearch(target, { limit: 1 }), { scanned: 1, changedRows: 0, nextCursor: id(1) });
  assert.deepEqual(await revision(), afterFirst);
  const second = await reprojectStoredSearch(target, { after: first.nextCursor!, limit: 1 });
  assert.deepEqual(second, { scanned: 1, changedRows: 0, nextCursor: id(2) });
  assert.deepEqual(await search(id(2)), nonSupplierBefore);
  assert.deepEqual(await revision(), afterFirst);

  const cli = promisify(execFile);
  const args = ['--import', 'tsx', 'src/external/search-reproject-cli.ts', '--database', name, '--after', second.nextCursor!];
  const env = { ...process.env, DATABASE_URL: address.href, DATABASE_URL_FILE: undefined, NODE_ENV: 'test' };
  const apiDirectory = new URL('..', import.meta.url);
  await assert.rejects(cli(process.execPath, args, { cwd: apiDirectory, env }), { code: 1 });
  assert.match((await search(id(3))).title_text, /555-0142/);
  const executed = await cli(process.execPath, [...args, '--apply'], { cwd: apiDirectory, env });
  assert.deepEqual(JSON.parse(executed.stdout), { scanned: 1, changedRows: 1, nextCursor: null });
  assert.equal((await search(id(3))).title_text, '');
  assert.equal(await search(id(3), 'ru'), undefined);
  assert.deepEqual(await stored(), storedBefore);
  assert.equal((await target.pool.query('SELECT 1 FROM external_source_blobs LIMIT 1')).rowCount, 0);
});
