import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PublicVehicleFiltersSchema, PublicVehicleListSchema } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig, type Config } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { seedScale } from '../src/external/scale-seed.js';
import { benchScale } from '../src/external/scale-bench.js';
import { grantSimulationAllowance, runTrialSimulation, seedTrialSimulation } from '../src/external/trial-fake.js';

const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (maintenanceUrl.hostname !== '127.0.0.1' || maintenanceUrl.pathname !== '/postgres' || maintenanceUrl.search || maintenanceUrl.hash) {
  throw new Error('Integration requires the isolated local PostgreSQL maintenance connection.');
}
const name = `hd_ext_scale_integration_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(maintenanceUrl);
databaseUrl.pathname = `/${name}`;
const maintenance = createDatabase(maintenanceUrl.toString(), 2);
const redisPort=process.env.API_TEST_SCALE_REDIS_PORT;
let runtime: Awaited<ReturnType<typeof buildApp>>;
let config: Config;
let temp: string;
let created = false;
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(),'hd-scale-integration-'));
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  created = true;
  config = readConfig({NODE_ENV:'test',HOST:'127.0.0.1',DATABASE_URL:databaseUrl.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),
    EXTERNAL_CATALOG_MODE:'synthetic-scale',TRANSLATION_PROVIDER:'disabled',MEDIA_ROOT:temp,
    EXTERNAL_PUBLIC_CACHE:redisPort?'redis':'memory',EXTERNAL_REDIS_PORT:redisPort,EXTERNAL_REDIS_HOST:'127.0.0.1',EXTERNAL_REDIS_USER:'scale_cache',
    EXTERNAL_CACHE_NAMESPACE:'hd-ext-scale-redis-test',EXTERNAL_REDIS_PASSWORD_FILE:process.env.API_TEST_SCALE_REDIS_PASSWORD_FILE});
  const db = createDatabase(config.databaseUrl, 2);
  try { await migrateDatabase(db); } finally { await db.close(); }
  runtime = await buildApp(config);
});
after(async () => {
  try { await runtime?.app.close(); }
  finally {
    try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
    finally { await maintenance.close(); if (temp) await rm(temp, {recursive:true,force:true}); }
  }
});

test('deterministic seed and integrated public cache preserve DTOs and hide stale results', async () => {
  const fixture = await seedScale(config,1000);
  assert.equal(fixture.expected.total,1000);
  assert.equal(fixture.expected.staff,10);
  assert.equal(fixture.expected.external,990);
  await assert.rejects(seedScale(config,1000),/empty catalog/);
  const query = '?locale=en&view=localized&catalog=curated';
  const url = `/api/v1/vehicles${query}&pageSize=12`;
  const a = await runtime.app.inject({url});
  const b = await runtime.app.inject({url});
  const first = PublicVehicleListSchema.parse(a.json());
  const second = PublicVehicleListSchema.parse(b.json());
  assert.equal(first.meta.total,1000);
  assert.equal(first.data.items.filter(item=>item.source.kind==='manual').length,10);
  assert.deepEqual(second.data,first.data);
  assert.notEqual(first.meta.requestId,second.meta.requestId);
  assert.equal(a.headers['cache-control'],'no-store');
  const metrics = (await runtime.app.inject({url:'/health/catalog-cache'})).json().metrics;
  assert.equal(metrics.localHits,1);
  assert.equal(metrics.originLoads,1);
  if(redisPort) {
    const secondProcess=await buildApp(config);
    try {
      const cross=PublicVehicleListSchema.parse((await secondProcess.app.inject({url})).json());
      assert.deepEqual(cross.data,first.data);
      assert.notEqual(cross.meta.requestId,first.meta.requestId);
      const stats=(await secondProcess.app.inject({url:'/health/catalog-cache'})).json().metrics;
      assert.equal(stats.redisHits,1);
      assert.equal(stats.originLoads,0);
    } finally {await secondProcess.app.close();}
  }
  const facets = async () => PublicVehicleFiltersSchema.parse((await runtime.app.inject({url:`/api/v1/vehicle-filters${query}`})).json());
  assert.equal((await facets()).data.total,1000);
  const smallLoad = await benchScale(config,'mixed',20,40,true);
  assert.deepEqual(smallLoad.statuses,{200:40});
  assert.equal(smallLoad.transport,'in-process');
  const id = first.data.items[10]!.id;
  assert.ok(id.startsWith('ext-'));
  const detailUrl=`/api/v1/vehicles/${id}${query.replace('&catalog=curated','')}`;
  assert.equal((await runtime.app.inject({url:detailUrl})).statusCode,200);
  await runtime.db.pool.query('DELETE FROM external_catalog WHERE listing_id=$1',[id.slice(4)]);
  assert.equal((await runtime.app.inject({url:detailUrl})).statusCode,404);
  assert.equal(PublicVehicleListSchema.parse((await runtime.app.inject({url})).json()).meta.total,999);
  assert.equal((await facets()).data.total,999);
});

test('synthetic trial fails closed and recovers an interrupted dispatch without refund', async () => {
  const trial = await seedTrialSimulation(config);
  assert.equal(trial.vehicleIds.length,100);
  assert.equal((await seedTrialSimulation(config)).id,trial.id);
  assert.equal((await runTrialSimulation(config,trial.id,{limit:1})).status,'completed');
  assert.equal((await runtime.db.pool.query('SELECT count(*)::int AS count FROM external_translation_reservations WHERE trial_id=$1',[trial.id])).rows[0].count,0);
  await grantSimulationAllowance(config,trial.id,100_000);
  const lock = await runtime.db.pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended('trial-simulation:'||($1::uuid)::text,0))", [trial.id]);
    assert.deepEqual(await runTrialSimulation(config,trial.id.toUpperCase(),{limit:1}),{status:'busy',realCalls:0});
  } finally { lock.release(true); }
  await assert.rejects(runTrialSimulation(config,trial.id,{limit:1,interruptAfterDispatch:true}),/interruption/);
  const before = (await runtime.db.pool.query('SELECT attempted_characters FROM external_translation_trials WHERE id=$1',[trial.id])).rows[0].attempted_characters;
  assert.ok(before>0);
  const after = await runTrialSimulation(config,trial.id,{limit:1});
  assert.deepEqual(after,{status:'completed',processed:1,budgetBlocked:0,recoveredUncertain:1,realCalls:0});
  const ledger=await runtime.db.pool.query(`SELECT attempted_characters,(SELECT count(*)::int FROM external_translation_simulation_results WHERE trial_id=$1) AS results
    FROM external_translation_trials WHERE id=$1`,[trial.id]);
  assert.deepEqual(ledger.rows[0],{attempted_characters:before*2,results:1});
  const sample = await runtime.app.inject({url:`/api/v1/vehicles/${trial.vehicleIds[0]}?view=localized&locale=ru`});
  assert.equal(sample.statusCode,200);
  assert.doesNotMatch(sample.body,/\[simulated /);
});
