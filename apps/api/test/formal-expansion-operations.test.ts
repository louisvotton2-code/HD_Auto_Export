import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {admitFormalListing,permitFullSyncAdmission} from '../src/external/formal-admission.js';

test('formal capacity reservation preserves cursors and journals only the first evidenced admission',async()=>{
  const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(address.protocol)||address.hostname!=='127.0.0.1'||address.pathname!=='/postgres'||address.search||address.hash)
    throw new Error('This test requires isolated loopback PostgreSQL.');
  const name='hd_expansion_'+randomBytes(8).toString('hex');
  const maintenance=createDatabase(address.href,1);
  const ownerPassword=randomBytes(16).toString('hex');
  address.pathname='/'+name;
  address.username=name;
  address.password=ownerPassword;
  const db=createDatabase(address.href,4);
  const directory=await mkdtemp(path.join(tmpdir(),'hd-formal-expansion-'));
  let roleCreated=false,created=false;
  try {
    await maintenance.pool.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${ownerPassword}'`);
    roleCreated=true;
    await maintenance.pool.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
    created=true;
    // Exercise the deployed ledger shape, including the deliberately deferred 0050.
    const migrations=new URL('../migrations/',import.meta.url);
    const journal=JSON.parse(await readFile(new URL('meta/_journal.json',migrations),'utf8'));
    journal.entries=journal.entries.filter(({idx}:{idx:number})=>idx<55&&idx!==50);
    await mkdir(path.join(directory,'meta'));
    await Promise.all(journal.entries.map(({tag}:{tag:string})=>copyFile(new URL(tag+'.sql',migrations),path.join(directory,tag+'.sql'))));
    const journalPath=path.join(directory,'meta/_journal.json');
    await writeFile(journalPath,JSON.stringify({...journal,entries:journal.entries.slice(0,-1)}));
    await migrate(db.orm,{migrationsFolder:directory});
    await assert.rejects(migrateDatabase(db,'--apply-formal-expansion'),/Expected the exact 0054 ledger/);
    await writeFile(journalPath,JSON.stringify(journal));
    await migrate(db.orm,{migrationsFolder:directory});
    await migrateDatabase(db,'--apply-formal-expansion');
    await migrateDatabase(db,'--apply-formal-expansion');
    const ledger=(await db.pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE created_at=1794182400050)::int AS han_pairs,
      count(*) FILTER(WHERE created_at=1794182400055)::int AS expansion FROM drizzle.__drizzle_migrations`)).rows[0];
    assert.deepEqual(ledger,{total:55,han_pairs:0,expansion:1});
    const permissions=(await db.pool.query(`SELECT current_setting('is_superuser')='off' AS limited_role,
      NOT EXISTS (SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
        WHERE p.proname='change_external_formal_expansion' AND a.grantee=0 AND a.privilege_type='EXECUTE') AS private_operator`)).rows[0];
    assert.deepEqual(permissions,{limited_role:true,private_operator:true});

    const snapshotId=randomUUID(),csvSha256='a'.repeat(64),capacity='b'.repeat(64);
    const oldLimit=546799,admitted=oldLimit-1,million=1_000_000;
    await db.pool.query(`INSERT INTO staff(id,name,email,role,banned) VALUES
      ('expansion-admin','Operator','expansion@example.invalid','admin',false),
      ('expansion-editor','Editor','expansion-editor@example.invalid','editor',false);
      UPDATE external_full_sync SET enabled=true,paused=false,last_capacity_sample=5,receive_cursor=777,worker_fence=12 WHERE id=1;
      UPDATE external_formal_admission_state SET admitted_count=546798,admission_limit=546799 WHERE id=1;
      INSERT INTO external_formal_admissions(source,external_id) VALUES ('che168','101')`);
    await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes,rows,staged,apply_cursor,target_rows)
      VALUES($1,now()-interval '2 hours','verified','fixture.csv.gz',$2,2048,3,3,0,$3)`,[snapshotId,csvSha256,oldLimit]);
    await db.pool.query(`INSERT INTO external_full_stage SELECT $1,n,'che168',(100+n)::text,'{}'::jsonb
      FROM generate_series(1,3) n`,[snapshotId]);

    const hold=await db.pool.connect();
    const operationId=randomUUID();
    const change=async({
      id=operationId,rollbackOf=null,actor='expansion-admin',snapshot=snapshotId,sha=csvSha256,
      expectedCount=admitted,expectedLimit=oldLimit,target=million,receipt=capacity,hash='c'.repeat(64),fence=12,
    }:{id?:string;rollbackOf?:string|null;actor?:string;snapshot?:string;sha?:string;expectedCount?:number;
      expectedLimit?:number;target?:number;receipt?:string|null;hash?:string;fence?:number}={})=>{
      return (await db.pool.query(`SELECT change_external_formal_expansion(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::bigint,$6::bigint,$7::bigint,$8::text,$9::text,$10::text,$11::bigint) AS receipt`,
      [id,rollbackOf,snapshot,sha,expectedCount,expectedLimit,target,actor,hash,receipt,fence])).rows[0].receipt;
    };
    try{
      await assert.rejects(change({target:million-1}),{code:'HD551'});
      await assert.rejects(change({actor:'expansion-editor'}),{code:'HD552'});
      await hold.query('SELECT pg_advisory_lock(78291333)');
      await assert.rejects(change(),{code:'HD554'});
      await hold.query('SELECT pg_advisory_unlock(78291333)');
      await db.pool.query("INSERT INTO backup_gc_leases(reference) VALUES ('backup:expansion-test')");
      await assert.rejects(change(),{code:'HD555'});
      await db.pool.query("DELETE FROM backup_gc_leases WHERE reference='backup:expansion-test'");
      await assert.rejects(change({fence:11}),{code:'HD556'});
      await assert.rejects(change({expectedCount:admitted-1}),{code:'HD557'});
      await assert.rejects(change({sha:'d'.repeat(64)}),{code:'HD558'});
      await db.pool.query("UPDATE external_full_snapshots SET state='applying',apply_cursor=1 WHERE id=$1",[snapshotId]);
      await assert.rejects(change(),{code:'HD558'});
      await db.pool.query("UPDATE external_full_snapshots SET state='verified',apply_cursor=0 WHERE id=$1",[snapshotId]);
      const reserved=await change();
      assert.deepEqual(reserved,{id:operationId,rollbackOf:null,snapshotId,csvSha256,priorLimit:oldLimit,targetRows:million,
        admitted,receiveCursor:'777',applyCursor:0,workerFence:'12',capacityReceipt:capacity});
      await hold.query('SELECT pg_advisory_lock(78291333)');
      assert.deepEqual(await change(),reserved);
      await assert.rejects(change({hash:'d'.repeat(64)}),{code:'HD553'});
      await hold.query('SELECT pg_advisory_unlock(78291333)');
    }finally{
      await hold.query('SELECT pg_advisory_unlock_all()');
      hold.release();
    }
    const state=async(id=snapshotId)=>(await db.pool.query(`SELECT a.admission_limit::int AS ceiling,a.admitted_count::int AS admitted,
      s.state,s.apply_cursor::int AS "applyCursor",s.target_rows::int AS "targetRows",w.receive_cursor::text AS "receiveCursor",
      w.capacity_pending AS "capacityPending" FROM external_formal_admission_state a CROSS JOIN external_full_sync w
      CROSS JOIN external_full_snapshots s WHERE s.id=$1`,[id])).rows[0];
    assert.deepEqual(await state(),{ceiling:million,admitted,state:'verified',applyCursor:0,targetRows:million,
      receiveCursor:'777',capacityPending:true});

    const claim=(id:string,evidence?:Parameters<typeof permitFullSyncAdmission>[1])=>db.transaction(async tx=>{
      await permitFullSyncAdmission(tx,evidence);
      return admitFormalListing(tx,'che168',id);
    });
    const csv={basis:'csv' as const,snapshotId};
    assert.equal(await claim('102',csv),false);
    // Only clear this in the fixture. In production the measured capacity gate owns it.
    await db.pool.query('UPDATE external_full_sync SET capacity_pending=false WHERE id=1');
    assert.equal(await claim('101'),true);
    assert.equal(await claim('102'),false);
    assert.equal(await claim('104',csv),false);
    assert.equal(await claim('102',{...csv,snapshotId:randomUUID()}),false);
    assert.deepEqual(await Promise.all([claim('102',csv),claim('102',csv)]),[true,true]);

    const record=async(id:string,externalId:string,denied=false)=>db.pool.query(`INSERT INTO external_full_events
      (event_id,payload_hash,source,external_id,operation,business_at,document_refs,applied_at,error_code)
      VALUES($1,'fixture','che168',$2,'upsert',now()-interval '1 minute','[]',
        CASE WHEN $3 THEN now() END,CASE WHEN $3 THEN 'SYNC_LISTING_LIMIT' END)`,[id,externalId,denied]);
    const incremental={basis:'incremental' as const,eventId:'17'};
    await record('17','105');
    assert.equal(await claim('105',incremental),false);
    await db.pool.query("UPDATE external_full_snapshots SET apply_cursor=rows,state='complete',completed_at=now() WHERE id=$1",[snapshotId]);
    await db.pool.query('UPDATE external_full_sync SET disk_paused=true WHERE id=1');

    const rollbackId=randomUUID();
    const rollback={id:rollbackId,rollbackOf:operationId,expectedCount:oldLimit,expectedLimit:million,target:oldLimit,receipt:null};
    const rolledBack=await change(rollback);
    assert.deepEqual(await change(rollback),rolledBack);
    assert.deepEqual(await state(),{ceiling:oldLimit,admitted:oldLimit,state:'complete',applyCursor:3,targetRows:oldLimit,
      receiveCursor:'777',capacityPending:true});
    assert.equal((await db.pool.query('SELECT closed_at IS NOT NULL AS closed FROM external_formal_expansion_operations WHERE id=$1',[operationId])).rows[0].closed,true);

    await db.pool.query('UPDATE external_full_sync SET disk_paused=false WHERE id=1');
    const secondId=randomUUID(),secondSnapshot=randomUUID();
    await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes,rows,staged,apply_cursor,target_rows)
      VALUES($1,now()-interval '1 hour','verified','second.csv.gz',$2,2048,1,1,0,$3)`,[secondSnapshot,csvSha256,oldLimit]);
    await db.pool.query(`INSERT INTO external_full_stage VALUES($1,1,'che168','101','{}')`,[secondSnapshot]);
    await change({id:secondId,snapshot:secondSnapshot,expectedCount:oldLimit});
    await db.pool.query('UPDATE external_full_sync SET capacity_pending=false WHERE id=1');
    await db.pool.query("UPDATE external_full_snapshots SET apply_cursor=rows,state='complete',completed_at=now() WHERE id=$1",[secondSnapshot]);
    assert.equal(await claim('106',incremental),false);
    assert.equal(await claim('105',incremental),true);
    const replayId=randomUUID();
    await record('18','106',true);
    await db.pool.query(`INSERT INTO external_full_admission_replays
      (id,snapshot_id,csv_sha256,capacity_receipt,requested_by,target_rows,request_hash,coverage)
      VALUES($1,$2,$3,$4,'expansion-admin',$5,$4,'{}')`,[replayId,secondSnapshot,csvSha256,capacity,million]);
    await db.pool.query("INSERT INTO external_full_admission_replay_items(replay_id,event_id,source,external_id) VALUES($1,18,'che168','106')",[replayId]);
    const replay={basis:'replay' as const,eventId:'18',replayId};
    assert.equal(await claim('106',replay),false);
    await db.transaction(async tx=>{
      await permitFullSyncAdmission(tx,replay);
      await tx.query("SELECT set_config('hd.external_full_admission_replay',$1,true)",[replayId]);
      assert.equal(await admitFormalListing(tx,'che168','106'),false);
      await tx.query(`UPDATE external_full_admission_replay_items
        SET state='scheduled',detail_generation=1,placeholder_created=true WHERE replay_id=$1`,[replayId]);
      await tx.query("INSERT INTO external_full_members(source,external_id,canonical_id) VALUES('che168','106','fixture:106')");
      await tx.query(`INSERT INTO external_full_work(source,external_id,kind,generation,locales)
        VALUES('che168','106','detail',1,ARRAY['zh','en','ru'])`);
      await tx.query("UPDATE external_full_admission_replays SET state='scheduled' WHERE id=$1",[replayId]);
    });
    await assert.rejects(db.transaction(async tx=>{
      await permitFullSyncAdmission(tx,replay);
      await tx.query("SELECT set_config('hd.external_full_admission_replay',$1,true)",[replayId]);
      assert.equal(await admitFormalListing(tx,'che168','106'),true);
      throw new Error('fixture later write failure');
    }),/fixture later write failure/);
    assert.equal((await state(secondSnapshot)).admitted,oldLimit+1);
    await db.transaction(async tx=>{
      await permitFullSyncAdmission(tx,replay);
      await tx.query("SELECT set_config('hd.external_full_admission_replay',$1,true)",[replayId]);
      assert.equal(await admitFormalListing(tx,'che168','106'),true);
      await tx.query("UPDATE external_full_admission_replays SET state='finished' WHERE id=$1",[replayId]);
    });
    await assert.rejects(change({...rollback,id:randomUUID(),rollbackOf:secondId,snapshot:secondSnapshot,
      expectedCount:oldLimit+2}),{code:'HD55B'});

    const receipts=(await db.pool.query(`SELECT reservation_id,snapshot_id,csv_sha256,external_id,basis,event_id::text,replay_id,
      admitted_at IS NOT NULL AS timed FROM external_formal_expansion_admissions ORDER BY entry_id`)).rows;
    const common={csv_sha256:csvSha256,timed:true};
    assert.deepEqual(receipts,[
      {...common,snapshot_id:snapshotId,reservation_id:operationId,external_id:'102',basis:'csv',event_id:null,replay_id:null},
      {...common,snapshot_id:secondSnapshot,reservation_id:secondId,external_id:'105',basis:'incremental',event_id:'17',replay_id:null},
      {...common,snapshot_id:secondSnapshot,reservation_id:secondId,external_id:'106',basis:'replay',event_id:'18',replay_id:replayId},
    ]);
  }finally{
    await db.close();
    if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    if(roleCreated)await maintenance.pool.query(`DROP ROLE "${name}"`);
    await maintenance.close();
    await rm(directory,{recursive:true,force:true});
  }
});
