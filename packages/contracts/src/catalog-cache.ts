import { z } from 'zod';
import { RequestMetaSchema, TimestampSchema, responseSchema } from './common.js';

export const PUBLIC_CATALOG_MAX_OFFSET = 10_000;
export function isPublicCatalogOffsetAllowed(page: number, pageSize: number): boolean {
  return Number.isSafeInteger(page) && page >= 1 && Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 48
    && (page - 1) * pageSize <= PUBLIC_CATALOG_MAX_OFFSET;
}
export const PUBLIC_CATALOG_CACHE_MAX_TTL_MS = 15_000;
export const PublicCatalogVersionQuerySchema = z.strictObject({ priceView: z.literal('usd').optional() });
/** A DTO reuse bound, never permission to cache version checks or serve stale data. */
export const PublicCatalogCacheStampSchema = z.strictObject({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  priceView: z.enum(['original', 'usd']),
  fx: z.strictObject({ version: z.uuid(), expiresAt: TimestampSchema }).nullable(),
  checkedAt: TimestampSchema,
  validUntil: TimestampSchema,
}).superRefine((value, ctx) => {
  const duration = Date.parse(value.validUntil) - Date.parse(value.checkedAt);
  if (duration <= 0 || duration > PUBLIC_CATALOG_CACHE_MAX_TTL_MS)
    ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Cache lifetime must be positive and at most 15 seconds' });
  if (value.priceView === 'original' && value.fx !== null)
    ctx.addIssue({ code: 'custom', path: ['fx'], message: 'Original prices do not depend on an FX quote' });
  if (value.fx && Date.parse(value.validUntil) > Date.parse(value.fx.expiresAt))
    ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Cache cannot outlive its FX quote' });
});
export type PublicCatalogCacheStamp = z.infer<typeof PublicCatalogCacheStampSchema>;
export const PublicCatalogVersionResponseSchema = responseSchema(PublicCatalogCacheStampSchema);
export type PublicCatalogVersionResponse = z.infer<typeof PublicCatalogVersionResponseSchema>;
export const PublicCatalogResponseMetaSchema = RequestMetaSchema.extend({
  // Optional for older servers/fixtures. An absent stamp prohibits SSR reuse.
  catalogCache: PublicCatalogCacheStampSchema.optional(),
});
