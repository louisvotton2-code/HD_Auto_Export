import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,rm,stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { makeVehicleDraftFixture,makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { InternalPublicCatalogCacheStampSchema, InternalPublicCatalogHomepageVersionResponseSchema, InternalPublicHomepageCacheStampSchema,
  InternalPublicHomepageVersionResponseSchema, PublicCatalogCacheStampSchema } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { PgTranslationBudget } from '../src/vehicles/translation-budget.js';
import { VehicleTranslator } from '../src/vehicles/translation.js';

async function transport(url:URL) {
  const socket=process.env.API_TEST_DATABASE_SOCKET;if(!socket)return url.toString();
  if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('Expected a local PostgreSQL socket.');
  const value=new URL(url);value.searchParams.set('host',socket);return value.toString();
}
test('REL03 uses real committed versions and restart-safe quotas without external calls',async t=>{
  const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(base.protocol)||base.hostname!=='127.0.0.1'||base.pathname!=='/postgres'||base.search||base.hash)throw new Error('Only the local maintenance database is allowed.');
  const name=`hd_rel03_${randomBytes(8).toString('hex')}`,url=new URL(base);url.pathname=`/${name}`;
  const maintenance=createDatabase(await transport(base),2),media=await mkdtemp(path.join(tmpdir(),'hd-rel03-'));
  let runtime:Awaited<ReturnType<typeof buildApp>>|undefined,created=false;
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('No external network is allowed.');});
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;
    const dbUrl=await transport(url),secret='synthetic-ssr-secret-only-for-rel03-tests';
    const config=readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),MEDIA_ROOT:media,
      HD_DEPLOYMENT_ENV:'test',HD_RELEASE_ID:'a'.repeat(40),CATALOG_READ_MODE:'combined',PUBLIC_CATALOG_CACHE:'memory',TRUST_PROXY:'192.0.2.10/32'});
    const app=runtime=await buildApp({...config,databaseUrl:dbUrl,ssrService:{secret,peers:['192.0.2.10/32']}});await migrateDatabase(app.db);
    const {db}=app;let n=0;
    const call=async(route:string,internal=false,scopedFilters=false,extended=false)=>{
      const r=await app.app.inject({url:route,remoteAddress:internal?'192.0.2.10':`198.51.100.${++n%240+1}`,
        headers:{...(internal?{'x-hd-ssr-key':secret,'x-forwarded-for':`198.51.100.${++n%240+1}`,
          ...(scopedFilters?{'x-hd-catalog-scope':'filters'}:{})}:{}),...(extended?{'x-hd-cache-protocol':'2'}:{})}});
      assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');
      assert.equal(r.headers['x-hd-cache-protocol'],internal&&extended?'2':undefined);
      return r.json();
    };
    const version=(filters=false)=>call('/internal/public-catalog/version'+(filters?'?scope=filters':''),true);
    const advanceCatalog=async()=>{await db.pool.query('SELECT queue_public_catalog_metadata_change()');};
    const injectCatalog=(route:string,internal:boolean,offsetSnapshot=false,inlineSnapshot=false)=>app.app.inject({
      url:(internal?'/internal/public-catalog':'/api/v1')+route,
      remoteAddress:internal?'192.0.2.10':`198.51.100.${++n%240+1}`,
      headers:internal?{'x-hd-ssr-key':secret,'x-hd-cache-protocol':'2',
        'x-forwarded-for':`198.51.100.${++n%240+1}`,...(offsetSnapshot?{'x-hd-catalog-offset-snapshot':'1'}:{}),
        ...(inlineSnapshot?{'x-hd-catalog-inline-snapshot':'1'}:{})}:{},
    });
    const afterCatalogReads=async(context:TestContext,request:()=>ReturnType<typeof injectCatalog>,commits:(()=>Promise<void>)[])=>{
      await advanceCatalog(); // Force a miss even when this request was just served.
      const transaction=db.transaction;
      let reads=0;
      const hook=context.mock.method(db,'transaction',<T>(work:Parameters<typeof transaction<T>>[0])=>transaction<T>(tx=>{
        const wrapped=Object.create(tx) as typeof tx;
        let repeatableRead=false;
        wrapped.query=(async (text:string,values?:unknown[])=>{
          const result=await tx.query(text,values);
          if(text.includes('ISOLATION LEVEL REPEATABLE READ')) repeatableRead=true;
          if(repeatableRead&&text.includes('s.revision::text AS revision')&&reads<commits.length){
            // PostgreSQL has already fixed this transaction's snapshot. Commit on a separate connection.
            await commits[reads++]!();
          }
          return result;
        }) as typeof tx.query;
        return work(wrapped);
      }));
      try {
        const reply=await request();
        assert.equal(reads,commits.length,reply.body);
        return reply;
      } finally {hook.mock.restore();}
    };
    const id=randomUUID(),publication=randomUUID(),draft=makeVehicleDraftFixture();
    const snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images:makePublicVehicleFixture().images};
    await db.transaction(async tx=>{
      await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[id]);
      await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify(draft)]);
      await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,id,JSON.stringify(snapshot)]);
      await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[id,publication]);
      await tx.query('UPDATE home_config SET sections=$1,version=version+1 WHERE id=1',[JSON.stringify([{id:'featured',title:{zh:'精选',en:'Featured',ru:'Избранное'},vehicleIds:[id]},{id:'recent',title:{zh:'新车',en:'Recent',ru:'Новое'},vehicleIds:[]}])]);
    });
    await t.test('all four public and protected aliases bind the same DTO version and preserve request IDs',async()=>{
      const catalogVersion=(await version()).data, filterVersion=(await version(true)).data;
      assert.notEqual(catalogVersion.version,filterVersion.version);
      for(const route of ['/vehicles?locale=zh','/vehicles/'+id+'?locale=zh','/vehicle-filters?locale=zh',
        '/vehicle-filters?locale=zh&view=localized&projection=home-models','/home/vehicles?locale=zh']){
        const isFilter=route.startsWith('/vehicle-filters');
        const v=PublicCatalogCacheStampSchema.parse(isFilter?filterVersion:catalogVersion);
        const internalRoute='/internal/public-catalog'+route;
        const publicResult=await call('/api/v1'+route),internal=await call(internalRoute,true,isFilter);
        assert.deepEqual(publicResult.data,internal.data);assert.equal(publicResult.meta.catalogCache.version,v.version);
        assert.equal(internal.meta.catalogCache.version,v.version);assert.notEqual(publicResult.meta.requestId,internal.meta.requestId);
        PublicCatalogCacheStampSchema.parse(internal.meta.catalogCache);
        if (isFilter) {
          const legacy=await call(internalRoute,true);
          assert.deepEqual(legacy.data,internal.data);
          assert.equal(legacy.meta.catalogCache.version,catalogVersion.version);
          const unauthorized=await app.app.inject({url:internalRoute,headers:{'x-hd-catalog-scope':'filters'}});
          assert.equal(unauthorized.statusCode,404);
        }
      }
      const denied=await app.app.inject({method:'POST',url:'/api/v1/admin/external/batches',payload:{}});assert.equal(denied.statusCode,404);
    });
    await t.test('only trusted v2 callers receive the longer stamp, preserving both live version scopes',async()=>{
      const paths=['/vehicles?locale=zh','/vehicles?locale=zh&view=localized&projection=card',
        '/vehicles/'+id+'?locale=zh','/vehicles/'+id+'?locale=zh&view=localized&projection=detail-inline-v1',
        '/vehicle-filters?locale=zh&view=localized&projection=home-models','/home/vehicles?locale=zh'];
      const control='/internal/public-catalog/version';
      const global=(await call(control,true,false,true)).data;
      const facets=(await call(control+'?scope=filters',true,false,true)).data;
      for(const raw of [global,facets]) {
        const stamp=InternalPublicCatalogCacheStampSchema.parse(raw);
        assert.equal(Date.parse(stamp.validUntil)-Date.parse(stamp.checkedAt),300_000);
      }
      for(const path of paths) {
        const scoped=path.startsWith('/vehicle-filters');
        const expected=scoped?facets:global;
        const internalPath='/internal/public-catalog'+path;
        const long=await call(internalPath,true,scoped,true);
        const old=await call(internalPath,true,scoped);
        const publicResult=await call('/api/v1'+path,false,false,true);
        const longStamp=InternalPublicCatalogCacheStampSchema.parse(long.meta.catalogCache);
        assert.equal(longStamp.version,expected.version);
        const duration=Date.parse(longStamp.validUntil)-Date.parse(longStamp.checkedAt);
        assert.ok(duration>299_000&&duration<=300_000);
        for (const result of [old,publicResult]) {
          assert.equal(PublicCatalogCacheStampSchema.parse(result.meta.catalogCache).version,expected.version);
          assert.deepEqual(result.data,long.data);
        }
      }
      const denied=await app.app.inject({url:control,headers:{'x-hd-cache-protocol':'2'}});
      assert.equal(denied.statusCode,404);
      assert.equal(denied.headers['x-hd-cache-protocol'],undefined);
    });
    await t.test('protocol 3 extends only authenticated USD homepage proofs',async()=>{
      const privatePrefix='/internal/public-catalog';
      const base='?locale=zh&view=localized&priceView=usd';
      const bundlePath='/version?priceView=usd&scope=homepage';
      const routes=['/home/vehicles'+base,
        '/vehicle-filters'+base+'&projection=overview','/vehicle-filters'+base+'&projection=home-models'];
      const request=(route:string,protocol:string,scope=true,prefix=privatePrefix)=>app.app.inject({
        url:prefix+route,remoteAddress:'192.0.2.10',headers:{'x-hd-ssr-key':secret,'x-hd-cache-protocol':protocol,
          'x-forwarded-for':`198.51.100.${++n%240+1}`,...(scope?{'x-hd-catalog-scope':'filters'}:{})},
      });
      const duration=(stamp:{checkedAt:string;validUntil:string})=>Date.parse(stamp.validUntil)-Date.parse(stamp.checkedAt);
      const bundled=await request(bundlePath,'3');
      assert.equal(bundled.statusCode,200,bundled.body);
      assert.equal(bundled.headers['x-hd-cache-protocol'],'3');
      const revisions=InternalPublicHomepageVersionResponseSchema.parse(bundled.json()).data;
      assert.equal(duration(revisions.catalog),600_000);
      assert.equal(duration(revisions.filters),600_000);
      for (const [index,route] of routes.entries()) {
        const legacy=await request(route,'2');
        const longer=await request(route,'3');
        const legacyAgain=await request(route,'2');
        for (const [response,protocol,maximum] of [[legacy,'2',300_000],[longer,'3',600_000],[legacyAgain,'2',300_000]] as const) {
          assert.equal(response.statusCode,200,response.body);
          assert.equal(response.headers['x-hd-cache-protocol'],protocol);
          const stamp=(protocol==='3'?InternalPublicHomepageCacheStampSchema:InternalPublicCatalogCacheStampSchema).parse(response.json().meta.catalogCache);
          assert.equal(stamp.version,index===0?revisions.catalog.version:revisions.filters.version);
          assert.ok(duration(stamp)>maximum-2_000&&duration(stamp)<=maximum);
          assert.deepEqual(response.json().data,legacy.json().data);
        }
        const publicResult=await request(route,'3',true,'/api/v1');
        assert.equal(publicResult.headers['x-hd-cache-protocol'],undefined);
        assert.ok(duration(PublicCatalogCacheStampSchema.parse(publicResult.json().meta.catalogCache))<=15_000);
      }
      for (const [route,scope] of [[routes[1]!+'&yearMin=2020',true], [routes[1]!,false],
        ['/vehicles'+base+'&projection=card',true],['/version?priceView=usd',true]] as const) {
        const result=await request(route,'3',scope);
        assert.equal(result.statusCode,200,result.body);
        assert.equal(result.headers['x-hd-cache-protocol'],undefined);
        const stamp=PublicCatalogCacheStampSchema.parse(result.json().meta.catalogCache??result.json().data);
        assert.ok(duration(stamp)<=15_000);
      }
      const denied=await app.app.inject({url:privatePrefix+bundlePath,headers:{'x-hd-cache-protocol':'3'}});
      assert.equal(denied.statusCode,404);
      assert.equal(denied.headers['x-hd-cache-protocol'],undefined);
      await advanceCatalog();
      const updated=InternalPublicHomepageVersionResponseSchema.parse((await request(bundlePath,'3')).json()).data;
      assert.notEqual(updated.catalog.version,revisions.catalog.version);
      assert.equal(updated.filters.version,revisions.filters.version);
    });
    await t.test('bundled homepage versions see current catalog, independent filters and one FX quote',async()=>{
      const root='/internal/public-catalog/version?priceView=usd';
      const bundle=async()=>InternalPublicCatalogHomepageVersionResponseSchema.parse(await call(root+'&scope=homepage',true,false,true)).data;
      const before=await bundle();
      assert.equal(before.catalog.version,(await call(root,true,false,true)).data.version);
      assert.equal(before.filters.version,(await call(root+'&scope=filters',true,false,true)).data.version);
      await advanceCatalog();
      const revised=await bundle();
      assert.notEqual(revised.catalog.version,before.catalog.version);
      assert.equal(revised.filters.version,before.filters.version);
      await db.pool.query("INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates) VALUES(1,'synthetic',now()-interval '1 hour',now()+interval '24 hours',$1)",
        [JSON.stringify({USD:'1',CNY:'7'})]);
      try {
        const priced=await bundle();
        assert.notEqual(priced.catalog.version,revised.catalog.version);
        assert.notEqual(priced.filters.version,revised.filters.version);
        assert.ok(priced.catalog.fx);
        assert.deepEqual(priced.catalog.fx,priced.filters.fx);
        assert.equal(priced.catalog.checkedAt,priced.filters.checkedAt);
        assert.equal(priced.catalog.validUntil,priced.filters.validUntil);
      } finally {await db.pool.query('DELETE FROM public_fx_quote WHERE id=1');}
    });
    await t.test('precise homepage proofs follow the rendered input rather than the global catalog revision',async context=>{
      const prefix='/internal/public-catalog';
      const resource='?locale=zh&view=localized&priceView=usd';
      const bundle='/version?priceView=usd&scope=homepage&locale=zh';
      const exact=(route=bundle,protocol='3',scope='exact-v1')=>app.app.inject({
        url:prefix+route,remoteAddress:'192.0.2.10',headers:{'x-hd-ssr-key':secret,'x-hd-cache-protocol':protocol,
          'x-hd-catalog-homepage':scope,'x-hd-catalog-scope':'filters','x-forwarded-for':`198.51.100.${++n%240+1}`},
      });
      const versions=async(route=bundle)=>{
        const result=await exact(route);
        assert.equal(result.statusCode,200,result.body);
        assert.equal(result.headers['x-hd-catalog-homepage'],'exact-v1');
        return InternalPublicHomepageVersionResponseSchema.parse(result.json()).data;
      };
      const ids=(data:ReturnType<typeof InternalPublicHomepageVersionResponseSchema.parse>['data'])=>[data.catalog.version,data.filters.version];
      const initial=await versions();
      for(const [suffix,scope] of [
        ['/home/vehicles'+resource,'catalog'],
        ['/vehicle-filters'+resource+'&projection=overview','filters'],
        ['/vehicle-filters'+resource+'&projection=home-models','filters'],
      ] as const) {
        const result=await exact(suffix);
        assert.equal(result.statusCode,200,result.body);
        assert.equal(result.headers['x-hd-catalog-homepage'],'exact-v1');
        assert.equal(result.json().meta.catalogCache.version,initial[scope].version);
      }
      assert.notEqual((await versions(bundle.replace('zh','en'))).catalog.version,initial.catalog.version);
      assert.equal((await exact(bundle,'2')).statusCode,400);
      assert.equal((await exact('/home/vehicles'+resource,'3','')).headers['x-hd-catalog-homepage'],undefined);
      const publicResult=await app.app.inject({url:'/api/v1/home/vehicles'+resource,headers:{'x-hd-cache-protocol':'3','x-hd-catalog-homepage':'exact-v1'}});
      assert.equal(publicResult.headers['x-hd-catalog-homepage'],undefined);

      await db.pool.query('SELECT queue_public_catalog_change()');
      assert.deepEqual(ids(await versions()),ids(initial));
      const other=randomUUID(),otherPublication=randomUUID();
      try {
        await db.transaction(async tx=>{
          await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[other]);
          await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',
            [otherPublication,other,JSON.stringify(snapshot)]);
          await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[other,otherPublication]);
        });
        const added=await versions();
        assert.equal(added.catalog.version,initial.catalog.version);
        assert.notEqual(added.filters.version,initial.filters.version);
        const models=await exact('/vehicle-filters'+resource+'&projection=home-models');
        assert.equal(models.json().data.models[0].count,2);
        const revisedPublication=randomUUID();
        await db.transaction(async tx=>{
          await tx.query(`INSERT INTO vehicle_publications(id,vehicle_id,data)
            SELECT $1,vehicle_id,jsonb_set(jsonb_set(data,'{facts,modelYear}','2021'::jsonb),
              '{price,money,amount}', '"31000.00"'::jsonb)
            FROM vehicle_publications WHERE id=$2`,[revisedPublication,otherPublication]);
          await tx.query('UPDATE vehicles SET published_revision_id=$2 WHERE id=$1',[other,revisedPublication]);
        });
        assert.deepEqual(ids(await versions()),ids(added));
        const overlapping=await afterCatalogReads(context,()=>exact(),[
          ()=>db.pool.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[id]).then(()=>{}),
        ]);
        assert.equal(overlapping.statusCode,200,overlapping.body);
        const withdrawn=await versions();
        assert.deepEqual(ids(InternalPublicHomepageVersionResponseSchema.parse(overlapping.json()).data),ids(withdrawn));
        assert.notEqual(withdrawn.catalog.version,added.catalog.version);
        assert.notEqual(withdrawn.filters.version,added.filters.version);
        assert.deepEqual((await exact('/home/vehicles'+resource)).json().data.sections,[]);
      } finally {
        await db.transaction(async tx=>{
          await tx.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[other]);
          await tx.query("UPDATE vehicles SET publication_state='published' WHERE id=$1",[id]);
        });
      }
    });
    await t.test('rollback does not invalidate; committed inventory changes immediately invalidate all cached projections',async()=>{
      const before=(await version()).data.version;
      const beforeFilter=(await version(true)).data.version;
      const homeModels='/api/v1/vehicle-filters?locale=zh&view=localized&projection=home-models';
      const featured=await call(homeModels);
      assert.equal(featured.meta.catalogCache.version,beforeFilter);
      assert.equal(featured.data.models[0]?.count,1);
      await assert.rejects(db.transaction(async tx=>{await tx.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[id]);throw new Error('rollback');}));
      assert.equal((await version()).data.version,before);
      assert.equal((await version(true)).data.version,beforeFilter);
      await db.pool.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[id]);
      const changed=(await version()).data.version;assert.notEqual(changed,before);
      const list=await call('/api/v1/vehicles?locale=zh');assert.equal(list.meta.total,0);assert.equal(list.meta.accessibleTotal,0);
      assert.equal(list.meta.catalogCache.version,changed);
      const updatedModels=await call(homeModels);
      const changedFilter=(await version(true)).data.version;
      assert.notEqual(changedFilter,beforeFilter);
      assert.equal(updatedModels.meta.catalogCache.version,changedFilter);
      assert.deepEqual(updatedModels.data.models,[]);
      for(const prefix of ['/api/v1','/internal/public-catalog']){
        const home=await call(`${prefix}/home/vehicles?locale=zh`,prefix.startsWith('/internal'));
        assert.equal(home.meta.catalogCache.version,changed);
        assert.deepEqual(home.data.sections.flatMap((section:{vehicles:Array<{id:string;availability:string}>})=>
          section.vehicles.map(vehicle=>[vehicle.id,vehicle.availability])),[[id,'sold']]);
      }
      assert.equal((await call('/api/v1/vehicles/'+id+'?locale=zh')).data.availability,'sold');
    });
    await t.test('an overlapping inventory commit returns the filter snapshot once and the following read sees the commit',async context=>{
      await db.pool.query("UPDATE vehicles SET availability='available' WHERE id=$1",[id]);
      const transaction=db.transaction;
      let wrote=false;
      const hook=context.mock.method(db,'transaction',<T>(work:Parameters<typeof transaction<T>>[0])=>transaction<T>(tx=>{
        const wrapped=Object.create(tx) as typeof tx;
        wrapped.query=(async (text:string,values?:unknown[])=>{
          const result=await tx.query(text,values);
          if (!wrote && text.includes('s.filter_revision::text AS revision')) {
            await db.pool.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[id]);
            wrote=true;
          }
          return result;
        }) as typeof tx.query;
        return work(wrapped);
      }));
      const route='/api/v1/vehicle-filters?locale=zh&view=localized&projection=overview-models';
      const overlapped=await call(route);
      hook.mock.restore();
      assert.equal(wrote,true);
      assert.equal(overlapped.data.total,1);
      assert.equal(overlapped.meta.catalogCache,undefined);
      const next=await call(route);
      assert.equal(next.data.total,0);
      assert.equal(next.meta.catalogCache.version,(await version(true)).data.version);
    });
    await t.test('list, detail and home use the actual PostgreSQL snapshot after a pre-read commit',async context=>{
      await db.pool.query("UPDATE vehicles SET availability='available' WHERE id=$1",[id]);
      const transaction=db.transaction;
      let starts=0;
      const hook=context.mock.method(db,'transaction',async <T>(work:Parameters<typeof transaction<T>>[0])=>{
        starts++;
        // Commit an inventory metadata version between the cache lookup and every actual read.
        await db.pool.query('SELECT queue_public_catalog_metadata_change()');
        return transaction<T>(work);
      });
      try {
        for(const route of ['/vehicles?locale=ru&view=localized&pagination=cursor','/vehicles/'+id+'?locale=ru','/home/vehicles?locale=ru']) {
          for(const internal of [false,true]) {
            const prefix=internal?'/internal/public-catalog':'/api/v1';
            const before=starts;
            const returned=await call(prefix+route,internal,false,internal);
            assert.equal(starts,before+1);
            assert.equal(returned.meta.catalogCache.version,(await version()).data.version);
            const warm=await call(prefix+route,internal,false,internal);
            assert.equal(starts,before+1);
            assert.deepEqual(warm.data,returned.data);
          }
        }
      } finally {hook.mock.restore();}
    });
    await t.test('offset pages reopen once, keep the resulting withdrawal and negotiate an unstamped SSR response',async context=>{
      const query='?locale=zh&view=localized&projection=card';
      const legacy={ 'x-hd-ssr-key':secret,'x-hd-cache-protocol':'2' };
      const negotiated={...legacy,'x-hd-catalog-offset-snapshot':'1'};
      const cases=[
        {url:'/api/v1/vehicles'+query,headers:{},status:200,total:0,withdraw:true},
        {url:'/internal/public-catalog/vehicles'+query,headers:negotiated,status:200,total:1},
        {url:'/internal/public-catalog/vehicles'+query,headers:legacy,status:503},
        {url:'/internal/public-catalog/vehicles'+query+'&pagination=cursor',headers:negotiated,status:503},
      ];
      const transaction=db.transaction;
      for(const item of cases){
        await db.pool.query("UPDATE vehicles SET availability='available' WHERE id=$1",[id]);
        await db.pool.query('SELECT queue_public_catalog_metadata_change()');
        let reads=0;
        const hook=context.mock.method(db,'transaction',<T>(work:Parameters<typeof transaction<T>>[0])=>transaction<T>(tx=>{
          const wrapped=Object.create(tx) as typeof tx;
          wrapped.query=(async (text:string,values?:unknown[])=>{
            const result=await tx.query(text,values);
            if(reads<2&&text.includes('s.revision::text AS revision')){
              if(++reads===1&&item.withdraw) await db.pool.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[id]);
              else await db.pool.query('SELECT queue_public_catalog_metadata_change()');
            }
            return result;
          }) as typeof tx.query;
          return work(wrapped);
        }));
        const response=await app.app.inject({url:item.url,headers:item.headers,
          remoteAddress:item.url.startsWith('/internal')?'192.0.2.10':'198.51.100.50'}).finally(()=>hook.mock.restore());
        assert.equal(response.statusCode,item.status,response.body);
        assert.equal(reads,2);
        assert.equal(response.headers['cache-control'],'no-store');
        assert.equal(response.json().meta.catalogCache,undefined);
        const confirmation=response.headers['x-hd-catalog-offset-snapshot'];
        if(item.status===200&&item.headers===negotiated) {
          assert.equal(typeof confirmation,'string');
          assert.equal(InternalPublicCatalogCacheStampSchema.parse(JSON.parse(confirmation as string)).priceView,'original');
        } else assert.equal(confirmation,undefined);
        if(item.status===200) {
          assert.equal(response.json().meta.total,item.total);
          assert.equal(response.json().data.items.length,item.total);
        }
      }
    });
    await t.test('public and negotiated offset lists reject a vehicle archived after the second snapshot',async context=>{
      const route='/vehicles?locale=zh&view=localized&projection=card';
      const archive=async()=>{await db.pool.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[id]);};
      await db.pool.query("UPDATE vehicles SET availability='available' WHERE id=$1",[id]);
      for(const internal of [false,true]){
        const request=()=>injectCatalog(route,internal,true);
        const unrelated=await afterCatalogReads(context,request,[advanceCatalog,advanceCatalog]);
        assert.equal(unrelated.statusCode,200,unrelated.body);
        assert.equal(unrelated.headers['cache-control'],'no-store');
        assert.equal(unrelated.json().meta.catalogCache,undefined);
        assert.deepEqual(unrelated.json().data.items.map((vehicle:{id:string})=>vehicle.id),[id]);
        assert.equal(typeof unrelated.headers['x-hd-catalog-offset-snapshot'],internal?'string':'undefined');

        try {
          const changed=await afterCatalogReads(context,request,[advanceCatalog,archive]);
          assert.ok([200,503].includes(changed.statusCode),changed.body);
          assert.equal(changed.headers['cache-control'],'no-store');
          assert.ok(!changed.body.includes(id),changed.body);
          const fresh=await request();
          assert.equal(fresh.statusCode,200,fresh.body);
          assert.deepEqual(fresh.json().data.items,[]);
        } finally {await db.pool.query("UPDATE vehicles SET publication_state='published' WHERE id=$1",[id]);}
      }
    });
    await t.test('website inline detail follows the live version without serving an old Pixel setting or withdrawn vehicle',async context=>{
      const route=`/vehicles/${id}?locale=zh&view=localized&priceView=usd&projection=detail-inline-v1&titleView=english&pixelView=eligible`;
      const pixel=async(enabled:boolean)=>db.transaction(async tx=>{
        await tx.query(`INSERT INTO vehicle_pixel_settings(vehicle_id,pixel_enabled,version) VALUES($1,$2,2)
          ON CONFLICT(vehicle_id) DO UPDATE SET pixel_enabled=excluded.pixel_enabled,version=vehicle_pixel_settings.version+1`,[id,enabled]);
        await tx.query('SELECT queue_public_catalog_metadata_change()');
      });
      const archive=async()=>{await db.pool.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[id]);};
      await db.pool.query("INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates) VALUES(1,'synthetic',now()-interval '1 hour',now()+interval '24 hours',$1)",
        [JSON.stringify({USD:'1',CNY:'7'})]);
      try {
        for(const internal of [false,true]){
          await pixel(true);
          const request=()=>injectCatalog(route,internal,false,true);
          const liveStamp=async()=>InternalPublicCatalogCacheStampSchema.parse((await call('/internal/public-catalog/version?priceView=usd',true,false,true)).data);
          const assertDetail=async(reply:Awaited<ReturnType<typeof request>>,enabled:boolean,expectedVersion?:string)=>{
            assert.equal(reply.statusCode,200,reply.body);
            assert.equal(reply.headers['cache-control'],'no-store');
            assert.equal(reply.headers['x-hd-catalog-inline-snapshot'],internal?'1':undefined);
            const {data,meta}=reply.json();
            assert.equal(data.id,id);
            assert.equal(data.projection,'detail-inline-v1');
            assert.equal(data.pixelEnabled,enabled);
            const stampSchema=internal?InternalPublicCatalogCacheStampSchema:PublicCatalogCacheStampSchema;
            const stamp=stampSchema.parse(meta.catalogCache),live=await liveStamp();
            assert.equal(stamp.priceView,'usd');
            assert.ok(stamp.fx);
            assert.equal(stamp.version,expectedVersion??live.version);
            assert.deepEqual(stamp.fx,live.fx);
          };
          let verifiedVersion:string|undefined;
          const unrelated=await afterCatalogReads(context,request,[async()=>{
            await advanceCatalog();
            verifiedVersion=(await liveStamp()).version;
          },advanceCatalog]);
          // The second commit is unrelated and occurs after the proof snapshot has opened.
          assert.ok(verifiedVersion);
          assert.notEqual(verifiedVersion,(await liveStamp()).version);
          await assertDetail(unrelated,true,verifiedVersion);
          await assertDetail(await request(),true);

          const disabled=await afterCatalogReads(context,request,[()=>pixel(false)]);
          if(disabled.statusCode===200) await assertDetail(disabled,false);
          else {
            assert.equal(disabled.statusCode,503,disabled.body);
            assert.equal(disabled.json().data,undefined);
          }
          await assertDetail(await request(),false);

          try {
            const withdrawn=await afterCatalogReads(context,request,[archive]);
            assert.ok([404,503].includes(withdrawn.statusCode),withdrawn.body);
            assert.equal(withdrawn.json().data,undefined);
            const fresh=await request();
            assert.equal(fresh.statusCode,404,fresh.body);
          } finally {await db.pool.query("UPDATE vehicles SET publication_state='published' WHERE id=$1",[id]);}
        }
      } finally {
        await db.transaction(async tx=>{
          await tx.query('DELETE FROM vehicle_pixel_settings WHERE vehicle_id=$1',[id]);
          await tx.query('DELETE FROM public_fx_quote WHERE id=1');
          await tx.query('SELECT queue_public_catalog_metadata_change()');
        });
      }
    });
    await t.test('ordinary manual detail verifies the target once during unrelated catalog commits',async context=>{
      const route='/api/v1/vehicles/'+id+'?locale=zh&view=localized';
      await db.pool.query('SELECT queue_public_catalog_metadata_change()');
      const transaction=db.transaction;
      let detailReads=0,checks=0;
      const hook=context.mock.method(db,'transaction',<T>(work:Parameters<typeof transaction<T>>[0])=>transaction<T>(tx=>{
        const wrapped=Object.create(tx) as typeof tx;
        wrapped.query=(async (text:string,values?:unknown[])=>{
          const result=await tx.query(text,values);
          if(text.startsWith('SELECT v.*,p.data AS publication_data')&&text.includes('AS detail_guard')) {
            detailReads++;
            await db.pool.query('SELECT queue_public_catalog_metadata_change()');
            await db.pool.query('SELECT queue_public_catalog_metadata_change()');
          } else if(text.startsWith('SELECT jsonb_build_array')&&text.includes('AS detail_guard')) {
            checks++;
          }
          return result;
        }) as typeof tx.query;
        return work(wrapped);
      }));
      try {
        const result=await call(route);
        assert.equal(result.data.id,id);
        assert.equal(result.meta.catalogCache.version,(await version()).data.version);
        assert.deepEqual((await call(route)).data,result.data);
        assert.equal(detailReads,1);
        assert.equal(checks,1);
      } finally {hook.mock.restore();}
    });
    await t.test('a new publication in the detail read is loaded with its own price',async context=>{
      const route='/api/v1/vehicles/'+id+'?locale=zh&view=localized';
      const before=await call(route);
      const newPrice={kind:'asking',money:{currency:'CNY',amount:'99000.00'},includes:[]};
      await db.pool.query('SELECT queue_public_catalog_metadata_change()');
      const transaction=db.transaction;
      let republished=false;
      const hook=context.mock.method(db,'transaction',<T>(work:Parameters<typeof transaction<T>>[0])=>transaction<T>(tx=>{
        const wrapped=Object.create(tx) as typeof tx;
        wrapped.query=(async (text:string,values?:unknown[])=>{
          const result=await tx.query(text,values);
          if(!republished&&text.includes('s.revision::text AS revision')) {
            republished=true;
            const nextPublication=randomUUID();
            await transaction(async change=>{
              await change.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',
                [nextPublication,id,JSON.stringify({...snapshot,price:newPrice})]);
              await change.query('UPDATE vehicles SET published_revision_id=$2,published_at=now() WHERE id=$1',[id,nextPublication]);
            });
          }
          return result;
        }) as typeof tx.query;
        return work(wrapped);
      }));
      try {
        const result=await call(route);
        assert.equal(republished,true);
        assert.notDeepEqual(result.data.price,before.data.price);
        assert.deepEqual(result.data.price,newPrice);
        assert.equal(result.meta.catalogCache.version,(await version()).data.version);
      } finally {hook.mock.restore();}
    });
    await t.test('a withdrawal committed after the detail snapshot cannot escape in the response',async context=>{
      const route='/api/v1/vehicles/'+id+'?locale=zh';
      await call(route);
      // Ensure a cache miss so the fixture can arrange a real read/withdrawal race.
      await db.pool.query('SELECT queue_public_catalog_metadata_change()');
      const transaction=db.transaction;
      let withdrawn=false;
      const hook=context.mock.method(db,'transaction',<T>(work:Parameters<typeof transaction<T>>[0])=>transaction<T>(tx=>{
        const wrapped=Object.create(tx) as typeof tx;
        wrapped.query=(async (text:string,values?:unknown[])=>{
          const result=await tx.query(text,values);
          if(!withdrawn && text.includes('s.revision::text AS revision')) {
            await db.pool.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[id]);
            withdrawn=true;
          }
          return result;
        }) as typeof tx.query;
        return work(wrapped);
      }));
      try {
        const r=await app.app.inject({url:route});
        assert.equal(withdrawn,true);
        assert.equal(r.statusCode,404,r.body);
        assert.equal(r.json().meta.catalogCache,undefined);
        const list=await call('/api/v1/vehicles?locale=zh');
        assert.equal(list.meta.total,0);
        assert.deepEqual((await call('/api/v1/home/vehicles?locale=zh')).data.sections,[]);
      } finally {hook.mock.restore();}
    });
    await t.test('offset guard precedes SQL and actual totals stay exact; cached DB loss fails closed',async()=>{
      const beyond=await app.app.inject({url:'/api/v1/vehicles?page=10002&pageSize=1'});assert.equal(beyond.statusCode,400);
      const boundary=await call('/api/v1/vehicles?page=10001&pageSize=1');assert.equal(boundary.meta.total,0);
      await db.pool.query('ALTER TABLE public_catalog_state RENAME TO rel03_hidden_state');
      try {
        for(const route of ['/api/v1/home/vehicles?locale=zh','/api/v1/vehicles?locale=zh','/api/v1/vehicle-filters?locale=zh']){
          const r=await app.app.inject({url:route,remoteAddress:'198.51.100.241'});assert.equal(r.statusCode,503);assert.equal(r.json().meta.catalogCache,undefined);
        }
      } finally {await db.pool.query('ALTER TABLE rel03_hidden_state RENAME TO public_catalog_state');}
    });
    const usage=async()=>Number((await db.pool.query('SELECT coalesce(sum(characters),0) AS used FROM translation_budget_reservations')).rows[0].used);
    const reset=()=>db.pool.query('DELETE FROM translation_budget_reservations'); // Own random fixture only.
    await t.test('concurrent budget reservations serialize and retain failed provider attempts',async()=>{
      const a=new PgTranslationBudget(db),b=new PgTranslationBudget(db);
      const results=await Promise.allSettled([a.reserve(6,10),b.reserve(6,10)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await usage(),6);
      await reset();let calls=0;
      const translator=new VehicleTranslator({engineVersion:'fake:1',async translate(){calls++;throw new Error('unknown upstream');}},4,'libretranslate',new PgTranslationBudget(db));
      await assert.rejects(translator.withPlanSession(translate=>translate('测试','en')));assert.equal(await usage(),2);assert.equal(calls,1);
      const afterRestart=new VehicleTranslator({engineVersion:'fake:2',async translate(){calls++;return 'translated';}},2,'libretranslate',new PgTranslationBudget(db));
      await assert.rejects(afterRestart.withPlanSession(translate=>translate('新','en')),{code:'TRANSLATION_QUOTA_EXCEEDED'});assert.equal(calls,1);
    });
    await t.test('a killed translator child leaves its dispatched unknown attempt charged after a real component restart',async()=>{
      await reset();
      const source=`import {createDatabase} from './src/db/index.ts'; import {PgTranslationBudget} from './src/vehicles/translation-budget.ts'; import {VehicleTranslator} from './src/vehicles/translation.ts';
        const db=createDatabase(process.env.REL03_TEST_DB,1); globalThis.fetch=()=>{throw new Error('network forbidden')};
        const tr=new VehicleTranslator({engineVersion:'fake-crash',async translate(){console.log('DISPATCHED');await new Promise(()=>{});return 'never';}},2,'libretranslate',new PgTranslationBudget(db));
        setInterval(()=>{},1000);await tr.withPlanSession(fn=>fn('测试','en'));`;
      const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:process.cwd(),env:{...process.env,REL03_TEST_DB:dbUrl},stdio:['ignore','pipe','pipe']});
      let output='';const exit=once(child,'exit');
      try {
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Synthetic dispatch did not start.')),10000);
          child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('DISPATCHED')){clearTimeout(timer);resolve();}});
          child.once('exit',()=>{clearTimeout(timer);reject(new Error('Synthetic process exited before dispatch.'));});
        });
        child.kill('SIGKILL');await exit;assert.equal(await usage(),2);
        const restarted=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {createDatabase} from './src/db/index.ts';import {PgTranslationBudget} from './src/vehicles/translation-budget.ts';const db=createDatabase(process.env.REL03_TEST_DB,1);try{await new PgTranslationBudget(db).reserve(1,2);process.exitCode=2;}catch(e){if(e.code!=='TRANSLATION_QUOTA_EXCEEDED')process.exitCode=3;}finally{await db.close();}`],{cwd:process.cwd(),env:{...process.env,REL03_TEST_DB:dbUrl},stdio:'ignore'});
        const [code]=await once(restarted,'exit');assert.equal(code,0);assert.equal(await usage(),2);
      } finally {if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
    });
    await t.test('budget DB failure prevents dispatch; expired reservations do not block a new hour',async()=>{
      let calls=0;const tr=new VehicleTranslator({engineVersion:'fake-db-down',async translate(){calls++;return 'translated';}},10,'libretranslate',new PgTranslationBudget(db));
      await db.pool.query('ALTER TABLE translation_budget_reservations RENAME TO rel03_hidden_budget');
      try {await assert.rejects(tr.withPlanSession(fn=>fn('测试','en')),{code:'SERVICE_UNAVAILABLE'});assert.equal(calls,0);}
      finally {await db.pool.query('ALTER TABLE rel03_hidden_budget RENAME TO translation_budget_reservations');}
      await db.pool.query("UPDATE translation_budget_reservations SET reserved_at=clock_timestamp()-interval '2 hours'");
      await new PgTranslationBudget(db).reserve(2,2);assert.equal(await usage(),4);
    });
    await t.test('upgrade conservatively accounts for recent legacy segments without changing their receipts',async()=>{
      const plan=randomUUID();
      await db.pool.query("INSERT INTO staff(id,name,email) VALUES('legacy','Legacy','legacy@example.invalid')");
      await db.pool.query(`INSERT INTO translation_plans(id,vehicle_id,actor_id,plan,source_input,created_at,expires_at)
        VALUES($1,$2,'legacy','{}','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '10 minutes')`,[plan,id]);
      const rows=[['running',null,null],['succeeded','legacy output',null],['failed',null,'budget_exceeded'],['outcome_unknown',null,'outcome_unknown'],['running',null,null]];
      for(const [index,[state,text,failure]] of rows.entries()) await db.pool.query(`INSERT INTO translation_plan_segments
        (plan_id,field_ref,target_locale,segment_index,cache_key,state,translated_text,failure_code,updated_at)
        VALUES($1,'content.title','en',$2,$3,$4,$5,$6,clock_timestamp()-($7::int*interval '1 hour'))`,[plan,index,'b'.repeat(64),state,text,failure,index===4?2:0]);
      const before=(await db.pool.query('SELECT * FROM translation_plan_segments WHERE plan_id=$1 ORDER BY segment_index',[plan])).rows;
      const migration=await readFile(new URL('../migrations/0017_translation_budget.sql',import.meta.url),'utf8');
      await db.transaction(async tx=>{await tx.query('DROP TABLE translation_budget_reservations,translation_budget_state');await tx.query(migration);});
      assert.equal(await usage(),15000);
      assert.deepEqual((await db.pool.query('SELECT * FROM translation_plan_segments WHERE plan_id=$1 ORDER BY segment_index',[plan])).rows,before);
      await assert.rejects(new PgTranslationBudget(db).reserve(1,10000),{code:'TRANSLATION_QUOTA_EXCEEDED'});
    });
  } finally {await runtime?.app.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.close();await rm(media,{recursive:true,force:true});}
});
