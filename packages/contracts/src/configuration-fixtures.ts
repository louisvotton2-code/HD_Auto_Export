import { ConfigurationDisplaySchema } from './configuration-display.js';
import { vehicleConfigurationItemId } from './configuration.js';
import type { Locale } from './common.js';

/** Synthetic consumer sample only; it is not evidence of a paid translation or human approval. */
export function makeConfigurationDisplayFixture(locale: Locale = 'zh') {
  const names = { zh: ['排量(cc)', '挡位数'], en: ['Displacement (cc)', 'Gears'], ru: ['Объём двигателя (куб. см)', 'Количество передач'] };
  return ConfigurationDisplaySchema.parse({ version: 1, items: ['排量(cc)', '挡位数'].map((source, index) => ({
    id: vehicleConfigurationItemId(source),
    name: { status: 'ready', text: names[locale][index], requestedLocale: locale, contentLocale: locale, provenance: locale === 'zh' ? 'original' : 'machine', reviewed: false },
    value: { status: 'ready', text: index === 0 ? '1989' : '8', requestedLocale: locale, contentLocale: 'und', provenance: 'original', reviewed: false },
  })) });
}
