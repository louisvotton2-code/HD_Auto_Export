import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AnalyticsEventsResponseSchema, AnalyticsOverviewResponseSchema } from '@hd/contracts/analytics';
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
  runtime=await buildApp(readConfig({
    NODE_ENV:'test',DATABASE_URL:url.href,AUTH_SECRET:randomBytes(32).toString('hex'),
    AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin,ANALYTICS_ORIGINS:origin,
  }));
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
});
