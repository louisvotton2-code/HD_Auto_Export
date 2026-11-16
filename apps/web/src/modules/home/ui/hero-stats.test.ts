import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/routing';
import { HeroStats } from './hero-stats';

function metricHtml(html: string, metric: string): string {
  return html.split(`data-hero-stat="${metric}"`)[1]?.split('</div>')[0] ?? '';
}

describe('hero statistics server content', () => {
  for (const [locale, catalogLabel, years] of [
    ['zh', '目录中的汽车', '23年'],
    ['en', 'Cars in catalog', '23 years'],
    ['ru', 'Автомобили в каталоге', '23 года'],
  ] as const) {
    it(`${locale}: sends zero for animated metrics and final values for assistive reading`, () => {
      const html = renderToStaticMarkup(createElement(HeroStats, { locale, catalogCount: 42 }));
      expect(html).toContain(catalogLabel);
      expect(metricHtml(html, 'catalog')).toContain('data-counter-value="0">0</span>');
      expect(metricHtml(html, 'catalog')).toMatch(/class="sr-only"[^>]*>42<\/span>/);
      expect(metricHtml(html, 'clients')).toContain('data-counter-value="0">0</span>');
      expect(metricHtml(html, 'clients')).toMatch(/class="sr-only"[^>]*>660\+<\/span>/);
      expect(metricHtml(html, 'years')).toContain('data-counter-value="23">23</span>');
      expect(metricHtml(html, 'years')).toContain(`class="sr-only">${years}</span>`);
      expect(html).not.toMatch(/1[ ,\u00a0]?240/);
    });
  }

  it('keeps an unknown catalog total distinct from a confirmed empty catalog', () => {
    const locale: Locale = 'en';
    const unknown = renderToStaticMarkup(createElement(HeroStats, { locale, catalogCount: null }));
    const empty = renderToStaticMarkup(createElement(HeroStats, { locale, catalogCount: 0 }));
    expect(metricHtml(unknown, 'catalog')).toContain('data-counter-value="unknown">—</span>');
    expect(metricHtml(empty, 'catalog')).toContain('data-counter-value="0">0</span>');
  });
});
