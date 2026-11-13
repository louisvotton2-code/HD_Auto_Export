import type { PoolClient } from 'pg';
import { AdminReportSchema, type AdminReport, type VehicleDraftSource } from '@hd/contracts/admin';
import type { ReportSourceRow } from './report-evidence.js';
import { chinaCarProfile, chinaCarSampleProfile, getPlatform, publicLink, syntheticProfile } from './profiles.js';

type Queryable = Pick<PoolClient, 'query'>;
export type ReportEnrichment = { binding: unknown; content: unknown } | null;
type ReportRow = ReportSourceRow & { inspection_binding?: unknown; inspection_content?: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const absent = (): AdminReport => ({ hasReport: false, url: null });

/** Source presence is independent of network verification. A rejected URL still proves a source claim, never clickability. */
export function projectSourceReport(source: ReportSourceRow, enrichment: ReportEnrichment = null): AdminReport {
  const profile = source.provider === chinaCarProfile.id ? chinaCarProfile : source.provider === chinaCarSampleProfile.id ? chinaCarSampleProfile : source.provider === syntheticProfile.id ? syntheticProfile : null;
  if (!profile || !getPlatform(profile, source.platform_id) || !source.source_data ||
      source.source_data.platformId !== source.platform_id || source.source_data.externalId !== source.external_id) return absent();
  const inspection = source.source_data.inspection;
  const originalUrl = typeof inspection?.reportUrl === 'string' && inspection.reportUrl.trim() ? inspection.reportUrl : null;
  const binding = object(enrichment?.binding), report = object(object(enrichment?.content).report);
  const enrichedPresence = binding.listingId === source.id && binding.provider === source.provider && binding.platformId === source.platform_id &&
    binding.externalId === source.external_id && binding.sourceRevision === source.source_revision && binding.sourceHash === source.source_hash && report.hasReport === true;
  return AdminReportSchema.parse({ hasReport: inspection?.hasReport === true || originalUrl !== null || enrichedPresence,
    url: publicLink(originalUrl, 'report', profile) });
}
const columns = `l.id,l.provider,l.platform_id,l.external_id,l.source_revision::text,l.source_hash,l.source_data,l.upstream_state,
  i.binding AS inspection_binding,i.content AS inspection_content`;
const from = 'FROM external_listings l LEFT JOIN external_inspection_enrichment i ON i.listing_id=l.id';
const project = (row: ReportRow) => projectSourceReport(row, row.inspection_binding ? { binding: row.inspection_binding, content: row.inspection_content } : null);

/** Authenticated callers use the URL; public/preview callers must pick only hasReport. Never performs HTTP. */
export async function getExternalReport(tx: Queryable, listingId: string): Promise<AdminReport> {
  const row = (await tx.query<ReportRow>(`SELECT ${columns} ${from} WHERE l.id=$1`, [listingId])).rows[0];
  return row ? project(row) : absent();
}

/** Staff copies have no provider key. Require one exact source triple across all providers; ambiguity fails closed. */
export async function getStaffReport(tx: Queryable, source: VehicleDraftSource): Promise<AdminReport> {
  if (source.kind !== 'external') return absent();
  const rows = (await tx.query<ReportRow>(`SELECT ${columns} ${from}
    WHERE l.platform_id=$1 AND l.external_id=$2 AND l.source_data->>'listingUrl'=$3 LIMIT 2`,
  [source.platform.id, source.externalId, source.listingUrl])).rows;
  return rows.length === 1 ? project(rows[0]!) : absent();
}
