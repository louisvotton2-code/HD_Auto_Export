import { getExternalReport } from './reports.js';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ExternalCandidateSchema, type ExternalAdminPageQuery, type ExternalBatch, type ExternalBatchRecord, type ExternalBulkVisibilityRequest,
  type ExternalCandidate, type ExternalImportBatchRequest, type ExternalListing, type ExternalOverrides, type ExternalUpsertCandidate, type SaveExternalOverrides,
} from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { idempotent, type Actor } from '../vehicles/service.js';
import { getExternalPublic, listingUuid, publicListingId } from './catalog.js';
import { buildProjection, canonicalJson, emptyOverrides, isDatabaseJson, isPublicText, jsonHash, sha256, sourceHashes, textSourceIdentity, type ExternalProjection, type TextSourceIdentities } from './normalize.js';
import { chinaCarSampleProfile, getPlatform, getProfile, publicLink, syntheticProfile, type ExternalSourceProfile } from './profiles.js';

type ListingRow = {
  id: string; provider: string; platform_id: string; external_id: string; source_revision: string; source_hash: string;
  source_data: ExternalUpsertCandidate | null; overrides: ExternalOverrides | null; text_source_identities: TextSourceIdentities | null;
  upstream_state: 'active' | 'withdrawn'; version: number; fetched_at: Date; source_updated_at: Date | null; published_at: Date | null;
};
type BatchRow = { id: string; provider: string; imported_at: Date; counts: ExternalBatch['counts']; request_hash: string };
type RecordRow = {
  row_number: number; listing_id: string | null; operation: ExternalBatchRecord['operation'];
  status: ExternalBatchRecord['status']; reason: ExternalBatchRecord['reason']; issues: ExternalBatchRecord['issues'];
  candidate?: ExternalCandidate | null; raw_hash?: string; raw_encoded?: string;
};
type OverrideResult = Pick<ExternalListing, 'id' | 'version' | 'state'>;
type BulkItem = (OverrideResult & { status: 'applied' | 'unchanged' }) |
  { id: string; status: 'failed'; reason: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'EXTERNAL_RESTRICTION' };
const selectListing = 'SELECT l.*,o.data AS overrides,o.text_source_identities FROM external_listings l LEFT JOIN external_listing_overrides o ON o.listing_id=l.id';
const batchColumns = 'id,provider,imported_at,counts';
const recordColumns = 'row_number,listing_id,operation,status,reason,issues';
const sameKeyConflict = () => new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The key was already used for different input.');
const upstreamState = (row: ListingRow): ExternalListing['state'] =>
  row.upstream_state === 'withdrawn' ? 'withdrawn' : row.overrides?.hidden ? 'hidden' : 'published';
const iso = (value: Date | null) => value?.toISOString() ?? null;
function projectListing(row: ListingRow, overrides: ExternalOverrides) {
  const profile = getProfile(row.provider);
  return row.source_data && buildProjection(row.source_data, overrides, getPlatform(profile, row.platform_id)!.name, profile, row.text_source_identities ?? {});
}

function batchView(row: BatchRow): ExternalBatch {
  return { id: row.id, provider: row.provider, importedAt: row.imported_at.toISOString(),
    state: row.counts.rejected || row.counts.ignored ? 'completed_with_issues' : 'completed', counts: row.counts };
}
function recordView(row: RecordRow): ExternalBatchRecord {
  return { row: row.row_number, listingId: row.listing_id ? publicListingId(row.listing_id) : null, operation: row.operation,
    status: row.status, reason: row.reason, issues: row.issues };
}

// Short, bounded sample batches use one writer order. No lock covers network I/O.
async function lockExternalWrites(tx: PoolClient) { await tx.query('SELECT pg_advisory_xact_lock(78291332)'); }
async function advanceRevision(tx: PoolClient) { await tx.query('UPDATE external_catalog_state SET revision=revision+1 WHERE id=1'); }
async function findListing(tx: PoolClient, id: string) {
  return (await tx.query<ListingRow>(`${selectListing} WHERE l.id=$1`, [id])).rows[0];
}

async function saveProjection(tx: PoolClient, row: ListingRow, projection: ExternalProjection | null) {
  if (upstreamState(row) !== 'published' || !projection) {
    return !!(await tx.query('DELETE FROM external_catalog WHERE listing_id=$1', [row.id])).rowCount;
  }
  await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(listing_id) DO UPDATE SET platform_name=excluded.platform_name,listing_url=excluded.listing_url,facts=excluded.facts,
      price_cny=excluded.price_cny,issues=excluded.issues,localized=excluded.localized,details=excluded.details`,
    [row.id, row.published_at, getPlatform(getProfile(row.provider), row.platform_id)!.name, row.source_data!.listingUrl, JSON.stringify(projection.facts), projection.priceCny,
      JSON.stringify(projection.issues), JSON.stringify(projection.localized), JSON.stringify(projection.details)]);
  await tx.query(`INSERT INTO external_media_refresh_requests(media_id,media_revision)
    SELECT id,revision FROM external_media WHERE listing_id=$1 AND active AND expires_at<=now() ON CONFLICT DO NOTHING`, [row.id]);
  return true;
}

async function syncImages(tx: PoolClient, listingId: string, images: ExternalProjection['images'], fetchedAt: string) {
  await tx.query('UPDATE external_media SET active=false WHERE listing_id=$1 AND active AND NOT (source_media_id=ANY($2::text[]))',
    [listingId, images.map(image => image.sourceMediaId)]);
  for (const [position, image] of images.entries()) {
    await tx.query(`INSERT INTO external_media(id,listing_id,source_media_id,url,width,height,alt,position,active,refreshed_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)
      ON CONFLICT(listing_id,source_media_id) DO UPDATE SET url=excluded.url,width=excluded.width,height=excluded.height,
        alt=excluded.alt,position=excluded.position,active=true,refreshed_at=excluded.refreshed_at,expires_at=excluded.expires_at,
        revision=external_media.revision+CASE WHEN external_media.url IS DISTINCT FROM excluded.url OR
          external_media.expires_at IS DISTINCT FROM excluded.expires_at OR NOT external_media.active THEN 1 ELSE 0 END`,
    [randomUUID(), listingId, image.sourceMediaId, image.url, image.width, image.height, JSON.stringify(image.alt), position, fetchedAt, image.expiresAt]);
  }
}

type ApplyResult = Pick<RecordRow, 'listing_id' | 'status' | 'reason' | 'issues'> & { publicChanged: boolean };
const noChange = (status: RecordRow['status'], reason: RecordRow['reason'], listing_id: string | null = null): ApplyResult =>
  ({ listing_id, status, reason, issues: [], publicChanged: false });

async function applyCandidate(tx: PoolClient, profile: ExternalSourceProfile, candidate: ExternalCandidate): Promise<ApplyResult> {
  const platform = getPlatform(profile, candidate.platformId);
  if (!platform) return noChange('rejected', 'identity_unconfirmed');
  const identity = [profile.id, candidate.platformId, candidate.externalId];
  const existing = (await tx.query<ListingRow>(`${selectListing} WHERE l.provider=$1 AND l.platform_id=$2 AND l.external_id=$3`, identity)).rows[0];
  // Collection time is provenance for this observation, independent of the supplier event's identity.
  const { fetchedAt, ...stable } = candidate;
  const hash = jsonHash(stable);
  if (existing && candidate.revision < Number(existing.source_revision)) return noChange('ignored', 'stale_revision', existing.id);
  if (existing && candidate.revision === Number(existing.source_revision)) return existing.source_hash === hash
    ? noChange('unchanged', null, existing.id) : noChange('rejected', 'revision_conflict', existing.id);
  if (candidate.operation === 'upsert') {
    if (!publicLink(candidate.listingUrl, 'listing', profile, candidate.platformId)) return noChange('rejected', 'unsafe_listing_url', existing?.id);
    if (!existing || existing.upstream_state === 'withdrawn') {
      const staffCopy = await tx.query(`SELECT 1 FROM vehicle_drafts WHERE data->'source'->>'kind'='external'
        AND data->'source'->'platform'->>'id'=$1 AND data->'source'->>'externalId'=$2`, identity.slice(1));
      if (staffCopy.rowCount) return noChange('rejected', 'staff_listing_exists', existing?.id);
    }
  }
  const active = candidate.operation === 'upsert';
  const source = active ? candidate : existing?.source_data ?? null;
  const id = existing?.id ?? randomUUID();
  const row = (await tx.query<ListingRow>(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,
      upstream_state,fetched_at,source_updated_at,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $8='active' THEN now() END)
    ON CONFLICT(id) DO UPDATE SET source_revision=excluded.source_revision,source_hash=excluded.source_hash,source_data=excluded.source_data,
      upstream_state=excluded.upstream_state,fetched_at=excluded.fetched_at,source_updated_at=excluded.source_updated_at,
      published_at=coalesce(external_listings.published_at,excluded.published_at),version=external_listings.version+1 RETURNING *`,
    [id, ...identity, candidate.revision, hash, source && JSON.stringify(source), active ? 'active' : 'withdrawn', fetchedAt, candidate.sourceUpdatedAt])).rows[0]!;
  row.overrides = existing?.overrides ?? null;
  row.text_source_identities = existing?.text_source_identities ?? null;
  const projection = active && source ? buildProjection(source, row.overrides ?? emptyOverrides(), platform.name, profile, row.text_source_identities ?? {}) : null;
  if (projection) await syncImages(tx, id, projection.images, fetchedAt);
  const publicChanged = await saveProjection(tx, row, projection);
  return { listing_id: id, status: 'applied', reason: null, issues: projection?.issues ?? [], publicChanged };
}

function validateOverrides(row: ListingRow, input: ExternalOverrides) {
  if (!isDatabaseJson(input)) throw new ApiError(422, 'INVALID_REQUEST', 'Override text is not valid.');
  const names = [input.facts.make?.name, input.facts.model?.name, input.facts.trim?.name, input.facts.generation?.name,
    input.facts.location?.city, input.facts.location?.displayName, ...input.text.map(text => text.text)];
  if (names.some(name => name != null && !isPublicText(name))) throw new ApiError(422, 'INVALID_REQUEST', 'Overrides require public display text.');
  const current = projectListing(row, input);
  for (const item of input.text) {
    const saved = row.overrides?.text.find(text => text.field === item.field && text.locale === item.locale);
    if (current?.sourceHashes[item.field] !== item.sourceHash && canonicalJson(saved) !== canonicalJson(item)) throw conflict();
  }
}

async function writeOverrides(tx: PoolClient, row: ListingRow, overrides: ExternalOverrides, actor: Actor) {
  if (canonicalJson(row.overrides ?? emptyOverrides()) === canonicalJson(overrides)) {
    return { result: { id: publicListingId(row.id), state: upstreamState(row), version: row.version }, changed: false, publicChanged: false };
  }
  const version = row.version + 1;
  const data = JSON.stringify(overrides);
  const hashes = projectListing(row, overrides)?.sourceHashes;
  const bindings: TextSourceIdentities = {};
  for (const {field, sourceHash} of overrides.text) {
    const identity = row.source_data && hashes?.[field] === sourceHash
      ? textSourceIdentity(row.source_data)
      : row.text_source_identities?.[sourceHash];
    if (identity) bindings[sourceHash] = identity;
  }
  await tx.query(`INSERT INTO external_listing_overrides(listing_id,data,text_source_identities) VALUES($1,$2,$3)
    ON CONFLICT(listing_id) DO UPDATE SET data=excluded.data,text_source_identities=excluded.text_source_identities`,
    [row.id, data, JSON.stringify(bindings)]);
  await tx.query('UPDATE external_listings SET version=$2 WHERE id=$1', [row.id, version]);
  await tx.query('INSERT INTO external_override_events(id,listing_id,actor_id,request_id,version,data) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), row.id, actor.id, actor.requestId, version, data]);
  row.overrides = overrides;
  row.text_source_identities = bindings;
  const projection = row.upstream_state === 'active' ? projectListing(row, overrides) : null;
  const publicChanged = await saveProjection(tx, row, projection);
  return { result: { id: publicListingId(row.id), state: upstreamState(row), version }, changed: true, publicChanged };
}

export class ExternalStore {
  constructor(private db: Database, private importProfile: ExternalSourceProfile = syntheticProfile) {}

  async importBatch(input: ExternalImportBatchRequest, key: string, actor: Actor): Promise<ExternalBatch> {
    return this.db.transaction(tx => this.importBatchWithClient(tx, input, key, actor));
  }

  // The worker commits an import receipt and its checkpoint under the same fence.
  async importBatchWithClient(tx: PoolClient, input: ExternalImportBatchRequest, key: string, actor: Actor): Promise<ExternalBatch> {
    if (input.provider !== this.importProfile.id) throw new ApiError(422, 'EXTERNAL_RESTRICTION', 'This source profile is not registered.');
    const hash = jsonHash(input);
    await lockExternalWrites(tx);
    const prior = (await tx.query<BatchRow>(`SELECT ${batchColumns},request_hash FROM external_import_batches WHERE provider=$1 AND idempotency_key=$2`, [input.provider, key])).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw sameKeyConflict();
      return batchView(prior);
    }
    const id = randomUUID();
    const counts: ExternalBatch['counts'] = { total: input.records.length, applied: 0, unchanged: 0, ignored: 0, rejected: 0 };
    await tx.query('INSERT INTO external_import_batches(id,provider,idempotency_key,request_hash,actor_id,counts) VALUES($1,$2,$3,$4,$5,$6)',
      [id, input.provider, key, hash, actor.id, JSON.stringify(counts)]);
    let publicChanged = false;
    for (const [position, record] of input.records.entries()) {
      const parsed = ExternalCandidateSchema.safeParse(record.candidate);
      const candidate = parsed.success && isDatabaseJson(parsed.data) ? parsed.data : null;
      const reason = !parsed.success && parsed.error.issues.some(issue => issue.path[0] === 'platformId' || issue.path[0] === 'externalId')
        ? 'identity_unconfirmed' : 'invalid_record';
      const applied = candidate ? await applyCandidate(tx, this.importProfile, candidate) : noChange('rejected', reason);
      publicChanged ||= applied.publicChanged;
      counts[applied.status]++;
      const encoded = JSON.stringify(record.raw);
      await tx.query(`INSERT INTO external_import_records(batch_id,row_number,listing_id,operation,status,reason,issues,candidate,raw_encoded,raw_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, position + 1, applied.listing_id, candidate?.operation ?? null,
        applied.status, applied.reason, JSON.stringify(applied.issues), candidate && JSON.stringify(candidate), encoded, sha256(encoded)]);
    }
    if (publicChanged) await advanceRevision(tx);
    return batchView((await tx.query<BatchRow>(`UPDATE external_import_batches SET counts=$2 WHERE id=$1 RETURNING ${batchColumns}`, [id, JSON.stringify(counts)])).rows[0]!);
  }

  async listBatches(query: ExternalAdminPageQuery) {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const total = (await tx.query<{ total: number }>('SELECT count(*)::int AS total FROM external_import_batches')).rows[0]!.total;
      const result = await tx.query<BatchRow>(`SELECT ${batchColumns} FROM external_import_batches ORDER BY imported_at DESC,id LIMIT $1 OFFSET $2`,
        [query.pageSize, (query.page - 1) * query.pageSize]);
      return { ...query, total, items: result.rows.map(batchView) };
    });
  }

  async getBatch(id: string) {
    const row = (await this.db.pool.query<BatchRow>(`SELECT ${batchColumns} FROM external_import_batches WHERE id=$1`, [id])).rows[0];
    if (!row) throw notFound();
    return batchView(row);
  }

  async listRecords(id: string, query: ExternalAdminPageQuery) {
    const { counts } = await this.getBatch(id);
    const rows = await this.db.pool.query<RecordRow>(`SELECT ${recordColumns} FROM external_import_records WHERE batch_id=$1 ORDER BY row_number LIMIT $2 OFFSET $3`,
      [id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { ...query, total: counts.total, items: rows.rows.map(recordView) };
  }

  async getRecord(id: string, row: number) {
    const found = (await this.db.pool.query<RecordRow>(`SELECT ${recordColumns},candidate,raw_hash FROM external_import_records WHERE batch_id=$1 AND row_number=$2`, [id, row])).rows[0];
    if (!found) throw notFound();
    return { ...recordView(found), candidate: found.candidate ?? null, rawHash: found.raw_hash! };
  }

  async getRaw(id: string, row: number) {
    const found = (await this.db.pool.query<{ raw_encoded: string; raw_hash: string }>('SELECT raw_encoded,raw_hash FROM external_import_records WHERE batch_id=$1 AND row_number=$2', [id, row])).rows[0];
    if (!found) throw notFound();
    return { raw: JSON.parse(found.raw_encoded) as string, rawHash: found.raw_hash };
  }

  async getListing(id: string, locale: Locale): Promise<ExternalListing> {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = await findListing(tx, listingUuid(id));
      if (!row) throw notFound();
      const overrides = row.overrides ?? emptyOverrides();
      const hashes = projectListing(row, overrides)?.sourceHashes ?? sourceHashes(null);
      return { id, version: row.version, state: upstreamState(row),
        identity: { provider: row.provider, platformId: row.platform_id, externalId: row.external_id },
        sourceRevision: Number(row.source_revision), sourceUpdatedAt: iso(row.source_updated_at), fetchedAt: row.fetched_at.toISOString(),
        source: row.source_data, overrides, sourceHashes: hashes, report: await getExternalReport(tx, row.id), vehicle: await getExternalPublic(tx, row.id, locale) };
    });
  }

  async saveOverrides(id: string, input: SaveExternalOverrides, key: string, actor: Actor) {
    return this.db.transaction(tx => idempotent(tx, actor, `external.override:${id}`, key, input, async () => {
      await lockExternalWrites(tx);
      const row = await findListing(tx, listingUuid(id));
      if (!row) throw notFound();
      if (row.version !== input.version) throw conflict();
      if (row.upstream_state === 'withdrawn' && !input.overrides.hidden) throw new ApiError(422, 'EXTERNAL_RESTRICTION', 'A withdrawn listing cannot be restored by a staff override.');
      validateOverrides(row, input.overrides);
      const { result, publicChanged } = await writeOverrides(tx, row, input.overrides, actor);
      if (publicChanged) await advanceRevision(tx);
      return result;
    }));
  }

  async bulkVisibility(input: ExternalBulkVisibilityRequest, key: string, actor: Actor) {
    return this.db.transaction(tx => idempotent(tx, actor, 'external.bulk-visibility', key, input, async () => {
      await lockExternalWrites(tx);
      const items: BulkItem[] = [];
      let catalogChanged = false;
      for (const item of input.items) {
        const row = await findListing(tx, listingUuid(item.id));
        if (!row) items.push({ id: item.id, status: 'failed', reason: 'NOT_FOUND' });
        else if (row.version !== item.version) items.push({ id: item.id, status: 'failed', reason: 'VERSION_CONFLICT' });
        else if (!input.hidden && row.upstream_state === 'withdrawn') items.push({ id: item.id, status: 'failed', reason: 'EXTERNAL_RESTRICTION' });
        else {
          const { result, changed, publicChanged } = await writeOverrides(tx, row, { ...(row.overrides ?? emptyOverrides()), hidden: input.hidden }, actor);
          catalogChanged ||= publicChanged;
          items.push({ ...result, status: changed ? 'applied' : 'unchanged' });
        }
      }
      if (catalogChanged) await advanceRevision(tx);
      return { items };
    }));
  }

  async providerStatus() {
    const provider = chinaCarSampleProfile.id;
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const latestBatch = (await tx.query<BatchRow>(
        `SELECT ${batchColumns} FROM external_import_batches WHERE provider=$1 ORDER BY imported_at DESC,id LIMIT 1`, [provider],
      )).rows[0];
      const { rows: [times] } = await tx.query<{
        imported_at: Date | null; fetched_at: Date | null; source_updated_at: Date | null;
      }>(`SELECT
        (SELECT imported_at FROM external_import_batches WHERE provider=$1 AND (counts->>'applied')::bigint>0
          ORDER BY imported_at DESC,id LIMIT 1) AS imported_at,
        (SELECT fetched_at FROM external_listings WHERE provider=$1 ORDER BY fetched_at DESC LIMIT 1) AS fetched_at,
        (SELECT source_updated_at FROM external_listings WHERE provider=$1
          ORDER BY source_updated_at DESC NULLS LAST LIMIT 1) AS source_updated_at`, [provider]);
      return {
        provider: 'chinacarapi' as const,
        worker: 'not_configured' as const,
        lastBatch: latestBatch ? batchView(latestBatch) : null,
        lastImportAt: iso(times!.imported_at),
        lastFetchedAt: iso(times!.fetched_at),
        lastSupplierUpdatedAt: iso(times!.source_updated_at),
      };
    });
  }

  async status() {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const revision = (await tx.query<{ revision: string }>('SELECT revision FROM external_catalog_state WHERE id=1')).rows[0]!.revision;
      const last = (await tx.query<BatchRow>(`SELECT ${batchColumns} FROM external_import_batches ORDER BY imported_at DESC,id LIMIT 1`)).rows[0];
      return { catalogRevision: revision, sync: 'manual_import_only' as const, translation: 'dry_run' as const, lastBatch: last ? batchView(last) : null,
        batchCharacterLimit: 100_000 as const, accountFreeRemaining: null };
    });
  }
}
