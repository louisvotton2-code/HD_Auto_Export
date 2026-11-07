import { describe, expect, it } from 'vitest';
import { buildVehicleContactLinks, type VehicleContactFacts } from './vehicle-contact';

const vehicle: VehicleContactFacts = {
  id: 'demo-车辆-01',
  make: 'BYD',
  model: 'Seal & Plus + #1',
  year: 2024,
  priceUsd: 25000,
  mileageKm: 1200,
  fuel: 'electric',
  body: 'sedan',
  detailPath: '/zh/cars/demo-01/',
};

describe('vehicle contact drafts', () => {
  it.each(['zh', 'en', 'ru'] as const)(
    'encodes identical %s drafts for the verified recipients',
    (locale) => {
      const result = buildVehicleContactLinks(vehicle, locale, {
        origin: 'https://cars.example.com',
      });
      const tg = new URL(result.telegram),
        wa = new URL(result.whatsapp);
      expect(tg.origin + tg.pathname).toBe('https://t.me/HD_Auto_CN');
      expect(wa.origin + wa.pathname).toBe('https://wa.me/8618215932610');
      for (const link of [tg, wa]) {
        expect([...link.searchParams.keys()]).toEqual(['text']);
        expect(link.searchParams.get('text')).toBe(result.message);
        expect(link.search).not.toContain('+');
      }
      for (const fact of [
        'demo-车辆-01',
        'BYD Seal & Plus + #1',
        '2024',
        'USD',
        'km',
        'https://cars.example.com/zh/cars/demo-01/',
      ])
        expect(result.message).toContain(fact);
      expect(result.message.split('\n')).toHaveLength(9);
      expect(result.message).toContain({ zh: '演示', en: 'demo', ru: 'демонстрационном' }[locale]);
      expect(result.message).toContain({ zh: '纯电', en: 'Electric', ru: 'Электро' }[locale]);
      expect(result.message).toContain({ zh: '轿车', en: 'Sedan', ru: 'Седан' }[locale]);
    },
  );

  it('keeps unrecognised adapter facts readable instead of replacing them with incorrect labels', () => {
    const result = buildVehicleContactLinks({ ...vehicle, fuel: 'Hydrogen', body: 'Van' }, 'en');
    expect(result.message).toContain('Fuel: Hydrogen\nBody: Van');
  });

  it.each([
    'https://other.example/car/',
    '//other.example/car/',
    'javascript:alert(1)',
    'cars/demo/',
  ])('rejects a detail path outside local routes: %s', (detailPath) => {
    expect(() => buildVehicleContactLinks({ ...vehicle, detailPath }, 'en')).toThrow('local route');
  });
});
