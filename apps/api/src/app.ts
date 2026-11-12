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
import { createAuth, authHeaders, requireStaff, requireTrustedOrigin } from './auth.js';
import { InventoryService, type Actor } from './vehicles/service.js';
import { MediaService } from './media/service.js';
import { LocalMediaStore, MediaStorageError } from './media/storage.js';
import { ApiError, notFound } from './errors.js';
import { createVehicleTranslator, type VehicleTranslator } from './vehicles/translation.js';
import { externalBatchPath, externalBulkVisibilityPath, externalMediaFailurePath, externalOverridesPath, externalTrialPath, registerExternalRoutes } from './external/routes.js';
import { createPublicCatalogCache, type PublicCacheRoute } from './external/public-cache.js';

const IdParams=z.strictObject({id:z.uuid()});
const versionHeader=z.object({'if-match':z.string().regex(/^\d+$/)});
const idemHeader=z.object({'idempotency-key':adm.IdempotencyKeySchema});
// Full drafts include two source fields, six translations and bounded private/media metadata.
// Allow their UTF-8/JSON-escaped encoding without raising the limits of small mutations.
const vehicleDraftBodyLimit=1024*1024;
const errorResponses=Object.fromEntries([400,401,403,404,409,413,422,429,500,503].map(code=>[code,pub.ApiErrorSchema]));
const schema=(tag:string,operationId:string,options:Record<string,unknown>)=>({tags:[tag],operationId,...options});

function rateLimitKey(request:FastifyRequest) {
  const route=request.routeOptions.url??'';
  const upload=request.method==='PUT'&&route==='/api/v1/admin/media/:id/content' ||
    request.method==='POST'&&['/api/v1/admin/media/uploads','/api/v1/admin/media/:id/complete'].includes(route);
  const translate=request.method==='POST'&&['/api/v1/admin/vehicles/:id/translation-suggestions',
    '/api/v1/admin/vehicles/:id/localization/translation-suggestions'].includes(route);
  // Matched route families, never a caller-supplied ID/query/header, select the budget.
  const bucket=route===externalMediaFailurePath?'external-media-report':
    request.method==='POST'&&route===externalBatchPath?'external-import':request.method==='POST'&&route===externalTrialPath?'external-trial':
    upload?'admin-upload':translate?'admin-translation':
    route==='/api/v1/media/:id'?'public-media':
    route.startsWith('/api/v1/admin/')?'admin':route.startsWith('/health/')?'health':
      route.startsWith('/api/auth/')?'auth':'public-json';
  // Retain the plugin's IPv4-mapped and IPv6 /64 normalization with our custom key.
  return `${bucket}:${normalizeIP(request.ip)}`;
}

function sendInternalMedia(reply:FastifyReply,file:{filename:string}) {
  // Only a store-prepared UUID and fixed derivative can become an internal URI.
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.thumb)?\.webp$/.test(file.filename)) {
    throw new MediaStorageError('MEDIA_STORAGE_ERROR','The media delivery target is invalid.');
  }
  return reply.type('image/webp').header('X-Accel-Redirect',`/_hd_media/${file.filename}`)
    .header('X-Accel-Expires','0').send();
}

const capacityRoutes = new Set<string>(['/api/v1/vehicles','/api/v1/vehicle-filters','/api/v1/vehicles/:id','/api/v1/home/vehicles']);

export async function buildApp(config:Config=readConfig(), options:{
  logger?:boolean;translator?:VehicleTranslator;onPublicFailure?:(event:PublicFailureDiagnostic)=>void;
}={}) {
  const db=createDatabase(config.databaseUrl,config.poolMax,Boolean(options.onPublicFailure));
  let catalogCache;
  try { catalogCache = config.publicCache ? await createPublicCatalogCache(db, {
    ...config.publicCache, maxConcurrentRevisionReads: config.externalScale ? 128 : 32,
  }) : null; }
  catch (error) { await db.close(); throw error; }
  const auth=createAuth(db,config);
  const loginAccounts=new LoginAccountLimiter(config.authSecret);
  const mediaStore=new LocalMediaStore(config.mediaRoot);
  const inventory=new InventoryService(db,config.externalCatalog,mediaStore);
  const translator=options.translator??createVehicleTranslator(config.translation);
  const media=new MediaService(db,mediaStore);
  const app=Fastify({logger: options.logger ? {redact:['req.headers.cookie','req.headers.authorization','req.body','res.headers.set-cookie']} : false,
    genReqId:()=>randomUUID(),requestIdHeader:false,bodyLimit:100_000,requestTimeout:30_000,trustProxy:config.trustProxy,
    logController:new LogController({disableRequestLogging:true})}).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger,{openapi:{openapi:'3.0.3',info:{title:'HD Auto API',version:pub.CONTRACT_VERSION},
    components:{securitySchemes:{staffSession:{type:'apiKey',in:'cookie',name:config.environment==='production'?'__Secure-hd-auto.session_token':'hd-auto.session_token'}}}},transform:jsonSchemaTransform});
  await app.register(rateLimit,{max:(_request,key)=>key.startsWith('admin-translation:')?20:120,timeWindow:60_000,
    keyGenerator:rateLimitKey,errorResponseBuilder:()=>({statusCode:429,code:'RATE_LIMITED',message:'Request rate exceeded.'})});
  const staff=new WeakMap<object,adm.StaffMe>();
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('X-Request-Id',request.id);
    // Only Fastify's explicitly trusted peers may supply forwarding metadata.
    // Reject malformed resolved identities before they reach auth or business handlers.
    if(!isIP(request.ip) || request.ip.includes('%')) throw new ApiError(400,'INVALID_REQUEST','Client address is invalid.');
  });
  // Route onRequest rate limits run before authentication; preParsing keeps
  // unauthenticated uploads from being read or decoded before access checks.
  app.addHook('preParsing',async(request,_reply,payload)=>{
    // Use the matched route, not the raw URL (which may contain encoded static segments).
    const route=request.routeOptions.url??'';
    const external=route.startsWith('/api/v1/admin/external/') || route===externalMediaFailurePath;
    if(external&&!config.externalCatalog) throw notFound();
    if(route.startsWith('/api/v1/admin/')) {
      const member=await requireStaff(request,auth,db);
      staff.set(request,member);
      requireTrustedOrigin(request,config);
      if(external && !member.permissions.includes('vehicles:read')) {
        throw new ApiError(403,'FORBIDDEN','Vehicle read permission is required.');
      }
      const changesExternalListing = request.method==='PUT' && route===externalOverridesPath ||
        request.method==='POST' && route===externalBulkVisibilityPath;
      if(changesExternalListing && !member.permissions.includes('vehicles:write')) {
        throw new ApiError(403,'FORBIDDEN','Vehicle write permission is required.');
      }
      if(external && member.role!=='admin' && (route.endsWith('/raw') || request.method==='POST' && [externalBatchPath,externalTrialPath].includes(route))) {
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
    app.log.info({requestId:request.id,method:request.method,route:request.routeOptions.url,statusCode:reply.statusCode,elapsedMs:reply.elapsedTime},'Request completed');
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
    if(problem.status>=500) app.log.error({requestId:request.id,errorCode:detail.code??detail.name},'Request failed');
    // The limiter already supplies the rounded-up remaining window. Preserve it;
    // only an otherwise unspecified 429 falls back to our full 60-second window.
    if(problem.status===429 && !reply.hasHeader('Retry-After')) reply.header('Retry-After','60');
    if(problem.status===503) reply.header('Retry-After','5');
    return reply.code(problem.status).send({error:{code:problem.code,message:problem.message,...(problem.fields?{fields:problem.fields}:{}),retryable:problem.retryable},meta:{requestId:request.id}});
  });
  app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'Resource is not available.',retryable:false},meta:{requestId:request.id}}));
  app.addHook('onClose',async()=>{try{await catalogCache?.close();}finally{await db.close();}});
  const actor=(request:{id:string}):Actor=>({id:staff.get(request)!.id,requestId:request.id});
  const response=<T>(data:T,request:{id:string})=>({data,meta:{requestId:request.id}});
  const cached=<T,Q extends {priceView?:'usd'}>(route:PublicCacheRoute,query:Q,load:()=>Promise<T>)=>
    catalogCache ? catalogCache.get(route,query,load,query.priceView==='usd') : load();

  app.get('/health/live',{schema:schema('health','liveness',{response:{200:z.object({status:z.literal('ok')})}})},async()=>({status:'ok' as const}));
  if(config.externalScale) app.get('/health/catalog-cache',{schema:{hide:true}},async()=>({enabled:!!catalogCache,metrics:catalogCache?.metrics()??null}));
  app.get('/health/ready',{schema:schema('health','readiness',{response:{200:z.object({status:z.literal('ready')}),503:z.object({status:z.literal('unavailable')})}})},async(_request,reply)=>{
    try {
      const ready=await db.pool.query(`SELECT h.id,v.deleted_at,v.public_content_revision,l.revision,pl.projections,im.receipt_hash,fx.version,pc.fingerprint FROM home_config h
        LEFT JOIN vehicles v ON false LEFT JOIN vehicle_localizations l ON false LEFT JOIN publication_localizations pl ON false
        LEFT JOIN idempotency_vehicle_metadata im ON false LEFT JOIN public_fx_quote fx ON false
        LEFT JOIN publication_preview_confirmations pc ON false WHERE h.id=1`);
      if(ready.rowCount!==1) throw new Error('Required initial data is unavailable');
      if(config.externalCatalog) {
        const externalReady=await db.pool.query(`SELECT state.revision,f.locale_mask,o.text_source_identities FROM external_catalog_state state
          JOIN public_catalog_state s ON s.id=state.id
          LEFT JOIN external_catalog c ON false LEFT JOIN external_catalog_search x ON false LEFT JOIN external_catalog_filter f ON false
          LEFT JOIN external_media m ON false LEFT JOIN external_translation_trials t ON false
          LEFT JOIN external_listing_overrides o ON false WHERE state.id=1`);
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
    if(request.method==='POST'&&path==='/api/auth/sign-in/email') {
      const retryAfter=loginAccounts.retryAfter((request.body as {email?:unknown}|null)?.email);
      if(retryAfter!==null) {
        reply.header('Retry-After',String(retryAfter));
        throw new ApiError(429,'RATE_LIMITED','Request rate exceeded.',undefined,true);
      }
    }
    const headers=authHeaders(request);
    const result=await auth.handler(new Request(`${config.authBaseUrl}${request.url}`,{method:request.method,headers,
      ...(request.method==='POST'?{body:JSON.stringify(request.body??{})}:{})}));
    for(const [key,value] of result.headers) if(key!=='set-cookie'&&key!=='cache-control') reply.header(key,value);
    const cookies=result.headers.getSetCookie();if(cookies.length) reply.header('set-cookie',cookies);
    return reply.code(result.status).send(await result.text());
  }});

  app.get('/api/v1/vehicles',{schema:schema('public','listVehicles',{querystring:pub.PublicVehicleQuerySchema,response:{200:pub.PublicVehicleListSchema,...errorResponses}})},
    async request=>{
      const query=request.query as pub.PublicVehicleQuery;
      const loaded=await cached('list',query,async()=>{
        const {data,meta:{requestId:_,...meta}}=await inventory.listPublic(query,request.id);
        return {data,meta};
      });
      return {...loaded,meta:{...loaded.meta,requestId:request.id}};
    });
  app.get('/api/v1/vehicles/:id',{schema:schema('public','getVehicle',{params:z.strictObject({id:z.union([z.uuid(),pub.ExternalListingIdSchema])}),querystring:pub.PublicLocaleQuerySchema,response:{200:pub.PublicVehicleResponseSchema,...errorResponses}})},
    async request=>{const p=request.params as {id:string};const q=request.query as pub.PublicLocaleQuery;return response(await cached('detail',{id:p.id,...q},()=>inventory.getPublic(p.id,q.locale,q.view,q.priceView)),request);});
  app.get('/api/v1/vehicle-filters',{schema:schema('public','vehicleFilters',{querystring:pub.PublicFilterQuerySchema,response:{200:pub.PublicVehicleFiltersSchema,...errorResponses}})},async request=>{
    const query=request.query as pub.PublicFilterQuery;return response(await cached('filters',query,()=>inventory.filters(query)),request);
  });
  app.get('/api/v1/home/vehicles',{schema:schema('public','homeVehicles',{querystring:pub.PublicLocaleQuerySchema,response:{200:pub.PublicHomeSectionsSchema,...errorResponses}})},async request=>{
    const query=request.query as pub.PublicLocaleQuery;return response(await cached('home',query,()=>inventory.publicHome(query.locale,query.view,query.priceView)),request);
  });
  app.get('/api/v1/media/:id',{schema:schema('public','publicMedia',{params:IdParams,querystring:pub.PublicMediaQuerySchema})},async(request,reply)=>{
    const id=(request.params as {id:string}).id;const variant=(request.query as pub.PublicMediaQuery).variant;
    if(config.mediaDelivery==='nginx') return sendInternalMedia(reply,await media.publicFile(id,variant));
    return reply.type('image/webp').send(await media.publicRead(id,variant));
  });

  const adminSchema=(operationId:string,options:Record<string,unknown>)=>schema('admin',operationId,{security:[{staffSession:[]}],...options});
  registerExternalRoutes(app,db,actor,config.providerAccountKey);
  app.get('/api/v1/admin/me',{schema:adminSchema('staffMe',{response:{200:adm.StaffMeResponseSchema,...errorResponses}})},async request=>response(staff.get(request),request));
  app.get('/api/v1/admin/vehicles',{schema:adminSchema('adminListVehicles',{querystring:adm.AdminVehicleQuerySchema,response:{200:adm.AdminVehicleListSchema,...errorResponses}})},async request=>response(await inventory.listAdmin(request.query as z.infer<typeof adm.AdminVehicleQuerySchema>),request));
  app.get('/api/v1/admin/vehicle-filters',{schema:adminSchema('adminVehicleFilters',{querystring:adm.AdminVehicleFiltersQuerySchema,response:{200:adm.AdminVehicleFiltersResponseSchema,...errorResponses}})},async request=>response(await inventory.adminFilters(request.query as adm.AdminVehicleFiltersQuery),request));
  app.post('/api/v1/admin/vehicles/bulk',{schema:adminSchema('bulkVehicleMutation',{body:adm.BulkVehicleMutationRequestSchema,headers:idemHeader,response:{200:adm.BulkVehicleMutationResponseSchema,...errorResponses}})},async request=>response(await inventory.bulk(request.body as adm.BulkVehicleMutationRequest,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('createVehicle',{body:adm.CreateVehicleRequestSchema,headers:idemHeader,response:{201:adm.AdminVehicleResponseSchema,...errorResponses}})},async(request,reply)=>{
    const body=request.body as adm.CreateVehicleRequest;return reply.code(201).send(response(await inventory.create(body.draft,actor(request),request.headers['idempotency-key'] as string),request));
  });
  app.get('/api/v1/admin/vehicles/:id',{schema:adminSchema('adminGetVehicle',{params:IdParams,querystring:adm.AdminVehicleDetailQuerySchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.getAdmin((request.params as {id:string}).id,(request.query as adm.AdminVehicleDetailQuery).includeDeleted==='true'),request));
  app.patch('/api/v1/admin/vehicles/:id',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('saveVehicle',{params:IdParams,body:adm.SaveVehicleRequestSchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>{
    const body=request.body as adm.SaveVehicleRequest;return response(await inventory.save((request.params as {id:string}).id,body.version,body.draft,actor(request)),request);
  });
  app.get('/api/v1/admin/vehicles/:id/publish-readiness',{schema:adminSchema('vehiclePublishReadiness',{params:IdParams,querystring:adm.PublicationPreviewQuerySchema,response:{200:adm.PublishReadinessResponseSchema,...errorResponses}})},async request=>response(await inventory.publishReadiness((request.params as {id:string}).id,(request.query as adm.PublicationPreviewQuery).locale,actor(request)),request));
  app.get('/api/v1/admin/vehicles/:id/publication-preview',{schema:adminSchema('vehiclePublicationPreview',{params:IdParams,querystring:adm.PublicationPreviewQuerySchema,response:{200:adm.PublicationPreviewResponseSchema,...errorResponses}})},async request=>response(await inventory.publicationPreview((request.params as {id:string}).id,(request.query as adm.PublicationPreviewQuery).locale,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/publication-preview/confirm',{schema:adminSchema('confirmVehiclePublicationPreview',{params:IdParams,body:adm.ConfirmPublicationPreviewRequestSchema,response:{200:adm.PublishReadinessResponseSchema,...errorResponses}})},async request=>response(await inventory.confirmPublicationPreview((request.params as {id:string}).id,request.body as adm.ConfirmPublicationPreviewRequest,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/publish',{schema:adminSchema('publishVehicle',{params:IdParams,body:adm.PublishVehicleRequestSchema,headers:idemHeader,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.publish((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles/:id/translation-suggestions',{schema:adminSchema('generateVehicleTranslations',{params:IdParams,body:adm.GenerateVehicleTranslationsRequestSchema,headers:idemHeader,response:{200:adm.VehicleTranslationSuggestionsResponseSchema,...errorResponses}})},async request=>response(await inventory.translationSuggestions((request.params as {id:string}).id,(request.body as adm.GenerateVehicleTranslationsRequest).version,actor(request),request.headers['idempotency-key'] as string,translator),request));
  app.get('/api/v1/admin/vehicles/:id/localization',{schema:adminSchema('getVehicleLocalization',{params:IdParams,response:{200:adm.VehicleLocalizationResponseSchema,...errorResponses}})},async request=>response(await inventory.getLocalization((request.params as {id:string}).id),request));
  app.put('/api/v1/admin/vehicles/:id/localization',{bodyLimit:vehicleDraftBodyLimit,schema:adminSchema('saveVehicleLocalization',{params:IdParams,body:adm.SaveVehicleLocalizationSchema,response:{200:adm.VehicleLocalizationResponseSchema,...errorResponses}})},async request=>response(await inventory.saveLocalization((request.params as {id:string}).id,request.body as adm.SaveVehicleLocalization,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/localization/translation-suggestions',{schema:adminSchema('generateDisplayTranslations',{params:IdParams,body:adm.GenerateDisplayTranslationsSchema,headers:idemHeader,response:{200:adm.DisplayTranslationSuggestionsResponseSchema,...errorResponses}})},async request=>response(await inventory.displayTranslationSuggestions((request.params as {id:string}).id,request.body as adm.GenerateDisplayTranslations,actor(request),request.headers['idempotency-key'] as string,translator),request));
  app.post('/api/v1/admin/vehicles/:id/availability',{schema:adminSchema('setAvailability',{params:IdParams,body:adm.AvailabilityRequestSchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.availability((request.params as {id:string}).id,request.body as adm.AvailabilityRequest,actor(request)),request));
  app.post('/api/v1/admin/vehicles/:id/archive',{schema:adminSchema('archiveVehicle',{params:IdParams,body:adm.ArchiveVehicleRequestSchema,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.archive((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request)),request));
  app.delete('/api/v1/admin/vehicles/:id',{schema:adminSchema('deleteVehicle',{params:IdParams,body:adm.DeleteVehicleRequestSchema,headers:idemHeader,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.remove((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.post('/api/v1/admin/vehicles/:id/restore',{schema:adminSchema('restoreVehicle',{params:IdParams,body:adm.RestoreVehicleRequestSchema,headers:idemHeader,response:{200:adm.AdminVehicleResponseSchema,...errorResponses}})},async request=>response(await inventory.restore((request.params as {id:string}).id,(request.body as adm.VersionRequest).version,actor(request),request.headers['idempotency-key'] as string),request));
  app.get('/api/v1/admin/home/vehicle-sections',{schema:adminSchema('adminHome',{response:{200:adm.AdminHomeSectionsResponseSchema,...errorResponses}})},async request=>response(await inventory.getHome(),request));
  app.put('/api/v1/admin/home/vehicle-sections',{schema:adminSchema('saveHome',{body:adm.SaveHomeSectionsRequestSchema,response:{200:adm.AdminHomeSectionsResponseSchema,...errorResponses}})},async request=>response(await inventory.saveHome(request.body as adm.AdminHomeSections,actor(request)),request));

  app.post('/api/v1/admin/media/uploads',{schema:adminSchema('createUpload',{body:adm.MediaUploadRequestSchema,response:{201:adm.MediaUploadResponseSchema,...errorResponses}})},async(request,reply)=>reply.code(201).send(response(await media.create(request.body as adm.MediaUploadRequest,actor(request)),request)));
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
    if(config.mediaDelivery==='nginx') return sendInternalMedia(reply,await media.previewFile(id));
    return reply.type('image/webp').send(await media.preview(id));
  });
  await app.ready();
  return {app,db,auth,inventory,media};
}
