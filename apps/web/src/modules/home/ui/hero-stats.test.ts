import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
    it(`${locale}: renders the exact total without animation and starts the company metrics at zero`, () => {
      const catalogTotal = 108_481;
      const html = renderToStaticMarkup(createElement(HeroStats, { locale, catalogTotal }));
      const catalog = new Intl.NumberFormat(locale).format(catalogTotal);
      expect(metricHtml(html, 'catalog')).toContain(`>${catalogLabel}</dt>`);
      expect(metricHtml(html, 'catalog')).toContain(`>${catalog}</strong>`);
      expect(metricHtml(html, 'catalog')).not.toContain('data-counter-value');
      for (const [metric, finalText] of [['clients', '660+'], ['years', years]]) {
        const markup = metricHtml(html, metric);
        expect(markup).toContain('data-counter-value="0">0</span>');
        expect(markup).toContain(`>${finalText}</span>`);
        expect(markup).toContain('class="sr-only"');
      }
    });
  }
  it('keeps an exact zero', () => {
    const html = renderToStaticMarkup(createElement(HeroStats, { locale: 'en', catalogTotal: 0 }));
    expect(metricHtml(html, 'catalog')).toContain('>0</strong>');
    expect(metricHtml(html, 'catalog')).toContain('Cars in catalog');
  });
  it.each([
    ['zh', '目录总数暂不可用 · 预设值'],
    ['en', 'Catalog count unavailable · Preset'],
    ['ru', 'Количество недоступно · Заданное значение'],
  ] as const)('%s: labels the preset when the catalog total is missing', (locale, label) => {
    const html = renderToStaticMarkup(createElement(HeroStats, { locale, catalogTotal: null }));
    const markup = metricHtml(html, 'catalog');
    expect(markup).toContain(label);
    expect(markup).toContain(`>${new Intl.NumberFormat(locale).format(470_000)}<span`);
    expect(markup).toContain('>+</span></strong>');
    expect(markup).not.toContain('data-counter-value');
  });
});
