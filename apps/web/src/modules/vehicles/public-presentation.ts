import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import type { Money, PublicMedia, PublicVehicle, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { withImageAltText } from './vehicle-image-text';
import { publicVehicleMessages } from './public-messages';
import { publicMediaUrl } from '@/shared/lib/public-media';
import { publicUsdQuote, roundedUsd } from '@/shared/lib/public-vehicle-price';
import { catalogFilterKeys } from './public-query';
import { catalogFilterCopy } from './catalog-filter-copy';

/** Keep amounts exact, including values too large for precise Number formatting. */
export function formatPublicAmount(amount: string, locale: Locale): string {
  const [whole, fraction = ''] = amount.split('.');
  const formatter = new Intl.NumberFormat(locale);
  const decimal =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const significantFraction = fraction.replace(/0+$/, '');
  return `${formatter.format(BigInt(whole!))}${significantFraction ? `${decimal}${significantFraction}` : ''}`;
}
export function formatVehicleMoney(money: Money, locale: Locale): string {
  if (money.currency === 'USD') return `${new Intl.NumberFormat(locale).format(roundedUsd(money.amount))} USD`;
  const amount = formatPublicAmount(money.amount, locale);
  return money.currency === 'CNY' ? `¥ ${amount}` : `${amount} ${money.currency}`;
}

export function formatPublicVehiclePrice(vehicle: PublicVehicleSummary, locale: Locale): string {
  const { money } = vehicle.price;
  return money ? formatVehicleMoney(money, locale) : publicVehicleMessages(locale).priceLabels.on_request;
}

export function formatPublicVehicleUsdApproximation(vehicle: PublicVehicleSummary, locale: Locale) {
  const quote = publicUsdQuote(vehicle);
  if (!quote?.conversion) return null;
  return `≈ ${new Intl.NumberFormat(locale).format(roundedUsd(quote.money.amount))} USD`;
}

export function publicAvailabilityLabel(vehicle: PublicVehicleSummary, locale: Locale): string {
  // An unknown state has no public badge; it is never converted into an available claim.
  return publicVehicleMessages(locale).availability[vehicle.availability];
}

export function publicVehicleCover(vehicle: PublicVehicleSummary): PublicMedia | null {
  const cover =
    vehicle.images.find((image) => image.isCover) ??
    [...vehicle.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return cover ? { ...withImageAltText(cover, vehicle.display?.mediaAlt), url: publicMediaUrl(cover.url) } : null;
}

/** Hide unknown facts; legitimate zero values remain visible and power uses direct horsepower only. */
export function publicVehicleFacts(
  vehicle: {
    facts: PublicVehicle['facts'];
    manufacture?: PublicVehicle['manufacture'];
    display?: { city: { contentLocale: string | null }; location: { contentLocale: string | null } };
  },
  locale: Locale,
): { label: string; value: string; lang?: string }[] {
  const t = publicVehicleMessages(locale), f = vehicle.facts, c = catalogFilterCopy[locale];
  const number = new Intl.NumberFormat(locale);
  const rows: { label: string; value: string; lang?: string }[] = [];
  const add = (label: string, value: string | number | null | undefined, lang?: string) => {
    if (value === null || value === undefined || String(value).trim() === '') return;
    rows.push({ label, value: String(value), ...(lang ? { lang } : {}) });
  };
  const range = vehicle.manufacture?.range;
  add(t.yearLabel, f.modelYear);
  add(t.manufactureLabel, vehicle.manufacture?.date?.value ??
    (range ? `${range.earliest.value} – ${range.latest.value}` : f.manufacturedAt?.value));
  add(t.registrationLabel, f.firstRegistration?.value);
  add(t.mileageLabel, f.mileageKm === null ? null : `${number.format(f.mileageKm)} ${t.km}`);
  if (f.powertrain !== 'unknown') add(t.powertrain, t.powertrains[f.powertrain]);
  add(c.trim, f.trim?.name);
  add(c.generation, f.generation?.name);
  if (f.drivetrain) add(c.drive, c.drives[f.drivetrain]);
  add(t.engineLabel, f.engineCc === null ? null : `${number.format(f.engineCc)} cm³`);
  const hp = { zh: '马力', en: 'hp', ru: 'л. с.' }[locale];
  add(t.powerLabel, f.powerHp == null ? null : `${number.format(f.powerHp)} ${hp}`);
  if (f.body) add(t.bodyLabel, t.bodies[f.body]);
  if (f.transmission) add(t.transmissionLabel, t.transmissions[f.transmission]);
  const place = f.location?.displayName || f.location?.city;
  const country = f.location?.country;
  const location = place || (country ? new Intl.DisplayNames(locale, { type: 'region', fallback: 'none' }).of(country) ?? country : null);
  const lang = f.location?.displayName ? vehicle.display?.location.contentLocale
    : f.location?.city ? vehicle.display?.city.contentLocale : locale;
  add(t.locationLabel, location, lang ?? undefined);
  return rows;
}

/** Only supported, validated query fields are emitted in public navigation links. */
export function publicCatalogHref(
  locale: Locale,
  query: PublicVehicleQuery,
  page = query.page,
): string {
  const search = new URLSearchParams();
  for (const key of catalogFilterKeys) {
    const value = query[key];
    if (value !== undefined) search.set(key, String(value));
  }
  if (query.pageSize !== 24) search.set('pageSize', String(query.pageSize));
  if (page > 1) search.set('page', String(page));
  return `/${locale}/cars/${search.size ? `?${search}` : ''}`;
}
