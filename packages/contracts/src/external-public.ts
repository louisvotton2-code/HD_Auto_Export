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
export const ExternalInspectionSchema = z.strictObject({
  reportUrl: ExternalHttpsUrlSchema.nullable(),
  entries: z.array(ExternalDetailEntrySchema).max(300),
});
export const ExternalPublicDetailSchema = z.strictObject({
  original: z.strictObject({ title: PublicTextSchema.nullable(), model: PublicTextSchema.nullable(), description: PublicTextSchema.nullable() }),
  specifications: z.array(ExternalDetailEntrySchema).max(500),
  inspection: ExternalInspectionSchema.nullable(),
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
