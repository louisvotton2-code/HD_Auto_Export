import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConfigurationDisplay } from '@hd/contracts/public';
import { makeConfigurationDisplayFixture } from '@hd/contracts/fixtures';
import type { Locale } from '@/i18n/routing';
import { VehicleConfiguration } from './ui/vehicle-configuration';

function render(configuration: ConfigurationDisplay | null | undefined, locale: Locale = 'en', showMetadata = false) {
  return renderToStaticMarkup(createElement(VehicleConfiguration, { configuration, locale, showMetadata }));
}

function values(html: string) {
  return [...html.matchAll(/data-configuration-field="value"[^>]*>([\s\S]*?)<\/span>/g)].map((match) => match[1]);
}

describe('shared public and staff vehicle configuration', () => {
  it.each(['zh', 'en', 'ru'] as const)('renders the %s display projection in source order with the section expanded', (locale) => {
    const configuration = makeConfigurationDisplayFixture(locale);
    const html = render(configuration, locale);
    expect(html).toContain('data-vehicle-configuration="true"');
    expect(html).toMatch(/<details[^>]* open=""/);
    expect([...html.matchAll(/data-configuration-item="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(configuration.items.map((item) => item.id));
    expect(values(html)).toEqual(['1989', '8']);
    for (const item of configuration.items) expect(html).toContain(item.name.text);
    expect(html).toContain(`data-requested-locale="${locale}"`);
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain('lang="und"');
  });

  it('keeps absent and empty configuration sections out of both views', () => {
    for (const configuration of [null, undefined, { version: 1 as const, items: [] }]) {
      expect(render(configuration)).toBe('');
      expect(render(configuration, 'ru', true)).toBe('');
    }
  });

  it('does not format, translate or drop language-neutral numeric values and units', () => {
    const configuration = makeConfigurationDisplayFixture('ru');
    configuration.items[0]!.value.text = '  000.00 mm / 20 ℃  ';
    configuration.items[1]!.value.text = '0';
    const before = structuredClone(configuration);
    expect(values(render(configuration, 'ru'))).toEqual(['  000.00 mm / 20 ℃  ', '0']);
    expect(configuration).toEqual(before);
  });

  it('uses the unknown marker for missing display values rather than zero or a raw draft fallback', () => {
    const configuration = makeConfigurationDisplayFixture('en');
    configuration.items[0]!.value = { status: 'missing', text: null, requestedLocale: 'en', contentLocale: null, provenance: null, reviewed: false };
    const html = render(configuration, 'en', true);
    expect(values(html)).toEqual(['—', '8']);
    expect(html).toContain('data-display-status="missing"');
    expect(html).toContain('Not entered');
  });

  it('preserves fallback language and provenance without claiming an unreviewed translation was reviewed', () => {
    const configuration = makeConfigurationDisplayFixture('en');
    configuration.items[0]!.name = { status: 'ready', text: '排量(cc)', requestedLocale: 'en', contentLocale: 'zh', provenance: 'original', reviewed: false };
    const html = render(configuration, 'en', true);
    expect(html).toMatch(/data-configuration-field="name"[^>]*data-provenance="original"[^>]*data-reviewed="false"[^>]*lang="zh"[^>]*>排量\(cc\)<\/span>/);
    expect(html).toContain('Machine translated');
    expect(html).toContain('Not reviewed');
  });

  it('shares the exact same values in public and preview while showing audit labels only to staff', () => {
    const configuration = makeConfigurationDisplayFixture('en');
    const publicHtml = render(configuration);
    const previewHtml = render(configuration, 'en', true);
    expect(values(publicHtml)).toEqual(values(previewHtml));
    expect(publicHtml).toContain('data-provenance="machine"');
    expect(publicHtml).toContain('data-reviewed="false"');
    expect(publicHtml).not.toContain('data-configuration-metadata');
    expect(publicHtml).not.toContain('Machine translated');
    expect(previewHtml).toContain('data-configuration-metadata');
  });

  it('renders configuration text literally, including HTML-like input', () => {
    const configuration = makeConfigurationDisplayFixture('en');
    configuration.items[0]!.name.text = '<img src=x onerror=alert(1)>';
    configuration.items[0]!.value.text = '<script>alert(1)</script>';
    const html = render(configuration);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });
});
