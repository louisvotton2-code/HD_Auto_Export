import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const usage = 'v2-capacity.mjs <cold|warm|sync|redis-failure|contact|contact-failure|analytics|analytics-failure|rate-limit> <20|50|100> <requests>';
const phases = new Set(['cold', 'warm', 'sync', 'redis-failure', 'contact', 'contact-failure', 'analytics', 'analytics-failure', 'rate-limit']);
const filters = [
  ['landing', 'locale=ru'],
  ['common', 'locale=ru&make=toyota'],
  ['rare', 'locale=en&make=scale-rare'],
  ['filtered', 'locale=zh&powertrain=bev&yearMin=2020&priceMin=60000&priceMax=120000&priceCurrency=CNY'],
];
const routes = filters.flatMap(([workload, args]) => {
  const query = `view=localized&catalog=curated&${args}`;
  return [
    { family: 'list', workload, url: `/api/v1/vehicles?${query}&projection=card&pageSize=24` },
    { family: 'facets', workload, url: `/api/v1/vehicle-filters?${query}&projection=overview` },
  ];
});
const gates = { p95Ms: 800, errorRate: 0.01 };
// Deterministic published staff sample 100 from the 500k seed.
const contactVehicleId = '10000000-0000-4000-8000-000000000064';
const contactChannel = 'whatsapp';

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return Math.round(sorted[Math.ceil(p * sorted.length) - 1] * 10) / 10;
}

function summarize(results, successCode) {
  const statuses = {};
  const latencies = [];
  for (const { status, elapsed } of results) {
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (status === successCode) latencies.push(elapsed);
  }
  latencies.sort((a, b) => a - b);
  return {
    requests: results.length,
    successes: latencies.length,
    statuses,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    errorRate: (results.length - latencies.length) / results.length,
    limited429: statuses[429] ?? 0,
    minRetryAfterSeconds: results.reduce((min, entry) => {
      if (entry.status !== 429 || !entry.retryAfterSeconds) return min;
      return min === null ? entry.retryAfterSeconds : Math.min(min, entry.retryAfterSeconds);
    }, null),
  };
}

async function request(app, options) {
  const started = performance.now();
  try {
    const response = await app.inject(options);
    return {
      status: response.statusCode,
      retryAfterSeconds: Number(response.headers['retry-after']) || null,
      elapsed: performance.now() - started,
    };
  } catch {
    return { status: 'transport-error', elapsed: performance.now() - started };
  }
}

function catalogAddress(index) {
  // Addresses are assigned only to Fastify's in-process synthetic sockets.
  return `198.18.${Math.floor(index / 250)}.${index % 250 + 1}`;
}

async function runCatalog(app, collector, phase, concurrency, requests) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < requests) {
      const index = next++;
      const routeIndex = index % routes.length;
      const remoteAddress = phase === 'rate-limit' ? '198.19.0.1' : catalogAddress(index);
      const result = await collector.run(routeIndex, () =>
        request(app, { method: 'GET', url: routes[routeIndex].url, remoteAddress }));
      results[index] = { routeIndex, ...result };
    }
  }));
  return results;
}

function collectAnalytics(app, phase) {
  const eventIds = Array.from({ length: phase === 'analytics-failure' ? 1 : 20 }, () => randomUUID());
  const result = Promise.all(eventIds.map(async (eventId, index) => {
    // The short analytics burst overlaps with the catalog run.
    await delay(index * 50);
    const startedAt = performance.now();
    const delivery = await request(app, {
      method: 'POST', url: '/api/v1/analytics/events', remoteAddress: '198.19.0.2',
      headers: { origin: 'http://localhost', host: 'localhost', 'sec-fetch-site': 'same-origin' },
      payload: { events: [{ eventId, type: 'page_view', pageType: 'catalog', locale: 'zh' }] },
    });
    return { ...delivery, startedAt };
  }));
  return { eventIds, result };
}

async function offerContactClicks(app, offers) {
  return Promise.all(Array.from({ length: offers }, async (_, index) => {
    await delay(index * 50);
    const startedAt = performance.now();
    const delivery = await request(app, {
      method: 'POST', url: '/api/v1/analytics/contact-count', remoteAddress: '127.0.0.1',
      headers: { origin: 'http://localhost', host: 'localhost', 'sec-fetch-site': 'same-origin' },
      payload: { vehicleId: contactVehicleId, channel: contactChannel },
    });
    return { ...delivery, startedAt };
  }));
}

async function storedContactClicks(pool) {
  const { rows: [{ clicks }] } = await pool.query(`SELECT coalesce(sum(clicks), 0)::float8 AS clicks
    FROM analytics_contact_hourly WHERE vehicle_id=$1 AND supplier=false AND channel=$2`, [contactVehicleId, contactChannel]);
  return clicks;
}

async function takeDatabaseSnapshot(pool) {
  const { rows: [row] } = await pool.query(`SELECT clock_timestamp() AS "at", current_database() AS "name",
    pg_database_size(current_database())::float8 AS "databaseBytes", numbackends AS "databaseConnections",
    blks_read::float8 AS "blocksRead", blks_hit::float8 AS "blocksHit", temp_bytes::float8 AS "tempBytes",
    deadlocks::float8 AS "deadlocks", xact_commit::float8 AS "commits", xact_rollback::float8 AS "rollbacks"
    FROM pg_stat_database WHERE datname=current_database()`);
  return row;
}

async function catalogCache(app) {
  const response = await app.inject({ url: '/health/catalog-cache' });
  if (response.statusCode !== 200) throw new Error('Synthetic cache metrics unavailable');
  return response.json().metrics;
}

function cgroupLimit(file) {
  try {
    return readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim();
  } catch {
    return null;
  }
}

function cgroupCounters() {
  const cpu = cgroupLimit('cpu.stat');
  if (!cpu) return {};
  return Object.fromEntries(cpu.split('\n').map(line => {
    const [key, value] = line.split(' ');
    return [key, Number(value)];
  }));
}

async function run(phase, concurrency, requests) {
  const { buildApp } = await import('/app/apps/api/dist/app.js');
  const { readConfig } = await import('/app/apps/api/dist/config.js');
  const { createDatabase } = await import('/app/apps/api/dist/db/index.js');
  const { capacityFailureCollector } = await import('/app/apps/api/dist/external/scale-bench.js');
  const config = readConfig();
  const database = new URL(config.databaseUrl);
  const syncFromGeneration = Number(process.env.CAPACITY_SYNC_GENERATION);
  const queuedLoads = process.env.EXTERNAL_CACHE_MAX_QUEUED_LOADS;
  if (!config.externalScale || config.environment !== 'test' || database.hostname !== 'postgres-scale' ||
      database.pathname !== '/hd_ext_scale_v2capacity' || config.deployment.environment !== 'test' ||
      config.publicCache.redis?.host !== 'redis-scale' || config.publicCache.redis.port !== (phase === 'redis-failure' ? 1 : 6379) ||
      !/^[a-f0-9]{40}$/.test(config.deployment.releaseId) || (phase === 'sync' &&
        (!Number.isSafeInteger(syncFromGeneration) || syncFromGeneration < 1 || syncFromGeneration > 99_999)) ||
      (queuedLoads !== undefined && config.publicCache.maxQueuedLoads !== Number(queuedLoads))) {
    throw new Error('Expected the dedicated v2 capacity fixture and exact test release');
  }

  const collector = capacityFailureCollector(routes.length);
  const observer = createDatabase(config.databaseUrl, 1);
  let runtime;
  let locked;
  try {
    const { rows: [{ vehicles }] } = await observer.pool.query(`SELECT (
      (SELECT count(*) FROM external_catalog) +
      (SELECT count(*) FROM vehicles WHERE publication_state='published')
    )::int AS vehicles`);
    if (vehicles < 500_000 || vehicles > 501_000) throw new Error('Expected approximately 500,000 public synthetic vehicles');
    runtime = await buildApp(config, { onPublicFailure: collector.observe });
    const { app } = runtime;
    if (!['cold', 'redis-failure'].includes(phase)) {
      for (const { url } of routes) {
        if ((await request(app, { method: 'GET', url })).status !== 200) throw new Error('Catalog warmup failed');
      }
    }
    const cacheBefore = await catalogCache(app);
    const databaseBefore = await takeDatabaseSnapshot(observer.pool);
    const contactPhase = ['contact', 'contact-failure'].includes(phase);
    const contactBefore = contactPhase ? await storedContactClicks(observer.pool) : null;
    if (['analytics-failure', 'contact-failure'].includes(phase)) {
      locked = await observer.pool.connect();
      await locked.query('BEGIN');
      const table = contactPhase ? 'analytics_contact_hourly' : 'analytics_event_receipts';
      await locked.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE NOWAIT`);
    }
    const cgroupBefore = cgroupCounters();
    const started = performance.now();
    const usageBefore = process.cpuUsage();
    const analyticsWork = ['analytics', 'analytics-failure'].includes(phase) ? collectAnalytics(app, phase) : null;
    const contactWork = contactPhase ? offerContactClicks(app, phase === 'contact-failure' ? 1 : 20) : null;
    const results = await runCatalog(app, collector, phase, concurrency, requests);
    const elapsedMs = performance.now() - started;
    const cpu = process.cpuUsage(usageBefore);
    const cgroupAfter = cgroupCounters();
    if (locked) {
      await (contactWork ?? analyticsWork.result);
      await locked.query('ROLLBACK');
      locked.release();
      locked = null;
    }
    const { rows: [{ at: catalogEndedAt }] } = await observer.pool.query('SELECT clock_timestamp() AS "at"');
    const cacheAfter = await catalogCache(app);
    const families = Object.fromEntries(['list', 'facets'].map(family => [
      family, summarize(results.filter(({ routeIndex }) => routes[routeIndex].family === family), 200),
    ]));
    let analytics = null;
    if (analyticsWork) {
      const delivery = await analyticsWork.result;
      const acceptedIds = analyticsWork.eventIds.filter((_, index) => delivery[index].status === 202);
      const { rows } = await observer.pool.query('SELECT event_id FROM analytics_event_receipts WHERE event_id = ANY($1::uuid[])',
        [analyticsWork.eventIds]);
      const receipts = new Set(rows.map(row => row.event_id));
      analytics = {
        ...summarize(delivery, 202), persisted: receipts.size,
        offeredWithoutReceipt: delivery.length - receipts.size,
        acceptedWithoutReceipt: acceptedIds.filter(id => !receipts.has(id)).length,
        startedDuringCatalog: delivery.filter(result => result.startedAt <= started + elapsedMs).length,
        fault: phase === 'analytics-failure' ? 'isolated receipt table lock' : null,
      };
    }
    let sync = null;
    let contact = null;
    if (contactWork) {
      const delivery = await contactWork;
      const persisted = (await storedContactClicks(observer.pool)) - contactBefore;
      contact = {
        ...summarize(delivery, 204), persisted,
        offeredWithoutCount: delivery.length - persisted,
        startedDuringCatalog: delivery.filter(result => result.startedAt <= started + elapsedMs).length,
        fault: phase === 'contact-failure' ? 'isolated hourly contact table lock' : null,
      };
    }
    if (phase === 'sync') {
      const { rows: [counts] } = await observer.pool.query(`SELECT count(*) FILTER
        (WHERE queued_at <= $2 AND (completed_at IS NULL OR completed_at >= $1))::int AS overlapping,
        count(*) FILTER (WHERE completed_at BETWEEN $1 AND $2)::int AS completed
        FROM external_sync_events
        WHERE substring(event_key FROM '^sample-([0-9]+)-')::int >= $3`, [databaseBefore.at, catalogEndedAt, syncFromGeneration]);
      sync = { fromGeneration: syncFromGeneration, ...counts };
    }
    // PostgreSQL reports cumulative counters after backends flush their local statistics.
    await delay(1100);
    const databaseAfter = await takeDatabaseSnapshot(observer.pool);
    const databaseDelta = Object.fromEntries(['blocksRead', 'blocksHit', 'tempBytes', 'deadlocks',
      'commits', 'rollbacks'].map(key => [key, databaseAfter[key] - databaseBefore[key]]));
    const catalogCgroup = Object.fromEntries(['usage_usec', 'nr_throttled', 'throttled_usec']
      .filter(key => key in cgroupBefore && key in cgroupAfter).map(key => [key, cgroupAfter[key] - cgroupBefore[key]]));
    const cacheDelta = Object.fromEntries(['localHits', 'redisHits', 'misses', 'originLoads', 'redisErrors', 'rejectedLoads',
      'versionRetries', 'timeouts', 'uncachedFilterLoads'].map(key => [key, cacheAfter[key] - cacheBefore[key]]));
    const overall = summarize(results, 200);
    const catalogPassed = Object.values(families).every(result =>
      result.p95Ms !== null && result.p95Ms <= gates.p95Ms && result.errorRate < gates.errorRate);
    const expectations = {
      cold: cacheDelta.redisHits === 0 && cacheDelta.originLoads > 0,
      warm: cacheDelta.localHits + cacheDelta.redisHits > 0,
      sync: sync?.completed > 0,
      'redis-failure': cacheDelta.redisErrors > 0,
      contact: contact?.persisted > 0 && contact.persisted === contact.successes && contact.startedDuringCatalog > 0,
      'contact-failure': contact?.statuses[503] === 1 && contact.persisted === 0 && contact.startedDuringCatalog > 0,
      analytics: analytics?.acceptedWithoutReceipt === 0 && analytics.persisted > 0 && analytics.startedDuringCatalog > 0,
      'analytics-failure': analytics?.statuses[503] === 1 && analytics?.persisted === 0 && analytics.startedDuringCatalog > 0,
      'rate-limit': overall.limited429 > 0 && overall.minRetryAfterSeconds !== null,
    };
    return {
      fixture: 'v2-synthetic-scale', release: config.deployment.releaseId,
      vehicles, transport: 'fastify-inject', phase, concurrency,
      runtimeLimits: { cpuMax: cgroupLimit('cpu.max'), memoryMaxBytes: cgroupLimit('memory.max'), architecture: process.arch },
      cacheSettings: { ttlMs: config.publicCache.ttlMs, maxConcurrentLoads: config.publicCache.maxConcurrentLoads,
        maxQueuedLoads: config.publicCache.maxQueuedLoads },
      elapsedMs: Math.round(elapsedMs), requestsPerSecond: Math.round(1000 * requests / elapsedMs),
      catalogCpuMicros: cpu, catalogCgroup,
      overall, families, routes: routes.map((route, index) => ({
        ...route, ...summarize(results.filter(sample => sample.routeIndex === index), 200), failReasons: collector.reasons(index),
      })),
      cacheDelta, cacheAfter, databaseBefore, databaseAfter, databaseDelta, apiPool: runtime.db.capacityMetrics(),
      unattributedFailures: collector.unattributedFailures(), analytics, contact, sync, gates,
      catalogPassedAt20: concurrency === 20 && phase !== 'rate-limit' ? catalogPassed : null,
      phaseEvidencePassed: expectations[phase],
    };
  } finally {
    try {
      if (locked) {
        try { await locked.query('ROLLBACK'); }
        finally { locked.release(); }
      }
      await runtime?.app.close();
    } finally {
      await observer.close();
    }
  }
}

const [phase, concurrencyArg, requestsArg, extra] = process.argv.slice(2);
const concurrency = Number(concurrencyArg);
const requests = Number(requestsArg);
if (phase === '--help') {
  console.log(usage);
} else if (!phases.has(phase) || ![20, 50, 100].includes(concurrency) || !Number.isInteger(requests) ||
    requests < concurrency || requests > 10_000 || extra !== undefined ||
    (phase === 'cold' && requests !== concurrency) || (phase === 'rate-limit' && requests <= 120)) {
  console.error(usage);
  process.exitCode = 2;
} else {
  try {
    const report = await run(phase, concurrency, requests);
    console.log(JSON.stringify(report));
    if (!report.phaseEvidencePassed || report.catalogPassedAt20 === false) process.exitCode = 1;
  } catch (error) {
    const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,45}$/.test(error.code) ? ` (${error.code})` : '';
    // Dependency errors can contain connection details. Only pass through authored errors.
    const message = /^Expected |^Catalog warmup failed$|^Synthetic cache metrics unavailable$/.test(error.message)
      ? error.message : 'Synthetic v2 capacity run failed';
    console.error(`${message}${code}`);
    process.exitCode = 2;
  }
}
