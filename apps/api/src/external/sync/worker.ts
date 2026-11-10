import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ExternalCandidateSchema, type ExternalCandidate, type ExternalImportBatchRequest } from '@hd/contracts/admin';
import type { Database } from '../../db/index.js';
import { ExternalStore } from '../store.js';
import { jsonHash } from '../normalize.js';
import { publicLink, syntheticProfile } from '../profiles.js';

export const SYNC_DELTA_INTERVAL_MS = 5 * 60_000;
export const SYNC_RECONCILE_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const LEASE_SECONDS = 45;
const PAGE_SIZE = 32;
const ACTOR_ID = 'ext02-synthetic-worker';
type Lane = 'delta' | 'reconcile';
export type FakeEvent = { key: string; lane: Lane; candidate: ExternalCandidate };
export type Lease = { owner: string; fence: string };
type Due = { delta: boolean; reconcile: boolean };
type EventRow = { seq: string; candidate: ExternalCandidate };
type MediaRow = { media_id: string; media_revision: number; revision: number; active: boolean; visible: boolean; url: string };

export type TickResult = {
  action: 'leased' | 'idle' | 'withdrawals' | Lane | 'media';
  processed: number;
  checkpoint?: string;
};

export async function enqueueFakeEvents(db: Database, input: FakeEvent[], runSoon = false) {
  if (input.length < 1 || input.length > 250) throw new Error('Synthetic feed accepts one bounded page of events.');
  const events = input.map(event => {
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(event.key) || !['delta', 'reconcile'].includes(event.lane)) throw new Error('Invalid synthetic event identity.');
    return { ...event, candidate: ExternalCandidateSchema.parse(event.candidate) };
  });
  return db.transaction(async tx => {
    const row = (await tx.query<{ enqueued_seq: string }>('SELECT enqueued_seq FROM external_sync_state WHERE id=1 FOR UPDATE')).rows[0]!;
    let head = BigInt(row.enqueued_seq);
    let inserted = 0;
    for (const { key, lane, candidate } of events) {
      const hash = jsonHash({ lane, candidate });
      const prior = (await tx.query<{ source_hash: string }>('SELECT source_hash FROM external_sync_events WHERE event_key=$1', [key])).rows[0];
      if (prior) {
        if (prior.source_hash !== hash) throw new Error('Synthetic event identity already has different content.');
        continue;
      }
      head += 1n;
      await tx.query('INSERT INTO external_sync_events(seq,event_key,lane,candidate,source_hash) VALUES($1,$2,$3,$4,$5)',
        [head.toString(), key, lane, JSON.stringify(candidate), hash]);
      inserted += 1;
    }
    if (inserted) {
      await tx.query(`UPDATE external_sync_state SET enqueued_seq=$1,
        next_delta_at=CASE WHEN $2 THEN clock_timestamp() ELSE next_delta_at END,
        next_reconcile_at=CASE WHEN $2 THEN clock_timestamp() ELSE next_reconcile_at END WHERE id=1`, [head.toString(), runSoon]);
    }
    return { inserted, head: head.toString() };
  });
}

export async function claimSyncLease(db: Database, owner: string): Promise<Lease | null> {
  const claimed = await db.pool.query<{ fence: string }>(`WITH available AS (
    SELECT id FROM external_sync_state WHERE id=1 AND retry_at<=clock_timestamp()
      AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) FOR UPDATE SKIP LOCKED
  ) UPDATE external_sync_state s SET lease_owner=$1, lease_expires_at=clock_timestamp()+$2*interval '1 second',
    fence=fence+1 FROM available a WHERE s.id=a.id RETURNING s.fence`, [owner, LEASE_SECONDS]);
  return claimed.rows[0] ? { owner, fence: claimed.rows[0].fence } : null;
}

async function releaseFailure(db: Database, lease: Lease) {
  await db.pool.query(`UPDATE external_sync_state SET lease_owner=NULL,lease_expires_at=NULL,
    consecutive_failures=least(consecutive_failures+1,8),
    retry_at=clock_timestamp()+least(30,power(2,consecutive_failures))*interval '1 second'
    WHERE id=1 AND lease_owner=$1 AND fence=$2`, [lease.owner, lease.fence]);
}

async function auditActor(tx: PoolClient) {
  // This local actor has no credential row and cannot create staff sessions.
  await tx.query(`INSERT INTO staff(id,name,email,role,banned)
    VALUES($1,'Synthetic sync worker','ext02-worker@example.invalid','editor',true) ON CONFLICT(id) DO NOTHING`, [ACTOR_ID]);
  const valid = await tx.query(`SELECT 1 FROM staff s WHERE id=$1 AND email='ext02-worker@example.invalid' AND banned
    AND NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE a.user_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM staff_sessions t WHERE t.user_id=s.id)`, [ACTOR_ID]);
  if (!valid.rowCount) throw new Error('Synthetic worker audit identity is unavailable.');
}

async function nextEvents(tx: PoolClient, due: Due): Promise<{ action: 'withdrawals' | Lane; rows: EventRow[] } | null> {
  const withdrawals = await tx.query<EventRow>(`SELECT seq,candidate FROM external_sync_events WHERE completed_at IS NULL
    AND is_withdrawal ORDER BY seq LIMIT $1`, [PAGE_SIZE]);
  if (withdrawals.rowCount) return { action: 'withdrawals', rows: withdrawals.rows };
  for (const lane of ['delta', 'reconcile'] as const) {
    if (!due[lane]) continue;
    const pending = await tx.query<EventRow>(`SELECT seq,candidate FROM external_sync_events WHERE completed_at IS NULL
      AND NOT is_withdrawal AND lane=$1 ORDER BY seq LIMIT $2`, [lane, PAGE_SIZE]);
    if (pending.rowCount) return { action: lane, rows: pending.rows };
    await finishLane(tx, lane, false);
  }
  return null;
}

async function finishLane(tx: PoolClient, lane: Lane, more: boolean) {
  const delay = more ? 0 : lane === 'delta' ? SYNC_DELTA_INTERVAL_MS : SYNC_RECONCILE_INTERVAL_MS;
  const column = lane === 'delta' ? 'next_delta_at' : 'next_reconcile_at';
  await tx.query(`UPDATE external_sync_state SET ${column}=clock_timestamp()+$1*interval '1 millisecond' WHERE id=1`, [delay]);
}

async function importEvents(tx: PoolClient, store: ExternalStore, action: 'withdrawals' | Lane, rows: EventRow[]) {
  await auditActor(tx);
  const input: ExternalImportBatchRequest = { provider: syntheticProfile.id, records: rows.map(({ candidate }) => ({
    raw: JSON.stringify({ source: 'synthetic-scale-worker', candidate }), candidate,
  })) };
  const key = 'sync-' + jsonHash(rows.map(row => row.seq));
  const result = await store.importBatchWithClient(tx, input, key, { id: ACTOR_ID, requestId: key });
  await tx.query('UPDATE external_sync_events SET batch_id=$2,completed_at=clock_timestamp() WHERE seq=ANY($1::bigint[])',
    [rows.map(row => row.seq), result.id]);
  if (action !== 'withdrawals') {
    const more = await tx.query('SELECT 1 FROM external_sync_events WHERE lane=$1 AND completed_at IS NULL AND NOT is_withdrawal LIMIT 1', [action]);
    await finishLane(tx, action, !!more.rowCount);
  }
}

async function refreshMedia(tx: PoolClient) {
  // Do not take the catalog writer lock during an empty heartbeat tick.
  const hasWork = await tx.query(`SELECT 1 WHERE EXISTS(
    SELECT 1 FROM external_media_refresh_requests r JOIN external_media m ON m.id=r.media_id
    JOIN external_listings l ON l.id=m.listing_id WHERE r.completed_at IS NULL AND l.provider=$1
  ) OR EXISTS(
    SELECT 1 FROM external_media m JOIN external_listings l ON l.id=m.listing_id
    JOIN external_catalog c ON c.listing_id=l.id WHERE m.active AND m.expires_at<=clock_timestamp() AND l.provider=$1
      AND NOT EXISTS(SELECT 1 FROM external_media_refresh_requests r WHERE r.media_id=m.id AND r.media_revision=m.revision)
  )`, [syntheticProfile.id]);
  if (!hasWork.rowCount) return 0;
  // Share the importer lock so a supplier revision or staff withdrawal cannot race this write.
  await tx.query('SELECT pg_advisory_xact_lock(78291332)');
  await tx.query(`INSERT INTO external_media_refresh_requests(media_id,media_revision)
    SELECT m.id,m.revision FROM external_media m JOIN external_listings l ON l.id=m.listing_id
    JOIN external_catalog c ON c.listing_id=l.id WHERE m.active AND m.expires_at<=clock_timestamp() AND l.provider=$1
      AND NOT EXISTS(SELECT 1 FROM external_media_refresh_requests r WHERE r.media_id=m.id AND r.media_revision=m.revision)
    ORDER BY m.expires_at,m.id LIMIT $2 ON CONFLICT DO NOTHING`, [syntheticProfile.id, PAGE_SIZE]);
  const pending = await tx.query<MediaRow>(`SELECT r.media_id,r.media_revision,m.revision,m.active,m.url,
      (c.listing_id IS NOT NULL AND l.upstream_state='active') AS visible
    FROM external_media_refresh_requests r JOIN external_media m ON m.id=r.media_id
    JOIN external_listings l ON l.id=m.listing_id LEFT JOIN external_catalog c ON c.listing_id=l.id
    WHERE r.completed_at IS NULL AND l.provider=$1 ORDER BY r.queued_at,r.media_id,r.media_revision LIMIT $2`, [syntheticProfile.id, PAGE_SIZE]);
  let updated = false;
  for (const item of pending.rows) {
    let outcome: 'refreshed' | 'obsolete' | 'unsafe_source' = 'obsolete';
    if (item.media_revision === item.revision && item.active && item.visible) {
      const replacement = `https://photos.example.invalid/refresh/${item.media_id}/${item.revision + 1}.webp`;
      if (publicLink(item.url, 'media', syntheticProfile) && publicLink(replacement, 'media', syntheticProfile)) {
        await tx.query(`UPDATE external_media SET url=$2,revision=revision+1,refreshed_at=clock_timestamp(),
          expires_at=clock_timestamp()+interval '1 day' WHERE id=$1 AND revision=$3`, [item.media_id, replacement, item.revision]);
        outcome = 'refreshed';
        updated = true;
      } else outcome = 'unsafe_source';
    }
    await tx.query(`UPDATE external_media_refresh_requests SET outcome=$3,completed_at=clock_timestamp()
      WHERE media_id=$1 AND media_revision=$2`, [item.media_id, item.media_revision, outcome]);
  }
  if (updated) await tx.query('UPDATE external_catalog_state SET revision=revision+1 WHERE id=1');
  return pending.rows.length;
}

export class SyntheticSyncWorker {
  readonly owner = randomUUID();
  private readonly store: ExternalStore;
  constructor(private readonly db: Database) {
    this.store = new ExternalStore(db, syntheticProfile);
  }

  async runLease(lease: Lease): Promise<TickResult> {
    if (lease.owner !== this.owner) return { action: 'leased', processed: 0 };
    return this.db.transaction(async tx => {
      const due = (await tx.query<Due>(`UPDATE external_sync_state
        SET lease_expires_at=clock_timestamp()+$3*interval '1 second'
        WHERE id=1 AND lease_owner=$1 AND fence=$2 AND lease_expires_at>clock_timestamp()
        RETURNING next_delta_at<=clock_timestamp() AS delta,next_reconcile_at<=clock_timestamp() AS reconcile`,
        [lease.owner, lease.fence, LEASE_SECONDS])).rows[0];
      if (!due) return { action: 'leased', processed: 0 };

      let action: TickResult['action'] = 'idle';
      let processed = 0;
      const job = await nextEvents(tx, due);
      if (job) {
        action = job.action;
        await importEvents(tx, this.store, action, job.rows);
        processed = job.rows.length;
      } else {
        processed = await refreshMedia(tx);
        if (processed) action = 'media';
      }
      const result = await tx.query<{ checkpoint: string }>(`UPDATE external_sync_state
        SET checkpoint=coalesce((SELECT min(seq)-1 FROM external_sync_events WHERE completed_at IS NULL),enqueued_seq),
            consecutive_failures=0,retry_at='-infinity',lease_owner=NULL,lease_expires_at=NULL
        WHERE id=1 AND lease_owner=$1 AND fence=$2 AND lease_expires_at>clock_timestamp() RETURNING checkpoint`,
        [lease.owner, lease.fence]);
      if (!result.rowCount) throw new Error('Synthetic sync lease expired before commit.');
      return { action, processed, checkpoint: result.rows[0]!.checkpoint };
    });
  }

  async tick(): Promise<TickResult> {
    const lease = await claimSyncLease(this.db, this.owner);
    if (!lease) return { action: 'leased', processed: 0 };
    try { return await this.runLease(lease); }
    catch (error) {
      await releaseFailure(this.db, lease).catch(() => {});
      throw error;
    }
  }

  async heartbeat(status: 'ready' | 'retrying') {
    await this.db.pool.query(`INSERT INTO external_sync_heartbeats(worker_id,seen_at,status) VALUES($1,clock_timestamp(),$2)
      ON CONFLICT(worker_id) DO UPDATE SET seen_at=excluded.seen_at,status=excluded.status`, [this.owner, status]);
  }

  async removeHeartbeat() {
    await this.db.pool.query('DELETE FROM external_sync_heartbeats WHERE worker_id=$1', [this.owner]);
  }
}

export async function syncHealth(db: Database) {
  const result = await db.pool.query<{ ready: boolean; checkpoint: string; enqueued_seq: string }>(`SELECT s.checkpoint,s.enqueued_seq,
    EXISTS(SELECT 1 FROM external_sync_heartbeats WHERE status='ready' AND seen_at>clock_timestamp()-interval '30 seconds')
    AND s.consecutive_failures=0 AS ready FROM external_sync_state s WHERE s.id=1`);
  const row = result.rows[0];
  return { ready: row?.ready ?? false, checkpoint: row?.checkpoint ?? null, enqueued: row?.enqueued_seq ?? null };
}
