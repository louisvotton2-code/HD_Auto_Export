import { PublicVehicleQuerySchema, type PublicFilterQuery, type PublicVehicleQuery, type PublicVehicle } from '@hd/contracts/public';
import { headers } from 'next/headers';
import type { Locale } from '@/i18n/routing';
import { getServerReleaseIdentity } from '@/shared/config/server-runtime';
import { invalidatePublicHtmlRender, publicHtmlRenderTicketHeader, recordPublicHtmlRenderStamp } from '@/shared/lib/public-html-render-proof';
import { localizedHomeSchema, publicFiltersSchema, localizedCardListSchema, localizedInlineVehicleSchema } from '../localized-projection';
import {
  publicUsdCatalogQuery, publicUsdFilterQuery, publicUsdView, publicInlineVehicleView,
  type PublicInlineDetailOptions, type UsdFilterScope,
} from '../public-query';
import { publicApiOrigin, PublicApiError } from './public-http';
import { publicRequestHeaders } from './public-request-context';
import { SsrDtoCache } from './ssr-dto-cache';
import { canonicalPublicPath, createSsrPublicReader, type SsrInitialVersionRead, type SsrPublicDescriptor, type SsrPublicEnvelope } from './ssr-public-reader';
import { readAnonymousPublicResource, readSsrServiceVersion } from './ssr-service-http';

// One bounded store for this Node process, including separate Next route bundles.
const cacheSymbol = Symbol.for('hd-auto.ssr-public-dto-cache.v1');
const processStores = globalThis as typeof globalThis & { [cacheSymbol]?: SsrDtoCache };
function store() { return processStores[cacheSymbol] ??= new SsrDtoCache(); }

async function readSsr<T extends SsrPublicEnvelope>(
  descriptor: SsrPublicDescriptor<T>, incoming?: Pick<Headers, 'get'>, initialVersion?: SsrInitialVersionRead,
) {
  let ticket: string | null = null;
  try {
    if (!incoming) ticket = (await headers()).get(publicHtmlRenderTicketHeader);
    const identity = { ...getServerReleaseIdentity(), apiOrigin: publicApiOrigin() };
    const read = createSsrPublicReader({
      identity, cache: store(), readAnonymous: readAnonymousPublicResource,
      // This function runs per call, even if the DTO key is already warm.
      readVersion: async (priceView, scope) => readSsrServiceVersion(priceView, await publicRequestHeaders(incoming), scope),
      onStamp: ticket ? (stamp, deadline) => {
        if (stamp) recordPublicHtmlRenderStamp(ticket, descriptor.scope ?? 'catalog', stamp, deadline);
        else invalidatePublicHtmlRender(ticket);
      } : undefined,
    });
    const resource = await read(descriptor, initialVersion);
    const { catalogCache: _internalStamp, ...meta } = resource.meta;
    return { ...resource, meta };
  } catch (error) {
    invalidatePublicHtmlRender(ticket);
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}

const media = (vehicles: readonly { images: PublicVehicle['images'] }[]) => vehicles.flatMap(vehicle => vehicle.images);

export function getSsrPublicHome(locale: Locale) {
  return readSsr({ path: canonicalPublicPath('/api/v1/home/vehicles', { locale, ...publicUsdView }),
    priceView: 'usd', schema: localizedHomeSchema(locale, 'usd'), media: value => media(value.data.sections.flatMap(section => section.vehicles)) });
}
export function getSsrPublicFilters(
  locale: Locale,
  scope: UsdFilterScope,
  projection: Pick<PublicFilterQuery, 'projection' | 'make' | 'model'>,
) {
  return readSsrFilters(locale, scope, projection);
}

function readSsrFilters(
  locale: Locale,
  scope: UsdFilterScope,
  projection: Pick<PublicFilterQuery, 'projection' | 'make' | 'model'>,
  initialVersion?: SsrInitialVersionRead,
) {
  return readSsr({ path: canonicalPublicPath('/api/v1/vehicle-filters', { ...publicUsdFilterQuery(locale, scope), ...projection }),
    priceView: 'usd', scope: 'filters', schema: publicFiltersSchema }, undefined, initialVersion);
}

export function getSsrPublicHomeFilters(locale: Locale) {
  // This closure belongs to one homepage render. A resource retry bypasses it.
  let initial: ReturnType<SsrInitialVersionRead> | undefined;
  const readInitialVersion: SsrInitialVersionRead = startedAt => initial ??= {
    startedAt,
    result: publicRequestHeaders().then(visitor => readSsrServiceVersion('usd', visitor, 'filters')),
  };
  return [
    readSsrFilters(locale, {}, { projection: 'overview' }, readInitialVersion),
    readSsrFilters(locale, {}, { projection: 'home-models' }, readInitialVersion),
  ] as const;
}
export function getSsrPublicCatalog(query: PublicVehicleQuery) {
  const effective = PublicVehicleQuerySchema.parse(publicUsdCatalogQuery(query));
  return readSsr({ path: canonicalPublicPath('/api/v1/vehicles', effective), priceView: 'usd',
    allowOffsetSnapshot: effective.cursor || effective.pagination ? undefined : true,
    schema: localizedCardListSchema(query.locale, 'usd'), media: value => media(value.data.items) });
}
export async function getSsrPublicVehicle(
  id: string,
  locale: Locale,
  incoming?: Pick<Headers, 'get'>,
  options: PublicInlineDetailOptions = {},
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return null;
  try {
    const localized = localizedInlineVehicleSchema(locale, 'usd');
    const read = (view?: PublicInlineDetailOptions) => readSsr({
      path: canonicalPublicPath(`/api/v1/vehicles/${id}`, { locale, ...publicInlineVehicleView(id, locale, view) }),
      priceView: 'usd', allowInlineSnapshot: true, schema: { parse(value) {
        const parsed = localized.parse(value);
        if (parsed.data.id !== id || parsed.data.detailPath !== `/${locale}/cars/${id}/`) throw new PublicApiError(503);
        return parsed;
      } }, media: value => value.data.images }, incoming);
    const result = await read(options).catch((error: unknown) => {
      if ((options.includePixel || options.includeSeo) && error instanceof PublicApiError && error.status === 400) return read();
      throw error;
    });
    return result.data;
  } catch (error) {
    if (error instanceof PublicApiError && [400, 404].includes(error.status)) return null;
    throw error;
  }
}
