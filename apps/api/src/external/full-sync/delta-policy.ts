import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { recordAudit } from '../../activity/service.js';
import type { Database } from '../../db/index.js';
import { checkDeltaEventAudit } from './delta-event-audit.js';
import { FullSyncError, type Actor } from './types.js';

export type DeltaPolicy = {
  phase: 'draining' | 'ready' | 'delta' | 'recovery' | 'blocked';
  snapshot_id: string | null;
  retained_snapshot_id: string | null;
  high_water: string | null;
  last_terminal_cursor: string | null;
  last_terminal_at: Date | null;
  audit_cursor: string;
  event_audit_cursor: string;
  audit_missing: string;
  audit_capacity_excluded: string;
  cursor_invalid: boolean;
  reason: 'cursor_expired' | 'confirmed_gap' | 'audit_gap' | 'recovery_limit' | null;
  recovery_since_at: Date | null;
  next_recovery_at: Date | number;
  recovery_anchor_cursor: string | null;
  recovery_previous_cursor: string | null;
  recovery_pending_receive: boolean;
  recovery_attempts: number;
  requested_by: string;
  evidence: string | null;
  updated_at: Date;
  transitioned_at: Date | null;
};

const operatorLimits = "SET LOCAL lock_timeout='200ms'; SET LOCAL statement_timeout='2s'";
const evidenceReference = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const anchorDate = z.iso.datetime().regex(/^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,3}))?Z$/);
const auditPosition = z.string().regex(/^(?:0|[1-9][0-9]{0,15})$/)
  .refine(value => Number.isSafeInteger(Number(value)));
const ResumeAuditRequest = z.strictObject({
  snapshotId: z.uuid(),
  snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  highWater: auditPosition,
  eventAuditCursor: auditPosition,
  evidence: z.string().regex(evidenceReference),
});

export async function readDeltaPolicy(connection: Pool | PoolClient, forUpdate = false): Promise<DeltaPolicy | undefined> {
  return (await connection.query<DeltaPolicy>(`SELECT phase,snapshot_id,retained_snapshot_id,high_water::text,
    last_terminal_cursor::text,last_terminal_at,
    audit_cursor::text,event_audit_cursor::text,audit_missing::text,audit_capacity_excluded::text,cursor_invalid,reason,requested_by,
    recovery_since_at,next_recovery_at,recovery_anchor_cursor::text,recovery_previous_cursor::text,recovery_pending_receive,recovery_attempts,
    evidence,updated_at,transitioned_at FROM external_full_delta_policy WHERE id=1${forUpdate ? ' FOR UPDATE' : ''}`)).rows[0];
}

export async function readDeltaPolicyStatus(db: Database) {
  const status = (await db.pool.query<{
    phase: DeltaPolicy['phase']; armed: boolean; snapshotId: string | null; snapshotState: string | null; snapshotDigest: string | null;
    snapshotRows: string | null; applyCursor: string | null; receiveCursor: string | null; retainedSnapshotId: string | null;
    lastTerminalCursor: string | null; lastTerminalAt: Date | null;
    nextDeltaAt: Date; lastReceiveAt: Date | null; nextSnapshotAt: Date | null; highWater: string | null;
    auditCursor: string; eventAuditCursor: string; auditMissing: string;
    auditCapacityExcluded: string; cursorInvalid: boolean; reason: DeltaPolicy['reason'];
    recoverySinceAt: Date | null; nextRecoveryAt: Date | null; recoveryAnchorCursor: string | null;
    recoveryPreviousCursor: string | null; recoveryPendingReceive: boolean; recoveryAttempts: number;
    paused: boolean; capacityPending: boolean; diskPaused: boolean; lastCapacityReason: string | null;
    evidence: string | null; updatedAt: Date; transitionedAt: Date | null;
  }>(`SELECT p.phase,p.phase='delta' AS armed,p.snapshot_id AS "snapshotId",s.state AS "snapshotState",
    s.sha256 AS "snapshotDigest",s.rows::text AS "snapshotRows",p.retained_snapshot_id AS "retainedSnapshotId",
    p.last_terminal_cursor::text AS "lastTerminalCursor",p.last_terminal_at AS "lastTerminalAt",
    s.apply_cursor::text AS "applyCursor",w.receive_cursor::text AS "receiveCursor",w.next_delta_at AS "nextDeltaAt",
    w.last_receive_at AS "lastReceiveAt",CASE WHEN isfinite(w.next_snapshot_at) THEN w.next_snapshot_at END AS "nextSnapshotAt",
    w.paused,w.capacity_pending AS "capacityPending",w.disk_paused AS "diskPaused",
    w.capacity_estimate->>'reason' AS "lastCapacityReason",
    p.high_water::text AS "highWater",p.audit_cursor::text AS "auditCursor",p.event_audit_cursor::text AS "eventAuditCursor",
    p.audit_missing::text AS "auditMissing",
    p.audit_capacity_excluded::text AS "auditCapacityExcluded",p.cursor_invalid AS "cursorInvalid",p.reason,p.evidence,
    p.recovery_since_at AS "recoverySinceAt",CASE WHEN isfinite(p.next_recovery_at) THEN p.next_recovery_at END AS "nextRecoveryAt",
    p.recovery_anchor_cursor::text AS "recoveryAnchorCursor",p.recovery_previous_cursor::text AS "recoveryPreviousCursor",
    p.recovery_pending_receive AS "recoveryPendingReceive",
    p.recovery_attempts AS "recoveryAttempts",
    p.updated_at AS "updatedAt",p.transitioned_at AS "transitionedAt"
    FROM external_full_delta_policy p JOIN external_full_sync w USING(id)
    LEFT JOIN external_full_snapshots s ON s.id=p.snapshot_id WHERE p.id=1`)).rows[0];
  return status ?? { phase: 'legacy' as const, armed: false };
}

export function deltaPolicyOperationError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === '42P01') throw new FullSyncError('SYNC_DELTA_MIGRATION_REQUIRED');
    if (error.code === '55P03' || error.code === '57014' || error.code === '40001') throw new FullSyncError('SYNC_DELTA_DB_BUSY');
  }
  throw error;
}

async function requireOperator(tx: PoolClient, actor: Actor) {
  await tx.query(operatorLimits);
  if (!(await tx.query("SELECT 1 FROM staff WHERE id=$1 AND role='admin' AND NOT banned FOR SHARE", [actor.id])).rowCount) {
    throw new FullSyncError('SYNC_ADMIN_REQUIRED');
  }
}

async function lockStoppedWorker(tx: PoolClient) {
  // The old binary also holds this lease. It may not start the next export between
  // checking the selected generation and persisting the new policy.
  if (!(await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(78291333) AS locked')).rows[0]?.locked) {
    throw new FullSyncError('SYNC_DELTA_WORKER_RUNNING');
  }
}

async function lockSync(tx: PoolClient) {
  const sync = (await tx.query<{ version: number; enabled: boolean; mode: string; receive_cursor: string | null }>(
    'SELECT version,enabled,mode,receive_cursor::text FROM external_full_sync WHERE id=1 FOR UPDATE',
  )).rows[0];
  if (!sync?.enabled || sync.mode !== 'continuous') throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
  return sync;
}

async function fencePeriodicSnapshot(tx: PoolClient, wakeDelta = false) {
  await tx.query(`UPDATE external_full_sync SET next_snapshot_at='infinity',version=version+1,
    next_delta_at=CASE WHEN $1 THEN least(next_delta_at,clock_timestamp()) ELSE next_delta_at END,
    updated_at=clock_timestamp() WHERE id=1`, [wakeDelta]);
}

export async function prepareDeltaPolicy(db: Database, actor: Actor, selectedSnapshotId: string) {
  if (!z.uuid().safeParse(selectedSnapshotId).success) throw new FullSyncError('SYNC_USAGE');
  const snapshotId = selectedSnapshotId.toLowerCase();
  return db.transaction(async tx => {
    await requireOperator(tx, actor);
    const current = await readDeltaPolicy(tx);
    if (current?.snapshot_id === snapshotId) return current;
    if (current) throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
    await lockStoppedWorker(tx);
    const { version } = await lockSync(tx);
    // A second CLI process may have committed while this one acquired the lease.
    const lockedPolicy = await readDeltaPolicy(tx);
    if (lockedPolicy?.snapshot_id === snapshotId) return lockedPolicy;
    if (lockedPolicy) throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
    const basis = (await tx.query<{ id: string; usable: boolean }>(`SELECT s.id,coalesce(
      s.archive_pruned_at IS NULL AND s.sha256 ~ '^[a-f0-9]{64}$' AND s.bytes>0 AND
      s.rows>0 AND s.staged=s.rows AND w.since_at<=s.generated_at AND
      ((s.state='verified' AND s.apply_cursor=0) OR
       (s.state='applying' AND s.apply_cursor>0 AND s.apply_cursor<s.rows) OR
       (s.state='complete' AND s.apply_cursor=s.rows AND s.completed_at IS NOT NULL)),false) AS usable
      FROM external_full_snapshots s CROSS JOIN external_full_sync w WHERE w.id=1
      ORDER BY s.created_at DESC,s.id DESC LIMIT 1`)).rows[0];
    if (!basis?.usable || basis.id !== snapshotId) throw new FullSyncError('SYNC_DELTA_SNAPSHOT_MISMATCH');
    await tx.query(`INSERT INTO external_full_delta_policy(id,phase,snapshot_id,requested_by)
      VALUES(1,'draining',$1,$2)`, [snapshotId, actor.id]);
    await fencePeriodicSnapshot(tx);
    await recordAudit(tx, actor, 'external.sync.delta.prepare', null, version, version + 1, [
      { path: 'sync.delta.snapshotId', before: null, after: snapshotId, beforePresent: false, afterPresent: true },
    ]);
    return (await readDeltaPolicy(tx))!;
  });
}

export async function armDeltaPolicy(db: Database, actor: Actor, selectedSnapshotId: string) {
  if (!z.uuid().safeParse(selectedSnapshotId).success) throw new FullSyncError('SYNC_USAGE');
  const snapshotId = selectedSnapshotId.toLowerCase();
  return db.transaction(async tx => {
    await requireOperator(tx, actor);
    const { version } = await lockSync(tx);
    const policy = await readDeltaPolicy(tx, true);
    if (policy?.snapshot_id !== snapshotId) throw new FullSyncError('SYNC_DELTA_SNAPSHOT_MISMATCH');
    if (policy.phase === 'delta') return policy;
    if (policy.phase !== 'ready') throw new FullSyncError('SYNC_DELTA_NOT_READY');
    const proof = (await tx.query<{ usable: boolean }>(`SELECT coalesce(
        s.state='complete' AND s.completed_at IS NOT NULL AND s.archive_pruned_at IS NULL AND
        s.sha256 ~ '^[a-f0-9]{64}$' AND s.bytes>0 AND s.rows>0 AND s.staged=s.rows AND s.apply_cursor=s.rows AND
        w.since_at<=s.generated_at AND p.audit_cursor=s.rows AND p.audit_missing=0 AND
        p.high_water IS NOT NULL AND p.event_audit_cursor=p.high_water AND w.receive_cursor>=p.high_water AND
        NOT p.cursor_invalid AND NOT p.recovery_pending_receive AND
        s.id=(SELECT id FROM external_full_snapshots ORDER BY created_at DESC,id DESC LIMIT 1) AND
        NOT EXISTS(SELECT 1 FROM external_full_snapshots WHERE state IN ('downloading','staging','verified','applying')),false) AS usable
      FROM external_full_delta_policy p JOIN external_full_sync w USING(id)
      JOIN external_full_snapshots s ON s.id=p.snapshot_id WHERE p.id=1`)).rows[0];
    if (!proof?.usable) throw new FullSyncError('SYNC_DELTA_NOT_READY');
    await tx.query(`UPDATE external_full_delta_policy SET phase='delta',retained_snapshot_id=snapshot_id,transitioned_at=clock_timestamp(),
      updated_at=clock_timestamp() WHERE id=1`);
    await fencePeriodicSnapshot(tx);
    await recordAudit(tx, actor, 'external.sync.delta.arm', null, version, version + 1, [
      { path: 'sync.delta.phase', before: 'ready', after: 'delta', beforePresent: true, afterPresent: true },
      { path: 'sync.delta.activatedHighWater', before: null, after: policy.high_water, beforePresent: false, afterPresent: true },
    ]);
    return (await readDeltaPolicy(tx))!;
  });
}

export async function resumeDeltaAudit(db: Database, actor: Actor, input: z.infer<typeof ResumeAuditRequest>) {
  const request = ResumeAuditRequest.safeParse(input);
  if (!request.success) throw new FullSyncError('SYNC_USAGE');
  const { snapshotSha256, highWater, eventAuditCursor, evidence } = request.data;
  const snapshotId = request.data.snapshotId.toLowerCase();
  if (BigInt(eventAuditCursor) >= BigInt(highWater)) throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');

  return db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await requireOperator(tx, actor);
    const { version } = await lockSync(tx);
    const policy = await readDeltaPolicy(tx, true);
    if (policy?.phase !== 'blocked' || policy.reason !== 'audit_gap' || policy.cursor_invalid ||
        policy.recovery_pending_receive || policy.snapshot_id !== snapshotId || policy.audit_missing !== '0' ||
        policy.high_water !== highWater || policy.event_audit_cursor !== eventAuditCursor) {
      throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
    }
    const snapshot = (await tx.query<{ generated_at: Date }>(`SELECT s.generated_at
      FROM external_full_snapshots s CROSS JOIN external_full_sync w
      WHERE s.id=$1 AND s.sha256=$2 AND s.state='complete' AND s.completed_at IS NOT NULL
        AND s.archive_pruned_at IS NULL AND s.bytes>0 AND s.rows>0 AND s.staged=s.rows AND s.apply_cursor=s.rows
        AND s.rows=$3::bigint AND w.id=1 AND w.receive_cursor>=$4::numeric AND w.since_at<=s.generated_at
        AND s.id=(SELECT id FROM external_full_snapshots ORDER BY created_at DESC,id DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM external_full_snapshots WHERE state IN ('downloading','staging','verified','applying'))`,
    [snapshotId, snapshotSha256, policy.audit_cursor, highWater])).rows[0];
    if (!snapshot) throw new FullSyncError('SYNC_DELTA_SNAPSHOT_MISMATCH');

    const batch = await checkDeltaEventAudit(tx, {
      snapshotId, generatedAt: snapshot.generated_at, after: eventAuditCursor, highWater,
      recoveryAnchorCursor: policy.recovery_anchor_cursor, recoveryPreviousCursor: policy.recovery_previous_cursor,
    });
    if (batch.status !== 'advance') throw new FullSyncError('SYNC_DELTA_AUDIT_NOT_CLEAR');

    // The worker rechecks this same batch. An operator never advances either audit cursor.
    await tx.query("UPDATE external_full_delta_policy SET phase='draining',reason=NULL,updated_at=clock_timestamp() WHERE id=1");
    await fencePeriodicSnapshot(tx);
    await recordAudit(tx, actor, 'external.sync.delta.resumeAudit', null, version, version + 1, [
      { path: 'sync.delta.phase', before: 'blocked', after: 'draining', beforePresent: true, afterPresent: true },
      { path: 'sync.delta.resumeEvidence', before: null, after: evidence, beforePresent: false, afterPresent: true },
      { path: 'sync.delta.resumeBoundary', before: null,
        after: { snapshotId, snapshotSha256, highWater, eventAuditCursor, checkedThrough: batch.through },
        beforePresent: false, afterPresent: true },
    ]);
    return (await readDeltaPolicy(tx))!;
  });
}

export async function requestDeltaReconciliation(db: Database, actor: Actor, evidence: string, since: string, anchorCursor: string) {
  if (!evidenceReference.test(evidence)) throw new FullSyncError('SYNC_DELTA_EVIDENCE_INVALID');
  const date = anchorDate.safeParse(since);
  const exactDate = since.includes('.') ?
    since.slice(0, 20) + since.slice(20, -1).padEnd(3, '0') + 'Z' : since.slice(0, -1) + '.000Z';
  if (!date.success || !Number.isFinite(Date.parse(since)) || since.startsWith('0000-') ||
    new Date(since).toISOString() !== exactDate ||
    !/^(0|[1-9][0-9]{0,15})$/.test(anchorCursor) || !Number.isSafeInteger(Number(anchorCursor))) {
    throw new FullSyncError('SYNC_DELTA_RECOVERY_ANCHOR_INVALID');
  }
  return db.transaction(async tx => {
    await requireOperator(tx, actor);
    const { version, receive_cursor: previousCursor } = await lockSync(tx);
    const policy = await readDeltaPolicy(tx, true);
    if (policy?.evidence === evidence) {
      const matches = (await tx.query<{ matches: boolean }>(`SELECT recovery_since_at=$1::timestamptz
        AND recovery_anchor_cursor=$2::numeric AS matches
        FROM external_full_delta_policy WHERE id=1`, [since, anchorCursor])).rows[0]?.matches;
      if (!matches) throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
      return policy;
    }
    if (policy?.phase !== 'delta' && policy?.phase !== 'blocked' && policy?.phase !== 'recovery') {
      throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
    }
    if (policy.recovery_pending_receive || (policy.phase === 'recovery' && policy.evidence !== null)) {
      throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
    }
    const activeSnapshot = (await tx.query(`SELECT 1 FROM external_full_snapshots
      WHERE state IN ('downloading','staging','verified','applying') LIMIT 1`)).rowCount;
    if (activeSnapshot) throw new FullSyncError('SYNC_DELTA_STATE_CONFLICT');
    const anchored = (await tx.query<{ valid: boolean }>(`SELECT coalesce($1::timestamptz<=last_receive_at AND (
      ($2::numeric=receive_cursor AND $3::boolean) OR
      ($2::numeric<receive_cursor AND EXISTS (SELECT 1 FROM external_full_receipts
        WHERE cursor_key='cursor:'||$2::text AND complete))),false) AS valid
      FROM external_full_sync WHERE id=1`, [since, anchorCursor, policy.reason === 'cursor_expired' && policy.cursor_invalid])).rows[0]?.valid;
    if (previousCursor === null || !anchored) throw new FullSyncError('SYNC_DELTA_RECOVERY_ANCHOR_INVALID');
    await tx.query(`UPDATE external_full_delta_policy SET phase='recovery',snapshot_id=NULL,high_water=NULL,
      retained_snapshot_id=coalesce(retained_snapshot_id,snapshot_id),last_terminal_cursor=NULL,last_terminal_at=NULL,
      audit_cursor=0,event_audit_cursor=0,audit_missing=0,audit_capacity_excluded=0,
      reason=CASE WHEN reason='cursor_expired' THEN reason ELSE 'confirmed_gap' END,
      recovery_since_at=$3::timestamptz,recovery_previous_cursor=$4::numeric,recovery_anchor_cursor=$5::numeric,
      recovery_pending_receive=true,recovery_attempts=0,
      next_recovery_at='-infinity',requested_by=$1,evidence=$2,updated_at=clock_timestamp(),transitioned_at=NULL
      WHERE id=1`, [actor.id, evidence, since, previousCursor, anchorCursor]);
    await fencePeriodicSnapshot(tx, true);
    await recordAudit(tx, actor, 'external.sync.delta.reconcile', null, version, version + 1, [
      { path: 'sync.delta.phase', before: policy.phase, after: 'recovery', beforePresent: true, afterPresent: true },
      { path: 'sync.delta.evidence', before: policy.evidence, after: evidence, beforePresent: policy.evidence !== null, afterPresent: true },
      { path: 'sync.delta.recoveryAnchorCursor', before: policy.recovery_anchor_cursor, after: anchorCursor,
        beforePresent: policy.recovery_anchor_cursor !== null, afterPresent: true },
    ]);
    return (await readDeltaPolicy(tx))!;
  });
}
