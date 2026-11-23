import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Database } from '../../db/index.js';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().refine(value => Number.isFinite(Date.parse(value)));
const sourceBinding = z.strictObject({
  database: z.string().min(1),
  systemId: z.string().regex(/^\d+$/),
  timeline: z.string().regex(/^[A-F0-9]+$/),
  wal: z.string().regex(/^[A-F0-9]+\/[A-F0-9]+$/),
  mvcc: z.string().regex(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/),
  recovering: z.boolean(),
});
const snapshotBinding = z.strictObject({
  id: z.uuid(),
  digest: sha256,
  generatedAt: time,
  rows: count.min(1),
  bytes: count.min(1),
  applyCursor: count,
}).refine(snapshot => snapshot.applyCursor <= snapshot.rows, 'Invalid CSV cursor');
const pending = z.strictObject({
  n: count,
  oldestReceivedAt: time.nullable(),
  oldestAgeMs: count.nullable(),
});
const eventEvidence = z.strictObject({
  lastHour: z.strictObject({
    received: count,
    coverage: z.enum(['complete-recorded-window', 'sample-limit']),
    distinctIdentities: count.nullable(),
    stillMissingAfterLimit: count.nullable(),
  }),
  unappliedPrice: pending,
  unappliedWithdrawal: pending,
  awaitingPublicPrice: pending,
  awaitingPublicWithdrawal: pending,
});
const manifestSchema = z.strictObject({
  format: z.literal(1),
  restoreReceipt: sha256,
  asOf: time,
  source: sourceBinding,
  snapshot: snapshotBinding,
  chunkRows: count.min(100).max(4000),
  admitted: count,
  admissionLimit: count,
  deltas: eventEvidence,
});
const countsSchema = z.strictObject({
  admitted: count,
  withdrawnSinceExport: count,
  missingThroughCursor: count,
  missingAfterCursor: count,
});
const chunkSchema = z.strictObject({
  binding: sha256,
  firstRow: count.min(1),
  lastRow: count.min(1),
  counts: countsSchema,
});
export const AdmissionAuditOptions = z.strictObject({
  database: z.string().min(1),
  checkpoint: z.string().refine(value => path.isAbsolute(value), 'Expected an absolute checkpoint path'),
  snapshotId: z.uuid(),
  restoreReceipt: sha256,
  restoreAsOf: z.iso.datetime(),
  chunkRows: count.min(100).max(4000).default(1000),
  maxChunks: count.min(1).max(100).default(20),
});
type AuditOptions = z.input<typeof AdmissionAuditOptions>;
type Manifest = z.infer<typeof manifestSchema>;
type Binding = z.infer<typeof sourceBinding>;
type Chunk = z.infer<typeof chunkSchema>;

export class AdmissionAuditUnavailableError extends Error {}

const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
function sameBinding(a: Binding, b: Binding) {
  // Logical writes move the MVCC view. On a primary, even a SELECT can
  // generate WAL for page hints, so the insert LSN is diagnostic only.
  return a.database===b.database && a.systemId===b.systemId && a.timeline===b.timeline &&
    a.mvcc===b.mvcc && a.recovering===b.recovering && (!a.recovering||a.wal===b.wal);
}
function fileDigest(data: string) {
  return createHash('sha256').update(data).digest('hex');
}

async function readPrivateJson(filename: string): Promise<string | undefined> {
  try {
    const info = await lstat(filename);
    if (!info.isFile() || (info.mode & 0o077)!==0 || info.size>65_536) throw new AdmissionAuditUnavailableError('Unsafe audit checkpoint file');
    return await readFile(filename, 'utf8');
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
}

async function writeCheckpoint(directory: string, filename: string, contents: string) {
  const target = path.join(directory,filename);
  const temporary = path.join(directory,'.audit-'+randomUUID());
  const file = await open(temporary,'wx',0o600);
  try {
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    // A completed chunk is published atomically and never overwritten.
    try {
      await link(temporary,target);
    } catch (error) {
      if (!(await readPrivateJson(target)===contents)) throw error;
    }
    const handle=await open(directory,'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } finally { await unlink(temporary); }
}

async function readBinding(tx: PoolClient): Promise<Binding> {
  const result=await tx.query(`SELECT current_database() AS database,system_identifier::text AS "systemId",
    CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn() ELSE pg_current_wal_insert_lsn() END::text AS wal,
    CASE WHEN pg_is_in_recovery() THEN upper(to_hex((pg_control_checkpoint()).timeline_id))
      ELSE left(pg_walfile_name(pg_current_wal_insert_lsn()),8) END AS timeline,
    pg_current_snapshot()::text AS mvcc,pg_is_in_recovery() AS recovering,
    CASE WHEN pg_is_in_recovery() THEN pg_get_wal_replay_pause_state() END AS pause
    FROM pg_control_system()`);
  const {pause,...binding}=result.rows[0]!;
  if (binding.recovering&&pause!=='paused') throw new AdmissionAuditUnavailableError('WAL replay must be paused on the isolated audit restore');
  return sourceBinding.parse(binding);
}

async function readOnlyView<T>(db: Database, database: string, work: (tx: PoolClient, binding: Binding)=>Promise<T>, expected?: Binding) {
  const result=await db.transaction(async tx=>{
    await tx.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='200ms';
      SET LOCAL idle_in_transaction_session_timeout='4s'; SET LOCAL max_parallel_workers_per_gather=0;
      SET LOCAL jit=off; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=pg_catalog`);
    const binding=await readBinding(tx);
    if (binding.database!==database || (expected&&!sameBinding(expected,binding))) {
      throw new AdmissionAuditUnavailableError('Isolated audit restore changed. Start a new checkpoint');
    }
    return {value:await work(tx,binding),binding};
  });
  // Check a second view after committing the read. A writer becoming visible
  // or WAL replay moving to a later position must invalidate reuse.
  const current=await db.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='2s'; SET LOCAL search_path=pg_catalog");
    return readBinding(tx);
  });
  if (!sameBinding(current,result.binding)) throw new AdmissionAuditUnavailableError('Isolated audit restore drifted while reading');
  return result.value;
}

async function readDeltas(tx: PoolClient,asOf: string) {
  const recent=await tx.query(`WITH bounded AS MATERIALIZED (
    SELECT source,external_id,event_id,operation,applied_at,error_code,business_at
    FROM public.external_full_events
    WHERE received_at >= $1::timestamptz - interval '1 hour' AND received_at <= $1::timestamptz
    ORDER BY received_at DESC LIMIT 20001
  ), latest AS MATERIALIZED (
    SELECT DISTINCT ON (source,external_id) * FROM bounded ORDER BY source,external_id,event_id DESC
  ), denominator AS (SELECT count(*)::int AS n FROM bounded)
  SELECT denominator.n AS received,CASE WHEN denominator.n<=20000 THEN 'complete-recorded-window' ELSE 'sample-limit' END AS coverage,
    CASE WHEN denominator.n<=20000 THEN (SELECT count(*)::int FROM latest) END AS "distinctIdentities",
    CASE WHEN denominator.n<=20000 THEN (
      SELECT count(*)::int FROM latest e
      LEFT JOIN public.external_formal_admissions a USING (source,external_id)
      LEFT JOIN public.external_ingestion_identity_state w
        ON w.provider='chinacarapi' AND w.source=e.source AND w.external_id=e.external_id AND w.withdrawn
      LEFT JOIN public.external_full_members m ON m.source=e.source AND m.external_id=e.external_id AND m.state='withdrawn'
      WHERE e.operation IN ('upsert','relist') AND e.error_code='SYNC_LISTING_LIMIT' AND e.applied_at IS NOT NULL AND a.source IS NULL
        AND (w.source IS NULL OR (e.operation='relist' AND e.event_id>w.business_order AND e.business_at>=w.business_at))
        AND (m.source IS NULL OR (e.operation='relist' AND e.event_id>m.event_order AND e.business_at>=m.business_at))
    ) END AS "stillMissingAfterLimit" FROM denominator`,[asOf]);
  const backlog=await tx.query(`WITH pending AS MATERIALIZED (
    SELECT CASE WHEN e.operation='withdraw' THEN 'Withdrawal' ELSE 'Price' END AS kind,
      e.applied_at IS NULL AS unapplied,e.received_at FROM public.external_full_events e
    WHERE (e.applied_at IS NULL OR (e.was_public AND e.public_outcome='pending'))
      AND (e.operation='withdraw' OR e.source_type='price')
  ), counts AS (
    SELECT kind,unapplied,count(*)::int AS n,min(received_at) AS oldest
    FROM pending GROUP BY kind,unapplied
  )
  SELECT (CASE WHEN groups.unapplied THEN 'unapplied' ELSE 'awaitingPublic' END)||groups.kind AS key,
    coalesce(counts.n,0) AS n,counts.oldest::text AS "oldestReceivedAt",
    CASE WHEN counts.oldest IS NOT NULL
      THEN greatest(floor(extract(epoch FROM ($1::timestamptz-counts.oldest))*1000),0)::float8 END AS "oldestAgeMs"
  FROM (VALUES ('Withdrawal',true),('Price',true),('Withdrawal',false),('Price',false)) AS groups(kind,unapplied)
  LEFT JOIN counts USING(kind,unapplied)`,[asOf]);
  return eventEvidence.parse({
    lastHour:recent.rows[0],
    ...Object.fromEntries(backlog.rows.map(({key,...values})=>[key,values])),
  });
}

async function readManifest(db: Database, options: z.output<typeof AdmissionAuditOptions>): Promise<Manifest> {
  return readOnlyView(db,options.database,async(tx,source)=>{
    const result=await tx.query(`SELECT snap.id::text AS id,snap.sha256 AS digest,snap.generated_at::text AS "generatedAt",
       snap.rows::float8 AS rows,snap.bytes::float8 AS bytes,snap.apply_cursor::float8 AS "applyCursor",
       a.admitted_count::float8 AS admitted,a.admission_limit::float8 AS "admissionLimit"
      FROM public.external_full_snapshots snap CROSS JOIN public.external_formal_admission_state a
      WHERE snap.id=$1::uuid AND a.id=1 AND snap.state IN ('verified','applying','complete')
        AND snap.archive_pruned_at IS NULL AND snap.rows=snap.staged AND snap.rows>0 AND snap.bytes>0
        AND snap.sha256 ~ '^[a-f0-9]{64}$'
        AND $2::timestamptz BETWEEN snap.created_at AND CURRENT_TIMESTAMP
        AND NOT EXISTS (SELECT 1 FROM public.external_full_events e WHERE e.received_at>$2::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM public.external_full_stage s WHERE s.snapshot_id=snap.id AND s.row_number<1)
        AND NOT EXISTS (SELECT 1 FROM public.external_full_stage s WHERE s.snapshot_id=snap.id AND s.row_number>snap.rows)`,
      [options.snapshotId,options.restoreAsOf]);
    if (!result.rows[0]) throw new AdmissionAuditUnavailableError('Verified retained CSV snapshot at the restore cutoff required');
    const {admitted,admissionLimit,...snapshot}=result.rows[0];
    const asOf=options.restoreAsOf;
    return manifestSchema.parse({format:1,restoreReceipt:options.restoreReceipt,asOf,source,snapshot,
      chunkRows:options.chunkRows,admitted,admissionLimit,deltas:await readDeltas(tx,asOf)});
  });
}

function assertChunk(chunk: Chunk,binding: string,firstRow: number,lastRow: number,cursor: number) {
  const {admitted,withdrawnSinceExport,missingThroughCursor,missingAfterCursor}=chunk.counts;
  if (chunk.binding!==binding||chunk.firstRow!==firstRow||chunk.lastRow!==lastRow ||
      admitted+withdrawnSinceExport+missingThroughCursor+missingAfterCursor!==lastRow-firstRow+1 ||
      missingThroughCursor>Math.max(0,Math.min(lastRow,cursor)-firstRow+1) ||
      missingAfterCursor>Math.max(0,lastRow-Math.max(firstRow-1,cursor))) {
    throw new AdmissionAuditUnavailableError('Invalid audit chunk checkpoint');
  }
}
async function readChunk(db: Database, manifest: Manifest, binding: string,firstRow: number,lastRow: number) {
  return readOnlyView(db,manifest.source.database,async tx=>{
    const result=await tx.query(`WITH picked AS MATERIALIZED (
      SELECT row_number,source,external_id FROM public.external_full_stage
      WHERE snapshot_id=$1::uuid AND row_number BETWEEN $2 AND $3
    )
    SELECT count(*)::int AS scanned,
      count(*) FILTER (WHERE admission.present)::int AS admitted,
      count(*) FILTER (WHERE admission.present IS NULL AND tombstone.present)::int AS "withdrawnSinceExport",
      count(*) FILTER (WHERE admission.present IS NULL AND tombstone.present IS NULL AND picked.row_number<=$4)::int AS "missingThroughCursor",
      count(*) FILTER (WHERE admission.present IS NULL AND tombstone.present IS NULL AND picked.row_number>$4)::int AS "missingAfterCursor"
    FROM picked
    LEFT JOIN LATERAL (
      SELECT true AS present FROM public.external_formal_admissions a
      WHERE a.source=picked.source AND a.external_id=picked.external_id LIMIT 1
    ) admission ON true
    LEFT JOIN LATERAL (
      SELECT true AS present FROM public.external_full_snapshots snapshot
      WHERE admission.present IS NULL AND snapshot.id=$1::uuid AND (
        EXISTS (SELECT FROM public.external_ingestion_identity_state w
          WHERE w.provider='chinacarapi' AND w.source=picked.source AND w.external_id=picked.external_id
            AND w.withdrawn AND w.business_at>=snapshot.generated_at)
        OR EXISTS (SELECT FROM public.external_full_members m WHERE m.source=picked.source AND m.external_id=picked.external_id
          AND m.state='withdrawn' AND m.business_at>=snapshot.generated_at)
      ) LIMIT 1
    ) tombstone ON true`,[manifest.snapshot.id,firstRow,lastRow,manifest.snapshot.applyCursor]);
    const {scanned,...counts}=result.rows[0]!;
    if (scanned!==lastRow-firstRow+1) throw new AdmissionAuditUnavailableError('CSV row range is incomplete');
    const chunk=chunkSchema.parse({binding,firstRow,lastRow,counts});
    assertChunk(chunk,binding,firstRow,lastRow,manifest.snapshot.applyCursor);
    return chunk;
  },manifest.source);
}

function chunkName(firstRow: number) {
  return 'rows-'+String(firstRow).padStart(7,'0')+'.json';
}
export async function auditSupplierAdmissionGap(db: Database, input: AuditOptions) {
  const options=AdmissionAuditOptions.parse(input);
  await mkdir(options.checkpoint,{recursive:true,mode:0o700});
  const security=await lstat(options.checkpoint);
  if (!security.isDirectory() || (security.mode&0o077)!==0) throw new AdmissionAuditUnavailableError('Audit checkpoint requires a private directory');
  const filename=path.join(options.checkpoint,'manifest.json');
  const existing=await readPrivateJson(filename);
  const manifest=existing?manifestSchema.parse(JSON.parse(existing)):await readManifest(db,options);
  const manifestText=existing??JSON.stringify(manifest);
  if (manifest.snapshot.id!==options.snapshotId || manifest.restoreReceipt!==options.restoreReceipt || manifest.asOf!==options.restoreAsOf ||
      manifest.source.database!==options.database || manifest.chunkRows!==options.chunkRows) {
    throw new AdmissionAuditUnavailableError('Audit options do not match the existing checkpoint');
  }
  const binding=fileDigest(manifestText);
  await readOnlyView(db,options.database,async()=>undefined,manifest.source);
  if (!existing) await writeCheckpoint(options.checkpoint,'manifest.json',manifestText);

  const priorChunks=new Set((await readdir(options.checkpoint)).filter(entry=>/^rows-\d{7,16}\.json$/.test(entry)));
  const totals={admitted:0,withdrawnSinceExport:0,missingThroughCursor:0,missingAfterCursor:0};
  let scanned=0,ran=0;
  for (let first=1;first<=manifest.snapshot.rows;first+=manifest.chunkRows) {
    const last=Math.min(manifest.snapshot.rows,first+manifest.chunkRows-1);
    const file=chunkName(first);
    const past=priorChunks.delete(file)?await readPrivateJson(path.join(options.checkpoint,file)):undefined;
    if (!past&&ran>=options.maxChunks) break;
    const chunk=past?chunkSchema.parse(JSON.parse(past)):await readChunk(db,manifest,binding,first,last);
    assertChunk(chunk,binding,first,last,manifest.snapshot.applyCursor);
    if (!past) {
      await writeCheckpoint(options.checkpoint,file,JSON.stringify(chunk));
      ran++;
    }
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key]+=chunk.counts[key];
    scanned+=last-first+1;
  }
  if (priorChunks.size!==0) throw new AdmissionAuditUnavailableError('Audit checkpoint has noncontiguous or excess chunks');
  await readOnlyView(db,options.database,async()=>undefined,manifest.source);
  const complete=scanned===manifest.snapshot.rows;
  return {
    complete,manifestDigest:binding,restoreReceipt:manifest.restoreReceipt,snapshot:manifest.snapshot.id,
    csvDigest:manifest.snapshot.digest,snapshotGeneratedAt:manifest.snapshot.generatedAt,asOf:manifest.asOf,rows:manifest.snapshot.rows,
    applyCursor:manifest.snapshot.applyCursor,scanned,remaining:manifest.snapshot.rows-scanned,
    cumulativeAdmissions:manifest.admitted,admissionLimit:manifest.admissionLimit,
    csv:complete?{...totals,eligibleMissing:totals.missingThroughCursor+totals.missingAfterCursor}:null,
    deltas:manifest.deltas,
  };
}
