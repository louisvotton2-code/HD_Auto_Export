import { z } from 'zod';
import { IdSchema, TimestampSchema, responseSchema } from './common.js';

/** Authenticated staff projections only; never exported by the public entry point. */
export const ActivityActorSchema = z.strictObject({
  kind: z.enum(['staff', 'system', 'unknown']), staffId: IdSchema.nullable(), name: z.string().max(300).nullable(),
});
export const ActivitySummaryEntrySchema = z.strictObject({ at: TimestampSchema, actor: ActivityActorSchema });
export const AdminActivitySummarySchema = z.strictObject({
  created: ActivitySummaryEntrySchema.nullable(), lastModified: ActivitySummaryEntrySchema.nullable(),
  firstImported: z.strictObject({ at: TimestampSchema, batchId: z.string().max(100).nullable() }).nullable(),
  lastSyncedAt: TimestampSchema.nullable(),
});
export type AdminActivitySummary = z.infer<typeof AdminActivitySummarySchema>;
export const ActivityQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2000).optional(), limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
export const ActivityEventSchema = z.strictObject({
  id: z.string().min(1).max(100), action: z.string().min(1).max(100), at: TimestampSchema,
  actor: ActivityActorSchema, oldVersion: z.number().int().nonnegative().nullable(), newVersion: z.number().int().nonnegative().nullable(),
  detailState: z.enum(['recorded', 'unknown']),
  changes: z.array(z.strictObject({ path: z.string().min(1).max(1000), beforePresent: z.boolean(), afterPresent: z.boolean(), before: z.json(), after: z.json() })).max(10000).nullable(),
}).refine(value => (value.detailState === 'unknown') === (value.changes === null), 'Unknown historical differences must remain null.');
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export const ActivityPageSchema = z.strictObject({ items: z.array(ActivityEventSchema).max(100), nextCursor: z.string().max(2000).nullable() });
export const ActivityResponseSchema = responseSchema(ActivityPageSchema);
export type ActivityPage = z.infer<typeof ActivityPageSchema>;
