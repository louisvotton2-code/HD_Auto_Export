import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {createStaff} from '../src/staff-cli.js';
import {AnalyticsTrafficResponseSchema} from '@hd/contracts/analytics';

const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(address.hostname!=='127.0.0.1'||address.pathname!=='/postgres'||address.search||address.hash||!['postgres:','postgresql:'].includes(address.protocol))
  throw new Error('Anonymous contact tests require a local maintenance database.');

test('anonymous contact increments once, keeps only a vehicle/hour/channel total, and validates privacy and staff boundaries',async t=>{
  const maintenance=createDatabase(address.href,2);
  const dbName=`hd_traffic_contact_${randomBytes(8).toString('hex')}`;
  const instances:Awaited<ReturnType<typeof buildApp>>[]=[];
  t.after(async()=>{
    try {for(const instance of instances)await instance.app.close();}
    finally {
      try {await maintenance.pool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);}
      finally {await maintenance.close();}
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${dbName}"`);
  const target=new URL(address);target.pathname=`/${dbName}`;
  const host='127.0.0.1:3363',origin=`http://${host}`,path='/api/v1/analytics/contact-count';
  const env={NODE_ENV:'test',DATABASE_URL:target.href,AUTH_SECRET:randomBytes(32).toString('hex'),
    AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin,ANALYTICS_ORIGINS:origin,TRUST_PROXY:'loopback',ANALYTICS_CONTACT_LOCAL_ENABLED:'true'};
  const runtime=await buildApp(readConfig(env));
  instances.push(runtime);
  const {app,db,auth}=runtime;
  await migrateDatabase(db);
  const vehicleId=randomUUID(),draftId=randomUUID(),publication=randomUUID();
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO vehicles(id) VALUES($1),($2)',[vehicleId,draftId]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,vehicleId,
      JSON.stringify({source:{kind:'manual'},content:{title:{translations:{zh:{text:'合成公开车辆'}}}}})]);
    await tx.query("UPDATE vehicles SET published_revision_id=$2,publication_state='published',published_at=now() WHERE id=$1",[vehicleId,publication]);
  });
  const payload={vehicleId,channel:'whatsapp'};
  const headers={host,origin,'content-type':'application/json','sec-fetch-site':'same-origin'};
  const submit=(body:object|string=payload,overrides?:Record<string,string>)=>app.inject({
    method:'POST',url:path,headers:{...headers,...overrides},payload:body,remoteAddress:'127.0.0.1'});
  assert.equal((await submit('broken JSON',{origin:'https://wrong.invalid'})).statusCode,403);
  for(const fields of [{source:'referral'},{sessionId:randomUUID()},{eventId:randomUUID()},{country:'CN'},{ip:'192.0.2.1'}])
    assert.equal((await submit({...payload,...fields})).statusCode,400);
  assert.equal((await submit({...payload,channel:'phone'})).statusCode,400);
  assert.equal((await submit({...payload,vehicleId:draftId})).statusCode,404);
  assert.equal((await submit({...payload,vehicleId:`ext-${randomUUID()}`})).statusCode,404);
  assert.equal((await submit('x'.repeat(513))).statusCode,413);
  const accepted=await submit(payload,{cookie:'irrelevant=not-retained',referer:'https://private.example/a'});
  assert.equal(accepted.statusCode,204,accepted.body);
  assert.equal(accepted.headers['cache-control'],'no-store');
  assert.equal(accepted.headers['set-cookie'],undefined);
  assert.deepEqual((await db.pool.query('SELECT vehicle_id,supplier,channel,clicks::int FROM analytics_contact_hourly')).rows,
    [{vehicle_id:vehicleId,supplier:false,channel:'whatsapp',clicks:1}]);
  for(const table of ['analytics_event_receipts','analytics_sessions','analytics_ip_keys','analytics_activity_hourly']){
    const {rows:[count]}=await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    assert.equal(count!.n,0);
  }

  const report='/api/v1/admin/analytics/traffic?period=today&granularity=hour';
  assert.equal((await app.inject({url:report,headers:{host}})).statusCode,401);
  for(const role of ['editor','admin'] as const){
    const email=`${role}@example.invalid`,password='isolated-traffic-report-access';
    await createStaff(auth,{email,password,name:role,role});
    const login=await app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{host,origin},payload:{email,password}});
    assert.equal(login.statusCode,200,login.body);
    const cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
    const read=await app.inject({url:report,headers:{host,cookie}});
    assert.equal(read.statusCode,role==='admin'?200:403,read.body);
    if(role==='admin') {
      const result=AnalyticsTrafficResponseSchema.parse(read.json()).data;
      assert.deepEqual(result.totals,{documentRequests:0,totalContactClicks:1,whatsappClicks:1,telegramClicks:0});
      assert.equal(result.quality.documents.coverage,'not_collected');
      assert.equal(result.quality.contacts.accepted,1);
      assert.equal(result.ranking.items[0]?.vehicleId,vehicleId);
    }
  }
  // Separate global key from legacy collection, while bounding this address's anonymous traffic.
  for(let n=0;n<12;n++)await submit({...payload,vehicleId:draftId});
  assert.equal((await submit()).statusCode,429);
  const legacy=await app.inject({method:'POST',url:'/api/v1/analytics/events',remoteAddress:'127.0.0.1',headers,
    payload:{events:[{eventId:randomUUID(),type:'page_view',pageType:'home',locale:'zh'}]}});
  assert.equal(legacy.statusCode,202,legacy.body);
  assert.equal((await db.pool.query('SELECT clicks::int FROM analytics_contact_hourly')).rows[0]?.clicks,1);

  const publicOrigin='https://cars.example.invalid',key=randomBytes(32).toString('hex');
  const gated=await buildApp({...readConfig({...env,HD_DEPLOYMENT_ENV:'production',HD_RELEASE_ID:'0'.repeat(40),
    ANALYTICS_ORIGINS:publicOrigin,ANALYTICS_CONTACT_ALLOWED_COUNTRIES:'KZ'}),analyticsGatewaySecret:key});
  instances.push(gated);
  const viaGateway=(country:string,secret=key,peer='127.0.0.1')=>gated.app.inject({
    method:'POST',url:path,remoteAddress:peer,headers:{...headers,host:'cars.example.invalid',origin:publicOrigin,
      'x-forwarded-proto':'https','x-forwarded-for':'198.51.100.9','x-hd-analytics-country':country,'x-hd-analytics-gateway-key':secret},
    payload:{...payload,channel:'telegram'},
  });
  assert.equal((await viaGateway('ZZ')).statusCode,403);
  assert.equal((await viaGateway('CN')).statusCode,403);
  assert.equal((await viaGateway('KZ','bad')).statusCode,403);
  assert.equal((await viaGateway('KZ',key,'198.51.100.10')).statusCode,403);
  assert.equal((await viaGateway('KZ')).statusCode,204);
  assert.deepEqual((await db.pool.query('SELECT channel,clicks::int FROM analytics_contact_hourly ORDER BY channel')).rows,
    [{channel:'telegram',clicks:1},{channel:'whatsapp',clicks:1}]);
});
