import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { resolveSiteOrigin } from '@/shared/config/site-origin';
import { partHref } from './query';
import type { Part } from './types';

const contactCopy = {
  zh: { intro: '你好，我想咨询这个配件。', oem: '配件号', name: '配件名称', quantity: '咨询数量', price: 'USD参考单价', detail: '详情' },
  en: { intro: 'Hello, I would like to ask about this part.', oem: 'Part number', name: 'Part name', quantity: 'Enquiry quantity', price: 'USD reference unit price', detail: 'Details' },
  ru: { intro: 'Здравствуйте! Хочу узнать об этой запчасти.', oem: 'Номер детали', name: 'Название', quantity: 'Количество для запроса', price: 'Справочная цена за единицу в USD', detail: 'Подробнее' },
} satisfies Record<Locale, Record<string, string>>;

export function buildPartContactLinks(part: Part, locale: Locale, quantity = 1, options: { origin?: string } = {}) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('Invalid part quantity');
  if (!/^[a-z0-9]+$/.test(part.slug) || part.oem.toLowerCase() !== part.slug) throw new Error('Invalid part identity');
  const t = contactCopy[locale];
  const origin = resolveSiteOrigin(options.origin ?? siteConfig.origin, false);
  const message = [t.intro, `${t.oem}: ${part.oem}`, `${t.name}: ${part.name[locale]}`, `${t.quantity}: ${quantity}`,
    ...(part.referencePriceUsd === null ? [] : [`${t.price}: ${part.referencePriceUsd} USD`]),
    `${t.detail}: ${new URL(partHref(locale, part.slug), origin).href}`].join('\n');
  const telegram = new URL(siteConfig.contacts.telegram.href), whatsapp = new URL(siteConfig.contacts.whatsapp.href);
  telegram.searchParams.set('text', message); whatsapp.searchParams.set('text', message);
  return { telegram: telegram.href, whatsapp: whatsapp.href, message };
}
