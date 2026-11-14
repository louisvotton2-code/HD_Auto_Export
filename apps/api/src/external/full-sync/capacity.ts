import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {Database} from '../../db/index.js';
import {jsonHash} from '../normalize.js';

const bytes=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const token=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const reason=z.enum(['SYNC_CAPACITY_VERIFIED','SYNC_CAPACITY_LIMIT','SYNC_CAPACITY_INSUFFICIENT_SAMPLE','SYNC_CAPACITY_WAITING_MEASUREMENT']);
const utc=z.iso.datetime().refine(value=>value.endsWith('Z'));
const decisionSchema=z.strictObject({schemaVersion:z.literal(1),model:z.literal('hd-ext07-peak-v1'),
 snapshotId:z.uuid(),targetRows:bytes,sampleRows:bytes,evidenceHash:z.string().regex(/^[a-f0-9]{64}$/),
 measuredAt:utc,expiresAt:utc,decision:z.enum(['allow','wait','blocked']),reason,
 projectedPeakBytes:bytes.nullable(),diskTotalBytes:bytes.positive(),currentUsedBytes:bytes,
 components:z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),z.union([bytes,token])).refine(value=>Object.keys(value).length<=64),
}).refine(value=>value.decision==='allow'?value.reason==='SYNC_CAPACITY_VERIFIED':value.decision==='blocked'?value.reason==='SYNC_CAPACITY_LIMIT':value.reason==='SYNC_CAPACITY_INSUFFICIENT_SAMPLE'||value.reason==='SYNC_CAPACITY_WAITING_MEASUREMENT');
export type CapacityDecision=z.infer<typeof decisionSchema>;
export type CapacityBinding={snapshotId:string;targetRows:number;sampleRows:number;evidenceHash:string};
export type CapacityDisk={total:number;available:number;used:number};
export type CapacityResult={allowed:boolean;code:string|null;decision:CapacityDecision|null};
const reached70=(used:number,total:number)=>BigInt(used)*10n>=BigInt(total)*7n;

/** Private, bounded, one-inode read. Atomic host rename cannot expose a half-written file. */
export async function readCapacityDecision(file:string|undefined,binding:CapacityBinding,disk:CapacityDisk,cap=0,now=Date.now()):Promise<CapacityResult>{
 const wait:CapacityResult={allowed:false,code:'SYNC_CAPACITY_AWAITING_DECISION',decision:null};
 if(!Number.isSafeInteger(disk.total)||disk.total<=0||!Number.isSafeInteger(disk.available)||disk.available<0||disk.available>disk.total)return wait;
 if(reached70(disk.total-disk.available,disk.total))return {...wait,code:'SYNC_CAPACITY_LIMIT'};
 if(!file||!path.isAbsolute(file)||!Number.isSafeInteger(cap)||cap<0)return wait;
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=await handle.stat(),limit=64*1024;
  if(!info.isFile()||info.size>limit||(info.mode&0o027)!==0)return wait;
  const buffer=Buffer.alloc(limit+1);let size=0;
  while(size<buffer.length){const part=await handle.read(buffer,size,buffer.length-size,null);if(!part.bytesRead)break;size+=part.bytesRead;}
  if(size>limit)return wait;
  const parsed=decisionSchema.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size))));
  if(!parsed.success)return wait;const d=parsed.data,measured=Date.parse(d.measuredAt),expires=Date.parse(d.expiresAt);
  if(measured>now+60_000||expires<=now||expires<=measured||expires-measured>600_000||d.currentUsedBytes>d.diskTotalBytes||d.diskTotalBytes!==disk.total||d.projectedPeakBytes!==null&&d.projectedPeakBytes<d.currentUsedBytes)return wait;
  if(d.snapshotId!==binding.snapshotId||d.targetRows!==binding.targetRows||d.sampleRows!==binding.sampleRows||d.evidenceHash!==binding.evidenceHash)return wait;
  if(d.projectedPeakBytes!==null&&reached70(d.projectedPeakBytes,d.diskTotalBytes)||reached70(d.currentUsedBytes,d.diskTotalBytes))return {...wait,decision:d,code:'SYNC_CAPACITY_LIMIT'};
  if(d.decision!=='allow'||d.projectedPeakBytes===null)return {...wait,decision:d};
  if(cap>0&&d.projectedPeakBytes>cap)return {...wait,decision:d,code:'SYNC_CAPACITY_BUDGET_CAP'};
  return {allowed:true,code:null,decision:d};
 }catch{return wait;}finally{await handle?.close().catch(()=>{});}
}

export type CapacitySample={details:number;active_details:number;withdrawn:number;three_locales:number;reports:number;no_report:number;cohort_hash:string;state_hash:string};
/** One consistent SQL statement; at most 10001 rows, with a partial index. Identity rows never leave PostgreSQL. */
export async function capacitySample(db:Database):Promise<CapacitySample>{
 return (await db.pool.query<CapacitySample>(`WITH cohort AS MATERIALIZED (
  SELECT * FROM external_full_members WHERE sampled AND last_detail_at IS NOT NULL ORDER BY source COLLATE "C",external_id COLLATE "C" LIMIT 10001
 ), fingerprints AS (
  SELECT *,encode(sha256(convert_to(jsonb_build_array(source,external_id)::text,'UTF8')),'hex') AS identity_hash,
   encode(sha256(convert_to(jsonb_build_array(source,external_id,canonical_id,state,event_order::text,desired_generation::text,applied_generation::text,
    ARRAY(SELECT l FROM unnest(locales) l ORDER BY l COLLATE "C"),report_state,extract(epoch FROM last_detail_at)::text,extract(epoch FROM report_checked_at)::text)::text,'UTF8')),'hex') AS member_hash FROM cohort
 ) SELECT count(*)::integer AS details,count(*) FILTER(WHERE state<>'withdrawn')::integer AS active_details,
 count(*) FILTER(WHERE state='withdrawn')::integer AS withdrawn,count(*) FILTER(WHERE state<>'withdrawn' AND cardinality(locales)=3)::integer AS three_locales,
 count(*) FILTER(WHERE state<>'withdrawn' AND report_state IN('available','unavailable'))::integer AS reports,
 count(*) FILTER(WHERE state<>'withdrawn' AND report_state='no_report')::integer AS no_report,
 encode(sha256(convert_to(coalesce(string_agg(identity_hash,'' ORDER BY source COLLATE "C",external_id COLLATE "C"),''),'UTF8')),'hex') AS cohort_hash,
 encode(sha256(convert_to(coalesce(string_agg(member_hash,'' ORDER BY source COLLATE "C",external_id COLLATE "C"),''),'UTF8')),'hex') AS state_hash FROM fingerprints`)).rows[0]!;
}
export type MeasuredCohort={model:'measured-cohort-v2';cohortHash:string;stateHash:string;sampleRows:number;snapshotId:string;targetRows:number;bytesPerDetail:number;at:string};
export function validMeasuredCohort(value:unknown,sample:CapacitySample):value is MeasuredCohort{
 if(!value||typeof value!=='object')return false;const p=value as Partial<MeasuredCohort>;
 return p.model==='measured-cohort-v2'&&p.cohortHash===sample.cohort_hash&&p.sampleRows===sample.details&&typeof p.stateHash==='string'&&/^[a-f0-9]{64}$/.test(p.stateHash)&&typeof p.snapshotId==='string'&&typeof p.targetRows==='number'&&Number.isSafeInteger(p.targetRows)&&p.targetRows>0&&typeof p.bytesPerDetail==='number'&&Number.isFinite(p.bytesPerDetail)&&p.bytesPerDetail>0;
}
export function capacityBinding(snapshotId:string,targetRows:number,sample:CapacitySample,baseline:MeasuredCohort|null):CapacityBinding{
 // Canonical JSON: recursively lexicographic object keys, arrays retain order, UTF-8, no whitespace; no polling time or live sizes.
 const history=baseline?{model:baseline.model,cohortHash:baseline.cohortHash,stateHash:baseline.stateHash,sampleRows:baseline.sampleRows,snapshotId:baseline.snapshotId,targetRows:baseline.targetRows,bytesPerDetail:baseline.bytesPerDetail}:null;
 return {snapshotId,targetRows,sampleRows:sample.details,evidenceHash:jsonHash({model:'hd-ext07-evidence-v1',snapshotId,targetRows,cohortHash:sample.cohort_hash,stateHash:sample.state_hash,history})};
}
