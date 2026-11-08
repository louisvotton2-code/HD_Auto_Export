import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiErrorSchema } from '@hd/contracts/public';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { ApiError } from './errors.js';

// These requests run through the real HTTP hooks without opening a socket or database connection.
const config=readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
  AUTH_SECRET:'rate-limit-test-placeholder-not-a-live-secret'});
const start=Date.parse('2026-11-08T00:00:00Z');

test('a 120/min bucket retains the actual remaining Retry-After and allows requests after that wait',async t=>{
  t.mock.timers.enable({apis:['Date'],now:start});
  const {app}=await buildApp(config);t.after(()=>app.close());
  const request=()=>app.inject({method:'GET',url:'/health/live',remoteAddress:'198.51.100.41'});
  for(let count=0;count<120;count++) assert.equal((await request()).statusCode,200);
  const limited=await request();assert.equal(limited.statusCode,429);
  assert.equal(limited.headers['retry-after'],'60');
  assert.equal(limited.headers['x-ratelimit-limit'],'120');
  assert.equal(limited.headers['x-ratelimit-remaining'],'0');
  const problem=ApiErrorSchema.parse(limited.json());assert.equal(problem.error.code,'RATE_LIMITED');assert.equal(problem.error.retryable,true);
  t.mock.timers.setTime(start+12_345);
  const remaining=await request();assert.equal(remaining.statusCode,429);
  assert.equal(remaining.headers['retry-after'],'48');
  assert.equal(remaining.headers['retry-after'],remaining.headers['x-ratelimit-reset']);
  t.mock.timers.setTime(Date.now()+Number(remaining.headers['retry-after'])*1000);
  const recovered=await request();assert.equal(recovered.statusCode,200);assert.equal(recovered.headers['retry-after'],undefined);
});

test('authentication route keeps its 30/min limit and remaining Retry-After',async t=>{
  t.mock.timers.enable({apis:['Date'],now:start});
  const {app}=await buildApp(config);t.after(()=>app.close());
  // An unexposed auth path exercises the route limiter without accessing staff sessions.
  const request=()=>app.inject({method:'GET',url:'/api/auth/not-exposed',remoteAddress:'198.51.100.42'});
  for(let count=0;count<30;count++) assert.equal((await request()).statusCode,404);
  t.mock.timers.setTime(start+7_001);
  const limited=await request();assert.equal(limited.statusCode,429);
  assert.equal(limited.headers['x-ratelimit-limit'],'30');assert.equal(limited.headers['retry-after'],'53');
  assert.equal(limited.headers['retry-after'],limited.headers['x-ratelimit-reset']);
});

test('429 without a supplied retry header falls back to a full minute; 503 retains its five-second fallback',async t=>{
  const {app,inventory}=await buildApp(config);t.after(()=>app.close());
  const method=t.mock.method(inventory,'listPublic',async()=>{throw new ApiError(429,'RATE_LIMITED','Test rate limit.',undefined,true);});
  const limited=await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:'198.51.100.43'});
  assert.equal(limited.statusCode,429);assert.equal(limited.headers['retry-after'],'60');ApiErrorSchema.parse(limited.json());
  method.mock.mockImplementation(async()=>{throw new ApiError(503,'SERVICE_UNAVAILABLE','Test unavailable dependency.',undefined,true);});
  const unavailable=await app.inject({method:'GET',url:'/api/v1/vehicles',remoteAddress:'198.51.100.43'});
  assert.equal(unavailable.statusCode,503);assert.equal(unavailable.headers['retry-after'],'5');ApiErrorSchema.parse(unavailable.json());
});
