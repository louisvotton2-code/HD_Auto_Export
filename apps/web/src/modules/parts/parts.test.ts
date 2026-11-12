import { describe, expect, it } from 'vitest';
import { getPart, listParts } from './repository';
import { defaultPartsQuery, filterParts, partsHref, parsePartQuantity, parsePartsQuery } from './query';
import { buildPartContactLinks } from './contact';

describe('static parts repository and local selection', () => {
  it('finds a specific OEM without returning the first record for unknown routes', async () => {
    const records = await listParts();
    expect(records).toHaveLength(44);
    expect(new Set(records.map((part) => part.slug)).size).toBe(44);
    expect((await getPart('52910K2200'))?.oem).toBe('52910K2200');
    expect(await getPart('missing-part')).toBeNull();
    expect(await getPart('../52910K2200')).toBeNull();
    for (const part of records) {
      expect(Object.values(part.name).every((value) => value.trim())).toBe(true);
      expect(part.images.every((image) => image.url.startsWith('/parts/'))).toBe(true);
    }
  });
  it('combines literal search, category and price on the complete static selection without mutation', async () => {
    const parts = await listParts(), order = parts.map((part) => part.slug);
    expect(filterParts(parts, { ...defaultPartsQuery, q: '52910k2200' }, 'ru').map((part) => part.oem)).toEqual(['52910K2200']);
    expect(filterParts(parts, { ...defaultPartsQuery, q: '%' }, 'en')).toEqual([]);
    const rows = filterParts(parts, { ...defaultPartsQuery, category: 'components', max: '7', sort: 'price-asc' }, 'en');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((part) => part.category === 'components' && part.referencePriceUsd! <= 7)).toBe(true);
    expect(rows.map((part) => part.referencePriceUsd)).toEqual(rows.map((part) => part.referencePriceUsd).sort((a, b) => a! - b!));
    expect(parts.map((part) => part.slug)).toEqual(order);
  });
  it('restores repeated or comma-separated multi-selects and preserves them in links', () => {
    const { query, invalid } = parsePartsQuery({
      brand: ['Hyundai', 'Kia,Hyundai'], category: ['chassis', 'transmission'], page: '4',
    });
    expect(invalid).toBe(false);
    expect(query.brand).toBe('Hyundai,Kia');
    expect(query.category).toBe('chassis,transmission');
    const href = new URL(partsHref('ru', query), 'https://cars.example.com');
    expect(parsePartsQuery(Object.fromEntries(href.searchParams)).query).toEqual(query);
  });
  it('combines multiple categories with OR and keeps the reference counts separate from records', async () => {
    const parts = await listParts();
    const { query } = parsePartsQuery({ brand: ['Hyundai', 'Kia'], category: ['chassis', 'transmission'] });
    expect(filterParts(parts, query, 'en')).toHaveLength(17);
    expect(filterParts(parts, { ...query, brand: 'Kia,Genesis' }, 'en')).toHaveLength(0);
    expect(filterParts(parts, { ...defaultPartsQuery, category: 'interior' }, 'en')).toHaveLength(0);
    expect(filterParts(parts, { ...defaultPartsQuery, category: 'hardware' }, 'en')).toHaveLength(0);
  });
  it('keeps the old components URL and applies subcategories only to recorded names', async () => {
    const parts = await listParts();
    const legacy = parsePartsQuery({ category: 'components' });
    expect(legacy.query.category).toBe('engine');
    expect(filterParts(parts, legacy.query, 'en')).toHaveLength(26);
    const wheels = filterParts(parts, { ...defaultPartsQuery, subcategory: 'hub-bearings' }, 'en');
    expect(wheels).toHaveLength(16);
    expect(wheels.every((part) => part.name.en.toLowerCase().includes('wheel'))).toBe(true);
    expect(filterParts(parts, { ...defaultPartsQuery, subcategory: 'oil-filters' }, 'en')).toHaveLength(0);
    expect(parsePartsQuery({ subcategory: '../untrusted' }).query.subcategory).toBe('');
  });
  it('flags bad numeric ranges instead of interpreting them as a zero price or an empty catalog', () => {
    for (const raw of [{ min: 'abc' }, { min: '20', max: '10' }, { min: '1e3' }]) {
      const parsed = parsePartsQuery(raw);
      expect(parsed.invalid).toBe(true);
      expect(parsed.query.min).toBe('');
      expect(parsed.query.max).toBe('');
    }
    for (const raw of ['', '0', '-1', '1.5', '1000', '1e2']) expect(parsePartQuantity(raw)).toBeNull();
    expect(parsePartQuantity('999')).toBe(999);
  });
  it('restores a valid catalog page independently of the price range', () => {
    expect(parsePartsQuery({}).page).toBe(1);
    expect(parsePartsQuery({ page: '51', q: '52910K2200', category: 'transmission', min: '20' })).toMatchObject({
      page: 51,
      invalid: false,
      query: { q: '52910K2200', category: 'transmission', min: '20' },
    });
    expect(parsePartsQuery({ page: '99999' }).page).toBe(2029);
    for (const page of ['0', '-1', '1.5', '1e2', ['2', '3']]) {
      expect(parsePartsQuery({ page, min: '20' })).toMatchObject({
        page: 1, invalid: false, query: { min: '20' },
      });
    }
  });
  it.each(['zh', 'en', 'ru'] as const)('encodes a %s draft with the correct part, quantity, original USD reference and own contact accounts', async (locale) => {
    const part = (await getPart('52910K2200'))!;
    const result = buildPartContactLinks(part, locale, 3, { origin: 'https://cars.example.com' });
    expect(result.message).toContain('52910K2200');
    expect(result.message).toContain(part.name[locale]);
    expect(result.message).toContain('3');
    expect(result.message).toContain('227 USD');
    expect(result.message).toContain(`https://cars.example.com/${locale}/parts/52910k2200/`);
    expect(new URL(result.telegram).origin + new URL(result.telegram).pathname).toBe('https://t.me/HD_Auto_CN');
    expect(new URL(result.whatsapp).origin + new URL(result.whatsapp).pathname).toBe('https://wa.me/8618215932610');
    expect(new URL(result.telegram).searchParams.get('text')).toBe(result.message);
    expect(new URL(result.whatsapp).searchParams.get('text')).toBe(result.message);
    expect(() => buildPartContactLinks({ ...part, slug: 'different' }, locale)).toThrow('identity');
    expect(() => buildPartContactLinks(part, locale, 0)).toThrow('quantity');
  });
});
