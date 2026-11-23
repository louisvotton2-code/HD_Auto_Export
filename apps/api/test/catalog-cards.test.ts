import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import { vehicleConfigurationItemId } from '@hd/contracts/admin';
import { PublicVehicleCardListSchema, PublicVehicleQuerySchema, PublicFilterQuerySchema } from '@hd/contracts/public';
import { makeVehicleDraftFixture, makePublicVehicleFixture, makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { InventoryService } from '../src/vehicles/service.js';
import { emptyLocalization, projectDisplay, syncLocalization } from '../src/vehicles/localization.js';
import { buildProjection, emptyOverrides } from '../src/external/normalize.js';
import { PublicCatalogCache, readPublicCatalogRevision, type CatalogRevisionProof } from '../src/external/public-cache.js';

// Isolated read-model fixtures, not a shortcut through the publication API. Never use a business database.
const maintenanceUrl=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['postgres:','postgresql:'].includes(maintenanceUrl.protocol)||maintenanceUrl.hostname!=='127.0.0.1'||maintenanceUrl.pathname!=='/postgres'||maintenanceUrl.search||maintenanceUrl.hash)
  throw new Error('Card tests require local maintenance PostgreSQL without options.');
const name=`hd_ext_cards_${randomBytes(8).toString('hex')}`,url=new URL(maintenanceUrl);url.pathname=`/${name}`;
const maintenance=createDatabase(maintenanceUrl.toString(),1),db=createDatabase(url.toString(),3),service=new InventoryService(db,true);
const staff:string[]=[],external:string[]=[],covers=new Map<string,string>();let created=false;
const query=(extra:Record<string,unknown>={})=>PublicVehicleQuerySchema.parse({locale:'en',view:'localized',projection:'card',pageSize:48,...extra});
const filters=(extra:Record<string,unknown>={})=>PublicFilterQuerySchema.parse({locale:'en',view:'localized',...extra});
const ids=(result:Awaited<ReturnType<InventoryService['listPublic']>>)=>result.data.items.map(item=>item.id);
const cache=new PublicCatalogCache({namespace:'hd:isolated-cards'}, {readRevision:usd=>readPublicCatalogRevision(db,usd)});

before(async()=>{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;await migrateDatabase(db);
  for(let i=0;i<4;i++) {
    const id=randomUUID(),publication=randomUUID(),draft=makeVehicleDraftFixture();staff.push(id);
    draft.facts.mileageKm=[900,100,100,null][i]!;draft.facts.modelYear=[2024,2020,2020,null][i]!;
    draft.price=i===3?{kind:'on_request',money:null,includes:[]}:{kind:'asking',money:{amount:i===0?'900':'100',currency:'USD'},includes:[]};
    draft.content.description.sourceText='DESCRIPTION_MUST_NOT_LEAVE_SQL';
    const images=Array.from({length:20},(_,j)=>({...makePublicVehicleFixture().images[0]!,id:randomUUID(),sortOrder:j,isCover:j===7}));
    covers.set(id,images[7]!.id);
    const snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images,
      configuration:{version:1 as const,items:[{name:'CONFIGURATION_MUST_NOT_LEAVE_SQL',value:'not a card field'}]}};
    await db.transaction(async tx=>{
      await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[id]);
      await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify(draft)]);
      await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,id,JSON.stringify(snapshot)]);
      if(i%2===0) {
        const projections=Object.fromEntries((['zh','en','ru'] as const).map(locale=>[locale,projectDisplay(id,snapshot,locale)]));
        await tx.query('INSERT INTO publication_localizations(publication_id,data,bindings,projections) VALUES($1,$2,$3,$4)',
          [publication,JSON.stringify(emptyLocalization().data),'{}',JSON.stringify(i===0?{policyVersion:2,...projections}:projections)]);
      }
      await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=$3 WHERE id=$1",[id,publication,`2026-01-01T00:00:00.00000${i+1}Z`]);
    });
  }
  for(let i=0;i<4;i++) {
    const id=randomUUID(),candidate=makeExternalCandidateFixture(i+10);external.push(id);
    candidate.facts.mileageKm=[9,1,1,null][i]!;candidate.facts.modelYear=[2025,2021,2021,null][i]!;
    candidate.price=i===3?null:{cny:i===0?'9':'1'};candidate.images=[];
    const p=buildProjection(candidate,emptyOverrides(),'Synthetic Market');
    await db.transaction(async tx=>{
      await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
        VALUES($1,'synthetic-feed','synthetic-market',$2,1,$3,$4,'active',now(),$5)`,[id,`card-${i}`,'a'.repeat(64),JSON.stringify(candidate),`2026-02-01T00:00:00.00000${i+1}Z`]);
      await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
        VALUES($1,$2,'Synthetic Market',$3,$4,$5,$6,$7,$8)`,[id,`2026-02-01T00:00:00.00000${i+1}Z`,candidate.listingUrl,JSON.stringify(p.facts),p.priceCny,JSON.stringify(p.issues),JSON.stringify(p.localized),JSON.stringify({...p.details,original:{...p.details.original,description:{text:'DETAIL_MUST_NOT_LEAVE_SQL',contentLocale:'en'}}})]);
      for(let j=0;j<20;j++) {
        const mediaId=randomUUID();if(j===1)covers.set(`ext-${id}`,`ximg-${mediaId}`);
        await tx.query(`INSERT INTO external_media(id,listing_id,source_media_id,url,position,active,refreshed_at,expires_at)
          VALUES($1,$2,$3,'https://photos.example.invalid/card.webp',$4,true,now(),$5)`,[mediaId,id,`media-${j}`,j,j===0?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z']);
      }
    });
  }
});
after(async()=>{await cache.close();await db.close();try{if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);}finally{await maintenance.close();}});

test('card database rows contain one live cover and no description, configuration, source document or report',async()=>{
  const returned:unknown[]=[];const statements:string[]=[];
  const observed={...db,transaction:async<T>(work:(tx:PoolClient)=>Promise<T>)=>db.transaction(async tx=>work({query:async(sql:string,values?:unknown[])=>{
    statements.push(sql);const result=await tx.query(sql,values);
    // The read-only transaction setup has two statements; pg returns one result per statement.
    for(const part of Array.isArray(result)?result:[result])returned.push(...part.rows);
    return result;
  }} as PoolClient))} as Database;
  const result=PublicVehicleCardListSchema.parse(await new InventoryService(observed,true).listPublic(query(),'card'));
  assert.equal(result.data.items.length,8);
  for(const item of result.data.items) {
    assert.equal(item.images.length,1);assert.equal(item.images[0]!.id,covers.get(item.id));
    assert.deepEqual(Object.keys(item.content),['title']);
    for(const field of ['external','configuration','configurationTotal','mediaTotal','report'])assert.equal(Object.hasOwn(item,field),false);
  }
  const encoded=JSON.stringify(returned);
  for(const marker of ['DESCRIPTION_MUST_NOT_LEAVE_SQL','CONFIGURATION_MUST_NOT_LEAVE_SQL','DETAIL_MUST_NOT_LEAVE_SQL','INTERNAL_FIXTURE_NOT_PUBLIC'])assert.equal(encoded.includes(marker),false,marker);
  const photos=returned.filter((row:any)=>row.listing_id&&row.url);assert.equal(photos.length,4,'SQL itself returns only one photo per external vehicle');
  const snapshots=returned.filter((row:any)=>row.publication_data) as Array<{publication_data:{images:unknown[];content:object}}>;
  assert.equal(snapshots.length,4);for(const row of snapshots){assert.equal(row.publication_data.images.length,1);assert.deepEqual(Object.keys(row.publication_data.content),['title']);}
  assert.equal(statements.some(sql=>sql.includes('external_source_segment_sets')),false);
});

test('a late offset proof checks supplier card media and current visibility by selected ID',async()=>{
  const id=external[0]!;
  let proof:CatalogRevisionProof|undefined;
  const initial=await service.listPublic(query(),'offset-proof',undefined,(_revision,verify)=>{proof=verify;});
  assert.ok(initial.data.items.some(item=>item.id===`ext-${id}`));
  assert.ok(proof);
  const check=()=>proof!(performance.now()+3000,new AbortController().signal);
  assert.ok(await check());
  try {
    await db.pool.query("UPDATE external_media SET active=false WHERE listing_id=$1 AND position=1",[id]);
    assert.equal(await check(),null);
    await db.pool.query("UPDATE external_media SET active=true WHERE listing_id=$1 AND position=1",[id]);
    assert.ok(await check());
    await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id]);
    assert.equal(await check(),null);
    assert.equal((await service.listPublic(query(),'latest')).data.items.some(item=>item.id===`ext-${id}`),false);
  } finally {
    await db.pool.query("UPDATE external_media SET active=true WHERE listing_id=$1 AND position=1",[id]);
    await db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[id]);
  }
});

test('every sort preserves the global staff group, deterministic ties and null tail across offset and cursor pages',async()=>{
  const tied=(values:string[])=>[values[1]!,values[2]!].sort();
  const expected={
    newest:[...staff].reverse().concat([...external].reverse().map(id=>`ext-${id}`)),
    price_asc:[...tied(staff),staff[0]!,staff[3]!,...tied(external).concat(external[0]!,external[3]!).map(id=>`ext-${id}`)],
    price_desc:[staff[0]!,...tied(staff),staff[3]!,...([external[0]!,...tied(external),external[3]!].map(id=>`ext-${id}`))],
    mileage_asc:[...tied(staff),staff[0]!,staff[3]!,...tied(external).concat(external[0]!,external[3]!).map(id=>`ext-${id}`)],
    year_desc:[staff[0]!,...tied(staff),staff[3]!,...([external[0]!,...tied(external),external[3]!].map(id=>`ext-${id}`))],
  };
  for(const [sort,wanted] of Object.entries(expected)) {
    assert.deepEqual(ids(await service.listPublic(query({sort}),'all')),wanted,sort);
    const seen:string[]=[];let cursor:string|undefined;
    do {const result=await service.listPublic(query({sort,pageSize:3,...(cursor?{cursor}:{pagination:'cursor'})}),'seek');seen.push(...ids(result));cursor=result.data.nextCursor??undefined;}while(cursor);
    assert.deepEqual(seen,wanted,sort);
    for(let page=1;page<=3;page++)assert.deepEqual(ids(await service.listPublic(query({sort,pageSize:3,page}),'offset')),wanted.slice((page-1)*3,page*3));
  }
});

test('sort, projection and export filters bind cursors; missing numeric anchors are rejected',async()=>{
  const cursor=(await service.listPublic(query({sort:'price_asc',pageSize:2,pagination:'cursor'}),'first')).data.nextCursor!;
  for(const change of [{sort:'price_desc'},{projection:undefined},{exportStatus:'unknown'}])await assert.rejects(service.listPublic(query({sort:'price_asc',pageSize:2,cursor,...change}),'bad'),(error:any)=>error.status===400);
  const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  const priorPolicy=Buffer.from(JSON.stringify({...decoded,v:1})).toString('base64url');
  await assert.rejects(service.listPublic(query({sort:'price_asc',pageSize:2,cursor:priorPolicy}),'prior-policy'),(error:any)=>error.status===409);
  const broken=structuredClone(decoded);delete broken.after.sortValue;
  await assert.rejects(service.listPublic(query({sort:'price_asc',pageSize:2,cursor:Buffer.from(JSON.stringify(broken)).toString('base64url')}),'bad-anchor'),(error:any)=>error.status===400);
});

test('USD sorting uses rounded display amounts, leaves unavailable quotes last, and binds FX versions',async()=>{
  await db.pool.query("INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates) VALUES(1,'synthetic',now()-interval '1 hour',now()+interval '24 hours',$1)",[JSON.stringify({USD:'1',CNY:'7'})]);
  try {
    const result=await service.listPublic(query({sort:'price_asc',priceView:'usd'}),'usd');
    assert.deepEqual(ids(result),[...[staff[1]!,staff[2]!].sort(),staff[0]!,staff[3]!,...[external[1]!,external[2]!].sort().concat(external[0]!,external[3]!).map(id=>`ext-${id}`)]);
    assert.equal(result.data.items[4]!.displayPrice?.money?.amount,'0.14');
    assert.equal(result.data.items[6]!.displayPrice?.money?.amount,'1.29');
    const request={sort:'price_asc',priceView:'usd',pageSize:2} as const;
    const cursor=(await service.listPublic(query({...request,pagination:'cursor'}),'quote')).data.nextCursor!;
    await db.pool.query("UPDATE public_fx_quote SET rates=$1",[JSON.stringify({USD:'1'})]);
    await assert.rejects(service.listPublic(query({...request,cursor}),'quote-changed'),(error:any)=>error.status===409);
    const missing=await service.listPublic(query({sort:'price_asc',priceView:'usd'}),'no-cny');
    assert.deepEqual(ids(missing).slice(4),[...external].sort().map(id=>`ext-${id}`));
    for(const item of missing.data.items.slice(4))assert.ok(item.displayPrice?.status==='unavailable'||item.displayPrice?.status==='on_request');
  } finally {await db.pool.query('DELETE FROM public_fx_quote');}
});

test('source name enrichment preserves employee text and fact overrides in cards and facets',async()=>{
  const id=external[2]!,old=(await db.pool.query('SELECT facts,localized FROM external_catalog WHERE listing_id=$1',[id])).rows[0];
  const display={status:'ready',text:'Employee model',requestedLocale:'en',contentLocale:'en',provenance:'human',reviewed:false};
  const sourceName={...display,text:'Supplier model',provenance:'original'};
  try {
    await db.pool.query("INSERT INTO external_vehicle_extras(listing_id,locale,data,export_status) VALUES($1,'en',$2,'unknown')",[id,JSON.stringify({exportStatus:'unknown',names:{model:sourceName}})]);
    const localized=structuredClone(old.localized);localized.en.display.model=display;localized.en.title.text='Unique enrichment vehicle';
    await db.pool.query('UPDATE external_catalog SET localized=$2 WHERE listing_id=$1',[id,JSON.stringify(localized)]);
    const read=()=>service.listPublic(query({q:'Unique enrichment vehicle'}),'override');
    assert.equal((await read()).data.items[0]!.facts.model!.name,'Employee model');
    assert.equal((await service.filters(filters({q:'Unique enrichment vehicle'}))).models[0]!.name,'Employee model');
    localized.en.display.model={...display,text:'Employee fact model',provenance:'original',contentLocale:'und'};
    await db.pool.query('UPDATE external_catalog SET localized=$2 WHERE listing_id=$1',[id,JSON.stringify(localized)]);
    await db.pool.query('INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,$2)',[id,JSON.stringify({hidden:false,facts:{model:{id:'synthetic-r1',name:'Employee fact model'}},text:[]})]);
    assert.equal((await read()).data.items[0]!.facts.model!.name,'Employee fact model');
    assert.equal((await service.filters(filters({q:'Unique enrichment vehicle'}))).models[0]!.name,'Employee fact model');
    const corrected={value:'2021-05',precision:'month'};
    await db.pool.query("UPDATE external_vehicle_extras SET data=data||$2::jsonb WHERE listing_id=$1",[id,JSON.stringify({manufacture:{date:{value:'2020-01',precision:'month'},range:null,source:'supplier',basis:null}})]);
    await db.pool.query("UPDATE external_listing_overrides SET data=jsonb_set(data,'{facts,manufacturedAt}',$2::jsonb) WHERE listing_id=$1",[id,JSON.stringify(corrected)]);
    await db.pool.query("UPDATE external_catalog SET facts=jsonb_set(facts,'{manufacturedAt}',$2::jsonb) WHERE listing_id=$1",[id,JSON.stringify(corrected)]);
    assert.deepEqual((await read()).data.items[0]!.manufacture,{date:corrected,range:null,source:'staff',basis:null});
    assert.deepEqual((await service.getPublic(`ext-${id}`,'en','localized')).manufacture,{date:corrected,range:null,source:'staff',basis:null});

  } finally {
    await db.pool.query('DELETE FROM external_listing_overrides WHERE listing_id=$1',[id]);
    await db.pool.query('DELETE FROM external_vehicle_extras WHERE listing_id=$1',[id]);
    await db.pool.query('UPDATE external_catalog SET facts=$2,localized=$3 WHERE listing_id=$1',[id,JSON.stringify(old.facts),JSON.stringify(old.localized)]);
  }
});

test('export default includes all valid rows and extras updates invalidate list/facets/cursors',async()=>{
  const request=query({sort:'price_asc'}),key={locale:'en',view:'localized',exportStatus:'eligible'};
  const list=()=>cache.get('list',request,()=>service.listPublic(request,'cached'));
  const eligible=()=>cache.get('filters',key,()=>service.filters(filters({exportStatus:'eligible'})));
  assert.equal((await list()).meta.total,8);assert.equal((await eligible()).total,0);
  const cursor=(await service.listPublic(query({pagination:'cursor',pageSize:2}),'before')).data.nextCursor!;
  await db.pool.query("INSERT INTO external_vehicle_extras(listing_id,locale,data,export_status) VALUES($1,'en',$2,'eligible')",[external[0],JSON.stringify({exportStatus:'eligible',powerHp:0,names:{}})]);
  assert.equal((await eligible()).total,1);assert.equal((await list()).data.items.find(item=>item.id===`ext-${external[0]}`)!.exportStatus,'eligible');
  const selected=await service.listPublic(query({exportStatus:'eligible'}),'eligible');assert.deepEqual(ids(selected),[`ext-${external[0]}`]);assert.equal(selected.data.items[0]!.facts.powerHp,0);
  assert.equal((await service.filters(filters({exportStatus:'unknown'}))).total,7);
  assert.equal((await service.listPublic(query({exportStatus:'all'}),'all')).meta.total,8);
  await assert.rejects(service.listPublic(query({pageSize:2,cursor}),'stale'),(error:any)=>error.status===409);
  await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[external[0]]);
  assert.equal((await list()).meta.total,7);assert.equal((await eligible()).total,0);
});


test('retained text in immutable snapshots projects consistently and whitespace titles stay out of the locale',async()=>{
  const base=makeVehicleDraftFixture();
  base.facts.model={id:'retained-public-model',name:'源车型'};
  base.configuration={version:1,items:[{name:'质保',value:'可延长'},{name:'电压',value:'85 kW'}]};
  const publication=(title:string|null,published:boolean)=>db.transaction(async tx=>{
    const id=randomUUID(),revision=randomUUID(),draft=structuredClone(base);
    draft.content.title.sourceLanguage='und';
    draft.content.title.sourceVersion=7;
    draft.content.title.translations.en!.text=title??'draft only retained title';
    draft.content.title.translations.en!.reviewStatus='stale';
    draft.content.description.sourceVersion=7;
    draft.content.description.translations.en!.text='Retained archived description';
    draft.content.description.translations.en!.reviewStatus='stale';
    const images=[{...makePublicVehicleFixture().images[0]!,id:randomUUID()}];
    const snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,configuration:draft.configuration,images};
    const sidecar=syncLocalization(id,{...draft,media:images},emptyLocalization(),'und');
    const record=(ref:string,text:string)=>{
      const field=sidecar.data.fields.find(candidate=>candidate.ref===ref)!;
      field.sourceVersion=7;
      field.translations.en={text,kind:'human',reviewStatus:'stale',sourceVersion:1,humanEditVersion:0,engineVersion:null};
    };
    record('model','Retained archived model');
    record('configuration.'+vehicleConfigurationItemId('质保')+'.name','Retained warranty');
    record('configuration.'+vehicleConfigurationItemId('质保')+'.value','Retained extended warranty');
    await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[id]);
    const unpublished=structuredClone(draft);
    unpublished.content.title.translations.en!.text='Draft copy must not appear';
    await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify(unpublished)]);
    if(published) {
      await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[revision,id,JSON.stringify(snapshot)]);
      // Old stored projections omitted these sidecar values.
      const old={en:projectDisplay(id,snapshot,'en')};
      await tx.query('INSERT INTO publication_localizations(publication_id,data,bindings,projections) VALUES($1,$2,$3,$4)',
        [revision,JSON.stringify(sidecar.data),JSON.stringify(sidecar.bindings),JSON.stringify(old)]);
      await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[id,revision]);
    }
    return id;
  });
  const retained=await publication('  Retained English title  ',true);
  const blank=await publication(' \r\t\u00A0\u2005\u3000\uFEFF',true);
  const draft=await publication(null,false);
  const home=await service.getHome();
  home.sections[0]!.vehicleIds=[retained,blank,draft];
  await db.pool.query('UPDATE home_config SET sections=$1 WHERE id=1',[JSON.stringify(home.sections)]);
  const target={model:'retained-public-model'};
  const card=await service.listPublic(query({...target,q:'Retained archived model'}),'retained-card');
  assert.equal(card.meta.total,1);assert.deepEqual(ids(card),[retained]);
  assert.equal(card.data.items[0]!.content.title?.text,'  Retained English title  ');
  assert.equal(card.data.items[0]!.display?.model.text,'Retained archived model');
  assert.equal(card.data.items[0]!.display?.model.reviewed,false);
  const full=await service.listPublic(query({...target,projection:undefined}),'retained-full');
  assert.equal(full.meta.total,1);assert.deepEqual(ids(full),[retained]);
  assert.equal((await service.listPublic(query({...target,locale:'zh'}),'retained-zh')).meta.total,2);
  const facet=await service.filters(filters(target));
  assert.equal(facet.total,1);
  assert.deepEqual(facet.models.map(({name,count})=>({name,count})),[{name:'Retained archived model',count:1}]);
  const detail=await service.getPublic(retained,'en','localized');
  assert.equal(detail.content.title.text,'  Retained English title  ');
  assert.equal(detail.content.description?.text,'Retained archived description');
  assert.equal(detail.configuration?.items[0]?.name.text,'Retained warranty');
  assert.equal(detail.configuration?.items[0]?.value.text,'Retained extended warranty');
  assert.equal(detail.configuration?.items[1]?.value.text,'85 kW');
  assert.ok(!JSON.stringify(detail).includes('Draft copy'));
  for(const id of [blank,draft])await assert.rejects(service.getPublic(id,'en','localized'),(error:any)=>error.status===404);
  const featured=(await service.publicHome('en','localized')).sections[0]!.vehicles;
  assert.deepEqual(featured.map(vehicle=>vehicle.id),[retained]);
  assert.equal(featured[0]?.facts.model?.name,'Retained archived model');
});

test('previously stored supplier copy with private costs or contacts stays out of public detail, cards and facets',async()=>{
  const id=external[1]!;
  const cost='内部采购成本 CNY 73421', contact='Seller contact (202) 555-0142';
  const original=(await db.pool.query('SELECT facts,localized,details FROM external_catalog WHERE listing_id=$1',[id])).rows[0]!;
  const stored=structuredClone(original);
  stored.localized.en.title.text=contact;
  stored.localized.en.description={...stored.localized.en.title,text:cost};
  stored.localized.en.display.model={...stored.localized.en.display.make,text:contact};
  stored.facts.model.name=contact;
  stored.details.original.description={text:cost,contentLocale:'zh'};
  stored.details.specifications=[{name:{text:'内部采购成本',contentLocale:'zh'},value:{text:'CNY 73421',contentLocale:'und'}}];
  await db.transaction(async tx=>{
    await tx.query('UPDATE external_catalog SET facts=$2,localized=$3,details=$4 WHERE listing_id=$1',
      [id,JSON.stringify(stored.facts),JSON.stringify(stored.localized),JSON.stringify(stored.details)]);
    await tx.query('UPDATE external_media SET alt=$2 WHERE listing_id=$1', [id,JSON.stringify({text:contact,contentLocale:'en'})]);
  });
  try {
    const detail=await service.getPublic(`ext-${id}`,'en','localized');
    assert.equal(detail.content.title.kind,'catalog');
    assert.equal(detail.content.description,null);
    assert.equal(detail.external?.detail?.original.description,null);
    assert.deepEqual(detail.external?.detail?.specifications,[]);
    assert.equal(detail.images[0]?.alt,'');
    const card=(await service.listPublic(query(),'private-supplier-copy')).data.items.find(item=>item.id===`ext-${id}`);
    assert.ok(card);
    assert.equal(card.content.title.kind,'catalog');
    const facet=await service.filters(filters({model:original.facts.model.id}));
    assert.ok(facet.models.some(item=>item.id===original.facts.model.id));
    for(const value of [detail,card,facet]) assert.doesNotMatch(JSON.stringify(value),/73421|555-0142/);
    const persisted=(await db.pool.query('SELECT details FROM external_catalog WHERE listing_id=$1',[id])).rows[0]!;
    assert.equal(persisted.details.original.description.text,cost);
  } finally {
    await db.transaction(async tx=>{
      await tx.query('UPDATE external_catalog SET facts=$2,localized=$3,details=$4 WHERE listing_id=$1',
        [id,JSON.stringify(original.facts),JSON.stringify(original.localized),JSON.stringify(original.details)]);
      await tx.query('UPDATE external_media SET alt=NULL WHERE listing_id=$1',[id]);
    });
  }
});

test('powertrain and year overview count unpriced listings and preserve visibility and facet availability',async()=>{
  const make={id:'facet-test-make',name:'Facet test make'};
  const search='纯电回归唯一样本';
  for(const [position,index] of [1,2,3].entries()) {
    const id=external[index]!;
    await db.pool.query(`UPDATE external_catalog
      SET facts=facts||$2::jsonb,price_cny=CASE WHEN $3 THEN NULL ELSE price_cny END,
        localized=jsonb_set(jsonb_set(CASE WHEN $3 THEN localized-'en' ELSE localized END,
          '{zh,display,make,text}',to_jsonb($4::text)),'{zh,title,text}',to_jsonb($5::text)) WHERE listing_id=$1`,[id,JSON.stringify({
      make,model:{id:'facet-test-model',name:'Facet test model'},trim:{id:'facet-test-trim',name:'Facet test trim'},
      generation:{id:'facet-test-generation',name:'Facet test generation'},powertrain:'bev',
      modelYear:[2020,2019,2022][position],drivetrain:position===2?'awd':'fwd',
    }),position===2,position===2?'合成新品牌':'合成旧品牌',position===0?search:'其他合成样本']);
  }
  const options={locale:'zh',catalog:'curated',powertrain:'bev',yearMin:2020};
  const compareToFull=async(extra:Record<string,unknown>={},expectedPhases?:string[])=>{
    const full=await service.filters(filters({...options,...extra}));
    const {trims,generations,priceCurrencies,models,...shared}=full;
    const overview={...shared,hasTrims:Boolean(trims?.length),hasGenerations:Boolean(generations?.length)};
    const supplierPhases:string[]=[];
    const {value:result}=await service.filterResult(filters({...options,...extra,projection:'overview'}),phase=>{
      if(phase.startsWith('supplier_'))supplierPhases.push(phase);
    });
    if(expectedPhases)assert.deepEqual(supplierPhases,expectedPhases);
    assert.deepEqual(result,{...overview,models:[]});
    assert.deepEqual(await service.filters(filters({...options,...extra,projection:'overview-models'})),{...overview,models});
    return result;
  };
  const compareGlobal=async(locale:'zh'|'en'|'ru')=>{
    const query={locale,catalog:'curated',view:'localized',priceView:'usd'};
    const full=await service.filters(filters(query));
    const {trims,generations,priceCurrencies,models,...shared}=full;
    const overview={...shared,hasTrims:Boolean(trims?.length),hasGenerations:Boolean(generations?.length)};
    for (const projection of ['overview','overview-models'] as const) {
      const phases:string[]=[];
      const {value}=await service.filterResult(filters({...query,projection}),phase=>phases.push(phase));
      assert.ok(phases.includes('supplier_global_rollup'));
      assert.deepEqual(value,{...overview,models:projection==='overview-models'?models:[]});
    }
  };
  for (const locale of ['zh','en','ru'] as const) await compareGlobal(locale);
  const supplierFacets=['supplier_facets','supplier_overview_rollup'];
  const zh=await compareToFull({},supplierFacets);
  assert.equal(zh.total,2);
  assert.deepEqual(zh.makes,[{id:make.id,name:'合成新品牌',count:2}]);
  assert.deepEqual(zh.modelYears,[{year:2022,count:1},{year:2020,count:1}]);
  assert.deepEqual(zh.powertrains,[{id:'bev',count:2}]);
  assert.deepEqual(zh.drivetrains,[{id:'awd',count:1},{id:'fwd',count:1}]);
  assert.equal(zh.hasTrims,true);
  assert.equal(zh.hasGenerations,true);
  assert.equal((await compareToFull({make:make.id,q:search})).total,1);
  assert.equal((await compareToFull({locale:'en'})).total,1);
  assert.equal((await compareToFull({yearMin:2023},supplierFacets)).total,0);

  await db.pool.query("UPDATE external_catalog_search SET make_label=NULL WHERE listing_id=$1 AND locale='zh'",[external[3]]);
  assert.deepEqual((await compareToFull({},[...supplierFacets,'supplier_label_fallback'])).makes,[{id:make.id,name:'合成旧品牌',count:2}]);
  await compareGlobal('zh');
  await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[external[3]]);
  assert.equal((await compareToFull()).total,1);
  await compareGlobal('zh');
  await db.pool.query("UPDATE external_catalog_search SET make_label=NULL WHERE listing_id=$1 AND locale='zh'",[external[1]]);
  const safe=await compareToFull();
  assert.equal(safe.total,1);
  assert.deepEqual(safe.makes,[{id:make.id,name:'外部挂牌',count:1}]);
});
