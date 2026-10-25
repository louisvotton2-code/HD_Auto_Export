import { resolveSiteOrigin } from './site-origin';

const indexable = process.env.SITE_INDEXABLE === 'true';

export const siteConfig = {
  name: 'HD Auto Export',
  companyWebsite: 'https://hongdingauto.com/',
  isPlaceholderBrand: false,
  brand: {
    name: 'HD Auto Export',
    logo: { src: '/brand/hd-auto-logo.webp', width: 960, height: 648 },
  },
  contacts: {
    phone: { display: '+86 182 1593 2610', href: 'tel:+8618215932610' },
    whatsapp: { display: '+86 182 1593 2610', href: 'https://wa.me/8618215932610' },
    facebook: { display: 'HDAuto', href: 'https://www.facebook.com/HDAuto' },
    instagram: { display: '18215932610', copyValue: '18215932610' },
    telegram: { display: '18215932610', copyValue: '18215932610' },
    wechat: { display: '18215932610', copyValue: '18215932610' },
  },
  origin: resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, indexable),
  indexable,
  defaultCountrySlug: 'russia',
};

export function localizedAlternates(path: string) {
  return {
    'zh-Hans': `/zh${path}`,
    en: `/en${path}`,
    ru: `/ru${path}`,
    'x-default': `/ru${path}`,
  };
}
