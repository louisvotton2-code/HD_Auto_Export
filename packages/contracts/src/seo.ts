import { z } from 'zod';
import { LocaleSchema, TimestampSchema, responseSchema } from './common.js';
/** Only the API decides which current languages may be indexed. Omission means no index permission. */
export const PublicVehicleSeoSchema = z.strictObject({
  indexable: z.boolean(), locales: z.array(LocaleSchema).max(3).refine(v => new Set(v).size === v.length),
  lastModified: TimestampSchema.nullable(),
}).refine(v => !v.indexable || v.locales.length > 0 && v.lastModified !== null);
export type PublicVehicleSeo = z.infer<typeof PublicVehicleSeoSchema>;
export const SeoVehicleIdSchema = z.string().regex(/^(?:ext-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const PublicSeoQuerySchema = z.strictObject({ cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100) });
export type PublicSeoQuery = z.infer<typeof PublicSeoQuerySchema>;
export const PublicSeoManifestSchema = z.strictObject({
  enabled: z.boolean(), validUntil: TimestampSchema.nullable(), revision: z.string().min(1).max(100),
  items: z.array(z.strictObject({ id: SeoVehicleIdSchema, locales: z.array(LocaleSchema).min(1).max(3).refine(v => new Set(v).size === v.length),
    lastModified: TimestampSchema })).max(500).refine(items => new Set(items.map(v => v.id)).size === items.length),
  nextCursor: PublicSeoQuerySchema.shape.cursor.unwrap().nullable(),
}).refine(v => v.enabled || !v.items.length && v.nextCursor === null);
export type PublicSeoManifest = z.infer<typeof PublicSeoManifestSchema>;
export const PublicSeoManifestResponseSchema = responseSchema(PublicSeoManifestSchema);
