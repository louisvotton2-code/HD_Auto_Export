import { ExternalHttpsUrlSchema, type Locale } from '@hd/contracts/public';

type LinkUse = 'listing' | 'media' | 'report';
type SourcePlatform = { name: string; listingHost: string; contentLocale: Locale };
export type ExternalSourceProfile = {
  id: string;
  platforms: Readonly<Record<string, SourcePlatform>>;
  media: (url: URL) => boolean;
  report: (url: URL) => boolean;
};

export const syntheticProfile: ExternalSourceProfile = {
  id: 'synthetic-feed',
  platforms: {
    'synthetic-market': { name: 'Synthetic Market', listingHost: 'listings.example.invalid', contentLocale: 'en' },
    'synthetic-market-alt': { name: 'Synthetic Market Two', listingHost: 'listings.example.invalid', contentLocale: 'en' },
  },
  media: url => url.hostname === 'photos.example.invalid' && !url.search,
  report: url => url.hostname === 'reports.example.invalid' && !url.search,
};

const unsignedPhotos = new Set(['p3-dcd.byteimg.com', 'p9-dcd.byteimg.com']);
const signedPhotos = new Set(['p3-dcd-sign.byteimg.com', 'p9-dcd-sign.byteimg.com']);
const psm = /^[A-Za-z0-9.]{1,80}$/;
const signedQuery = { psm, lk3s: /^[A-Za-z0-9]{1,32}$/, 'x-expires': /^\d{10}$/, 'x-signature': /^[A-Za-z0-9+_/=-]{10,160}$/ };
const reportQuery = { dealerid: /^[A-Za-z0-9+_/=-]{1,100}$/, infoid: /^[A-Za-z0-9+_/=-]{1,100}$/, fromtype: /^\d{1,3}$/, isglobal: /^[01]$/ };
function exactQuery(url: URL, rules: Readonly<Record<string, RegExp>>) {
  const entries = [...url.searchParams];
  return entries.length === Object.keys(rules).length && new Set(entries.map(([key]) => key)).size === entries.length &&
    entries.every(([key, value]) => Object.hasOwn(rules, key) && rules[key]!.test(value));
}

/** Checked sample hosts only. This profile is passed by the offline importer, never from HTTP input. */
export const chinaCarSampleProfile: ExternalSourceProfile = {
  id: 'chinacarapi-sample',
  platforms: {
    che168: { name: '车168', listingHost: 'www.che168.com', contentLocale: 'zh' },
    dongchedi: { name: '懂车帝', listingHost: 'www.dongchedi.com', contentLocale: 'zh' },
  },
  media: url => url.hostname === 'erscglobal2.autoimg.cn' ? !url.search :
    unsignedPhotos.has(url.hostname) ? exactQuery(url, { psm }) : signedPhotos.has(url.hostname) && exactQuery(url, signedQuery),
  report: url => url.hostname === 'activitym.che168.com' && url.pathname === '/2025/honestVehicleInspectionReport/main/index' && exactQuery(url, reportQuery),
};

export const getProfile = (provider: string) => provider === chinaCarSampleProfile.id ? chinaCarSampleProfile : syntheticProfile;
export const getPlatform = (profile: ExternalSourceProfile, id: string) => Object.hasOwn(profile.platforms, id) ? profile.platforms[id]! : null;
export function publicLink(value: string | null, use: LinkUse, profile = syntheticProfile, platform?: string): string | null {
  if (!value || !ExternalHttpsUrlSchema.safeParse(value).success) return null;
  const url = new URL(value);
  const allowed = use === 'listing' ? !url.search && (platform ? getPlatform(profile, platform)?.listingHost === url.hostname :
    Object.values(profile.platforms).some(entry => entry.listingHost === url.hostname)) : profile[use](url);
  return allowed ? value : null;
}

export function knownPhotoExpiry(url: URL) {
  const seconds = url.searchParams.get('x-expires');
  return signedPhotos.has(url.hostname) && seconds && /^\d{10}$/.test(seconds) ? new Date(Number(seconds) * 1000).toISOString() : null;
}
