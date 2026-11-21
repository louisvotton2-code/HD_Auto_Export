import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {copyFile,mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {admitFormalListing,formalAdmissionInstalled,DEFAULT_FORMAL_LISTING_LIMIT} from '../src/external/formal-admission.js';
import {bindAlias} from '../src/external/full-sync/apply.js';
import {verifiedSnapshotTarget} from '../src/external/full-sync/capacity.js';
import type {FullSyncClient} from '../src/external/full-sync/client.js';
import {configureFullSync,FullSyncWorker} from '../src/external/full-sync/engine.js';
import type {FullApply,Source} from '../src/external/full-sync/types.js';
import {hydratePending} from '../src/external/ingestion/hydrate.js';
import type {ChinaCarClient} from '../src/external/ingestion/provider.js';
import {createImportJob,FixedScopeWorker,receivePage,verifySnapshot} from '../src/external/ingestion/worker.js';
import type {IngestionEvent} from '../src/external/ingestion/types.js';
import {catalogColumns} from '../src/external/sources/index.js';

const earlier='2026-11-14T00:00:00.000Z';
const at='2026-11-14T01:00:00.000Z';

test('formal listing admissions persist across CSV and delta runs, including existing rows and withdrawals',async t=>{
 const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(address.protocol)||address.hostname!=='127.0.0.1'||address.pathname!=='/postgres'||address.search||address.hash)
  throw new Error('This test requires isolated loopback PostgreSQL.');
 const name='hd_admission_'+randomBytes(8).toString('hex');
 const maintenance=createDatabase(address.toString(),1);
 const directory=await mkdtemp(path.join(tmpdir(),'hd-admission-'));
 let db:Database|undefined,worker:FullSyncWorker|undefined;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  address.pathname='/'+name;
  const database=db=createDatabase(address.toString(),4);
  const previous=path.join(directory,'previous');
  await mkdir(path.join(previous,'meta'),{recursive:true});
  const source=new URL('../migrations/',import.meta.url);
  const journal=JSON.parse(await readFile(new URL('meta/_journal.json',source),'utf8'));
  const entries=journal.entries as Array<{idx:number;tag:string}>;
  journal.entries=entries.filter(entry=>entry.idx<28);
  await Promise.all(journal.entries.map(({tag}:{tag:string})=>copyFile(new URL(tag+'.sql',source),path.join(previous,tag+'.sql'))));
  await writeFile(path.join(previous,'meta/_journal.json'),JSON.stringify(journal));
  await migrate(database.orm,{migrationsFolder:previous});
  assert.equal(await formalAdmissionInstalled(database.pool),false);
  const actor={id:'admission-admin',requestId:'admission-test'};
  await assert.rejects(configureFullSync(database,actor,'full'),/SYNC_ADMISSION_MIGRATION_REQUIRED/);
  await database.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Synthetic admission operator','admission@example.invalid','admin',false)",[actor.id]);
  const insertListing=(provider:string,id:string)=>database.pool.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,
    source_hash,source_data,upstream_state,fetched_at,published_at,formal_canonical_id) VALUES($1,$2,'che168',$3,1,'fixture','{}','active',$4,$4,$5)`,
   [randomUUID(),provider,id,earlier,provider==='chinacarapi'?'shared-canonical':null]);
  await insertListing('chinacarapi','101');
  await insertListing('synthetic','101');
  await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,event_order,business_at,last_detail_at) VALUES
   ('che168','101','shared-canonical','active',0,$1,NULL),
   ('dongchedi','101','shared-canonical','withdrawn',5,$1,$1),
   ('che168','103','pure-withdrawal','withdrawn',8,$1,NULL)`,[earlier]);
  const admissionMigration=entries.find(entry=>entry.idx===28)!;
  await copyFile(new URL(admissionMigration.tag+'.sql',source),path.join(previous,admissionMigration.tag+'.sql'));
  await writeFile(path.join(previous,'meta/_journal.json'),JSON.stringify({...journal,entries:[...journal.entries,admissionMigration]}));
  await migrate(database.orm,{migrationsFolder:previous});
  await t.test('the expanded release reopens the verified CSV behind a fresh capacity decision',async()=>{
   const id=randomUUID();
   await database.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged,apply_cursor,target_rows,completed_at)
    VALUES($1,$2,'complete',$3,3,3,3,2,now())`,[id,earlier,path.join(directory,id+'.csv.gz')]);
   await database.pool.query(`INSERT INTO external_full_stage VALUES
    ($1,1,'che168','101','{}'),($1,2,'che168','103','{}'),($1,3,'che168','104','{}')`,[id]);
   await database.pool.query(`UPDATE external_full_sync SET enabled=true,paused=false,last_capacity_sample=10000 WHERE id=1`);
   // A short retained fixture must leave the old database ceiling in place.
   await assert.rejects(migrateDatabase(database));
   const oldDefinition=(await database.pool.query("SELECT pg_get_functiondef('reserve_external_formal_listing(text,text)'::regprocedure) AS definition")).rows[0].definition;
   assert.match(oldDefinition,/admitted_count<100000/);
   await database.pool.query('UPDATE external_formal_admission_state SET admitted_count=$1 WHERE id=1',[DEFAULT_FORMAL_LISTING_LIMIT-1]);
   const oldWorker=await database.pool.connect();
   try{
    await oldWorker.query('SELECT pg_advisory_lock(78291333)');
    await assert.rejects(migrateDatabase(database));
   }finally{
    await oldWorker.query('SELECT pg_advisory_unlock(78291333)');
    oldWorker.release();
   }
   await migrateDatabase(database);
   const state=(await database.pool.query(`SELECT s.state,s.apply_cursor,s.target_rows,s.completed_at,f.capacity_pending
    FROM external_full_snapshots s CROSS JOIN external_full_sync f WHERE s.id=$1 AND f.id=1`,[id])).rows[0];
   assert.deepEqual(state,{state:'verified',apply_cursor:'0',target_rows:String(DEFAULT_FORMAL_LISTING_LIMIT),completed_at:null,capacity_pending:true});
   assert.equal(await database.transaction(tx=>admitFormalListing(tx,'che168','104')),false);
   await database.pool.query('DELETE FROM external_full_stage WHERE snapshot_id=$1',[id]);
   await database.pool.query('DELETE FROM external_full_snapshots WHERE id=$1',[id]);
   await database.pool.query(`UPDATE external_full_sync SET enabled=false,paused=true,last_capacity_sample=0,capacity_pending=false WHERE id=1`);
   await database.pool.query('UPDATE external_formal_admission_state SET admitted_count=2 WHERE id=1');
  });
  await rm(previous,{recursive:true,force:true});
  assert.equal(await formalAdmissionInstalled(database.pool),true);
  const count=async()=>Number((await database.pool.query('SELECT admitted_count FROM external_formal_admission_state WHERE id=1')).rows[0].admitted_count);
  const admitted=async()=>Number((await database.pool.query('SELECT count(*) AS n FROM external_formal_admissions')).rows[0].n);
  const exists=async(source:Source,externalId:string)=>Boolean((await database.pool.query('SELECT 1 FROM external_formal_admissions WHERE source=$1 AND external_id=$2',[source,externalId])).rowCount);
  const identityState=async(id:string)=>(await database.pool.query(
   "SELECT business_order::text,withdrawn FROM external_ingestion_identity_state WHERE provider='chinacarapi' AND source='che168' AND external_id=$1",[id])).rows[0];
  assert.equal(await count(),2);
  assert.equal(await admitted(),2);
  assert.equal(await exists('dongchedi','101'),true);
  assert.equal(await exists('che168','101'),true);
  assert.equal(await exists('che168','103'),false);
  assert.deepEqual(await identityState('103'),{business_order:'8',withdrawn:true});
  const backfilledMembers=(await database.pool.query(`SELECT source,external_id,state,last_detail_at IS NOT NULL AS observed
   FROM external_full_members WHERE state='withdrawn' ORDER BY source`)).rows;
  assert.deepEqual(backfilledMembers,[
   {source:'che168',external_id:'103',state:'withdrawn',observed:false},
   {source:'dongchedi',external_id:'101',state:'withdrawn',observed:true},
  ]);

  await database.transaction(async tx=>{
   await tx.query("INSERT INTO external_formal_admissions SELECT 'che168',(5000000+g)::text FROM generate_series(1,$1::int) g",[DEFAULT_FORMAL_LISTING_LIMIT-4]);
   await tx.query('UPDATE external_formal_admission_state SET admitted_count=$1 WHERE id=1',[DEFAULT_FORMAL_LISTING_LIMIT-2]);
  });
  await t.test('rollback does not consume a slot and concurrent reservations for one identity count once',async()=>{
   await assert.rejects(database.transaction(async tx=>{
    assert.equal(await admitFormalListing(tx,'che168','111'),true);
    throw new Error('mock transaction failure');
   }),/mock transaction failure/);
   assert.equal(await count(),DEFAULT_FORMAL_LISTING_LIMIT-2);
   assert.equal(await exists('che168','111'),false);
   const reserve=(externalId:string)=>database.transaction(tx=>admitFormalListing(tx,'che168',externalId));
   assert.deepEqual(await Promise.all([reserve('112'),reserve('112')]),[true,true]);
   assert.equal(await count(),DEFAULT_FORMAL_LISTING_LIMIT-1);
  });

  await configureFullSync(database,actor,'full');
  const applied: Array<{source:Source;externalId:string;operation:string}>=[];
  const apply:FullApply=async(_tx,input)=>{applied.push({source:input.source,externalId:input.externalId,operation:input.operation});};
  const fakeClient={} as FullSyncClient;
  worker=new FullSyncWorker(database,fakeClient,directory,apply);
  assert.equal(await worker.acquire(),true);
  const stage=async(entries:Array<{source:Source;id:string}>,expectedTarget=DEFAULT_FORMAL_LISTING_LIMIT)=>{
   const id=randomUUID();
   await database.transaction(async tx=>{
    await tx.query("INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged,bytes) VALUES($1,$2,'staging',$3,$4,$4,1)",
     [id,at,path.join(directory,id+'.csv.gz'),entries.length]);
    for(const [index,entry] of entries.entries()){
     const data={...Object.fromEntries(catalogColumns.map(key=>[key,''])),...entry};
     await tx.query('INSERT INTO external_full_stage VALUES($1,$2,$3,$4,$5)',[id,index+1,entry.source,entry.id,JSON.stringify(data)]);
    }
    const target=await verifiedSnapshotTarget(tx,id);
    assert.equal(Number(target),expectedTarget);
    await tx.query("UPDATE external_full_snapshots SET state='verified',target_rows=$2 WHERE id=$1",[id,target]);
   });
   return id;
  };
  const event=async(order:number,source:Source,id:string,operation:'upsert'|'withdraw',businessAt=at)=>{
   await database.pool.query(`INSERT INTO external_full_events(event_id,payload_hash,source,external_id,operation,business_at,document_refs)
    VALUES($1,'fixture',$2,$3,$4,$5,'[]')`,[order,source,id,operation,businessAt]);
  };
  const assertNotAdmitted=async(id:string)=>{
   assert.equal(await count(),DEFAULT_FORMAL_LISTING_LIMIT-1);
   assert.equal(await exists('che168',id),false);
   const rows=(await database.pool.query(`SELECT
    EXISTS(SELECT 1 FROM external_full_members WHERE source='che168' AND external_id=$1) AS member,
    EXISTS(SELECT 1 FROM external_full_work WHERE source='che168' AND external_id=$1) AS work,
    EXISTS(SELECT 1 FROM external_listings WHERE provider='chinacarapi' AND platform_id='che168' AND external_id=$1) AS listing`,[id])).rows[0];
   assert.deepEqual(rows,{member:false,work:false,listing:false});
  };
  await t.test('unknown full-delta withdrawal records a tombstone without using the last admission',async()=>{
   const id='114';
   await event(11,'che168',id,'withdraw');
   assert.equal(await worker!.applyEvents(true),1);
   assert.deepEqual(await identityState(id),{business_order:'11',withdrawn:true});
   const withdrawn=(await database.pool.query('SELECT applied_at IS NOT NULL AS applied,error_code FROM external_full_events WHERE event_id=11')).rows[0];
   assert.deepEqual(withdrawn,{applied:true,error_code:null});
   assert.deepEqual(applied,[]);
   await assertNotAdmitted(id);

   await event(10,'che168',id,'upsert',earlier);
   assert.equal(await worker!.applyEvents(),1);
   assert.equal((await database.pool.query('SELECT applied_at IS NOT NULL AS applied FROM external_full_events WHERE event_id=10')).rows[0].applied,true);
   assert.deepEqual(await identityState(id),{business_order:'11',withdrawn:true});
   assert.deepEqual(applied,[]);
   await assertNotAdmitted(id);

   const staleSnapshot=await stage([{source:'che168',id}],DEFAULT_FORMAL_LISTING_LIMIT-1);
   await worker!.promoteSnapshot(staleSnapshot);
   await assertNotAdmitted(id);
   const verified=(await database.pool.query('SELECT state,target_rows FROM external_full_snapshots WHERE id=$1',[staleSnapshot])).rows[0];
   assert.deepEqual(verified,{state:'complete',target_rows:String(DEFAULT_FORMAL_LISTING_LIMIT-1)});
  });

  await t.test('CSV replay cannot reactivate a known withdrawal at the same business time',async()=>{
   await database.pool.query("UPDATE external_full_members SET business_at=$1 WHERE source='dongchedi' AND external_id='101'",[at]);
   const snapshot=await stage([{source:'dongchedi',id:'101'}],DEFAULT_FORMAL_LISTING_LIMIT-1);
   await worker!.promoteSnapshot(snapshot);
   const state=(await database.pool.query(`SELECT state,EXISTS(SELECT 1 FROM external_full_work w
    WHERE w.source=m.source AND w.external_id=m.external_id) AS queued
    FROM external_full_members m WHERE source='dongchedi' AND external_id='101'`)).rows[0];
   assert.deepEqual(state,{state:'withdrawn',queued:false});
  });

  await t.test('unknown fixed-scope withdrawal does not apply or hydrate an older delta',async()=>{
   const id='115';
   const snapshot={sha256:'b'.repeat(64),bytes:1,rows:1,sourceCounts:{che168:1,dongchedi:0},generatedAt:at,complete:true as const};
   const job=await createImportJob(database,'admission-unknown-withdrawal-fixed',{version:1,provider:'chinacarapi',generatedAt:at,csv:snapshot,
    identities:[{source:'che168',externalId:id,canonicalId:'not-admitted'}]},actor.id);
   await verifySnapshot(database,job,snapshot);
   await receivePage(database,job,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[]});
   const delta=(operation:IngestionEvent['operation'],businessOrder:string,observedAt:string):IngestionEvent=>({
    key:'unknown-'+businessOrder,identity:{provider:'chinacarapi',source:'che168',externalId:id},operation,businessOrder,observedAt,document:[],
   });
   await receivePage(database,job,{lane:'delta',inputCursor:null,nextCursor:'first',terminal:false,events:[delta('withdraw','12',at)]});
   const calls:boolean[]=[];
   const fixed=new FixedScopeWorker(database,async(_tx,_event,{obsolete})=>{calls.push(obsolete);});
   assert.equal((await fixed.tick(job)).processed,1);
   assert.equal(calls.length,0);
   assert.deepEqual(await identityState(id),{business_order:'12',withdrawn:true});
   await assertNotAdmitted(id);

   await receivePage(database,job,{lane:'delta',inputCursor:'first',nextCursor:null,terminal:true,events:[delta('upsert','11',earlier)]});
   const fakeHydrator={bulk:()=>{throw new Error('An obsolete delta must not fetch details');}} as unknown as ChinaCarClient;
   assert.equal(await hydratePending(database,fakeHydrator,job),0);
   assert.equal((await fixed.tick(job)).state,'complete');
   assert.equal(calls.includes(false),false);
   assert.deepEqual((await database.pool.query('SELECT outcome FROM external_ingestion_events WHERE job_id=$1 ORDER BY seq',[job])).rows,
    [{outcome:'applied'},{outcome:'obsolete'}]);
   assert.deepEqual(await identityState(id),{business_order:'12',withdrawn:true});
   await assertNotAdmitted(id);
  });

  await t.test('paused, capacity-pending and 70-percent disk gates defer only unadmitted upserts',async()=>{
   const active=worker!,normalSpace=active.space.bind(active);
   const unknown='166',knownRefresh='112',knownWithdraw='5000001';
   await database.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state) VALUES
      ('che168',$1,'known-refresh','active'),('che168',$2,'known-withdraw','active')`,[knownRefresh,knownWithdraw]);
   await event(20,'che168',unknown,'upsert');
   try{
    const gates=[{paused:true,pending:false,used:0},{paused:false,pending:true,used:0},{paused:false,pending:false,used:0.70}];
    for(const [index,gate] of gates.entries()){
     await database.pool.query('UPDATE external_full_sync SET paused=$1,capacity_pending=$2 WHERE id=1',[gate.paused,gate.pending]);
     active.space=async()=>({used:gate.used,total:1000,available:Math.round(1000*(1-gate.used))});
     const refreshId=21+index,withdrawId=24+index;
     await event(refreshId,'che168',knownRefresh,'upsert');
     await event(withdrawId,'che168',knownWithdraw,'withdraw');
     await active.applyEvents();
     await assertNotAdmitted(unknown);
     const received=(await database.pool.query(`SELECT event_id::text,applied_at IS NOT NULL AS applied FROM external_full_events
      WHERE event_id IN(20,$1,$2) ORDER BY event_id`,[refreshId,withdrawId])).rows;
     assert.deepEqual(received,[{event_id:'20',applied:false},{event_id:String(refreshId),applied:true},{event_id:String(withdrawId),applied:true}]);
     assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM external_full_work WHERE source='che168' AND external_id=$1 AND kind='detail'",[knownRefresh])).rows[0].n,1);
     assert.equal((await database.pool.query("SELECT state FROM external_full_members WHERE source='che168' AND external_id=$1",[knownWithdraw])).rows[0].state,'withdrawn');
    }
    assert.deepEqual(applied,Array.from({length:3},()=>({source:'che168',externalId:knownWithdraw,operation:'withdraw'})));
   }finally{
    active.space=normalSpace;
    await database.pool.query('UPDATE external_full_sync SET paused=false,capacity_pending=false,disk_paused=false WHERE id=1');
    await database.pool.query('DELETE FROM external_full_events WHERE event_id=20');
    await database.pool.query("DELETE FROM external_full_work WHERE source='che168' AND external_id=$1",[knownRefresh]);
    applied.length=0;
   }
  });

  await t.test('CSV and full delta share the last slot; at the limit CSV still refreshes late known members',async()=>{
   const first=await stage([{source:'che168',id:'120'},{source:'che168',id:'121'},{source:'che168',id:'101'}]);
   assert.equal(await worker!.sampleRemaining(),3);
   await event(1,'che168','122','upsert');
   // Race actual entry points for one final reservation.
   await Promise.all([worker!.promoteSnapshot(first),worker!.applyEvents()]);
   const outcomes=await Promise.all([exists('che168','120'),exists('che168','122')]);
   assert.equal(outcomes.filter(Boolean).length,1);
   assert.equal(await exists('che168','121'),false);
   assert.equal(await count(),DEFAULT_FORMAL_LISTING_LIMIT);
   assert.equal(await admitted(),DEFAULT_FORMAL_LISTING_LIMIT);
   assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM external_full_work WHERE source='che168' AND external_id='101'")).rows[0].n,1);

   const second=await stage([{source:'che168',id:'130'},{source:'dongchedi',id:'131'},{source:'dongchedi',id:'101'},{source:'che168',id:'132'}]);
   assert.equal(await worker!.promoteSnapshot(second),1);
   const completed=(await database.pool.query('SELECT state,apply_cursor,rows,target_rows FROM external_full_snapshots WHERE id=$1',[second])).rows[0];
   assert.deepEqual(completed,{state:'complete',apply_cursor:'4',rows:'4',target_rows:String(DEFAULT_FORMAL_LISTING_LIMIT)});
   assert.equal((await database.pool.query("SELECT last_snapshot FROM external_full_members WHERE source='dongchedi' AND external_id='101'")).rows[0].last_snapshot,second);
  });

  await t.test('restart permits existing events, rejects aliases and guards direct formal writes',async()=>{
   await worker!.close();
   worker=new FullSyncWorker(database,fakeClient,directory,apply);
   assert.equal(await worker.acquire(),true);
   await event(2,'che168','140','withdraw');
   await event(3,'dongchedi','101','upsert');
   await event(4,'che168','101','withdraw');
   assert.equal(await worker.applyEvents(),3);
   assert.deepEqual(applied,[{source:'che168',externalId:'101',operation:'withdraw'}]);
   const received=(await database.pool.query('SELECT applied_at IS NOT NULL AS applied,error_code FROM external_full_events WHERE event_id IN(2,3,4) ORDER BY event_id')).rows;
   assert.deepEqual(received,[{applied:true,error_code:null},{applied:true,error_code:null},{applied:true,error_code:null}]);
   await database.transaction(tx=>bindAlias(tx,'dongchedi','101',{source:'dongchedi',id:'141'},at));
   assert.equal(await exists('dongchedi','141'),false);
   await assert.rejects(insertListing('chinacarapi','142'),{code:'23514',constraint:'external_formal_listing_limit'});
   await insertListing('synthetic','142');
   assert.equal(await exists('che168','142'),false);
   assert.equal(await count(),DEFAULT_FORMAL_LISTING_LIMIT);
   assert.equal(await admitted(),DEFAULT_FORMAL_LISTING_LIMIT);
  });

  await t.test('fixed-scope delta does not hydrate excluded identities and completes known withdrawals',async()=>{
   const snapshot={sha256:'a'.repeat(64),bytes:1,rows:2,sourceCounts:{che168:2,dongchedi:0},generatedAt:at,complete:true as const};
   const job=await createImportJob(database,'admission-cap-fixed',{version:1,provider:'chinacarapi',generatedAt:at,csv:snapshot,
    identities:[{source:'che168',externalId:'143',canonicalId:'excluded'},{source:'che168',externalId:'101',canonicalId:'shared-canonical'}]},actor.id);
   await verifySnapshot(database,job,snapshot);
   const delta=(externalId:string,operation:IngestionEvent['operation'],order:number):IngestionEvent=>({
    key:'event-'+order,identity:{provider:'chinacarapi',source:'che168',externalId},operation,businessOrder:String(order),observedAt:at,document:[],
   });
   await receivePage(database,job,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[]});
   await receivePage(database,job,{lane:'delta',inputCursor:null,nextCursor:null,terminal:true,events:[delta('143','upsert',1),delta('101','withdraw',2)]});
   const fakeHydrator={bulk:()=>{throw new Error('Unadmitted identities must not fetch details');}} as unknown as ChinaCarClient;
   assert.equal(await hydratePending(database,fakeHydrator,job),0);
   const actual:string[]=[];
   const fixed=new FixedScopeWorker(database,async(_tx,input)=>{actual.push(input.identity.externalId);});
   const result=await fixed.tick(job);
   assert.equal(result.state,'complete');
   assert.deepEqual(actual,['101']);
   assert.deepEqual((await database.pool.query('SELECT outcome FROM external_ingestion_events WHERE job_id=$1 ORDER BY seq',[job])).rows,
    [{outcome:'excluded_limit'},{outcome:'applied'}]);
   assert.equal(await exists('che168','143'),false);
   assert.equal(await count(),DEFAULT_FORMAL_LISTING_LIMIT);
  });

  await t.test('legacy CSV metadata remains raw while capacity binds the admission target',async()=>{
   const legacy=randomUUID();
   await database.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,rows,staged,bytes,apply_cursor)
    VALUES($1,$2,'complete',$3,476416,476416,0,476416)`,[legacy,at,path.join(directory,legacy+'.csv.gz')]);
   await assert.rejects(worker!.estimateCapacity(legacy,0),/SYNC_CAPACITY_INSUFFICIENT_SAMPLE/);
   const estimate=(await worker!.state()).capacity_estimate;
   assert.equal(estimate.csvRows,476416);
   assert.equal(estimate.targetRows,DEFAULT_FORMAL_LISTING_LIMIT);
   assert.equal(estimate.estimatedRows,DEFAULT_FORMAL_LISTING_LIMIT);
   assert.equal(estimate.allowed,false);
  });

  await t.test('expanded capacity binds a retained export, defers new deltas, and shares the finite ceiling',async()=>{
   const limit=DEFAULT_FORMAL_LISTING_LIMIT+3;
   const snapshot=await stage(['151','152','153','155'].map(id=>({source:'che168',id})));
   await database.pool.query(`UPDATE external_full_stage SET payload=jsonb_set(payload,'{duplicate_of}','"dongchedi:999"')
    WHERE snapshot_id=$1 AND row_number=1`,[snapshot]);
   await database.pool.query('UPDATE external_full_snapshots SET sha256=$2 WHERE id=$1',[snapshot,'a'.repeat(64)]);
   await database.pool.query("UPDATE external_full_sync SET last_capacity_sample=10000,receive_cursor='200',capacity_pending=false WHERE id=1");
   await database.pool.query(`INSERT INTO external_ingestion_identity_state(provider,source,external_id,business_order,withdrawn,observed_at,business_at)
    VALUES('chinacarapi','che168','153',200,true,$1,$1)`,[at]);
   const prepare=(target:number)=>database.pool.query('SELECT prepare_external_formal_expansion($1,$2) AS limit',[snapshot,target]);
   await assert.rejects(prepare(limit),/worker must stop/);
   await worker!.close();
   await database.pool.query("INSERT INTO backup_gc_leases(reference) VALUES('backup:fixture')");
   await assert.rejects(prepare(limit),/backup lease/);
   await database.pool.query("DELETE FROM backup_gc_leases WHERE reference='backup:fixture'");
   await assert.rejects(prepare(limit+1),/Complete staged rows/);
   await database.pool.query('DELETE FROM external_full_stage WHERE snapshot_id=$1 AND row_number=4',[snapshot]);
   await assert.rejects(prepare(limit),/Complete staged rows/);
   await database.pool.query("INSERT INTO external_full_stage VALUES($1,4,'che168','155','{}')",[snapshot]);
   assert.equal(Number((await prepare(limit)).rows[0].limit),limit);
   await assert.rejects(prepare(limit),/exceed the current ceiling/);
   assert.deepEqual((await database.pool.query(`SELECT s.state,s.apply_cursor,s.target_rows,f.capacity_pending,f.receive_cursor
    FROM external_full_snapshots s CROSS JOIN external_full_sync f WHERE s.id=$1 AND f.id=1`,[snapshot])).rows[0],
    {state:'verified',apply_cursor:'0',target_rows:String(limit),capacity_pending:true,receive_cursor:'200'});
   assert.equal(await database.transaction(tx=>admitFormalListing(tx,'che168','151')),false);
   assert.equal(await database.transaction(tx=>admitFormalListing(tx,'che168','101')),true);
   worker=new FullSyncWorker(database,fakeClient,directory,apply);
   assert.equal(await worker.acquire(),true);
   await event(201,'che168','154','upsert');
   assert.equal(await worker.applyEvents(),0);
   await event(199,'che168','112','upsert');
   assert.equal(await worker.applyEvents(),1);
   assert.equal((await database.pool.query(`SELECT 1 FROM external_listings
    WHERE provider='chinacarapi' AND platform_id='che168' AND external_id='112'`)).rowCount,0);
   assert.equal((await database.pool.query(`SELECT priority FROM external_full_work
    WHERE source='che168' AND external_id='112' AND kind='detail'`)).rows[0].priority,50,
    'an admitted identity without a published listing gets normal detail priority');
   await event(200,'che168','112','withdraw');
   assert.equal(await worker.applyEvents(true),1);
   assert.equal((await database.pool.query(`SELECT state FROM external_full_members
    WHERE source='che168' AND external_id='112'`)).rows[0].state,'withdrawn');
   assert.equal((await database.pool.query(`SELECT 1 FROM external_full_work
    WHERE source='che168' AND external_id='112'`)).rowCount,0);
   await assert.rejects(worker.promoteSnapshot(snapshot),/SYNC_CAPACITY_PENDING/);
   // An active CSV identity can withdraw after the target is bound. The freed planned slot
   // is available to the delta only after the CSV has applied.
   await event(202,'che168','155','withdraw');
   assert.equal(await worker.applyEvents(true),1);

   // Isolate post-approval admission sequencing. Live capacity decision validation is tested separately.
   const originalHeavy=worker.heavy.bind(worker);
   worker.heavy=async()=>{};
   try{
    await database.pool.query('UPDATE external_full_sync SET capacity_pending=false WHERE id=1');
    assert.equal(await worker.applyEvents(),0);
    assert.equal(await database.transaction(tx=>admitFormalListing(tx,'che168','154')),false);
    assert.equal(await worker.promoteSnapshot(snapshot),4);
    assert.equal(await count(),limit-1);
    assert.equal(await exists('che168','151'),true);
    assert.equal(await exists('che168','152'),true);
    assert.equal(await exists('che168','153'),false);
    assert.equal(await exists('che168','154'),false);
    assert.equal(await exists('che168','155'),false);
    assert.equal(await exists('dongchedi','999'),false);
    assert.equal(await worker.applyEvents(),1);
    assert.equal(await exists('che168','154'),true);
    assert.equal(await count(),limit);
    assert.equal(await admitted(),limit);
    await event(203,'che168','156','upsert');
    assert.equal(await worker.applyEvents(),1);
    assert.equal((await database.pool.query('SELECT error_code FROM external_full_events WHERE event_id=203')).rows[0].error_code,'SYNC_LISTING_LIMIT');
    await stage([{source:'che168',id:'151'}],limit);
   }finally{worker.heavy=originalHeavy;}
  });
 }finally{
  await worker?.close();
  await db?.close();
  await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance.close();
  await rm(directory,{recursive:true,force:true});
 }
});
