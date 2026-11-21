import { z } from 'zod';
import { LocaleSchema, TimestampSchema, responseSchema } from './common.js';
import { ExternalListingIdSchema } from './external-public.js';

export const analyticsEventBatchLimit = 10;
export const analyticsEventBodyLimit = 8_192;
export const analyticsContactBodyLimit = 512;
export const AnalyticsPageTypeSchema = z.enum(['home','catalog','vehicle','calculator','parts','guide','about','other']);
export const AnalyticsChannelSchema = z.enum(['whatsapp','telegram','wechat','phone','email','form']);
export const AnalyticsSourceSchema = z.enum(['unknown','direct','search','meta','social','referral','paid']);
export const AnalyticsCampaignSchema = z.enum(['none','brand','catalog','retargeting']);
export const AnalyticsDeviceSchema = z.enum(['unknown','mobile','tablet','desktop']);
export const AnalyticsEntrySchema = z.enum(['unknown',...AnalyticsPageTypeSchema.options]);
export const AnalyticsCountrySchema = z.string().regex(/^[A-Z]{2}$/);
export const AnalyticsVehicleIdSchema = z.union([z.uuid().regex(/^[a-f0-9-]+$/),ExternalListingIdSchema]);
export const AnalyticsContactChannelSchema = z.enum(['whatsapp','telegram']);
export const AnalyticsContactCountRequestSchema = z.strictObject({vehicleId:AnalyticsVehicleIdSchema,channel:AnalyticsContactChannelSchema});
export type AnalyticsContactCountRequest = z.infer<typeof AnalyticsContactCountRequestSchema>;
const eventFields = {
  eventId:z.uuid(),pageType:AnalyticsPageTypeSchema,locale:LocaleSchema,
  sessionId:z.uuid().optional(),sequence:z.number().int().min(0).max(2_147_483_647).optional(),
  occurredAt:TimestampSchema.optional(),entry:AnalyticsEntrySchema.optional(),
  device:AnalyticsDeviceSchema.optional(),source:AnalyticsSourceSchema.optional(),campaign:AnalyticsCampaignSchema.optional(),
};
export const AnalyticsEventSchema = z.discriminatedUnion('type',[
  z.strictObject({...eventFields,type:z.literal('page_view'),vehicleId:AnalyticsVehicleIdSchema.optional()}),
  z.strictObject({...eventFields,type:z.literal('vehicle_click'),vehicleId:AnalyticsVehicleIdSchema}),
  z.strictObject({...eventFields,type:z.literal('contact_click'),vehicleId:AnalyticsVehicleIdSchema.optional(),channel:AnalyticsChannelSchema.optional()}),
  z.strictObject({...eventFields,type:z.literal('filter_submit'),pageType:z.literal('catalog')}),
  z.strictObject({...eventFields,type:z.literal('search_zero_results'),pageType:z.literal('catalog')}),
  z.strictObject({...eventFields,type:z.literal('calculator_complete'),pageType:z.literal('calculator')}),
]).superRefine((event,ctx)=>{
  if (event.type==='page_view' && (event.pageType==='vehicle') !== (event.vehicleId!==undefined)) {
    ctx.addIssue({code:'custom',path:['vehicleId'],message:'A vehicle ID is allowed and required only for vehicle detail page views.'});
  }
  if ((event.sessionId===undefined)!==(event.sequence===undefined))
    ctx.addIssue({code:'custom',path:['sequence'],message:'Session ID and sequence must be supplied together.'});
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

export const AnalyticsReportMetricSchema = z.enum(['detailViews','vehicleClicks','contactClicks','contactRate']);
const boundedInteger = (max:number) => z.union([z.number(),z.string().regex(/^[1-9]\d*$/).transform(Number)])
  .pipe(z.number().int().min(1).max(max));
const dateFilters = {
  days:boundedInteger(90).optional(),period:z.enum(['today','yesterday']).optional(),
  startDate:z.iso.date().optional(),endDate:z.iso.date().optional(),granularity:z.enum(['hour','day']).default('day'),
  page:boundedInteger(100_000).default(1),pageSize:boundedInteger(100).default(20),
};
function validateDateFilters(query:{days?:number;period?:string;startDate?:string;endDate?:string},ctx:z.RefinementCtx) {
  const dateRange=query.startDate!==undefined||query.endDate!==undefined;
  if((dateRange && (query.days!==undefined||query.period!==undefined))||(query.days!==undefined&&query.period!==undefined))
    ctx.addIssue({code:'custom',path:['days'],message:'Choose only one report time range.'});
  if(dateRange && (!query.startDate || !query.endDate || query.startDate.startsWith('0000-') || query.startDate>query.endDate ||
      Date.parse(query.endDate)-Date.parse(query.startDate)>=90*86_400_000))
    ctx.addIssue({code:'custom',path:['endDate'],message:'Provide both dates in order, covering at most 90 days.'});
}
export const AnalyticsReportQuerySchema = z.strictObject({
  ...dateFilters,metric:AnalyticsReportMetricSchema.default('detailViews'),source:AnalyticsSourceSchema.optional(),locale:LocaleSchema.optional(),
  country:AnalyticsCountrySchema.optional(),device:AnalyticsDeviceSchema.optional(),entry:AnalyticsEntrySchema.optional(),
}).superRefine(validateDateFilters);
export type AnalyticsReportQuery = z.infer<typeof AnalyticsReportQuerySchema>;
export const AnalyticsActivityTotalsSchema = AnalyticsTotalsSchema.extend({
  filterSubmits:count,searchZeroResults:count,calculatorCompletions:count,
});
const coverage = z.enum(['not_collected','gap','partial','complete']);
const dimensions = AnalyticsActivityTotalsSchema.extend({sessions:count});
const funnel = z.strictObject({catalog:count,vehicleClick:count,detail:count,contact:count});
const range = z.strictObject({start:TimestampSchema,end:TimestampSchema});
export const AnalyticsQualitySchema = z.strictObject({received:count,accepted:count,duplicates:count,dropped:count});
export const AnalyticsRuntimeQualitySchema = z.strictObject({acceptedBatches:count,rejectedBatches:count,rateLimitedBatches:count,unavailableBatches:count,since:TimestampSchema});
export const AnalyticsReportSchema = z.strictObject({
  timeZone:z.literal('Asia/Shanghai'),range,granularity:z.enum(['hour','day']),
  collectionStartedAt:TimestampSchema.nullable(),legacyCollectionStartedAt:TimestampSchema.nullable(),
  coverage,totals:AnalyticsActivityTotalsSchema,sessions:count,activeSessions:count,
  trend:z.array(AnalyticsActivityTotalsSchema.extend({start:TimestampSchema,coverage})).max(2160),
  comparison:z.strictObject({today:range,yesterday:range,current:AnalyticsActivityTotalsSchema,previous:AnalyticsActivityTotalsSchema,
    todayCoverage:coverage,yesterdayCoverage:coverage}),
  markets:z.strictObject({
    countries:z.array(dimensions.extend({country:AnalyticsCountrySchema})),
    languages:z.array(dimensions.extend({locale:LocaleSchema})),
    devices:z.array(dimensions.extend({device:AnalyticsDeviceSchema})),
    entries:z.array(dimensions.extend({entry:AnalyticsEntrySchema})),
    sources:z.array(dimensions.extend({source:AnalyticsSourceSchema})),
    campaigns:z.array(AnalyticsActivityTotalsSchema.extend({campaign:AnalyticsCampaignSchema})),
    channels:z.array(z.strictObject({channel:AnalyticsChannelSchema,contactClicks:count})),
  }),
  dailyUniqueIpEstimates:z.array(z.strictObject({date:z.iso.date(),estimate:count.nullable()})).max(90),
  ranking:z.strictObject({metric:AnalyticsReportMetricSchema,page:count,pageSize:count,total:count,
    items:z.array(AnalyticsTotalsSchema.omit({pageViews:true}).extend({vehicleId:AnalyticsVehicleIdSchema,detailSessions:count,
      contactAfterDetailSessions:count,contactRate:z.number().min(0).max(1).nullable(),
      stockCode:z.string().nullable(),title:z.string().nullable(),source:z.enum(['staff','supplier']),
      whatsappClicks:count,telegramClicks:count})).max(100)}),
  funnels:z.strictObject({catalog:funnel,direct:z.strictObject({detail:count,contact:count})}),
  quality:AnalyticsQualitySchema,runtimeQuality:AnalyticsRuntimeQualitySchema,
});
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;
export const AnalyticsReportResponseSchema = responseSchema(AnalyticsReportSchema);

export const AnalyticsTrafficRankSchema = z.enum(['total','whatsapp','telegram']);
export const AnalyticsTrafficQuerySchema = z.strictObject({
  ...dateFilters,rankBy:AnalyticsTrafficRankSchema.default('total'),locale:LocaleSchema.optional(),pageType:AnalyticsPageTypeSchema.optional(),
  include:z.literal('unique-ip-visits').optional(),
}).superRefine(validateDateFilters);
export type AnalyticsTrafficQuery = z.infer<typeof AnalyticsTrafficQuerySchema>;

const trafficCount = z.strictObject({whatsappClicks:count,telegramClicks:count,totalContactClicks:count});
const trafficTotals = trafficCount.extend({documentRequests:count,uniqueIpVisits:count.nullable().optional()});
export const AnalyticsTrafficContactQualitySchema = z.strictObject({configured:z.boolean(),accepted:count,rejected:count,
  rateLimited:count,unavailable:count,since:TimestampSchema});
export type AnalyticsTrafficContactQuality = z.infer<typeof AnalyticsTrafficContactQualitySchema>;
export const AnalyticsIpVisitQualitySchema = AnalyticsTrafficContactQualitySchema.extend({duplicates:count});
export type AnalyticsIpVisitQuality = z.infer<typeof AnalyticsIpVisitQualitySchema>;
const trafficHours=z.strictObject({coverage,expectedHours:count,importedHours:count,latestHour:TimestampSchema.nullable()});
export const AnalyticsTrafficSchema = z.strictObject({
  timeZone:z.literal('Asia/Shanghai'),range,granularity:z.enum(['hour','day']),totals:trafficTotals,
  trend:z.array(trafficTotals.extend({start:TimestampSchema,documentCoverage:coverage,contactCoverage:coverage,visitCoverage:coverage.optional()})).max(2160),
  comparison:z.strictObject({currentRange:range,previousRange:range,current:trafficTotals,previous:trafficTotals,
    documentCoverage:coverage,previousDocumentCoverage:coverage,contactCoverage:coverage,previousContactCoverage:coverage,
    visitCoverage:coverage.optional(),previousVisitCoverage:coverage.optional()}),
  documents:z.array(z.strictObject({locale:LocaleSchema,pageType:AnalyticsPageTypeSchema,requests:count})).max(24),
  ranking:z.strictObject({rankBy:AnalyticsTrafficRankSchema,total:count,page:count,pageSize:count,
    items:z.array(trafficCount.extend({vehicleId:AnalyticsVehicleIdSchema,stockCode:z.string().nullable(),title:z.string().nullable(),
      source:z.enum(['staff','supplier'])})).max(100)}),
  quality:z.strictObject({documents:trafficHours,contacts:AnalyticsTrafficContactQualitySchema.extend({collectionStartedAt:TimestampSchema.nullable(),coverage}),
    visits:z.strictObject({...trafficHours.shape,...AnalyticsIpVisitQualitySchema.shape}).optional()}),
});
export type AnalyticsTraffic = z.infer<typeof AnalyticsTrafficSchema>;
export const AnalyticsTrafficResponseSchema = responseSchema(AnalyticsTrafficSchema);

export const AnalyticsDocumentSnapshotSchema = z.strictObject({
  version:z.literal(1),hour:z.iso.datetime({offset:true}).refine(value=>Date.parse(value)%3_600_000===0),
  status:z.enum(['complete','partial']),rows:z.array(z.strictObject({locale:LocaleSchema,pageType:AnalyticsPageTypeSchema,
    requests:z.number().int().min(0).max(100_000_000)})).max(24),
}).refine(snapshot=>new Set(snapshot.rows.map(row=>`${row.locale}:${row.pageType}`)).size===snapshot.rows.length);
export type AnalyticsDocumentSnapshot = z.infer<typeof AnalyticsDocumentSnapshotSchema>;

/** Private gateway transport. This schema is never mounted under a public URL. */
export const analyticsIpVisitPath = '/internal/analytics/ip-visits';
export const analyticsIpVisitKeyHeader = 'x-hd-analytics-visit-key';
export const analyticsIpVisitBodyLimit = 512;
export const AnalyticsIpVisitRequestSchema = z.discriminatedUnion('kind',[
  z.strictObject({version:z.literal(1),kind:z.literal('document'),address:z.string().min(2).max(45).regex(/^[0-9a-fA-F:.]+$/),
    observedAt:z.iso.datetime({offset:true})}),
  z.strictObject({version:z.literal(1),kind:z.literal('coverage'),status:z.enum(['complete','partial']),
    hour:z.iso.datetime({offset:true}).refine(value=>Date.parse(value)%3_600_000===0)}),
]);
export type AnalyticsIpVisitRequest = z.infer<typeof AnalyticsIpVisitRequestSchema>;
