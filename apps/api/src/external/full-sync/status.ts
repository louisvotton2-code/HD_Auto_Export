import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Database} from '../../db/index.js';
import {ApiError,conflict} from '../../errors.js';
import {recordAudit} from '../../activity/service.js';
import type {Actor} from './types.js';
const iso=(value:Date|string|null)=>value?new Date(value).toISOString():null;
async function statusInTransaction(tx:PoolClient){
  const state=(await tx.query('SELECT *,clock_timestamp() AS as_of FROM external_full_sync WHERE id=1')).rows[0]!;
  const snap=(await tx.query('SELECT * FROM external_full_snapshots ORDER BY created_at DESC LIMIT 1')).rows[0];
  const counts=(await tx.query(`SELECT count(*)::integer AS raw,count(DISTINCT canonical_id)::integer AS canonical,
   count(*) FILTER(WHERE state='withdrawn')::integer AS withdrawn,count(*) FILTER(WHERE state<>'withdrawn' AND applied_generation<desired_generation)::integer AS pending_details,
   coalesce(sum(CASE WHEN state<>'withdrawn' THEN 3-cardinality(locales) ELSE 0 END),0)::integer AS pending_locales FROM external_full_members`)).rows[0]!;
  const work=(await tx.query(`SELECT count(*) FILTER(WHERE attempts>=5)::integer AS failed,count(*) FILTER(WHERE kind='report')::integer AS reports FROM external_full_work`)).rows[0]!;
  const visible=(await tx.query(`SELECT count(DISTINCT c.listing_id)::integer AS n FROM external_catalog c JOIN external_catalog_filter f ON f.listing_id=c.listing_id JOIN external_listings l ON l.id=c.listing_id LEFT JOIN external_listing_overrides o ON o.listing_id=l.id WHERE l.upstream_state='active' AND l.formal_primary AND NOT coalesce((o.data->>'hidden')::boolean,false) AND f.active AND f.locale_mask>0`)).rows[0]!.n;
  const pending=counts.pending_details>0||counts.pending_locales>0||work.reports>0||work.failed>0||Number(state.received_events)!==Number(state.applied_events);
  return {version:state.version,mode:state.mode,state:!state.enabled?'disabled':state.paused||state.disk_paused||state.capacity_pending?'paused':state.last_error_code?'error':snap&&!['complete','failed'].includes(snap.state)?'snapshot':pending?'syncing':state.mode==='full'&&snap?.state==='complete'&&Number(state.received_events)===Number(state.applied_events)?'complete':'idle',
   asOf:iso(state.as_of)!,lastSuccessAt:iso(state.last_success_at),lastError:state.last_error_code?{code:state.last_error_code,message:'Synchronization requires attention.',at:iso(state.last_error_at)!}:null,
   counts:{raw:counts.raw,canonical:counts.canonical,public:visible,withdrawn:counts.withdrawn,failed:work.failed,pendingDetails:counts.pending_details,pendingLocales:counts.pending_locales,pendingReports:work.reports},
   snapshot:snap?{id:snap.id,generatedAt:iso(snap.generated_at),rows:Number(snap.rows),staged:Number(snap.staged),complete:snap.state==='complete'}:null,
   receivedEvents:Number(state.received_events),appliedEvents:Number(state.applied_events),nextRunAt:state.enabled?iso(state.next_delta_at):null,paused:state.paused||state.disk_paused||state.capacity_pending};
}
export async function fullSyncStatus(db:Database){return db.transaction(async tx=>{await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return statusInTransaction(tx);});}
export async function setFullSyncPaused(db:Database,input:{version:number;action:'pause'|'resume'},actor:Actor,key:string){
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(key)||!Number.isSafeInteger(input.version)||!['pause','resume'].includes(input.action))throw new ApiError(400,'INVALID_REQUEST','Invalid synchronization control.');
 const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 return db.transaction(async tx=>{
  const admin=await tx.query("SELECT id FROM staff WHERE id=$1 AND role='admin' AND NOT banned",[actor.id]);if(!admin.rowCount)throw new ApiError(403,'FORBIDDEN','Administrator access required.');
  const state=(await tx.query('SELECT * FROM external_full_sync WHERE id=1 FOR UPDATE')).rows[0]!;
  const previous=(await tx.query('SELECT * FROM external_full_controls WHERE actor_id=$1 AND key=$2',[actor.id,key])).rows[0];
  if(previous){if(previous.request_hash!==digest)throw conflict();return previous.response;}
  if(state.version!==input.version)throw conflict();
  if(!state.enabled)throw new ApiError(409,'SYNC_NOT_CONFIGURED','Configure the formal synchronization worker before resuming.');
  const paused=input.action==='pause',version=state.version+1;
  await tx.query('UPDATE external_full_sync SET paused=$1,version=$2,updated_at=clock_timestamp() WHERE id=1',[paused,version]);
  await recordAudit(tx,actor,`external.sync.${input.action}`,null,state.version,version,[{path:'sync.paused',before:state.paused,after:paused,beforePresent:true,afterPresent:true}]);
  const result=await statusInTransaction(tx);await tx.query('INSERT INTO external_full_controls VALUES($1,$2,$3,$4)',[actor.id,key,digest,JSON.stringify(result)]);return result;
 });
}
