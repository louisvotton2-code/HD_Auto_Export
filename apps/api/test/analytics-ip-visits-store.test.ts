import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { pruneIpVisits, recordIpVisit, recordIpVisitCoverage } from '../src/analytics/ip-visits-store.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';

const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1'
  || address.pathname !== '/postgres' || address.search || address.hash) {
  throw new Error('IP visit tests require a loopback maintenance database.');
}
const name = `hd_api_test_ip_visits_${randomBytes(8).toString('hex')}`;
const target = new URL(address);
target.pathname = `/${name}`;
const maintenance = createDatabase(address.href, 1);
const db = createDatabase(target.href, 3);
let created = false;

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await maintenance.pool.query(`ALTER DATABASE "${name}" SET timezone TO 'America/Los_Angeles'`);
  await migrateDatabase(db);
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE analytics_ip_visit_keys, analytics_ip_visit_hourly, analytics_ip_visit_coverage');
});
after(async () => {
  await db.close();
  try {
    if (created) await maintenance.pool.query(`DROP DATABASE "${name}"`);
  } finally {
    await maintenance.close();
  }
});

const first = '2026-11-21T10:59:00+08:00';
const digest = Buffer.alloc(32, 17);
const at = (time: string) => new Date(time);
const visits = async () => (await db.pool.query<{ hour: Date; visits: number }>(
  'SELECT hour,visits::int FROM analytics_ip_visit_hourly ORDER BY hour')).rows.map(row => [row.hour.toISOString(), row.visits]);

test('the visit window crosses hour boundaries and duplicates never extend its duration', async () => {
  const duplicate = '2026-11-21T11:01:00+08:00';
  const stillDuplicate = '2026-11-21T11:58:59.999+08:00';
  const next = '2026-11-21T11:59:00+08:00';
  assert.equal(await recordIpVisit(db, digest, first, at(first)), 'counted');
  assert.equal(await recordIpVisit(db, digest, duplicate, at(duplicate)), 'duplicate');
  assert.equal(await recordIpVisit(db, digest, stillDuplicate, at(stillDuplicate)), 'duplicate');
  const key = (await db.pool.query<{ accepted_at: Date; expires_at: Date }>(
    'SELECT accepted_at,expires_at FROM analytics_ip_visit_keys WHERE digest=$1', [digest])).rows[0]!;
  assert.equal(key.accepted_at.toISOString(), at(first).toISOString());
  assert.equal(+key.expires_at - +key.accepted_at, 62 * 60_000);
  assert.equal(await recordIpVisit(db, digest, next, at(next)), 'counted');
  assert.deepEqual(await visits(), [['2026-11-21T02:00:00.000Z', 1], ['2026-11-21T03:00:00.000Z', 1]]);
});

test('independent pools deduplicate concurrent events and still deduplicate after reconnecting', async t => {
  const other = createDatabase(target.href, 3);
  t.after(() => other.close());
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    recordIpVisit(index % 2 ? db : other, digest, first, at(first))));
  assert.equal(attempts.filter(result => result === 'counted').length, 1);
  assert.equal(attempts.filter(result => result === 'duplicate').length, 11);
  const initialProcess = createDatabase(target.href, 2);
  const secondIp = Buffer.alloc(32, 23);
  try {
    assert.equal(await recordIpVisit(initialProcess, secondIp, first, at(first)), 'counted');
  } finally {
    await initialProcess.close();
  }
  assert.equal(await recordIpVisit(other, secondIp, first, at('2026-11-21T11:00:00+08:00')), 'duplicate');
  assert.deepEqual(await visits(), [['2026-11-21T02:00:00.000Z', 2]]);
});

test('stale and future events do not create keys, including after the original key has been pruned', async () => {
  assert.equal(await recordIpVisit(db, digest, first, at('2026-11-21T10:58:59.999+08:00')), 'expired');
  assert.equal(await recordIpVisit(db, digest, first, at('2026-11-21T11:01:00.001+08:00')), 'expired');
  assert.equal(await recordIpVisit(db, digest, first, at('2026-11-21T11:01:00+08:00')), 'counted');
  const earlier = '2026-11-21T10:58:59.000+08:00';
  assert.equal(await recordIpVisit(db, digest, earlier, at(first)), 'duplicate');

  const retained = '2026-11-21T12:00:59+08:00';
  assert.equal(await db.transaction(tx => pruneIpVisits(tx, at(retained))), false);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]!.n, 1);
  const expired = '2026-11-21T12:01:00+08:00';
  assert.equal(await db.transaction(tx => pruneIpVisits(tx, at(expired))), false);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]!.n, 0);
  assert.equal(await recordIpVisit(db, digest, first, at(expired)), 'expired');
  assert.equal(await recordIpVisit(db, digest, '2026-11-21T11:58:59.999+08:00', at(expired)), 'expired');
  assert.deepEqual(await visits(), [['2026-11-21T02:00:00.000Z', 1]]);
});

test('an aggregate storage failure rolls back the key as well as the count', async () => {
  await db.pool.query('ALTER TABLE analytics_ip_visit_hourly ADD CONSTRAINT reject_visit_test CHECK (visits <> 1) NOT VALID');
  try {
    await assert.rejects(recordIpVisit(db, digest, first, at(first)), { code: '23514' });
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]!.n, 0);
    assert.deepEqual(await visits(), []);
  } finally {
    await db.pool.query('ALTER TABLE analytics_ip_visit_hourly DROP CONSTRAINT reject_visit_test');
  }
  assert.equal(await recordIpVisit(db, digest, first, at(first)), 'counted');
  assert.deepEqual(await visits(), [['2026-11-21T02:00:00.000Z', 1]]);
});

test('a visit that expires during the write rolls back the key and hourly count', async t => {
  const one = createDatabase(target.href, 1);
  t.after(async () => {
    await one.close();
    await db.pool.query(`DROP TRIGGER visit_test_set_clock ON analytics_ip_visit_hourly;
      DROP FUNCTION public.visit_test_set_clock();
      DROP FUNCTION public.clock_timestamp()`);
  });
  // Shadow only the fresh clock in a dedicated test connection. The trigger advances it after the initial freshness check.
  await db.pool.query(`
    CREATE FUNCTION public.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
      SELECT coalesce(nullif(current_setting('hd_test.visit_clock',true),'')::timestamptz,pg_catalog.clock_timestamp())
    $$;
    CREATE FUNCTION public.visit_test_set_clock() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM set_config('hd_test.visit_clock',(pg_catalog.clock_timestamp()+interval '3 minutes')::text,true);
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER visit_test_set_clock BEFORE INSERT ON analytics_ip_visit_hourly FOR EACH ROW EXECUTE FUNCTION public.visit_test_set_clock()`);
  await one.pool.query('SET search_path = public, pg_catalog');
  const { rows: [clock] } = await db.pool.query<{ now: Date }>('SELECT pg_catalog.clock_timestamp() AS now');
  assert.equal(await recordIpVisit(one, digest, clock!.now.toISOString()), 'expired');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]!.n, 0);
  assert.deepEqual(await visits(), []);
});

test('only aligned, retained hours past the delivery grace can be sealed; a partial seal is sticky', async () => {
  const hour = '2026-11-21T10:00:00+08:00';
  const tooEarly = at('2026-11-21T11:01:59.999+08:00');
  const ready = at('2026-11-21T11:02:00+08:00');
  assert.equal(await recordIpVisitCoverage(db, hour, 'complete', tooEarly), 'expired');
  assert.equal(await recordIpVisitCoverage(db, '2026-11-21T09:21:00+08:00', 'complete', ready), 'expired');
  assert.equal(await recordIpVisitCoverage(db, '2026-08-20T10:00:00+08:00', 'complete', ready), 'expired');
  assert.equal(await recordIpVisitCoverage(db, hour, 'complete', ready), 'accepted');
  assert.equal(await recordIpVisitCoverage(db, '2026-11-21T02:00:00Z', 'complete', ready), 'accepted');
  assert.equal((await db.pool.query('SELECT status FROM analytics_ip_visit_coverage')).rows[0]!.status, 'complete');
  assert.deepEqual(await visits(), []);
  assert.equal(await recordIpVisitCoverage(db, hour, 'partial', ready), 'accepted');
  assert.equal(await recordIpVisitCoverage(db, hour, 'complete', ready), 'accepted');
  assert.deepEqual((await db.pool.query('SELECT status FROM analytics_ip_visit_coverage')).rows, [{ status: 'partial' }]);
});

test('cleanup has a fixed batch and retains exactly the last 90 Beijing dates for hourly aggregates', async () => {
  const now = at('2026-11-21T12:00:00+08:00');
  const keep = '2026-08-24T00:00:00+08:00';
  const old = '2026-08-23T23:00:00+08:00';
  await db.pool.query(`INSERT INTO analytics_ip_visit_hourly VALUES ($1,1),($2,2)`, [old, keep]);
  await db.pool.query(`INSERT INTO analytics_ip_visit_coverage VALUES ($1,'complete'),($2,'partial')`, [old, keep]);
  await db.pool.query(`
    INSERT INTO analytics_ip_visit_keys(digest,accepted_at,expires_at)
    SELECT decode(lpad(to_hex(n),64,'0'),'hex'), $1::timestamptz-interval '3 hours',$1::timestamptz-interval '118 minutes'
    FROM generate_series(1,10001) n`, [now]);
  assert.equal(await db.transaction(tx => pruneIpVisits(tx, now)), true);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]!.n, 1);
  assert.deepEqual(await visits(), [[at(keep).toISOString(), 2]]);
  assert.deepEqual((await db.pool.query('SELECT status FROM analytics_ip_visit_coverage')).rows, [{ status: 'partial' }]);
  assert.equal(await db.transaction(tx => pruneIpVisits(tx, now)), false);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM analytics_ip_visit_keys')).rows[0]!.n, 0);
});
