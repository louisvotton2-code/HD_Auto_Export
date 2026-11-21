import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { AnalyticsReportQuerySchema } from '@hd/contracts/analytics';
import { getAnalyticsReport } from '../src/analytics/report.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';

const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1'
    || address.pathname !== '/postgres' || address.search || address.hash) {
  throw new Error('Analytics report tests require a local PostgreSQL maintenance database.');
}
const name = `hd_api_test_analytics_report_${randomBytes(8).toString('hex')}`;
const databaseAddress = new URL(address);
databaseAddress.pathname = `/${name}`;
const maintenance = createDatabase(address.toString(), 1);
const db = createDatabase(databaseAddress.toString(), 2);
let created = false;
const clock = new Date('2026-11-20T16:11:45.123Z');
const runtimeQuality = {
  acceptedBatches: 3, rejectedBatches: 2, rateLimitedBatches: 1, unavailableBatches: 1, since: clock.toISOString(),
};
const read = (query: Record<string, string>) => getAnalyticsReport(db, AnalyticsReportQuerySchema.parse(query), runtimeQuality, clock);
const x = '30000000-0000-4000-8000-000000000001';
const y = '10000000-0000-4000-8000-000000000002';
const z = '20000000-0000-4000-8000-000000000003';

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await maintenance.pool.query(`ALTER DATABASE "${name}" SET timezone TO 'America/Los_Angeles'`);
  await migrateDatabase(db);
});
after(async () => {
  await db.close();
  try {
    if (created) await maintenance.pool.query(`DROP DATABASE "${name}"`);
  } finally {
    await maintenance.close();
  }
});

test('reports legacy totals without fabricating hourly, session, dimension or IP history', async () => {
  await db.pool.query(`INSERT INTO analytics_collection_state VALUES (1,'2026-11-20 00:00:00+00');
    INSERT INTO analytics_daily VALUES ('2026-11-20',42,14,6,3)`);
  await db.pool.query("INSERT INTO analytics_vehicle_daily VALUES ('2026-11-20',$1,false,14,6,3)", [x]);

  const day = await read({ days:'2', metric:'contactRate' });
  assert.equal(day.legacyCollectionStartedAt, '2026-11-20T00:00:00.000Z');
  assert.equal(day.collectionStartedAt, null);
  assert.equal(day.coverage, 'not_collected');
  assert.equal(day.totals.pageViews, 42);
  assert.deepEqual(day.trend.map(row => [row.start,row.pageViews,row.coverage]),
    [['2026-11-19T16:00:00.000Z',42,'not_collected'],['2026-11-20T16:00:00.000Z',0,'not_collected']]);
  assert.equal(day.sessions, 0);
  assert.deepEqual(day.markets.sources, []);
  assert.equal(day.ranking.items[0]!.contactRate, null);
  assert.deepEqual(day.dailyUniqueIpEstimates.map(row => row.estimate), [null,null]);
  assert.deepEqual(day.runtimeQuality, runtimeQuality);

  const hourly = await read({ days:'2', granularity:'hour' });
  assert.equal(hourly.trend.length, 25);
  assert.equal(hourly.trend.reduce((sum,row) => sum+row.pageViews,0), 0);
  assert.ok(hourly.trend.every(row => row.coverage==='not_collected'));
  assert.equal(hourly.comparison.previous.pageViews, 0);
  assert.equal(hourly.comparison.yesterdayCoverage, 'not_collected');
});

test('reports Shanghai windows, source denominators, cross-midnight funnels and globally sorted rankings', async () => {
  await db.pool.query(`TRUNCATE analytics_daily,analytics_vehicle_daily;
    INSERT INTO analytics_daily VALUES ('2026-11-20',1,0,1,0),('2026-11-21',5,4,1,4);
    INSERT INTO analytics_v2_collection VALUES (1,'2026-11-20 15:58:00+00');
    INSERT INTO analytics_v2_heartbeats VALUES ('2026-11-20 15:55:00+00'),('2026-11-20 16:00:00+00'),
      ('2026-11-20 16:05:00+00'),('2026-11-20 16:10:00+00');
    INSERT INTO analytics_daily_ips VALUES ('2026-11-20',7),('2026-11-21',11);
    INSERT INTO analytics_ingest_quality VALUES ('2026-11-20 16:00:00+00',17,11,4,2);
    INSERT INTO analytics_activity_hourly VALUES
      ('2026-11-20 15:00:00+00','CN','zh','desktop','catalog','direct','none','','page_view','catalog',1),
      ('2026-11-20 15:00:00+00','CN','zh','desktop','catalog','direct','none','','vehicle_click','catalog',1),
      ('2026-11-20 16:00:00+00','CN','zh','desktop','catalog','direct','none','','page_view','vehicle',1),
      ('2026-11-20 16:00:00+00','CN','zh','desktop','catalog','direct','none','wechat','contact_click','vehicle',1),
      ('2026-11-20 16:00:00+00','RU','ru','mobile','vehicle','search','catalog','','page_view','vehicle',1),
      ('2026-11-20 16:00:00+00','RU','ru','mobile','vehicle','search','catalog','telegram','contact_click','vehicle',1),
      ('2026-11-20 16:00:00+00','ZZ','en','mobile','catalog','social','retargeting','','filter_submit','catalog',1),
      ('2026-11-20 16:00:00+00','ZZ','en','mobile','catalog','social','retargeting','','search_zero_results','catalog',1),
      ('2026-11-20 16:00:00+00','ZZ','en','mobile','catalog','social','retargeting','','calculator_complete','calculator',1);
    INSERT INTO analytics_activity_minutes (minute,source,event_type,page_type,total) VALUES
      ('2026-11-19 16:00:00+00','search','page_view','vehicle',4),
      ('2026-11-19 16:11:00+00','search','page_view','vehicle',50),
      ('2026-11-20 16:00:00+00','search','page_view','vehicle',1),
      ('2026-11-20 16:10:00+00','search','contact_click','vehicle',1),
      ('2026-11-20 16:11:00+00','search','contact_click','vehicle',50)`);
  await db.pool.query(`INSERT INTO analytics_vehicle_daily VALUES
    ('2026-11-21',$1,false,2,6,3),('2026-11-21',$2,true,2,2,1),('2026-11-21',$3,false,0,10,0)`,[x,y,z]);
  const staff = await db.pool.query<{stock_number:string}>("INSERT INTO vehicles(id) VALUES ($1) RETURNING stock_number",[x]);
  const staffCode = `HD-${staff.rows[0]!.stock_number.padStart(6,'0')}`;
  const publication = '40000000-0000-4000-8000-000000000001';
  await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES ($1,$2,$3)', [publication,x,
    {content:{title:{translations:{zh:{text:'自录车标题'}}}}}]);
  await db.pool.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[x,publication]);
  const supplier = await db.pool.query<{inquiry_number:string}>(`INSERT INTO external_listings
    (id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES ($1,'synthetic','synthetic','private-supplier-id',1,'hash','{}','active',now(),now()) RETURNING inquiry_number`,[y]);
  const supplierCode = `HX${supplier.rows[0]!.inquiry_number}`;
  await db.pool.query(`INSERT INTO external_catalog
    (listing_id,published_at,platform_name,listing_url,facts,issues,localized,details)
    VALUES ($1,now(),'Synthetic','https://example.invalid/private-supplier-id','{}','[]',$2,'{}')`,
  [y,{en:{title:{text:'Supplier vehicle'}},ru:{title:{text:'Машина поставщика'}}}]);
  await db.pool.query(`INSERT INTO analytics_vehicle_activity_hourly
    (hour,source,vehicle_id,supplier,locale,country,device,entry,detail_views,vehicle_clicks,contact_clicks,telegram_clicks)
    VALUES ('2026-11-20 16:00:00+00','search',$1,true,'ru','RU','mobile','vehicle',1,0,1,1)`,[y]);
  const sessionData = await db.pool.query<{id: string}>(`INSERT INTO analytics_sessions
    (started_at,last_at,source,entry,locale,device,country,catalog_stage,direct_stage) VALUES
    ('2026-11-20 15:58:00+00','2026-11-20 16:01:00+00','direct','catalog','zh','desktop','CN',4,0),
    ('2026-11-20 16:02:00+00','2026-11-20 16:03:00+00','search','vehicle','ru','mobile','RU',0,2),
    ('2026-11-20 16:04:00+00','2026-11-20 16:09:00+00','social','catalog','en','mobile','ZZ',3,0)
    RETURNING id`);
  const [a,b,c] = sessionData.rows.map(row=>row.id);
  await db.pool.query(`INSERT INTO analytics_session_vehicles VALUES
    ($1,$4,false,true,true),($2,$5,true,true,true),($3,$4,false,true,false),($3,$5,true,false,false)`,[a,b,c,x,y]);

  const report = await read({ days:'2',metric:'detailViews',page:'2',pageSize:'1' });
  assert.deepEqual(report.range, {start:'2026-11-19T16:00:00.000Z',end:clock.toISOString()});
  assert.equal(report.coverage,'partial');
  assert.deepEqual(report.trend.map(row=>row.coverage), ['partial','complete']);
  assert.equal(report.totals.pageViews, 6);
  assert.equal(report.totals.detailViews, 4);
  assert.equal(report.totals.filterSubmits, 1);
  assert.equal(report.totals.searchZeroResults, 1);
  assert.equal(report.totals.calculatorCompletions, 1);
  assert.equal(report.sessions, 3);
  assert.equal(report.activeSessions,3);
  assert.deepEqual(report.funnels, {catalog:{catalog:2,vehicleClick:2,detail:2,contact:1},direct:{detail:1,contact:1}});
  assert.deepEqual(report.markets.sources.map(row=>[row.source,row.sessions]), [['direct',1],['search',1],['social',1]]);
  assert.deepEqual(report.markets.channels, [{channel:'telegram',contactClicks:1},{channel:'wechat',contactClicks:1}]);
  assert.equal(report.markets.countries.find(row=>row.country==='ZZ')!.sessions, 1);
  assert.deepEqual(report.dailyUniqueIpEstimates, [{date:'2026-11-20',estimate:7},{date:'2026-11-21',estimate:11}]);
  assert.deepEqual(report.ranking.items.map(row=>[row.vehicleId,row.detailSessions,row.contactAfterDetailSessions,row.contactRate]), [[`ext-${y}`,1,1,1]]);
  assert.deepEqual(report.ranking.items.map(row=>[row.stockCode,row.title]), [[supplierCode,'Supplier vehicle']]);
  assert.equal(report.ranking.total,3);
  const allRates = await read({days:'2',metric:'contactRate'});
  assert.deepEqual(allRates.ranking.items.map(row=>[row.vehicleId,row.contactRate]), [[`ext-${y}`,1],[x,0.5],[z,null]]);
  assert.deepEqual(allRates.ranking.items.map(row=>[row.stockCode,row.title]), [[supplierCode,'Supplier vehicle'],[staffCode,'自录车标题'],[null,null]]);
  assert.doesNotMatch(JSON.stringify(allRates),/private-supplier-id/);
  const today = await read({days:'1'});
  assert.equal(today.sessions,2);
  assert.equal(today.funnels.catalog.contact,0);
  assert.equal(today.totals.contactClicks,4);
  assert.equal(today.comparison.previous.pageViews,4);
  assert.equal(today.comparison.current.contactClicks,1);
  assert.equal(today.comparison.today.end,'2026-11-20T16:11:00.000Z');
  assert.equal(today.comparison.yesterday.end,'2026-11-19T16:11:00.000Z');
  // An accepted delayed occurrence proves partial data, even before the first live heartbeat.
  assert.equal(today.comparison.yesterdayCoverage,'partial');
  assert.deepEqual(today.quality,{received:17,accepted:11,duplicates:4,dropped:2});

  const search = await read({startDate:'2026-11-20',endDate:'2026-11-21',source:'search',locale:'ru',country:'RU',device:'mobile',entry:'vehicle'});
  assert.equal(search.sessions,1);
  assert.equal(search.totals.pageViews,1);
  assert.deepEqual(search.ranking.items.map(row=>[row.vehicleId,row.detailViews,row.telegramClicks,row.whatsappClicks,row.source]),
    [[`ext-${y}`,1,1,0,'supplier']]);
  assert.equal(search.ranking.items[0]!.title,'Машина поставщика');
  assert.deepEqual(search.dailyUniqueIpEstimates.map(row=>row.estimate),[null,null]);
  const yesterday = await read({ period:'yesterday', granularity:'hour' });
  assert.equal(yesterday.trend.length,24);
  assert.equal(yesterday.sessions,1);
  assert.equal(yesterday.funnels.catalog.contact,1);
  assert.equal(yesterday.totals.contactClicks,0);
});

test('distinguishes a monitored zero bucket from a gap after collection started', async () => {
  await db.pool.query(`INSERT INTO analytics_v2_collection VALUES (1,'2026-11-20 15:58:00+00')
    ON CONFLICT(id) DO NOTHING;
    INSERT INTO analytics_v2_heartbeats
    SELECT slot FROM generate_series('2026-11-20 17:00:00+00'::timestamptz,'2026-11-20 17:55:00+00',interval '5 minutes') AS slots(slot)`);
  const query = AnalyticsReportQuerySchema.parse({ days:'1',granularity:'hour' });
  const result = await getAnalyticsReport(db,query,runtimeQuality,new Date('2026-11-20T19:00:00Z'));
  const observed = result.trend.find(row=>row.start==='2026-11-20T17:00:00.000Z')!;
  const gap = result.trend.find(row=>row.start==='2026-11-20T18:00:00.000Z')!;
  assert.equal(observed.pageViews,0);
  assert.equal(observed.coverage,'complete');
  assert.equal(gap.pageViews,0);
  assert.equal(gap.coverage,'gap');
});
