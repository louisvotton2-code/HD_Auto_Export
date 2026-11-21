import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {analyticsIpVisitPath,analyticsIpVisitKeyHeader,AnalyticsTrafficResponseSchema} from '@hd/contracts/analytics';
import {buildApp} from '../src/app.js';
import {normalizeVisitAddress} from '../src/analytics/ip-visits.js';
import {readConfig} from '../src/config.js';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {createStaff} from '../src/staff-cli.js';

const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(base.hostname!=='127.0.0.1'||base.pathname!=='/postgres'||base.search||base.hash||!['postgres:','postgresql:'].includes(base.protocol))
  throw new Error('IP visit HTTP tests require a local maintenance database.');

test('IP normalization binds mapped IPv4 and compressed IPv6, and rejects zones and malformed IPv4',()=>{
  assert.equal(normalizeVisitAddress('::ffff:c000:22a'),'192.0.2.42');
  assert.equal(normalizeVisitAddress('::FFFF:192.0.2.42'),'192.0.2.42');
  assert.equal(normalizeVisitAddress('2001:0DB8:0000:0000:0000:0000:0000:0042'),'2001:db8::42');
  for(const input of ['192.0.002.42','fe80::1%en0','192.0.2.42, 192.0.2.1','[::1]','example.invalid'])
    assert.equal(normalizeVisitAddress(input),undefined);
});

test('private visit writes fail closed, separate counters, and preserve old admin traffic through a visit-store failure',async t=>{
  const maintenance=createDatabase(base.href,1);
  const name=`hd_visit_http_${randomBytes(8).toString('hex')}`;
  const apps:Awaited<ReturnType<typeof buildApp>>[]=[];
  t.after(async()=>{
    try{for(const runtime of apps)await runtime.app.close();}
    finally{
      try{await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);}
      finally{await maintenance.close();}
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  const target=new URL(base);target.pathname=`/${name}`;
  const host='127.0.0.1:3363',origin=`http://${host}`;
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:target.href,AUTH_SECRET:randomBytes(32).toString('hex'),
    AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin,ANALYTICS_IP_VISITS_ENABLED:'true',TRUST_PROXY:'loopback'});
  assert.equal(config.ipVisitService,null);
  assert.equal(config.ipVisitsMisconfigured,true);
  const disabled=await buildApp(config);
  apps.push(disabled);
  assert.equal((await disabled.app.inject({method:'POST',url:analyticsIpVisitPath,headers:{host},payload:{}})).statusCode,404);
  const key=randomBytes(32).toString('hex');
  const runtime=await buildApp({...config,ipVisitsMisconfigured:false,ipVisitService:{peers:['127.0.0.1/32'],
    gatewaySecret:key,hashSecret:randomBytes(32).toString('hex')}});
  apps.push(runtime);
  const {app,auth,db}=runtime;
  await migrateDatabase(db);
  const send=(payload:unknown,headers:Record<string,string>={},remoteAddress='127.0.0.1')=>app.inject({
    method:'POST',url:analyticsIpVisitPath,remoteAddress,payload:payload as object,headers:{host,'content-type':'application/json',
      [analyticsIpVisitKeyHeader]:key,...headers},
  });
  const document={version:1,kind:'document',address:'192.0.2.42',observedAt:new Date().toISOString()};
  assert.equal((await send('{not-json',{[analyticsIpVisitKeyHeader]:'bad'})).statusCode,404);
  assert.equal((await send(document,{},'198.51.100.40')).statusCode,404);
  const publicHeaders:Record<string,string>[]=[{origin},{cookie:'anonymous=off'},{'x-forwarded-for':'192.0.2.42'},{referer:origin}];
  for(const header of publicHeaders)assert.equal((await send(document,header)).statusCode,404);
  assert.equal((await send({...document,locale:'ru'})).statusCode,400);
  assert.equal((await send({...document,address:'192.0.2.042'})).statusCode,400);
  assert.equal((await send({...document,observedAt:new Date(Date.now()-121_000).toISOString()})).statusCode,400);
  assert.equal((await send(document)).statusCode,204);
  assert.equal((await send({...document,address:'::ffff:192.0.2.42'})).statusCode,204);
  assert.deepEqual((await db.pool.query('SELECT visits::int FROM analytics_ip_visit_hourly')).rows,[{visits:1}]);
  const keyShape=await db.pool.query('SELECT octet_length(digest)::int AS size FROM analytics_ip_visit_keys');
  assert.deepEqual(keyShape.rows,[{size:32}]);
  for(const table of ['analytics_event_receipts','analytics_ip_keys','analytics_contact_hourly','analytics_document_hourly'])
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n,0);
  assert.equal(app.swagger().paths?.[analyticsIpVisitPath],undefined);

  const report='/api/v1/admin/analytics/traffic?period=today&granularity=hour';
  const email='visit-admin@example.invalid',password='isolated-visit-admin-test';
  await createStaff(auth,{email,password,name:'Isolated visitor report admin',role:'admin'});
  const login=await app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{host,origin},payload:{email,password}});
  assert.equal(login.statusCode,200,login.body);
  const cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  assert.equal((await app.inject({url:`${report}&include=unique-ip-visits`,headers:{host}})).statusCode,401);
  const read=async(path:string)=>{
    const result=await app.inject({url:path,headers:{host,cookie}});
    assert.equal(result.statusCode,200,result.body);
    return AnalyticsTrafficResponseSchema.parse(result.json()).data;
  };
  const observed=await read(`${report}&include=unique-ip-visits`);
  assert.equal(observed.totals.uniqueIpVisits,1);
  assert.equal(observed.quality.visits?.accepted,1);
  assert.equal(observed.quality.visits?.duplicates,1);
  assert.equal((await read(report)).totals.uniqueIpVisits,undefined);

  await db.pool.query('ALTER TABLE analytics_ip_visit_hourly RENAME TO unavailable_ip_visits');
  try {
    const failure=await send({...document,address:'2001:db8::55'});
    assert.equal(failure.statusCode,503,failure.body);
    assert.doesNotMatch(failure.body,/unavailable_ip_visits|2001:db8/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]?.n,1);
    assert.equal((await read(report)).totals.uniqueIpVisits,undefined);
    assert.equal((await app.inject({url:'/api/v1/vehicles?locale=zh&projection=card&view=localized',headers:{host}})).statusCode,200);
  }finally{await db.pool.query('ALTER TABLE unavailable_ip_visits RENAME TO analytics_ip_visit_hourly');}
});
