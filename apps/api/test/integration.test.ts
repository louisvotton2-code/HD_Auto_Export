import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import type {InjectOptions} from 'fastify';
import {makeVehicleDraftFixture,makeDemoVehicleDraftFixture,makeExternalVehicleDraftFixture} from '@hd/contracts/fixtures';
import {PublicVehicleResponseSchema,PublicVehicleListSchema,ApiErrorSchema} from '@hd/contracts/public';
import {BulkVehicleMutationResponseSchema,AdminVehicleFiltersResponseSchema,VehicleTranslationSuggestionsResponseSchema,SaveVehicleRequestSchema,VehicleLocalizationSchema,PublicationPreviewResponseSchema,PublishReadinessResponseSchema,type VehicleLocalization,type AdminVehicle,type VehicleDraftInput} from '@hd/contracts/admin';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {changeStaffLogin,createStaff,setStaffEnabled} from '../src/staff-cli.js';
import {VehicleTranslator} from '../src/vehicles/translation.js';

const baseUrl=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['postgres:','postgresql:'].includes(baseUrl.protocol)||!['127.0.0.1','localhost'].includes(baseUrl.hostname)||baseUrl.pathname!=='/postgres'||baseUrl.search||baseUrl.hash) throw new Error('Integration tests require a local PostgreSQL maintenance database without connection options; never point at production.');
async function localTransport(url:URL):Promise<string> {
  const socket=process.env.API_TEST_DATABASE_SOCKET;
  if(socket===undefined)return url.toString();
  if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('API_TEST_DATABASE_SOCKET must name an existing local PostgreSQL socket directory.');
  const transport=new URL(url);transport.searchParams.set('host',socket);return transport.toString();
}
const databaseName=`hd_api_test_${randomBytes(8).toString('hex')}`;
let maintenance:ReturnType<typeof createDatabase>;
let createdDatabase=false;
let runtime:Awaited<ReturnType<typeof buildApp>>;
let root:string;let cookie:string;let editorId:string;let requestCounter=0;
const origin='http://127.0.0.1:3318';
const password='Isolated_test_password_903!';
let dbUrl:string;
let translationHook:((text:string,target:'en'|'ru')=>Promise<string>)|null=null;
const headers=()=>({cookie,origin});
const call=(options:InjectOptions)=>runtime.app.inject({...options,remoteAddress:`198.51.${Math.floor(requestCounter/240)}.${++requestCounter%240+1}`});
function rejectedPublication(response:Awaited<ReturnType<typeof call>>,fieldPath:string){
  assert.equal(response.statusCode,422,response.body);const error=ApiErrorSchema.parse(response.json()).error;
  assert.equal(error.code,'PUBLISH_VALIDATION_FAILED');assert.ok(error.fields?.some(field=>field.path===fieldPath),response.body);
}
function draft():VehicleDraftInput {const value=makeVehicleDraftFixture();value.media=[];value.facts.trim={id:'fixture_trim',name:'Synthetic fixture configuration'};return value;}
// Escape every UTF-16 unit in every JSON string, including property names, without changing the parsed request.
function escapedJson(value:object):string {
  return JSON.stringify(value).replace(/"(?:[^"\\]|\\.)*"/g,token=>`"${(JSON.parse(token) as string).split('').map(unit=>`\\u${unit.charCodeAt(0).toString(16).padStart(4,'0')}`).join('')}"`);
}
function padJson(body:string,size:number):Buffer {
  const bytes=Buffer.from(body);assert.ok(bytes.length<=size);return Buffer.concat([bytes,Buffer.alloc(size-bytes.length,0x20)]);
}
async function create(value=draft()):Promise<AdminVehicle> {
  const r=await call({method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':randomUUID()},payload:{draft:value}});
  assert.equal(r.statusCode,201,r.body);return r.json().data;
}
async function save(vehicle:AdminVehicle):Promise<AdminVehicle> {
  const r=await call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:vehicle.draft}});
  assert.equal(r.statusCode,200,r.body);return r.json().data;
}
async function upload(vehicle:AdminVehicle, provenance?:{listingUrl:string;imageUrl:string;collectedAt:string}) {
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#224466'}}).png().toBuffer();
  const permit=await call({method:'POST',url:'/api/v1/admin/media/uploads',headers:headers(),payload:{vehicleId:vehicle.id,contentType:'image/png',sizeBytes:bytes.length,rights:{basis:provenance?'unverified':'owned',note:'Synthetic test image generated for this test.',...(provenance?{source:provenance}:{})}}});
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
async function readyDemo():Promise<AdminVehicle> {
  const value=makeDemoVehicleDraftFixture();value.media=[];
  let vehicle=await create(value);const media=await upload(vehicle);
  vehicle.draft.media=[{id:media.id,sortOrder:0,isCover:true,alt:'Synthetic non-inventory example'}];
  return save(vehicle);
}
async function publish(vehicle:AdminVehicle):Promise<AdminVehicle> {
  vehicle=await confirmReady(vehicle);
  const r=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});
  assert.equal(r.statusCode,200,r.body);return r.json().data;
}
/** Success-path synthetic fixtures explicitly complete display text, then acknowledge the exact preview. */
async function confirmReady(vehicle:AdminVehicle):Promise<AdminVehicle> {
  const local=await localization(vehicle.id);
  assert.equal(local.vehicleVersion,vehicle.version,'Successful publication must use the current vehicle version.');
  if(local.data.fields.some(field=>['zh','en','ru'].some(locale=>{
    const value=field.translations[locale as 'zh'|'en'|'ru'];
    return !value||value.sourceVersion!==field.sourceVersion||value.reviewStatus==='stale'||(vehicle.draft.source.kind!=='demo'&&value.reviewStatus!=='approved');
  }))){await reviewDisplay(vehicle.id);vehicle=await freshVehicle(vehicle.id);}
  const response=await call({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}/publication-preview?locale=zh`,headers:headers()});
  assert.equal(response.statusCode,200,response.body);const preview=PublicationPreviewResponseSchema.parse(response.json()).data;
  const confirmed=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publication-preview/confirm`,headers:headers(),payload:{version:preview.vehicleVersion,publicContentRevision:preview.publicContentRevision,fingerprint:preview.fingerprint,locale:preview.locale}});
  assert.equal(confirmed.statusCode,200,confirmed.body);assert.equal(PublishReadinessResponseSchema.parse(confirmed.json()).data.canPublish,true);
  return vehicle;
}
/** Models pre-ADUX10 published data in this random database, never a new publication request. */
async function seedHistoricalPublication(vehicle:AdminVehicle):Promise<AdminVehicle> {
  await runtime.db.transaction(async client=>{
    await client.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE',[vehicle.id]);
    const media=await client.query<{id:string;width:number;height:number}>("SELECT id,width,height FROM media_assets WHERE vehicle_id=$1 AND state='ready'",[vehicle.id]);
    const images=vehicle.draft.media.map(image=>{
      const stored=media.rows.find(row=>row.id===image.id);assert.ok(stored);
      return {...image,url:`/api/v1/media/${image.id}`,width:stored.width,height:stored.height};
    });
    const {source,facts,price,content}=vehicle.draft;const publication=randomUUID();
    await client.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,vehicle.id,JSON.stringify({source,facts,price,content,images})]);
    for(const image of images)await client.query('INSERT INTO publication_media(publication_id,media_id) VALUES($1,$2)',[publication,image.id]);
    await client.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now(),version=version+1 WHERE id=$1",[vehicle.id,publication]);
  });
  return freshVehicle(vehicle.id);
}
before(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'hd-api-test-'));
  maintenance=createDatabase(await localTransport(baseUrl),2);
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
  createdDatabase=true;
  const url=new URL(baseUrl);url.pathname=`/${databaseName}`;dbUrl=await localTransport(url);
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:path.join(root,'media'),AUTH_BASE_URL:origin,TRUSTED_ORIGINS:origin});
  runtime=await buildApp({...config,databaseUrl:dbUrl},{translator:new VehicleTranslator({engineVersion:'isolated-http-stub:1',async translate(text,target){return translationHook?translationHook(text,target):`${target}:${text}`;}},1_000_000)});await migrateDatabase(runtime.db);await migrateDatabase(runtime.db);
  await createStaff(runtime.auth,{email:'admin@example.invalid',name:'Test admin',role:'admin',password});
  const editor=await createStaff(runtime.auth,{email:'editor@example.invalid',name:'Test editor',role:'editor',password});editorId=editor.user.id;
  const login=await call({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email:'editor@example.invalid',password}});
  assert.equal(login.statusCode,200,login.body);
  cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  assert.ok(cookie);assert.match(String(login.headers['set-cookie']),/HttpOnly/i);assert.match(String(login.headers['set-cookie']),/SameSite=Lax/i);assert.match(String(login.headers['set-cookie']),/Path=\/api/);
});
after(async()=>{
  if(runtime) await runtime.app.close();
  if(createdDatabase)await maintenance.pool.query(`DROP DATABASE "${databaseName}"`);if(maintenance)await maintenance.close();
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
test('full multibyte translation drafts survive save/readback, escaped JSON and the bounded route limit',async(context)=>{
  const limit=1024*1024;const input=draft();
  for(const [name,char] of [['title','车'],['description','辆']] as const) {
    input.content[name]={sourceLanguage:'zh',sourceText:char.repeat(10_000),sourceVersion:1,translations:{zh:null,en:null,ru:null}};
  }
  const creation=JSON.stringify({draft:input});assert.ok(Buffer.byteLength(creation)<100_000);
  let vehicle=await create(input);
  for(const name of ['title','description'] as const) {
    const field=vehicle.draft.content[name];
    for(const locale of ['zh','en','ru'] as const)field.translations[locale]={
      text:locale==='zh'?field.sourceText!:locale==='en'?'E'.repeat(10_000):'Я'.repeat(10_000),
      kind:locale==='zh'?'original':'machine',reviewStatus:'pending',sourceVersion:field.sourceVersion,humanEditVersion:0,
      engineVersion:locale==='zh'?null:'isolated-pending-result:1',
    };
  }
  const adopted=JSON.stringify(SaveVehicleRequestSchema.parse({version:vehicle.version,draft:vehicle.draft}));
  assert.ok(Buffer.byteLength(adopted)>100_000);assert.ok(Buffer.byteLength(adopted)<limit);
  const url=`/api/v1/admin/vehicles/${vehicle.id}`;
  const first=await call({method:'PATCH',url,headers:{...headers(),'content-type':'application/json'},payload:adopted});
  assert.equal(first.statusCode,200,first.body);vehicle=first.json().data;
  for(const name of ['title','description'] as const)for(const locale of ['zh','en','ru'] as const) {
    const text=vehicle.draft.content[name].translations[locale]!;
    assert.equal(text.text.length,10_000);assert.equal(text.reviewStatus,'pending');assert.equal(text.kind,locale==='zh'?'original':'machine');
  }
  const escaped=escapedJson({version:vehicle.version,draft:vehicle.draft});
  assert.deepEqual(JSON.parse(escaped),{version:vehicle.version,draft:vehicle.draft});assert.ok(Buffer.byteLength(escaped)>Buffer.byteLength(adopted));
  const second=await call({method:'PATCH',url,headers:{...headers(),'content-type':'application/json'},payload:escaped});
  assert.equal(second.statusCode,200,second.body);vehicle=second.json().data;
  const atLimit=padJson(JSON.stringify({version:vehicle.version,draft:vehicle.draft}),limit);
  const boundary=await call({method:'PATCH',url,headers:{...headers(),'content-type':'application/json'},payload:atLimit});
  assert.equal(boundary.statusCode,200,boundary.body);vehicle=boundary.json().data;
  const overflow=Buffer.concat([atLimit,Buffer.from(' ')]);
  const rejectedSave=await call({method:'PATCH',url,headers:{...headers(),'content-type':'application/json'},payload:overflow});
  assert.equal(rejectedSave.statusCode,413,rejectedSave.body);assert.equal(rejectedSave.json().error.code,'PAYLOAD_TOO_LARGE');
  const countBefore=(await runtime.db.pool.query('SELECT count(*)::int n FROM vehicles')).rows[0].n;
  const rejectedCreate=await call({method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers(),'content-type':'application/json','idempotency-key':randomUUID()},payload:padJson(creation,limit+1)});
  assert.equal(rejectedCreate.statusCode,413,rejectedCreate.body);assert.equal((await runtime.db.pool.query('SELECT count(*)::int n FROM vehicles')).rows[0].n,countBefore);
  const smallMutation=await call({method:'POST',url:`${url}/publish`,headers:{...headers(),'content-type':'application/json','idempotency-key':randomUUID()},payload:padJson(JSON.stringify({version:vehicle.version}),100_001)});
  assert.equal(smallMutation.statusCode,413,smallMutation.body); // The general 100k limit was not raised.
  const refreshed=await call({method:'GET',url,headers:headers()});assert.equal(refreshed.statusCode,200,refreshed.body);
  assert.deepEqual(refreshed.json().data,vehicle); // All six complete texts persisted; failed requests made no change.
  context.diagnostic(`UTF-8 create=${Buffer.byteLength(creation)}, adopted save=${Buffer.byteLength(adopted)}, all-string-escaped save=${Buffer.byteLength(escaped)} bytes; exact route cap=${limit}.`);
});
test('one MiB covers bounded full-field draft JSON even when every string is Unicode-escaped',context=>{
  const input=makeExternalVehicleDraftFixture();
  input.source={kind:'external',platform:{id:'p'.repeat(100),name:'平'.repeat(120)},listingUrl:'https://example.invalid/'.padEnd(2048,'x'),externalId:'源'.repeat(300),collectedAt:'2026-11-08T00:00:00.000Z',sourceUpdatedAt:'2026-11-08T00:00:00.000Z'};
  for(const name of ['make','model','trim'] as const)input.facts[name]={id:name.padEnd(100,'x'),name:'车'.repeat(120)};
  Object.assign(input.facts,{modelYear:9999,manufacturedAt:{precision:'day',value:'9999-12-31'},firstRegistration:{precision:'day',value:'9999-12-31'},
    mileageKm:10_000_000,engineCc:100_000,powerKw:100_000,location:{country:'CN',city:'市'.repeat(120),displayName:'地'.repeat(200)}});
  const money={amount:'99999999999999.99',currency:'CNY' as const};
  input.price={kind:'reference',money,includes:Array.from({length:30},()=> '费'.repeat(200))};
  input.internal={purchaseCost:money,notes:'备'.repeat(10_000),supplierContact:'联'.repeat(1000),vin:'X'.repeat(17)};
  input.media=Array.from({length:30},(_,index)=>({id:`image_${index}`.padEnd(100,'x'),alt:'图'.repeat(500),sortOrder:index,isCover:index===0}));
  for(const field of Object.values(input.content)) {
    field.sourceLanguage='zh-aaaaaaaa'+'-aaaaaaa'.repeat(3);field.sourceText='中'.repeat(10_000);field.sourceVersion=Number.MAX_SAFE_INTEGER;
    for(const locale of ['zh','en','ru'] as const)field.translations[locale]={text:'文'.repeat(10_000),kind:'machine',reviewStatus:'pending',
      sourceVersion:Number.MAX_SAFE_INTEGER,humanEditVersion:Number.MAX_SAFE_INTEGER,engineVersion:'版'.repeat(200)};
  }
  const parsed=SaveVehicleRequestSchema.parse({version:Number.MAX_SAFE_INTEGER,draft:input});const bytes=Buffer.byteLength(escapedJson(parsed));
  assert.ok(bytes<1024*1024,`Full escaped draft was ${bytes} bytes`);
  context.diagnostic(`Full bounded-field save with normal UTC millisecond timestamps, escaped keys/values and all numeric versions at maximum=${bytes} bytes.`);
});
test('publishable changes are authoritative; identical publish is a version-protected no-op',async()=>{
  let vehicle=await publish(await ready());assert.equal(vehicle.hasUnpublishedChanges,false);
  const counts=async()=>({publications:(await runtime.db.pool.query('SELECT count(*)::int n FROM vehicle_publications WHERE vehicle_id=$1',[vehicle.id])).rows[0].n,
    audits:(await runtime.db.pool.query("SELECT count(*)::int n FROM audit_events WHERE vehicle_id=$1 AND operation='vehicle.publish'",[vehicle.id])).rows[0].n});
  const old=structuredClone(vehicle);const initial=await counts();assert.deepEqual(await publish(vehicle),old);assert.deepEqual(await counts(),initial);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers()})).json().data.hasUnpublishedChanges,false);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/vehicles?q=${vehicle.stockCode}`,headers:headers()})).json().data.items[0].hasUnpublishedChanges,false);
  vehicle.draft.internal.notes='Internal only';vehicle=await save(vehicle);assert.equal(vehicle.hasUnpublishedChanges,false);
  const availability=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/availability`,headers:headers(),payload:{version:vehicle.version,availability:'reserved',checkedAt:new Date().toISOString()}});
  vehicle=availability.json().data;assert.equal(vehicle.hasUnpublishedChanges,false);const afterLive=structuredClone(vehicle);
  assert.deepEqual(await publish(vehicle),afterLive);assert.deepEqual(await counts(),initial);
  const stale=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:old.version}});assert.equal(stale.statusCode,409);
  vehicle.draft.facts.model!.name='Updated public model';vehicle=await save(vehicle);assert.equal(vehicle.hasUnpublishedChanges,true);
  vehicle=await publish(vehicle);assert.equal(vehicle.hasUnpublishedChanges,false);assert.equal((await counts()).publications,initial.publications+1);
  const archived=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/archive`,headers:headers(),payload:{version:vehicle.version}});vehicle=archived.json().data;assert.equal(vehicle.hasUnpublishedChanges,false);
  const republished=await publish(vehicle);assert.equal(republished.version,vehicle.version+1);assert.equal(republished.publicationState,'published');
});
test('translation suggestions enforce auth, origin, version/idempotency and leave human content untouched',async()=>{
  let vehicle=await create();const url=`/api/v1/admin/vehicles/${vehicle.id}/translation-suggestions`;const key=randomUUID();
  for(const options of [{headers:{'idempotency-key':key},status:401},{headers:{cookie,'idempotency-key':key},status:403}]) {
    const result=await call({method:'POST',url,headers:options.headers,payload:{version:vehicle.version}});assert.equal(result.statusCode,options.status,result.body);
  }
  const request={method:'POST' as const,url,headers:{...headers(),'idempotency-key':key},payload:{version:vehicle.version}};
  assert.equal((await call({...request,payload:{version:vehicle.version+1}})).statusCode,409);
  assert.equal((await call({...request,headers:headers()})).statusCode,400);
  const result=await call(request);assert.equal(result.statusCode,200,result.body);
  const suggested=VehicleTranslationSuggestionsResponseSchema.parse(result.json()).data;assert.equal(suggested.version,vehicle.version);
  assert.equal(suggested.content.title.translations.en.reviewStatus,'pending');assert.equal(suggested.content.title.translations.en.kind,'machine');
  assert.deepEqual(await runtime.inventory.getAdmin(vehicle.id),vehicle);
  const replay=await call(request);assert.deepEqual(replay.json().data,suggested);
  vehicle.draft.internal.notes='edit after suggestion';vehicle=await save(vehicle);
  assert.deepEqual((await call(request)).json().data,suggested); // historical receipt; caller must compare current version
  const keyConflict=await call({...request,payload:{version:vehicle.version}});assert.equal(keyConflict.statusCode,409);assert.equal(keyConflict.json().error.code,'IDEMPOTENCY_CONFLICT');
  vehicle.draft.content.title.sourceLanguage='en';vehicle=await save(vehicle);
  const unsupported=await call({...request,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});assert.equal(unsupported.statusCode,422);assert.equal(unsupported.json().error.code,'TRANSLATION_SOURCE_UNSUPPORTED');
});
test('translation results racing with an edit are rejected and upstream failures never change the draft',async()=>{
  const input=draft();input.content.title.sourceText=`隔离旧建议${randomUUID()}`;input.content.description.sourceText=null;let vehicle=await create(input);
  let release!:()=>void;let started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const invoked=new Promise<void>(resolve=>{started=resolve;});
  translationHook=async(_text,target)=>{started();await gate;return `${target}:generated`;};
  const request={method:'POST' as const,url:`/api/v1/admin/vehicles/${vehicle.id}/translation-suggestions`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}};
  try {
    const pending=call(request);await invoked;vehicle.draft.internal.notes='Concurrent edit';vehicle=await save(vehicle);release();
    const stale=await pending;assert.equal(stale.statusCode,409,stale.body);assert.deepEqual(await runtime.inventory.getAdmin(vehicle.id),vehicle);
    translationHook=async()=>{throw new Error('private upstream failure');};vehicle.draft.content.title.sourceText=`隔离失败${randomUUID()}`;vehicle=await save(vehicle);
    const failed=await call({...request,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});assert.equal(failed.statusCode,503,failed.body);assert.equal(failed.json().error.code,'TRANSLATION_UPSTREAM_FAILED');assert.ok(!failed.body.includes('private upstream'));
    assert.deepEqual(await runtime.inventory.getAdmin(vehicle.id),vehicle);
  } finally{release();translationHook=null;}
});
test('demo publication stays non-inventory across catalog counts, home, detail and media; manual gates remain',async()=>{
  let demo=await readyDemo();
  assert.equal(demo.availability,'unknown');assert.equal(demo.availabilityCheckedAt,null);
  await call({method:'GET',url:`/api/v1/vehicles/${demo.id}`}).then(r=>assert.equal(r.statusCode,404));
  const uniqueMake=`demo_${randomBytes(4).toString('hex')}`;demo.draft.facts.make={id:uniqueMake,name:'Display Example Brand'};demo=await save(demo);
  demo=await publish(demo);
  for(const locale of ['zh','en','ru']) {
    const detail=await call({method:'GET',url:`/api/v1/vehicles/${demo.id}?locale=${locale}`});assert.equal(detail.statusCode,200,detail.body);
    const vehicle=PublicVehicleResponseSchema.parse(detail.json()).data;assert.equal(vehicle.source.kind,'demo');assert.equal(vehicle.availability,'unknown');assert.equal(vehicle.availabilityCheckedAt,null);assert.equal(vehicle.facts.location,null);assert.equal(vehicle.price.kind,'on_request');assert.equal(vehicle.content.title.reviewed,false);assert.equal(vehicle.content.description?.reviewed,false);assert.equal(vehicle.content.title.kind,locale==='zh'?'original':'machine');
    const list=await call({method:'GET',url:`/api/v1/vehicles?locale=${locale}&make=${uniqueMake}`});const parsed=PublicVehicleListSchema.parse(list.json());assert.equal(parsed.meta.total,1);assert.equal(parsed.data.items[0]!.id,demo.id);
    const filters=(await call({method:'GET',url:`/api/v1/vehicle-filters?locale=${locale}`})).json().data;assert.equal(filters.makes.find((m:{id:string})=>m.id===uniqueMake).count,1);
  }
  const home=(await call({method:'GET',url:'/api/v1/admin/home/vehicle-sections',headers:headers()})).json().data;home.sections[0].vehicleIds=[demo.id];
  const configured=await call({method:'PUT',url:'/api/v1/admin/home/vehicle-sections',headers:headers(),payload:home});assert.equal(configured.statusCode,200,configured.body);
  assert.equal((await call({method:'GET',url:'/api/v1/home/vehicles?locale=en'})).json().data.sections[0].vehicles[0].source.kind,'demo');
  assert.equal((await call({method:'GET',url:`/api/v1/media/${demo.draft.media[0]!.id}`})).statusCode,200);
  for(const availability of ['available','reserved','sold','unknown']) {
    const rejected=await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/availability`,headers:headers(),payload:{version:demo.version,availability,checkedAt:new Date().toISOString()}});
    assert.equal(rejected.statusCode,422,rejected.body);assert.equal(rejected.json().error.code,'DEMO_RESTRICTION');
  }
  const forbidden=structuredClone(demo.draft);forbidden.source.kind='manual';
  const converted=await call({method:'PATCH',url:`/api/v1/admin/vehicles/${demo.id}`,headers:headers(),payload:{version:demo.version,draft:forbidden}});assert.equal(converted.statusCode,422);
  const archived=await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/archive`,headers:headers(),payload:{version:demo.version}});assert.equal(archived.statusCode,200);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${demo.id}`})).statusCode,404);
  assert.equal((await call({method:'GET',url:`/api/v1/media/${demo.draft.media[0]!.id}`})).statusCode,404);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles?make=${uniqueMake}`})).json().meta.total,0);
  assert.ok(!(await call({method:'GET',url:'/api/v1/vehicle-filters'})).json().data.makes.some((m:{id:string})=>m.id===uniqueMake));
  assert.equal((await call({method:'GET',url:'/api/v1/home/vehicles'})).json().data.sections.length,0);
  const archivedHome={...configured.json().data};
  assert.equal((await call({method:'PUT',url:'/api/v1/admin/home/vehicle-sections',headers:headers(),payload:archivedHome})).statusCode,422);
  let manual=await ready();manual.draft.facts.location=null;manual=await save(manual);
  rejectedPublication(await call({method:'POST',url:`/api/v1/admin/vehicles/${manual.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:manual.version}}),'draft.facts.location');
  const noInventory=await readyDemo();const source=structuredClone(noInventory.draft);source.source.kind='manual';
  const manualUnknown=await create({...source,media:[]});const img=await upload(manualUnknown);manualUnknown.draft.media=[{id:img.id,sortOrder:0,isCover:true,alt:''}];manualUnknown.draft.facts.location={country:'CN',city:null,displayName:null};const saved=await save(manualUnknown);
  const unverified=await call({method:'POST',url:`/api/v1/admin/vehicles/${saved.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:saved.version}});assert.equal(unverified.statusCode,422);assert.ok(unverified.json().error.fields.some((f:{path:string})=>f.path==='availability'));
});
test('demo publish rejects corrupted inventory metadata and source switching in either direction',async()=>{
  const demo=await readyDemo();
  await runtime.db.pool.query("UPDATE vehicles SET availability='available',availability_checked_at=now() WHERE id=$1",[demo.id]);
  const rejected=await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:demo.version}});rejectedPublication(rejected,'availability');
  await runtime.db.pool.query("UPDATE vehicles SET availability='unknown',availability_checked_at=null WHERE id=$1",[demo.id]);
  const invalid=structuredClone(demo.draft);invalid.facts.mileageKm=100;
  await runtime.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[demo.id,JSON.stringify(invalid)]);
  const badFacts=await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:demo.version}});rejectedPublication(badFacts,'draft.facts.mileageKm');
  await runtime.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[demo.id,JSON.stringify(demo.draft)]);
  const manual=await create();const demoInput=makeDemoVehicleDraftFixture();demoInput.media=[];
  const changed=await call({method:'PATCH',url:`/api/v1/admin/vehicles/${manual.id}`,headers:headers(),payload:{version:manual.version,draft:demoInput}});assert.equal(changed.statusCode,422);assert.equal(changed.json().error.code,'DEMO_RESTRICTION');
});
test('demo pending text can publish without human-review claims, but stale or missing text cannot',async()=>{
  let demo=await readyDemo();
  for(const language of ['zh','en','ru'] as const) assert.equal(demo.draft.content.title.translations[language]!.reviewStatus,'pending');
  demo=await publish(demo);assert.equal((await runtime.inventory.getPublic(demo.id,'en')).content.title.reviewed,false);
  demo.draft.content.title.translations.ru!.kind='original';demo=await save(demo);
  rejectedPublication(await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:demo.version}}),'draft.content.title.translations.ru.kind');
  demo.draft.content.title.translations.ru!.kind='machine';demo=await save(demo);
  demo.draft.content.title.sourceText='Updated demonstration source';demo=await save(demo);
  const stale=await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:demo.version}});rejectedPublication(stale,'draft.content.title.translations.en');
  for(const language of ['zh','en','ru'] as const) {const text=demo.draft.content.title.translations[language]!;text.sourceVersion=demo.draft.content.title.sourceVersion;text.reviewStatus='pending';}
  demo.draft.content.title.translations.zh!.text=demo.draft.content.title.sourceText!;demo=await save(demo);demo=await publish(demo);
  assert.equal((await runtime.inventory.getPublic(demo.id,'en')).content.title.reviewed,false);
  demo.draft.content.title.translations.en=null;demo=await save(demo);
  rejectedPublication(await call({method:'POST',url:`/api/v1/admin/vehicles/${demo.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:demo.version}}),'draft.content.title.translations.en');
  let manual=await ready();manual.draft.content.title.translations.en!.reviewStatus='pending';manual=await save(manual);
  rejectedPublication(await call({method:'POST',url:`/api/v1/admin/vehicles/${manual.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:manual.version}}),'draft.content.title.translations.en');
});
test('bulk reports independent results, preserves unselected records and replays exact requests without duplicate writes',async()=>{
  const good=await publish(await ready()),stale=await create(),untouched=await create(),demo=await readyDemo(),missing=randomUUID();
  await save(stale);
  const key=randomUUID();const input={operation:'availability',availability:'sold',checkedAt:new Date().toISOString(),items:[{id:demo.id,expectedVersion:demo.version},{id:good.id.toUpperCase(),expectedVersion:good.version},{id:missing,expectedVersion:1},{id:stale.id,expectedVersion:stale.version}]};
  const options:InjectOptions={method:'POST',url:'/api/v1/admin/vehicles/bulk',headers:{...headers(),'idempotency-key':key},payload:input};
  const [first,replay]=await Promise.all([call(options),call(options)]);assert.equal(first.statusCode,200,first.body);assert.equal(replay.statusCode,200,replay.body);
  const data=BulkVehicleMutationResponseSchema.parse(first.json()).data;assert.deepEqual(data,replay.json().data);assert.deepEqual(data.summary,{total:4,succeeded:1,failed:3});
  assert.deepEqual(data.results.map(r=>r.id),input.items.map(i=>i.id));
  assert.deepEqual(data.results.map(r=>r.status==='failed'?r.error.code:'succeeded'),['DEMO_RESTRICTION','succeeded','NOT_FOUND','VERSION_CONFLICT']);
  assert.equal((await runtime.inventory.getAdmin(untouched.id)).version,untouched.version);assert.equal((await runtime.inventory.getAdmin(demo.id)).availability,'unknown');
  assert.equal((await runtime.inventory.getPublic(good.id,'en')).availability,'sold');
  assert.ok(!(await runtime.inventory.listPublic({locale:'en',catalog:'curated',page:1,pageSize:48},randomUUID())).data.items.some(v=>v.id===good.id));
  assert.equal((await runtime.db.pool.query("SELECT count(*)::int AS count FROM audit_events WHERE vehicle_id=$1 AND operation='vehicle.availability'",[good.id])).rows[0].count,2); // initial verification + one bulk write
  const differentOperation=await call({...options,payload:{operation:'archive',items:input.items}});assert.equal(differentOperation.statusCode,409);
  const changedKey=await call({...options,headers:{...headers(),'idempotency-key':randomUUID()}});assert.equal(changedKey.statusCode,200);assert.equal(changedKey.json().data.results[1].error.code,'VERSION_CONFLICT');
  const refreshed=await runtime.inventory.getAdmin(good.id);await runtime.inventory.availability(good.id,{version:refreshed.version,availability:'reserved',checkedAt:new Date().toISOString()},{id:editorId,requestId:randomUUID()});
  const oldResult=await call(options);assert.deepEqual(oldResult.json().data,data);assert.equal((await runtime.inventory.getAdmin(good.id)).availability,'reserved');
});
test('bulk bounds, authorization, conflicting concurrent batches and infrastructure rollback are enforced',async()=>{
  const one=await publish(await ready()),two=await publish(await ready());
  const payload={operation:'archive',items:[{id:one.id,expectedVersion:one.version},{id:two.id,expectedVersion:two.version}]};
  const request=(body:unknown,extraHeaders=headers())=>call({method:'POST',url:'/api/v1/admin/vehicles/bulk',headers:{...extraHeaders,'idempotency-key':randomUUID()},payload:body as InjectOptions['payload']});
  assert.equal((await request(payload,{} as ReturnType<typeof headers>)).statusCode,401);
  assert.equal((await request(payload,{cookie,origin:'https://untrusted.example'})).statusCode,403);
  for(const body of [{...payload,items:[]},{...payload,items:Array.from({length:51},()=>({id:randomUUID(),expectedVersion:1}))},{...payload,items:[payload.items[0],{...payload.items[0],id:one.id.toUpperCase()}]},{...payload,items:[{id:'invalid',expectedVersion:1}]},{operation:'availability',availability:'sold',checkedAt:new Date(Date.now()+3600_000).toISOString(),items:payload.items}]) assert.equal((await request(body)).statusCode,400);
  assert.equal((await runtime.inventory.getAdmin(one.id)).version,one.version);
  await runtime.db.pool.query(`CREATE FUNCTION fail_bulk_second_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='vehicle.archive' AND NEW.vehicle_id='${two.id}' THEN RAISE EXCEPTION 'injected bulk failure'; END IF; RETURN NEW; END $$`);
  await runtime.db.pool.query('CREATE TRIGGER test_bulk_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_bulk_second_audit()');
  const failingKey=randomUUID();
  try {const failed=await call({method:'POST',url:'/api/v1/admin/vehicles/bulk',headers:{...headers(),'idempotency-key':failingKey},payload});assert.equal(failed.statusCode,500,failed.body);}
  finally {await runtime.db.pool.query('DROP TRIGGER test_bulk_audit ON audit_events');await runtime.db.pool.query('DROP FUNCTION fail_bulk_second_audit()');}
  assert.equal((await runtime.inventory.getAdmin(one.id)).publicationState,'published');assert.equal((await runtime.inventory.getAdmin(two.id)).version,two.version);
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM idempotency_keys WHERE key=$1',[failingKey])).rowCount,0);
  const raced=await Promise.all([request(payload),request({...payload,items:[...payload.items].reverse()})]);
  assert.deepEqual(raced.map(r=>r.statusCode),[200,200]);assert.deepEqual(raced.map(r=>r.json().data.summary.succeeded).sort(),[0,2]);
  for(const item of [one,two]) {assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${item.id}`})).statusCode,404);assert.equal((await call({method:'GET',url:`/api/v1/media/${item.draft.media[0]!.id}`})).statusCode,404);}
  const demo=await publish(await readyDemo());const removed=await request({operation:'archive',items:[{id:demo.id,expectedVersion:demo.version}]});assert.equal(removed.json().data.summary.succeeded,1);
});
test('admin classification options include drafts and archives, respect make-model pairs and never expose internal fields',async()=>{
  const prefix=`opts_${randomBytes(4).toString('hex')}`;
  const first=draft();first.facts.make={id:`${prefix}_a`,name:'Earlier name'};first.facts.model={id:`${prefix}_shared`,name:'A model'};
  const a=await create(first);const archived=await runtime.inventory.archive(a.id,a.version,{id:editorId,requestId:randomUUID()});
  const second=draft();second.facts.make={id:`${prefix}_a`,name:'Latest name'};second.facts.model={id:`${prefix}_shared`,name:'Latest A model'};second.facts.powertrain='unknown';await create(second);
  const third=draft();third.facts.make={id:`${prefix}_b`,name:'B brand'};third.facts.model={id:`${prefix}_shared`,name:'B model'};await create(third);
  const r=await call({method:'GET',url:'/api/v1/admin/vehicle-filters',headers:headers()});assert.equal(r.statusCode,200);const result=AdminVehicleFiltersResponseSchema.parse(r.json()).data;
  assert.equal(result.scope,'all_inventory');assert.equal(result.makes.find(m=>m.id===`${prefix}_a`)!.count,2);assert.equal(result.makes.find(m=>m.id===`${prefix}_a`)!.name,'Latest name');
  assert.equal(result.models.filter(m=>m.id===`${prefix}_shared`).length,2);assert.ok(result.powertrains.some(p=>p.id==='unknown'));
  const selected=(await call({method:'GET',url:`/api/v1/admin/vehicle-filters?make=${prefix}_a`,headers:headers()})).json().data;
  assert.deepEqual(selected.makes,result.makes);assert.deepEqual(selected.powertrains,result.powertrains);assert.deepEqual(selected.models.map((m:{makeId:string})=>m.makeId),[`${prefix}_a`]);
  assert.equal((await call({method:'GET',url:'/api/v1/admin/vehicle-filters?make=nonexistent',headers:headers()})).json().data.models.length,0);
  const publicOptions=(await call({method:'GET',url:'/api/v1/vehicle-filters'})).json().data;assert.ok(!publicOptions.makes.some((m:{id:string})=>m.id.startsWith(prefix)));
  for(const hidden of ['purchaseCost','supplierContact','INTERNAL_FIXTURE_NOT_PUBLIC','vin']) assert.ok(!r.body.includes(hidden));
  assert.equal((await call({method:'GET',url:'/api/v1/admin/vehicle-filters'})).statusCode,401);
  assert.equal((await runtime.inventory.getAdmin(archived.id)).publicationState,'archived');
});
test('admin search filters before pagination, combines categories and treats special characters literally',async()=>{
  const group=`search_${randomBytes(5).toString('hex')}`;
  const target=draft();target.facts.make={id:group,name:'Atlas Demo Brand'};
  target.facts.model={id:`${group}_model`,name:'Orion Special Model'};target.facts.powertrain='bev';
  target.content.title.sourceText="专用检索 ' %_ \\ O'Reilly";
  target.internal.notes='NEVER_SEARCH_INTERNAL_NOTES';target.internal.vin='SYNTHETICVIN00001';
  let vehicle=await create(target);
  for(let i=0;i<4;i++) {
    const value=draft();value.facts.make={id:group,name:'Other Brand'};value.facts.model={id:`${group}_other`,name:'Other Model'};
    await create(value);
  }
  const query=async(params:Record<string,string|number>)=>{
    const r=await call({method:'GET',url:`/api/v1/admin/vehicles?${new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]))}`,headers:headers()});
    assert.equal(r.statusCode,200,r.body);return r.json().data;
  };
  const first=await query({make:group,pageSize:2});assert.equal(first.total,5);assert.equal(first.hasMore,true);assert.ok(!first.items.some((v:AdminVehicle)=>v.id===vehicle.id));
  const found=await query({q:`  ${vehicle.stockCode.toLowerCase()}  `,make:group,pageSize:2});assert.equal(found.total,1);assert.equal(found.items[0].id,vehicle.id);assert.equal(found.hasMore,false);
  assert.equal((await query({q:vehicle.stockCode,pageSize:2,page:2})).items.length,0);
  for(const q of ['atlas demo','Orion Special','专用检索',"O'Reilly",'%_','\\']) {
    const matched=await query({q,make:group});assert.equal(matched.total,1);assert.equal(matched.items[0].id,vehicle.id);
  }
  assert.equal((await query({q:'专用检索',make:group,model:`${group}_model`,powertrain:'bev',publicationState:'draft',availability:'unknown'})).total,1);
  assert.equal((await query({q:'专用检索',make:group,powertrain:'petrol'})).total,0);
  for(const q of ["' OR 1=1 --",'NEVER_SEARCH_INTERNAL_NOTES','SYNTHETICVIN00001']) assert.equal((await query({q,make:group})).total,0);
  assert.equal((await query({q:'   ',make:group})).total,5);
  assert.equal((await query({make:group})).total,5);
  vehicle.draft.content.title.sourceText='最新原文标题';vehicle=await save(vehicle);
  assert.equal((await query({q:'最新原文',make:group})).items[0].id,vehicle.id);
  assert.equal((await query({q:'专用检索',make:group})).total,0);
  const invalidQueries:Record<string,string>[]=[{q:'x'.repeat(101)},{q:'bad\u0000value'},{powertrain:'spaceship'},{make:'invalid id'}];
  for(const params of invalidQueries) {
    const r=await call({method:'GET',url:`/api/v1/admin/vehicles?${new URLSearchParams(params)}`,headers:headers()});assert.equal(r.statusCode,400,r.body);
  }
  assert.equal((await call({method:'GET',url:'/api/v1/admin/vehicles?q=Atlas'})).statusCode,401);
  assert.equal((await call({method:'GET',url:'/api/v1/vehicles?q=Atlas'})).statusCode,200);
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
  vehicle=await confirmReady(await ready());const publishKey=randomUUID();
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
test('incomplete manual drafts stay private; demo unknown facts stay null and stale translations cannot publish',async()=>{
  let vehicle=await publish(await ready());const visible=await runtime.inventory.getPublic(vehicle.id,'ru');
  vehicle.draft.price={kind:'on_request',money:null,includes:[]};vehicle.draft.facts.manufacturedAt=null;vehicle.draft.facts.mileageKm=null;
  vehicle=await save(vehicle);
  const incomplete=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});
  assert.equal(incomplete.statusCode,422,incomplete.body);
  for(const path of ['draft.price','draft.facts.mileageKm'])assert.ok(incomplete.json().error.fields.some((field:{path:string})=>field.path===path));
  assert.deepEqual(await runtime.inventory.getPublic(vehicle.id,'ru'),visible);
  const demo=await publish(await readyDemo());const unknown=await runtime.inventory.getPublic(demo.id,'ru');
  assert.equal(unknown.price.money,null);assert.equal(unknown.facts.manufacturedAt,null);assert.equal(unknown.facts.mileageKm,null);
  vehicle.draft.price=draft().price;vehicle.draft.facts.mileageKm=0;
  vehicle.draft.content.title.sourceText='Changed source';vehicle=await save(vehicle);vehicle=await save(vehicle);
  const blocked=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});assert.equal(blocked.statusCode,422,blocked.body);
  assert.ok(blocked.json().error.fields.some((field:{path:string})=>field.path==='draft.content.title.translations.en'));
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
        const locks=await runtime.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT id FROM vehicles WHERE id=$1 AND deleted_at IS NULL FOR UPDATE'");
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
  const next=await confirmReady(await ready());const actor={id:editorId,requestId:randomUUID()};
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
  vehicle=await confirmReady(vehicle);
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
    // An older database can have home_config but still lack the migration required by this binary.
    await runtime.db.pool.query('ALTER TABLE vehicles RENAME COLUMN deleted_at TO test_unmigrated_deleted_at');
    try {assert.equal((await second.app.inject('/health/ready')).statusCode,503);}
    finally {await runtime.db.pool.query('ALTER TABLE vehicles RENAME COLUMN test_unmigrated_deleted_at TO deleted_at');}
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
test('vehicle recycle bin removes every active surface and restores only an unpublished draft',async()=>{
  let vehicle=await ready();const make=`recycle_${randomBytes(4).toString('hex')}`;
  vehicle.draft.facts.make={id:make,name:'Recycle fixture'};vehicle=await publish(await save(vehicle));
  const mediaId=vehicle.draft.media[0]!.id;const imageBefore=await runtime.media.preview(mediaId);
  let home=await runtime.inventory.getHome();home.sections=home.sections.map((section,index)=>({...section,vehicleIds:[index===0?vehicle.id.toUpperCase():vehicle.id]}));
  home=await runtime.inventory.saveHome(home,{id:editorId,requestId:randomUUID()});
  assert.equal((await runtime.inventory.publicHome('en')).sections.length,2);assert.ok(home.sections.every(section=>section.vehicleIds[0]===vehicle.id));
  const path=`/api/v1/admin/vehicles/${vehicle.id}`;const key=randomUUID();
  const deletion:InjectOptions={method:'DELETE',url:path,headers:{...headers(),'idempotency-key':key},payload:{version:vehicle.version}};
  assert.equal((await call({...deletion,headers:{origin,'idempotency-key':key}})).statusCode,401);
  assert.equal((await call({...deletion,headers:{cookie,'idempotency-key':key}})).statusCode,403);
  assert.equal((await call({...deletion,headers:headers()})).statusCode,400);
  assert.equal((await call({...deletion,payload:{version:vehicle.version-1}})).statusCode,409);
  const [first,retry]=await Promise.all([call(deletion),call(deletion)]);assert.equal(first.statusCode,200,first.body);assert.equal(retry.statusCode,200,retry.body);
  const removed:AdminVehicle=first.json().data;assert.deepEqual(removed,retry.json().data);assert.ok(removed.deletedAt);assert.equal(removed.version,vehicle.version+1);
  assert.equal((await runtime.inventory.getHome()).version,home.version+1);assert.ok((await runtime.inventory.getHome()).sections.every(section=>section.vehicleIds.length===0));
  assert.equal((await runtime.db.pool.query("SELECT 1 FROM audit_events WHERE vehicle_id=$1 AND operation='vehicle.delete'",[vehicle.id])).rowCount,1);
  for(const query of ['', '?includeDeleted=false']) assert.equal((await call({method:'GET',url:path+query,headers:headers()})).statusCode,404);
  assert.equal((await call({method:'GET',url:path+'?includeDeleted=yes',headers:headers()})).statusCode,400);
  assert.equal((await call({method:'GET',url:path+'?includeDeleted=true',headers:headers()})).json().data.deletedAt,removed.deletedAt);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/vehicles?q=${vehicle.stockCode}`,headers:headers()})).json().data.total,0);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/vehicles?q=${vehicle.stockCode}&deleted=only`,headers:headers()})).json().data.total,1);
  assert.ok(!(await runtime.inventory.adminFilters({})).makes.some(item=>item.id===make));
  for(const locale of ['zh','en','ru']) {
    assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=${locale}`})).statusCode,404);
    assert.equal((await call({method:'GET',url:`/api/v1/vehicles?locale=${locale}&make=${make}`})).json().meta.total,0);
    assert.ok(!(await call({method:'GET',url:`/api/v1/vehicle-filters?locale=${locale}`})).json().data.makes.some((item:{id:string})=>item.id===make));
    assert.equal((await call({method:'GET',url:`/api/v1/home/vehicles?locale=${locale}`})).json().data.sections.length,0);
  }
  for(const url of [`/api/v1/media/${mediaId}`,`/api/v1/media/${mediaId}?variant=thumb`,`/api/v1/admin/media/${mediaId}`,`/api/v1/admin/media/${mediaId}/preview`]) assert.equal((await call({method:'GET',url,headers:headers()})).statusCode,404);
  for(const suffix of ['publish','archive','availability']) {
    const r=await call({method:'POST',url:path+'/'+suffix,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:removed.version,...(suffix==='availability'?{availability:'available',checkedAt:new Date().toISOString()}:{})}});assert.equal(r.statusCode,404,r.body);
  }
  assert.equal((await call({method:'PATCH',url:path,headers:headers(),payload:{version:removed.version,draft:removed.draft}})).statusCode,404);
  const bulk=await call({method:'POST',url:'/api/v1/admin/vehicles/bulk',headers:{...headers(),'idempotency-key':randomUUID()},payload:{operation:'archive',items:[{id:vehicle.id,expectedVersion:removed.version}]}});assert.equal(bulk.json().data.results[0].error.code,'NOT_FOUND');
  const newDelete=await call({...deletion,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:removed.version}});assert.equal(newDelete.statusCode,404);
  await runtime.db.pool.query("UPDATE media_assets SET expires_at=now()-interval '1 hour' WHERE vehicle_id=$1",[vehicle.id]);await runtime.media.cleanupExpired();
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM vehicle_publications WHERE vehicle_id=$1',[vehicle.id])).rowCount,1);
  assert.equal((await runtime.db.pool.query('SELECT 1 FROM media_assets WHERE id=$1',[mediaId])).rowCount,1);
  const restore:InjectOptions={method:'POST',url:path+'/restore',headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:removed.version}};
  assert.equal((await call({...restore,payload:{version:vehicle.version}})).statusCode,409);
  const restoredResponse=await call(restore);assert.equal(restoredResponse.statusCode,200,restoredResponse.body);const restored:AdminVehicle=restoredResponse.json().data;
  assert.equal(restored.deletedAt,null);assert.equal(restored.version,removed.version+1);assert.equal(restored.publicationState,'draft');assert.equal(restored.publishedRevisionId,null);assert.equal(restored.publishedAt,null);assert.equal(restored.availability,'unknown');assert.equal(restored.availabilityCheckedAt,null);
  assert.deepEqual(await runtime.media.preview(mediaId),imageBefore);assert.equal((await call({method:'GET',url:`/api/v1/media/${mediaId}`})).statusCode,404);
  assert.equal((await runtime.inventory.getHome()).version,home.version+1);assert.equal((await call({...restore,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:restored.version}})).statusCode,409);
  assert.deepEqual((await call(deletion)).json().data,removed);assert.equal((await runtime.inventory.getAdmin(vehicle.id)).deletedAt,null);
  const deletedAgain=await call({...deletion,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:restored.version}});assert.equal(deletedAgain.statusCode,200,deletedAgain.body);
  assert.deepEqual((await call(restore)).json().data,restored);assert.ok((await runtime.inventory.getAdmin(vehicle.id,true)).deletedAt);
});
test('delete and restore roll back home, state and idempotency when audit fails; concurrent edits do not bypass deletion',async()=>{
  const vehicle=await publish(await ready());const actor={id:editorId,requestId:randomUUID()};let home=await runtime.inventory.getHome();home.sections[0]!.vehicleIds=[vehicle.id];home=await runtime.inventory.saveHome(home,actor);
  await runtime.db.pool.query(`CREATE FUNCTION reject_recycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.vehicle_id='${vehicle.id}' AND NEW.operation IN ('vehicle.delete','vehicle.restore') THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_recycle_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_recycle_audit()`);
  try {
    await assert.rejects(runtime.inventory.remove(vehicle.id,vehicle.version,actor,randomUUID()));
    assert.equal((await runtime.inventory.getAdmin(vehicle.id)).version,vehicle.version);assert.deepEqual(await runtime.inventory.getHome(),home);
  } finally {await runtime.db.pool.query('DROP TRIGGER reject_recycle_audit ON audit_events; DROP FUNCTION reject_recycle_audit()');}
  const race=await Promise.allSettled([runtime.inventory.remove(vehicle.id,vehicle.version,actor,randomUUID()),runtime.inventory.save(vehicle.id,vehicle.version,vehicle.draft,actor)]);
  assert.equal(race.filter(item=>item.status==='fulfilled').length,1);
  const current=await runtime.inventory.getAdmin(vehicle.id,true);const removed=current.deletedAt?current:await runtime.inventory.remove(current.id,current.version,actor,randomUUID());
  await runtime.db.pool.query(`CREATE FUNCTION reject_restore_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.vehicle_id='${vehicle.id}' AND NEW.operation='vehicle.restore' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_restore_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_restore_audit()`);
  try {await assert.rejects(runtime.inventory.restore(vehicle.id,removed.version,actor,randomUUID()));assert.deepEqual(await runtime.inventory.getAdmin(vehicle.id,true),removed);}
  finally {await runtime.db.pool.query('DROP TRIGGER reject_restore_audit ON audit_events; DROP FUNCTION reject_restore_audit()');}
});
test('legacy idempotent receipts survive added deletion fields without resurrecting deleted records',async()=>{
  const key=randomUUID(),value=draft();const request:InjectOptions={method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':key},payload:{draft:value}};
  const first=await call(request);assert.equal(first.statusCode,201,first.body);const vehicle:AdminVehicle=first.json().data;
  await runtime.db.pool.query("UPDATE idempotency_keys SET response=response-'deletedAt'-'hasUnpublishedChanges' WHERE actor_id=$1 AND operation='vehicle.create' AND key=$2",[editorId,key]);
  const removed=await runtime.inventory.remove(vehicle.id,vehicle.version,{id:editorId,requestId:randomUUID()},randomUUID());
  const replay=await call(request);assert.equal(replay.statusCode,201,replay.body);assert.equal(replay.json().data.deletedAt,null);assert.equal(replay.json().data.hasUnpublishedChanges,null);assert.equal(replay.json().data.version,1);
  assert.equal((await runtime.inventory.getAdmin(vehicle.id,true)).version,removed.version);await assert.rejects(runtime.inventory.getAdmin(vehicle.id));
});
test('staff external listing keeps reference facts and machine provenance after internal review and immutable publication',async()=>{
  const input=makeExternalVehicleDraftFixture();input.media=[];if(input.source.kind!=='external') throw new Error('external fixture required');
  input.facts.trim={id:'external_fixture_trim',name:'Synthetic external configuration'};input.internal.purchaseCost={amount:'18000',currency:'USD'};
  for(const field of Object.values(input.content))for(const language of ['zh','en','ru'] as const)field.translations[language]!.reviewStatus='approved';
  input.source.externalId=randomUUID();input.source.listingUrl='https://listing.example.invalid/item/'+input.source.externalId;input.facts.make={id:`external_${randomBytes(4).toString('hex')}`,name:'External listing fixture'};
  let vehicle=await create(input);assert.equal(vehicle.availability,'unknown');assert.equal(vehicle.availabilityCheckedAt,null);
  const photo=await upload(vehicle,{listingUrl:input.source.listingUrl,imageUrl:'https://images.example.invalid/original.png',collectedAt:input.source.collectedAt});
  vehicle.draft.media=[{id:photo.id,sortOrder:0,isCover:true,alt:'Observed source photo'}];vehicle=await publish(await save(vehicle));
  for(const locale of ['zh','en','ru']) {
    const response=await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=${locale}`});assert.equal(response.statusCode,200,response.body);
    const published=PublicVehicleResponseSchema.parse(response.json()).data;assert.equal(published.source.kind,'external');assert.equal(published.price.kind,'reference');assert.equal(published.availability,'unknown');assert.equal(published.availabilityCheckedAt,null);assert.equal(published.content.title.reviewed,false);assert.equal(published.content.description?.reviewed,false);assert.equal(published.content.title.kind,locale==='zh'?'original':'machine');assert.equal(published.fetchedAt,input.source.collectedAt);assert.deepEqual(published.facts,vehicle.draft.facts);
    assert.ok(!response.body.includes('externalId'));assert.ok(!response.body.includes('original.png'));assert.ok(!response.body.includes('supplierContact'));assert.ok(!response.body.includes('engineVersion'));
    const catalog=await call({method:'GET',url:`/api/v1/vehicles?locale=${locale}&make=${input.facts.make.id}`});assert.equal(catalog.json().meta.total,1);assert.equal(catalog.json().data.items[0].id,vehicle.id);
    assert.equal((await call({method:'GET',url:`/api/v1/vehicle-filters?locale=${locale}`})).json().data.makes.find((item:{id:string})=>item.id===input.facts.make!.id).count,1);
  }
  const home=await runtime.inventory.getHome();home.sections[0]!.vehicleIds=[vehicle.id];await runtime.inventory.saveHome(home,{id:editorId,requestId:randomUUID()});assert.ok((await runtime.inventory.publicHome('en')).sections.some(s=>s.vehicles.some(v=>v.id===vehicle.id)));
  assert.equal((await call({method:'GET',url:`/api/v1/media/${photo.id}`})).statusCode,200);
  const thumbnail=await call({method:'GET',url:`/api/v1/media/${photo.id}?variant=thumb`});assert.equal(thumbnail.statusCode,200,thumbnail.body);assert.equal((await sharp(thumbnail.rawPayload).metadata()).format,'webp');
  for(const query of ['variant=large','width=240','variant=thumb&width=240']) assert.equal((await call({method:'GET',url:`/api/v1/media/${photo.id}?${query}`})).statusCode,400);
  const unavailable=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/availability`,headers:headers(),payload:{version:vehicle.version,availability:'available',checkedAt:new Date().toISOString()}});assert.equal(unavailable.statusCode,422);assert.equal(unavailable.json().error.code,'EXTERNAL_RESTRICTION');
  const bulk=await call({method:'POST',url:'/api/v1/admin/vehicles/bulk',headers:{...headers(),'idempotency-key':randomUUID()},payload:{operation:'availability',availability:'available',checkedAt:new Date().toISOString(),items:[{id:vehicle.id,expectedVersion:vehicle.version}]}});assert.equal(bulk.json().data.results[0].error.code,'EXTERNAL_RESTRICTION');
  const before=await runtime.inventory.getPublic(vehicle.id,'en');vehicle.draft.content.title.sourceText='Source title updated after publication';vehicle=await save(vehicle);
  assert.deepEqual(await runtime.inventory.getPublic(vehicle.id,'en'),before);assert.equal(vehicle.draft.content.title.translations.en!.reviewStatus,'stale');
  const stale=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});rejectedPublication(stale,'draft.content.title.translations.en');
  const archived=await runtime.inventory.archive(vehicle.id,vehicle.version,{id:editorId,requestId:randomUUID()});assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}`})).statusCode,404);assert.equal((await call({method:'GET',url:`/api/v1/media/${photo.id}`})).statusCode,404);assert.equal(archived.availability,'unknown');
});
test('external identity, source type, price and per-image evidence cannot be bypassed',async()=>{
  const value=makeExternalVehicleDraftFixture();value.media=[];if(value.source.kind!=='external') throw new Error('external fixture required');value.source.externalId=randomUUID();
  let vehicle=await create(value);const request=(draft:unknown)=>call({method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':randomUUID()},payload:{draft}});
  assert.equal((await request(value)).statusCode,409);assert.equal((await request(value)).json().error.code,'SOURCE_IDENTITY_CONFLICT');
  assert.equal((await request({...value,source:{kind:'external'}})).statusCode,400);
  assert.equal((await request({...value,price:{kind:'asking',money:{amount:'100',currency:'CNY'},includes:[]}})).statusCode,400);
  assert.equal((await request({...value,source:{...value.source,listingUrl:'https://user:password@example.invalid/vehicle'}})).statusCode,400);
  const changed=structuredClone(value);if(changed.source.kind!=='external') throw new Error('external fixture required');changed.source.externalId='changed';
  assert.equal((await call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:changed}})).statusCode,422);
  assert.equal((await call({method:'PATCH',url:`/api/v1/admin/vehicles/${vehicle.id}`,headers:headers(),payload:{version:vehicle.version,draft:{...value,source:{kind:'manual'}}}})).statusCode,422);
  const media=await upload(vehicle);vehicle.draft.media=[{id:media.id,sortOrder:0,isCover:true,alt:''}];vehicle=await save(vehicle);
  const missingEvidence=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});assert.equal(missingEvidence.statusCode,422);assert.ok(missingEvidence.json().error.fields.some((field:{path:string})=>field.path.startsWith('draft.media')));
  const wrongSourcePhoto=await upload(vehicle,{listingUrl:'https://other.example.invalid/listing',imageUrl:'https://other.example.invalid/image.png',collectedAt:value.source.collectedAt});vehicle.draft.media=[{id:wrongSourcePhoto.id,sortOrder:0,isCover:true,alt:''}];vehicle=await save(vehicle);
  rejectedPublication(await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}}),`draft.media.${wrongSourcePhoto.id}.rights`);
  await runtime.inventory.remove(vehicle.id,vehicle.version,{id:editorId,requestId:randomUUID()},randomUUID());assert.equal((await request(value)).statusCode,409);
  const other={...value,source:{...value.source,platform:{id:'different-platform',name:'Different isolated platform'}}};assert.equal((await request(other)).statusCode,201);
});
test('unverified image rights remain an external-only publishing exception',async()=>{
  for(let vehicle of [await ready(),await readyDemo()]) {
    const media=await upload(vehicle,{listingUrl:'https://source.example.invalid/vehicle',imageUrl:'https://source.example.invalid/image.png',collectedAt:new Date().toISOString()});
    vehicle.draft.media=[{id:media.id,sortOrder:0,isCover:true,alt:'Unverified local test image'}];vehicle=await save(vehicle);
    const rejected=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:vehicle.version}});
    rejectedPublication(rejected,`draft.media.${media.id}.rights`);
    assert.equal((await runtime.db.pool.query('SELECT 1 FROM vehicle_publications WHERE vehicle_id=$1',[vehicle.id])).rowCount,0);
  }
});
test('public keyword search uses only published current-language fields with exact pagination and filter totals',async()=>{
  const token=`search_${randomBytes(4).toString('hex')}`;const vehicles:AdminVehicle[]=[];
  for(let index=0;index<2;index++) {
    let vehicle=await ready();vehicle.draft.content.title.translations.en!.text=`${token} 100%_car ${index}`;vehicle.draft.internal.notes=`private_${token}`;
    vehicle=await publish(await save(vehicle));vehicles.push(vehicle);
  }
  const query=`locale=en&q=${encodeURIComponent(' '+token.toUpperCase()+' ')}&pageSize=1`;
  const first=(await call({method:'GET',url:'/api/v1/vehicles?'+query})).json();const second=(await call({method:'GET',url:'/api/v1/vehicles?'+query+'&page=2'})).json();
  assert.equal(first.meta.total,2);assert.equal(first.meta.accessibleTotal,2);assert.equal(first.data.items.length,1);assert.equal(first.data.hasMore,true);assert.equal(second.data.hasMore,false);assert.notEqual(first.data.items[0].id,second.data.items[0].id);
  const filters=(await call({method:'GET',url:`/api/v1/vehicle-filters?locale=en&q=${token}`})).json().data;assert.equal(filters.makes.reduce((total:number,item:{count:number})=>total+item.count,0),2);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles?locale=zh&q=${token}`})).json().meta.total,0);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles?locale=en&q=private_${token}`})).json().meta.total,0);
  assert.equal((await call({method:'GET',url:'/api/v1/vehicles?locale=en&q='+encodeURIComponent('100%_car')})).json().meta.total,2);
  assert.equal((await call({method:'GET',url:'/api/v1/vehicles?locale=en&q='+encodeURIComponent('100X_car')})).json().meta.total,0);
  const vehicle=vehicles[0]!;vehicle.draft.content.title.translations.en!.text=`draft_${token}`;await save(vehicle);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles?locale=en&q=draft_${token}`})).json().meta.total,0);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles?locale=en&q=${vehicle.stockCode.toLowerCase()}`})).json().data.items[0].id,vehicle.id);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles?locale=en&q=${token}&make=not-a-real-brand`})).json().meta.total,0);
  for(const url of ['/api/v1/vehicles?q='+('x'.repeat(101)),'/api/v1/vehicles?q=%00','/api/v1/vehicle-filters?q=%00']) assert.equal((await call({method:'GET',url})).statusCode,400);
});
async function localization(id:string):Promise<VehicleLocalization>{
  const response=await call({method:'GET',url:`/api/v1/admin/vehicles/${id}/localization`,headers:headers()});
  assert.equal(response.statusCode,200,response.body);return VehicleLocalizationSchema.parse(response.json().data);
}
async function saveLocalization(value:VehicleLocalization,pathId=value.vehicleId):Promise<VehicleLocalization>{
  const response=await call({method:'PUT',url:`/api/v1/admin/vehicles/${pathId}/localization`,headers:headers(),payload:{vehicleVersion:value.vehicleVersion,revision:value.revision,data:value.data}});
  assert.equal(response.statusCode,200,response.body);return VehicleLocalizationSchema.parse(response.json().data);
}
async function reviewDisplay(id:string,extra=false){
  let local=await localization(id);
  if(extra){local.data.facts={generation:{id:'gen_test',name:'Generation One'},drivetrain:'awd'};local=await saveLocalization(local);}
  for(const field of local.data.fields)field.sourceLanguage=/\p{Script=Han}/u.test(field.sourceText)?'zh':'en';
  local=await saveLocalization(local);
  for(const field of local.data.fields)for(const locale of ['zh','en','ru'] as const){
    field.translations[locale]={text:locale===field.sourceLanguage?field.sourceText:`${locale} reviewed ${field.ref}`,kind:locale===field.sourceLanguage?'original':'human',reviewStatus:'approved',sourceVersion:field.sourceVersion,humanEditVersion:field.translations[locale]?.humanEditVersion??0,engineVersion:null};
  }
  return saveLocalization(local);
}
async function freshVehicle(id:string):Promise<AdminVehicle>{const r=await call({method:'GET',url:`/api/v1/admin/vehicles/${id}`,headers:headers()});assert.equal(r.statusCode,200,r.body);return r.json().data;}

test('localized sidecars may be incomplete in drafts but are required, private and immutable on new publication',async()=>{
  let vehicle=await ready();vehicle.draft.facts.make={id:'manual_toyota_localized',name:'丰田'};vehicle.draft.facts.model={id:'localized_model',name:'车型甲'};vehicle=await save(vehicle);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=en`})).statusCode,404);
  const preview=await call({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}/publication-preview?locale=en`,headers:headers()});assert.equal(preview.statusCode,200,preview.body);
  assert.equal(preview.json().data.vehicle.display.make.text,'Toyota');assert.equal(preview.json().data.vehicle.display.model.reviewStatus,'missing');assert.equal(preview.json().data.vehicle.facts.generation,null);
  assert.equal((await call({method:'GET',url:`/api/v1/admin/vehicles/${vehicle.id}/localization`})).statusCode,401);
  let local=await localization(vehicle.id);assert.equal(local.revision,0);
  // First PUT via upper-case UUID must use the same deterministic includes refs.
  local=await saveLocalization(local,vehicle.id.toUpperCase());
  const premature=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:local.vehicleVersion}});rejectedPublication(premature,'localization.model.en');
  local=await reviewDisplay(vehicle.id,true);vehicle=await freshVehicle(vehicle.id);assert.equal(vehicle.hasUnpublishedChanges,true);
  vehicle=await publish(vehicle);assert.equal(vehicle.hasUnpublishedChanges,false);
  const legacy=await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=en`});assert.equal(legacy.statusCode,200,legacy.body);
  assert.equal('display' in legacy.json().data,false);assert.equal('generation' in legacy.json().data.facts,false);
  const read=await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=en&view=localized`});assert.equal(read.statusCode,200,read.body);
  assert.equal(read.json().data.facts.model.name,'en reviewed model');assert.equal(read.json().data.facts.generation.id,'gen_test');assert.equal(read.json().data.facts.drivetrain,'awd');
  for(const secret of ['sourceHash','engineVersion','internal','sourceText','humanEditVersion'])assert.equal(read.body.includes(`"${secret}"`),false,secret);
  const priorPublication=vehicle.publishedRevisionId;
  local=await localization(vehicle.id);local.data.fields.find(field=>field.ref==='model')!.translations.en!.text='Human revised model';local=await saveLocalization(local);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=en&view=localized`})).json().data.facts.model.name,'en reviewed model');
  assert.equal((await freshVehicle(vehicle.id)).hasUnpublishedChanges,true);vehicle=await publish(await freshVehicle(vehicle.id));assert.notEqual(vehicle.publishedRevisionId,priorPublication);
  await assert.rejects(runtime.db.pool.query('UPDATE publication_localizations SET data=data WHERE publication_id=$1',[priorPublication]),/immutable/);
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=en&view=localized`})).json().data.facts.model.name,'Human revised model');
  const noOp=await publish(vehicle);assert.equal(noOp.version,vehicle.version);assert.equal(noOp.publishedRevisionId,vehicle.publishedRevisionId);
});

test('full-catalog ranges are inclusive, original-currency, model-year based and precede pagination/facets',async()=>{
  const makeId=`range_${randomUUID()}`;
  for(const spec of [
    {price:'0.00',currency:'USD',mileage:0,year:2020},
    {price:'100.00',currency:'USD',mileage:50,year:2024},
    {price:'100.00',currency:'CNY',mileage:50,year:2024},
    {price:null,currency:'USD',mileage:null,year:null},
  ] as const){
    let v=await ready();v.draft.facts.make={id:makeId,name:'Toyota'};v.draft.facts.model={id:'range_model',name:'范围车型'};v.draft.facts.trim={id:'trim_test',name:'配置甲'};
    v.draft.facts.mileageKm=spec.mileage;v.draft.facts.modelYear=spec.year;v.draft.facts.manufacturedAt={precision:'year',value:'1999'};
    v.draft.price=spec.price===null?{kind:'on_request',money:null,includes:[]}:{kind:'asking',money:{amount:spec.price,currency:spec.currency},includes:[]};
    v=await save(v);
    if(spec.price===null||spec.price==='0.00') {
      // Existing zero/unknown values must remain queryable; new staff publication now rejects them.
      const blocked=await call({method:'POST',url:`/api/v1/admin/vehicles/${v.id}/publish`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{version:v.version}});
      assert.equal(blocked.statusCode,422,blocked.body);assert.ok(blocked.json().error.fields.some((field:{path:string})=>field.path==='draft.price'));
      await seedHistoricalPublication(v);
    } else {if(spec.currency==='CNY')await reviewDisplay(v.id,true);await publish(await freshVehicle(v.id));}
  }
  const query=`locale=en&view=localized&make=${makeId}`;
  const list=async(extra:string)=>{const r=await call({method:'GET',url:`/api/v1/vehicles?${query}${extra}`});assert.equal(r.statusCode,200,r.body);return r.json();};
  assert.equal((await list('&pageSize=1')).meta.total,4);assert.equal((await list('&pageSize=1')).data.hasMore,true);
  assert.equal((await list('&priceCurrency=USD')).meta.total,4);
  assert.equal((await list('&priceCurrency=USD&priceMin=0&priceMax=100')).meta.total,2);
  assert.equal((await list('&priceCurrency=CNY&priceMin=100&priceMax=100.00')).meta.total,1);
  assert.equal((await list('&mileageMin=0&mileageMax=0')).meta.total,1);
  assert.equal((await list('&yearMin=2024&yearMax=2024')).meta.total,2);
  assert.equal((await list('&yearMin=1999&yearMax=1999')).meta.total,0);
  assert.equal((await list('&model=range_model&trim=trim_test&generation=gen_test&drivetrain=awd')).meta.total,1);
  const facet=await call({method:'GET',url:`/api/v1/vehicle-filters?${query}&yearMin=2024&yearMax=2024`});assert.equal(facet.statusCode,200,facet.body);
  assert.deepEqual(facet.json().data.modelYears,[{year:2024,count:2}]);assert.equal(facet.json().data.trims[0].count,2);assert.equal(facet.json().data.generations[0].count,1);
  assert.deepEqual(facet.json().data.priceCurrencies,[{id:'CNY',count:1},{id:'USD',count:1}]);
  for(const extra of ['&priceMin=abc&priceMax=20&priceCurrency=USD','&mileageMin=1e3','&mileageMin=3&mileageMax=2','&yearMin=2025&yearMax=2024','&priceMin=1']){
    const r=await call({method:'GET',url:`/api/v1/vehicles?${query}${extra}`});assert.equal(r.statusCode,400,r.body);
  }
});

test('localized q, facets, detail and home use the same publication projection while legacy stays raw',async()=>{
  let vehicle=await ready();vehicle.draft.facts.make={id:`manual_${randomUUID()}`,name:'　丰田　'};vehicle.draft.facts.model={id:'model_search_i18n',name:'原车型词'};
  vehicle=await publish(await save(vehicle));
  const before=await call({method:'GET',url:`/api/v1/vehicles?locale=en&view=localized&make=${vehicle.draft.facts.make!.id}&q=Toyota`});assert.equal(before.statusCode,200,before.body);assert.equal(before.json().meta.total,1);
  const hidden=await call({method:'GET',url:`/api/v1/vehicles?locale=en&view=localized&make=${vehicle.draft.facts.make!.id}&q=${encodeURIComponent('原车型词')}`});assert.equal(hidden.json().meta.total,0);
  await reviewDisplay(vehicle.id);vehicle=await publish(await freshVehicle(vehicle.id));
  const local=await call({method:'GET',url:`/api/v1/vehicles?locale=en&view=localized&make=${vehicle.draft.facts.make!.id}&q=en%20reviewed%20model`});assert.equal(local.statusCode,200,local.body);assert.equal(local.json().meta.total,1);
  const facets=await call({method:'GET',url:`/api/v1/vehicle-filters?locale=en&view=localized&make=${vehicle.draft.facts.make!.id}&q=en%20reviewed%20model`});assert.equal(facets.json().data.models[0].name,'en reviewed model');assert.equal(facets.json().data.models[0].count,1);
  const home=(await runtime.inventory.getHome());home.sections[0]!.vehicleIds=[vehicle.id];home.sections[1]!.vehicleIds=[];
  await runtime.inventory.saveHome(home,{id:editorId,requestId:'localized-home-test'});
  const shown=await call({method:'GET',url:'/api/v1/home/vehicles?locale=en&view=localized'});assert.equal(shown.statusCode,200,shown.body);assert.equal(shown.json().data.sections[0].vehicles[0].facts.model.name,'en reviewed model');
  assert.equal((await call({method:'GET',url:`/api/v1/vehicles/${vehicle.id}?locale=en`})).json().data.facts.model.name,'原车型词');
  // The same legal Russian boundary must parse on all public surfaces; one extra unit is rejected on save.
  let limit=await localization(vehicle.id);limit.data.fields.find(field=>field.ref==='model')!.translations.ru!.text='Ж'.repeat(121);
  const tooLong=await call({method:'PUT',url:`/api/v1/admin/vehicles/${vehicle.id}/localization`,headers:headers(),payload:{vehicleVersion:limit.vehicleVersion,revision:limit.revision,data:limit.data}});assert.equal(tooLong.statusCode,400,tooLong.body);
  limit.data.fields.find(field=>field.ref==='model')!.translations.ru!.text='Ж'.repeat(120);await saveLocalization(limit);vehicle=await publish(await freshVehicle(vehicle.id));
  for(const url of [`/api/v1/vehicles/${vehicle.id}?locale=ru&view=localized`,`/api/v1/vehicles?locale=ru&view=localized&make=${vehicle.draft.facts.make!.id}`,'/api/v1/home/vehicles?locale=ru&view=localized',`/api/v1/vehicle-filters?locale=ru&view=localized&make=${vehicle.draft.facts.make!.id}`]){
    const result=await call({method:'GET',url});assert.equal(result.statusCode,200,result.body);assert.ok(result.body.includes('Ж'.repeat(120)));
  }
});

test('display suggestions never save drafts and reject concurrent source/human edits',async()=>{
  let vehicle=await ready();vehicle.draft.facts.model!.name='机器建议车型';vehicle=await save(vehicle);
  let local=await localization(vehicle.id);local.data.fields.find(field=>field.ref==='model')!.sourceLanguage='zh';local=await saveLocalization(local);
  const input={vehicleVersion:local.vehicleVersion,revision:local.revision,refs:['model']};const key=randomUUID();
  const generated=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/localization/translation-suggestions`,headers:{...headers(),'idempotency-key':key},payload:input});assert.equal(generated.statusCode,200,generated.body);
  assert.equal((await localization(vehicle.id)).data.fields.find(field=>field.ref==='model')!.translations.en,null);
  const received=generated.json().data.fields[0];assert.equal(received.translations.en.kind,'machine');assert.equal(received.translations.en.reviewStatus,'pending');assert.equal(received.translations.en.humanEditVersion,0);
  local.data.fields.find(field=>field.ref==='model')!.translations.en={text:'Human revision',kind:'human',reviewStatus:'approved',sourceVersion:local.data.fields.find(field=>field.ref==='model')!.sourceVersion,humanEditVersion:0,engineVersion:null};
  const latest=await saveLocalization(local);const old=await call({method:'PUT',url:`/api/v1/admin/vehicles/${vehicle.id}/localization`,headers:headers(),payload:{vehicleVersion:local.vehicleVersion,revision:local.revision,data:{...local.data,fields:local.data.fields.map(field=>field.ref==='model'?received:field)}}});assert.equal(old.statusCode,409,old.body);
  const replay=await call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/localization/translation-suggestions`,headers:{...headers(),'idempotency-key':key},payload:input});assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json().data,generated.json().data);
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  translationHook=async(text,target)=>{entered();await gate;return `${target} fresh ${text}`;};
  vehicle=await freshVehicle(vehicle.id);vehicle.draft.facts.model!.name='并发新车型';vehicle=await save(vehicle);local=await localization(vehicle.id);
  const running=call({method:'POST',url:`/api/v1/admin/vehicles/${vehicle.id}/localization/translation-suggestions`,headers:{...headers(),'idempotency-key':randomUUID()},payload:{vehicleVersion:local.vehicleVersion,revision:local.revision,refs:['model']}});
  await started;try{vehicle.draft.facts.model!.name='并发再修改';await save(vehicle);}finally{release();translationHook=null;}
  const conflict=await running;assert.equal(conflict.statusCode,409,conflict.body);assert.ok(latest.vehicleVersion>input.vehicleVersion);
});

test('new vehicle receipts remain readable by the old strict DTO and preserve immutable new metadata',async()=>{
  const key=randomUUID();const payload={draft:draft()};const request={method:'POST' as const,url:'/api/v1/admin/vehicles',headers:{...headers(),'idempotency-key':key},payload};
  const created=await call(request);assert.equal(created.statusCode,201,created.body);assert.equal(created.json().data.hasUnpublishedChanges,true);
  const stored=(await runtime.db.pool.query('SELECT response,expires_at,request_hash FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3',[editorId,'vehicle.create',key])).rows[0];
  assert.equal('hasUnpublishedChanges' in stored.response,false);
  // The prior DTO is precisely the current base object without the optional/defaulted addition.
  const {AdminVehicleSchema}=await import('@hd/contracts/admin');const oldSchema=AdminVehicleSchema.omit({hasUnpublishedChanges:true});assert.deepEqual(oldSchema.parse(stored.response),stored.response);
  const v=created.json().data as AdminVehicle;v.draft.internal.notes='Edited after receipt';await save(v);
  const replay=await call(request);assert.equal(replay.statusCode,201,replay.body);assert.deepEqual(replay.json().data,created.json().data);
  assert.deepEqual((await runtime.db.pool.query('SELECT response,expires_at,request_hash FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3',[editorId,'vehicle.create',key])).rows[0],stored);
});

test('changing a staff login preserves identity and role, rotates credentials and revokes sessions',async()=>{
  const login = (email: string, secret: string) => call({
    method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email,password:secret},
  });
  const previous = await login('admin@example.invalid', password);
  assert.equal(previous.statusCode,200);
  const oldCookie = previous.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const before = await call({method:'GET',url:'/api/v1/admin/me',headers:{cookie:oldCookie,origin}});
  assert.equal(before.statusCode,200);
  const replacement = 'Synthetic_replacement_472!';
  await assert.rejects(changeStaffLogin(runtime.db,'admin@example.invalid','editor@example.invalid',replacement));
  assert.equal((await call({method:'GET',url:'/api/v1/admin/me',headers:{cookie:oldCookie,origin}})).statusCode,200);
  await changeStaffLogin(runtime.db,'admin@example.invalid','test-admin',replacement);
  assert.equal((await login('admin@example.invalid',password)).statusCode,401);
  assert.equal((await login('test-admin@staff.hd-auto.invalid',password)).statusCode,401);
  assert.equal((await call({method:'GET',url:'/api/v1/admin/me',headers:{cookie:oldCookie,origin}})).statusCode,401);
  const current = await login('test-admin@staff.hd-auto.invalid',replacement);
  assert.equal(current.statusCode,200);
  const me = await call({method:'GET',url:'/api/v1/admin/me',headers:{cookie:current.cookies.map(c => `${c.name}=${c.value}`).join('; '),origin}});
  assert.equal(me.statusCode,200);
  assert.equal(me.json().data.id,before.json().data.id);
  assert.equal(me.json().data.role,'admin');
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
