import { describe, expect, it } from 'vitest';
import {
  makeLocalizedPublicVehicleFixture,
  makePublicVehicleFixture,
} from '@hd/contracts/fixtures';
import {
  localizedHomeSchema,
  localizedListSchema,
  localizedVehicleSchema,
} from './localized-projection';

describe('localized public projection boundary', () => {
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
});
