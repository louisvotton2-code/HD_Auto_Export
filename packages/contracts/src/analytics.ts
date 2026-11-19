import { z } from 'zod';
import { LocaleSchema, TimestampSchema, responseSchema } from './common.js';
import { ExternalListingIdSchema } from './external-public.js';

export const analyticsEventBatchLimit = 10;
export const analyticsEventBodyLimit = 8_192;
export const AnalyticsPageTypeSchema = z.enum(['home','catalog','vehicle','calculator','parts','guide','about','other']);
export const AnalyticsChannelSchema = z.enum(['whatsapp','telegram','wechat','phone','email','form']);
export const AnalyticsVehicleIdSchema = z.union([z.uuid().regex(/^[a-f0-9-]+$/),ExternalListingIdSchema]);
const eventFields = {
  eventId:z.uuid(),pageType:AnalyticsPageTypeSchema,locale:LocaleSchema,
};
export const AnalyticsEventSchema = z.discriminatedUnion('type',[
  z.strictObject({...eventFields,type:z.literal('page_view'),vehicleId:AnalyticsVehicleIdSchema.optional()}),
  z.strictObject({...eventFields,type:z.literal('vehicle_click'),vehicleId:AnalyticsVehicleIdSchema}),
  z.strictObject({...eventFields,type:z.literal('contact_click'),vehicleId:AnalyticsVehicleIdSchema.optional(),channel:AnalyticsChannelSchema.optional()}),
]).superRefine((event,ctx)=>{
  if (event.type==='page_view' && (event.pageType==='vehicle') !== (event.vehicleId!==undefined)) {
    ctx.addIssue({code:'custom',path:['vehicleId'],message:'A vehicle ID is allowed and required only for vehicle detail page views.'});
  }
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const AnalyticsEventsRequestSchema = z.strictObject({
  events:z.array(AnalyticsEventSchema).min(1).max(analyticsEventBatchLimit),
});
export const AnalyticsEventsResponseSchema = responseSchema(z.strictObject({accepted:z.literal(true)}));

export const AnalyticsOverviewQuerySchema = z.strictObject({days:z.enum(['7','30']).default('30')});
export const AnalyticsDaysSchema = z.union([z.literal(7),z.literal(30)]);
export type AnalyticsDays = z.infer<typeof AnalyticsDaysSchema>;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const AnalyticsTotalsSchema = z.strictObject({
  pageViews:count,detailViews:count,vehicleClicks:count,contactClicks:count,
});
export const AnalyticsOverviewSchema = z.strictObject({
  days:AnalyticsDaysSchema,timeZone:z.literal('Asia/Shanghai'),startDate:z.iso.date(),endDate:z.iso.date(),
  collectionStartedAt:TimestampSchema.nullable(),hasData:z.boolean(),totals:AnalyticsTotalsSchema,
  trend:z.array(AnalyticsTotalsSchema.extend({date:z.iso.date()})).max(30),
  topVehicles:z.array(AnalyticsTotalsSchema.omit({pageViews:true}).extend({vehicleId:AnalyticsVehicleIdSchema})).max(20),
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverviewSchema>;
export const AnalyticsOverviewResponseSchema = responseSchema(AnalyticsOverviewSchema);
