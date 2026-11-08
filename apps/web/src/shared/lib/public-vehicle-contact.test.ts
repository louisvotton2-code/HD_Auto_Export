import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { buildPublicVehicleContactLinks } from './vehicle-contact';

describe('public vehicle contact drafts', () => {
  it.each(['zh', 'en', 'ru'] as const)(
    'preserves %s public identity, neutral wording and null facts',
    (locale) => {
      const vehicle = makePublicVehicleFixture();
      vehicle.source.kind = 'demo';
      vehicle.stockCode = 'SHOW-ATTO-01';
      vehicle.facts.manufacturedAt = null;
      vehicle.facts.modelYear = null;
      vehicle.facts.mileageKm = null;
      vehicle.facts.location = null;
      vehicle.price = { kind: 'on_request', money: null, includes: [] };
      vehicle.detailPath = `/${locale}/cars/${vehicle.id}/`;
      const links = buildPublicVehicleContactLinks(vehicle, locale, {
        origin: 'https://cars.example.com',
      });
      for (const href of [links.telegram, links.whatsapp])
        expect(new URL(href).searchParams.get('text')).toBe(links.message);
      expect(links.message).toContain('SHOW-ATTO-01');
      expect(links.message).toContain(vehicle.id);
      expect(links.message).not.toMatch(/Display example|展示样例|Демонстрационный|Third.party|第三方|Внешнее объявление/);
      expect(links.message).toContain(`https://cars.example.com${vehicle.detailPath}`);
      expect(links.message).not.toContain('0 km');
      expect(links.message).not.toContain('USD');
      expect(links.message).not.toContain('2024');
    },
  );
  it('keeps original currency and reference meaning, and asks for similar cars when sold', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.detailPath = `/en/cars/${vehicle.id}/`;
    vehicle.price = {
      kind: 'reference',
      money: { amount: '218000.50', currency: 'CNY' },
      includes: [],
    };
    vehicle.availability = 'sold';
    const links = buildPublicVehicleContactLinks(vehicle, 'en');
    expect(links.message).toContain('similar vehicles');
    expect(links.message).toContain('Reference price: 218000.50 CNY');
    expect(links.message).not.toContain('USD');
    expect(links.message).not.toContain('Demo');
  });
  it('refuses a mismatched public URL instead of sending the inquiry to a different vehicle', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.detailPath = '/en/cars/different/';
    expect(() => buildPublicVehicleContactLinks(vehicle, 'en')).toThrow('stable ID');
  });
});
