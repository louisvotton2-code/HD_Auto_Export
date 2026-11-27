import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { MoneySchema } from '@hd/contracts/public';
import { jsonHash, sha256 } from '../normalize.js';

const eventBatch = 2_000;
const priceProofBatch = 32;
const compressedEventLimit = 64 * 1024;
const decodedEventLimit = 256 * 1024;
const eventTime = z.iso.datetime({ offset: true });

type EventAudit = {
  snapshotId: string;
  generatedAt: Date;
  after: string;
  highWater: string;
  recoveryAnchorCursor: string | null;
  recoveryPreviousCursor: string | null;
};
type AuditResult = { status: 'advance' | 'waiting' | 'blocked'; through: string };
type StaleEvent = {
  event_id: string;
  source: string;
  external_id: string;
  business_at: string;
  payload_hash: string;
  document_refs: unknown;
  public_price: string | null;
  source_price: unknown;
  proof_eligible: boolean;
};
type PriceProof = {
  eventId: string;
  source: string;
  externalId: string;
  businessAt: string;
  hash: string;
  documentId: string;
  responseHash: string;
  price: bigint;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function positiveCny(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isInteger(value) && value > Number.MAX_SAFE_INTEGER / 100) return null;
  const amount = MoneySchema.shape.amount.safeParse(String(value));
  if (!amount.success) return null;
  const [whole, fraction = ''] = amount.data.split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n ? cents : null;
}

function atExactTime(value: unknown, databaseTime: string) {
  if (typeof value !== 'string' || !eventTime.safeParse(value).success) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  // PostgreSQL preserves six fractional digits. Date alone loses evidence below milliseconds.
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  if (/[1-9]/.test(fraction.slice(6))) return false;
  const seconds = new Date(parsed).toISOString().slice(0, -5);
  return `${seconds}.${fraction.slice(0, 6).padEnd(6, '0')}Z` === databaseTime;
}

function priceProof(event: StaleEvent): PriceProof | null {
  if (!event.proof_eligible || !Array.isArray(event.document_refs) || event.document_refs.length !== 1) return null;
  const ref = object(event.document_refs[0]);
  if (!ref || typeof ref.id !== 'string' || !z.uuid().safeParse(ref.id).success ||
      ref.eventSequence !== event.event_id || !atExactTime(ref.sourceUpdatedAt, event.business_at) ||
      typeof ref.responseHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.responseHash)) return null;
  const price = positiveCny(event.public_price);
  if (price === null || positiveCny(event.source_price) !== price) return null;
  return { eventId: event.event_id, source: event.source, externalId: event.external_id,
    businessAt: event.business_at, hash: event.payload_hash, documentId: ref.id, responseHash: ref.responseHash, price };
}

function matchesProviderPriceChange(proof: PriceProof, compressed: Buffer) {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(gunzipSync(compressed, { maxOutputLength: decodedEventLimit }));
    if (sha256(raw) !== proof.hash) return false;
    const event = object(JSON.parse(raw));
    if (!event || jsonHash(event) !== proof.hash || typeof event.id !== 'number' ||
        !Number.isSafeInteger(event.id) || String(event.id) !== proof.eventId ||
        event.source !== proof.source || event.vehicleId !== proof.externalId || event.type !== 'price' ||
        !atExactTime(event.at, proof.businessAt)) return false;
    const oldPrice = positiveCny(object(event.oldPrice)?.cny);
    const newPrice = positiveCny(object(event.newPrice)?.cny);
    return oldPrice !== null && newPrice === proof.price && oldPrice !== newPrice;
  } catch {
    return false;
  }
}

async function verifyPriceChanges(tx: PoolClient, proofs: PriceProof[]) {
  const refs = proofs.map(({ price: _price, ...ref }) => ref);
  const rows = (await tx.query<{ eventId: string; compressed: Buffer }>(`SELECT q."eventId",b.compressed
    FROM jsonb_to_recordset($1::jsonb) AS q("eventId" text,source text,"externalId" text,"businessAt" timestamptz,
      hash text,"documentId" uuid,"responseHash" text)
    JOIN external_source_documents d ON d.id=q."documentId" AND d.hash=q.hash AND d.provider='chinacarapi'
      AND d.source=q.source AND d.external_id=q."externalId" AND d.kind='event' AND d.locale='und'
      AND d.event_sequence=q."eventId"::numeric AND d.source_updated_at=q."businessAt"
      AND (d.response_hash=q."responseHash" OR EXISTS(SELECT 1 FROM external_source_responses r
        WHERE r.document_id=d.id AND r.response_hash=q."responseHash"))
    JOIN external_source_blobs b ON b.hash=d.hash AND octet_length(b.compressed)<=$2`,
  [JSON.stringify(refs), compressedEventLimit])).rows;
  const bytes = new Map(rows.map(row => [row.eventId, row.compressed]));
  return proofs.every(proof => {
    const compressed = bytes.get(proof.eventId);
    return compressed !== undefined && matchesProviderPriceChange(proof, compressed);
  });
}

/** Audit one bounded range under the caller's worker/sync lock. The cursor changes only for proven events. */
export async function checkDeltaEventAudit(tx: PoolClient, audit: EventAudit): Promise<AuditResult> {
  const { after, highWater, recoveryAnchorCursor, recoveryPreviousCursor, snapshotId, generatedAt } = audit;
  const through = (await tx.query<{ cursor: string }>(`SELECT
    (CASE WHEN count(*)<$3 THEN $2::numeric ELSE max(event_id) END)::text AS cursor FROM (
     SELECT event_id FROM external_full_events WHERE event_id>$1 AND event_id<=$2 ORDER BY event_id LIMIT $3
    ) boundary`, [after, highWater, eventBatch])).rows[0]!.cursor;
  const work = (await tx.query<{ unapplied: boolean; detail_pending: boolean; detail_unresolved: boolean }>(`WITH owed AS MATERIALIZED (
    SELECT e.source,e.external_id,coalesce(m.desired_generation,e.detail_generation) AS generation
    FROM external_full_events e
    LEFT JOIN external_full_members m ON m.source=e.source AND m.external_id=e.external_id
    WHERE e.applied_at IS NOT NULL AND e.event_id>$1 AND e.event_id<=$2 AND (
     e.public_outcome='pending' OR
     (e.operation<>'withdraw' AND e.detail_generation IS NOT NULL
       AND e.public_outcome='superseded' AND coalesce(m.state<>'withdrawn',true)
       AND coalesce(m.applied_generation<e.detail_generation,true)))
    ) SELECT
    EXISTS(SELECT 1 FROM external_full_events WHERE applied_at IS NULL AND event_id>$1 AND event_id<=$2) AS unapplied,
    EXISTS(SELECT 1 FROM owed) AS detail_pending,
    EXISTS(SELECT 1 FROM owed o WHERE NOT EXISTS(SELECT 1 FROM external_full_work w
     WHERE w.source=o.source AND w.external_id=o.external_id AND w.kind='detail' AND w.generation=o.generation
       AND w.attempts<5)) AS detail_unresolved`, [after, through])).rows[0]!;
  if (work.detail_unresolved) return { status: 'blocked', through: after };
  if (work.unapplied || work.detail_pending) return { status: 'waiting', through: after };

  // An older removal cannot be waived merely because a later price event was applied.
  const conflictingWithdrawal = recoveryAnchorCursor !== null && (await tx.query<{ missing: boolean }>(`SELECT EXISTS(
    SELECT 1 FROM external_full_events e
    JOIN external_full_members m ON m.source=e.source AND m.external_id=e.external_id
    JOIN external_listings l ON l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
    JOIN external_catalog_filter f ON f.listing_id=l.id AND f.active AND f.locale_mask<>0
    LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    WHERE e.event_id>greatest($1::numeric,$5::numeric) AND e.event_id<=least($2::numeric,$6::numeric)
     AND e.operation='withdraw' AND e.public_outcome='superseded'
     AND l.formal_primary AND l.upstream_state='active' AND NOT coalesce((o.data->>'hidden')::boolean,false)
     AND NOT EXISTS(SELECT 1 FROM external_full_events relist WHERE relist.source=e.source AND relist.external_id=e.external_id
      AND relist.event_id>e.event_id AND relist.business_at>=e.business_at AND relist.operation='relist'
      AND relist.applied_at IS NOT NULL AND relist.error_code IS NULL AND m.applied_generation>=relist.detail_generation
      AND l.source_updated_at>=relist.business_at)
     AND NOT ($4::timestamptz>=e.business_at AND coalesce(l.source_updated_at>=e.business_at,false)
      AND EXISTS(SELECT 1 FROM external_full_stage csv WHERE csv.snapshot_id=$3 AND csv.source=e.source AND csv.external_id=e.external_id))
    ) AS missing`, [recoveryAnchorCursor, recoveryPreviousCursor, snapshotId, generatedAt, after, through])).rows[0]!.missing;
  if (conflictingWithdrawal) return { status: 'blocked', through: after };

  const staleEvents = (await tx.query<StaleEvent>(`WITH suspect AS MATERIALIZED (
    SELECT event_id,source,external_id,business_at,source_type,operation,applied_at,error_code,detail_generation,
      public_outcome,prior_public_price,payload_hash,document_refs
    FROM external_full_events WHERE event_id>$1 AND event_id<=$2 AND public_outcome IN ('not_public','superseded')
      AND detail_generation IS NOT NULL AND (source_type IN ('new','relisted') OR (source_type='price' AND was_public))
    ), stale AS MATERIALIZED (
    SELECT e.event_id,e.source,e.external_id,e.business_at,e.payload_hash,e.document_refs,c.price_cny AS public_price,l.id AS listing_id,
      coalesce(e.source_type='price' AND e.operation='upsert' AND e.public_outcome='not_public'
       AND e.applied_at IS NOT NULL AND e.error_code IS NULL AND l.source_updated_at=e.business_at
       AND c.price_cny IS NOT NULL AND c.price_cny=e.prior_public_price
       AND m.event_order=e.event_id AND m.state='active' AND m.last_detail_at IS NOT NULL
       AND m.applied_generation=m.desired_generation AND m.applied_generation>=e.detail_generation,false) AS proof_eligible
    FROM suspect e
    JOIN external_full_members m ON m.source=e.source AND m.external_id=e.external_id AND m.event_order>=e.event_id
    JOIN external_listings l ON l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
    JOIN external_catalog_filter f ON f.listing_id=l.id AND f.active AND f.locale_mask=7
    JOIN external_catalog c ON c.listing_id=l.id
    LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    WHERE l.formal_primary AND l.upstream_state='active' AND NOT coalesce((o.data->>'hidden')::boolean,false)
     AND (l.source_updated_at IS NULL OR l.source_updated_at<e.business_at OR
      (e.source_type='price' AND l.source_updated_at=e.business_at AND c.price_cny IS NOT DISTINCT FROM e.prior_public_price))
    ORDER BY e.event_id LIMIT $3
    ) SELECT s.event_id::text,s.source,s.external_id,s.payload_hash,s.document_refs,s.public_price::text,
      to_char(s.business_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS business_at,
      CASE WHEN s.proof_eligible AND l.source_data->>'operation'='upsert' AND l.source_data->>'platformId'=s.source
        AND l.source_data->>'externalId'=s.external_id THEN l.source_data#>'{price,cny}' END AS source_price,
      s.proof_eligible
    FROM stale s JOIN external_listings l ON l.id=s.listing_id ORDER BY s.event_id`,
  [after, through, priceProofBatch + 1])).rows;
  if (!staleEvents.length) return { status: 'advance', through };
  const proofs: PriceProof[] = [];
  for (const event of staleEvents.slice(0, priceProofBatch)) {
    const proof = priceProof(event);
    if (!proof) return { status: 'blocked', through: after };
    proofs.push(proof);
  }
  if (!await verifyPriceChanges(tx, proofs)) return { status: 'blocked', through: after };
  // A later unexamined row stays ahead of the checkpoint, even if this pricing path could clear it.
  return { status: 'advance', through: staleEvents.length > priceProofBatch ? proofs.at(-1)!.eventId : through };
}
