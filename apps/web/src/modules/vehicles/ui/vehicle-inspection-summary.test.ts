import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicVehicleInlineSchema, type DisplayText } from '@hd/contracts/public';
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
      for (const text of [copy.unavailable, copy.application, copy.mismatch, copy.match, copy.merchant]) expect(html).toContain(text);
      expect(html).toMatch(new RegExp(`<strong[^>]*>${copy.merchant}</strong>`));
      expect(html).toMatch(new RegExp(`<strong[^>]*>${copy.customer}</strong>`));
      expect(html).not.toContain('data-public-inspection-link');
      expect(html).not.toContain('/inspection/');
      expect(html).not.toContain('https://t.me/');
      expect(html).not.toContain('https://wa.me/');
    }
  });
  it('keeps a known zero distinct from unknown counts without a report navigation action', () => {
    const vehicle = makeLocalizedPublicVehicleFixture('zh');
    vehicle.inspectionSummary = { status: 'available', contentLocale: 'en', checked: 0, faults: null,
      categories: [{ id: 'accident', label: { status: 'ready', text: '事故损伤', requestedLocale: 'zh', contentLocale: 'zh', provenance: 'catalog', reviewed: false }, checked: 0, faults: null, outcome: 'unknown' }] };
    const html = renderToStaticMarkup(createElement(VehicleInspectionSummary, { vehicle, locale: 'zh' }));
    expect(html).toMatch(/<dd>0<\/dd>/);
    expect(html).toContain('<small>检查项: 0</small>');
    expect(html).not.toContain('异常项');
    expect(html).not.toContain('/inspection/');
    expect(html).toContain('id="inspection"');
    expect(html).toContain('不代表历史事故或过户次数');
    expect(html).toContain('未提供结论');
  });
  it.each(['zh', 'en', 'ru'] as const)('omits empty statistics for an available report in %s', locale => {
    const vehicle = makeLocalizedPublicVehicleFixture(locale);
    const copy = inspectionSummaryCopy[locale];
    vehicle.inspectionSummary = { status: 'available', contentLocale: 'en', checked: null, faults: null,
      categories: [{ id: 'accident', label: { status: 'ready', text: 'Accident damage inspection', requestedLocale: locale,
        contentLocale: 'en', provenance: 'catalog', reviewed: false }, checked: null, faults: null, outcome: 'unknown' }] };
    const html = renderToStaticMarkup(createElement(VehicleInspectionSummary, { vehicle, locale }));
    expect(html).not.toContain('data-inspection-complete-counts');
    expect(html).not.toContain(`${copy.checked}:`);
    expect(html).not.toContain(`${copy.faults}:`);
    expect(html).toContain('Accident damage inspection');
    expect(html).toContain(copy.outcomes.unknown);
    expect(html).toContain(copy.contact);
  });
  it('shows the same finding separately for different concrete parts without altering complete statistics', () => {
    const base = makeLocalizedPublicVehicleFixture('zh');
    const field = (text: string): DisplayText => ({ status: 'ready', text, requestedLocale: 'zh', contentLocale: 'en', provenance: 'supplier', reviewed: false });
    const vehicle = PublicVehicleInlineSchema.parse({ ...base, projection: 'detail-inline-v1', configurationInline: [],
      inspectionSummary: { status: 'available', contentLocale: 'en', checked: 32, faults: 5, categories: [] },
      inspectionInline: { conclusions: [], normalItemCount: 12, hasMoreConclusions: false, hasMoreDefects: true,
        defects: ['Left door', 'Right door'].map((part, index) => ({ id: `part-${index}`, category: null, part: field(part),
          name: field('Paint'), value: field('Scratched'), outcome: 'defect', kind: 'defect' })) },
    });
    const html = renderToStaticMarkup(createElement(VehicleInspectionSummary, { vehicle, locale: 'zh' }));
    expect(html.match(/data-inspection-defect=/g)).toHaveLength(2);
    expect(html).toContain('Left door');
    expect(html).toContain('Right door');
    expect(html.match(/Scratched/g)).toHaveLength(2);
    expect(html).toContain('<dd>32</dd>');
    expect(html).toContain('<dd>5</dd>');
    expect(html).toContain('lang="en"');
    expect(html).not.toContain('/inspection/');
  });

});
