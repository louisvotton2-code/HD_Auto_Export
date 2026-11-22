import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  analyticsEventBodyLimit, AnalyticsEventsRequestSchema, AnalyticsEventsResponseSchema,
  AnalyticsOverviewQuerySchema, AnalyticsOverviewResponseSchema, type AnalyticsEvent,
  AnalyticsReportQuerySchema, AnalyticsReportResponseSchema, type AnalyticsReportQuery,
  analyticsContactBodyLimit, AnalyticsContactCountRequestSchema, type AnalyticsContactCountRequest,
  AnalyticsTrafficQuerySchema, AnalyticsTrafficResponseSchema, type AnalyticsTrafficQuery,
  type AnalyticsIpVisitQuality,
} from '@hd/contracts/analytics';
import { ApiErrorSchema } from '@hd/contracts/public';
import { z } from 'zod';
import type { Config } from '../config.js';
import { createDatabase } from '../db/index.js';
import { ApiError } from '../errors.js';
import { createAnalyticsStorage } from './storage.js';
import { getAnalyticsReport } from './report.js';
import { countContact } from './contact.js';
import { getAnalyticsTraffic } from './traffic.js';

export const analyticsEventsPath='/api/v1/analytics/events';
export const analyticsContactPath='/api/v1/analytics/contact-count';
const unavailable=()=>new ApiError(503,'SERVICE_UNAVAILABLE','Analytics is temporarily unavailable.',undefined,true);
const errorResponses=Object.fromEntries([400,401,403,404,413,415,429,500,503].map(code=>[code,ApiErrorSchema]));
const envelope=<T>(data:T,request:FastifyRequest)=>({data,meta:{requestId:request.id}});
const localDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});

function trustedGateway(request:FastifyRequest,config:Config) {
  const received=request.headers['x-hd-analytics-gateway-key'];
  return Boolean(config.analyticsGatewaySecret && typeof received==='string' && /^[a-f0-9]{64}$/.test(received) &&
    timingSafeEqual(Buffer.from(received,'hex'),Buffer.from(config.analyticsGatewaySecret,'hex')) &&
    request.ips && request.ips.length>1);
}
function gatewayCountry(request:FastifyRequest) {
  const country=request.headers['x-hd-analytics-country'];
  return typeof country==='string'&&/^[A-Z]{2}$/.test(country)&&country!=='ZZ'?country:undefined;
}

function analyticsContext(request:FastifyRequest,config:Config) {
  if(!config.analyticsV2Enabled)return undefined;
  const trusted=trustedGateway(request,config);
  const rawIp=trusted?request.ip:undefined;
  const ip=rawIp?.includes(':')?new URL(`http://[${rawIp}]`).hostname:rawIp;
  return {secret:config.authSecret,country:(trusted&&gatewayCountry(request))||'ZZ',ip};
}

function validateAnalyticsOrigin(request:FastifyRequest,config:Config) {
  delete request.headers.cookie;
  delete request.headers.authorization;
  delete request.headers.referer;
  const origin=request.headers.origin, fetchSite=request.headers['sec-fetch-site'];
  if(!origin || !config.analyticsOrigins.includes(origin) || origin!==`${request.protocol}://${request.host}` ||
    (fetchSite!==undefined && fetchSite!=='same-origin')) {
    throw new ApiError(403,'FORBIDDEN','A configured same-origin website request is required.');
  }
  if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')
    throw new ApiError(415,'INVALID_REQUEST','Analytics events require JSON.');
}

function lane() {
  let busy=false;
  return {
    idle:()=>!busy,
    async run<T>(operation:()=>Promise<T>):Promise<T> {
      if (busy) throw unavailable();
      busy=true;
      try { return await operation(); }
      catch { throw unavailable(); }
      finally { busy=false; }
    },
  };
}

export function registerAnalyticsRoutes(app:FastifyInstance,config:Config,isAdmin:(request:FastifyRequest)=>boolean,
  optionalMaintenance:(action:()=>Promise<void>)=>Promise<void>,ipVisitQuality:()=>AnalyticsIpVisitQuality) {
  // Analytics has its own small pool and no queued operations. Staff session
  // checks still use the ordinary auth path, before the overview opens this pool.
  const db=createDatabase(config.databaseUrl,2,false,500);
  const contactDb=createDatabase(config.databaseUrl,1,false,250);
  const analytics=createAnalyticsStorage(db);
  const writer=lane(), reader=lane(), contactWriter=lane(), trafficReader=lane();
  const runtimeQuality={acceptedBatches:0,rejectedBatches:0,rateLimitedBatches:0,unavailableBatches:0,since:new Date().toISOString()};
  const contactQuality={configured:config.analyticsOrigins.length>0,
    accepted:0,rejected:0,rateLimited:0,unavailable:0,since:runtimeQuality.since};
  let windowStart=performance.now(), acceptedBatches=0;
  let contactWindowStart=windowStart,contactWrites=0;
  let timer:ReturnType<typeof setInterval>|undefined;
  if(config.environment!=='test') {
    const heartbeatWidth=5*60_000;
    let nextMaintenance=0;
    timer=setInterval(()=>{
      const startedAt=Date.now();
      if(startedAt<nextMaintenance || !writer.idle()) return;
      void optionalMaintenance(()=>writer.run(async()=>{
        const backlog=await analytics.prune(config.analyticsV2Enabled&&config.analyticsOrigins.length>0);
        if(backlog)app.log.warn('Analytics retention cleanup has an expired backlog.');
        else nextMaintenance=(Math.floor(startedAt/heartbeatWidth)+1)*heartbeatWidth;
      })).catch(()=>app.log.warn('Analytics retention cleanup could not run.'));
    },60_000);
    timer.unref();
  }
  app.addHook('onClose',async()=>{
    if(timer) clearInterval(timer);
    await db.close();
    await contactDb.close();
  });

  app.post(analyticsEventsPath,{
    bodyLimit:analyticsEventBodyLimit,
    config:{rateLimit:{max:60,timeWindow:60_000}},
    schema:{tags:['public','analytics'],operationId:'recordAnalyticsEvents',body:AnalyticsEventsRequestSchema,
      response:{202:AnalyticsEventsResponseSchema,...errorResponses}},
    onResponse:async (request,reply)=>{
      if(reply.statusCode===202)runtimeQuality.acceptedBatches++;
      else if(reply.statusCode===429)runtimeQuality.rateLimitedBatches++;
      else if(reply.statusCode>=500)runtimeQuality.unavailableBatches++;
      else if(reply.statusCode>=400)runtimeQuality.rejectedBatches++;
      if(reply.statusCode>=400) app.log.warn({requestId:request.id,status:reply.statusCode},'Analytics batch not accepted');
    },
    onRequest:async request=>validateAnalyticsOrigin(request,config),
  },async (request,reply)=>{
    const now=performance.now();
    if(now-windowStart>=60_000) {windowStart=now;acceptedBatches=0;}
    if(acceptedBatches>=120) {
      reply.header('Retry-After',String(Math.max(1,Math.ceil((60_000-now+windowStart)/1000))));
      throw new ApiError(429,'RATE_LIMITED','Analytics capacity is busy.',undefined,true);
    }
    await writer.run(async()=>{
      acceptedBatches++;
      const quality=await analytics.ingest((request.body as {events:AnalyticsEvent[]}).events,config.externalCatalog,analyticsContext(request,config));
      if(quality.duplicates||quality.dropped)app.log.info(quality,'Analytics event decisions');
    });
    return reply.code(202).send(envelope({accepted:true as const},request));
  });

  app.post(analyticsContactPath,{
    bodyLimit:analyticsContactBodyLimit,
    config:{rateLimit:{max:20,timeWindow:60_000}},
    schema:{tags:['public','analytics'],operationId:'countAnonymousVehicleContact',body:AnalyticsContactCountRequestSchema,
      querystring:z.strictObject({}),response:{204:z.undefined(),...errorResponses}},
    onRequest:async request=>validateAnalyticsOrigin(request,config),
    onResponse:async (_request,reply)=>{
      if(reply.statusCode===204)contactQuality.accepted++;
      else if(reply.statusCode===429)contactQuality.rateLimited++;
      else if(reply.statusCode>=500)contactQuality.unavailable++;
      else if(reply.statusCode>=400)contactQuality.rejected++;
    },
  },async (request,reply)=>{
    const now=performance.now();
    if(now-contactWindowStart>=60_000) {contactWindowStart=now;contactWrites=0;}
    if(contactWrites>=90) {
      reply.header('Retry-After',String(Math.max(1,Math.ceil((60_000-now+contactWindowStart)/1000))));
      throw new ApiError(429,'RATE_LIMITED','Analytics capacity is busy.',undefined,true);
    }
    const counted=await contactWriter.run(()=>{
      contactWrites++;
      return countContact(contactDb,request.body as AnalyticsContactCountRequest,config.externalCatalog);
    });
    if(!counted)throw new ApiError(404,'NOT_FOUND','Resource is not available.');
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/analytics/overview',{
    schema:{tags:['admin','analytics'],security:[{staffSession:[]}],operationId:'getAnalyticsOverview',
      querystring:AnalyticsOverviewQuerySchema,response:{200:AnalyticsOverviewResponseSchema,...errorResponses}},
  },async request=>{
    if(!isAdmin(request)) throw new ApiError(403,'FORBIDDEN','Administrator permission is required.');
    const days=(request.query as {days:'7'|'30'}).days==='7'?7:30;
    return envelope(await reader.run(()=>analytics.overview(days)),request);
  });
  app.get('/api/v1/admin/analytics/report',{
    schema:{tags:['admin','analytics'],security:[{staffSession:[]}],operationId:'getAnalyticsReport',
      querystring:AnalyticsReportQuerySchema,response:{200:AnalyticsReportResponseSchema,...errorResponses}},
  },async request=>{
    if(!isAdmin(request)) throw new ApiError(403,'FORBIDDEN','Administrator permission is required.');
    const query=request.query as AnalyticsReportQuery;
    if(query.endDate && query.endDate>localDate.format())
      throw new ApiError(400,'INVALID_REQUEST','Report dates cannot extend beyond today in Asia/Shanghai.');
    return envelope(await reader.run(()=>getAnalyticsReport(db,query,{...runtimeQuality})),request);
  });
  app.get('/api/v1/admin/analytics/traffic',{
    schema:{tags:['admin','analytics'],security:[{staffSession:[]}],operationId:'getAnalyticsTraffic',
      querystring:AnalyticsTrafficQuerySchema,response:{200:AnalyticsTrafficResponseSchema,...errorResponses}},
  },async request=>{
    if(!isAdmin(request)) throw new ApiError(403,'FORBIDDEN','Administrator permission is required.');
    const query=request.query as AnalyticsTrafficQuery;
    if(query.endDate && query.endDate>localDate.format())
      throw new ApiError(400,'INVALID_REQUEST','Report dates cannot extend beyond today in Asia/Shanghai.');
    return envelope(await trafficReader.run(()=>getAnalyticsTraffic(db,query,{...contactQuality},undefined,
      query.include==='unique-ip-visits'?ipVisitQuality():undefined)),request);
  });
  return analytics;
}
