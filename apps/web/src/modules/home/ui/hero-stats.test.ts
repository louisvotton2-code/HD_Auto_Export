import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { approximateCatalogVehicleCount } from '../content/company-metrics';
import { HeroStats } from './hero-stats';

function metricHtml(html: string, metric: string): string {
  return html.split(`data-hero-stat="${metric}"`)[1]?.split('</div>')[0] ?? '';
}

describe('hero statistics server content', () => {
  for (const [locale, catalogLabel, years] of [
    ['zh', '目录中的汽车<wbr/>（约）', '23年'],
    ['en', 'Cars in catalog<wbr/> (approx.)', '23 years'],
    ['ru', 'Автомобили в каталоге<wbr/> (прибл.)', '23 года'],
  ] as const) {
    it(`${locale}: renders the catalog estimate immediately and starts the client count at zero`, () => {
      const html = renderToStaticMarkup(createElement(HeroStats, { locale }));
      const catalog = new Intl.NumberFormat(locale).format(approximateCatalogVehicleCount);
      expect(html).toContain(catalogLabel);
      expect(metricHtml(html, 'catalog')).toContain(`>${catalog}</strong>`);
      expect(metricHtml(html, 'catalog')).not.toContain('data-counter-value');
      expect(metricHtml(html, 'clients')).toContain('data-counter-value="0">0</span>');
      expect(metricHtml(html, 'clients')).toMatch(/class="sr-only"[^>]*>660\+<\/span>/);
      expect(metricHtml(html, 'years')).toContain('data-counter-value="23">23</span>');
      expect(metricHtml(html, 'years')).toContain(`class="sr-only">${years}</span>`);
    });
  }
});
