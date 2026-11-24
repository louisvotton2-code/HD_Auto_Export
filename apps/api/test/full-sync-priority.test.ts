import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {FullSyncWorker,configureFullSync} from '../src/external/full-sync/engine.js';
import type {DetailMaterializationObservation} from '../src/external/full-sync/materialization-log.js';
import type {FullSyncClient} from '../src/external/full-sync/client.js';
import {FullSyncError} from '../src/external/full-sync/types.js';
import type {Change,Source} from '../src/external/full-sync/types.js';
import {fullSyncTimings,recordDetailTiming,recordWithdrawalTiming} from '../src/external/full-sync/timing.js';
import {ExternalStore} from '../src/external/store.js';
import {InventoryService} from '../src/vehicles/service.js';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {randomUUID} from 'node:crypto';
import {ExternalSyncTimingsSchema} from '@hd/contracts/admin';

test('sync priority, fairness and five-stage observations persist without confusing queued work with publication',async t=>{
 const forbidden=mock.method(globalThis,'fetch',async()=>{throw new Error('No external calls in isolated sync test');});
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)throw new Error('Isolated loopback maintenance DB required');
 const maintenance=createDatabase(url.toString(),1),name=`hd_sync_priority_${randomBytes(8).toString('hex')}`,directory=await mkdtemp(path.join(tmpdir(),'hd-sync-priority-'));
 let db:Database|undefined,worker:FullSyncWorker|undefined,created=false;
 const requests:string[]=[],at='2026-11-14T00:00:00.000Z';let feed:Change[]=[];
 const client={changes:async()=>{const payload={changes:feed,cursor:0,nextCursor:feed.at(-1)?.id??0,hasMore:false};const body=JSON.stringify(payload);return {...payload,rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};},
  bulk:async function*(source:Source,ids:string[]){requests.push(`${source}:${ids.join(',')}`);const body=JSON.stringify({results:[],notFound:[]});yield {results:[],notFound:[],rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};}
 } as unknown as FullSyncClient;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;db=createDatabase(url.toString(),2);const database=db;await migrateDatabase(database);
  await database.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('priority-admin','Test','priority@example.invalid','admin',false)");
  await configureFullSync(database,{id:'priority-admin',requestId:'test'},'continuous');
  worker=new FullSyncWorker(database,client,directory,async()=>{});assert.equal(await worker.acquire(),true);worker.space=async()=>({used:0,total:1e12,available:1e12});
  await t.test('a restart retains the fourth oldest-work turn despite continuously due urgent updates',async()=>{
   await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id) VALUES('che168','1001','priority:high'),('dongchedi','1002','priority:low')`);
   await database.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,queued_at) VALUES
    ('che168','1001','detail',1,100,now()),('dongchedi','1002','detail',1,0,now()-interval '2 hours')`);
   for(let i=0;i<3;i++)await worker!.details();
   assert.deepEqual(requests,Array(9).fill('che168:1001'));
   await worker!.close();worker=new FullSyncWorker(database,client,directory,async()=>{});assert.equal(await worker.acquire(),true);worker.space=async()=>({used:0,total:1e12,available:1e12});
   await worker.details();assert.deepEqual(requests.slice(9),Array(3).fill('dongchedi:1002'));
   assert.equal((await database.pool.query('SELECT detail_turn::text FROM external_full_sync')).rows[0].detail_turn,'4');
   await database.pool.query('DELETE FROM external_full_work');await database.pool.query('DELETE FROM external_full_members');
  });
  await t.test('known events get first slots while new admission has a bounded ten-slot floor',async()=>{
   await database.pool.query(`INSERT INTO external_formal_admissions(source,external_id) SELECT 'che168',(2000+g)::text FROM generate_series(1,100) g`);
   await database.pool.query('UPDATE external_formal_admission_state SET admitted_count=100 WHERE id=1');
   await database.pool.query('UPDATE external_full_sync SET since_at=$1 WHERE id=1',[at]);
   feed=[...Array.from({length:100},(_,i)=>({id:i+1,source:'che168' as const,vehicleId:String(2001+i),type:'price' as const,at})),
    ...Array.from({length:10},(_,i)=>({id:101+i,source:'dongchedi' as const,vehicleId:String(3001+i),type:'new' as const,at}))];
   await worker!.receiveDelta();
   const nextPoll=(await database.pool.query("SELECT next_delta_at>clock_timestamp() AS future,mod(extract(epoch FROM next_delta_at)::numeric,300)=0 AS aligned FROM external_full_sync")).rows[0];assert.deepEqual(nextPoll,{future:true,aligned:true});
   assert.equal(await worker!.applyEvents(),100);
   const applied=(await database.pool.query(`SELECT source_type,count(*)::int AS n FROM external_full_events WHERE applied_at IS NOT NULL GROUP BY source_type ORDER BY source_type`)).rows;
   assert.deepEqual(applied,[{source_type:'new',n:10},{source_type:'price',n:90}]);
   const priorities=(await database.pool.query(`SELECT priority,count(*)::int AS n FROM external_full_work GROUP BY priority ORDER BY priority`)).rows;
   assert.deepEqual(priorities,[{priority:50,n:100}]);
   const timings=ExternalSyncTimingsSchema.parse(await fullSyncTimings(database));
   assert.equal(timings.window.complete,false);assert.equal(timings.backlog.pendingEvents,10);assert.equal(timings.backlog.pendingWork,100);
   const prices=timings.metrics.find(m=>m.kind==='price')!;assert.equal(prices.received,100);assert.equal(prices.applied,90);assert.equal(prices.publicEffective,0);assert.equal(prices.incomplete,100);assert.equal(prices.p95ReceivedToPublicMs,null);
   assert.ok(timings.events.every(e=>e.detailUpdatedAt===null&&e.publicEffectiveAt===null));
   await database.pool.query("UPDATE external_full_work SET attempts=5 WHERE source='che168' AND external_id='2001'");
   assert.equal((await fullSyncTimings(database)).metrics.find(m=>m.kind==='price')!.failed,1);
  });
  await t.test('a later generation preserves waiting age and supersedes the old event without inventing completion',async()=>{
   await database.pool.query("UPDATE external_full_work SET queued_at=now()-interval '2 hours' WHERE source='che168' AND external_id='2001'");
   const before=(await database.pool.query("SELECT queued_at FROM external_full_work WHERE source='che168' AND external_id='2001'")).rows[0].queued_at;
   feed=[{id:111,source:'che168',vehicleId:'2001',type:'price',at:'2026-11-14T00:01:00.000Z'}];
   await worker!.receiveDelta();await worker!.applyEvents();
   const after=(await database.pool.query("SELECT queued_at,attempts FROM external_full_work WHERE source='che168' AND external_id='2001'")).rows[0];assert.deepEqual(after,{queued_at:before,attempts:0});
   assert.deepEqual((await database.pool.query('SELECT public_outcome,public_effective_at FROM external_full_events WHERE event_id=1')).rows[0],{public_outcome:'superseded',public_effective_at:null});
  });
  await t.test('a withdrawal bypasses failed detail and removes its job without pretending an unprojected vehicle was public',async()=>{
   feed=[{id:112,source:'che168',vehicleId:'2001',type:'removed',at:'2026-11-14T00:02:00.000Z'}];
   await worker!.receiveDelta();await worker!.applyEvents(true);
   assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM external_full_work WHERE source='che168' AND external_id='2001'")).rows[0].n,0);
   assert.deepEqual((await database.pool.query('SELECT public_outcome,public_effective_at FROM external_full_events WHERE event_id=112')).rows[0],{public_outcome:'not_public',public_effective_at:null});
  });
  await t.test('real price, withdrawal and relist projections record distinct stages while staff corrections survive',async ctx=>{
   await database.pool.query('DELETE FROM external_full_work');await worker!.close();
   let sourceAt='2026-11-14T01:00:00.000Z',price=70000;
   const projectionClient={...client,bulk:async function*(source:Source,ids:string[],locale:string){
    const results=ids.map(id=>({id,source,status:'active',updatedAt:sourceAt,url:`https://www.che168.com/dealer/1/${id}.html`,
     title:locale==='zh'?'合成时点测试':locale==='ru'?'Синтетическая проверка':'Synthetic timing test',
     make:{id:'fixture-make',name:'Example',nameZh:'示例'},model:{id:'fixture-model',name:'Model',nameZh:'测试车型'},
     price:{cny:price},modelYear:2024,mileageKm:10000,fuel:'Petrol',transmission:'Automatic',
     photos:['https://erscglobal2.autoimg.cn/synthetic-sync-timing.jpg'],hasInspectionReport:false}));
    const body=JSON.stringify({results,notFound:[]});yield {results,notFound:[],rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};
   }} as unknown as FullSyncClient;
   worker=new FullSyncWorker(database,projectionClient,directory);assert.equal(await worker.acquire(),true);worker.space=async()=>({used:0,total:1e12,available:1e12});
   const next=async(id:number,type:Change['type'],at:string,legacyKind=false)=>{sourceAt=at;feed=[{id,source:'che168',vehicleId:'9001',type,at}];await worker!.receiveDelta();if(legacyKind)await database.pool.query('UPDATE external_full_events SET source_type=NULL WHERE event_id=$1',[id]);await worker!.applyEvents();};
   const timeline=async(id:number)=>(await database.pool.query('SELECT applied_at,detail_updated_at,public_effective_at,public_outcome FROM external_full_events WHERE event_id=$1',[id])).rows[0]!;
   await next(1000,'new',sourceAt);assert.equal((await timeline(1000)).public_effective_at,null);await worker.details();
   const id=(await database.pool.query("SELECT id FROM external_listings WHERE provider='chinacarapi' AND external_id='9001'")).rows[0]!.id;
   const store=new ExternalStore(database),inventory=new InventoryService(database,true),current=await store.getListing(`ext-${id}`,'en');
   const overrides={hidden:false,facts:{mileageKm:9000},text:[{field:'title' as const,locale:'en' as const,text:'Staff title stays',sourceHash:current.sourceHashes.title!}]};
   await store.saveOverrides(`ext-${id}`,{version:current.version,overrides},randomUUID(),{id:'priority-admin',requestId:'override'});
   price=65000;await next(1001,'price','2026-11-14T01:01:00.000Z');const queued=await timeline(1001);assert.ok(queued.applied_at);assert.equal(queued.detail_updated_at,null);assert.equal(queued.public_effective_at,null);
   await worker.details();const effective=await timeline(1001);assert.equal(effective.public_outcome,'effective');assert.ok(effective.public_effective_at>=effective.detail_updated_at);assert.ok(effective.detail_updated_at>=effective.applied_at);
   const detail=await inventory.getPublic(`ext-${id}`,'en','localized');assert.equal(detail.price.money?.amount,'65000.00');assert.equal(detail.content.title.text,'Staff title stays');assert.equal(detail.facts.mileageKm,9000);
   assert.deepEqual((await store.getListing(`ext-${id}`,'en')).overrides,overrides);
   await worker.receiveDelta();assert.equal(await worker.applyEvents(),0);assert.deepEqual(await timeline(1001),effective);
   await next(1002,'price','2026-11-14T01:02:00.000Z');await worker.details();assert.equal((await timeline(1002)).public_effective_at,null,'same prior public price cannot be counted as a known effective price change');
   await next(1003,'removed','2026-11-14T01:03:00.000Z');assert.equal((await timeline(1003)).public_outcome,'effective');assert.equal((await timeline(1003)).detail_updated_at,null);await assert.rejects(inventory.getPublic(`ext-${id}`,'en','localized'));
   await next(1004,'relisted','2026-11-14T01:04:00.000Z');assert.equal((await timeline(1004)).public_effective_at,null);await worker.details();assert.equal((await timeline(1004)).public_outcome,'effective');assert.equal((await inventory.getPublic(`ext-${id}`,'en','localized')).content.title.text,'Staff title stays');
   await ctx.test('timing writes only pending events for the requested identity and generation',async timingCtx=>{
    const tx=await database.pool.connect();
    try{
     await tx.query('BEGIN');
     const oldAt=new Date('2026-11-14T01:04:00.000Z');
     assert.equal((await tx.query('SELECT locale_mask FROM external_catalog_filter WHERE listing_id=$1',[id])).rows[0].locale_mask,7);
     await tx.query(`INSERT INTO external_full_events(event_id,payload_hash,source,external_id,operation,business_at,document_refs,
      source_type,detail_generation,public_outcome,prior_public_price,was_public,public_effective_at)
      SELECT event_id,'fixture','che168',identity,operation,$1::timestamptz,'[]',kind,generation,outcome,prior_price,was_public,
       CASE WHEN has_time THEN $1::timestamptz END
      FROM (VALUES
       (1100,'9001','upsert','price',990,'pending',70000,true,false),
       (1101,'9001','upsert','price',990,'pending',65000,true,false),
       (1102,'9001','upsert',NULL,990,'unknown',NULL,NULL,false),
       (1103,'9001','upsert','price',990,'effective',70000,true,true),
       (1104,'9001','upsert','price',990,'effective',70000,true,false),
       (1105,'9001','upsert','price',991,'pending',70000,true,false),
       (1106,'9002','upsert','price',990,'pending',70000,true,false),
       (1107,'9001','withdraw','removed',990,'pending',65000,true,false),
       (1108,'9001','withdraw','removed',990,'pending',NULL,false,false)
      ) AS v(event_id,identity,operation,kind,generation,outcome,prior_price,was_public,has_time)`,[oldAt]);
     const observations=async()=>(await tx.query(`SELECT event_id::int,public_outcome,detail_updated_at,public_effective_at
      FROM external_full_events WHERE event_id BETWEEN 1100 AND 1108 ORDER BY event_id`)).rows;
     const pending=await observations();
     const record=async(fn:typeof recordDetailTiming,generation='990')=>{
      const query=timingCtx.mock.method(tx,'query');
      try{await fn(tx,'che168','9001',generation);assert.equal(query.mock.callCount(),1);}finally{query.mock.restore();}
     };
     await record(recordDetailTiming);
     const detail=await observations();
     assert.equal(detail[0].public_outcome,'effective');
     assert.ok(detail[0].detail_updated_at>=oldAt&&detail[0].public_effective_at>=detail[0].detail_updated_at);
     assert.equal(detail[1].public_outcome,'not_public');
     assert.ok(detail[1].detail_updated_at>=oldAt);
     assert.equal(detail[1].public_effective_at,null);
     assert.deepEqual(detail.slice(2),pending.slice(2));
     await record(recordDetailTiming);
     await record(recordDetailTiming,'999');
     assert.deepEqual(await observations(),detail);

     await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id]);
     await tx.query('DELETE FROM external_catalog WHERE listing_id=$1',[id]);
     await record(recordWithdrawalTiming);
     const withdrawn=await observations();
     assert.deepEqual(withdrawn.slice(0,7),detail.slice(0,7));
     assert.equal(withdrawn[7].public_outcome,'effective');
     assert.ok(withdrawn[7].public_effective_at>=oldAt);
     assert.equal(withdrawn[7].detail_updated_at,null);
     assert.deepEqual(withdrawn[8],{...pending[8],public_outcome:'not_public'});
     await record(recordWithdrawalTiming);
     await record(recordWithdrawalTiming,'999');
     assert.deepEqual(await observations(),withdrawn);
    }finally{await tx.query('ROLLBACK');tx.release();}
   });
   const before=await fullSyncTimings(database);assert.equal(before.metrics.find(m=>m.kind==='price')!.publicEffective,1);assert.equal(before.metrics.find(m=>m.kind==='relisted')!.publicEffective,1);
   // Actual memory-cache hit, not a mocked publicResponse: the member hint is outside the cached loader.
   const servingFile=path.join(directory,'serving-mode');await writeFile(servingFile,'candidate',{mode:0o600});
   const runtime=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),
    API_SERVING_MODE_FILE:servingFile,MEDIA_ROOT:directory,AUTH_BASE_URL:'http://127.0.0.1:3318',TRUSTED_ORIGINS:'http://127.0.0.1:3318',CATALOG_READ_MODE:'combined',PUBLIC_CATALOG_CACHE:'memory',HD_DEPLOYMENT_ENV:'test',HD_RELEASE_ID:'a'.repeat(40)}));
   const original=InventoryService.prototype.getPublic;let loads=0;
   const spy=ctx.mock.method(InventoryService.prototype,'getPublic',async function(this:InventoryService,...args:Parameters<typeof original>){loads++;return original.apply(this,args);});
   try{
    const request={url:`/api/v1/vehicles/ext-${id}?locale=en&view=localized`};
    const first=await runtime.app.inject(request);assert.equal(first.statusCode,200,first.body);assert.equal(loads,1);
    await writeFile(servingFile,'active',{mode:0o600});
    let release!:()=>void,started=false,finished!:()=>void;const done=new Promise<void>(r=>finished=r),blocked=new Promise<void>(r=>release=r);
    const originalQuery=runtime.db.pool.query.bind(runtime.db.pool);let hintQueries=0;
    const querySpy=ctx.mock.method(runtime.db.pool,'query',((...args:unknown[])=>{
     if(typeof args[0]==='string'&&args[0].includes('UPDATE external_full_members m SET last_accessed_at')){
      hintQueries++;started=true;return blocked.then(()=>originalQuery(args[0] as string,args[1] as unknown[])).finally(finished);
     }
     return (originalQuery as (...a:unknown[])=>unknown)(...args);
    }) as typeof runtime.db.pool.query);
    try{
     const second=await runtime.app.inject(request);assert.equal(second.statusCode,200,second.body);assert.equal(loads,1,'second read must be a cache hit');assert.equal(started,true,'detached hint starts while response remains unblocked');
     assert.equal((await runtime.app.inject({url:'/health/serving'})).json().inFlight,1);
     assert.equal((await runtime.app.inject({url:`/api/v1/vehicles/ext-${randomUUID()}?locale=en&view=localized`})).statusCode,404);assert.equal(hintQueries,1,'a failed detail cannot produce a hint');
     release();await done;await new Promise(r=>setImmediate(r));
     const touched=(await database.pool.query("SELECT last_accessed_at,now()-last_accessed_at<interval '1 minute' AS recent FROM external_full_members WHERE source='che168' AND external_id='9001'")).rows[0]!;assert.equal(touched.recent,true);
     const third=await runtime.app.inject(request);assert.equal(third.statusCode,200);assert.equal(loads,2,'only the deliberately missing detail adds a loader call');assert.equal(hintQueries,1);
     assert.deepEqual((await database.pool.query("SELECT last_accessed_at FROM external_full_members WHERE source='che168' AND external_id='9001'")).rows[0]!.last_accessed_at,touched.last_accessed_at);
    }finally{release();querySpy.mock.restore();}
   }finally{spy.mock.restore();await runtime.app.close();}
   await next(1005,'price','2026-11-14T01:05:00.000Z',true);
   assert.equal((await database.pool.query("SELECT priority FROM external_full_work WHERE source='che168' AND external_id='9001'")).rows[0]!.priority,100,'legacy untyped updates of actual published vehicles still use the urgent lane');
   const snapshot=randomUUID();await database.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged) VALUES($1,'2026-11-14T01:06:00Z','verified',$2,3,3)",[snapshot,path.join(directory,'synthetic-snapshot.csv')]);
   await database.pool.query("INSERT INTO external_full_stage VALUES($1,1,'che168','9001',$2)",[snapshot,JSON.stringify({source:'che168',id:'9001',has_report:'false'})]);
   await database.pool.query("INSERT INTO external_full_stage VALUES($1,2,'che168','9002',$2),($1,3,'che168','9003',$3)",[snapshot,JSON.stringify({source:'che168',id:'9002',has_report:'false'}),JSON.stringify({source:'che168',id:'9003',has_report:'false'})]);
   await worker.promoteSnapshot(snapshot);
   assert.deepEqual((await database.pool.query('SELECT public_outcome,public_effective_at FROM external_full_events WHERE event_id=1005')).rows[0],{public_outcome:'superseded',public_effective_at:null});
   assert.equal((await database.pool.query("SELECT priority FROM external_full_work WHERE source='che168' AND external_id='9001'")).rows[0]!.priority,100,'CSV refresh preserves urgency while superseding the old event generation');
   // A hidden vehicle continues receiving source updates but is never included in successful latency samples.
   const updated=await store.getListing(`ext-${id}`,'en');await store.saveOverrides(`ext-${id}`,{version:updated.version,overrides:{...updated.overrides,hidden:true}},randomUUID(),{id:'priority-admin',requestId:'hide'});
   price=60000;await next(1006,'price','2026-11-14T01:07:00.000Z');await worker.details();assert.equal((await timeline(1006)).public_outcome,'not_public');assert.equal((await timeline(1006)).public_effective_at,null);
  });
  await t.test('tick processes details before snapshot admission and gives historical reports bounded progress',async ctx=>{
   const calls:string[]=[];
   for(const method of ['applyEvents','details','snapshot','report','daily','capacityGate','rotate','pruneStaging'] as const){
    ctx.mock.method(worker!,method,async()=>{calls.push(method);return method==='details'?1:0;});
   }
   await database.pool.query("UPDATE external_full_sync SET next_delta_at=now()+interval '1 hour',next_maintenance_at=now()+interval '1 hour',next_snapshot_at=now()-interval '1 minute' WHERE id=1");
   await worker!.tick();assert.ok(calls.indexOf('details')<calls.indexOf('snapshot'));assert.ok(calls.indexOf('snapshot')<calls.indexOf('report'));
   assert.equal(calls.filter(c=>c==='report').length,1);
  });
  await t.test('recoverable detail failures do not starve scheduled work, but rate/account limits still stop network work',async ctx=>{
   const calls:string[]=[];
   ctx.mock.method(worker!,'details',async()=>{throw new FullSyncError('SYNC_TIMEOUT');});
   for(const method of ['applyEvents','snapshot','report','daily','capacityGate','rotate','pruneStaging'] as const)ctx.mock.method(worker!,method,async()=>{calls.push(method);return 0;});
   await database.pool.query("UPDATE external_full_sync SET next_snapshot_at=now()-interval '1 minute' WHERE id=1");
   await worker!.tick();assert.ok(calls.includes('snapshot'));assert.equal(calls.filter(c=>c==='report').length,1);
   calls.length=0;ctx.mock.method(worker!,'details',async()=>{throw new FullSyncError('SYNC_RATE_LIMITED');});
   await assert.rejects(worker!.tick(),/SYNC_RATE_LIMITED/);assert.equal(calls.includes('snapshot'),false);assert.equal(calls.includes('report'),false);
  });
  await t.test('detail materialization yields at transaction boundaries and charges only the timed-out generation',async ctx=>{
   const ids=['93001','93002','93003','93004'];
   await worker!.close();
   await database.pool.query('DELETE FROM external_full_work');
   await database.pool.query(`UPDATE external_full_sync SET capacity_pending=false,last_capacity_sample=0,
    next_delta_at=now()+interval '1 hour',next_maintenance_at=now()+interval '1 hour',
    next_snapshot_at=now()+interval '1 hour' WHERE id=1`);
   await database.pool.query(`INSERT INTO external_formal_admissions(source,external_id) SELECT 'che168',unnest($1::text[])`,[ids]);
   await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,business_at)
    SELECT 'che168',id,'budget:'||id,$2 FROM unnest($1::text[]) id`,[ids,at]);
   await database.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,queued_at)
    SELECT 'che168',id,'detail',1,$2 FROM unnest($1::text[]) id`,[ids,at]);
   const requested:string[]=[];
   const detailClient={...client,bulk:async function*(source:Source,vehicleIds:string[],locale:string){
    requested.push(locale);assert.deepEqual(vehicleIds,ids);
    const results=vehicleIds.map(id=>({source,id,status:'active',title:locale,hasInspectionReport:true}));
    const body=JSON.stringify({results,notFound:[]});
    yield {results,notFound:[],rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};
   }} as unknown as FullSyncClient;
   let monotonicMs=0,timeoutId:string|undefined,replacement:Change|undefined;
   const applied:string[]=[],phases:string[]=[],observations:DetailMaterializationObservation[]=[];
   const budgetWorker=new FullSyncWorker(database,detailClient,directory,async(tx,input)=>{
    applied.push(`${input.operation}:${input.externalId}`);
    if(input.operation==='withdraw')return;
    input.observe?.('listing_upsert');
    if(input.externalId===timeoutId){
     await tx.query("UPDATE external_full_members SET verification_pending=true WHERE source='che168' AND external_id=$1",[input.externalId]);
     await tx.query("SET LOCAL statement_timeout='25ms'");
     await tx.query('SELECT pg_sleep(1)');
    }
    if(input.externalId===ids[0])monotonicMs=5000;
   },value=>observations.push(value));
   worker=budgetWorker;
   assert.equal(await budgetWorker.acquire(),true);budgetWorker.space=async()=>({used:0,total:1e12,available:1e12});
   ctx.mock.method(budgetWorker,'sampleRemaining',async()=>500);
   ctx.mock.method(performance,'now',()=>monotonicMs);
   const work=async()=>(await database.pool.query(`SELECT external_id,kind,generation::text,attempts,locales,document_refs,last_error_code,
    due_at>clock_timestamp() AS backed_off FROM external_full_work WHERE source='che168' AND external_id=ANY($1::text[]) ORDER BY external_id,kind`,[ids])).rows;
   const refs=async()=>(await database.pool.query(`SELECT reference,count(*)::int AS documents FROM external_source_document_refs
    WHERE kind='pending' AND reference=ANY($1::text[]) GROUP BY reference ORDER BY reference`,[ids.map(id=>`full:che168:${id}:detail`)])).rows;
   assert.equal(await budgetWorker.details(),1);
   assert.deepEqual(applied,['upsert:93001']);assert.deepEqual(requested,['zh','en','ru']);
   const slice=observations.find(value=>value.event==='external.full_sync.materialization_slice');
   assert.deepEqual(slice&&[slice.stop,slice.prepared,slice.attempted,slice.applied,slice.failed],['budget',4,1,1,0]);
   const prepared=await work(),protectedRefs=await refs();
   assert.deepEqual(prepared.map(row=>[row.external_id,row.kind,row.document_refs.length]),[['93001','report',0],['93002','detail',3],['93003','detail',3],['93004','detail',3]]);
   assert.deepEqual(protectedRefs,ids.slice(1).map(id=>({reference:`full:che168:${id}:detail`,documents:3})));

   const applyEvents=budgetWorker.applyEvents.bind(budgetWorker),receiveDelta=budgetWorker.receiveDelta.bind(budgetWorker);
   ctx.mock.method(budgetWorker,'applyEvents',async(withdrawOnly=false)=>{phases.push(withdrawOnly?'withdrawals':'delta_apply');return applyEvents(withdrawOnly);});
   ctx.mock.method(budgetWorker,'receiveDelta',async()=>{phases.push('delta_receive');return receiveDelta();});
   for(const method of ['snapshot','report','rotate','pruneStaging'] as const)ctx.mock.method(budgetWorker,method,async()=>{phases.push(method);return 0;});
   const transaction=database.transaction.bind(database);
   ctx.mock.method(database,'transaction',async(work:Parameters<Database['transaction']>[0])=>{
    try{return await transaction(work);}catch(error){
     if(error&&typeof error==='object'&&'code' in error&&error.code==='57014'){
      phases.push('57014');
      if(replacement){const change=replacement;replacement=undefined;feed=[change];await receiveDelta();await applyEvents();}
     }
     throw error;
    }
   });
   monotonicMs=0;timeoutId=ids[1];
   await budgetWorker.tick();
   assert.deepEqual(phases,['withdrawals','delta_apply','57014']);
   assert.deepEqual(applied,['upsert:93001','upsert:93002']);
   assert.deepEqual(await refs(),protectedRefs);
   assert.deepEqual(await work(),[prepared[0],{...prepared[1],attempts:1,last_error_code:'SYNC_DETAIL_SQL_TIMEOUT',backed_off:true},...prepared.slice(2)]);
   assert.equal((await budgetWorker.state()).last_error_code,'SYNC_DETAIL_SQL_TIMEOUT');
   const timeout=observations.find(value=>value.event==='external.full_sync.materialization_attempt'&&value.result==='failed');
   assert.ok(timeout&&timeout.event==='external.full_sync.materialization_attempt');
   assert.deepEqual([timeout.generation,timeout.databaseCode,timeout.stage,timeout.path],['1','SQL_STATEMENT_CANCELLED','listing_upsert','listing_upsert']);
   assert.match(timeout.listingToken,/^[a-f0-9]{24}$/);
   assert.ok(timeout.backendPid&&timeout.backendPid>0);
   assert.equal(Object.prototype.hasOwnProperty.call(timeout,'externalId'),false);
   assert.equal(Object.prototype.hasOwnProperty.call(timeout,'documents'),false);
   assert.equal((await database.pool.query("SELECT verification_pending FROM external_full_members WHERE source='che168' AND external_id='93002'")).rows[0].verification_pending,false);

   phases.length=0;timeoutId=ids[2];
   await database.pool.query("UPDATE external_full_sync SET next_delta_at=now()-interval '1 second' WHERE id=1");
   feed=[{id:930040,source:'che168',vehicleId:ids[3]!,type:'removed',at}];
   replacement={id:930041,source:'che168',vehicleId:ids[2]!,type:'price',at};
   await budgetWorker.tick();
   assert.deepEqual(phases,['withdrawals','delta_receive','delta_apply','withdrawals','report','57014']);
   assert.deepEqual(applied,['upsert:93001','upsert:93002','withdraw:93004','upsert:93003']);
   assert.deepEqual(requested,['zh','en','ru'],'complete archived jobs resume without refetching');
   const resumed=await work();
   assert.deepEqual(resumed.map(row=>[row.external_id,row.kind,row.generation,row.attempts,row.document_refs.length]),
    [['93001','report','1',0,0],['93002','detail','1',1,3],['93003','detail','2',0,0]]);
   assert.deepEqual(await refs(),protectedRefs.slice(0,1));
  });
  await t.test('multiple language misses charge once and a retry requests only missing languages',async ctx=>{
   const id='93005';
   await database.pool.query('DELETE FROM external_full_work');
   await database.pool.query("INSERT INTO external_formal_admissions(source,external_id) VALUES('che168',$1)",[id]);
   await database.pool.query("INSERT INTO external_full_members(source,external_id,canonical_id,business_at) VALUES('che168',$1,'budget:'||$1,$2)",[id,at]);
   await database.pool.query("INSERT INTO external_full_work(source,external_id,kind,generation) VALUES('che168',$1,'detail',1)",[id]);
   const seen:string[]=[];
   let recover=false;
   ctx.mock.method(worker!,'sampleRemaining',async()=>500);
   ctx.mock.method(worker!.client,'bulk',async function*(source:Source,ids:string[],locale:string){
    assert.deepEqual(ids,[id]);seen.push(locale);
    const found=recover||locale==='en';
    const results=found?[{source,id,status:'active',title:locale,hasInspectionReport:false}]:[];
    const notFound=found?[]:[id];
    const body=JSON.stringify({results,notFound});
    yield {results,notFound,rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};
   });
   assert.equal(await worker!.details(),0);
   const work=(await database.pool.query("SELECT attempts,last_error_code,locales,document_refs FROM external_full_work WHERE source='che168' AND external_id=$1",[id])).rows[0];
   assert.deepEqual([work.attempts,work.last_error_code,work.locales,work.document_refs.length],[1,'SYNC_DETAIL_NOT_FOUND',['en'],1]);
   await database.pool.query("UPDATE external_full_work SET due_at=clock_timestamp()-interval '1 second' WHERE source='che168' AND external_id=$1",[id]);
   const resumed=new FullSyncWorker(database,worker!.client,directory,async()=>{});
   await worker!.close();worker=resumed;
   assert.equal(await resumed.acquire(),true);
   resumed.space=async()=>({used:0,total:1e12,available:1e12});
   ctx.mock.method(resumed,'sampleRemaining',async()=>500);
   recover=true;
   assert.equal(await worker!.details(),1);
   assert.deepEqual(seen,['zh','en','ru','zh','ru']);
   assert.equal((await database.pool.query("SELECT 1 FROM external_full_work WHERE source='che168' AND external_id=$1",[id])).rowCount,0);
  });
  await t.test('a malformed later bulk split does not charge an already archived vehicle or a later unattempted split',async ctx=>{
   const ids=['93006','93007','93008'];
   await database.pool.query(`INSERT INTO external_formal_admissions(source,external_id) SELECT 'che168',unnest($1::text[])`,[ids]);
   await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,business_at)
    SELECT 'che168',id,'budget:'||id,$2 FROM unnest($1::text[]) id`,[ids,at]);
   await database.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,queued_at)
    SELECT 'che168',id,'detail',1,$2 FROM unnest($1::text[]) id`,[ids,at]);
   ctx.mock.method(worker!,'sampleRemaining',async()=>500);
   ctx.mock.method(worker!.client,'bulk',async function*(source:Source,vehicleIds:string[],locale:string){
    assert.deepEqual(vehicleIds,ids);assert.equal(locale,'zh');
    const results=[{source,id:ids[0]!,status:'active'}];
    const body=JSON.stringify({results,notFound:[]});
    yield {results,notFound:[],rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};
    const error=new FullSyncError('SYNC_RESPONSE_INVALID');error.affectedIds=[ids[1]!];throw error;
   });
   await assert.rejects(worker!.details(),/SYNC_RESPONSE_INVALID/);
   const work=(await database.pool.query("SELECT external_id,attempts,locales FROM external_full_work WHERE external_id=ANY($1::text[]) ORDER BY external_id",[ids])).rows;
   assert.deepEqual(work.map(row=>[row.external_id,row.attempts,row.locales]),[[ids[0],0,['zh']],[ids[1],1,[]],[ids[2],0,[]]]);
  });
  await t.test('capacity or lease loss after a provider response does not charge attempted or unattempted vehicles',async ctx=>{
   const selected=async()=>(await database.pool.query(`SELECT external_id,generation,attempts,locales,document_refs
    FROM external_full_work WHERE source='che168' AND kind='detail' ORDER BY external_id`)).rows;
   const before=await selected();assert.ok(before.some(row=>row.document_refs.length));
   let returned=false, guard='SYNC_CAPACITY_PENDING';
   ctx.mock.method(worker!,'sampleRemaining',async()=>500);
   ctx.mock.method(worker!,'heavy',async()=>{if(returned)throw new FullSyncError(guard);});
   ctx.mock.method(worker!.client,'bulk',async function*(source:Source,ids:string[]){
    const results=ids.map(id=>({source,id,status:'active'}));
    const body=JSON.stringify({results,notFound:[]});returned=true;
    yield {results,notFound:[],rawResponse:{body,hash:createHash('sha256').update(body).digest('hex')}};
   });
   for(const code of ['SYNC_CAPACITY_PENDING','SYNC_HEAVY_PAUSED','SYNC_LEASE_LOST']){
    returned=false;guard=code;
    await assert.rejects(worker!.details(),{code});
    assert.equal(returned,true);assert.deepEqual(await selected(),before);
   }
  });
  await t.test('old instrumentation without actual successful receive coverage is explicitly incomplete',async ctx=>{
   await database.pool.query("UPDATE external_full_sync SET timing_started_at=now()-interval '2 days' WHERE id=1");
   await database.pool.query('DELETE FROM external_full_receive_observations');
   const failedReceive=ctx.mock.method(worker!.client,'changes',async()=>{throw new FullSyncError('SYNC_TIMEOUT');});
   await assert.rejects(worker!.receiveDelta(),/SYNC_TIMEOUT/);failedReceive.mock.restore();
   const attempted=(await database.pool.query('SELECT last_success_at,last_error_code FROM external_full_receive_observations')).rows;
   assert.deepEqual(attempted,[{last_success_at:null,last_error_code:'SYNC_TIMEOUT'}]);
   let observed=await fullSyncTimings(database);assert.equal(observed.window.complete,false);assert.equal(observed.window.coverage.missingSlots,288);
   await database.pool.query(`INSERT INTO external_full_receive_observations SELECT slot,slot,slot,NULL FROM generate_series(
    date_bin(interval '5 minutes',now(),'epoch'::timestamptz)-interval '24 hours',date_bin(interval '5 minutes',now(),'epoch'::timestamptz)-interval '5 minutes',interval '5 minutes') slot`);
   observed=await fullSyncTimings(database);assert.equal(observed.window.complete,true);assert.equal(observed.window.coverage.successfulSlots,288);
   await database.pool.query("UPDATE external_full_receive_observations SET last_success_at=NULL,last_error_code='SYNC_TIMEOUT' WHERE slot_at=(SELECT min(slot_at) FROM external_full_receive_observations)");
   observed=await fullSyncTimings(database);assert.equal(observed.window.complete,false);assert.equal(observed.window.coverage.failedSlots,1);assert.equal(observed.window.coverage.missingSlots,1);
  });
  assert.equal(forbidden.mock.callCount(),0);
 }finally{await worker?.close();await db?.close();try{if(created)await maintenance.pool.query(`DROP DATABASE "${name}"`);}finally{await maintenance.close();await rm(directory,{recursive:true,force:true});forbidden.mock.restore();}}
});
