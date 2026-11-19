import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  analyticsEventBodyLimit, AnalyticsEventsRequestSchema, AnalyticsEventsResponseSchema,
  AnalyticsOverviewQuerySchema, AnalyticsOverviewResponseSchema, type AnalyticsEvent,
} from '@hd/contracts/analytics';
import { ApiErrorSchema } from '@hd/contracts/public';
import type { Config } from '../config.js';
import { createDatabase } from '../db/index.js';
import { ApiError } from '../errors.js';
import { createAnalyticsStorage } from './storage.js';

export const analyticsEventsPath='/api/v1/analytics/events';
const unavailable=()=>new ApiError(503,'SERVICE_UNAVAILABLE','Analytics is temporarily unavailable.',undefined,true);
const errorResponses=Object.fromEntries([400,401,403,413,415,429,500,503].map(code=>[code,ApiErrorSchema]));
const envelope=<T>(data:T,request:FastifyRequest)=>({data,meta:{requestId:request.id}});

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
  optionalMaintenance:(action:()=>Promise<void>)=>Promise<void>) {
  // Analytics has its own small pool and no queued operations. Staff session
  // checks still use the ordinary auth path, before the overview opens this pool.
  const db=createDatabase(config.databaseUrl,2,false,500);
  const analytics=createAnalyticsStorage(db);
  const writer=lane(), reader=lane();
  let windowStart=performance.now(), acceptedBatches=0;
  let timer:ReturnType<typeof setInterval>|undefined;
  if(config.environment!=='test') {
    timer=setInterval(()=>{
      if(!writer.idle()) return;
      void optionalMaintenance(()=>writer.run(async()=>{await analytics.prune();}))
        .catch(()=>app.log.warn('Analytics retention cleanup could not run.'));
    },5*60_000);
    timer.unref();
  }
  app.addHook('onClose',async()=>{
    if(timer) clearInterval(timer);
    await db.close();
  });

  app.post(analyticsEventsPath,{
    bodyLimit:analyticsEventBodyLimit,
    config:{rateLimit:{max:60,timeWindow:60_000}},
    schema:{tags:['public','analytics'],operationId:'recordAnalyticsEvents',body:AnalyticsEventsRequestSchema,
      response:{202:AnalyticsEventsResponseSchema,...errorResponses}},
    onRequest:async request=>{
      delete request.headers.cookie;
      delete request.headers.authorization;
      delete request.headers.referer;
      const origin=request.headers.origin, fetchSite=request.headers['sec-fetch-site'];
      if(!origin || !config.analyticsOrigins.includes(origin) || origin!==`${request.protocol}://${request.host}` ||
        (fetchSite!==undefined && fetchSite!=='same-origin')) {
        throw new ApiError(403,'FORBIDDEN','A configured same-origin website request is required.');
      }
      if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json') {
        throw new ApiError(415,'INVALID_REQUEST','Analytics events require JSON.');
      }
    },
  },async (request,reply)=>{
    const now=performance.now();
    if(now-windowStart>=60_000) {windowStart=now;acceptedBatches=0;}
    if(acceptedBatches>=120) {
      reply.header('Retry-After',String(Math.max(1,Math.ceil((60_000-now+windowStart)/1000))));
      throw new ApiError(429,'RATE_LIMITED','Analytics capacity is busy.',undefined,true);
    }
    await writer.run(async()=>{
      acceptedBatches++;
      await analytics.ingest((request.body as {events:AnalyticsEvent[]}).events,config.externalCatalog);
    });
    return reply.code(202).send(envelope({accepted:true as const},request));
  });

  app.get('/api/v1/admin/analytics/overview',{
    schema:{tags:['admin','analytics'],security:[{staffSession:[]}],operationId:'getAnalyticsOverview',
      querystring:AnalyticsOverviewQuerySchema,response:{200:AnalyticsOverviewResponseSchema,...errorResponses}},
  },async request=>{
    if(!isAdmin(request)) throw new ApiError(403,'FORBIDDEN','Administrator permission is required.');
    const days=(request.query as {days:'7'|'30'}).days==='7'?7:30;
    return envelope(await reader.run(()=>analytics.overview(days)),request);
  });
  return analytics;
}
