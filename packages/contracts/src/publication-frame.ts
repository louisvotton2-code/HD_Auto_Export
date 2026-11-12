import { z } from 'zod';
import { IdSchema, LocaleSchema, VersionSchema } from './common.js';
import { PublicationFingerprintSchema } from './publication.js';

const frame = {
  schemaVersion: z.literal(1), type: z.literal('hd:auto:publication-preview'),
  loadId: z.uuid(), vehicleId: IdSchema, locale: LocaleSchema,
};
export const PublicationPreviewFrameProofSchema = z.strictObject({
  vehicleId: IdSchema, vehicleVersion: VersionSchema, publicContentRevision: VersionSchema,
  fingerprint: PublicationFingerprintSchema, locale: LocaleSchema,
});
export type PublicationPreviewFrameProof = z.infer<typeof PublicationPreviewFrameProofSchema>;
/** Schema validation complements, and never replaces, browser origin/source/current-load checks. */
export const PublicationPreviewFrameMessageSchema = z.discriminatedUnion('event', [
  z.strictObject({ ...frame, event: z.literal('loading') }),
  z.strictObject({ ...frame, event: z.literal('ready'), preview: PublicationPreviewFrameProofSchema }),
  z.strictObject({ ...frame, event: z.literal('error'), error: z.strictObject({
    code: z.enum(['unauthenticated', 'forbidden', 'not_found', 'conflict', 'invalid_response', 'unavailable', 'render_error']),
  }) }),
  z.strictObject({ ...frame, event: z.literal('disposed') }),
  z.strictObject({ ...frame, event: z.literal('resize'), height: z.number().int().min(240).max(16000) }),
]).superRefine((value, ctx) => {
  if (value.event === 'ready' && (value.preview.vehicleId !== value.vehicleId || value.preview.locale !== value.locale))
    ctx.addIssue({ code: 'custom', path: ['preview'], message: 'Rendered proof must match the frame vehicle and language.' });
});
export type PublicationPreviewFrameMessage = z.infer<typeof PublicationPreviewFrameMessageSchema>;
