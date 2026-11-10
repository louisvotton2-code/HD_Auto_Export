import { setTimeout as delay } from 'node:timers/promises';
import { makeExternalCandidateFixture } from '@hd/contracts/fixtures';
import { readConfig } from '../../config.js';
import { createDatabase } from '../../db/index.js';
import { readDatabaseEnvironment } from '../../local-secrets.js';
import { enqueueFakeEvents, SyntheticSyncWorker, syncHealth, type FakeEvent } from './worker.js';

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error('Invalid synthetic worker limit.');
  return n;
}

function seedEvents(generation: number): FakeEvent[] {
  const events: FakeEvent[] = [];
  const revision = generation * 2;
  for (let index = 1; index <= 32; index++) {
    const lane = index <= 24 ? 'delta' : 'reconcile';
    const id = `scale-worker-${index}`;
    const candidate = makeExternalCandidateFixture(index);
    candidate.externalId = id;
    candidate.revision = revision;
    candidate.listingUrl = `https://listings.example.invalid/vehicles/${id}`;
    events.push({ key: `sample-${generation}-${index}`, lane, candidate });
  }
  const first = events[0]!.candidate;
  events.push({ key: `sample-${generation}-withdraw`, lane: 'delta', candidate: {
    operation: 'withdraw', platformId: first.platformId, externalId: first.externalId,
    fetchedAt: first.fetchedAt, sourceUpdatedAt: first.sourceUpdatedAt, revision: revision + 1,
  } });
  return events;
}

async function main() {
  const [command, seedGeneration] = process.argv.slice(2);
  if (!['--run', '--once', '--health', '--seed'].includes(command ?? '') ||
    (command !== '--seed' && process.argv.length !== 3) || (command === '--seed' && process.argv.length > 4)) {
    console.error('Usage: external:sync --run | --once | --health | --seed [generation]');
    process.exitCode = 1;
    return;
  }
  const env = readDatabaseEnvironment();
  const config = readConfig({
    DATABASE_URL: env.DATABASE_URL, NODE_ENV: env.NODE_ENV, HOST: env.HOST,
    TRANSLATION_PROVIDER: env.TRANSLATION_PROVIDER, EXTERNAL_CATALOG_MODE: env.EXTERNAL_CATALOG_MODE,
    AUTH_SECRET: 'synthetic-worker-no-http-session-placeholder',
  });
  if (!config.externalScale || config.translation.provider !== 'disabled') throw new Error('Synthetic worker configuration is required.');
  const max = boundedInteger(env.EXTERNAL_SYNC_POOL_MAX, 2, 1, 5);
  const idle = boundedInteger(env.EXTERNAL_SYNC_IDLE_MS, 1000, 250, 10_000);
  const db = createDatabase(config.databaseUrl, max);
  const worker = new SyntheticSyncWorker(db);
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    if (command === '--seed') {
      const generation = boundedInteger(seedGeneration, 1, 1, 100_000);
      console.log(JSON.stringify(await enqueueFakeEvents(db, seedEvents(generation), true)));
      return;
    }
    if (command === '--health') {
      const health = await syncHealth(db);
      console.log(JSON.stringify(health));
      process.exitCode = health.ready ? 0 : 1;
      return;
    }
    if (command === '--once') {
      console.log(JSON.stringify(await worker.tick()));
      return;
    }
    await db.pool.query("DELETE FROM external_sync_heartbeats WHERE seen_at<clock_timestamp()-interval '1 day'");
    let failed = 0;
    while (!stop.signal.aborted) {
      let wait = idle;
      try {
        const result = await worker.tick();
        failed = 0;
        await worker.heartbeat('ready');
        if (result.processed) console.log(JSON.stringify(result));
      } catch {
        failed = Math.min(7, failed + 1);
        wait = Math.min(30_000, idle * 2 ** failed);
        await worker.heartbeat('retrying').catch(() => {});
        console.error(JSON.stringify({ status: 'retrying' }));
      }
      if (!stop.signal.aborted) await delay(wait, undefined, { signal: stop.signal }).catch(error => {
        if (!stop.signal.aborted) throw error;
      });
    }
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    try { if (command === '--run') await worker.removeHeartbeat(); }
    finally { await db.close(); }
  }
}

try {
  await main();
} catch (error) {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,45}$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({ status: 'unavailable', ...(code ? { code } : {}) }));
  process.exitCode = 1;
}
