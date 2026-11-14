import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import type { Locale } from '@/i18n/routing';
import { inspectionSummaryCopy } from '../inspection-summary-copy';
import { VehicleInspectionSummary } from './vehicle-inspection-summary';

describe('same-response inspection summary', () => {
  it.each(['zh', 'en', 'ru'] as Locale[])('keeps the service conditions without a report action in %s', locale => {
    for (const status of ['no_report', 'unknown', 'pending', 'unavailable'] as const) {
      const vehicle = makeLocalizedPublicVehicleFixture(locale);
      vehicle.inspectionSummary = { status, contentLocale: null, checked: null, faults: null, categories: [] };
      const html = renderToStaticMarkup(createElement(VehicleInspectionSummary, { vehicle, locale }));
      const copy = inspectionSummaryCopy[locale];
      expect(html).toContain(`data-inspection-status="${status}"`);
      for (const text of [copy.unavailable, copy.application, copy.mismatch, copy.match]) expect(html).toContain(text);
      expect(html).not.toContain('data-public-inspection-link');
      expect(html).not.toContain('/inspection/');
      expect(html).toContain('https://t.me/');
      expect(html).toContain('https://wa.me/');
    }
  });
  it('keeps a known zero distinct from unknown counts and links to the local independent report', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('zh');
    vehicle.inspectionSummary = { status: 'available', contentLocale: 'en', checked: 0, faults: null,
      categories: [{ id: 'accident', label: { status: 'ready', text: '事故损伤', requestedLocale: 'zh', contentLocale: 'zh', provenance: 'catalog', reviewed: false }, checked: 0, faults: null, outcome: 'unknown' }] };
    const html = renderToStaticMarkup(createElement(VehicleInspectionSummary, { vehicle, locale: 'zh' }));
    expect(html).toMatch(/<dd>0<\/dd>/);
    expect(html).toMatch(/<dd>未提供<\/dd>/);
    expect(html).toContain(`href="${vehicle.detailPath}inspection/"`);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('不代表历史事故或过户次数');
    expect(html).toContain('未提供结论');
  });
});
