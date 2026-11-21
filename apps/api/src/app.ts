import { registerSeoRoutes } from './seo/routes.js';
import {ServingGate} from './serving-gate.js';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import Fastify, { LogController, type FastifyRequest, type FastifyReply } from 'fastify';
import swagger from '@fastify/swagger';
import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import { validatorCompiler, serializerCompiler, jsonSchemaTransform, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as pub from '@hd/contracts/public';
import * as adm from '@hd/contracts/admin';
import { readConfig, type Config } from './config.js';
import { classifyCapacityFailure, createDatabase, type PublicFailureDiagnostic } from './db/index.js';
import { LoginAccountLimiter } from './login-account-limiter.js';
import { createAuth, authHeaders, requireStaff, requireTrustedOrigin, staffSignInCredential } from './auth.js';
import { InventoryService, type Actor, type HomeModelFilterPhase, type PublicListReadPhase } from './vehicles/service.js';
import { getVehiclePixel, listEnabledVehiclePixels, setVehiclePixel } from './vehicles/pixel.js';
import { staffUploadStats } from './vehicles/upload-attribution.js';
import { StaffManagement } from './staff-management.js';
import { TranslationPlanService } from './vehicles/translation-plans.js';
import { PgTranslationBudget } from './vehicles/translation-budget.js';
import { VehicleEvidence } from './vehicles/evidence.js';
import {FullSyncAccessHints} from './external/full-sync/access.js';
import {markFullSyncAccess} from './external/full-sync/engine.js';
import {listingUuid} from './external/catalog.js';
import { externalInquiryNumber } from './external/inquiry-code.js';
import { VehicleSegments } from './vehicles/segments.js';
import { ActivityService } from './activity/service.js';
import { analyticsContactPath, analyticsEventsPath, registerAnalyticsRoutes } from './analytics/routes.js';
import { analyticsIpVisitPath } from '@hd/contracts/analytics';
import { registerIpVisitRoutes } from './analytics/ip-visits.js';
import { MAX_VEHICLE_MEDIA, MediaService } from './media/service.js';
import { LocalMediaStore, MediaStorageError } from './media/storage.js';
import { trimHttpWhitespace } from './media/conditional.js';
import { ApiError, notFound } from './errors.js';
import { createVehicleTranslator, type VehicleTranslator } from './vehicles/translation.js';
import { externalBatchPath, externalBulkVisibilityPath, externalMediaFailurePath, externalOverridesPath, externalTrialPath, registerExternalRoutes } from './external/routes.js';
import { createPublicCatalogCache, PublicCatalogUnavailableError, type PublicCacheRoute } from './external/public-cache.js';
import { createSsrServiceIdentity, SSR_CATALOG_PREFIX, SSR_CATALOG_VERSION_PATH, SsrOriginLimiter } from './ssr-service.js';

const IdParams=z.strictObject({id:z.uuid()});
const staffPath='/api/v1/admin/staff';
const staffVehiclePixelPath='/api/v1/admin/vehicles/:id/pixel';
const externalVehiclePixelPath='/api/v1/admin/external/listings/:id/pixel';
const enabledPixelVehiclesPath='/api/v1/admin/vehicle-pixel/enabled';
const StaffIdParams=z.strictObject({id:adm.StaffRecordSchema.shape.id});
const signInResultSchema=z.object({token:z.string().min(1),user:z.object({id:z.string().min(1)})});
const externalAdminReadPaths=new Set(['/api/v1/admin/external/provider-status','/api/v1/admin/external/sync-status','/api/v1/admin/external/sync-timings']);
const versionHeader=z.object({'if-match':z.string().regex(/^\d+$/)});
const idemHeader=z.object({'idempotency-key':adm.IdempotencyKeySchema});
// Full drafts include two source fields, six translations and bounded private/media metadata.
// Allow their UTF-8/JSON-escaped encoding without raising the limits of small mutations.
const vehicleDraftBodyLimit=1024*1024;
const configurationImportPath='/api/v1/admin/vehicles/:id/configuration-import';
const configurationImportPreviewPath=`${configurationImportPath}/preview`;
const vehicleMediaUploadsPath='/api/v1/admin/vehicles/:id/media-uploads';
const vehicleMediaUploadsResponse=pub.responseSchema(z.strictObject({
  items:z.array(adm.MediaAssetSchema),used:z.number().int().nonnegative(),limit:z.literal(MAX_VEHICLE_MEDIA),
}));
// A JSON string wrapper may escape each byte of the original JSON file as a six-byte sequence.
const configurationImportBodyLimit=6*adm.CONFIGURATION_IMPORT_JSON_BYTES+1024;
const errorResponses=Object.fromEntries([400,401,403,404,409,413,422,429,500,503].map(code=>[code,pub.ApiErrorSchema]));
const schema=(tag:string,operationId:string,options:Record<string,unknown>)=>({tags:[tag],operationId,...options});

function rateLimitKey(request:FastifyRequest) {
  const route=request.routeOptions.url??'';
  const upload=request.method==='PUT'&&route==='/api/v1/admin/media/:id/content' ||
    request.method==='POST'&&['/api/v1/admin/media/uploads','/api/v1/admin/media/:id/complete'].includes(route);
  const translate=request.method==='POST'&&['/api/v1/admin/vehicles/:id/translation-suggestions',
    '/api/v1/admin/vehicles/:id/localization/translation-suggestions','/api/v1/admin/vehicles/:id/translation-plans',
    '/api/v1/admin/vehicles/:id/translation-plans/:planId/generate'].includes(route);
  // Matched route families, never a caller-supplied ID/query/header, select the budget.
  const bucket=route===externalMediaFailurePath?'external-media-report':
    route===analyticsEventsPath?'public-analytics':route===analyticsContactPath?'anonymous-contact':route===analyticsIpVisitPath?'internal-ip-visits':
    request.method==='POST'&&route===externalBatchPath?'external-import':request.method==='POST'&&route===externalTrialPath?'external-trial':
    upload?'admin-upload':translate?'admin-translation':
    route==='/api/v1/media/:id'?'public-media':
    route.startsWith('/api/v1/admin/')?'admin':route.startsWith('/health/')?'health':
      route.startsWith('/api/auth/')?'auth':'public-json';
  // Retain the plugin's IPv4-mapped and IPv6 /64 normalization with our custom key.
  return `${bucket}:${normalizeIP(request.ip)}`;
}

const publicMediaCacheControl = 'private, no-cache';

function sendInternalMedia(reply:FastifyReply,file:{filename:string},etag?:string) {
  // Only a store-prepared UUID and fixed derivative can become an internal URI.
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.(?:thumb|card))?\.webp$/.test(file.filename)) {
    throw new MediaStorageError('MEDIA_STORAGE_ERROR','The media delivery target is invalid.');
  }
  const prefix=etag?'/_hd_public_media/':'/_hd_media/';
  if(etag) reply.header('ETag',etag);
  // X-Accel copies Cache-Control into the internal request. Give the final
  // location sole ownership of the policy, including static delivery failures.
  return reply.removeHeader('Cache-Control').type('image/webp').header('X-Accel-Redirect',`${prefix}${file.filename}`)
    .header('X-Accel-Expires','0').send();
}

const capacityRoutes = new Set<string>(['/api/v1/vehicles','/api/v1/vehicle-filters','/api/v1/vehicles/:id','/api/v1/home/vehicles']);
const isCatalogTextSearch=(query:{q?:string})=>Boolean(query.q&&!externalInquiryNumber(query.q));

export async function buildApp(config:Config=readConfig(), options:{
  logger?:boolean;translator?:VehicleTranslator;onPublicFailure?:(event:PublicFailureDiagnostic)=>void;
}={}) {
  const serving=new ServingGate(config.servingModeFile);
  const db=createDatabase(config.databaseUrl,config.poolMax,Boolean(options.onPublicFailure));
  const fullSyncHints=new FullSyncAccessHints(id=>markFullSyncAccess(db,id),work=>serving.optionalEffect(work));
  let catalogCache;
  try { catalogCache = await createPublicCatalogCache(db, {
    ...config.publicCache, maxConcurrentRevisionReads: config.externalScale ? 128 : 32,
  }); }
  catch (error) { await db.close(); throw error; }
  const auth=createAuth(db,config);
  const staffManagement=new StaffManagement(db,auth);
  const loginAccounts=new LoginAccountLimiter(config.authSecret);
  const mediaStore=new LocalMediaStore(config.mediaRoot);
  const inventory=new InventoryService(db,config.externalCatalog,mediaStore,config.publicSeoEnabled);
  const translator=options.translator??createVehicleTranslator(config.translation,new PgTranslationBudget(db));
  const translationPlans=new TranslationPlanService(db,translator,(id,who,scope)=>inventory.translationPlanInput(id,who,scope));
  const media=new MediaService(db,mediaStore);
  const activity=new ActivityService(db);
  const segments=new VehicleSegments(db,inventory);
  const isSsrService=createSsrServiceIdentity(config.ssrService);
  const ssrOriginLimiter=new SsrOriginLimiter();
  const app=Fastify({logger: options.logger ? {redact:['req.headers.cookie','req.headers.authorization','req.headers.x-hd-ssr-key','req.headers.x-hd-analytics-gateway-key','req.headers.x-hd-analytics-visit-key','req.body','res.headers.set-cookie']} : false,
    genReqId:()=>randomUUID(),requestIdHeader:false,bodyLimit:100_000,requestTimeout:30_000,trustProxy:config.trustProxy,
    logController:new LogController({disableRequestLogging:true})}).withTypeProvider<ZodTypeProvider>();
  app.addHook('onRoute',route=>{const handler=route.handler;route.handler=async function(request,reply){
    serving.handling(request);try{return await handler.call(this,request,reply);}finally{serving.finish(request);}
  };});
  app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger,{openapi:{openapi:'3.0.3',info:{title:'HD Auto API',version:pub.CONTRACT_VERSION},
    components:{securitySchemes:{staffSession:{type:'apiKey',in:'cookie',name:config.environment==='production'?'__Secure-hd-auto.session_token':'hd-auto.session_token'}}}},transform:jsonSchemaTransform});
  await app.register(rateLimit,{max:(_request,key)=>key.startsWith('admin-translation:')?20:120,timeWindow:60_000,
    keyGenerator:rateLimitKey,
    errorResponseBuilder:()=>({statusCode:429,code:'RATE_LIMITED',message:'Request rate exceeded.'})});
  const staff=new WeakMap<object,adm.StaffMe>();
  const requestSignals=new WeakMap<object,AbortSignal>();
  const longCacheRequests=new WeakSet<object>();
  type CatalogReadPhase=HomeModelFilterPhase|PublicListReadPhase|'cache_lookup_or_shared'|'cache_validate'|'response';
  type CatalogReadTiming={
    kind:'home-models'|'list'|'filters'; phase:CatalogReadPhase; started:number;
    stageMs:Partial<Record<CatalogReadPhase,number>>;
  };
  const catalogReadTimings=new WeakMap<FastifyRequest,CatalogReadTiming>();
  const beginCatalogTiming=(request:FastifyRequest,kind:CatalogReadTiming['kind'])=>{
    const timing:CatalogReadTiming={kind,phase:'cache_lookup_or_shared',started:performance.now(),stageMs:{}};
    catalogReadTimings.set(request,timing);
    return (phase:CatalogReadPhase)=>{
      const now=performance.now();
      timing.stageMs[timing.phase]=(timing.stageMs[timing.phase]??0)+now-timing.started;
      timing.phase=phase;
      timing.started=now;
    };
  };
  const catalogReadDiagnostics=(request:FastifyRequest)=>{
    const timing=catalogReadTimings.get(request);
    if(!timing)return {};
    const {kind,phase,stageMs,started}=timing;
    const elapsed={...stageMs,[phase]:Math.round((stageMs[phase]??0)+performance.now()-started)};
    return kind==='home-models'
      ? {projection:'home-models',homeModelsPhase:phase,homeModelsStageMs:elapsed}
      : {searchRoute:kind,searchPhase:phase,searchStageMs:elapsed};
  };
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('X-Request-Id',request.id);
    serving.enter(request,request.method,request.routeOptions.url??'');
    // Only Fastify's explicitly trusted peers may supply forwarding metadata.
    // Reject malformed resolved identities before they reach auth or business handlers.
    if(!isIP(request.ip) || request.ip.includes('%')) throw new ApiError(400,'INVALID_REQUEST','Client address is invalid.');
    if(capacityRoutes.has(request.routeOptions.url??'') || request.routeOptions.url?.startsWith(`${SSR_CATALOG_PREFIX}/`)) {
      const controller=new AbortController(),abort=()=>controller.abort();
      const cleanup=()=>{request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed);};
      const closed=()=>{if(!reply.raw.writableEnded)abort();cleanup();};
      requestSignals.set(request,controller.signal);
      request.raw.once('aborted',abort);reply.raw.once('close',closed);reply.raw.once('finish',cleanup);
    }
    if(request.routeOptions.url?.startsWith(`${SSR_CATALOG_PREFIX}/`)) {
      if(!isSsrService(request)) throw notFound();
      if(request.headers[pub.INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER]==='2') {
        longCacheRequests.add(request);
        reply.header(pub.INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER,'2');
      }
      if(request.routeOptions.url!==SSR_CATALOG_VERSION_PATH && !ssrOriginLimiter.take()) {
        reply.header('Retry-After','1');
        throw new ApiError(429,'RATE_LIMITED','SSR origin capacity is busy.',undefined,true);
      }
    }
  });
  // Route onRequest rate limits run before authentication; preParsing keeps
  // unauthenticated uploads from being read or decoded before access checks.
  app.addHook('preParsing',async(request,_reply,payload)=>{
    // Use the matched route, not the raw URL (which may contain encoded static segments).
    const route=request.routeOptions.url??'';
    const external=route.startsWith('/api/v1/admin/external/') || route===externalMediaFailurePath;
    if(external&&!config.externalCatalog) throw notFound();
    // Formal catalog reading is not authorization to import or start a supplier sync.
    if(request.method==='POST' && route===externalBatchPath && !config.externalIngestion) throw notFound();
    if(route.startsWith('/api/v1/admin/')) {
      const member=await requireStaff(request,auth,db);
      staff.set(request,member);
      requireTrustedOrigin(request,config);
      if((route===staffVehiclePixelPath||route===externalVehiclePixelPath||route===enabledPixelVehiclesPath)&&member.role!=='admin') {
        throw new ApiError(403,'FORBIDDEN','Administrator role is required for vehicle Pixel settings.');
      }
      if ((route===staffPath || route.startsWith(`${staffPath}/`)) && !member.permissions.includes('staff:manage')) {
        throw new ApiError(403,'FORBIDDEN','Staff management permission is required.');
      }
      if((external || route.endsWith('/activity') || route===vehicleMediaUploadsPath) && !member.permissions.includes('vehicles:read')) {
        throw new ApiError(403,'FORBIDDEN','Vehicle read permission is required.');
      }
      const changesExternalListing = request.method==='PUT' && route===externalOverridesPath ||
        request.method==='POST' && route===externalBulkVisibilityPath;
      if((changesExternalListing || route===configurationImportPath || route===configurationImportPreviewPath) && !member.permissions.includes('vehicles:write')) {
        throw new ApiError(403,'FORBIDDEN','Vehicle write permission is required.');
      }
      if(external && member.role!=='admin' && (externalAdminReadPaths.has(route) || route.endsWith('/raw') || request.method==='POST' && [externalBatchPath,externalTrialPath,'/api/v1/admin/external/sync-control'].includes(route))) {
        throw new ApiError(403,'FORBIDDEN','Administrator role is required for this external catalog operation.');
      }
    }
    return payload;
  });
  app.addHook('preValidation',async(request)=>{
    // Query strings use decimal integers only. Other representations remain invalid.
    const query=request.query as Record<string,unknown>;
    if(query && typeof query==='object') for(const key of ['page','pageSize','mileageMin','mileageMax','yearMin','yearMax']) {
      if(typeof query[key]==='string' && /^(?:0|[1-9]\d*)$/.test(query[key])) query[key]=Number(query[key]);
    }
  });
  app.addHook('onResponse',async(request,reply)=>{
    serving.response(request);
    if(request.routeOptions.url===analyticsContactPath||request.routeOptions.url===analyticsIpVisitPath)return;
    app.log.info({requestId:request.id,method:request.method,route:request.routeOptions.url,statusCode:reply.statusCode,elapsedMs:reply.elapsedTime,
      ...(reply.statusCode<400&&reply.elapsedTime>=750?catalogReadDiagnostics(request):{}),
    },'Request completed');
  });
  app.setErrorHandler((error,request,reply)=>{
    const detail=error as {code?:string;statusCode?:number;validation?:unknown;name?:string};
    let problem:ApiError;
    if(error instanceof ApiError) problem=error;
    else if(error instanceof MediaStorageError) {
      if(error.code==='MEDIA_TOO_LARGE') problem=new ApiError(413,'PAYLOAD_TOO_LARGE','Image is too large.');
      else if(error.code==='MEDIA_NOT_FOUND') problem=new ApiError(404,'NOT_FOUND','Image is not available.');
      else if(error.code==='MEDIA_ALREADY_EXISTS') problem=new ApiError(409,'VERSION_CONFLICT','This upload ID already contains different content.');
      else if(error.code==='MEDIA_STORAGE_ERROR') problem=new ApiError(503,'SERVICE_UNAVAILABLE','Media storage is unavailable.',undefined,true);
      else problem=new ApiError(400,'UNSUPPORTED_MEDIA_TYPE','Image content is invalid or unsupported.');
    } else if(detail.code==='23505' && (error as {constraint?:string}).constraint==='vehicle_external_identity_idx') {
      problem=new ApiError(409,'SOURCE_IDENTITY_CONFLICT','This platform listing already exists, including in the recycle bin.');
    } else if(detail.validation || error instanceof z.ZodError || detail.code==='22P02' || detail.statusCode===400) {
      const fields=error instanceof z.ZodError ? error.issues.map(issue=>({path:issue.path.join('.')||'request',code:'INVALID_FIELD',message:'Invalid field value.'}))
        : Array.isArray(detail.validation) ? detail.validation.map((issue:{instancePath?:string})=>({path:issue.instancePath?.replace(/^\//,'').replaceAll('/','.')||'request',code:'INVALID_FIELD',message:'Invalid field value.'})) : undefined;
      problem=new ApiError(400,'INVALID_REQUEST','Request validation failed.',fields?.slice(0,100));
    } else if(detail.statusCode===413) problem=new ApiError(413,'PAYLOAD_TOO_LARGE','Payload is too large.');
    else if(detail.statusCode===429) problem=new ApiError(429,'RATE_LIMITED','Request rate exceeded.',undefined,true);
    else if(detail.statusCode===415) problem=new ApiError(400,'UNSUPPORTED_MEDIA_TYPE','Content type is not supported.');
    else if(['ECONNREFUSED','ETIMEDOUT','57P01','53300','08006'].includes(detail.code??'')) problem=new ApiError(503,'SERVICE_UNAVAILABLE','A required service is unavailable.',undefined,true);
    else problem=new ApiError(500,'INTERNAL_ERROR','Request could not be completed.');
    const route=request.routeOptions.url;
    if(options.onPublicFailure && route && capacityRoutes.has(route)) {
      // Report only fixed categories. Diagnostics must not alter the public response.
      try {options.onPublicFailure({route:route as PublicFailureDiagnostic['route'],status:problem.status,...classifyCapacityFailure(error)});}
      catch {/* capacity observer only */}
    }
    if(problem.status>=500&&route!==analyticsContactPath&&route!==analyticsIpVisitPath) {
      const catalogError=error instanceof PublicCatalogUnavailableError?error:undefined;
      const metrics=catalogError&&catalogCache.metrics();
      app.log.error({requestId:request.id,route,errorCode:detail.code??detail.name,...catalogReadDiagnostics(request),
        ...(metrics&&catalogError?{catalogReason:catalogError.reason,
          activeLoads:metrics.activeLoads,queuedLoads:metrics.queuedLoads,activeRevisionReads:metrics.activeRevisionReads,
          timeouts:metrics.timeouts,versionRetries:metrics.versionRetries,uncachedFilterLoads:metrics.uncachedFilterLoads,oversizedValues:metrics.oversizedValues,
          poolWaiting:db.pool.waitingCount}:{}),
      },'Request failed');
    }
    // The limiter already supplies the rounded-up remaining window. Preserve it;
    // only an otherwise unspecified 429 falls back to our full 60-second window.
    if(problem.status===429 && !reply.hasHeader('Retry-After')) reply.header('Retry-After','60');
    if(problem.status===503) reply.header('Retry-After','5');
    return reply.code(problem.status).send({error:{code:problem.code,message:problem.message,...(problem.fields?{fields:problem.fields}:{}),retryable:problem.retryable},meta:{requestId:request.id}});
  });
  app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'Resource is not available.',retryable:false},meta:{requestId:request.id}}));
  app.addHook('onClose',async()=>{try{await fullSyncHints.close();await catalogCache.close();}finally{await db.close();}});
  const actor=(request:{id:string}):Actor=>({id:staff.get(request)!.id,requestId:request.id});
  const response=<T>(data:T,request:{id:string})=>({data,meta:{requestId:request.id}});
  const cacheProtocol=(request:object)=>longCacheRequests.has(request)?2:1;
  const cached=<T,Q extends {priceView?:'usd'}>(route:PublicCacheRoute,query:Q,load:()=>Promise<T>,request:{id:string})=>
    catalogCache.getVersioned(route,query,load,query.priceView==='usd',requestSignals.get(request),cacheProtocol(request));
  const publicResponse=async<T,Q extends {priceView?:'usd'}>(route:PublicCacheRoute,query:Q,load:()=>Promise<T>,request:{id:string})=>{
    const {value,stamp}=await cached(route,query,load,request);
    return {data:value,meta:{requestId:request.id,catalogCache:stamp}};
  };

  // Independent bounded generation lane; disabled deployments allocate no SEO connection pool.
  const seoDb=config.publicSeoEnabled?createDatabase(config.databaseUrl,1,false,1000):null;
  if(seoDb)app.addHook('onClose',async()=>{await seoDb.close();});
  registerSeoRoutes(app,seoDb??db,config.publicSeoEnabled,config.externalCatalog);

  app.get(SSR_CATALOG_VERSION_PATH,{schema:{hide:true,querystring:pub.PublicCatalogVersionQuerySchema,
    response:{200:pub.InternalPublicCatalogVersionResponseSchema,...errorResponses}}},async request=>{
    const query=request.query as z.infer<typeof pub.PublicCatalogVersionQuerySchema>;
    return response(await catalogCache.currentVersion(query.priceView==='usd',requestSignals.get(request),query.scope,cacheProtocol(request)),request);
  });

  app.get('/health/live',{schema:schema('health','liveness',{response:{200:z.object({status:z.literal('ok')})}})},async()=>({status:'ok' as const}));
  if(config.externalScale) app.get('/health/catalog-cache',{schema:{hide:true}},async()=>({enabled:config.publicCache.enabled,metrics:catalogCache.metrics()}));
  app.get('/health/serving',{schema:{hide:true}},async()=>serving.status());
  app.get('/health/ready',{schema:schema('health','readiness',{response:{200:z.object({status:z.literal('ready')}),503:z.object({status:z.literal('unavailable')})}})},async(_request,reply)=>{
    try {
      const ready=await db.pool.query(`SELECT bg.reference,ae.actor_name,ae.changes,h.id,cs.revision,cs.filter_revision,bs.last_reserved_at,v.deleted_at,v.public_content_revision,l.revision,pl.projections,im.receipt_hash,fx.version,pc.fingerprint,el.inquiry_number FROM home_config h
        JOIN public_catalog_state cs ON cs.id=1 JOIN translation_budget_state bs ON bs.id=1
        LEFT JOIN vehicles v ON false LEFT JOIN vehicle_localizations l ON false LEFT JOIN publication_localizations pl ON false
        LEFT JOIN idempotency_vehicle_metadata im ON false LEFT JOIN public_fx_quote fx ON false
        LEFT JOIN publication_preview_confirmations pc ON false
        LEFT JOIN translation_plans tp ON false LEFT JOIN translation_plan_segments ts ON false
        LEFT JOIN backup_gc_leases bg ON false LEFT JOIN translation_budget_reservations br ON false LEFT JOIN audit_events ae ON false
        LEFT JOIN analytics_collection_state ac ON false
        LEFT JOIN vehicle_pixel_settings vp ON false
        LEFT JOIN external_report_evidence re ON false LEFT JOIN external_inspection_enrichment ie ON false
        LEFT JOIN external_listings el ON false WHERE h.id=1`);
      if(ready.rowCount!==1) throw new Error('Required initial data is unavailable');
      if(config.publicSeoEnabled) await db.pool.query('SELECT 1 FROM seo_external_selection LIMIT 0');
      if(config.externalCatalog) {
        const externalReady=await db.pool.query(`SELECT el.formal_primary,el.first_imported_at,j.received_seq,sb.hash,sb.compressed,ss.revision,state.revision,f.locale_mask,o.text_source_identities,fs.version,fs.detail_turn,fs.timing_started_at,obs.slot_at,ve.export_status,ev.source_revision,ev.overview FROM external_catalog_state state
          JOIN public_catalog_state s ON s.id=state.id
          LEFT JOIN external_catalog c ON false LEFT JOIN external_catalog_search x ON false LEFT JOIN external_catalog_filter f ON false
          LEFT JOIN external_media m ON false LEFT JOIN external_translation_trials t ON false
          LEFT JOIN external_listings el ON false LEFT JOIN external_ingestion_jobs j ON false LEFT JOIN external_source_blobs sb ON false LEFT JOIN external_source_segment_sets ss ON false LEFT JOIN external_listing_overrides o ON false LEFT JOIN external_full_sync fs ON fs.id=1
          LEFT JOIN external_full_receive_observations obs ON false LEFT JOIN external_vehicle_extras ve ON false LEFT JOIN external_vehicle_evidence_sets ev ON false
          LEFT JOIN external_listing_pixel_settings ep ON false WHERE state.id=1 AND fs.id=1`);
        if(externalReady.rowCount!==1) throw new Error('External catalog migration is required');
      }
      return {status:'ready' as const};
    }
    catch{return reply.code(503).send({status:'unavailable' as const});}
  });
  app.route({method:['GET','POST'],url:'/api/auth/*',schema:{hide:true},config:{rateLimit:{max:30,timeWindow:60_000}},handler:async(request,reply)=>{
    const path=request.url.split('?')[0];
    const allowed=(request.method==='POST'&&['/api/auth/sign-in/email','/api/auth/sign-out'].includes(path??'')) || (request.method==='GET'&&path==='/api/auth/get-session');
    if(!allowed) return reply.code(404).send({code:'NOT_FOUND',message:'Authentication route is not exposed.'});
    if(request.method==='POST' && !config.trustedOrigins.includes(request.headers.origin??'')) return reply.code(403).send({code:'INVALID_ORIGIN',message:'Trusted Origin is required.'});
    const signingIn=request.method==='POST'&&path==='/api/auth/sign-in/email';
    const emailInput=(request.body as {email?:unknown}|null)?.email;
    if(signingIn) {
      const retryAfter=loginAccounts.retryAfter(emailInput);
      if(retryAfter!==null) {
        reply.header('Retry-After',String(retryAfter));
        throw new ApiError(429,'RATE_LIMITED','Request rate exceeded.',undefined,true);
      }
    }
    const login=signingIn?adm.StaffLoginSchema.safeParse(emailInput):undefined;
    const email=login?.success?adm.staffLoginEmail(login.data):undefined;
    const credential=email?await staffSignInCredential(db,email):undefined;
    const headers=authHeaders(request);
    const result=await auth.handler(new Request(`${config.authBaseUrl}${request.url}`,{method:request.method,headers,
      ...(request.method==='POST'?{body:JSON.stringify(request.body??{})}:{})}));
    const body=await result.text();
    if (signingIn&&result.ok) {
      const session=signInResultSchema.parse(JSON.parse(body));
      const current=email?await staffSignInCredential(db,email):undefined;
      // A concurrent reset may finish between password verification and session creation.
      // Remove only this request's new token before any cookie is sent.
      if (!current||credential?.id!==session.user.id||current.id!==session.user.id||credential.password!==current.password) {
        await db.pool.query('DELETE FROM staff_sessions WHERE token=$1 AND user_id=$2',[session.token,session.user.id]);
        throw new ApiError(401,'UNAUTHENTICATED','Staff login is required.');
      }
    }
    for(const [key,value] of result.headers) if(key!=='set-cookie'&&key!=='cache-control') reply.header(key,value);
    const cookies=result.headers.getSetCookie();if(cookies.length) reply.header('set-cookie',cookies);
    return reply.code(result.status).send(body);
  }});

  for (const prefix of ['/api/v1',SSR_CATALOG_PREFIX]) {
  const internal=prefix===SSR_CATALOG_PREFIX;
  const publicSchema=(operation:string,options:Record<string,unknown>)=>internal?{...options,hide:true}:schema('public',operation,options);
  const routeConfig=internal?{rateLimit:false as const}:undefined;
  const longerStamp={catalogCache:pub.InternalPublicCatalogCacheStampSchema.optional()};
  const meta=pub.PublicCatalogResponseMetaSchema.safeExtend(longerStamp);
  const listMeta=pub.CatalogMetaSchema.safeExtend(longerStamp);
  const cardList=internal?pub.PublicVehicleCardListSchema.safeExtend({meta:listMeta}):pub.PublicVehicleCardListSchema;
  const list=internal?pub.PublicVehicleListSchema.safeExtend({meta:listMeta}):pub.PublicVehicleListSchema;
  const detail=internal?pub.PublicVehicleResponseSchema.safeExtend({meta}):pub.PublicVehicleResponseSchema;
  const inline=internal?pub.PublicVehicleInlineResponseSchema.safeExtend({meta}):pub.PublicVehicleInlineResponseSchema;
  const filters=internal?pub.PublicVehicleFiltersSchema.safeExtend({meta}):pub.PublicVehicleFiltersSchema;
  const home=internal?pub.PublicHomeSectionsSchema.safeExtend({meta}):pub.PublicHomeSectionsSchema;
  app.get(`${prefix}/vehicles`,{config:routeConfig,schema:publicSchema('listVehicles',{querystring:pub.PublicVehicleQuerySchema,response:{200:z.union([cardList,list]),...errorResponses}})},
    async request=>{
      const query=request.query as pub.PublicVehicleQuery;
      const advance=isCatalogTextSearch(query)?beginCatalogTiming(request,'list'):undefined;
      const {value:loaded,stamp}=await cached('list',query,async()=>{
        const {data,meta:{requestId:_,...meta}}=await inventory.listPublic(query,request.id,advance);
        advance?.('cache_validate');
        return {data,meta};
      },request);
      advance?.('response');
      return {...loaded,meta:{...loaded.meta,requestId:request.id,catalogCache:stamp}};
    });
  app.get(`${prefix}/vehicles/:id`,{config:routeConfig,schema:publicSchema('getVehicle',{params:z.strictObject({id:z.union([z.uuid(),pub.ExternalListingIdSchema])}),querystring:pub.PublicVehicleDetailQuerySchema,response:{200:z.union([detail,inline]),...errorResponses}})},
    async request=>{const p=request.params as {id:string};const q=request.query as pub.PublicVehicleDetailQuery;
      // Candidate slots can share Redis while using different SEO settings.
      const detailKey={id:p.id,...q,...(q.seoView?{seoPolicy:config.publicSeoEnabled?1:0}:{})};
      const vehicle=await publicResponse('detail',detailKey,()=>inventory.getPublic(p.id,q.locale,q.view,q.priceView,q.projection,q.technicalView,q.titleView,q.pixelView,q.seoView),request);
      if(p.id.startsWith('ext-')) {
        fullSyncHints.hint(listingUuid(p.id));
      }
      return vehicle;
    });
  app.get(`${prefix}/vehicle-filters`,{config:routeConfig,schema:publicSchema('vehicleFilters',{querystring:pub.PublicFilterQuerySchema,response:{200:filters,...errorResponses}})},async request=>{
    const query=request.query as pub.PublicFilterQuery;
    // Previous Web releases still compare the filter response with the global version.
    const legacy=internal&&request.headers['x-hd-catalog-scope']!=='filters';
    const usd=query.priceView==='usd', signal=requestSignals.get(request), protocol=cacheProtocol(request);
    const advance=query.projection==='home-models'?beginCatalogTiming(request,'home-models')
      :isCatalogTextSearch(query)?beginCatalogTiming(request,'filters'):undefined;
    const {value,stamp}=legacy
      ? await catalogCache.getBoundedVersioned('filters',query,async()=>{
        const result=await inventory.filterResult(query,advance);
        advance?.('cache_validate');
        return result;
      },usd,signal,protocol)
      : await catalogCache.getFilterSnapshot(query,async()=>{
        const result=await inventory.filterSnapshot(query,advance);
        advance?.('cache_validate');
        return result;
      },usd,signal,protocol);
    advance?.('response');
    return {data:value,meta:{requestId:request.id,catalogCache:stamp}};
  });
  app.get(`${prefix}/home/vehicles`,{config:routeConfig,schema:publicSchema('homeVehicles',{querystring:pub.PublicLocaleQuerySchema,response:{200:home,...errorResponses}})},async request=>{
    const query=request.query as pub.PublicLocaleQuery;return publicResponse('home',query,()=>inventory.publicHome(query.locale,query.view,query.priceView),request);
  });
  }
  const publicMediaSchema=schema('public','publicMedia',{params:IdParams,querystring:pub.PublicMediaQuerySchema});
  const deliverPublicMedia=async(request:FastifyRequest,reply:FastifyReply)=>{
    const id=(request.params as {id:string}).id;
    const {variant}=request.query as pub.PublicMediaQuery;
    const ifMatch=request.headers['if-match'];
    const ifNoneMatch=request.headers['if-none-match'];
    const failedIfMatch=ifMatch!==undefined&&trimHttpWhitespace(ifMatch)!=='*';
    // A stock static handler would independently evaluate these conditions
    // against its own metadata. Use the same API delivery rules in both modes.
    const internal=config.mediaDelivery==='nginx'&&ifMatch===undefined&&request.headers['if-unmodified-since']===undefined;
    const readBody=request.method==='GET'&&!failedIfMatch;
    const options={ifNoneMatch,readBody:readBody&&!internal};
    let delivery:Awaited<ReturnType<MediaService['publicDelivery']>>|undefined;
    if(variant) {
      await serving.optionalEffect(async()=>{
        try { delivery=await media.publicDelivery(id,variant,options); }
        catch(error) {
          if(!(error instanceof MediaStorageError)||error.code!=='MEDIA_DERIVATIVE_BUSY') throw error;
        }
      });
    }
    // Non-active slots and busy card generators serve the authorized original
    // without a validator so it cannot be cached under the derivative URL.
    const fallback=variant!==undefined&&delivery===undefined;
    delivery??=await media.publicDelivery(id,undefined,fallback?{readBody}:options);
    if(failedIfMatch) throw new ApiError(412,'VERSION_CONFLICT','The media precondition did not match.');
    if(!fallback) {
      if(delivery.notModified) {
        return reply.header('Cache-Control',publicMediaCacheControl).header('ETag',delivery.etag).code(304).send();
      }
      if(internal) return sendInternalMedia(reply,delivery,delivery.etag);
      reply.header('Cache-Control',publicMediaCacheControl).header('ETag',delivery.etag);
    }
    reply.type('image/webp').header('Content-Length',delivery.byteSize);
    return reply.send(delivery.body);
  };
  app.get('/api/v1/media/:id',{schema:publicMediaSchema,exposeHeadRoute:false},deliverPublicMedia);
  // Fastify's automatic HEAD handler rewrites an empty reply's length to zero.
  app.head('/api/v1/media/:id',{schema:{...publicMediaSchema,hide:true},onSend:async()=>null},deliverPublicMedia);

  const adminSchema=(operationId:string,options:Record<string,unknown>)=>schema('admin',operationId,{security:[{staffSession:[]}],...options});
  app.get(enabledPixelVehiclesPath,{schema:adminSchema('listEnabledVehiclePixels',{
    querystring:adm.EnabledPixelVehiclesQuerySchema,response:{200:adm.EnabledPixelVehiclesResponseSchema,...errorResponses},
  })},async request=>response(await listEnabledVehiclePixels(db,request.query as adm.EnabledPixelVehiclesQuery,config.externalCatalog),request));
  for(const [path,kind,operation,params] of [
    [staffVehiclePixelPath,'staff','StaffVehiclePixel',IdParams],
    [externalVehiclePixelPath,'external','ExternalVehiclePixel',z.strictObject({id:pub.ExternalListingIdSchema})],
  ] as const) {
    const responses={200:adm.VehiclePixelSettingsResponseSchema,...errorResponses};
    app.get(path,{schema:adminSchema(`get${operation}`,{params,response:responses})},async request=>
      response(await getVehiclePixel(db,kind,(request.params as {id:string}).id),request));
    app.put(path,{bodyLimit:1024,schema:adminSchema(`set${operation}`,{params,body:adm.SaveVehiclePixelSettingsSchema,response:responses})},async request=>
      response(await setVehiclePixel(db,kind,(request.params as {id:string}).id,request.body as adm.SaveVehiclePixelSettings,actor(request)),request));
  }
  const PlanParams=z.strictObject({id:z.uuid(),planId:z.uuid()});
  app.get('/api/v1/admin/vehicles/:id/translation-bundle',{schema:adminSchema('getVehicleTranslationBundle',{params:IdParams,response:{200:adm.VehicleTranslationBundleResponseSchema,...errorResponses}})},async request=>response(await inventory.getTranslationBundle((request.params as {id:string}).id,actor(request)),request));
  const evidence=new VehicleEvidence(db,inventory);
  app.get('/api/v1/vehicles/:id/inspection',{schema:{operationId:'getVehicleInspection',tags:['public'],params:z.strictObject({id:z.union([z.uuid(),pub.ExternalListingIdSchema])}),querystring:pub.PublicVehicleInspectionQuerySchema,response:{200:pub.PublicVehicleInspectionResponseSchema,...errorResponses}}},
    async request=>response(pub.PublicVehicleInspectionResponseSchema.shape.data.parse(await evidence.read((request.params as {id:string}).id,'inspection',request.query as pub.PublicVehicleInspectionQuery)),request));
  app.get('/api/v1/vehicles/:id/price-history',{schema:{operationId:'getVehiclePriceHistory',tags:['public'],params:z.strictObject({id:z.union([z.uuid(),pub.ExternalListingIdSchema])}),querystring:pub.PublicVehicleSegmentQuerySchema,response:{200:pub.PublicVehiclePriceHistoryResponseSchema,...errorResponses}}},
    async request=>response(pub.PublicVehiclePriceHistoryResponseSchema.shape.data.parse(await evidence.read((request.params as {id:string}).id,'price-history',request.query as pub.PublicVehicleSegmentQuery)),request));
  app.get('/api/v1/vehicles/:id/gallery',{schema:{operationId:'getVehicleGallery',tags:['public'],params:z.strictObject({id:z.union([z.uuid(),pub.ExternalListingIdSchema])}),querystring:pub.PublicVehicleSegmentQuerySchema,response:{200:pub.PublicVehicleGalleryResponseSchema,...errorResponses}}},async request=>response(pub.PublicVehicleGalleryResponseSchema.shape.data.parse(await segments.read((request.params as {id:string}).id,'gallery',request.query as pub.PublicVehicleSegmentQuery)),request));
  app.get('/api/v1/vehicles/:id/configuration',{schema:{operationId:'getVehicleConfiguration',tags:['public'],params:z.strictObject({id:z.union([z.uuid(),pub.ExternalListingIdSchema])}),querystring:pub.PublicVehicleSegmentQuerySchema,response:{200:pub.PublicVehicleConfigurationResponseSchema,...errorResponses}}},async request=>response(pub.PublicVehicleConfigurationResponseSchema.shape.data.parse(await segments.read((request.params as {id:string}).id,'configuration',request.query as pub.PublicVehicleSegmentQuery)),request));
  app.get('/api/v1/admin/vehicles/:id/activity',{schema:adminSchema('getVehicleActivity',{params:IdParams,querystring:adm.ActivityQuerySchema,response:{200:adm.ActivityResponseSchema,...errorResponses}})},async request=>response(await activity.staff((request.params as {id:string}).id,request.query as adm.ActivityQuery),request));
  app.get('/api/v1/admin/external/listings/:id/activity',{schema:adminSchema('getExternalListingActivity',{params:z.strictObject({id:pub.ExternalListingIdSchema}),querystring:adm.ActivityQuerySchema,response:{200:adm.ActivityResponseSchema,...errorResponses}})},async request=>response(await activity.external((request.params as {id:string}).id,request.query as adm.ActivityQuery),request));
  app.put('/api/v1/admin/vehicles/:id/translation-bundle',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('saveVehicleTranslationBundle',{params:IdParams,body:adm.SaveVehicleTranslationBundleSchema,response:{200:adm.VehicleTranslationBundleResponseSchema,...errorResponses}})},async request=>response(await inventory.saveTranslationBundle((request.params as {id:string}).id,request.body as adm.SaveVehicleTranslationBundle,actor(request)),request));
  app.post(configurationImportPreviewPath,{bodyLimit:configurationImportBodyLimit,schema:adminSchema('previewConfigurationImport',{
    params:IdParams,body:adm.ConfigurationImportPreviewRequestSchema,response:{200:adm.ConfigurationImportPreviewResponseSchema,...errorResponses},
  })},async request=>response(await inventory.previewConfigurationImport((request.params as {id:string}).id,
    request.body as adm.ConfigurationImportPreviewRequest,actor(request),config.authSecret),request));
  app.put(configurationImportPath,{bodyLimit:configurationImportBodyLimit,schema:adminSchema('saveConfigurationImport',{
    params:IdParams,body:adm.ConfigurationImportSaveRequestSchema,response:{200:adm.VehicleTranslationBundleResponseSchema,...errorResponses},
  })},async request=>response(await inventory.saveConfigurationImport((request.params as {id:string}).id,
    request.body as adm.ConfigurationImportSaveRequest,actor(request),config.authSecret),request));
  app.post('/api/v1/admin/vehicles/:id/translation-plans',{schema:adminSchema('createVehicleTranslationPlan',{params:IdParams,body:adm.CreateTranslationPlanRequestSchema,response:{200:adm.TranslationPlanResponseSchema,...errorResponses}})},async request=>response(await translationPlans.create((request.params as {id:string}).id,request.body as adm.CreateTranslationPlanRequest,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/translation-plans/:planId/generate',{schema:adminSchema('generateConfirmedVehicleTranslationPlan',{params:PlanParams,body:adm.GenerateTranslationPlanRequestSchema,headers:idemHeader,response:{200:adm.TranslationPlanResultResponseSchema,...errorResponses}})},async request=>{
    const {id,planId}=request.params as {id:string;planId:string};return response(await translationPlans.generate(id,planId,request.body as adm.GenerateTranslationPlanRequest,actor(request),request.headers['idempotency-key'] as string),request);
  });
  app.get('/api/v1/admin/vehicles/:id/translation-plans/recoverable',{schema:adminSchema('getRecoverableVehicleTranslationPlan',{params:IdParams,response:{200:adm.RecoverableTranslationPlanResponseSchema,...errorResponses}})},
    async request=>response(await translationPlans.recoverable((request.params as {id:string}).id,actor(request)),request));
  app.get('/api/v1/admin/vehicles/:id/translation-plans/:planId',{schema:adminSchema('getVehicleTranslationPlanStatus',{params:PlanParams,response:{200:adm.TranslationPlanStatusResponseSchema,...errorResponses}})},async request=>{
    const {id,planId}=request.params as {id:string;planId:string};return response(await translationPlans.status(id,planId,actor(request)),request);
  });
  registerExternalRoutes(app,db,actor,config.providerAccountKey);
  const ipVisitQuality=registerIpVisitRoutes(app,config,work=>serving.optionalEffect(work));
  const analytics=registerAnalyticsRoutes(app,config,request=>staff.get(request)?.permissions.includes('staff:manage')===true,
    work=>serving.optionalEffect(work),ipVisitQuality);
  app.get('/api/v1/admin/me',{schema:adminSchema('staffMe',{response:{200:adm.StaffMeResponseSchema,...errorResponses}})},async request=>response(staff.get(request),request));
  app.get('/api/v1/admin/me/upload-stats',{schema:adminSchema('staffUploadStats',{response:{200:adm.StaffUploadStatsResponseSchema,...errorResponses}})},
    async request=>response(await staffUploadStats(db.pool,staff.get(request)!.id),request));
  app.get(staffPath,{schema:adminSchema('listStaff',{response:{200:adm.StaffDirectoryResponseSchema,...errorResponses}})},
    async request=>response(await staffManagement.list(),request));
  app.post(staffPath,{bodyLimit:4096,schema:adminSchema('createStaff',{body:adm.StaffCreateRequestSchema,response:{201:adm.StaffRecordResponseSchema,...errorResponses}})},
    async(request,reply)=>reply.code(201).send(response(await staffManagement.create(request.body as adm.StaffCreateRequest),request)));
  app.post(`${staffPath}/:id/password`,{bodyLimit:2048,schema:adminSchema('resetStaffPassword',{params:StaffIdParams,body:adm.StaffPasswordResetRequestSchema,response:{200:adm.StaffMutationResponseSchema,...errorResponses}})},
    async request=>response(await staffManagement.resetPassword((request.params as {id:string}).id,(request.body as {password:string}).password),request));
  app.delete(`${staffPath}/:id`,{schema:adminSchema('revokeStaff',{params:StaffIdParams,response:{200:adm.StaffMutationResponseSchema,...errorResponses}})},
    async request=>response(await staffManagement.revoke((request.params as {id:string}).id),request));
  app.get('/api/v1/admin/vehicles',{schema:adminSchema('adminListVehicles',{querystring:adm.AdminVehicleQuerySchema,response:{200:adm.AdminVehicleListSchema,...errorResponses}})},async request=>{
    const query=request.query as adm.AdminVehicleQuery;
    const member=staff.get(request)!;
    if(query.uploader&&!member.permissions.includes('staff:manage')) throw new ApiError(403,'FORBIDDEN','Staff management permission is required.');
    return response(await inventory.listAdmin(query,member.id),request);
  });
  app.get('/api/v1/admin/vehicle-filters',{schema:adminSchema('adminVehicleFilters',{querystring:adm.AdminVehicleFiltersQuerySchema,response:{200:adm.AdminVehicleFiltersResponseSchema,...errorResponses}})},async request=>response(await inventory.adminFilters(request.query as adm.AdminVehicleFiltersQuery),request));
  app.post('/api/v1/admin/vehicles/bulk',{schema:adminSchema('bulkVehicleMutation',{body:adm.BulkVehicleMutationRequestSchema,headers:idemHeader,response:{200:adm.BulkVehicleMutationResponseSchema,...errorResponses}})},async request=>response(await inventory.bulk(request.body as adm.BulkVehicleMutationRequest,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('createVehicle',{body:adm.CreateVehicleRequestSchema,headers:idemHeader,response:{201:adm.AdminVehicleResponseSchema,...errorResponses}})},async(request,reply)=>{
    const body=request.body as adm.CreateVehicleRequest;return reply.code(201).send(response(await inventory.create(adm.parseVehicleDraftWrite(body.draft),actor(request),request.headers['idempotency-key'] as string),request));
  });
  app.get('/api/v1/admin/vehicles/:id',{schema:adminSchema('adminGetVehicle',{params:IdParams,querystring:adm.AdminVehicleDetailQuerySchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.getAdmin((request.params as {id:string}).id,(request.query as adm.AdminVehicleDetailQuery).includeDeleted==='true'),request));
  app.patch('/api/v1/admin/vehicles/:id',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('saveVehicle',{params:IdParams,body:adm.SaveVehicleRequestSchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>{
    const body=request.body as adm.SaveVehicleRequest;return response(await inventory.save((request.params as {id:string}).id,body.version,adm.parseVehicleDraftWrite(body.draft),actor(request)),request);
  });
  app.get('/api/v1/admin/vehicles/:id/publish-readiness',{schema:adminSchema('vehiclePublishReadiness',{params:IdParams,querystring:adm.PublicationPreviewQuerySchema,response:{200:adm.PublishReadinessResponseSchema,...errorResponses}})},async request=>response(await inventory.publishReadiness((request.params as {id:string}).id,(request.query as adm.PublicationPreviewQuery).locale,actor(request)),request));
  app.get('/api/v1/admin/vehicles/:id/publication-preview',{schema:adminSchema('vehiclePublicationPreview',{params:IdParams,querystring:adm.PublicationPreviewQuerySchema,response:{200:adm.PublicationPreviewResponseSchema,...errorResponses}})},async request=>response(await inventory.publicationPreview((request.params as {id:string}).id,(request.query as adm.PublicationPreviewQuery).locale,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/publication-preview/confirm',{schema:adminSchema('confirmVehiclePublicationPreview',{params:IdParams,body:adm.ConfirmPublicationPreviewRequestSchema,response:{200:adm.PublishReadinessResponseSchema,...errorResponses}})},async request=>response(await inventory.confirmPublicationPreview((request.params as {id:string}).id,request.body as adm.ConfirmPublicationPreviewRequest,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/publish',{schema:adminSchema('publishVehicle',{params:IdParams,body:adm.PublishVehicleRequestSchema,headers:idemHeader,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.publish((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles/:id/translation-suggestions',{schema:adminSchema('generateVehicleTranslations',{params:IdParams,body:adm.GenerateVehicleTranslationsRequestSchema,headers:idemHeader,response:{200:adm.VehicleTranslationSuggestionsResponseSchema,...errorResponses}})},async request=>response(await inventory.translationSuggestions((request.params as {id:string}).id,(request.body as adm.GenerateVehicleTranslationsRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.get('/api/v1/admin/vehicles/:id/localization',{schema:adminSchema('getVehicleLocalization',{params:IdParams,response:{200:adm.VehicleLocalizationResponseSchema,...errorResponses}})},async request=>response(await inventory.getLocalization((request.params as {id:string}).id),request));
  app.put('/api/v1/admin/vehicles/:id/localization',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('saveVehicleLocalization',{params:IdParams,body:adm.SaveVehicleLocalizationSchema,response:{200:adm.VehicleLocalizationResponseSchema,...errorResponses}})},async request=>response(await inventory.saveLocalization((request.params as {id:string}).id,request.body as adm.SaveVehicleLocalization,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/localization/translation-suggestions',{schema:adminSchema('generateDisplayTranslations',{params:IdParams,body:adm.GenerateDisplayTranslationsSchema,headers:idemHeader,response:{200:adm.DisplayTranslationSuggestionsResponseSchema,...errorResponses}})},async request=>response(await inventory.displayTranslationSuggestions((request.params as {id:string}).id,request.body as adm.GenerateDisplayTranslations,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles/:id/availability',{schema:adminSchema('setAvailability',{params:IdParams,body:adm.AvailabilityRequestSchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.availability((request.params as {id:string}).id,request.body as adm.AvailabilityRequest,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/archive',{schema:adminSchema('archiveVehicle',{params:IdParams,body:adm.ArchiveVehicleRequestSchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.archive((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request)),request));
  app.delete('/api/v1/admin/vehicles/:id',{schema:adminSchema('deleteVehicle',{params:IdParams,body:adm.DeleteVehicleRequestSchema,headers:idemHeader,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.remove((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles/:id/restore',{schema:adminSchema('restoreVehicle',{params:IdParams,body:adm.RestoreVehicleRequestSchema,headers:idemHeader,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.restore((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.get('/api/v1/admin/home/vehicle-sections',{schema:adminSchema('adminHome',{response:{200:adm.AdminHomeSectionsResponseSchema,...errorResponses}})},async request=>response(await inventory.getHome(),request));
  app.put('/api/v1/admin/home/vehicle-sections',{schema:adminSchema('saveHome',{body:adm.SaveHomeSectionsRequestSchema,response:{200:adm.AdminHomeSectionsResponseSchema,...errorResponses}})},async request=>response(await inventory.saveHome(request.body as adm.AdminHomeSections,actor(request)),request));

  app.post('/api/v1/admin/media/uploads',{schema:adminSchema('createUpload',{body:adm.MediaUploadRequestSchema,response:{201:adm.MediaUploadResponseSchema,...errorResponses}})},async(request,reply)=>reply.code(201).send(response(await media.create(request.body as adm.MediaUploadRequest,actor(request)),request)));
  app.get(vehicleMediaUploadsPath,{schema:adminSchema('listRecoverableVehicleUploads',{params:IdParams,response:{200:vehicleMediaUploadsResponse,...errorResponses}})},
    async request=>response(await media.listRecoverableUploads((request.params as {id:string}).id),request));
  app.get('/api/v1/admin/media/:id',{schema:adminSchema('mediaStatus',{params:IdParams,response:{200:adm.MediaAssetResponseSchema,...errorResponses}})},async request=>response(await media.get((request.params as {id:string}).id),request));
  app.addContentTypeParser(['image/jpeg','image/png','image/webp'],{parseAs:'buffer',bodyLimit:10*1024*1024},(_request,body,done)=>done(null,body));
  app.put('/api/v1/admin/media/:id/content',{bodyLimit:10*1024*1024,schema:adminSchema('uploadContent',{params:IdParams,headers:versionHeader,response:{200:adm.MediaAssetResponseSchema,...errorResponses}})},async request=>{
    if(!Buffer.isBuffer(request.body)) throw new ApiError(400,'UNSUPPORTED_MEDIA_TYPE','Upload a binary image body.');
    return response(await media.upload((request.params as {id:string}).id,Number(request.headers['if-match']),request.body,request.headers['content-type']??'',actor(request)),request);
  });
  app.post('/api/v1/admin/media/:id/complete',{schema:adminSchema('completeUpload',{params:IdParams,body:adm.MediaCompleteRequestSchema,response:{200:adm.MediaAssetResponseSchema,...errorResponses}})},async request=>response(await media.complete((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request)),request));
  app.delete('/api/v1/admin/media/:id',{schema:adminSchema('deleteMedia',{params:IdParams,body:adm.MediaDeleteRequestSchema,response:{204:z.undefined(),...errorResponses}})},async(request,reply)=>{
    await media.remove((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request));return reply.code(204).send();
  });
  app.get('/api/v1/admin/media/:id/preview',{schema:adminSchema('previewMedia',{params:IdParams})},async(request,reply)=>{
    const id=(request.params as {id:string}).id;
    // The static handler can return 304 for "*" even with ETag generation off.
    const conditional=['if-none-match','if-match','if-modified-since','if-unmodified-since']
      .some(header=>request.headers[header]!==undefined);
    if(config.mediaDelivery==='nginx'&&!conditional) return sendInternalMedia(reply,await media.previewFile(id));
    return reply.type('image/webp').send(await media.preview(id));
  });
  await app.ready();
  return {app,db,auth,inventory,media,analytics};
}
