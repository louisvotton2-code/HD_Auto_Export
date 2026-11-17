import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { DisplayText, Locale } from '@hd/contracts/public';
import { makeExternalStructuredPublicVehicleFixture } from '@hd/contracts/fixtures';
import { configurationSemanticKey, inlineDetail } from './inline-detail.js';

test('stable configuration semantics survive source IDs, manual Chinese IDs and translated labels',()=>{
 assert.equal(configurationSemanticKey('specs.ev.motorPowerKw','任意译文'),'motorKw');
 const id='cfg-'+Array.from('电池容量').map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 assert.equal(configurationSemanticKey(id,'Unknown translated label'),'batteryKwh');
 assert.equal(configurationSemanticKey('sheet.0.1','Wheelbase'),'wheelbaseMm');
 assert.equal(configurationSemanticKey('equipment.0.1','ABS'),'abs');
 assert.equal(configurationSemanticKey('sheet.0.2','Unrecognized supplier wording'),null);
});

test('BE generates the shared three-language configuration cases consumed by FE',async()=>{
 const {CONFIGURATION_SEMANTIC_FIXTURES}=await import('@hd/contracts/fixtures');
 const {CONFIGURATION_SEMANTIC_KEYS,CONFIGURATION_SEMANTIC_ALIASES}=await import('@hd/contracts/public');
 for(const fixture of CONFIGURATION_SEMANTIC_FIXTURES)for(const label of fixture.labels){
  assert.equal(configurationSemanticKey(fixture.id,label),fixture.semanticKey,`${fixture.id}: ${label}`);
 }
 // Every advertised key is actually produced; exact known labels work on opaque source items and manually entered Chinese names.
 for(const key of CONFIGURATION_SEMANTIC_KEYS){
  assert.equal(configurationSemanticKey(`specs.${key}`,'Unrelated fallback'),key);
  for(const label of CONFIGURATION_SEMANTIC_ALIASES[key]){
   assert.equal(configurationSemanticKey('equipment.0.0',label),key,label);
   if(/\p{Script=Han}/u.test(label)){
    const id='cfg-'+label.split('').map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
    assert.equal(configurationSemanticKey(id,'Unrelated translated label'),key,label);
   }
  }
 }
 assert.equal(configurationSemanticKey('equipment.0.0','Not equipped with seat ventilation'),null);
 assert.equal(configurationSemanticKey('equipment.0.0','Possible navigation upgrade'),null);
});

const display = (locale: Locale, text: string): DisplayText => ({
  status: 'ready', text, requestedLocale: locale, contentLocale: locale, provenance: 'supplier', reviewed: false,
});

test('supplier inline detail reads checked power outside the inline slice and keeps raw horsepower and manufacture range', async () => {
  const vehicle = makeExternalStructuredPublicVehicleFixture('en');
  vehicle.facts.engineCc = 0;
  vehicle.facts.powerHp = 94;
  vehicle.manufacture = {
    date: null, range: { earliest: { precision: 'month', value: '2020-03' }, latest: { precision: 'month', value: '2020-10' } },
    source: null, basis: null,
  };
  const item = (locale: Locale, id: string, name: string, value: string) => ({
    id, name: display(locale, name), value: display(locale, value),
  });
  const inline = [
    item('en', 'specs.displacementCc', 'Displacement', '0 cm³'),
    item('en', 'specs.powerHp', 'Power (specification)', '123 hp'),
  ];
  const technical = (['zh', 'en', 'ru'] as const).flatMap((locale, index) => [
    { locale, data: item(locale, 'specs.engineKw', ['发动机功率', 'Engine power', 'Мощность двигателя'][index]!, '83 kW') },
    { locale, data: item(locale, 'specs.displacementCc', ['排量', 'Displacement', 'Рабочий объём'][index]!, '0 cm³') },
  ]);
  let technicalReads = 0;
  const tx = { query: async (sql: string, params: unknown[]) => {
    assert.match(sql, /external_source_segments/);
    if (sql.includes('LIMIT 200')) return { rows: inline.map(data => ({ data })) };
    assert.match(sql, /data->>'id'=ANY/);
    assert.ok(Array.isArray(params[1]) && params[1].includes('specs.engineKw'));
    technicalReads++;
    return { rows: technical };
  } } as unknown as PoolClient;
  const existing = await inlineDetail(tx, vehicle, 'en');
  assert.equal(existing.technicalDetails, undefined);
  assert.equal(technicalReads, 0);
  const result = await inlineDetail(tx, vehicle, 'en', 'verified');
  assert.equal(technicalReads, 1);
  assert.equal(result.facts.powerHp, 94);
  assert.deepEqual(result.manufacture, vehicle.manufacture);
  assert.deepEqual(result.technicalDetails, {
    power: { engineKw: 83 },
    configurationMatches: [{ id: 'specs.displacementCc', semanticKey: 'displacementCc', source: 'record' }],
  });
  assert.deepEqual(result.configurationInline.map(entry => entry.id), ['specs.displacementCc', 'specs.powerHp']);

  assert.ok(vehicle.external);
  vehicle.external.issues = [{ field: 'specifications', code: 'conflict' }];
  const disputed = await inlineDetail(tx, vehicle, 'en', 'verified');
  assert.equal(disputed.technicalDetails, undefined);
  assert.equal(technicalReads, 1);
  assert.deepEqual(disputed.configurationInline, result.configurationInline);

  vehicle.external.issues = [{ field: 'powertrain', code: 'conflict' }];
  assert.equal((await inlineDetail(tx, vehicle, 'en', 'verified')).technicalDetails, undefined);
  assert.equal(technicalReads, 1);
});

test('supplier inline detail keeps configuration when the technical lookup may have cut off rows', async () => {
  const vehicle = makeExternalStructuredPublicVehicleFixture('en');
  const engineItem = (locale: Locale) => ({
    id: 'specs.engineKw', name: display(locale, 'Engine power'), value: display(locale, '83 kW'),
  });
  const tx = { query: async (sql: string, params: [string, string[], number]) => {
    if (sql.includes('LIMIT 200')) return { rows: [{ data: engineItem('en') }] };
    const completeEngine = (['zh', 'en', 'ru'] as const).map(locale => ({ locale, data: engineItem(locale) }));
    const duplicates = Array.from({ length: params[2] - completeEngine.length }, () => ({
      locale: 'en', data: { ...engineItem('en'), id: 'specs.motorKw' },
    }));
    return { rows: [...completeEngine, ...duplicates] };
  } } as unknown as PoolClient;
  const result = await inlineDetail(tx, vehicle, 'en', 'verified');
  assert.equal(result.technicalDetails, undefined);
  assert.deepEqual(result.configurationInline.map(entry => entry.id), ['specs.engineKw']);
});
