/** Server public entry. Never export this through the browser-safe index.ts. */
import { cache } from 'react';
import { getSsrPublicVehicle } from './infrastructure/ssr-public-api';
import type { Locale } from '@/i18n/routing';
export {
  getPublicSeoManifest,
  getPublicVehicleInspection,
  parseCatalogQuery,
  parseCatalogPageQuery,
  PublicApiError,
  publicRetryAfter,
} from './infrastructure/public-api';
export {
  createSsrCatalogVersionScope as createCatalogVersionScope,
  getSsrPublicHomepage as getPublicHomepage,
  getSsrPublicFilters as getPublicFilters,
  getSsrPublicCatalog as getPublicCatalog,
} from './infrastructure/ssr-public-api';
export const getPublicVehicleById = cache((id: string, locale: Locale, includePixel = false, includeSeo = false) =>
  getSsrPublicVehicle(id, locale, undefined, { includePixel, includeSeo }),
);
export { getSsrPublicVehicle as readPublicVehicleDocument } from './infrastructure/ssr-public-api';
export { proxyPublicRequest } from './infrastructure/public-proxy';
export { getPublicHtmlCacheVersions } from './infrastructure/public-html-cache-version';
export { readSsrBrowseGeneration } from './infrastructure/ssr-service-http';
export { isPublicApiError } from './infrastructure/public-http';
export { proxyExternalPhotoFailure } from './infrastructure/public-media-report';
export { catalogFacetProjection, projectCatalogFacetOverview, projectCatalogFacetScope } from './catalog-facets';
export { vehicleSeoPresentation, vehicleStructuredData } from './vehicle-seo';
