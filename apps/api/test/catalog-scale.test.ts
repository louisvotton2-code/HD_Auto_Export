import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {PublicVehicleQuerySchema,PublicFilterQuerySchema} from '@hd/contracts/public';
import {makeVehicleDraftFixture,makePublicVehicleFixture,makeExternalCandidateFixture} from '@hd/contracts/fixtures';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {InventoryService} from '../src/vehicles/service.js';
import {externalFacets} from '../src/external/catalog.js';
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
    const empty=await externalFacets(tx,filters({make:'missing_make'}));
    assert.deepEqual(empty,[{kind:'total',id:null,name:null,make_id:null,model_id:null,count:0}]);
  } finally {await tx.query('ROLLBACK');tx.release();}
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
