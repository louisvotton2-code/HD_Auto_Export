import type { PublicVehicle, PublicVehicleInline } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { publicPageSchema } from '@/shared/lib/page-seo';
import { hasPrivateVehicleSource } from '@/shared/lib/public-vehicle-reference';
import { publicDetailTitle, publicVehicleTitle } from '@/shared/lib/public-vehicle-title';
import { publicVehicleCover } from './public-presentation';

const fallbackDescriptions = {
  zh: (title: string) => `查看 ${title} 的车辆照片和参数，了解购车及进口费用。`,
  en: (title: string) => `See photos and specifications for the ${title}, and estimate vehicle import costs.`,
  ru: (title: string) => `Фотографии и характеристики ${title}, условия покупки и предварительный расчёт расходов на ввоз.`,
} satisfies Record<Locale, (title: string) => string>;

export function vehicleSeoPresentation(vehicle: PublicVehicle & Pick<PublicVehicleInline, 'englishTitle'>, locale: Locale) {
  const languages = vehicle.source.kind === 'demo' ? [] : vehicle.seo?.locales ?? [];
  const eligible = vehicle.seo?.indexable === true && languages.includes(locale);
  const safeDescription = vehicle.content.description;
  const text = safeDescription?.text?.trim();
  const title = siteConfig.indexable && eligible
    ? publicVehicleTitle(vehicle, locale).text
    : publicDetailTitle(vehicle, locale).text;
  const description = text && safeDescription?.contentLocale?.split('-')[0] === locale &&
    !hasPrivateVehicleSource(text) ? text.slice(0, 300) : fallbackDescriptions[locale](title).slice(0, 300);
  const path = `/cars/${vehicle.id}/`;
  const cover = publicVehicleCover(vehicle);
  const image = cover ? { src: cover.url, width: cover.width ?? undefined, height: cover.height ?? undefined } : undefined;
  return { locale, path, eligible, languages, title, description, image };
}

export function vehicleStructuredData(vehicle: PublicVehicle, presentation: ReturnType<typeof vehicleSeoPresentation>) {
  const { locale, path, title, description, image } = presentation;
  const { make, model, modelYear, mileageKm } = vehicle.facts;
  // Only owned, actually available cars with an asking price may advertise an offer.
  const offer = vehicle.source.kind === 'manual' && vehicle.availability === 'available' &&
    vehicle.price.kind === 'asking' && Number(vehicle.price.money.amount) > 0 ? vehicle.price.money : null;
  return {
    ...publicPageSchema(locale, path, title, 'WebPage', description),
    '@type': 'Car',
    image: image && new URL(image.src, siteConfig.origin).href,
    brand: make && !hasPrivateVehicleSource(make.name) ? { '@type': 'Brand', name: make.name } : undefined,
    model: model && !hasPrivateVehicleSource(model.name) ? model.name : undefined,
    vehicleModelDate: modelYear === null ? undefined : String(modelYear),
    mileageFromOdometer: mileageKm === null ? undefined : { '@type': 'QuantitativeValue', value: mileageKm, unitCode: 'KMT' },
    offers: offer ? {
      '@type': 'Offer',
      url: new URL(vehicle.detailPath, siteConfig.origin).href,
      price: offer.amount,
      priceCurrency: offer.currency,
      availability: 'https://schema.org/InStock',
    } : undefined,
  };
}
