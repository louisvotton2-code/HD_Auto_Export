import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture, demoPublicVehicleFixture } from '@hd/contracts/fixtures';
import { publicVehicleMessages } from './public-messages';
import {
  formatPublicVehiclePrice,
  publicAvailabilityLabel,
  publicCatalogHref,
  publicVehicleCover,
  publicVehicleFacts,
} from './public-presentation';

describe('public vehicle presentation', () => {
  it('retains the original currency and decimal precision at the contract money limit', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.price = {
      kind: 'reference',
      money: { amount: '99999999999999.99', currency: 'CNY' },
      includes: [],
    };
    expect(formatPublicVehiclePrice(vehicle, 'en')).toBe('99,999,999,999,999.99 CNY');
    expect(formatPublicVehiclePrice(vehicle, 'ru')).toContain(',99 CNY');
  });

  it.each(['zh', 'en', 'ru'] as const)(
    'does not invent an amount or inventory for a %s display example',
    (locale) => {
      expect(formatPublicVehiclePrice(demoPublicVehicleFixture, locale)).toBe(
        publicVehicleMessages(locale).priceLabels.on_request,
      );
      expect(publicAvailabilityLabel(demoPublicVehicleFixture, locale)).toBe(
        '',
      );
      expect(publicAvailabilityLabel(demoPublicVehicleFixture, locale)).not.toBe(
        publicVehicleMessages(locale).availability.available,
      );
    },
  );

  it('distinguishes model year from an unknown manufacturing date and unknown mileage from zero', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.manufacturedAt = null;
    vehicle.facts.mileageKm = null;
    const t = publicVehicleMessages('en');
    const facts = publicVehicleFacts(vehicle, 'en');
    expect(facts.find((fact) => fact.label === t.yearLabel)?.value).toBe('2024');
    expect(facts.find((fact) => fact.label === t.manufactureLabel)?.value).toBe(t.unknown);
    expect(facts.find((fact) => fact.label === t.mileageLabel)?.value).toBe(t.unknown);
    vehicle.facts.mileageKm = 0;
    expect(
      publicVehicleFacts(vehicle, 'en').find((fact) => fact.label === t.mileageLabel)?.value,
    ).toBe('0 km');
  });

  it('keeps reserved and sold statuses distinct from available', () => {
    const vehicle = makePublicVehicleFixture();
    for (const state of ['reserved', 'sold', 'unknown'] as const) {
      vehicle.availability = state;
      expect(publicAvailabilityLabel(vehicle, 'en')).toBe(
        publicVehicleMessages('en').availability[state],
      );
    }
  });

  it('selects the published cover or the first ordered image without mutating the gallery', () => {
    const vehicle = makePublicVehicleFixture();
    const image = vehicle.images[0]!;
    vehicle.images = [
      { ...image, id: 'second', sortOrder: 1, isCover: false },
      { ...image, id: 'first', sortOrder: 0, isCover: false },
    ];
    expect(publicVehicleCover(vehicle)?.id).toBe('first');
    expect(vehicle.images.map((item) => item.id)).toEqual(['second', 'first']);
    vehicle.images[0]!.isCover = true;
    expect(publicVehicleCover(vehicle)?.id).toBe('second');
  });

  it('preserves server filter criteria across pagination and can return to page one', () => {
    const query = {
      catalog: 'curated',
      locale: 'ru',
      page: 3,
      pageSize: 12,
      make: 'byd',
      model: 'seal',
      powertrain: 'bev',
    } as const;
    const url = new URL(publicCatalogHref('ru', query, 4), 'https://cars.example');
    expect(url.pathname).toBe('/ru/cars/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      make: 'byd',
      model: 'seal',
      powertrain: 'bev',
      pageSize: '12',
      page: '4',
    });
    expect(new URL(publicCatalogHref('ru', query, 1), url.origin).searchParams.has('page')).toBe(
      false,
    );
  });
});
