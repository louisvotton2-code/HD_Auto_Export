import { describe, expect, it } from 'vitest';
import { vehicleConfigurationItemId } from '@hd/contracts/admin';
import { makeConfigurationDisplayFixture, makeImportedPublicVehicleFixture, makeLocalizedPublicVehicleFixture, makePublicVehicleFixture } from '@hd/contracts/fixtures';
import type { DisplayText } from '@hd/contracts/public';
import { publicVehicleFacts } from './public-presentation';
import { publicVehicleMessages } from './public-messages';
import { configurationWithoutShownFacts } from './vehicle-fact-configuration';

function ready(text: string, requestedLocale: 'zh' | 'en' | 'ru', contentLocale = requestedLocale): Extract<DisplayText, { status: 'ready' }> {
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

  it('keeps structured displacement authoritative and skips ambiguous or incompatible configuration', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('zh');
    const row = (id: string, name: string, value: string) =>
      ({ id, semanticKey: null, name: ready(name, 'zh'), value: ready(value, 'zh') });
    const milliliters = row('ml', '排量（mL）', '1197');
    const read = (items: Array<typeof milliliters>) => publicVehicleFacts({
      ...vehicle, configurationInline: items,
    }, 'zh').find(({ id }) => id === 'displacementCc');

    vehicle.facts.engineCc = 0;
    expect(read([milliliters])).toMatchObject({ value: '0 cm³' });
    vehicle.facts.engineCc = null;
    expect(read([row('explicit', '发动机排量', '1197毫升')])?.value).toMatch(/^1[\s,]?197 cm³$/);
    expect(read([milliliters, row('cc', '发动机排量(cc)', '1200')])).toBeUndefined();
    expect(read([row('invalid', '排量(mL)', '1.2 L'), row('tank', '油箱容积(mL)', '1197')])).toBeUndefined();
  });

  it.each([
    ['zh', '驱动形式', '全轮驱动', '电动机总功率(kW)', '330 kW'],
    ['en', 'Drive configuration', 'All-wheel drive', 'Total traction motor power (kW)', '330 kW'],
    ['ru', 'Тип привода', 'Полный привод', 'Суммарная мощность тяговых электродвигателей(kW)', '330 кВт'],
  ] as const)('moves the stored drive and motor power in %s', (locale, drive, driveValue, motor, motorValue) => {
    const vehicle = makeLocalizedPublicVehicleFixture(locale);
    vehicle.facts.drivetrain = null;
    const configurationInline = [
      { id: 'drive', semanticKey: 'driveType', name: ready(drive, locale), value: ready(driveValue, locale) },
      { id: 'motor', semanticKey: null, name: ready(motor, locale), value: ready('330', locale) },
      { id: 'other', semanticKey: 'abs', name: ready('ABS', locale), value: ready('true', locale) },
      { id: 'copy', semanticKey: 'driveType', name: ready(drive, locale), value: ready(driveValue, locale) },
      { id: 'reviewed', semanticKey: 'driveType', name: ready(drive, locale), value: { ...ready(driveValue, locale), reviewed: true } },
    ];
    const facts = publicVehicleFacts({ ...vehicle, configurationInline }, locale);
    expect(facts.find(row => row.id === 'drivetrain')).toMatchObject({ value: driveValue, lang: locale });
    expect(facts.find(row => row.id === 'motorKw')?.value).toBe(motorValue);
    expect(configurationWithoutShownFacts(configurationInline, facts)).toEqual([configurationInline[2], configurationInline[4]]);
  });

  it('preserves dates and zero from explicit configuration while retaining disputed and conflicting rows', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    Object.assign(vehicle.facts, {
      modelYear: 2024, manufacturedAt: null, firstRegistration: null, mileageKm: null,
      engineCc: null, powerKw: null, powerHp: null, transmission: null, powertrain: 'unknown',
    });
    const configurationInline = [
      ['year', 'Model year', '2023'],
      ['manufacture', 'Manufacture date', '2022-02 – 2022-04'],
      ['registration', 'First registration date', '2023-09'],
      ['mileage', 'Mileage (km)', '0'],
      ['displacement', 'Displacement (cc)', '1998 L'],
      ['kilowatts', 'Power (kW)', '150'],
      ['specHp', 'Power (specification)', '204 hp'],
      ['originalHp', 'Original horsepower (hp)', '0'],
      ['drive1', 'Drive type', 'All-wheel drive'],
      ['drive2', 'Drive type', 'Rear-wheel drive'],
      ['gearbox', 'Transmission', 'Automatic'],
      ['energy', 'Energy type', 'Diesel'],
    ].map(([id, name, value]) => ({
      id: id!, semanticKey: id === 'specHp' ? 'powerHp' : null, name: ready(name!, 'en'), value: ready(value!, 'en'),
    }));
    const facts = publicVehicleFacts({
      ...vehicle, configurationInline, external: { issues: [
        { field: 'transmission', code: 'conflict' }, { field: 'powertrain', code: 'invalid' },
      ] },
    }, 'en');
    const shown = new Map(facts.map(row => [row.id, row.value]));
    expect(shown.get('modelYear')).toBe('2024');
    expect(shown.get('manufacturedAt')).toBe('2022-02 – 2022-04');
    expect(shown.get('firstRegistration')).toBe('2023-09');
    expect(shown.get('mileageKm')).toBe('0 km');
    expect(shown.get('powerKw')).toBe('150 kW');
    expect(shown.get('powerHp')).toBe('0 hp');
    for (const id of ['displacementCc', 'drivetrain', 'transmission', 'powertrain'] as const)
      expect(shown.has(id)).toBe(false);
    expect(configurationWithoutShownFacts(configurationInline, facts).map(item => item.id)).toEqual([
      'year', 'displacement', 'specHp', 'drive1', 'drive2', 'gearbox', 'energy',
    ]);
    vehicle.facts.registrationStatus = 'never_registered';
    const unregistered = publicVehicleFacts({ ...vehicle, configurationInline }, 'en');
    expect(unregistered.some(row => row.id === 'firstRegistration')).toBe(false);
    expect(configurationWithoutShownFacts(configurationInline, unregistered).some(item => item.id === 'registration'))
      .toBe(true);
  });

  it('keeps legacy configuration rows when the server supplies no match hints', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.engineCc = 1989;
    const { items } = makeConfigurationDisplayFixture('ru');

    const shown = configurationWithoutShownFacts(items, publicVehicleFacts(vehicle, 'ru'));

    expect(shown).toEqual(items);
    expect(shown[0]!.value.text).toBe('1989');
  });

  it.each([
    ['zh', '发动机功率(kW)', '185 kW', '电机功率(kW)', '0 kW'],
    ['en', 'Engine power (kW)', '185 kW', 'Motor power (kW)', '0 kW'],
    ['ru', 'Мощность двигателя (кВт)', '190 кВт', 'Мощность электромотора (кВт)', '0 кВт'],
  ] as const)('keeps unverified supplier observations below and dedupes verified zero in %s', (locale, engine, engineValue, motor, motorValue) => {
    const external = makeImportedPublicVehicleFixture(locale, 'supplier', true);
    const configurationInline = [
      { id: 'specs.engineKw', semanticKey: 'engineKw', name: ready(engine, locale), value: ready(engineValue, locale) },
      { id: 'specs.motorKw', semanticKey: 'motorKw', name: ready(motor, locale), value: ready(motorValue, locale) },
      ...(locale === 'zh' ? [{
        id: 'specs.engineHp', semanticKey: 'engineHp', name: ready('发动机马力(hp)', locale), value: ready('250 hp', locale),
      }] : []),
    ];
    const technicalDetails = {
      power: { motorKw: 0, systemKw: 200 },
      configurationMatches: [
        { id: 'specs.motorKw', semanticKey: 'motorKw' as const, source: 'configuration' as const },
      ],
    };
    const facts = publicVehicleFacts({ ...external, configurationInline, technicalDetails }, locale);
    expect(facts.find(row => row.id === 'motorKw')?.value).toBe(motorValue);
    expect(facts.find(row => row.id === 'systemKw')?.value).toBe(locale === 'ru' ? '200 кВт' : '200 kW');
    expect(facts.some(row => row.id === 'engineKw' || row.id === 'engineHp')).toBe(false);
    expect(configurationWithoutShownFacts(configurationInline, facts, technicalDetails.configurationMatches))
      .toEqual(configurationInline.filter(item => item.id !== 'specs.motorKw'));
    const staffReference = publicVehicleFacts({
      facts: external.facts, source: external.source, configuration: { version: 1, items: configurationInline },
    }, locale);
    expect(staffReference.find(row => row.id === 'engineKw')?.value).toBe(engineValue);
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
