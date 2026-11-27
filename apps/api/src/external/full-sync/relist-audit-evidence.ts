import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { MoneySchema } from '@hd/contracts/public';
import { jsonHash, sha256 } from '../normalize.js';
import { LIMITS } from './types.js';

export type RelistArchiveEvidence = {
  eventId: string;
  source: string;
  externalId: string;
  businessAt: string;
  appliedAt: string;
  detailUpdatedAt: string;
  sourceUpdatedAt: string;
  eventHash: string;
  responseHash: string;
  priceCents: string;
};

const eventTime = z.iso.datetime({ offset: true });
const hashPattern = /^[a-f0-9]{64}$/;
const locales = ['en', 'ru', 'zh'] as const;
export const relistProofBatch = 8;
const compressedPageLimit = 256 * 1024;
const compressedDetailLimit = 128 * 1024;
const decodedPageLimit = 4 * 1024 * 1024;
const decodedDetailLimit = 1024 * 1024;
const decodedBatchLimit = 24 * 1024 * 1024;
type DecodeBudget = { remaining: number };

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

function normalizeProof(proof: RelistArchiveEvidence): RelistArchiveEvidence | null {
  const businessAt = exactTime(proof.businessAt);
  const appliedAt = exactTime(proof.appliedAt);
  const detailUpdatedAt = exactTime(proof.detailUpdatedAt);
  const sourceUpdatedAt = exactTime(proof.sourceUpdatedAt);
  if (!businessAt || !appliedAt || !detailUpdatedAt || !sourceUpdatedAt ||
      businessAt > appliedAt || appliedAt > detailUpdatedAt ||
      !/^[1-9][0-9]{0,15}$/.test(proof.eventId) || !Number.isSafeInteger(Number(proof.eventId)) ||
      (proof.source !== 'che168' && proof.source !== 'dongchedi') || !/^\d{1,100}$/.test(proof.externalId) ||
      !/^[1-9][0-9]{0,15}$/.test(proof.priceCents) ||
      !hashPattern.test(proof.eventHash) || !hashPattern.test(proof.responseHash)) return null;
  return { ...proof, businessAt, appliedAt, detailUpdatedAt, sourceUpdatedAt };
}

function decodeArchive(compressed: Buffer, hash: string, maxOutputLength: number, budget: DecodeBudget) {
  const limit = Math.min(maxOutputLength, budget.remaining);
  if (limit < 1) return null;
  try {
    const bytes = gunzipSync(compressed, { maxOutputLength: limit });
    budget.remaining -= bytes.length;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return sha256(text) === hash ? object(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

async function verifyCsv(tx: PoolClient, snapshotId: string, proofs: ReadonlyMap<string, RelistArchiveEvidence>) {
  const rows = (await tx.query<{
    eventId: string; source: unknown; externalId: unknown; price: unknown; duplicateOf: unknown;
    fetchedAt: unknown; completedAt: string;
  }>(`SELECT q."eventId",r.payload->'source' AS source,r.payload->'id' AS "externalId",
    r.payload->'price_cny' AS price,r.payload->'duplicate_of' AS "duplicateOf",
    r.payload->'detail_fetched_at' AS "fetchedAt",
    to_char(s.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "completedAt"
    FROM external_full_snapshots s
    CROSS JOIN jsonb_to_recordset($2::jsonb) AS q("eventId" text,source text,"externalId" text)
    JOIN external_full_stage r ON r.snapshot_id=s.id AND r.source=q.source AND r.external_id=q."externalId"
    WHERE s.id=$1 AND s.state='complete' AND s.staged=s.rows AND s.apply_cursor=s.rows AND s.rows>0
      AND s.sha256 ~ '^[a-f0-9]{64}$' AND s.bytes>0 AND s.completed_at IS NOT NULL
      AND s.archive_pruned_at IS NULL AND r.row_number BETWEEN 1 AND s.rows`,
  [snapshotId, JSON.stringify([...proofs.values()])])).rows;
  if (rows.length !== proofs.size || new Set(rows.map(row => row.eventId)).size !== proofs.size) return false;
  return rows.every(row => {
    const proof = proofs.get(row.eventId);
    const fetched = exactTime(row.fetchedAt);
    const completed = exactTime(row.completedAt);
    // x-generated-at is the feed's continuation anchor, not an upper bound on source row time.
    return !!(proof && fetched && completed && fetched > proof.detailUpdatedAt && fetched <= completed &&
      row.source === proof.source && row.externalId === proof.externalId && row.duplicateOf === '' &&
      positiveCny(row.price) === BigInt(proof.priceCents));
  });
}

async function verifyPages(tx: PoolClient, proofs: ReadonlyMap<string, RelistArchiveEvidence>, budget: DecodeBudget) {
  const pages = new Map<string, RelistArchiveEvidence[]>();
  for (const proof of proofs.values()) {
    const expected = pages.get(proof.responseHash);
    if (expected) expected.push(proof);
    else pages.set(proof.responseHash, [proof]);
  }
  const blobs = (await tx.query<{ hash: string; compressed: Buffer }>(`SELECT hash,compressed
    FROM external_source_blobs WHERE hash=ANY($1::text[]) AND raw_exact AND octet_length(compressed)<=$2`,
  [[...pages.keys()], compressedPageLimit])).rows;
  if (blobs.length !== pages.size) return false;
  return blobs.every(blob => {
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
      byId.set(id, event);
    }
    return expected.every(proof => {
      const event = byId.get(proof.eventId);
      return !!(event && event.type === 'relisted' && event.source === proof.source &&
        event.vehicleId === proof.externalId && atExactTime(event.at, proof.businessAt) && jsonHash(event) === proof.eventHash);
    });
  });
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

/** Verify raw archive, its current-generation source heads, and the later bound export. */
export async function verifyRelistArchiveEvidence(tx: PoolClient, snapshotId: string,
  proofs: readonly RelistArchiveEvidence[]): Promise<boolean> {
  if (!proofs.length || proofs.length > relistProofBatch || !z.uuid().safeParse(snapshotId).success) return false;
  const byId = new Map<string, RelistArchiveEvidence>();
  const identities = new Set<string>();
  for (const value of proofs) {
    const proof = normalizeProof(value);
    if (!proof || byId.has(proof.eventId) || identities.has(`${proof.source}:${proof.externalId}`)) return false;
    byId.set(proof.eventId, proof);
    identities.add(`${proof.source}:${proof.externalId}`);
  }
  const budget = { remaining: decodedBatchLimit };
  return await verifyCsv(tx, snapshotId, byId) && await verifyPages(tx, byId, budget) && await verifyDetailHeads(tx, byId, budget);
}
