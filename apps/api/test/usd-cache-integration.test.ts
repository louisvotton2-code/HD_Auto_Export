import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PublicVehicleFiltersSchema, PublicVehicleListSchema } from '@hd/contracts/public';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { seedSyntheticFx } from '../src/external/fx.js';
import { readPublicCatalogRevision } from '../src/external/public-cache.js';
import { seedScale } from '../src/external/scale-seed.js';

test('USD results, indexable bounds, cache and cursor use the active stored quote', async () => {
  const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (maintenanceUrl.hostname !== '127.0.0.1' || maintenanceUrl.pathname !== '/postgres' || maintenanceUrl.search || maintenanceUrl.hash) {
    throw new Error('Integration requires the isolated local PostgreSQL maintenance connection.');
  }
  const name = `hd_ext_scale_usd_${randomBytes(8).toString('hex')}`;
  const databaseUrl = new URL(maintenanceUrl);
  databaseUrl.pathname = `/${name}`;
  const maintenance = createDatabase(maintenanceUrl.toString(), 2);
  const mediaRoot = await mkdtemp(path.join(tmpdir(),'hd-scale-usd-'));
  let runtime: Awaited<ReturnType<typeof buildApp>> | undefined;
  let created = false;
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    const config = readConfig({NODE_ENV:'test',HD_DEPLOYMENT_ENV:'test',HD_RELEASE_ID:'a'.repeat(40),HOST:'127.0.0.1',DATABASE_URL:databaseUrl.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),
      EXTERNAL_CATALOG_MODE:'synthetic-scale',TRANSLATION_PROVIDER:'disabled',EXTERNAL_PUBLIC_CACHE:'memory',MEDIA_ROOT:mediaRoot});
    const migration = createDatabase(config.databaseUrl, 2);
    try { await migrateDatabase(migration); } finally { await migration.close(); }
    const fixture = await seedScale(config,1000);
    const app = runtime = await buildApp(config);
    assert.equal((await app.app.inject({url:'/health/ready'})).statusCode,200);
    const legacyUrl = '/api/v1/vehicles?view=localized&locale=en&pageSize=2';
    const usdUrl = `${legacyUrl}&priceView=usd`;
    const range = 'view=localized&locale=en&priceView=usd&priceCurrency=USD&priceMin=8000&priceMax=17000&make=toyota';
    const list = async (url: string) => PublicVehicleListSchema.parse((await app.app.inject({url})).json());
    const filters = async () => PublicVehicleFiltersSchema.parse((await app.app.inject({url:`/api/v1/vehicle-filters?${range}`})).json()).data;
    assert.equal((await list(legacyUrl)).data.items[0]!.displayPrice,undefined);
    assert.equal((await list(usdUrl)).data.items[0]!.displayPrice?.status,'unavailable');
    assert.equal((await list(`/api/v1/vehicles?${range}`)).meta.total,0);

    const a = await seedSyntheticFx(app.db,'a');
    assert.equal(a.changed,true);
    const versionA = await readPublicCatalogRevision(app.db,true);
    assert.equal(versionA.fx?.version,a.quote.version);
    const quoteA = (await list(usdUrl)).data.items[0]!.displayPrice;
    assert.equal(quoteA?.status,'ready');
    assert.equal((await list(`/api/v1/vehicles?${range}`)).meta.total,fixture.expected.usd_toyota_a);
    assert.deepEqual((await filters()).priceCurrencies,[{id:'USD',count:fixture.expected.usd_toyota_a}]);
    assert.equal((await seedSyntheticFx(app.db,'a')).changed,false);
    assert.deepEqual(await readPublicCatalogRevision(app.db,true),versionA);
    const cursor = (await list(`${usdUrl}&pagination=cursor`)).data.nextCursor;
    assert.ok(cursor);

    await seedSyntheticFx(app.db,'b');
    const versionB = await readPublicCatalogRevision(app.db,true);
    assert.notEqual(versionB.revision,versionA.revision);
    assert.notEqual(versionB.fx?.version,versionA.fx?.version);
    assert.notDeepEqual((await list(usdUrl)).data.items[0]!.displayPrice,quoteA);
    assert.equal((await list(`/api/v1/vehicles?${range}`)).meta.total,fixture.expected.usd_toyota_b);
    assert.equal((await filters()).total,fixture.expected.usd_toyota_b);
    assert.equal((await app.app.inject({url:`${usdUrl}&cursor=${cursor}`})).statusCode,409);

    await seedSyntheticFx(app.db,'expired');
    assert.equal((await readPublicCatalogRevision(app.db,true)).fx,null);
    assert.equal((await list(usdUrl)).data.items[0]!.displayPrice?.status,'unavailable');
    assert.deepEqual((await filters()).priceCurrencies,[]);
    assert.equal((await list(legacyUrl)).data.items[0]!.displayPrice,undefined);
  } finally {
    try { await runtime?.app.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(mediaRoot,{recursive:true,force:true}); }
    }
  }
});
