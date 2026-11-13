import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {createStaff} from '../src/staff-cli.js';
import {ExternalFullSyncStatusResponseSchema} from '@hd/contracts/admin';
import {makeExternalImportFixture} from '@hd/contracts/fixtures';
import {PublicVehicleInspectionResponseSchema,PublicVehiclePriceHistoryResponseSchema} from '@hd/contracts/public';
test('full sync HTTP controls require an admin and preserve versioned idempotent status receipts',async()=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/postgres'||url.search||url.hash)throw new Error('Isolated local maintenance database only');
 const maintenance=createDatabase(url.toString(),1),name=`hd_ext_control_${randomBytes(8).toString('hex')}`,media=await mkdtemp(path.join(os.tmpdir(),'hd-full-control-'));
 let runtime:Awaited<ReturnType<typeof buildApp>>|undefined,created=false;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;
  const origin='http://127.0.0.1:3318';runtime=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:media,AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin,EXTERNAL_CATALOG_MODE:'synthetic'}));
  await migrateDatabase(runtime.db);const app=runtime.app;
  const cookies:Record<string,string>={};
  for(const role of ['admin','editor'] as const){const email=`${role}@example.invalid`,password='Isolated-control-only!';await createStaff(runtime.auth,{name:role,email,password,role});
   const login=await app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email,password}});assert.equal(login.statusCode,200,login.body);cookies[role]=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');}
  const statusUrl='/api/v1/admin/external/sync-status',controlUrl='/api/v1/admin/external/sync-control';
  assert.equal((await app.inject({url:statusUrl})).statusCode,401);
  await runtime.db.pool.query('UPDATE external_full_sync SET enabled=true,paused=false WHERE id=1');
  const current=await app.inject({url:statusUrl,headers:{origin,cookie:cookies.editor}});assert.equal(current.statusCode,200,current.body);assert.equal(current.headers['cache-control'],'no-store');
  const status=ExternalFullSyncStatusResponseSchema.parse(current.json()).data;
  const request={method:'POST' as const,url:controlUrl,headers:{origin,cookie:cookies.admin,'idempotency-key':randomUUID()},payload:{version:status.version,action:'pause'}};
  assert.equal((await app.inject({...request,headers:{...request.headers,cookie:cookies.editor}})).statusCode,403);
  assert.equal((await app.inject({...request,headers:{...request.headers,origin:'https://untrusted.invalid'}})).statusCode,403);
  const first=await app.inject(request);assert.equal(first.statusCode,200,first.body);const paused=ExternalFullSyncStatusResponseSchema.parse(first.json()).data;assert.equal(paused.paused,true);
  const replay=await app.inject(request);assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json().data,first.json().data);
  assert.equal((await app.inject({...request,headers:{...request.headers,'idempotency-key':randomUUID()}})).statusCode,409);
  assert.equal((await app.inject({...request,payload:{version:paused.version,action:'resume'}})).statusCode,409);
  const resumed=await app.inject({...request,headers:{...request.headers,'idempotency-key':randomUUID()},payload:{version:paused.version,action:'resume'}});assert.equal(resumed.statusCode,200,resumed.body);assert.equal(resumed.json().data.paused,false);
  assert.equal((await runtime.db.pool.query("SELECT count(*)::int AS n FROM audit_events WHERE operation IN ('external.sync.pause','external.sync.resume')")).rows[0].n,2);
  // Public evidence reads remain paged and bind every continuation to identity, language and visible revision.
  const imported=await app.inject({method:'POST',url:'/api/v1/admin/external/batches',headers:{origin,cookie:cookies.admin,'idempotency-key':randomUUID()},payload:makeExternalImportFixture(1)});
  assert.equal(imported.statusCode,201,imported.body);
  const listing=(await runtime.db.pool.query('SELECT id FROM external_listings LIMIT 1')).rows[0].id,publicId=`ext-${listing}`;
  const display={status:'ready',text:'Original paint',requestedLocale:'en',contentLocale:'en',provenance:'supplier',reviewed:false};
  await runtime.db.transaction(async tx=>{
   for(const kind of ['inspection','price-history']) {
    await tx.query("INSERT INTO external_vehicle_evidence_sets VALUES($1,'en',$2,$3,3,'available')",[listing,kind,'a'.repeat(64)]);
    for(let i=0;i<3;i++)await tx.query("INSERT INTO external_vehicle_evidence VALUES($1,'en',$2,$3,$4)",[listing,kind,i,JSON.stringify(kind==='inspection'?{id:`row-${i}`,category:null,part:null,name:display,value:display,outcome:'ok'}:{id:`price-${i}`,at:null,money:{currency:'CNY',amount:String(i)},kind:'asking'})]);
   }
  });
  const page=await app.inject({url:`/api/v1/vehicles/${publicId}/inspection?locale=en&limit=2`});assert.equal(page.statusCode,200,page.body);
  const report=PublicVehicleInspectionResponseSchema.parse(page.json()).data;assert.equal(report.total,3);assert.equal(report.items.length,2);assert.equal(report.status,'available');assert.ok(report.nextCursor);
  const cursor=encodeURIComponent(report.nextCursor!);
  const next=await app.inject({url:`/api/v1/vehicles/${publicId}/inspection?locale=en&limit=2&cursor=${cursor}`});assert.equal(next.statusCode,200,next.body);assert.equal(next.json().data.items.length,1);
  assert.equal((await app.inject({url:`/api/v1/vehicles/${publicId}/inspection?locale=ru&cursor=${cursor}`})).statusCode,400);
  assert.equal((await app.inject({url:`/api/v1/vehicles/${publicId}/price-history?locale=en&cursor=${cursor}`})).statusCode,400);
  const prices=await app.inject({url:`/api/v1/vehicles/${publicId}/price-history?locale=en&limit=2`});assert.equal(prices.statusCode,200,prices.body);assert.equal(PublicVehiclePriceHistoryResponseSchema.parse(prices.json()).data.items[0]!.money.amount,'0');
  await runtime.db.pool.query("UPDATE external_vehicle_evidence_sets SET source_revision=$2,status='unavailable' WHERE listing_id=$1 AND kind='inspection'",[listing,'b'.repeat(64)]);
  assert.equal((await app.inject({url:`/api/v1/vehicles/${publicId}/inspection?locale=en&cursor=${cursor}`})).statusCode,409);
  await runtime.db.pool.query('DELETE FROM external_catalog WHERE listing_id=$1',[listing]);
  assert.equal((await app.inject({url:`/api/v1/vehicles/${publicId}/inspection?locale=en`})).statusCode,404);

 }finally{if(runtime)await runtime.app.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);await maintenance.close();await rm(media,{recursive:true,force:true});}
});
