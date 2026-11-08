import { z } from 'zod';
import {
  AvailabilitySchema, IdSchema, LanguageTagSchema, LocaleSchema, PowertrainSchema,
  PublicPriceSchema, RequestMetaSchema, TimestampSchema, TranslationKindSchema,
  VehicleFactsSchema, responseSchema,
} from './common.js';

export * from './common.js';

export const PublicTextSchema = z.strictObject({
  text: z.string().min(1).max(10_000).regex(/\S/, 'Display text cannot be blank'),
  requestedLocale: LocaleSchema,
  contentLocale: LanguageTagSchema,
  kind: TranslationKindSchema,
  reviewed: z.boolean(),
});
export type PublicText = z.infer<typeof PublicTextSchema>;
export const MediaUrlSchema = z.string().max(2048).refine((value) => {
  if (/^\/api\/v1\/media\/[A-Za-z0-9_-]+$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}, 'Expected a local public media path or an HTTPS URL');
export const PublicMediaSchema = z.strictObject({
  id: IdSchema,
  url: MediaUrlSchema,
  alt: z.string().max(500),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
  sortOrder: z.number().int().min(0).max(29),
  isCover: z.boolean(),
});
export type PublicMedia = z.infer<typeof PublicMediaSchema>;
export const PublicVehicleSchema = z.strictObject({
  id: IdSchema,
  stockCode: z.string().min(1).max(60),
  source: z.strictObject({ kind: z.enum(['manual', 'external']) }),
  facts: VehicleFactsSchema,
  price: PublicPriceSchema,
  content: z.strictObject({ title: PublicTextSchema, description: PublicTextSchema.nullable() }),
  images: z.array(PublicMediaSchema).min(1).max(30),
  availability: AvailabilitySchema,
  availabilityCheckedAt: TimestampSchema.nullable(),
  sourceUpdatedAt: TimestampSchema.nullable(),
  fetchedAt: TimestampSchema.nullable(),
  publishedAt: TimestampSchema,
  detailPath: z.string().regex(/^\/(?:zh|en|ru)\/cars\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/$/),
});
export type PublicVehicle = z.infer<typeof PublicVehicleSchema>;
export const PublicVehicleResponseSchema = responseSchema(PublicVehicleSchema);
export type PublicVehicleResponse = z.infer<typeof PublicVehicleResponseSchema>;

/** HTTP adapters convert query integers explicitly before parsing this logical query. */
export const PublicVehicleQuerySchema = z.strictObject({
  locale: LocaleSchema.default('ru'),
  catalog: z.literal('curated').default('curated'),
  page: z.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().min(1).max(48).default(24),
  make: IdSchema.optional(),
  model: IdSchema.optional(),
  powertrain: PowertrainSchema.optional(),
});
export type PublicVehicleQuery = z.infer<typeof PublicVehicleQuerySchema>;
export const PublicLocaleQuerySchema = z.strictObject({ locale: LocaleSchema.default('ru') });
export type PublicLocaleQuery = z.infer<typeof PublicLocaleQuerySchema>;
export const PublicFilterQuerySchema = z.strictObject({
  locale: LocaleSchema.default('ru'), catalog: z.literal('curated').default('curated'),
});
export type PublicFilterQuery = z.infer<typeof PublicFilterQuerySchema>;
export const CatalogMetaSchema = RequestMetaSchema.extend({
  catalog: z.literal('curated'),
  total: z.number().int().nonnegative().nullable(),
  totalKind: z.enum(['exact', 'provider_reported', 'unknown']),
  accessibleTotal: z.number().int().nonnegative().nullable(),
  dataAsOf: TimestampSchema,
  freshness: z.enum(['fresh', 'stale']),
}).superRefine((value, ctx) => {
  if ((value.totalKind === 'unknown') !== (value.total === null)) {
    ctx.addIssue({ code: 'custom', path: ['total'], message: 'Unknown totals must be null; known totals must be numbers' });
  }
});
export type CatalogMeta = z.infer<typeof CatalogMetaSchema>;
export const PublicVehicleListSchema = z.strictObject({
  data: z.strictObject({
    items: z.array(PublicVehicleSchema).max(48),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(48),
    hasMore: z.boolean(),
  }),
  meta: CatalogMetaSchema,
});
export type PublicVehicleList = z.infer<typeof PublicVehicleListSchema>;

export const PublicHomeSectionSchema = z.strictObject({
  id: IdSchema, title: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'), vehicles: z.array(PublicVehicleSchema).min(1).max(30),
});
export type PublicHomeSection = z.infer<typeof PublicHomeSectionSchema>;
export const PublicHomeSectionsSchema = responseSchema(z.strictObject({ sections: z.array(PublicHomeSectionSchema).max(2) }));
export type PublicHomeSections = z.infer<typeof PublicHomeSectionsSchema>;

const FilterOptionSchema = z.strictObject({ id: IdSchema, name: z.string().min(1).max(120), count: z.number().int().nonnegative() });
export const PublicVehicleFiltersSchema = responseSchema(z.strictObject({
  catalog: z.literal('curated'),
  makes: z.array(FilterOptionSchema),
  models: z.array(FilterOptionSchema.extend({ makeId: IdSchema })),
  powertrains: z.array(z.strictObject({ id: PowertrainSchema, count: z.number().int().nonnegative() })),
}));
export type PublicVehicleFilters = z.infer<typeof PublicVehicleFiltersSchema>;
