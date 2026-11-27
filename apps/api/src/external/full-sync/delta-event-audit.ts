import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { jsonHash, sha256 } from '../normalize.js';
import { atExactTime, positiveCny, relistProofBatch, verifyRelistArchiveEvidence, type RelistArchiveEvidence } from './relist-audit-evidence.js';

const eventBatch = 2_000;
const proofBatch = 32;
const compressedEventLimit = 64 * 1024;
const decodedEventLimit = 256 * 1024;

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
  source_type: string;
  applied_at: string | null;
  detail_updated_at: string | null;
  source_updated_at: string | null;
  price_eligible: boolean;
  relist_eligible: boolean;
};
type EventProof = {
  eventId: string;
  source: string;
  externalId: string;
  businessAt: string;
  hash: string;
  documentId: string;
  responseHash: string;
  price: bigint;
} & ({ kind: 'price' } | { kind: 'relisted'; relist: RelistArchiveEvidence });
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function eventProof(event: StaleEvent): EventProof | null {
  if ((!event.price_eligible && !event.relist_eligible) ||
      !Array.isArray(event.document_refs) || event.document_refs.length !== 1) return null;
  const ref = object(event.document_refs[0]);
  if (!ref || typeof ref.id !== 'string' || !z.uuid().safeParse(ref.id).success ||
      ref.eventSequence !== event.event_id || !atExactTime(ref.sourceUpdatedAt, event.business_at) ||
      typeof ref.responseHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.responseHash)) return null;
  const price = positiveCny(event.public_price);
  if (price === null || positiveCny(event.source_price) !== price) return null;
  const identity = { eventId: event.event_id, source: event.source, externalId: event.external_id,
    businessAt: event.business_at, responseHash: ref.responseHash };
  const proof = { ...identity, hash: event.payload_hash, documentId: ref.id, price };
  if (event.price_eligible) return { ...proof, kind: 'price' };
  if (!event.applied_at || !event.detail_updated_at || !event.source_updated_at) return null;
  return { ...proof, kind: 'relisted', relist: {
    ...identity, appliedAt: event.applied_at, detailUpdatedAt: event.detail_updated_at,
    sourceUpdatedAt: event.source_updated_at, eventHash: event.payload_hash, priceCents: price.toString(),
  } };
}

function matchesProviderEvent(proof: EventProof, compressed: Buffer) {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(gunzipSync(compressed, { maxOutputLength: decodedEventLimit }));
    if (sha256(raw) !== proof.hash) return false;
    const event = object(JSON.parse(raw));
    if (!event || jsonHash(event) !== proof.hash || typeof event.id !== 'number' ||
        !Number.isSafeInteger(event.id) || String(event.id) !== proof.eventId ||
        event.source !== proof.source || event.vehicleId !== proof.externalId || event.type !== proof.kind ||
        !atExactTime(event.at, proof.businessAt)) return false;
    const oldPrice = positiveCny(object(event.oldPrice)?.cny);
    const newPrice = positiveCny(object(event.newPrice)?.cny);
    if (oldPrice === null || newPrice !== proof.price) return false;
    // This relist exception covers unchanged prices proved independently by the actual listing records.
    return proof.kind === 'relisted' ? oldPrice === newPrice : oldPrice !== newPrice;
  } catch {
    return false;
  }
}

async function verifyEventDocuments(tx: PoolClient, proofs: EventProof[]) {
  const refs = proofs.map(({ eventId, source, externalId, businessAt, hash, documentId, responseHash }) =>
    ({ eventId, source, externalId, businessAt, hash, documentId, responseHash }));
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
    return compressed !== undefined && matchesProviderEvent(proof, compressed);
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

  // Use the same timestamps and current generation that the worker recorded on successful materialization.
  // A fresh fetch alone does not establish that an old content version was actually relisted.
  const staleEvents = (await tx.query<StaleEvent>(`WITH suspect AS MATERIALIZED (
    SELECT event_id,source,external_id,business_at,source_type,operation,received_at,applied_at,error_code,detail_generation,
      detail_updated_at,public_effective_at,public_outcome,prior_public_price,payload_hash,document_refs,was_public
    FROM external_full_events WHERE event_id>$1 AND event_id<=$2 AND public_outcome IN ('not_public','superseded')
      AND detail_generation IS NOT NULL AND (source_type IN ('new','relisted') OR (source_type='price' AND was_public))
    ), stale AS MATERIALIZED (
    SELECT e.event_id,e.source,e.external_id,e.business_at,e.source_type,e.applied_at,e.detail_updated_at,l.source_updated_at,
      e.payload_hash,e.document_refs,c.price_cny AS public_price,l.id AS listing_id,
      coalesce(e.source_type='price' AND e.operation='upsert' AND e.public_outcome='not_public'
       AND e.applied_at IS NOT NULL AND e.error_code IS NULL AND l.source_updated_at=e.business_at
       AND c.price_cny IS NOT NULL AND c.price_cny=e.prior_public_price
       AND m.event_order=e.event_id AND m.state='active' AND m.last_detail_at IS NOT NULL
       AND m.applied_generation=m.desired_generation AND m.applied_generation>=e.detail_generation,false) AS price_eligible,
      CASE WHEN e.source_type='relisted' AND e.operation='relist' AND e.public_outcome='not_public'
        AND NOT e.was_public AND e.public_effective_at IS NULL AND e.error_code IS NULL
        AND l.source_updated_at<e.business_at AND e.applied_at>=e.received_at
        AND m.state='active' AND NOT m.verification_pending AND m.last_snapshot=$4::uuid
        AND m.event_order=e.event_id AND m.business_at=e.business_at AND m.canonical_id=l.formal_canonical_id
        AND m.desired_generation=e.detail_generation AND m.applied_generation=e.detail_generation
        AND m.locales @> ARRAY['zh','en','ru'] AND cardinality(m.locales)=3
        AND m.last_detail_at BETWEEN e.applied_at AND e.detail_updated_at
        THEN coalesce((
          SELECT earlier.operation='withdraw' AND earlier.business_at<e.business_at AND earlier.applied_at<=e.applied_at
            AND earlier.error_code IS NULL AND earlier.public_outcome IN ('effective','unknown','not_public')
          FROM external_full_events earlier WHERE earlier.source=e.source AND earlier.external_id=e.external_id
            AND earlier.event_id<e.event_id AND (earlier.operation IN ('withdraw','relist') OR earlier.source_type='new')
          ORDER BY earlier.event_id DESC LIMIT 1
        ),false) AND NOT EXISTS (
          SELECT 1 FROM external_full_events later WHERE later.source=e.source AND later.external_id=e.external_id
            AND later.event_id>e.event_id
        ) AND NOT EXISTS (
          SELECT 1 FROM external_ingestion_identity_state t WHERE t.provider='chinacarapi' AND t.source=e.source
            AND t.external_id=e.external_id AND t.withdrawn
        ) ELSE false END AS relist_eligible
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
    ) SELECT s.event_id::text,s.source,s.external_id,s.source_type,s.payload_hash,s.document_refs,s.public_price::text,
      to_char(s.business_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS business_at,
      to_char(s.applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS applied_at,
      to_char(s.detail_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS detail_updated_at,
      to_char(s.source_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at,
      CASE WHEN (s.price_eligible OR s.relist_eligible) AND l.source_data->>'operation'='upsert'
        AND l.source_data->>'platformId'=s.source AND l.source_data->>'externalId'=s.external_id
        THEN l.source_data#>'{price,cny}' END AS source_price,
      s.price_eligible,s.relist_eligible
    FROM stale s JOIN external_listings l ON l.id=s.listing_id ORDER BY s.event_id`,
  [after, through, proofBatch + 1, snapshotId])).rows;
  if (!staleEvents.length) return { status: 'advance', through };
  const proofs: EventProof[] = [];
  const relists: RelistArchiveEvidence[] = [];
  for (const event of staleEvents.slice(0, proofBatch)) {
    if (event.source_type === 'relisted' && relists.length >= relistProofBatch) break;
    const proof = eventProof(event);
    if (!proof) return { status: 'blocked', through: after };
    proofs.push(proof);
    if (proof.kind === 'relisted') relists.push(proof.relist);
  }
  if (!await verifyEventDocuments(tx, proofs) ||
      (relists.length && !await verifyRelistArchiveEvidence(tx, snapshotId, relists))) {
    return { status: 'blocked', through: after };
  }
  // Stop at the last proved event when more evidence would exceed this batch's budget.
  return { status: 'advance', through: staleEvents.length > proofs.length ? proofs.at(-1)!.eventId : through };
}
