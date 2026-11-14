import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { PublicVehicleCardListSchema, PublicVehicleQuerySchema, type Locale } from '@hd/contracts/public';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { InventoryService } from '../src/vehicles/service.js';
import { ExternalStore } from '../src/external/store.js';
import { applyFullSource, bindAlias, ensureMember } from '../src/external/full-sync/apply.js';
import { configureFullSync } from '../src/external/full-sync/engine.js';
import type { Source } from '../src/external/full-sync/types.js';
import type { SourceDocument } from '../src/external/sources/index.js';

// Real projection/canonical SQL against this suite's random database only. No worker client, HTTP or provider calls.
test('full-source apply preserves staff edits and promotes an active canonical backup without duplicate listings',async t=>{
  const address=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(address.protocol)||address.hostname!=='127.0.0.1'||address.pathname!=='/postgres'||address.search||address.hash)
    throw new Error('Projection tests require local maintenance PostgreSQL without options.');
  const socket=process.env.API_TEST_DATABASE_SOCKET;
  if(socket){if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${address.port||'5432'}`))).isSocket())throw new Error('An existing local PostgreSQL socket is required.');address.searchParams.set('host',socket);}
  const name=`hd_ext_full_projection_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(address.toString(),1);
  let db:Database|undefined,created=false;
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;address.pathname=`/${name}`;db=createDatabase(address.toString(),3);
    const database=db;await migrateDatabase(database);
    const actor={id:'full-projection-admin',requestId:randomUUID()};
    await database.pool.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Synthetic projection operator','full-projection@example.invalid','admin',false)",[actor.id]);
    await configureFullSync(database,actor,'full');
    const inventory=new InventoryService(database,true),store=new ExternalStore(database),batchId=randomUUID();
    const at='2026-11-14T00:00:00.000Z';
    const locales=['zh','en','ru'] as const;
    const sourceIds={che168:'900001',dongchedi:'900002'};
    const documents=(source:Source):SourceDocument[]=>locales.map((locale):SourceDocument=>({
      identity:{provider:'chinacarapi',source,externalId:sourceIds[source]},kind:'detail',locale,observedAt:at,sourceUpdatedAt:at,
      payload:{source,id:sourceIds[source],status:'active',updatedAt:at,
        url:source==='che168'?`https://www.che168.com/dealer/1/${sourceIds[source]}.html`:`https://www.dongchedi.com/usedcar/${sourceIds[source]}`,
        title:{zh:'合成测试车辆',en:'Synthetic projection vehicle',ru:'Синтетический тестовый автомобиль'}[locale],
        description:{zh:'仅供隔离测试',en:'Isolated test only',ru:'Только изолированный тест'}[locale],
        make:{id:'fixture-make',name:'Example',nameZh:'示例'},model:{id:'fixture-model',name:'Model',nameZh:'测试车型'},
        trim:{id:'fixture-trim',name:'Variant',nameZh:'测试配置'},modelYear:2024,manufactureDate:'2024-02',firstRegistration:'2024-03',
        mileageKm:12000,price:{cny:70000},fuel:'Petrol',transmission:'Automatic',powerKw:100,powerHp:136,
        specs:{displacementCc:1998},photos:['https://erscglobal2.autoimg.cn/synthetic-full-projection.jpg'],hasInspectionReport:false,
        seller:{phone:'PRIVATE_SELLER_PHONE_MARKER'},unknownPrivate:{secret:'PRIVATE_FULL_RAW_MARKER'},
      },
    }));
    // These are the real worker's pre-apply membership updates. The applier and all projections remain real.
    const apply=(source:Source,operation:'upsert'|'withdraw'='upsert')=>database.transaction(async tx=>{
      const member=await ensureMember(tx,source,sourceIds[source]);
      await tx.query(`UPDATE external_full_members SET state=$3,locales=$4,applied_generation=desired_generation,last_detail_at=$5
        WHERE source=$1 AND external_id=$2`,[source,sourceIds[source],operation==='withdraw'?'withdrawn':'active',[...locales],at]);
      await applyFullSource(tx,{source,externalId:sourceIds[source],canonicalId:member.canonical_id,operation,
        documents:operation==='upsert'?documents(source):[],at,batchId});
      return member.canonical_id as string;
    });
    const listing=(source:Source)=>database.pool.query<{id:string;formal_canonical_id:string;formal_primary:boolean;upstream_state:string}>(
      "SELECT id,formal_canonical_id,formal_primary,upstream_state FROM external_listings WHERE provider='chinacarapi' AND platform_id=$1 AND external_id=$2",[source,sourceIds[source]]).then(result=>result.rows[0]!);
    const visible=async(locale:Locale)=>PublicVehicleCardListSchema.parse(await inventory.listPublic(PublicVehicleQuerySchema.parse({locale,view:'localized',projection:'card'}),'synthetic-projection'));
    const assertPublic=async(expected:string)=>{
      for(const locale of locales){
        const page=await visible(locale);assert.equal(page.meta.total,1);assert.deepEqual(page.data.items.map(item=>item.id),[`ext-${expected}`]);
        const detail=await inventory.getPublic(`ext-${expected}`,locale,'localized');
        assert.equal(detail.id,`ext-${expected}`);assert.equal(detail.source.kind,'external');
        for(const value of [page,detail])assert.doesNotMatch(JSON.stringify(value),/PRIVATE_FULL_RAW_MARKER|PRIVATE_SELLER_PHONE_MARKER|unknownPrivate|source_data|full-projection-admin/);
      }
    };
    let canonical='',primaryId='',backupId='';
    let primaryOverrides:unknown,backupOverrides:unknown;

    await t.test('first qualified source owns the canonical representative and all three public locales',async()=>{
      canonical=await apply('che168');const first=await listing('che168');primaryId=first.id;
      assert.equal(first.formal_primary,true);assert.equal(first.formal_canonical_id,canonical);await assertPublic(primaryId);
      const bound=(await database.pool.query('SELECT source,external_id FROM external_canonical_bindings WHERE canonical_id=$1',[canonical])).rows;
      assert.deepEqual(bound,[{source:'che168',external_id:sourceIds.che168}]);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_vehicle_extras WHERE listing_id=$1',[primaryId])).rows[0].n,3);
    });
    await t.test('verified second-source alias remains private while original staff corrections survive refresh',async()=>{
      await database.transaction(async tx=>{
        await ensureMember(tx,'dongchedi',sourceIds.dongchedi);
        await bindAlias(tx,'dongchedi',sourceIds.dongchedi,{source:'che168',id:sourceIds.che168},at);
      });
      assert.equal(await apply('dongchedi'),canonical);const second=await listing('dongchedi');backupId=second.id;
      assert.notEqual(primaryId,backupId);assert.equal(second.formal_primary,false);assert.equal(second.formal_canonical_id,canonical);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_catalog')).rows[0].n,1);
      for(const [id,title,mileage] of [[primaryId,'Employee primary title',9100],[backupId,'Employee backup title',8200]] as const){
        const current=await store.getListing(`ext-${id}`,'en');assert.ok(current.sourceHashes.title);
        const overrides={hidden:false,facts:{mileageKm:mileage},text:[{field:'title' as const,locale:'en' as const,text:title,sourceHash:current.sourceHashes.title!}]};
        await store.saveOverrides(`ext-${id}`,{version:current.version,overrides},randomUUID(),actor);
        if(id===primaryId)primaryOverrides=overrides;else backupOverrides=overrides;
      }
      await apply('che168');await apply('dongchedi');
      assert.equal((await listing('che168')).id,primaryId);assert.equal((await listing('dongchedi')).id,backupId);
      assert.deepEqual((await store.getListing(`ext-${primaryId}`,'en')).overrides,primaryOverrides);
      assert.deepEqual((await store.getListing(`ext-${backupId}`,'en')).overrides,backupOverrides);
      const primary=(await visible('en')).data.items[0]!;assert.equal(primary.content.title.text,'Employee primary title');assert.equal(primary.content.title.kind,'human');assert.equal(primary.facts.mileageKm,9100);
      await assertPublic(primaryId);
    });
    await t.test('withdrawn representative promotes the already existing active backup atomically',async()=>{
      await apply('che168','withdraw');
      assert.equal((await listing('che168')).upstream_state,'withdrawn');assert.equal((await listing('che168')).formal_primary,false);
      const backup=await listing('dongchedi');assert.equal(backup.id,backupId);assert.equal(backup.upstream_state,'active');assert.equal(backup.formal_primary,true);
      const bindings=(await database.pool.query('SELECT source,external_id FROM external_canonical_bindings WHERE canonical_id=$1',[canonical])).rows;
      assert.deepEqual(bindings,[{source:'dongchedi',external_id:sourceIds.dongchedi}]);
      await assertPublic(backupId);await assert.rejects(inventory.getPublic(`ext-${primaryId}`,'en','localized'),(error:any)=>error.status===404);
      const current=(await visible('en')).data.items[0]!;assert.equal(current.content.title.text,'Employee backup title');assert.equal(current.facts.mileageKm,8200);
      assert.deepEqual((await store.getListing(`ext-${primaryId}`,'en')).overrides,primaryOverrides);
      assert.deepEqual((await store.getListing(`ext-${backupId}`,'en')).overrides,backupOverrides);
    });
    await t.test('replayed withdrawal and backup refresh retain both source UUIDs and a single public representative',async()=>{
      for(let attempt=0;attempt<2;attempt++){await apply('che168','withdraw');await apply('dongchedi');}
      assert.equal((await listing('che168')).id,primaryId);assert.equal((await listing('dongchedi')).id,backupId);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_listings')).rows[0].n,2);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_catalog')).rows[0].n,1);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_canonical_bindings')).rows[0].n,1);
      assert.equal((await database.pool.query('SELECT count(DISTINCT canonical_id)::int AS n FROM external_full_members')).rows[0].n,1);
      assert.deepEqual((await store.getListing(`ext-${backupId}`,'en')).overrides,backupOverrides);
      await assertPublic(backupId);
    });
  } finally {
    await db?.close();try{if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);}finally{await maintenance.close();}
  }
});
