import type { PoolClient } from 'pg';

export const relistHistoryCycles = 4;
const historyPriceLimit = 8;
export const relistHistoryEventLimit = 2 * relistHistoryCycles + historyPriceLimit;

export type StoredRelistHistoryEvent = {
  event_id: string;
  source: string;
  external_id: string;
  business_at: string;
  payload_hash: string;
  document_refs: unknown;
  applied_at: string;
  detail_updated_at: string | null;
  public_effective_at: string | null;
  public_outcome: string;
  prior_public_price: string | null;
  generation: string;
};

type LedgerRow = Omit<StoredRelistHistoryEvent, 'applied_at' | 'generation'> & {
  member_event_id: string;
  operation: string;
  source_type: string | null;
  error_code: string | null;
  received_at: string;
  applied_at: string | null;
  generation: string | null;
  was_public: boolean | null;
};

type MaterializedEvent = StoredRelistHistoryEvent & { detail_updated_at: string };

type Cycle = {
  withdrawal: StoredRelistHistoryEvent;
  relist: MaterializedEvent & { public_outcome: 'effective' | 'not_public' };
  prices: MaterializedEvent[];
};

function isApplied(row: LedgerRow): row is LedgerRow & { applied_at: string; generation: string } {
  return row.applied_at !== null && row.applied_at >= row.received_at &&
    row.applied_at >= row.business_at && row.error_code === null && row.generation !== null;
}

function withdrawalThenRelist(w: LedgerRow, r: LedgerRow): Cycle | null {
  if (!isApplied(w) || !isApplied(r) || w.operation !== 'withdraw' || w.source_type !== 'removed' ||
      w.was_public !== true || w.public_outcome !== 'effective' || !w.public_effective_at ||
      w.public_effective_at < w.applied_at || w.public_effective_at > r.applied_at ||
      r.operation !== 'relist' || r.source_type !== 'relisted' || r.was_public !== false ||
      w.business_at >= r.business_at || BigInt(w.generation) + 1n !== BigInt(r.generation) ||
      !r.detail_updated_at || r.detail_updated_at < r.applied_at) return null;
  const outcome = r.public_outcome;
  if (outcome !== 'effective' && outcome !== 'not_public') return null;
  if (outcome === 'effective' ? r.public_effective_at !== r.detail_updated_at : r.public_effective_at !== null) return null;
  return { withdrawal: w, relist: { ...r, detail_updated_at: r.detail_updated_at, public_outcome: outcome }, prices: [] };
}

function effectivePrice(row: LedgerRow, previous: MaterializedEvent): MaterializedEvent | null {
  if (!isApplied(row) || row.operation !== 'upsert' || row.source_type !== 'price' || row.was_public !== true ||
      row.public_outcome !== 'effective' || !row.detail_updated_at || row.public_effective_at !== row.detail_updated_at ||
      row.detail_updated_at < row.applied_at || previous.detail_updated_at > row.applied_at ||
      previous.business_at >= row.business_at || BigInt(previous.generation) + 1n !== BigInt(row.generation)) return null;
  return { ...row, detail_updated_at: row.detail_updated_at };
}

/** Read a contiguous same-identity chain through the committed current member. */
export async function readSupersededRelistChain(tx: PoolClient, eventId: string, highWater: string): Promise<Cycle[] | null> {
  const rows = (await tx.query<LedgerRow>(`WITH scope AS MATERIALIZED (
    SELECT target.source,target.external_id,m.event_order,prior.event_id AS first_event
    FROM external_full_events target
    JOIN external_full_members m ON (m.source,m.external_id)=(target.source,target.external_id)
    JOIN external_full_sync sync ON sync.id=1 AND sync.receive_cursor>=m.event_order
    JOIN LATERAL (
      SELECT e.event_id FROM external_full_events e
      WHERE (e.source,e.external_id)=(target.source,target.external_id) AND e.event_id<target.event_id
      ORDER BY e.event_id DESC LIMIT 1
    ) prior ON true
    WHERE target.event_id=$1 AND target.event_id<=$2 AND target.operation='relist' AND m.event_order>target.event_id
  ) SELECT e.event_id::text,e.source,e.external_id,s.event_order::text AS member_event_id,
    e.operation,e.source_type,e.error_code,e.payload_hash,e.document_refs,e.detail_generation::text AS generation,
    e.was_public,e.public_outcome,e.prior_public_price::text,
    to_char(e.business_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS business_at,
    to_char(e.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at,
    to_char(e.applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS applied_at,
    to_char(e.detail_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS detail_updated_at,
    to_char(e.public_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS public_effective_at
    FROM scope s CROSS JOIN LATERAL (
      SELECT e.* FROM external_full_events e WHERE (e.source,e.external_id)=(s.source,s.external_id)
        AND e.event_id BETWEEN s.first_event AND s.event_order
      ORDER BY e.event_id LIMIT $3
    ) e ORDER BY e.event_id`, [eventId, highWater, relistHistoryEventLimit + 1])).rows;
  const last = rows.at(-1);
  if (rows.length < 4 || rows.length > relistHistoryEventLimit || last?.operation !== 'relist' ||
      rows[1]?.event_id !== eventId || last.event_id !== last.member_event_id) return null;

  const cycles: Cycle[] = [];
  let priceCount = 0;
  for (let i = 0; i < rows.length;) {
    const withdrawal = rows[i];
    const relist = rows[i + 1];
    if (!withdrawal || !relist || cycles.length === relistHistoryCycles) return null;
    const cycle = withdrawalThenRelist(withdrawal, relist);
    if (!cycle) return null;
    const previous = cycles.at(-1);
    if (previous) {
      const preceding = previous.prices.at(-1) ?? previous.relist;
      const gap = BigInt(cycle.withdrawal.generation) - BigInt(preceding.generation);
      // Preserve the relist-only proof when its own public receipt accounts for a generation gap.
      if (preceding.business_at >= cycle.withdrawal.business_at ||
          preceding.detail_updated_at > cycle.withdrawal.applied_at || gap <= 0n ||
          (gap > 1n && (previous.prices.length > 0 || previous.relist.public_outcome !== 'effective'))) return null;
    }
    i += 2;
    while (rows[i]?.source_type === 'price') {
      const price = effectivePrice(rows[i]!, cycle.prices.at(-1) ?? cycle.relist);
      if (!price || ++priceCount > historyPriceLimit) return null;
      cycle.prices.push(price);
      i++;
    }
    cycles.push(cycle);
  }
  return cycles;
}
