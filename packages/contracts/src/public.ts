import { z } from 'zod';
import {
  AvailabilitySchema, DemoVehicleFactsSchema, ExternalPlatformSchema, IdSchema, LocaleSchema, PowertrainSchema,
  PublicPriceSchema, RequestMetaSchema, SafeHttpUrlSchema, SearchTextSchema, TimestampSchema,
  VehicleFactsSchema, CurrencySchema, MoneySchema, NamedValueSchema, responseSchema,
} from './common.js';
import {DrivetrainSchema,VehicleDisplaySchema} from './localization.js';
import { ExternalHttpsUrlSchema, ExternalListingIdSchema, ExternalMediaIdSchema, ExternalPublicSummarySchema, PublicTextSchema, RemoteMediaMetadataSchema } from './external-public.js';

export * from './common.js';
export {DrivetrainSchema,VehicleExtraFactsSchema,DisplayTextSchema,VehicleDisplaySchema} from './localization.js';
export type {Drivetrain,VehicleExtraFacts,DisplayText,VehicleDisplay} from './localization.js';
export * from './catalog.js';
export * from './external-public.js';

export const MediaUrlSchema = z.string().max(2048).refine((value) => {
  if (/^\/api\/v1\/media\/[A-Za-z0-9_-]+(?:\?variant=thumb)?$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}, 'Expected a local public media path or an HTTPS URL');
export const PublicMediaSchema = z.strictObject({
  id: IdSchema,
  url: MediaUrlSchema,
  alt: z.string().max(500),
  width: z.number().int().positive().max(100_000).nullable(),
  height: z.number().int().positive().max(100_000).nullable(),
  sortOrder: z.number().int().min(0).max(29),
  isCover: z.boolean(),
  remote: RemoteMediaMetadataSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.remote && (!ExternalMediaIdSchema.safeParse(value.id).success || !ExternalHttpsUrlSchema.safeParse(value.url).success)) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'Remote media requires its own ID and a safe HTTPS URL' });
  }
  if ((value.width === null) !== (value.height === null) || (!value.remote && value.width === null)) {
    ctx.addIssue({ code: 'custom', path: ['width'], message: 'Only remote images can omit both dimensions' });
  }
});
export type PublicMedia = z.infer<typeof PublicMediaSchema>;
export const PublicMediaQuerySchema = z.strictObject({ variant: z.literal('thumb').optional() });
export type PublicMediaQuery = z.infer<typeof PublicMediaQuerySchema>;
export const SourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual') }),
  z.strictObject({ kind: z.literal('demo') }),
  z.strictObject({ kind: z.literal('external'), platform: ExternalPlatformSchema, listingUrl: SafeHttpUrlSchema }),
]);
export type Source = z.infer<typeof SourceSchema>;
export const PublicVehicleSchema = z.strictObject({
  id: IdSchema,
  stockCode: z.string().min(1).max(60),
  source: SourceSchema,
  facts: VehicleFactsSchema.extend({generation:NamedValueSchema.nullable().optional(),drivetrain:DrivetrainSchema.nullable().optional()}),
  display:VehicleDisplaySchema.optional(),
  price: PublicPriceSchema,
  content: z.strictObject({ title: PublicTextSchema, description: PublicTextSchema.nullable() }),
  images: z.array(PublicMediaSchema).max(30),
  external: ExternalPublicSummarySchema.optional(),
  availability: AvailabilitySchema,
  availabilityCheckedAt: TimestampSchema.nullable(),
  sourceUpdatedAt: TimestampSchema.nullable(),
  fetchedAt: TimestampSchema.nullable(),
  publishedAt: TimestampSchema,
  detailPath: z.string().regex(/^\/(?:zh|en|ru)\/cars\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/$/),
}).superRefine((value, ctx) => {
  if (value.external) {
    if (value.source.kind !== 'external' || !ExternalListingIdSchema.safeParse(value.id).success || value.price.money && value.price.money.currency !== 'CNY') {
      ctx.addIssue({ code: 'custom', path: ['external'], message: 'Imported listings require an external identity and CNY reference or on-request pricing' });
    }
    if (value.images.some(image => !image.remote)) ctx.addIssue({ code: 'custom', path: ['images'], message: 'Imported listing photos must use direct remote media' });
  } else {
    if (!value.images.length || value.images.some(image => image.remote)) ctx.addIssue({ code: 'custom', path: ['images'], message: 'Staff publications require their existing stored media' });
    if ([value.content.title.kind, value.content.description?.kind].some(kind => kind === 'supplier' || kind === 'catalog')) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'Supplier text and generic catalogue labels are limited to imported listings' });
    }
  }
  if (value.source.kind === 'demo') {
    const facts = DemoVehicleFactsSchema.extend({generation:NamedValueSchema.nullable().optional(),drivetrain:DrivetrainSchema.nullable().optional()}).safeParse(value.facts);
    if (!facts.success) for (const issue of facts.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['facts', ...issue.path], message: 'Demo vehicles cannot contain physical inventory facts' });
    }
    if (value.price.kind !== 'on_request') ctx.addIssue({ code: 'custom', path: ['price'], message: 'Demo vehicles must use on-request pricing' });
  }
  if (value.source.kind === 'external' && value.price.kind === 'asking') {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'External vehicles must use reference or on-request pricing' });
  }
  if (value.source.kind === 'demo' || value.source.kind === 'external') {
    if (value.availability !== 'unknown') ctx.addIssue({ code: 'custom', path: ['availability'], message: 'Non-owned vehicle availability must remain unknown' });
    if (value.availabilityCheckedAt !== null) ctx.addIssue({ code: 'custom', path: ['availabilityCheckedAt'], message: 'Non-owned vehicles have no inventory verification timestamp' });
    if (value.content.title.reviewed) ctx.addIssue({ code: 'custom', path: ['content', 'title', 'reviewed'], message: 'Demo and external text cannot claim human review' });
    if (value.content.description?.reviewed) ctx.addIssue({ code: 'custom', path: ['content', 'description', 'reviewed'], message: 'Demo and external text cannot claim human review' });
  }
});
export type PublicVehicle = z.infer<typeof PublicVehicleSchema>;
export const PublicVehicleResponseSchema = responseSchema(PublicVehicleSchema);
export type PublicVehicleResponse = z.infer<typeof PublicVehicleResponseSchema>;

/** HTTP adapters convert query integers explicitly before parsing this logical query. */
const catalogQueryFields={
  locale: LocaleSchema.default('ru'),
  catalog: z.literal('curated').default('curated'),
  view:z.enum(['legacy','localized']).optional(),
  make: IdSchema.optional(),
  model: IdSchema.optional(),
  trim:IdSchema.optional(),generation:IdSchema.optional(),drivetrain:DrivetrainSchema.optional(),
  priceMin:MoneySchema.shape.amount.optional(),priceMax:MoneySchema.shape.amount.optional(),priceCurrency:CurrencySchema.optional(),
  mileageMin:z.number().int().min(0).max(10_000_000).optional(),mileageMax:z.number().int().min(0).max(10_000_000).optional(),
  yearMin:z.number().int().min(1886).max(9999).optional(),yearMax:z.number().int().min(1886).max(9999).optional(),
  powertrain: PowertrainSchema.optional(),
  q: SearchTextSchema.optional(),
};
const cents=(value:string)=>{const [whole,fraction='']=value.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));};
function validateCatalogQuery(value:z.infer<z.ZodObject<typeof catalogQueryFields>>,ctx:z.RefinementCtx) {
  if((value.priceMin!==undefined||value.priceMax!==undefined)&&!value.priceCurrency)ctx.addIssue({code:'custom',path:['priceCurrency'],message:'Price ranges require an explicit currency'});
  if(value.priceMin!==undefined&&value.priceMax!==undefined&&MoneySchema.shape.amount.safeParse(value.priceMin).success&&MoneySchema.shape.amount.safeParse(value.priceMax).success&&cents(value.priceMin)>cents(value.priceMax))ctx.addIssue({code:'custom',path:['priceMax'],message:'Maximum must not be below minimum'});
  for(const [min,max] of [['mileageMin','mileageMax'],['yearMin','yearMax']] as const)
    if(value[min]!==undefined&&value[max]!==undefined&&value[min]>value[max])ctx.addIssue({code:'custom',path:[max],message:'Maximum must not be below minimum'});
  if((value.trim||value.generation)&&(!value.make||!value.model))ctx.addIssue({code:'custom',path:['model'],message:'Trim and generation require make and model IDs'});
}
export const PublicVehicleQuerySchema = z.strictObject({...catalogQueryFields,
  page:z.number().int().min(1).max(1_000_000).default(1),pageSize:z.number().int().min(1).max(48).default(24),
}).superRefine(validateCatalogQuery);
export type PublicVehicleQuery = z.infer<typeof PublicVehicleQuerySchema>;
export const PublicLocaleQuerySchema = z.strictObject({ locale: LocaleSchema.default('ru'),view:z.enum(['legacy','localized']).optional() });
export type PublicLocaleQuery = z.infer<typeof PublicLocaleQuerySchema>;
export const PublicFilterQuerySchema = z.strictObject(catalogQueryFields).superRefine(validateCatalogQuery);
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
  total: z.number().int().nonnegative().optional(),
  makes: z.array(FilterOptionSchema),
  models: z.array(FilterOptionSchema.extend({ makeId: IdSchema })),
  powertrains: z.array(z.strictObject({ id: PowertrainSchema, count: z.number().int().nonnegative() })),
  trims:z.array(FilterOptionSchema.extend({makeId:IdSchema,modelId:IdSchema})).optional(),
  generations:z.array(FilterOptionSchema.extend({makeId:IdSchema,modelId:IdSchema})).optional(),
  drivetrains:z.array(z.strictObject({id:DrivetrainSchema,count:z.number().int().nonnegative()})).optional(),
  modelYears:z.array(z.strictObject({year:z.number().int().min(1886).max(9999),count:z.number().int().nonnegative()})).optional(),
  priceCurrencies:z.array(z.strictObject({id:CurrencySchema,count:z.number().int().nonnegative()})).optional(),
}));
export type PublicVehicleFilters = z.infer<typeof PublicVehicleFiltersSchema>;
