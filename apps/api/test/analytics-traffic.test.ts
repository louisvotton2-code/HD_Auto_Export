import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { AnalyticsTrafficQuerySchema } from '@hd/contracts/analytics';
import { getAnalyticsTraffic } from '../src/analytics/traffic.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';

const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1' ||
    address.pathname !== '/postgres' || address.search || address.hash) {
  throw new Error('Analytics traffic tests require an isolated local maintenance database.');
}
const name = `hd_api_test_analytics_traffic_${randomBytes(8).toString('hex')}`;
const databaseAddress = new URL(address);
databaseAddress.pathname = `/${name}`;
const maintenance = createDatabase(address.toString(), 1);
const db = createDatabase(databaseAddress.toString(), 2);
let created = false;
const clock = new Date('2026-11-21T02:37:00.000Z');
const quality = {configured:true,accepted:14,rejected:2,rateLimited:1,unavailable:1,since:clock.toISOString()};
const read = (query:Record<string,string>={}, now=clock) => getAnalyticsTraffic(db,AnalyticsTrafficQuerySchema.parse(query),quality,now);
const visitQuality = {...quality,duplicates:8};
const readVisits = (query:Record<string,string>={}, now=clock) => getAnalyticsTraffic(db,
  AnalyticsTrafficQuerySchema.parse({...query,include:'unique-ip-visits'}),quality,now,visitQuality);
const a = '30000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
const c = '20000000-0000-4000-8000-000000000003';

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await maintenance.pool.query(`ALTER DATABASE "${name}" SET timezone TO 'America/Los_Angeles'`);
  await migrateDatabase(db);
});
after(async () => {
  await db.close();
  try { if(created) await maintenance.pool.query(`DROP DATABASE "${name}"`); }
  finally { await maintenance.close(); }
});

test('reports independent missing web documents even when consent analytics have counts', async()=>{
  await db.pool.query("INSERT INTO analytics_daily VALUES ('2026-11-21',42,14,6,3)");
  const report=await read({period:'today',granularity:'hour'});
  assert.equal(report.timeZone,'Asia/Shanghai');
  assert.deepEqual(report.range,{start:'2026-11-20T16:00:00.000Z',end:clock.toISOString()});
  assert.equal(report.trend.length,11);
  assert.ok(report.trend.every(row=>row.documentCoverage==='not_collected'));
  assert.deepEqual(report.totals,{documentRequests:0,whatsappClicks:0,telegramClicks:0,totalContactClicks:0});
  assert.deepEqual(report.quality.documents,{coverage:'not_collected',expectedHours:10,importedHours:0,latestHour:null});
  assert.deepEqual(report.quality.contacts,{...quality,collectionStartedAt:null,coverage:'not_collected'});
  assert.deepEqual(report.ranking.items,[]);
  assert.equal(Object.hasOwn(report.quality,'visits'),false);
  assert.equal(Object.hasOwn(report.totals,'uniqueIpVisits'),false);
  assert.equal(Object.hasOwn(report.trend[0]!,'visitCoverage'),false);
  assert.equal(Object.hasOwn(report.comparison,'previousVisitCoverage'),false);

  const optIn=await readVisits({period:'today',granularity:'hour'});
  assert.equal(optIn.totals.uniqueIpVisits,null);
  assert.equal(optIn.comparison.current.uniqueIpVisits,null);
  assert.equal(optIn.comparison.previous.uniqueIpVisits,null);
  assert.ok(optIn.trend.every(row=>row.uniqueIpVisits===null&&row.visitCoverage==='not_collected'));
  assert.deepEqual(optIn.quality.visits,{...visitQuality,coverage:'not_collected',expectedHours:10,importedHours:0,latestHour:null});
});

test('covers whole Shanghai hours, counts zero snapshots, compares matched elapsed hours and ranks all contact vehicles',async()=>{
  await db.pool.query(`INSERT INTO analytics_document_snapshots(hour,status,digest,imported_at) VALUES
      ('2026-11-19 16:00+00','complete',repeat('a',64),now()),
      ('2026-11-20 02:00+00','complete',repeat('b',64),now()),
      ('2026-11-20 16:00+00','complete',repeat('c',64),now()),
      ('2026-11-20 17:00+00','partial',repeat('d',64),now()),
      ('2026-11-20 19:00+00','complete',repeat('e',64),now()),
      ('2026-11-21 02:00+00','partial',repeat('f',64),now());
    INSERT INTO analytics_document_hourly(hour,locale,page_type,requests) VALUES
      ('2026-11-19 16:00+00','zh','home',7),('2026-11-20 02:00+00','zh','home',99),
      ('2026-11-20 17:00+00','zh','home',2),('2026-11-20 17:00+00','ru','vehicle',3),
      ('2026-11-20 19:00+00','zh','home',5),('2026-11-21 02:00+00','zh','home',13);
    INSERT INTO analytics_contact_collection(id,started_at) VALUES (1,'2026-11-19 16:00+00');`);
  await db.pool.query(`INSERT INTO analytics_contact_hourly(hour,vehicle_id,supplier,channel,clicks) VALUES
    ('2026-11-19 16:00+00',$1,false,'whatsapp',3),('2026-11-20 02:00+00',$1,false,'whatsapp',99),
    ('2026-11-20 16:00+00',$1,false,'whatsapp',9),('2026-11-20 16:00+00',$1,false,'telegram',1),
    ('2026-11-20 17:00+00',$2,false,'whatsapp',1),('2026-11-20 17:00+00',$2,false,'telegram',9),
    ('2026-11-20 19:00+00',$3,true,'whatsapp',9),('2026-11-21 02:00+00',$3,true,'telegram',2)`,[a,b,c]);
  const staff=await db.pool.query<{stock_number:string}>('INSERT INTO vehicles(id) VALUES ($1) RETURNING stock_number',[a]);
  const stock=`HD-${staff.rows[0]!.stock_number.padStart(6,'0')}`;
  const publication='40000000-0000-4000-8000-000000000001';
  await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES ($1,$2,$3)',[publication,a,
    {content:{title:{translations:{zh:{text:'自录车'},ru:{text:'Машина'}}}}}]);
  await db.pool.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[a,publication]);
  const supplier=await db.pool.query<{inquiry_number:string}>(`INSERT INTO external_listings
    (id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES ($1,'synthetic','synthetic','private-traffic-test-id',1,'hash','{}','active',now(),now()) RETURNING inquiry_number`,[c]);
  await db.pool.query(`INSERT INTO external_catalog
    (listing_id,published_at,platform_name,listing_url,facts,issues,localized,details)
    VALUES ($1,now(),'Synthetic','https://example.invalid/private-traffic-test-id','{}','[]',$2,'{}')`,
    [c,{en:{title:{text:'Supplier vehicle'}}}]);

  const report=await read({period:'today',granularity:'hour',page:'1',pageSize:'1'});
  assert.deepEqual(report.totals,{documentRequests:23,whatsappClicks:19,telegramClicks:12,totalContactClicks:31});
  assert.deepEqual(report.comparison.currentRange,{start:'2026-11-20T16:00:00.000Z',end:'2026-11-21T02:00:00.000Z'});
  assert.deepEqual(report.comparison.previousRange,{start:'2026-11-19T16:00:00.000Z',end:'2026-11-20T02:00:00.000Z'});
  assert.deepEqual(report.comparison.current,{documentRequests:10,whatsappClicks:19,telegramClicks:10,totalContactClicks:29});
  assert.deepEqual(report.comparison.previous,{documentRequests:7,whatsappClicks:3,telegramClicks:0,totalContactClicks:3});
  assert.equal(report.quality.documents.expectedHours,10);
  assert.equal(report.quality.documents.importedHours,3);
  assert.equal(report.quality.documents.latestHour,'2026-11-21T02:00:00.000Z');
  assert.equal(report.quality.documents.coverage,'partial');
  assert.equal(report.quality.contacts.collectionStartedAt,'2026-11-19T16:00:00.000Z');
  assert.equal(report.trend[0]!.documentCoverage,'complete');
  assert.equal(report.trend[0]!.documentRequests,0);
  assert.equal(report.trend[1]!.documentCoverage,'partial');
  assert.equal(report.trend[2]!.documentCoverage,'gap');
  assert.equal(report.trend[2]!.documentRequests,0);
  assert.equal(report.trend.at(-1)!.documentCoverage,'partial');
  assert.equal(report.trend.at(-1)!.documentRequests,13);
  assert.deepEqual(report.documents,[{locale:'ru',pageType:'vehicle',requests:3},{locale:'zh',pageType:'home',requests:20}]);
  assert.equal(report.ranking.total,3);
  assert.deepEqual(report.ranking.items,[{vehicleId:`ext-${c}`,stockCode:`HX${supplier.rows[0]!.inquiry_number}`,
    title:'Supplier vehicle',source:'supplier',whatsappClicks:9,telegramClicks:2,totalContactClicks:11}]);
  assert.doesNotMatch(JSON.stringify(report),/private-traffic-test-id/);

  const filtered=await read({period:'today',locale:'ru',pageType:'vehicle',rankBy:'whatsapp',page:'1',pageSize:'1'});
  assert.equal(filtered.totals.documentRequests,3);
  assert.equal(filtered.totals.totalContactClicks,31);
  assert.deepEqual(filtered.ranking.items,[{vehicleId:a,stockCode:stock,title:'Машина',source:'staff',
    whatsappClicks:9,telegramClicks:1,totalContactClicks:10}]);
  const second=await read({period:'today',rankBy:'whatsapp',page:'2',pageSize:'1'});
  assert.equal(second.ranking.total,3);
  assert.equal(second.ranking.items[0]!.vehicleId,`ext-${c}`);
  const telegram=await read({period:'today',rankBy:'telegram'});
  assert.equal(telegram.ranking.items[0]!.vehicleId,b);
  assert.equal(telegram.ranking.items[0]!.title,null);
});

test('retention limits selected documents and contact aggregates independently of delayed pruning', async()=>{
  await db.pool.query(`INSERT INTO analytics_document_snapshots(hour,status,digest,imported_at)
    VALUES ('2026-07-01 16:00+00','complete',repeat('9',64),now());
    INSERT INTO analytics_document_hourly(hour,locale,page_type,requests)
      VALUES ('2026-07-01 16:00+00','zh','home',8);`);
  await db.pool.query(`INSERT INTO analytics_contact_hourly(hour,vehicle_id,supplier,channel,clicks)
      VALUES ('2026-07-01 16:00+00',$1,false,'telegram',5)`,[a]);
  const old=await read({startDate:'2026-07-02',endDate:'2026-07-02',granularity:'hour'});
  assert.equal(old.trend.length,24);
  assert.equal(old.totals.documentRequests,0);
  assert.equal(old.totals.telegramClicks,0);
  assert.equal(old.quality.documents.coverage,'not_collected');
  assert.equal(old.ranking.total,0);
});

test('shows distinct visit evidence by hour and matched period without inheriting document filters',async()=>{
  await db.pool.query(`INSERT INTO analytics_ip_visit_coverage(hour,status) VALUES
      ('2026-07-01 16:00+00','complete'),('2026-11-19 16:00+00','complete'),
      ('2026-11-20 16:00+00','complete'),('2026-11-20 17:00+00','partial'),
      ('2026-11-20 19:00+00','partial'),('2026-11-20 20:00+00','complete');
    INSERT INTO analytics_ip_visit_hourly(hour,visits) VALUES
      ('2026-07-01 16:00+00',99),('2026-11-19 16:00+00',2),('2026-11-20 02:00+00',99),
      ('2026-11-20 17:00+00',3),('2026-11-20 20:00+00',4),('2026-11-21 02:00+00',7);
    INSERT INTO analytics_document_snapshots(hour,status,digest) VALUES ('2026-11-20 21:00+00','complete',repeat('a',64));
    INSERT INTO analytics_document_hourly(hour,locale,page_type,requests) VALUES ('2026-11-20 21:00+00','zh','home',6);`);
  await db.pool.query(`INSERT INTO analytics_contact_hourly(hour,vehicle_id,supplier,channel,clicks)
    VALUES ('2026-11-20 21:00+00',$1,false,'whatsapp',1)`,[a]);
  const request={period:'today',granularity:'hour'};
  const report=await readVisits(request);
  assert.equal(report.totals.uniqueIpVisits,14);
  assert.equal(report.comparison.current.uniqueIpVisits,7);
  assert.equal(report.comparison.previous.uniqueIpVisits,2);
  assert.equal(report.comparison.visitCoverage,'partial');
  assert.equal(report.comparison.previousVisitCoverage,'partial');
  assert.deepEqual(report.trend.slice(0,5).map(row=>[row.uniqueIpVisits,row.visitCoverage]),
    [[0,'complete'],[3,'partial'],[null,'gap'],[null,'partial'],[4,'complete']]);
  assert.equal(report.trend.at(-1)!.uniqueIpVisits,7);
  assert.equal(report.trend.at(-1)!.visitCoverage,'partial');
  assert.deepEqual(report.quality.visits,{...visitQuality,coverage:'partial',expectedHours:10,importedHours:4,
    latestHour:'2026-11-21T02:00:00.000Z'});

  const onlyRussianVehicles=await readVisits({...request,locale:'ru',pageType:'vehicle'});
  assert.ok(onlyRussianVehicles.totals.documentRequests<=report.totals.documentRequests-6);
  assert.equal(onlyRussianVehicles.totals.totalContactClicks,report.totals.totalContactClicks);
  assert.equal(onlyRussianVehicles.totals.uniqueIpVisits,report.totals.uniqueIpVisits);
  assert.deepEqual(onlyRussianVehicles.quality.visits,report.quality.visits);
  const old=await readVisits({startDate:'2026-07-02',endDate:'2026-07-02'});
  assert.equal(old.totals.uniqueIpVisits,null);
  assert.equal(old.trend[0]!.visitCoverage,'not_collected');
  assert.equal(old.quality.visits?.importedHours,0);

  const legacy=await read(request);
  assert.equal(Object.hasOwn(legacy.totals,'uniqueIpVisits'),false);
  assert.equal(Object.hasOwn(legacy.quality,'visits'),false);
  assert.equal(Object.hasOwn(legacy.comparison.current,'uniqueIpVisits'),false);
});

test('supports the full ninety-day hourly gateway matrix under the report statement budget', async()=>{
  await db.pool.query(`TRUNCATE analytics_document_snapshots,analytics_document_hourly,analytics_contact_hourly,
    analytics_ip_visit_hourly,analytics_ip_visit_coverage;
    INSERT INTO analytics_document_snapshots(hour,status,digest)
    SELECT hour,'complete',repeat('a',64) FROM generate_series('2026-08-23 16:00+00'::timestamptz,
      '2026-11-21 01:00+00'::timestamptz,interval '1 hour') hrs(hour);
    INSERT INTO analytics_document_hourly(hour,locale,page_type,requests)
      SELECT h.hour,l.locale,p.page_type,1 FROM analytics_document_snapshots h
       CROSS JOIN (VALUES ('zh'),('en'),('ru')) l(locale) CROSS JOIN
         (VALUES ('home'),('catalog'),('vehicle'),('calculator'),('parts'),('guide'),('about'),('other')) p(page_type);
    INSERT INTO analytics_ip_visit_hourly(hour,visits) SELECT hour,1 FROM analytics_document_snapshots;
    INSERT INTO analytics_ip_visit_coverage(hour,status) SELECT hour,'complete' FROM analytics_document_snapshots;`);
  await db.pool.query(`INSERT INTO analytics_contact_hourly(hour,vehicle_id,supplier,channel,clicks)
    SELECT h.hour,$1,false,'whatsapp',1 FROM analytics_document_snapshots h`,[a]);
  const report=await readVisits({days:'90',granularity:'hour'});
  const completeHours=89*24+10;
  assert.equal(report.quality.documents.expectedHours,completeHours);
  assert.equal(report.quality.documents.importedHours,completeHours);
  assert.equal(report.trend.length,completeHours+1);
  assert.equal(report.totals.documentRequests,24*completeHours);
  assert.equal(report.totals.totalContactClicks,completeHours);
  assert.equal(report.comparison.documentCoverage,'complete');
  assert.equal(report.comparison.previousDocumentCoverage,'not_collected');
  assert.equal(report.trend.at(-1)!.documentCoverage,'partial');
  assert.equal(report.documents.length,24);
  assert.equal(report.totals.uniqueIpVisits,completeHours);
  assert.equal(report.quality.visits?.importedHours,completeHours);
  assert.equal(report.comparison.current.uniqueIpVisits,completeHours);
  assert.equal(report.comparison.visitCoverage,'complete');
  assert.equal(report.comparison.previous.uniqueIpVisits,null);
  assert.equal(report.comparison.previousVisitCoverage,'not_collected');
  assert.equal(report.trend.at(-1)!.uniqueIpVisits,null);
});
