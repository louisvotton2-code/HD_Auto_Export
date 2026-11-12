import {
  PUBLIC_CATALOG_CACHE_MAX_TTL_MS,
  PublicCatalogCacheStampSchema,
  PublicCatalogVersionResponseSchema,
  type PublicMedia,
  type PublicCatalogCacheStamp,
  type PublicCatalogVersionResponse,
} from '@hd/contracts/public';
import { PublicApiError, isPublicApiError } from './public-http';
import { SsrDtoCache, SsrDtoCacheExpiredError } from './ssr-dto-cache';

export type SsrPublicEnvelope = { data: unknown; meta: { requestId: string; catalogCache?: PublicCatalogCacheStamp } };
type Envelope = SsrPublicEnvelope;
export type AnonymousPublicEnvelope<T extends Envelope> = Omit<T, 'meta'> & { meta: Omit<T['meta'], 'requestId'> };
type Anonymous<T extends Envelope> = AnonymousPublicEnvelope<T>;
type Stored<T extends Envelope> = { resource: Anonymous<T>; deadline: number };
export type SsrPublicDescriptor<T extends Envelope> = {
  path: string;
  priceView: PublicCatalogCacheStamp['priceView'];
  schema: { parse: (value: unknown) => T };
  media?: (resource: Anonymous<T>) => readonly PublicMedia[];
};
export type SsrCacheIdentity = { deploymentEnv: string; releaseId: string; apiOrigin: string };
export type SsrAnonymousReader = <T extends Envelope>(descriptor: SsrPublicDescriptor<T>) => Promise<Anonymous<T>>;
const changedVersionIdentity = Symbol.for('hd-auto.ssr-version-mismatch.v1');
class ChangedPublicVersion extends Error { readonly [changedVersionIdentity] = true; }
const isChangedVersion = (value: unknown) => value !== null && typeof value === 'object' && Reflect.get(value, changedVersionIdentity) === true;

function sameVersion(left: PublicCatalogCacheStamp, right: PublicCatalogCacheStamp) {
  return left.version === right.version && left.priceView === right.priceView
    && (left.fx?.version ?? null) === (right.fx?.version ?? null)
    && (left.fx?.expiresAt ?? null) === (right.fx?.expiresAt ?? null);
}

/** Translate the backend's remaining duration, including full network time, without comparing host clocks. */
function deadlineAt(startedAt: number, stamp: PublicCatalogCacheStamp) {
  return startedAt + Math.min(PUBLIC_CATALOG_CACHE_MAX_TTL_MS, Date.parse(stamp.validUntil) - Date.parse(stamp.checkedAt));
}

/** This closure only receives public descriptors/stamps and a static service reader, never visitor context. */
function anonymousLoad<T extends Envelope>(
  descriptor: SsrPublicDescriptor<T>, expected: PublicCatalogCacheStamp, versionDeadline: number,
  readAnonymous: SsrAnonymousReader, now: () => number,
) {
  return async () => {
    const startedAt = now();
    // The HTTP adapter validates the official schema and removes its trace first.
    const resource = await readAnonymous(descriptor);
    const parsed = PublicCatalogCacheStampSchema.safeParse(resource.meta.catalogCache);
    if (!parsed.success || !sameVersion(parsed.data, expected)) throw new ChangedPublicVersion();
    const mediaBudget = (descriptor.media?.(resource) ?? []).reduce((duration, image) =>
      image.remote?.expiresAt ? Math.min(duration, Date.parse(image.remote.expiresAt) - Date.parse(parsed.data.checkedAt)) : duration,
    PUBLIC_CATALOG_CACHE_MAX_TTL_MS);
    const deadline = Math.min(versionDeadline, deadlineAt(startedAt, parsed.data), startedAt + mediaBudget);
    if (now() >= deadline) throw new SsrDtoCacheExpiredError();
    return { value: { resource, deadline } satisfies Stored<T>, expiresAt: deadline };
  };
}

export function createSsrPublicReader({ identity, readVersion, readAnonymous, cache, now = () => performance.now() }: {
  identity: SsrCacheIdentity;
  readVersion: (priceView: PublicCatalogCacheStamp['priceView']) => Promise<PublicCatalogVersionResponse>;
  readAnonymous: SsrAnonymousReader;
  cache?: SsrDtoCache;
  now?: () => number;
}) {
  const store = cache ?? new SsrDtoCache({ now });
  return async function read<T extends Envelope>(descriptor: SsrPublicDescriptor<T>): Promise<T> {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Intentionally outside the shared loader and executed even on a warm hit.
        const versionStartedAt = now();
        const current = PublicCatalogVersionResponseSchema.parse(await readVersion(descriptor.priceView));
        const stamp = current.data;
        if (stamp.priceView !== descriptor.priceView) throw new PublicApiError(503);
        const versionDeadline = deadlineAt(versionStartedAt, stamp);
        if (now() >= versionDeadline) throw new PublicApiError(503);
        const key = JSON.stringify([
          identity.deploymentEnv, identity.releaseId, identity.apiOrigin,
          descriptor.path, stamp.version, stamp.priceView, stamp.fx?.version ?? null, stamp.fx?.expiresAt ?? null,
        ]);
        try {
          const stored = await store.read<Stored<T>>(key, anonymousLoad(descriptor, stamp, versionDeadline, readAnonymous, now));
          if (now() >= Math.min(versionDeadline, stored.deadline)) throw new PublicApiError(503);
          return { ...stored.resource, meta: { ...stored.resource.meta, requestId: current.meta.requestId } } as T;
        } catch (error) {
          if (isChangedVersion(error) && attempt === 0) continue;
          throw error;
        }
      }
      throw new PublicApiError(503);
    } catch (error) {
      if (isPublicApiError(error)) throw new PublicApiError(error.status, error.retryAfter);
      throw new PublicApiError(503);
    }
  };
}

/** Run in the HTTP adapter, before any value reaches the cross-request cache loader. */
export function anonymousPublicEnvelope<T extends Envelope>(envelope: T): Anonymous<T> {
  const { requestId: _trace, ...meta } = envelope.meta;
  return { ...envelope, meta } as Anonymous<T>;
}

/** Keys use the exact effective query sent upstream, independently of property insertion order. */
export function canonicalPublicPath(path: string, query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size ? `${path}?${params}` : path;
}
