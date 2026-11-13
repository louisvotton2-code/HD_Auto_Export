import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Database} from '../../db/index.js';
import {persistSourceResponse} from '../sources/index.js';
import {EventSchema,ManifestSchema,hash,identityKey,IngestionError,WORKER_LIMITS,type IngestionEvent,type Manifest,type Lane,type SourceApplier} from './types.js';
export const SERVICE_ACTOR='chinacarapi-ingestion-worker';
type Lease={jobId:string;owner:string;fence:string};
type Job={id:string;state:string;manifest:Manifest;triggered_by:string;received_seq:string;applied_seq:string;receive_cursors:Partial<Record<Lane,string|null>>;completed_lanes:Partial<Record<Lane,boolean>>};
function fail(code:string):never{throw new IngestionError(code);}
async function serviceActor(tx:PoolClient){
 await tx.query(`INSERT INTO staff(id,name,email,role,banned) VALUES($1,'ChinaCarAPI import service','chinacarapi-worker@example.invalid','editor',true) ON CONFLICT(id) DO NOTHING`,[SERVICE_ACTOR]);
 const valid=await tx.query(`SELECT 1 FROM staff s WHERE id=$1 AND banned AND email='chinacarapi-worker@example.invalid'
 AND NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE a.user_id=s.id) AND NOT EXISTS(SELECT 1 FROM staff_sessions t WHERE t.user_id=s.id)`,[SERVICE_ACTOR]);
 if(!valid.rowCount)fail('INGESTION_SERVICE_IDENTITY_INVALID');
}
export async function createImportJob(db:Database,key:string,manifestInput:unknown,triggeredBy:string){
 const manifest=ManifestSchema.parse(manifestInput);if(!/^[A-Za-z0-9._:-]{1,160}$/.test(key))fail('INGESTION_KEY_INVALID');
 const digest=hash(manifest);
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`ingestion-job:${key}`]);
  const actor=await tx.query(`SELECT 1 FROM staff WHERE id=$1 AND role='admin' AND NOT banned`,[triggeredBy]);
  if(!actor.rowCount)fail('INGESTION_TRIGGER_FORBIDDEN');
  const old=(await tx.query<{id:string;manifest_hash:string}>('SELECT id,manifest_hash FROM external_ingestion_jobs WHERE job_key=$1',[key])).rows[0];
  if(old){if(old.manifest_hash!==digest)fail('INGESTION_MANIFEST_CONFLICT');return old.id;}
  await serviceActor(tx);const id=randomUUID();
  await tx.query('INSERT INTO external_ingestion_jobs(id,job_key,manifest_hash,manifest,triggered_by,generated_at) VALUES($1,$2,$3,$4,$5,$6)',[id,key,digest,JSON.stringify(manifest),triggeredBy,manifest.generatedAt]);
  for(const member of manifest.identities)await tx.query('INSERT INTO external_ingestion_members(job_id,provider,source,external_id,canonical_id) VALUES($1,$2,$3,$4,$5)',[id,manifest.provider,member.source,member.externalId,member.canonicalId]);
  return id;
 });
}
export type ReceivedPage={lane:Lane;inputCursor:string|null;nextCursor:string|null;terminal:boolean;events:IngestionEvent[];rawResponse?:{hash:string;body:string}};
export async function receivePage(db:Database,jobId:string,page:ReceivedPage){
 if(!['snapshot','delta','detail'].includes(page.lane)||page.events.length>WORKER_LIMITS.batch||
  [page.inputCursor,page.nextCursor].some(x=>x!==null&&(typeof x!=='string'||x.length>2048))||
  (!page.terminal&&(!page.nextCursor||page.nextCursor===page.inputCursor)))fail('INGESTION_PAGE_INVALID');
 const events=page.events.map(x=>EventSchema.parse(x));const digest=hash(page);
 return db.transaction(async tx=>{
  const job=(await tx.query<Job>('SELECT * FROM external_ingestion_jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];if(!job)fail('INGESTION_NOT_FOUND');
  const prior=(await tx.query<{page_hash:string}>('SELECT page_hash FROM external_ingestion_pages WHERE job_id=$1 AND lane=$2 AND input_cursor=$3',[jobId,page.lane,page.inputCursor??''])).rows[0];
  if(prior){if(prior.page_hash!==digest)fail('INGESTION_PAGE_CONFLICT');return {inserted:0,replayed:true};}
  if(job.state==='complete'||job.state==='paused')fail('INGESTION_NOT_RECEIVING');
  if((job.receive_cursors[page.lane]??null)!==page.inputCursor||job.completed_lanes[page.lane])fail('INGESTION_CURSOR_CONFLICT');
  if(page.lane==='snapshot'&&events.some(e=>e.snapshotHash!==job.manifest.csv.sha256||e.observedAt!==job.manifest.generatedAt))fail('INGESTION_SNAPSHOT_BINDING');
  if(page.rawResponse)await persistSourceResponse(tx,page.rawResponse);
  const allowed=new Set(job.manifest.identities.map(m=>identityKey({...m,provider:job.manifest.provider})));
  let seq=BigInt(job.received_seq),inserted=0;
  for(const event of events){
   if(!allowed.has(identityKey(event.identity)))continue; // Receive cursor covers the whole feed; scope never grows.
   const evidence=Array.isArray(event.document)?event.document.filter(x=>x?.kind==='event').map(x=>x.payload):[];
   const payloadHash=evidence.length?hash({identity:event.identity,operation:event.operation,businessOrder:event.businessOrder,evidence}):hash(event);
   const old=(await tx.query<{payload_hash:string}>('SELECT payload_hash FROM external_ingestion_events WHERE job_id=$1 AND event_key=$2',[jobId,event.key])).rows[0];
   if(old){if(old.payload_hash!==payloadHash)fail('INGESTION_EVENT_CONFLICT');continue;}
   seq++;const {identity}=event;
   await tx.query(`INSERT INTO external_ingestion_events(job_id,seq,event_key,payload_hash,provider,source,external_id,operation,business_order,observed_at,document,lane,snapshot_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[jobId,seq.toString(),event.key,payloadHash,identity.provider,identity.source,identity.externalId,event.operation,event.businessOrder,event.observedAt,JSON.stringify(event.document),page.lane,event.snapshotHash??null]);inserted++;
  }
  await tx.query('INSERT INTO external_ingestion_pages(job_id,lane,input_cursor,page_hash,next_cursor,terminal) VALUES($1,$2,$3,$4,$5,$6)',[jobId,page.lane,page.inputCursor??'',digest,page.nextCursor,page.terminal]);
  await tx.query(`UPDATE external_ingestion_jobs SET received_seq=$2,receive_cursors=receive_cursors||$3::jsonb,completed_lanes=completed_lanes||$4::jsonb WHERE id=$1`,[jobId,seq.toString(),JSON.stringify({[page.lane]:page.nextCursor}),JSON.stringify({[page.lane]:page.terminal})]);
  return {inserted,replayed:false};
 });
}
export async function verifySnapshot(db:Database,jobId:string,proof:Manifest['csv']){
 const result=await db.pool.query(`UPDATE external_ingestion_jobs SET snapshot_verified_at=clock_timestamp(),state='ready'
 WHERE id=$1 AND state='awaiting_snapshot' AND manifest->'csv'=$2::jsonb RETURNING id`,[jobId,JSON.stringify(proof)]);
 if(!result.rowCount){const old=(await db.pool.query('SELECT snapshot_verified_at,manifest FROM external_ingestion_jobs WHERE id=$1',[jobId])).rows[0];
 if(!old?.snapshot_verified_at||hash(old.manifest.csv)!==hash(proof))fail('INGESTION_SNAPSHOT_PROOF_INVALID');}
}
/** A 410 does not delete cars. OPS must supply a newly verified snapshot and repeat the same fixed identities. */
export async function recoverExpiredCursor(db:Database,jobId:string,proof:Manifest['csv']){
 return db.transaction(async tx=>{
  const row=(await tx.query('SELECT *,lease_until>clock_timestamp() AS busy FROM external_ingestion_jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];if(!row)fail('INGESTION_NOT_FOUND');
  if(row.recovery_count>=WORKER_LIMITS.maxRecoveries)fail('INGESTION_RECOVERY_LIMIT');
  if(row.busy)fail('INGESTION_LEASE_BUSY');
  const manifest=ManifestSchema.parse({...row.manifest,generatedAt:proof.generatedAt,csv:proof});
  await tx.query(`UPDATE external_ingestion_jobs SET recovery_count=recovery_count+1,manifest=$2,manifest_hash=$3,generated_at=$4,
   state='awaiting_snapshot',snapshot_verified_at=NULL,receive_cursors='{}',completed_lanes='{}',retry_at='-infinity',lease_owner=NULL,lease_until=NULL,fence=fence+1 WHERE id=$1`,[jobId,JSON.stringify(manifest),hash(manifest),proof.generatedAt]);
  // Old events remain durable and must finish; receipt keys are scoped to one snapshot generation.
  await tx.query('DELETE FROM external_ingestion_pages WHERE job_id=$1',[jobId]);
 });
}
export function isObsolete(event:Pick<IngestionEvent,'operation'|'businessOrder'|'observedAt'>,prior:{businessOrder:string;withdrawn:boolean;observedAt:string}|null){
 if(!prior)return false;
 const order=BigInt(event.businessOrder),previous=BigInt(prior.businessOrder);
 if(order<previous)return true;
 if(prior.withdrawn&&event.operation!=='withdraw'&&!(event.operation==='relist'&&order>previous))return true;
 return order===previous&&new Date(event.observedAt).getTime()<new Date(prior.observedAt).getTime();
}
export class FixedScopeWorker{
 readonly owner=randomUUID();
 constructor(private readonly db:Database,private readonly apply:SourceApplier){}
 async claim(jobId:string):Promise<Lease|null>{
  const row=(await this.db.pool.query<{fence:string}>(`UPDATE external_ingestion_jobs SET lease_owner=$2,fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds'
   WHERE id=$1 AND state IN ('awaiting_snapshot','ready') AND retry_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING fence`,[jobId,this.owner])).rows[0];
  return row?{jobId,owner:this.owner,fence:row.fence}:null;
 }
 async run(lease:Lease){
  if(lease.owner!==this.owner)fail('INGESTION_LEASE_LOST');
  return this.db.transaction(async tx=>{
   const job=(await tx.query<Job>(`SELECT * FROM external_ingestion_jobs WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND lease_until>clock_timestamp() FOR UPDATE`,[lease.jobId,lease.owner,lease.fence])).rows[0];
   if(!job)fail('INGESTION_LEASE_LOST');await serviceActor(tx);
   // Unhydrated deltas may pass only when obsolete under the same source-time/order rules below.
   // Use the first event document (null falls back to observed_at), with JavaScript millisecond precision.
   const rows=(await tx.query<{seq:string;event_key:string;provider:'chinacarapi';source:'che168'|'dongchedi';external_id:string;operation:IngestionEvent['operation'];business_order:string;observed_at:Date;document:IngestionEvent['document'];canonical_id:string;lane:Lane;snapshot_hash:string|null}>(`SELECT e.*,coalesce(e.hydrated_document,e.document) AS document,m.canonical_id FROM external_ingestion_events e JOIN external_ingestion_members m USING(job_id,provider,source,external_id)
    WHERE e.job_id=$1 AND completed_at IS NULL AND ($2 OR (operation='withdraw' AND lane='delta'))
    AND (operation='withdraw' OR lane<>'delta' OR hydrated_document IS NOT NULL OR EXISTS(
     SELECT 1 FROM external_ingestion_identity_state i WHERE i.provider=e.provider AND i.source=e.source AND i.external_id=e.external_id AND (
      i.business_order>e.business_order OR (i.withdrawn AND (e.operation<>'relist' OR i.business_order>=e.business_order))
      OR (i.business_order=e.business_order AND e.observed_at<i.observed_at)
      OR date_trunc('milliseconds',i.business_at)>date_trunc('milliseconds',coalesce((
       SELECT doc->>'sourceUpdatedAt' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.document)='array' THEN e.document ELSE '[]'::jsonb END) WITH ORDINALITY AS entries(doc,position)
       WHERE doc->>'kind'='event' ORDER BY position LIMIT 1)::timestamptz,e.observed_at)))))
    ORDER BY (operation='withdraw') DESC,seq LIMIT $3`,[lease.jobId,job.state==='ready',WORKER_LIMITS.batch])).rows;
   if(rows.length)await tx.query('SELECT pg_advisory_xact_lock(78291332)');
   for(const row of rows){
    const event:IngestionEvent={key:row.event_key,identity:{provider:row.provider,source:row.source,externalId:row.external_id},operation:row.operation,businessOrder:row.business_order,observedAt:row.observed_at.toISOString(),document:row.document,...(row.snapshot_hash?{snapshotHash:row.snapshot_hash}:{})};
    const params=[row.provider,row.source,row.external_id];
    const previous=(await tx.query<{business_order:string;withdrawn:boolean;observed_at:Date;business_at:Date}>('SELECT * FROM external_ingestion_identity_state WHERE provider=$1 AND source=$2 AND external_id=$3 FOR UPDATE',params)).rows[0];
    const sourceEvent=Array.isArray(event.document)?event.document.find(d=>d?.kind==='event'):undefined;
    const businessAt=row.lane==='snapshot'?event.observedAt:sourceEvent?.sourceUpdatedAt??event.observedAt;
    if(typeof businessAt!=='string'||!Number.isFinite(Date.parse(businessAt)))fail('INGESTION_EVENT_TIME_INVALID');
    const invalidSnapshot=row.lane==='snapshot'&&(event.snapshotHash!==job.manifest.csv.sha256||event.observedAt!==job.manifest.generatedAt);
    const newerSnapshot=!invalidSnapshot&&row.lane==='snapshot'&&previous&&Date.parse(event.observedAt)>previous.business_at.getTime();
    const obsolete=invalidSnapshot?true:previous&&Date.parse(businessAt)<previous.business_at.getTime()?true:newerSnapshot?false:
     isObsolete(event,previous?{businessOrder:previous.business_order,withdrawn:previous.withdrawn,observedAt:previous.observed_at.toISOString()}:null);
    await this.apply(tx,event,{obsolete,jobId:job.id,canonicalId:row.canonical_id,triggeredBy:job.triggered_by,actor:{id:SERVICE_ACTOR,requestId:`ingest:${job.id}:${row.seq}`}});
    if(!obsolete){
     if(row.lane==='delta')await tx.query('UPDATE external_ingestion_members SET verification_pending=false WHERE job_id=$1 AND provider=$2 AND source=$3 AND external_id=$4',[job.id,...params]);
     await tx.query(`INSERT INTO external_ingestion_identity_state(provider,source,external_id,business_order,withdrawn,observed_at,business_at) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(provider,source,external_id) DO UPDATE SET business_order=greatest(external_ingestion_identity_state.business_order,excluded.business_order),withdrawn=excluded.withdrawn,observed_at=excluded.observed_at,business_at=excluded.business_at`,[...params,row.business_order,row.operation==='withdraw',row.observed_at,businessAt]);
    }
    await tx.query('UPDATE external_ingestion_events SET completed_at=clock_timestamp(),outcome=$3 WHERE job_id=$1 AND seq=$2',[job.id,row.seq,obsolete?'obsolete':'applied']);
   }
   const result=(await tx.query<{applied_seq:string;state:string}>(`UPDATE external_ingestion_jobs SET applied_seq=coalesce((SELECT min(seq)-1 FROM external_ingestion_events WHERE job_id=$1 AND completed_at IS NULL),received_seq),
    state=CASE WHEN state='ready' AND completed_lanes->>'snapshot'='true' AND completed_lanes->>'delta'='true' AND NOT EXISTS(SELECT 1 FROM external_ingestion_events WHERE job_id=$1 AND completed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM external_ingestion_members WHERE job_id=$1 AND verification_pending) THEN 'complete' ELSE state END,
    failures=0,retry_at='-infinity',lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND lease_until>clock_timestamp() RETURNING applied_seq,state`,[job.id,lease.owner,lease.fence])).rows[0];
   if(!result)fail('INGESTION_LEASE_LOST');
   if(result.state==='complete')await tx.query('UPDATE external_ingestion_jobs SET completed_at=clock_timestamp() WHERE id=$1',[job.id]);
   return {processed:rows.length,checkpoint:result.applied_seq,state:result.state};
  });
 }
 async tick(jobId:string){
  const lease=await this.claim(jobId);if(!lease)return {processed:0,checkpoint:null,state:'unavailable'};
  try{return await this.run(lease);}catch(error){
   await this.db.pool.query(`UPDATE external_ingestion_jobs SET lease_owner=NULL,lease_until=NULL,failures=failures+1,
    state=CASE WHEN failures>=4 THEN 'paused' ELSE state END,retry_at=clock_timestamp()+least(60,power(2,least(failures,6))) * interval '1 second'
    WHERE id=$1 AND lease_owner=$2 AND fence=$3`,[jobId,lease.owner,lease.fence]);throw error;
  }
 }
}

/** Explicit one-shot catch-up only. Reopen the empty terminal page, never erase queued work or expand members. */
export async function beginCatchUp(db:Database,jobId:string){
 return db.transaction(async tx=>{
  const job=(await tx.query(`SELECT *,lease_until>clock_timestamp() AS busy FROM external_ingestion_jobs WHERE id=$1 FOR UPDATE`,[jobId])).rows[0];
  if(!job)fail('INGESTION_NOT_FOUND');if(job.busy)fail('INGESTION_LEASE_BUSY');if(job.state==='paused')fail('INGESTION_PAUSED');
  await tx.query(`DELETE FROM external_ingestion_pages WHERE job_id=$1 AND lane='delta' AND terminal AND input_cursor=coalesce($2,'')`,[jobId,job.receive_cursors.delta??null]);
  await tx.query(`UPDATE external_ingestion_jobs SET completed_lanes=completed_lanes||'{"delta":false}'::jsonb,
   state=CASE WHEN snapshot_verified_at IS NULL THEN 'awaiting_snapshot' ELSE 'ready' END,completed_at=NULL WHERE id=$1`,[jobId]);
 });
}
