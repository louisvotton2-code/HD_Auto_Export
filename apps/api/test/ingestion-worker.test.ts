import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {prepareSnapshot} from '../src/external/ingestion/snapshot.js';
import {hydratePending} from '../src/external/ingestion/hydrate.js';
import {ChinaCarClient} from '../src/external/ingestion/provider.js';
import {catalogColumns} from '../src/external/sources/index.js';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {createImportJob,receivePage,verifySnapshot,recoverExpiredCursor,FixedScopeWorker,SERVICE_ACTOR,beginCatchUp} from '../src/external/ingestion/worker.js';
import {ManifestSchema,type IngestionEvent,type SourceApplier} from '../src/external/ingestion/types.js';

test('fixed-scope ingestion persists leases, pages, failures, withdrawal precedence and bounded recovery',async t=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)throw new Error('Worker tests require a local maintenance database.');
 const socket=process.env.API_TEST_DATABASE_SOCKET;if(socket){if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('Invalid existing socket.');url.searchParams.set('host',socket);}
 const name=`hd_ext_worker_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.toString(),1);let db:Database|undefined,created=false;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;db=createDatabase(url.toString(),2);const database=db;await migrateDatabase(db);
  if(!(await db.pool.query("SELECT to_regclass('external_ingestion_jobs') AS relation")).rows[0].relation)await db.pool.query(await readFile(new URL('../migrations/0019_ingestion.sql',import.meta.url),'utf8'));
  await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('worker-test-admin','Operator','worker-test@example.invalid','admin',false)");
  await db.pool.query('CREATE TABLE test_worker_effects(event_key text PRIMARY KEY,obsolete boolean NOT NULL)');
  const at='2026-11-13T00:00:00.000Z';const manifest=ManifestSchema.parse({version:1,provider:'chinacarapi',generatedAt:at,identities:[{source:'che168',externalId:'123',canonicalId:'car-1'}],csv:{sha256:'a'.repeat(64),bytes:10,rows:1,sourceCounts:{che168:1,dongchedi:0},generatedAt:at,complete:true}});
  const event=(key:string,operation:IngestionEvent['operation']='upsert',order='0'):IngestionEvent=>({key,identity:{provider:'chinacarapi',source:'che168',externalId:'123'},operation,businessOrder:order,observedAt:at,snapshotHash:'a'.repeat(64),document:[]});
  const apply:SourceApplier=async(tx,e,c)=>{await tx.query('INSERT INTO test_worker_effects VALUES($1,$2)',[e.key,c.obsolete]);};
  await t.test('fixed identities, source-page atomicity and historical trigger identity',async()=>{
   const id=await createImportJob(database,'fixed',manifest,'worker-test-admin');assert.equal(await createImportJob(database,'fixed',manifest,'worker-test-admin'),id);
   await assert.rejects(createImportJob(database,'fixed',{...manifest,identities:[{...manifest.identities[0],externalId:'other'}]},'worker-test-admin'),/MANIFEST_CONFLICT/);
   await assert.rejects(createImportJob(database,'new',manifest,SERVICE_ACTOR),/FORBIDDEN/);
   const page={lane:'snapshot' as const,inputCursor:null,nextCursor:'1',terminal:false,events:[event('snapshot'),{...event('outside'),identity:{...event('outside').identity,externalId:'999'}}]};
   assert.equal((await receivePage(database,id,page)).inserted,1);assert.equal((await receivePage(database,id,page)).replayed,true);
   await assert.rejects(receivePage(database,id,{...page,events:[event('changed')]}),/PAGE_CONFLICT/);
   assert.equal((await database.pool.query('SELECT received_seq FROM external_ingestion_jobs WHERE id=$1',[id])).rows[0].received_seq,'1');
   await assert.rejects(verifySnapshot(database,id,{...manifest.csv,bytes:11}),/PROOF_INVALID/);
   assert.equal((await database.pool.query('SELECT state FROM external_ingestion_jobs WHERE id=$1',[id])).rows[0].state,'awaiting_snapshot');
   const actor=(await database.pool.query('SELECT banned FROM staff WHERE id=$1',[SERVICE_ACTOR])).rows[0];assert.equal(actor.banned,true);
  });
  await t.test('withdrawals apply first while the contiguous checkpoint waits for all earlier events',async()=>{
   const id=await createImportJob(database,'withdraw',manifest,'worker-test-admin');await verifySnapshot(database,id,manifest.csv);
   await receivePage(database,id,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[event('old-snapshot')]});
   await receivePage(database,id,{lane:'delta',inputCursor:null,nextCursor:'100',terminal:true,events:[event('removed','withdraw','100')]});
   const result=await new FixedScopeWorker(database,apply).tick(id);assert.equal(result.state,'complete');assert.equal(result.checkpoint,'2');
   const effects=(await database.pool.query('SELECT * FROM test_worker_effects ORDER BY event_key')).rows;assert.deepEqual(effects,[{event_key:'old-snapshot',obsolete:true},{event_key:'removed',obsolete:false}]);
   for(let run=0;run<2;run++){await beginCatchUp(database,id);await receivePage(database,id,{lane:'delta',inputCursor:'100',nextCursor:'100',terminal:true,events:[]});assert.equal((await new FixedScopeWorker(database,apply).tick(id)).state,'complete');}
   assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_ingestion_members WHERE job_id=$1',[id])).rows[0].n,1);
  });
  await t.test('callback failure rolls back effects and checkpoint; fenced lease cannot run',async()=>{
   const id=await createImportJob(database,'failure',manifest,'worker-test-admin');await verifySnapshot(database,id,manifest.csv);
   await receivePage(database,id,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[event('fails','relist','101')]});
   const broken=new FixedScopeWorker(database,async(tx,e,c)=>{await apply(tx,e,c);throw new Error('isolated failure');});await assert.rejects(broken.tick(id),/isolated failure/);
   assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM test_worker_effects WHERE event_key='fails'")).rows[0].n,0);
   assert.equal((await database.pool.query('SELECT applied_seq FROM external_ingestion_jobs WHERE id=$1',[id])).rows[0].applied_seq,'0');
   await database.pool.query("UPDATE external_ingestion_jobs SET retry_at='-infinity' WHERE id=$1",[id]);
   const worker=new FixedScopeWorker(database,apply),lease=(await worker.claim(id))!;await database.pool.query("UPDATE external_ingestion_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
   const replacement=new FixedScopeWorker(database,apply),next=(await replacement.claim(id))!;await assert.rejects(worker.run(lease),/LEASE_LOST/);await replacement.run(next);
  });
  await t.test('fresh complete baseline repairs expired-feed state and older unhydrated deltas finish without network',async()=>{
   await database.pool.query("UPDATE external_ingestion_identity_state SET withdrawn=true WHERE provider='chinacarapi' AND source='che168' AND external_id='123'");
   const newer={...manifest,generatedAt:'2026-11-14T00:00:00.000Z',csv:{...manifest.csv,generatedAt:'2026-11-14T00:00:00.000Z'}};
   const id=await createImportJob(database,'new-baseline',newer,'worker-test-admin');await verifySnapshot(database,id,newer.csv);
   await receivePage(database,id,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[{...event('new-snapshot'),observedAt:newer.generatedAt}]});
   await receivePage(database,id,{lane:'delta',inputCursor:null,nextCursor:'100',terminal:true,events:[event('old-unhydrated','upsert','100')]});
   const result=await new FixedScopeWorker(database,apply).tick(id);assert.equal(result.state,'complete');
   const state=(await database.pool.query('SELECT withdrawn,business_order FROM external_ingestion_identity_state')).rows[0];assert.equal(state.withdrawn,false);assert.equal(state.business_order,'101');
   const effects=(await database.pool.query("SELECT * FROM test_worker_effects WHERE event_key IN ('new-snapshot','old-unhydrated') ORDER BY event_key")).rows;
   assert.deepEqual(effects,[{event_key:'new-snapshot',obsolete:false},{event_key:'old-unhydrated',obsolete:true}]);
  });
  await t.test('recovery cannot relabel an old queued snapshot as the new verified generation',async()=>{
   const id=await createImportJob(database,'old-generation',manifest,'worker-test-admin');
   await receivePage(database,id,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[event('old-generation-snapshot')]});
   const proof={...manifest.csv,sha256:'b'.repeat(64),generatedAt:'2026-11-15T00:00:00.000Z'};await recoverExpiredCursor(database,id,proof);await verifySnapshot(database,id,proof);
   await receivePage(database,id,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[{...event('new-generation-snapshot'),snapshotHash:proof.sha256,observedAt:proof.generatedAt}]});
   await receivePage(database,id,{lane:'delta',inputCursor:null,nextCursor:'200',terminal:true,events:[]});
   await new FixedScopeWorker(database,apply).tick(id);
   assert.equal((await database.pool.query("SELECT obsolete FROM test_worker_effects WHERE event_key='old-generation-snapshot'")).rows[0].obsolete,true);
   assert.equal((await database.pool.query("SELECT obsolete FROM test_worker_effects WHERE event_key='new-generation-snapshot'")).rows[0].obsolete,false);
  });
  await t.test('a verified recovery CSV omission stays pending and never invents a withdrawal',async()=>{
   const values=catalogColumns.map(key=>key==='source'?'che168':key==='id'?'999':'');
   const bytes=Buffer.from(catalogColumns.join(',')+'\n'+values.join(',')+'\n');
   const missing={...manifest,generatedAt:'2026-11-16T00:00:00.000Z',csv:{...manifest.csv,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,generatedAt:'2026-11-16T00:00:00.000Z'}};
   const previous=(await database.pool.query('SELECT withdrawn FROM external_ingestion_identity_state')).rows[0].withdrawn;
   const id=await prepareSnapshot(database,{key:'missing-snapshot',manifest:missing,triggeredBy:'worker-test-admin',allowMissingForRecovery:true,csv:(async function*(){yield bytes;})(),documents:(async function*(){})()});
   await receivePage(database,id,{lane:'delta',inputCursor:null,nextCursor:'300',terminal:true,events:[]});
   const result=await new FixedScopeWorker(database,apply).tick(id);assert.equal(result.state,'ready');assert.equal(result.processed,0);
   assert.equal((await database.pool.query('SELECT verification_pending FROM external_ingestion_members WHERE job_id=$1',[id])).rows[0].verification_pending,true);
   assert.equal((await database.pool.query('SELECT withdrawn FROM external_ingestion_identity_state')).rows[0].withdrawn,previous);
  });
  await t.test('bulk wrapper unknown fields are archived once and notFound does not block another member',async()=>{
   const members={...manifest,identities:[...manifest.identities,{source:'che168' as const,externalId:'124',canonicalId:'car-2'}]};
   const id=await createImportJob(database,'hydrate',members,'worker-test-admin');await verifySnapshot(database,id,members.csv);
   await receivePage(database,id,{lane:'snapshot',inputCursor:null,nextCursor:null,terminal:true,events:[]});
   await receivePage(database,id,{lane:'delta',inputCursor:null,nextCursor:'202',terminal:true,events:[{...event('hydrate-good','upsert','201'),observedAt:'2026-11-17T00:00:00.000Z'},
    {...event('hydrate-missing','upsert','202'),identity:{provider:'chinacarapi',source:'che168',externalId:'124'},observedAt:'2026-11-17T00:00:00.000Z'}]});
   const body=JSON.stringify({results:[{source:'che168',id:'123',status:'active'}],notFound:['124'],unknownWrapper:{preserved:true}});
   const client=new ChinaCarClient('fake-key',{fetch:async()=>new Response(body,{headers:{'content-type':'application/json'}})});
   assert.equal(await hydratePending(database,client,id),1);
   const blob=(await database.pool.query('SELECT raw_text AS body FROM external_source_blobs WHERE hash=$1',[createHash('sha256').update(body).digest('hex')])).rows[0];assert.equal(blob.body,body);
   const result=await new FixedScopeWorker(database,apply).tick(id);assert.equal(result.processed,1);assert.equal(result.state,'ready');
   assert.equal((await database.pool.query("SELECT hydration_error FROM external_ingestion_events WHERE job_id=$1 AND external_id='124'",[id])).rows[0].hydration_error,'not_found');
  });
  await t.test('410 recovery retains scope and queued events and stops at the configured bound',async()=>{
   const id=await createImportJob(database,'recovery',manifest,'worker-test-admin');await receivePage(database,id,{lane:'delta',inputCursor:null,nextCursor:'5',terminal:true,events:[event('withdraw-recovery','withdraw','105')]});
   await recoverExpiredCursor(database,id,manifest.csv);await recoverExpiredCursor(database,id,manifest.csv);await assert.rejects(recoverExpiredCursor(database,id,manifest.csv),/RECOVERY_LIMIT/);
   assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_ingestion_events WHERE job_id=$1',[id])).rows[0].n,1);
   assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_ingestion_members WHERE job_id=$1',[id])).rows[0].n,1);
  });
 }finally{if(db)await db.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);await maintenance.close();}
});
