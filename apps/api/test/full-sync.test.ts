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
import {catalogColumns,persistSourceDocument} from '../src/external/sources/index.js';
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
  worker.space=async()=>({used:0,available:1024**4,total:1024**4});
  const withdrawalState=async()=>(await database.pool.query(`SELECT business_order::text,withdrawn
   FROM external_ingestion_identity_state WHERE provider='chinacarapi' AND source='che168' AND external_id='123'`)).rows[0];
  const assertNotAdmitted=async()=>{
   const footprint=(await database.pool.query(`SELECT
    EXISTS(SELECT 1 FROM external_formal_admissions WHERE source='che168' AND external_id='123') AS admitted,
    EXISTS(SELECT 1 FROM external_full_members WHERE source='che168' AND external_id='123') AS member,
    EXISTS(SELECT 1 FROM external_full_work WHERE source='che168' AND external_id='123') AS queued`)).rows[0];
   assert.deepEqual(footprint,{admitted:false,member:false,queued:false});
  };
  await t.test('raw page durable before application, replay idempotent and withdrawal wins',async()=>{
   await worker!.receiveDelta();let s=await fullSyncStatus(database);assert.equal(s.receivedEvents,2);assert.equal(s.appliedEvents,0);
   // Model a restart before the page checkpoint advanced: replay the very same event IDs.
   await database.pool.query('UPDATE external_full_sync SET receive_cursor=NULL WHERE id=1');
   await worker!.receiveDelta();assert.equal((await fullSyncStatus(database)).receivedEvents,2);
   await database.pool.query('UPDATE external_full_sync SET receive_cursor=NULL WHERE id=1');
   const first=feed[0]!;
   feed[0]={...first,vehicleId:'999'};
   await assert.rejects(worker!.receiveDelta(),/SYNC_EVENT_CONFLICT/);
   assert.equal((await worker!.state()).receive_cursor,null);
   feed[0]=first;
   await worker!.receiveDelta();
   assert.equal(await worker!.applyEvents(true),1);
   const pending=(await database.pool.query(`SELECT operation FROM external_full_events WHERE applied_at IS NULL ORDER BY event_id`)).rows;
   assert.deepEqual(pending,[{operation:'upsert'}]);
   assert.deepEqual(await withdrawalState(),{business_order:'2',withdrawn:true});
   await assertNotAdmitted();
   assert.equal(await worker!.applyEvents(),1);s=await fullSyncStatus(database);assert.equal(s.appliedEvents,2);
   assert.deepEqual(await withdrawalState(),{business_order:'2',withdrawn:true});
   await assertNotAdmitted();
   assert.deepEqual((await database.pool.query('SELECT operation FROM full_test_effects')).rows,[]);
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
   assert.deepEqual(await withdrawalState(),{business_order:'2',withdrawn:true});
   await assertNotAdmitted();
   feed.push({id:4,source:'che168',vehicleId:'123',type:'relisted',at:'2026-11-14T00:00:03.000Z'});await worker!.receiveDelta();await worker!.applyEvents();
   assert.deepEqual(await withdrawalState(),{business_order:'4',withdrawn:false});
   assert.equal((await database.pool.query("SELECT state FROM external_full_members WHERE source='che168' AND external_id='123'")).rows[0].state,'pending');
   assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM external_full_work WHERE source='che168' AND external_id='123' AND kind='detail'")).rows[0].n,1);
  });
  await t.test('a due daily export starts alongside an exhausted detail from the previous snapshot',async ctx=>{
   const before=await worker!.state();
   const scheduled=ctx.mock.method(worker!,'snapshot',async()=>0);
   ctx.mock.method(worker!,'details',async()=>0);
   ctx.mock.method(worker!,'report',async()=>0);
   ctx.mock.method(worker!,'capacityGate',async()=>{});
   ctx.mock.method(worker!,'rotate',async()=>{});
   ctx.mock.method(worker!,'pruneStaging',async()=>{});
   await database.pool.query(`UPDATE external_full_work SET attempts=5 WHERE source='che168' AND external_id='123' AND kind='detail'`);
   try {
    await database.pool.query(`UPDATE external_full_sync SET mode='continuous',next_delta_at=now()+interval '1 day',
     next_maintenance_at=now()+interval '1 day',next_snapshot_at=now()+interval '1 day' WHERE id=1`);
    await worker!.tick();
    assert.equal(scheduled.mock.callCount(),0);
    await database.pool.query("UPDATE external_full_sync SET next_snapshot_at=now()-interval '1 minute' WHERE id=1");
    await worker!.tick();
    assert.equal(scheduled.mock.callCount(),1);
    await database.pool.query("UPDATE external_full_sync SET mode='full' WHERE id=1");
    await worker!.tick();
    assert.equal(scheduled.mock.callCount(),1);
    await database.pool.query('UPDATE external_full_sync SET since_at=NULL WHERE id=1');
    await worker!.tick();
    assert.equal(scheduled.mock.callCount(),2);
    assert.equal((await database.pool.query("SELECT attempts FROM external_full_work WHERE source='che168' AND external_id='123' AND kind='detail'")).rows[0].attempts,5);
   } finally {
    await database.pool.query(`UPDATE external_full_sync SET mode=$1,next_delta_at=$2,next_maintenance_at=$3,next_snapshot_at=$4,since_at=$5 WHERE id=1`,
     [before.mode,before.next_delta_at,before.next_maintenance_at,before.next_snapshot_at,before.since_at]);
    await database.pool.query(`UPDATE external_full_work SET attempts=0 WHERE source='che168' AND external_id='123' AND kind='detail'`);
   }
  });
  await t.test('daily export cadence skips elapsed slots and leaves a minimum gap after completion',async()=>{
   const before=await worker!.state();
   const detail=(await database.pool.query("SELECT due_at FROM external_full_work WHERE source='che168' AND external_id='123' AND kind='detail'")).rows[0]!;
   const member=(await database.pool.query("SELECT last_snapshot FROM external_full_members WHERE source='che168' AND external_id='123'")).rows[0]!;
   try{
    await database.pool.query("UPDATE external_full_work SET due_at='infinity' WHERE source='che168' AND external_id='123' AND kind='detail'");
    for(const fixture of [
     {mode:'continuous',age:'6 hours',offset:'24 hours',anchor:'start'},
     {mode:'continuous',age:'60 hours',offset:'72 hours',anchor:'start'},
     {mode:'continuous',age:'23 hours 58 minutes',offset:'5 minutes',anchor:'completion'},
     {mode:'full',age:'6 hours',offset:'24 hours',anchor:'completion'},
    ]){
     const id=randomUUID();
     try{
      await database.pool.query('UPDATE external_full_sync SET mode=$1 WHERE id=1',[fixture.mode]);
      await database.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged,created_at)
       VALUES($1,$2,'verified',$3,1,1,now()-$4::interval)`,[id,at,path.join(directory,`${id}.csv.gz`),fixture.age]);
      await database.pool.query("INSERT INTO external_full_stage VALUES($1,1,'che168','123','{}')",[id]);
      assert.equal(await worker!.promoteSnapshot(id),1);
      const row=(await database.pool.query(`SELECT s.state,
       abs(extract(epoch FROM(f.next_snapshot_at-(CASE WHEN $2='start' THEN s.created_at ELSE s.completed_at END+$3::interval))))<1 AS scheduled
       FROM external_full_snapshots s CROSS JOIN external_full_sync f WHERE s.id=$1 AND f.id=1`,[id,fixture.anchor,fixture.offset])).rows[0];
      assert.deepEqual(row,{state:'complete',scheduled:true},`${fixture.mode} export started ${fixture.age} ago`);
     }finally{
      await database.pool.query('DELETE FROM external_full_stage WHERE snapshot_id=$1',[id]);
      await database.pool.query('DELETE FROM external_full_snapshots WHERE id=$1',[id]);
     }
    }
   }finally{
    await database.pool.query('UPDATE external_full_sync SET mode=$1,next_snapshot_at=$2 WHERE id=1',[before.mode,before.next_snapshot_at]);
    await database.pool.query("UPDATE external_full_work SET due_at=$1 WHERE source='che168' AND external_id='123' AND kind='detail'",[detail.due_at]);
    await database.pool.query("UPDATE external_full_members SET last_snapshot=$1 WHERE source='che168' AND external_id='123'",[member.last_snapshot]);
   }
  });
  await t.test('rotation treats observations in the complete and active exports as present',async()=>{
   const complete=randomUUID(),active=randomUUID(),ids=['800001','800002','800003','800004'];
   try{
    await database.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,created_at,completed_at) VALUES
     ($1,$3,'complete',$4,now()-interval '1 day',now()-interval '1 day'),($2,$3,'verified',$5,now(),NULL)`,
     [complete,active,at,path.join(directory,`${complete}.csv.gz`),path.join(directory,`${active}.csv.gz`)]);
    await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,last_snapshot,last_detail_at,desired_generation)
     VALUES ('che168',$1,$1,'active',$5,now(),7),('che168',$2,$2,'active',$6,now(),7),
      ('che168',$3,$3,'active',NULL,now(),7),('che168',$4,$4,'active',$6,now()-interval '8 days',7)`,[...ids,complete,active]);

    assert.equal(await worker!.rotate(),2);
    await database.pool.query("UPDATE external_full_snapshots SET state='applying' WHERE id=$1",[active]);
    assert.equal(await worker!.rotate(),0);
    const rows=(await database.pool.query(`SELECT m.desired_generation::text,m.verification_pending,w.generation::text AS queued
     FROM external_full_members m LEFT JOIN external_full_work w ON w.source=m.source AND w.external_id=m.external_id AND w.kind='detail'
     WHERE m.source='che168' AND m.external_id=ANY($1::text[]) ORDER BY m.external_id`,[ids])).rows;
    assert.deepEqual(rows,[{desired_generation:'7',verification_pending:false,queued:null},
     {desired_generation:'7',verification_pending:false,queued:null},{desired_generation:'8',verification_pending:true,queued:'8'},
     {desired_generation:'8',verification_pending:false,queued:'8'}]);
   }finally{
    await database.transaction(async tx=>{
     await tx.query("DELETE FROM external_full_work WHERE source='che168' AND external_id=ANY($1::text[])",[ids]);
     await tx.query("DELETE FROM external_full_members WHERE source='che168' AND external_id=ANY($1::text[])",[ids]);
     await tx.query(`WITH removed AS (DELETE FROM external_formal_admissions WHERE source='che168' AND external_id=ANY($1::text[]) RETURNING 1)
      UPDATE external_formal_admission_state SET admitted_count=admitted_count-(SELECT count(*) FROM removed) WHERE id=1`,[ids]);
     await tx.query('DELETE FROM external_full_snapshots WHERE id=ANY($1::uuid[])',[[complete,active]]);
    });
   }
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
   const approveCurrent=async(measuredAt=Date.now())=>{
    const e=(await worker!.state()).capacity_estimate;
    const decision={schemaVersion:1,model:'hd-ext07-peak-v1',snapshotId:e.snapshotId,targetRows:e.targetRows,sampleRows:e.sampleRows,evidenceHash:e.evidenceHash,
     measuredAt:new Date(measuredAt).toISOString(),expiresAt:new Date(measuredAt+600000).toISOString(),decision:'allow',reason:'SYNC_CAPACITY_VERIFIED',projectedPeakBytes:500000000,diskTotalBytes:1024**4,currentUsedBytes:0,components:{fixtureMeasuredPeak:500000000}};
    await writeFile(decisionFile+'.next',JSON.stringify(decision),{mode:0o600});await rename(decisionFile+'.next',decisionFile);
   };
   const waitForDecision=async()=>{await assert.rejects(worker!.tick(),/SYNC_CAPACITY_AWAITING_DECISION/);assert.equal(worker!.tickPhase,'capacity');await approveCurrent();await worker!.tick();};
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
   await database.pool.query(`UPDATE external_full_members SET event_order=event_order+1,desired_generation=desired_generation+1,
    applied_generation=desired_generation+1,last_detail_at=clock_timestamp(),report_checked_at=clock_timestamp()
    WHERE source='dongchedi' AND external_id='100010'`);
   await worker!.heavy();
   await database.pool.query("INSERT INTO external_full_work(source,external_id,kind,generation) VALUES('dongchedi','100010','detail',2)");
   await database.pool.query('UPDATE external_full_sync SET capacity_pending=true WHERE id=1');
   await worker!.tick();
   let resumed=await worker!.state();
   assert.equal(resumed.capacity_pending,false);
   assert.equal(resumed.capacity_estimate.evidenceHash,stableHash,'Completed equivalent refreshes retain the same approval');
   assert.equal(resumed.capacity_estimate.at,estimate.at,'Checking a ready receipt should not repeat the physical measurement');
   assert.equal((await database.pool.query("DELETE FROM external_full_work WHERE external_id='100010'")).rowCount,1,
    'A complete sample should validate the receipt before fetching a queued routine refresh');
   await approveCurrent(Date.now()-601_000);
   await assert.rejects(worker!.capacityGate(),/SYNC_CAPACITY_AWAITING_DECISION/);
   assert.equal((await worker!.state()).capacity_pending,true,'A recent measurement cannot authorize an expired receipt');
   await approveCurrent();
   await worker!.capacityGate();
   await database.pool.query(`UPDATE external_full_sync SET capacity_estimate=jsonb_set(capacity_estimate,'{at}',
    to_jsonb((clock_timestamp()-interval '31 seconds')::text)) WHERE id=1`);
   const sameMeasurementBinding=await worker!.capacityGate().catch((error:unknown)=>{
    assert.equal((error as {code?:string}).code,'SYNC_CAPACITY_AWAITING_DECISION');return false;
   });
   resumed=await worker!.state();
   assert.ok(Date.now()-Date.parse(resumed.capacity_estimate.at)<30_000,'Physical evidence must be measured again after its reuse limit');
   const beforeGrowthCost=resumed.capacity_baseline.detailSample.bytesPerDetail;
   if(sameMeasurementBinding)assert.equal(resumed.capacity_estimate.evidenceHash,stableHash);
   else {
    // Updating sampled rows can allocate real heap pages, especially in a small fixture.
    assert.ok(beforeGrowthCost>estimate.historicalBytesPerDetail);
    assert.equal(resumed.capacity_pending,true);
    await approveCurrent();
    await worker!.capacityGate();
   }
   await database.pool.query(`CREATE TABLE external_capacity_growth_fixture AS SELECT repeat(md5(g::text), 32) AS payload
    FROM generate_series(1,500) g`);
   await assert.rejects(worker!.estimateCapacity(snapshotId,20000000),/SYNC_CAPACITY_AWAITING_DECISION/);
   const higherCost=(await worker!.state()).capacity_baseline.detailSample.bytesPerDetail;
   assert.ok(higherCost>beforeGrowthCost,'Observed physical growth must raise the measured cost floor');
   await database.pool.query('DROP TABLE external_capacity_growth_fixture');
   await approveCurrent();
   await worker!.estimateCapacity(snapshotId,20000000);
   assert.equal((await worker!.state()).capacity_estimate.projectedBytesPerDetail,higherCost,
    'Later pruning must retain the historical cost floor');
   worker!.space=async()=>({used:.70,available:Math.floor(.30*1024**4),total:1024**4});
   await assert.rejects(worker!.capacityGate(),/SYNC_CAPACITY_LIMIT/);
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
   // The sample cannot use the receipt while incomplete. Repair restores the
   // same approved shape and may resume without issuing another receipt.
   delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
   const beforeEquivalentRepair=(await worker!.state()).capacity_estimate.evidenceHash;
   await worker!.tick();
   assert.equal((await worker!.state()).capacity_estimate.evidenceHash,beforeEquivalentRepair);
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

   // A later-received event with an older business time cannot undo that relist.
   feed.push({id:11,source:'dongchedi',vehicleId:'100003',type:'removed',at:'2026-11-14T00:00:08.500Z'});
   await worker!.receiveDelta();assert.equal(await worker!.applyEvents(true),1);
   assert.deepEqual((await database.pool.query("SELECT state,event_order::text FROM external_full_members WHERE source='dongchedi' AND external_id='100003'")).rows[0],
    {state:'active',event_order:'10'});

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
   const queued:Change={id:feed.at(-1)!.id+1,source:'che168',vehicleId:'424242',type:'new',at};
   feed.push(queued);
   await worker!.receiveDelta();
   const retained=async()=>({
    members:(await database.pool.query('SELECT source,external_id,canonical_id,state FROM external_full_members ORDER BY source,external_id')).rows,
    events:(await database.pool.query(`SELECT event_id::text,source,external_id,operation,applied_at,document_refs
     FROM external_full_events ORDER BY event_id`)).rows,
   });
   const before=await retained();
   const received=before.events.find(event=>event.event_id===String(queued.id));
   assert.equal(received?.applied_at,null);
   assert.ok(received?.document_refs.length);
   await worker!.recover();await worker!.recover();await assert.rejects(worker!.recover(),/SYNC_RECOVERY_LIMIT/);
   assert.deepEqual(await retained(),before);
  });
  await t.test('CSV image evidence does not invalidate previously imported detail',async()=>{
   const externalId='812344';
   // Keep earlier cases' queued fixture work out of this promotion batch.
   await database.pool.query("UPDATE external_full_work SET due_at='infinity' WHERE kind='detail'");
   await database.pool.query('UPDATE external_full_members SET sampled=false WHERE sampled');
   async function applySnapshot(price:string,image?:string){
    const id=randomUUID(),file=path.join(directory,`${id}.csv`);
    const row={source:'che168',id:externalId,price_cny:price} as Record<string,string>;
    const columns=image===undefined?catalogColumns:[...catalogColumns,'image'];
    if(image!==undefined)row.image=image;
    const csv=Buffer.from(columns.join(',')+'\n'+columns.map(column=>row[column]??'').join(',')+'\n');
    await writeFile(file,csv);
    await database.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes) VALUES($1,$2,'staging',$3,$4,$5)",[id,at,file,createHash('sha256').update(csv).digest('hex'),csv.length]);
    await worker!.snapshot();
    assert.equal((await database.pool.query('SELECT state FROM external_full_snapshots WHERE id=$1',[id])).rows[0].state,'complete');
    return id;
   }
   await applySnapshot('70000');
   await database.pool.query("UPDATE external_full_members SET state='active',last_detail_at=now(),locales=ARRAY['zh','en','ru'],sampled=false WHERE source='che168' AND external_id=$1",[externalId]);
   await database.pool.query("DELETE FROM external_full_work WHERE source='che168' AND external_id=$1 AND kind='detail'",[externalId]);
   const image='https://example.invalid/photo.jpg';
   const id=await applySnapshot('70000',image);
   const unchanged=(await database.pool.query(`SELECT state,last_snapshot,locales,
     EXISTS(SELECT 1 FROM external_full_work w WHERE w.source=m.source AND w.external_id=m.external_id AND w.kind='detail') AS queued
     FROM external_full_members m WHERE source='che168' AND external_id=$1`,[externalId])).rows[0];
   assert.deepEqual(unchanged,{state:'active',last_snapshot:id,locales:['zh','en','ru'],queued:false});
   assert.equal((await database.pool.query("SELECT payload->>'image' AS image FROM external_full_stage WHERE snapshot_id=$1",[id])).rows[0].image,image);
   await applySnapshot('71000',image);
   assert.equal((await database.pool.query("SELECT count(*)::integer AS jobs FROM external_full_work WHERE source='che168' AND external_id=$1 AND kind='detail'",[externalId])).rows[0].jobs,1);
  });
  await t.test('report 404 uses the report transaction and retry boundary',async()=>{
   const failed='812345',healthy='812346',missing='812347',retired='812348',replaced='812349',stale='812350',leaseLost='812351';
   const calls:string[]=[];
   const reportClient=new FullSyncClient('synthetic-key',{wait:async()=>{},fetch:async input=>{
    const url=new URL(String(input)),id=url.pathname.split('/').at(-1)!;
    assert.equal(url.pathname,`/api/inspection/${id}`);
    assert.equal(url.searchParams.get('source'),'che168');
    calls.push(id);
    if(id===leaseLost){await worker!.close();throw new Error('Synthetic transport interruption after lease loss');}
    if(id===healthy)return Response.json({id,source:'che168',summary:[{area:'Fixture report',result:'Checked'}]});
    if(id===retired||id===replaced){
     await database.pool.query("UPDATE external_full_members SET desired_generation=8 WHERE source='che168' AND external_id=$1",[id]);
     if(id===replaced)await database.pool.query(`UPDATE external_full_work SET generation=8,due_at=now()+interval '1 day'
      WHERE source='che168' AND external_id=$1 AND kind='report'`,[id]);
    }
    return new Response(null,{status:404});
   }});
   const applyReport:FullApply=async(tx,input)=>{
    for(const document of input.documents)await persistSourceDocument(tx,document);
    await apply(tx,input);
    if(input.externalId===failed)throw new Error('Synthetic report projection failure after archive write');
   };
   const space=worker!.space;
   await worker!.close();
   worker=new FullSyncWorker(database,reportClient,directory,applyReport);
   worker.space=space;
   assert.equal(await worker.acquire(),true);

   await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,desired_generation,applied_generation,report_state)
    SELECT 'che168',id,'report-fixture:'||id,'active',7,7,'pending' FROM unnest($1::text[]) AS ids(id)`,[[failed,healthy,missing,retired,replaced,stale]]);
   await database.pool.query("UPDATE external_full_members SET desired_generation=8 WHERE source='che168' AND external_id=$1",[stale]);
   await database.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,due_at)
    VALUES ('che168',$1,'report',7,105,$7),('che168',$2,'report',7,104,$7),('che168',$3,'report',7,103,$7),
     ('che168',$4,'report',7,102,$7),('che168',$5,'report',7,101,$7),('che168',$6,'report',7,106,$7)`,[failed,healthy,missing,retired,replaced,stale,at]);

   assert.equal(await worker.report(),1);
   assert.deepEqual(calls,[]);
   assert.equal((await database.pool.query("SELECT 1 FROM external_full_work WHERE source='che168' AND external_id=$1 AND kind='report'",[stale])).rowCount,0);
   assert.equal(await worker.report(),0);
   const failure=(await database.pool.query(`SELECT w.generation::text,w.attempts,w.last_error_code,
     w.due_at>now() AND w.due_at<=now()+interval '1 minute' AS backed_off,m.report_state,m.report_checked_at,
     EXISTS(SELECT 1 FROM external_source_documents d WHERE d.source=w.source AND d.external_id=w.external_id AND d.kind='report') AS documented,
     EXISTS(SELECT 1 FROM full_test_effects e WHERE e.source=w.source AND e.external_id=w.external_id) AS applied
    FROM external_full_work w JOIN external_full_members m USING(source,external_id)
    WHERE w.source='che168' AND w.external_id=$1 AND w.kind='report'`,[failed])).rows[0];
   assert.deepEqual(failure,{generation:'7',attempts:1,last_error_code:'SYNC_REPORT_404_APPLY_FAILED',backed_off:true,
    report_state:'pending',report_checked_at:null,documented:false,applied:false});

   assert.equal(await worker.report(),1);
   assert.equal(await worker.report(),1);
   const settled=(await database.pool.query(`SELECT m.external_id,m.report_state,m.report_checked_at IS NOT NULL AS checked,
     EXISTS(SELECT 1 FROM external_full_work w WHERE w.source=m.source AND w.external_id=m.external_id AND w.kind='report') AS queued
    FROM external_full_members m WHERE m.source='che168' AND m.external_id=ANY($1::text[]) ORDER BY m.external_id`,[[healthy,missing]])).rows;
   assert.deepEqual(settled,[{external_id:healthy,report_state:'available',checked:true,queued:false},
    {external_id:missing,report_state:'unavailable',checked:true,queued:false}]);
   const observation=(await database.pool.query(`SELECT merged_payload->'observation' AS observation FROM external_source_heads
    WHERE provider='chinacarapi' AND source='che168' AND external_id=$1 AND kind='report' AND locale='en'`,[missing])).rows[0];
   assert.deepEqual(observation,{observation:{httpStatus:404,kind:'transport_observation'}});

   await worker.report();
   await worker.report();
   assert.deepEqual(calls,[failed,healthy,missing,retired,replaced]);
   const remaining=(await database.pool.query(`SELECT external_id,generation::text,attempts FROM external_full_work
    WHERE source='che168' AND external_id=ANY($1::text[]) AND kind='report'`,[[retired,replaced]])).rows;
   assert.deepEqual(remaining,[{external_id:replaced,generation:'8',attempts:0}]);
   assert.equal((await database.pool.query(`SELECT count(*)::integer AS n FROM external_source_documents
    WHERE source='che168' AND external_id=ANY($1::text[]) AND kind='report'`,[[retired,replaced]])).rows[0].n,0);

   await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,desired_generation,applied_generation,report_state)
    VALUES('che168',$1,'report-fixture:'||$1,'active',7,7,'pending')`,[leaseLost]);
   await database.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,due_at)
    VALUES('che168',$1,'report',7,999,$2)`,[leaseLost,at]);
   await assert.rejects(worker.report(),/SYNC_LEASE_LOST/);
   assert.deepEqual((await database.pool.query(`SELECT attempts,last_error_code FROM external_full_work
    WHERE source='che168' AND external_id=$1 AND kind='report'`,[leaseLost])).rows[0],{attempts:0,last_error_code:null});
  });
 }finally{await worker?.close();await db?.close();await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await maintenance.close();await rm(directory,{recursive:true,force:true});}
});
