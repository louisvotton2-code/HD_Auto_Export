/** Server public entry. Never export this through the browser-safe index.ts. */
import { cache } from 'react';
import { getSsrPublicVehicle } from './infrastructure/ssr-public-api';
import type { Locale } from '@/i18n/routing';
export {
  getPublicSitemapCatalog,
  getPublicVehicleInspection,
  parseCatalogQuery,
  parseCatalogPageQuery,
  PublicApiError,
  publicRetryAfter,
} from './infrastructure/public-api';
export {
  getSsrPublicHome as getPublicHome,
  getSsrPublicFilters as getPublicFilters,
  getSsrPublicCatalog as getPublicCatalog,
} from './infrastructure/ssr-public-api';
export const getPublicVehicleById = cache((id: string, locale: Locale) =>
  getSsrPublicVehicle(id, locale),
);
export { proxyPublicRequest } from './infrastructure/public-proxy';
export { proxyExternalPhotoFailure } from './infrastructure/public-media-report';
