import {physicalCleanupAllowed} from '../../backup-lease.js';
import {randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {mkdir,statfs,stat,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import type {Database} from '../../db/index.js';
import {verifyCatalogCsv,persistSourceResponse,persistSourceDocument,archiveSourceDocuments,loadSourceDocumentRefs,releaseSourceReferences,protectSourceBlob,type SourceDocument,type CatalogCsvRow} from '../sources/index.js';
import {SERVICE_ACTOR} from '../ingestion/worker.js';
import {jsonHash} from '../normalize.js';
import {admitFormalListing,clearFormalWithdrawal,formalAdmissionInstalled,formalWithdrawal,isFormalListingAdmitted,permitFullSyncAdmission,rememberFormalWithdrawal,DEFAULT_FORMAL_LISTING_LIMIT,FORMAL_LISTING_LIMIT_CODE} from '../formal-admission.js';
import {runSourceMaintenance} from './maintenance.js';
import {syncAccount} from './quota.js';
import {advanceCapacitySampleLifecycle,capacitySample,capacityBinding,capacityTarget,capacitySampleTarget,verifiedSnapshotTarget,validMeasuredCohort,readCapacityDecision,type MeasuredCohort,type CapacityDisk,type CapacitySample} from './capacity.js';
import {recordReceiveObservation,recordDetailTiming,recordWithdrawalTiming,supersedeTiming} from './timing.js';
import {FullSyncClient} from './client.js';
import {applyFullSource,ensureMember,bindAlias,parseAlias} from './apply.js';
import {ADMISSION_REPLAY_BATCH, checkScheduledReplayDetail, currentReplaySnapshot, eligibleReplayEvents} from './admission-replay.js';
import {FullSyncError,LIMITS,type Actor,type FullApply,type Source,type Locale} from './types.js';
const identity=(source:Source,externalId:string)=>({provider:'chinacarapi' as const,source,externalId});
const workRef=(source:string,id:string,kind:string)=>`full:${source}:${id}:${kind}`;
const errorCode=(error:unknown)=>error instanceof FullSyncError?error.code:'SYNC_OPERATION_FAILED';
const capacityMeasurementMaxAgeMs=30_000;
type CapacitySnapshot=Parameters<typeof capacityTarget>[0]&{id:string;bytes:string};
type CapacityMeasurement={state:Record<string,any>;disk:CapacityDisk;sample:CapacitySample;snapshot:CapacitySnapshot|undefined};
function completeCapacitySample(snapshot:CapacitySnapshot|undefined,sample:CapacitySample) {
 return !!snapshot&&capacityTarget(snapshot)>0&&sample.details>0&&sample.details<=10000&&sample.details>=capacitySampleTarget(snapshot)
  &&sample.three_locales===sample.active_details&&sample.reports+sample.no_report===sample.active_details;
}
type TickPhase='startup'|'withdrawals'|'delta_receive'|'delta_apply'|'space'|'source_maintenance'|
 'daily'|'snapshot'|'details'|'admission_replay'|'reports'|'capacity'|'rotation'|'archive_cleanup'|'finalize';
export async function configureFullSync(db:Database,actor:Actor,mode:'full'|'continuous'){
 if(!await formalAdmissionInstalled(db.pool))throw new FullSyncError('SYNC_ADMISSION_MIGRATION_REQUIRED');
 return db.transaction(async tx=>{
  if(!(await tx.query("SELECT id FROM staff WHERE id=$1 AND role='admin' AND NOT banned",[actor.id])).rowCount)throw new FullSyncError('SYNC_ADMIN_REQUIRED');
  await tx.query(`INSERT INTO staff(id,name,email,role,banned) VALUES($1,'ChinaCarAPI import service','chinacarapi-worker@example.invalid','editor',true) ON CONFLICT(id) DO NOTHING`,[SERVICE_ACTOR]);
  if(!(await tx.query(`SELECT id FROM staff s WHERE id=$1 AND banned AND NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE a.user_id=s.id) AND NOT EXISTS(SELECT 1 FROM staff_sessions t WHERE t.user_id=s.id)`,[SERVICE_ACTOR])).rowCount)throw new FullSyncError('SYNC_SERVICE_INVALID');
  await tx.query("UPDATE external_full_sync SET capacity_baseline=coalesce(capacity_baseline,jsonb_build_object('walLsn',pg_current_wal_lsn()::text,'databaseBytes',pg_database_size(current_database()),'at',clock_timestamp())) WHERE id=1");
  await tx.query("INSERT INTO external_full_members(source,external_id,canonical_id,state,event_order,business_at,locales,last_detail_at,applied_generation) SELECT l.platform_id,l.external_id,l.formal_canonical_id,l.upstream_state,coalesce(i.business_order,0),coalesce(i.business_at,l.fetched_at),'{}',l.fetched_at,1 FROM external_listings l LEFT JOIN external_ingestion_identity_state i ON i.provider=l.provider AND i.source=l.platform_id AND i.external_id=l.external_id WHERE l.provider='chinacarapi' AND l.formal_canonical_id IS NOT NULL AND EXISTS(SELECT 1 FROM external_formal_admissions a WHERE a.source=l.platform_id AND a.external_id=l.external_id) ON CONFLICT DO NOTHING");
  await tx.query("UPDATE external_full_members SET locales=ARRAY['zh','en','ru'] WHERE state='active' AND last_detail_at IS NOT NULL AND cardinality(locales)=0 AND desired_generation=applied_generation");
  await tx.query('UPDATE external_full_sync SET enabled=true,paused=false,mode=$1,triggered_by=$2,version=version+1,updated_at=now() WHERE id=1',[mode,actor.id]);
 });
}
async function queue(tx:PoolClient,source:Source,id:string,kind:'detail'|'report',generation:string|number,priority:number){
 const prior=(await tx.query('SELECT generation FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind=$3 FOR UPDATE',[source,id,kind])).rows[0];
 if(prior&&BigInt(prior.generation)!==BigInt(generation))await releaseSourceReferences(tx,'pending',workRef(source,id,kind));
 await tx.query(`INSERT INTO external_full_work(source,external_id,kind,generation,priority) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(source,external_id,kind) DO UPDATE SET priority=CASE WHEN external_full_work.generation=excluded.generation THEN greatest(external_full_work.priority,excluded.priority) ELSE excluded.priority END,
 document_refs=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.document_refs ELSE '[]'::jsonb END,
 locales=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.locales ELSE '{}'::text[] END,
 attempts=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.attempts ELSE 0 END,
 due_at=CASE WHEN external_full_work.generation=excluded.generation THEN external_full_work.due_at ELSE now() END,generation=excluded.generation`,[source,id,kind,generation,priority]);
}
async function finishReplayPlan(tx:PoolClient,replayId:string){
 await tx.query(`UPDATE external_full_admission_replays r SET state='finished' WHERE id=$1 AND state IN ('pending','scheduled')
  AND NOT EXISTS (SELECT 1 FROM external_full_admission_replay_items i WHERE i.replay_id=r.id AND i.state IN ('pending','scheduled'))`,[replayId]);
}
async function retireReplayDetail(tx:PoolClient,replay:{replay_id:string;event_id:string;placeholder_created:boolean},
 source:Source,id:string,generation:string,state:'superseded'|'verified_withdrawn'|'unresolved_not_found'|'unresolved_unverified'|'retry_limit'|'unresolved_no_work'='superseded'){
 await tx.query("UPDATE external_full_admission_replay_items SET state=$3,processed_at=clock_timestamp() WHERE replay_id=$1 AND event_id=$2",
  [replay.replay_id,replay.event_id,state]);
 const deleted=await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail' AND generation=$3",[source,id,generation]);
 if(deleted.rowCount)await releaseSourceReferences(tx,'pending',workRef(source,id,'detail'));
 if(replay.placeholder_created)await tx.query(`DELETE FROM external_full_members m WHERE m.source=$1 AND m.external_id=$2
  AND m.desired_generation=$3 AND m.applied_generation=0
  AND NOT EXISTS (SELECT 1 FROM external_formal_admissions a WHERE a.source=m.source AND a.external_id=m.external_id)
  AND NOT EXISTS (SELECT 1 FROM external_full_work w WHERE w.source=m.source AND w.external_id=m.external_id)`,[source,id,generation]);
 await finishReplayPlan(tx,replay.replay_id);
}
export class FullSyncWorker{
 private lock:PoolClient|null=null;private lost=false;private fence:string|null=null;
 private phase:TickPhase='startup';
 constructor(readonly db:Database,readonly client:FullSyncClient,readonly directory:string,private apply:FullApply=applyFullSource){}
 get tickPhase(){return this.phase;}
 /** One dedicated connection owns the process lease; pool's remaining connection executes short transactions. */
 async acquire(){
  if(!await formalAdmissionInstalled(this.db.pool))throw new FullSyncError('SYNC_ADMISSION_MIGRATION_REQUIRED');
  if(!(await this.db.pool.query(`SELECT to_regclass('external_full_admission_replays') IS NOT NULL
    AND to_regclass('external_full_admission_replay_items') IS NOT NULL AS installed`)).rows[0]?.installed)
   throw new FullSyncError('SYNC_REPLAY_MIGRATION_REQUIRED');
  const c=await this.db.pool.connect();if(!(await c.query('SELECT pg_try_advisory_lock(78291333) AS ok')).rows[0].ok){c.release();return false;}
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
 // Only work restricted to existing sampled members (and its required account refresh) may request sampleRepair.
 async heavy(sampleRepair=false){
  await this.alive();const s=await this.state(),disk=await this.space();
  if(!s.enabled||s.paused||disk.used>=.70)throw new FullSyncError('SYNC_HEAVY_PAUSED');
  if(!sampleRepair){if(s.capacity_pending)throw new FullSyncError('SYNC_CAPACITY_PENDING');if(Number(s.last_capacity_sample)>0)await this.checkCapacityDecision(s,disk);}
 }
 private async checkCapacityDecision(state:Record<string,any>,disk:CapacityDisk){
  const snapshot=await this.capacitySnapshot();
  const sample=await capacitySample(this.db),prior=state.capacity_baseline?.detailSample;
  const enough=snapshot&&completeCapacitySample(snapshot,sample)&&validMeasuredCohort(prior,sample);
  const result=enough?await readCapacityDecision(process.env.FULL_SYNC_CAPACITY_DECISION_FILE,
   capacityBinding(snapshot.id,capacityTarget(snapshot),sample,prior,state.capacity_baseline?.sampleLifecycleEpoch??null),
   disk,Number(process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES??0)):{allowed:false,code:'SYNC_CAPACITY_INSUFFICIENT_SAMPLE'};
  if(!result.allowed){await this.db.pool.query('UPDATE external_full_sync SET capacity_pending=true WHERE id=1');throw new FullSyncError(result.code!);}
 }
 private async capacitySnapshot(id?:string):Promise<CapacitySnapshot|undefined>{
  return (await this.db.pool.query<CapacitySnapshot>(`SELECT s.id,s.rows,s.target_rows,s.bytes,a.admitted_count,a.admission_limit
   FROM external_full_snapshots s CROSS JOIN external_formal_admission_state a WHERE a.id=1
   AND ${id===undefined?"s.state IN('verified','applying','complete')":'s.id=$1'} ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,
  id===undefined?[]:[id])).rows[0];
 }
 /** 2000-event page staged in 100-event transactions. Cursor advances only after every chunk and raw evidence is durable. */
 async receiveDelta(){
  await this.alive();const s=await this.state();if(!s.since_at)return false;
  try{
  const page=await this.client.changes(new Date(s.since_at).toISOString(),s.receive_cursor===null?null:String(s.receive_cursor));
  const key=s.receive_cursor===null?`since:${new Date(s.since_at).toISOString()}`:`cursor:${s.receive_cursor}`;
  await this.transaction(async tx=>{await persistSourceResponse(tx,page.rawResponse);await protectSourceBlob(tx,page.rawResponse.hash,{kind:'pending',reference:`full-page:${key}`});});
  for(let offset=0;offset<page.changes.length;offset+=LIMITS.dbBatch){await this.alive();await this.transaction(async tx=>{
   for(const e of page.changes.slice(offset,offset+LIMITS.dbBatch)){
    const existing=(await tx.query('SELECT payload_hash FROM external_full_events WHERE event_id=$1',[e.id])).rows[0];if(existing){if(existing.payload_hash!==jsonHash(e))throw new FullSyncError('SYNC_EVENT_CONFLICT');continue;}
    const ref=`full-event:${e.id}`,docs:SourceDocument[]=[{identity:identity(e.source,e.vehicleId),kind:'event',locale:'und',observedAt:new Date().toISOString(),sourceUpdatedAt:e.at,eventSequence:String(e.id),payload:e,rawResponse:{hash:page.rawResponse.hash}}];
    const refs=await archiveSourceDocuments(tx,docs,ref);
    await tx.query('INSERT INTO external_full_events(event_id,source,external_id,operation,business_at,document_refs,payload_hash,source_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[e.id,e.source,e.vehicleId,e.type==='removed'?'withdraw':e.type==='relisted'?'relist':'upsert',e.at,JSON.stringify(refs),jsonHash(e),e.type]);
    await tx.query('UPDATE external_full_sync SET received_events=received_events+1 WHERE id=1');
   }
  });}
  await this.transaction(async tx=>{
   const current=(await tx.query('SELECT receive_cursor,since_at FROM external_full_sync WHERE id=1 FOR UPDATE')).rows[0]!;
   if(String(current.receive_cursor)!==String(s.receive_cursor)||new Date(current.since_at).getTime()!==new Date(s.since_at).getTime())throw new FullSyncError('SYNC_CURSOR_CONFLICT');
   await tx.query(`INSERT INTO external_full_receipts(cursor_key,next_cursor,event_count,complete) VALUES($1,$2,$3,true) ON CONFLICT(cursor_key) DO UPDATE SET next_cursor=excluded.next_cursor,event_count=excluded.event_count,complete=true`,[key,page.nextCursor,page.changes.length]);
   await tx.query("UPDATE external_full_sync SET receive_cursor=$1,last_receive_at=clock_timestamp(),next_delta_at=CASE WHEN $2 THEN clock_timestamp() ELSE date_bin(interval '5 minutes',clock_timestamp(),'epoch'::timestamptz)+interval '5 minutes' END WHERE id=1",[page.nextCursor,page.hasMore]);
   await releaseSourceReferences(tx,'pending',`full-page:${key}`);
   await recordReceiveObservation(tx);
  });return page.hasMore;
  }catch(error){try{await this.transaction(tx=>recordReceiveObservation(tx,errorCode(error)));}catch{/* Missing coverage remains explicit if the database/lease is unavailable. */}throw error;}
 }
 async applyEvents(withdrawOnly=false){
  await this.alive();
  const events=(await this.db.pool.query(`WITH eligible AS (SELECT e.*,a.external_id IS NOT NULL AS admitted,
   coalesce((e.operation='upsert' AND f.active AND f.locale_mask=7) OR (e.operation='relist' AND l.published_at IS NOT NULL),false) AS urgent,
   admission.admitted_count >= admission.admission_limit AS at_limit FROM external_full_events e
   CROSS JOIN external_formal_admission_state admission
   LEFT JOIN external_formal_admissions a USING(source,external_id)
   LEFT JOIN external_listings l ON l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
   LEFT JOIN external_catalog_filter f ON f.listing_id=l.id
   WHERE admission.id=1 AND e.applied_at IS NULL AND ($1=false OR e.operation='withdraw')
    ), ranked AS (SELECT *,row_number() OVER(PARTITION BY admitted,operation='withdraw' ORDER BY urgent DESC,event_id) AS lane_row FROM eligible)
   SELECT * FROM ranked ORDER BY (operation='withdraw') DESC,
   CASE WHEN admitted AND lane_row<=90 THEN 0 WHEN NOT admitted THEN 1 ELSE 2 END,urgent DESC,event_id LIMIT 100`,[withdrawOnly])).rows;
  let expansionAllowed:boolean|undefined,completed=0;
  for(const event of events){
   const withdraw=event.operation==='withdraw';
   if(!withdraw&&!event.admitted&&!event.at_limit&&expansionAllowed===undefined){
    try{await this.heavy();expansionAllowed=true;}
    catch(error){
     if(!(error instanceof FullSyncError&&(error.code==='SYNC_HEAVY_PAUSED'||error.code.startsWith('SYNC_CAPACITY_'))))throw error;
     expansionAllowed=false;
    }
   }
   const processed=await this.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    const known=await isFormalListingAdmitted(tx,event.source,event.external_id);
    const at=new Date(event.business_at);
    const tombstone=known||withdraw?undefined:await formalWithdrawal(tx,event.source,event.external_id);
    const blockedByWithdrawal=tombstone&&(event.operation!=='relist'||BigInt(event.event_id)<=BigInt(tombstone.business_order)||at<tombstone.business_at);
    let admitted=known,excluded=false,generation:string|null=null,outcome='not_public';
    const prior=(await tx.query(`SELECT c.price_cny,f.active AND f.locale_mask=7 AS visible FROM external_listings l
     JOIN external_catalog c ON c.listing_id=l.id JOIN external_catalog_filter f ON f.listing_id=l.id
     WHERE l.provider='chinacarapi' AND l.platform_id=$1 AND l.external_id=$2`,[event.source,event.external_id])).rows[0];
    if(!known&&withdraw)await rememberFormalWithdrawal(tx,event.source,event.external_id,event.event_id,at);
    if(!known&&!withdraw&&!blockedByWithdrawal){
     const gates=(await tx.query(`SELECT admitted_count >= admission_limit AS at_limit,
        admission_limit>$1 AND EXISTS (SELECT 1 FROM external_full_snapshots WHERE state IN ('downloading','staging','verified','applying')) AS snapshot_first,
        enabled AND NOT paused AND NOT disk_paused AND NOT capacity_pending AS can_expand
        FROM external_full_sync s CROSS JOIN external_formal_admission_state a WHERE s.id=1 AND a.id=1`,[DEFAULT_FORMAL_LISTING_LIMIT])).rows[0]!;
     if(!gates.at_limit&&(!expansionAllowed||!gates.can_expand||gates.snapshot_first))return false;
     if(!gates.at_limit){
      await permitFullSyncAdmission(tx);
      admitted=await admitFormalListing(tx,event.source,event.external_id);
      if(!admitted)return false;
     }
     excluded=!admitted;
    }
    if(admitted){
     const member=await ensureMember(tx,event.source,event.external_id);
     outcome='superseded';
     const newer=BigInt(event.event_id)>BigInt(member.event_order)&&at>=new Date(member.business_at);
     if(newer){
      const canActivate=member.state!=='withdrawn'||event.operation==='relist';
      await tx.query(`UPDATE external_full_members SET event_order=$3,business_at=$4,desired_generation=desired_generation+1,verification_pending=false,
        state=CASE WHEN $5 THEN 'withdrawn' WHEN $6 THEN 'pending' ELSE state END,locales=CASE WHEN $5 THEN locales ELSE '{}'::text[] END,
        has_report=CASE WHEN $7 THEN false ELSE has_report END,report_state=CASE WHEN $7 THEN 'unknown' ELSE report_state END,
        report_checked_at=CASE WHEN $7 THEN NULL ELSE report_checked_at END WHERE source=$1 AND external_id=$2`,
       [event.source,event.external_id,event.event_id,event.business_at,withdraw,canActivate,event.operation==='relist']);
      if(member.sampled&&(event.operation==='relist'||withdraw&&member.state!=='withdrawn'))await advanceCapacitySampleLifecycle(tx);
      const next=(await tx.query('SELECT * FROM external_full_members WHERE source=$1 AND external_id=$2',[event.source,event.external_id])).rows[0]!;
      generation=String(next.desired_generation);outcome=withdraw||canActivate?'pending':'not_public';
      await supersedeTiming(tx,event.source,event.external_id,generation);
      if(withdraw){const docs=await loadSourceDocumentRefs(tx,event.document_refs);await this.apply(tx,{source:event.source,externalId:event.external_id,canonicalId:next.canonical_id,operation:'withdraw',documents:docs,at:at.toISOString(),batchId:randomUUID()});
       for(const kind of ['detail','report'])await releaseSourceReferences(tx,'pending',workRef(event.source,event.external_id,kind));await tx.query('DELETE FROM external_full_work WHERE source=$1 AND external_id=$2',[event.source,event.external_id]);
      }else if(canActivate){
       if(event.operation==='relist')await clearFormalWithdrawal(tx,event.source,event.external_id,at,event.event_id);
       await queue(tx,event.source,event.external_id,'detail',next.desired_generation,event.urgent?100:50);
      }
     }
    }
    const marked=await tx.query('UPDATE external_full_events SET applied_at=clock_timestamp(),error_code=$2,detail_generation=$3,public_outcome=$4,prior_public_price=$5,was_public=$6 WHERE event_id=$1 AND applied_at IS NULL',
     [event.event_id,excluded?FORMAL_LISTING_LIMIT_CODE:null,generation,outcome,prior?.price_cny??null,prior?.visible===true]);
    if(withdraw&&generation)await recordWithdrawalTiming(tx,event.source,event.external_id,generation);
    if(marked.rowCount)await tx.query('UPDATE external_full_sync SET applied_events=applied_events+1 WHERE id=1');
    await releaseSourceReferences(tx,'pending',`full-event:${event.event_id}`);
    return Boolean(marked.rowCount);
   });
   if(processed)completed++;
  }
  return completed;
 }
 /** Recovered denials request fresh details from the ordinary work lane. */
 async replayAdmissions(){
  await this.alive();
  const prepared=(await this.db.pool.query<{id:string;state:string}>("SELECT id,state FROM external_full_admission_replays WHERE state IN ('pending','scheduled') LIMIT 1")).rows[0];
  if(!prepared)return 0;
  const pending=await this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const snapshot=await currentReplaySnapshot(tx);
   const plan=(await tx.query(`SELECT r.*,a.admission_limit=r.target_rows AS ceiling_matches FROM external_full_admission_replays r
    CROSS JOIN external_formal_admission_state a WHERE r.id=$1 AND a.id=1 FOR UPDATE OF r`,[prepared.id])).rows[0]!;
   const scopeCurrent=snapshot?.active&&snapshot.id===plan.snapshot_id&&snapshot.sha256===plan.csv_sha256
    &&snapshot.target===Number(plan.target_rows)&&plan.ceiling_matches;
   const stopped=(await tx.query(`SELECT i.*,i.detail_generation::text AS generation,
     CASE WHEN w.attempts>=5 AND w.last_error_code='SYNC_DETAIL_NOT_FOUND' THEN 'unresolved_not_found'
          WHEN w.attempts>=5 AND w.last_error_code='SYNC_REPLAY_STATUS_UNVERIFIED' THEN 'unresolved_unverified'
          WHEN w.attempts>=5 THEN 'retry_limit'
          WHEN w.source IS NULL THEN 'unresolved_no_work' ELSE 'superseded' END AS outcome
     FROM external_full_admission_replay_items i
     LEFT JOIN external_full_work w ON w.source=i.source AND w.external_id=i.external_id
       AND w.kind='detail' AND w.generation=i.detail_generation
     WHERE i.replay_id=$1 AND i.state='scheduled'
       AND ($2=false OR NOT EXISTS (SELECT 1 FROM external_full_admission_replay_reservations r
         WHERE r.replay_id=i.replay_id AND r.event_id=i.event_id))
     ORDER BY i.event_id LIMIT $3`,[prepared.id,Boolean(scopeCurrent),ADMISSION_REPLAY_BATCH])).rows;
   for(const item of stopped)await retireReplayDetail(tx,item,item.source,item.external_id,item.generation,scopeCurrent?item.outcome:'superseded');
   if(!scopeCurrent){
    await tx.query("UPDATE external_full_admission_replay_items SET state='superseded',processed_at=clock_timestamp() WHERE replay_id=$1 AND state='pending'",[prepared.id]);
    await tx.query(`UPDATE external_full_admission_replays r SET state='superseded' WHERE id=$1 AND NOT EXISTS (
     SELECT 1 FROM external_full_admission_replay_items i WHERE i.replay_id=r.id AND i.state='scheduled')`,[prepared.id]);
    return false;
   }
   return prepared.state==='pending';
  });
  if(!pending)return 0;
  await this.heavy();
  return this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const plan=(await tx.query<{id:string;snapshot_id:string;csv_sha256:string;target_rows:number}>(
    "SELECT id,snapshot_id,csv_sha256,target_rows::int FROM external_full_admission_replays WHERE id=$1 AND state='pending' FOR UPDATE",[prepared.id])).rows[0];
   if(!plan)return 0;
   const snapshot=await currentReplaySnapshot(tx);
   const {ceiling,canAdmit}=(await tx.query<{ceiling:number;canAdmit:boolean}>(`SELECT admission_limit::int AS ceiling,
    enabled AND NOT paused AND NOT disk_paused AND NOT capacity_pending AND last_capacity_sample>0 AS "canAdmit"
    FROM external_full_sync s CROSS JOIN external_formal_admission_state a WHERE s.id=1 AND a.id=1`)).rows[0]!;
   if(!snapshot?.active||snapshot.id!==plan.snapshot_id||snapshot.sha256!==plan.csv_sha256||
      snapshot.target!==plan.target_rows||ceiling!==plan.target_rows){
    await tx.query("UPDATE external_full_admission_replay_items SET state='superseded',processed_at=clock_timestamp() WHERE replay_id=$1 AND state='pending'",[plan.id]);
    await tx.query("UPDATE external_full_admission_replays SET state='superseded' WHERE id=$1",[plan.id]);
    return 0;
   }
   if(!canAdmit||!await physicalCleanupAllowed(tx))return 0;
   const requested=(await tx.query<{event_id:string;source:Source;external_id:string}>(`SELECT event_id::text,source,external_id
     FROM external_full_admission_replay_items WHERE replay_id=$1 AND state='pending' ORDER BY event_id LIMIT $2`,
    [plan.id,ADMISSION_REPLAY_BATCH])).rows;
   const events=new Map((await eligibleReplayEvents(tx,snapshot.id,requested.map(row=>row.event_id))).map(event=>[event.event_id,event]));
   let scheduled=0;
   // Serialize temporary work and permanent allocations under the same ledger lock.
   await tx.query('SELECT 1 FROM external_formal_admission_state WHERE id=1 FOR UPDATE');
   await tx.query("SELECT set_config('hd.external_full_admission_replay',$1,true)",[plan.id]);
   for(const item of requested){
    const event=events.get(item.event_id);
    if(!event){
     const state=await isFormalListingAdmitted(tx,item.source,item.external_id)?'already_admitted':'superseded';
     await tx.query('UPDATE external_full_admission_replay_items SET state=$3,processed_at=clock_timestamp() WHERE replay_id=$1 AND event_id=$2',
      [plan.id,item.event_id,state]);
     continue;
    }
    const prior=(await tx.query<{desired_generation:string}>(`SELECT desired_generation FROM external_full_members
      WHERE source=$1 AND external_id=$2 FOR UPDATE`,[item.source,item.external_id])).rows[0];
    const generation=prior?String(BigInt(prior.desired_generation)+1n):'1';
    await tx.query(`UPDATE external_full_admission_replay_items SET state='scheduled',
      detail_generation=$3,placeholder_created=$4,processed_at=clock_timestamp() WHERE replay_id=$1 AND event_id=$2`,[plan.id,item.event_id,generation,!prior]);
    if(prior)await tx.query('UPDATE external_full_members SET desired_generation=$3 WHERE source=$1 AND external_id=$2',
     [item.source,item.external_id,generation]);
    else await tx.query(`INSERT INTO external_full_members(source,external_id,canonical_id,desired_generation) VALUES($1,$2,$3,$4)`,
     [item.source,item.external_id,`chinacarapi:${item.source}:${item.external_id}`,generation]);
    await queue(tx,item.source,item.external_id,'detail',generation,45);
    scheduled++;
   }
   await tx.query(`UPDATE external_full_admission_replays r SET state='scheduled' WHERE id=$1 AND NOT EXISTS(
    SELECT 1 FROM external_full_admission_replay_items item WHERE item.replay_id=r.id AND item.state='pending')`,[plan.id]);
   await finishReplayPlan(tx,plan.id);
   return scheduled;
  });
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
   const finalized=await this.transaction(async tx=>{
    if(!await physicalCleanupAllowed(tx))return false;
    const target=await verifiedSnapshotTarget(tx,snapshot.id);
    await tx.query("UPDATE external_full_snapshots SET state='verified',rows=$2,source_counts=$3,path=$4,target_rows=$5 WHERE id=$1",
     [snapshot.id,proof.rows,JSON.stringify(proof.sourceCounts),compressed,target]);
    await unlink(snapshot.path);return true;
   });
   if(!finalized)return; // Retain the original path and retry after the backup lease is explicitly released.
  }
  return this.promoteSnapshot(snapshot.id);
 }
 async estimateCapacity(snapshotId:string,bytes:number,input?:CapacityMeasurement){
  const {disk,state,sample,snapshot}=input??{
   disk:await this.space(),state:await this.state(),sample:await capacitySample(this.db),snapshot:await this.capacitySnapshot(snapshotId),
  };
  const measured=(await this.db.pool.query('SELECT count(*) AS n FROM external_full_stage WHERE snapshot_id=$1 AND row_number<=10000',[snapshotId])).rows[0]!;
  const relations=(await this.db.pool.query(`SELECT c.relname AS relation,pg_total_relation_size(c.oid)::text AS total_bytes,pg_indexes_size(c.oid)::text AS index_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname LIKE 'external_%'`)).rows;
  const wal=(await this.db.pool.query('SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),$1::pg_lsn)::text AS bytes',[state.capacity_baseline?.walLsn??'0/0'])).rows[0]!.bytes;
  const details=sample.details;
  const processed=Number((await this.db.pool.query('SELECT count(*) AS n FROM external_full_members WHERE last_detail_at IS NOT NULL')).rows[0].n);
  let archiveBytes=0;for(const entry of await readdir(this.directory,{withFileTypes:true})){if(entry.isFile())archiveBytes+=(await stat(path.join(this.directory,entry.name))).size;}
  const rows=snapshot?capacityTarget(snapshot):0;
  // CSV staging already contains the full export, including its indexes/TOAST. It is not a detail sample.
  const sqlStagingBytes=relations.filter(r=>r.relation==='external_full_stage').reduce((n,r)=>n+Number(r.total_bytes),0);
  // Relation sizes include the archive heap, indexes and TOAST without reading archived payloads.
  const businessBytes=relations.filter(r=>r.relation!=='external_full_stage').reduce((n,r)=>n+Number(r.total_bytes),0);
  // The cohort stays fixed after first acceptance; later catalog growth must not be divided by just those 10000 members.
  const ready=completeCapacitySample(snapshot,sample);
  const prior=state.capacity_baseline?.detailSample;
  const validPrior=validMeasuredCohort(prior,sample),mean=businessBytes/Math.max(1,processed);
  const measureHistory=ready&&sample.withdrawn===0&&(!validPrior||prior.stateHash!==sample.state_hash||mean>prior.bytesPerDetail);
  const measuredSample:MeasuredCohort|null=measureHistory?{model:'measured-cohort-v2',cohortHash:sample.cohort_hash,stateHash:sample.state_hash,snapshotId,sampleRows:details,targetRows:rows,bytesPerDetail:Math.max(mean,validPrior?prior.bytesPerDetail:0),at:new Date().toISOString()}:validPrior?prior:null;
  const enoughSample=ready&&measuredSample!==null;
  const actualPerDetail=enoughSample?mean:null;
  const projectedBytesPerDetail=enoughSample?Math.max(mean,measuredSample!.bytesPerDetail):null;
  const fixedBytes=sqlStagingBytes+archiveBytes+Number(wal),binding=capacityBinding(snapshotId,rows,sample,measuredSample,state.capacity_baseline?.sampleLifecycleEpoch??null);
  const approved=Number(process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES??0);
  const admission=enoughSample?await readCapacityDecision(process.env.FULL_SYNC_CAPACITY_DECISION_FILE,binding,disk,approved):{allowed:false,code:'SYNC_CAPACITY_INSUFFICIENT_SAMPLE',decision:null};
  const allowed=admission.allowed&&state.enabled&&!state.paused;
  const code=!state.enabled||state.paused?'SYNC_HEAVY_PAUSED':admission.code;
  const estimate={...binding,sampleStageRows:Number(measured.n),distinctProcessed:processed,detailSampleRows:details,activeDetailSampleRows:sample.active_details,withdrawnSampleRows:sample.withdrawn,threeLocaleCompleted:sample.three_locales,reportCompleted:sample.reports,confirmedNoReport:sample.no_report,csvRows:Number(snapshot?.rows)||0,csvTarget:rows||null,estimatedRows:rows,sampleEvidenceSufficient:enoughSample,actualBytesPerDetail:actualPerDetail,projectedBytesPerDetail,historicalBytesPerDetail:measuredSample?.bytesPerDetail??null,businessBytes,sqlStagingBytes,fixedBytes,relations,walBytes:Number(wal),csvBytes:bytes,archiveDirectoryBytes:archiveBytes,
    estimatedBytes:admission.decision?.projectedPeakBytes??null,decision:admission.decision,approvedBudgetBytes:approved||null,allowed,reason:code,assumptions:['Only OPS hd-ext07-peak-v1 or hd-ext09-daily-two-v1 computes peak usage; BE emits measured components and validates the bound decision.','Business bytes include indexes and compressed raw storage, excluding complete SQL staging.','Archive files and WAL are fixed observations, not per-detail multipliers.','Historical costs require a fully measured fixed cohort; a new verified CSV snapshot always invalidates an old decision.','Withdrawn members are terminal, not checked or absent reports.'],at:new Date().toISOString()};
  await this.db.pool.query(`UPDATE external_full_sync SET capacity_estimate=$1,capacity_pending=NOT $2,
   capacity_baseline=CASE WHEN $3::jsonb IS NULL THEN capacity_baseline ELSE coalesce(capacity_baseline,'{}'::jsonb)||jsonb_build_object('detailSample',$3::jsonb) END WHERE id=1`,[JSON.stringify(estimate),allowed,measuredSample===null?null:JSON.stringify(measuredSample)]);
  if(!allowed)throw new FullSyncError(code!);
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
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const {reached:atLimit,expanded}=(await tx.query<{reached:boolean;expanded:boolean}>(`SELECT
    admitted_count >= admission_limit AS reached, admission_limit > $1 AS expanded
    FROM external_formal_admission_state WHERE id=1`,[DEFAULT_FORMAL_LISTING_LIMIT])).rows[0]!;
   // When full, jump over unadmitted rows but still refresh every admitted
   // member in the export, including those after the initial CSV rows.
   const eligible=atLimit?'AND EXISTS(SELECT 1 FROM external_formal_admissions a WHERE a.source=s.source AND a.external_id=s.external_id)':'';
   const rows=(await tx.query(`SELECT s.*,i.business_at AS withdrawn_at,m.business_at AS member_withdrawn_at FROM external_full_stage s
     LEFT JOIN external_ingestion_identity_state i ON i.provider='chinacarapi' AND i.source=s.source AND i.external_id=s.external_id AND i.withdrawn
     LEFT JOIN external_full_members m ON m.source=s.source AND m.external_id=s.external_id AND m.state='withdrawn'
     WHERE snapshot_id=$1 AND row_number>$2 ${eligible}
     ORDER BY row_number LIMIT 100`,[id,snap.apply_cursor])).rows;
   if(!atLimit&&rows.length)await permitFullSyncAdmission(tx);
   let last=snap.apply_cursor,processed=0,ceilingReached=atLimit;
   for(const entry of rows){
    const memberWithdrawn=entry.member_withdrawn_at&&new Date(snap.generated_at)<=new Date(entry.member_withdrawn_at);
    const withdrawn=memberWithdrawn||(entry.withdrawn_at&&new Date(snap.generated_at)<=new Date(entry.withdrawn_at));
    const admitted=!withdrawn&&await admitFormalListing(tx,entry.source,entry.external_id);
    if(!withdrawn&&!admitted&&!ceilingReached){
     ceilingReached=(await tx.query<{reached:boolean}>('SELECT admitted_count >= admission_limit AS reached FROM external_formal_admission_state WHERE id=1')).rows[0]!.reached;
     if(!ceilingReached)break; // Retry this row when the temporary capacity gate reopens.
    }
    last=entry.row_number;processed++;
    if(!admitted){
     if(memberWithdrawn)await tx.query(`UPDATE external_full_members SET last_snapshot=$3 WHERE source=$1 AND external_id=$2
       AND last_snapshot IS DISTINCT FROM $3::uuid AND EXISTS(SELECT 1 FROM external_formal_admissions
        WHERE source=$1 AND external_id=$2)`,[entry.source,entry.external_id,id]);
     continue;
    }
    let m=await ensureMember(tx,entry.source,entry.external_id);const row=entry.payload as CatalogCsvRow;
    if(m.state==='withdrawn'&&new Date(snap.generated_at)<=new Date(m.business_at)){
     await tx.query('UPDATE external_full_members SET last_snapshot=$3 WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id,id]);
     continue;
    }
    const alias=parseAlias(row.duplicate_of);
    if(alias){
     const stagedAlias=!expanded||(await tx.query(`SELECT 1 FROM external_full_stage
      WHERE snapshot_id=$1 AND source=$2 AND external_id=$3`,[id,alias.source,alias.id])).rowCount===1;
     await bindAlias(tx,entry.source,entry.external_id,alias,new Date(snap.generated_at).toISOString(),stagedAlias);
    }
    m=(await tx.query('SELECT * FROM external_full_members WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id])).rows[0]!;
    // Export image URLs are retained as evidence but detail photos are refreshed separately.
    const stableRow=Object.fromEntries(Object.entries(row).filter(([key])=>!['first_seen_at','last_seen_at','detail_fetched_at','export_price_usd','image'].includes(key)));const rowHash=jsonHash(stableRow);
    if(m.csv_hash===rowHash&&m.last_detail_at){await tx.query('UPDATE external_full_members SET last_snapshot=$3,verification_pending=false WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id,id]);continue;}
    if(new Date(snap.generated_at).getTime()>=new Date(m.business_at).getTime()){
     const docs:SourceDocument[]=[{identity:identity(entry.source,entry.external_id),kind:'csv',locale:'und',observedAt:new Date(snap.generated_at).toISOString(),sourceUpdatedAt:null,payload:row}];
     const recovering=m.state==='withdrawn'||entry.withdrawn_at!=null;
     const updated=(await tx.query(`UPDATE external_full_members SET desired_generation=desired_generation+1,last_snapshot=$3,verification_pending=false,has_report=$4,
      business_at=$5,csv_hash=$6,state='pending',locales='{}',report_state=CASE WHEN $7 THEN 'unknown' ELSE report_state END,
      report_checked_at=CASE WHEN $7 THEN NULL ELSE report_checked_at END WHERE source=$1 AND external_id=$2 RETURNING desired_generation`,
      [entry.source,entry.external_id,id,['true','1'].includes(row.has_report),snap.generated_at,rowHash,recovering])).rows[0]!;
     if(m.sampled&&recovering)await advanceCapacitySampleLifecycle(tx);
     if(entry.withdrawn_at)await clearFormalWithdrawal(tx,entry.source,entry.external_id,new Date(snap.generated_at));
     await supersedeTiming(tx,entry.source,entry.external_id,String(updated.desired_generation));
     const priorWork=(await tx.query("SELECT priority FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail'",[entry.source,entry.external_id])).rows[0];
     await queue(tx,entry.source,entry.external_id,'detail',updated.desired_generation,priorWork?.priority>=100?100:50);
     const refs=await archiveSourceDocuments(tx,docs,workRef(entry.source,entry.external_id,'detail'));
     await tx.query('UPDATE external_full_work SET document_refs=$3 WHERE source=$1 AND external_id=$2 AND kind=\'detail\'',[entry.source,entry.external_id,JSON.stringify(refs)]);
    }else await tx.query('UPDATE external_full_members SET last_snapshot=$3 WHERE source=$1 AND external_id=$2',[entry.source,entry.external_id,id]);
   }
   if(atLimit&&rows.length<100)last=snap.rows;
   const complete=BigInt(last)>=BigInt(snap.rows);
   await tx.query("UPDATE external_full_snapshots SET state=$2,apply_cursor=$3,completed_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$1",[id,complete?'complete':'applying',last,complete]);
   if(complete)await tx.query(`UPDATE external_full_sync SET next_snapshot_at=CASE WHEN mode='continuous' THEN
    greatest(date_bin(interval '24 hours',statement_timestamp(),$1::timestamptz)+interval '24 hours',
     statement_timestamp()+interval '5 minutes') ELSE now()+interval '1 day' END WHERE id=1`,[snap.created_at]);
   return processed;
  });
 }
 async details(sampleOnly=false){
  sampleOnly=sampleOnly||(await this.state()).capacity_pending;
  await this.heavy(sampleOnly);const remaining=await this.sampleRemaining(),restrictToSample=sampleOnly||remaining===0;
  // At the boundary only refresh existing sample members invalidated by newer events; never fetch a new identity.
  const turn=await this.transaction(async tx=>Number((await tx.query('UPDATE external_full_sync SET detail_turn=detail_turn+1 WHERE id=1 RETURNING detail_turn')).rows[0]!.detail_turn));
  const oldest=turn%4===0;
  const selected=(await this.db.pool.query(`SELECT w.source FROM external_full_work w JOIN external_full_members m USING(source,external_id)
   LEFT JOIN external_full_admission_replay_items item ON item.source=w.source AND item.external_id=w.external_id
     AND item.detail_generation=w.generation AND item.state='scheduled'
   WHERE w.kind='detail' AND w.attempts<5 AND w.due_at<=now() AND (m.state<>'withdrawn' OR item.replay_id IS NOT NULL)
     AND ($1=false OR m.sampled) ORDER BY CASE WHEN $2 THEN 0 ELSE w.priority END DESC,w.queued_at,w.due_at,w.source,w.external_id LIMIT 1`,[restrictToSample,oldest])).rows[0];
  if(!selected)return 0;const candidates=(await this.db.pool.query(`SELECT w.*,item.replay_id FROM external_full_work w JOIN external_full_members m USING(source,external_id)
   LEFT JOIN external_full_admission_replay_items item ON item.source=w.source AND item.external_id=w.external_id
     AND item.detail_generation=w.generation AND item.state='scheduled'
   WHERE w.kind='detail' AND w.source=$3 AND w.attempts<5 AND w.due_at<=now() AND (m.state<>'withdrawn' OR item.replay_id IS NOT NULL)
     AND ($2=false OR m.sampled) ORDER BY CASE WHEN $4 THEN 0 ELSE w.priority END DESC,w.queued_at,w.due_at,w.source,w.external_id LIMIT $1`,[restrictToSample?500:Math.min(500,remaining),restrictToSample,selected.source,oldest])).rows;
  const jobs=[];
  for(const job of candidates){
   if(!job.replay_id){jobs.push(job);continue;}
   const usable=await this.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    const item=await checkScheduledReplayDetail(tx,job.source,job.external_id,String(job.generation));
    if(item&&!item.stillCurrent)await retireReplayDetail(tx,item,job.source,job.external_id,String(job.generation));
    return item?.stillCurrent&&item.canApply;
   });
   if(usable)jobs.push(job);
  }
  if(!jobs.length)return 0;
  const stoppedReplay=new Set<string>();
  const replayKey=(job:{source:Source;external_id:string})=>`${job.source}:${job.external_id}`;
  for(const source of ['che168','dongchedi'] as const)for(const locale of ['zh','en','ru'] as const){
   const wanted=jobs.filter(j=>j.source===source&&!j.locales.includes(locale)&&!stoppedReplay.has(replayKey(j)));if(!wanted.length)continue;
   if(wanted.some(job=>job.replay_id))await this.heavy();
   try{for await(const response of this.client.bulk(source,wanted.map(j=>j.external_id),locale)){
    await this.heavy(sampleOnly);await this.applyEvents(true);await this.transaction(tx=>persistSourceResponse(tx,response.rawResponse));
    for(const payload of response.results){const job=wanted.find(j=>j.external_id===payload.id)!;
     await this.transaction(async tx=>{
      const current=(await tx.query("SELECT * FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail' FOR UPDATE",[source,payload.id])).rows[0];
      if(!current||String(current.generation)!==String(job.generation))return;
      const at=new Date().toISOString(),doc:SourceDocument={identity:identity(source,payload.id),kind:'detail',locale,observedAt:at,sourceUpdatedAt:typeof payload.updatedAt==='string'?payload.updatedAt:null,payload,rawResponse:{hash:response.rawResponse.hash}};
      const refs=await archiveSourceDocuments(tx,[doc],workRef(source,payload.id,'detail'));
      await tx.query(`UPDATE external_full_work SET document_refs=document_refs||$3::jsonb,locales=ARRAY(SELECT DISTINCT unnest(locales||$4::text[])) WHERE source=$1 AND external_id=$2 AND kind='detail'`,[source,payload.id,JSON.stringify(refs),[locale]]);
     });
    }
    for(const id of response.notFound){
     const job=wanted.find(entry=>entry.external_id===id);
     if(job&&await this.failDetail(job,'SYNC_DETAIL_NOT_FOUND'))stoppedReplay.add(replayKey(job));
    }
   }}catch(error){if(error instanceof FullSyncError&&(error.code.startsWith('SYNC_ACCOUNT_')||error.code==='SYNC_SOURCE_FORBIDDEN'))throw error;for(const job of wanted.filter(j=>!(error instanceof FullSyncError)||!error.affectedIds||error.affectedIds.includes(j.external_id)))await this.failDetail(job,errorCode(error));throw error;}
  }
  let applied=0,replayFlush=0;
  for(const job of jobs){
   if(stoppedReplay.has(replayKey(job)))continue;
   if(job.replay_id&&replayFlush++%ADMISSION_REPLAY_BATCH===0)await this.heavy();
   try{await this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const current=(await tx.query("SELECT * FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail' FOR UPDATE",[job.source,job.external_id])).rows[0];
   if(!current||String(current.generation)!==String(job.generation)||current.attempts>=5||current.locales.length!==3)return;
   const member=(await tx.query('SELECT * FROM external_full_members WHERE source=$1 AND external_id=$2 FOR UPDATE',[job.source,job.external_id])).rows[0]!;
   if(String(current.generation)!==String(member.desired_generation)||member.state==='withdrawn'&&!job.replay_id){
    await releaseSourceReferences(tx,'pending',workRef(job.source,job.external_id,'detail'));await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail'",[job.source,job.external_id]);return;}
   const replay=job.replay_id?await checkScheduledReplayDetail(tx,job.source,job.external_id,String(current.generation)):undefined;
   if(replay&&!replay.stillCurrent){
    await retireReplayDetail(tx,replay,job.source,job.external_id,String(current.generation));
    return;
   }
   if(job.replay_id&&(!replay?.canApply||!await physicalCleanupAllowed(tx)))return;
   const docs=await loadSourceDocumentRefs(tx,current.document_refs),detail=docs.find(d=>d.kind==='detail'&&d.locale==='en')?.payload as Record<string,unknown>|undefined;
   // Explicit active/removed evidence is different from HTTP notFound, which remains unresolved.
   const removed=(status:unknown)=>status==='removed'||status==='withdrawn';
   const replayDetails=replay?docs.filter(d=>d.kind==='detail'):[];
   const replayStatuses=replayDetails.map(d=>(d.payload as Record<string,unknown>)?.status);
   const withdrawn=replay?replayStatuses.every(removed):removed(detail?.status);
   if(replay){
    const sourceTimes=replayDetails.map(doc=>new Date(doc.sourceUpdatedAt??doc.observedAt));
    if(replayStatuses.length!==3||(!withdrawn&&replayStatuses.some(status=>status!=='active'))||
       sourceTimes.some((at,index)=>!(at>=replay.business_at&&at<=new Date(replayDetails[index]!.observedAt))))
     throw new FullSyncError('SYNC_REPLAY_STATUS_UNVERIFIED');
    if(withdrawn){
     const removedAt=new Date(Math.max(...sourceTimes.map(at=>at.getTime())));
     for(const doc of replayDetails)await persistSourceDocument(tx,doc);
     await rememberFormalWithdrawal(tx,job.source,job.external_id,replay.event_id,removedAt);
     await retireReplayDetail(tx,replay,job.source,job.external_id,String(current.generation),'verified_withdrawn');
     return;
    }
    await permitFullSyncAdmission(tx);
    await tx.query("SELECT set_config('hd.external_full_admission_replay',$1,true)",[replay.replay_id]);
    if(!await admitFormalListing(tx,job.source,job.external_id))return;
    if(replay.operation==='relist')await clearFormalWithdrawal(tx,job.source,job.external_id,replay.business_at,replay.event_id);
    await tx.query('UPDATE external_full_members SET event_order=$3,business_at=$4 WHERE source=$1 AND external_id=$2',
     [job.source,job.external_id,replay.event_id,replay.business_at]);
   }
   if(Array.isArray(detail?.alsoListedOn))for(const entry of detail.alsoListedOn){if(entry&&typeof entry==='object'&&'source' in entry&&'id' in entry&&['che168','dongchedi'].includes(String(entry.source))&&/^\d{1,100}$/.test(String(entry.id)))await bindAlias(tx,job.source,job.external_id,{source:entry.source as Source,id:String(entry.id)},new Date().toISOString(),!restrictToSample&&!replay);}
   const canonical=(await tx.query('SELECT canonical_id FROM external_full_members WHERE source=$1 AND external_id=$2',[job.source,job.external_id])).rows[0]!.canonical_id;
   const at=new Date().toISOString();
   const hasReport=detail?.hasInspectionReport===true||detail?.inspectionAvailable===true;
   const noReport=detail?.hasInspectionReport===false&&detail?.inspectionAvailable!==true;
   // Same-listing refresh keeps the last verified report observation while the recheck is queued.
   const retainsReport=!withdrawn&&hasReport&&member.has_report===true&&member.canonical_id===canonical&&member.report_checked_at!=null&&
    (member.report_state==='available'||member.report_state==='unavailable');
   const reportState=noReport?'no_report':retainsReport?member.report_state:'pending';
   await tx.query(`UPDATE external_full_members SET state=$3,locales=$4,applied_generation=desired_generation,last_detail_at=$5,verification_pending=false,
    sampled=sampled OR (SELECT last_capacity_sample=0 FROM external_full_sync WHERE id=1),has_report=$6,report_state=$7 WHERE source=$1 AND external_id=$2`,[job.source,job.external_id,withdrawn?'withdrawn':'active',current.locales,at,hasReport,reportState]);
   if(member.sampled&&withdrawn)await advanceCapacitySampleLifecycle(tx);
   await this.apply(tx,{source:job.source,externalId:job.external_id,canonicalId:canonical,operation:withdrawn?'withdraw':'upsert',documents:docs,at,batchId:member.last_snapshot??randomUUID()});
   if(replay){
    await tx.query("UPDATE external_full_admission_replay_items SET state='verified_active',processed_at=clock_timestamp() WHERE replay_id=$1 AND event_id=$2",
     [replay.replay_id,replay.event_id]);
    await finishReplayPlan(tx,replay.replay_id);
   }
   await recordDetailTiming(tx,job.source,job.external_id,String(member.desired_generation));
   await releaseSourceReferences(tx,'pending',workRef(job.source,job.external_id,'detail'));await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='detail'",[job.source,job.external_id]);
   await tx.query("UPDATE external_full_members SET photo_expires_at=(SELECT min(e.expires_at) FROM external_media e JOIN external_listings l ON l.id=e.listing_id WHERE l.provider='chinacarapi' AND l.platform_id=$1 AND l.external_id=$2 AND e.active) WHERE source=$1 AND external_id=$2",[job.source,job.external_id]);
   if(!withdrawn&&!noReport)await queue(tx,job.source,job.external_id,'report',member.desired_generation,10);
   applied++;
  });}catch(error){await this.failDetail(job,errorCode(error));}}return applied;
 }
 private async failDetail(job:{source:Source;external_id:string;generation:string;replay_id?:string|null},code:string){
  if(!job.replay_id){await this.failWork(job.source,job.external_id,'detail',code);return false;}
  return this.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   const replay=await checkScheduledReplayDetail(tx,job.source,job.external_id,String(job.generation));
   if(!replay)return true;
   if(!replay.stillCurrent){
    await retireReplayDetail(tx,replay,job.source,job.external_id,String(job.generation));
    return true;
   }
   const attempts=await this.failWork(job.source,job.external_id,'detail',code,{tx,generation:String(job.generation)});
   if(attempts!==undefined&&attempts>=5){
    const state=code==='SYNC_DETAIL_NOT_FOUND'?'unresolved_not_found':code==='SYNC_REPLAY_STATUS_UNVERIFIED'?'unresolved_unverified':'retry_limit';
    await retireReplayDetail(tx,replay,job.source,job.external_id,String(job.generation),state);
    return true;
   }
   return false;
  });
 }
 private async failWork(source:Source,id:string,kind:string,code:string,target?:{tx:PoolClient;generation:string}){
  return (await (target?.tx??this.db.pool).query<{attempts:number}>(`UPDATE external_full_work SET attempts=attempts+1,last_error_code=$4,due_at=now()+least(3600,power(2,attempts+1)*30)*interval '1 second'
   WHERE source=$1 AND external_id=$2 AND kind=$3 AND ($5::bigint IS NULL OR generation=$5) RETURNING attempts`,[source,id,kind,code,target?.generation??null])).rows[0]?.attempts;
 }
 async report(sampleOnly=false){
  sampleOnly=sampleOnly||(await this.state()).capacity_pending;
  await this.heavy(sampleOnly);const job=(await this.db.pool.query(`SELECT w.*,w.generation<>m.desired_generation OR m.state='withdrawn' AS stale
   FROM external_full_work w JOIN external_full_members m USING(source,external_id)
   WHERE w.kind='report' AND w.attempts<5 AND w.due_at<=now() AND ($1=false OR (m.sampled AND m.state<>'withdrawn')) ORDER BY w.priority DESC,w.queued_at,w.due_at,w.source,w.external_id LIMIT 1`,[sampleOnly])).rows[0];if(!job)return 0;
  let transportMissing=false;
  try{
   const response=job.stale?undefined:await this.client.report(job.source,job.external_id).catch((error:unknown)=>{
    if(!(error instanceof FullSyncError)||error.code!=='SYNC_HTTP_404')throw error;
    transportMissing=true;
    return undefined;
   });
   await this.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');const member=await ensureMember(tx,job.source,job.external_id);
    const stale=String(member.desired_generation)!==String(job.generation)||member.state==='withdrawn';
    if(job.stale&&!stale)return; // This observation was skipped, so keep the now-current job.
    const removed=(await tx.query("DELETE FROM external_full_work WHERE source=$1 AND external_id=$2 AND kind='report' AND generation=$3",[job.source,job.external_id,job.generation])).rowCount;
    if(!removed)return;
    if(stale){await releaseSourceReferences(tx,'pending',workRef(job.source,job.external_id,'report'));return;}
    const payload=response?response.payload:{source:job.source,id:job.external_id,available:false,observation:{httpStatus:404,kind:'transport_observation'}};
    if(response)await persistSourceResponse(tx,response.rawResponse);
    const data=payload&&typeof payload==='object'?payload as Record<string,unknown>:{};
    const state=data.available===false?'unavailable':data.hasReport===false?'no_report':
     ['summary','checks','defects','counts'].some(key=>Array.isArray(data[key]))?'available':'unavailable';
    const at=new Date().toISOString();
    await this.apply(tx,{source:job.source,externalId:job.external_id,canonicalId:member.canonical_id,operation:'upsert',at,batchId:member.last_snapshot??randomUUID(),documents:[{
     identity:identity(job.source,job.external_id),kind:'report',locale:'en',observedAt:at,sourceUpdatedAt:null,payload,
     ...(response?{rawResponse:{hash:response.rawResponse.hash}}:{})}]});
    await tx.query('UPDATE external_full_members SET report_checked_at=now(),report_state=$3 WHERE source=$1 AND external_id=$2',[job.source,job.external_id,state]);
   });
   return 1;
  }catch(error){
   const code=errorCode(error);
   if(code==='SYNC_LEASE_LOST')throw error;
   const reason=transportMissing&&code==='SYNC_OPERATION_FAILED'?'SYNC_REPORT_404_APPLY_FAILED':code;
   await this.transaction(tx=>this.failWork(job.source,job.external_id,'report',reason,{tx,generation:String(job.generation)}));
   return 0;
  }
 }
 async rotate(){
  if(await this.sampleSaturated())return 0;await this.heavy();return this.transaction(async tx=>{
   // Missing in one complete export is a high-priority verification, never a removal signal.
   const exports=(await tx.query<{completed:string|null;applying:string|null}>(`SELECT
    (SELECT id FROM external_full_snapshots WHERE state='complete' ORDER BY created_at DESC,id DESC LIMIT 1) AS completed,
    (SELECT id FROM external_full_snapshots WHERE state IN ('verified','applying') LIMIT 1) AS applying`)).rows[0]!;
   const rows=(await tx.query(`SELECT m.*,e.missing_from_export FROM external_full_members m
    CROSS JOIN LATERAL (SELECT $1::uuid IS NOT NULL AND m.last_snapshot IS DISTINCT FROM $1
     AND ($2::uuid IS NULL OR m.last_snapshot IS DISTINCT FROM $2) AS missing_from_export) e
    WHERE m.state<>'withdrawn' AND NOT EXISTS(SELECT 1 FROM external_full_work w WHERE w.source=m.source AND w.external_id=m.external_id AND kind='detail') AND
    NOT EXISTS(SELECT 1 FROM external_full_admission_replay_items item WHERE item.source=m.source AND item.external_id=m.external_id
      AND item.detail_generation=m.desired_generation AND item.state='scheduled') AND
    (last_detail_at IS NULL OR last_detail_at<now()-interval '7 days' OR last_accessed_at>last_detail_at OR photo_expires_at<now()+interval '1 day' OR (e.missing_from_export AND NOT verification_pending))
    ORDER BY (last_accessed_at>last_detail_at) DESC NULLS LAST,(photo_expires_at<now()+interval '1 day') DESC NULLS LAST,last_detail_at NULLS FIRST,source,external_id LIMIT 100`,[exports.completed,exports.applying])).rows;
   for(const m of rows){const next=(await tx.query(`UPDATE external_full_members SET desired_generation=desired_generation+1,verification_pending=verification_pending OR $3::boolean WHERE source=$1 AND external_id=$2 RETURNING desired_generation`,[m.source,m.external_id,m.missing_from_export])).rows[0]!;
    await queue(tx,m.source,m.external_id,'detail',next.desired_generation,m.last_accessed_at||m.photo_expires_at?30:0);}
   return rows.length;
  });
 }
 async daily(sampleRepair=false){
  await this.heavy(sampleRepair);for(const kind of ['account','dictionary'] as const){
   if(sampleRepair&&kind!=='account')continue;
   if((await this.db.pool.query("SELECT 1 FROM external_full_daily WHERE kind=$1 AND day=(now() AT TIME ZONE 'UTC')::date",[kind])).rowCount)continue;
   const result=await this.client.daily(kind);await this.transaction(async tx=>{await persistSourceResponse(tx,result.rawResponse);
    await protectSourceBlob(tx,result.rawResponse.hash,{kind:'pending',reference:`full-daily:${kind}:${new Date().toISOString().slice(0,10)}`});
    await tx.query("INSERT INTO external_full_daily VALUES($1,(now() AT TIME ZONE 'UTC')::date,$2) ON CONFLICT DO NOTHING",[kind,result.rawResponse.hash]);
    if(kind==='account'){const account=syncAccount(result.payload);
     await tx.query('UPDATE external_full_sync SET account=$1,account_checked_at=clock_timestamp(),account_reserved_ids=0 WHERE id=1',[JSON.stringify(account)]);
    }
   });
  }
  // Sample repair still needs a current account/quota snapshot; defer dictionary and ordinary maintenance.
  if(sampleRepair)return;
  await this.transaction(async tx=>{const old=(await tx.query("SELECT kind,to_char(day,'YYYY-MM-DD') AS day FROM external_full_daily d WHERE day<current_date-7 OR (SELECT count(*) FROM external_full_daily newer WHERE newer.kind=d.kind AND newer.day>d.day)>=2 LIMIT 100")).rows;for(const row of old){await releaseSourceReferences(tx,'pending',`full-daily:${row.kind}:${row.day}`);await tx.query('DELETE FROM external_full_daily WHERE kind=$1 AND day=$2',[row.kind,row.day]);}});
  await this.pruneStaging();
  await this.db.pool.query("UPDATE external_full_sync SET next_maintenance_at=(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' WHERE id=1");
 }
 async sampleRemaining(){
  const row=(await this.db.pool.query(`SELECT fs.last_capacity_sample,CASE WHEN fs.last_capacity_sample>0 THEN 0
   ELSE (SELECT count(*) FROM external_full_members WHERE sampled AND last_detail_at IS NOT NULL) END AS sampled,
   s.rows,s.target_rows,a.admitted_count,a.admission_limit FROM external_full_sync fs CROSS JOIN external_formal_admission_state a
   LEFT JOIN LATERAL (SELECT rows,target_rows FROM external_full_snapshots WHERE rows>0 ORDER BY created_at DESC LIMIT 1) s ON true
   WHERE fs.id=1 AND a.id=1`)).rows[0]!;
  if(Number(row.last_capacity_sample)>0)return 500;
  const target=row.rows===null?10000:capacitySampleTarget(row);
  return Math.max(0,target-Number(row.sampled));
 }
 async sampleSaturated(){return await this.sampleRemaining()===0;}
 async capacityGate(beforeRepair=false){
  const state=await this.state();
  if(!Number(state.last_capacity_sample)&&!await this.sampleSaturated())return false;
  const snapshot=await this.capacitySnapshot();if(!snapshot)return false;
  const sample=await capacitySample(this.db),ready=completeCapacitySample(snapshot,sample);
  // A complete cohort waiting for an OPS receipt does not need another refresh.
  // Only an actually incomplete cohort may use the restricted repair lane.
  if(beforeRepair&&!ready)return false;
  const disk=await this.space(),prior=state.capacity_baseline?.detailSample;
  const estimate=state.capacity_estimate,age=Date.now()-Date.parse(estimate?.at);
  if(ready&&validMeasuredCohort(prior,sample)&&(sample.withdrawn>0||prior.stateHash===sample.state_hash)
    &&estimate?.sampleEvidenceSufficient===true&&age>=0&&age<capacityMeasurementMaxAgeMs) {
   const binding=capacityBinding(snapshot.id,capacityTarget(snapshot),sample,prior,state.capacity_baseline?.sampleLifecycleEpoch??null);
   if(estimate.evidenceHash===binding.evidenceHash) {
    const approval=await readCapacityDecision(process.env.FULL_SYNC_CAPACITY_DECISION_FILE,binding,disk,Number(process.env.FULL_SYNC_CAPACITY_APPROVED_BYTES??0));
    const allowed=approval.allowed&&state.enabled&&!state.paused;
    const reason=!state.enabled||state.paused?'SYNC_HEAVY_PAUSED':approval.code;
    const estimatedBytes=approval.decision?.projectedPeakBytes??null;
    // Keep the physical observation timestamp. Rechecking a receipt is not a measurement.
    if(state.capacity_pending===allowed||estimate.allowed!==allowed||estimate.reason!==reason||estimate.estimatedBytes!==estimatedBytes||
      (allowed&&Number(state.last_capacity_sample)!==sample.details)) {
     await this.db.pool.query(`UPDATE external_full_sync SET capacity_estimate=capacity_estimate||$1::jsonb,capacity_pending=NOT $2,
      last_capacity_sample=CASE WHEN $2 THEN $3 ELSE last_capacity_sample END WHERE id=1`,
     [JSON.stringify({allowed,reason,decision:approval.decision,estimatedBytes}),allowed,sample.details]);
    }
    if(!allowed)throw new FullSyncError(reason!);
    return true;
   }
  }
  await this.estimateCapacity(snapshot.id,Number(snapshot.bytes),{state,disk,sample,snapshot});
  await this.db.pool.query('UPDATE external_full_sync SET last_capacity_sample=$1,capacity_pending=false WHERE id=1',[sample.details]);
  return true;
 }
 async pruneStaging(){
  await this.transaction(async tx=>{
   if(!await physicalCleanupAllowed(tx))return;
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
 private async scheduledDetails(sampleOnly=false){
  try{return await this.details(sampleOnly);}catch(error){
   if(!(error instanceof FullSyncError)||!['SYNC_TIMEOUT','SYNC_RESPONSE_INVALID','SYNC_TOO_LARGE','SYNC_HTTP_500','SYNC_HTTP_502','SYNC_HTTP_503','SYNC_HTTP_504'].includes(error.code))throw error;
   await this.db.pool.query('UPDATE external_full_sync SET last_error_code=$1,last_error_at=clock_timestamp() WHERE id=1',[error.code]);
   return 1; // A failed attempted batch still limits report quota; there is no immediate detail retry.
  }
 }
 async tick(){
  this.phase='startup';
  await this.alive();await mkdir(this.directory,{recursive:true,mode:0o700});const s=await this.state();if(!s.enabled)return;
  try{
   // Withdrawal application is first and remains available when heavy work is paused or disk usage is high.
   this.phase='withdrawals';
   await this.applyEvents(true);
   this.phase='delta_receive';
   if(s.since_at&&new Date(s.next_delta_at).getTime()<=Date.now())try{await this.receiveDelta();}catch(e){if(e instanceof FullSyncError&&e.code==='SYNC_CURSOR_EXPIRED')await this.recover();else throw e;}
   this.phase='delta_apply';await this.applyEvents();
   this.phase='space';const disk=await this.space(),current=await this.state();if(current.paused||disk.used>=.70)return;
   this.phase='source_maintenance';
   await runSourceMaintenance(this.db);
   if(current.capacity_pending){
    this.phase='capacity';if(await this.capacityGate(true))return;
    // New events may invalidate the sample after a failed estimate. Repair only that sample before rechecking.
    this.phase='daily';
    if(new Date(s.next_maintenance_at).getTime()<=Date.now())await this.daily(true);
    this.phase='details';const repaired=await this.scheduledDetails(true);
    this.phase='withdrawals';await this.applyEvents(true);
    this.phase='reports';for(let n=0;n<(repaired?1:20);n++){await this.applyEvents(true);if(!await this.report(true))break;}
    this.phase='capacity';await this.capacityGate();return; // New identities/snapshots resume on a later tick only after the gate passes.
   }
   this.phase='daily';
   if(new Date(s.next_maintenance_at).getTime()<=Date.now())await this.daily();
   // Complete a bounded current-detail batch before CSV admission work.
   this.phase='details';const refreshed=await this.scheduledDetails();
   this.phase='withdrawals';await this.applyEvents(true);
   this.phase='admission_replay';await this.replayAdmissions();
   this.phase='snapshot';
   const active=(await this.db.pool.query("SELECT id FROM external_full_snapshots WHERE state IN('downloading','staging','verified','applying') LIMIT 1")).rows[0];
   const snapshotDue=new Date(current.next_snapshot_at).getTime()<=Date.now();
   // Detail work can outlive a snapshot. A continuous export follows its own schedule after the prior snapshot completes.
   if(active||(snapshotDue&&current.mode==='continuous'))await this.snapshot();
   else if(snapshotDue&&!current.last_success_at){
    const bootstrapDetailPending=current.since_at&&(await this.db.pool.query("SELECT 1 FROM external_full_work WHERE kind='detail' LIMIT 1")).rowCount;
    if(!bootstrapDetailPending)await this.snapshot();
   }
   // Reserve one report per tick: progress survives a continuous stream of high-priority updates.
   this.phase='withdrawals';await this.applyEvents(true);
   this.phase='reports';for(let n=0;n<(refreshed?1:20);n++){await this.applyEvents(true);if(!await this.report())break;}
   this.phase='capacity';await this.capacityGate();
   this.phase='rotation';await this.rotate();
   this.phase='archive_cleanup';await this.pruneStaging();
   this.phase='finalize';
   const pending=(await this.db.pool.query("SELECT 1 FROM external_full_work UNION ALL SELECT 1 FROM external_full_events WHERE applied_at IS NULL UNION ALL SELECT 1 FROM external_full_members WHERE state<>'withdrawn' AND (applied_generation<desired_generation OR cardinality(locales)<3 OR verification_pending) LIMIT 1")).rowCount;
   const building=(await this.db.pool.query("SELECT 1 FROM external_full_snapshots WHERE state IN('downloading','staging','verified','applying') LIMIT 1")).rowCount;
   if(!pending&&!building)await this.db.pool.query('UPDATE external_full_sync SET last_success_at=now(),last_error_code=NULL,last_error_at=NULL WHERE id=1');
  }catch(error){const code=errorCode(error);if(code==='SYNC_CURSOR_EXPIRED')await this.recover();await this.db.pool.query('UPDATE external_full_sync SET last_error_code=$1,last_error_at=now() WHERE id=1',[code]);if(code!=='SYNC_HEAVY_PAUSED')throw error;}
 }
}

/** Public detail read hint. Throttled writes cannot turn each page request into a refresh job. */
export async function markFullSyncAccess(db: Database, listingId: string) {
  await db.pool.query(`UPDATE external_full_members m SET last_accessed_at=now()
    FROM external_listings l
    WHERE l.id=$1 AND l.provider='chinacarapi' AND m.source=l.platform_id AND m.external_id=l.external_id
      AND (m.last_accessed_at IS NULL OR m.last_accessed_at<now()-interval '1 hour')`, [listingId]);
}
export async function pinFullSyncArchive(db:Database,snapshotId:string,reference:string){
 await db.pool.query('INSERT INTO external_full_archive_pins VALUES($1,$2) ON CONFLICT DO NOTHING',[snapshotId,reference]);
}
export async function releaseFullSyncArchive(db:Database,reference:string){
 await db.pool.query('DELETE FROM external_full_archive_pins WHERE reference=$1',[reference]);
}
