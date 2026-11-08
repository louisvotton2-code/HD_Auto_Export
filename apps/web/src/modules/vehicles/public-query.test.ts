import { describe, expect, it } from 'vitest';
import { parseCatalogQuery, parseFilterQuery } from './public-query';
import { publicCatalogHref } from './public-presentation';

describe('complete catalog query roundtrip', () => {
  it('preserves all filters and zero bounds across pagination, excluding transport view', () => {
    const input = {
      q: 'HD-42',
      make: 'toyota',
      model: 'camry',
      trim: 'premium',
      generation: 'xv70',
      drivetrain: 'fwd',
      powertrain: 'hev',
      priceMin: '0',
      priceMax: '50000.50',
      priceCurrency: 'USD',
      mileageMin: '0',
      mileageMax: '50000',
      yearMin: '2020',
      yearMax: '2025',
      pageSize: '6',
      page: '3',
      view: 'localized',
    };
    const parsed = parseCatalogQuery(input, 'ru')!;
    expect(parsed.mileageMin).toBe(0);
    const url = new URL(publicCatalogHref('ru', parsed, 4), 'https://cars.example');
    const expected = { ...input, page: '4' };
    delete (expected as Partial<typeof expected>).view;
    expect(Object.fromEntries(url.searchParams)).toEqual(expected);
    expect(parseCatalogQuery(Object.fromEntries(url.searchParams), 'ru')).toEqual({
      ...parsed,
      page: 4,
      view: undefined,
    });
    expect(parseFilterQuery(input, 'ru')).toMatchObject({ mileageMin: 0, yearMax: 2025 });
    expect(parseFilterQuery(input, 'ru')).not.toHaveProperty('page');
  });
  it.each([
    { mileageMin: '1e3' },
    { yearMin: '0x7e8' },
    { mileageMin: '-1' },
    { yearMin: '2020.5' },
    { priceMin: '100', priceMax: '50', priceCurrency: 'USD' },
    { priceMin: 'bad', priceCurrency: 'USD' },
    { priceMin: '5' },
    { mileageMin: '100', mileageMax: '0' },
    { yearMin: '2025', yearMax: '2024' },
    { generation: 'xv70' },
    { trim: 'premium', make: 'toyota' },
    { drivetrain: '2wd' },
    { yearMin: ['2020', '2021'] },
    { mileageMax: '10000001' },
  ])('rejects malformed or inconsistent criteria: %j', (input) => {
    expect(parseCatalogQuery(input, 'en')).toBeNull();
  });
});
