import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createDatabase,type Database} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {readVehicleEvidence,publicVehicleExtras,protectSourceBlob,decodeSourceBlob,archiveSourceDocuments,loadSourceDocumentRefs,releaseSourceReferences,pruneSourceHistory,listSourceDocuments,getSourceDocument,persistSourceDocument,persistSourceResponse,loadSourceDocuments,persistTrimDocument,type SourceDocument,adaptSourceDocuments,refreshSourceSegments,readSourceSegment} from '../src/external/sources/index.js';

test('source evidence, sparse enrichment, obsolete events and all gallery/config segments persist atomically',async()=>{
 const url=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||url.search||url.hash)throw new Error('Source tests require a local maintenance connection.');
 const socket=process.env.API_TEST_DATABASE_SOCKET;if(socket){if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('Invalid existing local socket.');url.searchParams.set('host',socket);}
 const name=`hd_ext_sources_${randomBytes(8).toString('hex')}`,maintenance=createDatabase(url.toString(),1);let db:Database|undefined,created=false;
 try{
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;db=createDatabase(url.toString(),2);await migrateDatabase(db);
  if(!(await db.pool.query("SELECT to_regclass('external_source_documents') AS relation")).rows[0].relation)await db.pool.query(await readFile(new URL('../migrations/0020_sources.sql',import.meta.url),'utf8'));
  const identity={provider:'chinacarapi' as const,source:'che168' as const,externalId:'1001'},at='2026-11-13T12:00:00.000Z';
  const row={source:'che168',id:'1001',status:'active',updatedAt:at,url:'https://www.che168.com/dealer/1/1001.html',title:'Example vehicle',make:{id:'1',name:'Example'},model:{id:'2',name:'Model'},trim:{id:'3',name:'Variant'},specs:{displacementCc:1998},photos:Array.from({length:45},(_,i)=>`https://erscglobal2.autoimg.cn/photo/${i}.jpg`),equipment:[{items:Array.from({length:601},(_,i)=>({name:`ABS`,value:'Standard'}))}],unknownPrivate:{raw:'preserved'}};
  const doc:SourceDocument={identity,kind:'detail',locale:'en',observedAt:at,sourceUpdatedAt:at,payload:row};
  const responseBody=JSON.stringify({results:[row],notFound:[],unknownWrapper:'preserve'});doc.rawResponse={hash:createHash('sha256').update(responseBody).digest('hex'),body:responseBody};
  await db.transaction(async tx=>{await persistSourceDocument(tx,doc);await persistSourceDocument(tx,doc);await persistSourceDocument(tx,{...doc,observedAt:'2026-11-13T12:01:00Z',payload:{specs:{powerKw:100}}});});
  assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM external_source_documents')).rows[0].count,2);
  const stored=(await db.pool.query('SELECT * FROM external_source_blobs WHERE hash=$1',[doc.rawResponse.hash])).rows[0];assert.equal(stored.payload,null);assert.ok(Buffer.isBuffer(stored.compressed));assert.equal((decodeSourceBlob(stored).payload as {unknownWrapper:string}).unknownWrapper,'preserve');
  let loaded=await db.transaction(tx=>loadSourceDocuments(tx,identity));assert.equal((loaded[0]!.payload as typeof row).photos.length,45);assert.equal((loaded[0]!.payload as typeof row).specs.displacementCc,1998);
  await db.transaction(tx=>persistSourceDocument(tx,{...doc,observedAt:'2026-11-13T13:00:00Z',payload:{photos:[]}},false));
  loaded=await db.transaction(tx=>loadSourceDocuments(tx,identity));assert.equal((loaded[0]!.payload as typeof row).photos.length,45);
  await db.transaction(async tx=>{await persistTrimDocument(tx,'3','en',{summary:{displacementCc:1998}},at);await persistTrimDocument(tx,'3','en',{summary:{displacementCc:1998}},at);});
  assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM external_trim_documents')).rows[0].count,1);
  const raw='{"a":1}',rawHash=createHash('sha256').update(raw).digest('hex');
  await db.transaction(async tx=>{await persistTrimDocument(tx,'4','en',{a:1},at);await persistSourceResponse(tx,{hash:rawHash,body:raw});});
  assert.equal(decodeSourceBlob((await db.pool.query('SELECT * FROM external_source_blobs WHERE hash=$1',[rawHash])).rows[0]).rawText,raw);
  const oldDoc={...doc,identity:{...identity,externalId:'retention-test'},observedAt:'2001-01-01T00:00:00Z',payload:{unrecognizedOriginal:{kept:true}}};
  oldDoc.identity.externalId='9001';
  const oldRefs=await db.transaction(tx=>archiveSourceDocuments(tx,[oldDoc],'retention-pending'));
  const oldHash=(await db.pool.query('SELECT hash FROM external_source_documents WHERE id=$1',[oldRefs[0]!.id])).rows[0].hash;
  await db.transaction(tx=>protectSourceBlob(tx,oldHash,{kind:'backup',reference:'retained-backup'}));
  await db.transaction(tx=>releaseSourceReferences(tx,'pending','retention-pending'));await db.transaction(tx=>pruneSourceHistory(tx));
  assert.equal((await db.transaction(tx=>loadSourceDocumentRefs(tx,oldRefs))).length,1);
  await db.transaction(tx=>releaseSourceReferences(tx,'backup','retained-backup'));await db.transaction(tx=>pruneSourceHistory(tx));
  await assert.rejects(db.transaction(tx=>loadSourceDocumentRefs(tx,oldRefs)),/missing/);
  const refs=await db.transaction(tx=>archiveSourceDocuments(tx,[doc],'test-pending'));
  await db.transaction(tx=>persistSourceDocument(tx,{...doc,observedAt:'2026-11-13T14:00:00Z'},false));
  await db.transaction(tx=>pruneSourceHistory(tx));
  const queued=await db.transaction(tx=>loadSourceDocumentRefs(tx,refs));assert.equal(queued[0]!.observedAt,at);assert.deepEqual(queued[0]!.payload,row);
  await db.transaction(tx=>releaseSourceReferences(tx,'pending','test-pending'));
  const listingId=randomUUID(),projection=adaptSourceDocuments([{...loaded[0]!,payload:{...(loaded[0]!.payload as object),priceHistory:Array.from({length:150},(_,i)=>({price:{cny:i},observedAt:at}))}},
   {...doc,kind:'report',payload:{id:'1001',summary:Array.from({length:150},(_,i)=>({area:`Panel ${i}`,result:'Original',privateContact:'hidden'}))}}],1,at)!;
  await db.pool.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at) VALUES($1,'chinacarapi','che168','1001',1,$2,$3,'active',$4,$4)`,[listingId,'a'.repeat(64),JSON.stringify(projection.candidate),at]);
  const history=await listSourceDocuments(db,`ext-${listingId}`,{limit:1});assert.equal(history.items.length,1);assert.ok(history.nextCursor);
  const original=await getSourceDocument(db,`ext-${listingId}`,history.items[0]!.id);assert.deepEqual(Object.keys(original.response??{}).sort(),['hash','shared']);
  const next=await listSourceDocuments(db,`ext-${listingId}`,{limit:1,cursor:history.nextCursor!});assert.notEqual(next.items[0]!.id,history.items[0]!.id);
  const otherId=randomUUID();await db.pool.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at) VALUES($1,'chinacarapi','che168','1002',1,$2,$3,'active',$4,$4)`,[otherId,'b'.repeat(64),JSON.stringify(projection.candidate),at]);
  await assert.rejects(getSourceDocument(db,`ext-${otherId}`,history.items[0]!.id),e=>(e as {status?:number}).status===404);
  await assert.rejects(listSourceDocuments(db,`ext-${otherId}`,{limit:1,cursor:history.nextCursor!}),e=>(e as {status?:number}).status===400);
  for(const time of ['0000-01-01T00:00:00.000000Z','2026-02-30T00:00:00.000000Z']){
   const cursor=Buffer.from(JSON.stringify({listingId:`ext-${listingId}`,time,id:history.items[0]!.id})).toString('base64url');
   await assert.rejects(listSourceDocuments(db,`ext-${listingId}`,{limit:1,cursor}),e=>(e as {status?:number}).status===400);
  }
  await db.transaction(tx=>refreshSourceSegments(tx,listingId,projection,at));
  const evidence=await readVehicleEvidence(db.pool,listingId,'en','inspection',100,100);assert.equal(evidence!.total,150);assert.equal(evidence!.items.length,50);assert.ok(!JSON.stringify(evidence).includes('privateContact'));
  const prices=await readVehicleEvidence(db.pool,listingId,'en','price-history',0,100);assert.equal(prices!.total,150);assert.equal(prices!.items.length,100);assert.equal((prices!.items[0] as {money:{amount:string}}).money.amount,'0');
  assert.equal((await publicVehicleExtras(db.pool,listingId,'en'))!.identifiers.inquiryCode,'che168-1001');
  const page=await readSourceSegment(db.pool,listingId,'en','photos',30,20);assert.equal(page!.total,45);assert.equal(page!.items.length,15);
  const config=await readSourceSegment(db.pool,listingId,'en','configuration',500,100);assert.ok(config!.total>600);assert.equal(config!.items.length,100);
  const before=(await readSourceSegment(db.pool,listingId,'en','photos',0,100))!;await db.pool.query('UPDATE external_media SET active=false WHERE listing_id=$1 AND position=0',[listingId]);
  const hidden=(await readSourceSegment(db.pool,listingId,'en','photos',0,100))!;assert.equal(hidden.total,44);assert.notEqual(hidden.revision,before.revision);
  await db.pool.query("UPDATE external_media SET expires_at=now()-interval '1 second' WHERE listing_id=$1 AND position=1",[listingId]);
  const expired=(await readSourceSegment(db.pool,listingId,'en','photos',0,100))!;assert.equal(expired.total,43);assert.notEqual(expired.revision,hidden.revision);
  await assert.rejects(db.transaction(async tx=>{await refreshSourceSegments(tx,listingId,{...projection,fullPhotos:[]},at);throw new Error('rollback fixture');}));
  assert.equal((await readSourceSegment(db.pool,listingId,'en','photos',0,100))!.total,43);
 }finally{if(db)await db.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH(FORCE)`);await maintenance.close();}
});
