import { z } from 'zod';
import { RequestMetaSchema, TimestampSchema, responseSchema } from './common.js';

export const PUBLIC_CATALOG_MAX_OFFSET = 10_000;
export function isPublicCatalogOffsetAllowed(page: number, pageSize: number): boolean {
  return Number.isSafeInteger(page) && page >= 1 && Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 48
    && (page - 1) * pageSize <= PUBLIC_CATALOG_MAX_OFFSET;
}
export const PUBLIC_CATALOG_CACHE_MAX_TTL_MS = 15_000;
export const INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS = 300_000;
export const INTERNAL_PUBLIC_HOMEPAGE_CACHE_MAX_TTL_MS = 600_000;
export const INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER = 'x-hd-cache-protocol';
export const PublicCatalogVersionQuerySchema = z.strictObject({
  priceView: z.literal('usd').optional(),
  scope: z.literal('filters').optional(),
});
export const InternalPublicCatalogVersionQuerySchema = z.union([
  PublicCatalogVersionQuerySchema,
  z.strictObject({ priceView: z.literal('usd'), scope: z.literal('homepage') }),
]);
function catalogCacheStampSchema(maxLifetimeMs: number) {
  return z.strictObject({
    version: z.string().regex(/^[a-f0-9]{64}$/),
    priceView: z.enum(['original', 'usd']),
    fx: z.strictObject({ version: z.uuid(), expiresAt: TimestampSchema }).nullable(),
    checkedAt: TimestampSchema,
    validUntil: TimestampSchema,
  }).superRefine((value, ctx) => {
    const duration = Date.parse(value.validUntil) - Date.parse(value.checkedAt);
    if (!Number.isFinite(duration) || duration <= 0 || duration > maxLifetimeMs)
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: `Cache lifetime must be positive and at most ${maxLifetimeMs / 1000} seconds` });
    if (value.priceView === 'original' && value.fx !== null)
      ctx.addIssue({ code: 'custom', path: ['fx'], message: 'Original prices do not depend on an FX quote' });
    if (value.fx && Date.parse(value.validUntil) > Date.parse(value.fx.expiresAt))
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Cache cannot outlive its FX quote' });
  });
}

/** A DTO reuse bound that still requires a live version check. */
export const PublicCatalogCacheStampSchema = catalogCacheStampSchema(PUBLIC_CATALOG_CACHE_MAX_TTL_MS);
export type PublicCatalogCacheStamp = z.infer<typeof PublicCatalogCacheStampSchema>;
export const PublicCatalogVersionResponseSchema = responseSchema(PublicCatalogCacheStampSchema);
export type PublicCatalogVersionResponse = z.infer<typeof PublicCatalogVersionResponseSchema>;
/** For authenticated service responses that explicitly negotiate protocol 2. */
export const InternalPublicCatalogCacheStampSchema = catalogCacheStampSchema(INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS);
export const InternalPublicCatalogVersionResponseSchema = responseSchema(InternalPublicCatalogCacheStampSchema);
export const InternalPublicCatalogHomepageVersionResponseSchema = responseSchema(z.strictObject({
  catalog: InternalPublicCatalogCacheStampSchema,
  filters: InternalPublicCatalogCacheStampSchema,
}));
/** Protocol 3 applies only to the authenticated homepage resources and their live version pair. */
export const InternalPublicHomepageCacheStampSchema = catalogCacheStampSchema(INTERNAL_PUBLIC_HOMEPAGE_CACHE_MAX_TTL_MS);
export const InternalPublicHomepageVersionResponseSchema = responseSchema(z.strictObject({
  catalog: InternalPublicHomepageCacheStampSchema,
  filters: InternalPublicHomepageCacheStampSchema,
}));
export const PublicCatalogResponseMetaSchema = RequestMetaSchema.extend({
  // Optional for older servers/fixtures. An absent stamp prohibits SSR reuse.
  catalogCache: PublicCatalogCacheStampSchema.optional(),
});
