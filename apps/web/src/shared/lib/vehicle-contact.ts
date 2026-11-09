import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { resolveSiteOrigin } from '@/shared/config/site-origin';
import type { PublicVehicle } from '@hd/contracts/public';
import { publicUsdQuote } from './public-vehicle-price';

/** Structural input shared by home and catalog; never imports a business module. */
export interface VehicleContactFacts {
  id: string;
  make: string;
  model: string;
  year: number;
  priceUsd: number;
  mileageKm: number;
  fuel: string;
  body: string;
  detailPath: string;
}

const copy = {
  zh: {
    intro: '你好，我想咨询这辆车。',
    id: '咨询编号',
    vehicle: '车辆',
    year: '年份',
    price: '参考价格',
    mileage: '里程',
    fuel: '动力',
    body: '车身',
    page: '详情',
    fuels: { electric: '纯电', petrol: '汽油', hybrid: '混合动力', lpg: '液化石油气' },
    bodies: { hatchback: '两厢车', sedan: '轿车', suv: 'SUV' },
  },
  en: {
    intro: 'Hello, I would like to ask about this vehicle.',
    id: 'Inquiry reference',
    vehicle: 'Vehicle',
    year: 'Year',
    price: 'Reference price',
    mileage: 'Mileage',
    fuel: 'Fuel',
    body: 'Body',
    page: 'Details',
    fuels: { electric: 'Electric', petrol: 'Petrol', hybrid: 'Hybrid', lpg: 'LPG' },
    bodies: { hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV' },
  },
  ru: {
    intro: 'Здравствуйте! Хочу узнать об этом автомобиле.',
    id: 'Номер для запроса',
    vehicle: 'Автомобиль',
    year: 'Год',
    price: 'Ориентировочная цена',
    mileage: 'Пробег',
    fuel: 'Двигатель',
    body: 'Кузов',
    page: 'Подробнее',
    fuels: { electric: 'Электро', petrol: 'Бензин', hybrid: 'Гибрид', lpg: 'LPG' },
    bodies: { hatchback: 'Хэтчбек', sedan: 'Седан', suv: 'SUV' },
  },
} satisfies Record<
  Locale,
  {
    intro: string;
    id: string;
    vehicle: string;
    year: string;
    price: string;
    mileage: string;
    fuel: string;
    body: string;
    page: string;
    fuels: Record<'electric' | 'petrol' | 'hybrid' | 'lpg', string>;
    bodies: Record<'hatchback' | 'sedan' | 'suv', string>;
  }
>;

function label(labels: Record<string, string>, value: string) {
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

/** Builds drafts only; the visitor reviews and sends in their own messaging client. */
export function buildVehicleContactLinks(
  vehicle: VehicleContactFacts,
  locale: Locale,
  options: { origin?: string } = {},
) {
  const origin = resolveSiteOrigin(options.origin ?? siteConfig.origin, false);
  const detail = new URL(vehicle.detailPath, origin);
  if (
    !vehicle.detailPath.startsWith('/') ||
    vehicle.detailPath.startsWith('//') ||
    detail.origin !== origin
  )
    throw new Error('Vehicle detailPath must be a local route.');
  const t = copy[locale];
  const number = new Intl.NumberFormat(locale);
  const message = [
    t.intro,
    `${t.id}: ${vehicle.id}`,
    `${t.vehicle}: ${vehicle.make} ${vehicle.model}`,
    `${t.year}: ${vehicle.year}`,
    `${t.price}: ${number.format(vehicle.priceUsd)} USD`,
    `${t.mileage}: ${number.format(vehicle.mileageKm)} km`,
    `${t.fuel}: ${label(t.fuels, vehicle.fuel)}`,
    `${t.body}: ${label(t.bodies, vehicle.body)}`,
    `${t.page}: ${detail.href}`,
  ].join('\n');
  const telegram = new URL(siteConfig.contacts.telegram.href);
  const whatsapp = new URL(siteConfig.contacts.whatsapp.href);
  // Use URI percent encoding (%20 for spaces), including on native deep-link clients.
  const query = `?text=${encodeURIComponent(message)}`;
  telegram.search = query;
  whatsapp.search = query;
  return { telegram: telegram.href, whatsapp: whatsapp.href, message };
}

const publicCopy = {
  zh: {
    intro: '你好，我想咨询这款车。',
    similar: '你好，这辆车已售，我想咨询类似车辆。',
    id: '车号',
    vehicle: '车型',
    year: '年款',
    manufactured: '制造时间',
    mileage: '里程',
    price: '公开价格',
    asking: '售价',
    reference: '参考价',
    onRequest: '待询价',
    status: '库存状态',
    statuses: { available: '在售', reserved: '已预订', sold: '已售' },
    details: '详情',
  },
  en: {
    intro: 'Hello, I would like to ask about this vehicle.',
    similar: 'Hello, this vehicle is sold. I would like to ask about similar vehicles.',
    id: 'Stock code',
    vehicle: 'Vehicle',
    year: 'Model year',
    manufactured: 'Manufactured',
    mileage: 'Mileage',
    price: 'Public price',
    asking: 'Asking price',
    reference: 'Reference price',
    onRequest: 'Price on request',
    status: 'Availability',
    statuses: {
      available: 'Available',
      reserved: 'Reserved',
      sold: 'Sold',
    },
    details: 'Details',
  },
  ru: {
    intro: 'Здравствуйте! Хочу узнать об этом автомобиле.',
    similar: 'Здравствуйте! Этот автомобиль продан. Интересуют похожие автомобили.',
    id: 'Номер автомобиля',
    vehicle: 'Автомобиль',
    year: 'Модельный год',
    manufactured: 'Дата выпуска',
    mileage: 'Пробег',
    price: 'Публичная цена',
    asking: 'Цена продажи',
    reference: 'Ориентировочная цена',
    onRequest: 'Цена по запросу',
    status: 'Наличие',
    statuses: {
      available: 'В продаже',
      reserved: 'Зарезервирован',
      sold: 'Продан',
    },
    details: 'Подробнее',
  },
} satisfies Record<
  Locale,
  {
    intro: string;
    similar: string;
    id: string;
    vehicle: string;
    year: string;
    manufactured: string;
    mileage: string;
    price: string;
    asking: string;
    reference: string;
    onRequest: string;
    status: string;
    statuses: Record<Exclude<PublicVehicle['availability'], 'unknown'>, string>;
    details: string;
  }
>;

/** Public API facts. Unknown fields stay absent; model year never becomes manufacture date. */
export function buildPublicVehicleContactLinks(
  vehicle: PublicVehicle,
  locale: Locale,
  options: { origin?: string } = {},
) {
  const origin = resolveSiteOrigin(options.origin ?? siteConfig.origin, false);
  if (vehicle.detailPath !== `/${locale}/cars/${vehicle.id}/`)
    throw new Error('Vehicle detailPath must match its locale and stable ID.');
  const t = publicCopy[locale];
  const quote = publicUsdQuote(vehicle);
  const price = quote
    ? `${quote.kind === 'reference' ? t.reference : t.asking}: ${quote.money.amount} ${quote.money.currency}`
    : t.onRequest;
  const message = [
    vehicle.availability === 'sold' ? t.similar : t.intro,
    `${t.id}: ${vehicle.stockCode}`,
    `ID: ${vehicle.id}`,
    `${t.vehicle}: ${vehicle.content.title.text}`,
    ...(vehicle.facts.modelYear === null ? [] : [`${t.year}: ${vehicle.facts.modelYear}`]),
    ...(vehicle.facts.manufacturedAt === null
      ? []
      : [`${t.manufactured}: ${vehicle.facts.manufacturedAt.value}`]),
    ...(vehicle.facts.mileageKm === null
      ? []
      : [`${t.mileage}: ${vehicle.facts.mileageKm.toLocaleString(locale)} km`]),
    `${t.price}: ${price}`,
    ...(vehicle.availability === 'unknown'
      ? []
      : [`${t.status}: ${t.statuses[vehicle.availability]}`]),
    `${t.details}: ${new URL(vehicle.detailPath, origin).href}`,
  ].join('\n');
  const telegram = new URL(siteConfig.contacts.telegram.href),
    whatsapp = new URL(siteConfig.contacts.whatsapp.href);
  const query = `?text=${encodeURIComponent(message)}`;
  telegram.search = query;
  whatsapp.search = query;
  return { telegram: telegram.href, whatsapp: whatsapp.href, message };
}
