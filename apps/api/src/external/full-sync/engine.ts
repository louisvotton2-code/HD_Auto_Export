import {randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {mkdir,statfs,stat,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import type {Database} from '../../db/index.js';
import {verifyCatalogCsv,persistSourceResponse,archiveSourceDocuments,loadSourceDocumentRefs,releaseSourceReferences,protectSourceBlob,type SourceDocument,type CatalogCsvRow} from '../sources/index.js';
import {SERVICE_ACTOR} from '../ingestion/worker.js';
import {jsonHash} from '../normalize.js';
import {runSourceMaintenance} from './maintenance.js';
import {syncAccount} from './quota.js';
import {FullSyncClient} from './client.js';
import {applyFullSource,ensureMember,bindAlias,parseAlias} from './apply.js';
import {FullSyncError,LIMITS,type Actor,type FullApply,type Source,type Locale} from './types.js';
const identity=(source:Source,externalId:string)=>({provider:'chinacarapi' as const,source,externalId});
const workRef=(source:string,id:string,kind:string)=>`full:${source}:${id}:${kind}`;
const errorCode=(error:unknown)=>error instanceof FullSyncError?error.code:'SYNC_OPERATION_FAILED';
export async function configureFullSync(db:Database,actor:Actor,mode:'full'|'continuous'){
 return db.transaction(async tx=>{
  if(!(await tx.query("SELECT id FROM staff WHERE id=$1 AND role='admin' AND NOT banned",[actor.id])).rowCount)throw new FullSyncError('SYNC_ADMIN_REQUIRED');
  await tx.query(`INSERT INTO staff(id,name,email,role,banned) VALUES($1,'ChinaCarAPI import service','chinacarapi-worker@example.invalid','editor',true) ON CONFLICT(id) DO NOTHING`,[SERVICE_ACTOR]);
  if(!(await tx.query(`SELECT id FROM staff s WHERE id=$1 AND banned AND NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE a.user_id=s.id) AND NOT EXISTS(SELECT 1 FROM staff_sessions t WHERE t.user_id=s.id)`,[SERVICE_ACTOR])).rowCount)throw new FullSyncError('SYNC_SERVICE_INVALID');
  await tx.query("UPDATE external_full_sync SET capacity_baseline=coalesce(capacity_baseline,jsonb_build_object('walLsn',pg_current_wal_lsn()::text,'databaseBytes',pg_database_size(current_database()),'at',clock_timestamp())) WHERE id=1");
  await tx.query("INSERT INTO external_full_members(source,external_id,canonical_id,state,event_order,business_at,locales,last_detail_at,applied_generation) SELECT l.platform_id,l.external_id,l.formal_canonical_id,l.upstream_state,coalesce(i.business_order,0),coalesce(i.business_at,l.fetched_at),'{}',l.fetched_at,1 FROM external_listings l LEFT JOIN external_ingestion_identity_state i ON i.provider=l.provider AND i.source=l.platform_id AND i.external_id=l.external_id WHERE l.provider='chinacarapi' AND l.formal_canonical_id IS NOT NULL ON CONFLICT DO NOTHING");
  await tx.query("UPDATE external_full_members SET locales=ARRAY['zh','en','ru'] WHERE state='active' AND last_detail_at IS NOT NULL AND cardinality(locales)=0 AND desired_generation=applied_generation");
  await tx.query('UPDATE external_full_sync SET enabled=true,paused=false,mode=$1,triggered_by=$2,version=version+1,updated_at=now() WHERE id=1',[mode,actor.id]);
 });
}
async function queue(tx:PoolClient,source:Source,id:string,kind:'detail'|'report',generation:string|number,priority:number){
 const prior=(await tx.query('SELECT generation FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind=$3 FOR UPDATE',[source,id,kind])).rows[0];
 if(prior&&BigInt(prior.generation)!==BigInt(generation))await releaseSourceReferences(tx,'pending',workRef(source,id,kind));
 await tx.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(source,external_id,kind) DO UPDATE SET priority=greatest(external_full_work.priority,excluded.priority),
 document_refs=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.document_refs ELSE '[]'::jsonb END,
 locales=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.locales ELSE '{}'::text[] END,
 attempts=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.attempts ELSE 0 END,
 due_at=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.due_at ELSE now() END,generation=excluded.generation`,[source,id,kind,generation,priority]);
}
export class FullSyncWorker{
 private lock:PoolClient|null=null;private lost=false;private fence:string|null=null;
 constructor(readonly db:Database,readonly client:FullSyncClient,readonly directory:string,private apply:FullApply=applyFullSource){}
 /** One dedicated connection owns the process lease; pool's remaining connection executes short transactions. */
 async acquire(){const c=await this.db.pool.connect();if(!(await c.query('SELECT pg_try_advisory_lock(78291333) AS ok')).rows[0].ok){c.release();return false;}
  this.lock=c;c.on('error',()=>{this.lost=true;});this.fence=String((await this.db.pool.query('UPDATE external_full_sync SET worker_fence=worker_fence+1 WHERE id=1 RETURNING worker_fence')).rows[0]!.worker_fence);return true;}
 async close(){if(this.lock){try{await this.lock.query('SELECT pg_advisory_unlock(78291333)');}finally{this.lock.release();this.lock=null;}}}
 private async alive(){if(!this.lock||this.lost)throw new FullSyncError('SYNC_LEASE_LOST');await this.lock.query('SELECT 1');}
 private async transaction<T>(work:(tx:PoolClient)=>Promise<T>):Promise<T>{
  await this.alive();return this.db.transaction(async tx=>{
   const fence=(await tx.query('SELECT worker_fence FROM external_full_sync WHERE id=1 FOR UPDATE')).rows[0]!.worker_fence;
   if(String(fence)!==this.fence)throw new FullSyncError('SYNC_LEASE_LOST');return work(tx);
  });
 }
 async state(){return (await this.db.pool.query('SELECT * FROM external_full_sync WHERE id=1')).rows[0]!;}
 async space(){const disk=await statfs(this.directory);const used=1-disk.bavail/disk.blocks;if(!Number.isFinite(used))throw new FullSyncError('SYNC_SPACE_UNKNOWN');
  await this.db.pool.query('UPDATE external_full_sync SET disk_paused=$1 WHERE id=1',[used>=.70]);return {used,available:disk.bavail*disk.bsize,total:disk.blocks*disk.bsize};}
 async heavy(){await this.alive();const s=await this.state(),disk=await this.space();if(s.capacity_pending)throw new FullSyncError('SYNC_CAPACITY_PENDING');if(!s.enabled||s.paused||disk.used>=.70)throw new FullSyncError('SYNC_HEAVY_PAUSED');}
 /** 2000-event page staged in 100-event transactions. Cursor advances only after every chunk and raw evidence is durable. */
 async receiveDelta(){
  await this.alive();const s=await this.state();if(!s.since_at)return false;
  const page=await this.client.changes(new Date(s.since_at).toISOString(),s.receive_cursor===null?null:String(s.receive_cursor));
  const key=s.receive_cursor===null?`since:${new Date(s.since_at).toISOString()}`:`cursor:${s.receive_cursor}`;
  await this.transaction(async tx=>{await persistSourceResponse(tx,page.rawResponse);await protectSourceBlob(tx,page.rawResponse.hash,{kind:'pending',reference:`full-page:${key}`});});
  for(let offset=0;offset<page.changes.length;offset+=LIMITS.dbBatch){await this.alive();await this.transaction(async tx=>{
   for(const e of page.changes.slice(offset,offset+LIMITS.dbBatch)){
    const existing=(await tx.query('SELECT payload_hash FROM external_full_events WHERE event_id=$1',[e.id])).rows[0];if(existing){if(existing.payload_hash!==jsonHash(e))throw new FullSyncError('SYNC_EVENT_CONFLICT');continue;}
    const ref=`full-event:${e.id}`,docs:SourceDocument[]=[{identity:identity(e.source,e.vehicleId),kind:'event',locale:'und',observedAt:new Date().toISOString(),sourceUpdatedAt:e.at,eventSequence:String(e.id),payload:e,rawResponse:{hash:page.rawResponse.hash}}];
    const refs=await archiveSourceDocuments(tx,docs,ref);
    await tx.query('INSERT INTO external_full_events(event_id,source,external_id,operation,business_at,document_refs,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[e.id,e.source,e.vehicleId,e.type==='removed'?'withdraw':e.type==='relisted'?'relist':'upsert',e.at,JSON.stringify(refs),jsonHash(e)]);
    await tx.query('UPDATE external_full_sync SET received_events=received_events+1 WHERE id=1');
   }
  });}
  await this.transaction(async tx=>{
   const current=(await tx.query('SELECT receive_cursor,since_at FROM external_full_sync WHERE id=1 FOR UPDATE')).rows[0]!;
   if(String(current.receive_cursor)!==String(s.receive_cursor)||new Date(current.since_at).getTime()!==new Date(s.since_at).getTime())throw new FullSyncError('SYNC_CURSOR_CONFLICT');
   await tx.query(`INSERT INTO external_full_receipts(cursor_key,next_cursor,event_count,complete) VALUES($1,$2,$3,true) ON CONFLICT(cursor_key) DO UPDATE SET next_cursor=excluded.next_cursor,event_count=excluded.event_count,complete=true`,[key,page.nextCursor,page.changes.length]);
   await tx.query("UPDATE external_full_sync SET receive_cursor=$1,next_delta_at=clock_timestamp()+CASE WHEN $2 THEN interval '0 seconds' ELSE interval '5 minutes' END WHERE id=1",[page.nextCursor,page.hasMore]);
   await releaseSourceReferences(tx,'pending',`full-page:${key}`);
  });return page.hasMore;
 }
 async applyEvents(withdrawOnly=false){
  await this.alive();const events=(await this.db.pool.query(`SELECT * FROM external_full_events WHERE applied_at IS NULL AND ($1=false OR operation='withdraw') ORDER BY (operation='withdraw') DESC,event_id LIMIT 100`,[withdrawOnly])).rows;
  for(const event of events)await this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const member=await ensureMember(tx,event.source,event.external_id);
   const newer=BigInt(event.event_id)>BigInt(member.event_order)&&new Date(event.business_at).getTime()>=new Date(member.business_at).getTime();
   if(newer){
    const withdraw=event.operation==='withdraw',canActivate=member.state!=='withdrawn'||event.operation==='relist';
    await tx.query(`UPDATE external_full_members SET event_order=$3,business_at=$4,desired_generation=desired_generation+1,verification_pending=false,
      state=CASE WHEN $5 THEN 'withdrawn' WHEN $6 THEN 'pending' ELSE state END,locales=CASE WHEN $5 THEN locales ELSE '{}'::text[] END WHERE source=$1 AND external_id=$2`,[event.source,event.external_id,event.event_id,event.business_at,withdraw,canActivate]);
    const next=(await tx.query('SELECT * FROM external_full_members WHERE source=$1 AND external_id=$2',[event.source,event.external_id])).rows[0]!;
    if(withdraw){const docs=await loadSourceDocumentRefs(tx,event.document_refs);await this.apply(tx,{source:event.source,externalId:event.external_id,canonicalId:next.canonical_id,operation:'withdraw',documents:docs,at:new Date(event.business_at).toISOString(),batchId:randomUUID()});
     for(const kind of ['detail','report'])await releaseSourceReferences(tx,'pending',workRef(event.source,event.external_id,kind));await tx.query('DELETE FROM external_full_work WHERE source=$1 AND external_id=$2',[event.source,event.external_id]);
    }else if(canActivate)await queue(tx,event.source,event.external_id,'detail',next.desired_generation,100);
   }
   await tx.query('UPDATE external_full_events SET applied_at=clock_timestamp() WHERE event_id=$1 AND applied_at IS NULL',[event.event_id]);
   await tx.query('UPDATE external_full_sync SET applied_events=applied_events+1 WHERE id=1');await releaseSourceReferences(tx,'pending',`full-event:${event.event_id}`);
  });return events.length;
 }
 async snapshot(){
  // Freeze CSV expansion while the first detail sample waits for reports/capacity approval.
  if(await this.sampleSaturated())return 0;
  await this.heavy();await mkdir(this.directory,{recursive:true,mode:0o700});
  let snapshot=(await this.db.pool.query("SELECT * FROM external_full_snapshots WHERE state IN('downloading','staging','verified','applying') LIMIT 1")).rows[0];
  if(!snapshot){
   const generatedAt=await this.client.probeExport(),id=randomUUID();
   await this.transaction(async tx=>{await tx.query("INSERT INTO external_full_snapshots(id,generated_at,state,path) VALUES($1,$2,'downloading',$3)",[id,generatedAt,path.join(this.directory,`${id}.csv`)]);
    await tx.query('UPDATE external_full_sync SET since_at=coalesce(since_at,$1) WHERE id=1',[generatedAt]);});
   // Capture at the x-generated-at start before the long download; no overlapping network requests.
   await this.receiveDelta();await this.applyEvents(true);
   snapshot=(await this.db.pool.query('SELECT * FROM external_full_snapshots WHERE id=$1',[id])).rows[0];
  }
  if(snapshot.state==='downloading'){
   const downloaded=await this.client.downloadExport(snapshot.path,async()=>{await this.heavy();await this.applyEvents(true);});
   await this.db.pool.query("UPDATE external_full_snapshots SET state='staging',generated_at=$2,sha256=$3,bytes=$4 WHERE id=$1",[snapshot.id,downloaded.generatedAt,downloaded.sha256,downloaded.bytes]);
   snapshot={...snapshot,...{state:'staging',generated_at:new Date(downloaded.generatedAt),sha256:downloaded.sha256,bytes:downloaded.bytes}};
  }
  if(snapshot.state==='staging'){
   let batch:Array<{row:CatalogCsvRow;index:number}>=[];
   const flush=async()=>{if(!batch.length)return;await this.heavy();await this.transaction(async tx=>{
    for(const entry of batch)await tx.query(`INSERT INTO external_full_stage VALUES($1,$2,$3,$4,$5) ON CONFLICT(snapshot_id,row_number) DO NOTHING`,[snapshot.id,entry.index+1,entry.row.source,entry.row.id,JSON.stringify(entry.row)]);
    await tx.query('UPDATE external_full_snapshots SET staged=greatest(staged,$2) WHERE id=$1',[snapshot.id,batch.at(-1)!.index+1]);});batch=[];};
   const proof=await verifyCatalogCsv(createReadStream(snapshot.path),{expectedSha256:snapshot.sha256,expectedBytes:Number(snapshot.bytes),generatedAt:new Date(snapshot.generated_at).toISOString(),downloadCompleted:true},async(row,index)=>{
    if(index>=Number(snapshot.staged))batch.push({row,index});if(batch.length>=100||batch.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.row)),0)>=1024*1024)await flush();
    if((index+1)%10_000===0){await this.receiveDelta();await this.applyEvents(true);}
   });await flush();
   await this.alive();const compressed=snapshot.path+'.gz';await pipeline(createReadStream(snapshot.path),createGzip(),createWriteStream(compressed,{mode:0o600}));
   await this.transaction(tx=>tx.query("UPDATE external_full_snapshots SET state='verified',rows=$2,source_counts=$3,path=$4 WHERE id=$1",[snapshot.id,proof.rows,JSON.stringify(proof.sourceCounts),compressed]));await unlink(snapshot.path);
  }
  return this.promoteSnapshot(snapshot.id);
 }
 async estimateCapacity(snapshotId:string,bytes:number){
  const disk=await this.space(),state=await this.state();
  const measured=(await this.db.pool.query(`SELECT coalesce(sum(pg_column_size(payload)),0)::bigint AS stage_bytes,count(*)::bigint AS n FROM external_full_stage WHERE snapshot_id=$1 AND row_number<=10000`,[snapshotId])).rows[0]!;
  const relations=(await this.db.pool.query(`SELECT c.relname AS relation,pg_total_relation_size(c.oid)::text AS total_bytes,pg_indexes_size(c.oid)::text AS index_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname LIKE 'external_%'`)).rows;
  const wal=(await this.db.pool.query('SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),$1::pg_lsn)::text AS bytes',[state.capacity_baseline?.walLsn??'0/0'])).rows[0]!.bytes;
  const sample=(await this.db.pool.query("SELECT count(*)::integer AS details,count(*) FILTER(WHERE cardinality(locales)=3)::integer AS three_locales,count(*) FILTER(WHERE report_state IN('available','unavailable'))::integer AS reports,count(*) FILTER(WHERE report_state='no_report')::integer AS no_report FROM external_full_members WHERE sampled AND state<>'withdrawn' AND last_detail_at IS NOT NULL")).rows[0]!;const details=sample.details;
  const completedSnapshot=(await this.db.pool.query('SELECT rows FROM external_full_snapshots WHERE id=$1',[snapshotId])).rows[0];
  const compressed=(await this.db.pool.query('SELECT sum(octet_length(compressed))::text AS bytes,count(*) FILTER(WHERE compressed IS NULL)::integer AS uncompacted FROM external_source_blobs')).rows[0]!;
  let archiveBytes=0;for(const entry of await readdir(this.directory,{withFileTypes:true})){if(entry.isFile())archiveBytes+=(await stat(path.join(this.directory,entry.name))).size;}
  const rows=Number(completedSnapshot?.rows)||Math.ceil(bytes/Math.max(1,Number(measured.stage_bytes)/Number(measured.n)));
  // CSV staging already contains the full export, including its indexes/TOAST. It is not a detail sample.
  const sqlStagingBytes=relations.filter(r=>r.relation==='external_full_stage').reduce((n,r)=>n+Number(r.total_bytes),0);
  const businessBytes=relations.filter(r=>r.relation!=='external_full_stage').reduce((n,r)=>n+Number(r.total_bytes),0);
  const actualPerDetail=details>=Math.min(10000,rows)&&sample.three_locales===details&&sample.reports+sample.no_report>=details?businessBytes/details:null;
  const projectedBusinessBytes=rows*(actualPerDetail??128*1024)*6;
  const fixedBytes=sqlStagingBytes+archiveBytes+Number(wal),projected=projectedBusinessBytes+fixedBytes;
  const approved=Number(process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES??0),enoughSample=actualPerDetail!==null;
  const allowed=enoughSample&&projected<=Math.min(approved>0?approved:Number.MAX_SAFE_INTEGER,Math.max(0,disk.total*.70-(disk.total-disk.available)));
  const estimate={sampleRows:Number(measured.n),distinctProcessed:details,detailSampleRows:details,threeLocaleCompleted:sample.three_locales,reportCompleted:sample.reports,confirmedNoReport:sample.no_report,csvTarget:Number(completedSnapshot?.rows)||null,estimatedRows:rows,actualBytesPerDetail:actualPerDetail,businessBytes,projectedBusinessBytes,sqlStagingBytes,fixedBytes,relations,walBytes:Number(wal),csvBytes:bytes,archiveDirectoryBytes:archiveBytes,compressedRawBytes:compressed.bytes===null?null:Number(compressed.bytes),uncompactedRawBlobs:compressed.uncompacted,
    estimatedBytes:projected,approvedBudgetBytes:approved||null,allowed,assumptions:['Business relation sizes include indexes and compressed raw storage, excluding the complete SQL CSV staging relation.','SQL staging (including indexes/TOAST), actual archive files and measured WAL delta are fixed costs, never extrapolated per detail.','csvBytes is source metadata; the actual files are counted once in archiveDirectoryBytes.','WAL delta includes concurrent database activity.','6x applies only to business growth for retained history and backup headroom; OPS separately measures whole-disk and backup costs.','128KiB per vehicle is a conservative fallback, not a measured detail size.','Automatic continuation requires complete three-language details and checked report presence for the sample.'],at:new Date().toISOString()};
  await this.db.pool.query('UPDATE external_full_sync SET capacity_estimate=$1,capacity_pending=NOT $2 WHERE id=1',[JSON.stringify(estimate),allowed]);
  if(!allowed)throw new FullSyncError(enoughSample||approved>0?'SYNC_CAPACITY_ESTIMATE':'SYNC_CAPACITY_PENDING');
 }
 async promoteSnapshot(id:string){
  const remaining=await this.sampleRemaining();if(!remaining)return 0;
  const target=Math.min(500,remaining);let promoted=0;
  // At most ten 100-row transactions per tick; interleaved sources can fill one real 500-ID bulk.
  for(let part=0;part<10;part++){
   const ready=(await this.db.pool.query(`SELECT source,count(*)::integer AS n FROM (
    SELECT w.source FROM external_full_work w JOIN external_full_members m USING(source,external_id)
    WHERE w.kind='detail' AND w.attempts<5 AND w.due_at<=now() AND m.state<>'withdrawn'
    ORDER BY w.priority DESC,w.due_at,w.source,w.external_id LIMIT 1000) q GROUP BY source`)).rows;
   if(ready.some(row=>row.n>=target))break;
   const count=await this.promoteSnapshotChunk(id);promoted+=count;if(count<100)break;
   await this.applyEvents(true);
  }
  return promoted;
 }
 private async promoteSnapshotChunk(id:string){
  if(await this.sampleSaturated())return 0;await this.heavy();return this.transaction(async tx=>{
   const snap=(await tx.query("SELECT * FROM external_full_snapshots WHERE id=$1 AND state IN('verified','applying') FOR UPDATE",[id])).rows[0];if(!snap)return 0;
   const rows=(await tx.query('SELECT * FROM external_full_stage WHERE snapshot_id=$1 AND row_number>$2 ORDER BY row_number LIMIT 100',[id,snap.apply_cursor])).rows;
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   for(const entry of rows){let m=await ensureMember(tx,entry.source,entry.external_id);const row=entry.payload as CatalogCsvRow;
    const alias=parseAlias(row.duplicate_of);if(alias)await bindAlias(tx,entry.source,entry.external_id,alias,new Date(snap.generated_at).toISOString());
    m=(await tx.query('SELECT * FROM external_full_members WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id])).rows[0]!;
    const stableRow=Object.fromEntries(Object.entries(row).filter(([key])=>!['first_seen_at','last_seen_at','detail_fetched_at','export_price_usd'].includes(key)));const rowHash=jsonHash(stableRow);
    if(m.csv_hash===rowHash&&m.last_detail_at){await tx.query('UPDATE external_full_members SET last_snapshot=$3,verification_pending=false WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id,id]);continue;}
    if(new Date(snap.generated_at).getTime()>=new Date(m.business_at).getTime()){
     const docs:SourceDocument[]=[{identity:identity(entry.source,entry.external_id),kind:'csv',locale:'und',observedAt:new Date(snap.generated_at).toISOString(),sourceUpdatedAt:null,payload:row}];
     const updated=(await tx.query(`UPDATE external_full_members SET desired_generation=desired_generation+1,last_snapshot=$3,verification_pending=false,has_report=$4,
      business_at=$5,csv_hash=$6,state='pending',locales='{}' WHERE source=$1 AND external_id=$2 RETURNING desired_generation`,[entry.source,entry.external_id,id,['true','1'].includes(row.has_report),snap.generated_at,rowHash])).rows[0]!;
     await queue(tx,entry.source,entry.external_id,'detail',updated.desired_generation,50);
     const refs=await archiveSourceDocuments(tx,docs,workRef(entry.source,entry.external_id,'detail'));
     await tx.query('UPDATE external_full_work SET document_refs=$3 WHERE source=$1 AND external_id=$2 AND kind=\'detail\'',[entry.source,entry.external_id,JSON.stringify(refs)]);
    }else await tx.query('UPDATE external_full_members SET last_snapshot=$3 WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id,id]);
   }
   const last=rows.at(-1)?.row_number??snap.apply_cursor,complete=BigInt(last)>=BigInt(snap.rows);
   await tx.query("UPDATE external_full_snapshots SET state=$2,apply_cursor=$3,completed_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$1",[id,complete?'complete':'applying',last,complete]);
   if(complete)await tx.query("UPDATE external_full_sync SET next_snapshot_at=now()+interval '1 day' WHERE id=1");
   return rows.length;
  });
 }
 async details(){
  await this.heavy();const remaining=await this.sampleRemaining();
  // At the boundary only refresh existing sample members invalidated by newer events; never fetch a new identity.
  const selected=(await this.db.pool.query(`SELECT w.source FROM external_full_work w JOIN external_full_members m USING(source,external_id) WHERE w.kind='detail' AND w.attempts<5 AND w.due_at<=now() AND m.state<>'withdrawn' AND ($1=false OR m.sampled) ORDER BY w.priority DESC,w.due_at,w.source,w.external_id LIMIT 1`,[remaining===0])).rows[0];
  if(!selected)return 0;const jobs=(await this.db.pool.query(`SELECT w.* FROM external_full_work w JOIN external_full_members m USING(source,external_id)
   WHERE w.kind='detail' AND w.source=$3 AND w.attempts<5 AND w.due_at<=now() AND m.state<>'withdrawn' AND ($2=false OR m.sampled) ORDER BY w.priority DESC,w.due_at,w.source,w.external_id LIMIT $1`,[remaining===0?500:Math.min(500,remaining),remaining===0,selected.source])).rows;
  if(!jobs.length)return 0;
  for(const source of ['che168','dongchedi'] as const)for(const locale of ['zh','en','ru'] as const){
   const wanted=jobs.filter(j=>j.source===source&&!j.locales.includes(locale));if(!wanted.length)continue;
   try{for await(const response of this.client.bulk(source,wanted.map(j=>j.external_id),locale)){
    await this.heavy();await this.transaction(tx=>persistSourceResponse(tx,response.rawResponse));
    for(const payload of response.results){const job=wanted.find(j=>j.external_id===payload.id)!;
     await this.transaction(async tx=>{
      const current=(await tx.query("SELECT * FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail' FOR UPDATE",[source,payload.id])).rows[0];
      if(!current||String(current.generation)!==String(job.generation))return;
      const at=new Date().toISOString(),doc:SourceDocument={identity:identity(source,payload.id),kind:'detail',locale,observedAt:at,sourceUpdatedAt:typeof payload.updatedAt==='string'?payload.updatedAt:null,payload,rawResponse:{hash:response.rawResponse.hash}};
      const refs=await archiveSourceDocuments(tx,[doc],workRef(source,payload.id,'detail'));
      await tx.query(`UPDATE external_full_work SET document_refs=document_refs||$3::jsonb,locales=ARRAY(SELECT DISTINCT unnest(locales||$4::text[])) WHERE source=$1 AND external_id=$2 AND kind='detail'`,[source,payload.id,JSON.stringify(refs),[locale]]);
     });
    }
    for(const id of response.notFound)await this.failWork(source,id,'detail','SYNC_DETAIL_NOT_FOUND');
   }}catch(error){if(error instanceof FullSyncError&&(error.code.startsWith('SYNC_ACCOUNT_')||error.code==='SYNC_SOURCE_FORBIDDEN'))throw error;for(const job of wanted.filter(j=>!(error instanceof FullSyncError)||!error.affectedIds||error.affectedIds.includes(j.external_id)))await this.failWork(source,job.external_id,'detail',errorCode(error));throw error;}
  }
  let applied=0;
  for(const job of jobs){try{await this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const current=(await tx.query("SELECT * FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail' FOR UPDATE",[job.source,job.external_id])).rows[0];
   const member=await ensureMember(tx,job.source,job.external_id);
   if(!current||current.locales.length!==3)return;
   if(String(current.generation)!==String(member.desired_generation)||member.state==='withdrawn'){
    await releaseSourceReferences(tx,'pending',workRef(job.source,job.external_id,'detail'));await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail'",[job.source,job.external_id]);return;}
   const docs=await loadSourceDocumentRefs(tx,current.document_refs),detail=docs.find(d=>d.kind==='detail'&&d.locale==='en')?.payload as Record<string,unknown>|undefined;
   // Explicit active/removed evidence is different from HTTP notFound, which remains unresolved.
   const withdrawn=detail?.status==='removed'||detail?.status==='withdrawn';
   if(Array.isArray(detail?.alsoListedOn))for(const entry of detail.alsoListedOn){if(entry&&typeof entry==='object'&&'source' in entry&&'id' in entry&&['che168','dongchedi'].includes(String(entry.source))&&/^\d{1,100}$/.test(String(entry.id)))await bindAlias(tx,job.source,job.external_id,{source:entry.source as Source,id:String(entry.id)},new Date().toISOString());}
   const canonical=(await tx.query('SELECT canonical_id FROM external_full_members WHERE source=$1 AND external_id=$2',[job.source,job.external_id])).rows[0]!.canonical_id;
   const at=new Date().toISOString();
   await tx.query(`UPDATE external_full_members SET state=$3,locales=$4,applied_generation=desired_generation,last_detail_at=$5,verification_pending=false,
    sampled=true,has_report=$6,report_state=$7 WHERE source=$1 AND external_id=$2`,[job.source,job.external_id,withdrawn?'withdrawn':'active',current.locales,at,detail?.hasInspectionReport===true||detail?.inspectionAvailable===true,detail?.hasInspectionReport===false&&detail?.inspectionAvailable!==true?'no_report':'pending']);
   await this.apply(tx,{source:job.source,externalId:job.external_id,canonicalId:canonical,operation:withdrawn?'withdraw':'upsert',documents:docs,at,batchId:member.last_snapshot??randomUUID()});
   await releaseSourceReferences(tx,'pending',workRef(job.source,job.external_id,'detail'));await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail'",[job.source,job.external_id]);
   await tx.query("UPDATE external_full_members SET photo_expires_at=(SELECT min(e.expires_at) FROM external_media e JOIN external_listings l ON l.id=e.listing_id WHERE l.provider='chinacarapi' AND l.platform_id=$1 AND l.external_id=$2 AND e.active) WHERE source=$1 AND external_id=$2",[job.source,job.external_id]);
   if(!withdrawn&&!(detail?.hasInspectionReport===false&&detail?.inspectionAvailable!==true))await queue(tx,job.source,job.external_id,'report',member.desired_generation,10);
   applied++;
  });}catch(error){await this.failWork(job.source,job.external_id,'detail',errorCode(error));}}return applied;
 }
 private async failWork(source:Source,id:string,kind:string,code:string){await this.db.pool.query(`UPDATE external_full_work SET attempts=attempts+1,last_error_code=$4,due_at=now()+least(3600,power(2,attempts+1)*30)*interval '1 second' WHERE source=$1 AND external_id=$2 AND kind=$3`,[source,id,kind,code]);}
 async report(){
  await this.heavy();const job=(await this.db.pool.query("SELECT * FROM external_full_work WHERE kind='report' AND attempts<5 AND due_at<=now() ORDER BY priority DESC,due_at LIMIT 1")).rows[0];if(!job)return 0;
  try{const response=await this.client.report(job.source,job.external_id);await this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');const m=await ensureMember(tx,job.source,job.external_id);
   if(String(m.desired_generation)!==String(job.generation)||m.state==='withdrawn'){await releaseSourceReferences(tx,'pending',workRef(job.source,job.external_id,'report'));await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='report'",[job.source,job.external_id]);return;}
   await persistSourceResponse(tx,response.rawResponse);const at=new Date().toISOString();
   await this.apply(tx,{source:job.source,externalId:job.external_id,canonicalId:m.canonical_id,operation:'upsert',at,batchId:m.last_snapshot??randomUUID(),documents:[{identity:identity(job.source,job.external_id),kind:'report',locale:'en',observedAt:at,sourceUpdatedAt:null,payload:response.payload,rawResponse:{hash:response.rawResponse.hash}}]});
   await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='report'",[job.source,job.external_id]);await tx.query('UPDATE external_full_members SET report_checked_at=now(),report_state=$3 WHERE source=$1 AND external_id=$2',[job.source,job.external_id,response.payload&&typeof response.payload==='object'&&'available' in response.payload&&response.payload.available===false?'unavailable':response.payload&&typeof response.payload==='object'&&'hasReport' in response.payload&&response.payload.hasReport===false?'no_report':response.payload&&typeof response.payload==='object'&&['summary','checks','defects','counts'].some(key=>Array.isArray((response.payload as Record<string,unknown>)[key]))?'available':'unavailable']);
  });return 1;}catch(error){if(error instanceof FullSyncError&&error.code==='SYNC_HTTP_404'){await this.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(78291332)');const member=await ensureMember(tx,job.source,job.external_id);
    if(String(member.desired_generation)!==String(job.generation)||member.state==='withdrawn')return;
    const at=new Date().toISOString();await this.apply(tx,{source:job.source,externalId:job.external_id,canonicalId:member.canonical_id,operation:'upsert',at,batchId:member.last_snapshot??randomUUID(),documents:[{identity:identity(job.source,job.external_id),kind:'report',locale:'en',observedAt:at,sourceUpdatedAt:null,payload:{source:job.source,id:job.external_id,available:false,observation:{httpStatus:404,kind:'transport_observation'}}}]});
    await tx.query("UPDATE external_full_members SET report_state='unavailable',report_checked_at=now() WHERE source=$1 AND external_id=$2 AND desired_generation=$3",[job.source,job.external_id,job.generation]);await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='report' AND generation=$3",[job.source,job.external_id,job.generation]);});return 1;}await this.failWork(job.source,job.external_id,'report',errorCode(error));return 0;}
 }
 async rotate(){
  if(await this.sampleSaturated())return 0;await this.heavy();return this.transaction(async tx=>{
   // Missing in one complete export is a high-priority verification, never a removal signal.
   const latest=(await tx.query("SELECT id FROM external_full_snapshots WHERE state='complete' ORDER BY created_at DESC LIMIT 1")).rows[0]?.id;
   const rows=(await tx.query(`SELECT m.* FROM external_full_members m WHERE state<>'withdrawn' AND NOT EXISTS(SELECT 1 FROM external_full_work w WHERE w.source=m.source AND w.external_id=m.external_id AND kind='detail') AND
    (last_detail_at IS NULL OR last_detail_at<now()-interval '7 days' OR last_accessed_at>last_detail_at OR photo_expires_at<now()+interval '1 day' OR ($1::uuid IS NOT NULL AND last_snapshot IS DISTINCT FROM $1 AND NOT verification_pending))
    ORDER BY (last_accessed_at>last_detail_at) DESC NULLS LAST,(photo_expires_at<now()+interval '1 day') DESC NULLS LAST,last_detail_at NULLS FIRST,source,external_id LIMIT 100`,[latest])).rows;
   for(const m of rows){const next=(await tx.query(`UPDATE external_full_members SET desired_generation=desired_generation+1,verification_pending=verification_pending OR ($3::uuid IS NOT NULL AND last_snapshot IS DISTINCT FROM $3) WHERE source=$1 AND external_id=$2 RETURNING desired_generation`,[m.source,m.external_id,latest])).rows[0]!;
    await queue(tx,m.source,m.external_id,'detail',next.desired_generation,m.last_accessed_at||m.photo_expires_at?30:0);}
   return rows.length;
  });
 }
 async daily(){
  await this.heavy();for(const kind of ['account','dictionary'] as const){
   if((await this.db.pool.query("SELECT 1 FROM external_full_daily WHERE kind=$1 AND day=(now() AT TIME ZONE 'UTC')::date",[kind])).rowCount)continue;
   const result=await this.client.daily(kind);await this.transaction(async tx=>{await persistSourceResponse(tx,result.rawResponse);
    await protectSourceBlob(tx,result.rawResponse.hash,{kind:'pending',reference:`full-daily:${kind}:${new Date().toISOString().slice(0,10)}`});
    await tx.query("INSERT INTO external_full_daily VALUES($1,(now() AT TIME ZONE 'UTC')::date,$2) ON CONFLICT DO NOTHING",[kind,result.rawResponse.hash]);
    if(kind==='account'){const account=syncAccount(result.payload);
     await tx.query('UPDATE external_full_sync SET account=$1,account_checked_at=clock_timestamp(),account_reserved_ids=0 WHERE id=1',[JSON.stringify(account)]);
    }
   });
  }
  await this.transaction(async tx=>{const old=(await tx.query("SELECT kind,to_char(day,'YYYY-MM-DD') AS day FROM external_full_daily d WHERE day<current_date-7 OR (SELECT count(*) FROM external_full_daily newer WHERE newer.kind=d.kind AND newer.day>d.day)>=2 LIMIT 100")).rows;for(const row of old){await releaseSourceReferences(tx,'pending',`full-daily:${row.kind}:${row.day}`);await tx.query('DELETE FROM external_full_daily WHERE kind=$1 AND day=$2',[row.kind,row.day]);}});
  await this.pruneStaging();
  await this.db.pool.query("UPDATE external_full_sync SET next_maintenance_at=(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' WHERE id=1");
 }
 async sampleRemaining(){
  const row=(await this.db.pool.query(`SELECT last_capacity_sample,(SELECT count(*) FROM external_full_members WHERE sampled AND state<>'withdrawn') AS sampled,
   (SELECT rows FROM external_full_snapshots WHERE rows>0 ORDER BY created_at DESC LIMIT 1) AS target FROM external_full_sync WHERE id=1`)).rows[0]!;
  if(Number(row.last_capacity_sample)>0)return 500;
  return Math.max(0,10000-Number(row.sampled));
 }
 async sampleSaturated(){return await this.sampleRemaining()===0;}
 async capacityGate(){
  if(!await this.sampleSaturated())return;
  const incomplete=(await this.db.pool.query("SELECT 1 FROM external_full_members WHERE sampled AND (cardinality(locales)<>3 OR report_state NOT IN('available','unavailable','no_report')) AND state<>'withdrawn' LIMIT 1")).rowCount;
  if(incomplete)return; // Reports continue independently while new detail work waits at the sample boundary.
  const snap=(await this.db.pool.query("SELECT id,bytes FROM external_full_snapshots WHERE state IN('verified','applying','complete') ORDER BY created_at DESC LIMIT 1")).rows[0];
  if(!snap)return;await this.estimateCapacity(snap.id,Number(snap.bytes));
  await this.db.pool.query("UPDATE external_full_sync SET last_capacity_sample=(SELECT count(*) FROM external_full_members WHERE sampled AND state<>'withdrawn'),capacity_pending=false WHERE id=1");
 }
 async pruneStaging(){
  await this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291334)');
   const obsolete=(await tx.query(`SELECT s.id,s.path FROM external_full_snapshots s WHERE s.archive_pruned_at IS NULL AND s.state IN('complete','failed') AND
    (s.created_at<now()-interval '7 days' OR s.id NOT IN(SELECT id FROM external_full_snapshots ORDER BY created_at DESC LIMIT 2)) AND
    NOT EXISTS(SELECT 1 FROM external_full_archive_pins p WHERE p.snapshot_id=s.id) ORDER BY s.created_at LIMIT 1`)).rows[0];
   if(!obsolete)return;
   await tx.query('DELETE FROM external_full_stage WHERE ctid IN(SELECT ctid FROM external_full_stage WHERE snapshot_id=$1 LIMIT 200)',[obsolete.id]);
   if(!(await tx.query('SELECT 1 FROM external_full_stage WHERE snapshot_id=$1 LIMIT 1',[obsolete.id])).rowCount){
    if(path.dirname(obsolete.path)!==this.directory)throw new FullSyncError('SYNC_ARCHIVE_PATH');
    await unlink(obsolete.path).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});await tx.query('UPDATE external_full_snapshots SET archive_pruned_at=now() WHERE id=$1',[obsolete.id]);
   }
  });
 }
 async recover(){
  await this.alive();await this.transaction(async tx=>{
   const s=(await tx.query('SELECT * FROM external_full_sync WHERE id=1 FOR UPDATE')).rows[0]!;if(s.recovery_count>=2)throw new FullSyncError('SYNC_RECOVERY_LIMIT');
   await tx.query("UPDATE external_full_snapshots SET state='failed',error_code='SYNC_CURSOR_EXPIRED' WHERE state IN('downloading','staging','verified','applying')");
   await tx.query("UPDATE external_full_sync SET receive_cursor=NULL,since_at=NULL,next_snapshot_at=now(),recovery_count=recovery_count+1 WHERE id=1");
  });
 }
 async tick(){
  await this.alive();await mkdir(this.directory,{recursive:true,mode:0o700});const s=await this.state();if(!s.enabled)return;
  try{
   // Withdrawal application is first and remains available when heavy work is paused or disk usage is high.
   await this.applyEvents(true);
   if(s.since_at&&new Date(s.next_delta_at).getTime()<=Date.now())try{await this.receiveDelta();}catch(e){if(e instanceof FullSyncError&&e.code==='SYNC_CURSOR_EXPIRED')await this.recover();else throw e;}
   await this.applyEvents(true);const disk=await this.space();if(s.paused||disk.used>=.70)return;
   await this.applyEvents();await runSourceMaintenance(this.db);if(s.capacity_pending){await this.capacityGate();if((await this.state()).capacity_pending)return;}
   if(new Date(s.next_maintenance_at).getTime()<=Date.now())await this.daily();
   const active=(await this.db.pool.query("SELECT id FROM external_full_snapshots WHERE state IN('downloading','staging','verified','applying') LIMIT 1")).rows[0];
   const initialPending=(await this.db.pool.query("SELECT 1 FROM external_full_work WHERE kind='detail' LIMIT 1")).rowCount;
   if(active||((!s.since_at||!initialPending)&&new Date(s.next_snapshot_at).getTime()<=Date.now()&&(s.mode==='continuous'||!s.last_success_at)))await this.snapshot();
   await this.details();for(let reports=0;reports<20;reports++){if(!await this.report())break;}
   await this.capacityGate();await this.rotate();await this.pruneStaging();
   const pending=(await this.db.pool.query("SELECT 1 FROM external_full_work UNION ALL SELECT 1 FROM external_full_events WHERE applied_at IS NULL UNION ALL SELECT 1 FROM external_full_members WHERE state<>'withdrawn' AND (applied_generation<desired_generation OR cardinality(locales)<3 OR verification_pending) LIMIT 1")).rowCount;
   const building=(await this.db.pool.query("SELECT 1 FROM external_full_snapshots WHERE state IN('downloading','staging','verified','applying') LIMIT 1")).rowCount;
   if(!pending&&!building)await this.db.pool.query('UPDATE external_full_sync SET last_success_at=now(),last_error_code=NULL,last_error_at=NULL WHERE id=1');
  }catch(error){const code=errorCode(error);if(code==='SYNC_CURSOR_EXPIRED')await this.recover();await this.db.pool.query('UPDATE external_full_sync SET last_error_code=$1,last_error_at=now() WHERE id=1',[code]);if(code!=='SYNC_HEAVY_PAUSED')throw error;}
 }
}

/** Public detail read hint. Throttled writes cannot turn each page request into a refresh job. */
export async function markFullSyncAccess(db:Database,source:Source,externalId:string){
 await db.pool.query("UPDATE external_full_members SET last_accessed_at=now() WHERE source=$1 AND external_id=$2 AND (last_accessed_at IS NULL OR last_accessed_at<now()-interval '1 hour')",[source,externalId]);
}
export async function pinFullSyncArchive(db:Database,snapshotId:string,reference:string){
 await db.pool.query('INSERT INTO external_full_archive_pins VALUES($1,$2) ON CONFLICT DO NOTHING',[snapshotId,reference]);
}
export async function releaseFullSyncArchive(db:Database,reference:string){
 await db.pool.query('DELETE FROM external_full_archive_pins WHERE reference=$1',[reference]);
}
