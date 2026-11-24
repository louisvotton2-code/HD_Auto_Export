import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { PublicFilterQuerySchema, PublicVehicleQuerySchema, type Locale } from '@hd/contracts/public';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { countExternal, preferIndexedHanPair } from '../src/external/catalog.js';
import { seedSyntheticFx } from '../src/external/fx.js';
import { advanceKeywordMatch } from '../src/external/keyword-match-maintenance.js';
import { applyFormalCandidate } from '../src/external/store.js';
import { InventoryService } from '../src/vehicles/service.js';

const listingQuery = (locale: Locale, options: Record<string, unknown> = {}) => PublicVehicleQuerySchema.parse({
  locale, catalog: 'curated', view: 'localized', projection: 'card', pageSize: 2, ...options,
});
const localeBits = [['zh', 1], ['en', 2], ['ru', 4]] as const;

test('exact supplier locale counts backfill and track the same snapshot as the searchable catalog', async t => {
  const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1' ||
    address.pathname !== '/postgres' || address.search || address.hash) throw new Error('Only isolated loopback PostgreSQL is supported.');
  const name = `hd_ext_scale_locale_counts_${randomBytes(8).toString('hex')}`;
  const maintenance = createDatabase(address.href, 1);
  const previousMigrations = await mkdtemp(path.join(tmpdir(), 'hd-catalog-locale-counts-'));
  address.pathname = `/${name}`;
  const db = createDatabase(address.href, 4);
  let created = false;
  t.after(async () => {
    try { await db.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(previousMigrations, { recursive: true, force: true }); }
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  const migrationSource = new URL('../migrations/', import.meta.url);
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrationSource), 'utf8'));
  const entries = (journal.entries as {idx: number; tag: string}[]).filter(entry => entry.idx < 46);
  await mkdir(path.join(previousMigrations, 'meta'));
  await Promise.all(entries.map(({tag}) => copyFile(new URL(`${tag}.sql`, migrationSource), path.join(previousMigrations, `${tag}.sql`))));
  await writeFile(path.join(previousMigrations, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await migrate(db.orm, { migrationsFolder: previousMigrations });
  const hasCounter = async () => (await db.pool.query<{present:boolean}>(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='external_catalog_state' AND column_name='locale_counts') AS present`)).rows[0]!.present;
  assert.equal(await hasCounter(), false);

  const actor = { id: 'catalog-counts-admin', requestId: randomUUID() };
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Locale counts fixture','counts@example.invalid','admin',false)", [actor.id]);
  const apply = (tx: PoolClient, number: number, revision: number, amount?: string) => {
    const base = makeExternalCandidateFixture();
    const externalId = String(995000 + number);
    const common = { externalId, platformId: 'che168', revision, fetchedAt: base.fetchedAt, sourceUpdatedAt: base.sourceUpdatedAt };
    const title = { text: `Locale Regression ${number}`, contentLocale: 'en' as const };
    return applyFormalCandidate(tx, amount === undefined ? { ...common, operation: 'withdraw' } : {
      ...base, ...common, listingUrl: `https://www.che168.com/dealer/1/${externalId}.html`, relatedListingUrls: [],
      price: { cny: amount }, images: [], inspection: null, copy: { ...base.copy, title: { original: title, translations: {} } },
    }, actor, randomUUID(), { id: `chinacarapi:che168:${externalId}`, primary: true });
  };
  const fixtures: string[] = [];
  await db.transaction(async tx => {
    for (let mask = 0; mask <= 7; mask++) {
      const { listingId } = await apply(tx, mask, 1, String((mask + 1) * 8));
      fixtures.push(listingId);
      const removed = localeBits.filter(([,bit]) => !(mask & bit)).map(([locale]) => locale);
      await tx.query('UPDATE external_catalog SET localized=localized-$2::text[] WHERE listing_id=$1', [listingId, removed]);
    }
    const { listingId } = await apply(tx, 8, 1, '80');
    await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1", [listingId]);
  });
  assert.deepEqual((await db.pool.query('SELECT active,locale_mask FROM external_catalog_filter ORDER BY active DESC,locale_mask')).rows,
    [...fixtures.map((_id, locale_mask) => ({ active: true, locale_mask })), { active: false, locale_mask: 7 }]);
  const pairMigration = await readFile(new URL('0050_external_search_zh_han_pairs.sql', migrationSource), 'utf8');
  const [definePairFunction, verifyPairIndex] = pairMigration.split('--> statement-breakpoint');
  await db.transaction(tx => tx.query(definePairFunction!));
  await assert.rejects(db.transaction(async tx => {
    await tx.query("SET LOCAL hd.require_prebuilt_search_zh_han_pairs_index='on'");
    await tx.query(verifyPairIndex!);
  }), /must be prebuilt concurrently/);
  await db.pool.query(`CREATE INDEX CONCURRENTLY external_catalog_search_zh_han_pairs_idx ON public.external_catalog_search
    USING gin (public.external_catalog_han_pairs(search_document)) WHERE locale='zh'`);
  const indexOid = async () => (await db.pool.query<{oid:string}>(`SELECT 'external_catalog_search_zh_han_pairs_idx'::regclass::oid::text AS oid`)).rows[0]!.oid;
  const prebuiltIndex = await indexOid();
  await db.pool.query(`CREATE INDEX CONCURRENTLY external_catalog_filter_model_winner_idx ON public.external_catalog_filter
    (make_id,model_id,locale_mask,published_at DESC,listing_id)
    WHERE active AND locale_mask<>0 AND make_id IS NOT NULL AND model_id IS NOT NULL`);
  const rollupIndexOid = async () => (await db.pool.query<{oid:string}>(
    "SELECT 'external_catalog_filter_model_winner_idx'::regclass::oid::text AS oid")).rows[0]!.oid;
  const prebuiltWinnerIndex = await rollupIndexOid();
  await migrateDatabase(db);
  assert.equal(await hasCounter(), true);
  assert.equal(await indexOid(), prebuiltIndex, 'the migration adopts the live concurrent index in place');
  assert.equal(await rollupIndexOid(), prebuiltWinnerIndex, 'the global facet migration adopts the concurrent index');

  const buckets = async (reader: Pick<PoolClient, 'query'> = db.pool) => (await reader.query<{locale_counts: string[]}>(
    'SELECT locale_counts FROM external_catalog_state WHERE id=1')).rows[0]!.locale_counts.map(Number);
  const compareTotals = async (expected: readonly number[], reader: Pick<PoolClient, 'query'> = db.pool) => {
    for (const [index, [locale, bit]] of localeBits.entries()) {
      const exact = (await reader.query<{total: number}>(`SELECT count(*)::int AS total FROM external_catalog_filter
        WHERE active AND locale_mask<>0 AND (locale_mask & $1::smallint)<>0`, [bit])).rows[0]!.total;
      assert.equal(exact, expected[index], locale);
      assert.equal(await countExternal(reader, listingQuery(locale)), exact, locale);
      const grouped = (await reader.query<{total:number}>(`SELECT coalesce(sum(row_count),0)::int AS total
        FROM external_catalog_global_facets WHERE (locale_mask & $1::smallint)<>0`,[bit])).rows[0]!.total;
      assert.equal(grouped, exact, `global facet counts for ${locale}`);
    }
  };

  await t.test('backfills all seven eligible masks and ignores mask zero and inactive rows', async () => {
    assert.deepEqual(await buckets(), [1, 1, 1, 1, 1, 1, 1]);
    await compareTotals([4, 4, 4]);
  });

  await t.test('uses bounded totals for exact pagination and preserves search, USD ranges and sorting', async () => {
    await seedSyntheticFx(db, 'b');
    const statements: string[] = [];
    const observed = { ...db, transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => db.transaction(tx => work({
      query: async (sql: string, params?: unknown[]) => { statements.push(sql); return tx.query(sql, params); },
    } as PoolClient)) } as Database;
    const service = new InventoryService(observed, true);
    const page = async (options: Record<string, unknown> = {}) => {
      statements.length = 0;
      return service.listPublic(listingQuery('en', { priceView: 'usd', ...options }), 'catalog-locale-counts');
    };
    const first = await page({ sort: 'price_asc' });
    assert.equal(first.meta.total, 4);
    assert.equal(first.meta.totalKind, 'exact');
    assert.equal(first.meta.accessibleTotal, 4);
    assert.equal(first.data.hasMore, true);
    assert.deepEqual(first.data.items.map(item => item.id), [2, 3].map(mask => `ext-${fixtures[mask]}`));
    assert.ok(statements.some(sql => sql.includes('locale_counts')));
    assert.ok(statements.every(sql => !/SELECT count\(\*\)::int AS total\s+FROM external_catalog_filter/i.test(sql)));
    const beyond = await page({ page: 3 });
    assert.equal(beyond.meta.total, 4);
    assert.equal(beyond.data.hasMore, false);
    assert.deepEqual(beyond.data.items, []);
    assert.ok(statements.some(sql => sql.includes('locale_counts')));

    const priced = first.data.items[0]?.displayPrice;
    assert.equal(priced?.status, 'ready');
    const amount = priced.money.amount;
    const bounded = await page({ priceMin: amount, priceMax: amount, priceCurrency: 'USD' });
    assert.equal(bounded.meta.total, 1);
    assert.deepEqual(bounded.data.items.map(item => item.id), [`ext-${fixtures[2]}`]);
    assert.ok(statements.every(sql => !sql.includes('locale_counts')));
    const searched = await page({ q: 'Locale Regression 2' });
    assert.equal(searched.meta.total, 1);
    assert.deepEqual(searched.data.items.map(item => item.id), [`ext-${fixtures[2]}`]);
    assert.ok(statements.every(sql => !sql.includes('locale_counts')));
  });

  await t.test('publication, price updates, language changes and withdrawal maintain the counters', async () => {
    const { listingId } = await db.transaction(tx => apply(tx, 9, 1, '800'));
    await compareTotals([5, 5, 5]);
    assert.deepEqual(await buckets(), [1, 1, 1, 1, 1, 1, 2]);
    await db.transaction(tx => apply(tx, 9, 2, '900'));
    assert.equal((await db.pool.query('SELECT price_cny FROM external_catalog_filter WHERE listing_id=$1', [listingId])).rows[0].price_cny, '900.00');
    assert.deepEqual(await buckets(), [1, 1, 1, 1, 1, 1, 2]);
    const counterTuple = async () => (await db.pool.query('SELECT xmin::text AS version FROM external_catalog_state WHERE id=1')).rows[0].version;
    const beforeNoOp = await counterTuple();
    await db.pool.query('UPDATE external_catalog_filter SET price_cny=price_cny WHERE listing_id=$1', [listingId]);
    assert.equal(await counterTuple(), beforeNoOp);
    await db.pool.query("UPDATE external_catalog SET localized=localized-'en' WHERE listing_id=$1", [listingId]);
    await compareTotals([5, 4, 5]);
    assert.deepEqual(await buckets(), [1, 1, 1, 1, 2, 1, 1]);
    await db.transaction(tx => apply(tx, 9, 3));
    assert.equal((await db.pool.query('SELECT listing_id FROM external_catalog WHERE listing_id=$1', [listingId])).rowCount, 0);
    await compareTotals([4, 4, 4]);
    assert.deepEqual(await buckets(), [1, 1, 1, 1, 1, 1, 1]);
  });

  await t.test('Chinese two-character lookup preserves literal matches, visibility and exact pagination', async () => {
    const term = '海狮';
    // Keep the source and published content untouched. These are isolated search projection rows.
    const terms = [[1, '', '比亚迪海狮07'], [3, '海狮', ''], [5, '海', '狮'], [8, '', '已撤回海狮']] as const;
    for (const [mask, model, title] of terms) {
      await db.pool.query(`UPDATE external_catalog_search SET stock_text='',make_text='',model_text=$2,title_text=$3
        WHERE listing_id=$1 AND locale='zh'`, [fixtures[mask], model, title]);
    }
    assert.equal(await preferIndexedHanPair(db.pool, listingQuery('zh', { q: term })), false, 'missing statistics keep the old access path');
    await db.pool.query(`WITH samples AS (
      INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,upstream_state,fetched_at)
      SELECT gen_random_uuid(),'pair-stats-fixture','che168',(996000+n)::text,1,repeat('a',64),'withdrawn',now()
      FROM generate_series(1,100) AS n RETURNING id
    ) INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
    SELECT samples.id,now(),base.platform_name,base.listing_url,base.facts,base.price_cny,base.issues,base.localized,base.details
    FROM samples CROSS JOIN external_catalog base WHERE base.listing_id=$1`, [fixtures[1]]);
    await db.pool.query(`UPDATE external_catalog_search s SET stock_text='',make_text='',model_text='',title_text='电动汽车'
      FROM external_listings l WHERE s.listing_id=l.id AND l.provider='pair-stats-fixture' AND s.locale='zh'`);
    await db.pool.query('ANALYZE external_catalog_search');
    assert.equal(await preferIndexedHanPair(db.pool, listingQuery('zh', { q: term })), true);
    assert.equal(await preferIndexedHanPair(db.pool, listingQuery('zh', { q: '电动' })), false);
    assert.equal(await preferIndexedHanPair(db.pool, listingQuery('en', { q: term })), false);
    const pairs = (await db.pool.query<{pairs:string[]}>(`SELECT public.external_catalog_han_pairs(E'海\\n狮，海狮狮') AS pairs`)).rows[0]!.pairs;
    assert.deepEqual(new Set(pairs), new Set(['海狮', '狮狮']));
    const make = (await db.pool.query<{make_id:string}>('SELECT make_id FROM external_catalog_filter WHERE listing_id=$1', [fixtures[1]])).rows[0]!.make_id;
    assert.ok(make);
    const input = listingQuery('zh', { q: term, make, pageSize: 1, priceView: 'usd', sort: 'newest' });
    const original = (await db.pool.query<{listing_id:string}>(`SELECT f.listing_id FROM external_catalog_filter f
      JOIN external_catalog_search s ON s.listing_id=f.listing_id AND s.locale='zh'
      WHERE f.active AND (f.locale_mask & 1)<>0 AND f.make_id=$1 AND s.search_document LIKE $2
      ORDER BY f.published_at DESC,f.listing_id`, [make, '%海狮%'])).rows.map(row => `ext-${row.listing_id}`);
    assert.deepEqual(new Set(original), new Set([1, 3].map(mask => `ext-${fixtures[mask]}`)));
    const service = new InventoryService(db, true);
    const first = await service.listPublic(input, 'han-pair');
    const second = await service.listPublic({ ...input, page: 2 }, 'han-pair');
    assert.equal(first.meta.total, 2);
    assert.equal(first.data.hasMore, true);
    assert.equal(second.meta.total, 2);
    assert.equal(second.data.hasMore, false);
    assert.deepEqual([...first.data.items, ...second.data.items].map(item => item.id), original);
    const facets = await service.filters(PublicFilterQuerySchema.parse({ locale: 'zh', view: 'localized', make, q: term, projection: 'overview' }));
    assert.equal(facets.total, 2);
    await db.pool.query('UPDATE external_listings SET upstream_state=\'withdrawn\' WHERE id=$1', [fixtures[1]]);
    try {
      const after = await service.listPublic(input, 'han-pair-after-withdrawal');
      assert.equal(after.meta.total, 1);
      assert.deepEqual(after.data.items.map(item => item.id), [`ext-${fixtures[3]}`]);
    } finally {
      await db.pool.query('UPDATE external_listings SET upstream_state=\'active\' WHERE id=$1', [fixtures[1]]);
    }

    const delayed = { ...db, transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => db.transaction(tx => work({
      query: async (sql: string, params?: unknown[]) => sql.startsWith('WITH matching AS MATERIALIZED')
        ? tx.query('SELECT pg_sleep(1)') : tx.query(sql, params),
    } as PoolClient)) } as Database;
    const deadline = performance.now() + 250;
    await assert.rejects(new InventoryService(delayed, true).listPublic(input, 'han-pair-timeout', undefined, undefined, { deadline }),
      { status: 503, reason: 'deadline', sqlState: '57014' });
  });

  await t.test('unscoped brand words reuse exact English and Russian text matches without restricting makes', async () => {
    const brand = fixtures[6]!, other = fixtures[7]!;
    const originalFacts = (await db.pool.query('SELECT facts FROM external_catalog WHERE listing_id=$1', [other])).rows[0]!.facts;
    await db.pool.query("UPDATE external_catalog SET facts=jsonb_set(facts,'{make}','{\"id\":\"honda\",\"name\":\"Honda\"}') WHERE listing_id=$1", [other]);
    try {
      // Other fixture vehicles share Toyota as their original brand. Set the
      // searchable fields explicitly for this membership check.
      await db.pool.query(`UPDATE external_catalog_search SET stock_text='',make_text='',model_text='',title_text=''
        WHERE listing_id=ANY($1::uuid[]) AND locale IN ('en','ru')`, [fixtures]);
      await db.pool.query(`UPDATE external_catalog_search
        SET stock_text='',model_text='RAV4',make_text='Toyota',title_text='Fixture'
        WHERE listing_id=$1 AND locale IN ('en','ru')`, [brand]);
      await db.pool.query(`UPDATE external_catalog_search
        SET stock_text='',model_text='Civic',make_text='Honda',title_text='Compared with TOYOTA'
        WHERE listing_id=$1 AND locale IN ('en','ru')`, [other]);
      await db.pool.query(`UPDATE external_catalog_search
        SET stock_text='',make_text='Toy',model_text='ota',title_text='No match'
        WHERE (listing_id=$1 AND locale='en') OR (listing_id=$2 AND locale='ru')`, [fixtures[2], fixtures[4]]);
      const withdrawn = await db.pool.query(`UPDATE external_catalog_search s SET title_text='Withdrawn Toyota'
        FROM external_listings l WHERE s.listing_id=l.id AND s.locale IN ('en','ru')
          AND l.provider='chinacarapi' AND l.platform_id='che168' AND l.external_id='995008'`);
      assert.equal(withdrawn.rowCount, 2);

      const combined: string[] = [];
      const observed = { ...db, transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => db.transaction(tx => work({
        query: (sql: string, params?: unknown[]) => {
          if (sql.startsWith('WITH matching AS MATERIALIZED')) combined.push(sql);
          return tx.query(sql, params);
        },
      } as PoolClient)) } as Database;
      const service = new InventoryService(observed, true);
      for (const locale of ['en', 'ru'] as const) {
        const query = listingQuery(locale, { q: 'Toyota', pageSize: 1 });
        const page = await service.listPublic(query, 'unscoped-brand');
        const next = await service.listPublic({ ...query, page: 2 }, 'unscoped-brand-next');
        assert.match(combined.at(-1)!, /LIMIT 49153/);
        assert.equal(combined.at(-1)!.match(/JOIN external_catalog_search\b/g)?.length, 1);
        assert.equal(page.meta.total, 2);
        assert.equal(next.meta.total, 2);
        assert.equal(page.data.hasMore, true);
        assert.equal(next.data.hasMore, false);
        assert.deepEqual(new Set([...page.data.items, ...next.data.items].map(item => item.id)), new Set([`ext-${brand}`, `ext-${other}`]));
        const filters = PublicFilterQuerySchema.parse({ locale, view: 'localized', q: 'Toyota', projection: 'overview' });
        assert.equal((await service.filters(filters)).total, 2);
        const scoped = await service.listPublic({ ...query, q: 'RAV4', make: 'toyota', yearMin: 2020 }, 'scoped-model');
        assert.match(combined.at(-1)!, /LIMIT 8193/);
        assert.equal(scoped.meta.total, 1);
        assert.deepEqual(scoped.data.items.map(item => item.id), [`ext-${brand}`]);
        const sorted = await service.listPublic({ ...query, pageSize: 2, sort: 'price_asc' }, 'unscoped-brand-price');
        assert.deepEqual(sorted.data.items.map(item => item.id), [`ext-${brand}`, `ext-${other}`]);
        assert.equal(sorted.meta.total, 2);
      }
    } finally {
      await db.pool.query('UPDATE external_catalog SET facts=$2 WHERE listing_id=$1', [other, JSON.stringify(originalFacts)]);
    }
  });

  await t.test('verified keyword matches preserve literal results, current visibility and no-op sync', async () => {
    const ids = [fixtures[6]!, fixtures[7]!];
    await db.pool.query(`UPDATE external_catalog SET facts=jsonb_set(facts,'{model}','{"id":"corolla","name":"Corolla"}')
      WHERE listing_id=$1`, [ids[1]]);
    await db.pool.query(`UPDATE external_catalog_search SET title_text=$2
      WHERE listing_id=ANY($1::uuid[]) AND locale IN ('en','ru')`, [ids, 'Special keyword fixture 100% RA']);
    await db.pool.query(`UPDATE external_catalog_search SET make_text='R',model_text='A'
      WHERE listing_id=$1 AND locale IN ('en','ru')`, [ids[0]]);
    await db.pool.query(`UPDATE external_catalog_search SET title_text=title_text||$2
      WHERE listing_id=$1 AND locale IN ('en','ru')`, [ids[1], ' R\nA _']);
    await db.pool.query('TRUNCATE external_catalog_keyword_match');
    await assert.rejects(advanceKeywordMatch(db, 'activate', 2), /Complete and verify/);
    assert.deepEqual(await advanceKeywordMatch(db, 'start', 2), { status: 'maintaining' });
    await assert.rejects(db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await tx.query("UPDATE external_catalog_search SET title_text='Old snapshot edit' WHERE listing_id=$1 AND locale='en'", [ids[0]]);
    }), { code: '0A000' });
    await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(78291332)');
      assert.deepEqual(await advanceKeywordMatch(db, 'backfill', 2), { status: 'busy' });
    });
    const finish = async (action: 'backfill' | 'verify') => {
      for (let n = 0; n < 10; n++) {
        if ((await advanceKeywordMatch(db, action, 2)).status === 'complete') return;
      }
      assert.fail(`Keyword match ${action} did not finish`);
    };
    await finish('backfill');
    await db.pool.query('UPDATE external_catalog_keyword_match SET search_document=$2 WHERE listing_id=$1', [ids[0], 'bad projection']);
    await assert.rejects(finish('verify'), /verification found a difference/);
    await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(78291332)');
      await tx.query('SELECT refresh_external_catalog_keyword_match($1::uuid[])', [ids]);
    });
    await finish('verify');

    const statements: string[] = [];
    const observed = { ...db, transaction: async <T>(work: (tx: PoolClient) => Promise<T>) => db.transaction(tx => work({
      query: (sql: string, params?: unknown[]) => { statements.push(sql); return tx.query(sql, params); },
    } as PoolClient)) } as Database;
    const service = new InventoryService(observed, true);
    const query = listingQuery('en', { q: 'keyword fixture 100%' });
    const filters = PublicFilterQuerySchema.parse({ locale: 'en', catalog: 'curated', view: 'localized',
      q: query.q, projection: 'overview-models' });
    const baseline = await service.listPublic(query, 'keyword-before');
    const baselineFacets = await service.filters(filters);
    assert.equal(baseline.meta.total, 2);
    const scoped = listingQuery('en', { q: 'RA', make: 'toyota', priceView: 'usd', pageSize: 1 });
    const scopedFilters = PublicFilterQuerySchema.parse({ locale: 'en', view: 'localized', priceView: 'usd',
      make: scoped.make, q: scoped.q, projection: 'overview-models' });
    const first = await service.listPublic(scoped, 'scoped-before');
    const second = await service.listPublic({ ...scoped, page: 2 }, 'scoped-before-page2');
    const scopedBefore = await service.filters(scopedFilters);
    assert.equal(first.meta.total, 2);
    assert.equal(second.meta.total, 2);
    assert.equal(scopedBefore.total, 2);
    assert.deepEqual(new Set([...first.data.items, ...second.data.items].map(item => item.id)), new Set(ids.map(id => `ext-${id}`)));
    assert.ok(statements.some(sql => sql.includes('FROM external_catalog_search\n    WHERE locale=') && sql.includes('OFFSET 0')));
    assert.deepEqual(await advanceKeywordMatch(db, 'activate', 2), { status: 'active' });
    await assert.rejects(db.pool.query('TRUNCATE external_catalog_keyword_match_en'), { code: '55000' });
    for (const locale of ['en', 'ru'] as const) {
      statements.length = 0;
      const current = await service.listPublic({ ...query, locale }, 'keyword-active');
      const facets = await service.filters({ ...filters, locale });
      assert.equal(current.meta.total, 2);
      assert.equal(facets.total, baselineFacets.total);
      assert.deepEqual(current.data.items.map(item => item.id), baseline.data.items.map(item => item.id));
      assert.ok(statements.filter(sql => sql.includes('FROM external_catalog_keyword_match f')).length >= 2);
      statements.length = 0;
      const currentFirst = await service.listPublic({ ...scoped, locale }, 'scoped-active');
      const currentSecond = await service.listPublic({ ...scoped, locale, page: 2 }, 'scoped-next');
      assert.equal(currentFirst.meta.total, 2);
      assert.equal(currentSecond.meta.total, 2);
      assert.deepEqual(currentFirst.data.items.map(item => item.id), first.data.items.map(item => item.id));
      assert.deepEqual(currentSecond.data.items.map(item => item.id), second.data.items.map(item => item.id));
      const currentScoped = await service.filters({ ...scopedFilters, locale });
      assert.equal(currentScoped.total, 2);
      assert.deepEqual(currentScoped.models.map(({id,count})=>[id,count]), scopedBefore.models.map(({id,count})=>[id,count]));
      assert.ok(statements.filter(sql => sql.includes('FROM external_catalog_keyword_match\n    WHERE locale=') && sql.includes('OFFSET 0')).length >= 3);
      const modelOnly = await service.listPublic({ ...scoped, locale, make: undefined, model: 'corolla', sort: 'price_asc' }, 'short-model');
      assert.equal(modelOnly.meta.total, 1);
      assert.equal(modelOnly.data.items[0]?.id, `ext-${ids[1]}`);
      const fullQuery = PublicFilterQuerySchema.parse({ locale, view: 'localized', make: 'toyota', q: '%', mileageMin: 0 });
      assert.equal((await service.filters(fullQuery)).total, 2);
      const newline = await service.listPublic({ ...scoped, locale, q: 'R\nA' }, 'short-literal-newline');
      assert.equal(newline.meta.total, 1);
      assert.equal(newline.data.items[0]?.id, `ext-${ids[1]}`);
      const underscore = await service.listPublic({ ...scoped, locale, q: '_' }, 'short-literal-underscore');
      assert.equal(underscore.meta.total, 1);
      assert.equal(underscore.data.items[0]?.id, `ext-${ids[1]}`);
    }
    const version = async () => (await db.pool.query<{xmin:string}>(
      "SELECT xmin::text FROM external_catalog_keyword_match WHERE listing_id=$1 AND locale='en'", [ids[0]])).rows[0]?.xmin;
    const beforePrice = await version();
    await db.pool.query('UPDATE external_catalog_filter SET price_cny=price_cny+1 WHERE listing_id=$1', [ids[0]]);
    assert.equal(await version(), beforePrice);
    await db.pool.query("UPDATE external_catalog_search SET title_text='Another topic' WHERE listing_id=$1 AND locale='en'", [ids[0]]);
    assert.notEqual(await version(), beforePrice);
    assert.equal((await service.listPublic(query, 'keyword-after-edit')).meta.total, 1);
    assert.equal((await service.filters(filters)).total, 1);
    await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1", [ids[1]]);
    try {
      assert.equal((await service.listPublic(query, 'keyword-after-withdrawal')).meta.total, 0);
      assert.equal((await service.filters(filters)).total, 0);
    } finally {
      await db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1", [ids[1]]);
      await advanceKeywordMatch(db, 'disable', 2);
    }
    assert.equal((await service.listPublic(query, 'keyword-disabled')).meta.total, 1);
    assert.deepEqual(await advanceKeywordMatch(db, 'pause', 2), { status: 'paused' });
    const pausedVersion = await version();
    await db.pool.query("UPDATE external_catalog_search SET title_text='Paused source edit' WHERE listing_id=$1 AND locale='en'", [ids[0]]);
    assert.equal(await version(), pausedVersion);
    await assert.rejects(advanceKeywordMatch(db, 'start', 2), /clear the paused projection/);
  });

  await t.test('bulk changes are atomic and restoring only the first-party singleton ID starts at zero', async () => {
    const abort = new Error('Rollback isolated catalog test');
    await assert.rejects(db.transaction(async tx => {
      await tx.query('UPDATE external_catalog_filter SET active=false WHERE active');
      await compareTotals([0, 0, 0], tx);
      assert.deepEqual(await buckets(tx), [0, 0, 0, 0, 0, 0, 0]);
      await compareTotals([4, 4, 4]);
      // First-party restore writes only the singleton id, leaving supplier rows for later rebuild.
      await tx.query('TRUNCATE external_catalog_state');
      await tx.query('INSERT INTO external_catalog_state(id) VALUES(1)');
      assert.deepEqual(await buckets(tx), [0, 0, 0, 0, 0, 0, 0]);
      throw abort;
    }), abort);
    await compareTotals([4, 4, 4]);
    assert.deepEqual(await buckets(), [1, 1, 1, 1, 1, 1, 1]);
  });

  await t.test('truncating the derived projection invalidates the public catalog only when visible counts change', async () => {
    const revision = async () => BigInt((await db.pool.query<{revision: string}>(
      'SELECT revision FROM public_catalog_state WHERE id=1')).rows[0]!.revision);
    const before = await revision();
    await db.pool.query('TRUNCATE external_catalog_filter');
    await compareTotals([0, 0, 0]);
    assert.deepEqual(await buckets(), [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(await revision(), before + 1n);
    await db.pool.query('TRUNCATE external_catalog_filter');
    assert.equal(await revision(), before + 1n);
  });
});
