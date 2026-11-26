import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {AdmissionBatchReceiptRequest,readAdmissionBatchReceipt} from '../src/external/full-sync/admission-receipt.js';

test('admission receipt keeps exact first-admission scope, pagination and current source availability',async t=>{
  const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)
    throw new Error('This test requires isolated loopback PostgreSQL.');
  const name='hd_admission_receipt_'+randomBytes(8).toString('hex');
  const maintenance=createDatabase(url.href,1);
  url.pathname='/'+name;
  const db=createDatabase(url.href,2);
  let created=false;
  t.after(async()=>{
    await db.close();
    try {if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
    finally {await maintenance.close();}
  });
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created=true;
  await migrateDatabase(db);

  const reservationId=randomUUID(),snapshotId=randomUUID(),nextSnapshotId=randomUUID();
  const csvSha256='a'.repeat(64),nextSha='b'.repeat(64);
  const request={reservationId,snapshotId};
  await db.pool.query(`INSERT INTO external_full_snapshots(id,generated_at,state,path,sha256,bytes,rows,staged,apply_cursor,target_rows)
    VALUES ($1,now()-interval '1 day','complete','old.fixture',$2,512,6,6,6,1000000),
           ($3,now(),'complete','new.fixture',$4,512,1,1,1,1000000)`,[snapshotId,csvSha256,nextSnapshotId,nextSha]);
  await db.pool.query(`INSERT INTO external_formal_admissions(source,external_id)
    VALUES ('che168','11'),('che168','22'),('che168','33'),('che168','44'),('che168','55'),('che168','66'),
           ('che168','00'),('che168','77'),('che168','999')`);
  await db.pool.query(`INSERT INTO external_formal_expansion_operations
    (id,snapshot_id,csv_sha256,requested_by,request_hash,capacity_receipt,prior_limit,target_limit,admitted_count,worker_fence,apply_cursor,result)
    VALUES ($1,$2,$3,'operator',repeat('c',64),repeat('d',64),150000,1000000,1,1,0,'{}')`,
  [reservationId,snapshotId,csvSha256]);
  const receipt=async(limit?:number)=>readAdmissionBatchReceipt(db,{...request,limit});
  assert.deepEqual((await receipt()).items,[]);
  await assert.rejects(readAdmissionBatchReceipt(db,{reservationId,snapshotId:nextSnapshotId}),/SYNC_ADMISSION_RECEIPT_NOT_FOUND/);
  assert.equal(AdmissionBatchReceiptRequest.safeParse({...request,cursor:{through:'cannot parse',after:'1'}}).success,false);
  assert.equal(AdmissionBatchReceiptRequest.safeParse({...request,cursor:{through:'9223372036854775808',after:'1'}}).success,false);

  const identities=['11','22','33','44','55','66'];
  await db.pool.query(`INSERT INTO external_full_members(source,external_id,canonical_id,state,desired_generation)
    VALUES ('che168','11','fixture-11','pending',2),('che168','22','fixture-22','pending',1),
           ('che168','33','fixture-33','withdrawn',1),('che168','44','fixture-44','active',1),
           ('che168','55','fixture-shared','active',1),('che168','66','fixture-shared','active',1)`);
  await db.pool.query(`INSERT INTO external_full_work(source,external_id,kind,generation,attempts,last_error_code)
    VALUES ('che168','11','detail',1,5,'STALE_DETAIL_FAILURE'),('che168','22','detail',1,5,'SYNC_DETAIL_NOT_FOUND')`);
  const hiddenId=randomUUID(),publicId=randomUUID(),aliasId=randomUUID();
  await db.pool.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at,formal_canonical_id,formal_primary)
    VALUES ($1,'chinacarapi','che168','44',1,'fixture','{}','active',now(),now(),'fixture-44',true),
           ($2,'chinacarapi','che168','55',1,'fixture','{}','active',now(),now(),'fixture-shared',true),
           ($3,'chinacarapi','che168','66',1,'fixture','{}','active',now(),now(),'fixture-shared',false)`,
  [hiddenId,publicId,aliasId]);
  await db.pool.query(`INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,'{"hidden":true}')`,[hiddenId]);
  await db.pool.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,issues,localized,details)
    VALUES ($1,now(),'Fixture','https://example.invalid/listing/55','{}','[]','{"zh":{},"ru":{}}','{}')`,[publicId]);
  const addJournal=(snap:string,sha:string,ids:string[])=>db.pool.query(`INSERT INTO external_formal_expansion_admissions
    (reservation_id,snapshot_id,csv_sha256,source,external_id,basis)
    SELECT $1,$2,$3,'che168',external_id,'csv' FROM unnest($4::text[]) WITH ORDINALITY input(external_id,n) ORDER BY input.n`,
  [reservationId,snap,sha,ids]);
  await addJournal(snapshotId,csvSha256,identities);
  const first=await receipt(2);
  assert.deepEqual(first.items.map(({externalId,status,detailErrorCode})=>[externalId,status,detailErrorCode]),[
    ['11','pending',null],['22','failed','SYNC_DETAIL_NOT_FOUND'],
  ]);
  assert.equal(first.csvSha256,csvSha256);
  assert.ok(first.items.every(item=>item.basis==='csv'&&item.admittedAt.endsWith('Z')));
  const cursor=first.nextCursor;
  assert.ok(cursor);
  assert.notEqual(cursor.after,cursor.through);

  // Admissions after the captured high-water mark, including a lower source ID, must not join this traversal.
  await addJournal(snapshotId,csvSha256,['00']);
  await addJournal(nextSnapshotId,nextSha,['77']);
  const last=await readAdmissionBatchReceipt(db,{...request,cursor});
  assert.deepEqual(last.items.map(({externalId,status,localeMask})=>[externalId,status,localeMask]),[
    ['33','withdrawn',0],['44','hidden',0],['55','public',5],['66','not_public',0],
  ]);
  assert.deepEqual(last.pageCounts,{public:1,withdrawn:1,hidden:1,failed:0,pending:0,not_public:1});
  assert.equal(last.nextCursor,null);
  assert.equal(last.through,first.through);
  assert.deepEqual((await receipt()).items.map(item=>item.externalId),[...identities,'00']);
  assert.deepEqual((await readAdmissionBatchReceipt(db,{reservationId,snapshotId:nextSnapshotId})).items.map(item=>item.externalId),['77']);
  await assert.rejects(readAdmissionBatchReceipt(db,{reservationId,snapshotId:nextSnapshotId,cursor}),/SYNC_ADMISSION_RECEIPT_CURSOR_CHANGED/);
});
