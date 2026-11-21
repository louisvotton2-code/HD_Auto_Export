import type { PoolClient } from 'pg';
import type { Database } from '../db/index.js';

type VisitOutcome = 'counted' | 'duplicate' | 'expired';
type CoverageStatus = 'complete' | 'partial';
type CoverageOutcome = 'accepted' | 'expired';

const visitWindow = "interval '60 minutes'";
const deliveryWindow = "interval '2 minutes'";
const timeZone = "'Asia/Shanghai'";
const retainedSince = (clock: string) => `(((${clock} AT TIME ZONE ${timeZone})::date - 89)::timestamp AT TIME ZONE ${timeZone})`;
const freshAt = (observed: string, clock: string) => `${observed} BETWEEN (${clock} - ${deliveryWindow}) AND ${clock}`;

const visitSql = `
 WITH eligible AS MATERIALIZED (
   SELECT $1::bytea AS digest, $2::timestamptz AS observed_at
   WHERE ${freshAt('$2::timestamptz', 'coalesce($3::timestamptz, statement_timestamp())')}
 ), claimed AS (
   INSERT INTO analytics_ip_visit_keys AS k(digest,accepted_at,expires_at)
   SELECT digest,observed_at,observed_at+${visitWindow}+${deliveryWindow} FROM eligible
   ON CONFLICT (digest) DO UPDATE SET accepted_at=excluded.accepted_at,expires_at=excluded.expires_at
   WHERE excluded.accepted_at>=k.accepted_at+${visitWindow}
   RETURNING accepted_at
 ), counted AS (
   INSERT INTO analytics_ip_visit_hourly AS h(hour,visits)
   SELECT date_trunc('hour',accepted_at,${timeZone}),1 FROM claimed
   ON CONFLICT (hour) DO UPDATE SET visits=h.visits+1
   RETURNING 1
 )
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM eligible) THEN 'expired'
   ELSE coalesce((SELECT CASE WHEN ${freshAt('$2::timestamptz', 'coalesce($3::timestamptz, clock_timestamp())')}
       THEN 'counted' ELSE 'expired_write' END FROM counted),'duplicate')
   END AS outcome`;

const expiredWrite = Symbol('IP visit expired while waiting on database locks');

/** Only the derived HMAC reaches PostgreSQL. A counted visit and its hour are committed together. */
export async function recordIpVisit(db: Database, digest: Buffer, observedAt: string, testClock?: Date): Promise<VisitOutcome> {
  if (digest.length !== 32) throw new Error('Expected a 32-byte visit digest');
  try {
    return await db.transaction(async tx => {
      await tx.query("SET LOCAL statement_timeout='450ms'; SET LOCAL lock_timeout='150ms'");
      const result = await tx.query<{ outcome: VisitOutcome | 'expired_write' }>(visitSql, [digest, observedAt, testClock ?? null]);
      const outcome = result.rows[0]!.outcome;
      // A near-expiry replay can race a concurrent prune. Recheck after obtaining the aggregate row, then roll back both writes.
      if (outcome === 'expired_write') throw expiredWrite;
      return outcome;
    });
  } catch (error) {
    if (error === expiredWrite) return 'expired';
    throw error;
  }
}

const coverageSql = `
 WITH eligible AS MATERIALIZED (
   SELECT $1::timestamptz AS hour,$2::text AS status
   FROM (SELECT coalesce($3::timestamptz,statement_timestamp()) AS now) clock
   WHERE $1::timestamptz=date_trunc('hour',$1::timestamptz,${timeZone})
     AND $1::timestamptz+interval '1 hour'+${deliveryWindow}<=clock.now
     AND $1::timestamptz>=${retainedSince('clock.now')}
 ), sealed AS (
   INSERT INTO analytics_ip_visit_coverage AS c(hour,status)
   SELECT hour,status FROM eligible
   ON CONFLICT (hour) DO UPDATE SET status='partial'
   WHERE excluded.status='partial' AND c.status='complete'
 )
 SELECT EXISTS(SELECT 1 FROM eligible) AS accepted`;

/** A replay is idempotent. When producers disagree, a partial hour stays partial. */
export async function recordIpVisitCoverage(db: Database, hour: string, status: CoverageStatus, testClock?: Date): Promise<CoverageOutcome> {
  return db.transaction(async tx => {
    await tx.query("SET LOCAL statement_timeout='450ms'; SET LOCAL lock_timeout='150ms'");
    const result = await tx.query<{ accepted: boolean }>(coverageSql, [hour, status, testClock ?? null]);
    return result.rows[0]!.accepted ? 'accepted' : 'expired';
  });
}

const pruneLimit = 10_000;
const pruneClock = 'coalesce($1::timestamptz, statement_timestamp())';
const pruneSql = `
 WITH keys AS (
   DELETE FROM analytics_ip_visit_keys WHERE ctid=ANY(ARRAY(
     SELECT ctid FROM analytics_ip_visit_keys WHERE expires_at<=${pruneClock}
     ORDER BY expires_at LIMIT ${pruneLimit} FOR UPDATE SKIP LOCKED
   )) RETURNING 1
 ), counts AS (
   DELETE FROM analytics_ip_visit_hourly WHERE ctid=ANY(ARRAY(
     SELECT ctid FROM analytics_ip_visit_hourly WHERE hour<${retainedSince(pruneClock)}
     ORDER BY hour LIMIT ${pruneLimit} FOR UPDATE SKIP LOCKED
   )) RETURNING 1
 ), coverage AS (
   DELETE FROM analytics_ip_visit_coverage WHERE ctid=ANY(ARRAY(
     SELECT ctid FROM analytics_ip_visit_coverage WHERE hour<${retainedSince(pruneClock)}
     ORDER BY hour LIMIT ${pruneLimit} FOR UPDATE SKIP LOCKED
   )) RETURNING 1
 )
 SELECT greatest((SELECT count(*) FROM keys),(SELECT count(*) FROM counts),(SELECT count(*) FROM coverage))>=${pruneLimit} AS backlog`;

export async function pruneIpVisits(tx: PoolClient, testClock?: Date): Promise<boolean> {
  const result = await tx.query<{ backlog: boolean }>(pruneSql, [testClock ?? null]);
  return result.rows[0]!.backlog;
}
