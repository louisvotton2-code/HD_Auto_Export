import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {PublicVehicleQuerySchema,PublicFilterQuerySchema} from '@hd/contracts/public';
import {makeVehicleDraftFixture,makePublicVehicleFixture,makeExternalCandidateFixture} from '@hd/contracts/fixtures';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {InventoryService} from '../src/vehicles/service.js';
import {countExternal,externalFacets,listExternalPage} from '../src/external/catalog.js';
import {buildProjection,emptyOverrides} from '../src/external/normalize.js';
import type {PoolClient} from 'pg';

const maintenanceUrl=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(!['postgres:','postgresql:'].includes(maintenanceUrl.protocol)||maintenanceUrl.hostname!=='127.0.0.1'||maintenanceUrl.pathname!=='/postgres'||maintenanceUrl.search||maintenanceUrl.hash)
  throw new Error('Catalog tests require a local PostgreSQL maintenance database without URL options.');
const name=`hd_ext_scale_test_${randomBytes(8).toString('hex')}`,url=new URL(maintenanceUrl);url.pathname=`/${name}`;
const maintenance=createDatabase(maintenanceUrl.toString(),2),db=createDatabase(url.toString(),4);
const inventory=new InventoryService(db,true),staffIds:string[]=[],externalIds:string[]=[];
let created=false;
const query=(extra:Record<string,unknown>={})=>PublicVehicleQuerySchema.parse({locale:'en',view:'localized',pageSize:2,...extra});
const filters=(extra:Record<string,unknown>={})=>PublicFilterQuerySchema.parse({locale:'en',view:'localized',...extra});

async function versions(client:Pick<PoolClient,'query'>=db.pool) {
  const result=await client.query<{revision:string;filter_revision:string}>('SELECT revision,filter_revision FROM public_catalog_state WHERE id=1');
  const row=result.rows[0]!;
  return {global:BigInt(row.revision),filters:BigInt(row.filter_revision)};
}

before(async()=>{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;await migrateDatabase(db);
  for(let i=1;i<=3;i++){
    const id=randomUUID(),publication=randomUUID(),draft=makeVehicleDraftFixture();staffIds.push(id);
    draft.facts.make={id:'fixture_make',name:i===3?'Z newest staff':'A old staff'};
    const snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images:makePublicVehicleFixture().images};
    await db.transaction(async tx=>{
      await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[id]);
      await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify(draft)]);
      await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,id,JSON.stringify(snapshot)]);
      await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=$3 WHERE id=$1",[id,publication,`2026-01-01T00:00:00.00000${i}Z`]);
    });
  }
  for(let i=0;i<8;i++){
    const id=randomUUID(),candidate=makeExternalCandidateFixture(i+10);externalIds.push(id);
    candidate.facts.make={id:'fixture_make',name:i===7?'Z latest external':'A old external'};candidate.facts.model={id:'fixture_model',name:'External model'};
    candidate.copy.model=null;candidate.images=[];
    if(i===0)candidate.copy.title={original:{text:'Literal %_\\ marker',contentLocale:'en'},translations:{}};
    if(i===1){candidate.price=null;candidate.facts.mileageKm=null;candidate.facts.modelYear=null;candidate.facts.powertrain='unknown';}
    const p=buildProjection(candidate,emptyOverrides(),'Synthetic Market');
    await db.transaction(async tx=>{
      await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
        VALUES($1,'synthetic-feed','synthetic-market',$2,1,$3,$4,'active',now(),$5)`,[id,`scale-${i}`,'a'.repeat(64),JSON.stringify(candidate),`2026-02-01T00:00:00.00000${i+1}Z`]);
      await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
        VALUES($1,$2,'Synthetic Market',$3,$4,$5,$6,$7,$8)`,[id,`2026-02-01T00:00:00.00000${i+1}Z`,candidate.listingUrl,JSON.stringify(p.facts),p.priceCny,JSON.stringify(p.issues),JSON.stringify(p.localized),JSON.stringify(p.details)]);
    });
  }
});
after(async()=>{await db.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.close();});

test('SQL facets agree with exact totals and preserve unknown and original-currency semantics',async()=>{
  const f=await inventory.filters(filters());assert.equal(f.total,11);assert.equal(f.makes[0]!.count,11);
  assert.equal(f.makes[0]!.name,'Awaiting translation'); // Employee label takes priority over external label.
  assert.equal(f.models[0]!.count,11);assert.equal(f.powertrains.some(x=>x.id==='unknown'),false);
  assert.equal((await inventory.filters(filters({powertrain:'hev'}))).makes[0]!.name,'Z latest external');
  assert.deepEqual(f.priceCurrencies,[{id:'CNY',count:7},{id:'USD',count:3}]);
  const ranged={priceMin:'0',priceCurrency:'CNY',mileageMin:0,yearMin:1886};
  assert.equal((await inventory.filters(filters(ranged))).total,7);
  assert.equal((await inventory.listPublic(query(ranged),'test')).meta.total,7);
  assert.equal((await inventory.filters(filters({powertrain:'unknown'}))).total,0);
  const legacy=await inventory.filters(PublicFilterQuerySchema.parse({locale:'en'}));
  assert.equal(legacy.total,undefined);assert.equal(legacy.makes[0]!.name,'Z newest staff');assert.equal(legacy.makes[0]!.count,3);
});

test('scoped filter views preserve exact three-language facets and leave the full response intact',async()=>{
  for(const locale of ['zh','en','ru']){
    const scope={locale,priceView:'usd',priceCurrency:'USD',q:'fixture'};
    const full=await inventory.filters(filters(scope));
    const overview=await inventory.filters(filters({...scope,projection:'overview'}));
    for(const key of ['total','makes','powertrains','drivetrains','modelYears'] as const)
      assert.deepEqual(overview[key],full[key],`${locale}: ${key}`);
    assert.deepEqual(overview.models,[]);
    assert.equal(overview.hasTrims,!!full.trims?.length);
    assert.equal(overview.hasGenerations,!!full.generations?.length);
    assert.equal(overview.trims,undefined);
    assert.equal(overview.generations,undefined);
    assert.equal(full.hasTrims,undefined);
    assert.equal(full.hasGenerations,undefined);
    const legacyBookmark=await inventory.filters(filters({...scope,projection:'overview-models'}));
    assert.deepEqual(legacyBookmark,{...overview,models:full.models});
    const make='fixture_make';
    const fullBrand=await inventory.filters(filters({locale,make}));
    const models=await inventory.filters(filters({locale,make,projection:'models'}));
    assert.deepEqual(models,{catalog:'curated',makes:[],models:fullBrand.models,powertrains:[]});
  }
  const empty=await inventory.filters(filters({q:'absent vehicles',projection:'overview'}));
  assert.equal(empty.total,0);
  assert.equal(empty.hasTrims,false);
  assert.equal(empty.hasGenerations,false);
  assert.equal(PublicFilterQuerySchema.safeParse({projection:'overview'}).success,false);
  assert.equal(PublicFilterQuerySchema.safeParse({view:'localized',projection:'models'}).success,false);
  assert.equal(PublicFilterQuerySchema.safeParse({view:'localized',projection:'variants',make:'fixture_make'}).success,false);
  assert.equal(PublicVehicleQuerySchema.safeParse({view:'localized',projection:'overview'}).success,false);
});

test('ordinary list shapes stay unchanged and microsecond keysets cross employee/external boundary once',async()=>{
  const regular=await inventory.listPublic(query(),'regular');assert.equal(Object.hasOwn(regular.data,'nextCursor'),false);
  const legacy=await inventory.listPublic(query({view:'legacy'}),'legacy');assert.equal(legacy.meta.total,3);assert.equal(Object.hasOwn(legacy.data,'nextCursor'),false);
  const expected=[...staffIds].reverse().concat([...externalIds].reverse().map(id=>`ext-${id}`));
  const seen:string[]=[];let cursor:string|undefined;let page=1;
  do{
    const result=await inventory.listPublic(query(cursor?{cursor}:{pagination:'cursor'}),'cursor');
    assert.equal(result.data.page,page++);assert.equal(result.meta.total,11);
    seen.push(...result.data.items.map(item=>item.id));cursor=result.data.nextCursor??undefined;
    assert.equal(result.data.hasMore,!!cursor);
  }while(cursor);
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,11);
  for(let page=1;page<=7;page++)assert.deepEqual((await inventory.listPublic(query({page}),'offset')).data.items.map(item=>item.id),expected.slice((page-1)*2,page*2));
});

test('equal-time groups seek by UUID without duplication in either stream',async()=>{
  const beforeStaff=(await db.pool.query('SELECT id,published_at::text AS stamp FROM vehicles')).rows;
  const beforeExternal=(await db.pool.query('SELECT listing_id,published_at::text AS stamp FROM external_catalog')).rows;
  await db.pool.query("UPDATE vehicles SET published_at='2026-01-01T00:00:00.123456Z'");
  await db.pool.query("UPDATE external_catalog SET published_at='2026-02-01T00:00:00.123456Z'");
  try {
    const expected=[...staffIds].sort().concat([...externalIds].sort().map(id=>`ext-${id}`));
    let cursor:string|undefined;const found:string[]=[];
    do {const result=await inventory.listPublic(query(cursor?{cursor}:{pagination:'cursor'}),'equal-time');found.push(...result.data.items.map(item=>item.id));cursor=result.data.nextCursor??undefined;}while(cursor);
    assert.deepEqual(found,expected);
    const firstExternal=externalIds.map((id,index)=>({id,index})).filter(row=>row.index!==1).sort((a,b)=>a.id.localeCompare(b.id))[0]!;
    assert.equal((await inventory.filters(filters({powertrain:'hev'}))).makes[0]!.name,firstExternal.index===7?'Z latest external':'A old external');
  } finally {
    for(const row of beforeStaff)await db.pool.query('UPDATE vehicles SET published_at=$2 WHERE id=$1',[row.id,row.stamp]);
    for(const row of beforeExternal)await db.pool.query('UPDATE external_catalog SET published_at=$2 WHERE listing_id=$1',[row.listing_id,row.stamp]);
  }
});

test('search treats percent underscore and backslash literally, with matching facet totals',async()=>{
  for(const q of ['%','_','\\','%_\\','literal']){
    const listed=await inventory.listPublic(query({q}),'search');assert.equal(listed.meta.total,1,q);
    assert.equal((await inventory.filters(filters({q}))).total,1,q);
  }
  assert.equal((await inventory.listPublic(query({q:'missing token'}),'search')).meta.total,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM external_catalog_search')).rows[0].count,24);
  const before=await inventory.listPublic(query({q:'replacement'}),'before');assert.equal(before.meta.total,0);
  await db.pool.query(`UPDATE external_catalog SET localized=jsonb_set(localized,'{en,title,text}','"Replacement token"') WHERE listing_id=$1`,[externalIds[0]]);
  assert.equal((await inventory.listPublic(query({q:'replacement'}),'after')).meta.total,1);
  assert.equal((await inventory.filters(filters({q:'replacement'}))).total,1);
});

test('searching a literal newline matches one field, never the separator between fields',async()=>{
  const q='boundary end\nboundary start';
  const tx=await db.pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("UPDATE external_catalog_search SET stock_text='boundary end',make_text='boundary start' WHERE listing_id=$1 AND locale='en'",[externalIds[1]]);
    await tx.query("UPDATE external_catalog_search SET title_text=$1 WHERE listing_id=$2 AND locale='en'",[q,externalIds[2]]);
    const input=query({q,sort:'newest',projection:'card'});
    const page=await listExternalPage(tx,input,24,0,Date.now(),undefined,null,true);
    assert.equal(page.total,1);
    assert.deepEqual(page.items.map(({id})=>id),[`ext-${externalIds[2]}`]);
    assert.equal((await externalFacets(tx,filters({q,projection:'overview'}))).find(({kind})=>kind==='total')?.count,1);
  } finally {await tx.query('ROLLBACK');tx.release();}
});

test('Chinese search keeps cross-brand title matches, exact facets and newest card keysets',async()=>{
  const q='马自达',stamp='2026-03-01T00:00:00.123456Z';
  const matchingStaff=staffIds.slice(0,2);
  const [compared,mazda,englishOnly,withdrawn]=externalIds.slice(2,6) as [string,string,string,string];
  const existingStaff=(await db.pool.query('SELECT id,published_revision_id,published_at::text AS stamp FROM vehicles WHERE id=ANY($1::uuid[])',[matchingStaff])).rows;
  const existingExternal=(await db.pool.query(`SELECT c.listing_id,c.published_at::text AS stamp,c.facts,c.localized,l.upstream_state
    FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id WHERE c.listing_id=ANY($1::uuid[])`,[[compared,mazda,englishOnly,withdrawn]])).rows;
  const search={q,locale:'zh',priceView:'usd',projection:'card',sort:'newest'} as const;
  try {
    await db.transaction(async tx=>{
      for(const id of matchingStaff) {
        const publication=randomUUID();
        await tx.query(`INSERT INTO vehicle_publications(id,vehicle_id,data)
          SELECT $2,v.id,jsonb_set(p.data,'{content,title,translations,zh,text}',to_jsonb($3::text))
          FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id WHERE v.id=$1`,[id,publication,`门店对比${q}`]);
        await tx.query('UPDATE vehicles SET published_revision_id=$2,published_at=$3 WHERE id=$1',[id,publication,stamp]);
      }
      await tx.query(`UPDATE external_catalog SET published_at=$2,localized=jsonb_set(localized,'{zh,title,text}',to_jsonb($3::text))
        WHERE listing_id=ANY($1::uuid[])`,[[compared,withdrawn],stamp,`车主比较${q}`]);
      await tx.query(`UPDATE external_catalog SET published_at=$2,facts=jsonb_set(facts,'{make}','{"id":"mazda","name":"Mazda"}'),
        localized=jsonb_set(localized,'{zh,display,make,text}',to_jsonb($3::text)) WHERE listing_id=$1`,[mazda,stamp,q]);
      await tx.query(`UPDATE external_catalog SET localized=jsonb_set(localized,'{en,title,text}',to_jsonb($2::text))
        WHERE listing_id=$1`,[englishOnly,`English-only comparison: ${q}`]);
      await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[withdrawn]);
    });

    const expected=[...matchingStaff].sort().concat([compared,mazda].sort().map(id=>`ext-${id}`));
    const first=await inventory.listPublic(query(search),'chinese-search');
    assert.equal(first.meta.totalKind,'exact');
    assert.equal(first.meta.total,expected.length);
    assert.deepEqual(first.data.items.map(item=>item.id),expected.slice(0,2));
    const firstWithSupplier=await inventory.listPublic(query({...search,pageSize:4}),'chinese-search-combined');
    assert.equal(firstWithSupplier.meta.total,expected.length);
    assert.deepEqual(firstWithSupplier.data.items.map(item=>item.id),expected);
    const missing=await inventory.listPublic(query({...search,q:'不存在的品牌'}),'chinese-search-missing');
    assert.equal(missing.meta.total,0);
    assert.deepEqual(missing.data.items,[]);
    const pastEnd=await inventory.listPublic(query({...search,page:3}),'chinese-past-end');
    assert.equal(pastEnd.meta.total,expected.length);
    assert.deepEqual(pastEnd.data.items,[]);
    assert.equal(pastEnd.data.hasMore,false);
    const overview=await inventory.filters(filters({locale:'zh',q,priceView:'usd',projection:'overview'}));
    assert.equal(overview.total,first.meta.total);
    assert.deepEqual(overview.makes.map(make=>[make.id,make.count]),[['fixture_make',3],['mazda',1]]);

    let cursor:string|undefined;
    for(const [index,id] of expected.entries()) {
      const page=await inventory.listPublic(query({...search,pageSize:1,pagination:'cursor',cursor}),'chinese-keyset');
      assert.equal(page.meta.total,expected.length);
      assert.deepEqual(page.data.items.map(item=>item.id),[id]);
      cursor=page.data.nextCursor??undefined;
      assert.equal(Boolean(cursor),index<expected.length-1);
    }

    const english=await inventory.listPublic(query({...search,locale:'en'}),'english-search');
    assert.equal(english.meta.total,1);
    assert.deepEqual(english.data.items.map(item=>item.id),[`ext-${englishOnly}`]);
  } finally {
    await db.transaction(async tx=>{
      for(const row of existingStaff)await tx.query('UPDATE vehicles SET published_revision_id=$2,published_at=$3 WHERE id=$1',
        [row.id,row.published_revision_id,row.stamp]);
      for(const row of existingExternal) {
        await tx.query('UPDATE external_listings SET upstream_state=$2 WHERE id=$1',[row.listing_id,row.upstream_state]);
        await tx.query('UPDATE external_catalog SET published_at=$2,facts=$3,localized=$4 WHERE listing_id=$1',
          [row.listing_id,row.stamp,JSON.stringify(row.facts),JSON.stringify(row.localized)]);
      }
    });
  }
});

test('nested facet counts preserve the latest nonnull label when the newest historical labels are missing',async()=>{
  const tx=await db.pool.connect();await tx.query('BEGIN');
  try {
    for(const [index,id] of externalIds.entries()) {
      const trimName=index===7?null:index===6?'Z latest known trim':'A earlier trim';
      const generationName=index===7?null:index===6?'Z latest known generation':'A earlier generation';
      // Legacy malformed labels are deliberately retained as a read-compatibility
      // case; current candidate schemas reject these missing required names.
      await tx.query(`UPDATE external_catalog SET
        facts=jsonb_set(jsonb_set(facts,'{trim}',$2::jsonb),'{generation}',$3::jsonb),
        localized=jsonb_set(jsonb_set(localized,'{en,display,trim,text}',$4::jsonb),'{en,display,generation,text}',$5::jsonb)
        WHERE listing_id=$1`,[id,JSON.stringify({id:'shared_trim',name:trimName}),JSON.stringify({id:'shared_generation',name:generationName}),JSON.stringify(trimName),JSON.stringify(generationName)]);
    }
    const rows=await externalFacets(tx,filters({priceView:'usd'}),{
      version:'synthetic-nested-facets',source:'synthetic',asOf:'2026-01-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',rates:{CNY:'7'},
    });
    for(const [kind,name] of [['trim','Z latest known trim'],['generation','Z latest known generation']]) {
      assert.deepEqual(rows.filter(row=>row.kind===kind),[{
        kind,id:kind==='trim'?'shared_trim':'shared_generation',name,make_id:'fixture_make',model_id:'fixture_model',count:8,
      }]);
    }
    assert.equal(rows.find(row=>row.kind==='total')?.count,8);
    assert.equal(rows.find(row=>row.kind==='currency')?.count,7);
    const variants=await externalFacets(tx,filters({make:'fixture_make',model:'fixture_model',projection:'variants'}));
    assert.deepEqual(variants.filter(row=>row.kind!=='total').sort((a,b)=>a.kind.localeCompare(b.kind)),
      rows.filter(row=>row.kind==='trim'||row.kind==='generation').sort((a,b)=>a.kind.localeCompare(b.kind)));
    const overview=await externalFacets(tx,filters({projection:'overview'}));
    assert.equal(overview.find(row=>row.kind==='hasTrims')?.count,1);
    assert.equal(overview.find(row=>row.kind==='hasGenerations')?.count,1);
    assert.equal(overview.some(row=>['model','trim','generation'].includes(row.kind)),false);
    const empty=await externalFacets(tx,filters({make:'missing_make'}));
    assert.deepEqual(empty,[{kind:'total',id:null,name:null,make_id:null,model_id:null,count:0}]);
  } finally {await tx.query('ROLLBACK');tx.release();}
});

test('supplier and cover observation times only change the global version; cover and visibility changes invalidate filters',async()=>{
  const id=externalIds[0]!;
  const photo=randomUUID();
  await db.pool.query(`INSERT INTO external_media(id,listing_id,source_media_id,url,position,active,refreshed_at)
    VALUES($1,$2,'scope-fixture','https://photos.example.invalid/cache-scope.webp',0,true,now())`,[photo,id]);
  const scope=filters({projection:'overview-models'});
  const original=await inventory.filters(scope);
  const refresh=async (client:Pick<PoolClient,'query'>)=>{
    await client.query("UPDATE external_listings SET fetched_at=fetched_at+interval '1 second',source_updated_at=fetched_at WHERE id=$1",[id]);
    await client.query("UPDATE external_media SET refreshed_at=refreshed_at+interval '1 second' WHERE id=$1",[photo]);
  };
  const originalVersions=await versions();
  await db.transaction(async tx=>{
    await refresh(tx);
    await refresh(tx);
    assert.deepEqual(await versions(tx),originalVersions);
  });
  const refreshed=await versions();
  assert.deepEqual(refreshed,{global:originalVersions.global+1n,filters:originalVersions.filters});
  assert.deepEqual(await inventory.filters(scope),original);

  const withdraw=async (tx:PoolClient)=>{
    await refresh(tx);
    await tx.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id]);
  };
  await assert.rejects(db.transaction(async tx=>{
    await withdraw(tx);
    throw new Error('intentional rollback');
  }),/intentional rollback/);
  assert.deepEqual(await versions(),refreshed);
  assert.deepEqual(await inventory.filters(scope),original);

  await db.transaction(withdraw);
  try {
    assert.deepEqual(await versions(),{global:refreshed.global+1n,filters:refreshed.filters+1n});
    assert.equal((await inventory.filters(scope)).total,original.total!-1);
  } finally {
    await db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[id]);
  }
  assert.deepEqual(await inventory.filters(scope),original);
  const beforeCoverChange=await versions();
  const expiry=new Date(Date.now()+90_000);
  await db.pool.query('UPDATE external_media SET expires_at=$2 WHERE id=$1',[photo,expiry]);
  assert.deepEqual(await versions(),{global:beforeCoverChange.global+1n,filters:beforeCoverChange.filters+1n});
  const config=await inventory.getHome();
  await db.pool.query("UPDATE home_config SET sections=jsonb_set(sections,'{0,vehicleIds}',$1::jsonb) WHERE id=1",
    [JSON.stringify([`ext-${id}`])]);
  try {
    const scoped=filters({projection:'home-models'});
    const legacyRead=await inventory.filterResult(scoped);
    assert.equal(legacyRead.value.models.length,1);
    assert.equal(legacyRead.expiresAt,expiry.getTime());
    assert.equal((await inventory.filterSnapshot(scoped)).expiresAt,expiry.getTime());
  } finally {
    await db.pool.query('UPDATE home_config SET sections=$1 WHERE id=1',[JSON.stringify(config.sections)]);
    await db.pool.query('DELETE FROM external_media WHERE id=$1',[photo]);
  }
});

test('inspection evidence and report-only projection edits keep the facet version stable',async()=>{
  const id=externalIds.at(-1)!;
  const original=(await db.pool.query('SELECT details,issues,price_cny,localized FROM external_catalog WHERE listing_id=$1',[id])).rows[0]!;
  const scope=filters({make:'fixture_make',projection:'models'});
  const originalFacets=await externalFacets(db.pool,scope);
  const writeEvidence=(client:Pick<PoolClient,'query'>,revision:string)=>client.query(`INSERT INTO external_vehicle_evidence_sets(listing_id,locale,kind,source_revision,total,status)
    VALUES($1,'en','inspection',$2,0,'unavailable') ON CONFLICT(listing_id,locale,kind) DO UPDATE SET source_revision=excluded.source_revision`,[id,revision]);
  const writeReport=(client:Pick<PoolClient,'query'>,fixture:number)=>client.query(`UPDATE external_catalog
    SET details=jsonb_set(details,'{inspection}',jsonb_build_object('fixture',$2::integer)) WHERE listing_id=$1`,[id,fixture]);
  async function expectBumps(globalDelta:bigint,filterDelta:bigint,change:()=>Promise<unknown>){
    const prior=await versions();
    await change();
    assert.deepEqual(await versions(),{global:prior.global+globalDelta,filters:prior.filters+filterDelta});
  }
  try {
    await expectBumps(1n,0n,()=>writeEvidence(db.pool,'report-1'));
    await expectBumps(1n,0n,()=>writeEvidence(db.pool,'report-2'));
    await expectBumps(1n,0n,()=>writeReport(db.pool,1));
    await expectBumps(1n,0n,()=>db.pool.query(`UPDATE external_catalog
      SET issues='[{"field":"inspection","code":"invalid"}]' WHERE listing_id=$1`,[id]));
    assert.deepEqual(await externalFacets(db.pool,scope),originalFacets);
    await expectBumps(0n,0n,()=>db.transaction(async tx=>{
      await writeEvidence(tx,'report-2');
      await writeReport(tx,1);
    }));

    await expectBumps(1n,1n,()=>db.transaction(async tx=>{
      await writeReport(tx,2);
      await writeEvidence(tx,'report-3');
      await tx.query('UPDATE external_catalog SET price_cny=price_cny+1 WHERE listing_id=$1',[id]);
    }));
    await expectBumps(1n,1n,()=>db.transaction(async tx=>{
      await tx.query(`UPDATE external_catalog SET localized=jsonb_set(localized,'{en,display,model,text}','"Current label"') WHERE listing_id=$1`,[id]);
      await writeEvidence(tx,'report-4');
      await writeReport(tx,3);
    }));
    assert.equal((await externalFacets(db.pool,scope))[0]?.name,'Current label');

    await expectBumps(0n,0n,()=>assert.rejects(db.transaction(async tx=>{
      await writeEvidence(tx,'report-rolled-back');
      await writeReport(tx,4);
      throw new Error('rollback report changes');
    }),/rollback report changes/));
    await expectBumps(1n,1n,()=>db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[id]));
    await expectBumps(0n,0n,()=>db.transaction(async tx=>{
      await writeEvidence(tx,'report-withdrawn');
      await writeReport(tx,4);
    }));
    await expectBumps(1n,1n,()=>db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[id]));
    await expectBumps(1n,0n,()=>db.pool.query("DELETE FROM external_vehicle_evidence_sets WHERE listing_id=$1 AND locale='en' AND kind='inspection'",[id]));
  } finally {
    await db.transaction(async tx=>{
      await tx.query("DELETE FROM external_vehicle_evidence_sets WHERE listing_id=$1 AND locale='en' AND kind='inspection'",[id]);
      await tx.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[id]);
      await tx.query('UPDATE external_catalog SET details=$2,issues=$3,price_cny=$4,localized=$5 WHERE listing_id=$1',
        [id,JSON.stringify(original.details),JSON.stringify(original.issues),original.price_cny,JSON.stringify(original.localized)]);
    });
  }
});

test('cursor rejects changed filters, revision and restore epochs',async()=>{
  const first=await inventory.listPublic(query({pagination:'cursor'}),'first');const cursor=first.data.nextCursor!;
  await assert.rejects(inventory.listPublic(query({cursor,q:'new query'}),'bad'),(e:any)=>e.status===400);
  const malformed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));malformed.after.publishedAt='2026-02-31T00:00:00.000001Z';
  await assert.rejects(inventory.listPublic(query({cursor:Buffer.from(JSON.stringify(malformed)).toString('base64url')}),'invalid-date'),(e:any)=>e.status===400);
  await db.pool.query('UPDATE public_catalog_state SET revision=revision+1 WHERE id=1');
  await assert.rejects(inventory.listPublic(query({cursor}),'stale'),(e:any)=>e.code==='VERSION_CONFLICT');
  const next=(await inventory.listPublic(query({pagination:'cursor'}),'first')).data.nextCursor!;
  await db.pool.query('UPDATE public_catalog_state SET epoch=$1 WHERE id=1',[randomUUID()]);
  await assert.rejects(inventory.listPublic(query({cursor:next}),'restored'),(e:any)=>e.code==='VERSION_CONFLICT');
});

test('exact counts, facets and pages agree for every supported locale mask',async()=>{
  const locales=['zh','en','ru'] as const;
  const tx=await db.pool.connect();await tx.query('BEGIN');
  try {
    for(const [mask,id] of externalIds.entries()) {
      const visible=locales.filter((_,index)=>(mask&(1<<index))!==0);
      await tx.query(`UPDATE external_catalog SET localized=(
        SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(localized) WHERE key=ANY($2::text[])
      ) WHERE listing_id=$1`,[id,visible]);
    }
    for(const [index,locale] of locales.entries()) {
      const expected=externalIds.filter((_,mask)=>(mask&(1<<index))!==0).sort();
      const q=filters({locale,projection:'overview-models'});
      assert.equal(await countExternal(tx,q),expected.length);
      assert.equal((await externalFacets(tx,q)).find(row=>row.kind==='total')?.count,expected.length);
      const page=await listExternalPage(tx,query({locale}),48,0,Date.now());
      assert.deepEqual(page.anchors.map(anchor=>anchor.id).sort(),expected);
    }
  } finally {await tx.query('ROLLBACK');tx.release();}
});

test('USD price ordering and cursor seek preserve rounded ties, zero and missing-rate ordering',async()=>{
  const tx=await db.pool.connect();await tx.query('BEGIN');
  try {
    const ids=[...externalIds].sort();
    // Both small source values round to USD 0.00. The smaller ID has the larger raw amount.
    const prices=['0.03','0.01','0.04','0.18','1.00','2.00',null,null];
    for(const [index,id] of ids.entries())
      await tx.query('UPDATE external_catalog SET price_cny=$2 WHERE listing_id=$1',[id,prices[index]]);
    const priceQuote={version:'synthetic-sort',source:'synthetic' as const,asOf:'2026-01-01T00:00:00.000Z',
      expiresAt:'2099-01-01T00:00:00.000Z',rates:{CNY:'7'}};
    const q=query({sort:'price_asc',priceView:'usd',projection:'card'});
    let after:Awaited<ReturnType<typeof listExternalPage>>['anchors'][number]|undefined;
    const seen:string[]=[];
    for(let index=0;index<ids.length;index++) {
      const page=await listExternalPage(tx,q,1,0,Date.now(),after,priceQuote);
      after=page.anchors[0]!;
      seen.push(after.id);
      if(index<2) assert.equal(after.sortValue,'0.00');
    }
    assert.deepEqual(seen,ids);
    assert.equal((await listExternalPage(tx,q,1,0,Date.now(),after,priceQuote)).items.length,0);
    const descending=await listExternalPage(tx,{...q,sort:'price_desc'},48,0,Date.now(),undefined,priceQuote);
    assert.deepEqual(descending.anchors.map(anchor=>anchor.id),[ids[5],ids[4],ids[3],ids[2],ids[0],ids[1],ids[6],ids[7]]);
    const missing=await listExternalPage(tx,q,48,0,Date.now());
    assert.deepEqual(missing.anchors.map(anchor=>[anchor.id,anchor.sortValue]),ids.map(id=>[id,null]));

    // Finite-scale division can round the first value up twice and turn these into a false tie.
    await tx.query('UPDATE external_catalog SET price_cny=20000000000010.02 WHERE listing_id=$1',[ids[0]]);
    await tx.query('UPDATE external_catalog SET price_cny=20000000000010.01 WHERE listing_id=$1',[ids[1]]);
    const precise=await listExternalPage(tx,{...q,priceMin:'10000000000000.00',priceCurrency:'USD'},48,0,Date.now(),
      undefined,{...priceQuote,rates:{CNY:'2.000000000001'}});
    assert.deepEqual(precise.anchors.map(anchor=>[anchor.id,anchor.sortValue]),
      [[ids[1],'10000000000000.00'],[ids[0],'10000000000000.01']]);
  } finally {await tx.query('ROLLBACK');tx.release();}
  const options={sort:'price_asc',priceView:'usd'};
  const first=await inventory.listPublic(query({...options,pagination:'cursor'}),'usd-first');
  const cursor=first.data.nextCursor!;
  const resumed=await inventory.listPublic(query({...options,cursor}),'usd-resume');
  assert.equal(resumed.data.page,2);
  const previous=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  delete previous.usdSort;
  const oldCursor=Buffer.from(JSON.stringify(previous)).toString('base64url');
  await assert.rejects(inventory.listPublic(query({...options,cursor:oldCursor}),'usd-old'),(e:any)=>e.code==='VERSION_CONFLICT');
});

test('count and materialized page share one repeatable-read snapshot during a concurrent withdrawal',async()=>{
  let removed=false;
  const hooked={...db,transaction:async<T>(work:(tx:PoolClient)=>Promise<T>)=>db.transaction(async tx=>{
    const wrapped={query:async(sql:string,values?:unknown[])=>{
      const result=await tx.query(sql,values);
      if(!removed&&sql.startsWith('SELECT count(*)::int AS total FROM vehicles')){removed=true;await db.pool.query('DELETE FROM external_catalog WHERE listing_id=$1',[externalIds[7]]);}
      return result;
    }} as PoolClient;
    return work(wrapped);
  })} as Database;
  const result=await new InventoryService(hooked,true).listPublic(query({pageSize:48}),'snapshot');
  assert.equal(removed,true);assert.equal(result.meta.total,11);assert.equal(result.data.items.length,11);
  assert.equal((await inventory.listPublic(query(),'current')).meta.total,10);
  assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM external_catalog_search')).rows[0].count,21);
});
