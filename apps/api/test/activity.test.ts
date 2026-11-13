import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { makeVehicleDraftFixture, makeExternalImportFixture } from '@hd/contracts/fixtures';
import { ActivityResponseSchema } from '@hd/contracts/admin';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { readConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createStaff, setStaffEnabled } from '../src/staff-cli.js';
import { ExternalStore } from '../src/external/store.js';
import { recordAudit, ActivityService } from '../src/activity/service.js';

const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['postgres:','postgresql:'].includes(base.protocol)||base.hostname!=='127.0.0.1'||base.pathname!=='/postgres'||base.search||base.hash)throw new Error('Only a local maintenance database is allowed.');
async function transport(url:URL){
  const socket=process.env.API_TEST_DATABASE_SOCKET;if(!socket)return url.toString();
  if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('Expected existing local socket.');
  const result=new URL(url);result.searchParams.set('host',socket);return result.toString();
}
const name=`hd_ext_activity_${randomBytes(8).toString('hex')}`,origin='http://127.0.0.1:3318',password='Isolated-activity-password!';
let runtime:Awaited<ReturnType<typeof buildApp>>,maintenance:ReturnType<typeof createDatabase>,root:string,created=false;
let actorA:string,actorB:string,cookieA:string,cookieB:string;
before(async()=>{
  root=await mkdtemp(path.join(tmpdir(),'hd-activity-'));maintenance=createDatabase(await transport(base),2);
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;const url=new URL(base);url.pathname=`/${name}`;
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:root,AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin,EXTERNAL_CATALOG_MODE:'synthetic'});
  runtime=await buildApp({...config,databaseUrl:await transport(url)});await migrateDatabase(runtime.db);
  for(const suffix of ['a','b']){
    const user=await createStaff(runtime.auth,{name:`Operator ${suffix}`,email:`${suffix}@example.invalid`,password,role:'admin'});
    const login=await runtime.app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email:`${suffix}@example.invalid`,password}});assert.equal(login.statusCode,200,login.body);
    const cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
    if(suffix==='a'){actorA=user.user.id;cookieA=cookie;}else{actorB=user.user.id;cookieB=cookie;}
  }
});
after(async()=>{if(runtime)await runtime.app.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}"`);if(maintenance)await maintenance.close();if(root)await rm(root,{recursive:true,force:true});});
const headers=(cookie=cookieA)=>({origin,cookie});
const activity=async(id:string,cookie=cookieA,query='')=>{
 const result=await runtime.app.inject({method:'GET',url:`/api/v1/admin/vehicles/${id}/activity${query}`,headers:headers(cookie)});
 assert.equal(result.statusCode,200,result.body);assert.equal(result.headers['cache-control'],'no-store');return ActivityResponseSchema.parse(result.json()).data;
};

test('activity is session-derived, immutable, paginated and keeps real historical names across edits and bans',async()=>{
 const draft=makeVehicleDraftFixture();draft.media=[];const key=randomUUID();
 const request={method:'POST' as const,url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':key},payload:{draft}};
 const created=await runtime.app.inject(request);assert.equal(created.statusCode,201,created.body);let vehicle=created.json().data;
 assert.equal(vehicle.activity.created.actor.staffId,actorA);assert.equal(vehicle.activity.created.actor.name,'Operator a');
 const first=await activity(vehicle.id);assert.equal(first.items.length,1);assert.equal(first.items[0]!.detailState,'recorded');
 const unauth=await runtime.app.inject({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}/activity`});assert.equal(unauth.statusCode,401);
 assert.equal((await runtime.app.inject(request)).statusCode,201);assert.equal((await activity(vehicle.id)).items.length,1);
 const save=async(payload:Record<string,unknown>,cookie=cookieB)=>runtime.app.inject({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(cookie),payload});
 assert.equal((await save({version:vehicle.version,draft:vehicle.draft,actorId:actorA})).statusCode,400);
 assert.equal((await save({version:vehicle.version,draft:vehicle.draft})).statusCode,200);assert.equal((await activity(vehicle.id)).items.length,1);
 await runtime.db.pool.query('UPDATE staff SET name=$2 WHERE id=$1',[actorB,'Renamed operator']);
 vehicle.draft.facts.modelYear=2025;vehicle.draft.internal.notes='secret-value-must-not-enter-history';
 const saved=await save({version:vehicle.version,draft:vehicle.draft});assert.equal(saved.statusCode,200,saved.body);vehicle=saved.json().data;
 assert.equal(vehicle.activity.lastModified.actor.name,'Renamed operator');assert.equal(vehicle.activity.created.actor.name,'Operator a');
 let history=await activity(vehicle.id);assert.equal(history.items.length,2);assert.equal(history.items[0]!.actor.staffId,actorB);
 assert.ok(history.items[0]!.changes!.some(c=>c.path==='draft.facts.modelYear'&&c.after===2025));assert.equal(JSON.stringify(history).includes('secret-value'),false);
 assert.equal((await save({version:1,draft:vehicle.draft})).statusCode,409);assert.equal((await activity(vehicle.id)).items.length,2);
 const page1=await activity(vehicle.id,cookieA,'?limit=1');assert.ok(page1.nextCursor);
 const page2=await activity(vehicle.id,cookieA,`?limit=1&cursor=${page1.nextCursor}`);assert.equal(page2.items.length,1);assert.notEqual(page1.items[0]!.id,page2.items[0]!.id);
 const other=await runtime.inventory.create(draft,{id:actorA,requestId:randomUUID()},randomUUID());
 assert.equal((await runtime.app.inject({method:'GET',url:`/api/v1/admin/vehicles/${other.id}/activity?cursor=${page1.nextCursor}`,headers:headers()})).statusCode,400);
 await setStaffEnabled(runtime.db,'b@example.invalid',false);
 assert.equal((await runtime.app.inject({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}/activity`,headers:headers(cookieB)})).statusCode,401);
 history=await activity(vehicle.id);assert.equal(history.items[0]!.actor.name,'Renamed operator');
 await assert.rejects(runtime.db.pool.query('UPDATE audit_events SET actor_name=$1 WHERE vehicle_id=$2',['forged',vehicle.id]),/append only/);
 await assert.rejects(runtime.db.pool.query('DELETE FROM audit_events WHERE vehicle_id=$1',[vehicle.id]),/append only/);
 const removed=await runtime.inventory.remove(vehicle.id,vehicle.version,{id:actorA,requestId:randomUUID()},randomUUID());
 const restored=await runtime.inventory.restore(vehicle.id,removed.version,{id:actorA,requestId:randomUUID()},randomUUID());
 history=await activity(restored.id);assert.ok(history.items.some(e=>e.action==='vehicle.delete'));assert.equal(history.items[0]!.action,'vehicle.restore');
 const publicResponse=await runtime.app.inject({method:'GET',url:`/api/v1/vehicles/${vehicle.id}`});assert.equal(publicResponse.statusCode,404);assert.equal(publicResponse.body.includes('Operator'),false);
});

test('media audit uses stable IDs; audit failure rolls the mutation back; old evidence stays unknown',async()=>{
 const draft=makeVehicleDraftFixture();draft.media=[];let vehicle=await runtime.inventory.create(draft,{id:actorA,requestId:randomUUID()},randomUUID());
 const actor={id:actorA,requestId:randomUUID()};const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#333333'}}).png().toBuffer();
 const permit=await runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:bytes.length,rights:{basis:'owned',note:'Synthetic'}},actor);
 const uploaded=await runtime.media.upload(permit.media.id,permit.media.version,bytes,'image/png',actor);const complete=await runtime.media.complete(uploaded.id,uploaded.version,actor);
 vehicle.draft.media=[{id:complete.id,alt:'front',sortOrder:0,isCover:true}];vehicle=await runtime.inventory.save(vehicle.id,vehicle.version,vehicle.draft,actor);
 vehicle.draft.media[0]!.alt='side';vehicle=await runtime.inventory.save(vehicle.id,vehicle.version,vehicle.draft,actor);
 let history=await activity(vehicle.id);assert.ok(history.items.some(e=>e.action==='media.complete'&&e.changes!.some(c=>c.path===`media.${complete.id}.state`)));
 assert.ok(history.items.some(e=>e.changes!.some(c=>c.path===`draft.media.${complete.id}.alt`&&c.after==='side')));
 assert.equal(JSON.stringify(history).includes('/preview'),false);
 await runtime.db.pool.query(`CREATE FUNCTION fail_activity_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated audit failure'; END $$; CREATE TRIGGER fail_activity BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_activity_insert()`);
 const version=vehicle.version;vehicle.draft.facts.modelYear=2026;
 await assert.rejects(runtime.inventory.save(vehicle.id,version,vehicle.draft,actor),/isolated audit failure/);
 await runtime.db.pool.query('DROP TRIGGER fail_activity ON audit_events');assert.equal((await runtime.inventory.getAdmin(vehicle.id)).version,version);
 await runtime.db.pool.query('INSERT INTO audit_events(id,actor_id,operation,vehicle_id,old_version,new_version,request_id) VALUES($1,$2,$3,$4,1,2,$5)',[randomUUID(),actorA,'vehicle.save',vehicle.id,randomUUID()]);
 history=await activity(vehicle.id);assert.equal(history.items[0]!.changes,null);assert.equal(history.items[0]!.detailState,'unknown');assert.equal(history.items[0]!.actor.name,null);
});

test('external manual activity remains independent of refresh and old override snapshots are not invented',async()=>{
 const store=new ExternalStore(runtime.db),actor={id:actorA,requestId:randomUUID()},input=makeExternalImportFixture(1);
 await store.importBatch(input,randomUUID(),actor);
 const row=(await runtime.db.pool.query('SELECT id FROM external_listings ORDER BY id LIMIT 1')).rows[0]!;const id=`ext-${row.id}`;
 let listing=await store.getListing(id,'en');assert.equal(JSON.stringify(listing.activity!.lastModified),'null');
 const overrides={...listing.overrides,hidden:true};await store.saveOverrides(id,{version:listing.version,overrides},randomUUID(),actor);
 listing=await store.getListing(id,'en');const before=listing.activity!.lastModified;
 assert.equal(before!.actor.name,'Operator a');const service=new ActivityService(runtime.db);const events=await service.external(id,{limit:20});assert.equal(events.items.length,1);
 await store.saveOverrides(id,{version:listing.version,overrides},randomUUID(),actor);assert.equal((await service.external(id,{limit:20})).items.length,1);
 await runtime.db.pool.query("UPDATE external_listings SET fetched_at=now()+interval '1 minute' WHERE id=$1",[row.id]);
 listing=await store.getListing(id,'en');assert.deepEqual(listing.activity!.lastModified,before);
 const history=await runtime.app.inject({method:'GET',url:`/api/v1/admin/external/listings/${id}/activity`,headers:headers()});assert.equal(history.statusCode,200,history.body);
 assert.equal((await runtime.app.inject({method:'GET',url:`/api/v1/admin/external/listings/${id}/activity`})).statusCode,401);
});


test('equivalent inventory timestamps do not add a version or successful activity for single and bulk writes',async()=>{
 const actor={id:actorA,requestId:randomUUID()},draft=makeVehicleDraftFixture();draft.media=[];
 const created=await runtime.inventory.create(draft,actor,randomUUID());
 const first=await runtime.inventory.availability(created.id,{version:created.version,availability:'available',checkedAt:'2026-11-13T10:00:00Z'},actor);
 const count=(await activity(first.id)).items.length;
 const same=await runtime.inventory.availability(first.id,{version:first.version,availability:'available',checkedAt:'2026-11-13T10:00:00.000Z'},actor);
 assert.equal(same.version,first.version);assert.equal((await activity(first.id)).items.length,count);
 const bulk=await runtime.inventory.bulk({operation:'availability',availability:'available',checkedAt:'2026-11-13T10:00:00Z',items:[{id:first.id,expectedVersion:first.version}]},actor,randomUUID());
 assert.equal(bulk.summary.succeeded,1);assert.equal(bulk.summary.failed,0);
 assert.equal((await runtime.inventory.getAdmin(first.id)).version,first.version);assert.equal((await activity(first.id)).items.length,count);
});


test('historical translation suggestions remain visible evidence without replacing the last human edit',async()=>{
 const actor={id:actorA,requestId:randomUUID()},draft=makeVehicleDraftFixture();draft.media=[];
 const vehicle=await runtime.inventory.create(draft,actor,randomUUID());const before=vehicle.activity!.lastModified;
 for(const operation of ['vehicle.translationSuggestions','vehicle.displayTranslationSuggestions'])await runtime.db.pool.query('INSERT INTO audit_events(id,actor_id,operation,vehicle_id,old_version,new_version,request_id,created_at) VALUES($1,$2,$3,$4,$5,$5,$6,clock_timestamp())',[randomUUID(),actorB,operation,vehicle.id,vehicle.version,randomUUID()]);
 assert.deepEqual((await runtime.inventory.getAdmin(vehicle.id)).activity!.lastModified,before);
 const history=await activity(vehicle.id);assert.equal(history.items[0]!.action,'vehicle.displayTranslationSuggestions');assert.equal(history.items[0]!.detailState,'unknown');
});


test('history rejects impossible cursor dates and orders late writes by database event time',async()=>{
 const draft=makeVehicleDraftFixture();draft.media=[];const actor={id:actorA,requestId:randomUUID()};
 const vehicle=await runtime.inventory.create(draft,actor,randomUUID());
 for(const at of ['0000-01-01T00:00:00.000000Z','2026-02-30T00:00:00.000000Z']){
  const cursor=Buffer.from(JSON.stringify({kind:'staff',resource:vehicle.id,at,id:randomUUID()})).toString('base64url');
  const response=await runtime.app.inject({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}/activity?cursor=${cursor}`,headers:headers()});
  assert.equal(response.statusCode,400,response.body);
 }
 const early=await runtime.db.pool.connect();
 try{
  await early.query('BEGIN');await early.query('SELECT now()');
  await runtime.db.transaction(tx=>recordAudit(tx,actor,'test.first',vehicle.id,vehicle.version,vehicle.version,[]));
  await recordAudit(early,{id:actorB,requestId:randomUUID()},'test.later',vehicle.id,vehicle.version,vehicle.version,[]);
  await early.query('COMMIT');
 }catch(error){await early.query('ROLLBACK');throw error;}finally{early.release();}
 const page=await activity(vehicle.id);assert.equal(page.items[0]!.action,'test.later');
 assert.equal((await runtime.inventory.getAdmin(vehicle.id)).activity!.lastModified!.actor.staffId,actorB);
});
