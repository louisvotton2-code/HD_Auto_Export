import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {importLocalPreview} from '../src/external/local-preview.js';
import {ExternalStore} from '../src/external/store.js';
import type {SourceDocument} from '../src/external/sources/index.js';
test('fixed persistent sample preserves IDs, staff corrections and batch receipts across replays and new captures',async()=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');
 const maintenance=createDatabase(url.toString(),1),name=`hd_local_preview_test_${randomBytes(8).toString('hex')}`;let db;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;db=createDatabase(url.toString(),3);await migrateDatabase(db);
  const manifest={version:1,batchKey:'local-real-test-v1',identities:[{source:'che168',externalId:'900001'}]};
  const docs:SourceDocument[]=(['zh','en','ru'] as const).map(locale=>({identity:{provider:'chinacarapi',source:'che168',externalId:'900001'},kind:'detail',locale,observedAt:'2026-11-14T00:00:00.000Z',sourceUpdatedAt:'2026-11-14T00:00:00.000Z',payload:{source:'che168',id:'900001',status:'active',updatedAt:'2026-11-14T00:00:00.000Z',url:'https://www.che168.com/dealer/1/900001.html',title:'Synthetic local sample',make:{id:'make',name:'Example'},model:{id:'model',name:'Model'},trim:{id:'trim',name:'Trim'},modelYear:2024,manufactureDate:'2024-02',firstRegistration:'2024-03',mileageKm:12000,price:{cny:70000},fuel:'Petrol',transmission:'Automatic',specs:{displacementCc:1998},photos:['https://erscglobal2.autoimg.cn/synthetic-local-preview.jpg']}}));
  const first=await importLocalPreview(db,manifest,docs);assert.equal(first.applied,1);
  const replay=await importLocalPreview(db,manifest,docs);assert.equal(replay.unchanged,1);assert.deepEqual(replay.publicIds,first.publicIds);
  const actor={id:'preview-test-admin',requestId:randomUUID()};await db.pool.query("INSERT INTO staff(id,name,email,role) VALUES($1,'Synthetic local tester','preview-test@example.invalid','admin')",[actor.id]);
  const store=new ExternalStore(db),id=first.publicIds[0]!,current=await store.getListing(id,'en');
  await store.saveOverrides(id,{version:current.version,overrides:{hidden:false,facts:{mileageKm:9876},text:[]}},randomUUID(),actor);
  const corrected=(await store.getListing(id,'en')).overrides;
  await importLocalPreview(db,manifest,docs);assert.deepEqual((await store.getListing(id,'en')).overrides,corrected);
  const updated=docs.map(d=>({...d,observedAt:'2026-11-14T02:00:00.000Z'}));
  assert.equal((await importLocalPreview(db,manifest,updated)).applied,1);assert.deepEqual((await store.getListing(id,'en')).overrides,corrected);
  const stale=docs.map(d=>({...d,payload:{...d.payload as object,status:'removed'}}));
  assert.equal((await importLocalPreview(db,manifest,stale)).stale,1);
  assert.equal((await db.pool.query('SELECT upstream_state FROM external_listings')).rows[0].upstream_state,'active');
  const removed=updated.map(d=>({...d,observedAt:'2026-11-14T03:00:00.000Z',payload:{...d.payload as object,status:'removed'}}));
  const withdrawal=await importLocalPreview(db,manifest,removed);assert.equal(withdrawal.withdrawn,1);assert.equal(withdrawal.publicIds.length,0);
  assert.equal((await db.pool.query('SELECT upstream_state FROM external_listings')).rows[0].upstream_state,'withdrawn');
  assert.deepEqual((await store.getListing(id,'en')).overrides,corrected);
  assert.equal((await importLocalPreview(db,manifest,removed)).unchanged,1);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM local_preview_batches')).rows[0].n,1);
  assert.equal((await db.pool.query('SELECT enabled FROM external_full_sync WHERE id=1')).rows[0].enabled,false);
  await assert.rejects(importLocalPreview(db,{...manifest,identities:[{source:'che168',externalId:'900002'}]},[]),/cannot be replaced/);
 }finally{await db?.close();await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);await maintenance.close();}
});
