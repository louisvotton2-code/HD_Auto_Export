import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDatabase } from '../../src/db/index.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { auditSupplierAdmissionGap } from '../../src/external/full-sync/admission-audit.js';

// Use a dedicated PostgreSQL instance so activity in other databases cannot change the cluster MVCC snapshot.
test('supplier gap audit resumes ranges, distinguishes current omissions and refuses drift',async t=>{
  const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:','postgresql:'].includes(base.protocol)||base.hostname!=='127.0.0.1'||
      base.pathname!=='/postgres'||base.search||base.hash) throw new Error('Only isolated loopback PostgreSQL is supported.');
  const database='hd_admission_audit_'+randomBytes(8).toString('hex');
  const maintenance=createDatabase(base.href,1);
  const directory=await mkdtemp(path.join(tmpdir(),'hd-admission-audit-'));
  const address=new URL(base);
  address.pathname='/'+database;
  const db=createDatabase(address.href,2);
  let created=false;
  t.after(async()=>{
    try { await db.close(); } finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
      finally { await maintenance.close();await rm(directory,{recursive:true,force:true}); }
    }
  });
  await maintenance.pool.query(`CREATE DATABASE "${database}"`);
  created=true;
  await migrateDatabase(db);

  const snapshotId=randomUUID();
  await db.transaction(async tx=>{
    await tx.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes,rows,staged,apply_cursor)
      VALUES ($1,now()-interval '2 hours','applying','test',repeat('a',64),2048,203,203,100)`,[snapshotId]);
    // The same provider number on two source platforms is two separate
    // admission identities. The dongchedi copy has a newer withdrawal.
    await tx.query(`INSERT INTO external_full_stage(snapshot_id,row_number,source,external_id,payload)
      SELECT $1,row,CASE WHEN row=102 THEN 'dongchedi' ELSE 'che168' END,
        CASE WHEN row=102 THEN '101' ELSE row::text END,'{}'::jsonb
      FROM generate_series(1,203) row`,[snapshotId]);
    await tx.query(`INSERT INTO external_formal_admissions(source,external_id)
      VALUES ('che168','1'),('che168','101'),('che168','203');
      UPDATE external_formal_admission_state SET admitted_count=3 WHERE id=1;
      INSERT INTO external_ingestion_identity_state(provider,source,external_id,business_order,withdrawn,observed_at,business_at)
      VALUES ('chinacarapi','che168','2',1,true,now(),now()-interval '1 hour'),
        ('chinacarapi','che168','50',1,true,now(),now()-interval '3 hours'),
        ('chinacarapi','dongchedi','101',1,true,now(),now()-interval '1 hour'),
        ('chinacarapi','che168','1012',1,true,now(),now()-interval '1 hour'),
        ('chinacarapi','che168','1013',1,true,now(),now()-interval '1 hour');
      INSERT INTO external_full_events(event_id,payload_hash,source,external_id,operation,business_at,document_refs,
        received_at,applied_at,error_code,source_type,public_outcome)
      VALUES (11,'fixture','che168','1010','upsert',now()-interval '2 min','[]',now()-interval '2 min',now(),'SYNC_LISTING_LIMIT','new','not_public'),
        (12,'fixture','che168','1011','upsert',now()-interval '3 min','[]',now()-interval '3 min',now(),'SYNC_LISTING_LIMIT','new','not_public'),
        (13,'fixture','che168','1011','withdraw',now()-interval '2 min','[]',now()-interval '2 min',now(),null,'removed','not_public'),
        (14,'fixture','che168','1012','upsert',now()-interval '4 min','[]',now()-interval '4 min',now(),'SYNC_LISTING_LIMIT','new','not_public'),
        (15,'fixture','che168','1013','relist',now()-interval '2 min','[]',now()-interval '2 min',now(),'SYNC_LISTING_LIMIT','relisted','not_public'),
        (16,'fixture','che168','103','upsert',now()-interval '2 min','[]',now()-interval '2 min',now(),'SYNC_LISTING_LIMIT','new','not_public'),
        (17,'fixture','che168','1014','upsert',now()-interval '3 hours','[]',now()-interval '3 hours',now(),'SYNC_LISTING_LIMIT','new','not_public'),
        (18,'fixture','che168','1','upsert',now()-interval '2 min','[]',now()-interval '2 min',null,null,'price','pending'),
        (19,'fixture','che168','202','withdraw',now()-interval '3 min','[]',now()-interval '3 min',null,null,'removed','pending'),
        (20,'fixture','che168','203','upsert',now()-interval '4 min','[]',now()-interval '4 min',now(),null,'price','pending'),
        (21,'fixture','che168','204','upsert',now()-interval '4 min','[]',now()-interval '4 min',now(),null,'price','pending');
      UPDATE external_full_events SET was_public=true WHERE event_id=20;
      SET LOCAL session_replication_role='replica';
      INSERT INTO external_full_members(source,external_id,canonical_id,state,business_at)
        VALUES ('che168','53','member-only-newer','withdrawn',now()-interval '1 hour'),
          ('che168','54','member-only-older','withdrawn',now()-interval '3 hours');
      SET LOCAL session_replication_role='origin'`);
  });

  const clock=(await db.pool.query<{at:Date}>('SELECT clock_timestamp() AS at')).rows[0]!.at;
  const input={database,checkpoint:path.join(directory,'resume'),snapshotId,restoreReceipt:'f'.repeat(64),
    restoreAsOf:clock.toISOString(),chunkRows:100,maxChunks:1};
  const first=await auditSupplierAdmissionGap(db,input);
  assert.equal(first.complete,false);
  assert.equal(first.scanned,100);
  assert.equal(first.csv,null);
  assert.deepEqual((await readdir(input.checkpoint)).sort(),['manifest.json','rows-0000001.json']);
  assert.equal((await stat(path.join(input.checkpoint,'manifest.json'))).mode&0o077,0);
  const cli=fileURLToPath(new URL('../../src/external/full-sync/admission-audit-cli.ts',import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath,[
    '--import','tsx',cli,'--database',database,'--checkpoint',input.checkpoint,
    '--snapshot-id',snapshotId,'--restore-receipt',input.restoreReceipt,'--restore-as-of',input.restoreAsOf,
    '--chunk-rows','100','--max-chunks','1',
  ],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...process.env,ADMISSION_AUDIT_DATABASE_URL:address.href}}),error=>{
    const result=error as {code:number;stdout:string};
    assert.equal(result.code,2);
    assert.equal(JSON.parse(result.stdout).scanned,200);
    return true;
  });
  const complete=await auditSupplierAdmissionGap(db,input);
  assert.equal(complete.complete,true);
  assert.equal(complete.asOf,input.restoreAsOf);
  assert.deepEqual(complete.csv,{admitted:3,withdrawnSinceExport:3,missingThroughCursor:97,missingAfterCursor:100,eligibleMissing:197});
  assert.deepEqual(complete.deltas.lastHour,{received:10,coverage:'complete-recorded-window',distinctIdentities:9,stillMissingAfterLimit:3,outsideSelectedCsv:2});
  assert.equal(complete.deltas.unappliedPrice.n,1);
  assert.ok(complete.deltas.unappliedPrice.oldestAgeMs!>=120_000);
  assert.equal(complete.deltas.unappliedWithdrawal.n,1);
  assert.ok(complete.deltas.unappliedWithdrawal.oldestAgeMs!>=180_000);
  assert.equal(complete.deltas.awaitingPublicPrice.n,1);
  assert.deepEqual(complete.deltas.awaitingPublicWithdrawal,{n:0,oldestReceivedAt:null,oldestAgeMs:null});
  assert.deepEqual(await auditSupplierAdmissionGap(db,input),complete);
  await assert.rejects(auditSupplierAdmissionGap(db,{...input,restoreReceipt:'0'.repeat(64)}),/do not match/);
  await assert.rejects(auditSupplierAdmissionGap(db,{...input,checkpoint:path.join(directory,'early'),
    restoreAsOf:new Date(clock.getTime()-300_000).toISOString()}),/restore cutoff/);

  // Catch even unrelated committed state drift rather than combine checkpoints
  // from two different views of a restored database.
  await db.pool.query("INSERT INTO external_formal_admissions(source,external_id) VALUES ('che168','65')");
  await assert.rejects(auditSupplierAdmissionGap(db,input),/restore changed/);

  await db.pool.query('DELETE FROM external_full_stage WHERE snapshot_id=$1 AND row_number=150',[snapshotId]);
  const damaged={...input,checkpoint:path.join(directory,'damaged'),maxChunks:2};
  await assert.rejects(auditSupplierAdmissionGap(db,damaged),/row range is incomplete/);
  assert.deepEqual((await readdir(damaged.checkpoint)).sort(),['manifest.json','rows-0000001.json']);
});
