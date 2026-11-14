import { describe, expect, it } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicVehicleCardSchema, PublicVehicleSchema } from '@hd/contracts/public';
import { localizedCardListSchema } from './localized-projection';
import { parseVehicleSegment, mergeVehicleSegment } from './public-segments';
import { publicVehicleFacts } from './public-presentation';
import { publicVehicleMessages } from './public-messages';
import { parseCatalogQuery, publicUsdCatalogQuery } from './public-query';
import { buildPublicVehicleContactLinks } from '@/shared/lib/vehicle-contact';

const vehicle = () => makeLocalizedPublicVehicleFixture('ru');
const text = (value: string) => ({ status: 'ready' as const, text: value, requestedLocale: 'ru' as const,
  contentLocale: 'en' as const, provenance: 'supplier' as const, reviewed: false });
const page = (items: unknown[]) => ({ data: { vehicleId: vehicle().id, locale: 'ru', revision: 'a'.repeat(64),
  total: items.length, items, nextCursor: null }, meta: { requestId: 'ext07' } });

describe('EXT07 public projections and records', () => {
  it('keeps lightweight card contracts separate from full details', () => {
    const full = vehicle();
    const { external: _external, configuration: _configuration, report: _report,
      configurationTotal: _ct, mediaTotal: _mt, ...base } = full;
    const card = { ...base, content: { title: full.content.title }, images: full.images.slice(0, 1) };
    expect(PublicVehicleCardSchema.parse(card).id).toBe(full.id);
    expect(() => PublicVehicleCardSchema.parse({ ...card, content: full.content })).toThrow();
    expect(() => PublicVehicleCardSchema.parse({ ...card, images: [full.images[0], full.images[0]] })).toThrow();
    const envelope = { data: { items: [card], page: 1, pageSize: 24, hasMore: false }, meta: {
      requestId: 'card', catalog: 'curated', total: 1, totalKind: 'exact', accessibleTotal: 1,
      dataAsOf: '2026-11-14T00:00:00Z', freshness: 'fresh',
    } };
    expect(localizedCardListSchema('ru').parse(envelope).data.items).toHaveLength(1);
    expect(() => localizedCardListSchema('en').parse(envelope)).toThrow();
  });
  it('shows direct horsepower and hides absent values without hiding zero', () => {
    const full = vehicle();
    full.facts.powerHp = 0;
    full.facts.powerKw = 500;
    full.facts.manufacturedAt = null;
    full.facts.mileageKm = 0;
    const t = publicVehicleMessages('ru'), facts = publicVehicleFacts(full, 'ru');
    expect(facts.find(row => row.label === t.powerLabel)?.value).toBe('0 л. с.');
    expect(facts.find(row => row.label === t.mileageLabel)?.value).toBe(`0 ${t.km}`);
    expect(facts.find(row => row.label === t.manufactureLabel)).toBeUndefined();
    full.facts.powerHp = null;
    expect(publicVehicleFacts(full, 'ru').find(row => row.label === t.powerLabel)).toBeUndefined();
  });
  it('uses the supplier inquiry reference and source without changing detail URLs', () => {
    const full = vehicle();
    full.identifiers = { inquiryCode: 'dcd-357217151', sourceId: '357217151', source: 'dongchedi', vin: 'LHGCM82633A004352' };
    expect(PublicVehicleSchema.parse(full).identifiers?.vin).toBe('LHGCM82633A004352');
    const draft = buildPublicVehicleContactLinks(full, 'ru');
    expect(draft.message).toContain('dcd-357217151');
    expect(draft.message).toContain('dongchedi');
    expect(draft.message).toContain(full.detailPath);
    expect(draft.message).not.toContain(`ID: ${full.id}`);
  });
  it('roundtrips export conditions and ordering while explicitly requesting card projection', () => {
    const query = parseCatalogQuery({ exportStatus: 'restricted', sort: 'price_asc' }, 'ru')!;
    expect(publicUsdCatalogQuery(query)).toMatchObject({ projection: 'card', exportStatus: 'restricted', sort: 'price_asc' });
    expect(parseCatalogQuery({ exportStatus: 'everything' }, 'ru')).toBeNull();
  });
  it('preserves the actual report language and rejects scope drift and private unknown fields', () => {
    const report = { ...page([{ id: 'entry', category: null, part: null, name: text('Accidents'), value: text('0'), outcome: 'ok' }]) };
    const response = { ...report, data: { ...report.data, status: 'available' } };
    const parsed = parseVehicleSegment('inspection', response, vehicle().id, 'ru');
    expect(parsed.data.items[0].value).toMatchObject({ text: '0', contentLocale: 'en', reviewed: false });
    expect(() => parseVehicleSegment('inspection', response, vehicle().id, 'en')).toThrow();
    expect(() => parseVehicleSegment('inspection', { ...response, data: { ...response.data, sellerPhone: '+000' } }, vehicle().id, 'ru')).toThrow();
    expect(() => mergeVehicleSegment(parsed.data, { ...parsed.data, status: 'pending' })).toThrow();
  });
  it('keeps historical zero amounts and original currencies without adding current FX', () => {
    const history = parseVehicleSegment('price-history', page([{ id: 'price', at: null,
      money: { amount: '0.00', currency: 'CNY' }, kind: 'seller' }]), vehicle().id, 'ru');
    expect(history.data.items[0]).toMatchObject({ at: null, money: { amount: '0.00', currency: 'CNY' } });
    expect(() => parseVehicleSegment('price-history', { ...history, data: { ...history.data, revision: 'invalid' } }, vehicle().id, 'ru')).toThrow();
  });
});
