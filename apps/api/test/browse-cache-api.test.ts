import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { makeExternalCandidateFixture, makePublicVehicleFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { CATALOG_SEARCH_TERM_TOO_SHORT, InternalPublicBrowseGenerationResponseSchema } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { applyFormalCandidate } from '../src/external/store.js';

async function createBrowseFixture(t:TestContext,useFence=false) {
  const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:','postgresql:'].includes(address.protocol) || address.hostname!=='127.0.0.1' ||
    address.pathname!=='/postgres' || address.search || address.hash) throw new Error('Only isolated loopback PostgreSQL is supported.');
  const name = 'hd_browse_api_'+randomBytes(8).toString('hex');
  const maintenance = createDatabase(address.href,1);
  address.pathname='/'+name;
  const media=await mkdtemp(path.join(tmpdir(),'hd-browse-cache-'));
  const fence=path.join(media,'generation');
  const secret='synthetic-browse-cache-service-secret';
  let created=false, runtime:Awaited<ReturnType<typeof buildApp>>|undefined;
  t.after(async()=>{
    try { await runtime?.app.close(); }
    finally {
      try { if(created)await maintenance.pool.query('DROP DATABASE "'+name+'" WITH (FORCE)'); }
      finally { await maintenance.close(); await rm(media,{recursive:true,force:true}); }
    }
  });
  await maintenance.pool.query('CREATE DATABASE "'+name+'"');
  created=true;
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:address.href,AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:media,
    HD_DEPLOYMENT_ENV:'test',HD_RELEASE_ID:'b'.repeat(40),CATALOG_READ_MODE:'combined',PUBLIC_CATALOG_CACHE:'memory',
    PUBLIC_BROWSE_CACHE_ENABLED:'true',TRUST_PROXY:'192.0.2.10/32',...(useFence?{HD_BROWSE_GENERATION_FILE:fence}:{})});
  const start=()=>buildApp({...config,ssrService:{secret,peers:['192.0.2.10/32']}});
  const {app,db}=runtime=await start();
  await migrateDatabase(db);
  const manual=randomUUID(), publication=randomUUID(), draft=makeVehicleDraftFixture();
  const value={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images:makePublicVehicleFixture().images};
  const actor={id:'browse-cache-editor',requestId:randomUUID()};
  const fixture=makeExternalCandidateFixture();
  const supplier=await db.transaction(async tx=>{
    await tx.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Browse actor','browse@example.invalid','admin',false)",[actor.id]);
    await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[manual]);
    await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[manual,JSON.stringify(draft)]);
    await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,manual,JSON.stringify(value)]);
    await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[manual,publication]);
    const externalId='995723';
    const title={text:'Browse supplier fixture',contentLocale:'en'} as const;
    const supplier=await applyFormalCandidate(tx,{...fixture,externalId,platformId:'che168',
      listingUrl:`https://www.che168.com/dealer/1/${externalId}.html`,relatedListingUrls:[],images:[],inspection:null,
      copy:{...fixture.copy,title:{original:title,translations:{}}}},actor,randomUUID(),
      {id:`chinacarapi:che168:${externalId}`,primary:true});
    const sections=(await tx.query('SELECT sections FROM home_config WHERE id=1')).rows[0].sections;
    sections[0].vehicleIds=[manual];
    await tx.query('UPDATE home_config SET sections=$1,version=version+1 WHERE id=1',[JSON.stringify(sections)]);
    return supplier.listingId;
  });
  const source='ext-'+supplier;
  const publicPrefix='/api/v1', internalPrefix='/internal/public-catalog';
  let n=0;
  const call=(route:string,headers:Record<string,string>={},internal=false)=>runtime!.app.inject({
    url:(internal?internalPrefix:publicPrefix)+route,remoteAddress:internal?'192.0.2.10':'198.51.100.'+(++n%240+1),
    headers:internal?{'x-hd-ssr-key':secret,'x-forwarded-for':'198.51.100.'+(++n%240+1),...headers}:headers,
  });
  const generation=async()=>InternalPublicBrowseGenerationResponseSchema.parse((await call('/browse-generation',{},true)).json()).data.generation;
  const writeFence=async(value:string)=>{
    const nextFence=fence+'.next';
    await writeFile(nextFence,value,{mode:0o644,flag:'wx'});
    await rename(nextFence,fence);
  };
  return {app,db,manual,supplier,source,fixture,call,generation,internalPrefix,fence,writeFence,
    async restart(){ await runtime!.app.close(); runtime=undefined; runtime=await start(); }};
}

test('short unscoped English and Russian catalog searches return 400 before any database or browse access', async t => {
  const {db, call, fixture}=await createBrowseFixture(t);
  for (const path of ['/vehicles', '/vehicle-filters']) {
    for (const internal of [false, true]) {
      const headers:Record<string,string>=internal?{'x-hd-browse-policy':'browse-600-v1'}:{};
      const request=(locale:string,q:string,filters='')=>call(`${path}?locale=${locale}&view=localized&q=${encodeURIComponent(q)}${filters}`,headers,internal);
      const connect=t.mock.method(db.pool,'connect',()=>{throw new Error('unexpected database access');});
      try {
        for (const [locale,q] of [['en','  EV  '], ['ru','Ю-В'], ['ru','__']] as const) {
          const result=await request(locale,q);
          assert.equal(result.statusCode,400,result.body);
          assert.equal(result.json().error.code,CATALOG_SEARCH_TERM_TOO_SHORT);
          assert.equal(result.headers['x-hd-browse-policy'],undefined);
          assert.equal(result.headers['cache-control'],'no-store');
        }
        assert.equal(connect.mock.callCount(),0);
      } finally {connect.mock.restore();}
      const make=encodeURIComponent(fixture.facts.make!.id);
      for (const [locale,q,filters] of [['en','EV',`&make=${make}`], ['zh','海狮',''], ['ru','HX1',''], ['en','   ','']] as const) {
        const result=await request(locale,q,filters);
        assert.equal(result.statusCode,200,result.body);
      }
    }
  }
});

test('anonymous browse API shares a fenced snapshot and direct detail still follows supplier updates', async t => {
  const {app,db,manual,supplier,source,fixture,call,generation,internalPrefix}=await createBrowseFixture(t);
  const combination='locale=zh&catalog=curated&view=localized';
  const list='/vehicles?'+combination+'&page=1&pageSize=1&projection=card';
  const next=list.replace('page=1','page=2');
  const query=list+'&q='+encodeURIComponent(fixture.facts.make!.name);
  const facets='/vehicle-filters?'+combination+'&projection=overview';
  const featured='/home/vehicles?locale=zh&view=localized';
  const ensureBrowse=(reply:Awaited<ReturnType<typeof call>>,expected:string)=>{
    assert.equal(reply.statusCode,200,reply.body);
    assert.equal(reply.headers['cache-control'],'no-store');
    assert.equal(reply.headers['x-hd-browse-policy'],'browse-600-v1');
    assert.equal(reply.headers['x-hd-browse-generation'],expected);
    assert.equal(reply.json().meta.catalogCache,undefined);
    assert.equal(Date.parse(String(reply.headers['x-hd-browse-expires-at']))-Date.parse(String(reply.headers['x-hd-browse-generated-at'])),600_000);
    return reply.json();
  };
  const originalGeneration=await generation();
  assert.equal((await app.inject({url:internalPrefix+'/browse-generation'})).statusCode,404);
  const listed=ensureBrowse(await call(list),originalGeneration);
  const second=ensureBrowse(await call(next),originalGeneration);
  assert.equal(listed.meta.total,2);
  const rowIds=[...listed.data.items,...second.data.items].map(row=>row.id);
  assert.deepEqual(new Set(rowIds),new Set([manual,source]));
  ensureBrowse(await call(query),originalGeneration);
  assert.equal(ensureBrowse(await call(facets),originalGeneration).data.total,2);
  assert.equal(ensureBrowse(await call(featured),originalGeneration).data.sections[0].vehicles[0].id,manual);
  const forwarded=await call(list,{'x-hd-browse-policy':'browse-600-v1'},true);
  assert.equal(ensureBrowse(forwarded,originalGeneration).meta.dataAsOf,listed.meta.dataAsOf);
  const old=await call(list,{},true);
  assert.equal(old.headers['x-hd-browse-generation'],undefined);
  assert.ok(old.json().meta.catalogCache);
  const bypassHeaders:Record<string,string>[]=[{cookie:'private=yes'},{authorization:'Bearer synthetic'},{range:'bytes=0-20'},
    {'if-none-match':'"example"'},{rsc:'1'}];
  for(const headers of bypassHeaders)
    assert.equal((await call(list,headers)).headers['x-hd-browse-policy'],undefined);
  assert.equal((await call(list+'&pagination=cursor')).headers['x-hd-browse-policy'],undefined);

  const details='/vehicles/'+source+'?locale=zh&view=localized';
  const original=await call(details);
  assert.equal(original.statusCode,200,original.body);
  assert.equal(original.headers['x-hd-browse-policy'],undefined);
  await db.pool.query('UPDATE external_catalog SET price_cny=65432 WHERE listing_id=$1',[supplier]);
  const repriced=await call(details);
  assert.equal(repriced.statusCode,200,repriced.body);
  assert.notDeepEqual(repriced.json().data.price,original.json().data.price);
  assert.equal((await call(next)).json().meta.dataAsOf,second.meta.dataAsOf);
  await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[supplier]);
  assert.equal((await call(details)).statusCode,404);
  assert.equal(await generation(),originalGeneration);
  assert.equal(ensureBrowse(await call(facets),originalGeneration).data.total,2);

  await db.pool.query("INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates) VALUES(1,'synthetic',now()-interval '1 hour',now()+interval '30 seconds',$1)",
    [JSON.stringify({USD:'1',CNY:'7'})]);
  const quoted=await call(list+'&priceView=usd');
  assert.equal(quoted.statusCode,200,quoted.body);
  const period=Date.parse(String(quoted.headers['x-hd-browse-expires-at']))-Date.parse(String(quoted.headers['x-hd-browse-generated-at']));
  assert.ok(period>0&&period<=30_000);

  await db.pool.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[manual]);
  const changed=await generation();
  assert.notEqual(changed,originalGeneration);
  assert.equal(ensureBrowse(await call(list),changed).meta.total,0);
  assert.equal(ensureBrowse(await call(facets),changed).data.total,0);
  assert.deepEqual(ensureBrowse(await call(featured),changed).data.sections,[]);
  assert.equal((await call('/vehicles/'+manual+'?locale=zh')).statusCode,404);
});

test('the OPS hold bypasses browse snapshots and persists through rollback and API restart', async t => {
  const {db,manual,supplier,call,generation,fence,writeFence,restart}=await createBrowseFixture(t,true);
  const policy={'x-hd-browse-policy':'browse-600-v1','x-hd-catalog-scope':'filters'};
  const locales=['zh','en','ru'];
  const browseHeaders=['x-hd-browse-policy','x-hd-browse-generation','x-hd-browse-generated-at','x-hd-browse-expires-at'];
  async function expectBrowse(stamp:string|null,total:number,showManual:boolean,multilingual=false) {
    for (const locale of multilingual?locales:['zh']) for (const internal of [false,true]) {
      const query=`locale=${locale}&catalog=curated&view=localized`;
      const [list,filters,home]=await Promise.all([
        call(`/vehicles?${query}&page=1&pageSize=24&projection=card`,policy,internal),
        call(`/vehicle-filters?${query}&projection=overview`,policy,internal),
        call(`/home/vehicles?locale=${locale}&view=localized`,policy,internal),
      ]);
      for (const reply of [list,filters,home]) {
        assert.equal(reply.statusCode,200,reply.body);
        assert.equal(reply.headers['cache-control'],'no-store');
        if (stamp) assert.equal(reply.headers['x-hd-browse-generation'],stamp);
        else for (const header of browseHeaders) assert.equal(reply.headers[header],undefined);
      }
      assert.equal(list.json().meta.total,total,locale);
      assert.equal(filters.json().data.total,total,locale);
      assert.equal(list.json().data.items.some((vehicle:{id:string})=>vehicle.id===manual),showManual,locale);
      assert.deepEqual(home.json().data.sections.flatMap((section:{vehicles:{id:string}[]})=>section.vehicles.map(vehicle=>vehicle.id)),
        showManual?[manual]:[],locale);
    }
  }
  const expectNoAuthority=async()=>{
    const reply=await call('/browse-generation',{},true);
    assert.equal(reply.statusCode,503,reply.body);
    assert.equal(reply.headers['cache-control'],'no-store');
    assert.equal(reply.json().data,undefined);
  };

  await writeFence('a'.repeat(32)+'\n');
  const original=await generation();
  await expectBrowse(original,2,true,true);

  // An ordinary supplier change should keep serving the old browse snapshot
  // while active. The exact same requests must become live on a local hold.
  await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[supplier]);
  assert.equal(await generation(),original);
  await expectBrowse(original,2,true);

  await writeFence('hold-'+'a'.repeat(32)+'\n');
  await expectNoAuthority();
  await expectBrowse(null,1,true,true);
  const rollback=new Error('synthetic archive rollback');
  await assert.rejects(db.transaction(async tx=>{
    await tx.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[manual]);
    throw rollback;
  }),error=>error===rollback);
  await expectBrowse(null,1,true);

  await writeFence('b'.repeat(32)+'\n');
  const resumed=await generation();
  assert.notEqual(resumed,original,'a new host token must retire the preceding snapshot even after rollback');
  await expectBrowse(resumed,1,true);
  await writeFence('malformed-generation\n');
  await expectNoAuthority();
  await expectBrowse(null,1,true);
  await rm(fence);
  await expectNoAuthority();
  await expectBrowse(null,1,true);

  await writeFence('hold-'+'b'.repeat(32)+'\n');
  await db.pool.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[manual]);
  await expectBrowse(null,0,false);
  await restart();
  await expectNoAuthority();
  await expectBrowse(null,0,false,true);

  await writeFence('c'.repeat(32)+'\n');
  const afterArchive=await generation();
  assert.notEqual(afterArchive,resumed);
  await expectBrowse(afterArchive,0,false,true);
});
