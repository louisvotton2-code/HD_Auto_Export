import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { jsonHash } from '../normalize.js';
import { atExactTime, compareRelistCsv, positiveCny, relistProofBatch, verifyRelistArchiveEvidence,
  type ArchivedEventPageEvidence, type HistoricalRelistArchiveEvidence, type RelistArchiveEvidence,
  type RelistCsvSample, type HistoricalCorroboration } from './relist-audit-evidence.js';
import { readSupersededRelistChain } from './relist-history.js';

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
type AuditResult = {
  status: 'advance' | 'waiting' | 'blocked';
  through: string;
  historyCorroboration?: HistoricalCorroboration[];
};
type StoredEvent = {
  event_id: string;
  source: string;
  external_id: string;
  business_at: string;
  payload_hash: string;
  document_refs: unknown;
};
type StaleEvent = StoredEvent & {
  source_type: string;
  public_price: string | null;
  source_price: unknown;
  price_eligible: boolean;
  member_event_id: string;
};
type RelistRequest = { eventId: string; priceEventId: string | null; currentWitness?: true };
type RelistRow = StoredEvent & {
  applied_at: string;
  detail_updated_at: string;
  source_updated_at: string;
  price_event_id: string | null;
  public_price: string | null;
  source_price: unknown;
  csv_lineage: boolean;
  csv_sample: RelistCsvSample | null;
  snapshot_completed_at: string;
  withdrawal_bound: boolean;
  legacy_withdrawal: boolean;
  withdrawal: StoredEvent | null;
};
type EventProof = ArchivedEventPageEvidence & {
  documentId: string;
  price: bigint | null;
  priorPrice?: bigint;
  legacyWithdrawal?: true;
  processedOnly?: true;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function eventProof(event: StoredEvent, kind: EventProof['kind'], price: bigint | null): EventProof | null {
  if (!Array.isArray(event.document_refs) || event.document_refs.length !== 1) return null;
  const ref = object(event.document_refs[0]);
  if (!ref || typeof ref.id !== 'string' || !z.uuid().safeParse(ref.id).success ||
      ref.eventSequence !== event.event_id || !atExactTime(ref.sourceUpdatedAt, event.business_at) ||
      typeof ref.responseHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.responseHash)) return null;
  return { eventId: event.event_id, source: event.source, externalId: event.external_id,
    businessAt: event.business_at, eventHash: event.payload_hash, responseHash: ref.responseHash,
    documentId: ref.id, kind, price };
}

function detailWindow(proof: ArchivedEventPageEvidence, appliedAt: string, detailUpdatedAt: string) {
  const { eventId, source, externalId, kind, businessAt, eventHash, responseHash } = proof;
  return { eventId, source, externalId, kind, businessAt, eventHash, responseHash, appliedAt, detailUpdatedAt };
}

function matchesProviderEvent(proof: EventProof, compressed: Buffer) {
  try {
    const bytes = gunzipSync(compressed, { maxOutputLength: decodedEventLimit });
    if (createHash('sha256').update(bytes).digest('hex') !== proof.eventHash) return false;
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const event = object(JSON.parse(raw));
    if (!event || jsonHash(event) !== proof.eventHash || typeof event.id !== 'number' ||
        !Number.isSafeInteger(event.id) || String(event.id) !== proof.eventId ||
        event.source !== proof.source || event.vehicleId !== proof.externalId || event.type !== proof.kind ||
        !atExactTime(event.at, proof.businessAt)) return false;
    // A historical processed-only receipt does not attest a financial effect.
    if (proof.kind === 'removed' || proof.processedOnly) return true;
    const oldPrice = positiveCny(object(event.oldPrice)?.cny);
    const newPrice = positiveCny(object(event.newPrice)?.cny);
    if (oldPrice === null || newPrice !== proof.price || (proof.priorPrice !== undefined && oldPrice !== proof.priorPrice)) return false;
    // This relist exception covers unchanged prices proved independently by the actual listing records.
    return proof.kind === 'relisted' ? oldPrice === newPrice : oldPrice !== newPrice;
  } catch {
    return false;
  }
}

async function verifyEventDocuments(tx: PoolClient, proofs: EventProof[]): Promise<EventProof[] | null> {
  const refs = proofs.map(({ eventId, source, externalId, businessAt, eventHash, documentId, responseHash, kind, legacyWithdrawal }) =>
    ({ eventId, source, externalId, businessAt, hash: eventHash, documentId, responseHash, kind, legacyWithdrawal }));
  // Retention can delete an applied event's document metadata independently of the blobs.
  // Join by UUID first so an extant but contradictory row never takes the fallback.
  const rows = (await tx.query<{ eventId: string; compressed: Buffer; missingDocument: boolean }>(`SELECT
    q."eventId",b.compressed,d.id IS NULL AS "missingDocument"
    FROM jsonb_to_recordset($1::jsonb) AS q("eventId" text,source text,"externalId" text,"businessAt" timestamptz,
      hash text,"documentId" uuid,"responseHash" text,kind text,"legacyWithdrawal" boolean)
    JOIN external_source_blobs b ON b.hash=q.hash AND octet_length(b.compressed)<=$2
    LEFT JOIN external_source_documents d ON d.id=q."documentId"
    WHERE CASE WHEN d.id IS NULL THEN EXISTS(SELECT 1 FROM external_full_events e
      WHERE e.event_id=q."eventId"::numeric AND e.source=q.source AND e.external_id=q."externalId"
        AND e.business_at=q."businessAt" AND e.payload_hash=q.hash
        AND (e.source_type=q.kind OR (q."legacyWithdrawal" AND q.kind='removed' AND e.source_type IS NULL))
        AND e.operation=CASE q.kind WHEN 'removed' THEN 'withdraw' WHEN 'relisted' THEN 'relist' ELSE 'upsert' END
        AND e.applied_at>=e.received_at AND e.error_code IS NULL
        AND e.document_refs->0->>'id'=q."documentId"::text AND e.document_refs->0->>'responseHash'=q."responseHash")
    ELSE d.hash=q.hash AND d.provider='chinacarapi' AND d.source=q.source AND d.external_id=q."externalId"
      AND d.kind='event' AND d.locale='und' AND d.event_sequence=q."eventId"::numeric AND d.source_updated_at=q."businessAt"
      AND (d.response_hash=q."responseHash" OR EXISTS(SELECT 1 FROM external_source_responses r
        WHERE r.document_id=d.id AND r.response_hash=q."responseHash")) END`,
  [JSON.stringify(refs), compressedEventLimit])).rows;
  const archives = new Map(rows.map(row => [row.eventId, row]));
  const missingDocuments: EventProof[] = [];
  for (const proof of proofs) {
    const archive = archives.get(proof.eventId);
    if (!archive || !matchesProviderEvent(proof, archive.compressed)) return null;
    if (archive.missingDocument || proof.legacyWithdrawal) missingDocuments.push(proof);
  }
  return missingDocuments;
}

/** Bind both standalone relists and the current successor of a historical price to the same lifecycle evidence. */
async function readRelistPaths(tx: PoolClient, snapshotId: string, highWater: string, requests: RelistRequest[]) {
  return (await tx.query<RelistRow>(`SELECT e.event_id::text,e.source,e.external_id,e.payload_hash,e.document_refs,
    q."priceEventId" AS price_event_id,e.business_at<=s.generated_at AND m.last_snapshot=s.id AS csv_lineage,
    coalesce(w.source_type='removed' AND w.detail_generation+1=e.detail_generation,false)
      OR legacy.matches AS withdrawal_bound,legacy.matches AS legacy_withdrawal,
    to_char(s.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS snapshot_completed_at,
    CASE WHEN r.snapshot_id IS NOT NULL THEN jsonb_build_object(
      'source',r.payload->'source','externalId',r.payload->'id','price',r.payload->'price_cny',
      'duplicateOf',r.payload->'duplicate_of','fetchedAt',r.payload->'detail_fetched_at',
      'inBounds',r.row_number BETWEEN 1 AND s.rows
    ) END AS csv_sample,
    to_char(e.business_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS business_at,
    to_char(e.applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS applied_at,
    to_char(e.detail_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS detail_updated_at,
    to_char(l.source_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at,
    c.price_cny::text AS public_price,CASE WHEN l.source_data->>'operation'='upsert'
      AND l.source_data->>'platformId'=e.source AND l.source_data->>'externalId'=e.external_id
      THEN l.source_data#>'{price,cny}' END AS source_price,
    jsonb_build_object(
      'event_id',w.event_id::text,'source',w.source,'external_id',w.external_id,'payload_hash',w.payload_hash,
      'document_refs',w.document_refs,'business_at',to_char(w.business_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) AS withdrawal
    FROM external_full_snapshots s
    CROSS JOIN jsonb_to_recordset($2::jsonb) AS q("eventId" text,"priceEventId" text,"currentWitness" boolean)
    JOIN external_full_events e ON e.event_id=q."eventId"::numeric
    JOIN external_full_members m ON (m.source,m.external_id)=(e.source,e.external_id)
    JOIN external_listings l ON l.provider='chinacarapi' AND (l.platform_id,l.external_id)=(e.source,e.external_id)
    JOIN external_catalog_filter f ON f.listing_id=l.id AND f.active AND f.locale_mask=7
    JOIN external_catalog c ON c.listing_id=l.id
    LEFT JOIN external_full_stage r ON r.snapshot_id=s.id AND r.source=e.source AND r.external_id=e.external_id
    LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    LEFT JOIN external_full_events old ON old.event_id=q."priceEventId"::numeric
      AND (old.source,old.external_id)=(e.source,e.external_id)
    JOIN LATERAL (
      SELECT earlier.* FROM external_full_events earlier WHERE (earlier.source,earlier.external_id)=(e.source,e.external_id)
        AND earlier.event_id<e.event_id AND (earlier.operation IN ('withdraw','relist') OR earlier.source_type='new')
      ORDER BY earlier.event_id DESC LIMIT 1
    ) w ON w.operation='withdraw' AND w.business_at<e.business_at AND w.applied_at BETWEEN w.received_at AND e.applied_at
      AND w.error_code IS NULL AND w.public_outcome IN ('effective','unknown','not_public')
    CROSS JOIN external_full_sync sync
    CROSS JOIN LATERAL (SELECT w.source_type IS NULL AND w.detail_generation IS NULL
      AND w.was_public IS NULL AND w.prior_public_price IS NULL AND w.public_outcome='unknown'
      AND w.public_effective_at IS NULL AND w.detail_updated_at IS NULL
      AND w.received_at<sync.timing_started_at AND w.applied_at<sync.timing_started_at
      AND w.applied_at>=w.business_at AS matches) legacy
    WHERE sync.id=1 AND s.id=$1 AND s.state='complete' AND s.archive_pruned_at IS NULL
      AND s.staged=s.rows AND s.apply_cursor=s.rows AND s.rows>0
      AND s.sha256 ~ '^[a-f0-9]{64}$' AND s.bytes>0 AND s.completed_at IS NOT NULL
      -- A committed relist beyond the audit frontier can explain the current projection.
      AND (e.event_id<=$3::numeric OR ((q."priceEventId" IS NOT NULL OR q."currentWitness")
        AND e.event_id<=(SELECT receive_cursor FROM external_full_sync WHERE id=1)))
      AND e.source_type='relisted' AND e.operation='relist' AND NOT e.was_public
      AND e.error_code IS NULL AND e.applied_at>=e.received_at
      AND ((e.public_outcome='not_public' AND e.public_effective_at IS NULL
        AND (l.source_updated_at<e.business_at OR q."currentWitness"))
        OR (q."currentWitness" AND e.public_outcome='effective' AND e.public_effective_at=e.detail_updated_at
          AND l.source_updated_at>=e.business_at))
      AND l.formal_primary AND l.upstream_state='active' AND NOT coalesce((o.data->>'hidden')::boolean,false)
      AND m.state='active' AND NOT m.verification_pending AND m.event_order=e.event_id
      AND m.business_at=e.business_at AND m.canonical_id=l.formal_canonical_id
      AND m.desired_generation=e.detail_generation AND m.applied_generation=e.detail_generation
      AND m.locales @> ARRAY['zh','en','ru'] AND cardinality(m.locales)=3
      AND m.last_detail_at BETWEEN e.applied_at AND e.detail_updated_at
      AND NOT EXISTS(SELECT 1 FROM external_full_events later WHERE (later.source,later.external_id)=(e.source,e.external_id)
        AND later.event_id>e.event_id)
      AND NOT EXISTS(SELECT 1 FROM external_ingestion_identity_state t WHERE t.provider='chinacarapi'
        AND (t.source,t.external_id)=(e.source,e.external_id) AND t.withdrawn)
      AND (q."priceEventId" IS NULL OR (
        -- The effective withdrawal closes the historical chain inside the audit frontier.
        old.event_id<=$3::numeric AND w.event_id<=$3::numeric
        AND old.source_type='price' AND old.operation='upsert' AND old.was_public AND old.public_outcome='not_public'
        AND old.public_effective_at IS NULL
        AND old.error_code IS NULL AND old.applied_at>=old.received_at
        AND old.detail_updated_at BETWEEN old.applied_at AND w.applied_at
        AND old.event_id<w.event_id AND old.business_at<w.business_at AND old.detail_generation<w.detail_generation
        AND w.source_type='removed' AND w.public_outcome='effective' AND w.was_public
        AND w.public_effective_at BETWEEN w.applied_at AND e.applied_at
        AND w.detail_generation+1=e.detail_generation
        AND l.source_updated_at=old.business_at AND c.price_cny=old.prior_public_price
        AND NOT EXISTS(SELECT 1 FROM external_full_events step WHERE (step.source,step.external_id)=(e.source,e.external_id)
          AND step.event_id>old.event_id AND step.event_id<e.event_id AND step.event_id<>w.event_id)
      ))`, [snapshotId, JSON.stringify(requests), highWater])).rows;
}

async function verifySupersededRelist(tx: PoolClient, snapshotId: string, highWater: string,
  eventId: string, uninterruptedReceipts: boolean) {
  const cycles = await readSupersededRelistChain(tx, eventId, highWater);
  if (!cycles) return null;
  const needsProcessedChain = cycles.some(cycle => cycle.withdrawal.public_outcome !== 'effective' ||
    cycle.prices.some(price => price.public_outcome === 'not_public'));
  if (needsProcessedChain && !uninterruptedReceipts) return null;
  const last = cycles.at(-1)!;
  const [live] = await readRelistPaths(tx, snapshotId, highWater, [{
    eventId: last.relist.event_id, priceEventId: null, currentWitness: true,
  }]);
  if (!live || !live.withdrawal_bound || live.withdrawal?.event_id !== last.withdrawal.event_id) return null;
  const livePrice = positiveCny(live.public_price);
  if (livePrice === null || positiveCny(live.source_price) !== livePrice) return null;

  const documents: EventProof[] = [];
  const history: HistoricalRelistArchiveEvidence[] = [];
  let current: RelistArchiveEvidence | undefined;
  for (const [i, cycle] of cycles.entries()) {
    const next = cycles[i + 1];
    const firstPrice = cycle.prices[0];
    const successor = firstPrice ?? next?.withdrawal;
    const processedRelist = !!next && cycle.relist.public_outcome === 'not_public' &&
      successor?.public_outcome !== 'effective';
    // A historical public quote still needs an independently recorded pre-state.
    const price = !next ? livePrice : successor?.was_public ? positiveCny(successor.prior_public_price) : null;
    if (!processedRelist && price === null) return null;
    const withdrawal = eventProof(cycle.withdrawal, 'removed', null);
    const relist = eventProof(cycle.relist, 'relisted', price);
    if (!withdrawal || !relist || (!processedRelist && compareRelistCsv(live.csv_sample, relist, live.snapshot_completed_at,
      price!, successor?.business_at) === 'conflict')) return null;
    documents.push(cycle.withdrawal.public_outcome === 'unknown' ? { ...withdrawal, legacyWithdrawal: true } : withdrawal,
      processedRelist ? { ...relist, processedOnly: true } : relist);

    const window = { ...detailWindow(relist, cycle.relist.applied_at, cycle.relist.detail_updated_at), kind: 'relisted' as const };
    if (!next) {
      current = { ...window, priceCents: livePrice.toString(), sourceUpdatedAt: live.source_updated_at };
      continue;
    }
    const nextWithdrawal = next.withdrawal;
    const processedWitness = { kind: 'processed' as const, eventId: nextWithdrawal.event_id };
    if (processedRelist) {
      history.push({ ...window, priceCents: null, outcome: 'not_public', witness: processedWitness });
    } else {
      // A not_public price may show the previous quote, but is no witness of a price change.
      if (firstPrice?.public_outcome === 'not_public' &&
          BigInt(firstPrice.generation) !== BigInt(cycle.relist.generation) + 1n) return null;
      const requiresLinkedReceipts = !firstPrice && cycle.relist.public_outcome === 'not_public' &&
        BigInt(nextWithdrawal.generation!) > BigInt(cycle.relist.generation) + 1n;
      if (requiresLinkedReceipts && !uninterruptedReceipts) return null;
      const witness = firstPrice?.public_outcome === 'effective' ? { kind: 'price' as const, eventId: firstPrice.event_id }
        : !firstPrice && uninterruptedReceipts
          ? { kind: 'withdrawal' as const, eventId: nextWithdrawal.event_id, requiresLinkedReceipts } : undefined;
      history.push({ ...window, priceCents: price!.toString(), outcome: cycle.relist.public_outcome, witness });
    }
    for (const [index, change] of cycle.prices.entries()) {
      if (change.public_outcome === 'not_public') {
        const proof = eventProof(change, 'price', null);
        if (!proof) return null;
        documents.push({ ...proof, processedOnly: true });
        history.push({ ...detailWindow(proof, change.applied_at, change.detail_updated_at), kind: 'price',
          priceCents: null, outcome: 'not_public', witness: processedWitness });
        continue;
      }
      const following = cycle.prices[index + 1] ?? nextWithdrawal;
      const oldPrice = positiveCny(change.prior_public_price);
      const newPrice = following.was_public ? positiveCny(following.prior_public_price) : null;
      if (oldPrice === null || newPrice === null || oldPrice === newPrice ||
          BigInt(following.generation!) !== BigInt(change.generation) + 1n) return null;
      const proof = eventProof(change, 'price', newPrice);
      if (!proof || compareRelistCsv(live.csv_sample, proof, live.snapshot_completed_at,
        newPrice, following.business_at) === 'conflict') return null;
      documents.push({ ...proof, priorPrice: oldPrice });
    }

  }
  const missingDocuments = await verifyEventDocuments(tx, documents);
  if (!current || missingDocuments === null) return null;
  const processedChain = needsProcessedChain ? documents.slice(1) : [];
  if (processedChain.length && !missingDocuments.some(proof => proof.eventId === documents[0]!.eventId)) {
    missingDocuments.push(documents[0]!);
  }
  const proof = await verifyRelistArchiveEvidence(tx, [current], documents, missingDocuments, history,
    needsProcessedChain ? { chain: processedChain, frontier: highWater } : undefined);
  if (!proof || !needsProcessedChain) return proof;
  const processedEventIds = cycles.flatMap(cycle => [cycle.withdrawal, cycle.relist, ...cycle.prices])
    .filter(event => event.public_outcome === 'not_public' && event.event_id !== last.relist.event_id &&
      BigInt(event.event_id) >= BigInt(eventId) && BigInt(event.event_id) <= BigInt(highWater))
    .map(event => event.event_id);
  return { historyCorroboration: proof.historyCorroboration.map(item =>
    'scope' in item && item.scope === 'processed_publication_unconfirmed' ? { ...item, processedEventIds } : item) };
}

async function auditHistoricalEvent(tx: PoolClient, audit: EventAudit, eventId: string): Promise<AuditResult | null> {
  const proof = await verifySupersededRelist(tx, audit.snapshotId, audit.highWater, eventId,
    audit.recoveryAnchorCursor === null && audit.recoveryPreviousCursor === null);
  if (!proof) return null;
  const historyCorroboration = proof.historyCorroboration.filter(item => item.eventId === eventId);
  return { status: 'advance', through: eventId, ...(historyCorroboration.length ? { historyCorroboration } : {}) };
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
    SELECT e.event_id,e.source,e.external_id,e.business_at,e.source_type,e.payload_hash,e.document_refs,
      c.price_cny AS public_price,l.id AS listing_id,m.event_order,
      coalesce(e.source_type='price' AND e.operation='upsert' AND e.public_outcome='not_public'
       AND e.applied_at IS NOT NULL AND e.error_code IS NULL AND l.source_updated_at=e.business_at
       AND c.price_cny IS NOT NULL AND c.price_cny=e.prior_public_price
       AND m.state='active' AND m.last_detail_at IS NOT NULL
       AND m.applied_generation=m.desired_generation AND m.applied_generation>=e.detail_generation,false) AS price_eligible
    FROM suspect e
    JOIN external_full_members m ON m.source=e.source AND m.external_id=e.external_id AND m.event_order>=e.event_id
    JOIN external_listings l ON l.provider='chinacarapi' AND l.platform_id=e.source AND l.external_id=e.external_id
    JOIN external_catalog_filter f ON f.listing_id=l.id AND f.active AND f.locale_mask=7
    JOIN external_catalog c ON c.listing_id=l.id
    LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    WHERE l.formal_primary AND l.upstream_state='active' AND NOT coalesce((o.data->>'hidden')::boolean,false)
     AND (l.source_updated_at IS NULL OR l.source_updated_at<e.business_at OR
      (e.source_type='relisted' AND e.public_outcome='not_public' AND m.event_order>e.event_id
        AND EXISTS(SELECT 1 FROM external_full_events successor WHERE successor.event_id=m.event_order
          AND successor.operation='relist')) OR
      (e.source_type='price' AND l.source_updated_at=e.business_at AND (
        c.price_cny IS NOT DISTINCT FROM e.prior_public_price OR (e.public_outcome='not_public' AND m.event_order>e.event_id
          AND EXISTS(SELECT 1 FROM external_full_events successor WHERE successor.event_id=m.event_order
            AND successor.operation='relist')))))
    ORDER BY e.event_id LIMIT $3
    ) SELECT s.event_id::text,s.source,s.external_id,s.source_type,s.payload_hash,s.document_refs,s.public_price::text,
      s.event_order::text AS member_event_id,
      to_char(s.business_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS business_at,
      CASE WHEN s.price_eligible AND l.source_data->>'operation'='upsert'
        AND l.source_data->>'platformId'=s.source AND l.source_data->>'externalId'=s.external_id
        THEN l.source_data#>'{price,cny}' END AS source_price,s.price_eligible
    FROM stale s JOIN external_listings l ON l.id=s.listing_id ORDER BY s.event_id`,
  [after, through, proofBatch + 1])).rows;
  if (!staleEvents.length) return { status: 'advance', through };

  const documents = new Map<string, EventProof>();
  const requests: RelistRequest[] = [];
  const related = new Map<string, ArchivedEventPageEvidence>();
  const relists = new Map<string, RelistArchiveEvidence>();
  let checked = 0;
  for (const event of staleEvents.slice(0, proofBatch)) {
    const historical = event.member_event_id !== event.event_id;
    if (historical && (event.source_type === 'relisted' || event.source_type === 'price')) {
      // Finish any ordinary prefix before a single historical event that may need a chain.
      if (checked > 0) break;
      if (event.source_type === 'relisted' || !event.price_eligible) {
        return await auditHistoricalEvent(tx, audit, event.event_id) ?? { status: 'blocked', through: after };
      }
    }
    const needsRelist = event.source_type==='relisted' || event.member_event_id!==event.event_id;
    if (needsRelist && requests.length>=relistProofBatch) break;
    if (event.source_type==='relisted') {
      requests.push({ eventId: event.event_id, priceEventId: null });
    } else {
      const price = positiveCny(event.public_price);
      if (!event.price_eligible || price===null || positiveCny(event.source_price)!==price) {
        return { status: 'blocked', through: after };
      }
      const proof = eventProof(event,'price',price);
      if (!proof) return { status: 'blocked', through: after };
      documents.set(proof.eventId, proof);
      if (needsRelist) {
        requests.push({ eventId: event.member_event_id, priceEventId: proof.eventId });
        related.set(proof.eventId, proof);
      }
    }
    checked++;
    if (historical && event.source_type === 'price') break;
  }
  if (requests.length) {
    const paths = await readRelistPaths(tx,snapshotId,highWater,requests);
    if (paths.length!==requests.length) {
      const first = staleEvents[0]!;
      if (first.source_type === 'price' && first.member_event_id !== first.event_id &&
          !paths.some(path => path.price_event_id === first.event_id)) {
        return await auditHistoricalEvent(tx, audit, first.event_id) ?? { status: 'blocked', through: after };
      }
      return { status: 'blocked', through: after };
    }
    for (const path of paths) {
      const price = positiveCny(path.public_price);
      const historical = path.price_event_id===null ? undefined : documents.get(path.price_event_id);
      if (price===null || positiveCny(path.source_price)!==price || (path.price_event_id!==null && historical?.price!==price)) {
        return { status: 'blocked', through: after };
      }
      const relist = eventProof(path,'relisted',price);
      if (!relist) return { status: 'blocked', through: after };
      const csv = compareRelistCsv(path.csv_sample,relist,path.snapshot_completed_at,price);
      if (csv==='conflict') return { status: 'blocked', through: after };
      // The complete withdrawal-to-relist chain can prove either side of the export anchor.
      const useCsv = !historical && path.csv_lineage && csv==='corroborated';
      const withdrawal = !useCsv && path.withdrawal_bound && path.withdrawal && eventProof(path.withdrawal,'removed',null);
      if (!useCsv && !withdrawal) return { status: 'blocked', through: after };
      documents.set(relist.eventId,relist);
      relists.set(relist.eventId,{
        eventId: relist.eventId, source: relist.source, externalId: relist.externalId, kind: 'relisted',
        businessAt: relist.businessAt, eventHash: relist.eventHash, responseHash: relist.responseHash,
        appliedAt: path.applied_at, detailUpdatedAt: path.detail_updated_at, sourceUpdatedAt: path.source_updated_at,
        priceCents: price.toString(),
      });
      if (withdrawal) {
        const proof = path.legacy_withdrawal ? { ...withdrawal, legacyWithdrawal: true as const } : withdrawal;
        documents.set(withdrawal.eventId,proof);
        related.set(withdrawal.eventId,proof);
      }
    }
  }
  const missingDocuments = await verifyEventDocuments(tx,[...documents.values()]);
  if (missingDocuments === null || ((relists.size || missingDocuments.length) &&
      !await verifyRelistArchiveEvidence(tx,[...relists.values()],[...related.values()],missingDocuments))) {
    return { status: 'blocked', through: after };
  }
  // Stop at the last proved event when more evidence would exceed this batch's budget.
  return { status: 'advance', through: staleEvents.length>checked ? staleEvents[checked-1]!.event_id : through };
}
