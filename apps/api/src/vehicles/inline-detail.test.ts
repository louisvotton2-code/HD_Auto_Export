import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { DisplayText, Locale, PublicInspectionEntry, PublicInspectionSummary } from '@hd/contracts/public';
import { makeExternalStructuredPublicVehicleFixture } from '@hd/contracts/fixtures';
import type { Database } from '../db/index.js';
import { VehicleEvidence } from './evidence.js';
import { configurationSemanticKey, inlineDetail } from './inline-detail.js';
import type { InventoryService } from './service.js';

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
    { locale, data: item(locale, 'specs.motorKw', ['电机功率', 'Seller phone', 'Мощность мотора'][index]!, '99 kW') },
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

const privatePhone = display('en', 'Phone');
const barePhone = display('en', '(202) 555-0142');
const privateCost = display('zh', '内部采购成本');
const bareCost = display('en', 'CNY 73421');
const missing: DisplayText = {
  status: 'missing', text: null, requestedLocale: 'en', contentLocale: null, provenance: null, reviewed: false,
};
const safeText = display('en', 'Front left door');
const historicalSummary: PublicInspectionSummary = {
  status: 'available', contentLocale: 'en', checked: 20, faults: 1,
  categories: [{ id: 'body', label: privatePhone, checked: 3, faults: 1, outcome: 'defect' }],
};
const historicalConclusion = { id: 'summary.0', name: privatePhone, value: barePhone };
const cleanDefect: PublicInspectionEntry = {
  id: 'defect.0', categoryId: 'body', partId: 'door', groupId: 'exterior', kind: 'defect', outcome: 'defect',
  category: display('en', 'Body'), part: safeText, group: display('en', 'Exterior'), name: display('en', 'Scratch'), value: safeText,
};
const evidenceLabels = ['category', 'part', 'group', 'name'] as const;
const historicalDefects = evidenceLabels.map((field, index) => ({ ...cleanDefect, id: `defect.${index}`, [field]: privateCost, value: bareCost }));
const publicDefects = evidenceLabels.map((field, index) => ({ ...historicalDefects[index]!, [field]: missing, value: missing }));
const publicSummary = { ...historicalSummary, categories: [{ ...historicalSummary.categories[0]!, label: missing }] };
const publicConclusion = { ...historicalConclusion, name: missing, value: missing };

test('historical inline supplier text is masked while row counts, stable IDs and safe specifications stay intact', async () => {
  const vehicle = makeExternalStructuredPublicVehicleFixture('en');
  vehicle.inspectionSummary = historicalSummary;
  const config = [
    { id: 'specs.engineKw', name: privateCost, value: bareCost },
    { id: 'sheet.0.1', name: display('en', 'Wheelbase'), value: display('en', '2800 mm') },
  ];
  const tx = { query: async (sql: string) => sql.includes('external_vehicle_evidence') ? {
    rows: [{ conclusions: Array(4).fill(historicalConclusion), defects: [...historicalDefects, ...historicalDefects, cleanDefect], normal: 18 }],
  } : { rows: config.map(data => ({ data })) } } as unknown as PoolClient;
  const result = await inlineDetail(tx, vehicle, 'en');
  assert.deepEqual(result.inspectionSummary, publicSummary);
  assert.deepEqual(result.inspectionInline, {
    conclusions: Array(3).fill(publicConclusion), defects: [...publicDefects, ...publicDefects], normalItemCount: 18,
    hasMoreConclusions: true, hasMoreDefects: true,
  });
  assert.deepEqual(result.configurationInline, [
    { ...config[0], name: missing, value: missing, semanticKey: 'engineKw' },
    { ...config[1], semanticKey: 'wheelbaseMm' },
  ]);
});

test('historical evidence masks fields in place without moving inspection cursors or changing price history', async () => {
  const vehicle = makeExternalStructuredPublicVehicleFixture('en');
  const cleanEntry = { ...cleanDefect, id: 'defect.4', category: null, part: null, group: null };
  const price = { id: 'asking.0', at: null, money: { currency: 'CNY', amount: '0' }, kind: 'asking' };
  const tx = { query: async (sql: string, parameters?: unknown[]) => {
    if (sql.startsWith('SET TRANSACTION')) return { rows: [] };
    if (!sql.includes('WITH chosen')) return { rows: [{ source_revision: 'price', total: 1, items: [price] }] };
    assert.equal(parameters?.[4], 'body');
    const start = parameters?.[2] === 0;
    return { rows: [{ source_revision: 'inspection', total: 2, status: 'available',
      overview: { summary: historicalSummary, conclusions: [historicalConclusion] }, items: [start ? historicalDefects[0] : cleanEntry] }] };
  } } as unknown as PoolClient;
  const db = {
    pool: { query: async () => ({ rows: [{ epoch: 'test', revision: '42' }] }) },
    transaction: async <T>(work: (client: PoolClient) => Promise<T>) => work(tx),
  } as unknown as Database;
  const inventory = { getPublic: async () => vehicle } as unknown as InventoryService;
  const evidence = new VehicleEvidence(db, inventory);
  const query = { locale: 'en', limit: 1, category: 'body', order: 'source' } as const;
  const first = await evidence.read(vehicle.id, 'inspection', query);
  assert.deepEqual(first.summary, publicSummary);
  assert.deepEqual(first.conclusions, [publicConclusion]);
  assert.deepEqual(first.items, [publicDefects[0]]);
  assert.equal(first.total, 2);
  assert.ok(first.nextCursor);
  const second = await evidence.read(vehicle.id, 'inspection', { ...query, cursor: first.nextCursor });
  assert.deepEqual(second.items, [cleanEntry]);
  assert.equal(second.total, first.total);
  assert.equal(second.revision, first.revision);
  assert.equal(second.nextCursor, null);
  const history = await evidence.read(vehicle.id, 'price-history', { locale: 'en', limit: 20 });
  assert.deepEqual(history.items, [price]);
  assert.equal(history.total, 1);
});
