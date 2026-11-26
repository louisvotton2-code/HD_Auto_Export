import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {AdmissionChangeRequest,changeAdmissionLimit,inspectAdmissionChange,validateAdmissionApproval} from '../src/external/full-sync/admission-operations.js';

test('operator binds native evidence, preserves both cursors and retrieves committed operations',async()=>{
 const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(address.protocol)||address.hostname!=='127.0.0.1'||
   address.pathname!=='/postgres'||address.search||address.hash)throw new Error('This test requires isolated loopback PostgreSQL.');
 const database='hd_operator_'+randomUUID().replaceAll('-','');
 const maintenance=createDatabase(address.href,1);
 address.pathname='/'+database;
 const db=createDatabase(address.href,3);
 let created=false;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${database}"`);
  created=true;
  await migrateDatabase(db);
  const snapshotId=randomUUID(),csvSha256='a'.repeat(64),sourceEvidenceHash='b'.repeat(64),release='c'.repeat(40);
  const estimate={snapshotId,targetRows:546_799,sampleRows:6,evidenceHash:sourceEvidenceHash,sampleEvidenceSufficient:true};
  await db.pool.query(`INSERT INTO staff(id,name,email,role,banned) VALUES
   ('admission-admin','Operator','operator@example.invalid','admin',false),
   ('admission-editor','Editor','editor@example.invalid','editor',false)`);
  await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes,rows,staged,
   apply_cursor,target_rows) VALUES($1,now(),'applying','/fixture/current.csv.gz',$2,2048,2,2,1,546799)`,[snapshotId,csvSha256]);
  await db.pool.query(`INSERT INTO external_full_stage VALUES
   ($1,1,'che168','100','{}'),($1,2,'dongchedi','101','{}')`,[snapshotId]);
  await db.pool.query('UPDATE external_formal_admission_state SET admitted_count=546799,admission_limit=546799 WHERE id=1');
  await db.pool.query(`UPDATE external_full_sync SET enabled=true,paused=false,last_capacity_sample=6,worker_fence=7,
   receive_cursor=9223372036854775808,capacity_estimate=$1 WHERE id=1`,[JSON.stringify(estimate)]);
  const request=AdmissionChangeRequest.parse({
   id:randomUUID(),database,snapshotId,csvSha256,expectedAdmitted:546_799,expectedLimit:546_799,
   targetRows:1_000_000,workerFence:'7',rollbackOf:null,
  });
  await assert.rejects(inspectAdmissionChange(db,request),/SYNC_ADMISSION_SNAPSHOT_ALREADY_APPLIED/);
  await db.pool.query("UPDATE external_full_snapshots SET state='verified',apply_cursor=0 WHERE id=$1",[snapshotId]);
  assert.deepEqual(await inspectAdmissionChange(db,request),{
   request,committed:null,sourceEvidenceHash,sourceTargetRows:546_799,sampleRows:6,
  });
  const proof=(hash:string)=>validateAdmissionApproval(JSON.stringify({
   kind:'formal-admission-capacity-v1',release,request,sourceEvidenceHash:hash,sourceTargetRows:546_799,
   sampleRows:6,measuredAt:new Date(Date.now()-1000).toISOString(),sourceNativeExpiresAt:new Date(Date.now()+60_000).toISOString(),
   heavyWorkPausePercent:80,currentUsedBytes:48,diskTotalBytes:100,projectedPeakBytes:79,ioSafe:true,
  }),request,release,80,0);
  await assert.rejects(changeAdmissionLimit(db,request,'admission-editor',()=>proof(sourceEvidenceHash)),/SYNC_ADMIN_REQUIRED/);
  await assert.rejects(changeAdmissionLimit(db,request,'admission-admin',()=>proof('d'.repeat(64))),/SYNC_ADMISSION_BASIS_CHANGED/);
  await db.pool.query("UPDATE external_full_sync SET capacity_estimate=capacity_estimate||'{\"approvedBudgetBytes\":78}'::jsonb WHERE id=1");
  await assert.rejects(changeAdmissionLimit(db,request,'admission-admin',()=>proof(sourceEvidenceHash)),/SYNC_CAPACITY_BUDGET_CAP/);
  await db.pool.query("UPDATE external_full_sync SET capacity_estimate=capacity_estimate-'approvedBudgetBytes' WHERE id=1");
  const reserve=await changeAdmissionLimit(db,request,'admission-admin',()=>proof(sourceEvidenceHash)) as Record<string,unknown>;
  assert.equal(reserve.applyCursor,0);
  assert.equal(reserve.receiveCursor,'9223372036854775808');
  assert.equal(reserve.targetRows,1_000_000);
  const unexpectedProof=()=>{throw new Error('committed or rollback operations need no fresh projection');};
  assert.deepEqual(await changeAdmissionLimit(db,request,'admission-admin',unexpectedProof),reserve);
  assert.deepEqual(await inspectAdmissionChange(db,request),{request,committed:reserve});
  await assert.rejects(inspectAdmissionChange(db,{...request,workerFence:'8'}),/SYNC_ADMISSION_OPERATION_CONFLICT/);
  await db.pool.query("UPDATE external_full_snapshots SET state='applying',apply_cursor=1 WHERE id=$1",[snapshotId]);
  const rollback=AdmissionChangeRequest.parse({...request,id:randomUUID(),expectedLimit:1_000_000,
   rollbackOf:request.id,targetRows:546_799});
  const restored=await changeAdmissionLimit(db,rollback,'admission-admin',unexpectedProof) as Record<string,unknown>;
  assert.equal(restored.receiveCursor,reserve.receiveCursor);
  assert.equal(restored.applyCursor,1);
  assert.equal(restored.targetRows,546_799);
  assert.deepEqual((await db.pool.query(`SELECT w.capacity_pending,s.target_rows::int,s.apply_cursor::int,s.state
   FROM external_full_sync w CROSS JOIN external_full_snapshots s WHERE w.id=1 AND s.id=$1`,[snapshotId])).rows[0],
  {capacity_pending:true,target_rows:546_799,apply_cursor:1,state:'applying'});
 }finally{
  await db.close();
  if(created)await maintenance.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await maintenance.close();
 }
});
