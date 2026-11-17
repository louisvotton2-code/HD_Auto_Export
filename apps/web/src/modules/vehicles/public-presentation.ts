import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import type { DisplayText, Money, PublicMedia, PublicVehicle, PublicVehicleInline, PublicVehicleQuery } from '@hd/contracts/public';
import type { PublicationPreviewText } from '@hd/contracts/admin';
import type { Locale } from '@/i18n/routing';
import { withImageAltText } from './vehicle-image-text';
import { publicVehicleMessages } from './public-messages';
import { publicMediaUrl } from '@/shared/lib/public-media';
import { formatDisplayAmount } from '@/shared/lib/display-amount';
import { publicUsdQuote } from '@/shared/lib/public-vehicle-price';
import { catalogFilterKeys } from './public-query';
import { catalogFilterCopy } from './catalog-filter-copy';
import { publicVehicleRecordsCopy } from './public-vehicle-records-copy';
import { configurationFacts, type ConfigurationFact } from './vehicle-fact-configuration';

export { formatDisplayAmount as formatPublicAmount };
export function formatVehicleMoney(money: Money, locale: Locale, maximumDecimals = 2): string {
  const amount = formatDisplayAmount(money.amount, locale, 0, maximumDecimals);
  return money.currency === 'CNY' ? `¥ ${amount}` : `${amount} ${money.currency}`;
}

export function formatPublicVehiclePrice(vehicle: PublicVehicleSummary, locale: Locale): string {
  const { money } = vehicle.price;
  return money ? formatVehicleMoney(money, locale, 0) : publicVehicleMessages(locale).priceLabels.on_request;
}

export function formatPublicVehicleUsdApproximation(vehicle: PublicVehicleSummary, locale: Locale) {
  const quote = publicUsdQuote(vehicle);
  if (!quote?.conversion) return null;
  return `≈ ${formatDisplayAmount(quote.money.amount, locale, 0, 0)} USD`;
}

export function publicAvailabilityLabel(vehicle: Pick<PublicVehicleSummary, 'availability'>, locale: Locale): string {
  const { availability } = vehicle;
  if (availability === 'reserved' || availability === 'sold')
    return publicVehicleMessages(locale).availability[availability];
  return '';
}

export function publicVehicleCover(vehicle: PublicVehicleSummary): PublicMedia | null {
  const cover =
    vehicle.images.find((image) => image.isCover) ??
    [...vehicle.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return cover ? { ...withImageAltText(cover, vehicle.display?.mediaAlt), url: publicMediaUrl(cover.url) } : null;
}

type DetailText = DisplayText | PublicationPreviewText;
type TechnicalDetails = NonNullable<PublicVehicleInline['technicalDetails']>;
type SpecificPower = keyof TechnicalDetails['power'];
export type DetailTextField = 'trim' | 'generation' | 'location' | 'city';
export type VehicleFactId = 'modelYear' | 'manufacturedAt' | 'firstRegistration' | 'mileageKm'
  | 'powertrain' | 'trim' | 'generation' | 'drivetrain' | 'displacementCc' | 'powerHp' | 'powerKw'
  | 'body' | 'transmission' | 'location' | 'vehicleClass' | SpecificPower;
export type VehicleFactRow = {
  id: VehicleFactId;
  label: string;
  value: string;
  lang?: string;
  displayField?: DetailTextField;
  configuration?: ConfigurationFact;
};

const kwLabel = { zh: '功率（kW）', en: 'Power (kW)', ru: 'Мощность (кВт)' };
const originalHpLabel = { zh: '原始马力（hp）', en: 'Original horsepower (hp)', ru: 'Исходная мощность (л. с.)' };
const kwUnit = { zh: 'kW', en: 'kW', ru: 'кВт' };
const hpUnit = { zh: '马力', en: 'hp', ru: 'л. с.' };
const specificPowerLabels = {
  engineKw: { zh: '发动机功率', en: 'Engine power (kW)', ru: 'Мощность двигателя (кВт)' },
  motorKw: { zh: '电机功率', en: 'Electric motor power (kW)', ru: 'Мощность электромотора (кВт)' },
  systemKw: { zh: '系统综合功率', en: 'Combined system power (kW)', ru: 'Суммарная мощность системы (кВт)' },
  engineHp: { zh: '发动机马力', en: 'Engine power (hp)', ru: 'Мощность двигателя (л. с.)' },
  motorHp: { zh: '电机马力', en: 'Electric motor power (hp)', ru: 'Мощность электромотора (л. с.)' },
  systemHp: { zh: '系统综合马力', en: 'Combined system power (hp)', ru: 'Суммарная мощность системы (л. с.)' },
} satisfies Record<SpecificPower, Record<Locale, string>>;

function readyText(field: DetailText | null | undefined, locale: Locale) {
  if (!field || field.requestedLocale !== locale) return null;
  // Preview retains review metadata. Both current DTOs accept a supplied nonempty value.
  if ('status' in field ? field.status !== 'ready' : field.reviewStatus === 'missing') return null;
  const text = field.text?.trim();
  return text ? { text, lang: field.contentLocale ?? undefined } : null;
}

/** Only facts that reach this list may suppress a configuration row. */
export function publicVehicleFacts(
  vehicle: {
    facts: PublicVehicle['facts'];
    source?: Pick<PublicVehicle['source'], 'kind'>;
    manufacture?: PublicVehicle['manufacture'];
    display?: Partial<Record<DetailTextField, DetailText>>;
    vehicleClass?: DetailText | null;
    technicalDetails?: Pick<TechnicalDetails, 'power'>;
    configuration?: PublicVehicle['configuration'];
    configurationInline?: PublicVehicleInline['configurationInline'];
    external?: Pick<NonNullable<PublicVehicle['external']>, 'issues'>;
  },
  locale: Locale,
): VehicleFactRow[] {
  const t = publicVehicleMessages(locale), f = vehicle.facts, c = catalogFilterCopy[locale];
  const count = new Intl.NumberFormat(locale);
  const precision = new Intl.NumberFormat(locale, { maximumFractionDigits: 20 });
  const rows: VehicleFactRow[] = [];
  // Supplier detail facts require the API’s cross-language verification.
  // An explicitly empty inline snapshot is authoritative over a legacy full configuration.
  const supplierDetail = vehicle.source?.kind === 'external' && vehicle.external !== undefined;
  const configured = supplierDetail ? null : configurationFacts(
    vehicle.configurationInline ?? vehicle.configuration?.items ?? [], locale, vehicle.external?.issues,
  );
  const addText = (id: VehicleFactId, label: string, value: string | null | undefined,
    lang?: string, displayField?: DetailTextField) => {
    if (value?.trim()) {
      rows.push({ id, label, value: value.trim(), lang, displayField });
      return;
    }
    const configuration = configured?.get(id);
    if (configuration && typeof configuration.value === 'string')
      rows.push({ id, label, value: configuration.value, lang: configuration.field.contentLocale ?? undefined, configuration });
  };
  const addNumber = (id: VehicleFactId, label: string, value: number | null | undefined,
    unit?: 'cc' | 'hp' | 'kw' | 'km', suffix = '') => {
    const configuration = value == null ? configured?.get(id) ?? undefined : undefined;
    const number = value ?? configuration?.value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return;
    const text = unit ? `${(unit === 'hp' || unit === 'kw' ? precision : count).format(number)} ${suffix}` : String(number);
    rows.push({ id, label, value: text, configuration });
  };
  const named = (field: 'trim' | 'generation', label: string) => {
    const fact = f[field];
    const text = fact ? readyText(vehicle.display?.[field], locale) : null;
    if (text) addText(field, label, text.text, text.lang, field);
    else addText(field, label, vehicle.display?.[field] ? null : fact?.name);
  };
  const range = vehicle.manufacture?.range;
  addNumber('modelYear', t.yearLabel, f.modelYear);
  addText('manufacturedAt', t.manufactureLabel, vehicle.manufacture?.date?.value ??
    (range ? `${range.earliest.value} – ${range.latest.value}` : f.manufacturedAt?.value));
  if (f.firstRegistration || f.registrationStatus !== 'never_registered')
    addText('firstRegistration', t.registrationLabel, f.firstRegistration?.value);
  addNumber('mileageKm', t.mileageLabel, f.mileageKm, 'km', t.km);
  const { powertrain, drivetrain, body, transmission } = f;
  addText('powertrain', t.powertrain, powertrain === 'unknown' ? null : t.powertrains[powertrain]);
  named('trim', c.trim);
  named('generation', c.generation);
  addText('drivetrain', c.drive, drivetrain ? c.drives[drivetrain] : null);
  addNumber('displacementCc', t.engineLabel, f.engineCc, 'cc', 'cm³');
  addNumber('powerKw', kwLabel[locale], f.powerKw, 'kw', kwUnit[locale]);
  addNumber('powerHp', originalHpLabel[locale], f.powerHp, 'hp', hpUnit[locale]);
  for (const id of Object.keys(specificPowerLabels) as SpecificPower[]) {
    const unit = id.endsWith('Hp') ? 'hp' : 'kw';
    addNumber(id, specificPowerLabels[id][locale], vehicle.technicalDetails?.power[id], unit,
      unit === 'hp' ? hpUnit[locale] : kwUnit[locale]);
  }
  addText('body', t.bodyLabel, body && body !== 'unknown' ? t.bodies[body] : null);
  addText('transmission', t.transmissionLabel, transmission && transmission !== 'unknown' ? t.transmissions[transmission] : null);
  if (f.location) {
    const place = readyText(vehicle.display?.location, locale);
    const city = readyText(vehicle.display?.city, locale);
    if (place) addText('location', t.locationLabel, place.text, place.lang, 'location');
    else if (!vehicle.display?.location && f.location.displayName?.trim())
      addText('location', t.locationLabel, f.location.displayName);
    else if (city) addText('location', t.locationLabel, city.text, city.lang, 'city');
    else if (!vehicle.display?.city && f.location.city?.trim())
      addText('location', t.locationLabel, f.location.city);
    else if (f.location.country !== 'ZZ' && f.location.country !== 'XX') {
      const country = new Intl.DisplayNames(locale, { type: 'region', fallback: 'none' }).of(f.location.country);
      addText('location', t.locationLabel, country, locale);
    } else addText('location', t.locationLabel, null);
  } else addText('location', t.locationLabel, null);
  const vehicleClass = readyText(vehicle.vehicleClass, locale);
  addText('vehicleClass', publicVehicleRecordsCopy[locale].vehicleClass, vehicleClass?.text, vehicleClass?.lang);
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
