import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { MoneySchema } from '@hd/contracts/public';
import { jsonHash } from '../normalize.js';
import { LIMITS } from './types.js';
import { relistHistoryCycles, relistHistoryEventLimit } from './relist-history.js';

export type ArchivedEventPageEvidence = {
  eventId: string;
  source: string;
  externalId: string;
  businessAt: string;
  eventHash: string;
  responseHash: string;
  kind: 'price' | 'relisted' | 'removed';
};

type RelistDetailWindow = ArchivedEventPageEvidence & {
  kind: 'relisted';
  appliedAt: string;
  detailUpdatedAt: string;
  priceCents: string;
};

export type RelistArchiveEvidence = RelistDetailWindow & { sourceUpdatedAt: string };
type HistoricalWitness = { kind: 'price'; eventId: string } |
  { kind: 'withdrawal'; eventId: string; requiresLinkedReceipts: boolean };
export type HistoricalRelistArchiveEvidence = (RelistDetailWindow & {
  outcome: 'effective' | 'not_public';
  witness?: HistoricalWitness;
}) | (ArchivedEventPageEvidence & {
  kind: 'relisted' | 'price';
  appliedAt: string;
  detailUpdatedAt: string;
  priceCents: null;
  outcome: 'not_public';
  witness: { kind: 'processed'; eventId: string };
});

export type RelistCsvSample = {
  source: unknown;
  externalId: unknown;
  price: unknown;
  duplicateOf: unknown;
  fetchedAt: unknown;
  inBounds: boolean;
};

const eventTime = z.iso.datetime({ offset: true });
const hashPattern = /^[a-f0-9]{64}$/;
const locales = ['en', 'ru', 'zh'] as const;
export type HistoricalCorroboration = {
  eventId: string;
  unavailableLocales: (typeof locales)[number][];
} & ({ priceEventId: string } | { withdrawalEventId: string; scope: 'public_before_withdrawal' } |
  { supersededByEventId: string; scope: 'processed_publication_unconfirmed'; processedEventIds?: string[] });
export const relistProofBatch = 8;
const relatedEventLimit = 32;
const relatedEventsPerRelist = 2;
const historyDocumentLimit = 32;
const historyReceiptLinkLimit = 768;
const compressedPageLimit = 256 * 1024;
const compressedDetailLimit = 128 * 1024;
const decodedPageLimit = 4 * 1024 * 1024;
const decodedDetailLimit = 1024 * 1024;
const decodedBatchLimit = 24 * 1024 * 1024;
type DecodeBudget = { remaining: number };
type CompletedPage = { cursor: string; nextCursor: string; eventCount: number };
type WithdrawalInterval = { relist: ArchivedEventPageEvidence; withdrawal: ArchivedEventPageEvidence };
type ReceiptRange = { eventId: string; start: string; end: string; checkpoints?: string[] };

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function positiveCny(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isInteger(value) && value > Number.MAX_SAFE_INTEGER / 100) return null;
  const amount = MoneySchema.shape.amount.safeParse(String(value));
  if (!amount.success) return null;
  const [whole, fraction = ''] = amount.data.split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n ? cents : null;
}

function exactTime(value: unknown): string | null {
  if (typeof value !== 'string' || !eventTime.safeParse(value).success) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  // PostgreSQL preserves six fractional digits. Date alone loses evidence below milliseconds.
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  if (/[1-9]/.test(fraction.slice(6))) return null;
  const seconds = new Date(parsed).toISOString().slice(0, -5);
  return /^\d{4}-/.test(seconds) && !seconds.startsWith('0000-')
    ? `${seconds}.${fraction.slice(0, 6).padEnd(6, '0')}Z` : null;
}

export function atExactTime(value: unknown, databaseTime: string): boolean {
  const exact = exactTime(value);
  return exact !== null && exact === databaseTime;
}

function normalizeEventPage<T extends ArchivedEventPageEvidence>(proof: T): T | null {
  const businessAt = exactTime(proof.businessAt);
  if (!businessAt || !/^[1-9][0-9]{0,15}$/.test(proof.eventId) || !Number.isSafeInteger(Number(proof.eventId)) ||
      (proof.source !== 'che168' && proof.source !== 'dongchedi') || !/^\d{1,100}$/.test(proof.externalId) ||
      !hashPattern.test(proof.eventHash) || !hashPattern.test(proof.responseHash) ||
      (proof.kind !== 'price' && proof.kind !== 'relisted' && proof.kind !== 'removed')) return null;
  return { ...proof, businessAt };
}

function normalizeWindow<T extends RelistDetailWindow | HistoricalRelistArchiveEvidence>(value: T): T | null {
  const proof = normalizeEventPage(value);
  if (!proof || (proof.kind !== 'relisted' && !(proof.kind === 'price' && proof.priceCents === null))) return null;
  const appliedAt = exactTime(proof.appliedAt);
  const detailUpdatedAt = exactTime(proof.detailUpdatedAt);
  if (!appliedAt || !detailUpdatedAt ||
      proof.businessAt > appliedAt || appliedAt > detailUpdatedAt ||
      (proof.priceCents !== null && !/^[1-9][0-9]{0,15}$/.test(proof.priceCents))) return null;
  return { ...proof, appliedAt, detailUpdatedAt };
}

function normalizeProof(value: RelistArchiveEvidence): RelistArchiveEvidence | null {
  const proof = normalizeWindow(value);
  const sourceUpdatedAt = exactTime(value.sourceUpdatedAt);
  return proof && sourceUpdatedAt ? { ...proof, sourceUpdatedAt } : null;
}

function decodeArchive(compressed: Buffer, hash: string, maxOutputLength: number, budget: DecodeBudget) {
  const limit = Math.min(maxOutputLength, budget.remaining);
  if (limit < 1) return null;
  try {
    const bytes = gunzipSync(compressed, { maxOutputLength: limit });
    budget.remaining -= bytes.length;
    if (createHash('sha256').update(bytes).digest('hex') !== hash) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return object(JSON.parse(text));
  } catch {
    return null;
  }
}

export function compareRelistCsv(sample: RelistCsvSample | null, proof: ArchivedEventPageEvidence,
  snapshotCompletedAt: string, price: bigint, supersededAt?: string): 'corroborated' | 'unavailable' | 'conflict' {
  if (!sample) return 'unavailable';
  if (!sample.inBounds || sample.source !== proof.source || sample.externalId !== proof.externalId) return 'conflict';
  if (sample.fetchedAt === '') return 'unavailable';
  const fetched = exactTime(sample.fetchedAt);
  const event = exactTime(proof.businessAt);
  const completed = exactTime(snapshotCompletedAt);
  if (!fetched || !event || !completed || fetched > completed) return 'conflict';
  if (supersededAt) {
    const end = exactTime(supersededAt);
    if (!end || end <= event) return 'conflict';
    if (fetched >= end) return 'unavailable';
  }
  // The supplier sampled a source listing. Local materialization time only binds the three detail heads.
  if (fetched < event) return 'unavailable';
  if (sample.duplicateOf !== '' || positiveCny(sample.price) !== price) return 'conflict';
  return fetched > event ? 'corroborated' : 'unavailable';
}

function completedPage(page: Record<string, unknown>, ids: Iterable<string>): CompletedPage | null {
  const { cursor, nextCursor, hasMore } = page;
  if (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < 0 ||
      typeof nextCursor !== 'number' || !Number.isSafeInteger(nextCursor) || nextCursor <= cursor ||
      typeof hasMore !== 'boolean') return null;
  let last = cursor;
  let eventCount = 0;
  for (const id of ids) {
    const current = Number(id);
    if (current <= last || current > nextCursor) return null;
    last = current;
    eventCount++;
  }
  return { cursor: String(cursor), nextCursor: String(nextCursor), eventCount };
}

async function verifyLinkedReceipts(tx: PoolClient, intervals: readonly WithdrawalInterval[],
  responses: ReadonlyMap<string, CompletedPage>, chain: readonly ArchivedEventPageEvidence[], frontier?: string) {
  const ranges: ReceiptRange[] = [];
  for (const { relist, withdrawal } of intervals) {
    const left = responses.get(relist.responseHash);
    const right = responses.get(withdrawal.responseHash);
    if (!left || !right) return false;
    if (relist.responseHash === withdrawal.responseHash) continue;
    if (BigInt(left.nextCursor) > BigInt(right.cursor)) return false;
    ranges.push({ eventId: relist.eventId, start: left.nextCursor, end: right.cursor });
  }
  if (chain.length) {
    const checkpoints: string[] = [];
    let previous: CompletedPage | undefined;
    for (const event of chain) {
      const page = responses.get(event.responseHash);
      if (!page) return false;
      if (page === previous) continue;
      if (previous && BigInt(page.cursor) < BigInt(previous.nextCursor)) return false;
      checkpoints.push(page.cursor);
      previous = page;
    }
    const start = checkpoints[0]!, end = previous!.nextCursor;
    if (frontier && BigInt(frontier) > BigInt(start) && BigInt(frontier) < BigInt(end)) checkpoints.push(frontier);
    ranges.push({ eventId: chain[0]!.eventId, start, end, checkpoints });
  }
  if (!ranges.length) return true;
  // Receipts are committed after all rows on that page. Follow cursor keys between verified originals.
  // Interior pages need only indexed receipt reads, under a fixed hop limit.
  return (await tx.query<{ matched: boolean }>(`WITH RECURSIVE bounds AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS q("eventId" text,start numeric,"end" numeric,checkpoints numeric[])
  ), walk AS (
    SELECT "eventId",start AS cursor,"end",0 AS hops FROM bounds
    UNION ALL
    SELECT w."eventId",r.next_cursor,w."end",w.hops+1 FROM walk w
    JOIN LATERAL (
      SELECT r.next_cursor FROM external_full_receipts r WHERE r.cursor_key='cursor:'||w.cursor::text
        AND r.complete AND r.event_count BETWEEN 0 AND $3 AND r.next_cursor>w.cursor AND r.next_cursor<=w."end"
      LIMIT 1
    ) r ON true
    WHERE w.cursor<w."end" AND w.hops<$2
  ) SELECT NOT EXISTS(SELECT 1 FROM bounds b CROSS JOIN LATERAL
    unnest(array_append(coalesce(b.checkpoints,ARRAY[]::numeric[]),b."end")) required(cursor)
    WHERE NOT EXISTS(SELECT 1 FROM walk w WHERE w."eventId"=b."eventId" AND w.cursor=required.cursor)) AS matched`,
  [JSON.stringify(ranges), historyReceiptLinkLimit, LIMITS.events])).rows[0]?.matched === true;
}

async function verifyPages(tx: PoolClient, proofs: ReadonlyMap<string, ArchivedEventPageEvidence>,
  missingDocuments: ReadonlySet<string>, budget: DecodeBudget, intervals: readonly WithdrawalInterval[],
  chain: readonly ArchivedEventPageEvidence[], frontier?: string) {
  const pages = new Map<string, ArchivedEventPageEvidence[]>();
  for (const proof of proofs.values()) {
    const expected = pages.get(proof.responseHash);
    if (expected) expected.push(proof);
    else pages.set(proof.responseHash, [proof]);
  }
  const blobs = (await tx.query<{ hash: string; compressed: Buffer }>(`SELECT hash,compressed
    FROM external_source_blobs WHERE hash=ANY($1::text[]) AND raw_exact AND octet_length(compressed)<=$2`,
  [[...pages.keys()], compressedPageLimit])).rows;
  if (blobs.length !== pages.size) return false;
  const requiredResponses = new Set(intervals.flatMap(({ relist, withdrawal }) => [relist.responseHash, withdrawal.responseHash]));
  for (const item of chain) requiredResponses.add(item.responseHash);
  const chainIds = new Set(chain.map(item => item.eventId));
  const first = chain[0];
  const last = chain.at(-1);
  const completed = new Map<string, CompletedPage>();
  for (const blob of blobs) {
    const page = decodeArchive(blob.compressed, blob.hash, decodedPageLimit, budget);
    const expected = pages.get(blob.hash);
    if (!expected || !page || !Array.isArray(page.changes) || page.changes.length > LIMITS.events) return false;
    // A page is decoded once. A second occurrence of an event ID is ambiguous.
    const byId = new Map<string, Record<string, unknown>>();
    for (const raw of page.changes) {
      const event = object(raw);
      if (!event || typeof event.id !== 'number' || !Number.isSafeInteger(event.id) || event.id < 0) return false;
      const id = String(event.id);
      if (byId.has(id)) return false;
      // For a direct relist-to-withdrawal interval, an extra event in a verified raw page
      // contradicts the scoped same-identity ledger.
      if (intervals.some(({ relist, withdrawal }) => event.source === relist.source &&
          event.vehicleId === relist.externalId && Number(relist.eventId) < Number(id) &&
          Number(id) < Number(withdrawal.eventId))) return false;
      if (first && last && event.source === first.source && event.vehicleId === first.externalId &&
          Number(first.eventId) < event.id && event.id < Number(last.eventId) && !chainIds.has(id)) return false;
      byId.set(id, event);
    }
    if (!expected.every(proof => {
      const event = byId.get(proof.eventId);
      return !!(event && event.type === proof.kind && event.source === proof.source &&
        event.vehicleId === proof.externalId && atExactTime(event.at, proof.businessAt) && jsonHash(event) === proof.eventHash);
    })) return false;
    if (requiredResponses.has(blob.hash) || expected.some(proof => missingDocuments.has(proof.eventId))) {
      const receipt = completedPage(page, byId.keys());
      if (!receipt) return false;
      completed.set(blob.hash, receipt);
    }
  }
  if (!completed.size) return true;
  // The response itself proves membership. The mutable receipt only corroborates the exact completed range,
  // and its creation time does not date a specific response received on a reused cursor.
  const matched = (await tx.query<{ matched: boolean }>(`SELECT NOT EXISTS(
    SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS q(cursor text,"nextCursor" numeric,"eventCount" integer)
    WHERE NOT EXISTS(SELECT 1 FROM external_full_receipts r WHERE r.cursor_key='cursor:'||q.cursor
      AND r.complete AND r.next_cursor=q."nextCursor" AND r.event_count=q."eventCount")) AS matched`,
  [JSON.stringify([...completed.values()])])).rows[0]?.matched === true;
  return matched && await verifyLinkedReceipts(tx, intervals, completed, chain, frontier);
}

async function verifyDetailHeads(tx: PoolClient, proofs: ReadonlyMap<string, RelistArchiveEvidence>, budget: DecodeBudget) {
  const rows = (await tx.query<{ eventId: string; locale: string; hash: string; compressed: Buffer }>(`
    SELECT q."eventId",h.locale,b.hash,b.compressed
    FROM jsonb_to_recordset($1::jsonb) AS q("eventId" text,source text,"externalId" text,
      "appliedAt" timestamptz,"detailUpdatedAt" timestamptz,"sourceUpdatedAt" timestamptz)
    JOIN external_source_heads h ON h.provider='chinacarapi' AND h.source=q.source AND h.external_id=q."externalId"
      AND h.kind='detail' AND h.locale=ANY($2::text[]) AND h.observed_at BETWEEN q."appliedAt" AND q."detailUpdatedAt"
    JOIN external_source_documents d ON d.id=h.document_id AND d.provider=h.provider AND d.source=h.source
      AND d.external_id=h.external_id AND d.kind=h.kind AND d.locale=h.locale
      AND d.source_updated_at=q."sourceUpdatedAt" AND h.observed_at BETWEEN d.first_observed_at AND d.last_observed_at
    JOIN external_source_blobs b ON b.hash=d.hash AND octet_length(b.compressed)<=$3`,
  [JSON.stringify([...proofs.values()]), locales, compressedDetailLimit])).rows;
  if (rows.length !== proofs.size * locales.length ||
      new Set(rows.map(row => `${row.eventId}:${row.locale}`)).size !== rows.length) return false;
  return rows.every(row => {
    const proof = proofs.get(row.eventId);
    const detail = decodeArchive(row.compressed, row.hash, decodedDetailLimit, budget);
    return !!(proof && detail && jsonHash(detail) === row.hash && detail.source === proof.source &&
      detail.id === proof.externalId && detail.status === 'active' &&
      atExactTime(detail.updatedAt, proof.sourceUpdatedAt) && positiveCny(object(detail.price)?.cny) === BigInt(proof.priceCents));
  });
}

async function verifyHistoricalDetails(tx: PoolClient, proofs: ReadonlyMap<string, HistoricalRelistArchiveEvidence>,
  budget: DecodeBudget): Promise<HistoricalCorroboration[] | null> {
  const rows = (await tx.query<{
    eventId: string; locale: (typeof locales)[number]; hash: string | null; sourceUpdatedAt: string | null;
    compressed: Buffer | null; candidateCount: number; observedCount: number; eventSequence: string | null;
  }>(`SELECT q."eventId",language.locale,d.hash,b.compressed,d.event_sequence::text AS "eventSequence",
    d."candidateCount",d."observedCount",
    to_char(d.source_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "sourceUpdatedAt"
    FROM jsonb_to_recordset($1::jsonb) AS q("eventId" text,source text,"externalId" text,
      "appliedAt" timestamptz,"detailUpdatedAt" timestamptz)
    CROSS JOIN unnest($2::text[]) AS language(locale)
    JOIN LATERAL (
      WITH candidates AS MATERIALIZED (
        SELECT d.id,d.hash,d.source_updated_at,d.first_observed_at,d.last_observed_at,d.event_sequence
        FROM external_source_documents d
        WHERE d.provider='chinacarapi' AND d.source=q.source AND d.external_id=q."externalId"
          AND d.kind='detail' AND d.locale=language.locale AND d.last_observed_at>=q."appliedAt"
        ORDER BY d.last_observed_at DESC,d.id DESC LIMIT ($3+1)
      ), observed AS MATERIALIZED (
        SELECT * FROM candidates d
        WHERE d.first_observed_at BETWEEN q."appliedAt" AND q."detailUpdatedAt"
          OR d.last_observed_at BETWEEN q."appliedAt" AND q."detailUpdatedAt"
          OR EXISTS(SELECT 1 FROM external_source_responses r
            WHERE r.document_id=d.id AND r.observed_at BETWEEN q."appliedAt" AND q."detailUpdatedAt")
      )
      SELECT chosen.*,counts."candidateCount",counts."observedCount" FROM (
        SELECT (SELECT count(*) FROM candidates)::int AS "candidateCount",
          (SELECT count(*) FROM observed)::int AS "observedCount"
      ) counts LEFT JOIN LATERAL (
        SELECT d.hash,d.source_updated_at,d.event_sequence FROM observed d
        WHERE counts."candidateCount"<=$3 AND counts."observedCount"=1
      ) chosen ON true
    ) d ON true
    LEFT JOIN external_source_blobs b ON b.hash=d.hash AND octet_length(b.compressed)<=$4
    ORDER BY q."eventId",language.locale`,
  [JSON.stringify([...proofs.values()]), locales, historyDocumentLimit, compressedDetailLimit])).rows;
  if (rows.length !== proofs.size * locales.length ||
      new Set(rows.map(row => `${row.eventId}:${row.locale}`)).size !== rows.length) return null;
  const versions = new Map<string, string>();
  const corroboration = new Map<string, HistoricalCorroboration>();
  for (const row of rows) {
    const proof = proofs.get(row.eventId);
    if (!proof || row.candidateCount > historyDocumentLimit || row.observedCount > 1) return null;
    if (proof.witness?.kind === 'processed' && !corroboration.has(row.eventId)) {
      corroboration.set(row.eventId, { eventId: row.eventId, unavailableLocales: [],
        supersededByEventId: proof.witness.eventId, scope: 'processed_publication_unconfirmed' });
    }
    if (row.observedCount === 0) {
      const witness = proof.witness;
      if (!witness) return null;
      const existing = corroboration.get(row.eventId);
      if (existing) existing.unavailableLocales.push(row.locale);
      else corroboration.set(row.eventId, {
        eventId: row.eventId, unavailableLocales: [row.locale],
        ...(witness.kind === 'price' ? { priceEventId: witness.eventId }
          : { withdrawalEventId: witness.eventId, scope: 'public_before_withdrawal' }),
      });
      continue;
    }
    // A retained but invalid, ambiguous or wrong-generation original cannot be treated as missing.
    if (!row.hash || !row.compressed || (row.eventSequence !== null && row.eventSequence !== row.eventId)) return null;
    const detail = decodeArchive(row.compressed, row.hash, decodedDetailLimit, budget);
    if (!detail || !row.sourceUpdatedAt || jsonHash(detail) !== row.hash || detail.source !== proof.source ||
        detail.id !== proof.externalId || !atExactTime(detail.updatedAt, row.sourceUpdatedAt)) return null;
    const amount = positiveCny(object(detail.price)?.cny);
    if (proof.priceCents !== null && (detail.status !== 'active' || amount !== BigInt(proof.priceCents) ||
        (proof.outcome === 'effective' ? row.sourceUpdatedAt < proof.businessAt : row.sourceUpdatedAt >= proof.businessAt))) return null;
    // Compare retained observations to each other without assigning a historic public price.
    const version = JSON.stringify([row.sourceUpdatedAt, detail.status, amount?.toString()]);
    const previous = versions.get(row.eventId);
    if (previous !== undefined && previous !== version) return null;
    versions.set(row.eventId, version);
  }
  return [...corroboration.values()];
}

function samePageProof(a: ArchivedEventPageEvidence, b: ArchivedEventPageEvidence) {
  return a.kind === b.kind && a.source === b.source && a.externalId === b.externalId &&
    a.businessAt === b.businessAt && a.eventHash === b.eventHash && a.responseHash === b.responseHash;
}

/** Verify source archives, using a completed original page when event metadata has been pruned. */
export async function verifyRelistArchiveEvidence(tx: PoolClient,
  proofs: readonly RelistArchiveEvidence[], related: readonly ArchivedEventPageEvidence[] = [],
  missingDocuments: readonly ArchivedEventPageEvidence[] = [],
  history: readonly HistoricalRelistArchiveEvidence[] = [],
  processed?: { chain: readonly ArchivedEventPageEvidence[]; frontier: string },
): Promise<{ historyCorroboration: HistoricalCorroboration[] } | null> {
  const processedChain = processed?.chain ?? [];
  if ((!proofs.length && !related.length && !missingDocuments.length) || proofs.length > relistProofBatch ||
      related.length > relatedEventLimit || missingDocuments.length > relatedEventLimit + 2 * relistProofBatch ||
      (history.length > 0 && (proofs.length !== 1 ||
        history.length >= (processedChain.length ? relistHistoryEventLimit : relistHistoryCycles))) ||
      processedChain.length >= relistHistoryEventLimit) return null;
  const byId = new Map<string, RelistArchiveEvidence>();
  const relationsByIdentity = new Map<string, number>();
  for (const value of proofs) {
    const proof = normalizeProof(value);
    if (!proof || byId.has(proof.eventId)) return null;
    const identity = `${proof.source}:${proof.externalId}`;
    if (relationsByIdentity.has(identity)) return null;
    byId.set(proof.eventId, proof);
    relationsByIdentity.set(identity, 0);
  }
  const pages = new Map<string, ArchivedEventPageEvidence>(byId);
  const relationLimit = history.length || processedChain.length ? relistHistoryEventLimit - 1 : relatedEventsPerRelist;
  for (const value of related) {
    const proof = normalizeEventPage(value);
    if (!proof) return null;
    const previous = pages.get(proof.eventId);
    if (previous) {
      if (!samePageProof(previous, proof)) return null;
      continue;
    }
    const identity = `${proof.source}:${proof.externalId}`;
    const count = relationsByIdentity.get(identity);
    if (count !== undefined) {
      if (count === relationLimit) return null;
      relationsByIdentity.set(identity, count + 1);
    }
    pages.set(proof.eventId, proof);
  }
  const receiptProofs = new Set<string>();
  for (const value of missingDocuments) {
    const proof = normalizeEventPage(value);
    if (!proof || receiptProofs.has(proof.eventId)) return null;
    const previous = pages.get(proof.eventId);
    if (previous && !samePageProof(previous, proof)) return null;
    pages.set(proof.eventId, proof);
    receiptProofs.add(proof.eventId);
  }
  const historical = new Map<string, HistoricalRelistArchiveEvidence>();
  const current = byId.values().next().value;
  const chain: ArchivedEventPageEvidence[] = [];
  for (const value of processedChain) {
    const proof = normalizeEventPage(value);
    const previous = chain.at(-1);
    const event = proof && pages.get(proof.eventId);
    if (!proof || !current || !event || !samePageProof(event, proof) || proof.source !== current.source ||
        proof.externalId !== current.externalId || (previous && BigInt(previous.eventId) >= BigInt(proof.eventId))) return null;
    chain.push(proof);
  }
  if (chain.length && (chain[0]!.kind !== 'relisted' || chain.at(-1)?.eventId !== current?.eventId)) return null;
  for (const value of history) {
    const proof = normalizeWindow(value);
    if (!proof || !current || historical.has(proof.eventId) || byId.has(proof.eventId) ||
        proof.source !== current.source || proof.externalId !== current.externalId) return null;
    const event = pages.get(proof.eventId);
    if (!event || !samePageProof(event, proof)) return null;
    if (proof.witness) {
      const witness = pages.get(proof.witness.eventId);
      const kind = proof.witness.kind === 'price' ? 'price' : 'removed';
      if (!witness || witness.kind !== kind || witness.source !== proof.source || witness.externalId !== proof.externalId ||
          BigInt(witness.eventId) <= BigInt(proof.eventId) || witness.businessAt <= proof.businessAt) return null;
      if (proof.witness.kind === 'processed' && !chain.length) return null;
    }
    historical.set(proof.eventId, proof);
  }
  const budget = { remaining: decodedBatchLimit };
  if (byId.size && !await verifyDetailHeads(tx, byId, budget)) return null;
  const historyCorroboration = historical.size ? await verifyHistoricalDetails(tx, historical, budget) : [];
  if (!historyCorroboration) return null;
  const missingHistory = new Set(historyCorroboration.map(item => item.eventId));
  const intervals: WithdrawalInterval[] = [];
  for (const proof of historical.values()) {
    const witness = proof.witness;
    if (!chain.length && witness?.kind === 'withdrawal' && (witness.requiresLinkedReceipts || missingHistory.has(proof.eventId))) {
      intervals.push({ relist: proof, withdrawal: pages.get(witness.eventId)! });
    }
  }
  return await verifyPages(tx, pages, receiptProofs, budget, intervals, chain, processed?.frontier) ? { historyCorroboration } : null;
}
