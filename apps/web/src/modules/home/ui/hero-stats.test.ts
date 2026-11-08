import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/routing';
import { HeroStats } from './hero-stats';

function renderedNumber(html: string, metric: string): string {
  const cell = html.split(`data-hero-stat="${metric}"`)[1]?.split('</div>')[0] ?? '';
  return (cell.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] ?? '')
    .replace(/<[^>]+>/g, '');
}

describe('hero statistics server content', () => {
  for (const [locale, catalogLabel, years] of [
    ['zh', '目录中的汽车', '3年'],
    ['en', 'Cars in catalog', '3 years'],
    ['ru', 'Автомобили в каталоге', '3 года'],
  ] as const) {
    it(`${locale}: renders API count and confirmed company figures before browser effects`, () => {
      const html = renderToStaticMarkup(createElement(HeroStats, { locale, catalogCount: 42 }));
      expect(html).toContain(catalogLabel);
      expect(renderedNumber(html, 'catalog')).toBe('42');
      expect(renderedNumber(html, 'clients')).toBe('660+');
      expect(renderedNumber(html, 'years')).toBe(years);
      expect(html).not.toMatch(/1[ ,\u00a0]?240/);
    });
  }

  it('keeps an unknown catalog total distinct from a confirmed empty catalog', () => {
    const locale: Locale = 'en';
    const unknown = renderToStaticMarkup(createElement(HeroStats, { locale, catalogCount: null }));
    const empty = renderToStaticMarkup(createElement(HeroStats, { locale, catalogCount: 0 }));
    expect(renderedNumber(unknown, 'catalog')).toBe('—');
    expect(renderedNumber(empty, 'catalog')).toBe('0');
    expect(renderedNumber(unknown, 'clients')).toBe('660+');
  });
});
