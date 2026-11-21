import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { importAnalyticsDocumentSnapshot } from '../src/analytics/traffic-import.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';

const address = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (!['postgres:', 'postgresql:'].includes(address.protocol) || address.hostname !== '127.0.0.1'
    || address.pathname !== '/postgres' || address.search || address.hash) {
  throw new Error('Analytics importer tests require a loopback maintenance database.');
}
const name = `hd_api_test_traffic_import_${randomBytes(8).toString('hex')}`;
const target = new URL(address);
target.pathname = `/${name}`;
const maintenance = createDatabase(address.toString(), 1);
const db = createDatabase(target.toString(), 2);
const run = promisify(execFile);
const apiWorkingDirectory = fileURLToPath(new URL('../', import.meta.url));
let created = false;
let currentHour: number;

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  await maintenance.pool.query(`ALTER DATABASE "${name}" SET timezone TO 'America/Los_Angeles'`);
  await migrateDatabase(db);
  const result = await db.pool.query<{ hour: Date }>("SELECT date_trunc('hour',clock_timestamp(),'Asia/Shanghai') AS hour");
  currentHour = result.rows[0]!.hour.getTime();
});
after(async () => {
  await db.close();
  try {
    if (created) await maintenance.pool.query(`DROP DATABASE "${name}"`);
  } finally {
    await maintenance.close();
  }
});

const hoursAgo = (offset: number) => new Date(currentHour - offset * 3_600_000).toISOString();
const chinaLocal = (utc: string) => new Date(Date.parse(utc) + 8 * 3_600_000).toISOString().replace(/Z$/, '+08:00');

test('imports one finalized hour atomically despite concurrent replay, offset and row ordering', async () => {
  const rows = [{ locale: 'zh', pageType: 'catalog', requests: 22 }, { locale: 'ru', pageType: 'vehicle', requests: 9 }];
  const input = { version: 1, hour: hoursAgo(1), status: 'complete', rows };
  const outcomes = await Promise.all([
    importAnalyticsDocumentSnapshot(db, input, name),
    importAnalyticsDocumentSnapshot(db, { ...input, hour: chinaLocal(input.hour), rows: [...rows].reverse() }, name),
  ]);
  assert.deepEqual(outcomes.map(result => result.outcome).sort(), ['duplicate', 'imported']);
  const read = await db.pool.query(`SELECT s.status, sum(h.requests)::int AS total, count(*)::int AS cells
    FROM analytics_document_snapshots s JOIN analytics_document_hourly h USING (hour)
    WHERE s.hour=$1 GROUP BY s.status`, [input.hour]);
  assert.deepEqual(read.rows, [{ status: 'complete', total: 31, cells: 2 }]);
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...input, status: 'partial' }, name), { code: 'HOUR_CONFLICT' });
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...input, rows: [{ ...rows[0], requests: 30 }] }, name), { code: 'HOUR_CONFLICT' });
  assert.deepEqual((await db.pool.query('SELECT requests::int AS requests FROM analytics_document_hourly WHERE hour=$1 ORDER BY requests', [input.hour])).rows,
    [{ requests: 9 }, { requests: 22 }]);
});

test('keeps zero and partial snapshots separate and rejects wrong-target and unretained imports', async () => {
  const snapshot = { version: 1, hour: hoursAgo(2), status: 'complete', rows: [] };
  await assert.rejects(importAnalyticsDocumentSnapshot(db, snapshot, 'wrong_database'), { code: 'DATABASE_MISMATCH' });
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...snapshot, hour: hoursAgo(-1) }, name), { code: 'HOUR_OUT_OF_RANGE' });
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...snapshot, hour: hoursAgo(91 * 24) }, name), { code: 'HOUR_OUT_OF_RANGE' });
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...snapshot, hour: hoursAgo(2).replace(':00:00', ':15:00') }, name),
    { code: 'INVALID_SNAPSHOT' });
  const cell = { locale: 'en', pageType: 'home', requests: 1 };
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...snapshot, rows: [cell, cell] }, name), { code: 'INVALID_SNAPSHOT' });
  await assert.rejects(importAnalyticsDocumentSnapshot(db, { ...snapshot, visitorAddress: '192.0.2.14' }, name), { code: 'INVALID_SNAPSHOT' });
  assert.equal((await importAnalyticsDocumentSnapshot(db, snapshot, name)).rows, 0);
  await importAnalyticsDocumentSnapshot(db, { ...snapshot, hour: hoursAgo(3), status: 'partial', rows: [cell] }, name);
  assert.deepEqual((await db.pool.query(`SELECT s.status, count(h.locale)::int AS cells
    FROM analytics_document_snapshots s LEFT JOIN analytics_document_hourly h USING (hour)
    WHERE s.hour = ANY($1::timestamptz[]) GROUP BY s.hour,s.status ORDER BY s.hour`, [[hoursAgo(2), hoursAgo(3)]])).rows,
  [{ status: 'partial', cells: 1 }, { status: 'complete', cells: 0 }]);
});

test('rolls back the whole snapshot if inserting its aggregates fails', async () => {
  const hour = hoursAgo(4);
  const snapshot = { version: 1, hour, status: 'complete', rows: [{ locale: 'zh', pageType: 'home', requests: 9 }] };
  await db.pool.query('ALTER TABLE analytics_document_hourly ADD CONSTRAINT import_failure_test CHECK (requests <> 9) NOT VALID');
  try {
    await assert.rejects(importAnalyticsDocumentSnapshot(db, snapshot, name), { code: '23514' });
    assert.deepEqual((await db.pool.query('SELECT hour FROM analytics_document_snapshots WHERE hour=$1', [hour])).rows, []);
  } finally {
    await db.pool.query('ALTER TABLE analytics_document_hourly DROP CONSTRAINT import_failure_test');
  }
  assert.equal((await importAnalyticsDocumentSnapshot(db, snapshot, name)).outcome, 'imported');
});

test('the operator CLI accepts private bounded aggregate JSON and refuses symlinks or a wrong target', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'analytics-traffic-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'snapshot.json');
  const alias = path.join(directory, 'alias.json');
  const data = { version: 1, hour: hoursAgo(5), status: 'complete', rows: [{ locale: 'zh', pageType: 'home', requests: 2 }] };
  await writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  await symlink(file, alias);
  const cli = (input: string, database = name) => run(process.execPath, ['--import', 'tsx', 'src/analytics/traffic-import-cli.ts', input], {
    cwd: apiWorkingDirectory, timeout: 6000,
    env: { PATH: process.env.PATH, DATABASE_URL: target.toString(), ANALYTICS_IMPORT_DATABASE: database },
  });
  await assert.rejects(cli(alias), { code: 1, stderr: 'Analytics document snapshot import failed (IMPORT_FAILED).\n' });
  await assert.rejects(cli(file, 'wrong_database'), { code: 1, stderr: 'Analytics document snapshot import failed (DATABASE_MISMATCH).\n' });
  await chmod(file, 0o644);
  await assert.rejects(cli(file), { code: 1, stderr: 'Analytics document snapshot import failed (INVALID_SNAPSHOT).\n' });
  await chmod(file, 0o600);
  const expected = { outcome: 'imported', hour: data.hour, status: data.status, rows: 1 };
  assert.deepEqual(JSON.parse((await cli(file)).stdout), expected);
  assert.deepEqual(JSON.parse((await cli(file)).stdout), { ...expected, outcome: 'duplicate' });
  await writeFile(file, ' '.repeat(16_385));
  await assert.rejects(cli(file), { code: 1, stderr: 'Analytics document snapshot import failed (INVALID_SNAPSHOT).\n' });
});
