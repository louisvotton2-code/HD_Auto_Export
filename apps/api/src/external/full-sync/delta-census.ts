import type { PoolClient } from 'pg';
import { DEFAULT_FORMAL_LISTING_LIMIT } from '../formal-admission.js';
import { FullSyncError } from './types.js';

const censusChunkRows = 2_000;

type DeltaSnapshotChunk = {
  cursor: string;
  missing: string;
  capacityExcluded: string;
  pending: string;
};

/** Check one ordinal range of the retained CSV without reading any supplier payload. */
export async function scanDeltaSnapshotChunk(
  tx: PoolClient,
  snapshotId: string,
  after: string,
): Promise<DeltaSnapshotChunk> {
  const result = await tx.query<DeltaSnapshotChunk>(`
    WITH bounds AS MATERIALIZED (
      SELECT s.id, s.generated_at, $2::bigint AS previous_row,
        $2::bigint + least(s.rows - $2::bigint, $3::bigint) AS through_row,
        a.admitted_count >= a.admission_limit
          AND (a.admission_limit <= $4 OR s.target_rows = a.admission_limit) AS at_ceiling
      FROM external_full_snapshots s CROSS JOIN external_formal_admission_state a
      WHERE s.id = $1 AND a.id = 1 AND s.state = 'complete'
        AND s.rows > 0 AND s.staged = s.rows AND s.apply_cursor = s.rows
        AND s.archive_pruned_at IS NULL AND $2::bigint BETWEEN 0 AND s.rows
    ), staged AS MATERIALIZED (
      SELECT s.source, s.external_id
      FROM bounds b JOIN external_full_stage s
        ON s.snapshot_id = b.id AND s.row_number > b.previous_row AND s.row_number <= b.through_row
      ORDER BY s.row_number LIMIT $3
    ), traced AS (
      SELECT CASE
        WHEN w.withdrawn AND w.business_at >= b.generated_at THEN 'covered'
        WHEN m.state = 'withdrawn' AND m.business_at >= b.generated_at THEN 'covered'
        WHEN a.source IS NOT NULL AND (
          m.last_snapshot = b.id OR (
            m.event_order > 0 AND m.business_at >= b.generated_at AND EXISTS (
              SELECT 1 FROM external_full_events e
              WHERE e.event_id = m.event_order AND e.source = m.source AND e.external_id = m.external_id
                AND e.business_at = m.business_at AND e.operation IN ('upsert', 'relist')
                AND e.applied_at IS NOT NULL AND e.error_code IS NULL AND e.detail_generation IS NOT NULL
            )
          )
        ) THEN CASE
          WHEN m.state = 'active' AND m.last_detail_at IS NOT NULL AND m.applied_generation > 0 THEN 'covered'
          WHEN m.state <> 'withdrawn' AND EXISTS (
            SELECT 1 FROM external_full_work work
            WHERE work.source = m.source AND work.external_id = m.external_id
              AND work.kind = 'detail' AND work.generation = m.desired_generation AND work.attempts < 5
          ) THEN 'pending'
          ELSE 'missing'
        END
        WHEN a.source IS NULL AND m.source IS NULL AND b.at_ceiling THEN 'capacity_excluded'
        ELSE 'missing'
      END AS outcome
      FROM staged s CROSS JOIN bounds b
      LEFT JOIN external_formal_admissions a ON a.source = s.source AND a.external_id = s.external_id
      LEFT JOIN external_full_members m ON m.source = s.source AND m.external_id = s.external_id
      LEFT JOIN external_ingestion_identity_state w
        ON w.provider = 'chinacarapi' AND w.source = s.source AND w.external_id = s.external_id AND w.withdrawn
    )
    SELECT b.through_row::text AS cursor,
      (b.through_row - b.previous_row - counts.staged + counts.missing)::text AS missing,
      counts.capacity_excluded::text AS "capacityExcluded", counts.pending::text AS pending
    FROM bounds b CROSS JOIN (
      SELECT count(*) AS staged, count(*) FILTER (WHERE outcome = 'missing') AS missing,
        count(*) FILTER (WHERE outcome = 'capacity_excluded') AS capacity_excluded,
        count(*) FILTER (WHERE outcome = 'pending') AS pending
      FROM traced
    ) counts`,
    [snapshotId, after, censusChunkRows, DEFAULT_FORMAL_LISTING_LIMIT]);

  const chunk = result.rows[0];
  if (!chunk) throw new FullSyncError('SYNC_DELTA_AUDIT_SNAPSHOT_INVALID');
  return chunk;
}
