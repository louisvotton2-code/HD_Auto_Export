import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicVehicleInspectionResponseSchema, type DisplayText } from '@hd/contracts/public';
import { VehicleInspectionPage } from './vehicle-inspection-page';

describe('independent inspection report SSR', () => {
  it('renders known zero, unknown counts and actual English body without a client reveal', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('zh');
    const field = (text: string): DisplayText => ({ status: 'ready', text, requestedLocale: 'zh', contentLocale: 'en', provenance: 'supplier', reviewed: false });
    const summary = { status: 'available', contentLocale: 'en', checked: 0, faults: null,
      categories: [{ id: 'accident', label: field('Accident inspection'), checked: 0, faults: null, outcome: 'unknown' }] };
    const report = PublicVehicleInspectionResponseSchema.parse({ data: {
      vehicleId: vehicle.id, locale: 'zh', revision: 'a'.repeat(64), status: 'available', total: 1,
      nextCursor: null, summary, conclusions: [], items: [{ id: 'one', categoryId: 'accident', partId: 'body', groupId: 'body',
        category: field('Accident inspection'), part: field('Body'), group: field('Body'),
        name: field('Structural inspection'), value: field('No observation supplied'), outcome: 'unknown', kind: 'check' }],
    }, meta: { requestId: 'synthetic-inspection' } });
    const html = renderToStaticMarkup(createElement(VehicleInspectionPage, { vehicle, locale: 'zh', initialReport: report }));
    expect(html).toMatch(/data-report-checked[^>]*>0<\/dd>/);
    expect(html).toMatch(/data-report-faults[^>]*>未提供<\/dd>/);
    expect(html).toContain('data-inspection-page-item="one"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('Structural inspection');
    expect(html).not.toContain('data-vehicle-route-loading');
  });
  it('does not repeat a stored conclusion as a legacy summary row', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    const field = (text: string): DisplayText => ({ status: 'ready', text, requestedLocale: 'en', contentLocale: 'en', provenance: 'supplier', reviewed: false });
    const name = field('Inspection classification');
    const value = field('Stored conclusion shown once');
    const report = PublicVehicleInspectionResponseSchema.parse({ data: {
      vehicleId: vehicle.id, locale: 'en', revision: 'a'.repeat(64), status: 'available', total: 1, nextCursor: null,
      summary: { status: 'available', contentLocale: 'en', checked: 0, faults: null, categories: [] },
      conclusions: [{ id: 'conclusion', name, value }], items: [{ id: 'legacy-summary', category: null, part: null,
        name, value, outcome: 'unknown', kind: 'summary' }],
    }, meta: { requestId: 'synthetic-inspection' } });
    const html = renderToStaticMarkup(createElement(VehicleInspectionPage, { vehicle, locale: 'en', initialReport: report }));
    expect(html.split('Stored conclusion shown once')).toHaveLength(2);
    expect(html).not.toContain('data-inspection-page-item="legacy-summary"');
  });
});
