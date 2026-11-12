import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicVehicleListSchema, PublicVehicleQuerySchema } from '@hd/contracts/public';
import { catalogPagination } from './catalog-pagination';
import { CatalogPagination } from './ui/catalog-pagination';

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

  it('caps browsable pages at the actual HTTP contract while retaining the API vehicle total', () => {
    const input = { ...pageInput, page: 1_000_000, pageSize: 1, total: 2_000_000, accessibleTotal: 2_000_000 };
    const bounded = catalogPagination(input);
    expect(bounded).toMatchObject({ totalPages: 1_000_000, totalKind: 'accessible', items: [1_000_000], next: null });
    expect(bounded.items.filter((item) => typeof item === 'number').every((page) => PublicVehicleQuerySchema.safeParse({ page }).success)).toBe(true);
    expect(bounded.items).not.toContain(2_000_000);
    const firstPage = catalogPagination({ ...input, page: 1 });
    expect(firstPage.items).toEqual([1, 2, 'ellipsis', 1_000_000]);
    expect(input.total).toBe(2_000_000);
    expect(input.accessibleTotal).toBe(2_000_000);
    expect(catalogPagination({ ...input, total: 1_000_000, accessibleTotal: 1_000_000 })).toMatchObject({
      totalPages: 1_000_000, totalKind: 'exact',
    });
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
});
