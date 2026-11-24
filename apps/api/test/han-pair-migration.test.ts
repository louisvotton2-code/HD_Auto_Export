import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { PublicFilterQuerySchema, PublicVehicleQuerySchema } from '@hd/contracts/public';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { preferIndexedHanPair } from '../src/external/catalog.js';
import { applyFormalCandidate } from '../src/external/store.js';
import { InventoryService } from '../src/vehicles/service.js';

test('0050 can be deferred and completed with the original SQL, unchanged cursors and exact Chinese search', async t => {
  const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1' ||
    address.pathname !== '/postgres' || address.search || address.hash) throw new Error('Only isolated loopback PostgreSQL is supported.');
  const name = `hd_test_deferred_han_pair_${randomBytes(8).toString('hex')}`;
  const maintenance = createDatabase(address.href, 1);
  const previous = await mkdtemp(path.join(tmpdir(), 'hd-han-pair-0049-'));
  address.pathname = `/${name}`;
  const db = createDatabase(address.href, 2);
  let created = false;
  t.after(async () => {
    try { await db.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(previous, { recursive: true, force: true }); }
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  const source = new URL('../migrations/', import.meta.url);
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', source), 'utf8'));
  const entries = (journal.entries as { idx: number; tag: string }[]).filter(entry => entry.idx < 50);
  await mkdir(path.join(previous, 'meta'));
  await Promise.all(entries.map(({ tag }) => copyFile(new URL(`${tag}.sql`, source), path.join(previous, `${tag}.sql`))));
  await writeFile(path.join(previous, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await migrate(db.orm, { migrationsFolder: previous });

  const files = readMigrationFiles({ migrationsFolder: fileURLToPath(source) });
  const history = files.slice(0, 54).map(entry => ({ created_at: String(entry.folderMillis), hash: entry.hash }));
  const ledger = async (order: 'id' | 'created_at') =>
    (await db.pool.query(`SELECT created_at::text, hash FROM drizzle.__drizzle_migrations ORDER BY ${order}`)).rows;
  const defer = () => migrateDatabase(db, '--defer-han-pair-index');
  const complete = () => migrateDatabase(db, '--complete-han-pair-index');
  const runMigrationCli = (mode: '--defer-han-pair-index' | '--complete-han-pair-index') =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts', mode], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env: { DATABASE_URL: address.href },
    });
  // A same-name object is never accepted as an absent index.
  await db.pool.query('CREATE INDEX external_catalog_search_zh_han_pairs_idx ON external_catalog_search(listing_id)');
  await assert.rejects(defer, /index to be absent/);
  await db.pool.query('DROP INDEX external_catalog_search_zh_han_pairs_idx');
  await assert.rejects(defer, /Global facet model winner index must be prebuilt/);
  assert.deepEqual(await ledger('id'), history.slice(0, 50));
  await db.pool.query(`CREATE INDEX CONCURRENTLY external_catalog_filter_model_winner_idx ON public.external_catalog_filter
    (make_id,model_id,locale_mask,published_at DESC,listing_id)
    WHERE active AND locale_mask<>0 AND make_id IS NOT NULL AND model_id IS NOT NULL`);

  const actor = { id: 'han-pair-fixture-admin', requestId: randomUUID() };
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Han pair fixture','han-pair@example.invalid','admin',false)", [actor.id]);
  const formalVehicle = (externalId: string) => ({
    ...makeExternalCandidateFixture(), platformId: 'che168', externalId, relatedListingUrls: [],
    listingUrl: `https://www.che168.com/dealer/1/${externalId}.html`,
    images: [], inspection: null,
  });
  const vehicle = formalVehicle('995001');
  const before = await db.transaction(async tx => {
    await tx.query('UPDATE external_full_sync SET receive_cursor=42,received_events=7,applied_events=6 WHERE id=1');
    await tx.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged,apply_cursor)
      VALUES ($1,now(),'complete','synthetic.csv',5,5,5)`, [randomUUID()]);
    const { listingId } = await applyFormalCandidate(tx, vehicle, actor, randomUUID(),
      { id: `chinacarapi:che168:${vehicle.externalId}`, primary: true });
    await tx.query(`UPDATE external_catalog_search SET stock_text='',make_text='',model_text='海狮',title_text='测试海狮'
      WHERE listing_id=$1 AND locale='zh'`, [listingId]);
    const withdrawnVehicle = formalVehicle('995002');
    const { listingId: withdrawn } = await applyFormalCandidate(tx, withdrawnVehicle,
      actor, randomUUID(), { id: `chinacarapi:che168:${withdrawnVehicle.externalId}`, primary: true });
    await tx.query("UPDATE external_catalog_search SET title_text='撤回海狮' WHERE listing_id=$1 AND locale='zh'", [withdrawn]);
    await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1", [withdrawn]);
    return listingId;
  });
  const cursors = async () => (await db.pool.query(`SELECT s.receive_cursor,s.received_events,s.applied_events,p.apply_cursor
    FROM external_full_sync s CROSS JOIN external_full_snapshots p WHERE s.id=1`)).rows;
  const beforeCursors = await cursors();
  const inventory = new InventoryService(db, true);
  const options = { locale: 'zh', catalog: 'curated', view: 'localized', q: '海狮' };
  const query = PublicVehicleQuerySchema.parse({ ...options, projection: 'card', pageSize: 2 });
  const filters = PublicFilterQuerySchema.parse({ ...options, projection: 'overview' });

  await assert.rejects(defer, /Full-sync event identity index must be prebuilt/);
  assert.deepEqual(await ledger('id'), history.slice(0, 50));
  assert.equal((await db.pool.query("SELECT to_regclass('public.external_catalog_global_facets') AS facets")).rows[0].facets, null);
  const prebuildReplayIndex = () => db.pool.query(`CREATE INDEX CONCURRENTLY external_full_event_identity_latest
    ON public.external_full_events (source, external_id, event_id DESC)`);
  await prebuildReplayIndex();

  const [, deferredCli] = await Promise.all([defer(), runMigrationCli('--defer-han-pair-index')]);
  assert.match(deferredCli.stdout, /Migration 0050 remains pending/);
  const pending = history.filter((_entry, index) => index !== 50);
  assert.deepEqual(await ledger('id'), pending);
  assert.deepEqual(await cursors(), beforeCursors);
  await assert.rejects(migrateDatabase(db), /Migration 0050 is pending/);
  await assert.rejects(complete, /Han pair search index must be prebuilt/);
  await db.pool.query('DROP INDEX external_full_event_identity_latest');
  await assert.rejects(defer, /Full-sync event identity index must be prebuilt/);
  await prebuildReplayIndex();
  await db.pool.query("UPDATE drizzle.__drizzle_migrations SET hash='unexpected' WHERE created_at=$1", [history[52]!.created_at]);
  await assert.rejects(defer, /exact 0049 ledger/);
  await assert.rejects(complete, /exact pending or completed/);
  await db.pool.query("UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE created_at=$2", [history[52]!.hash, history[52]!.created_at]);

  assert.equal(await preferIndexedHanPair(db.pool, query), false);
  const list = await inventory.listPublic(query, 'han-pair-pending');
  assert.deepEqual(list.data.items.map(item => item.id), [`ext-${before}`]);
  assert.equal(list.meta.total, 1);
  assert.equal((await inventory.filters(filters)).total, 1);
  assert.equal((await inventory.filters(PublicFilterQuerySchema.parse({ locale: 'zh', view: 'localized', projection: 'overview-models' }))).total, 1);
  const schema = await db.pool.query(`SELECT browse_generation::int AS generation,
    (SELECT count(*)::int FROM external_full_admission_replay_reservations) AS reservations FROM public_catalog_state WHERE id=1`);
  assert.ok(schema.rows[0].generation > 0);
  assert.equal(schema.rows[0].reservations, 0);

  await db.transaction(tx => tx.query(files[50]!.sql[0]!));
  await db.pool.query(`CREATE INDEX CONCURRENTLY external_catalog_search_zh_han_pairs_idx ON public.external_catalog_search
    USING gin (public.external_catalog_han_pairs(search_document)) WHERE locale='zh'`);
  const [, completedCli] = await Promise.all([complete(), runMigrationCli('--complete-han-pair-index')]);
  assert.match(completedCli.stdout, /Database migrations applied/);
  assert.deepEqual(await ledger('id'), [...pending, history[50]]);
  assert.deepEqual(await ledger('created_at'), history);
  assert.deepEqual(await cursors(), beforeCursors);
  await migrateDatabase(db);
  assert.deepEqual(await ledger('created_at'), history);
  assert.deepEqual((await inventory.listPublic(query, 'han-pair-complete')).data.items.map(item => item.id), [`ext-${before}`]);
  assert.equal((await inventory.filters(filters)).total, 1);
});
