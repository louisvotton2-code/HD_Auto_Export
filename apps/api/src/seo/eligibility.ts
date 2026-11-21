import type { Locale } from '@hd/contracts/public';
export const SEO_EXTERNAL_LIMIT = 1000;
export const seoLocales: Locale[] = ['zh', 'en', 'ru'];
type Obj = Record<string, any>;
export type SeoRecord = { id: string; kind: 'manual'|'external'; facts: Obj; localized: Obj; content: Obj|null;
  price: string|null; visible: boolean; has_image: boolean; last_modified: Date; image_until?: Date|null; display?: Obj|null };
const text = (v: unknown, min = 1) => typeof v === 'string' && v.trim().length >= min;
const language = (value: unknown, locale: Locale) => typeof value === 'string' && value.toLowerCase().split('-')[0] === locale;
function currentText(field: Obj|undefined, locale: Locale, minimum: number): boolean {
  const t = field?.translations?.[locale];
  return !!t && text(t.text, minimum) && t.reviewStatus !== 'stale' && t.sourceVersion === field!.sourceVersion &&
    (t.kind !== 'original' || language(field!.sourceLanguage, locale));
}
function publicText(t: Obj|undefined, locale: Locale, minimum: number): boolean {
  return !!t && text(t.text, minimum) && t.kind !== 'catalog' && language(t.contentLocale, locale);
}
function displayText(t: Obj|undefined, locale: Locale): boolean {
  return !!t && t.status === 'ready' && text(t.text) && language(t.contentLocale, locale);
}
/** Shared by detail permission, manifest reads and the controlled selection refresh; no network or clock reads. */
export function eligibleSeoLocales(row: SeoRecord): Locale[] {
  const f = row.facts;
  if (!row.visible || !row.has_image || !f?.make?.id || !f?.model?.id || !Number.isInteger(f.modelYear) ||
      !Number.isInteger(f.mileageKm) || f.mileageKm < 0 || !f.powertrain || f.powertrain === 'unknown' ||
      row.price === null || !/^\d+(?:\.\d+)?$/.test(row.price) || Number(row.price) <= 0 || !Number.isFinite(Number(row.price))) return [];
  return seoLocales.filter(locale => {
    if (row.kind === 'external') {
      const l = row.localized?.[locale];
      return publicText(l?.title, locale, 4) && publicText(l?.description, locale, 20) &&
        displayText(l?.display?.make, locale) && displayText(l?.display?.model, locale);
    }
    const d = row.display?.[locale]?.display;
    return currentText(row.content?.title, locale, 4) && currentText(row.content?.description, locale, 20) &&
      displayText(d?.make, locale) && displayText(d?.model, locale);
  });
}
