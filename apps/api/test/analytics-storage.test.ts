import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { AnalyticsOverviewSchema, type AnalyticsEvent } from '@hd/contracts/analytics';
import { createAnalyticsStorage } from '../src/analytics/storage.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';

const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1'
    || address.pathname !== '/postgres' || address.search || address.hash) {
  throw new Error('Analytics tests require a local PostgreSQL maintenance database.');
}
const name = `hd_api_test_analytics_${randomBytes(8).toString('hex')}`;
const databaseAddress = new URL(address);
databaseAddress.pathname = `/${name}`;
const maintenance = createDatabase(address.toString(), 1);
const db = createDatabase(databaseAddress.toString(), 2);
const analytics = createAnalyticsStorage(db);
let created = false;

const zero = { pageViews: 0, detailViews: 0, vehicleClicks: 0, contactClicks: 0 };
const todaySql = "(statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date";
const overview = async (days: 7 | 30) => AnalyticsOverviewSchema.parse(await analytics.overview(days));
const homeView = (): AnalyticsEvent => ({ eventId: randomUUID(), type: 'page_view', pageType: 'home', locale: 'en' });
const detailView = (vehicleId: string): AnalyticsEvent => ({
  eventId: randomUUID(), type: 'page_view', pageType: 'vehicle', vehicleId, locale: 'en',
});
async function staffVehicle(state = 'published', title = 'Synthetic vehicle', sold = false, source = 'manual') {
  const id = randomUUID(), publicationId = randomUUID();
  const publication = { source: { kind: source }, content: { title: { translations: { en: { text: title } } } } };
  await db.transaction(async client => {
    await client.query('INSERT INTO vehicles (id, availability, availability_checked_at) VALUES ($1, $2, now())',
      [id, sold ? 'sold' : source === 'manual' ? 'available' : 'unknown']);
    await client.query('INSERT INTO vehicle_publications (id, vehicle_id, data) VALUES ($1, $2, $3)', [publicationId, id, publication]);
    await client.query('UPDATE vehicles SET publication_state=$2, published_revision_id=$3, published_at=now() WHERE id=$1',
      [id, state, publicationId]);
  });
  return id;
}
async function supplier(status = 'visible') {
  const id = randomUUID();
  await db.transaction(async client => {
    await client.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,
      source_data,upstream_state,fetched_at,published_at,formal_primary)
      VALUES($1,'synthetic','synthetic-market',$1::uuid::text,1,$2,'{}',$3,now(),now(),$4)`,
      [id, 'a'.repeat(64), status === 'withdrawn' ? 'withdrawn' : 'active', status !== 'nonprimary']);
    await client.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,issues,localized,details)
      VALUES($1,now(),'Synthetic Market','https://example.invalid/vehicle','{}','[]',$2,'{}')`,
      [id, status === 'no-english' ? { zh: {} } : { en: {} }]);
    if (status === 'hidden') {
      await client.query("INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,'{\"hidden\":true}')", [id]);
    }
  });
  return `ext-${id}`;
}

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await maintenance.pool.query(`ALTER DATABASE "${name}" SET timezone TO 'UTC'`);
  await migrateDatabase(db);
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE analytics_event_receipts, analytics_collection_state, analytics_daily, analytics_vehicle_daily');
});
after(async () => {
  await db.close();
  try {
    if (created) await maintenance.pool.query(`DROP DATABASE "${name}"`);
  } finally {
    await maintenance.close();
  }
});

test('counts empty and populated windows and deduplicates within a batch and concurrent retries', async () => {
  const empty = await overview(7);
  assert.deepEqual(empty, {
    days: 7, timeZone: 'Asia/Shanghai', hasData: false, totals: zero, trend: [], topVehicles: [],
    collectionStartedAt: null, startDate: empty.startDate, endDate: empty.endDate,
  });
  const vehicleId = await staffVehicle();
  const home = homeView(), detail = detailView(vehicleId);
  const click = { eventId: randomUUID(), type: 'vehicle_click', pageType: 'catalog', locale: 'en', vehicleId } as const;
  const contact = { eventId: randomUUID(), type: 'contact_click', pageType: 'vehicle', locale: 'en', vehicleId, channel: 'telegram' } as const;
  const conflictingReuse = { ...contact, eventId: home.eventId.toUpperCase() };
  await Promise.all([
    analytics.ingest([home, conflictingReuse, detail, contact], true),
    analytics.ingest([detail, click, contact], true),
  ]);
  await analytics.ingest([home, detail, click, contact], true);
  const result = await overview(7);
  assert.equal(result.hasData, true);
  assert.deepEqual(result.totals, { pageViews: 2, detailViews: 1, vehicleClicks: 1, contactClicks: 1 });
  assert.deepEqual(result.topVehicles, [{ vehicleId, detailViews: 1, vehicleClicks: 1, contactClicks: 1 }]);
  const receipts = await db.pool.query<{ received_at: Date }>('SELECT * FROM analytics_event_receipts');
  assert.equal(receipts.rowCount, 4);
  assert.deepEqual(receipts.fields.map(field => field.name), ['event_id', 'received_at']);
  assert.ok(receipts.rows.some(receipt => receipt.received_at.toISOString() === result.collectionStartedAt));
  assert.equal((await db.pool.query('SELECT * FROM analytics_collection_state')).rowCount, 1);
});

test('looks up public IDs and event locales without retaining rejected events', async () => {
  const visible = await staffVehicle('published', 'Available detail', true), visibleSupplier = await supplier();
  const visibleDemo = await staffVehicle('published', 'Demo vehicle', false, 'demo');
  const deleted = await staffVehicle(), draft = await staffVehicle('draft'), archived = await staffVehicle('archived');
  const blankTitle = await staffVehicle('published', '\u3000\u00a0\t');
  await db.pool.query("INSERT INTO staff(id,name,email,role) VALUES('tester','Tester','tester@example.invalid','admin')");
  await db.pool.query("UPDATE vehicles SET deleted_at=now(),deleted_by='tester' WHERE id=$1", [deleted]);
  const restricted = [
    deleted, draft, archived, blankTitle, randomUUID(), 'invalid',
    await supplier('withdrawn'), await supplier('hidden'), await supplier('nonprimary'), await supplier('no-english'),
  ];
  const restrictedEvents = restricted.map(detailView);
  await analytics.ingest(restrictedEvents, true);
  const empty = await overview(7);
  assert.equal(empty.hasData, false);
  assert.equal(empty.collectionStartedAt, null);
  const supplierEvent = detailView(visibleSupplier);
  await analytics.ingest([detailView(visible), detailView(visibleDemo), supplierEvent], false);
  await analytics.ingest([supplierEvent, { ...detailView(visible), locale: 'ru' }], true);
  const result = await overview(7);
  assert.deepEqual(result.totals, { ...zero, pageViews: 3, detailViews: 3 });
  assert.deepEqual(result.topVehicles.map(vehicle => vehicle.vehicleId), [visible, visibleDemo, visibleSupplier].sort());
  assert.equal((await db.pool.query('SELECT * FROM analytics_event_receipts')).rowCount, 3);
});

test('returns inclusive Beijing dates, explicit zeroes, and the first 20 vehicles by score and ID', async () => {
  const carIds = Array.from({ length: 22 }, () => randomUUID()).sort();
  await db.pool.query(`INSERT INTO analytics_daily(day,page_views,detail_views,vehicle_clicks,contact_clicks)
    VALUES (${todaySql}-29,4,0,0,0),(${todaySql}-30,50,0,0,0),(${todaySql}+1,50,0,0,0),
      (${todaySql}-6,0,0,22,0),(${todaySql}-7,0,0,0,2)`);
  await db.pool.query(`INSERT INTO analytics_vehicle_daily(day,vehicle_id,supplier,detail_views,vehicle_clicks,contact_clicks)
    SELECT ${todaySql}-6, vehicle_id, false, 0, 1, 0 FROM unnest($1::uuid[]) AS ids(vehicle_id)
    UNION ALL SELECT ${todaySql}-7, $2::uuid, false, 0, 0, 2`, [carIds, carIds.at(-1)]);
  await analytics.ingest([homeView()], false);
  const today = (await db.pool.query<{ day: string }>(`SELECT to_char(${todaySql}, 'YYYY-MM-DD') AS day`)).rows[0]!.day;
  const week = await overview(7), month = await overview(30);
  assert.deepEqual(week.totals, { ...zero, pageViews: 1, vehicleClicks: 22 });
  assert.deepEqual(month.totals, { ...zero, pageViews: 5, vehicleClicks: 22, contactClicks: 2 });
  assert.equal(week.trend.length, 7);
  assert.equal(month.trend.length, 30);
  assert.equal(week.startDate, week.trend[0]!.date);
  assert.equal(month.startDate, month.trend[0]!.date);
  assert.equal(week.endDate, today);
  assert.equal(month.endDate, today);
  for (const [index, row] of month.trend.entries()) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 29 + index);
    assert.equal(row.date, date.toISOString().slice(0, 10));
    if (![0, 22, 23, 29].includes(index)) assert.deepEqual(row, { ...zero, date: row.date });
  }
  assert.deepEqual(week.trend, month.trend.slice(-7));
  assert.deepEqual(week.topVehicles.map(vehicle => vehicle.vehicleId), carIds.slice(0, 20));
  assert.deepEqual(month.topVehicles.map(vehicle => vehicle.vehicleId), [carIds.at(-1), ...carIds.slice(0, 19)]);
});

test('rolls back receipts and both totals on a bounded database lock failure', async () => {
  const event = detailView(await staffVehicle());
  await db.transaction(async client => {
    await client.query('LOCK TABLE analytics_vehicle_daily IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(analytics.ingest([event, homeView()], false), { code: '55P03' });
  });
  assert.equal((await db.pool.query('SELECT * FROM analytics_event_receipts')).rowCount, 0);
  const empty = await overview(7);
  assert.equal(empty.hasData, false);
  assert.equal(empty.collectionStartedAt, null);
  await analytics.ingest([event], false);
  assert.deepEqual((await overview(7)).totals, { ...zero, pageViews: 1, detailViews: 1 });
});

test('expires receipts after seven days and prunes bounded batches while keeping the last 90 Beijing dates', async () => {
  const event = homeView(), carId = randomUUID();
  await analytics.ingest([event], false);
  const firstReceipt = (await db.pool.query<{ received_at: Date }>('SELECT received_at FROM analytics_event_receipts')).rows[0]!;
  const firstCollection = (await overview(7)).collectionStartedAt;
  assert.equal(firstCollection, firstReceipt.received_at.toISOString());
  await db.pool.query("UPDATE analytics_event_receipts SET received_at=now()-INTERVAL '167 hours'");
  await analytics.ingest([event], false);
  assert.equal((await overview(7)).totals.pageViews, 1);
  await db.pool.query("UPDATE analytics_event_receipts SET received_at=now()-INTERVAL '168 hours'");
  await analytics.ingest([event], false);
  assert.equal((await overview(7)).totals.pageViews, 2);
  assert.equal((await overview(7)).collectionStartedAt, firstCollection);
  await db.pool.query(`INSERT INTO analytics_event_receipts
    SELECT md5(i::text)::uuid, now()-INTERVAL '8 days' FROM generate_series(1, 10001) AS series(i)`);
  await db.pool.query(`INSERT INTO analytics_daily VALUES (${todaySql}-89,1,0,0,0),(${todaySql}-90,1,0,0,0)`);
  await db.pool.query(`INSERT INTO analytics_vehicle_daily VALUES
    (${todaySql}-89,$1,false,1,0,0),(${todaySql}-90,$1,false,1,0,0)`, [carId]);
  await analytics.prune();
  assert.equal((await db.pool.query('SELECT * FROM analytics_event_receipts')).rowCount, 2);
  assert.equal((await db.pool.query('SELECT * FROM analytics_daily')).rowCount, 2);
  assert.equal((await db.pool.query('SELECT * FROM analytics_vehicle_daily')).rowCount, 1);
  await analytics.prune();
  assert.deepEqual((await db.pool.query('SELECT event_id FROM analytics_event_receipts')).rows, [{ event_id: event.eventId }]);
  await db.pool.query(`DELETE FROM analytics_daily WHERE day = ${todaySql}`);
  const withoutCurrentData = await overview(7);
  assert.equal(withoutCurrentData.hasData, false);
  assert.equal(withoutCurrentData.collectionStartedAt, firstCollection);
});
