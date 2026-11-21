import { makeImportedPublicVehicleFixture, makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { vehicleSeoPresentation, vehicleStructuredData } from './vehicle-seo';

describe('public vehicle search presentation', () => {
  it('uses the explicit BE language decision and closes missing eligibility', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('ru');
    const eligibility = { indexable: true, locales: ['en'] as const, lastModified: '2026-11-21T00:00:00Z' };
    expect(vehicleSeoPresentation(vehicle, 'ru').eligible).toBe(false);
    const approved = { ...vehicle, seo: { ...eligibility, locales: [...eligibility.locales] } };
    expect(vehicleSeoPresentation(approved, 'ru').eligible).toBe(false);
    expect(vehicleSeoPresentation(approved, 'en').eligible).toBe(true);
    expect(vehicleSeoPresentation({ ...approved, source: { kind: 'demo' } }, 'en').eligible).toBe(false);
  });

  it('uses a safe local description when source prose is in another language or names a private platform', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('ru');
    const description = { ...vehicle.content.title, text: 'Сторонняя платформа Dongchedi' };
    vehicle.content.description = description;
    expect(vehicleSeoPresentation(vehicle, 'ru').description).toContain('Фотографии и характеристики');
    expect(vehicleSeoPresentation(vehicle, 'ru').description).not.toContain('Dongchedi');
    vehicle.content.description = { ...description, text: 'Описание автомобиля.' };
    expect(vehicleSeoPresentation(vehicle, 'ru').description).toBe('Описание автомобиля.');
  });

  it('preserves the preferred English document title for details outside the SEO list', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('ru');
    const englishTitle = { ...vehicle.content.title, text: 'Preferred English vehicle title',
      requestedLocale: 'en' as const, contentLocale: 'en' as const };
    expect(vehicleSeoPresentation({ ...vehicle, englishTitle }, 'ru').title).toBe(englishTitle.text);
  });

  it('does not mark supplier references as in-stock offers and protects sold cars', () => {
    const imported = makeImportedPublicVehicleFixture('en');
    const owned = makeLocalizedPublicVehicleFixture('en');
    expect(vehicleStructuredData(imported, vehicleSeoPresentation(imported, 'en')).offers).toBeUndefined();
    owned.price = { kind: 'asking', money: { currency: 'USD', amount: '4900' }, includes: [] };
    expect(vehicleStructuredData(owned, vehicleSeoPresentation(owned, 'en')).offers).toMatchObject({
      availability: 'https://schema.org/InStock', price: '4900', priceCurrency: 'USD',
    });
    owned.availability = 'sold';
    expect(vehicleStructuredData(owned, vehicleSeoPresentation(owned, 'en')).offers).toBeUndefined();
  });
});
