import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {rememberFormalWithdrawal} from '../src/external/formal-admission.js';
import type {FullSyncClient} from '../src/external/full-sync/client.js';
import {configureFullSync,FullSyncWorker} from '../src/external/full-sync/engine.js';
import type {Change,Source} from '../src/external/full-sync/types.js';
import {jsonHash} from '../src/external/normalize.js';

test('supplier detail refresh preserves real report coverage only for the same listing lifecycle',async t=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)
  throw new Error('Use isolated loopback maintenance PostgreSQL.');
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network in report continuity tests');});
 const name=`hd_full_report_coverage_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.toString(),1);
 const directory=await mkdtemp(path.join(tmpdir(),'hd-full-report-coverage-'));
 url.pathname=`/${name}`;
 const db=createDatabase(url.toString(),2);
 let created=false;
 const at='2026-11-14T00:00:00.000Z',checkedAt='2026-11-14T00:00:01.000Z';
 const raw=(value:unknown)=>{
  const body=JSON.stringify(value);
  return {hash:createHash('sha256').update(body).digest('hex'),body};
 };
 const details=new Map<string,Record<string,unknown>>();
 let feed:Change[]=[];
 const client={
  changes:async(_since:string,cursor:string|null)=>{
   const changes=feed.filter(event=>event.id>Number(cursor??0));
   const data={cursor:Number(cursor??0),nextCursor:changes.at(-1)?.id??Number(cursor??0),hasMore:false,changes};
   return {...data,rawResponse:raw(data)};
  },
  bulk:async function*(source:Source,ids:string[]){
   const results=ids.map(id=>({source,id,status:'active',...details.get(id)}));
   yield {results,notFound:[],rawResponse:raw({results,notFound:[]})};
  },
 } as unknown as FullSyncClient;
 const worker=new FullSyncWorker(db,client,directory,async()=>{});
 worker.space=async()=>({used:0,available:1024**4,total:1024**4});
 const seed=async(id:string,reportState:string,hasReport:boolean,checked:string|null,state='active')=>{
  await db.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,locales,business_at,last_detail_at,
    desired_generation,applied_generation,has_report,report_state,report_checked_at,sampled)
    VALUES('che168',$1,'chinacarapi:che168:'||$1,$2,ARRAY['zh','en','ru'],$3,$3,1,1,$4,$5,$6,true)`,
  [id,state,at,hasReport,reportState,checked]);
 };
 const cover=async(id:string)=>(await db.pool.query(`SELECT state,has_report,report_state,report_checked_at,
    (SELECT generation::text FROM external_full_work w WHERE w.source=m.source AND w.external_id=m.external_id AND w.kind='report') AS queued
    FROM external_full_members m WHERE source='che168' AND external_id=$1`,[id])).rows[0];
 const lifecycle=async()=>(await db.pool.query("SELECT capacity_baseline->>'sampleLifecycleEpoch' AS epoch FROM external_full_sync WHERE id=1")).rows[0].epoch;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;
  await migrateDatabase(db);
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('sync-report-test','Sync fixture','sync-report@example.invalid','admin',false)");
  await configureFullSync(db,{id:'sync-report-test',requestId:'report-continuity'},'continuous');
  await db.pool.query('UPDATE external_full_sync SET since_at=$1 WHERE id=1',[at]);
  assert.equal(await worker.acquire(),true);

  await t.test('verified true reports remain available or unavailable while the recheck is queued',async()=>{
   const epoch=await lifecycle();
   const fixtures=[
    {id:'501',previous:'available',hasReport:true,checked:checkedAt,next:{hasInspectionReport:true},state:'available',expectedReport:true,queued:'2'},
    {id:'502',previous:'unavailable',hasReport:true,checked:checkedAt,next:{inspectionAvailable:true},state:'unavailable',expectedReport:true,queued:'2'},
    {id:'503',previous:'no_report',hasReport:false,checked:checkedAt,next:{hasInspectionReport:true},state:'pending',expectedReport:true,queued:'2'},
    {id:'504',previous:'available',hasReport:true,checked:null,next:{hasInspectionReport:true},state:'pending',expectedReport:true,queued:'2'},
    {id:'505',previous:'available',hasReport:true,checked:checkedAt,next:{hasInspectionReport:false},state:'no_report',expectedReport:false,queued:null},
    {id:'506',previous:'available',hasReport:true,checked:checkedAt,next:{},state:'pending',expectedReport:false,queued:'2'},
   ];
   for(const f of fixtures){
    await seed(f.id,f.previous,f.hasReport,f.checked);
    details.set(f.id,f.next);
   }
   feed=fixtures.map((f,index)=>({id:index+1,source:'che168',vehicleId:f.id,type:'price',at:'2026-11-14T00:01:00.000Z'}));
   await worker.receiveDelta();
   assert.equal(await worker.applyEvents(),fixtures.length);
   assert.equal(await worker.details(),fixtures.length);
   for(const f of fixtures)assert.deepEqual(await cover(f.id),{
    state:'active',has_report:f.expectedReport,report_state:f.state,report_checked_at:f.checked?new Date(f.checked):null,queued:f.queued,
   });
   assert.equal(await lifecycle(),epoch);
  });

  await t.test('an explicit relist cannot carry checked coverage across the lifecycle boundary',async()=>{
   const epoch=await lifecycle();
   feed=[{id:7,source:'che168',vehicleId:'501',type:'relisted',at:'2026-11-14T00:02:00.000Z'}];
   await worker.receiveDelta();
   assert.equal(await worker.applyEvents(),1);
   assert.deepEqual(await cover('501'),{state:'pending',has_report:false,report_state:'unknown',report_checked_at:null,queued:'2'});
   const relistedEpoch=await lifecycle();
   assert.notEqual(relistedEpoch,epoch);
   assert.equal(await worker.details(),1);
   assert.deepEqual(await cover('501'),{state:'active',has_report:true,report_state:'pending',report_checked_at:null,queued:'3'});
   assert.equal(await lifecycle(),relistedEpoch);
  });

  await t.test('a removal observed in detail invalidates the measured sample lifecycle',async()=>{
   const epoch=await lifecycle();
   details.set('502',{status:'removed',hasInspectionReport:true});
   feed=[{id:8,source:'che168',vehicleId:'502',type:'price',at:'2026-11-14T00:02:00.000Z'}];
   await worker.receiveDelta();
   assert.equal(await worker.applyEvents(),1);
   assert.equal(await lifecycle(),epoch);
   assert.equal(await worker.details(),1);
   assert.equal((await cover('502')).state,'withdrawn');
   assert.notEqual(await lifecycle(),epoch);
  });

  await t.test('a newer CSV recovery drops stale coverage for withdrawn and tombstoned listings',async()=>{
   // Reset synthetic cohort membership so this three-row snapshot can be promoted under the bootstrap gate.
   await db.pool.query('UPDATE external_full_members SET sampled=false');
   await seed('507','available',true,checkedAt,'withdrawn');
   await seed('508','available',true,checkedAt);
   await seed('509','available',true,checkedAt,'withdrawn');
   await db.pool.query("UPDATE external_full_members SET sampled=false WHERE source='che168' AND external_id='509'");
   await db.transaction(async tx=>{
    await rememberFormalWithdrawal(tx,'che168','508','20',new Date('2026-11-14T00:02:00.000Z'));
    await rememberFormalWithdrawal(tx,'che168','509','21',new Date('2026-11-14T00:04:00.000Z'));
   });
   const snapshot=randomUUID();
   await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged)
     VALUES($1,'2026-11-14T00:03:00.000Z','verified',$2,3,3)`,[snapshot,path.join(directory,'fixture.csv.gz')]);
   await db.pool.query(`INSERT INTO external_full_stage(snapshot_id,row_number,source,external_id,payload)
     SELECT $1,number,'che168',id,jsonb_build_object('source','che168','id',id,'has_report','true')
     FROM unnest(ARRAY['507','508','509']) WITH ORDINALITY AS rows(id,number)`,[snapshot]);
   const epoch=await lifecycle();
   assert.equal(await worker.promoteSnapshot(snapshot),3);
   assert.notEqual(await lifecycle(),epoch);
   for(const id of ['507','508'])assert.deepEqual(await cover(id),{
    state:'pending',has_report:true,report_state:'unknown',report_checked_at:null,queued:null,
   });
   assert.deepEqual(await cover('509'),{state:'withdrawn',has_report:true,report_state:'available',report_checked_at:new Date(checkedAt),queued:null});
  });
 }finally{
  await worker.close();
  await db.close();
  try{if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
  finally{await maintenance.close();await rm(directory,{recursive:true,force:true});}
 }
});

test('capacity repair reaches the real report gap ahead of ordinary rechecks across CSV chunks',async t=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)
  throw new Error('Use isolated loopback maintenance PostgreSQL.');
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network in capacity repair tests');});
 const name=`hd_full_report_repair_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.toString(),1);
 const directory=await mkdtemp(path.join(tmpdir(),'hd-full-report-repair-')),decisionFile=path.join(directory,'decision.json');
 const previousDecision=process.env.FULL_SYNC_CAPACITY_DECISION_FILE,previousBudget=process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
 url.pathname=`/${name}`;
 const db=createDatabase(url.toString(),2);
 let created=false;
 const ids=Array.from({length:301},(_,index)=>String(600001+index));
 const changed=[ids[0]!,ids[100]!,ids[200]!],gap=ids[279]!;
 const rechecks=ids.filter(id=>!changed.includes(id)).slice(0,142);
 const reportRequests:string[]=[];
 const raw=(value:unknown)=>{
  const body=JSON.stringify(value);
  return {hash:createHash('sha256').update(body).digest('hex'),body};
 };
 const client={
  report:async(source:Source,id:string)=>{
   reportRequests.push(id);
   const payload={source,id,available:true,summary:[]};
   return {payload,rawResponse:raw(payload)};
  },
  bulk:async function*(source:Source,requested:string[]){
   const results=requested.map(id=>({source,id,status:'active',hasInspectionReport:true}));
   yield {results,notFound:[],rawResponse:raw({results,notFound:[]})};
  },
 } as unknown as FullSyncClient;
 const worker=new FullSyncWorker(db,client,directory,async()=>{});
 const diskTotal=1024**4;
 worker.space=async()=>({used:0,available:diskTotal,total:diskTotal});
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;
  await migrateDatabase(db);
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('report-repair-admin','Sync fixture','report-repair@example.invalid','admin',false)");
  await configureFullSync(db,{id:'report-repair-admin',requestId:'report-repair'},'continuous');
  assert.equal(await worker.acquire(),true);
  process.env.FULL_SYNC_CAPACITY_DECISION_FILE=decisionFile;process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES='0';
  const snapshot=randomUUID(),csvRows=ids.map(id=>({source:'che168',id,has_report:'true'}));
  await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,bytes,rows,staged,target_rows)
    VALUES($1,now(),'verified',$2,100,301,301,301)`,[snapshot,path.join(directory,'fixture.csv.gz')]);
  await db.pool.query(`INSERT INTO external_full_stage(snapshot_id,row_number,source,external_id,payload)
    SELECT $1,n,'che168',id,payload::jsonb FROM unnest($2::text[],$3::text[]) WITH ORDINALITY AS rows(id,payload,n)`,
  [snapshot,ids,csvRows.map(row=>JSON.stringify(row))]);
  await db.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,applied_generation,locales,
    sampled,last_detail_at,csv_hash,has_report,report_state,report_checked_at)
    SELECT 'che168',id,'fixture:'||id,'active',1,ARRAY['zh','en','ru'],true,now(),hash,
      id=ANY($3::text[]) OR id=$4,CASE WHEN id=$4 THEN 'pending' WHEN id=ANY($3::text[]) THEN 'available' ELSE 'no_report' END,
      CASE WHEN id=ANY($3::text[]) THEN now() END FROM unnest($1::text[],$2::text[]) AS rows(id,hash)`,
  [ids,csvRows.map(row=>changed.includes(row.id)?null:jsonHash(row)),rechecks,gap]);
  await db.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,queued_at)
    SELECT 'che168',id,'report',1,10,now()-interval '1 hour'+n*interval '1 second'
    FROM unnest($1::text[]) WITH ORDINALITY AS rows(id,n)`,[[...rechecks,gap]]);
  const csvState=async()=>(await db.pool.query("SELECT state,apply_cursor::int AS cursor FROM external_full_snapshots WHERE id=$1",[snapshot])).rows[0];
  const reportState=async(id:string)=>(await db.pool.query("SELECT report_state FROM external_full_members WHERE source='che168' AND external_id=$1",[id])).rows[0].report_state;
  const allowCapacity=async()=>{
   await assert.rejects(worker.capacityGate(),/SYNC_CAPACITY_AWAITING_DECISION/);
   const state=await worker.state(),estimate=state.capacity_estimate;
   assert.equal(state.capacity_pending,true);assert.equal(estimate.sampleEvidenceSufficient,true);
   const measuredAt=Date.now();
   await writeFile(decisionFile,JSON.stringify({schemaVersion:1,model:'hd-ext07-peak-v1',snapshotId:snapshot,targetRows:estimate.targetRows,
    sampleRows:estimate.sampleRows,evidenceHash:estimate.evidenceHash,measuredAt:new Date(measuredAt).toISOString(),
    expiresAt:new Date(measuredAt+300_000).toISOString(),decision:'allow',reason:'SYNC_CAPACITY_VERIFIED',
    diskTotalBytes:diskTotal,projectedPeakBytes:1e9,currentUsedBytes:0,components:{fixture:1e9}}),{mode:0o600});
   assert.equal(await worker.capacityGate(),true);
   assert.equal((await worker.state()).capacity_pending,false);
  };

  await assert.rejects(worker.capacityGate(),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);
  assert.deepEqual(await csvState(),{state:'verified',cursor:0});
  assert.equal(await worker.report(true),1);
  assert.deepEqual(reportRequests,[gap],'repair must pick the rank-143 gap first');
  assert.equal(await reportState(gap),'available');

  const controls=['700001','700002','700003','700004','700005','700006'];
  await db.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,applied_generation,report_state,sampled,last_detail_at)
    SELECT 'che168',id,'fixture:'||id,CASE WHEN n=4 THEN 'withdrawn' ELSE 'active' END,1,'pending',n<>5,
      CASE WHEN n<>6 THEN now() END FROM unnest($1::text[]) WITH ORDINALITY AS rows(id,n)`,[controls]);
  await db.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority,attempts,due_at)
    SELECT 'che168',id,'report',CASE WHEN n=1 THEN 0 ELSE 1 END,20,CASE WHEN n=3 THEN 5 ELSE 0 END,
      CASE WHEN n=2 THEN now()+interval '1 hour' ELSE now() END FROM unnest($1::text[]) WITH ORDINALITY AS rows(id,n)`,[controls]);
  assert.equal(await worker.report(true),0,'stale, future, exhausted, withdrawn, unsampled and unmaterialized reports cannot repair the cohort');
  assert.deepEqual(reportRequests,[gap]);
  await db.pool.query("DELETE FROM external_full_work WHERE external_id=ANY($1::text[])",[controls]);
  await db.pool.query("DELETE FROM external_full_members WHERE external_id=ANY($1::text[])",[controls]);
  await allowCapacity();

  for(const [index,id] of changed.entries()){
   await assert.rejects(worker.promoteSnapshot(snapshot),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);
   assert.deepEqual(await csvState(),{state:'applying',cursor:(index+1)*100});
   assert.equal(await worker.report(true),0,'repair must leave ordinary rechecks queued before the target detail is complete');
   assert.equal(await worker.details(true),1);
   assert.equal(await reportState(id),'pending');
   assert.equal(await worker.report(true),1);
   assert.equal(reportRequests.at(-1),id);
   assert.equal(await reportState(id),'available');
   await allowCapacity();
  }
  assert.deepEqual(reportRequests,[gap,...changed]);
  assert.equal(await worker.promoteSnapshot(snapshot),1);
  assert.deepEqual(await csvState(),{state:'complete',cursor:301});
  assert.equal(await worker.report(),1);
  assert.equal(reportRequests.at(-1),rechecks[0],'ordinary rechecks preserve their FIFO order');
 }finally{
  if(previousDecision===undefined)delete process.env.FULL_SYNC_CAPACITY_DECISION_FILE;else process.env.FULL_SYNC_CAPACITY_DECISION_FILE=previousDecision;
  if(previousBudget===undefined)delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;else process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=previousBudget;
  await worker.close();await db.close();
  try{if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
  finally{await maintenance.close();await rm(directory,{recursive:true,force:true});}
 }
});
