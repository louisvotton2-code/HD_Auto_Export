import {changeBackupLease,physicalCleanupAllowed} from '../src/backup-lease.js';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {MediaService} from '../src/media/service.js';
import {LocalMediaStore} from '../src/media/storage.js';
import {ApiError} from '../src/errors.js';

const baseUrl=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['127.0.0.1','localhost'].includes(baseUrl.hostname)||baseUrl.pathname!=='/postgres') throw new Error('Media tests require a local PostgreSQL maintenance database.');
const databaseName=`hd_media_test_${randomBytes(8).toString('hex')}`;
const maintenance=createDatabase(baseUrl.toString(),2);
const actor={id:randomUUID(),requestId:randomUUID()};
const rights={basis:'owned' as const,note:'Synthetic isolated media test image.'};
let db:Database;let dbUrl:string;let media:MediaService;let store:LocalMediaStore;let root:string;let bytes:Buffer;

before(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'hd-media-softdelete-'));
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  const url=new URL(baseUrl);url.pathname=`/${databaseName}`;
  dbUrl=url.toString();db=createDatabase(dbUrl,5);await migrateDatabase(db);
  await db.pool.query('INSERT INTO staff(id,name,email) VALUES($1,$2,$3)',[actor.id,'Isolated media tester','media@example.invalid']);
  store=new LocalMediaStore(path.join(root,'media'));media=new MediaService(db,store);
  bytes=await sharp({create:{width:24,height:24,channels:3,background:'#334455'}}).png().toBuffer();
});
after(async()=>{
  if(db) await db.close();
  await maintenance.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await maintenance.close();
  if(root) await rm(root,{recursive:true,force:true});
});
async function vehicle() {
  const id=randomUUID();await db.pool.query('INSERT INTO vehicles(id) VALUES($1)',[id]);
  await db.pool.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify({media:[]})]);
  return id;
}
async function ready(vehicleId:string) {
  const permit=await media.create({vehicleId,contentType:'image/png',sizeBytes:bytes.length,rights},actor);
  const uploaded=await media.upload(permit.media.id,permit.media.version,bytes,'image/png',actor);
  return media.complete(uploaded.id,uploaded.version,actor);
}
async function publish(vehicleId:string,mediaId:string) {
  const publication=randomUUID();
  await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,vehicleId,'{}']);
  await db.pool.query('INSERT INTO publication_media(publication_id,media_id) VALUES($1,$2)',[publication,mediaId]);
  await db.pool.query("UPDATE vehicles SET published_revision_id=$2,publication_state='published',published_at=now() WHERE id=$1",[vehicleId,publication]);
}
const hidden=(action:()=>Promise<unknown>)=>assert.rejects(action,(error:unknown)=>error instanceof ApiError&&error.status===404);
const gate=()=>{
  let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
};
async function waitForVehicleLock() {
  for(let i=0;i<100;i++) {
    const waiting=await db.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%vehicles%'`);
    if(waiting.rowCount) return;
    await delay(10);
  }
  assert.fail('Expected the competing operation to wait for the vehicle row lock');
}

test('deleted owners hide every media operation while retaining files and publication references',async()=>{
  const vehicleId=await vehicle();const image=await ready(vehicleId);
  const options={readBody:true};
  await hidden(()=>media.publicDelivery(image.id,'thumb',options));
  const permit=await media.create({vehicleId,contentType:'image/png',sizeBytes:bytes.length,rights},actor);
  await publish(vehicleId,image.id);
  assert.ok((await media.publicDelivery(image.id,undefined,options)).body?.length);
  assert.ok((await media.publicDelivery(image.id,'thumb',options)).body?.length);
  await db.pool.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);
  for(const action of [
    ()=>media.get(image.id),()=>media.preview(image.id),()=>media.publicDelivery(image.id,undefined,options),()=>media.publicDelivery(image.id,'thumb',options),
    ()=>media.create({vehicleId,contentType:'image/png',sizeBytes:bytes.length,rights},actor),
    ()=>media.upload(permit.media.id,permit.media.version,bytes,'image/png',actor),
    ()=>media.complete(image.id,image.version,actor),()=>media.remove(image.id,image.version,actor),
  ]) await hidden(action);
  await db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE vehicle_id=$1",[vehicleId]);
  assert.equal((await media.cleanupExpired()).removed,0);
  assert.ok((await store.read(image.id)).length);
  assert.ok((await store.readThumbnail(image.id)).length);
  assert.equal((await db.pool.query('SELECT 1 FROM publication_media WHERE media_id=$1',[image.id])).rowCount,1);
  assert.equal((await db.pool.query('SELECT 1 FROM media_assets WHERE vehicle_id=$1',[vehicleId])).rowCount,2);
});

test('public media GET and HEAD revalidate only while the owner remains public',async t=>{
  for(const mode of ['direct','nginx'] as const) {
    await t.test(mode,async t=>{
      const runtime=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:dbUrl,
        AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:path.join(root,'media'),MEDIA_DELIVERY:mode}));
      t.after(()=>runtime.app.close());
      const vehicleId=await vehicle();const image=await ready(vehicleId);
      const url=`/api/v1/media/${image.id}`;
      const unpublished=await runtime.app.inject({method:'GET',url,headers:{'if-none-match':'*'}});
      assert.equal(unpublished.statusCode,404);
      assert.equal(unpublished.headers['cache-control'],'no-store');
      await publish(vehicleId,image.id);

      const validators=new Map<string,string>();
      for(const variant of [undefined,'thumb'] as const) {
        const imageUrl=variant?`${url}?variant=thumb`:url;
        const get=await runtime.app.inject({method:'GET',url:imageUrl});
        const etag=get.headers.etag;
        assert.equal(get.statusCode,200,get.body);
        assert.equal(get.headers['content-type'],'image/webp');
        assert.equal(typeof etag,'string');
        assert.ok(typeof etag==='string'&&etag.startsWith('W/"'));
        validators.set(imageUrl,etag);
        const head=await runtime.app.inject({method:'HEAD',url:imageUrl});
        assert.equal(head.statusCode,200);
        assert.equal(head.headers.etag,etag);
        assert.equal(head.rawPayload.length,0);
        if(mode==='nginx') {
          const internalPath=`/_hd_public_media/${image.id}${variant?'.thumb':''}.webp`;
          assert.equal(get.headers['x-accel-redirect'],internalPath);
          assert.equal(head.headers['x-accel-redirect'],internalPath);
          assert.equal(get.rawPayload.length,0);
        } else {
          assert.equal(get.headers['x-accel-redirect'],undefined);
          assert.equal(head.headers['x-accel-redirect'],undefined);
          assert.equal(get.headers['cache-control'],'private, no-cache');
          assert.equal(head.headers['cache-control'],'private, no-cache');
          assert.ok(get.rawPayload.length>0);
          assert.equal(Number(head.headers['content-length']),get.rawPayload.length);
        }
        const headers:Record<string,string>={'if-none-match':etag};
        for(const method of ['GET','HEAD'] as const) {
          const cached:{statusCode:number;headers:Record<string,unknown>;rawPayload:Buffer}=
            await runtime.app.inject({method,url:imageUrl,headers});
          assert.equal(cached.statusCode,304);
          assert.equal(cached.headers.etag,etag);
          assert.equal(cached.headers['cache-control'],'private, no-cache');
          assert.equal(cached.headers['x-accel-redirect'],undefined);
          assert.equal(cached.rawPayload.length,0);
        }
      }
      assert.equal(new Set(validators.values()).size,2);
      await db.pool.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);
      for(const [imageUrl,etag] of validators) {
        for(const method of ['GET','HEAD'] as const) {
          const revoked=await runtime.app.inject({method,url:imageUrl,headers:{'if-none-match':etag}});
          assert.equal(revoked.statusCode,404);
          assert.equal(revoked.headers['cache-control'],'no-store');
          assert.equal(revoked.headers.etag,undefined);
          assert.equal(revoked.headers['x-accel-redirect'],undefined);
          if(method==='HEAD') assert.equal(revoked.rawPayload.length,0);
        }
      }
      assert.ok((await store.read(image.id)).length);
      assert.ok((await store.readThumbnail(image.id)).length);
    });
  }
});

test('cleanup candidate selected before vehicle deletion is preserved after waiting for its lock',async()=>{
  const vehicleId=await vehicle();const image=await ready(vehicleId);
  await db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE id=$1",[image.id]);
  const blocker=await db.pool.connect();let cleaning:Promise<{removed:number}>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE',[vehicleId]);
    cleaning=media.cleanupExpired();await waitForVehicleLock();
    await blocker.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);await blocker.query('COMMIT');
    assert.equal((await cleaning).removed,0);assert.ok((await store.read(image.id)).length);
    assert.equal((await db.pool.query('SELECT state FROM media_assets WHERE id=$1',[image.id])).rows[0].state,'ready');
  } finally {await blocker.query('ROLLBACK');blocker.release();await cleaning;}
});

test('soft deletion between logical cleanup and unlink preserves the existing file',async()=>{
  const vehicleId=await vehicle();const image=await ready(vehicleId);
  await db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE id=$1",[image.id]);
  let transactions=0;
  const interleaved:Database={...db,transaction:async work=>{
    const result=await db.transaction(work);
    if(++transactions===1) await db.pool.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);
    return result;
  }};
  const cleanup=new MediaService(interleaved,store);
  assert.equal((await cleanup.cleanupExpired()).removed,0);
  assert.ok((await store.read(image.id)).length);
  assert.equal((await db.pool.query('SELECT state FROM media_assets WHERE id=$1',[image.id])).rows[0].state,'deleted');
});

test('explicit media removal also rechecks a vehicle deleted before unlink',async()=>{
  const vehicleId=await vehicle();const image=await ready(vehicleId);let transactions=0;
  const interleaved:Database={...db,transaction:async work=>{
    const result=await db.transaction(work);
    if(++transactions===1) await db.pool.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);
    return result;
  }};
  await new MediaService(interleaved,store).remove(image.id,image.version,actor);
  assert.ok((await store.read(image.id)).length);
  assert.equal((await db.pool.query('SELECT state FROM media_assets WHERE id=$1',[image.id])).rows[0].state,'deleted');
});

test('physical cleanup holds the vehicle lock until unlink finishes',async()=>{
  const vehicleId=await vehicle();const image=await ready(vehicleId);
  await db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE id=$1",[image.id]);
  const started=gate();const proceed=gate();
  class DelayedStore extends LocalMediaStore {
    override async remove(id:string) {started.release();await proceed.promise;return super.remove(id);}
  }
  const cleaning=new MediaService(db,new DelayedStore(path.join(root,'media'))).cleanupExpired();
  let deleting:Promise<unknown>|undefined;
  try {
    await Promise.race([started.promise,cleaning.then(()=>{throw new Error('Cleanup completed without reaching unlink');})]);
    deleting=db.pool.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);
    await waitForVehicleLock();
    assert.ok((await store.read(image.id)).length);
  } finally {proceed.release();}
  assert.equal((await cleaning).removed,1);await deleting;
  assert.equal((await db.pool.query('SELECT 1 FROM media_assets WHERE id=$1',[image.id])).rowCount,0);
});

test('unlink failure leaves an invisible retryable record, and the next cleanup succeeds',async()=>{
  const vehicleId=await vehicle();const image=await ready(vehicleId);
  await store.readThumbnail(image.id);
  await db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE id=$1",[image.id]);
  class FailingStore extends LocalMediaStore {override async remove() {throw new Error('Injected filesystem failure');}}
  await assert.rejects(new MediaService(db,new FailingStore(path.join(root,'media'))).cleanupExpired(),/Injected filesystem failure/);
  assert.equal((await db.pool.query('SELECT state FROM media_assets WHERE id=$1',[image.id])).rows[0].state,'deleted');
  await hidden(()=>media.get(image.id));assert.ok((await store.read(image.id)).length);
  assert.equal((await media.cleanupExpired()).removed,1);
  await assert.rejects(store.readThumbnail(image.id));
  assert.ok(!(await readdir(path.join(root,'media'))).some(name=>name.startsWith(image.id)));
  assert.equal((await media.cleanupExpired()).removed,0);
});


test('online backup leases preserve manually deleted media and only the owning reference releases protection',async()=>{
 const vehicleId=await vehicle(),image=await ready(vehicleId),a='backup:test:a',b='backup:test:b';
 await changeBackupLease(db,'acquire',a);await changeBackupLease(db,'acquire',b);
 try{
  await media.remove(image.id,image.version,actor);
  assert.equal((await db.pool.query('SELECT state FROM media_assets WHERE id=$1',[image.id])).rows[0].state,'deleted');
  assert.ok((await store.read(image.id)).length);assert.equal((await media.cleanupExpired()).removed,0);
  await changeBackupLease(db,'release',a);assert.equal(await db.transaction(physicalCleanupAllowed),false);
  await changeBackupLease(db,'release',a);assert.equal(await db.transaction(physicalCleanupAllowed),false);
 }finally{await changeBackupLease(db,'release',a);await changeBackupLease(db,'release',b);}
 assert.equal((await media.cleanupExpired()).removed,1);await assert.rejects(store.read(image.id));
});

test('backup acquire waits until an already admitted physical deletion transaction ends',async()=>{
 const tx=await db.pool.connect();let acquiring:Promise<unknown>|undefined;
 try{
  await tx.query('BEGIN');assert.equal(await physicalCleanupAllowed(tx),true);
  let done=false;acquiring=changeBackupLease(db,'acquire','backup:test:serialized').then(value=>{done=true;return value;});
  await delay(40);assert.equal(done,false);await tx.query('COMMIT');await acquiring;
  assert.equal(await db.transaction(physicalCleanupAllowed),false);
 }finally{await tx.query('ROLLBACK');tx.release();await acquiring;await changeBackupLease(db,'release','backup:test:serialized');}
});
