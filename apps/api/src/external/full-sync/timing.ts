import type {PoolClient} from 'pg';
import type {Database} from '../../db/index.js';
import type {ExternalSyncTimings} from '@hd/contracts/admin';

/** The existing writer lock protects projection and timeline together. A skipped generation is not a success. */
export async function supersedeTiming(tx:PoolClient,source:string,id:string,generation:string){
 await tx.query(`UPDATE external_full_events SET public_outcome='superseded'
  WHERE source=$1 AND external_id=$2 AND detail_generation<$3 AND public_outcome='pending'`,[source,id,generation]);
}

// Stamp the indexed pending row in the same update as its outcome. Terminal
// history and refreshes without a pending event need no second lookup.
const observedPublicTiming = (verified: string) => `(
  WITH observation AS MATERIALIZED (SELECT (${verified}) AS effective)
  SELECT CASE WHEN effective THEN 'effective' ELSE 'not_public' END,
   CASE WHEN effective THEN coalesce(e.public_effective_at, statement_timestamp()) ELSE e.public_effective_at END
  FROM observation
 )`;

export async function recordWithdrawalTiming(tx:PoolClient,source:string,id:string,generation:string){
 await tx.query(`UPDATE external_full_events e SET (public_outcome, public_effective_at)=${observedPublicTiming(`e.was_public AND EXISTS(
   SELECT 1 FROM external_listings l WHERE l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
   AND l.upstream_state='withdrawn' AND NOT EXISTS(SELECT 1 FROM external_catalog c WHERE c.listing_id=l.id))`)}
  WHERE e.source=$1 AND e.external_id=$2 AND e.detail_generation=$3 AND e.operation='withdraw' AND e.public_outcome='pending'`,[source,id,generation]);
}
export async function recordDetailTiming(tx:PoolClient,source:string,id:string,generation:string){
 // A detail fetched for this generation may still contain stale supplier data. Keep that unresolved.
 // A hidden, disputed, non-representative or unpriced listing does not count as publicly effective.
 await tx.query(`UPDATE external_full_events e SET detail_updated_at=statement_timestamp(),
   (public_outcome, public_effective_at)=${observedPublicTiming(`EXISTS(SELECT 1 FROM external_listings l
    JOIN external_catalog c ON c.listing_id=l.id JOIN external_catalog_filter f ON f.listing_id=l.id
    WHERE l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
     AND l.upstream_state='active' AND l.formal_primary AND f.active AND f.locale_mask=7
     AND l.source_updated_at>=e.business_at AND (e.source_type<>'price' OR
      (e.was_public AND l.source_updated_at=e.business_at AND c.price_cny IS NOT NULL AND c.price_cny IS DISTINCT FROM e.prior_public_price)))`)}
  WHERE e.source=$1 AND e.external_id=$2 AND e.detail_generation=$3 AND e.operation<>'withdraw' AND e.public_outcome='pending'`,[source,id,generation]);
}
/** A slot counts only after its whole received page and cursor commit; an attempted or partial page is not coverage. */
export async function recordReceiveObservation(tx:PoolClient,error:string|null=null){
 await tx.query(`INSERT INTO external_full_receive_observations(slot_at,last_attempt_at,last_success_at,last_error_code)
  VALUES(date_bin(interval '5 minutes',statement_timestamp(),'epoch'::timestamptz),statement_timestamp(),CASE WHEN $1::text IS NULL THEN statement_timestamp() ELSE NULL END,$1)
  ON CONFLICT(slot_at) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
   last_success_at=coalesce(excluded.last_success_at,external_full_receive_observations.last_success_at),last_error_code=excluded.last_error_code`,[error]);
 await tx.query("DELETE FROM external_full_receive_observations WHERE slot_at<=date_bin(interval '5 minutes',statement_timestamp(),'epoch'::timestamptz)-interval '168 hours'");
}
const iso=(value:Date|string|null)=>value?new Date(value).toISOString():null;
export async function fullSyncTimings(db:Database):Promise<ExternalSyncTimings>{
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const clock=(await tx.query(`SELECT CURRENT_TIMESTAMP AS at,CURRENT_TIMESTAMP-interval '24 hours' AS from_at,
   date_bin(interval '5 minutes',CURRENT_TIMESTAMP,'epoch'::timestamptz) AS coverage_end,
   timing_started_at,last_receive_at,next_delta_at FROM external_full_sync WHERE id=1`)).rows[0]!;
  const coverage=(await tx.query(`SELECT count(*) FILTER(WHERE last_success_at IS NOT NULL)::integer AS succeeded,
   count(*) FILTER(WHERE last_success_at IS NULL AND last_error_code IS NOT NULL)::integer AS failed
   FROM external_full_receive_observations WHERE slot_at>=$1::timestamptz-interval '24 hours' AND slot_at<$1`,[clock.coverage_end])).rows[0]!;
  const groups=(await tx.query(`SELECT coalesce(e.source_type,'unknown') AS kind,count(*)::integer AS received,
   count(*) FILTER(WHERE e.applied_at IS NOT NULL)::integer AS applied,
   count(*) FILTER(WHERE e.detail_updated_at IS NOT NULL)::integer AS detail_updated,
   count(*) FILTER(WHERE e.public_effective_at IS NOT NULL)::integer AS public_effective,
   count(*) FILTER(WHERE e.public_effective_at IS NULL)::integer AS incomplete,
   count(*) FILTER(WHERE w.attempts>=5 OR e.error_code IS NOT NULL)::integer AS failed,
   count(*) FILTER(WHERE e.public_outcome='not_public')::integer AS not_public,
   count(*) FILTER(WHERE e.public_outcome='superseded')::integer AS superseded,
   count(*) FILTER(WHERE e.public_outcome='unknown' OR e.source_type IS NULL)::integer AS uninstrumented,
   min(e.received_at) FILTER(WHERE e.public_effective_at IS NULL) AS oldest,
   percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM(e.received_at-e.business_at))*1000)
    FILTER(WHERE e.received_at>=e.business_at) AS source_received,
   percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM(e.applied_at-e.received_at))*1000)
    FILTER(WHERE e.applied_at>=e.received_at) AS received_applied,
   percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM(e.detail_updated_at-e.applied_at))*1000)
    FILTER(WHERE e.detail_updated_at>=e.applied_at) AS applied_detail,
   percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM(e.public_effective_at-e.received_at))*1000)
    FILTER(WHERE e.public_effective_at>=e.received_at) AS received_public
   FROM external_full_events e LEFT JOIN external_full_work w ON w.source=e.source AND w.external_id=e.external_id
    AND w.kind='detail' AND w.generation=e.detail_generation
   WHERE e.received_at>=$1 GROUP BY coalesce(e.source_type,'unknown') ORDER BY kind`,[clock.from_at])).rows;
  const backlog=(await tx.query(`SELECT count(*)::integer AS pending,
   count(*) FILTER(WHERE attempts>=5)::integer AS failed,min(queued_at) AS oldest FROM external_full_work`)).rows[0]!;
  const pending=(await tx.query(`SELECT count(*)::integer AS n,min(received_at) AS oldest FROM external_full_events WHERE applied_at IS NULL`)).rows[0]!;
  const events=(await tx.query(`SELECT event_id::text,source_type,business_at,received_at,applied_at,detail_updated_at,public_effective_at,public_outcome
   FROM external_full_events ORDER BY received_at DESC,event_id DESC LIMIT 50`)).rows;
  return {asOf:iso(clock.at)!,window:{from:iso(clock.from_at)!,to:iso(clock.at)!,instrumentedSince:iso(clock.timing_started_at)!,
   complete:new Date(clock.timing_started_at).getTime()<=new Date(clock.coverage_end).getTime()-86_400_000&&coverage.succeeded===288,
   uninstrumentedEvents:groups.reduce((n,r)=>n+r.uninstrumented,0),lastReceivedAt:iso(clock.last_receive_at),nextReceiveAt:iso(clock.next_delta_at)!,coverage:{slotMs:300000,expectedSlots:288,successfulSlots:coverage.succeeded,missingSlots:288-coverage.succeeded,failedSlots:coverage.failed,through:iso(clock.coverage_end)!}},
   backlog:{pendingEvents:pending.n,pendingWork:backlog.pending,failedWork:backlog.failed,oldestEventAt:iso(pending.oldest),oldestWorkAt:iso(backlog.oldest)},
   metrics:groups.map(r=>({kind:r.kind,received:r.received,applied:r.applied,detailUpdated:r.detail_updated,publicEffective:r.public_effective,
    incomplete:r.incomplete,failed:r.failed,notPublic:r.not_public,superseded:r.superseded,oldestIncompleteAt:iso(r.oldest),
    p95SourceToReceivedMs:r.source_received,p95ReceivedToAppliedMs:r.received_applied,p95AppliedToDetailMs:r.applied_detail,p95ReceivedToPublicMs:r.received_public})),
   events:events.map(r=>({eventId:r.event_id,kind:r.source_type??'unknown',sourceAt:iso(r.business_at)!,receivedAt:iso(r.received_at)!,appliedAt:iso(r.applied_at),
    detailUpdatedAt:iso(r.detail_updated_at),publicEffectiveAt:iso(r.public_effective_at),outcome:r.public_outcome}))};
 });
}
