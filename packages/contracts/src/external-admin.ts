import { z } from 'zod';
import { IdSchema, LanguageTagSchema, LocaleSchema, NamedValueSchema, PowertrainSchema, TimestampSchema, VehicleFactsSchema, responseSchema } from './common.js';
import { DrivetrainSchema } from './localization.js';
import {
  ExternalDetailEntrySchema, ExternalDisputeFieldSchema, ExternalHistorySchema, ExternalInspectionContentSchema,
  ExternalIssueSchema, ExternalListingIdSchema, ExternalTaggedTextSchema, ExternalTimestampSchema,
} from './external-public.js';
import { PublicVehicleSchema } from './public.js';

export const EXTERNAL_TRIAL_SIZE = 100;
export const EXTERNAL_TRIAL_CHARACTER_LIMIT = 100_000;
const RevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const ListingVersionSchema = RevisionSchema.max(2_147_483_647);
const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ExternalIdentitySchema = z.strictObject({
  provider: IdSchema,
  platformId: IdSchema,
  externalId: z.string().min(1).max(300).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
});
const CandidateIdentitySchema = ExternalIdentitySchema.omit({ provider: true }).extend({
  revision: RevisionSchema,
  fetchedAt: ExternalTimestampSchema,
  sourceUpdatedAt: ExternalTimestampSchema.nullable(),
});
const candidateUrl = z.string().min(1).max(2048);
const shortText = (max: number) => z.string().min(1).max(max).regex(/\S/).regex(/^[^\u0000]*$/);
const taggedText = (max: number) => z.strictObject({ text: shortText(max), contentLocale: LanguageTagSchema });
function externalCopy(max: number) {
  return z.strictObject({
    original: taggedText(max),
    translations: z.partialRecord(LocaleSchema, taggedText(max)),
  }).superRefine((value, ctx) => {
    for (const [locale, text] of Object.entries(value.translations)) {
      if (text.contentLocale.split('-')[0] !== locale) ctx.addIssue({
        code: 'custom', path: ['translations', locale], message: 'Supplier text must declare its actual language',
      });
    }
  });
}
export const ExternalFactsSchema = VehicleFactsSchema.extend({ generation: NamedValueSchema.nullable(), drivetrain: DrivetrainSchema.nullable() });
export const ExternalCopySchema = z.strictObject({
  title: externalCopy(500).nullable(),
  model: externalCopy(120).nullable(),
  description: externalCopy(2000).nullable(),
});
const CandidatePriceSchema = z.strictObject({ cny: z.union([z.string().max(100), z.number(), z.null()]).optional() });
const RemoteImageCandidateSchema = z.strictObject({
  sourceMediaId: ExternalIdentitySchema.shape.externalId,
  url: candidateUrl,
  width: z.number().int().positive().max(100_000).nullable(),
  height: z.number().int().positive().max(100_000).nullable(),
  alt: ExternalTaggedTextSchema.nullable(),
  expiresAt: ExternalTimestampSchema.nullable(),
});
export const ExternalUpsertCandidateSchema = CandidateIdentitySchema.extend({
  operation: z.literal('upsert'),
  listingUrl: candidateUrl,
  relatedListingUrls: z.array(candidateUrl).max(20),
  facts: ExternalFactsSchema,
  disputes: z.array(ExternalDisputeFieldSchema).max(ExternalDisputeFieldSchema.options.length).refine(values => new Set(values).size === values.length),
  price: CandidatePriceSchema.nullable(),
  sellerPrice: CandidatePriceSchema.nullable(),
  copy: ExternalCopySchema,
  images: z.array(RemoteImageCandidateSchema).max(30).refine(images => new Set(images.map(image => image.sourceMediaId)).size === images.length),
  specifications: z.array(ExternalDetailEntrySchema).max(500),
  history: ExternalHistorySchema.nullable().optional(),
  // A source may submit content and a candidate URL, never server verification evidence.
  inspection: ExternalInspectionContentSchema.safeExtend({ reportUrl: candidateUrl.nullable() }).nullable(),
});
export const ExternalCandidateSchema = z.discriminatedUnion('operation', [
  ExternalUpsertCandidateSchema,
  CandidateIdentitySchema.extend({ operation: z.literal('withdraw') }),
]);
export type ExternalCandidate = z.infer<typeof ExternalCandidateSchema>;
export type ExternalUpsertCandidate = z.infer<typeof ExternalUpsertCandidateSchema>;

// Raw text is opaque. A malformed candidate is recorded independently of its siblings.
export const ExternalImportBatchRequestSchema = z.strictObject({
  provider: IdSchema,
  records: z.array(z.strictObject({ raw: z.string().min(1).max(262_144), candidate: z.unknown() })).min(1).max(250),
});
export type ExternalImportBatchRequest = z.infer<typeof ExternalImportBatchRequestSchema>;
export const ExternalAdminPageQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export type ExternalAdminPageQuery = z.infer<typeof ExternalAdminPageQuerySchema>;
const pageFields = { page: ExternalAdminPageQuerySchema.shape.page, pageSize: ExternalAdminPageQuerySchema.shape.pageSize, total: CountSchema };
export const ExternalBatchSchema = z.strictObject({
  id: z.uuid(), provider: IdSchema, importedAt: TimestampSchema,
  state: z.enum(['completed', 'completed_with_issues']),
  counts: z.strictObject({ total: CountSchema, applied: CountSchema, unchanged: CountSchema, ignored: CountSchema, rejected: CountSchema }),
});
export type ExternalBatch = z.infer<typeof ExternalBatchSchema>;
export const ExternalBatchResponseSchema = responseSchema(ExternalBatchSchema);
export const ExternalBatchListResponseSchema = responseSchema(z.strictObject({ ...pageFields, items: z.array(ExternalBatchSchema).max(100) }));
export const ExternalRecordReasonSchema = z.enum([
  'invalid_record', 'identity_unconfirmed', 'unsafe_listing_url', 'staff_listing_exists', 'stale_revision', 'revision_conflict',
]);
export const ExternalBatchRecordSchema = z.strictObject({
  row: z.number().int().min(1).max(250),
  listingId: ExternalListingIdSchema.nullable(),
  operation: z.enum(['upsert', 'withdraw']).nullable(),
  status: z.enum(['applied', 'unchanged', 'ignored', 'rejected']),
  reason: ExternalRecordReasonSchema.nullable(),
  issues: z.array(ExternalIssueSchema).max(50),
});
export type ExternalBatchRecord = z.infer<typeof ExternalBatchRecordSchema>;
export const ExternalBatchRecordsResponseSchema = responseSchema(z.strictObject({ ...pageFields, items: z.array(ExternalBatchRecordSchema).max(100) }));
export const ExternalBatchRecordResponseSchema = responseSchema(ExternalBatchRecordSchema.extend({
  candidate: ExternalCandidateSchema.nullable(), rawHash: SourceHashSchema,
}));
export const ExternalRawRecordResponseSchema = responseSchema(z.strictObject({ raw: z.string().max(262_144), rawHash: SourceHashSchema }));

export const ExternalTrialFieldSchema = z.enum(['title', 'model', 'description']);
export type ExternalTrialField = z.infer<typeof ExternalTrialFieldSchema>;
const ExternalTextOverrideSchema = z.strictObject({
  field: ExternalTrialFieldSchema, locale: LocaleSchema, sourceHash: SourceHashSchema, text: shortText(2000),
}).superRefine((value, ctx) => {
  const limit = { title: 500, model: 120, description: 2000 }[value.field];
  if (value.text.length > limit) ctx.addIssue({ code: 'custom', path: ['text'], message: `Text limit is ${limit}` });
});
export const ExternalOverridesSchema = z.strictObject({
  hidden: z.boolean(),
  facts: ExternalFactsSchema.partial(),
  text: z.array(ExternalTextOverrideSchema).max(9).refine(items => new Set(items.map(item => `${item.field}:${item.locale}`)).size === items.length),
});
export type ExternalOverrides = z.infer<typeof ExternalOverridesSchema>;
export const SaveExternalOverridesSchema = z.strictObject({ version: ListingVersionSchema, overrides: ExternalOverridesSchema });
export type SaveExternalOverrides = z.infer<typeof SaveExternalOverridesSchema>;
export const ExternalListingQuerySchema = z.strictObject({ locale: LocaleSchema.default('zh') });
export const ExternalListingSchema = z.strictObject({
  id: ExternalListingIdSchema, version: ListingVersionSchema, state: z.enum(['published', 'hidden', 'withdrawn']),
  identity: ExternalIdentitySchema,
  sourceRevision: RevisionSchema, sourceUpdatedAt: TimestampSchema.nullable(), fetchedAt: TimestampSchema,
  source: ExternalUpsertCandidateSchema.nullable(),
  overrides: ExternalOverridesSchema,
  sourceHashes: z.strictObject({ title: SourceHashSchema.nullable(), model: SourceHashSchema.nullable(), description: SourceHashSchema.nullable() }),
  vehicle: PublicVehicleSchema.nullable(),
});
export type ExternalListing = z.infer<typeof ExternalListingSchema>;
export const ExternalListingResponseSchema = responseSchema(ExternalListingSchema);
export const ExternalListingListQuerySchema = ExternalAdminPageQuerySchema.extend({
  q: z.string().trim().max(2048).regex(/^[^\u0000]*$/).optional(),
  platformId: IdSchema.optional(),
  state: ExternalListingSchema.shape.state.optional(),
  make: IdSchema.optional(),
  model: IdSchema.optional(),
  powertrain: PowertrainSchema.optional(),
  yearMin: VehicleFactsSchema.shape.modelYear.unwrap().optional(),
  yearMax: VehicleFactsSchema.shape.modelYear.unwrap().optional(),
  mileageMax: VehicleFactsSchema.shape.mileageKm.unwrap().optional(),
  locale: LocaleSchema.default('zh'),
}).refine(query => !query.model || !!query.make, { path: ['model'], message: 'Select a make before a model' })
  .refine(query => query.yearMin === undefined || query.yearMax === undefined || query.yearMin <= query.yearMax,
    { path: ['yearMax'], message: 'Maximum year must not precede minimum year' });
export type ExternalListingListQuery = z.infer<typeof ExternalListingListQuerySchema>;
export const ExternalListingOverviewQuerySchema = z.strictObject({ make: IdSchema.optional() });
export const ExternalListingOverviewResponseSchema = responseSchema(z.strictObject({
  total: CountSchema,
  published: CountSchema,
  hidden: CountSchema,
  withdrawn: CountSchema,
  platforms: z.array(IdSchema),
  makes: z.array(NamedValueSchema),
  models: z.array(NamedValueSchema),
  years: z.array(VehicleFactsSchema.shape.modelYear.unwrap()),
}));

export const ExternalListingListFactsSchema = ExternalFactsSchema.pick({
  make: true, model: true, modelYear: true, mileageKm: true, powertrain: true,
});
export const ExternalListingSummarySchema = ExternalIdentitySchema.extend({
  id: ExternalListingIdSchema,
  version: ListingVersionSchema,
  listingUrl: candidateUrl.nullable(),
  title: shortText(500).nullable(),
  state: ExternalListingSchema.shape.state,
  fetchedAt: TimestampSchema,
  sourceUpdatedAt: TimestampSchema.nullable(),
  publishedAt: TimestampSchema.nullable(),
  hasOverrides: z.boolean(),
  facts: ExternalListingListFactsSchema.nullable().optional(),
});
export type ExternalListingSummary = z.infer<typeof ExternalListingSummarySchema>;
export const ExternalListingListResponseSchema = responseSchema(z.strictObject({
  ...pageFields, items: z.array(ExternalListingSummarySchema).max(100),
}));

export const ExternalOverrideResponseSchema = responseSchema(ExternalListingSchema.pick({ id: true, version: true, state: true }));
export const ExternalBulkVisibilityRequestSchema = z.strictObject({
  hidden: z.boolean(),
  items: z.array(z.strictObject({ id: ExternalListingIdSchema, version: ListingVersionSchema })).min(1).max(100)
    .refine(items => new Set(items.map(item => item.id)).size === items.length),
});
export type ExternalBulkVisibilityRequest = z.infer<typeof ExternalBulkVisibilityRequestSchema>;
export const ExternalBulkVisibilityResponseSchema = responseSchema(z.strictObject({
  items: z.array(z.discriminatedUnion('status', [
    z.strictObject({ id: ExternalListingIdSchema, status: z.enum(['applied', 'unchanged']), version: ListingVersionSchema, state: ExternalListingSchema.shape.state }),
    z.strictObject({ id: ExternalListingIdSchema, status: z.literal('failed'), reason: z.enum(['NOT_FOUND', 'VERSION_CONFLICT', 'EXTERNAL_RESTRICTION']) }),
  ])).max(100),
}));

export const ExternalTrialRequestSchema = z.strictObject({
  vehicleIds: z.array(ExternalListingIdSchema).length(EXTERNAL_TRIAL_SIZE).refine(ids => new Set(ids).size === ids.length),
});
export type ExternalTrialRequest = z.infer<typeof ExternalTrialRequestSchema>;
const EstimateSchema = z.strictObject({
  grossCharacters: CountSchema, existingCharacters: CountSchema, glossaryCharacters: CountSchema, cachedCharacters: CountSchema,
  duplicateCharacters: CountSchema, estimatedCharacters: CountSchema, estimatedCalls: CountSchema,
});
export const ExternalTrialSchema = z.strictObject({
  id: z.uuid(), batchId: z.uuid(), createdAt: TimestampSchema, status: z.literal('dry_run'),
  vehicleIds: ExternalTrialRequestSchema.shape.vehicleIds,
  estimate: EstimateSchema,
  byField: z.array(EstimateSchema.extend({ field: ExternalTrialFieldSchema })).length(3),
  budget: z.strictObject({
    month: z.string().regex(/^\d{4}-\d{2}$/), batchLimit: z.literal(EXTERNAL_TRIAL_CHARACTER_LIMIT),
    accountFreeRemaining: z.null(), reservedCharacters: CountSchema, attemptedCharacters: CountSchema, realCalls: z.literal(0),
  }),
});
export type ExternalTrial = z.infer<typeof ExternalTrialSchema>;
export const ExternalTrialResponseSchema = responseSchema(ExternalTrialSchema.nullable());
export const ExternalStatusResponseSchema = responseSchema(z.strictObject({
  catalogRevision: z.string().regex(/^[1-9]\d*$/),
  sync: z.literal('manual_import_only'), translation: z.literal('dry_run'),
  lastBatch: ExternalBatchSchema.nullable(), batchCharacterLimit: z.literal(EXTERNAL_TRIAL_CHARACTER_LIMIT), accountFreeRemaining: z.null(),
}));

export const ExternalProviderAccountSchema = z.strictObject({
  state: z.enum(['not_configured', 'ok', 'unauthorized', 'forbidden', 'rate_limited', 'unavailable', 'invalid_response']),
  checkedAt: TimestampSchema.nullable(),
  plan: z.string().min(1).max(80).nullable(),
  expiresAt: TimestampSchema.nullable(),
  sources: z.array(IdSchema).max(20),
  dailyLimit: CountSchema.nullable(),
  remainingToday: CountSchema.nullable(),
});
export type ExternalProviderAccount = z.infer<typeof ExternalProviderAccountSchema>;
export const ExternalProviderStatusSchema = z.strictObject({
  provider: z.literal('chinacarapi'),
  worker: z.literal('not_configured'),
  lastBatch: ExternalBatchSchema.nullable(),
  lastImportAt: TimestampSchema.nullable(),
  lastFetchedAt: TimestampSchema.nullable(),
  lastSupplierUpdatedAt: TimestampSchema.nullable(),
  account: ExternalProviderAccountSchema,
});
export type ExternalProviderStatus = z.infer<typeof ExternalProviderStatusSchema>;
export const ExternalProviderStatusResponseSchema = responseSchema(ExternalProviderStatusSchema);
