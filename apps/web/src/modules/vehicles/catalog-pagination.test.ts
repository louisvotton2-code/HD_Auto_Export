import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isPublicCatalogOffsetAllowed, PublicVehicleListSchema, PublicVehicleQuerySchema } from '@hd/contracts/public';
import { catalogPagination } from './catalog-pagination';
import { CatalogPagination } from './ui/catalog-pagination';
import { CatalogOffsetLimitNotice } from './ui/catalog-offset-limit';

const pageInput = {
  page: 1, pageSize: 24, hasMore: true,
  total: 240, totalKind: 'exact' as const, accessibleTotal: 240,
};

describe('catalog pagination from full API totals', () => {
  it('uses server pageSize and renders current, next, omission and last pages', () => {
    expect(catalogPagination(pageInput)).toMatchObject({
      items: [1, 2, 'ellipsis', 10], totalPages: 10, totalKind: 'exact', previous: null, next: 2,
    });
    expect(catalogPagination({ ...pageInput, pageSize: 48 }).totalPages).toBe(5);
    expect(catalogPagination({ ...pageInput, total: 241, accessibleTotal: 241 }).totalPages).toBe(11);
  });

  it('does not duplicate the final page or add ellipsis when adjacent', () => {
    expect(catalogPagination({ ...pageInput, page: 8 }).items).toEqual([8, 9, 10]);
    expect(catalogPagination({ ...pageInput, page: 9 }).items).toEqual([9, 10]);
    expect(catalogPagination({ ...pageInput, page: 10, hasMore: false })).toMatchObject({
      items: [10], previous: 9, next: null,
    });
  });

  it('takes the accessible range rather than a supplier-reported inventory scale', () => {
    expect(catalogPagination({ ...pageInput, total: 160000, totalKind: 'provider_reported', accessibleTotal: 100 })).toMatchObject({
      totalPages: 5, totalKind: 'accessible', items: [1, 2, 'ellipsis', 5],
    });
    expect(catalogPagination({ ...pageInput, totalKind: 'provider_reported', accessibleTotal: null })).toMatchObject({
      totalPages: null, totalKind: null, items: [1], next: 2,
    });
  });

  it('keeps unknown totals unknown even when the current page contains data', () => {
    expect(catalogPagination({ ...pageInput, total: null, totalKind: 'unknown', accessibleTotal: null, page: 4 })).toMatchObject({
      totalPages: null, totalKind: null, items: [4], previous: 3, next: 5,
    });
  });

  it('preserves an accessible count even when the wider total is unknown', () => {
    expect(catalogPagination({ ...pageInput, total: null, totalKind: 'unknown', accessibleTotal: 73 })).toMatchObject({
      totalPages: 4, totalKind: 'accessible',
    });
  });

  it('makes a known empty set and a page beyond the result range recoverable', () => {
    expect(catalogPagination({ ...pageInput, total: 0, accessibleTotal: 0, hasMore: false })).toMatchObject({
      totalPages: 0, items: [], next: null,
    });
    expect(catalogPagination({ ...pageInput, page: 15, hasMore: false })).toMatchObject({
      outOfRange: true, items: [10], previous: 10, next: null,
    });
  });

  it.each([[1, 10_001], [5, 2001], [24, 417], [48, 209]])('caps %s-row pages at the actual offset window, retaining true totals', (pageSize, last) => {
    const input = { ...pageInput, page: last, pageSize, total: 2_000_000, accessibleTotal: 2_000_000 };
    const bounded = catalogPagination(input);
    expect(bounded).toMatchObject({ totalPages: last, totalKind: 'accessible', items: [last], previous: last - 1, next: null, truncated: true });
    expect(bounded.items.filter((item) => typeof item === 'number').every((page) => PublicVehicleQuerySchema.safeParse({ page, pageSize }).success)).toBe(true);
    expect(bounded.items).not.toContain(2_000_000);
    expect(isPublicCatalogOffsetAllowed(last, pageSize)).toBe(true);
    expect(isPublicCatalogOffsetAllowed(last + 1, pageSize)).toBe(false);
    const firstPage = catalogPagination({ ...input, page: 1 });
    expect(firstPage.items).toEqual([1, 2, 'ellipsis', last]);
    expect(input.total).toBe(2_000_000);
    expect(input.accessibleTotal).toBe(2_000_000);
    expect(catalogPagination({ ...input, total: last * pageSize, accessibleTotal: last * pageSize })).toMatchObject({
      totalPages: last, totalKind: 'exact', truncated: false,
    });
  });

  it('allows a full last page beginning at offset 10000 without inventing a 10000-item total', () => {
    const input = { ...pageInput, page: 2001, pageSize: 5, total: 10_005, accessibleTotal: 10_005, hasMore: false };
    expect(catalogPagination(input)).toMatchObject({ totalPages: 2001, totalKind: 'exact', next: null, truncated: false });
    expect(catalogPagination({ ...input, total: 10_006, accessibleTotal: 10_006, hasMore: true }))
      .toMatchObject({ totalPages: 2001, totalKind: 'accessible', next: null, truncated: true });
  });

  it('stops unknown-total navigation at the actual page-size boundary without inventing a tail', () => {
    const input = { ...pageInput, total: null, totalKind: 'unknown' as const, accessibleTotal: null, page: 209, pageSize: 48 };
    expect(catalogPagination(input)).toMatchObject({ totalPages: null, totalKind: null, items: [209], previous: 208, next: null, truncated: true });
    expect(catalogPagination({ ...input, hasMore: false })).toMatchObject({ totalPages: null, truncated: false });
    expect(catalogPagination({ ...input, page: 210 })).toMatchObject({ totalPages: null, items: [], previous: 209, next: null });
  });
});

function sampleResult() {
  return PublicVehicleListSchema.parse({
    data: { items: [], page: 3, pageSize: 7, hasMore: true },
    meta: {
      requestId: 'synthetic-pager', catalog: 'curated', total: 75, totalKind: 'exact', accessibleTotal: 75,
      dataAsOf: '2026-11-12T00:00:00Z', freshness: 'fresh',
    },
  });
}

describe('catalog pager server markup', () => {
  for (const locale of ['zh', 'en', 'ru'] as const) {
    it(`${locale}: exposes real anchor navigation retaining the selected filter scope`, () => {
      const query = PublicVehicleQuerySchema.parse({ locale, page: 3, pageSize: 7, make: 'toyota', model: 'camry', q: '车 & Car', powertrain: 'hev' });
      const html = renderToStaticMarkup(createElement(CatalogPagination, { result: sampleResult(), query, locale, onPageClick: () => undefined }));
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => new URL(match[1]!.replaceAll('&amp;', '&'), 'https://example.test'));
      expect(links.length).toBeGreaterThan(1);
      expect(links.every((link) => link.pathname === `/${locale}/cars/` && link.searchParams.get('make') === 'toyota'
        && link.searchParams.get('model') === 'camry' && link.searchParams.get('q') === '车 & Car'
        && link.searchParams.get('powertrain') === 'hev' && link.searchParams.get('pageSize') === '7')).toBe(true);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('rel="prev"');
      expect(html).toContain('rel="next"');
      expect(html).toContain('data-catalog-page-count="11"');
      expect(html).toContain('…');
      expect(links.some((link) => link.searchParams.get('page') === '11')).toBe(true);
    });
  }

  it('does not expose a fabricated page total for an unknown supplier scope', () => {
    const result = sampleResult();
    result.meta.total = null; result.meta.totalKind = 'unknown'; result.meta.accessibleTotal = null;
    const query = PublicVehicleQuerySchema.parse({ page: 3, pageSize: 7 });
    const html = renderToStaticMarkup(createElement(CatalogPagination, { result, query, locale: 'ru', onPageClick: () => undefined }));
    expect(html).toContain('data-catalog-page-count="unknown"');
    expect(html).not.toContain(' / ');
    expect(html).not.toContain('…');
  });

  it.each(['zh', 'en', 'ru'] as const)('%s: explains bounded browsing while retaining the real API total', (locale) => {
    const result = sampleResult();
    result.data.page = 209; result.data.pageSize = 48; result.data.hasMore = true;
    result.meta.total = 1_000_000; result.meta.accessibleTotal = 1_000_000;
    const before = structuredClone(result);
    const query = PublicVehicleQuerySchema.parse({ locale, page: 209, pageSize: 48, make: 'toyota', q: 'stock_50%' });
    const html = renderToStaticMarkup(createElement(CatalogPagination, { result, query, locale, onPageClick: () => undefined }));
    expect(html).toContain('data-catalog-offset-hint');
    expect(html).toContain('data-catalog-page-count="209"');
    expect(html).not.toContain('rel="next"');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), 'https://example.test'));
    expect(links.every(link => isPublicCatalogOffsetAllowed(Number(link.searchParams.get('page') ?? '1'), 48))).toBe(true);
    expect(result).toEqual(before);
  });

  it.each(['zh', 'en', 'ru'] as const)('%s: recovery is a readable native link preserving filters, not a fabricated empty result', (locale) => {
    const query = PublicVehicleQuerySchema.parse({ locale, pageSize: 48, q: '车 & stock', make: 'toyota', model: 'camry', priceMin: '0', priceMax: '50000', priceCurrency: 'USD' });
    const html = renderToStaticMarkup(createElement(CatalogOffsetLimitNotice, { locale, query }));
    expect(html).toContain('data-testid="catalog-offset-limit"');
    expect(html).toContain('<h1');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('public-catalog-empty');
    expect(html).not.toContain('<script');
    const url = new URL(html.match(/href="([^"]+)"/)![1]!.replaceAll('&amp;', '&'), 'https://example.test');
    expect(url.pathname).toBe(`/${locale}/cars/`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '车 & stock', make: 'toyota', model: 'camry', priceMin: '0', priceMax: '50000', priceCurrency: 'USD', pageSize: '48' });
  });
});
