import { z } from 'zod';
import type { PoolClient } from 'pg';
import { ExternalReportAccessSchema, ExternalTimestampSchema, type ExternalReportAccess } from '@hd/contracts/public';
import type { ExternalUpsertCandidate } from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { jsonHash } from './normalize.js';
import { chinaCarSampleProfile, getPlatform, publicLink, syntheticProfile } from './profiles.js';

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ListingIdsSchema = z.array(z.uuid()).min(1).max(250).refine(ids => new Set(ids).size === ids.length);
export const ReportBindingSchema = z.strictObject({
  listingId: z.uuid(), provider: z.enum(['synthetic-feed', 'chinacarapi-sample']),
  platformId: z.string().min(1).max(100), externalId: z.string().min(1).max(300),
  sourceRevision: z.string().regex(/^[1-9][0-9]{0,18}$/), sourceHash: HashSchema,
  reportUrl: z.string().max(2048),
});
export const ReportManifestSchema = z.strictObject({
  version: z.literal(1), exportedAt: ExternalTimestampSchema,
  entries: z.array(ReportBindingSchema).max(250),
}).refine(value => new Set(value.entries.map(item => item.listingId)).size === value.entries.length, 'Duplicate manifest listing.');
export const ReportObservationSchema = z.strictObject({
  listingId: z.uuid(), checkedAt: ExternalTimestampSchema, expiresAt: ExternalTimestampSchema,
  outcome: z.enum(['unknown', 'available', 'unavailable']),
  // These are a trusted operator's offline evidence, never assertions accepted from a supplier or public request.
  httpStatus: z.number().int().min(100).max(599).nullable(), finalUrl: z.string().max(2048).nullable(),
  verifiedReportContent: z.boolean(), matchedVehicle: z.boolean(), evidenceHash: HashSchema,
}).refine(value => Date.parse(value.expiresAt) > Date.parse(value.checkedAt) &&
  Date.parse(value.expiresAt) - Date.parse(value.checkedAt) <= 24 * 60 * 60 * 1000, 'Evidence lifetime must be positive and at most 24 hours.');
export const ReportResultsSchema = z.strictObject({
  version: z.literal(1), manifest: ReportManifestSchema,
  observations: z.array(ReportObservationSchema).min(1).max(250),
}).refine(value => new Set(value.observations.map(item => item.listingId)).size === value.observations.length, 'Duplicate observation.');
export type ReportBinding = z.infer<typeof ReportBindingSchema>;
export type ReportManifest = z.infer<typeof ReportManifestSchema>;
export type ReportObservation = z.infer<typeof ReportObservationSchema>;
export type ReportSourceRow = {
  id: string; provider: string; platform_id: string; external_id: string; source_revision: string; source_hash: string;
  source_data: ExternalUpsertCandidate | null; upstream_state: string;
};
export type ReportEvidenceRow = { binding: unknown; observation: unknown; checked_at: Date; expires_at: Date; observation_hash: string };
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Report evidence does not match the approved offline contract.');
const conflict = () => new ApiError(409, 'VERSION_CONFLICT', 'Report source or evidence changed; export a new manifest.');
export const unknownReportAccess = (): ExternalReportAccess => ({ status: 'unknown', url: null, checkedAt: null, expiresAt: null });

export function reportBinding(row: ReportSourceRow): ReportBinding | null {
  // getProfile's synthetic fallback must never grant an unknown provider a report capability.
  const profile = row.provider === chinaCarSampleProfile.id ? chinaCarSampleProfile : row.provider === syntheticProfile.id ? syntheticProfile : null;
  if (!profile || !getPlatform(profile, row.platform_id) || row.upstream_state !== 'active' || !row.source_data || row.source_data.disputes.length) return null;
  const reportUrl = publicLink(row.source_data.inspection?.reportUrl ?? null, 'report', profile);
  if (!reportUrl) return null;
  const parsed = ReportBindingSchema.safeParse({ listingId: row.id, provider: row.provider, platformId: row.platform_id,
    externalId: row.external_id, sourceRevision: row.source_revision, sourceHash: row.source_hash, reportUrl });
  return parsed.success ? parsed.data : null;
}
function validObservation(binding: ReportBinding, observation: ReportObservation): boolean {
  if (binding.listingId !== observation.listingId || observation.finalUrl !== null && observation.finalUrl !== binding.reportUrl) return false;
  return observation.outcome !== 'available' || observation.httpStatus === 200 && observation.finalUrl === binding.reportUrl &&
    observation.verifiedReportContent && observation.matchedVehicle;
}

/** Pure read projection. Exact source binding is checked again even after an import transaction succeeded. */
export function projectReportAccess(row: ReportSourceRow, evidence: ReportEvidenceRow | null | undefined, now: number): ExternalReportAccess {
  const current = reportBinding(row);
  if (!current || !evidence || !Number.isFinite(now)) return unknownReportAccess();
  const binding = ReportBindingSchema.safeParse(evidence.binding), observation = ReportObservationSchema.safeParse(evidence.observation);
  if (!binding.success || !observation.success || jsonHash(current) !== jsonHash(binding.data) ||
      !validObservation(binding.data, observation.data) || jsonHash(observation.data) !== evidence.observation_hash) return unknownReportAccess();
  const proof = observation.data, checked = Date.parse(proof.checkedAt), expiry = Date.parse(proof.expiresAt);
  if (evidence.checked_at.getTime() !== checked || evidence.expires_at.getTime() !== expiry || checked > now) return unknownReportAccess();
  // An application shell/HTTP 200 alone remains unknown, including its public timestamps.
  if (proof.outcome === 'unknown') return unknownReportAccess();
  return ExternalReportAccessSchema.parse({ status: expiry <= now ? 'expired' : proof.outcome,
    url: expiry > now && proof.outcome === 'available' ? current.reportUrl : null, checkedAt: proof.checkedAt, expiresAt: proof.expiresAt });
}

export async function requireReportOperator(tx: PoolClient, actorId: string) {
  if (!(await tx.query("SELECT id FROM staff WHERE id=$1 AND role='admin' AND NOT banned FOR SHARE", [actorId])).rowCount) {
    throw new ApiError(403, 'FORBIDDEN', 'An active administrator must import offline report evidence.');
  }
}

/** Export only explicitly selected, existing profile-approved URLs. This function performs no network I/O. */
export async function exportReportManifest(db: Pick<Database, 'pool'>, listingIds: string[], now = Date.now()): Promise<ReportManifest> {
  const ids = ListingIdsSchema.parse(listingIds);
  const rows = await db.pool.query<ReportSourceRow>('SELECT * FROM external_listings WHERE id=ANY($1::uuid[]) ORDER BY id', [ids]);
  return ReportManifestSchema.parse({ version: 1, exportedAt: new Date(now).toISOString(), entries: rows.rows.flatMap(row => reportBinding(row) ?? []) });
}

/** Trusted offline import only: no HTTP route, provider client, redirect following or URL fetch is exposed here. */
export async function importReportResults(db: Database, input: unknown, actorId: string, now = Date.now()) {
  const parsed = ReportResultsSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) throw invalid();
  const results = parsed.data, exported = Date.parse(results.manifest.exportedAt), manifestHash = jsonHash(results.manifest);
  const bindings = new Map(results.manifest.entries.map(binding => [binding.listingId, binding]));
  if (exported > now || results.observations.some(item => !bindings.has(item.listingId) || Date.parse(item.checkedAt) < exported || Date.parse(item.checkedAt) > now)) throw invalid();
  return db.transaction(async tx => {
    // Match ExternalStore's writer order. The singleton public revision remains deferred until commit.
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    await requireReportOperator(tx, actorId);
    const counts = { applied: 0, unchanged: 0 };
    for (const observation of [...results.observations].sort((a, b) => a.listingId.localeCompare(b.listingId))) {
      const row = (await tx.query<ReportSourceRow>('SELECT * FROM external_listings WHERE id=$1 FOR UPDATE', [observation.listingId])).rows[0];
      const binding = bindings.get(observation.listingId)!;
      const current = row && reportBinding(row);
      if (!current || jsonHash(current) !== jsonHash(binding) || !validObservation(current, observation)) throw conflict();
      const hash = jsonHash(observation);
      const prior = (await tx.query<ReportEvidenceRow>('SELECT * FROM external_report_evidence WHERE listing_id=$1 FOR UPDATE', [row.id])).rows[0];
      if (prior && Date.parse(observation.checkedAt) <= prior.checked_at.getTime()) {
        if (Date.parse(observation.checkedAt) === prior.checked_at.getTime() && prior.observation_hash === hash && jsonHash(prior.binding) === jsonHash(binding)) {
          counts.unchanged++; continue;
        }
        throw conflict();
      }
      await tx.query(`INSERT INTO external_report_evidence(listing_id,binding,observation,observation_hash,manifest_hash,checked_at,expires_at,imported_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(listing_id) DO UPDATE SET binding=excluded.binding,observation=excluded.observation,
          observation_hash=excluded.observation_hash,manifest_hash=excluded.manifest_hash,checked_at=excluded.checked_at,
          expires_at=excluded.expires_at,imported_by=excluded.imported_by,imported_at=now()`,
      [row.id, binding, observation, hash, manifestHash, observation.checkedAt, observation.expiresAt, actorId]);
      counts.applied++;
    }
    return counts;
  });
}
