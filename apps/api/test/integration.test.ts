import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import type {InjectOptions} from 'fastify';
import {makeVehicleDraftFixture} from '@hd/contracts/fixtures';
import {PublicVehicleResponseSchema,PublicVehicleListSchema,ApiErrorSchema} from '@hd/contracts/public';
import type {AdminVehicle,VehicleDraftInput} from '@hd/contracts/admin';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {createStaff,setStaffEnabled} from '../src/staff-cli.js';

const baseUrl=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['127.0.0.1','localhost'].includes(baseUrl.hostname)||baseUrl.pathname!=='/postgres') throw new Error('Integration tests require a local PostgreSQL maintenance database; never point at production.');
const databaseName=`hd_api_test_${randomBytes(8).toString('hex')}`;
const maintenance=createDatabase(baseUrl.toString(),2);
let runtime:Awaited<ReturnType<typeof buildApp>>;
let root:string;let cookie:string;let editorId:string;let requestCounter=0;
const origin='http://127.0.0.1:3318';
const password='Isolated_test_password_903!';
let dbUrl:string;
const headers=()=>({cookie,origin});
const call=(options:InjectOptions)=>runtime.app.inject({...options,remoteAddress:`198.51.${Math.floor(requestCounter/240)}.${++requestCounter%240+1}`});
function draft():VehicleDraftInput {const value=makeVehicleDraftFixture();value.media=[];return value;}
async function create(value=draft()):Promise<AdminVehicle> {
  const r=await call({method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':randomUUID()},payload:{draft:value}});
  assert.equal(r.statusCode,201,r.body);return r.json().data;
}
async function save(vehicle:AdminVehicle):Promise<AdminVehicle> {
  const r=await call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:vehicle.draft}});
  assert.equal(r.statusCode,200,r.body);return r.json().data;
}
async function upload(vehicle:AdminVehicle) {
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#224466'}}).png().toBuffer();
  const permit=await call({method:'POST',url:'/api/v1/admin/media/uploads',headers:headers(),payload:{vehicleId:vehicle.id,contentType:'image/png',sizeBytes:bytes.length,rights:{basis:'owned',note:'Synthetic test image generated for this test.'}}});
  assert.equal(permit.statusCode,201,permit.body);const p=permit.json().data;
  const sent=await call({method:'PUT',url:p.uploadUrl,headers:{...headers(),'content-type':'image/png','if-match':String(p.media.version)},payload:bytes});
  assert.equal(sent.statusCode,200,sent.body);
  const complete=await call({method:'POST',url:`/api/v1/admin/media/${p.media.id}/complete`,headers:headers(),payload:{version:sent.json().data.version}});
  assert.equal(complete.statusCode,200,complete.body);return complete.json().data;
}
async function ready():Promise<AdminVehicle> {
  let vehicle=await create();const media=await upload(vehicle);
  vehicle.draft.media=[{id:media.id,sortOrder:0,isCover:true,alt:'Isolated synthetic fixture'}];vehicle=await save(vehicle);
  const availability=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/availability`,headers:headers(),payload:{version:vehicle.version,availability:'available',checkedAt:new Date().toISOString()}});
  assert.equal(availability.statusCode,200,availability.body);return availability.json().data;
}
async function publish(vehicle:AdminVehicle):Promise<AdminVehicle> {
  const r=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});
  assert.equal(r.statusCode,200,r.body);return r.json().data;
}
before(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'hd-api-test-'));
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  const url=new URL(baseUrl);url.pathname=`/${databaseName}`;dbUrl=url.toString();
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:dbUrl,AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:path.join(root,'media'),AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin});
  runtime=await buildApp(config);await migrateDatabase(runtime.db);await migrateDatabase(runtime.db);
  await createStaff(runtime.auth,{email:'admin@example.invalid',name:'Test admin',role:'admin',password});
  const editor=await createStaff(runtime.auth,{email:'editor@example.invalid',name:'Test editor',role:'editor',password});editorId=editor.user.id;
  const login=await call({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email:'editor@example.invalid',password}});
  assert.equal(login.statusCode,200,login.body);
  cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  assert.ok(cookie);assert.match(String(login.headers['set-cookie']),/HttpOnly/i);assert.match(String(login.headers['set-cookie']),/SameSite=Lax/i);assert.match(String(login.headers['set-cookie']),/Path=\/api/);
});
after(async()=>{
  if(runtime) await runtime.app.close();
  await maintenance.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await maintenance.close();
  if(root) await rm(root,{recursive:true,force:true});
});

test('real authentication, closed registration, role permissions and encoded path protection',async()=>{
  for(const prefix of ['/api/v1/admin','/api/v1/%61dmin','/api/v1/ad%6din']) {
    const r=await call({method:'GET',url:`${prefix}/vehicles`});assert.equal(r.statusCode,401,r.body);ApiErrorSchema.parse(r.json());
  }
  const me=await call({method:'GET',url:'/api/v1/admin/me',headers:headers()});assert.equal(me.statusCode,200,me.body);
  assert.equal(me.json().data.role,'editor');assert.ok(!me.json().data.permissions.includes('staff:manage'));
  for(const suffix of ['/sign-up/email','/admin/create-user','/admin/impersonate-user','/admin/remove-user']) {
    assert.equal((await call({method:'POST',url:`/api/auth${suffix}`,headers:headers(),payload:{}})).statusCode,404);
  }
  for(const originHeader of [{}, {origin:'https://untrusted.example'}]) {
    const r=await call({method:'POST',url:'/api/v1/%61dmin/vehicles',headers:{cookie,...originHeader,'idempotency-key':randomUUID()},payload:{draft:draft()}});assert.equal(r.statusCode,403,r.body);
  }
});
test('draft privacy and current-language publication validation',async()=>{
  const vehicle=await create();
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=ru`})).statusCode,404);
  const r=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});
  assert.equal(r.statusCode,422,r.body);assert.ok(r.json().error.fields.some((f:{path:string})=>f.path==='draft.media'));
  assert.equal((await runtime.db.pool.query('SELECT count(*)::int AS count FROM vehicle_publications WHERE vehicle_id=$1',[vehicle.id])).rows[0].count,0);
  const current=await runtime.inventory.getAdmin(vehicle.id);assert.equal(current.version,vehicle.version);assert.equal(current.publicationState,'draft');
});
test('one vehicle lifecycle, public whitelist, draft snapshot, availability, home and archive',async()=>{
  let vehicle=await ready();const mediaId=vehicle.draft.media[0]!.id;
  assert.equal((await call({method:'GET',url:`/api/v1/media/${mediaId}`})).statusCode,404);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/media/${mediaId}/preview`})).statusCode,401);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/media/${mediaId}/preview`,headers:headers()})).statusCode,200);
  vehicle=await publish(vehicle);
  for(const locale of ['zh','en','ru']) {
    const r=await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=${locale}`});assert.equal(r.statusCode,200,r.body);PublicVehicleResponseSchema.parse(r.json());
    for(const secret of ['purchaseCost','INTERNAL_FIXTURE_NOT_PUBLIC','supplierContact','engineVersion','rights']) assert.ok(!r.body.includes(secret),secret);
    assert.equal(r.json().data.content.title.contentLocale,locale);assert.equal(r.json().data.content.title.reviewed,true);
  }
  assert.equal((await call({method:'GET',url:`/api/v1/media/${mediaId}`})).statusCode,200);
  const home=await runtime.inventory.getHome();home.sections[0]!.vehicleIds=[vehicle.id];await runtime.inventory.saveHome(home,{id:editorId,requestId:randomUUID()});
  assert.equal((await call({method:'GET',url:'/api/v1/home/vehicles?locale=en'})).json().data.sections[0].vehicles[0].id,vehicle.id);
  const oldText=(await runtime.inventory.getPublic(vehicle.id,'en')).content.title.text;
  vehicle.draft.content.title.translations.en!.text='Edited draft title';vehicle=await save(vehicle);
  assert.equal((await runtime.inventory.getPublic(vehicle.id,'en')).content.title.text,oldText);
  vehicle=await runtime.inventory.availability(vehicle.id,{version:vehicle.version,availability:'sold',checkedAt:new Date().toISOString()},{id:editorId,requestId:randomUUID()});
  assert.equal((await call({method:'GET',url:'/api/v1/home/vehicles?locale=en'})).json().data.sections.length,0);
  const list=await call({method:'GET',url:'/api/v1/vehicles?locale=en&page=1&pageSize=48'});PublicVehicleListSchema.parse(list.json());assert.ok(!list.json().data.items.some((v:{id:string})=>v.id===vehicle.id));
  vehicle=await publish(vehicle);assert.equal((await runtime.inventory.getPublic(vehicle.id,'en')).availability,'sold');
  await runtime.inventory.archive(vehicle.id,vehicle.version,{id:editorId,requestId:randomUUID()});
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}`})).statusCode,404);
  assert.equal((await call({method:'GET',url:`/api/v1/media/${mediaId}`})).statusCode,404);
  const media=await runtime.media.get(mediaId);assert.equal((await call({method:'DELETE',url:`/api/v1/admin/media/${mediaId}`,headers:headers(),payload:{version:media.version}})).statusCode,409);
});
test('concurrent edits and idempotent create/publish retries preserve one business fact',async()=>{
  const key=randomUUID();const options:InjectOptions={method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':key},payload:{draft:draft()}};
  const [a,b]=await Promise.all([call(options),call(options)]);assert.equal(a.statusCode,201,a.body);assert.equal(b.statusCode,201,b.body);assert.equal(a.json().data.id,b.json().data.id);
  const changed=draft();changed.internal.notes='different';assert.equal((await call({...options,payload:{draft:changed}})).statusCode,409);
  let vehicle:AdminVehicle=a.json().data;
  const edits=await Promise.all(['First','Second'].map(note=>call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:{...vehicle.draft,internal:{...vehicle.draft.internal,notes:note}}}})));
  assert.deepEqual(edits.map(r=>r.statusCode).sort(),[200,409]);
  vehicle=await ready();const publishKey=randomUUID();
  const attempts=await Promise.all([1,2].map(()=>call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':publishKey},payload:{version:vehicle.version}})));
  assert.deepEqual(attempts.map(r=>r.statusCode),[200,200]);assert.equal(attempts[0]!.json().data.version,attempts[1]!.json().data.version);
  assert.equal((await runtime.db.pool.query("SELECT count(*)::int AS count FROM audit_events WHERE vehicle_id=$1 AND operation='vehicle.publish'",[vehicle.id])).rows[0].count,1);
});
test('media ownership, invalid binary, rights, UUID parameters and missing data are checked',async()=>{
  const vehicle=await create();const other=await create();const media=await upload(other);
  vehicle.draft.media=[{id:media.id,sortOrder:0,isCover:true,alt:''}];
  const rejected=await call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:vehicle.draft}});assert.equal(rejected.statusCode,422,rejected.body);
  vehicle.draft.media[0]!.id='not-a-uuid';assert.equal((await call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:vehicle.draft}})).statusCode,400);
  assert.equal((await call({method:'GET',url:'/api/v1/vehicles/not-a-uuid'})).statusCode,400);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${randomUUID()}`})).statusCode,404);
  assert.equal((await call({method:'GET',url:'/api/v1/vehicles?pageSize=49'})).statusCode,400);
  assert.equal((await call({method:'GET',url:'/api/v1/vehicles?locale=de'})).statusCode,400);
  const missingRights=await call({method:'POST',url:'/api/v1/admin/media/uploads',headers:headers(),payload:{vehicleId:vehicle.id,contentType:'image/png',sizeBytes:20}});assert.equal(missingRights.statusCode,400);
  const permit=await runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:20,rights:{basis:'owned',note:'Invalid synthetic image test'}},{id:editorId,requestId:randomUUID()});
  const invalid=await call({method:'PUT',url:permit.uploadUrl,headers:{...headers(),'if-match':'1','content-type':'image/png'},payload:Buffer.alloc(20)});assert.equal(invalid.statusCode,400,invalid.body);
  assert.equal((await runtime.media.get(permit.media.id)).status,'pending');
});
test('on-request price and unknown dates stay null; stale translations cannot be published',async()=>{
  let vehicle=await ready();vehicle.draft.price={kind:'on_request',money:null,includes:[]};vehicle.draft.facts.manufacturedAt=null;vehicle.draft.facts.mileageKm=null;
  vehicle=await save(vehicle);vehicle=await publish(vehicle);
  const visible=await runtime.inventory.getPublic(vehicle.id,'ru');assert.equal(visible.price.money,null);assert.equal(visible.facts.manufacturedAt,null);assert.equal(visible.facts.mileageKm,null);
  vehicle.draft.content.title.sourceText='Changed source';vehicle=await save(vehicle);vehicle=await save(vehicle);
  const blocked=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});assert.equal(blocked.statusCode,422,blocked.body);
  assert.equal((await runtime.inventory.getPublic(vehicle.id,'ru')).content.title.text,visible.content.title.text);
});
test('expired upload cleanup advances past removed rows and protects ready/public images',async()=>{
  const vehicle=await create();const permit=await runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:20,rights:{basis:'owned',note:'Cleanup test'}},{id:editorId,requestId:randomUUID()});
  const unbound=await upload(vehicle);
  await runtime.db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE id=$1",[permit.media.id]);
  await runtime.db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE id=$1",[unbound.id]);
  assert.ok((await runtime.media.cleanupExpired()).removed>=1);assert.equal((await runtime.media.cleanupExpired()).removed,0);
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM media_assets WHERE id=$1',[permit.media.id])).rowCount,0);
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM media_assets WHERE id=$1',[unbound.id])).rowCount,0);
});
test('media removed while a mutation waits for its vehicle lock returns 404 instead of 500',async()=>{
  const vehicle=await create();
  for(const operation of ['upload','complete','remove'] as const) {
    const permit=await runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:20,rights:{basis:'owned',note:'Concurrent cleanup fixture'}},{id:editorId,requestId:randomUUID()});
    const blocker=await runtime.db.pool.connect();
    let response:ReturnType<typeof call>|undefined;
    try {
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE',[vehicle.id]);
      const id=permit.media.id;
      response=call(operation==='upload'?{method:'PUT',url:permit.uploadUrl,headers:{...headers(),'content-type':'image/png','if-match':'1'},payload:Buffer.alloc(20)}:
        {method:operation==='complete'?'POST':'DELETE',url:`/api/v1/admin/media/${id}${operation==='complete'?'/complete':''}`,headers:headers(),payload:{version:1}});
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++) {
        const locks=await runtime.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT id FROM vehicles WHERE id=$1 FOR UPDATE'");
        if(locks.rowCount) {waiting=true;break;} await delay(20);
      }
      assert.equal(waiting,true,'mutation reached the vehicle lock after its first media read');
      // Model the physical removal performed by cleanup before the waiting mutation resumes.
      await blocker.query('DELETE FROM media_assets WHERE id=$1',[id]);await blocker.query('COMMIT');
      const result=await response;assert.equal(result.statusCode,404,result.body);
    } finally {await blocker.query('ROLLBACK');blocker.release();if(response) await response;}
  }
});
test('regional original text can be reviewed and published without hiding its actual language tag',async()=>{
  let vehicle=await ready();vehicle.draft.content.title.sourceLanguage='zh-CN';vehicle=await save(vehicle);
  for(const locale of ['zh','en','ru'] as const) {
    const text=vehicle.draft.content.title.translations[locale]!;
    assert.equal(text.reviewStatus,'stale');text.sourceVersion=vehicle.draft.content.title.sourceVersion;text.reviewStatus='approved';
  }
  vehicle=await save(vehicle);vehicle=await publish(vehicle);
  const zh=await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=zh`});assert.equal(zh.statusCode,200,zh.body);
  assert.deepEqual(zh.json().data.content.title,{text:vehicle.draft.content.title.sourceText,requestedLocale:'zh',contentLocale:'zh-CN',kind:'original',reviewed:true});
  assert.equal((await runtime.inventory.getPublic(vehicle.id,'ru')).content.title.contentLocale,'ru');
});
test('published snapshots reject mutation and an interrupted publication transaction rolls back',async()=>{
  let vehicle=await ready();vehicle=await publish(vehicle);
  await assert.rejects(runtime.db.pool.query("UPDATE vehicle_publications SET data='{}' WHERE id=$1",[vehicle.publishedRevisionId]),/immutable/);
  const next=await ready();const actor={id:editorId,requestId:randomUUID()};
  await runtime.db.pool.query(`CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='vehicle.publish' THEN RAISE EXCEPTION 'injected test failure'; END IF; RETURN NEW; END $$`);
  await runtime.db.pool.query('CREATE TRIGGER test_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_audit()');
  try {await assert.rejects(runtime.inventory.publish(next.id,next.version,actor,randomUUID()),/injected/);}
  finally {await runtime.db.pool.query('DROP TRIGGER test_failure ON audit_events');await runtime.db.pool.query('DROP FUNCTION test_fail_audit()');}
  assert.equal((await runtime.inventory.getAdmin(next.id)).version,next.version);
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM vehicle_publications WHERE vehicle_id=$1',[next.id])).rowCount,0);
});
test('a full published photo set can replace an image without deleting historical evidence',async()=>{
  let vehicle=await create();const actor={id:editorId,requestId:randomUUID()};
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#336699'}}).png().toBuffer();
  for(let index=0;index<30;index++) {
    const permit=await runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:bytes.length,rights:{basis:'owned',note:'Synthetic quota regression image'}},actor);
    const uploaded=await runtime.media.upload(permit.media.id,permit.media.version,bytes,'image/png',actor);
    await runtime.media.complete(uploaded.id,uploaded.version,actor);
    vehicle.draft.media.push({id:uploaded.id,sortOrder:index,isCover:index===0,alt:'Synthetic quota fixture'});
  }
  vehicle=await runtime.inventory.save(vehicle.id,vehicle.version,vehicle.draft,actor);
  vehicle=await runtime.inventory.availability(vehicle.id,{version:vehicle.version,availability:'available',checkedAt:new Date().toISOString()},actor);
  vehicle=await runtime.inventory.publish(vehicle.id,vehicle.version,actor,randomUUID());
  await assert.rejects(runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:bytes.length,rights:{basis:'owned',note:'Over quota'}},actor),/at most 30/);
  const old=vehicle.draft.media.pop()!;vehicle=await runtime.inventory.save(vehicle.id,vehicle.version,vehicle.draft,actor);
  const replacement=await runtime.media.create({vehicleId:vehicle.id,contentType:'image/png',sizeBytes:bytes.length,rights:{basis:'owned',note:'Replacement'}},actor);
  assert.ok(replacement.media.id);assert.equal((await runtime.inventory.getPublic(vehicle.id,'en')).images.length,30);
  const oldMedia=await runtime.media.get(old.id);await assert.rejects(runtime.media.remove(old.id,oldMedia.version,actor),/history/);
});
test('protected expired uploads do not starve cleanup of later unreferenced files',async()=>{
  // Isolated DB seed models 100 protected expired uploads without creating 100 HTTP requests.
  const vehicles=await Promise.all([1,2,3,4].map(()=>create()));const ids:string[]=[];
  for(const vehicle of vehicles) {
    const batch=Array.from({length:25},()=>randomUUID());ids.push(...batch);
    for(const id of batch) await runtime.db.pool.query(`INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,expires_at,rights,created_at) VALUES($1,$2,'image/png',20,now()-interval '2 hours',$3,now()-interval '3 hours')`,[id,vehicle.id,JSON.stringify({basis:'owned',note:'Protected cleanup fixture'})]);
    const data=structuredClone(vehicle.draft);data.media=batch.map((id,index)=>({id,sortOrder:index,isCover:index===0,alt:''}));
    await runtime.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[vehicle.id,JSON.stringify(data)]);
  }
  const vehicle=vehicles[0]!;
  const target=randomUUID();await runtime.db.pool.query(`INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,expires_at,rights) VALUES($1,$2,'image/png',20,now()-interval '1 hour',$3)`,[target,vehicle.id,JSON.stringify({basis:'owned',note:'Unreferenced cleanup fixture'})]);
  await runtime.media.cleanupExpired();
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM media_assets WHERE id=$1',[target])).rowCount,0);
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM media_assets WHERE id=ANY($1::uuid[])',[ids])).rowCount,100);
  for(const item of vehicles) await runtime.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[item.id,JSON.stringify(item.draft)]);
});
test('spoofed forwarding headers cannot reset the login rate limit',async()=>{
  const statuses:number[]=[];
  for(let i=0;i<6;i++) {
    const r=await runtime.app.inject({method:'POST',url:'/api/auth/sign-in/email',remoteAddress:'203.0.113.70',headers:{origin,'x-forwarded-for':`192.0.2.${i+1}`,'x-hd-client-ip':`192.0.2.${i+1}`},payload:{email:'invalid-email',password}});
    statuses.push(r.statusCode);
  }
  assert.equal(statuses[5],429,JSON.stringify(statuses));
});
test('a fresh API instance reads persisted data and reports readiness',async()=>{
  const vehicle=await create();
  const second=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:dbUrl,AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:path.join(root,'media'),AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin}));
  try {
    assert.equal((await second.inventory.getAdmin(vehicle.id)).stockCode,vehicle.stockCode);
    assert.equal((await second.app.inject('/health/live')).statusCode,200);
    assert.equal((await second.app.inject('/health/ready')).statusCode,200);
  } finally {await second.app.close();}
});
test('production cookies are Secure and a missing database fails readiness without failing liveness',async()=>{
  const production=await buildApp(readConfig({NODE_ENV:'production',DATABASE_URL:dbUrl,AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:path.join(root,'media'),AUTH_BASE_URL:'https://admin.example.invalid',TRUSTED_ORIGINS:'https://admin.example.invalid'}));
  try {
    const login=await production.app.inject({method:'POST',url:'/api/auth/sign-in/email',headers:{origin:'https://admin.example.invalid'},payload:{email:'admin@example.invalid',password}});
    assert.equal(login.statusCode,200,login.body);assert.match(String(login.headers['set-cookie']),/; Secure/);assert.match(String(login.headers['set-cookie']),/__Secure-hd-auto/);
  } finally {await production.app.close();}
  const unavailable=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:path.join(root,'unavailable-media')}));
  try {
    assert.equal((await unavailable.app.inject('/health/live')).statusCode,200);
    const readiness=await unavailable.app.inject('/health/ready');assert.equal(readiness.statusCode,503);assert.deepEqual(readiness.json(),{status:'unavailable'});
  } finally {await unavailable.app.close();}
});
test('disabled staff sessions fail immediately and sign-out invalidates the session',async()=>{
  await setStaffEnabled(runtime.db,'editor@example.invalid',false);
  assert.equal((await call({method:'GET',url:'/api/v1/admin/me',headers:headers()})).statusCode,401);
  await setStaffEnabled(runtime.db,'editor@example.invalid',true);
  assert.equal((await call({method:'GET',url:'/api/v1/admin/me',headers:headers()})).statusCode,401);
  const login=await call({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email:'editor@example.invalid',password}});assert.equal(login.statusCode,200,login.body);cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  const logout=await call({method:'POST',url:'/api/auth/sign-out',headers:headers(),payload:{}});assert.equal(logout.statusCode,200,logout.body);
  assert.equal((await call({method:'GET',url:'/api/v1/admin/me',headers:headers()})).statusCode,401);
});
