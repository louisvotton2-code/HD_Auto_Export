import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FullSyncClient,retryAfter} from './full-sync/client.js';
import {parseAlias} from './full-sync/apply.js';
test('full bulk starts at 500 and persists halves after timeout and response size failure',async()=>{
 const requests:number[]=[],ids=Array.from({length:500},(_,i)=>String(i+1));let failed=false;
 const client=new FullSyncClient('synthetic-key',{wait:async()=>{},fetch:async(_url,init)=>{
  assert.equal(init!.redirect,'error');const requested=(JSON.parse(String(init!.body)) as {ids:string[]}).ids;requests.push(requested.length);
  if(requested.length===500)return new Response('',{status:413});if(requested.length===250&&!failed){failed=true;throw new Error('simulated timeout');}
  return Response.json({results:requested.map(id=>({id,source:'che168',unknown:{preserved:true}})),notFound:[]});
 }});
 const returned:string[]=[];for await(const result of client.bulk('che168',ids,'en')){returned.push(...result.results.map(r=>r.id));assert.match(result.rawResponse.body,/unknown/);}
 assert.deepEqual(requests,[500,250,125,125,250]);assert.deepEqual(returned,ids);
});
test('retry-after supports date and numeric, preserves 429 delay and never retries arbitrary origins',async()=>{
 assert.equal(retryAfter('10',0),10000);assert.equal(retryAfter('Thu, 01 Jan 1970 00:01:00 GMT',0),60000);
 let defer=0;const client=new FullSyncClient('synthetic-key',{wait:async()=>{},defer:async ms=>{defer=ms;},fetch:async(url,init)=>{assert.equal(new URL(String(url)).origin,'https://api.chinacarapi.com');assert.equal(init!.redirect,'error');return new Response('',{status:429,headers:{'retry-after':'120'}});}});
 await assert.rejects(client.changes('2026-11-14T00:00:00.000Z',null),/SYNC_RATE_LIMITED/);assert.equal(defer,120000);
});
test('full feed asks 2000 and rejects cursor rollback without accepting a page',async()=>{
 const client=new FullSyncClient('synthetic-key',{wait:async()=>{},fetch:async url=>{assert.equal(new URL(String(url)).searchParams.get('limit'),'2000');return Response.json({cursor:99,nextCursor:100,hasMore:false,changes:[]});}});
 await assert.rejects(client.changes('2026-11-14T00:00:00.000Z','100'),/SYNC_CURSOR_INVALID/);
});
test('alias parser only accepts provider identity evidence',()=>{
 assert.deepEqual(parseAlias('dongchedi:123'),{source:'dongchedi',id:'123'});assert.deepEqual(parseAlias('che168/456'),{source:'che168',id:'456'});assert.equal(parseAlias('https://evil.example'),null);assert.equal(parseAlias('123'),null);
});

import {checkBulkQuota,syncAccount} from './full-sync/quota.js';
test('all documented accounts are recognized and quota/expiration still bound every bulk reservation',()=>{
 const now=new Date('2026-11-15T12:00:00.000Z'),base={product:'chinacarapi',plan:'starter',sources:['che168'],expiresAt:'2026-11-16T00:00:00.000Z',dailyLimit:1200,remainingToday:700};
 for(const plan of ['sandbox','trial','starter','business','scale','internal'])assert.equal(syncAccount({...base,plan},now).plan,plan);
 assert.throws(()=>syncAccount({...base,plan:'unknown'},now),/SYNC_ACCOUNT_INVALID/);
 const request={account:base,checkedAt:now,day:'2026-11-15',used:600,reservedSinceCheck:100,requested:500,source:'che168' as const};
 assert.deepEqual(checkBulkQuota(request,now),{day:'2026-11-15',used:1100,reserved:600});
 assert.throws(()=>checkBulkQuota({...request,used:701},now),/SYNC_ACCOUNT_DAILY_LIMIT/);
 assert.throws(()=>checkBulkQuota({...request,reservedSinceCheck:201},now),/SYNC_ACCOUNT_DAILY_LIMIT/);
 assert.throws(()=>checkBulkQuota({...request,account:{...base,remainingToday:0}},now),/SYNC_ACCOUNT_DAILY_LIMIT/);
 assert.throws(()=>checkBulkQuota({...request,checkedAt:'2026-11-14T23:59:59.000Z'},now),/SYNC_ACCOUNT_REFRESH_REQUIRED/);
 assert.throws(()=>checkBulkQuota({...request,account:{...base,expiresAt:now.toISOString()}},now),/SYNC_ACCOUNT_EXPIRED/);
 assert.throws(()=>checkBulkQuota({...request,source:'dongchedi'},now),/SYNC_SOURCE_FORBIDDEN/);
});
