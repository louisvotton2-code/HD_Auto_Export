import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import type { PoolClient } from 'pg';
import { classifyCapacityFailure, instrumentPoolCapacity } from './index.js';

function fakePool() {
  type Callback = (error: Error | undefined, client: PoolClient | undefined, done: () => void) => void;
  const pending: Callback[] = [];
  const release = () => undefined;
  const client = { release } as unknown as PoolClient;
  const value = {
    totalCount: 1, idleCount: 0,
    get waitingCount() { return pending.length; },
    connect(callback: Callback) { pending.push(callback); },
    complete(error?: Error) { pending.shift()!(error, error ? undefined : client, release); },
  };
  return { value, pool: value as unknown as pg.Pool, client, release };
}

test('optional pool diagnostics preserve promise and callback identities and collect bounded acquisition time', async () => {
  const { pool, value, client, release } = fakePool();
  let now = 0;
  const metrics = instrumentPoolCapacity(pool, () => now);
  const first = pool.connect();
  let received: unknown[] | undefined;
  pool.connect((...args) => { received = args; });
  assert.equal(metrics().pendingAcquires, 2);
  assert.equal(metrics().peakPoolWaiting, 2);
  now = 5; value.complete(); assert.equal(await first, client);
  now = 5001; value.complete();
  assert.deepEqual(received, [undefined, client, release]);
  assert.deepEqual(metrics(), { acquireStarted: 2, acquireSucceeded: 2, acquireFailed: 0, acquireTimeouts: 0,
    acquireElapsedTotalMs: 5006, acquireElapsedMaxMs: 5001,
    acquireElapsedBuckets: { le_1:0,le_10:1,le_50:0,le_100:0,le_500:0,le_1000:0,le_2500:0,le_5000:0,le_10000:1,gt_10000:0 },
    pendingAcquires: 0, peakPendingAcquires: 2, peakPoolWaiting: 2, totalConnections: 1, idleConnections: 0, waitingAcquires: 0 });
  const snapshot = metrics(); snapshot.acquireElapsedBuckets.le_10 = 999;
  assert.equal(metrics().acquireElapsedBuckets.le_10, 1);
});

test('only an actual acquisition-boundary queue timeout is tagged; original thrown errors are unchanged', async () => {
  const { pool, value } = fakePool();
  const metrics = instrumentPoolCapacity(pool, () => 0);
  const error = new Error('timeout exceeded when trying to connect');
  assert.deepEqual(classifyCapacityFailure(error), { code: 'OTHER', stage: 'unknown' });
  const work = pool.connect(); value.complete(error);
  await assert.rejects(work, candidate => candidate === error);
  assert.deepEqual(classifyCapacityFailure(error), { code: 'POOL_ACQUIRE_TIMEOUT', stage: 'pool_acquire' });
  assert.equal(metrics().acquireTimeouts, 1); assert.equal(metrics().acquireFailed, 1);
  const foreign = new Error('private-password-sentinel');
  const second = pool.connect(); value.complete(foreign);
  await assert.rejects(second, candidate => candidate === foreign);
  assert.deepEqual(classifyCapacityFailure(foreign), { code: 'POOL_ACQUIRE_ERROR', stage: 'pool_acquire' });
  assert.doesNotMatch(JSON.stringify(metrics()), /sentinel|message|stack|password/);
});

test('failure projection is an allowlist and SQL cancellation is not misreported as a proven timeout', () => {
  assert.deepEqual(classifyCapacityFailure({ code: '57014', message: 'secret query', stack: 'private' }),
    { code: 'SQL_STATEMENT_CANCELLED', stage: 'statement' });
  assert.deepEqual(classifyCapacityFailure({ code: 'ECONNREFUSED', message: 'private credentials' }),
    { code: 'DB_CONNECTION_REFUSED', stage: 'dependency' });
  for (const value of [null, 'password-sentinel', { code: 'password-sentinel' }, new Error('password-sentinel')])
    assert.deepEqual(classifyCapacityFailure(value), { code: 'OTHER', stage: 'unknown' });
});

test('synchronous acquisition errors retain behavior and do not leave pending diagnostics behind', () => {
  const error = new Error('private-sentinel');
  const pool = { totalCount:0,idleCount:0,waitingCount:0, connect() { throw error; } } as unknown as pg.Pool;
  const metrics = instrumentPoolCapacity(pool, () => 10);
  assert.throws(() => pool.connect(() => {}), candidate => candidate === error);
  assert.equal(metrics().pendingAcquires, 0); assert.equal(metrics().acquireFailed, 1);
  assert.deepEqual(classifyCapacityFailure(error), { code:'POOL_ACQUIRE_ERROR',stage:'pool_acquire' });
});
