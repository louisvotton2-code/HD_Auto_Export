import type { PublicVehicleInline } from '@hd/contracts/public';
import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import { hasPrivateVehicleSource } from './public-vehicle-reference';
import type { Locale } from '@/i18n/routing';

export function publicDetailTitle(vehicle: PublicVehicleInline, locale: Locale) {
  const title = vehicle.englishTitle;
  const text = title?.text.trim();
  if (title && text && text !== '—' && !hasPrivateVehicleSource(text)) {
    return { text, lang: title.contentLocale };
  }
  return publicVehicleTitle(vehicle, locale);
}

const hasChineseText = /\p{Script=Han}/u;
const genericTitle = { zh: '车辆信息', en: 'Vehicle details', ru: 'Информация об автомобиле' };

/** Prefer a matching title, otherwise build it from the localized catalog facts. */
export function publicVehicleTitle(vehicle: PublicVehicleSummary, locale: Locale) {
  const original = vehicle.content.title;
  const matchLocale = (lang: string | null | undefined) => lang?.toLowerCase().split('-')[0] === locale;
  const safeOriginal = original.kind !== 'catalog' && original.text !== '—' && !hasPrivateVehicleSource(original.text);
  if (safeOriginal && matchLocale(original.contentLocale)) {
    return { text: original.text, lang: original.contentLocale };
  }
  const { modelYear } = vehicle.facts;
  const factName = (field: 'make' | 'model' | 'trim') => {
    // The staff-published projection inserts a label for missing translations.
    const name = vehicle.facts[field]?.name.trim() ?? '';
    const display = vehicle.display?.[field];
    if (display?.status === 'missing' || hasPrivateVehicleSource(name) || (locale !== 'zh' && hasChineseText.test(name))) return '';
    return name;
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
  const trimLocale = vehicle.display?.trim.contentLocale;
  const trimInLocale = trimLocale ? matchLocale(trimLocale) : locale === 'zh' && hasChineseText.test(variant);
  const localizedTrim = trimInLocale && variant !== identity && variant !== name ? variant : '';
  const year = modelYear !== null && !localizedTrim.includes(String(modelYear))
    ? `${modelYear}${locale === 'zh' ? '款' : ''}`
    : '';
  if (!identity && !localizedTrim && safeOriginal) return { text: original.text, lang: original.contentLocale };
  const text = [identity || genericTitle[locale], year, localizedTrim].filter(Boolean).join(' ');
  return { text, lang: locale };
}
