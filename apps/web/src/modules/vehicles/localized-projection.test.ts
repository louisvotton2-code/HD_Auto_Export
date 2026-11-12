import { describe, expect, it } from 'vitest';
import {
  makeLocalizedPublicVehicleFixture,
  makePublicVehicleFixture,
  makeConfigurationDisplayFixture,
} from '@hd/contracts/fixtures';
import {
  localizedHomeSchema,
  localizedListSchema,
  localizedVehicleSchema,
} from './localized-projection';

describe('localized public projection boundary', () => {
  it.each([true, false])('only accepts the detail report existence fact (%s) without an original URL', (hasReport) => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.report = { hasReport };
    const meta = { requestId: 'report-presence' };
    expect(localizedVehicleSchema('en').parse({ data: vehicle, meta }).data.report).toEqual({ hasReport });
    expect(() => localizedVehicleSchema('en').parse({ data: { ...vehicle, report: { hasReport, url: 'https://reports.example.invalid/private' } }, meta })).toThrow();
    expect(() => localizedListSchema('en').parse({ data: { items: [vehicle], page: 1, pageSize: 24, hasMore: false }, meta })).toThrow();
    expect(() => localizedHomeSchema('en').parse({ data: { sections: [{ id: 'featured', title: 'Cars', vehicles: [vehicle] }] }, meta })).toThrow();
  });
  it.each(['name', 'value'] as const)('checks configuration %s locale and keeps detail-only content out of lists/home', (field) => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.configuration = makeConfigurationDisplayFixture('en');
    const envelope = { data: vehicle, meta: { requestId: 'configuration' } };
    expect(localizedVehicleSchema('en').parse(envelope).data.configuration).toEqual(vehicle.configuration);
    expect(() => localizedHomeSchema('en').parse({ data: { sections: [{ id: 'featured', title: 'Cars', vehicles: [vehicle] }] }, meta: envelope.meta })).toThrow();
    expect(() => localizedListSchema('en').parse({ data: { items: [vehicle], page: 1, pageSize: 24, hasMore: false }, meta: envelope.meta })).toThrow();
    vehicle.configuration.items[0][field].contentLocale = 'zh';
    expect(localizedVehicleSchema('en').parse(envelope).data.configuration).toEqual(vehicle.configuration);
    vehicle.configuration.items[0][field].requestedLocale = 'ru';
    expect(() => localizedVehicleSchema('en').parse(envelope)).toThrow();
  });
  it.each(['zh', 'en', 'ru'] as const)(
    'accepts actual %s projections including missing text metadata',
    (locale) => {
      const vehicle = makeLocalizedPublicVehicleFixture(locale, 'missing');
      expect(
        localizedVehicleSchema(locale).parse({ data: vehicle, meta: { requestId: 'localized' } })
          .data,
      ).toEqual(vehicle);
      expect(
        localizedHomeSchema(locale).parse({
          data: { sections: [{ id: 'featured', title: 'Cars', vehicles: [vehicle] }] },
          meta: { requestId: 'localized' },
        }).data.sections,
      ).toHaveLength(1);
    },
  );
  it('refuses a legacy DTO and a wrong requested language instead of leaking raw text', () => {
    const wrap = (data: unknown) => ({ data, meta: { requestId: 'localized' } });
    expect(() => localizedVehicleSchema('en').parse(wrap(makePublicVehicleFixture()))).toThrow();
    expect(() =>
      localizedVehicleSchema('ru').parse(wrap(makeLocalizedPublicVehicleFixture('zh'))),
    ).toThrow();
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.display!.make.requestedLocale = 'zh';
    expect(() => localizedVehicleSchema('en').parse(wrap(vehicle))).toThrow();
    const wrongDescription = makeLocalizedPublicVehicleFixture('en');
    wrongDescription.content.description = {
      ...wrongDescription.content.title,
      text: 'Description',
      requestedLocale: 'zh',
    };
    expect(() => localizedVehicleSchema('en').parse(wrap(wrongDescription))).toThrow();
    const wrongPath = makeLocalizedPublicVehicleFixture('en');
    wrongPath.detailPath = `/ru/cars/${wrongPath.id}/`;
    expect(() => localizedVehicleSchema('en').parse(wrap(wrongPath))).toThrow();
  });
  it('does not require invented display fields for an empty result', () => {
    expect(
      localizedListSchema('en').parse({
        data: { items: [], page: 1, pageSize: 24, hasMore: false },
        meta: {
          requestId: 'empty',
          catalog: 'curated',
          total: 0,
          totalKind: 'exact',
          accessibleTotal: 0,
          dataAsOf: '2026-11-08T00:00:00Z',
          freshness: 'fresh',
        },
      }).data.items,
    ).toEqual([]);
  });

  it('requires the USD price only on opt-in projections', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    const envelope = { data: vehicle, meta: { requestId: 'price-view' } };
    expect(() => localizedVehicleSchema('en', 'usd').parse(envelope)).toThrow();
    vehicle.displayPrice = {
      status: 'ready', kind: 'asking',
      money: { amount: '23500.00', currency: 'USD' }, conversion: null,
    };
    expect(localizedVehicleSchema('en', 'usd').parse(envelope).data.displayPrice).toEqual(
      vehicle.displayPrice,
    );
    expect(() => localizedVehicleSchema('en').parse(envelope)).toThrow();
  });
});
