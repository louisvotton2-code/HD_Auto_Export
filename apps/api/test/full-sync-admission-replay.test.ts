import {strict as assert} from 'node:assert';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {admissionReplayStatus,inspectAdmissionReplay,prepareAdmissionReplay} from '../src/external/full-sync/admission-replay.js';
import {capacityBinding,capacitySample,type MeasuredCohort} from '../src/external/full-sync/capacity.js';
import type {FullSyncClient} from '../src/external/full-sync/client.js';
import {FullSyncWorker} from '../src/external/full-sync/engine.js';
import type {ApplyInput,Locale,Source} from '../src/external/full-sync/types.js';
import {admitFormalListing,permitFullSyncAdmission} from '../src/external/formal-admission.js';

test('replay is fenced, bound to a verified generation and never publishes from historical denials',async()=>{
  const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)
    throw new Error('This test requires isolated loopback PostgreSQL.');
  const name='hd_admission_replay_'+randomBytes(8).toString('hex');
  const maintenance=createDatabase(url.href,1);
  const directory=await mkdtemp(path.join(tmpdir(),'hd-admission-replay-'));
  url.pathname='/'+name;
  const db=createDatabase(url.href,3);
  const previous=process.env.FULL_SYNC_CAPACITY_DECISION_FILE;
  const previousBudget=process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
  const decisionFile=path.join(directory,'decision.json');
  const applied:ApplyInput[]=[];
  const requests:{ids:string[];locale:Locale}[]=[];
  const removedAt=new Date();
  let calls=0,created=false;
  const record=async(e:number,source:Source,id:string,operation='upsert',denied=true)=>{
    await db.pool.query(`INSERT INTO external_full_events(event_id,payload_hash,source,external_id,operation,
      business_at,document_refs,received_at,applied_at,error_code,source_type,public_outcome)
      VALUES($1,'fixture',$2,$3,$4,clock_timestamp(),'[]',clock_timestamp(),
        CASE WHEN $5 THEN clock_timestamp() END,CASE WHEN $5 THEN 'SYNC_LISTING_LIMIT' END,
        CASE $4 WHEN 'withdraw' THEN 'removed' WHEN 'relist' THEN 'relisted' ELSE 'new' END,
        CASE WHEN $5 THEN 'not_public' ELSE 'pending' END)`,[e,source,id,operation,denied]);
  };
  const client={
    async *bulk(source:Source,ids:string[],locale:Locale){
      calls++;
      requests.push({ids,locale});
      const results=ids.filter(id=>id!=='96').map(id=>({source,id,status:id==='93'?'removed':'active',hasInspectionReport:false,
        ...(id==='93'?{updatedAt:removedAt.toISOString()}:id==='99'?{updatedAt:'2026-11-14T00:00:00.000Z'}:{})}));
      const payload={results,notFound:ids.filter(id=>id==='96')};
      const body=JSON.stringify(payload);
      yield {...payload,rawResponse:{hash:createHash('sha256').update(body).digest('hex'),body}};
      if(locale==='ru'&&ids.includes('95'))await record(115,'che168','95','withdraw',false);
    },
  } as unknown as FullSyncClient;
  const worker=new FullSyncWorker(db,client,directory,async(_tx,input)=>{applied.push(input);});
  const diskTotal=1024**4;
  worker.space=async()=>({used:0,available:diskTotal,total:diskTotal});
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);
    created=true;
    await migrateDatabase(db);
    await db.pool.query(`INSERT INTO staff(id,name,email,role,banned) VALUES
      ('replay-admin','Operator','replay@example.invalid','admin',false),
      ('replay-editor','Editor','replay-editor@example.invalid','editor',false)`);
    const snapshotId=randomUUID(),csvSha256='a'.repeat(64);
    await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes,rows,staged,
      apply_cursor,target_rows,completed_at) VALUES($1,now()-interval '1 hour','complete',$2,$3,2048,6,6,6,150000,now())`,
    [snapshotId,path.join(directory,'report.csv.gz'),csvSha256]);
    await db.pool.query(`INSERT INTO external_full_stage
      SELECT $1,n,'che168',(100+n)::text,'{}'::jsonb FROM generate_series(1,6) n`,[snapshotId]);
    await db.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,locales,
      last_detail_at,sampled,report_state,desired_generation,applied_generation)
      SELECT 'che168',(700+n)::text,'chinacarapi:che168:'||(700+n)::text,'active',
      ARRAY['zh','en','ru'],now(),true,'no_report',1,1 FROM generate_series(1,6) n`);
    await db.pool.query(`INSERT INTO external_formal_admissions(source,external_id) VALUES ('che168','104');
      UPDATE external_formal_admission_state SET admitted_count=150000 WHERE id=1;
      UPDATE external_full_sync SET enabled=true,paused=false,last_capacity_sample=6,receive_cursor=777,
        received_events=9,applied_events=9 WHERE id=1;
      INSERT INTO external_ingestion_identity_state(provider,source,external_id,business_order,withdrawn,observed_at,business_at)
        VALUES ('chinacarapi','che168','102',1,true,now(),now()-interval '30 minutes'),
           ('chinacarapi','che168','97',10,true,now(),now()-interval '30 minutes');
      SET session_replication_role='replica';
      INSERT INTO external_full_members(source,external_id,canonical_id,state,business_at)
        VALUES ('che168','103','member-withdrawal','withdrawn',now()-interval '30 minutes');
      SET session_replication_role='origin'`);
    await record(11,'che168','91');
    await record(12,'che168','101'); // This identity is actually in the verified export.
    await record(13,'dongchedi','101');
    await record(14,'che168','94');
    await record(15,'che168','95');
    await record(16,'che168','96');
    await record(17,'che168','97','relist');
    await record(18,'che168','98');
    await record(19,'che168','98','withdraw',false);
    await record(20,'che168','99');
    await record(21,'che168','93');
    await db.pool.query("UPDATE external_full_events SET business_at=$1::timestamptz-interval '5 minutes' WHERE event_id=21",[removedAt]);
    await record(22,'che168','100');
    const actor={id:'replay-admin',requestId:'isolated-replay'};
    const input={id:randomUUID(),snapshotId,csvSha256,capacityReceipt:'b'.repeat(64),
      expectedAdmitted:150000,expectedLimit:150000,targetRows:150008,eventIds:['11','14','15','16','17','20','21','22']};
    const basis=await inspectAdmissionReplay(db,input);
    assert.deepEqual(basis.csv,{rows:6,admitted:1,withdrawn:2,eligibleMissing:3});
    assert.equal(basis.deltaOnly,8);
    await assert.rejects(inspectAdmissionReplay(db,{...input,targetRows:150001,eventIds:['12']}),/SYNC_REPLAY_INELIGIBLE/);
    await assert.rejects(inspectAdmissionReplay(db,{...input,targetRows:150001,eventIds:['18']}),/SYNC_REPLAY_INELIGIBLE/);
    assert.equal((await inspectAdmissionReplay(db,{...input,targetRows:150001,eventIds:['13']})).deltaOnly,1);
    await assert.rejects(prepareAdmissionReplay(db,{...actor,id:'replay-editor'},input),/SYNC_ADMIN_REQUIRED/);
    await db.pool.query("UPDATE external_full_snapshots SET state='applying' WHERE id=$1",[snapshotId]);
    await assert.rejects(prepareAdmissionReplay(db,actor,input),/SYNC_REPLAY_SNAPSHOT_CHANGED/);
    await db.pool.query("UPDATE external_full_snapshots SET state='complete' WHERE id=$1",[snapshotId]);
    await db.pool.query("INSERT INTO backup_gc_leases(reference) VALUES('backup:replay-test')");
    await assert.rejects(prepareAdmissionReplay(db,actor,input),/SYNC_REPLAY_BACKUP_ACTIVE/);
    await db.pool.query("DELETE FROM backup_gc_leases WHERE reference='backup:replay-test'");
    assert.equal(await worker.acquire(),true);
    await assert.rejects(prepareAdmissionReplay(db,actor,input),/SYNC_REPLAY_WORKER_RUNNING/);
    await worker.close();

    const approval={workerFence:String((await worker.state()).worker_fence),expiresAt:Date.now()+60_000};
    await assert.rejects(prepareAdmissionReplay(db,actor,input,{...approval,heavyWorkPausePercent:80}),
      /SYNC_REPLAY_CAPACITY_NOT_READY/);
    const prepared=await prepareAdmissionReplay(db,actor,input,{...approval,heavyWorkPausePercent:70});
    assert.deepEqual(prepared.items,{pending:8});
    assert.deepEqual((await prepareAdmissionReplay(db,actor,input)).items,{pending:8});
    await assert.rejects(prepareAdmissionReplay(db,actor,{...input,capacityReceipt:'c'.repeat(64)}),/SYNC_REPLAY_CONFLICT/);
    const incoming=()=>db.pool.query(`SELECT receive_cursor::text,received_events::text,applied_events::text,
      snap.apply_cursor::text,cap.admission_limit::text FROM external_full_sync
      CROSS JOIN external_full_snapshots snap CROSS JOIN external_formal_admission_state cap WHERE snap.id=$1`,[snapshotId]);
    assert.deepEqual((await incoming()).rows[0],{receive_cursor:'777',received_events:'9',applied_events:'9',apply_cursor:'6',admission_limit:'150008'});

    assert.equal(await worker.acquire(),true);
    await assert.rejects(worker.replayAdmissions(),/SYNC_CAPACITY_PENDING/);
    process.env.FULL_SYNC_CAPACITY_DECISION_FILE=decisionFile;
    delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;
    const sample=await capacitySample(db),now=Date.now();
    const history:MeasuredCohort={model:'measured-cohort-v2',cohortHash:sample.cohort_hash,stateHash:sample.state_hash,
      sampleRows:sample.details,snapshotId,targetRows:150008,bytesPerDetail:2048,at:new Date(now).toISOString()};
    const binding=capacityBinding(snapshotId,150008,sample,history);
    const decision={schemaVersion:1,model:'hd-ext09-daily-two-v1',...binding,measuredAt:new Date(now).toISOString(),
      expiresAt:new Date(now+300_000).toISOString(),decision:'allow',reason:'SYNC_CAPACITY_VERIFIED',
      projectedPeakBytes:1024**3,diskTotalBytes:diskTotal,currentUsedBytes:0,components:{}};
    await db.pool.query('UPDATE external_full_sync SET capacity_baseline=$1,capacity_estimate=$2 WHERE id=1',
      [JSON.stringify({detailSample:history}),JSON.stringify({...binding,at:history.at,sampleEvidenceSufficient:true})]);
    await assert.rejects(worker.capacityGate(),/SYNC_CAPACITY_AWAITING_DECISION/);
    await writeFile(decisionFile,JSON.stringify(decision),{mode:0o600});
    assert.equal(await worker.capacityGate(),true);
    const count=async()=>Number((await db.pool.query('SELECT admitted_count FROM external_formal_admission_state')).rows[0].admitted_count);
    const ledgerIds=async()=> (await db.pool.query("SELECT external_id FROM external_formal_admissions WHERE source='che168' AND external_id NOT IN ('104','701','702','703','704','705','706') ORDER BY external_id")).rows.map(row=>row.external_id);
    await db.transaction(async tx=>{
      await permitFullSyncAdmission(tx);
      assert.equal(await admitFormalListing(tx,'che168','900'),false); // Pending plan holds all eight places.
    });
    await record(114,'che168','94','withdraw',false);
    assert.equal(await worker.replayAdmissions(),7);
    assert.equal(calls,0);
    assert.equal(await count(),150000);
    assert.deepEqual(await ledgerIds(),[]);
    assert.equal((await db.pool.query("SELECT withdrawn FROM external_ingestion_identity_state WHERE provider='chinacarapi' AND source='che168' AND external_id='97'")).rows[0].withdrawn,true);
    assert.deepEqual((await admissionReplayStatus(db,input.id)).items,{scheduled:7,superseded:1});
    assert.deepEqual((await incoming()).rows[0],{receive_cursor:'777',received_events:'9',applied_events:'9',apply_cursor:'6',admission_limit:'150008'});
    await db.transaction(async tx=>{
      await permitFullSyncAdmission(tx);
      await tx.query('SAVEPOINT reservation_probe');
      assert.equal(await admitFormalListing(tx,'che168','900'),true); // Superseded 94 releases its place.
      assert.equal(await admitFormalListing(tx,'che168','901'),false); // Unrelated work cannot steal scheduled places.
      await tx.query('ROLLBACK TO SAVEPOINT reservation_probe');
    });
    assert.equal(await worker.replayAdmissions(),0);
    await db.pool.query("UPDATE external_full_work SET due_at=now()+interval '1 day' WHERE source='che168' AND external_id='100' AND kind='detail'");
    assert.equal(await worker.details(),2);
    assert.equal(calls,3);
    assert.equal((await db.pool.query("SELECT 1 FROM external_full_events WHERE event_id=115 AND applied_at IS NULL")).rowCount,1);
    assert.equal(await count(),150002);
    assert.deepEqual(await ledgerIds(),['91','97']);
    assert.deepEqual(applied.filter(item=>item.operation==='upsert').map(item=>item.externalId).sort(),['91','97']);
    assert.ok(applied.filter(item=>item.operation==='upsert').every(item=>item.documents.length===3&&item.documents.every(d=>d.kind==='detail')));
    assert.equal((await db.pool.query("SELECT last_error_code FROM external_full_work WHERE source='che168' AND external_id='99' AND kind='detail'")).rows[0].last_error_code,'SYNC_REPLAY_STATUS_UNVERIFIED');
    await db.pool.query("UPDATE external_full_work SET attempts=4,due_at=now() WHERE source='che168' AND external_id IN ('96','99') AND kind='detail'");
    assert.equal(await worker.details(),0);
    assert.deepEqual(requests.slice(3).filter(request=>request.ids.includes('96')).map(request=>request.locale),['zh']);
    assert.deepEqual((await admissionReplayStatus(db,input.id)).items,
      {scheduled:1,superseded:2,unresolved_not_found:1,unresolved_unverified:1,verified_active:2,verified_withdrawn:1});
    assert.equal(await count(),150002);
    const removal=(await db.pool.query("SELECT withdrawn,business_at FROM external_ingestion_identity_state WHERE provider='chinacarapi' AND source='che168' AND external_id='93'")).rows[0];
    assert.equal(removal.withdrawn,true);
    assert.equal(removal.business_at.getTime(),removedAt.getTime());
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM external_source_heads WHERE provider='chinacarapi' AND source='che168' AND external_id='93' AND kind='detail' AND merged_payload->>'status'='removed'")).rows[0].n,3);
    await record(116,'che168','93','relist',false);
    await db.pool.query("UPDATE external_full_events SET business_at=$1::timestamptz-interval '1 minute' WHERE event_id=116",[removedAt]);
    assert.equal(await worker.applyEvents(),1);
    assert.equal((await db.pool.query("SELECT public_outcome FROM external_full_events WHERE event_id=116")).rows[0].public_outcome,'not_public');
    assert.equal(await count(),150002);
    assert.equal((await db.pool.query("SELECT 1 FROM external_formal_admissions WHERE source='che168' AND external_id='94'")).rowCount,0);
    assert.equal((await db.pool.query("SELECT 1 FROM external_full_work WHERE source='che168' AND external_id='95' AND kind='detail'")).rowCount,0);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM external_full_events WHERE event_id IN (11,14,15,16,17,20,21,22) AND applied_at IS NOT NULL AND error_code='SYNC_LISTING_LIMIT' AND public_outcome='not_public'")).rows[0].n,8);
    await db.pool.query("INSERT INTO external_full_snapshots(id,generated_at,state,path) VALUES($1,now(),'staging',$2)",
      [randomUUID(),path.join(directory,'another-export.csv.gz')]);
    const callsBeforeRollover=calls;
    assert.equal(await worker.replayAdmissions(),0);
    assert.equal(calls,callsBeforeRollover);
    assert.equal(await count(),150002);
    assert.deepEqual(await ledgerIds(),['91','97']);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM external_full_members WHERE source='che168' AND external_id IN ('93','94','95','96','99','100')")).rows[0].n,0);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM external_full_admission_replay_reservations')).rows[0].n,0);
    assert.deepEqual((await admissionReplayStatus(db,input.id)).items,
      {superseded:3,unresolved_not_found:1,unresolved_unverified:1,verified_active:2,verified_withdrawn:1});
  } finally {
    if(previous===undefined)delete process.env.FULL_SYNC_CAPACITY_DECISION_FILE;else process.env.FULL_SYNC_CAPACITY_DECISION_FILE=previous;
    if(previousBudget===undefined)delete process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES;else process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES=previousBudget;
    try{await worker.close();await db.close();}
    finally{
      if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await maintenance.close();
      await rm(directory,{recursive:true,force:true});
    }
  }
});
