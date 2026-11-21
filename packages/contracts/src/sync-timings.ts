import {z} from 'zod';
import {TimestampSchema,responseSchema} from './common.js';
const Count=z.number().int().nonnegative();
const Kind=z.enum(['new','price','removed','relisted','unknown']);
const Duration=z.number().nonnegative().nullable();
/** Admin-only observations of committed database projections, not browser delivery or supplier polling guarantees. */
export const ExternalSyncTimingsSchema=z.strictObject({
 asOf:TimestampSchema,
 window:z.strictObject({from:TimestampSchema,to:TimestampSchema,instrumentedSince:TimestampSchema,complete:z.boolean(),uninstrumentedEvents:Count,lastReceivedAt:TimestampSchema.nullable(),nextReceiveAt:TimestampSchema,coverage:z.strictObject({slotMs:z.literal(300000),expectedSlots:z.literal(288),successfulSlots:Count.max(288),missingSlots:Count.max(288),failedSlots:Count.max(288),through:TimestampSchema})}),
 backlog:z.strictObject({pendingEvents:Count,pendingWork:Count,failedWork:Count,oldestEventAt:TimestampSchema.nullable(),oldestWorkAt:TimestampSchema.nullable()}),
 metrics:z.array(z.strictObject({kind:Kind,received:Count,applied:Count,detailUpdated:Count,publicEffective:Count,incomplete:Count,failed:Count,
  notPublic:Count,superseded:Count,oldestIncompleteAt:TimestampSchema.nullable(),p95SourceToReceivedMs:Duration,p95ReceivedToAppliedMs:Duration,
  p95AppliedToDetailMs:Duration,p95ReceivedToPublicMs:Duration})).max(5),
 events:z.array(z.strictObject({eventId:z.string().regex(/^\d{1,30}$/),kind:Kind,sourceAt:TimestampSchema,receivedAt:TimestampSchema,
  appliedAt:TimestampSchema.nullable(),detailUpdatedAt:TimestampSchema.nullable(),publicEffectiveAt:TimestampSchema.nullable(),
  outcome:z.enum(['unknown','pending','effective','not_public','superseded'])})).max(50),
});
export type ExternalSyncTimings=z.infer<typeof ExternalSyncTimingsSchema>;
export const ExternalSyncTimingsResponseSchema=responseSchema(ExternalSyncTimingsSchema);
