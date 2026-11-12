import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { SsrOriginLimiter } from './ssr-service.js';

const secret='synthetic-only-ssr-service-secret-123456789';
test('SSR origin is a bounded 30/s token bucket with burst 40 and no waiting queue',()=>{
  let at=0;const limiter=new SsrOriginLimiter(()=>at);
  for(let i=0;i<40;i++)assert.equal(limiter.take(),true);
  assert.equal(limiter.take(),false);at+=1000;
  for(let i=0;i<30;i++)assert.equal(limiter.take(),true);
  assert.equal(limiter.take(),false);at+=100000;
  for(let i=0;i<40;i++)assert.equal(limiter.take(),true);
  assert.equal(limiter.take(),false);
});
test('SSR credentials and actual socket peer are both required; forged public headers do not alter visitor limits',async()=>{
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',AUTH_SECRET:'a'.repeat(32),TRUST_PROXY:'192.0.2.10/32'});
  const runtime=await buildApp({...config,ssrService:{secret,peers:['192.0.2.10/32']}});
  const app=runtime.app;
  try {
    const internal='/internal/public-catalog/vehicles?locale=invalid';
    for(const options of [{remoteAddress:'192.0.2.10'},
      {remoteAddress:'192.0.2.10',headers:{'x-hd-ssr-key':'forged-secret-which-is-long-enough'}},
      {remoteAddress:'198.51.100.9',headers:{'x-hd-ssr-key':secret,'x-forwarded-for':'192.0.2.10'}}])
      assert.equal((await app.inject({url:internal,...options})).statusCode,404);
    for(const peer of ['192.0.2.10','::ffff:192.0.2.10'])
      assert.equal((await app.inject({url:internal,remoteAddress:peer,headers:{'x-hd-ssr-key':secret}})).statusCode,400);
    for(let i=0;i<120;i++)assert.equal((await app.inject({url:'/api/v1/vehicles?locale=invalid',remoteAddress:'198.51.100.20',headers:{'x-hd-ssr-key':secret}})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/vehicles?locale=invalid',remoteAddress:'198.51.100.20',headers:{'x-hd-ssr-key':secret}})).statusCode,429);
    const version={url:'/internal/public-catalog/version?unexpected=1',remoteAddress:'192.0.2.10',headers:{'x-hd-ssr-key':secret,'x-forwarded-for':'198.51.100.30'}};
    for(let i=0;i<120;i++)assert.equal((await app.inject(version)).statusCode,400);
    assert.equal((await app.inject(version)).statusCode,429);
    assert.equal((await app.inject({...version,headers:{...version.headers,'x-forwarded-for':'198.51.100.31'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/internal/public-catalog/vehicles',remoteAddress:'192.0.2.10',headers:{'x-hd-ssr-key':secret},payload:{}})).statusCode,404);
  } finally {await app.close();}
});

test('real HTTP disconnect cancels an unneeded queued read while normal GET completion stays usable',async t=>{
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',AUTH_SECRET:'a'.repeat(32)});
  const runtime=await buildApp({...config,publicCache:{...config.publicCache,maxConcurrentLoads:1,maxQueuedLoads:1}});
  let release!:()=>void,started!:()=>void,secondRead!:()=>void,disconnected!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;}),start=new Promise<void>(resolve=>{started=resolve;});
  const second=new Promise<void>(resolve=>{secondRead=resolve;}),closed=new Promise<void>(resolve=>{disconnected=resolve;});
  let reads=0;const loads:string[]=[];
  t.mock.method(runtime.db.pool,'query',async()=>{if(++reads===2)secondRead();return {rows:[{epoch:'00000000-0000-4000-8000-000000000001',revision:'1'}],rowCount:1};});
  t.mock.method(runtime.inventory,'publicHome',async(locale:string)=>{loads.push(locale);if(locale==='en'){started();await blocked;}return {sections:[]};});
  runtime.app.server.on('request',(request,response)=>{if(request.url?.includes('locale=zh'))response.once('close',disconnected);});
  const origin=await runtime.app.listen({host:'127.0.0.1',port:0});
  try {
    const normal=fetch(`${origin}/api/v1/home/vehicles?locale=en`);await start;
    const controller=new AbortController();
    const abandoned=fetch(`${origin}/api/v1/home/vehicles?locale=zh`,{signal:controller.signal}).then(()=>{throw new Error('Expected cancellation');},()=>{});
    await second;await new Promise(resolve=>setImmediate(resolve));controller.abort();await abandoned;await closed;
    release();const response=await normal;assert.equal(response.status,200);await response.json();
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(loads,['en']);
    const next=await fetch(`${origin}/api/v1/home/vehicles?locale=ru`);assert.equal(next.status,200);await next.json();assert.deepEqual(loads,['en','ru']);
  }finally{release();await runtime.app.close();}
});
