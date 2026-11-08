/** Server public entry. Never export this through the browser-safe index.ts. */
import { cache } from 'react';
import { getPublicVehicle } from './infrastructure/public-api';
import type { Locale } from '@/i18n/routing';
export {
  getPublicHome,
  getPublicFilters,
  getPublicCatalog,
  parseCatalogQuery,
  PublicApiError,
  publicRetryAfter,
} from './infrastructure/public-api';
export const getPublicVehicleById = cache((id: string, locale: Locale) =>
  getPublicVehicle(id, locale, undefined, 'localized'),
);
export { proxyPublicRequest } from './infrastructure/public-proxy';
