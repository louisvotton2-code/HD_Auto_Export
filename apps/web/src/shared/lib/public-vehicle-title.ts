import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import type { Locale } from '@/i18n/routing';

const hasChineseText = /\p{Script=Han}/u;
const genericTitle = { zh: '车辆信息', en: 'Vehicle details', ru: 'Информация об автомобиле' };

/** Imported supplied titles retain their actual source language; catalog placeholders use safe facts. */
export function publicVehicleTitle(vehicle: PublicVehicleSummary, locale: Locale) {
  const original = vehicle.content.title;
  const missingTitle = vehicle.source.kind === 'external' && original.kind === 'catalog';
  const missingChinese = vehicle.source.kind !== 'external' && locale === 'zh' && !/^zh(?:-|$)/i.test(original.contentLocale);
  if (!missingTitle && !missingChinese) {
    return { text: original.text, lang: original.contentLocale };
  }
  const { modelYear } = vehicle.facts;
  const factName = (field: 'make' | 'model' | 'trim') => {
    // The staff-published projection inserts a label for missing translations.
    if (vehicle.source.kind !== 'external' && vehicle.display?.[field].status === 'missing') return '';
    return vehicle.facts[field]?.name.trim() ?? '';
  };
  const brand = factName('make');
  const name = factName('model');
  const brandStem = brand.replace(/汽车$/, '');
  const modelIncludesBrand = brandStem && (
    name === brandStem || name.startsWith(`${brandStem} `) ||
    (hasChineseText.test(brandStem) && name.startsWith(brandStem))
  );
  const identity = modelIncludesBrand ? name : [brand, name].filter(Boolean).join(' ');
  const variant = factName('trim');
  const localizedTrim = locale === 'zh' && variant && hasChineseText.test(variant) && variant !== identity && variant !== name
    ? variant
    : '';
  const year = modelYear !== null && !localizedTrim.includes(String(modelYear))
    ? `${modelYear}${locale === 'zh' ? '款' : ''}`
    : '';
  const text = [identity || genericTitle[locale], year, localizedTrim].filter(Boolean).join(' ');
  return { text, lang: locale };
}
