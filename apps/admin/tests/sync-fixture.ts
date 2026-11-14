import { ExternalFullSyncStatusSchema, type ExternalFullSyncStatus } from '@hd/contracts/admin';

export function syncStatus(overrides: Partial<ExternalFullSyncStatus> = {}): ExternalFullSyncStatus {
  return ExternalFullSyncStatusSchema.parse({
    version: 7, mode: 'continuous', state: 'syncing', paused: false,
    asOf: '2026-11-14T01:00:00.000Z', lastSuccessAt: '2026-11-14T00:45:00.000Z', lastError: null,
    counts: { raw: 410, canonical: 300, public: 290, withdrawn: 10, failed: 2, pendingDetails: 30, pendingLocales: 20, pendingReports: 0 },
    snapshot: { id: '00000000-0000-4000-8000-000000000007', generatedAt: '2026-11-14T00:00:00.000Z', rows: 10000, staged: 6000, complete: false },
    receivedEvents: 900, appliedEvents: 870, nextRunAt: '2026-11-14T01:05:00.000Z', ...overrides,
  });
}
