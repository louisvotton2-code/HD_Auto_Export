import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ApiErrorSchema, type PublicVehicleQuery } from '@hd/contracts/public';
import { type MediaAsset } from '@hd/contracts/admin';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { ApiError } from './errors.js';

const start=Date.parse('2026-11-10T00:00:00Z');
const origin='http://127.0.0.1:3318';
const visitor='198.51.100.61',otherVisitor='198.51.100.62';
const proxy='192.0.2.10',web='192.0.2.11';
const cookie='hd-auto.session_token=auth-rate-test-session';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const staffHeaders={cookie,origin};
const asset:MediaAsset={id:ids[0]!,vehicleId:ids[1]!,version:1,status:'uploaded',contentType:'image/webp',
  rights:{basis:'owned',note:'Synthetic test image'},sizeBytes:4,width:1,height:1,
  previewPath:`/api/v1/admin/media/${ids[0]}/preview`,createdAt:new Date(start).toISOString()};
type Runtime=Awaited<ReturnType<typeof buildApp>>;
type HttpResponse={statusCode:number;headers:Record<string,unknown>;json:()=>unknown};

// Real HTTP hooks, route matching, Origin checks and IP resolution; no socket,
// database or translation provider is used. Only business dependencies are replaced.
async function setup(t:TestContext,trustProxy='false') {
  t.mock.timers.enable({apis:['Date'],now:start});
  const runtime=await buildApp(readConfig({NODE_ENV:'test',
    DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/hd_ext_auth_rate_test',
    AUTH_SECRET:'auth-rate-tests-placeholder-not-a-live-secret',TRUST_PROXY:trustProxy,
    EXTERNAL_CATALOG_MODE:'synthetic'}));
  t.after(()=>runtime.app.close());
  t.mock.method(runtime.db.pool,'connect',()=>{throw new Error('This test must not connect to a database.');});
  t.mock.method(runtime.db.pool,'query',async(sql:unknown)=>{
    assert.equal(sql,'SELECT id,name,role,banned FROM staff WHERE id=$1');
    return {rows:[{id:'auth-rate-test-staff',name:'Test admin',role:'admin',banned:false}],rowCount:1};
  });
  const sessions=t.mock.method(runtime.auth.api,'getSession',async(options:{headers?:HeadersInit})=>{
    if(new Headers(options.headers).get('cookie')!==cookie)return null;
    return {user:{id:'auth-rate-test-staff'},session:{id:'auth-rate-test-session'}};
  });
  const authRequests:Request[]=[];
  t.mock.method(runtime.auth,'handler',async(request:Request)=>{
    authRequests.push(request);
    return request.url.includes('/sign-in/email')
      ?new Response(JSON.stringify({code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid credentials.'}),{status:401,headers:{'content-type':'application/json'}})
      :new Response('null',{headers:{'content-type':'application/json'}});
  });
  const create=t.mock.method(runtime.media,'create',async()=>({media:asset,method:'PUT' as const,
    uploadUrl:`/api/v1/admin/media/${asset.id}/content`,expiresAt:new Date(start+600_000).toISOString()}));
  const upload=t.mock.method(runtime.media,'upload',async()=>asset);
  const complete=t.mock.method(runtime.media,'complete',async()=>asset);
  t.mock.method(runtime.media,'get',async()=>asset);
  t.mock.method(runtime.media,'preview',async()=>Buffer.from('test-preview'));
  t.mock.method(runtime.media,'publicRead',async()=>Buffer.from('test-public'));
  t.mock.method(runtime.media,'remove',async()=>{});
  const translation=t.mock.method(runtime.inventory,'translationSuggestions',async()=>{
    throw new ApiError(503,'SERVICE_UNAVAILABLE','Synthetic translation dependency unavailable.',undefined,true);
  });
  const displayTranslation=t.mock.method(runtime.inventory,'displayTranslationSuggestions',async()=>{
    throw new ApiError(503,'SERVICE_UNAVAILABLE','Synthetic translation dependency unavailable.',undefined,true);
  });
  t.mock.method(runtime.inventory,'listPublic',async(query:PublicVehicleQuery,requestId:string)=>({
    data:{items:[],page:query.page,pageSize:query.pageSize,hasMore:false},
    meta:{requestId,catalog:'curated' as const,total:0,totalKind:'exact' as const,accessibleTotal:0,
      dataAsOf:new Date(start).toISOString(),freshness:'fresh' as const},
  }));
  return {...runtime,authRequests,sessions,create,upload,complete,translation,displayTranslation};
}
function limited(response:HttpResponse,retry:string|null='60',max?:number) {
  assert.equal(response.statusCode,429);
  if(retry!==null)assert.equal(response.headers['retry-after'],retry);
  else {
    assert.match(String(response.headers['retry-after']),/^[1-9]\d*$/);
    assert.ok(Number(response.headers['retry-after'])<=60);
  }
  if(max!==undefined)assert.equal(response.headers['x-ratelimit-limit'],String(max));
  const problem=ApiErrorSchema.parse(response.json());
  assert.deepEqual(problem.error,{code:'RATE_LIMITED',message:'Request rate exceeded.',retryable:true});
  return problem.error;
}
const login=(app:Runtime['app'],email:string,remoteAddress=visitor,headers:Record<string,string>={origin})=>
  app.inject({method:'POST',url:'/api/auth/sign-in/email',remoteAddress,headers,payload:{email,password:'synthetic-wrong-password'}});
function uploadRequest(app:Runtime['app'],index:number,remoteAddress=visitor) {
  const id=ids[index%ids.length]!;
  if(index%3===0)return app.inject({method:'POST',url:'/api/v1/admin/media/uploads',remoteAddress,headers:staffHeaders,
    payload:{vehicleId:id,contentType:'image/webp',rights:asset.rights,sizeBytes:4}});
  if(index%3===1)return app.inject({method:'PUT',url:`/api/v1/admin/media/${id}/content`,remoteAddress,
    headers:{...staffHeaders,'content-type':'image/webp','if-match':'1'},payload:Buffer.from('test')});
  return app.inject({method:'POST',url:`/api/v1/admin/media/${id}/complete`,remoteAddress,headers:staffHeaders,payload:{version:1}});
}
function translationRequest(app:Runtime['app'],index:number,remoteAddress=visitor) {
  return app.inject({method:'POST',url:`/api/v1/admin/vehicles/${ids[index%ids.length]}/${index%2?'localization/':''}translation-suggestions`,
    remoteAddress,headers:{...staffHeaders,'idempotency-key':`auth-rate-test-${index}`},
    payload:index%2?{vehicleVersion:1,revision:0,refs:['make']}:{version:1}});
}
const trial=(app:Runtime['app'],index:number)=>app.inject({method:'POST',
  url:`/api/v1/admin/external/batches/${ids[index%ids.length]}/translation-trial`,
  remoteAddress:visitor,headers:staffHeaders,payload:{}});

test('email login has one case-insensitive five-attempt budget across IPs with a generic bounded retry',async t=>{
  const {app,authRequests}=await setup(t);
  for(let n=0;n<5;n++){
    const response=await login(app,n%2?'STAFF@EXAMPLE.INVALID':'staff@example.invalid',`198.51.100.${n+1}`);
    assert.equal(response.statusCode,401);
    assert.deepEqual(response.json(),{code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid credentials.'});
  }
  const expected=limited(await login(app,'Staff@Example.Invalid',otherVisitor),null);
  assert.equal(authRequests.length,5);
  assert.equal((await authRequests[1]!.clone().json()).email,'STAFF@EXAMPLE.INVALID');
  // No lookup of whether a different account exists is involved in throttling.
  for(let n=0;n<5;n++)assert.equal((await login(app,'absent@example.invalid',`203.0.113.${n+1}`)).statusCode,401);
  assert.deepEqual(limited(await login(app,'ABSENT@example.invalid',otherVisitor),null),expected);
  // The account limiter uses monotonic time. Its injected-clock unit tests
  // cover exact expiry; mocked wall time here belongs only to Fastify's IP store.
  limited(await login(app,'staff@example.invalid','203.0.113.70'),null);
  assert.equal(authRequests.length,10);
});

test('untrusted or missing Origin consumes no email budget and exhausted email does not block other auth routes',async t=>{
  const {app,authRequests}=await setup(t);
  for(let n=0;n<6;n++) {
    const response=await login(app,'origin@example.invalid',`198.51.100.${n+1}`,n%2?{}:{origin:'https://untrusted.example.invalid'});
    assert.equal(response.statusCode,403);assert.equal(response.json().code,'INVALID_ORIGIN');
  }
  assert.equal(authRequests.length,0);
  for(let n=0;n<5;n++)assert.equal((await login(app,'origin@example.invalid',visitor)).statusCode,401);
  limited(await login(app,'origin@example.invalid',visitor),null);
  for(const [method,url] of [['GET','/api/auth/get-session'],['POST','/api/auth/sign-out']] as const) {
    const response=await app.inject({method,url,remoteAddress:visitor,headers:{origin},...(method==='POST'?{payload:{}}:{})});
    assert.equal(response.statusCode,200);
  }
  assert.equal((await app.inject({method:'POST',url:'/api/auth/sign-up/email',remoteAddress:visitor,headers:{origin},payload:{}})).statusCode,404);
  assert.equal(authRequests.length,7);
});

test('spoofed forwarding headers cannot evade the existing thirty-per-IP auth limit',async t=>{
  const {app,authRequests}=await setup(t,`${proxy}/32,${web}/32`);
  for(let n=0;n<30;n++)assert.equal((await login(app,`unique-${n}@example.invalid`,visitor,
    {origin,'x-forwarded-for':`203.0.113.${n+1}`,'x-hd-client-ip':`203.0.113.${n+1}`})).statusCode,401);
  t.mock.timers.setTime(start+7_001);
  limited(await login(app,'fresh@example.invalid',visitor,{origin,'x-forwarded-for':otherVisitor}),'53',30);
  assert.equal(authRequests.length,30);
  assert.ok(authRequests.every(request=>request.headers.get('x-hd-client-ip')===visitor));
  assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/admin/me',remoteAddress:visitor,headers:staffHeaders})).statusCode,200);
});

test('trusted proxy and web hops use the resolved visitor while fake left-hand hops cannot split its quota',async t=>{
  const {app,authRequests}=await setup(t,`${proxy}/32,${web}/32`);
  for(let n=0;n<30;n++)assert.equal((await login(app,`proxy-${n}@example.invalid`,n%2?web:proxy,
    {origin,'x-forwarded-for':`203.0.113.${n+1}, ${visitor}`,'x-hd-client-ip':'203.0.113.250'})).statusCode,401);
  limited(await login(app,'new-proxy@example.invalid',web,{origin,'x-forwarded-for':visitor}),'60',30);
  assert.ok(authRequests.every(request=>request.headers.get('x-hd-client-ip')===visitor));
  assert.equal((await login(app,'other-proxy@example.invalid',proxy,{origin,'x-forwarded-for':otherVisitor})).statusCode,401);
  assert.equal(authRequests.at(-1)?.headers.get('x-hd-client-ip'),otherVisitor);
});

test('upload creation, bytes and completion share 120 requests across IDs without consuming other buckets',async t=>{
  const runtime=await setup(t),{app}=runtime;
  for(let n=0;n<120;n++)assert.equal((await uploadRequest(app,n)).statusCode,n%3===0?201:200);
  const sessionCalls=runtime.sessions.mock.callCount();
  for(let n=0;n<6;n++)limited(await uploadRequest(app,n),'60',120);
  assert.equal(runtime.sessions.mock.callCount(),sessionCalls);
  assert.equal(runtime.create.mock.callCount(),40);assert.equal(runtime.upload.mock.callCount(),40);assert.equal(runtime.complete.mock.callCount(),40);
  for(const url of ['/api/v1/admin/me',`/api/v1/admin/media/${ids[0]}`,`/api/v1/admin/media/${ids[0]}/preview`]) {
    assert.equal((await app.inject({method:'GET',url,remoteAddress:visitor,headers:staffHeaders})).statusCode,200);
  }
  assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/media/${ids[0]}`,remoteAddress:visitor})).statusCode,200);
  assert.equal((await translationRequest(app,0)).statusCode,503);
  assert.equal((await trial(app,0)).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/sign-out',remoteAddress:visitor,headers:{origin},payload:{}})).statusCode,200);
  t.mock.timers.setTime(start+12_345);
  limited(await uploadRequest(app,0),'48',120);
  t.mock.timers.setTime(start+60_345);
  assert.equal((await uploadRequest(app,0)).statusCode,201);
});

test('both ordinary translation routes share twenty requests and retain the real trial six-request bucket',async t=>{
  const runtime=await setup(t),{app}=runtime;
  for(let n=0;n<20;n++)assert.equal((await translationRequest(app,n)).statusCode,503);
  const sessionCalls=runtime.sessions.mock.callCount();
  for(let n=20;n<24;n++)limited(await translationRequest(app,n),'60',20);
  assert.equal(runtime.sessions.mock.callCount(),sessionCalls);
  assert.equal(runtime.translation.mock.callCount(),10);assert.equal(runtime.displayTranslation.mock.callCount(),10);
  for(let n=0;n<6;n++)assert.equal((await trial(app,n)).statusCode,400);
  limited(await trial(app,6),'60',6);
  assert.equal((await uploadRequest(app,0)).statusCode,201);
  for(const url of ['/api/v1/admin/me',`/api/v1/admin/media/${ids[0]}/preview`])assert.equal((await app.inject({method:'GET',url,remoteAddress:visitor,headers:staffHeaders})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor})).statusCode,200);
  t.mock.timers.setTime(start+10_001);
  limited(await translationRequest(app,0),'50',20);
  t.mock.timers.setTime(start+60_001);
  assert.equal((await translationRequest(app,0)).statusCode,503);
});

test('ordinary admin/preview and public budgets can exhaust without consuming upload or translation quota',async t=>{
  const {app}=await setup(t);
  for(let n=0;n<120;n++)assert.equal((await app.inject({method:'GET',remoteAddress:visitor,headers:staffHeaders,
    url:n%2?`/api/v1/admin/media/${ids[n%2]}/preview`:'/api/v1/admin/me'})).statusCode,200);
  for(const url of ['/api/v1/admin/me',`/api/v1/admin/media/${ids[0]}/preview`,`/api/v1/admin/media/${ids[0]}`])
    limited(await app.inject({method:'GET',url,remoteAddress:visitor,headers:staffHeaders}),'60',120);
  for(let n=0;n<120;n++)assert.equal((await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor})).statusCode,200);
  limited(await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:visitor}),'60',120);
  assert.equal((await uploadRequest(app,0)).statusCode,201);
  assert.equal((await translationRequest(app,0)).statusCode,503);
  assert.equal((await trial(app,0)).statusCode,400);
});

test('new upload and translation buckets keep staff authentication and Origin checks before business work',async t=>{
  const runtime=await setup(t),{app}=runtime;
  for(const url of ['/api/v1/admin/media/uploads',`/api/v1/admin/vehicles/${ids[0]}/translation-suggestions`]) {
    const noSession=await app.inject({method:'POST',url,remoteAddress:visitor,headers:{origin},payload:{}});
    assert.equal(noSession.statusCode,401);assert.equal(ApiErrorSchema.parse(noSession.json()).error.code,'UNAUTHENTICATED');
    const noOrigin=await app.inject({method:'POST',url,remoteAddress:visitor,headers:{cookie},payload:{}});
    assert.equal(noOrigin.statusCode,403);assert.equal(ApiErrorSchema.parse(noOrigin.json()).error.code,'FORBIDDEN');
  }
  assert.equal(runtime.create.mock.callCount(),0);assert.equal(runtime.translation.mock.callCount(),0);
});
