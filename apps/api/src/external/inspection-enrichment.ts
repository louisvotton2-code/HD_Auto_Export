import { z } from 'zod';
import { ExternalHistorySchema, ExternalInspectionSchema, PublicReportSchema } from '@hd/contracts/public';
import { ExternalUpsertCandidateSchema } from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { adaptChinaCarSample } from './china-car-sample.js';
import { buildProjection, emptyOverrides, jsonHash, sha256, type ExternalProjection } from './normalize.js';
import { chinaCarSampleProfile, getPlatform } from './profiles.js';
import { ReportBindingSchema, requireReportOperator, type ReportSourceRow } from './report-evidence.js';

const InspectionBindingSchema = ReportBindingSchema.omit({ reportUrl: true });
const EnrichmentContentSchema = z.strictObject({ history: ExternalHistorySchema.nullable(), inspection: ExternalInspectionSchema.nullable(), report: PublicReportSchema.optional() })
  .refine(value => !value.inspection || value.inspection.reportUrl === null && value.inspection.reportAccess?.status === 'unknown');
const RequestsSchema = z.array(z.strictObject({ batchId: z.uuid(), row: z.number().int().min(1).max(250) })).min(1).max(250)
  .refine(items => new Set(items.map(item => `${item.batchId}:${item.row}`)).size === items.length);
type EnrichmentRow = { binding: unknown; content: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const conflict = () => new ApiError(409, 'VERSION_CONFLICT', 'The archived inspection does not match the current source.');
function sourceBinding(source: ReportSourceRow) {
  return InspectionBindingSchema.safeParse({ listingId: source.id, provider: source.provider, platformId: source.platform_id,
    externalId: source.external_id, sourceRevision: source.source_revision, sourceHash: source.source_hash });
}

/** A sidecar survives ordinary projection rebuilds, but never a different upstream source version. */
export function applyInspectionEnrichment(source: ReportSourceRow, details: ExternalProjection['details'], row: EnrichmentRow | null): ExternalProjection['details'] {
  if (!row || source.upstream_state !== 'active' || !source.source_data || source.source_data.disputes.length) return details;
  const current = sourceBinding(source), binding = InspectionBindingSchema.safeParse(row.binding), content = EnrichmentContentSchema.safeParse(row.content);
  if (!current.success || !binding.success || !content.success || jsonHash(current.data) !== jsonHash(binding.data)) return details;
  return { ...details, history: content.data.history, inspection: content.data.inspection };
}

/** Controlled local repair of selected existing archive rows. No upstream reimport, source revision rewrite or network access. */
export async function enrichArchivedInspections(db: Database, input: unknown, actorId: string) {
  const requests = RequestsSchema.parse(input);
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    await requireReportOperator(tx, actorId);
    const counts = { applied: 0, unchanged: 0 };
    const seen = new Set<string>();
    for (const request of requests) {
      const archived = (await tx.query<{ listing_id: string; candidate: unknown; raw_encoded: string; raw_hash: string; provider: string }>(
        `SELECT r.listing_id,r.candidate,r.raw_encoded,r.raw_hash,b.provider FROM external_import_records r
         JOIN external_import_batches b ON b.id=r.batch_id WHERE r.batch_id=$1 AND r.row_number=$2 AND r.status IN ('applied','unchanged')`,
        [request.batchId, request.row])).rows[0];
      if (!archived || archived.provider !== chinaCarSampleProfile.id || !archived.listing_id || seen.has(archived.listing_id)) throw conflict();
      seen.add(archived.listing_id);
      const source = (await tx.query<ReportSourceRow>('SELECT * FROM external_listings WHERE id=$1 FOR UPDATE', [archived.listing_id])).rows[0];
      const candidate = ExternalUpsertCandidateSchema.safeParse(archived.candidate);
      if (!source || source.provider !== archived.provider || source.upstream_state !== 'active' || !candidate.success ||
          archived.raw_encoded.length > 2_097_152 || sha256(archived.raw_encoded) !== archived.raw_hash) throw conflict();
      const { fetchedAt, ...stable } = candidate.data;
      if (source.source_hash !== jsonHash(stable) || source.source_revision !== String(candidate.data.revision) ||
          source.platform_id !== candidate.data.platformId || source.external_id !== candidate.data.externalId) throw conflict();
      let raw: Record<string, unknown>, sourceLine: Record<string, unknown>;
      try {
        const decoded: unknown = JSON.parse(archived.raw_encoded);
        if (typeof decoded !== 'string' || decoded.length > 262_144) throw conflict();
        raw = object(JSON.parse(decoded));
        if (typeof raw.sourceLine !== 'string') throw conflict();
        sourceLine = object(JSON.parse(raw.sourceLine));
      } catch { throw conflict(); }
      const report = object(raw.inspection);
      if (raw.inspection != null && (String(report.id) !== source.external_id || report.source != null && report.source !== source.platform_id)) throw conflict();
      const adapted = adaptChinaCarSample(sourceLine, fetchedAt, {}, Array.isArray(raw.evidence) ? raw.evidence.map(object) : [], raw.inspection == null ? undefined : { ...report, source: source.platform_id });
      if (!adapted || adapted.platformId !== source.platform_id || adapted.externalId !== source.external_id ||
          String(adapted.revision) !== source.source_revision || jsonHash(adapted.facts) !== jsonHash(candidate.data.facts) || adapted.listingUrl !== candidate.data.listingUrl) throw conflict();
      const projection = buildProjection({ ...candidate.data, history: adapted.history, inspection: adapted.inspection }, emptyOverrides(),
        getPlatform(chinaCarSampleProfile, source.platform_id)!.name, chinaCarSampleProfile);
      const binding = sourceBinding(source);
      if (!binding.success) throw conflict();
      const content = EnrichmentContentSchema.parse({ history: projection.details.history ?? null, inspection: projection.details.inspection,
        report: { hasReport: adapted.inspection?.hasReport === true || !!adapted.inspection?.reportUrl } });
      const prior = (await tx.query<EnrichmentRow>('SELECT binding,content FROM external_inspection_enrichment WHERE listing_id=$1', [source.id])).rows[0];
      if (prior && jsonHash(prior.binding) === jsonHash(binding.data) && jsonHash(prior.content) === jsonHash(content)) { counts.unchanged++; continue; }
      await tx.query(`INSERT INTO external_inspection_enrichment(listing_id,binding,content,archive_batch_id,archive_row,raw_hash,imported_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(listing_id) DO UPDATE SET binding=excluded.binding,content=excluded.content,
        archive_batch_id=excluded.archive_batch_id,archive_row=excluded.archive_row,raw_hash=excluded.raw_hash,imported_by=excluded.imported_by,imported_at=now()`,
      [source.id, binding.data, content, request.batchId, request.row, archived.raw_hash, actorId]);
      counts.applied++;
    }
    return counts;
  });
}
