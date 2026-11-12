import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,rm,stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { makeVehicleDraftFixture,makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicCatalogCacheStampSchema } from '@hd/contracts/public';
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
    const call=async(route:string,internal=false)=>{
      const r=await app.app.inject({url:route,remoteAddress:internal?'192.0.2.10':`198.51.100.${++n%240+1}`,
        headers:internal?{'x-hd-ssr-key':secret,'x-forwarded-for':`198.51.100.${++n%240+1}`}:{}});
      assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');return r.json();
    };
    const version=()=>call('/internal/public-catalog/version',true);
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
      const v=(await version()).data;PublicCatalogCacheStampSchema.parse(v);
      for(const route of ['/vehicles?locale=zh','/vehicles/'+id+'?locale=zh','/vehicle-filters?locale=zh','/home/vehicles?locale=zh']){
        const publicResult=await call('/api/v1'+route),internal=await call('/internal/public-catalog'+route,true);
        assert.deepEqual(publicResult.data,internal.data);assert.equal(publicResult.meta.catalogCache.version,v.version);
        assert.equal(internal.meta.catalogCache.version,v.version);assert.notEqual(publicResult.meta.requestId,internal.meta.requestId);
        PublicCatalogCacheStampSchema.parse(internal.meta.catalogCache);
      }
      const denied=await app.app.inject({method:'POST',url:'/api/v1/admin/external/batches',payload:{}});assert.equal(denied.statusCode,404);
    });
    await t.test('rollback does not invalidate; committed inventory changes immediately invalidate all cached projections',async()=>{
      const before=(await version()).data.version;
      await assert.rejects(db.transaction(async tx=>{await tx.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[id]);throw new Error('rollback');}));
      assert.equal((await version()).data.version,before);
      await db.pool.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[id]);
      const changed=(await version()).data.version;assert.notEqual(changed,before);
      const list=await call('/api/v1/vehicles?locale=zh');assert.equal(list.meta.total,0);assert.equal(list.meta.accessibleTotal,0);
      assert.equal(list.meta.catalogCache.version,changed);assert.equal((await call('/api/v1/home/vehicles?locale=zh')).data.sections.length,0);
      assert.equal((await call('/api/v1/vehicles/'+id+'?locale=zh')).data.availability,'sold');
    });
    await t.test('offset guard precedes SQL and actual totals stay exact; cached DB loss fails closed',async()=>{
      const beyond=await app.app.inject({url:'/api/v1/vehicles?page=10002&pageSize=1'});assert.equal(beyond.statusCode,400);
      const boundary=await call('/api/v1/vehicles?page=10001&pageSize=1');assert.equal(boundary.meta.total,0);
      await db.pool.query('ALTER TABLE public_catalog_state RENAME TO rel03_hidden_state');
      try {
        for(const route of ['/api/v1/home/vehicles?locale=zh','/api/v1/vehicles?locale=zh']){
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
