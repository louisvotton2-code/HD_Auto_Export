import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createDatabase} from '../src/db/index.js';import {migrateDatabase} from '../src/db/migrate.js';
import {buildApp} from '../src/app.js';import {readConfig} from '../src/config.js';
import {createImportJob,SERVICE_ACTOR} from '../src/external/ingestion/worker.js';
import {applyIngestionEvent} from '../src/external/ingestion/apply.js';
import {refreshFxQuote,readFxQuote} from '../src/external/fx.js';
import type {SourceDocument} from '../src/external/sources/index.js';

test('formal source projection, all segments, canonical deduplication and real-source FX gate integrate atomically',async()=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)throw new Error('Local isolated test database required');
 const socket=process.env.API_TEST_DATABASE_SOCKET;if(socket){if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('Local socket required');url.searchParams.set('host',socket);}
 const name=`hd_ext_formal_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.toString(),1),root=await mkdtemp(path.join(os.tmpdir(),'hd-formal-'));let runtime:Awaited<ReturnType<typeof buildApp>>|undefined,created=false;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;const plain=new URL(url);plain.search='';
  runtime=await buildApp({...readConfig({NODE_ENV:'test',DATABASE_URL:plain.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:root,CATALOG_READ_MODE:'combined'}),databaseUrl:url.toString()});
  const db=runtime.db;await migrateDatabase(db);await db.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES('formal-test-admin','Operator','formal@example.invalid','admin',false)");
  const at=new Date().toISOString(),identity={provider:'chinacarapi' as const,source:'che168' as const,externalId:'1001'};
  const manifest={version:1,provider:'chinacarapi',generatedAt:at,identities:[{source:'che168',externalId:'1001',canonicalId:'car-1'},{source:'che168',externalId:'1002',canonicalId:'car-1'}],csv:{complete:true,sha256:'a'.repeat(64),bytes:10,rows:2,sourceCounts:{che168:2,dongchedi:0},generatedAt:at}};
  const jobId=await createImportJob(db,'formal',manifest,'formal-test-admin');
  const row={source:'che168',id:'1001',status:'active',updatedAt:at,url:'https://www.che168.com/dealer/1/1001.html',title:'Example vehicle',make:{id:'1',name:'Example'},model:{id:'2',name:'Model'},trim:{id:'3',name:'Variant'},price:{cny:70000},specs:{displacementCc:1998},photos:Array.from({length:45},(_,i)=>`https://erscglobal2.autoimg.cn/photo/${i}.jpg`),equipment:[{items:Array.from({length:601},(_,i)=>({name:`Feature ${i}`,value:'Standard'}))}],unknownPrivate:{secret:'never-public'}};
  const doc:SourceDocument={identity,kind:'detail',locale:'en',observedAt:at,sourceUpdatedAt:at,payload:row};
  const context={obsolete:false,jobId,canonicalId:'car-1',actor:{id:SERVICE_ACTOR,requestId:randomUUID()},triggeredBy:'formal-test-admin'};
  const event={key:'initial',identity,operation:'upsert' as const,businessOrder:'1',observedAt:at,document:[doc]};
  await db.transaction(tx=>applyIngestionEvent(tx,event,context));
  const listing=(await db.pool.query("SELECT id,first_import_batch_id FROM external_listings WHERE external_id='1001'")).rows[0];assert.equal(listing.first_import_batch_id,jobId);const id=`ext-${listing.id}`;
  const get=(suffix:string)=>runtime!.app.inject({method:'GET',url:`/api/v1/vehicles/${id}${suffix}`});
  const detail=await get('?locale=en&view=localized');assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().data.images.length,30);assert.equal(detail.json().data.mediaTotal,45);assert.ok(!detail.body.includes('never-public'));assert.ok(!detail.body.includes('formal-test-admin'));
  const first=await get('/gallery?locale=en&limit=30');assert.equal(first.statusCode,200,first.body);const page=first.json().data;assert.equal(page.total,45);assert.equal(first.headers['cache-control'],'no-store');
  const second=await get(`/gallery?locale=en&limit=30&cursor=${page.nextCursor}`);assert.equal(second.statusCode,200,second.body);assert.equal(second.json().data.items.length,15);assert.equal(new Set([...page.items,...second.json().data.items].map((p:{id:string})=>p.id)).size,45);
  for(const photo of second.json().data.items){assert.equal(photo.altText.requestedLocale,'en');assert.equal(photo.altText.reviewed,false);assert.equal(photo.altText.status,'missing');}
  const wrong=await get(`/configuration?locale=en&cursor=${page.nextCursor}`);assert.equal(wrong.statusCode,400);
  const config=await get('/configuration?locale=en&limit=100');assert.equal(config.statusCode,200,config.body);assert.ok(config.json().data.total>600);assert.equal(config.json().data.items.length,100);
  await db.transaction(tx=>applyIngestionEvent(tx,{...event,key:'duplicate',identity:{...identity,externalId:'1002'},document:[{...doc,identity:{...identity,externalId:'1002'},payload:{...row,id:'1002',url:'https://www.che168.com/dealer/1/1002.html'}}]},context));
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM external_catalog")).rows[0].n,1);
  const laterJob=await createImportJob(db,'later',{...manifest,identities:[{source:'che168',externalId:'1000',canonicalId:'car-1'},{source:'che168',externalId:'1001',canonicalId:'car-1'}]},'formal-test-admin');
  await db.transaction(tx=>applyIngestionEvent(tx,{...event,key:'earlier-sorted',identity:{...identity,externalId:'1000'},document:[{...doc,identity:{...identity,externalId:'1000'},payload:{...row,id:'1000',url:'https://www.che168.com/dealer/1/1000.html'}}]},{...context,jobId:laterJob}));
  assert.equal((await db.pool.query('SELECT listing_id FROM external_catalog')).rows[0].listing_id,listing.id);
  assert.equal((await db.pool.query('SELECT external_id FROM external_canonical_bindings')).rows[0].external_id,'1001');
  const changedJob=await createImportJob(db,'changed-group',{...manifest,identities:[{source:'che168',externalId:'1001',canonicalId:'car-2'}]},'formal-test-admin');
  await assert.rejects(db.transaction(tx=>applyIngestionEvent(tx,event,{...context,jobId:changedJob,canonicalId:'car-2'})));
  assert.equal((await db.pool.query('SELECT listing_id FROM external_catalog')).rows[0].listing_id,listing.id);
  const fxAuth={networkEnabled:true,nodeEnv:'production',mode:'disabled',databaseUrl:plain.toString(),formalDatabase:name,releaseId:'a'.repeat(40)};
  let calls=0;const fx=await refreshFxQuote(db,fxAuth,async()=>{calls++;return new Response(JSON.stringify({result:'success',base_code:'USD',time_last_update_unix:Math.floor(Date.now()/1000)-60,time_next_update_unix:Math.floor(Date.now()/1000)+3600,rates:{USD:1,CNY:7}}));});
  assert.equal(fx.health.source,'exchange_rate_api');assert.equal(fx.health.lastOutcome,'success');assert.equal((await readFxQuote(db.pool))?.rates.CNY,'7');
  await refreshFxQuote(db,fxAuth,async()=>{calls++;throw new Error('should not call twice');});assert.equal(calls,1);
  assert.equal((await get(`/gallery?locale=en&cursor=${page.nextCursor}`)).statusCode,409);
  await db.transaction(tx=>applyIngestionEvent(tx,{...event,key:'withdraw',operation:'withdraw',businessOrder:'2',document:[]},context));
  assert.equal((await get('/gallery?locale=en')).statusCode,404);
  await db.transaction(tx=>applyIngestionEvent(tx,event,{...context,obsolete:true}));assert.equal((await get('?locale=en')).statusCode,404);
 }finally{if(runtime)await runtime.app.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);await maintenance.close();await rm(root,{recursive:true,force:true});}
});
