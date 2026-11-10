import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { createDatabase } from '../src/db/index.js';

const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1' ||
    address.pathname !== '/postgres' || address.search || address.hash) throw new Error('Filter tests require local maintenance PostgreSQL.');
const name = 'hd_ext_scale_filter_' + randomBytes(8).toString('hex');
const databaseUrl = new URL(address);
databaseUrl.pathname = '/' + name;
const maintenance = createDatabase(address.toString(), 1);
const db = createDatabase(databaseUrl.toString(), 3);
const id = randomUUID(), second = randomUUID(), unpublished = randomUUID();
const stamp = '2026-01-01T00:00:00.123456Z';
const facts = { make: { id:'one', name:'One' }, model: { id:'m', name:'M' }, trim: null, generation: {id:'g',name:'G'},
  powertrain:'hev', drivetrain:'awd', modelYear:2026, mileageKm:7 };
const migration = (file: string) => readFile(new URL('../migrations/' + file + '.sql', import.meta.url), 'utf8');
let created = false;

async function addListing(tx: PoolClient, key: string, upstream: 'active' | 'withdrawn') {
  await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES($1,'synthetic-feed','synthetic-market',$1::uuid::text,1,'fixture','{}',$2,now(),$3)`, [key, upstream, stamp]);
}

const projections = `INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
  VALUES($1,$3,'Synthetic','https://listings.example.invalid/one',$4,1000,'[]','{"en":{},"ru":{}}','{}'),
        ($2,$3,'Synthetic','https://listings.example.invalid/two',$4,NULL,'[]','{"zh":{}}','{}')`;

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await db.transaction(async tx => {
    for (const file of ['0000_inventory','0001_media_rights','0002_vehicle_recycle_and_sources','0003_vehicle_localization',
      '0004_external_catalog','0005_catalog_scale','0006_public_catalog_version']) await tx.query(await migration(file));
    await addListing(tx,id,'active');
    await addListing(tx,second,'withdrawn');
    await addListing(tx,unpublished,'active');
    await tx.query(projections,[id,second,stamp,JSON.stringify(facts)]);
  });
  const client = await db.pool.connect();
  try {
    const timeout = async () => (await client.query('SHOW statement_timeout')).rows[0].statement_timeout;
    const initialTimeout = await timeout();
    await client.query('BEGIN');
    try {
      for (const statement of (await migration('0011_external_catalog_filter')).split('--> statement-breakpoint')) {
        await client.query(statement);
      }
      assert.equal(await timeout(), '10min');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    assert.equal(await timeout(), initialTimeout);
  } finally { client.release(); }
});

after(async () => {
  try { await db.close(); }
  finally {
    try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
    finally { await maintenance.close(); }
  }
});

const compact = async (key: string, tx: Pick<PoolClient,'query'> = db.pool) => (await tx.query(`SELECT f.*,f.xmin::text AS tuple_version,
    to_char(f.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp
  FROM external_catalog_filter f WHERE listing_id=$1`, [key])).rows[0];
const visible = async (locale: string, bit: number, tx: Pick<PoolClient,'query'> = db.pool) => {
  const old = await tx.query(`SELECT c.listing_id FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id
    JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1 WHERE l.upstream_state='active' ORDER BY c.listing_id`, [locale]);
  const thin = await tx.query(`SELECT f.listing_id FROM external_catalog_filter f
    WHERE f.active AND f.locale_mask<>0 AND (f.locale_mask & $1::smallint)<>0 ORDER BY f.listing_id`, [bit]);
  assert.deepEqual(thin.rows,old.rows);
  return thin.rows.map(row => row.listing_id);
};

const revision = async () => BigInt((await db.pool.query('SELECT revision FROM public_catalog_state WHERE id=1')).rows[0].revision);

test('migration backfills only compact scalar facts and exact locale/order keys', async () => {
  const first = await compact(id);
  assert.equal(first.active,true);
  assert.equal(first.stamp,stamp);
  assert.equal(first.locale_mask,6);
  assert.equal(first.make_id,'one');
  assert.equal(first.model_id,'m');
  assert.equal(first.trim_id,null);
  assert.equal(first.generation_id,'g');
  assert.equal(first.powertrain,'hev');
  assert.equal(first.drivetrain,'awd');
  assert.equal(first.model_year,2026);
  assert.equal(first.mileage_km,7);
  assert.equal(first.price_cny,'1000.00');
  const old = await db.pool.query(`SELECT lpad((253402300799999999-floor(extract(epoch FROM published_at)*1000000))::text,18,'0')||listing_id::text AS label_order
    FROM external_catalog WHERE listing_id=$1`,[id]);
  assert.equal(first.label_order,old.rows[0].label_order);
  assert.equal(first.label_order.slice(18),id);
  assert.equal((await compact(second)).active,false);
  assert.equal((await compact(second)).locale_mask,1);
  const empty = await compact(unpublished);
  assert.equal(empty.active,true);
  assert.equal(empty.locale_mask,0);
  assert.equal(empty.published_at,null);
  assert.equal(empty.label_order,null);
  assert.equal(empty.make_id,null);
  assert.deepEqual(await visible('en',2),[id]);
  assert.deepEqual(await visible('ru',4),[id]);
  assert.deepEqual(await visible('zh',1),[]);
});

test('bulk projections update exact keys and preserve tuple version when public filter facts do not change', async () => {
  const first = await compact(id), priorSecond = await compact(second);
  await db.pool.query("UPDATE external_catalog SET platform_name='Renamed',localized=jsonb_set(localized,'{en,title}','{\"text\":\"new\"}') WHERE listing_id=$1",[id]);
  assert.equal((await compact(id)).tuple_version,first.tuple_version);
  await db.pool.query(`UPDATE external_catalog SET localized='{"zh":{}}',price_cny=900,
    facts=jsonb_set(facts,'{modelYear}','2025') WHERE listing_id=ANY($1::uuid[])`, [[id,second]]);
  const updated = await compact(id);
  assert.equal(updated.locale_mask,1);
  assert.equal(updated.model_year,2025);
  assert.equal(updated.price_cny,'900.00');
  assert.notEqual(updated.tuple_version,first.tuple_version);
  assert.notEqual((await compact(second)).tuple_version,priorSecond.tuple_version);
  assert.deepEqual(await visible('en',2),[]);
  assert.deepEqual(await visible('ru',4),[]);
  assert.deepEqual(await visible('zh',1),[id]);
});

test('direct source state updates remain snapshot-consistent across a concurrent withdrawal', async () => {
  const before = await compact(id);
  await db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.deepEqual(await visible('zh',1,tx),[id]);
    await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id]);
    assert.deepEqual(await visible('zh',1,tx),[id]);
  });
  assert.deepEqual(await visible('zh',1),[]);
  const withdrawn = await compact(id);
  assert.equal(withdrawn.active,false);
  assert.equal(withdrawn.locale_mask,before.locale_mask);
  assert.equal(withdrawn.make_id,before.make_id);
  assert.notEqual(withdrawn.tuple_version,before.tuple_version);
  await db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[id]);
  assert.deepEqual(await visible('zh',1),[id]);
  const active = await compact(id);
  const priorRevision = await revision();
  await db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[id]);
  await db.pool.query('UPDATE external_catalog SET localized=localized WHERE listing_id=$1',[id]);
  assert.equal((await compact(id)).tuple_version,active.tuple_version);
  assert.equal(await revision(),priorRevision);
});

test('hide cascade, bulk upsert restore and rollback stay in the projection transaction', async () => {
  await db.pool.query('DELETE FROM external_catalog WHERE listing_id=$1',[id]);
  const hidden = await compact(id);
  assert.equal(hidden.active,true);
  assert.equal(hidden.locale_mask,0);
  assert.equal(hidden.published_at,null);
  assert.equal(hidden.label_order,null);
  assert.equal(hidden.make_id,null);
  assert.equal(hidden.price_cny,null);
  assert.deepEqual(await visible('zh',1),[]);
  await db.pool.query(projections+` ON CONFLICT(listing_id) DO UPDATE SET localized=excluded.localized,price_cny=excluded.price_cny`,
    [id,second,stamp,JSON.stringify(facts)]);
  assert.equal((await compact(id)).locale_mask,6);
  assert.equal((await compact(second)).price_cny,null);
  assert.deepEqual(await visible('en',2),[id]);
  const prior = await compact(id);
  const priorRevision = await revision();
  await assert.rejects(db.transaction(async tx => {
    await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id]);
    await tx.query("UPDATE external_catalog SET localized='{}' WHERE listing_id=$1",[id]);
    assert.equal((await compact(id,tx)).active,false);
    assert.equal((await compact(id,tx)).locale_mask,0);
    assert.deepEqual(await visible('en',2,tx),[]);
    throw new Error('rollback');
  }), /rollback/);
  assert.deepEqual(await compact(id),prior);
  assert.equal(await revision(),priorRevision);
  assert.deepEqual(await visible('en',2),[id]);
});

test('source bulk upsert creates new hidden rows and updates active without touching projection fields', async () => {
  const inserted = randomUUID();
  const previous = await compact(second);
  await db.pool.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES ($1,'synthetic-feed','synthetic-market',$1::uuid::text,1,'fixture','{}','active',now(),$3),
           ($2,'synthetic-feed','synthetic-market',$2::uuid::text,1,'fixture','{}','withdrawn',now(),$3)
    ON CONFLICT(id) DO UPDATE SET upstream_state=excluded.upstream_state`, [second,inserted,stamp]);
  const changed = await compact(second);
  assert.equal(changed.active,true);
  assert.equal(changed.locale_mask,previous.locale_mask);
  assert.equal(changed.label_order,previous.label_order);
  assert.equal((await compact(inserted)).locale_mask,0);
  assert.equal((await compact(inserted)).active,false);
  await db.pool.query('DELETE FROM external_listings WHERE id=$1',[inserted]);
  assert.equal(await compact(inserted),undefined);
  await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[second]);
});

const insertOne = `INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
  VALUES($1,$2,'Synthetic','https://listings.example.invalid/concurrent',$3,1000,'[]','{"en":{}}','{}')`;
const activate = "UPDATE external_listings SET upstream_state='active' WHERE id=$1";
async function waitForLock(client: PoolClient) {
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  return async () => {
    const limit = Date.now()+1800;
    while (Date.now()<limit) {
      const status = await db.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
      if (status.rows[0]?.wait_event_type==='Lock') return;
      await delay(10);
    }
    throw new Error('The expected concurrent row lock was not observed');
  };
}
async function interleave(
  winner: (client: PoolClient) => Promise<unknown>, loser: (client: PoolClient) => Promise<unknown>,
  repeatableRead = false, afterWinnerCommit?: () => Promise<void>,
) {
  const first = await db.pool.connect(), second = await db.pool.connect();
  let pending: Promise<unknown>|undefined;
  try {
    await first.query('BEGIN');
    await second.query(repeatableRead?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN');
    await second.query("SET LOCAL lock_timeout='3s'");
    const blocked = await waitForLock(second);
    await winner(first);
    pending=loser(second);
    void pending.catch(()=>{});
    await blocked();
    await first.query('COMMIT');
    await afterWinnerCommit?.();
    if (repeatableRead) {
      await assert.rejects(pending,{code:'40001'});
      await second.query('ROLLBACK');
    } else {
      await pending;
      await second.query('COMMIT');
    }
  } finally {
    await first.query('ROLLBACK');
    await pending?.catch(()=>{});
    await second.query('ROLLBACK');
    first.release(); second.release();
  }
}

test('READ COMMITTED publication and activation serialize on the same filter row and invalidate', async () => {
  for (const activateFirst of [false,true]) {
    const key=randomUUID();
    await db.transaction(tx=>addListing(tx,key,'withdrawn'));
    const previous=await revision();
    const publish=(tx:PoolClient)=>tx.query(insertOne,[key,stamp,JSON.stringify(facts)]);
    const show=(tx:PoolClient)=>tx.query(activate,[key]);
    await interleave(activateFirst?show:publish,activateFirst?publish:show);
    assert.equal((await compact(key)).active,true);
    assert.equal((await compact(key)).locale_mask,2);
    assert.equal(await revision(),previous+1n);
    assert.ok((await visible('en',2)).includes(key));
  }
});

test('material text updates serialize with reactivation without rewriting filter scalars', async () => {
  const key=randomUUID();
  await db.transaction(async tx=>{
    await addListing(tx,key,'withdrawn');
    await tx.query(insertOne,[key,stamp,JSON.stringify(facts)]);
  });
  const previous=await revision();
  await interleave(tx=>tx.query(activate,[key]),tx=>tx.query(`UPDATE external_catalog SET localized='{"en":{"title":{"text":"changed"}}}' WHERE listing_id=$1`,[key]));
  assert.equal(await revision(),previous+2n);
  assert.equal((await compact(key)).locale_mask,2);
  const before = await compact(key);
  await db.pool.query("UPDATE external_catalog SET platform_name='New display name' WHERE listing_id=$1",[key]);
  assert.equal((await compact(key)).tuple_version,before.tuple_version);
  assert.equal(await revision(),previous+3n);
});

test('REPEATABLE READ rejects both stale publication and stale source updates', async () => {
  for (const activateFirst of [false,true]) {
    const key=randomUUID();
    await db.transaction(tx=>addListing(tx,key,'withdrawn'));
    const publish=(tx:PoolClient)=>tx.query(insertOne,[key,stamp,JSON.stringify(facts)]);
    const show=(tx:PoolClient)=>tx.query(activate,[key]);
    const previous=await revision();
    await interleave(activateFirst?show:publish,activateFirst?publish:show,true);
    const row=await compact(key);
    assert.equal(row.active,activateFirst);
    assert.equal(row.locale_mask,activateFirst?0:2);
    assert.equal(await revision(),previous);
    assert.ok(!(await visible('en',2)).includes(key));
    await db.transaction(activateFirst?publish:show);
    assert.equal(await revision(),previous+1n);
    assert.ok((await visible('en',2)).includes(key));
  }
});

test('one statement can create a source and its catalogue projection', async () => {
  const key=randomUUID();
  await db.pool.query(`WITH created AS (
    INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES($1,'synthetic-feed','synthetic-market',$1::uuid::text,1,'fixture','{}','active',now(),$2)
    RETURNING id
  )
  INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
    SELECT id,$2,'Synthetic','https://listings.example.invalid/combined',$3,1000,'[]','{"en":{}}','{}' FROM created`,
    [key,stamp,JSON.stringify(facts)]);
  assert.equal((await compact(key)).active,true);
  assert.equal((await compact(key)).locale_mask,2);
  assert.ok((await visible('en',2)).includes(key));
});

const newFetch = '2026-01-02T00:00:00Z';
const updateFetch = (tx: PoolClient, key: string) =>
  tx.query('UPDATE external_listings SET fetched_at=$2 WHERE id=$1',[key,newFetch]);
const publicFetch = async (key: string): Promise<string | undefined> => {
  const result = await db.pool.query(`SELECT l.fetched_at FROM external_listings l JOIN external_catalog c ON c.listing_id=l.id
    JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale='en'
    WHERE l.upstream_state='active' AND l.id=$1`,[key]);
  return result.rows[0]?.fetched_at.toISOString();
};

test('READ COMMITTED first publication and source metadata serialize and invalidate in both commit orders', async () => {
  for (const fetchedFirst of [false,true]) {
    const key=randomUUID();
    await db.transaction(tx=>addListing(tx,key,'active'));
    const initialFetch=(await db.pool.query('SELECT fetched_at FROM external_listings WHERE id=$1',[key])).rows[0].fetched_at.toISOString();
    const previous=await revision();
    const publish=(tx:PoolClient)=>tx.query(insertOne,[key,stamp,JSON.stringify(facts)]);
    const refresh=(tx:PoolClient)=>updateFetch(tx,key);
    await interleave(fetchedFirst?refresh:publish,fetchedFirst?publish:refresh,false,async()=>{
      assert.equal(await publicFetch(key),fetchedFirst?undefined:initialFetch);
      assert.equal(await revision(),fetchedFirst?previous:previous+1n);
    });
    assert.equal(await publicFetch(key),new Date(newFetch).toISOString());
    assert.equal(await revision(),previous+(fetchedFirst?1n:2n));
  }
});

test('REPEATABLE READ rejects a stale metadata writer after first publication and allows replay', async () => {
  const key=randomUUID();
  await db.transaction(tx=>addListing(tx,key,'active'));
  const previous=await revision();
  await interleave(tx=>tx.query(insertOne,[key,stamp,JSON.stringify(facts)]),tx=>updateFetch(tx,key),true);
  assert.equal(await revision(),previous+1n);
  assert.notEqual(await publicFetch(key),new Date(newFetch).toISOString());
  await db.transaction(tx=>updateFetch(tx,key));
  assert.equal(await publicFetch(key),new Date(newFetch).toISOString());
  assert.equal(await revision(),previous+2n);
});

test('unchanged or private source metadata does not rewrite filter state or invalidate', async () => {
  const before=await compact(id), inactive=await compact(second), previous=await revision();
  await db.pool.query(`UPDATE external_listings SET fetched_at=fetched_at,source_hash='fixture-private-update',
    source_revision=source_revision+1,source_data='{"private":"updated"}' WHERE id=$1`,[id]);
  await db.transaction(tx=>updateFetch(tx,second));
  assert.equal((await compact(id)).tuple_version,before.tuple_version);
  assert.equal((await compact(second)).tuple_version,inactive.tuple_version);
  assert.equal(await revision(),previous);
});
