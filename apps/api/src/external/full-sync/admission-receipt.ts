import {z} from 'zod';
import type {Database} from '../../db/index.js';
import {FullSyncError, type Source} from './types.js';

const entryId = z.string().refine(value =>
  /^[1-9][0-9]{0,18}$/.test(value) && (value.length<19 || value<='9223372036854775807'),
);
const receiptCursor = z.strictObject({through:entryId,after:entryId}).refine(
  ({after,through}) => after.length<through.length || after.length===through.length && after<through,
);
export const AdmissionBatchReceiptRequest = z.strictObject({
  reservationId:z.uuid(),
  snapshotId:z.uuid(),
  limit:z.number().int().min(1).max(250).default(100),
  cursor:receiptCursor.optional(),
});
export type AdmissionBatchReceiptRequest = z.input<typeof AdmissionBatchReceiptRequest>;

type AdmissionStatus = 'public'|'withdrawn'|'hidden'|'failed'|'pending'|'not_public';
type AdmissionEntry = {
  entryId:string;
  csvSha256:string;
  source:Source;
  externalId:string;
  admittedAt:Date;
  basis:'csv'|'incremental'|'replay';
  eventId:string|null;
  replayId:string|null;
  status:AdmissionStatus;
  localeMask:number;
  detailErrorCode:string|null;
};

/** Private, bounded reconciliation of first admissions within one reservation and verified snapshot. */
export async function readAdmissionBatchReceipt(db:Database,request:AdmissionBatchReceiptRequest) {
  const input=AdmissionBatchReceiptRequest.parse(request);
  const {reservationId,snapshotId,limit,cursor}=input;
  return db.transaction(async tx=>{
    await tx.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='200ms';
      SET LOCAL max_parallel_workers_per_gather=0; SET LOCAL jit=off; SET LOCAL search_path=pg_catalog`);
    const scope=(await tx.query<{
      csvSha256:string; observedAt:Date; reservationClosedAt:Date|null; latest:string|null; validCursor:boolean;
    }>(`
      SELECT s.sha256 AS "csvSha256",current_timestamp AS "observedAt",r.closed_at AS "reservationClosedAt",
        tail.entry_id::text AS latest,
        ($3::bigint IS NULL OR (
          EXISTS (SELECT 1 FROM public.external_formal_expansion_admissions a
            WHERE a.reservation_id=r.id AND a.snapshot_id=s.id AND a.entry_id=$3)
          AND EXISTS (SELECT 1 FROM public.external_formal_expansion_admissions a
            WHERE a.reservation_id=r.id AND a.snapshot_id=s.id AND a.entry_id=$4)
        )) AS "validCursor"
      FROM public.external_formal_expansion_operations r
      JOIN public.external_full_snapshots s ON s.id=$2
      LEFT JOIN LATERAL (
        SELECT a.entry_id FROM public.external_formal_expansion_admissions a
        WHERE a.reservation_id=r.id AND a.snapshot_id=s.id ORDER BY a.entry_id DESC LIMIT 1
      ) tail ON true
      WHERE r.id=$1 AND r.rollback_of IS NULL AND (r.snapshot_id=s.id OR tail.entry_id IS NOT NULL)
        AND (r.snapshot_id<>s.id OR r.csv_sha256=s.sha256)`,
    [reservationId,snapshotId,cursor?.through??null,cursor?.after??null])).rows[0];
    if (!scope || !/^[a-f0-9]{64}$/.test(scope.csvSha256)) throw new FullSyncError('SYNC_ADMISSION_RECEIPT_NOT_FOUND');
    if (!scope.validCursor) throw new FullSyncError('SYNC_ADMISSION_RECEIPT_CURSOR_CHANGED');

    // The journal sequence is assigned under the admission ledger lock. Capture
    // its visible high-water mark so later admissions cannot shift this traversal.
    const through=cursor?.through??scope.latest;
    const rows=through===null?[]:(await tx.query<AdmissionEntry>(`
      WITH picked AS MATERIALIZED (
        SELECT a.* FROM public.external_formal_expansion_admissions a
        WHERE a.reservation_id=$1 AND a.snapshot_id=$2 AND a.entry_id>$3 AND a.entry_id<=$4
        ORDER BY a.entry_id LIMIT $5
      )
      SELECT a.entry_id::text AS "entryId",a.csv_sha256 AS "csvSha256",a.source,a.external_id AS "externalId",
        a.admitted_at AS "admittedAt",a.basis,a.event_id::text AS "eventId",a.replay_id AS "replayId",
        CASE
          WHEN m.state='withdrawn' OR l.upstream_state='withdrawn' THEN 'withdrawn'
          WHEN f.active AND f.locale_mask<>0 THEN 'public'
          WHEN o.data @> '{"hidden":true}'::jsonb THEN 'hidden'
          WHEN w.attempts>=5 THEN 'failed'
          WHEN w.generation IS NOT NULL OR m.state IS DISTINCT FROM 'active' THEN 'pending'
          ELSE 'not_public'
        END AS status,
        coalesce(CASE WHEN f.active THEN f.locale_mask ELSE 0 END,0) AS "localeMask",
        CASE WHEN w.attempts>=5 THEN w.last_error_code END AS "detailErrorCode"
      FROM picked a
      LEFT JOIN public.external_full_members m USING (source,external_id)
      LEFT JOIN public.external_full_work w ON w.source=m.source AND w.external_id=m.external_id
        AND w.kind='detail' AND w.generation=m.desired_generation
      LEFT JOIN public.external_listings l ON l.provider='chinacarapi' AND l.platform_id=a.source AND l.external_id=a.external_id
      LEFT JOIN public.external_catalog_filter f ON f.listing_id=l.id
      LEFT JOIN public.external_listing_overrides o ON o.listing_id=l.id
      ORDER BY a.entry_id`,[reservationId,snapshotId,cursor?.after??'0',through,limit+1])).rows;
    if (rows.some(row=>row.csvSha256!==scope.csvSha256)) throw new FullSyncError('SYNC_ADMISSION_RECEIPT_SNAPSHOT_CHANGED');
    const items=rows.slice(0,limit).map(({csvSha256,admittedAt,...row})=>({
      ...row,admittedAt:admittedAt.toISOString(),localeMask:row.status==='public'?row.localeMask:0,
    }));
    const pageCounts:Record<AdmissionStatus,number>={public:0,withdrawn:0,hidden:0,failed:0,pending:0,not_public:0};
    for (const {status} of items) pageCounts[status]++;
    const last=items.at(-1);
    return {
      reservationId,snapshotId,csvSha256:scope.csvSha256,observedAt:scope.observedAt.toISOString(),
      reservationClosedAt:scope.reservationClosedAt?.toISOString()??null,through,items,pageCounts,
      nextCursor:rows.length>limit&&through&&last?{through,after:last.entryId}:null,
    };
  });
}
