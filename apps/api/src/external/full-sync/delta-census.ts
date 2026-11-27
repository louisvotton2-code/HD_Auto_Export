import type { PoolClient } from 'pg';
import { DEFAULT_FORMAL_LISTING_LIMIT } from '../formal-admission.js';
import { FullSyncError, type Locale, type Source } from './types.js';

const censusChunkRows = 2_000;

export type QueuedDetail = {
  source: Source;
  external_id: string;
  generation: string;
  locales: Locale[];
  priority: number;
  replay_id: string | null;
};

/** Select only admitted, unstaged work actually holding up this CSV census block. */
export async function findDeltaAuditDetails(
  tx: PoolClient,
  source: Source,
  alreadySelected: string[],
  limit: number,
): Promise<QueuedDetail[]> {
  const {rows} = await tx.query<QueuedDetail>(`
    WITH current_block AS MATERIALIZED (
      SELECT s.id, s.generated_at, p.audit_cursor
      FROM external_full_delta_policy p JOIN external_full_snapshots s ON s.id = p.snapshot_id
      WHERE p.id = 1 AND p.phase = 'draining' AND p.high_water IS NOT NULL
        AND NOT p.cursor_invalid AND p.audit_missing = 0
        AND s.state = 'complete' AND s.staged = s.rows AND s.apply_cursor = s.rows
        AND s.archive_pruned_at IS NULL AND p.audit_cursor < s.rows
        AND NOT EXISTS (
          SELECT 1 FROM external_full_work urgent JOIN external_full_members m USING (source, external_id)
          WHERE urgent.kind = 'detail' AND urgent.priority >= 100 AND urgent.attempts < 5
            AND urgent.due_at <= now() AND urgent.generation = m.desired_generation AND m.state <> 'withdrawn'
        )
    )
    SELECT w.source, w.external_id, w.generation, w.locales, w.priority, NULL::uuid AS replay_id
    FROM current_block b JOIN external_full_stage s ON s.snapshot_id = b.id
      AND s.row_number > b.audit_cursor AND s.row_number <= b.audit_cursor + $3
    JOIN external_formal_admissions a USING (source, external_id)
    JOIN external_full_members m USING (source, external_id)
    JOIN external_full_work w USING (source, external_id)
    WHERE s.source = $1 AND s.external_id <> ALL($2::text[])
      AND m.state = 'pending' AND m.last_snapshot = b.id AND w.generation = m.desired_generation
      AND w.kind = 'detail' AND w.priority <= 50 AND w.attempts < 5 AND w.due_at <= now() AND w.locales = '{}'
      AND NOT EXISTS (
        SELECT 1 FROM external_ingestion_identity_state i
        WHERE i.provider = 'chinacarapi' AND i.source = s.source AND i.external_id = s.external_id
          AND i.withdrawn AND i.business_at >= b.generated_at
      ) AND NOT EXISTS (
        SELECT 1 FROM external_full_admission_replay_items item
        WHERE item.source = w.source AND item.external_id = w.external_id
          AND item.detail_generation = w.generation AND item.state = 'scheduled'
      )
    ORDER BY s.row_number LIMIT $4`, [source, alreadySelected, censusChunkRows, limit]);
  return rows;
}

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
