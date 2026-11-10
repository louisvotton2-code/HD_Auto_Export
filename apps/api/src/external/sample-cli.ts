import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type ExternalImportBatchRequest, type ExternalTrial } from '@hd/contracts/admin';
import { PublicVehicleFiltersSchema, PublicVehicleListSchema, type Locale } from '@hd/contracts/public';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { migrateDatabase } from '../db/migrate.js';
import { createStaff } from '../staff-cli.js';
import { loadChinaCarSample } from './china-car-sample.js';
import { jsonHash, locales } from './normalize.js';
import { chinaCarSampleProfile } from './profiles.js';
import { ExternalStore } from './store.js';
import { createTrial } from './trial.js';

let stage = 'local-input-configuration';

async function run() {
  const [action, folder] = process.argv.slice(2);
  if (action !== '--inspect-local' || !folder || process.argv.length !== 4) {
    console.error('Usage: external:sample --inspect-local <verified private sample folder>');
    process.exitCode = 1;
    return;
  }
  const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if (!['postgres:', 'postgresql:'].includes(maintenanceUrl.protocol) || maintenanceUrl.hostname !== '127.0.0.1' ||
      maintenanceUrl.pathname !== '/postgres' || maintenanceUrl.search || maintenanceUrl.hash) {
    throw new Error('The sample runner requires a local 127.0.0.1 maintenance database without URL options.');
  }
  const databaseName = `hd_ext_real_${randomBytes(8).toString('hex')}`;
  const databaseUrl = new URL(maintenanceUrl);
  databaseUrl.pathname = `/${databaseName}`;
  stage = 'verified-files';
  const input = await loadChinaCarSample(folder);
  const maintenance = createDatabase(maintenanceUrl.toString(), 2);
  const directory = await mkdtemp(path.join(tmpdir(), 'hd-ext-real-'));
  let runtime: Awaited<ReturnType<typeof buildApp>> | undefined;
  let created = false;
  try {
    stage = 'isolated-migration';
    await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    runtime = await buildApp(readConfig({ NODE_ENV: 'test', EXTERNAL_CATALOG_MODE: 'synthetic', TRANSLATION_PROVIDER: 'disabled',
      DATABASE_URL: databaseUrl.toString(), HOST: '127.0.0.1', AUTH_SECRET: randomBytes(32).toString('hex'), MEDIA_ROOT: directory }));
    await migrateDatabase(runtime.db);
    const actor = { requestId: 'private-sample-inspection', id: (await createStaff(runtime.auth, {
      email: 'sample-admin@example.invalid', name: 'Isolated sample runner', role: 'admin', password: randomBytes(24).toString('hex'),
    })).user.id };
    const store = new ExternalStore(runtime.db, chinaCarSampleProfile);
    const ingest = async (name: 'pilot' | 'control', batch: ExternalImportBatchRequest) => {
      stage = `import-${name}`;
      const key = `private-${name}-${jsonHash(batch)}`;
      const imported = await store.importBatch(batch, key, actor);
      const replay = await store.importBatch(batch, key, actor);
      if (replay.id !== imported.id) throw new Error('The isolated batch receipt was not stable.');
      const { items } = await store.listRecords(imported.id, { page: 1, pageSize: 100 });
      const ids = items.flatMap(item => item.status === 'applied' && item.listingId ? [item.listingId] : []);
      if (ids.length !== 100 || new Set(ids).size !== 100) {
        const reasons: Record<string, number> = {};
        for (const item of items) if (item.reason) reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
        console.log(JSON.stringify({ group: name, counts: imported.counts, reasons }));
        throw new Error('The fixed selection did not fully import.');
      }
      return { batch: imported, ids, issues: items.flatMap(item => item.issues) };
    };
    const pilot = await ingest('pilot', input.pilot);
    const control = await ingest('control', input.control);
    stage = 'trial-dry-run';
    const plan = await createTrial(runtime.db, pilot.batch.id, { vehicleIds: pilot.ids }, actor);
    const { estimate, byField, budget } = plan;
    if (budget.realCalls !== 0 || budget.reservedCharacters !== 0 || budget.attemptedCharacters !== 0) throw new Error('The dry run used translation budget.');
    stage = 'read-only-projection';
    const probe = async (ids: string[], locale: Locale) => {
      const counts = { titleSupplier: 0, titleOriginal: 0, titleFallbackOtherLanguage: 0, titleCatalog: 0,
        modelReady: 0, modelSameLanguage: 0, descriptionPresent: 0, referencePrice: 0, pictures: 0, withPictures: 0,
        reportLinks: 0, inspectionEntries: 0, specificationEntries: 0, yearUnknown: 0, energyUnknown: 0, withExpiredPictures: 0 };
      for (const id of ids) {
        const item = await runtime!.inventory.getPublic(id, locale, 'localized');
        const details = item.external?.detail;
        if (!details || item.availability !== 'unknown' || item.availabilityCheckedAt !== null || item.content.title.reviewed) {
          throw new Error('A sample record did not meet the external projection rules.');
        }
        if (item.price.kind === 'reference') {
          if (item.price.money.currency !== 'CNY') throw new Error('A sample did not use the CNY price rule.');
          counts.referencePrice++;
        }
        for (const issue of item.external!.issues) {
          if (issue.code !== 'conflict') continue;
          if ((issue.field === 'price' && item.price.money !== null) || (issue.field === 'powertrain' && item.facts.powertrain !== 'unknown') ||
              (issue.field === 'modelYear' && item.facts.modelYear !== null) || (issue.field === 'specifications' && details.specifications.length)) {
            throw new Error('A disputed fact appeared in public output.');
          }
        }
        if (item.content.title.kind === 'supplier') counts.titleSupplier++;
        if (item.content.title.kind === 'catalog') counts.titleCatalog++;
        if (item.content.title.kind === 'original') {
          counts.titleOriginal++;
          if (item.content.title.contentLocale.split('-')[0] !== locale) counts.titleFallbackOtherLanguage++;
        }
        if (item.display?.model.status === 'ready') {
          counts.modelReady++;
          if (item.display.model.contentLocale.split('-')[0] === locale) counts.modelSameLanguage++;
        }
        if (item.content.description) counts.descriptionPresent++;
        if (item.images.length) counts.withPictures++;
        if (item.external!.issues.some(issue => issue.field === 'images' && issue.code === 'expired')) counts.withExpiredPictures++;
        if (details.inspection?.reportUrl) counts.reportLinks++;
        if (item.facts.modelYear === null) counts.yearUnknown++;
        if (item.facts.powertrain === 'unknown') counts.energyUnknown++;
        counts.pictures += item.images.length;
        counts.inspectionEntries += details.inspection?.entries.length ?? 0;
        counts.specificationEntries += details.specifications.length;
      }
      return counts;
    };
    const projections = [];
    for (const locale of locales) {
      const query = `?locale=${locale}&view=localized`;
      const list = PublicVehicleListSchema.parse((await runtime.app.inject({ url: `/api/v1/vehicles${query}` })).json());
      const facets = PublicVehicleFiltersSchema.parse((await runtime.app.inject({ url: `/api/v1/vehicle-filters${query}` })).json());
      if (list.meta.total !== 200 || facets.data.total !== list.meta.total || list.data.items.some(item => item.external?.detail)) {
        throw new Error('The sample catalog count or public detail boundary is inconsistent.');
      }
      projections.push({ locale, total: list.meta.total, pilot: await probe(pilot.ids, locale), control: await probe(control.ids, locale) });
    }
    const audit = await runtime.db.pool.query<{ trials: number; reservations: number }>(`SELECT
      (SELECT count(*)::int FROM external_translation_trials) AS trials,
      (SELECT count(*)::int FROM external_translation_reservations) AS reservations`);
    if (audit.rows[0]?.trials !== 1 || audit.rows[0].reservations !== 0) throw new Error('The trial unexpectedly created live work reservations.');
    const report: { estimate: ExternalTrial['estimate']; byField: ExternalTrial['byField']; budget: ExternalTrial['budget'] } = { estimate, byField, budget };
    console.log(JSON.stringify({ pilot: pilot.batch.counts, control: control.batch.counts, languageGroups: input.languageGroups,
      evidenceEntries: input.evidenceEntries, dryRun: report, projections }, null, 2));
    stage = 'isolated-cleanup';
  } finally {
    try { await runtime?.app.close(); }
    finally {
      try { if (created) await maintenance.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
      finally { await maintenance.close(); await rm(directory, { recursive: true, force: true }); }
    }
  }
  console.log('Isolated sample database and temporary media cleaned.');
}

try { await run(); }
catch (error) {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,45}$/.test(error.code) ? ` (${error.code})` : '';
  console.error(`Private sample inspection failed during ${stage}${code}.`);
  process.exitCode = 1;
}
