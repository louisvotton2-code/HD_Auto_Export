import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import Fastify from 'fastify';
import {validatorCompiler,serializerCompiler} from 'fastify-type-provider-zod';
import {makeImportedPublicVehicleFixture,makeExternalCandidateFixture,makeVehicleDraftFixture,makePublicVehicleFixture} from '@hd/contracts/fixtures';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {createDatabase} from '../src/db/index.js';
import {seoManifest,vehicleSeo,refreshSeoSelection} from '../src/seo/service.js';
import {registerSeoRoutes} from '../src/seo/routes.js';
import {emptyLocalization} from '../src/vehicles/localization.js';
import {InventoryService} from '../src/vehicles/service.js';
import {PublicSeoManifestResponseSchema} from '@hd/contracts/public';

const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['postgres:','postgresql:'].includes(address.protocol)||address.hostname!=='127.0.0.1'||address.pathname!=='/postgres'||address.search||address.hash)throw new Error('SEO tests require local maintenance DB without options.');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('SEO shares current eligibility across detail and manifest, with a hard cross-language external cap',async t=>{
 const name=`hd_api_test_seo_${randomBytes(8).toString('hex')}`,url=new URL(address);url.pathname=`/${name}`;
 const maintenance=createDatabase(address.href,1),db=createDatabase(url.href,3);let created=false;
 const now=new Date(),later=new Date(now.getTime()+60_000);
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('SEO cannot contact providers.');});
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;
  const journal=JSON.parse(await readFile(new URL('../migrations/meta/_journal.json',import.meta.url),'utf8'));
  // SEO is isolated from the concurrently implemented analytics/sync migrations.
  for(const entry of journal.entries.filter((e:{idx:number})=>e.idx<=37))await db.pool.query(await readFile(new URL(`../migrations/${entry.tag}.sql`,import.meta.url),'utf8'));
  await db.pool.query(await readFile(new URL('../migrations/0040_seo_selection.sql',import.meta.url),'utf8'));
  await db.pool.query(await readFile(new URL('../migrations/0043_vehicle_pixel.sql',import.meta.url),'utf8'));
  const sample=makeImportedPublicVehicleFixture('en','supplier',true),candidate=makeExternalCandidateFixture();
  const localized=Object.fromEntries(['zh','en','ru'].map(locale=>[locale,{title:{...sample.content.title,text:'Synthetic vehicle title',requestedLocale:locale,contentLocale:locale},
   description:{...sample.content.title,text:'A complete synthetic description for this vehicle.',requestedLocale:locale,contentLocale:locale},
   display:{...sample.display,make:{...sample.display!.make,contentLocale:locale},model:{...sample.display!.model,contentLocale:locale}}}]));
  await db.transaction(async tx=>{
   await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-feed','synthetic-market',n::text,1,repeat('a',64),$1,'active',$2,$2 FROM generate_series(1,1001)n`,[candidate,now]);
   await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
    SELECT id,$1,'Synthetic Market','https://listings.example.invalid/seo', $2,100,'[]',$3,$4 FROM external_listings`,
    [now,candidate.facts,localized,{original:{title:null,model:null,description:null},specifications:[],inspection:null,relatedListingUrls:[]}]);
   await tx.query(`INSERT INTO external_media(id,listing_id,source_media_id,url,position,active,refreshed_at,expires_at)
    SELECT gen_random_uuid(),id,'main','https://photos.example.invalid/seo.webp',0,true,$1,$2 FROM external_listings`,[now,later]);
  });
  await t.test('disabled reads do not query selection; refresh is atomic, idempotent and capped at 1000 identities',async()=>{
   assert.deepEqual(await seoManifest(db,{limit:500},false),{enabled:false,validUntil:null,revision:'disabled',items:[],nextCursor:null});
   assert.deepEqual(await refreshSeoSelection(db,now),{selected:1000,scanned:1000,changed:true});
   assert.deepEqual(await refreshSeoSelection(db,now),{selected:1000,scanned:1000,changed:false});
   await assert.rejects(db.pool.query('INSERT INTO seo_external_selection(listing_id,slot) VALUES($1,1001)',[id(1001)]),{code:'23514'});
   assert.equal((await vehicleSeo(db.pool,`ext-${id(1001)}`,'en',true,now)).indexable,false);
  });
  await t.test('all three languages share one identity selection, and actual detail returns the same qualification',async()=>{
   const first=await seoManifest(db,{limit:500},true,now);assert.equal(first.items.length,500);assert.ok(first.nextCursor);assert.equal(first.validUntil,later.toISOString());
   const second=await seoManifest(db,{limit:500,cursor:first.nextCursor!},true,now);assert.equal(second.items.length,500);assert.equal(second.nextCursor,null);
   assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,1000);assert.deepEqual(first.items[0]!.locales,['zh','en','ru']);
   const seo=await vehicleSeo(db.pool,first.items[0]!.id,'en',true,now);assert.equal(seo.indexable,true);assert.deepEqual(seo.locales,first.items[0]!.locales);
   const inventory=new InventoryService(db,true,undefined,true);
   const detail=await inventory.getPublic(first.items[0]!.id,'en','localized',undefined,'detail-inline-v1',undefined,undefined,undefined,'eligible');
   assert.deepEqual(detail.seo,seo);
   assert.equal((await inventory.getPublic(first.items[0]!.id,'en','localized')).seo,undefined);
  });
  await t.test('SEO requires inline opt-in and cannot leak through the warm public and SSR detail caches',async t=>{
   const secret=randomBytes(32).toString('hex');
   const environment={NODE_ENV:'test',DATABASE_URL:url.href,AUTH_SECRET:secret,HD_DEPLOYMENT_ENV:'test',HD_RELEASE_ID:'a'.repeat(40),
    CATALOG_READ_MODE:'combined',PUBLIC_CATALOG_CACHE:'memory'};
   const build=(enabled:boolean)=>buildApp({...readConfig(enabled?{...environment,PUBLIC_SEO_ENABLED:'true'}:environment),
    ssrService:{secret,peers:['127.0.0.1/32']}});
   const {app,inventory}=await build(true);
   t.after(()=>app.close());
   const load=t.mock.method(inventory,'getPublic');
   const path=`/vehicles/ext-${id(1)}`;
   const localized='?locale=en&view=localized';
   const combined=`${localized}&projection=detail-inline-v1&technicalView=verified&titleView=english&priceView=usd&pixelView=eligible`;
   const optedIn=`${combined}&seoView=eligible`;
   const read=async(query:string,internal=false)=>{
    const prefix=internal?'/internal/public-catalog':'/api/v1';
    const reply=await app.inject({url:`${prefix}${path}${query}`,remoteAddress:'127.0.0.1',headers:internal?{'x-hd-ssr-key':secret}:undefined});
    assert.equal(reply.statusCode,200,reply.body);
    return reply.json().data;
   };
   for(const query of [`${localized}&seoView=eligible`,`${combined}&seoView=invalid`,
    '?locale=en&view=legacy&projection=detail-inline-v1&seoView=eligible']) {
    assert.equal((await app.inject(`/api/v1${path}${query}`)).statusCode,400);
   }
   assert.equal((await read(localized)).seo,undefined);
   assert.equal((await read(`${localized}&projection=detail-inline-v1`)).seo,undefined);
   const pixelOnly=await read(combined);
   assert.equal(pixelOnly.pixelEnabled,false);
   assert.equal(pixelOnly.seo,undefined);
   const both=await read(optedIn,true);
   assert.equal(both.pixelEnabled,false);
   assert.deepEqual(both.seo,await vehicleSeo(db.pool,`ext-${id(1)}`,'en',true,now));
   assert.deepEqual(await read(optedIn),both);
   assert.deepEqual(await read(combined,true),pixelOnly);
   assert.equal(load.mock.callCount(),4);

   const disabled=await build(false);
   t.after(()=>disabled.app.close());
   const reply=await disabled.app.inject(`/api/v1${path}${optedIn}`);
   assert.equal(reply.statusCode,200,reply.body);
   assert.deepEqual(reply.json().data,pixelOnly);
  });
  await t.test('language quality, withdrawal, expiry, price changes and stale generation cursors invalidate immediately',async()=>{
   const first=await seoManifest(db,{limit:500},true,now),cursor=first.nextCursor!;
   await db.pool.query('UPDATE external_catalog SET price_cny=200 WHERE listing_id=$1',[id(1001)]);
   assert.equal((await seoManifest(db,{limit:500,cursor},true,now)).revision,first.revision);
   await assert.rejects(seoManifest(db,{limit:500,cursor},true,later),{status:409});
   const wrong=structuredClone(localized);wrong.ru!.description.contentLocale='zh';
   await db.pool.query('UPDATE external_catalog SET localized=$2 WHERE listing_id=$1',[id(1),wrong]);
   assert.deepEqual((await vehicleSeo(db.pool,`ext-${id(1)}`,'ru',true,now)).locales,['zh','en']);
   assert.equal((await vehicleSeo(db.pool,`ext-${id(1)}`,'ru',true,now)).indexable,false);
   await assert.rejects(seoManifest(db,{limit:500,cursor},true,now),{status:409});
   await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id(2)]);
   assert.equal((await vehicleSeo(db.pool,`ext-${id(2)}`,'en',true,now)).indexable,false);
   await db.pool.query('UPDATE external_catalog SET price_cny=NULL WHERE listing_id=$1',[id(3)]);
   assert.equal((await vehicleSeo(db.pool,`ext-${id(3)}`,'en',true,now)).indexable,false);
   assert.equal((await vehicleSeo(db.pool,`ext-${id(4)}`,'en',true,later)).indexable,false);
   const page=await seoManifest(db,{limit:500},true,now);assert.deepEqual(page.items.find(v=>v.id===`ext-${id(1)}`)!.locales,['zh','en']);
   assert.equal(page.items.some(v=>v.id===`ext-${id(2)}`||v.id===`ext-${id(3)}`),false);
   assert.equal((await seoManifest(db,{limit:500},true,later)).items.length,0);
  });
  await t.test('selected source and staff visibility invalidate detail revision before projection repair',async()=>{
   const revision=async()=>(await db.pool.query('SELECT revision::text FROM public_catalog_state WHERE id=1')).rows[0].revision;
   let before=await revision();
   await db.pool.query('UPDATE external_listings SET formal_primary=false WHERE id=$1',[id(4)]);
   assert.notEqual(await revision(),before);assert.equal((await vehicleSeo(db.pool,`ext-${id(4)}`,'en',true,now)).indexable,false);
   before=await revision();await db.pool.query('UPDATE external_listings SET formal_primary=false WHERE id=$1',[id(4)]);assert.equal(await revision(),before);
   await db.pool.query('UPDATE external_listings SET formal_primary=true WHERE id=$1',[id(4)]);
   before=await revision();await db.pool.query('INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,$2)',[id(4),{hidden:true}]);
   assert.notEqual(await revision(),before);assert.equal((await vehicleSeo(db.pool,`ext-${id(4)}`,'en',true,now)).indexable,false);
   before=await revision();await db.pool.query('UPDATE external_listing_overrides SET data=$2 WHERE listing_id=$1',[id(4),{hidden:true,privateNote:'synthetic'}]);assert.equal(await revision(),before);
   await db.pool.query('DELETE FROM external_listing_overrides WHERE listing_id=$1',[id(4)]);assert.notEqual(await revision(),before);
   assert.equal((await vehicleSeo(db.pool,`ext-${id(4)}`,'en',true,now)).indexable,true);
  });
  await t.test('manifest lock contention is cancelled by its dedicated statement deadline',async()=>{
   const blocker=await db.pool.connect();
   try{
    await blocker.query('BEGIN');await blocker.query('LOCK external_catalog IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(seoManifest(db,{limit:500},true,now),{code:'57014'});
   }finally{await blocker.query('ROLLBACK');blocker.release();}
   assert.ok((await seoManifest(db,{limit:500},true,now)).items.length>0);
  });
  await t.test('manual publications share the policy and never index draft, sold, demo or external staff copies',async()=>{
   const draft=makeVehicleDraftFixture(),vehicle=randomUUID(),publication=randomUUID(),media=randomUUID();
   for(const field of Object.values(draft.content))for(const locale of ['zh','en','ru']as const)field.translations[locale]!.text='A complete synthetic description for this vehicle.';
   const snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images:makePublicVehicleFixture().images};
   const display=Object.fromEntries(['zh','en','ru'].map(locale=>[locale,{display:localized[locale]!.display}]));
   await db.transaction(async tx=>{
    await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at)VALUES($1,'available',$2)",[vehicle,now]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data)VALUES($1,$2,$3)',[publication,vehicle,snapshot]);
    await tx.query("INSERT INTO media_assets(id,vehicle_id,state,content_type,expected_size,expires_at,rights)VALUES($1,$2,'ready','image/webp',1,$3,'{}')",[media,vehicle,later]);
    await tx.query('INSERT INTO publication_media(publication_id,media_id)VALUES($1,$2)',[publication,media]);
    await tx.query("INSERT INTO publication_localizations(publication_id,data,bindings,projections)VALUES($1,$2,'{}',$3)",[publication,emptyLocalization().data,display]);
    await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=$3 WHERE id=$1",[vehicle,publication,now]);
   });
   const seo=await vehicleSeo(db.pool,vehicle,'en',true,now);
   assert.equal(seo.indexable,true);
   const inventory=new InventoryService(db,true,undefined,true);
   assert.equal((await inventory.getPublic(vehicle,'en','localized',undefined,'detail-inline-v1')).seo,undefined);
   assert.deepEqual((await inventory.getPublic(vehicle,'en','localized',undefined,'detail-inline-v1',undefined,undefined,undefined,'eligible')).seo,seo);
   let page=await seoManifest(db,{limit:500},true,now),found=page.items.some(v=>v.id===vehicle);
   while(!found&&page.nextCursor){page=await seoManifest(db,{limit:500,cursor:page.nextCursor},true,now);found=page.items.some(v=>v.id===vehicle);}
   assert.ok(found);
   await db.pool.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[vehicle]);
   assert.equal((await vehicleSeo(db.pool,vehicle,'en',true,now)).indexable,false);
   for(const kind of ['demo','external']){
    const v=randomUUID(),p=randomUUID();await db.pool.query('INSERT INTO vehicles(id)VALUES($1)',[v]);
    await db.pool.query('INSERT INTO vehicle_publications(id,vehicle_id,data)VALUES($1,$2,$3)',[p,v,{...snapshot,source:{kind}}]);
    await db.pool.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=$3 WHERE id=$1",[v,p,now]);
    assert.equal((await vehicleSeo(db.pool,v,'en',true,now)).indexable,false);
   }
  });
  await t.test('manifest HTTP route is no-store, rejects overlimits and turns dependency failure into 503',async()=>{
   const runtime=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:url.href,AUTH_SECRET:randomBytes(32).toString('hex'),PUBLIC_SEO_ENABLED:'true'}));const app=runtime.app;
   try{const response=await app.inject('/api/v1/seo/vehicles?limit=10');assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');const manifest=PublicSeoManifestResponseSchema.parse(response.json());assert.equal(manifest.data.items.some(v=>v.id.startsWith('ext-')),false);
    assert.equal((await app.inject('/api/v1/seo/vehicles?limit=501')).statusCode,400);
   }finally{await app.close();}
   const broken=Fastify();broken.setValidatorCompiler(validatorCompiler);broken.setSerializerCompiler(serializerCompiler);
   // Minimal adapter preserves the actual ApiError status; production app's handler additionally serializes its public envelope.
   broken.setErrorHandler((error,_request,reply)=>reply.status((error as {status?:number}).status??500).send({error:{code:'SERVICE_UNAVAILABLE',message:'Unavailable',retryable:true},meta:{requestId:'test'}}));
   registerSeoRoutes(broken,{transaction:async()=>{throw new Error('Private DB failure');}} as unknown as typeof db,true);
   try{const response=await broken.inject('/api/v1/seo/vehicles');assert.equal(response.statusCode,503,response.body);assert.ok(!response.body.includes('Private DB'));}finally{await broken.close();}
  });
  await t.test('failed selection replacement preserves the previous complete selection and revision',async()=>{
   const before=(await db.pool.query('SELECT listing_id,slot FROM seo_external_selection ORDER BY slot')).rows;
   const revision=(await db.pool.query('SELECT revision::text FROM public_catalog_state WHERE id=1')).rows[0].revision;
   await db.pool.query(`CREATE FUNCTION reject_seo_replacement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic selection interruption'; END $$;
    CREATE TRIGGER reject_seo_replacement BEFORE INSERT ON seo_external_selection FOR EACH STATEMENT EXECUTE FUNCTION reject_seo_replacement()`);
   try{await assert.rejects(refreshSeoSelection(db,now));
    assert.deepEqual((await db.pool.query('SELECT listing_id,slot FROM seo_external_selection ORDER BY slot')).rows,before);
    assert.equal((await db.pool.query('SELECT revision::text FROM public_catalog_state WHERE id=1')).rows[0].revision,revision);
   }finally{await db.pool.query('DROP TRIGGER reject_seo_replacement ON seo_external_selection; DROP FUNCTION reject_seo_replacement()');}
  });
  assert.equal(fetch.mock.callCount(),0);
 }finally{fetch.mock.restore();await db.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.close();}
});
