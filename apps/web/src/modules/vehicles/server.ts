/** Server public entry. Never export this through the browser-safe index.ts. */
import { cache } from 'react';
import { getPublicVehicle } from './infrastructure/public-api';
import { publicUsdView } from './public-query';
import type { Locale } from '@/i18n/routing';
export {
  getPublicHome,
  getPublicFilters,
  getPublicCatalog,
  getPublicSitemapCatalog,
  parseCatalogQuery,
  parseCatalogPageQuery,
  PublicApiError,
  publicRetryAfter,
} from './infrastructure/public-api';
export const getPublicVehicleById = cache((id: string, locale: Locale) =>
  getPublicVehicle(id, locale, undefined, publicUsdView.view, publicUsdView.priceView),
);
export { proxyPublicRequest } from './infrastructure/public-proxy';
export { proxyExternalPhotoFailure } from './infrastructure/public-media-report';
