import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
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
let db:Database;let media:MediaService;let store:LocalMediaStore;let root:string;let bytes:Buffer;

before(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'hd-media-softdelete-'));
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  const url=new URL(baseUrl);url.pathname=`/${databaseName}`;
  db=createDatabase(url.toString(),5);await migrateDatabase(db);
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
  await hidden(()=>media.publicRead(image.id,'thumb'));
  const permit=await media.create({vehicleId,contentType:'image/png',sizeBytes:bytes.length,rights},actor);
  const publication=randomUUID();
  await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,vehicleId,'{}']);
  await db.pool.query('INSERT INTO publication_media(publication_id,media_id) VALUES($1,$2)',[publication,image.id]);
  await db.pool.query("UPDATE vehicles SET published_revision_id=$2,publication_state='published',published_at=now() WHERE id=$1",[vehicleId,publication]);
  assert.ok((await media.publicRead(image.id)).length);
  assert.ok((await media.publicRead(image.id,'thumb')).length);
  await db.pool.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[vehicleId,actor.id]);
  for(const action of [
    ()=>media.get(image.id),()=>media.preview(image.id),()=>media.publicRead(image.id),()=>media.publicRead(image.id,'thumb'),
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
