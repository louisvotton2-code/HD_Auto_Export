import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabase, type Database } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { applyFullSource, bindAlias } from '../src/external/full-sync/apply.js';
import { emptyOverrides } from '../src/external/normalize.js';
import { readSourceSegment, type SourceDocument } from '../src/external/sources/index.js';
import { ExternalStore, reprojectFormalListing } from '../src/external/store.js';

test('formal supplier replay keeps the material projection, gallery and representative unchanged',async()=>{
  const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash) {
    throw new Error('Use an isolated loopback maintenance database.');
  }
  const name=`hd_ext_repeat_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.href,1);
  let db:Database|undefined,created=false;
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);
    created=true;
    url.pathname=`/${name}`;
    const database=db=createDatabase(url.href,2);
    await migrateDatabase(database);
    const now=Date.now(), at=(minutes:number)=>new Date(now+minutes*60_000).toISOString();
    const source='che168',externalId='90101',canonicalId=`chinacarapi:${source}:${externalId}`;
    const batchId=randomUUID();
    const primary:Pick<Parameters<typeof applyFullSource>[1],'source'|'externalId'|'canonicalId'|'batchId'>={source,externalId,canonicalId,batchId};
    await database.pool.query(`INSERT INTO external_full_members (source,external_id,canonical_id,state,locales)
      VALUES ($1,$2,$3,'active',ARRAY['zh','en','ru'])`,[source,externalId,canonicalId]);
    const signed=(seconds:number,signature:string)=>`https://p3-dcd-sign.byteimg.com/real-shape/detailed~resize.webp?psm=test&lk3s=fixture&x-expires=${seconds}&x-signature=${signature}`;
    const originalExpiry=Math.floor((now+4*60*60_000)/1000);
    const raw={
      source,id:externalId,status:'active',updatedAt:at(-5),url:`https://www.che168.com/dealer/1/${externalId}.html`,
      title:'Fixture Motors Gallery',make:{id:'1',name:'Fixture Motors',nameZh:'样例品牌'},
      model:{id:'2',name:'Gallery',nameZh:'样例车型'},trim:{id:'3',name:'Variant',nameZh:'配置'},
      modelYear:2022,fuel:'Petrol',mileageKm:12345,price:{cny:86000},specs:{displacementCc:1998},
      photos:[...Array.from({length:44},(_,i)=>`https://erscglobal2.autoimg.cn/fixture/gallery-${i}.jpg`),signed(originalExpiry,'originalSignature')],
      equipment:[{items:[{name:'ABS',value:'Standard',nameZh:'防抱死系统',valueZh:'标配'}]}],privateEvidence:{serial:'preserved'},
    };
    const docs=(observedAt:string,payload=raw,model=primary):SourceDocument[]=>(['zh','en','ru'] as const).map(locale=>({
      identity:{provider:'chinacarapi',source:model.source,externalId:model.externalId},
      kind:'detail',locale,observedAt,sourceUpdatedAt:payload.updatedAt,payload,
    }));
    const apply=(observedAt:string,payload=raw,model=primary)=>database.transaction(tx=>
      applyFullSource(tx,{...model,operation:'upsert',documents:docs(observedAt,payload,model),at:observedAt}));
    await apply(at(-4));
    const listingId=(await database.pool.query('SELECT id FROM external_listings WHERE external_id=$1',[externalId])).rows[0]!.id as string;
    const footprint=async()=> (await database.pool.query(`SELECT
      (SELECT jsonb_build_array(xmin::text,source_revision,version,fetched_at,source_hash) FROM external_listings WHERE id=$1) AS source,
      (SELECT xmin::text FROM external_catalog WHERE listing_id=$1) AS catalog,
      (SELECT jsonb_agg(jsonb_build_array(id,xmin::text,revision,position,active,refreshed_at) ORDER BY position)
        FROM external_media WHERE listing_id=$1) AS media,
      (SELECT jsonb_agg(jsonb_build_array(locale,kind,xmin::text,revision) ORDER BY locale,kind)
        FROM external_source_segment_sets WHERE listing_id=$1) AS segments,
      (SELECT xmin::text FROM external_canonical_bindings WHERE provider='chinacarapi' AND canonical_id=$2) AS binding,
      (SELECT jsonb_build_array(revision,filter_revision,browse_generation) FROM public_catalog_state WHERE id=1) AS versions,
      (SELECT revision FROM external_catalog_state WHERE id=1) AS external_revision`,
    [listingId,canonicalId])).rows[0]!;
    const original=await footprint();
    assert.equal(original.media.length,45);
    const gallery=await readSourceSegment(database.pool,listingId,'zh','photos',30,20);
    assert.equal(gallery?.total,45);
    assert.equal(gallery?.items.length,15);

    await apply(at(-3));
    assert.deepEqual(await footprint(),original);
    const store=new ExternalStore(database);
    assert.equal((await store.providerStatus()).lastFetchedAt,at(-4));
    await database.pool.query('UPDATE external_full_members SET last_detail_at=$3 WHERE source=$1 AND external_id=$2',
      [source,externalId,at(-3)]);
    assert.equal((await store.providerStatus()).lastFetchedAt,at(-3));
    const evidence=(await database.pool.query(`SELECT d.first_observed_at,d.last_observed_at,h.observed_at,
      h.merged_payload->'privateEvidence' AS evidence FROM external_source_heads h
      JOIN external_source_documents d ON d.id=h.document_id WHERE h.external_id=$1 AND h.locale='en' AND h.kind='detail'`,[externalId])).rows[0]!;
    assert.equal(evidence.first_observed_at.toISOString(),at(-4));
    assert.equal(evidence.last_observed_at.toISOString(),at(-3));
    assert.equal(evidence.observed_at.toISOString(),at(-3));
    assert.deepEqual(evidence.evidence,{serial:'preserved'});

    const enBefore=await readSourceSegment(database.pool,listingId,'en','configuration',0,20);
    const zhBefore=await readSourceSegment(database.pool,listingId,'zh','configuration',0,20);
    const applyLocalizedSpecs=(observedAt:string,value='标配')=>database.transaction(tx=>applyFullSource(tx,{
      ...primary,operation:'upsert',at:observedAt,documents:[{
        identity:{provider:'chinacarapi',source,externalId},kind:'specs',locale:'zh',observedAt,sourceUpdatedAt:raw.updatedAt,
        payload:{trimId:'3',sections:[{items:[{name:'泊车雷达',value}]}]},
      }],
    }));
    await applyLocalizedSpecs(at(-2.9));
    const localized=await footprint();
    assert.deepEqual(localized.source,original.source);
    assert.equal(localized.catalog,original.catalog);
    assert.deepEqual(localized.media,original.media);
    assert.deepEqual(await readSourceSegment(database.pool,listingId,'en','configuration',0,20),enBefore);
    const zhAfter=await readSourceSegment(database.pool,listingId,'zh','configuration',0,20);
    assert.equal(zhAfter?.total,(zhBefore?.total??0)+1);
    assert.notEqual(zhAfter?.revision,zhBefore?.revision);
    assert.deepEqual(localized.versions,[original.versions[0]+1,...original.versions.slice(1)]);
    assert.equal(BigInt(localized.external_revision),BigInt(original.external_revision)+1n);
    await applyLocalizedSpecs(at(-2.8));
    assert.deepEqual(await footprint(),localized);

    const extendedExpiry=originalExpiry+3600;
    const refreshed={...raw,photos:[...raw.photos.slice(0,-1),signed(extendedExpiry,'refreshedSignature')]};
    await apply(at(-2),refreshed);
    const refreshedRows=await footprint();
    assert.deepEqual(refreshedRows.source,original.source);
    assert.equal(refreshedRows.catalog,original.catalog);
    assert.deepEqual(refreshedRows.media.slice(0,-1),original.media.slice(0,-1));
    assert.equal(refreshedRows.media.at(-1)[0],original.media.at(-1)[0]);
    assert.equal(refreshedRows.media.at(-1)[2],original.media.at(-1)[2]+1);
    const rechecked=await readSourceSegment(database.pool,listingId,'zh','photos',30,20);
    assert.notEqual(rechecked?.revision,gallery?.revision);
    assert.match((rechecked?.items.at(-1) as {url:string}).url,/refreshedSignature/);

    const priced={...refreshed,updatedAt:at(-1),price:{cny:87000}};
    await apply(at(-1),priced);
    const updated=await footprint();
    assert.notDeepEqual(updated.source,refreshedRows.source);
    assert.notEqual(updated.catalog,refreshedRows.catalog);
    assert.deepEqual(updated.media,refreshedRows.media);
    assert.equal((await database.pool.query('SELECT price_cny FROM external_catalog WHERE listing_id=$1',[listingId])).rows[0]?.price_cny,'87000.00');

    const reportAndMediaExpiry={...priced,photos:[...priced.photos.slice(0,-1),signed(Math.floor((now-30*60_000)/1000),'expiredSignature')]};
    await apply(at(0),reportAndMediaExpiry);
    assert.equal((await readSourceSegment(database.pool,listingId,'zh','photos',30,20))?.total,44);
    assert.equal((await database.pool.query(`SELECT count(*)::int AS n FROM external_media_refresh_requests r
      JOIN external_media m ON m.id=r.media_id AND m.revision=r.media_revision WHERE m.listing_id=$1`,[listingId])).rows[0]?.n,1);

    const secondaryId='90102',secondaryCanonical=`chinacarapi:${source}:${secondaryId}`;
    const successor={...primary,externalId:secondaryId,canonicalId:secondaryCanonical};
    const successorRaw={...raw,id:secondaryId,url:`https://www.che168.com/dealer/1/${secondaryId}.html`};
    await database.transaction(async tx=>{
      await tx.query(`INSERT INTO external_full_members (source,external_id,canonical_id,state,locales)
        VALUES ($1,$2,$3,'active',ARRAY['zh','en','ru'])`,[source,secondaryId,secondaryCanonical]);
      const observedAt=at(1);
      await applyFullSource(tx,{...successor,operation:'upsert',documents:docs(observedAt,successorRaw,successor),at:observedAt});
      await bindAlias(tx,source,externalId,{source,id:secondaryId},observedAt);
    });
    const visibleRepresentative=async()=>(await database.pool.query(`SELECT l.external_id
      FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id
      WHERE l.formal_canonical_id=$1`,[canonicalId])).rows.map(row=>row.external_id);
    assert.deepEqual(await visibleRepresentative(),[externalId]);

    await database.transaction(async tx=>{
      await tx.query("UPDATE external_full_members SET state='withdrawn' WHERE source=$1 AND external_id=$2",[source,externalId]);
      await applyFullSource(tx,{...primary,operation:'withdraw',documents:[],at:at(2)});
    });
    assert.equal((await footprint()).catalog,null);
    assert.deepEqual(await visibleRepresentative(),[secondaryId]);
    assert.equal((await database.pool.query('SELECT upstream_state FROM external_listings WHERE id=$1',[listingId])).rows[0]?.upstream_state,'withdrawn');
    await database.transaction(async tx=>{
      await tx.query('INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,$2)',
        [listingId,{...emptyOverrides(),hidden:true}]);
      await reprojectFormalListing(tx,listingId);
    });
    await database.pool.query("UPDATE external_full_members SET state='active' WHERE source=$1 AND external_id=$2",[source,externalId]);
    await apply(at(3),reportAndMediaExpiry);
    assert.equal((await database.pool.query('SELECT upstream_state FROM external_listings WHERE id=$1',[listingId])).rows[0]?.upstream_state,'active');
    assert.equal((await footprint()).catalog,null);
    assert.deepEqual(await visibleRepresentative(),[secondaryId]);
    await apply(at(4),reportAndMediaExpiry);
    assert.equal((await database.pool.query("SELECT data->>'hidden' AS hidden FROM external_listing_overrides WHERE listing_id=$1",[listingId])).rows[0]?.hidden,'true');
    assert.deepEqual(await visibleRepresentative(),[secondaryId]);
    const hidden=await footprint();
    await applyLocalizedSpecs(at(5),'选装');
    const changedWhileHidden=await footprint();
    assert.notDeepEqual(changedWhileHidden.segments,hidden.segments);
    assert.deepEqual(changedWhileHidden.versions,hidden.versions);
  } finally {
    if(db) await db.close();
    if(created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);
    await maintenance.close();
  }
});
