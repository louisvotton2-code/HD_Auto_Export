import { z } from 'zod';
import { LanguageTagSchema, LocaleSchema, SafeHttpUrlSchema, TimestampSchema, responseSchema } from './common.js';

export const ExternalListingIdSchema = z.string().regex(/^ext-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const ExternalMediaIdSchema = z.string().regex(/^ximg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
// PostgreSQL and Node both preserve whole milliseconds, including the final instant of year 9999.
export const ExternalTimestampSchema = TimestampSchema.max(24).refine(value => !value.startsWith('0000-'));

/** Transport syntax only. Server-owned source profiles separately restrict exact hosts. */
export const ExternalHttpsUrlSchema = SafeHttpUrlSchema.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.hash && !value.includes('\\');
  } catch { return false; }
});

export const PublicTextSchema = z.strictObject({
  text: z.string().min(1).max(10_000).regex(/\S/, 'Display text cannot be blank'),
  requestedLocale: LocaleSchema,
  contentLocale: LanguageTagSchema,
  kind: z.enum(['original', 'machine', 'human', 'supplier', 'catalog']),
  reviewed: z.boolean(),
});
export type PublicText = z.infer<typeof PublicTextSchema>;

export const ExternalFactFieldSchema = z.enum([
  'make', 'model', 'trim', 'generation', 'modelYear', 'manufacturedAt', 'firstRegistration', 'registrationStatus',
  'mileageKm', 'powertrain', 'engineCc', 'powerKw', 'body', 'transmission', 'drivetrain', 'location',
]);
export const ExternalDisputeFieldSchema = z.enum([...ExternalFactFieldSchema.options, 'price', 'specifications']);
export const ExternalIssueSchema = z.strictObject({
  field: z.enum([...ExternalDisputeFieldSchema.options, 'title', 'description', 'images', 'inspection', 'relatedListingUrls']),
  code: z.enum(['missing', 'conflict', 'invalid', 'expired']),
});
export type ExternalIssue = z.infer<typeof ExternalIssueSchema>;

export const ExternalTaggedTextSchema = z.strictObject({
  text: z.string().min(1).max(500).regex(/\S/),
  contentLocale: LanguageTagSchema,
});
export const ExternalDetailEntrySchema = z.strictObject({ name: ExternalTaggedTextSchema, value: ExternalTaggedTextSchema });
/** Explicit source history only. Inspection faults/checked never become history events. */
export const ExternalHistorySchema = z.strictObject({
  ownershipTransfers: z.number().int().min(0).max(100).nullable(),
});
export type ExternalHistory = z.infer<typeof ExternalHistorySchema>;

const InspectionCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const ExternalInspectionCheckItemSchema = z.strictObject({
  part: ExternalTaggedTextSchema, result: ExternalTaggedTextSchema.nullable(), ok: z.boolean().nullable(),
});
export const ExternalInspectionCheckGroupSchema = z.strictObject({
  name: ExternalTaggedTextSchema, defects: InspectionCountSchema,
  items: z.array(ExternalInspectionCheckItemSchema).max(1000),
});
export const ExternalInspectionCheckSchema = z.strictObject({
  category: ExternalTaggedTextSchema, defects: InspectionCountSchema,
  groups: z.array(ExternalInspectionCheckGroupSchema).max(100),
});
export const ExternalInspectionDefectDetailSchema = z.strictObject({
  text: ExternalTaggedTextSchema.nullable(), textZh: ExternalTaggedTextSchema.nullable(),
}).refine(value => value.text !== null || value.textZh !== null, 'A defect detail needs at least one safe text.');
export const ExternalInspectionDefectItemSchema = z.strictObject({
  group: ExternalTaggedTextSchema, part: ExternalTaggedTextSchema, finding: ExternalTaggedTextSchema,
  details: z.array(ExternalInspectionDefectDetailSchema).max(100),
});
export const ExternalInspectionDefectSchema = z.strictObject({
  category: ExternalTaggedTextSchema, count: InspectionCountSchema,
  items: z.array(ExternalInspectionDefectItemSchema).max(1000),
});
export const EXTERNAL_INSPECTION_MAX_LEAVES = 1000;
/** Shared by candidates and public output. Photos and other raw report fields are deliberately absent. */
export const ExternalInspectionContentSchema = z.strictObject({
  entries: z.array(ExternalDetailEntrySchema).max(300),
  checks: z.array(ExternalInspectionCheckSchema).max(30).optional(),
  defects: z.array(ExternalInspectionDefectSchema).max(30).optional(),
}).superRefine((value, ctx) => {
  let leaves = 0;
  for (const category of value.checks ?? []) for (const group of category.groups) leaves += group.items.length;
  for (const category of value.defects ?? []) for (const item of category.items) leaves += 1 + item.details.length;
  if (leaves > EXTERNAL_INSPECTION_MAX_LEAVES) ctx.addIssue({ code: 'custom', message: 'Inspection content exceeds the total leaf limit.' });
});

/** The API binds evidence to vehicle/source/content and evaluates expiry; schemas never read the clock. */
export const ExternalReportAccessSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unknown'), url: z.null(), checkedAt: z.null(), expiresAt: z.null() }),
  z.strictObject({ status: z.literal('available'), url: ExternalHttpsUrlSchema, checkedAt: ExternalTimestampSchema, expiresAt: ExternalTimestampSchema }),
  z.strictObject({ status: z.literal('unavailable'), url: z.null(), checkedAt: ExternalTimestampSchema, expiresAt: ExternalTimestampSchema }),
  z.strictObject({ status: z.literal('expired'), url: z.null(), checkedAt: ExternalTimestampSchema, expiresAt: ExternalTimestampSchema }),
]).refine(value => value.status === 'unknown' || Date.parse(value.expiresAt) > Date.parse(value.checkedAt),
  'Report evidence must expire after it was checked.');
export type ExternalReportAccess = z.infer<typeof ExternalReportAccessSchema>;
export const ExternalInspectionSchema = ExternalInspectionContentSchema.safeExtend({
  // Legacy responses may only have reportUrl. New projections must set it to the
  // available reportAccess.url, and null for every other access status.
  reportUrl: ExternalHttpsUrlSchema.nullable(),
  reportAccess: ExternalReportAccessSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.reportAccess && value.reportUrl !== (value.reportAccess.status === 'available' ? value.reportAccess.url : null)) {
    ctx.addIssue({ code: 'custom', path: ['reportUrl'], message: 'Report URL must match the declared report access.' });
  }
});
export type ExternalInspection = z.infer<typeof ExternalInspectionSchema>;
export const ExternalPublicDetailSchema = z.strictObject({
  original: z.strictObject({ title: PublicTextSchema.nullable(), model: PublicTextSchema.nullable(), description: PublicTextSchema.nullable() }),
  specifications: z.array(ExternalDetailEntrySchema).max(500),
  inspection: ExternalInspectionSchema.nullable(),
  history: ExternalHistorySchema.nullable().optional(),
  relatedListingUrls: z.array(ExternalHttpsUrlSchema).max(20),
});
export type ExternalPublicDetail = z.infer<typeof ExternalPublicDetailSchema>;
export const ExternalPublicSummarySchema = z.strictObject({
  issues: z.array(ExternalIssueSchema).max(50),
  detail: ExternalPublicDetailSchema.optional(),
});
export const RemoteMediaMetadataSchema = z.strictObject({
  revision: z.number().int().positive().max(2_147_483_647),
  refreshedAt: ExternalTimestampSchema,
  expiresAt: ExternalTimestampSchema.nullable(),
});
export const ExternalMediaFailureRequestSchema = RemoteMediaMetadataSchema.pick({ revision: true });
export const ExternalMediaFailureResponseSchema = responseSchema(z.strictObject({ queued: z.boolean() }));
