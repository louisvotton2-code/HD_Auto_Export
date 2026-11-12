import type { ExternalInspection } from '@hd/contracts/public';

export function hasInspectionContent(inspection: ExternalInspection | null | undefined): boolean {
  return Boolean(inspection && (inspection.entries.length || inspection.checks?.length || inspection.defects?.length));
}
