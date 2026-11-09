import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import pg, { type PoolClient } from 'pg';

// This suite owns only its random database. It never loads an application env file,
// starts an HTTP server, imports sample files or calls a translation provider.
function maintenanceAddress() {
  try {
    const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/postgres' || url.search || url.hash) throw new Error();
    return url;
  } catch { throw new Error('Catalog version tests require a local PostgreSQL maintenance URL without options.'); }
}
const address = maintenanceAddress();
const databaseName = `hd_ext_version_${randomBytes(8).toString('hex')}`;
const maintenance = new pg.Pool({ connectionString: address.toString(), max: 1, connectionTimeoutMillis: 5000 });
const testAddress = new URL(address);
testAddress.pathname = `/${databaseName}`;
let db: pg.Pool;
let created = false;
const actor = randomUUID();
type Queryable = pg.Pool | PoolClient;
type Version = { epoch: string; revision: string };
const state = async (query: Queryable = db) => (await query.query<Version>('SELECT epoch,revision FROM public_catalog_state WHERE id=1')).rows[0]!;
const pending = async (query: Queryable = db) => (await query.query<{ count: number }>('SELECT count(*)::int AS count FROM public_catalog_pending')).rows[0]!.count;

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function delta(expected: number, work: () => Promise<unknown>) {
  const prior = await state();
  await work();
  const next = await state();
  assert.equal(next.epoch, prior.epoch);
  assert.equal(BigInt(next.revision), BigInt(prior.revision) + BigInt(expected));
  assert.equal(await pending(), 0);
}
async function vehicle(query: Queryable = db, published = false) {
  const id = randomUUID(), publication = randomUUID();
  await query.query('INSERT INTO vehicles(id) VALUES($1)', [id]);
  await query.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)', [id, { internal: { notes: 'Synthetic migration test' } }]);
  await query.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)', [publication, id, { images: [] }]);
  if (published) await query.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [id, publication]);
  return { id, publication };
}
async function listing(query: Queryable = db, visible = false) {
  const id = randomUUID();
  await query.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES($1,'synthetic-feed','synthetic-market',$2,1,'synthetic','{}','active',now(),now())`, [id, randomUUID()]);
  if (visible) await showListing(id, query);
  return id;
}
async function showListing(id: string, query: Queryable = db) {
  await query.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
    VALUES($1,now(),'Synthetic','https://listings.example.invalid/test','{}',100,'[]','{}','{}')`, [id]);
}
async function externalPhoto(listingId: string, active: boolean, query: Queryable = db) {
  const id = randomUUID();
  await query.query(`INSERT INTO external_media(id,listing_id,source_media_id,url,position,active,refreshed_at)
    VALUES($1,$2,$3,'https://photos.example.invalid/test.webp',0,$4,now())`, [id, listingId, randomUUID(), active]);
  return id;
}
async function editHome(query: Queryable = db) {
  await query.query("UPDATE home_config SET sections=jsonb_build_array(jsonb_build_object('test', $1::text)),version=version+1 WHERE id=1", [randomUUID()]);
}

before(async () => {
  await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  db = new pg.Pool({ connectionString: testAddress.toString(), max: 6, connectionTimeoutMillis: 5000,
    statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 });
  await transaction(async client => {
    // The version migration depends only on the existing business schema. Keeping
    // this list explicit also tests it without the independent 0005 query indexes.
    for (const name of ['0000_inventory', '0001_media_rights', '0002_vehicle_recycle_and_sources', '0003_vehicle_localization', '0004_external_catalog']) {
      await client.query(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }
    await client.query('INSERT INTO staff(id,name,email) VALUES($1,$2,$3)', [actor, 'Version test actor', 'version-test@example.invalid']);
    await vehicle(client, true); // Existing public data is supported when the migration is installed.
    await client.query(await readFile(new URL('../migrations/0006_public_catalog_version.sql', import.meta.url), 'utf8'));
  });
});
after(async () => {
  try {
    await db?.end();
    // The pool can drain before PostgreSQL finishes disconnecting its backends.
    // A regular drop waits for them without interrupting the client shutdown.
    if (created) await maintenance.query(`DROP DATABASE "${databaseName}"`);
  } finally { await maintenance.end(); }
});

test('migration installs one epoch/version row and statement-level business triggers', async () => {
  const initial = await state();
  assert.match(initial.epoch, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(initial.revision, '1');
  assert.equal(await pending(), 0);
  const triggers = await db.query<{ tgname: string; row_level: boolean; tgdeferrable: boolean; tginitdeferred: boolean }>(`
    SELECT tgname,(tgtype & 1)<>0 AS row_level,tgdeferrable,tginitdeferred FROM pg_trigger
    WHERE NOT tgisinternal AND (tgname LIKE '%public_version_%' OR tgname='public_catalog_commit')`);
  assert.equal(triggers.rows.filter(row => row.tgname !== 'public_catalog_commit').length, 20);
  assert.ok(triggers.rows.filter(row => row.tgname !== 'public_catalog_commit').every(row => !row.row_level));
  assert.deepEqual(triggers.rows.find(row => row.tgname === 'public_catalog_commit'), {
    tgname: 'public_catalog_commit', row_level: true, tgdeferrable: true, tginitdeferred: true,
  });
});

test('drafts, audit, private source data, unbound snapshots and no-op writes stay quiet', async () => {
  await delta(0, async () => {
    const car = await vehicle();
    await db.query("UPDATE vehicle_drafts SET data=data||'{\"note\":\"private edit\"}' WHERE vehicle_id=$1", [car.id]);
    await db.query("INSERT INTO vehicle_localizations(vehicle_id,revision,data,bindings) VALUES($1,1,'{}','{}')", [car.id]);
    await db.query("INSERT INTO publication_localizations(publication_id,data,bindings,projections) VALUES($1,'{}','{}','{}')", [car.publication]);
    await db.query("UPDATE vehicles SET version=version+1,updated_at=now(),availability='sold',availability_checked_at=now() WHERE id=$1", [car.id]);
    await db.query("INSERT INTO audit_events(id,actor_id,operation,vehicle_id,request_id) VALUES($1,$2,'test.private',$3,'synthetic')", [randomUUID(), actor, car.id]);
    await db.query('UPDATE home_config SET version=version+1,sections=sections WHERE id=1');
    const hidden = await listing();
    await db.query("UPDATE external_listings SET version=version+1,source_data='{\"private\":true}',fetched_at=now() WHERE id=$1", [hidden]);
    await externalPhoto(hidden, true);
    await db.query("UPDATE vehicles SET updated_at=now() WHERE id='00000000-0000-4000-8000-000000000000'");
  });
});

test('many public changes queue once and publish their version only at commit', async () => {
  const car = await vehicle();
  const prior = await state();
  await delta(1, () => transaction(async client => {
    await client.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [car.id, car.publication]);
    await editHome(client);
    const imported = await listing(client, true);
    await externalPhoto(imported, true, client);
    assert.equal(await pending(client), 1);
    assert.deepEqual(await state(client), prior);
    assert.deepEqual(await state(), prior);
  }));
});

test('published inventory, archive, republish and deletion invalidate; restore to a draft does not', async () => {
  const car = await vehicle(db, true);
  await delta(0, () => db.query('UPDATE vehicles SET version=version+1,updated_at=now() WHERE id=$1', [car.id]));
  await delta(1, () => db.query("UPDATE vehicles SET availability='sold',availability_checked_at=now() WHERE id=$1", [car.id]));
  await delta(1, () => db.query("UPDATE vehicles SET availability_checked_at=availability_checked_at+interval '1 second' WHERE id=$1", [car.id]));
  await delta(1, () => db.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1", [car.id]));
  await delta(0, () => db.query("UPDATE vehicles SET availability='available',availability_checked_at=now() WHERE id=$1", [car.id]));
  await delta(1, () => db.query("UPDATE vehicles SET publication_state='published',published_at=now() WHERE id=$1", [car.id]));
  await delta(1, () => db.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1', [car.id, actor]));
  await delta(0, () => db.query(`UPDATE vehicles SET deleted_at=NULL,deleted_by=NULL,publication_state='draft',published_revision_id=NULL,
    published_at=NULL,availability='unknown',availability_checked_at=NULL WHERE id=$1`, [car.id]));
  await delta(1, () => db.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1", [car.id, car.publication]));
});

test('only current published localization/media references and ready access affect public media', async () => {
  const car = await vehicle(db, true), photo = randomUUID();
  await delta(0, async () => {
    await db.query(`INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,expires_at,rights)
      VALUES($1,$2,'image/png',100,now()+interval '1 hour','{}')`, [photo, car.id]);
    await db.query('INSERT INTO publication_media(publication_id,media_id) VALUES($1,$2)', [car.publication, photo]);
  });
  await delta(1, () => db.query("UPDATE media_assets SET state='ready' WHERE id=$1", [photo]));
  await delta(0, () => db.query("UPDATE media_assets SET version=version+1,rights='{\"note\":\"internal\"}',expires_at=now() WHERE id=$1", [photo]));
  await delta(1, () => db.query("UPDATE media_assets SET state='failed' WHERE id=$1", [photo]));
  await delta(0, () => db.query("UPDATE media_assets SET state='uploaded' WHERE id=$1", [photo]));
  await delta(1, () => db.query("UPDATE media_assets SET state='ready' WHERE id=$1", [photo]));
  await delta(1, () => db.query('DELETE FROM publication_media WHERE publication_id=$1 AND media_id=$2', [car.publication, photo]));
  await delta(1, () => db.query('INSERT INTO publication_media(publication_id,media_id) VALUES($1,$2)', [car.publication, photo]));
  await delta(0, () => db.query('UPDATE publication_media SET media_id=media_id WHERE media_id=$1', [photo]));
  await delta(1, () => db.query("INSERT INTO publication_localizations(publication_id,data,bindings,projections) VALUES($1,'{}','{}','{}')", [car.publication]));
  await delta(1, () => db.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1", [car.id]));
  await delta(0, () => db.query("UPDATE media_assets SET state='failed' WHERE id=$1", [photo]));
});

test('external public facts, provenance, withdrawal and hiding invalidate without private-field noise', async () => {
  const id = await listing();
  await delta(1, () => showListing(id));
  await delta(0, () => db.query('UPDATE external_catalog SET price_cny=price_cny WHERE listing_id=$1', [id]));
  await delta(0, () => db.query("UPDATE external_listings SET version=version+1,source_revision=source_revision+1,source_data='{\"raw\":true}' WHERE id=$1", [id]));
  await delta(1, () => db.query("UPDATE external_listings SET fetched_at=fetched_at+interval '1 second' WHERE id=$1", [id]));
  await delta(1, () => db.query("UPDATE external_catalog SET localized='{\"en\":{\"title\":\"Updated\"}}' WHERE listing_id=$1", [id]));
  await delta(1, () => transaction(async client => {
    await client.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1", [id]);
    await client.query('DELETE FROM external_catalog WHERE listing_id=$1', [id]);
  }));
  await delta(0, () => db.query("UPDATE external_listings SET fetched_at=now(),upstream_state='active' WHERE id=$1", [id]));
  await delta(1, () => showListing(id));
  await delta(1, () => db.query('DELETE FROM external_catalog WHERE listing_id=$1', [id]));
  await delta(0, () => db.query('UPDATE external_listings SET fetched_at=now() WHERE id=$1', [id]));
});

test('visible external media invalidate; inactive/hidden/expired-only URL edits do not', async () => {
  const id = await listing(db, true);
  let photo!: string;
  await delta(1, async () => { photo = await externalPhoto(id, true); });
  await delta(0, () => db.query('UPDATE external_media SET url=url WHERE id=$1', [photo]));
  const inactive = await externalPhoto(id, false);
  await delta(0, () => db.query("UPDATE external_media SET url='https://photos.example.invalid/hidden.webp',revision=revision+1 WHERE id=$1", [inactive]));
  await delta(1, () => db.query("UPDATE external_media SET url='https://photos.example.invalid/new.webp',revision=revision+1 WHERE id=$1", [photo]));
  await delta(1, () => db.query("UPDATE external_media SET expires_at='2000-01-01' WHERE id=$1", [photo]));
  await delta(0, () => db.query("UPDATE external_media SET url='https://photos.example.invalid/expired.webp',refreshed_at=now(),revision=revision+1 WHERE id=$1", [photo]));
  await delta(1, () => db.query('UPDATE external_media SET active=false WHERE id=$1', [photo]));
  await delta(0, () => db.query('DELETE FROM external_media WHERE id=$1', [photo]));
  await delta(1, () => db.query('UPDATE external_media SET active=true WHERE id=$1', [inactive]));
  await delta(1, () => db.query('DELETE FROM external_catalog WHERE listing_id=$1', [id]));
  await delta(0, () => db.query("UPDATE external_media SET url='https://photos.example.invalid/unpublished.webp',revision=revision+1 WHERE listing_id=$1", [id]));
});

test('rollback, savepoints and connection reuse preserve the one-bump transaction boundary', async () => {
  await delta(0, () => assert.rejects(transaction(async client => {
    await editHome(client);
    assert.equal(await pending(client), 1);
    await client.query("INSERT INTO audit_events(id,actor_id,operation,request_id) VALUES($1,'missing-actor','synthetic','rollback')", [randomUUID()]);
  }), { code: '23503' }));
  await delta(1, () => transaction(async client => {
    await client.query('SAVEPOINT discard');
    await editHome(client);
    assert.equal(await pending(client), 1);
    await client.query('ROLLBACK TO SAVEPOINT discard');
    assert.equal(await pending(client), 0);
    await editHome(client);
    assert.equal(await pending(client), 1);
  }));
  await delta(1, () => editHome());
});

test('a large statement still registers one pending bump, with no-op bulk updates remaining quiet', async () => {
  await delta(1, () => transaction(async client => {
    await client.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
      SELECT gen_random_uuid(),'version-bulk','synthetic-market',i::text,1,'synthetic','{}','active',now(),now() FROM generate_series(1,5000) i`);
    assert.equal(await pending(client), 0);
    await client.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
      SELECT id,now(),'Synthetic','https://listings.example.invalid/bulk','{}',100,'[]','{}','{}' FROM external_listings WHERE provider='version-bulk'`);
    assert.equal(await pending(client), 1);
  }));
  await delta(0, () => db.query("UPDATE external_catalog SET price_cny=price_cny WHERE listing_id IN (SELECT id FROM external_listings WHERE provider='version-bulk')"));
  await delta(1, () => db.query("UPDATE external_catalog SET price_cny=price_cny+1 WHERE listing_id IN (SELECT id FROM external_listings WHERE provider='version-bulk')"));
});

test('deferred version locks cannot invert home-to-vehicle business lock order', async () => {
  const car = await vehicle(db, true);
  const first = await db.connect(), second = await db.connect();
  let waiting: Promise<pg.QueryResult> | undefined;
  try {
    await delta(2, async () => {
      await first.query('BEGIN'); await second.query('BEGIN');
      const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await editHome(first); // Schedules a change, but must not take the singleton lock.
      await second.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE', [car.id]);
      await second.query("UPDATE vehicles SET availability='available',availability_checked_at=now() WHERE id=$1", [car.id]);
      waiting = first.query("UPDATE vehicles SET availability='sold',availability_checked_at=now() WHERE id=$1", [car.id]);
      // Observe only this test's own backend. No timing guess or shared business database is involved.
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const activity = await db.query<{ waiting: boolean }>("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1 AND datname=current_database()", [firstPid]);
        if (activity.rows[0]?.waiting) { blocked = true; break; }
        await delay(5);
      }
      assert.equal(blocked, true, 'The first transaction should be waiting for the vehicle lock');
      await second.query('COMMIT'); // An early singleton lock would deadlock here.
      await waiting;
      await first.query('COMMIT');
    });
  } finally {
    await second.query('ROLLBACK');
    if (waiting) await waiting.catch(() => {});
    await first.query('ROLLBACK');
    first.release(); second.release();
  }
});
