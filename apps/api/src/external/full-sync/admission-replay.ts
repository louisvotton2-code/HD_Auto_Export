import type {PoolClient} from 'pg';
import {z} from 'zod';
import {physicalCleanupAllowed} from '../../backup-lease.js';
import type {Database} from '../../db/index.js';
import {FORMAL_LISTING_LIMIT_CODE, DEFAULT_FORMAL_LISTING_LIMIT} from '../formal-admission.js';
import {jsonHash} from '../normalize.js';
import type {ReplayOperatorApproval} from './replay-approval.js';
import {defaultHeavyWorkPausePercent} from './disk-policy.js';
import {FullSyncError, type Actor, type Source} from './types.js';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const eventId=z.string().regex(/^[1-9][0-9]{0,29}$/);
const capacityRows=z.number().int().min(DEFAULT_FORMAL_LISTING_LIMIT).max(1_000_000);
export const AdmissionReplayRequest=z.strictObject({
  id:z.uuid(),snapshotId:z.uuid(),csvSha256:digest,capacityReceipt:digest,
  expectedAdmitted:z.number().int().nonnegative().max(1_000_000),expectedLimit:capacityRows,targetRows:capacityRows,
  eventIds:z.array(eventId).min(1).max(500).refine(ids=>new Set(ids).size===ids.length),
});
export type AdmissionReplayRequest=z.infer<typeof AdmissionReplayRequest>;
type Snapshot={id:string;sha256:string;rows:number;active:boolean;target:number};
export type ReplayEvent={event_id:string;source:Source;external_id:string;business_at:Date;operation:'upsert'|'relist'};
export const ADMISSION_REPLAY_BATCH=25;
const operatorQueryLimits="SET LOCAL lock_timeout='200ms'; SET LOCAL statement_timeout='2s'; SET LOCAL max_parallel_workers_per_gather=0; SET LOCAL jit=off";

export async function requireAdmissionReplayMigration(db:Database) {
  const result=await db.pool.query(`SELECT to_regclass('public.external_full_admission_replays') IS NOT NULL
   AND to_regclass('public.external_full_admission_replay_items') IS NOT NULL
   AND EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid=to_regclass('public.external_full_event_identity_latest') AND indisvalid AND indisready AND indislive)
   AS installed`);
  if(!result.rows[0]?.installed)throw new FullSyncError('SYNC_REPLAY_MIGRATION_REQUIRED');
}

// All newer received events, including unapplied ones, participate in supersession.
// A relist must independently outrank each recorded withdrawal.
export async function eligibleReplayEvents(tx:PoolClient,snapshotId:string,eventIds:string[]) {
  return (await tx.query<ReplayEvent>(`SELECT e.event_id::text,e.source,e.external_id,e.business_at,e.operation
    FROM external_full_events e JOIN external_full_snapshots s ON s.id=$1
    WHERE e.event_id=ANY($2::numeric[]) AND e.source IN ('che168','dongchedi')
      AND e.external_id ~ '^[0-9]{1,100}$' AND e.applied_at IS NOT NULL AND e.error_code=$3
      AND e.operation IN ('upsert','relist') AND e.business_at>=s.generated_at
      AND NOT EXISTS (SELECT 1 FROM external_full_stage csv WHERE csv.snapshot_id=s.id
        AND csv.source=e.source AND csv.external_id=e.external_id)
      AND NOT EXISTS (SELECT 1 FROM external_formal_admissions a
        WHERE a.source=e.source AND a.external_id=e.external_id)
      AND NOT EXISTS (SELECT 1 FROM external_full_events newer
        WHERE newer.source=e.source AND newer.external_id=e.external_id AND newer.event_id>e.event_id)
      AND NOT EXISTS (SELECT 1 FROM external_ingestion_identity_state w
        WHERE w.provider='chinacarapi' AND w.source=e.source AND w.external_id=e.external_id AND w.withdrawn
          AND NOT (e.operation='relist' AND e.event_id>w.business_order AND e.business_at>=w.business_at))
      AND NOT EXISTS (SELECT 1 FROM external_full_members m WHERE m.source=e.source AND m.external_id=e.external_id
        AND (m.event_order>=e.event_id OR m.business_at>e.business_at OR
          (m.state='withdrawn' AND e.operation<>'relist')))
    ORDER BY e.event_id`,[snapshotId,eventIds,FORMAL_LISTING_LIMIT_CODE])).rows;
}

export async function currentReplaySnapshot(tx:PoolClient) {
  return (await tx.query<Snapshot>(`SELECT id,sha256,rows::int,coalesce(target_rows,0)::int AS target,
      state='complete' AND apply_cursor=rows AND staged=rows AND rows>0 AND bytes>0
      AND archive_pruned_at IS NULL AND sha256 ~ '^[a-f0-9]{64}$' AS active
    FROM external_full_snapshots WHERE state<>'failed' ORDER BY created_at DESC,id DESC LIMIT 1`)).rows[0];
}

export async function exactReplayCsvCoverage(tx:PoolClient,snapshot:Snapshot) {
  const result=await tx.query<{rows:number;first:number|null;last:number|null;admitted:number;withdrawn:number;missing:number}>(`
    WITH coverage AS (
      SELECT c.row_number,a.source IS NOT NULL AS admitted,
        (i.source IS NOT NULL OR m.source IS NOT NULL) AS withdrawn
      FROM external_full_stage c JOIN external_full_snapshots s ON s.id=c.snapshot_id
      LEFT JOIN external_formal_admissions a ON a.source=c.source AND a.external_id=c.external_id
      LEFT JOIN external_ingestion_identity_state i ON i.provider='chinacarapi' AND i.source=c.source
        AND i.external_id=c.external_id AND i.withdrawn AND i.business_at>=s.generated_at
      LEFT JOIN external_full_members m ON m.source=c.source AND m.external_id=c.external_id
        AND m.state='withdrawn' AND m.business_at>=s.generated_at WHERE c.snapshot_id=$1
    ) SELECT count(*)::int AS rows,min(row_number)::int AS first,max(row_number)::int AS last,
      count(*) FILTER(WHERE admitted)::int AS admitted,
      count(*) FILTER(WHERE NOT admitted AND withdrawn)::int AS withdrawn,
      count(*) FILTER(WHERE NOT admitted AND NOT withdrawn)::int AS missing FROM coverage`,[snapshot.id]);
  const rows=result.rows[0]!;
  if(rows.rows!==snapshot.rows||rows.first!==1||rows.last!==snapshot.rows)
    throw new FullSyncError('SYNC_REPLAY_INCOMPLETE_CSV');
  return {rows:rows.rows,admitted:rows.admitted,withdrawn:rows.withdrawn,eligibleMissing:rows.missing};
}

async function replayStatusInTransaction(tx:PoolClient,id:string) {
  const result=await tx.query(`WITH current AS MATERIALIZED (
    SELECT id FROM external_full_snapshots WHERE state<>'failed' ORDER BY created_at DESC,id DESC LIMIT 1
  ), item_status AS (
    SELECT i.replay_id,CASE
      WHEN i.state<>'scheduled' THEN i.state
      WHEN current.id IS DISTINCT FROM r.snapshot_id
        OR (m.state='withdrawn' AND NOT (denial.operation='relist'
          AND denial.event_id>m.event_order AND denial.business_at>=m.business_at))
        OR m.desired_generation IS DISTINCT FROM i.detail_generation OR EXISTS (
          SELECT 1 FROM external_full_events newer WHERE newer.source=i.source AND newer.external_id=i.external_id
           AND newer.event_id>i.event_id)
        THEN 'superseded'
      WHEN w.attempts>=5 AND w.last_error_code='SYNC_DETAIL_NOT_FOUND' THEN 'unresolved_not_found'
      WHEN w.attempts>=5 AND w.last_error_code='SYNC_REPLAY_STATUS_UNVERIFIED' THEN 'unresolved_unverified'
      WHEN w.attempts>=5 THEN 'retry_limit'
      WHEN w.source IS NULL THEN 'unresolved_no_work'
      ELSE i.state
    END AS state
    FROM external_full_admission_replay_items i JOIN external_full_admission_replays r ON r.id=i.replay_id
    JOIN external_full_events denial ON denial.event_id=i.event_id
    LEFT JOIN current ON true
    LEFT JOIN external_full_members m ON m.source=i.source AND m.external_id=i.external_id
    LEFT JOIN external_full_work w ON w.source=i.source AND w.external_id=i.external_id
      AND w.generation=i.detail_generation AND w.kind='detail'
    WHERE i.replay_id=$1
  ) SELECT r.id,r.snapshot_id AS "snapshotId",r.target_rows::int AS "targetRows",
    r.state,r.coverage,coalesce((SELECT jsonb_object_agg(item.state,item.count) FROM (
      SELECT state,count(*)::int FROM item_status GROUP BY state
    ) item),'{}') AS items
    FROM external_full_admission_replays r WHERE r.id=$1`,[id]);
  if(!result.rows[0])throw new FullSyncError('SYNC_REPLAY_NOT_FOUND');
  return result.rows[0];
}

export async function admissionReplayStatus(db:Database,id:string) {
  return db.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await tx.query(operatorQueryLimits);
    return replayStatusInTransaction(tx,z.uuid().parse(id));
  });
}

type AdmissionState={admitted:number;ceiling:number};
const admissionStateSql=`SELECT admitted_count::int AS admitted,admission_limit::int AS ceiling
  FROM external_formal_admission_state WHERE id=1`;
async function replayBasis(tx:PoolClient,input:AdmissionReplayRequest,admission:AdmissionState) {
  if(admission.admitted!==input.expectedAdmitted||admission.ceiling!==input.expectedLimit)
    throw new FullSyncError('SYNC_REPLAY_ADMISSION_CHANGED');
  const snapshot=await currentReplaySnapshot(tx);
  if(!snapshot?.active||snapshot.id!==input.snapshotId||snapshot.sha256!==input.csvSha256||snapshot.target!==admission.ceiling)
    throw new FullSyncError('SYNC_REPLAY_SNAPSHOT_CHANGED');
  const csv=await exactReplayCsvCoverage(tx,snapshot);
  const events=await eligibleReplayEvents(tx,snapshot.id,input.eventIds);
  if(events.length!==input.eventIds.length)throw new FullSyncError('SYNC_REPLAY_INELIGIBLE');
  const targetRows=Math.max(admission.ceiling,admission.admitted+events.length);
  if(targetRows!==input.targetRows)throw new FullSyncError('SYNC_REPLAY_TARGET_MISMATCH');
  return {snapshotId:snapshot.id,csvSha256:snapshot.sha256,csv,admitted:admission.admitted,
    priorLimit:admission.ceiling,deltaOnly:events.length,targetRows};
}

/** Compare the same denominator and target without planning work or changing a ceiling. */
export async function inspectAdmissionReplay(db:Database,request:AdmissionReplayRequest) {
  const input=AdmissionReplayRequest.parse(request);
  return db.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await tx.query(operatorQueryLimits);
    return replayBasis(tx,input,(await tx.query<AdmissionState>(admissionStateSql)).rows[0]!);
  });
}

/** The operator binds capacity evidence before staging; the running worker still requires its native live allow. */
export async function prepareAdmissionReplay(db:Database,actor:Actor,request:AdmissionReplayRequest,approval?:ReplayOperatorApproval) {
  const input=AdmissionReplayRequest.parse(request);
  const requestHash=jsonHash({...input,eventIds:[...input.eventIds].sort()});
  return db.transaction(async tx=>{
    await tx.query(operatorQueryLimits);
    if(!(await tx.query("SELECT id FROM staff WHERE id=$1 AND role='admin' AND NOT banned FOR SHARE",[actor.id])).rowCount)
      throw new FullSyncError('SYNC_ADMIN_REQUIRED');
    const existing=(await tx.query<{request_hash:string;requested_by:string}>(
      'SELECT request_hash,requested_by FROM external_full_admission_replays WHERE id=$1',[input.id])).rows[0];
    if(existing){
      if(existing.request_hash!==requestHash||existing.requested_by!==actor.id)throw new FullSyncError('SYNC_REPLAY_CONFLICT');
      return replayStatusInTransaction(tx,input.id);
    }
    if(!(await tx.query('SELECT pg_try_advisory_xact_lock(78291333) AS locked')).rows[0]?.locked)
      throw new FullSyncError('SYNC_REPLAY_WORKER_RUNNING');
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    if(!await physicalCleanupAllowed(tx))throw new FullSyncError('SYNC_REPLAY_BACKUP_ACTIVE');
    const state=(await tx.query(`SELECT enabled,paused,disk_paused,capacity_pending,last_capacity_sample,worker_fence::text,
      capacity_estimate->'heavyWorkPausePercent' AS heavy_work_pause_percent,
      capacity_estimate->'projectedPeakPausePercent' AS projected_peak_pause_percent
      FROM external_full_sync WHERE id=1 FOR UPDATE`)).rows[0]!;
    if(!state.enabled||state.paused||state.disk_paused||state.capacity_pending||Number(state.last_capacity_sample)<=0)
      throw new FullSyncError('SYNC_REPLAY_CAPACITY_NOT_READY');
    if(approval&&state.worker_fence!==approval.workerFence)throw new FullSyncError('SYNC_REPLAY_WORKER_CHANGED');
    const actualPercent=state.heavy_work_pause_percent??defaultHeavyWorkPausePercent;
    const projectedPercent=state.projected_peak_pause_percent??actualPercent;
    if(approval&&(actualPercent!==approval.heavyWorkPausePercent||
      projectedPercent!==(approval.projectedPeakPausePercent??approval.heavyWorkPausePercent)))
      throw new FullSyncError('SYNC_REPLAY_CAPACITY_NOT_READY');
    const admission=(await tx.query<AdmissionState>(`${admissionStateSql} FOR UPDATE`)).rows[0]!;
    if((await tx.query("SELECT 1 FROM external_full_admission_replays WHERE state IN ('pending','scheduled')")).rowCount)
      throw new FullSyncError('SYNC_REPLAY_PLAN_PENDING');
    const basis=await replayBasis(tx,input,admission);
    if(approval&&Date.now()>=approval.expiresAt)throw new FullSyncError('SYNC_REPLAY_APPROVAL_INVALID');
    const {targetRows:target,snapshotId,csvSha256}=basis;
    await tx.query(`INSERT INTO external_full_admission_replays
      (id,snapshot_id,csv_sha256,capacity_receipt,requested_by,target_rows,request_hash,coverage)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.id,snapshotId,csvSha256,input.capacityReceipt,actor.id,target,requestHash,JSON.stringify(basis)]);
    await tx.query(`INSERT INTO external_full_admission_replay_items(replay_id,event_id,source,external_id)
      SELECT $1,e.event_id,e.source,e.external_id FROM external_full_events e WHERE e.event_id=ANY($2::numeric[])`,
    [input.id,input.eventIds]);
    if(target>admission.ceiling){
      await tx.query('UPDATE external_formal_admission_state SET admission_limit=$1 WHERE id=1',[target]);
      await tx.query('UPDATE external_full_snapshots SET target_rows=$2 WHERE id=$1',[snapshotId,target]);
      await tx.query('UPDATE external_full_sync SET capacity_pending=true WHERE id=1');
    }
    return replayStatusInTransaction(tx,input.id);
  });
}

export async function checkScheduledReplayDetail(tx:PoolClient,source:Source,id:string,generation:string) {
  const item=(await tx.query<{replay_id:string;event_id:string;business_at:Date;operation:'upsert'|'relist';placeholder_created:boolean;stillCurrent:boolean;canApply:boolean}>(`
    SELECT item.replay_id,item.event_id::text,denial.business_at,denial.operation,item.placeholder_created,
      (SELECT s.id=plan.snapshot_id AND s.sha256=plan.csv_sha256 AND s.state='complete' AND s.target_rows=plan.target_rows
        AND s.archive_pruned_at IS NULL FROM external_full_snapshots s WHERE s.state<>'failed'
        ORDER BY s.created_at DESC,s.id DESC LIMIT 1) IS TRUE
      AND EXISTS (SELECT 1 FROM external_formal_admission_state a WHERE a.id=1 AND a.admission_limit=plan.target_rows)
      AND NOT EXISTS (SELECT 1 FROM external_full_events newer WHERE newer.source=item.source AND newer.external_id=item.external_id
        AND newer.event_id>item.event_id) AND NOT EXISTS (SELECT 1 FROM external_ingestion_identity_state w
        WHERE w.provider='chinacarapi' AND w.source=item.source AND w.external_id=item.external_id AND w.withdrawn
          AND NOT (denial.operation='relist' AND denial.event_id>w.business_order AND denial.business_at>=w.business_at)
        ) AND NOT EXISTS (SELECT 1 FROM external_formal_admissions a WHERE a.source=item.source AND a.external_id=item.external_id)
        AND EXISTS (SELECT 1 FROM external_full_members m WHERE m.source=item.source AND m.external_id=item.external_id
          AND m.desired_generation=item.detail_generation AND (m.state<>'withdrawn'
            OR (denial.operation='relist' AND denial.event_id>m.event_order AND denial.business_at>=m.business_at)))
        AS "stillCurrent",
      EXISTS (SELECT 1 FROM external_full_sync sync WHERE sync.id=1 AND sync.enabled AND NOT sync.paused
        AND NOT sync.disk_paused AND NOT sync.capacity_pending AND sync.last_capacity_sample>0) AS "canApply"
    FROM external_full_admission_replay_items item JOIN external_full_admission_replays plan ON plan.id=item.replay_id
    JOIN external_full_events denial ON denial.event_id=item.event_id
    WHERE item.source=$1 AND item.external_id=$2 AND item.detail_generation=$3 AND item.state='scheduled'`,
  [source,id,generation])).rows[0];
  return item;
}
