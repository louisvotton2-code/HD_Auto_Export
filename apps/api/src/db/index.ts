import pg, { type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { performance } from 'node:perf_hooks';

export type CapacityFailureCode = 'POOL_ACQUIRE_TIMEOUT' | 'POOL_ACQUIRE_ERROR' | 'SQL_STATEMENT_CANCELLED' |
  'DB_CONNECTION_REFUSED' | 'DB_CONNECTION_TIMEOUT' | 'DB_TOO_MANY_CONNECTIONS' | 'DB_CONNECTION_LOST' |
  'DB_SHUTDOWN' | 'SERVICE_UNAVAILABLE' | 'RATE_LIMITED' | 'OTHER';
type CapacityStage = 'pool_acquire' | 'statement' | 'dependency' | 'request' | 'unknown';
export type PublicFailureDiagnostic = { route: '/api/v1/vehicles' | '/api/v1/vehicle-filters' |
  '/api/v1/vehicles/:id' | '/api/v1/home/vehicles'; status: number; code: CapacityFailureCode; stage: CapacityStage };
type Failure = Pick<PublicFailureDiagnostic, 'code' | 'stage'>;
const acquiredFailures = new WeakMap<object, Failure>();
/** Only fixed classifications leave this boundary; never return an error's message, stack, query or arbitrary code. */
export function classifyCapacityFailure(error: unknown): Failure {
  if (!error || typeof error !== 'object') return { code: 'OTHER', stage: 'unknown' };
  const acquired = acquiredFailures.get(error);
  if (acquired) return acquired;
  const code = 'code' in error ? error.code : undefined;
  switch (code) {
    case '57014': return { code: 'SQL_STATEMENT_CANCELLED', stage: 'statement' };
    case 'ECONNREFUSED': return { code: 'DB_CONNECTION_REFUSED', stage: 'dependency' };
    case 'ETIMEDOUT': return { code: 'DB_CONNECTION_TIMEOUT', stage: 'dependency' };
    case '53300': return { code: 'DB_TOO_MANY_CONNECTIONS', stage: 'dependency' };
    case '08006': case 'ECONNRESET': return { code: 'DB_CONNECTION_LOST', stage: 'dependency' };
    case '57P01': return { code: 'DB_SHUTDOWN', stage: 'dependency' };
    case 'SERVICE_UNAVAILABLE': return { code: 'SERVICE_UNAVAILABLE', stage: 'request' };
    case 'RATE_LIMITED': return { code: 'RATE_LIMITED', stage: 'request' };
    default: return { code: 'OTHER', stage: 'unknown' };
  }
}
export type PoolCapacityMetrics = {
  acquireStarted: number; acquireSucceeded: number; acquireFailed: number; acquireTimeouts: number;
  acquireElapsedTotalMs: number; acquireElapsedMaxMs: number; acquireElapsedBuckets: Record<string, number>;
  pendingAcquires: number; peakPendingAcquires: number; peakPoolWaiting: number;
  totalConnections: number; idleConnections: number; waitingAcquires: number;
};

/** Opt-in private diagnostics. Acquisition elapsed includes creating a connection, not just queue waiting. */
export function instrumentPoolCapacity(pool: pg.Pool, now: () => number = () => performance.now()) {
  const bounds = [1, 10, 50, 100, 500, 1000, 2500, 5000, 10000];
  const buckets: Record<string, number> = Object.fromEntries([...bounds.map(n => `le_${n}`), 'gt_10000'].map(key => [key, 0]));
  const metrics = { acquireStarted: 0, acquireSucceeded: 0, acquireFailed: 0, acquireTimeouts: 0,
    acquireElapsedTotalMs: 0, acquireElapsedMaxMs: 0, pendingAcquires: 0, peakPendingAcquires: 0, peakPoolWaiting: 0 };
  const original = pool.connect.bind(pool);
  type Callback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;
  const connect = (callback: Callback) => {
    const start = now();
    metrics.acquireStarted++; metrics.pendingAcquires++;
    metrics.peakPendingAcquires = Math.max(metrics.peakPendingAcquires, metrics.pendingAcquires);
    let completed = false;
    const finish = (error: unknown) => {
      if (completed) return; completed = true;
      metrics.pendingAcquires--;
      const elapsed = Math.max(0, now() - start);
      metrics.acquireElapsedTotalMs += elapsed;
      metrics.acquireElapsedMaxMs = Math.max(metrics.acquireElapsedMaxMs, elapsed);
      const bucket = bounds.find(bound => elapsed <= bound);
      buckets[bucket === undefined ? 'gt_10000' : `le_${bucket}`]!++;
      if (!error) metrics.acquireSucceeded++;
      else {
        metrics.acquireFailed++;
        // pg-pool 3.x has no error code for this exact queue timeout. Match only at its connect boundary.
        const timeout = error instanceof Error && ['timeout exceeded when trying to connect',
          'Connection terminated due to connection timeout'].includes(error.message);
        if (timeout) metrics.acquireTimeouts++;
        if (typeof error === 'object' && error !== null) {
          const known = classifyCapacityFailure(error);
          acquiredFailures.set(error, { stage: 'pool_acquire', code: timeout ? 'POOL_ACQUIRE_TIMEOUT' :
            known.code === 'OTHER' ? 'POOL_ACQUIRE_ERROR' : known.code });
        }
      }
    };
    try {
      original((error, client, done) => { finish(error); callback(error, client, done); });
      metrics.peakPoolWaiting = Math.max(metrics.peakPoolWaiting, pool.waitingCount);
    } catch (error) { finish(error); throw error; }
  };
  pool.connect = ((callback?: Callback) => {
    if (callback) return connect(callback);
    return new Promise<PoolClient>((resolve, reject) => connect((error, client) => {
      if (error) reject(error); else resolve(client!);
    }));
  }) as typeof pool.connect;
  return (): PoolCapacityMetrics => ({ ...metrics,
    acquireElapsedTotalMs: Math.round(metrics.acquireElapsedTotalMs * 10) / 10,
    acquireElapsedMaxMs: Math.round(metrics.acquireElapsedMaxMs * 10) / 10,
    acquireElapsedBuckets: { ...buckets }, totalConnections: pool.totalCount, idleConnections: pool.idleCount,
    waitingAcquires: pool.waitingCount });
}

export function createDatabase(url: string, max = 5, diagnostics = false) {
  const pool = new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 });
  const capacityMetrics = diagnostics ? instrumentPoolCapacity(pool) : () => null;
  // An idle connection failure must not become an uncaught process exception.
  pool.on('error', () => { /* Next request/readiness check reports dependency failure without connection details. */ });
  return {
    pool, orm: drizzle(pool, { schema }), capacityMetrics,
    async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
export type Database = ReturnType<typeof createDatabase>;
