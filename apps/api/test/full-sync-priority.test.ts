import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {FullSyncWorker,configureFullSync} from '../src/external/full-sync/engine.js';
import type {FullSyncClient} from '../src/external/full-sync/client.js';
import {FullSyncError} from '../src/external/full-sync/types.js';
import type {Change,Source} from '../src/external/full-sync/types.js';
import {fullSyncTimings} from '../src/external/full-sync/timing.js';
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
