import { PublicVehicleFiltersSchema, PublicVehicleQuerySchema, type PublicVehicleQuery, type PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { getServerReleaseIdentity } from '@/shared/config/server-runtime';
import { localizedHomeSchema, localizedListSchema, localizedVehicleSchema } from '../localized-projection';
import { publicUsdCatalogQuery, publicUsdFilterQuery, publicUsdView, type UsdFilterScope } from '../public-query';
import { publicApiOrigin, PublicApiError } from './public-http';
import { publicRequestHeaders } from './public-request-context';
import { SsrDtoCache } from './ssr-dto-cache';
import { canonicalPublicPath, createSsrPublicReader, type SsrPublicDescriptor, type SsrPublicEnvelope } from './ssr-public-reader';
import { readAnonymousPublicResource, readSsrServiceVersion } from './ssr-service-http';

// One bounded store for this Node process, including separate Next route bundles.
const cacheSymbol = Symbol.for('hd-auto.ssr-public-dto-cache.v1');
const processStores = globalThis as typeof globalThis & { [cacheSymbol]?: SsrDtoCache };
function store() { return processStores[cacheSymbol] ??= new SsrDtoCache(); }

async function readSsr<T extends SsrPublicEnvelope>(descriptor: SsrPublicDescriptor<T>) {
  try {
    const identity = { ...getServerReleaseIdentity(), apiOrigin: publicApiOrigin() };
    const read = createSsrPublicReader({
      identity, cache: store(), readAnonymous: readAnonymousPublicResource,
      // This function runs per call, even if the DTO key is already warm.
      readVersion: async priceView => readSsrServiceVersion(priceView, await publicRequestHeaders()),
    });
    return await read(descriptor);
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}

const media = (vehicles: readonly PublicVehicle[]) => vehicles.flatMap(vehicle => vehicle.images);

export function getSsrPublicHome(locale: Locale) {
  return readSsr({ path: canonicalPublicPath('/api/v1/home/vehicles', { locale, ...publicUsdView }),
    priceView: 'usd', schema: localizedHomeSchema(locale, 'usd'), media: value => media(value.data.sections.flatMap(section => section.vehicles)) });
}
export function getSsrPublicFilters(locale: Locale, scope?: UsdFilterScope) {
  return readSsr({ path: canonicalPublicPath('/api/v1/vehicle-filters', publicUsdFilterQuery(locale, scope)),
    priceView: 'usd', schema: PublicVehicleFiltersSchema });
}
export function getSsrPublicCatalog(query: PublicVehicleQuery) {
  const effective = PublicVehicleQuerySchema.parse(publicUsdCatalogQuery(query));
  return readSsr({ path: canonicalPublicPath('/api/v1/vehicles', effective), priceView: 'usd',
    schema: localizedListSchema(query.locale, 'usd'), media: value => media(value.data.items) });
}
export async function getSsrPublicVehicle(id: string, locale: Locale) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return null;
  try {
    const localized = localizedVehicleSchema(locale, 'usd');
    const result = await readSsr({ path: canonicalPublicPath(`/api/v1/vehicles/${id}`, { locale, ...publicUsdView }),
      priceView: 'usd', schema: { parse(value) {
        const parsed = localized.parse(value);
        if (parsed.data.id !== id || parsed.data.detailPath !== `/${locale}/cars/${id}/`) throw new PublicApiError(503);
        return parsed;
      } }, media: value => value.data.images });
    return result.data;
  } catch (error) {
    if (error instanceof PublicApiError && [400, 404].includes(error.status)) return null;
    throw error;
  }
}
