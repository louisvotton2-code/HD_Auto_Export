import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { ApiErrorSchema, type PublicVehicleQuery } from '@hd/contracts/public';
import { buildApp } from './app.js';
import { readConfig } from './config.js';

const start=Date.parse('2026-11-08T00:00:00Z');
const proxy='192.0.2.10';
const web='192.0.2.11';
const visitor='198.51.100.51';
const secondVisitor='198.51.100.52';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const staffCookie='hd-auto.session_token=traffic-test-session';

// Only business dependencies are replaced. Real routes, IP resolution, authentication
// hooks and rate-limit middleware run without listening or opening a database connection.
async function setup(t:TestContext,trustProxy='false') {
  t.mock.timers.enable({apis:['Date'],now:start});
  const runtime=await buildApp(readConfig({NODE_ENV:'test',
    DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
    AUTH_SECRET:'traffic-limit-test-placeholder-not-a-live-secret',TRUST_PROXY:trustProxy}));
  t.after(()=>runtime.app.close());
  t.mock.method(runtime.db.pool,'connect',()=>{throw new Error('This test must not connect to a database.');});
  const query=t.mock.method(runtime.db.pool,'query',async(sql:unknown)=>{
    if(sql==='SELECT id,name,role,banned FROM staff WHERE id=$1') {
      return {rows:[{id:'traffic-test-staff',name:'Test editor',role:'editor',banned:false}],rowCount:1};
    }
    if(sql==='SELECT h.id,v.deleted_at FROM home_config h LEFT JOIN vehicles v ON false WHERE h.id=1') {
      return {rows:[{id:1}],rowCount:1};
    }
    throw new Error('Unexpected database query in a traffic-limit test.');
  });
  const getSession=t.mock.method(runtime.auth.api,'getSession',async(options:{headers?:HeadersInit})=>{
    if(new Headers(options?.headers).get('cookie')!==staffCookie) return null;
    return {user:{id:'traffic-test-staff'},session:{id:'traffic-test-session'}};
  });
  const authRequests:Request[]=[];
  t.mock.method(runtime.auth,'handler',async(request:Request)=>{
    authRequests.push(request);
    return new Response('null',{headers:{'Content-Type':'application/json'}});
  });
  const list=t.mock.method(runtime.inventory,'listPublic',async(query:PublicVehicleQuery,requestId:string)=>({
    data:{items:[],page:query.page,pageSize:query.pageSize,hasMore:false},
    meta:{requestId,catalog:'curated' as const,total:0,totalKind:'exact' as const,
      accessibleTotal:0,dataAsOf:new Date(start).toISOString(),freshness:'fresh' as const},
  }));
  t.mock.method(runtime.inventory,'getPublic',async()=>makePublicVehicleFixture());
  t.mock.method(runtime.inventory,'filters',async()=>({catalog:'curated' as const,makes:[],models:[],powertrains:[]}));
  t.mock.method(runtime.inventory,'publicHome',async()=>({sections:[]}));
  t.mock.method(runtime.media,'publicRead',async()=>Buffer.from('traffic-limit-test-media'));
  return {...runtime,authRequests,list,query,getSession};
}

function limited(response:{statusCode:number;headers:Record<string,unknown>;json:()=>unknown},max=120) {
  assert.equal(response.statusCode,429);
  assert.equal(response.headers['x-ratelimit-limit'],String(max));
  assert.equal(response.headers['retry-after'],'60');
  const problem=ApiErrorSchema.parse(response.json());
  assert.equal(problem.error.code,'RATE_LIMITED');
  assert.equal(problem.error.retryable,true);
}

test('all media IDs, thumbnails and HEAD share 120 requests without exhausting JSON, admin, health or auth',async t=>{
  const {app}=await setup(t);
  for(let count=0;count<120;count++) {
    const response=await app.inject({method:count%3===0?'HEAD':'GET',remoteAddress:visitor,
      url:`/api/v1/media/${ids[count%2]}${count%2?'?variant=thumb':''}`});
    assert.equal(response.statusCode,200);
  }
  for(const id of ids) for(const variant of ['','?variant=thumb']) {
    limited(await app.inject({method:'GET',url:`/api/v1/media/${id}${variant}`,remoteAddress:visitor}));
    // HEAD has no JSON body, but must still receive the same exhausted budget.
    const head=await app.inject({method:'HEAD',url:`/api/v1/media/${id}${variant}`,remoteAddress:visitor});
    assert.equal(head.statusCode,429);assert.equal(head.headers['retry-after'],'60');
  }
  for(const url of ['/api/v1/vehicles','/health/live','/api/v1/admin/me']) {
    const response=await app.inject({method:'GET',url,remoteAddress:visitor,headers:{cookie:staffCookie}});
    assert.equal(response.statusCode,200);assert.equal(response.headers['x-ratelimit-remaining'],'119');
  }
  for(let count=0;count<30;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/auth/not-exposed',remoteAddress:visitor})).statusCode,404);
  }
  limited(await app.inject({method:'GET',url:'/api/auth/not-exposed',remoteAddress:visitor}),30);
});

test('JSON routes and query changes share one budget while health and admin remain available',async t=>{
  const {app}=await setup(t);
  const urls=['/api/v1/vehicles?locale=zh','/api/v1/vehicle-filters?locale=en',
    '/api/v1/home/vehicles?locale=ru',`/api/v1/vehicles/${ids[0]}?locale=zh`];
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:urls[count%urls.length]!,remoteAddress:visitor})).statusCode,200);
  }
  for(const url of [...urls,'/api/v1/vehicles?page=2&q=changed']) {
    limited(await app.inject({method:'GET',url,remoteAddress:visitor}));
  }
  for(const url of ['/health/live','/api/v1/admin/me']) {
    const response=await app.inject({method:'GET',url,remoteAddress:visitor,headers:{cookie:staffCookie}});
    assert.equal(response.statusCode,200);assert.equal(response.headers['x-ratelimit-remaining'],'119');
  }
});

test('health probes share a bounded quota and do not consume business requests',async t=>{
  const {app}=await setup(t);
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:count%2?'/health/live':'/health/ready',remoteAddress:visitor})).statusCode,200);
  }
  for(const url of ['/health/live','/health/ready']) limited(await app.inject({method:'GET',url,remoteAddress:visitor}));
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor})).statusCode,200);
  }
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor}));
  for(const url of [`/api/v1/media/${ids[0]}`,'/api/v1/admin/me']) {
    const response=await app.inject({method:'GET',url,remoteAddress:visitor,headers:{cookie:staffCookie}});
    assert.equal(response.statusCode,200);assert.equal(response.headers['x-ratelimit-remaining'],'119');
  }
});

test('admin has a separate bounded budget and still rejects requests without a staff session',async t=>{
  const {app,query,getSession}=await setup(t);
  const unauthorized=await app.inject({method:'GET',url:'/api/v1/admin/me',remoteAddress:secondVisitor});
  assert.equal(unauthorized.statusCode,401);
  assert.equal(ApiErrorSchema.parse(unauthorized.json()).error.code,'UNAUTHENTICATED');
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/admin/me',remoteAddress:visitor,headers:{cookie:staffCookie}})).statusCode,200);
  }
  const sessionCalls=getSession.mock.callCount();
  const roleQueries=query.mock.callCount();
  assert.equal(sessionCalls,121);assert.equal(roleQueries,120);
  for(const url of ['/api/v1/admin/me','/api/v1/admin/vehicles','/api/v1/admin/vehicle-filters']) {
    limited(await app.inject({method:'GET',url,remoteAddress:visitor,headers:{cookie:staffCookie}}));
  }
  assert.equal(getSession.mock.callCount(),sessionCalls);
  assert.equal(query.mock.callCount(),roleQueries);
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor})).statusCode,200);
  }
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor}));
});

test('unauthenticated admin requests exhaust the same quota before additional session or role lookups',async t=>{
  const {app,query,getSession}=await setup(t);
  for(let count=0;count<120;count++) {
    const response=await app.inject({method:'GET',url:'/api/v1/admin/me',remoteAddress:visitor});
    assert.equal(response.statusCode,401);
    assert.equal(ApiErrorSchema.parse(response.json()).error.code,'UNAUTHENTICATED');
  }
  assert.equal(getSession.mock.callCount(),120);assert.equal(query.mock.callCount(),0);
  limited(await app.inject({method:'GET',url:'/api/v1/admin/me',remoteAddress:visitor}));
  // Adding a valid staff cookie or changing routes cannot escape the exhausted IP bucket.
  limited(await app.inject({method:'GET',url:'/api/v1/admin/vehicles',remoteAddress:visitor,headers:{cookie:staffCookie}}));
  assert.equal(getSession.mock.callCount(),120);assert.equal(query.mock.callCount(),0);
});

test('admin authentication and Origin checks reject uploads before an oversized body is parsed',async t=>{
  const {app,media}=await setup(t);
  const upload=t.mock.method(media,'upload',async()=>{throw new Error('A rejected upload must not reach the media service.');});
  const payload=Buffer.alloc(10*1024*1024+1);
  const url=`/api/v1/admin/media/${ids[0]}/content`;
  const headers={'content-type':'image/webp','if-match':'1'};
  const unauthenticated=await app.inject({method:'PUT',url,remoteAddress:visitor,payload,
    headers:{...headers,origin:'http://127.0.0.1:3318'}});
  assert.equal(unauthenticated.statusCode,401);
  assert.equal(ApiErrorSchema.parse(unauthenticated.json()).error.code,'UNAUTHENTICATED');
  for(const origin of [undefined,'https://untrusted.example.invalid']) {
    const forbidden=await app.inject({method:'PUT',url,remoteAddress:visitor,payload,
      headers:{...headers,cookie:staffCookie,...(origin?{origin}:{})}});
    assert.equal(forbidden.statusCode,403);
    assert.equal(ApiErrorSchema.parse(forbidden.json()).error.code,'FORBIDDEN');
  }
  // The same payload really exceeds the parser limit once access checks succeed.
  const oversized=await app.inject({method:'PUT',url,remoteAddress:visitor,payload,
    headers:{...headers,cookie:staffCookie,origin:'http://127.0.0.1:3318'}});
  assert.equal(oversized.statusCode,413);
  assert.equal(ApiErrorSchema.parse(oversized.json()).error.code,'PAYLOAD_TOO_LARGE');
  assert.equal(upload.mock.callCount(),0);
});

test('trusted proxy and web peers preserve separate visitors and share the same visitor budget',async t=>{
  const {app}=await setup(t,`${proxy}/32,${web}/32`);
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:count%2?web:proxy,
      headers:{'x-forwarded-for':visitor}})).statusCode,200);
  }
  for(const peer of [proxy,web]) {
    limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:peer,headers:{'x-forwarded-for':visitor}}));
    const other=await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:peer,headers:{'x-forwarded-for':secondVisitor}});
    assert.equal(other.statusCode,200);
    assert.equal(other.headers['x-ratelimit-remaining'],peer===proxy?'119':'118');
  }
});

test('untrusted peers and spoofed headers cannot create fresh visitor quotas',async t=>{
  const {app,authRequests}=await setup(t,`${proxy}/32,${web}/32`);
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor,
      headers:{'x-forwarded-for':`203.0.113.${count+1}`,'x-hd-visitor-ip':`203.0.113.${count+1}`,
        'x-hd-client-ip':`203.0.113.${count+1}`}})).statusCode,200);
  }
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor,
    headers:{'x-forwarded-for':secondVisitor,'x-hd-visitor-ip':secondVisitor,'x-hd-client-ip':secondVisitor}}));
  // No forwarding chain means even a trusted service uses its own bounded peer quota.
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:web,
      headers:{'x-hd-visitor-ip':`203.0.113.${count+1}`}})).statusCode,200);
  }
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:web,
    headers:{'x-hd-visitor-ip':secondVisitor}}));
  const session=await app.inject({method:'GET',url:'/api/auth/get-session',remoteAddress:visitor,
    headers:{'x-forwarded-for':secondVisitor,'x-hd-client-ip':secondVisitor}});
  assert.equal(session.statusCode,200);
  assert.equal(authRequests[0]?.headers.get('x-hd-client-ip'),visitor);
  const trustedSession=await app.inject({method:'GET',url:'/api/auth/get-session',remoteAddress:web,
    headers:{'x-forwarded-for':secondVisitor,'x-hd-client-ip':'203.0.113.222'}});
  assert.equal(trustedSession.statusCode,200);
  assert.equal(authRequests[1]?.headers.get('x-hd-client-ip'),secondVisitor);
});

test('a forged left-hand forwarding chain cannot bypass the nearest untrusted visitor',async t=>{
  const {app}=await setup(t,`${proxy}/32,${web}/32`);
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:proxy,
      headers:{'x-forwarded-for':`203.0.113.${count+1}, ${web}, ${visitor}`}})).statusCode,200);
  }
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:web,
    headers:{'x-forwarded-for':`${secondVisitor}, ${proxy}, ${visitor}`}}));
  const other=await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:proxy,
    headers:{'x-forwarded-for':secondVisitor}});
  assert.equal(other.statusCode,200);assert.equal(other.headers['x-ratelimit-remaining'],'119');
});

test('IPv4 mapped addresses and IPv6 addresses in one /64 retain normalized quotas',async t=>{
  const {app}=await setup(t,`${proxy}/32,${web}/32`);
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:proxy,
      headers:{'x-forwarded-for':count%2?visitor:`::ffff:${visitor}`}})).statusCode,200);
  }
  for(const ip of [visitor,`::ffff:${visitor}`]) {
    limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:web,headers:{'x-forwarded-for':ip}}));
  }
  for(let count=0;count<120;count++) {
    assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:proxy,
      headers:{'x-forwarded-for':`2001:db8:1:2::${(count+1).toString(16)}`}})).statusCode,200);
  }
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:web,
    headers:{'x-forwarded-for':'2001:db8:1:2:ffff:ffff:ffff:ffff'}}));
  const adjacent=await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:web,
    headers:{'x-forwarded-for':'2001:db8:1:3::1'}});
  assert.equal(adjacent.statusCode,200);assert.equal(adjacent.headers['x-ratelimit-remaining'],'119');
});

test('malformed and scoped resolved IPs are rejected before business or auth handlers',async t=>{
  const {app,list,authRequests}=await setup(t,`${proxy}/32,${web}/32`);
  for(const ip of ['not-an-ip','198.51.100.51:443','fe80::1%eth0']) {
    for(const url of ['/api/v1/vehicles','/api/auth/get-session']) {
      const response=await app.inject({method:'GET',url,remoteAddress:proxy,headers:{'x-forwarded-for':ip}});
      assert.equal(response.statusCode,400);
      assert.equal(ApiErrorSchema.parse(response.json()).error.code,'INVALID_REQUEST');
    }
  }
  assert.equal(list.mock.callCount(),0);assert.equal(authRequests.length,0);
});
