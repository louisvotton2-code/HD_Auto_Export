import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { resolveSiteOrigin } from '@/shared/config/site-origin';

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
    intro: '你好，我想咨询这辆演示车辆。',
    id: '演示编号',
    vehicle: '车辆',
    year: '年份',
    price: '示例价格',
    mileage: '里程',
    fuel: '动力',
    body: '车身',
    page: '详情',
    fuels: { electric: '纯电', petrol: '汽油', hybrid: '混合动力', lpg: '液化石油气' },
    bodies: { hatchback: '两厢车', sedan: '轿车', suv: 'SUV' },
  },
  en: {
    intro: 'Hello, I would like to ask about this demo vehicle.',
    id: 'Demo ID',
    vehicle: 'Vehicle',
    year: 'Year',
    price: 'Example price',
    mileage: 'Mileage',
    fuel: 'Fuel',
    body: 'Body',
    page: 'Details',
    fuels: { electric: 'Electric', petrol: 'Petrol', hybrid: 'Hybrid', lpg: 'LPG' },
    bodies: { hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV' },
  },
  ru: {
    intro: 'Здравствуйте! Хочу узнать об этом демонстрационном автомобиле.',
    id: 'Демо ID',
    vehicle: 'Автомобиль',
    year: 'Год',
    price: 'Цена в примере',
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
