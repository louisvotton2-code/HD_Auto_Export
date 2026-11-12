import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeExternalInspectionFixture } from '@hd/contracts/fixtures';
import { hasInspectionContent } from './vehicle-inspection';
import { VehicleInspectionReport } from './ui/vehicle-inspection-report';

describe('structured inspection presentation', () => {
  it.each(['zh', 'en', 'ru'] as const)('explains the bounded legacy-only remainder without an inert %s button', (locale) => {
    const inspection = makeExternalInspectionFixture('unknown');
    inspection.checks = [];
    inspection.defects = [];
    inspection.entries = Array.from({ length: 8 }, (_, index) => ({ name: { text: `Legacy item ${index + 1}`, contentLocale: 'en' }, value: { text: 'Recorded', contentLocale: 'en' } }));
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale, id: 'inspection' }));
    expect(html).toContain('Legacy item 6');
    expect(html).not.toContain('Legacy item 7');
    expect(html).toMatch(/<noscript>.*JavaScript.*\(2\).*<\/noscript>/);
    expect(html).not.toContain('<button');
  });
  it.each([
    ['zh', '启用 JavaScript 后可展开查看分项检测内容。'],
    ['en', 'Enable JavaScript to view the itemized inspection details.'],
    ['ru', 'Включите JavaScript, чтобы просмотреть подробные результаты осмотра.'],
  ] as const)('includes a readable no-script explanation inside each %s disclosure', (locale, instruction) => {
    const inspection = makeExternalInspectionFixture();
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale, id: 'inspection' }));
    const disclosures = [...html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)];
    expect(disclosures.length).toBeGreaterThan(0);
    for (const [, content] of disclosures) {
      expect(content).toMatch(/<noscript><p\b[^>]*>/);
      expect(content).toContain(instruction);
    }
  });

  it('server-renders the first batch without a nonfunctional show-more button', () => {
    const inspection = makeExternalInspectionFixture();
    inspection.entries = Array.from({ length: 8 }, (_, index) => ({
      name: { text: `Entry ${index}`, contentLocale: 'en' },
      value: { text: `Value ${index}`, contentLocale: 'en' },
    }));
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale: 'en', id: 'inspection' }));
    expect(html).toContain('Entry 5');
    expect(html).not.toContain('Entry 6');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Show more');
  });

  it('recognizes structured checks with empty legacy entries and keeps initial markup lightweight', () => {
    const inspection = makeExternalInspectionFixture();
    expect(inspection.entries).toEqual([]);
    expect(hasInspectionContent(inspection)).toBe(true);
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale: 'ru', id: 'inspection' }));
    expect(html).toContain('Проверенные элементы');
    expect(html).toContain('data-inspection-check-category');
    expect(html).toContain('data-inspection-defect-category');
    expect(html).not.toContain('data-inspection-check-item');
    expect(html).not.toContain('data-inspection-defect-item');
    expect(html).not.toContain('reports.example.invalid');
  });

  it('never mounts a thousand leaf rows on the initial render', () => {
    const inspection = makeExternalInspectionFixture();
    const group = inspection.checks![0]!.groups[0]!;
    group.items = Array.from({ length: 1000 }, (_, index) => ({ part: { text: `Part ${index}`, contentLocale: 'en' }, result: null, ok: null }));
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale: 'en', id: 'inspection' }));
    expect(html).not.toContain('Part 0');
    expect(html).not.toContain('Part 999');
    expect(html).toContain('Inspection checks');
  });

  it('keeps explicit zero and null finding counters distinct', () => {
    const inspection = makeExternalInspectionFixture();
    inspection.checks![0]!.defects = 0;
    inspection.defects![0]!.count = null;
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale: 'en', id: 'inspection' }));
    expect(html).toContain('data-inspection-count="0"');
    expect(html).toContain('data-inspection-count="unknown"');
    expect(html).toContain('Not provided');
  });

  it('does not invent an inspection card when there are no inspection rows', () => {
    const inspection = makeExternalInspectionFixture();
    inspection.checks = [];
    inspection.defects = [];
    expect(hasInspectionContent(inspection)).toBe(false);
    expect(renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale: 'en', id: 'inspection' }))).toBe('');
  });

  it('keeps original report links out of the inspection content', () => {
    const inspection = makeExternalInspectionFixture();
    const html = renderToStaticMarkup(createElement(VehicleInspectionReport, { inspection, locale: 'en', id: 'inspection' }));
    expect(html).not.toContain('reports.example.invalid');
    expect(html).not.toContain('target="_blank"');
  });
});
