import { describe, expect, it } from 'vitest';
import { vehicleConfigurationItemId } from '@hd/contracts/admin';
import { makeConfigurationDisplayFixture, makeLocalizedPublicVehicleFixture, makePublicVehicleFixture } from '@hd/contracts/fixtures';
import type { DisplayText } from '@hd/contracts/public';
import { publicVehicleFacts } from './public-presentation';
import { publicVehicleMessages } from './public-messages';
import { configurationWithoutShownFacts } from './vehicle-fact-configuration';

function ready(text: string, requestedLocale: 'zh' | 'en' | 'ru', contentLocale = requestedLocale): DisplayText {
  return { status: 'ready', text, requestedLocale, contentLocale, provenance: 'original', reviewed: false };
}

describe('vehicle detail facts and configuration', () => {
  it('shows the explicit manufacture range ahead of the legacy date when both are provided', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.manufacturedAt = { precision: 'year', value: '2022' };
    vehicle.manufacture = {
      date: null, source: null, basis: null,
      range: {
        earliest: { precision: 'month', value: '2022-02' },
        latest: { precision: 'month', value: '2022-05' },
      },
    };
    expect(publicVehicleFacts(vehicle, 'zh').find(row => row.id === 'manufacturedAt')?.value)
      .toBe('2022-02 – 2022-05');
  });
  it.each(['zh', 'en', 'ru'] as const)('omits unknown facts and keeps measured zero values in %s', (locale) => {
    const vehicle = makeLocalizedPublicVehicleFixture(locale);
    Object.assign(vehicle.facts, {
      manufacturedAt: null, firstRegistration: null,
      trim: { id: 'trim', name: 'Awaiting translation' },
      location: { country: 'ZZ', city: 'Awaiting translation', displayName: null },
      powertrain: 'unknown', body: 'unknown', transmission: 'unknown',
      mileageKm: 0, engineCc: 0, powerKw: null, powerHp: null,
    });
    const rows = publicVehicleFacts(vehicle, locale);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const copy = publicVehicleMessages(locale);

    expect(byId.get('modelYear')).toMatchObject({ label: copy.yearLabel, value: '2024' });
    expect(byId.get('mileageKm')).toMatchObject({ label: copy.mileageLabel, value: `0 ${copy.km}` });
    expect(byId.get('displacementCc')?.value).toMatch(/^0\s/);
    for (const id of ['manufacturedAt', 'firstRegistration', 'powertrain', 'body', 'transmission', 'trim', 'location'] as const) {
      expect(byId.has(id)).toBe(false);
    }
  });

  it('keeps the actual language of a location shown in a translated detail', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('ru');
    vehicle.facts.location = { country: 'CN', city: '成都', displayName: null };
    vehicle.display!.city = ready('成都', 'ru', 'zh');

    expect(publicVehicleFacts(vehicle, 'ru').find((row) => row.id === 'location'))
      .toMatchObject({ value: '成都', lang: 'zh' });
  });

  it('suppresses only the hinted configuration identities whose mapped facts are shown', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.powerHp = 120;
    vehicle.facts.powerKw = null;
    const configuration = [
      { id: vehicleConfigurationItemId('原始马力(hp)'), semanticKey: 'powerHp', name: ready('Horsepower', 'en'), value: ready('120 hp', 'en') },
      { id: vehicleConfigurationItemId('其他马力(hp)'), semanticKey: 'powerHp', name: ready('Horsepower', 'en'), value: ready('120 hp', 'en') },
      { id: vehicleConfigurationItemId('最大马力(hp)'), semanticKey: 'powerHp', name: ready('Horsepower', 'en'), value: ready('121 hp', 'en') },
      { id: vehicleConfigurationItemId('电机功率(kW)'), semanticKey: 'motorKw', name: ready('Motor power (kW)', 'en'), value: ready('0 kW', 'en') },
      { id: vehicleConfigurationItemId('电机马力(hp)'), semanticKey: 'motorHp', name: ready('Motor horsepower', 'en'), value: ready('160 hp', 'en') },
    ];
    const original = structuredClone(configuration);
    const technicalDetails = {
      power: { motorKw: 0 },
      configurationMatches: [
        { id: configuration[0]!.id, semanticKey: 'powerHp' as const, source: 'record' as const },
        { id: configuration[3]!.id, semanticKey: 'motorKw' as const, source: 'configuration' as const },
        { id: configuration[4]!.id, semanticKey: 'motorHp' as const, source: 'configuration' as const },
        { id: vehicleConfigurationItemId('无关马力(hp)'), semanticKey: 'powerHp' as const, source: 'record' as const },
      ],
    };
    const projectedVehicle = { ...vehicle, technicalDetails };

    const shown = configurationWithoutShownFacts(
      configuration, publicVehicleFacts(projectedVehicle, 'en'), technicalDetails.configurationMatches,
    );

    expect(shown).toEqual([configuration[1], configuration[2], configuration[4]]);
    expect(configuration).toEqual(original);
  });

  it('uses the separate kilowatt fact when horsepower is absent', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.powerHp = null;
    vehicle.facts.powerKw = 120;
    const rows = publicVehicleFacts(vehicle, 'zh');

    expect(rows.find((row) => row.id === 'powerKw')?.value).toBe('120 kW');
    expect(rows.some((row) => row.id === 'powerHp')).toBe(false);
  });

  it('keeps legacy configuration rows when the server supplies no match hints', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.engineCc = 1989;
    const { items } = makeConfigurationDisplayFixture('ru');

    const shown = configurationWithoutShownFacts(items, publicVehicleFacts(vehicle, 'ru'));

    expect(shown).toEqual(items);
    expect(shown[0]!.value.text).toBe('1989');
  });

  it('presents verified engine, motor and system power separately from generic power', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.powerKw = 120;
    vehicle.facts.powerHp = 160;
    const technicalDetails = {
      power: { engineKw: 0, motorKw: 120, systemKw: 200, engineHp: 0, motorHp: 160, systemHp: 270 },
      configurationMatches: [],
    };

    const rows = publicVehicleFacts({ ...vehicle, technicalDetails }, 'en');
    const power = new Map(rows.map(({ id, value }) => [id, value]));

    expect(power.get('powerKw')).toBe('120 kW');
    expect(power.get('powerHp')).toBe('160 hp');
    expect(power.get('engineKw')).toBe('0 kW');
    expect(power.get('motorKw')).toBe('120 kW');
    expect(power.get('systemKw')).toBe('200 kW');
    expect(power.get('engineHp')).toBe('0 hp');
    expect(power.get('motorHp')).toBe('160 hp');
    expect(power.get('systemHp')).toBe('270 hp');
  });
});
