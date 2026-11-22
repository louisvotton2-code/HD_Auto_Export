import logoUrl from '../../../public/brand/hd-auto-logo.webp?site-asset';
import iconUrl from '../../../public/icon.svg?site-asset';
import { siteAssetUrl } from './site-asset';
import { resolveSiteOrigin } from './site-origin';

const indexable = process.env.SITE_INDEXABLE === 'true';
const staticIndexable = process.env.SITE_INDEXABLE === 'static';

export const staticSearchPaths: readonly string[] = ['/about/', '/buy/'];

export const siteConfig = {
  name: 'HD Auto Export',
  domainVerification: {
    'facebook-domain-verification': 'md2rffp4rxtxs1zzhdivrs1oqnbbzy',
  },
  isPlaceholderBrand: false,
  brand: {
    name: 'HD Auto Export',
    iconUrl: siteAssetUrl(iconUrl),
    logo: { src: siteAssetUrl(logoUrl), width: 960, height: 648 },
  },
  contacts: {
    phone: { display: '+86 182 1593 2610', href: 'tel:+8618215932610' },
    phone2: { display: '+86 199 3899 9916', href: 'tel:+8619938999916' },
    whatsapp: { display: '+86 182 1593 2610', href: 'https://wa.me/8618215932610' },
    facebook: { display: 'HDAuto', href: 'https://www.facebook.com/HDAuto' },
    instagram: { display: '@hongding_auto', href: 'https://www.instagram.com/hongding_auto/' },
    tiktok: { display: '@votton.louis', href: 'https://www.tiktok.com/@votton.louis?is_from_webapp=1&sender_device=pc' },
    telegram: { display: '@HD_Auto_CN', href: 'https://t.me/HD_Auto_CN' },
    wechat: [
      { display: '+86 182 1593 2610', copyValue: '+8618215932610' },
      { display: '+86 199 3899 9916', copyValue: '+8619938999916' },
    ],
  },
  origin: resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, indexable || staticIndexable),
  indexable,
  staticIndexable,
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
