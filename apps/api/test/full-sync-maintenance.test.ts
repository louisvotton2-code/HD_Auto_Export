import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {runSourceMaintenance} from '../src/external/full-sync/maintenance.js';

test('archive maintenance resumes keyset batches beyond a pinned prefix and retains heads plus one recent history',async()=>{
 const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(address.protocol)||address.hostname!=='127.0.0.1'||address.pathname!=='/postgres'||address.search||address.hash)throw new Error('Isolated loopback maintenance database only.');
 const maintenance=createDatabase(address.toString(),1),name=`hd_ext_archive_${randomBytes(8).toString('hex')}`;let db:Database|undefined,created=false;
 const id=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;address.pathname=`/${name}`;db=createDatabase(address.toString(),2);await migrateDatabase(db);
  const rows=Array.from({length:1009},(_,i)=>({id:id(i+1),hash:createHash('sha256').update(JSON.stringify({i:i+1})).digest('hex'),payload:{i:i+1},recent:i>=999}));
  await db.pool.query(`INSERT INTO external_source_blobs(hash,payload,created_at) SELECT hash,payload,'2001-01-01'::timestamptz FROM jsonb_to_recordset($1::jsonb) AS p(hash text,payload jsonb)`,[JSON.stringify(rows)]);
  await db.pool.query(`INSERT INTO external_source_documents(id,provider,source,external_id,kind,locale,hash,presence,first_observed_at,last_observed_at)
   SELECT id::uuid,'chinacarapi','che168','9001','detail','en',hash,'{}',CASE WHEN recent THEN now() ELSE '2001-01-01'::timestamptz END,CASE WHEN recent THEN now() ELSE '2001-01-01'::timestamptz END FROM jsonb_to_recordset($1::jsonb) AS p(id text,hash text,recent boolean)`,[JSON.stringify(rows.slice(0,1001))]);
  await db.pool.query(`INSERT INTO external_source_heads(provider,source,external_id,kind,locale,document_id,observed_at,merged_payload) VALUES('chinacarapi','che168','9001','detail','en',$1,now(),'{}')`,[id(1001)]);
  await db.pool.query("INSERT INTO external_source_document_refs VALUES($1,'pending','queued'),($2,'backup','retained-backup')",[id(1),id(3)]);
  await db.pool.query("INSERT INTO external_source_blob_refs(hash,kind,reference) VALUES($1,'audit','staff-event'),($2,'backup','retained-backup')",[rows[1]!.hash,rows[2]!.hash]);
  await db.pool.query('UPDATE external_source_documents SET response_hash=$2 WHERE id=$1',[id(1001),rows[1004]!.hash]);
  await db.pool.query(`INSERT INTO external_source_responses(document_id,response_hash,observed_at) VALUES($1,$2,'2001-01-01'),($1,$3,'2001-01-01'),($1,$4,now()-interval '1 minute'),($1,$5,now())`,[id(1001),...rows.slice(1001,1005).map(r=>r.hash)]);
  await db.pool.query(`INSERT INTO external_trim_documents(provider,trim_id,locale,hash,last_observed_at) VALUES('chinacarapi','trim-1','en',$1,'2001-01-01'),('chinacarapi','trim-1','en',$2,'2001-01-01'),('chinacarapi','trim-1','en',$3,now()-interval '1 minute'),('chinacarapi','trim-1','en',$4,now())`,rows.slice(1005,1009).map(r=>r.hash));
  await db.pool.query("INSERT INTO external_source_blob_refs(hash,kind,reference) VALUES($1,'pending','report-pending'),($2,'backup','trim-backup')",[rows[1002]!.hash,rows[1006]!.hash]);
  const first=await runSourceMaintenance(db);assert.equal(first.segments,4);assert.equal(first.visited,800);assert.equal(first.deleted,797);
  const saved=(await db.pool.query('SELECT phase,cursor FROM external_source_maintenance WHERE id=1')).rows[0];assert.equal(saved.phase,'documents');assert.equal(saved.cursor.id,id(800));
  // A new invocation resumes the database checkpoint; no process-local continuation is required.
  let finished=false;for(let i=0;i<10&&!finished;i++){const result=await runSourceMaintenance(db);assert.ok(result.segments<=4);assert.ok(result.visited<=800);finished=result.finished;}
  assert.ok(finished);const kept=(await db.pool.query('SELECT id FROM external_source_documents ORDER BY id')).rows.map(r=>r.id);assert.deepEqual(kept,[id(1),id(2),id(3),id(1000),id(1001)]);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM external_source_blobs')).rows[0].n,11);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM external_source_responses')).rows[0].n,3);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM external_trim_documents')).rows[0].n,3);
  assert.equal((await db.pool.query('SELECT rounds FROM external_source_maintenance WHERE id=1')).rows[0].rounds,'1');assert.equal((await runSourceMaintenance(db)).segments,0);
  // Releasing a pin and aging the former latest history is observed on the next scheduled sweep.
  await db.pool.query("DELETE FROM external_source_document_refs WHERE reference='queued'");
  await db.pool.query("UPDATE external_source_documents SET last_observed_at='2001-01-01' WHERE id=$1",[id(1000)]);
  await db.pool.query("UPDATE external_source_maintenance SET due_at='-infinity' WHERE id=1");
  finished=false;for(let i=0;i<10&&!finished;i++)finished=(await runSourceMaintenance(db)).finished;
  assert.ok(finished);assert.deepEqual((await db.pool.query('SELECT id FROM external_source_documents ORDER BY id')).rows.map(r=>r.id),[id(2),id(3),id(1001)]);
 }finally{await db?.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);await maintenance.close();}
});
