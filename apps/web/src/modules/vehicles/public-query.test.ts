import { describe, expect, it } from 'vitest';
import { parseCatalogQuery, parseCatalogPageRequest, parseFilterQuery, publicUsdCatalogQuery, publicUsdFilterQuery } from './public-query';
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

  it.each([
    ['1000', '1000.00', '999.50', '1000.49'],
    ['0', '0', '0', '0.49'],
    ['1000.01', '2000.35', '1000.01', '2000.35'],
  ])('keeps website bounds in sync with whole dollars and precise bookmarks', (min, max, wireMin, wireMax) => {
    const page = parseCatalogQuery({ priceMin: min, priceMax: max, priceCurrency: 'USD' }, 'zh')!;
    const bounds = { priceMin: wireMin, priceMax: wireMax, priceCurrency: 'USD', priceView: 'usd' };
    expect(publicUsdCatalogQuery(page)).toMatchObject(bounds);
    expect(publicUsdFilterQuery('zh', page)).toMatchObject(bounds);
    expect(parseFilterQuery({ priceMin: min, priceMax: max, priceCurrency: 'USD' }, 'zh'))
      .toMatchObject({ priceMin: min, priceMax: max });
  });
});

describe('catalog page requests at the public offset window', () => {
  it.each([
    ['48', '209', 'query'], ['48', '210', 'offset_limit'],
    ['5', '2001', 'query'], ['5', '2002', 'offset_limit'],
    ['1', '10001', 'query'], ['1', '10002', 'offset_limit'],
    ['24', '417', 'query'], ['24', '418', 'offset_limit'],
  ] as const)('uses the actual %s-row page size for page %s', (pageSize, page, kind) => {
    const parsed = parseCatalogPageRequest({ pageSize, page, make: 'toyota', model: 'camry', q: '  car & stock  ' }, 'ru');
    expect(parsed?.kind).toBe(kind);
    expect(parsed?.query).toMatchObject({ locale: 'ru', pageSize: Number(pageSize), page: kind === 'query' ? Number(page) : 1, make: 'toyota', model: 'camry', q: 'car & stock', view: 'localized', priceView: 'usd' });
  });

  it('defaults page size through the existing schema and permits the largest formatted page only as recovery', () => {
    expect(parseCatalogPageRequest({}, 'en')).toMatchObject({ kind: 'query', query: { page: 1, pageSize: 24 } });
    expect(parseCatalogPageRequest({ page: '418' }, 'en')?.kind).toBe('offset_limit');
    expect(parseCatalogPageRequest({ page: '1000000' }, 'en')).toMatchObject({ kind: 'offset_limit', query: { page: 1, pageSize: 24 } });
  });

  it.each([
    { page: ['210', '211'] }, { page: '0' }, { page: '-1' }, { page: '210.0' }, { page: '0xd2' },
    { page: '0210' }, { page: '1000001' }, { page: '999999999999999999999999999' },
    { pageSize: ['48', '48'] }, { pageSize: '49' }, { pageSize: '0' }, { pageSize: '5.0' },
    { q: ['car', 'stock'] }, { powertrain: 'electric' }, { drivetrain: '2wd' }, { make: ['toyota'] },
    { model: ['camry'] }, { generation: 'xv70' }, { trim: 'premium', make: 'toyota' },
    { priceMin: '100', priceMax: '50', priceCurrency: 'USD' }, { priceMin: '5' },
    { yearMin: '2025', yearMax: '2024' }, { mileageMin: '1e3' },
    { view: ['localized', 'legacy'] }, { view: 'invalid' }, { priceView: '' }, { priceView: 'eur' }, { catalog: 'invalid' },
  ])('keeps malformed or invalid queries as failures even alongside a large offset: %j', (patch) => {
    expect(parseCatalogPageRequest({ page: '210', pageSize: '48', ...patch }, 'en')).toBeNull();
  });

  it('retains the existing non-USD bookmark migration in the recovery scope', () => {
    const request = parseCatalogPageRequest({ page: '210', pageSize: '48', priceMin: '100', priceMax: '50000', priceCurrency: 'CNY', q: 'stock', make: 'toyota' }, 'zh');
    expect(request).toMatchObject({ kind: 'offset_limit', query: { page: 1, pageSize: 48, make: 'toyota', q: 'stock', priceView: 'usd' } });
    expect(request!.query.priceMin).toBeUndefined();
    expect(request!.query.priceMax).toBeUndefined();
    expect(request!.query.priceCurrency).toBeUndefined();
  });
});
