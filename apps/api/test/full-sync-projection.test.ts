import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { mock,test } from 'node:test';
import { PublicFilterQuerySchema, PublicVehicleCardListSchema, PublicVehicleInlineSchema, PublicVehicleInspectionResponseSchema, PublicVehicleQuerySchema, type Locale } from '@hd/contracts/public';
import { ExternalListingListQuerySchema } from '@hd/contracts/admin';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { InventoryService } from '../src/vehicles/service.js';
import { ExternalStore } from '../src/external/store.js';
import { applyFullSource, bindAlias, ensureMember } from '../src/external/full-sync/apply.js';
import { configureFullSync, markFullSyncAccess } from '../src/external/full-sync/engine.js';
import { listExternalListings } from '../src/external/listings.js';
import type { Source } from '../src/external/full-sync/types.js';
import type { SourceDocument } from '../src/external/sources/index.js';
import {persistSourceDocument} from '../src/external/sources/index.js';
import {reprojectStoredInspections} from '../src/external/inspection-reproject.js';
import {VehicleEvidence} from '../src/vehicles/evidence.js';

// Real projection/canonical SQL against this suite's random database only. No worker client, HTTP or provider calls.
test('full-source apply preserves staff edits and promotes an active canonical backup without duplicate listings',async t=>{
  const network=mock.method(globalThis,'fetch',async()=>{throw new Error('Stored source projections must not request suppliers or translations');});
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
    await t.test('the inquiry migration backfills existing rows and advances beyond them', async () => {
      const sql = await readFile(new URL('../migrations/0027_external_inquiry_numbers.sql', import.meta.url), 'utf8');
      await database.transaction(async tx => {
        // A temporary legacy table shadows the migrated table for this connection only.
        await tx.query('CREATE TEMP TABLE external_listings(id uuid PRIMARY KEY, platform_id text, external_id text) ON COMMIT DROP');
        await tx.query('INSERT INTO pg_temp.external_listings(id) VALUES ($1), ($2)', [randomUUID(), randomUUID()]);
        await tx.query(sql);
        const before = await tx.query('SELECT inquiry_number::text FROM pg_temp.external_listings ORDER BY inquiry_number');
        assert.deepEqual(before.rows.map(row => row.inquiry_number), ['1', '2']);
        const inserted = await tx.query('INSERT INTO pg_temp.external_listings(id) VALUES ($1) RETURNING inquiry_number::text', [randomUUID()]);
        assert.equal(inserted.rows[0]!.inquiry_number, '3');
      });
    });
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
        alsoListedOn:[{url:'https://www.che168.com/dealer/1/900009.html'}],nameplate:{vin:'LHGCM82633A004352'},
        seller:{phone:'PRIVATE_SELLER_PHONE_MARKER'},unknownPrivate:{secret:'PRIVATE_FULL_RAW_MARKER'},
      },
    }));
    // These are the real worker's pre-apply membership updates. The applier and all projections remain real.
    const apply=(source:Source,operation:'upsert'|'withdraw'='upsert',reports:SourceDocument[] = [])=>database.transaction(async tx=>{
      const member=await ensureMember(tx,source,sourceIds[source]);
      await tx.query(`UPDATE external_full_members SET state=$3,locales=$4,applied_generation=desired_generation,last_detail_at=$5
        WHERE source=$1 AND external_id=$2`,[source,sourceIds[source],operation==='withdraw'?'withdrawn':'active',[...locales],at]);
      await applyFullSource(tx,{source,externalId:sourceIds[source],canonicalId:member.canonical_id,operation,
        documents:operation==='upsert'?[...documents(source),...reports]:[],at,batchId});
      return member.canonical_id as string;
    });
    const listing=(source:Source)=>database.pool.query<{id:string;inquiry_number:string;formal_canonical_id:string;formal_primary:boolean;upstream_state:string}>(
      "SELECT id,inquiry_number::text,formal_canonical_id,formal_primary,upstream_state FROM external_listings WHERE provider='chinacarapi' AND platform_id=$1 AND external_id=$2",[source,sourceIds[source]]).then(result=>result.rows[0]!);
    const visible=async(locale:Locale)=>PublicVehicleCardListSchema.parse(await inventory.listPublic(PublicVehicleQuerySchema.parse({locale,view:'localized',projection:'card'}),'synthetic-projection'));
    const assertPublic=async(expected:string)=>{
      const { inquiry_number } = (await database.pool.query('SELECT inquiry_number::text FROM external_listings WHERE id=$1', [expected])).rows[0]!;
      const inquiryCode = `HX${inquiry_number}`;
      for(const locale of locales){
        const page=await visible(locale);assert.equal(page.meta.total,1);assert.deepEqual(page.data.items.map(item=>item.id),[`ext-${expected}`]);
        const detail=await inventory.getPublic(`ext-${expected}`,locale,'localized');
        assert.deepEqual(detail.external?.detail?.relatedListingUrls, []);
        for (const vehicle of [page.data.items[0]!, detail]) {
          assert.equal(vehicle.id, `ext-${expected}`);
          assert.equal(vehicle.detailPath, `/${locale}/cars/ext-${expected}/`);
          assert.equal(vehicle.stockCode, inquiryCode);
          assert.deepEqual(vehicle.identifiers, { inquiryCode, sourceId: null, source: null, vin: 'LHGCM82633A004352' });
          assert.deepEqual(vehicle.source, { kind: 'external', platform: { id: 'external', name: 'External listing' }, listingUrl: null });
          assert.equal(vehicle.display?.platform.status, 'missing');
          assert.deepEqual(vehicle.price.money, { amount: '70000.00', currency: 'CNY' });
          assert.equal(vehicle.availability, 'unknown');
          assert.doesNotMatch(JSON.stringify(vehicle), /PRIVATE_FULL_RAW_MARKER|PRIVATE_SELLER_PHONE_MARKER|unknownPrivate|source_data|full-projection-admin|"(?:900001|900002|900009)"|che168\.com|dongchedi\.com/);
        }
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
    await t.test('the same exact inquiry code works in public and private search while historical references stay private', async () => {
      const primary = await listing('che168');
      const inquiryCode = `HX${primary.inquiry_number}`;
      const permanentId = `ext-${primary.id}`;
      const originalUrl = `https://www.che168.com/dealer/1/${sourceIds.che168}.html`;
      const hex = primary.id.replaceAll('-', '').toUpperCase();
      const oldCode = `HDX-${hex.slice(0, 12)}${hex.slice(-4)}`;
      const staff = await store.getListing(permanentId, 'en');
      assert.equal(staff.inquiryCode, inquiryCode);
      assert.equal(staff.identity.externalId, sourceIds.che168);
      assert.equal(staff.source?.listingUrl, originalUrl);
      assert.deepEqual(staff.source?.relatedListingUrls, ['https://www.che168.com/dealer/1/900009.html']);
      for (const q of [inquiryCode.toLowerCase(), oldCode, `che168-${sourceIds.che168}`, permanentId, originalUrl]) {
        const result = await listExternalListings(database, ExternalListingListQuerySchema.parse({ locale: 'en', q }));
        assert.deepEqual(result.items.map(item => [item.id, item.inquiryCode]), [[permanentId, inquiryCode]], q);
      }
      for (const [q, total] of [[inquiryCode.toLowerCase(), 1], [`che168-${sourceIds.che168}`, 0], ['HX9223372036854775808', 0]] as const) {
        const result = await inventory.listPublic(PublicVehicleQuerySchema.parse({ locale: 'en', view: 'localized', projection: 'card', q }), 'inquiry-lookup');
        assert.equal(result.meta.total, total, q);
        const filters = await inventory.filters(PublicFilterQuerySchema.parse({ locale: 'en', view: 'localized', q }));
        assert.equal(filters.total, total, q);
      }
      // The hint uses the UUID internally, even when the response no longer contains supplier identity.
      await markFullSyncAccess(database, primary.id);
      const lastAccessed = async () => (await database.pool.query('SELECT last_accessed_at FROM external_full_members WHERE source=$1 AND external_id=$2',
        ['che168', sourceIds.che168])).rows[0]!.last_accessed_at;
      const touched = await lastAccessed();
      assert.ok(touched instanceof Date);
      await markFullSyncAccess(database, primary.id);
      assert.deepEqual(await lastAccessed(), touched);
    });
    await t.test('verified second-source alias remains private while original staff corrections survive refresh',async()=>{
      await database.transaction(async tx=>{
        await ensureMember(tx,'dongchedi',sourceIds.dongchedi);
        await bindAlias(tx,'dongchedi',sourceIds.dongchedi,{source:'che168',id:sourceIds.che168},at);
      });
      assert.equal(await apply('dongchedi'),canonical);const second=await listing('dongchedi');backupId=second.id;
      assert.notEqual(primaryId,backupId);assert.equal(second.formal_primary,false);assert.equal(second.formal_canonical_id,canonical);
      const first = await listing('che168');
      assert.ok(BigInt(second.inquiry_number) > BigInt(first.inquiry_number));
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM external_catalog')).rows[0].n,1);
      for(const [id,title,mileage] of [[primaryId,'Employee primary title',9100],[backupId,'Employee backup title',8200]] as const){
        const current=await store.getListing(`ext-${id}`,'en');assert.ok(current.sourceHashes.title);
        const overrides={hidden:false,facts:{mileageKm:mileage},text:[{field:'title' as const,locale:'en' as const,text:title,sourceHash:current.sourceHashes.title!}]};
        await store.saveOverrides(`ext-${id}`,{version:current.version,overrides},randomUUID(),actor);
        if(id===primaryId)primaryOverrides=overrides;else backupOverrides=overrides;
      }
      await apply('che168');await apply('dongchedi');
      assert.equal((await listing('che168')).id,primaryId);assert.equal((await listing('dongchedi')).id,backupId);
      assert.equal((await listing('che168')).inquiry_number, first.inquiry_number);
      assert.equal((await listing('dongchedi')).inquiry_number, second.inquiry_number);
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
    await t.test('a raw report with private category or part leaves only safe rows in persisted public evidence',async()=>{
      const identity={provider:'chinacarapi',source:'dongchedi',externalId:sourceIds.dongchedi} as const;
      const payload={id:identity.externalId,source:identity.source,counts:[{category:'Accident items',checked:4,faults:1}],checks:[
        {category:'　Ｐｈｏｎｅ　',groups:[{name:'Body',items:[{part:'(202) 555-0103',result:'(202) 555-0142',ok:false}]}]},
        {category:'Major accident check',groups:[
          {name:'(202) 555-0104',items:[{part:'Phone',result:'OK',ok:true}]},
          {name:'Body',items:[{part:'内部采购成本',result:73421,ok:false},{part:'Hood',result:'Repaired',ok:false}]},
        ]},
        {groups:[{name:'Other inspection',items:[{result:'Factory finish',ok:true}]}]},
        {category:null,groups:[{name:'Other inspection',items:[{part:'　',result:12,ok:true}]}]},
      ]};
      await apply(identity.source,'upsert',[{identity,kind:'report',locale:'en',observedAt:'2026-11-14T00:30:00.000Z',sourceUpdatedAt:null,payload}]);
      const archived=await database.pool.query(`SELECT merged_payload FROM external_source_heads
        WHERE provider=$1 AND source=$2 AND external_id=$3 AND kind='report' AND locale='en'`,[identity.provider,identity.source,identity.externalId]);
      assert.deepEqual(archived.rows[0]?.merged_payload,payload);
      const materialized=await database.pool.query(`SELECT data FROM external_vehicle_evidence
        WHERE listing_id=$1 AND locale='en' AND kind='inspection' ORDER BY position`,[backupId]);
      assert.deepEqual(materialized.rows.map(({data})=>data.value.text),['Repaired','Factory finish','12']);
      assert.doesNotMatch(JSON.stringify(materialized.rows),/555-01(?:03|04|42)|73421|采购成本|Ｐｈｏｎｅ/);

      const visibleId=`ext-${backupId}`,evidence=new VehicleEvidence(database,inventory);
      const withInspection=PublicVehicleInspectionResponseSchema.shape.data;
      for(const locale of locales){
        const query={locale,limit:2,order:'source'} as const;
        const first=withInspection.parse(await evidence.read(visibleId,'inspection',query));
        assert.equal(first.status,'available');assert.equal(first.total,3);assert.equal(first.summary?.checked,4);assert.equal(first.summary?.faults,1);
        assert.deepEqual(first.items.map(item=>[item.categoryId,item.value.text]),[['accident','Repaired'],[null,'Factory finish']]);assert.ok(first.nextCursor);
        const second=withInspection.parse(await evidence.read(visibleId,'inspection',{...query,cursor:first.nextCursor}));
        assert.equal(second.nextCursor,null);
        assert.deepEqual(second.items.map(item=>[item.categoryId,item.value.text]),[[null,'12']]);
        const detail=PublicVehicleInlineSchema.parse(await inventory.getPublic(visibleId,locale,'localized',undefined,'detail-inline-v1'));
        assert.equal(detail.inspectionSummary.status,'available');
        assert.deepEqual(detail.inspectionInline.defects.map(item=>item.part?.text),['Hood']);
        for(const response of [first,second,detail])assert.doesNotMatch(JSON.stringify(response),/555-01(?:03|04|42)|73421|采购成本|Ｐｈｏｎｅ/);
      }
    });
    await t.test('bounded stored-report reprojection resumes, is idempotent and cannot revive a withdrawn source or change staff facts',async()=>{
      const report:SourceDocument={identity:{provider:'chinacarapi',source:'dongchedi',externalId:sourceIds.dongchedi},kind:'report',locale:'en',observedAt:'2026-11-14T01:00:00.000Z',sourceUpdatedAt:null,
       payload:{id:sourceIds.dongchedi,hasReport:false,counts:[{category:'Accident items',checked:40,faults:0}],checks:[{category:'Major accident check',groups:[{name:'Body',items:[{part:'Door',result:'Original',ok:true}]}]}],reportUrl:'https://private.invalid',seller:{phone:'PRIVATE_MARKER'}}};
      await database.transaction(tx=>persistSourceDocument(tx,report));
      const factsBefore=(await database.pool.query('SELECT id,source_revision,source_hash,upstream_state FROM external_listings ORDER BY id')).rows;
      const workerBefore=(await database.pool.query('SELECT * FROM external_full_sync')).rows;
      const mediaBefore=(await database.pool.query('SELECT * FROM external_media ORDER BY id')).rows;
      await database.pool.query("UPDATE external_vehicle_evidence_sets SET overview='{}',source_revision=repeat('0',64) WHERE kind='inspection'");
      const first=await reprojectStoredInspections(database,{limit:1});assert.equal(first.scanned,1);assert.ok(first.nextCursor);
      const second=await reprojectStoredInspections(database,{limit:1,after:first.nextCursor!});assert.equal(second.scanned,1);
      assert.equal((await reprojectStoredInspections(database,{limit:1,after:second.nextCursor!})).scanned,0);
      const publicVersion=(await database.pool.query('SELECT epoch,revision FROM public_catalog_state WHERE id=1')).rows[0];
      assert.equal((await reprojectStoredInspections(database,{limit:100})).changed,0);
      assert.deepEqual((await database.pool.query('SELECT epoch,revision FROM public_catalog_state WHERE id=1')).rows[0],publicVersion);
      assert.deepEqual((await database.pool.query('SELECT id,source_revision,source_hash,upstream_state FROM external_listings ORDER BY id')).rows,factsBefore);
      assert.deepEqual((await database.pool.query('SELECT * FROM external_full_sync')).rows,workerBefore);assert.deepEqual((await database.pool.query('SELECT * FROM external_media ORDER BY id')).rows,mediaBefore);
      assert.deepEqual((await store.getListing(`ext-${backupId}`,'en')).overrides,backupOverrides);
      const evidence=new VehicleEvidence(database,inventory);
      for(const locale of locales){
       const detail=await inventory.getPublic(`ext-${backupId}`,locale,'localized');assert.equal(detail.inspectionSummary!.status,'available');assert.equal(detail.inspectionSummary!.faults,0);assert.equal(detail.report!.hasReport,true);assert.equal(detail.external!.detail!.inspection,null);
       const result=await evidence.read(`ext-${backupId}`,'inspection',{locale,limit:1,order:'faults_first'});assert.equal(result.total,1);assert.equal(result.summary!.faults,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_MARKER|private\.invalid/);
       await assert.rejects(evidence.read(`ext-${primaryId}`,'inspection',{locale,limit:1,order:'source'}),(error:any)=>error.status===404);
      }
      const current=await store.getListing(`ext-${backupId}`,'en');
      await store.saveOverrides(`ext-${backupId}`,{version:current.version,overrides:{...current.overrides,hidden:true}},randomUUID(),actor);
      await assert.rejects(evidence.read(`ext-${backupId}`,'inspection',{locale:'en',limit:1,order:'source'}),(error:any)=>error.status===404);
      assert.equal(network.mock.callCount(),0);
    });
  } finally {
    network.mock.restore();
    await db?.close();try{if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);}finally{await maintenance.close();}
  }
});
