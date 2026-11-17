import assert from 'node:assert/strict';
import test from 'node:test';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { LocaleSchema, type DisplayText, type Locale } from '@hd/contracts/public';
import { projectSupplierTechnicalDetails } from './supplier-technical-detail.js';

function ready(locale: Locale, text: string, contentLocale: string): DisplayText {
  return { status: 'ready', requestedLocale: locale, contentLocale, text, provenance: 'supplier', reviewed: false };
}

function rows(id: string, text: string | Record<Locale, string>, contentLocale = 'und') {
  return LocaleSchema.options.map(locale => ({
    locale,
    data: {
      id, name: ready(locale, id === 'specs.engineHp' && locale === 'ru' ? 'Мощность двигателя (л.с.)' : 'Specification', locale),
      value: typeof text === 'string' ? ready(locale, text, contentLocale) : ready(locale, text[locale], locale),
    },
  }));
}

test('only exact supplier semantics can match equivalent base facts or project scoped power', () => {
  const facts = {
    ...makePublicVehicleFixture().facts, engineCc: 0, powerKw: 280, powerHp: 252,
    body: 'sedan' as const, transmission: 'dct' as const, drivetrain: 'fwd' as const,
  };
  const before = structuredClone(facts);
  const items = [
    ...rows('specs.displacementCc', '0 cm³'),
    ...rows('specs.powerKw', '280 kW'),
    ...rows('specs.powerHp', '252 hp'),
    ...rows('specs.engineKw', '185 kW'),
    ...rows('specs.motorKw', '100 kW'),
    ...rows('specs.ev.motorPowerKw', '100.0 kW'),
    ...rows('specs.systemKw', '280 kW'),
    ...rows('specs.engineHp', '252 hp'),
    ...rows('specs.motorHp', '0 hp'),
    ...rows('specs.bodyType', { zh: '轿车', en: 'Saloon', ru: 'седан' }),
    ...rows('specs.transmissionType', '7-speed DCT', 'en'),
    ...rows('specs.driveType', 'FWD', 'en-US'),
    ...rows('sheet.engineHp', '400 hp'),
  ];
  const inlineIds = new Set(items.map(item => item.data.id).filter(id => id !== 'specs.ev.motorPowerKw'));
  const projected = projectSupplierTechnicalDetails(facts, items, inlineIds);
  assert.deepEqual(projected, {
    power: { engineKw: 185, motorKw: 100, systemKw: 280, engineHp: 252, motorHp: 0 },
    configurationMatches: [
      { id: 'specs.displacementCc', semanticKey: 'displacementCc', source: 'record' },
      { id: 'specs.powerKw', semanticKey: 'powerKw', source: 'record' },
      { id: 'specs.engineKw', semanticKey: 'engineKw', source: 'configuration' },
      { id: 'specs.motorKw', semanticKey: 'motorKw', source: 'configuration' },
      { id: 'specs.systemKw', semanticKey: 'systemKw', source: 'configuration' },
      { id: 'specs.engineHp', semanticKey: 'engineHp', source: 'configuration' },
      { id: 'specs.motorHp', semanticKey: 'motorHp', source: 'configuration' },
      { id: 'specs.bodyType', semanticKey: 'bodyType', source: 'record' },
      { id: 'specs.driveType', semanticKey: 'driveType', source: 'record' },
    ],
  });
  assert.deepEqual(facts, before);
});

test('scope conflicts, wrong units, unexplained base equality and richer enum values stay inline', () => {
  const facts = { ...makePublicVehicleFixture().facts, engineCc: null, powerKw: 190, body: 'sedan' as const, transmission: 'dct' as const };
  const items = [
    ...rows('specs.displacementCc', '2000 cc'),
    ...rows('specs.powerKw', '100 kW'),
    ...rows('specs.engineKw', { zh: '185 kW', en: '185 kW', ru: '190 kW' }),
    ...rows('specs.engineHp', '150 PS'),
    ...rows('specs.motorHp', '150 kW'),
    ...rows('specs.systemKw', '190'),
    ...rows('specs.bodyType', { zh: '轿车', en: 'Sedan', ru: 'Универсал' }),
    ...rows('specs.transmissionType', { zh: '双离合', en: '7-speed DCT', ru: 'коробка передач с двойным сцеплением' }),
    ...rows('specs.motorKw', '100 kW'),
    ...rows('specs.ev.motorPowerKw', '101 kW'),
  ];
  assert.equal(projectSupplierTechnicalDetails(facts, items, new Set(items.map(item => item.data.id))), undefined);
});

test('present aliases require complete ready evidence in each requested locale without duplicates', () => {
  const facts = makePublicVehicleFixture().facts;
  const motor = rows('specs.motorKw', '100 kW');
  const alias = rows('specs.ev.motorPowerKw', '100 kW');
  const inline = new Set([motor[0]!.data.id, alias[0]!.data.id]);
  assert.deepEqual(projectSupplierTechnicalDetails(facts, motor, inline)?.power, { motorKw: 100 });
  assert.deepEqual(projectSupplierTechnicalDetails(facts, alias, inline)?.power, { motorKw: 100 });
  assert.deepEqual(projectSupplierTechnicalDetails(facts, [...motor, ...alias], inline)?.configurationMatches, [
    { id: 'specs.motorKw', semanticKey: 'motorKw', source: 'configuration' },
    { id: 'specs.ev.motorPowerKw', semanticKey: 'motorKw', source: 'configuration' },
  ]);

  const wrongLocale = { ...alias[0]!, data: { ...alias[0]!.data, value: ready('en', '100 kW', 'und') } };
  const missingLocale = {
    ...alias[0]!, data: { ...alias[0]!.data, value: {
      status: 'missing' as const, requestedLocale: alias[0]!.locale, text: null,
      contentLocale: null, provenance: null, reviewed: false as const,
    } },
  };
  const malformedName = { ...alias[0]!, data: { ...alias[0]!.data, name: null as unknown as DisplayText } };
  for (const invalidAlias of [
    alias.slice(0, 2), [alias[0]!, alias[1]!, alias[1]!], [...alias, alias[0]!],
    [wrongLocale, ...alias.slice(1)], [missingLocale, ...alias.slice(1)], [malformedName, ...alias.slice(1)],
  ]) assert.equal(projectSupplierTechnicalDetails(facts, [...motor, ...invalidAlias], inline), undefined);
});
