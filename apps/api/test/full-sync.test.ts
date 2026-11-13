import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,rename} from 'node:fs/promises';
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
   const originalSpace=worker!.space.bind(worker!),originalBudget=process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES,originalDecision=process.env.FULL_SYNC_CAPACITY_DECISION_FILE;
   const capacityDir=await mkdtemp(path.join(tmpdir(),'hd-full-decision-')),decisionFile=path.join(capacityDir,'decision.json');
   const approveCurrent=async()=>{
    const e=(await worker!.state()).capacity_estimate,measuredAt=Date.now();
    const decision={schemaVersion:1,model:'hd-ext07-peak-v1',snapshotId:e.snapshotId,targetRows:e.targetRows,sampleRows:e.sampleRows,evidenceHash:e.evidenceHash,
     measuredAt:new Date(measuredAt).toISOString(),expiresAt:new Date(measuredAt+600000).toISOString(),decision:'allow',reason:'within_budget',projectedPeakBytes:500000000,diskTotalBytes:1024**4,currentUsedBytes:0,components:{fixtureMeasuredPeak:500000000}};
    await writeFile(decisionFile+'.next',JSON.stringify(decision),{mode:0o600});await rename(decisionFile+'.next',decisionFile);
   };
   const waitForDecision=async()=>{await assert.rejects(worker!.tick(),/SYNC_CAPACITY_AWAITING_DECISION/);await approveCurrent();await worker!.tick();};
   try{
   process.env.FULL_SYNC_CAPACITY_DECISION_FILE=decisionFile;
   process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=String(1024**4);
   worker!.space=async()=>({used:0,available:1024**4,total:1024**4});
   assert.equal(await worker!.sampleRemaining(),0);assert.equal(await worker!.promoteSnapshot(snapshotId),0);
   assert.equal(await worker!.snapshot(),0);
   (client as unknown as {bulk:Function}).bulk=async function*(){throw new Error('New detail fetch must wait for the sample gate');};
   assert.equal(await worker!.details(),0);
   await assert.rejects(worker!.capacityGate(),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);assert.equal((await worker!.state()).capacity_pending,true);
   (client as unknown as {report:Function}).report=async()=>({payload:{hasReport:false},rawResponse:raw({hasReport:false})});
   await database.pool.query("INSERT INTO external_full_work(source,external_id,kind,generation) VALUES('dongchedi','100001','report',1)");
   // Exercise the actual scheduler with an active snapshot, a queued new identity and a pending sample report.
   await database.pool.query("UPDATE external_full_sync SET next_maintenance_at=now()+interval '1 day' WHERE id=1");
   feed.push({id:5,source:'che168',vehicleId:'123',type:'removed',at:'2026-11-14T00:00:04.000Z'});
   await worker!.receiveDelta();await assert.rejects(worker!.tick(),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);
   assert.equal((await database.pool.query("SELECT report_state FROM external_full_members WHERE source='dongchedi' AND external_id='100001'")).rows[0].report_state,'no_report');
   assert.equal((await database.pool.query("SELECT state FROM external_full_members WHERE source='che168' AND external_id='123'")).rows[0].state,'withdrawn');
   assert.equal((await database.pool.query('SELECT apply_cursor FROM external_full_snapshots WHERE id=$1',[snapshotId])).rows[0].apply_cursor,'10000');
   assert.equal((await database.pool.query("SELECT count(*)::integer AS n FROM external_full_members WHERE source='dongchedi'")).rows[0].n,10000);
   assert.equal((await database.pool.query("SELECT count(*)::integer AS n FROM external_source_documents WHERE kind='csv'")).rows[0].n,0);

   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);
   assert.equal((await worker!.state()).capacity_estimate.allowed,false,'An approved budget cannot replace the unfinished report sample');
   assert.equal((await worker!.state()).capacity_estimate.estimatedBytes,null);
   await assert.rejects(worker!.heavy(),/SYNC_CAPACITY_PENDING/);
   await database.pool.query("UPDATE external_full_members SET report_state='no_report' WHERE sampled");
   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_AWAITING_DECISION/);
   const stableHash=(await worker!.state()).capacity_estimate.evidenceHash;await approveCurrent();
   await worker!.estimateCapacity(snapshotId,20000000);
   const estimate=(await worker!.state()).capacity_estimate;
   const stageBytes=Number((await database.pool.query("SELECT pg_total_relation_size('external_full_stage')::text AS bytes")).rows[0].bytes);
   assert.equal(estimate.sqlStagingBytes,stageBytes);assert.ok(stageBytes>estimate.businessBytes);
   assert.equal(estimate.archiveDirectoryBytes,archive.length);
   assert.equal(estimate.actualBytesPerDetail,estimate.businessBytes/10000);
   assert.equal(estimate.fixedBytes,stageBytes+archive.length+estimate.walBytes);
   assert.equal(estimate.estimatedBytes,500000000,'Only the external component model supplies the peak; BE must not multiply it');
   assert.equal(estimate.evidenceHash,stableHash,'Polling/WAL/metadata writes must not invalidate the evidence hash');
   assert.equal(estimate.allowed,true);
   worker!.space=async()=>({used:.70,available:Math.floor(.30*1024**4),total:1024**4});
   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_LIMIT/);
   assert.equal((await worker!.state()).capacity_estimate.allowed,false,'70% remains a hard limit despite an approved budget');
   worker!.space=async()=>({used:0,available:1024**4,total:1024**4});
   process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES='1';
   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_BUDGET_CAP/);
   // A source update now invalidates the sample while capacity_pending is already true.
   feed.push({id:6,source:'dongchedi',vehicleId:'100001',type:'price',at:'2026-11-14T00:00:05.000Z'});
   await worker!.receiveDelta();
   await database.pool.query("INSERT INTO external_full_members(source,external_id,canonical_id,state) VALUES('dongchedi','200001','sample:unsampled','pending')");
   await database.pool.query("INSERT INTO external_full_work(source,external_id,kind,generation,priority) VALUES('dongchedi','200001','detail',1,1000),('dongchedi','200001','report',1,1000)");
   const repairs:string[]=[],reportRepairs:string[]=[];let repairId='100001';
   (client as unknown as {bulk:Function}).bulk=async function*(source:string,ids:string[],locale:string){
    assert.equal(source,'dongchedi');assert.deepEqual(ids,[repairId]);
    assert.equal((await worker!.state()).capacity_pending,true);
    repairs.push(locale);const payload={results:[{source,id:repairId,status:'active',hasInspectionReport:true}],notFound:[]};
    yield {...payload,rawResponse:raw(payload)};
   };
   (client as unknown as {report:Function}).report=async(source:string,id:string)=>{
    assert.equal(source,'dongchedi');assert.equal(id,repairId);
    assert.equal((await worker!.state()).capacity_pending,true);reportRepairs.push(id);
    return {payload:{hasReport:false},rawResponse:raw({hasReport:false})};
   };
   await database.pool.query('UPDATE external_full_sync SET paused=true WHERE id=1');
   await assert.rejects(worker!.details(true),/SYNC_HEAVY_PAUSED/);await assert.rejects(worker!.report(true),/SYNC_HEAVY_PAUSED/);
   await database.pool.query('UPDATE external_full_sync SET paused=false WHERE id=1');
   worker!.space=async()=>({used:.70,available:Math.floor(.30*1024**4),total:1024**4});
   await assert.rejects(worker!.details(true),/SYNC_HEAVY_PAUSED/);await assert.rejects(worker!.report(true),/SYNC_HEAVY_PAUSED/);
   worker!.space=async()=>({used:0,available:1024**4,total:1024**4});
   const dailyKinds:string[]=[];
   (client as unknown as {daily:Function}).daily=async(kind:string)=>{
    assert.equal(kind,'account');dailyKinds.push(kind);
    const payload={product:'chinacarapi',plan:'starter',sources:['che168','dongchedi'],expiresAt:'2099-01-01T00:00:00.000Z',dailyLimit:100000,remainingToday:100000};
    return {payload,rawResponse:raw(payload)};
   };
   await database.pool.query("UPDATE external_full_sync SET next_maintenance_at=now()-interval '1 day' WHERE id=1");
   // No approved override: the next estimate may pass only after actual sample repair and ample measured headroom.
   delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
   await waitForDecision();
   assert.deepEqual(repairs,['zh','en','ru']);assert.deepEqual(reportRepairs,['100001']);
   assert.deepEqual(dailyKinds,['account']);
   const repaired=(await database.pool.query("SELECT cardinality(locales) AS locales,report_state,applied_generation,desired_generation FROM external_full_members WHERE source='dongchedi' AND external_id='100001'")).rows[0];
   assert.equal(repaired.locales,3);assert.equal(repaired.report_state,'no_report');assert.equal(repaired.applied_generation,repaired.desired_generation);
   assert.equal((await worker!.state()).capacity_pending,false);assert.equal(await worker!.sampleRemaining(),500);
   assert.equal((await database.pool.query("SELECT count(*)::integer AS n FROM external_full_work WHERE source='dongchedi' AND external_id='200001'")).rows[0].n,2);
   assert.equal((await database.pool.query('SELECT apply_cursor FROM external_full_snapshots WHERE id=$1',[snapshotId])).rows[0].apply_cursor,'10000');
   await worker!.heavy();
   await writeFile(decisionFile,'{}',{mode:0o600});
   await assert.rejects(worker!.heavy(),/SYNC_CAPACITY_AWAITING_DECISION/);
   assert.equal((await worker!.state()).capacity_pending,true,'A previously accepted decision is re-read before later heavy work');
   await approveCurrent();await worker!.capacityGate();

   const rejectBudget=async()=>{
    await database.pool.query('UPDATE external_full_sync SET last_capacity_sample=0 WHERE id=1');
    process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES='1';
    await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_BUDGET_CAP/);
    assert.equal((await worker!.state()).capacity_pending,true);
    delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
   };
   // Withdrawal after a rejected estimate keeps the already measured sample slot; it does not admit a replacement car.
   await rejectBudget();
   feed.push({id:7,source:'dongchedi',vehicleId:'100002',type:'removed',at:'2026-11-14T00:00:06.000Z'});
   await worker!.receiveDelta();await worker!.applyEvents(true);
   assert.equal(await worker!.sampleRemaining(),0);
   await waitForDecision();
   let recovered=await worker!.state();
   assert.equal(recovered.capacity_pending,false);assert.equal(Number(recovered.last_capacity_sample),10000);
   assert.equal(recovered.capacity_estimate.detailSampleRows,10000);assert.equal(recovered.capacity_estimate.withdrawnSampleRows,1);
   assert.equal(recovered.capacity_estimate.activeDetailSampleRows,9999);
   assert.equal(recovered.capacity_estimate.confirmedNoReport,9999);
   assert.equal(recovered.capacity_estimate.projectedBytesPerDetail,Math.max(recovered.capacity_estimate.actualBytesPerDetail,recovered.capacity_baseline.detailSample.bytesPerDetail));
   assert.ok(recovered.capacity_estimate.projectedBytesPerDetail<128*1024,'Withdrawal must not invent a 128KiB per-vehicle cost');

   // An update can invalidate locales before the withdrawal arrives. A withdrawn record is terminal, never a fake report.
   await rejectBudget();
   feed.push({id:8,source:'dongchedi',vehicleId:'100003',type:'price',at:'2026-11-14T00:00:07.000Z'});
   await worker!.receiveDelta();await worker!.applyEvents();
   assert.equal((await database.pool.query("SELECT cardinality(locales) AS n FROM external_full_members WHERE source='dongchedi' AND external_id='100003'")).rows[0].n,0);
   feed.push({id:9,source:'dongchedi',vehicleId:'100003',type:'removed',at:'2026-11-14T00:00:08.000Z'});
   await worker!.receiveDelta();await waitForDecision();recovered=await worker!.state();
   assert.equal(recovered.capacity_pending,false);assert.equal(recovered.capacity_estimate.withdrawnSampleRows,2);
   assert.equal(recovered.capacity_estimate.threeLocaleCompleted,9998);assert.equal(recovered.capacity_estimate.confirmedNoReport,9998);

   // Explicit relist leaves the terminal state and must again fetch all locales and actually check report presence.
   await rejectBudget();repairId='100003';repairs.length=0;reportRepairs.length=0;
   feed.push({id:10,source:'dongchedi',vehicleId:'100003',type:'relisted',at:'2026-11-14T00:00:09.000Z'});
   await worker!.receiveDelta();await waitForDecision();recovered=await worker!.state();
   assert.deepEqual(repairs,['zh','en','ru']);assert.deepEqual(reportRepairs,['100003']);
   assert.equal(recovered.capacity_pending,false);assert.equal(recovered.capacity_estimate.withdrawnSampleRows,1);
   assert.equal(recovered.capacity_estimate.threeLocaleCompleted,9999);assert.equal(recovered.capacity_estimate.confirmedNoReport,9999);

   // Even a wholly withdrawn cohort can be reevaluated conservatively; no active member/report is invented.
   await rejectBudget();await database.pool.query("UPDATE external_full_members SET state='withdrawn' WHERE sampled");
   await waitForDecision();recovered=await worker!.state();
   assert.equal(recovered.capacity_pending,false);assert.equal(recovered.capacity_estimate.detailSampleRows,10000);
   assert.equal(recovered.capacity_estimate.withdrawnSampleRows,10000);assert.equal(recovered.capacity_estimate.activeDetailSampleRows,0);
   assert.equal(recovered.capacity_estimate.threeLocaleCompleted,0);assert.equal(recovered.capacity_estimate.reportCompleted,0);assert.equal(recovered.capacity_estimate.confirmedNoReport,0);
   assert.equal(recovered.capacity_estimate.projectedBytesPerDetail,Math.max(recovered.capacity_estimate.actualBytesPerDetail,recovered.capacity_baseline.detailSample.bytesPerDetail));
   assert.equal((await database.pool.query("SELECT count(*)::integer AS n FROM external_full_work WHERE source='dongchedi' AND external_id='200001'")).rows[0].n,2);
   assert.equal((await database.pool.query('SELECT apply_cursor FROM external_full_snapshots WHERE id=$1',[snapshotId])).rows[0].apply_cursor,'10000');
   const frozenHash=recovered.capacity_estimate.evidenceHash;
   await database.pool.query("UPDATE external_full_work SET due_at=now()+interval '1 day' WHERE external_id='200001'");
   await database.pool.query("INSERT INTO external_full_members(source,external_id,canonical_id,state) VALUES('dongchedi','200002','sample:unsampled2','pending')");
   await database.pool.query("INSERT INTO external_full_work(source,external_id,kind,generation) VALUES('dongchedi','200002','detail',1)");
   (client as unknown as {bulk:Function}).bulk=async function*(source:string,ids:string[]){
    assert.deepEqual(ids,['200002']);const payload={results:[{source,id:'200002',status:'active',hasInspectionReport:false}],notFound:[]};yield {...payload,rawResponse:raw(payload)};
   };
   assert.equal(await worker!.details(),1);
   assert.equal((await database.pool.query("SELECT sampled FROM external_full_members WHERE external_id='200002'")).rows[0].sampled,false);
   await worker!.estimateCapacity(snapshotId,20000000);recovered=await worker!.state();
   assert.equal(recovered.capacity_estimate.evidenceHash,frozenHash,'Later new identities do not rewrite the fixed sample');
   assert.equal(recovered.capacity_estimate.distinctProcessed,10001);
   const measuredBaseline=recovered.capacity_baseline;
   await database.pool.query("UPDATE external_full_sync SET capacity_baseline=capacity_baseline-'detailSample' WHERE id=1");
   process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=String(1024**4);
   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);
   const insufficient=(await worker!.state()).capacity_estimate;
   assert.equal(insufficient.estimatedBytes,null);assert.equal(insufficient.projectedBytesPerDetail,null);
   assert.equal(insufficient.allowed,false,'An unmeasured withdrawn cohort is insufficient evidence, not a capacity-limit claim');
   await database.pool.query('UPDATE external_full_sync SET capacity_baseline=$1 WHERE id=1',[JSON.stringify(measuredBaseline)]);
   }finally{
    worker!.space=originalSpace;if(originalBudget===undefined)delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;else process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=originalBudget;
    if(originalDecision===undefined)delete process.env.FULL_SYNC_CAPACITY_DECISION_FILE;else process.env.FULL_SYNC_CAPACITY_DECISION_FILE=originalDecision;
    await rm(capacityDir,{recursive:true,force:true});
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
   assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_full_events')).rows[0].n,10);
  });
 }finally{await worker?.close();await db?.close();await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await maintenance.close();await rm(directory,{recursive:true,force:true});}
});
