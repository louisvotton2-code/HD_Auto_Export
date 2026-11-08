import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import type { Locale } from '@/i18n/routing';
import zh from '../../../messages/zh.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { VehicleImportEstimate } from './vehicle-import-estimate';

const messages = { zh, en, ru };
function render(locale: Locale, disabled = false) {
  const vehicle = makePublicVehicleFixture();
  vehicle.facts.powertrain = 'unknown';
  vehicle.facts.manufacturedAt = { precision: 'year', value: '2024' };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale, messages: messages[locale], timeZone: 'Asia/Shanghai',
    children: createElement(VehicleImportEstimate, {
      vehicle, locale, initialDate: '2026-11-08', initialRates: createReferenceSnapshot(), disabled,
    }),
  }));
}

describe('detail calculator server enhancement boundary', () => {
  it.each(['zh', 'en', 'ru'] as Locale[])('keeps a native full-tool link and honest missing fields in %s SSR', (locale) => {
    const html = render(locale);
    expect(html).toContain(`href="/${locale}/calculator/russia/"`);
    expect(html).toContain('data-testid="vehicle-full-calculator"');
    expect(html).not.toContain('#hd-estimate=');
    expect(html).not.toContain('data-testid="inline-estimate-total"');
    expect(html).toMatch(/name="powertrain"[^>]*><option value="" selected="">/);
    expect(html).toMatch(/name="manufactureDate"[^>]*value=""/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain('name="price"');
    expect(html).toContain('value="23500.00"');
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain('2026-10-22');
  });
  it('does not expose a seeded quote while the owning vehicle resource is unavailable', () => {
    const html = render('en', true);
    expect(html).toContain('Vehicle details are unavailable.');
    expect(html).not.toContain('data-testid="inline-estimate-total"');
    expect(html).not.toContain('#hd-estimate=');
    expect(html).toContain('href="/en/calculator/russia/"');
  });
});
