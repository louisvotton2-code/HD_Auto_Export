import {
  INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS,
  InternalPublicCatalogCacheStampSchema,
  InternalPublicCatalogVersionResponseSchema,
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
type Stored<T extends Envelope> = { resource: Anonymous<T>; deadline: number; proofExpiry: number | null };
export type SsrPublicDescriptor<T extends Envelope> = {
  path: string;
  priceView: PublicCatalogCacheStamp['priceView'];
  scope?: 'filters';
  allowOffsetSnapshot?: true;
  allowInlineSnapshot?: true;
  schema: { parse: (value: unknown) => T };
  media?: (resource: Anonymous<T>) => readonly PublicMedia[];
};
export type SsrCacheIdentity = { deploymentEnv: string; releaseId: string; apiOrigin: string };
export type SsrCacheProtocol = 1 | 2;
type Negotiated<T> = { protocol: SsrCacheProtocol; value: T; offsetSnapshot?: PublicCatalogCacheStamp; inlineSnapshot?: true };
export type SsrInitialVersionRead = (startedAt: number) => {
  startedAt: number;
  result: Promise<Negotiated<PublicCatalogVersionResponse>>;
};
export type SsrAnonymousReader = <T extends Envelope>(descriptor: SsrPublicDescriptor<T>) => Promise<Negotiated<Anonymous<T>>>;
const changedVersionIdentity = Symbol.for('hd-auto.ssr-version-mismatch.v1');
class ChangedPublicVersion extends Error { readonly [changedVersionIdentity] = true; }
const isChangedVersion = (value: unknown) => value !== null && typeof value === 'object' && Reflect.get(value, changedVersionIdentity) === true;

function samePriceView(left: PublicCatalogCacheStamp, right: PublicCatalogCacheStamp) {
  return left.priceView === right.priceView
    && (left.fx?.version ?? null) === (right.fx?.version ?? null)
    && (left.fx?.expiresAt ?? null) === (right.fx?.expiresAt ?? null);
}
function sameVersion(left: PublicCatalogCacheStamp, right: PublicCatalogCacheStamp) {
  return left.version === right.version && samePriceView(left, right);
}

/** Translate the backend's remaining duration, including full network time, without comparing host clocks. */
function deadlineAt(startedAt: number, stamp: PublicCatalogCacheStamp, maxLifetime: number) {
  return startedAt + Math.min(maxLifetime, Date.parse(stamp.validUntil) - Date.parse(stamp.checkedAt));
}

const protocolLifetime = (protocol: SsrCacheProtocol) => protocol === 2
  ? INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS : PUBLIC_CATALOG_CACHE_MAX_TTL_MS;

/** This closure only receives public descriptors/stamps and a static service reader, never visitor context. */
function anonymousLoad<T extends Envelope>(
  descriptor: SsrPublicDescriptor<T>, expected: PublicCatalogCacheStamp, protocol: SsrCacheProtocol, versionDeadline: number,
  readAnonymous: SsrAnonymousReader, now: () => number,
) {
  return async () => {
    const startedAt = now();
    // The HTTP adapter validates the official schema and removes its trace first.
    const { protocol: resourceProtocol, value: resource, offsetSnapshot, inlineSnapshot } = await readAnonymous(descriptor);
    const rawStamp = resource.meta.catalogCache;
    const schema = resourceProtocol === 2 ? InternalPublicCatalogCacheStampSchema : PublicCatalogCacheStampSchema;
    const parsed = schema.safeParse(rawStamp);
    const stamp = parsed.success ? parsed.data : undefined;
    if ((rawStamp !== undefined && !stamp) || (stamp && stamp.priceView !== expected.priceView))
      throw new ChangedPublicVersion();
    const reusable = stamp !== undefined && sameVersion(stamp, expected);
    const oneOffOffset = rawStamp === undefined && descriptor.allowOffsetSnapshot && offsetSnapshot
      && samePriceView(offsetSnapshot, expected) ? offsetSnapshot : undefined;
    const oneOffInline = descriptor.allowInlineSnapshot && inlineSnapshot && stamp && samePriceView(stamp, expected);
    if (!reusable && descriptor.scope !== 'filters' && !oneOffOffset && !oneOffInline) throw new ChangedPublicVersion();
    const maxLifetime = Math.min(protocolLifetime(protocol), protocolLifetime(resourceProtocol));
    const mediaExpiry = (descriptor.media?.(resource) ?? []).reduce((expiry, image) =>
      image.remote?.expiresAt ? Math.min(expiry, Date.parse(image.remote.expiresAt)) : expiry, Infinity);
    const freshness = stamp ?? oneOffOffset;
    const resourceDeadline = freshness ? Math.min(deadlineAt(startedAt, freshness, maxLifetime),
      startedAt + mediaExpiry - Date.parse(freshness.checkedAt)) : startedAt + maxLifetime;
    const deadline = Math.min(versionDeadline, resourceDeadline);
    if (now() >= deadline) throw new SsrDtoCacheExpiredError();
    const proofExpiry = protocol === 2 && resourceProtocol === 2 && reusable
      ? Math.min(Date.parse(stamp.validUntil), mediaExpiry) : null;
    if (oneOffInline && !reusable) delete resource.meta.catalogCache;
    // A consistent one-off snapshot may finish during a version change. Share it with
    // the waiting readers, without assigning it to the checked cache key.
    return { value: { resource, deadline, proofExpiry } satisfies Stored<T>, expiresAt: deadline, reusable };
  };
}

export function createSsrPublicReader({ identity, readVersion, readAnonymous, cache, onStamp,
  now = () => performance.now(), wallNow = Date.now }: {
  identity: SsrCacheIdentity;
  readVersion: (priceView: PublicCatalogCacheStamp['priceView'], scope?: 'filters') => Promise<Negotiated<PublicCatalogVersionResponse>>;
  readAnonymous: SsrAnonymousReader;
  cache?: SsrDtoCache;
  onStamp?: (stamp: PublicCatalogCacheStamp | null, acceptedDeadlineEpochMs?: number) => void;
  now?: () => number;
  wallNow?: () => number;
}) {
  const store = cache ?? new SsrDtoCache({ now });
  return async function read<T extends Envelope>(descriptor: SsrPublicDescriptor<T>, initialVersion?: SsrInitialVersionRead): Promise<T> {
    let observed: PublicCatalogCacheStamp | null = null;
    let acceptedDeadlineEpochMs: number | undefined;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Intentionally outside the shared loader and executed even on a warm hit.
        const startedAt = now();
        const version = attempt === 0 && initialVersion
          ? initialVersion(startedAt)
          : { startedAt, result: readVersion(descriptor.priceView, descriptor.scope) };
        const { protocol, value } = await version.result;
        const schema = protocol === 2 ? InternalPublicCatalogVersionResponseSchema : PublicCatalogVersionResponseSchema;
        const current = schema.parse(value);
        const stamp = current.data;
        if (stamp.priceView !== descriptor.priceView) throw new PublicApiError(503);
        const versionDeadline = deadlineAt(version.startedAt, stamp, protocolLifetime(protocol));
        if (now() >= versionDeadline) throw new PublicApiError(503);
        const key = JSON.stringify([
          identity.deploymentEnv, identity.releaseId, identity.apiOrigin,
          descriptor.path, descriptor.scope ?? null, descriptor.allowOffsetSnapshot ?? null, descriptor.allowInlineSnapshot ?? null,
          protocol, stamp.version, stamp.priceView, stamp.fx?.version ?? null, stamp.fx?.expiresAt ?? null,
        ]);
        try {
          const stored = await store.read<Stored<T>>(key, anonymousLoad(descriptor, stamp, protocol, versionDeadline, readAnonymous, now));
          const remaining = Math.min(versionDeadline, stored.deadline) - now();
          if (remaining <= 0) throw new PublicApiError(503);
          const actual = stored.resource.meta.catalogCache;
          if (onStamp && actual && stored.proofExpiry !== null) {
            const wall = wallNow();
            const expiry = Math.floor(Math.min(stored.proofExpiry, Date.parse(stamp.validUntil), wall + remaining));
            if (expiry > wall && expiry > Date.parse(actual.checkedAt)) {
              observed = { ...actual, fx: actual.fx && { ...actual.fx } };
              acceptedDeadlineEpochMs = expiry;
            }
          }
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
    } finally {
      // Proof bookkeeping is optional and must not replace the rendered data or its error.
      try { onStamp?.(observed, acceptedDeadlineEpochMs); } catch { /* Render proof stays incomplete. */ }
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
