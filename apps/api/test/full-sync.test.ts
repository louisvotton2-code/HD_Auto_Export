import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {FullSyncWorker,configureFullSync} from '../src/external/full-sync/engine.js';
import {FullSyncClient} from '../src/external/full-sync/client.js';
import {fullSyncStatus,setFullSyncPaused} from '../src/external/full-sync/status.js';
import {catalogColumns} from '../src/external/sources/index.js';
import type {Change,FullApply} from '../src/external/full-sync/types.js';

test('formal full synchronization has durable independent receipt/application and safe control',async t=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)throw new Error('Use an isolated loopback maintenance database, never production.');
 const name=`hd_full_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.toString(),1),directory=await mkdtemp(path.join(tmpdir(),'hd-full-'));
 let db:Database|undefined,worker:FullSyncWorker|undefined;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;db=createDatabase(url.toString(),2);const database=db;await migrateDatabase(db);
  if(!(await db.pool.query("SELECT to_regclass('external_full_sync') AS relation")).rows[0].relation)throw new Error('Migrate all EXT07 migrations before this test.');
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('full-admin','Full operator','full-admin@example.invalid','admin',false),('full-editor','Editor','full-editor@example.invalid','editor',false)");
  const actor={id:'full-admin',requestId:'full-test'},at='2026-11-14T00:00:00.000Z';await configureFullSync(db,actor,'full');
  await db.pool.query('UPDATE external_full_sync SET since_at=$1 WHERE id=1',[at]);
  let feed:Change[]=[{id:1,source:'che168',vehicleId:'123',type:'new',at},{id:2,source:'che168',vehicleId:'123',type:'removed',at:'2026-11-14T00:00:01.000Z'}];
  const raw=(payload:unknown)=>{const body=JSON.stringify(payload);return {hash:createHash('sha256').update(body).digest('hex'),body};};
  const client={changes:async(_since:string,cursor:string|null)=>{const changes=feed.filter(e=>e.id>Number(cursor??0)),payload={cursor:Number(cursor??0),nextCursor:changes.at(-1)?.id??Number(cursor??0),hasMore:false,changes};return {...payload,rawResponse:raw(payload)};}} as unknown as FullSyncClient;
  await db.pool.query('CREATE TABLE full_test_effects(source text,external_id text,operation text)');
  const apply:FullApply=async(tx,input)=>{await tx.query('INSERT INTO full_test_effects VALUES($1,$2,$3)',[input.source,input.externalId,input.operation]);};
  worker=new FullSyncWorker(db,client,directory,apply);assert.equal(await worker.acquire(),true);
  await t.test('raw page durable before application, replay idempotent and withdrawal wins',async()=>{
   await worker!.receiveDelta();let s=await fullSyncStatus(database);assert.equal(s.receivedEvents,2);assert.equal(s.appliedEvents,0);
   await worker!.receiveDelta();assert.equal((await fullSyncStatus(database)).receivedEvents,2);
   await worker!.applyEvents(true);await worker!.applyEvents();s=await fullSyncStatus(database);assert.equal(s.appliedEvents,2);
   assert.equal((await database.pool.query("SELECT state FROM external_full_members WHERE external_id='123'")).rows[0].state,'withdrawn');
   assert.deepEqual((await database.pool.query('SELECT operation FROM full_test_effects')).rows,[{operation:'withdraw'}]);
  });
  await t.test('pause/resume uses version and immutable idempotent status snapshots',async()=>{
   const before=await fullSyncStatus(database),key=randomUUID(),input={version:before.version,action:'pause' as const};
   const paused=await setFullSyncPaused(database,input,actor,key);assert.equal(paused.paused,true);
   const resumed=await setFullSyncPaused(database,{version:paused.version,action:'resume'},actor,randomUUID());assert.equal(resumed.paused,false);
   assert.deepEqual(await setFullSyncPaused(database,input,actor,key),paused);
   await assert.rejects(setFullSyncPaused(database,input,actor,randomUUID()),/Reload/);
   await assert.rejects(setFullSyncPaused(database,{version:resumed.version,action:'pause'},{id:'full-editor',requestId:'bad'},randomUUID()),/Administrator/);
  });
  await t.test('single session lock excludes a second worker',async()=>{
   // A separate pool avoids waiting behind this worker's dedicated connection.
   const otherDb=createDatabase(url.toString(),2),other=new FullSyncWorker(otherDb,client,directory,apply);
   try{assert.equal(await other.acquire(),false);}finally{await other.close();await otherDb.close();}
  });
  await t.test('only a newer explicit relist clears a withdrawn fence',async()=>{
   feed=[...feed,{id:3,source:'che168',vehicleId:'123',type:'price',at:'2026-11-14T00:00:02.000Z'}];await worker!.receiveDelta();await worker!.applyEvents();
   assert.equal((await database.pool.query("SELECT state FROM external_full_members WHERE external_id='123'")).rows[0].state,'withdrawn');
   feed.push({id:4,source:'che168',vehicleId:'123',type:'relisted',at:'2026-11-14T00:00:03.000Z'});await worker!.receiveDelta();await worker!.applyEvents();
   assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM external_full_work WHERE source='che168' AND external_id='123'")).rows[0].n,1);
  });
  await t.test('a full CSV staging table is fixed cost and sample waiting freezes expansion but permits reports and withdrawals',async()=>{
   const snapshotId=randomUUID(),archivePath=path.join(directory,`${snapshotId}.csv.gz`),archive=Buffer.alloc(8192,1);
   await writeFile(archivePath,archive);
   await database.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged,apply_cursor,bytes) VALUES($1,$2,'applying',$3,50000,50000,10000,20000000)",[snapshotId,at,archivePath]);
   // The complete export is materially larger than the detail sample; it must not be scaled by 50000/10000.
   await database.pool.query(`INSERT INTO external_full_stage(snapshot_id,row_number,source,external_id,payload)
    SELECT $1,g,'dongchedi',(100000+g)::text,jsonb_build_object('source','dongchedi','id',(100000+g)::text,'description',repeat(md5(g::text),16)) FROM generate_series(1,50000) g`,[snapshotId]);
   await database.pool.query("INSERT INTO external_full_members(source,external_id,canonical_id,state,sampled,last_detail_at,locales,report_state) SELECT 'dongchedi',(100000+g)::text,'sample:'||g,'active',true,now(),ARRAY['zh','en','ru'],'pending' FROM generate_series(1,10000) g");
   const originalSpace=worker!.space.bind(worker!),originalBudget=process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
   try{
   process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=String(1024**4);
   worker!.space=async()=>({used:0,available:1024**4,total:1024**4});
   assert.equal(await worker!.sampleRemaining(),0);assert.equal(await worker!.promoteSnapshot(snapshotId),0);
   assert.equal(await worker!.snapshot(),0);
   (client as unknown as {bulk:Function}).bulk=async function*(){throw new Error('New detail fetch must wait for the sample gate');};
   assert.equal(await worker!.details(),0);
   await worker!.capacityGate();assert.equal((await database.pool.query('SELECT capacity_pending FROM external_full_sync')).rows[0].capacity_pending,false);
   (client as unknown as {report:Function}).report=async()=>({payload:{hasReport:false},rawResponse:raw({hasReport:false})});
   await database.pool.query("INSERT INTO external_full_work(source,external_id,kind,generation) VALUES('dongchedi','100001','report',1)");
   // Exercise the actual scheduler with an active snapshot, a queued new identity and a pending sample report.
   await database.pool.query("UPDATE external_full_sync SET next_maintenance_at=now()+interval '1 day' WHERE id=1");
   feed.push({id:5,source:'che168',vehicleId:'123',type:'removed',at:'2026-11-14T00:00:04.000Z'});
   await worker!.receiveDelta();await worker!.tick();
   assert.equal((await database.pool.query("SELECT report_state FROM external_full_members WHERE source='dongchedi' AND external_id='100001'")).rows[0].report_state,'no_report');
   assert.equal((await database.pool.query("SELECT state FROM external_full_members WHERE source='che168' AND external_id='123'")).rows[0].state,'withdrawn');
   assert.equal((await database.pool.query('SELECT apply_cursor FROM external_full_snapshots WHERE id=$1',[snapshotId])).rows[0].apply_cursor,'10000');
   assert.equal((await database.pool.query("SELECT count(*)::integer AS n FROM external_full_members WHERE source='dongchedi'")).rows[0].n,10000);
   assert.equal((await database.pool.query("SELECT count(*)::integer AS n FROM external_source_documents WHERE kind='csv'")).rows[0].n,0);

   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_ESTIMATE/);
   assert.equal((await worker!.state()).capacity_estimate.allowed,false,'An approved budget cannot replace the unfinished report sample');
   await assert.rejects(worker!.heavy(),/SYNC_CAPACITY_PENDING/);
   await database.pool.query("UPDATE external_full_members SET report_state='no_report' WHERE sampled");
   await worker!.estimateCapacity(snapshotId,20000000);
   const estimate=(await worker!.state()).capacity_estimate;
   const stageBytes=Number((await database.pool.query("SELECT pg_total_relation_size('external_full_stage')::text AS bytes")).rows[0].bytes);
   assert.equal(estimate.sqlStagingBytes,stageBytes);assert.ok(stageBytes>estimate.businessBytes);
   assert.equal(estimate.archiveDirectoryBytes,archive.length);
   assert.equal(estimate.actualBytesPerDetail,estimate.businessBytes/10000);
   assert.equal(estimate.fixedBytes,stageBytes+archive.length+estimate.walBytes);
   assert.ok(Math.abs(estimate.estimatedBytes-(estimate.businessBytes*5*6+estimate.fixedBytes))<1);
   assert.ok(estimate.estimatedBytes<(estimate.businessBytes+stageBytes)*5*6,'The full staging relation must not inflate per-vehicle projection');
   assert.equal(estimate.allowed,true);
   worker!.space=async()=>({used:.70,available:.30*1024**4,total:1024**4});
   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_ESTIMATE/);
   assert.equal((await worker!.state()).capacity_estimate.allowed,false,'70% remains a hard limit despite an approved budget');
   worker!.space=async()=>({used:0,available:1024**4,total:1024**4});
   await worker!.capacityGate();assert.equal(await worker!.sampleRemaining(),500);
   }finally{
    worker!.space=originalSpace;if(originalBudget===undefined)delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;else process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=originalBudget;
    await database.pool.query('UPDATE external_full_sync SET capacity_pending=false,last_capacity_sample=0 WHERE id=1');
    await database.pool.query("DELETE FROM external_full_work w USING external_full_members m WHERE w.source=m.source AND w.external_id=m.external_id AND m.canonical_id LIKE 'sample:%'");
    await database.pool.query("DELETE FROM external_full_members WHERE canonical_id LIKE 'sample:%'");
    await database.pool.query('DELETE FROM external_full_stage WHERE snapshot_id=$1',[snapshotId]);
    await database.pool.query('DELETE FROM external_full_snapshots WHERE id=$1',[snapshotId]);await rm(archivePath);
   }
  });
  await t.test('complete streamed CSV passes bootstrap before any detail capacity sample exists',async()=>{
   const id=randomUUID(),file=path.join(directory,`${id}.csv`);
   const records=Array.from({length:10000},(_,i)=>catalogColumns.map(c=>c==='source'?'che168':c==='id'?String(300000+i):'').join(','));
   const csv=Buffer.from(catalogColumns.join(',')+'\n'+records.join('\n')+'\n');await writeFile(file,csv);
   await database.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes) VALUES($1,$2,'staging',$3,$4,$5)",[id,at,file,createHash('sha256').update(csv).digest('hex'),csv.length]);
   await worker!.snapshot();const state=(await database.pool.query('SELECT state,rows,staged FROM external_full_snapshots WHERE id=$1',[id])).rows[0];
   assert.equal(state.rows,'10000');assert.equal(state.staged,'10000');assert.equal(state.state,'applying');
   assert.equal((await database.pool.query('SELECT apply_cursor FROM external_full_snapshots WHERE id=$1',[id])).rows[0].apply_cursor,'500');
   const calls:number[]=[];
   (client as unknown as {bulk:Function}).bulk=async function*(source:string,ids:string[]){calls.push(ids.length);const payload={results:ids.map(id=>({source,id,status:'active',hasInspectionReport:false})),notFound:[]};yield {...payload,rawResponse:raw(payload)};};
   assert.equal(await worker!.details(),500);assert.deepEqual(calls,[500,500,500]);

   assert.equal((await database.pool.query('SELECT capacity_pending FROM external_full_sync')).rows[0].capacity_pending,false);
   await database.pool.query("UPDATE external_full_snapshots SET state='failed' WHERE id=$1",[id]);
  });
  await t.test('archive cleanup advances past a pruned generation and respects backup pins',async()=>{
   const ids=[randomUUID(),randomUUID(),randomUUID()];
   for(const [i,id] of ids.entries()){const file=path.join(directory,`${id}.csv`);await writeFile(file,'old synthetic archive');await database.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,created_at) VALUES($1,$2,'complete',$3,now()-($4*interval '1 day'))",[id,at,file,12-i]);}
   await database.pool.query('INSERT INTO external_full_archive_pins VALUES($1,$2)',[ids[0],'synthetic-backup']);
   await worker!.pruneStaging();assert.ok((await database.pool.query('SELECT archive_pruned_at FROM external_full_snapshots WHERE id=$1',[ids[1]])).rows[0].archive_pruned_at);
   await worker!.pruneStaging();assert.ok((await database.pool.query('SELECT archive_pruned_at FROM external_full_snapshots WHERE id=$1',[ids[2]])).rows[0].archive_pruned_at);
   assert.equal((await database.pool.query('SELECT archive_pruned_at FROM external_full_snapshots WHERE id=$1',[ids[0]])).rows[0].archive_pruned_at,null);
   await database.pool.query('DELETE FROM external_full_archive_pins WHERE reference=$1',['synthetic-backup']);
   await worker!.pruneStaging();assert.ok((await database.pool.query('SELECT archive_pruned_at FROM external_full_snapshots WHERE id=$1',[ids[0]])).rows[0].archive_pruned_at);
  });
  await t.test('incomplete CSV never gets verified or publishes; staging remains resumable',async()=>{
   const id=randomUUID(),file=path.join(directory,`${id}.csv`),csv=Buffer.from(catalogColumns.join(',')+'\n'+catalogColumns.map(c=>c==='source'?'che168':c==='id'?'456':'').join(',')+'\n');await writeFile(file,csv);
   await database.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes) VALUES($1,$2,'staging',$3,$4,$5)",[id,at,file,'a'.repeat(64),csv.length]);
   await assert.rejects(worker!.snapshot());
   assert.equal((await database.pool.query('SELECT state FROM external_full_snapshots WHERE id=$1',[id])).rows[0].state,'staging');
   assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM external_full_members WHERE external_id='456'")).rows[0].n,0);
  });
  await t.test('410 preserves source membership and queued events and has a finite bound',async()=>{
   const count=(await database.pool.query('SELECT count(*) AS n FROM external_full_members')).rows[0].n;
   await worker!.recover();await worker!.recover();await assert.rejects(worker!.recover(),/SYNC_RECOVERY_LIMIT/);
   assert.equal((await database.pool.query('SELECT count(*) AS n FROM external_full_members')).rows[0].n,count);
   assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_full_events')).rows[0].n,5);
  });
 }finally{await worker?.close();await db?.close();await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await maintenance.close();await rm(directory,{recursive:true,force:true});}
});
