import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AnalyticsEventsResponseSchema, AnalyticsOverviewResponseSchema, AnalyticsReportResponseSchema } from '@hd/contracts/analytics';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createStaff } from '../src/staff-cli.js';

const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (base.hostname!=='127.0.0.1'||base.pathname!=='/postgres'||base.search||base.hash||!['postgres:','postgresql:'].includes(base.protocol)) {
  throw new Error('Analytics HTTP tests require an isolated local maintenance database.');
}

test('analytics HTTP persists only deduplicated public interactions and protects statistics',async t=>{
  const maintenance=createDatabase(base.href,2);
  const name=`hd_analytics_http_${randomBytes(8).toString('hex')}`;
  let runtime:Awaited<ReturnType<typeof buildApp>>|undefined;
  t.after(async()=>{
    try { await runtime?.app.close(); }
    finally {
      try { await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
      finally { await maintenance.close(); }
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  const url=new URL(base);url.pathname=`/${name}`;
  const origin='http://127.0.0.1:3363',host='127.0.0.1:3363';
  const gatewayKey=randomBytes(32).toString('hex');
  runtime=await buildApp({...readConfig({
    NODE_ENV:'test',DATABASE_URL:url.href,AUTH_SECRET:randomBytes(32).toString('hex'),
    AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin,ANALYTICS_ORIGINS:origin,ANALYTICS_V2_ENABLED:'true',TRUST_PROXY:'loopback',
  }),analyticsGatewaySecret:gatewayKey});
  const {app,auth,db}=runtime;
  await migrateDatabase(db);
  assert.equal((await app.inject({url:'/health/ready',headers:{host}})).statusCode,200);
  await db.pool.query('ALTER TABLE analytics_collection_state RENAME TO incomplete_analytics_collection_state');
  assert.equal((await app.inject({url:'/health/ready',headers:{host}})).statusCode,503);
  await db.pool.query('ALTER TABLE incomplete_analytics_collection_state RENAME TO analytics_collection_state');
  const cookies=new Map<string,string>();
  for(const role of ['admin','editor'] as const) {
    const email=`${role}@example.invalid`,password='isolated-analytics-staff-pass';
    await createStaff(auth,{email,password,name:`Synthetic ${role}`,role});
    const signedIn=await app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{origin,host},payload:{email,password}});
    assert.equal(signedIn.statusCode,200,signedIn.body);
    cookies.set(role,signedIn.cookies.map(c=>`${c.name}=${c.value}`).join('; '));
  }
  const stats='/api/v1/admin/analytics/overview';
  const read=async(days:7|30)=>{
    const response=await app.inject({url:`${stats}?days=${days}`,headers:{host,cookie:cookies.get('admin')!}});
    assert.equal(response.statusCode,200,response.body);
    assert.equal(response.headers['cache-control'],'no-store');
    return AnalyticsOverviewResponseSchema.parse(response.json()).data;
  };
  assert.equal((await app.inject({url:stats,headers:{host}})).statusCode,401);
  assert.equal((await app.inject({url:stats,headers:{host,cookie:cookies.get('editor')!}})).statusCode,403);
  const empty=await read(30);
  assert.equal(empty.days,30);
  assert.equal(empty.timeZone,'Asia/Shanghai');
  assert.equal(empty.hasData,false);
  assert.equal(empty.collectionStartedAt,null);
  assert.equal(Date.parse(empty.endDate)-Date.parse(empty.startDate),29*86_400_000);
  assert.deepEqual(empty.totals,{pageViews:0,detailViews:0,vehicleClicks:0,contactClicks:0});
  assert.deepEqual(empty.trend,[]);
  assert.deepEqual(empty.topVehicles,[]);

  const vehicleId=randomUUID(),publication=randomUUID();
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO vehicles(id) VALUES($1)',[vehicleId]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,vehicleId,JSON.stringify({
      source:{kind:'manual'},content:{title:{translations:{ru:{text:'Synthetic public title'}}}},
    })]);
    await tx.query("UPDATE vehicles SET published_revision_id=$2,publication_state='published',published_at=now() WHERE id=$1",[vehicleId,publication]);
  });

  const events=[
    {eventId:randomUUID(),type:'page_view',pageType:'home',locale:'ru'},
    {eventId:randomUUID(),type:'page_view',pageType:'vehicle',locale:'ru',vehicleId},
    {eventId:randomUUID(),type:'vehicle_click',pageType:'catalog',locale:'ru',vehicleId},
    {eventId:randomUUID(),type:'contact_click',pageType:'vehicle',locale:'ru',vehicleId,channel:'whatsapp'},
    {eventId:randomUUID(),type:'vehicle_click',pageType:'catalog',locale:'ru',vehicleId:randomUUID()},
  ];
  const post=()=>app.inject({method:'POST',url:'/api/v1/analytics/events',headers:{host,origin,'sec-fetch-site':'same-origin'},payload:{events}});
  for(let index=0;index<2;index++) {
    const response=await post();
    assert.equal(response.statusCode,202,response.body);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual(AnalyticsEventsResponseSchema.parse(response.json()).data,{accepted:true});
  }
  const overview=await read(7);
  assert.equal(overview.hasData,true);
  assert.ok(overview.collectionStartedAt);
  assert.equal(Date.parse(overview.endDate)-Date.parse(overview.startDate),6*86_400_000);
  assert.equal(overview.trend[0]?.date,overview.startDate);
  assert.equal(overview.trend.at(-1)?.date,overview.endDate);
  assert.equal(overview.trend.length,7);
  assert.deepEqual(overview.totals,{pageViews:2,detailViews:1,vehicleClicks:1,contactClicks:1});
  assert.deepEqual(overview.topVehicles,[{vehicleId,detailViews:1,vehicleClicks:1,contactClicks:1}]);
  assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM analytics_event_receipts')).rows[0].count,4);

  const reportPath='/api/v1/admin/analytics/report';
  assert.equal((await app.inject({url:reportPath,headers:{host}})).statusCode,401);
  assert.equal((await app.inject({url:reportPath,headers:{host,cookie:cookies.get('editor')!}})).statusCode,403);
  const reportHeaders={host,cookie:cookies.get('admin')!};
  assert.equal((await app.inject({url:`${reportPath}?period=yesterday&days=7`,headers:reportHeaders})).statusCode,400);
  assert.equal((await app.inject({url:`${reportPath}?startDate=2026-01-01&endDate=2026-04-01`,headers:reportHeaders})).statusCode,400);
  const sessionId=randomUUID();
  const ordered=[
    {type:'page_view',pageType:'catalog'},
    {type:'vehicle_click',pageType:'catalog',vehicleId},
    {type:'page_view',pageType:'vehicle',vehicleId},
    {type:'contact_click',pageType:'vehicle',vehicleId,channel:'whatsapp'},
    {type:'filter_submit',pageType:'catalog'},
    {type:'search_zero_results',pageType:'catalog'},
  ].map((event,sequence)=>({...event,sequence,sessionId,eventId:randomUUID(),locale:'ru',source:'search',device:'mobile'}));
  const extended=[...ordered,ordered[3],{...ordered[1],eventId:randomUUID(),vehicleId:randomUUID()}];
  // Physical receipt order can differ from event order inside a batch.
  extended.reverse();
  const edgeHeaders={host,origin,'x-forwarded-for':'198.51.100.42','x-hd-analytics-country':'KZ','x-hd-analytics-gateway-key':gatewayKey};
  const collect=(payload:unknown,headers:Record<string,string>=edgeHeaders)=>app.inject({method:'POST',url:'/api/v1/analytics/events',
    remoteAddress:'127.0.0.1',headers,payload:{events:payload}});
  for(let attempt=0;attempt<2;attempt++) {
    const response=await collect(extended);
    assert.equal(response.statusCode,202,response.body);
  }
  assert.equal((await collect([{...ordered[4],search:'synthetic private text'}])).statusCode,400);
  const spoof=await collect([{...ordered[4],sessionId:randomUUID(),eventId:randomUUID()}],{...edgeHeaders,'x-hd-analytics-gateway-key':'bad-key'});
  assert.equal(spoof.statusCode,202,spoof.body);
  const report=await app.inject({url:`${reportPath}?period=today&locale=ru&source=search&country=KZ&metric=contactClicks&page=1&pageSize=1`,headers:reportHeaders});
  assert.equal(report.statusCode,200,report.body);
  const data=AnalyticsReportResponseSchema.parse(report.json()).data;
  assert.equal(data.sessions,1);
  assert.deepEqual(data.funnels.catalog,{catalog:1,vehicleClick:1,detail:1,contact:1});
  assert.deepEqual(data.totals,{pageViews:2,detailViews:1,vehicleClicks:1,contactClicks:1,filterSubmits:1,searchZeroResults:1,calculatorCompletions:0});
  assert.equal(data.ranking.items[0]?.vehicleId,vehicleId);
  assert.equal(data.ranking.items[0]?.whatsappClicks,1);
  assert.equal(data.ranking.items[0]?.telegramClicks,0);
  assert.equal(data.ranking.items[0]?.title,'Synthetic public title');
  assert.equal(data.ranking.items[0]?.source,'staff');
  assert.equal(data.ranking.items[0]?.contactRate,1);
  assert.equal(data.dailyUniqueIpEstimates[0]?.estimate,null);
  assert.equal((await db.pool.query('SELECT unique_ips::int FROM analytics_daily_ips')).rows[0]?.unique_ips,1);
  assert.deepEqual((await db.pool.query("SELECT country FROM analytics_activity_hourly WHERE event_type='filter_submit' ORDER BY country")).rows,[{country:'KZ'},{country:'ZZ'}]);
  assert.deepEqual(data.quality,{received:27,accepted:11,duplicates:12,dropped:4});

  const otherVehicle=randomUUID(),otherVersion=randomUUID();
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO vehicles(id) VALUES($1)',[otherVehicle]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) SELECT $1,$2,data FROM vehicle_publications WHERE id=$3',
      [otherVersion,otherVehicle,publication]);
    await tx.query("UPDATE vehicles SET published_revision_id=$2,publication_state='published',published_at=now() WHERE id=$1",[otherVehicle,otherVersion]);
  });
  const otherSession=randomUUID();
  const orderedByClient=[ordered[0],ordered[1],ordered[3],ordered[2],{...ordered[3],vehicleId:otherVehicle}]
    .map((event,sequence)=>({...event,sequence,sessionId:otherSession,eventId:randomUUID(),source:'referral',entry:'catalog'}));
  const firstPart=await collect(orderedByClient.slice(2));
  assert.equal(firstPart.statusCode,202,firstPart.body);
  const backfill=await collect(orderedByClient.slice(0,2));
  assert.equal(backfill.statusCode,202,backfill.body);
  const edge=await app.inject({url:`${reportPath}?period=today&locale=ru&source=referral&country=KZ`,headers:reportHeaders});
  assert.equal(edge.statusCode,200,edge.body);
  const edgeReport=AnalyticsReportResponseSchema.parse(edge.json()).data;
  assert.equal(edgeReport.totals.contactClicks,2);
  assert.deepEqual(edgeReport.funnels.catalog,{catalog:1,vehicleClick:1,detail:1,contact:0});
  assert.equal(edgeReport.ranking.items.find(row=>row.vehicleId===vehicleId)?.contactRate,0);
  assert.deepEqual((await db.pool.query("SELECT DISTINCT entry FROM analytics_activity_hourly WHERE source='referral'")).rows,[{entry:'catalog'}]);

  await db.pool.query("UPDATE analytics_sessions SET last_at=now()-interval '31 minutes' WHERE source='referral'");
  const newLanding=await collect([{...orderedByClient[3],eventId:randomUUID(),vehicleId:otherVehicle,sequence:5,entry:'vehicle'}]);
  assert.equal(newLanding.statusCode,202,newLanding.body);
  const newContact=await collect([{...orderedByClient[4],eventId:randomUUID(),sequence:6,entry:'vehicle'}]);
  assert.equal(newContact.statusCode,202,newContact.body);
  const afterIdle=await app.inject({url:`${reportPath}?period=today&source=referral`,headers:reportHeaders});
  assert.equal(afterIdle.statusCode,200,afterIdle.body);
  const idleReport=AnalyticsReportResponseSchema.parse(afterIdle.json()).data;
  assert.equal(idleReport.sessions,2);
  assert.equal(idleReport.activeSessions,1);
  assert.deepEqual(idleReport.funnels.direct,{detail:1,contact:1});

  await db.pool.query("UPDATE analytics_session_keys SET started_at=now()-interval '8 days'; UPDATE analytics_session_events SET received_at=now()-interval '8 days'");
  await runtime.analytics.prune();
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_session_keys')).rows[0]?.n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_session_events')).rows[0]?.n,0);
  const pruned=await app.inject({url:`${reportPath}?period=today&source=referral`,headers:reportHeaders});
  assert.equal(pruned.statusCode,200,pruned.body);
  assert.deepEqual(AnalyticsReportResponseSchema.parse(pruned.json()).data.funnels,idleReport.funnels);

  const occurrence=new Date(Date.now()-20*60_000);
  const timeResponse=await collect([{eventId:randomUUID(),type:'calculator_complete',pageType:'calculator',locale:'ru',occurredAt:occurrence.toISOString()}]);
  assert.equal(timeResponse.statusCode,202,timeResponse.body);
  const bucket=await db.pool.query("SELECT minute FROM analytics_activity_minutes WHERE event_type='calculator_complete'");
  assert.equal(bucket.rows[0]?.minute.getTime(),Math.floor(occurrence.getTime()/60_000)*60_000);
});
