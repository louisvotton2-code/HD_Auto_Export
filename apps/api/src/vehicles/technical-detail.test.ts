import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { vehicleConfigurationItemId, type ConfigurationImportItem } from '@hd/contracts/admin';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { projectConfiguration } from './configuration.js';
import { configurationImportToken, prepareConfigurationImport, requireConfigurationImportToken } from './configuration-import.js';
import { resolveDisplay, syncLocalization, technicalFactsIdentity } from './localization.js';
import { projectTechnicalDetail } from './technical-detail.js';

const vehicleId = '58bc5fd1-e5fa-4bea-84fb-c51e4230062b';
const item = (zh: string, en: string, ru: string, value: string | ConfigurationImportItem['value']): ConfigurationImportItem => ({
  id: vehicleConfigurationItemId(zh), name: { zh, en, ru },
  value: typeof value === 'string' ? { zh: value, en: value, ru: value } : value,
});
const displacement = item('排量(cc)', 'Displacement (cc)', 'Рабочий объём (см³)', '1998');
const rawHp = item('原始马力(hp)', 'Original power (hp)', 'Исходная мощность (hp)', '88');
const engine = item('发动机最大功率(kW)', 'Maximum engine power (kW)', 'Максимальная мощность двигателя (кВт)', '0');
const motor = item('电机功率(kW)', 'Motor power (kW)', 'Мощность электродвигателя (кВт)', '109');
const system = item('系统综合功率(kW)', 'Combined system power (kW)', 'Суммарная мощность системы (кВт)', '140');
const body = item('车身形式', 'Body type', 'Тип кузова', { zh: '轿车', en: 'Sedan', ru: 'Седан' });
const transmission = item('变速箱', 'Transmission', 'Коробка передач', { zh: '无级变速', en: 'CVT', ru: 'Вариатор' });
const drive = item('驱动形式', 'Drive', 'Привод', { zh: '全轮驱动', en: 'AWD', ru: 'Привод на все колёса' });
const vehicleClass = item('车身级别', 'Vehicle class', 'Класс автомобиля', { zh: '紧凑型', en: 'Compact', ru: 'Компактный класс' });
const uncertain = item('发动机功率(hp)', 'Engine power (PS)', 'Мощность двигателя (hp)', '14');
const draftWithoutMedia = () => ({ ...makeVehicleDraftFixture(), media: [] });

test('technical import preserves recorded zero and snapshot identity, fills stable facts and keeps all source rows', () => {
  const input = draftWithoutMedia();
  Object.assign(input.facts, { engineCc: 0, powerHp: null, body: null, transmission: null });
  const rows = [displacement, rawHp, engine, motor, system, body, transmission, drive, vehicleClass, uncertain];
  const prior = syncLocalization(vehicleId, input);
  const plan = prepareConfigurationImport(vehicleId, input, prior, JSON.stringify({ version: 1, items: rows }));
  assert.equal(plan.draft.facts.engineCc, 0);
  assert.equal(plan.draft.facts.powerHp, 88);
  assert.equal(plan.draft.facts.powerKw, input.facts.powerKw);
  assert.equal(plan.draft.facts.modelYear, input.facts.modelYear);
  assert.deepEqual(plan.draft.facts.location, input.facts.location);
  assert.equal(plan.draft.facts.body, 'sedan');
  assert.equal(plan.draft.facts.transmission, 'cvt');
  assert.equal(plan.localization.data.facts.drivetrain, 'awd');
  assert.deepEqual(plan.localization.data.facts.verifiedTechnical, {
    identityHash: technicalFactsIdentity(input.facts), engineKw: 0, motorKw: 109, systemKw: 140, vehicleClass: { id: vehicleClass.id, value: vehicleClass.value },
  });
  assert.equal(plan.draft.configuration?.items.length, rows.length);
  assert.deepEqual(plan.warnings, [
    { path: 'json.items.9.value', code: 'UNVERIFIED_CONFIGURATION_VALUE', retained: null, submitted: '14' },
    { path: 'json.items.0.value', code: 'RETAINED_CONFIRMED_VALUE', retained: '0', submitted: '1998' },
  ]);
});

test('technical projection matches only ready localized equivalents, keeping the verified values after configuration edits', () => {
  const input = draftWithoutMedia();
  input.facts.engineCc = 0;
  input.facts.powerHp = null;
  input.facts.body = null;
  const sameEngine = { ...engine, name: { ...engine.name, en: 'Power (kW)' } };
  const mislabeledBody = { ...body, name: { ...body.name, en: 'Transmission' } };
  const plan = prepareConfigurationImport(vehicleId, input, syncLocalization(vehicleId, input),
    JSON.stringify({ version: 1, items: [displacement, rawHp, sameEngine, motor, system, vehicleClass, mislabeledBody] }));
  for (const locale of ['zh', 'en', 'ru'] as const) {
    const configuration = projectConfiguration(plan.draft.configuration, locale,
      ref => resolveDisplay(plan.localization.data.fields.find(field => field.ref === ref), locale, true));
    const projected = projectTechnicalDetail(plan.draft.facts, plan.localization.data.facts, plan.draft.configuration, configuration, locale);
    const matches = new Set(projected.technicalDetails?.configurationMatches.map(match => match.id));
    assert.ok(!matches.has(displacement.id));
    assert.equal(matches.has(engine.id), locale !== 'en');
    assert.equal(matches.has(body.id), locale !== 'en');
    assert.ok(matches.has(motor.id));
    assert.ok(matches.has(vehicleClass.id));
    assert.equal(projected.technicalDetails?.power.engineKw, 0);
    assert.equal(projected.vehicleClass?.text, vehicleClass.value[locale]);
  }
  const wrongScopeLabel = { ...sameEngine, name: { ...sameEngine.name, en: 'Engine torque (kW)' } };
  const wrongScope = prepareConfigurationImport(vehicleId, plan.draft, plan.localization,
    JSON.stringify({ version: 1, items: [wrongScopeLabel] }));
  const wrongScopeDisplay = projectConfiguration(wrongScope.draft.configuration, 'en',
    ref => resolveDisplay(wrongScope.localization.data.fields.find(field => field.ref === ref), 'en', true));
  assert.equal(projectTechnicalDetail(wrongScope.draft.facts, wrongScope.localization.data.facts,
    wrongScope.draft.configuration, wrongScopeDisplay, 'en').technicalDetails?.configurationMatches.length, 0);
  const next = prepareConfigurationImport(vehicleId, plan.draft, plan.localization, JSON.stringify({ version: 1, items: [rawHp] }));
  assert.deepEqual(next.localization.data.facts.verifiedTechnical, plan.localization.data.facts.verifiedTechnical);
  assert.equal(next.draft.configuration?.items.length, 1);
  const identityChanged = projectTechnicalDetail({ ...next.draft.facts, trim: { id: 'other-trim', name: 'Other trim' } },
    next.localization.data.facts, next.draft.configuration, null, 'en');
  assert.equal(identityChanged.vehicleClass, undefined);
  assert.equal(identityChanged.technicalDetails?.power.engineKw, undefined);
});

test('technical class refreshes translations only when the verified item and Chinese value still match', () => {
  const draft = draftWithoutMedia();
  const from = (entry: ConfigurationImportItem) => JSON.stringify({ version: 1, items: [entry] });
  const initial = prepareConfigurationImport(vehicleId, draft, syncLocalization(vehicleId, draft), from(vehicleClass));
  const translated = { ...vehicleClass, value: { ...vehicleClass.value, en: 'Compact class', ru: 'Компактный автомобиль' } };
  const next = prepareConfigurationImport(vehicleId, initial.draft, initial.localization, from(translated));
  assert.deepEqual(next.localization.data.facts.verifiedTechnical?.vehicleClass?.value, translated.value);
  const display = projectConfiguration(next.draft.configuration, 'ru',
    ref => resolveDisplay(next.localization.data.fields.find(field => field.ref === ref), 'ru', true));
  const projected = projectTechnicalDetail(next.draft.facts, next.localization.data.facts, next.draft.configuration, display, 'ru');
  assert.equal(projected.vehicleClass?.text, translated.value.ru);
  assert.ok(projected.technicalDetails?.configurationMatches.some(match => match.id === vehicleClass.id));
  const conflicting = { ...vehicleClass, value: { zh: '中型', en: 'Midsize', ru: 'Средний класс' } };
  const retained = prepareConfigurationImport(vehicleId, next.draft, next.localization, from(conflicting));
  assert.deepEqual(retained.localization.data.facts.verifiedTechnical?.vehicleClass?.value, translated.value);
  assert.equal(retained.warnings?.[0]?.code, 'RETAINED_CONFIRMED_VALUE');
});

test('technical class aliases with conflicting translations leave the verified value and source rows intact', () => {
  const draft = draftWithoutMedia();
  const initial = prepareConfigurationImport(vehicleId, draft, syncLocalization(vehicleId, draft),
    JSON.stringify({ version: 1, items: [vehicleClass] }));
  const alias = item('车型级别', 'Vehicle class', 'Класс автомобиля', { ...vehicleClass.value, en: 'Full-size' });
  const collision = prepareConfigurationImport(vehicleId, initial.draft, initial.localization,
    JSON.stringify({ version: 1, items: [vehicleClass, alias] }));
  assert.deepEqual(collision.localization.data.facts.verifiedTechnical?.vehicleClass, { id: vehicleClass.id, value: vehicleClass.value });
  assert.deepEqual(collision.draft.configuration?.items.map(row => row.name), [vehicleClass.name.zh, alias.name.zh]);
  assert.deepEqual(collision.warnings?.map(warning => warning.code), ['CONFLICTING_CONFIGURATION_VALUES', 'CONFLICTING_CONFIGURATION_VALUES']);
});

test('contradictory recognized drivetrain translations are surfaced as a conflict and retained verbatim', () => {
  const draft = draftWithoutMedia();
  const localization = syncLocalization(vehicleId, draft);
  localization.data.facts.drivetrain = 'rwd';
  const contradictory = { ...drive, value: { zh: '前轮驱动', en: 'All-wheel drive', ru: 'Передний привод' } };
  const plan = prepareConfigurationImport(vehicleId, draft, localization,
    JSON.stringify({ version: 1, items: [contradictory] }));
  assert.equal(plan.localization.data.facts.drivetrain, 'rwd');
  assert.deepEqual(plan.draft.configuration?.items, [{ name: '驱动形式', value: '前轮驱动' }]);
  assert.deepEqual(plan.warnings, [{
    path: 'json.items.0.value', code: 'CONFLICTING_CONFIGURATION_VALUES', retained: 'rwd', submitted: '前轮驱动',
  }]);
});

test('preview tokens created before structured imports require a fresh preview', () => {
  const secret = 'test-secret';
  const binding = { vehicleId, actorId: 'staff', input: { version: 1, localizationRevision: 1, json: '{"version":1}' } };
  const expiry = Date.now() + 60_000;
  const legacyMac = createHmac('sha256', secret).update(JSON.stringify([
    'vehicle.configuration-import.v1', vehicleId, binding.actorId, 1, 1, expiry, binding.input.json,
  ])).digest('hex');
  assert.throws(() => requireConfigurationImportToken(secret, binding, `${expiry}.${legacyMac}`), { code: 'VERSION_CONFLICT' });
  requireConfigurationImportToken(secret, binding, configurationImportToken(secret, binding));
});
