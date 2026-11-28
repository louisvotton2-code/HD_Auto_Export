import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Database} from '../../db/index.js';
import {DEFAULT_FORMAL_LISTING_LIMIT} from '../formal-admission.js';
import {jsonHash} from '../normalize.js';
import {heavyWorkPausePercentSchema,projectedPeakPausePercentSchema,reachedDiskPercent,reachedHeavyWorkPause,
 type HeavyWorkPausePercent,type ProjectedPeakPausePercent} from './disk-policy.js';
import {FullSyncError} from './types.js';

const sha256=z.string().regex(/^[a-f0-9]{64}$/);
const uint=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rows=z.number().int().min(DEFAULT_FORMAL_LISTING_LIMIT).max(1_000_000);
const isoTime=z.iso.datetime({offset:true});
const databaseName=z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const AdmissionChangeRequest=z.strictObject({
 id:z.uuid(),database:databaseName,snapshotId:z.uuid(),csvSha256:sha256,
 expectedAdmitted:uint.max(1_000_000),expectedLimit:rows,targetRows:rows,
 workerFence:z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value=>value.length<19||value<='9223372036854775807'),
 rollbackOf:z.uuid().nullable(),
}).refine(input=>input.expectedAdmitted<=input.expectedLimit&&(
 input.rollbackOf===null?input.targetRows===1_000_000&&input.targetRows>input.expectedLimit:
 input.rollbackOf!==input.id&&input.targetRows<input.expectedLimit&&input.targetRows>=input.expectedAdmitted
));
export type AdmissionChangeRequest=z.infer<typeof AdmissionChangeRequest>;

const admissionApproval=z.strictObject({
 kind:z.literal('formal-admission-capacity-v1'),release:z.string().regex(/^[a-f0-9]{40}$/),request:AdmissionChangeRequest,
 sourceEvidenceHash:sha256,sourceTargetRows:rows,sampleRows:z.number().int().min(1).max(10_000),
 measuredAt:isoTime,sourceNativeExpiresAt:isoTime,heavyWorkPausePercent:heavyWorkPausePercentSchema,
 projectedPeakPausePercent:projectedPeakPausePercentSchema.optional(),
 currentUsedBytes:uint,diskTotalBytes:uint.min(1),projectedPeakBytes:uint.min(1),ioSafe:z.literal(true),
});

export function validateAdmissionApproval(raw:string,input:AdmissionChangeRequest,release:string|undefined,
 percent:HeavyWorkPausePercent,byteBudget:number,now=Date.now(),
 projectedPeakPausePercent:ProjectedPeakPausePercent=percent) {
 try {
  const proof=admissionApproval.parse(JSON.parse(raw));
  const measuredAt=Date.parse(proof.measuredAt);
  const expiresAt=Math.min(measuredAt+60_000,Date.parse(proof.sourceNativeExpiresAt));
  if(input.rollbackOf===null&&proof.release===release&&jsonHash(proof.request)===jsonHash(input)&&
    proof.heavyWorkPausePercent===percent&&
    (proof.projectedPeakPausePercent??proof.heavyWorkPausePercent)===projectedPeakPausePercent&&
    measuredAt<=now&&now<expiresAt&&proof.currentUsedBytes<=proof.projectedPeakBytes&&
    !reachedHeavyWorkPause(proof.currentUsedBytes,proof.diskTotalBytes,percent)&&
    !reachedDiskPercent(proof.projectedPeakBytes,proof.diskTotalBytes,projectedPeakPausePercent)&&
    Number.isSafeInteger(byteBudget)&&byteBudget>=0&&(byteBudget===0||proof.projectedPeakBytes<=byteBudget)) {
   return {hash:createHash('sha256').update(raw).digest('hex'),expiresAt,projectedPeakBytes:proof.projectedPeakBytes,
    sourceEvidenceHash:proof.sourceEvidenceHash,sourceTargetRows:proof.sourceTargetRows,sampleRows:proof.sampleRows};
  }
 } catch { /* The host receipt is private and may not be reported in errors. */ }
 throw new FullSyncError('SYNC_ADMISSION_CAPACITY_APPROVAL_INVALID');
}

const operatorLimits="SET LOCAL lock_timeout='200ms'; SET LOCAL statement_timeout='2s'; SET LOCAL max_parallel_workers_per_gather=0";
const operationErrors:Record<string,string>={
 HD551:'SYNC_ADMISSION_PLAN_INVALID',HD552:'SYNC_ADMIN_REQUIRED',HD553:'SYNC_ADMISSION_OPERATION_CONFLICT',
 HD554:'SYNC_ADMISSION_WORKER_RUNNING',HD555:'SYNC_ADMISSION_BACKUP_ACTIVE',HD556:'SYNC_ADMISSION_BASIS_CHANGED',
 HD557:'SYNC_ADMISSION_BASIS_CHANGED',HD558:'SYNC_ADMISSION_BASIS_CHANGED',HD559:'SYNC_ADMISSION_REPLAY_ACTIVE',
 HD55A:'SYNC_ADMISSION_RESERVATION_ACTIVE',HD55B:'SYNC_ADMISSION_ROLLBACK_UNSAFE',
 '42883':'SYNC_ADMISSION_MIGRATION_REQUIRED','42P01':'SYNC_ADMISSION_MIGRATION_REQUIRED',
 '55P03':'SYNC_ADMISSION_DB_BUSY','57014':'SYNC_ADMISSION_DB_BUSY',
};

export function admissionOperationError(error:unknown):never {
 if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&Object.hasOwn(operationErrors,error.code))
  throw new FullSyncError(operationErrors[error.code]!);
 throw error;
}

async function currentBasis(tx:PoolClient,input:AdmissionChangeRequest) {
 const basis=(await tx.query<{
  database:string;admitted:number;ceiling:number;workerFence:string;snapshotId:string|null;csvSha256:string|null;
  retained:boolean;unapplied:boolean;sourceEvidenceHash:string|null;sourceTargetRows:number|null;sampleRows:number|null;
  approvedBudgetBytes:string|null;
 }>(`SELECT current_database() AS database, a.admitted_count::int AS admitted,a.admission_limit::int AS ceiling,
  w.worker_fence::text AS "workerFence",s.id AS "snapshotId",s.sha256 AS "csvSha256",
  coalesce(s.state IN ('verified','applying','complete') AND s.archive_pruned_at IS NULL AND
    s.rows>0 AND s.staged=s.rows AND s.bytes>0,false) AS retained,
  coalesce(s.state='verified' AND s.apply_cursor=0,false) AS unapplied,
  CASE WHEN w.capacity_estimate->>'snapshotId'=s.id::text AND
     w.capacity_estimate->'sampleEvidenceSufficient'='true'::jsonb THEN w.capacity_estimate->>'evidenceHash' END AS "sourceEvidenceHash",
  (w.capacity_estimate->>'targetRows')::int AS "sourceTargetRows",
  (w.capacity_estimate->>'sampleRows')::int AS "sampleRows",
  w.capacity_estimate->>'approvedBudgetBytes' AS "approvedBudgetBytes"
  FROM external_formal_admission_state a JOIN external_full_sync w ON w.id=a.id
  LEFT JOIN LATERAL (SELECT * FROM external_full_snapshots WHERE state<>'failed'
    ORDER BY created_at DESC,id DESC LIMIT 1) s ON true WHERE a.id=1`)).rows[0];
 if(!basis||basis.database!==input.database||basis.admitted!==input.expectedAdmitted||
   basis.ceiling!==input.expectedLimit||basis.workerFence!==input.workerFence||
   basis.snapshotId!==input.snapshotId||basis.csvSha256!==input.csvSha256||!basis.retained)
  throw new FullSyncError('SYNC_ADMISSION_BASIS_CHANGED');
 if(input.rollbackOf===null){
  if(!basis.unapplied)throw new FullSyncError('SYNC_ADMISSION_SNAPSHOT_ALREADY_APPLIED');
  if(!sha256.safeParse(basis.sourceEvidenceHash).success||basis.sourceTargetRows!==input.expectedLimit||
    !basis.sampleRows||basis.sampleRows>10_000)throw new FullSyncError('SYNC_ADMISSION_CAPACITY_SAMPLE_REQUIRED');
 }
 return basis;
}

async function requireTargetDatabase(tx:PoolClient,input:AdmissionChangeRequest) {
 if((await tx.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name!==input.database)
  throw new FullSyncError('SYNC_ADMISSION_BASIS_CHANGED');
}

async function committedChange(tx:PoolClient,input:AdmissionChangeRequest,actor?:string) {
 const previous=(await tx.query<{request_hash:string;requested_by:string;result:unknown}>(
  'SELECT request_hash,requested_by,result FROM external_formal_expansion_operations WHERE id=$1',[input.id])).rows[0];
 if(!previous)return null;
 if(previous.request_hash!==jsonHash(input)||(actor!==undefined&&previous.requested_by!==actor))
  throw new FullSyncError('SYNC_ADMISSION_OPERATION_CONFLICT');
 return previous.result;
}

export async function inspectAdmissionChange(db:Database,input:AdmissionChangeRequest) {
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await tx.query(operatorLimits);
  await requireTargetDatabase(tx,input);
  const committed=await committedChange(tx,input);
  if(committed)return {request:input,committed};
  const {sourceEvidenceHash,sourceTargetRows,sampleRows}=await currentBasis(tx,input);
  return {request:input,committed:null,sourceEvidenceHash,sourceTargetRows,sampleRows};
 });
}

export async function changeAdmissionLimit(db:Database,input:AdmissionChangeRequest,actor:string,
 getApproval:()=>ReturnType<typeof validateAdmissionApproval>) {
 return db.transaction(async tx=>{
  await tx.query(operatorLimits);
  await requireTargetDatabase(tx,input);
  if(!(await tx.query("SELECT id FROM staff WHERE id=$1 AND role='admin' AND NOT banned FOR SHARE",[actor])).rowCount)
   throw new FullSyncError('SYNC_ADMIN_REQUIRED');
  const committed=await committedChange(tx,input,actor);
  if(committed)return committed;
  // Use the same worker fence as the database function, so the sample cannot
  // change between the evidence comparison and updating the ceiling.
  if(!(await tx.query('SELECT pg_try_advisory_xact_lock(78291333) AS locked')).rows[0]?.locked)
   throw new FullSyncError('SYNC_ADMISSION_WORKER_RUNNING');
  const concurrent=await committedChange(tx,input,actor);
  if(concurrent)return concurrent;
  const basis=await currentBasis(tx,input);
  const approval=input.rollbackOf===null?getApproval():null;
  if(approval&&(basis.sourceEvidenceHash!==approval.sourceEvidenceHash||
    basis.sourceTargetRows!==approval.sourceTargetRows||basis.sampleRows!==approval.sampleRows))
   throw new FullSyncError('SYNC_ADMISSION_BASIS_CHANGED');
  const budget=Number(basis.approvedBudgetBytes??0);
  if(approval&&(!Number.isSafeInteger(budget)||budget<0||budget>0&&approval.projectedPeakBytes>budget))
   throw new FullSyncError('SYNC_CAPACITY_BUDGET_CAP');
  const result=await tx.query<{result:unknown}>(`SELECT public.change_external_formal_expansion(
   $1::uuid,$2::uuid,$3::uuid,$4::text,$5::bigint,$6::bigint,$7::bigint,$8::text,$9::text,$10::text,$11::bigint
  ) AS result`,[input.id,input.rollbackOf,input.snapshotId,input.csvSha256,input.expectedAdmitted,
   input.expectedLimit,input.targetRows,actor,jsonHash(input),approval?.hash??null,input.workerFence]);
  if(approval&&Date.now()>=approval.expiresAt)throw new FullSyncError('SYNC_ADMISSION_CAPACITY_APPROVAL_INVALID');
  return result.rows[0]!.result;
 });
}
