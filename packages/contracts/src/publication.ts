import { z } from 'zod';
import {
  AvailabilitySchema, IdSchema, LanguageTagSchema, LocaleSchema, MoneySchema,
  TimestampSchema, VehicleFactsSchema, VersionSchema, responseSchema,
} from './common.js';
import { DrivetrainSchema } from './localization.js';
import { PublicUsdPriceSchema, SourceSchema } from './public.js';

/** Authenticated preview projection. Never serialize an AdminVehicle or internal data here. */
export const PublicationPreviewTextSchema = z.strictObject({
  text: z.string().min(1).max(10_000).nullable(), requestedLocale: LocaleSchema,
  contentLocale: LanguageTagSchema.nullable(),
  kind: z.enum(['original', 'machine', 'human', 'catalog']).nullable(),
  reviewStatus: z.enum(['missing', 'pending', 'approved', 'stale']),
  sourceVersion: VersionSchema.nullable(),
}).superRefine((value, ctx) => {
  const missing = value.reviewStatus === 'missing';
  if (missing !== (value.text === null) || missing !== (value.kind === null) || missing !== (value.contentLocale === null) || missing !== (value.sourceVersion === null))
    ctx.addIssue({ code: 'custom', message: 'Missing text must have null content metadata.' });
});
export type PublicationPreviewText = z.infer<typeof PublicationPreviewTextSchema>;
export const PublicationPreviewPriceSchema = z.strictObject({
  kind: z.enum(['asking', 'reference', 'on_request']),
  money: MoneySchema.extend({ amount: MoneySchema.shape.amount.nullable() }).nullable(),
  includes: z.array(z.string().min(1).max(200)).max(30),
  status: z.enum(['ready', 'missing', 'on_request']),
  // null means an incomplete draft price; it must never appear as a zero or an on-request price.
  displayPrice: PublicUsdPriceSchema.nullable(),
}).superRefine((value, ctx) => {
  const missing = value.kind !== 'on_request' && value.money?.amount == null;
  if (value.status !== (value.kind === 'on_request' ? 'on_request' : missing ? 'missing' : 'ready') ||
    (missing ? value.displayPrice !== null : value.displayPrice === null) ||
    (value.kind === 'on_request' && (value.money !== null || value.displayPrice?.status !== 'on_request')))
    ctx.addIssue({ code: 'custom', message: 'Preview price state must match its original amount.' });
});
export const PublicationPreviewVehicleSchema = z.strictObject({
  id: IdSchema, stockCode: z.string().min(1).max(60), source: SourceSchema,
  facts: VehicleFactsSchema.extend({ generation: VehicleFactsSchema.shape.model, drivetrain: DrivetrainSchema.nullable() }),
  content: z.strictObject({ title: PublicationPreviewTextSchema, description: PublicationPreviewTextSchema }),
  display: z.strictObject({
    make: PublicationPreviewTextSchema, model: PublicationPreviewTextSchema, trim: PublicationPreviewTextSchema,
    generation: PublicationPreviewTextSchema, city: PublicationPreviewTextSchema, location: PublicationPreviewTextSchema,
    platform: PublicationPreviewTextSchema,
    priceIncludes: z.array(z.strictObject({ id: z.uuid(), value: PublicationPreviewTextSchema })).max(30),
    mediaAlt: z.array(z.strictObject({ mediaId: IdSchema, value: PublicationPreviewTextSchema })).max(30),
  }),
  price: PublicationPreviewPriceSchema,
  images: z.array(z.strictObject({
    id: IdSchema, url: z.string().regex(/^\/api\/v1\/admin\/media\/[A-Za-z0-9_-]+\/preview$/).nullable(),
    alt: z.string().max(500), sortOrder: z.number().int().min(0).max(29), isCover: z.boolean(),
    width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
    status: z.enum(['ready', 'missing']),
  })).max(30),
  availability: AvailabilitySchema, availabilityCheckedAt: TimestampSchema.nullable(),
});
export type PublicationPreviewVehicle = z.infer<typeof PublicationPreviewVehicleSchema>;
export const PublicationPreviewQuerySchema = z.strictObject({ locale: LocaleSchema.default('zh') });
export type PublicationPreviewQuery = z.infer<typeof PublicationPreviewQuerySchema>;
export const PublicationFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicationPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1), vehicleVersion: VersionSchema, publicContentRevision: VersionSchema,
  fingerprint: PublicationFingerprintSchema, locale: LocaleSchema, priceView: z.literal('usd'),
  vehicle: PublicationPreviewVehicleSchema,
});
export type PublicationPreview = z.infer<typeof PublicationPreviewSchema>;
export const PublicationPreviewResponseSchema = responseSchema(PublicationPreviewSchema);
export type PublicationPreviewResponse = z.infer<typeof PublicationPreviewResponseSchema>;
export const PublicationIssueSchema = z.strictObject({
  stage: z.enum(['required_fields', 'localization', 'preview']),
  path: z.string().min(1).max(500), code: z.string().min(1).max(100), message: z.string().min(1).max(500),
});
export type PublicationIssue = z.infer<typeof PublicationIssueSchema>;
export const PublishReadinessSchema = z.strictObject({
  schemaVersion: z.literal(1), vehicleId: IdSchema, vehicleVersion: VersionSchema,
  publicContentRevision: VersionSchema, fingerprint: PublicationFingerprintSchema, locale: LocaleSchema,
  requiredFieldsReady: z.boolean(), localizationReady: z.boolean(), previewConfirmed: z.boolean(), canPublish: z.boolean(),
  issues: z.array(PublicationIssueSchema).max(500),
  confirmation: z.strictObject({ locale: LocaleSchema, confirmedAt: TimestampSchema, expiresAt: TimestampSchema }).nullable(),
}).superRefine((value, ctx) => {
  if (value.canPublish !== (value.requiredFieldsReady && value.localizationReady && value.previewConfirmed) ||
    value.previewConfirmed !== (value.confirmation !== null))
    ctx.addIssue({ code: 'custom', message: 'Publication gates must all pass independently.' });
});
export type PublishReadiness = z.infer<typeof PublishReadinessSchema>;
export const PublishReadinessResponseSchema = responseSchema(PublishReadinessSchema);
export type PublishReadinessResponse = z.infer<typeof PublishReadinessResponseSchema>;
/** Explicitly acknowledges the exact preview fetched by this staff member, never an implicit latest version. */
export const ConfirmPublicationPreviewRequestSchema = z.strictObject({
  version: VersionSchema, publicContentRevision: VersionSchema, fingerprint: PublicationFingerprintSchema, locale: LocaleSchema,
});
export type ConfirmPublicationPreviewRequest = z.infer<typeof ConfirmPublicationPreviewRequestSchema>;
