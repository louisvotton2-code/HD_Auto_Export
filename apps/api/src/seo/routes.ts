import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiErrorSchema, PublicSeoManifestResponseSchema, PublicSeoQuerySchema } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { seoManifest } from './service.js';
export function registerSeoRoutes(app: FastifyInstance, db: Database, enabled: boolean, externalEnabled=true) {
 // Per-process, fail-fast lane: no queue behind a generation and no visitor DB connection budget.
 let busy=false;
 app.withTypeProvider<ZodTypeProvider>().get('/api/v1/seo/vehicles',{
  schema:{operationId:'getSeoVehicleManifest',tags:['public'],querystring:PublicSeoQuerySchema,
   response:{200:PublicSeoManifestResponseSchema,400:ApiErrorSchema,409:ApiErrorSchema,503:ApiErrorSchema}},
 },async(request,reply)=>{
  reply.header('cache-control','no-store');
  if(busy)throw new ApiError(503,'SERVICE_UNAVAILABLE','SEO generation is busy; retry later.',undefined,true);
  busy=true;
  try {
   const data=await seoManifest(db,request.query,enabled,new Date(),externalEnabled);
   if(data.validUntil!==null&&Date.parse(data.validUntil)<=Date.now())throw new ApiError(503,'SERVICE_UNAVAILABLE','SEO eligibility expired during generation; retry.',undefined,true);
   return {data,meta:{requestId:request.id}};
  }
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'SERVICE_UNAVAILABLE','SEO catalog is temporarily unavailable.',undefined,true);}
  finally{busy=false;}
 });
}
