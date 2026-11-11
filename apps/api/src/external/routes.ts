import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as admin from '@hd/contracts/admin';
import * as publicApi from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { notFound } from '../errors.js';
import type { Actor } from '../vehicles/service.js';
import { reportMediaFailure } from './catalog.js';
import { getExternalListingOverview, listExternalListings } from './listings.js';
import { createProviderProbe } from './provider-probe.js';
import { ExternalStore } from './store.js';
import { createTrial, getTrial } from './trial.js';

const prefix = '/api/v1/admin/external';
const batch = `${prefix}/batches`;
const batchId = z.strictObject({ id: z.uuid() });
const listingId = z.strictObject({ id: publicApi.ExternalListingIdSchema });
const recordParams = batchId.extend({ row: z.string().regex(/^[1-9]\d{0,2}$/).refine(value => Number(value) <= 250) });
const idem = z.object({ 'idempotency-key': admin.IdempotencyKeySchema });
export const externalMediaFailurePath = '/api/v1/external-media/:id/failure';
export const externalBatchPath = batch;
export const externalOverridesPath = `${prefix}/listings/:id/overrides`;
export const externalBulkVisibilityPath = `${prefix}/listings/bulk-visibility`;
export const externalTrialPath = `${batch}/:id/translation-trial`;
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 422, 429, 500, 503].map(code => [code, publicApi.ApiErrorSchema]));
const schema = (operationId: string, response: z.ZodType, options: Record<string, unknown> = {}, status = 200) => ({
  operationId, tags: ['admin', 'external-catalog'], security: [{ staffSession: [] }], ...options, response: { [status]: response, ...errors },
});
const result = <T>(data: T, request: FastifyRequest) => ({ data, meta: { requestId: request.id } });
const pathId = (request: FastifyRequest) => (request.params as { id: string }).id;
const key = (request: FastifyRequest) => request.headers['idempotency-key'] as string;
const page = (request: FastifyRequest) => request.query as admin.ExternalAdminPageQuery;
const row = (request: FastifyRequest) => Number((request.params as { row: string }).row);

export function registerExternalRoutes(app: FastifyInstance, db: Database, actor: (request: FastifyRequest) => Actor, providerAccountKey?: string) {
  const store = new ExternalStore(db);
  const checkAccount = createProviderProbe(providerAccountKey);
  app.get(`${prefix}/status`, { schema: schema('getExternalStatus', admin.ExternalStatusResponseSchema) },
    async request => result(await store.status(), request));
  app.get(`${prefix}/provider-status`, { schema: schema('getExternalProviderStatus', admin.ExternalProviderStatusResponseSchema) },
    async request => {
      const local = await store.providerStatus();
      return result({ ...local, account: await checkAccount() }, request);
    });
  app.get(`${prefix}/listings`, { schema: schema('listExternalListings', admin.ExternalListingListResponseSchema,
    { querystring: admin.ExternalListingListQuerySchema }) },
  async request => result(await listExternalListings(db, request.query as admin.ExternalListingListQuery), request));
  app.get(`${prefix}/listings/overview`, { schema: schema('getExternalListingOverview', admin.ExternalListingOverviewResponseSchema,
    { querystring: admin.ExternalListingOverviewQuerySchema }) },
  async request => result(await getExternalListingOverview(db, (request.query as { make?: string }).make), request));
  app.get(batch, { schema: schema('listExternalBatches', admin.ExternalBatchListResponseSchema, { querystring: admin.ExternalAdminPageQuerySchema }) },
    async request => result(await store.listBatches(page(request)), request));
  app.post(batch, { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 6, timeWindow: 60_000 } },
    schema: schema('importExternalBatch', admin.ExternalBatchResponseSchema, { headers: idem, body: admin.ExternalImportBatchRequestSchema }, 201) },
  async (request, reply) => reply.code(201).send(result(await store.importBatch(request.body as admin.ExternalImportBatchRequest, key(request), actor(request)), request)));
  app.get(`${batch}/:id`, { schema: schema('getExternalBatch', admin.ExternalBatchResponseSchema, { params: batchId }) },
    async request => result(await store.getBatch(pathId(request)), request));
  app.get(`${batch}/:id/records`, { schema: schema('listExternalBatchRecords', admin.ExternalBatchRecordsResponseSchema,
    { params: batchId, querystring: admin.ExternalAdminPageQuerySchema }) },
  async request => result(await store.listRecords(pathId(request), page(request)), request));
  app.get(`${batch}/:id/records/:row`, { schema: schema('getExternalBatchRecord', admin.ExternalBatchRecordResponseSchema, { params: recordParams }) },
    async request => result(await store.getRecord(pathId(request), row(request)), request));
  app.get(`${batch}/:id/records/:row/raw`, { schema: schema('getExternalBatchRawRecord', admin.ExternalRawRecordResponseSchema, { params: recordParams }) },
    async request => result(await store.getRaw(pathId(request), row(request)), request));
  app.get(externalTrialPath, { schema: schema('getExternalTranslationTrial', admin.ExternalTrialResponseSchema, { params: batchId }) },
    async request => result(await getTrial(db, pathId(request)), request));
  app.post(externalTrialPath, { config: { rateLimit: { max: 6, timeWindow: 60_000 } },
    schema: schema('createExternalTranslationTrial', admin.ExternalTrialResponseSchema, { params: batchId, body: admin.ExternalTrialRequestSchema }, 201) },
  async (request, reply) => reply.code(201).send(result(await createTrial(db, pathId(request), request.body as admin.ExternalTrialRequest, actor(request)), request)));
  app.get(`${prefix}/listings/:id`, { schema: schema('getExternalListing', admin.ExternalListingResponseSchema,
    { params: listingId, querystring: admin.ExternalListingQuerySchema }) },
  async request => result(await store.getListing(pathId(request), (request.query as z.infer<typeof admin.ExternalListingQuerySchema>).locale), request));
  app.put(externalOverridesPath, { schema: schema('saveExternalListingOverrides', admin.ExternalOverrideResponseSchema,
    { params: listingId, body: admin.SaveExternalOverridesSchema, headers: idem }) },
  async request => result(await store.saveOverrides(pathId(request), request.body as admin.SaveExternalOverrides, key(request), actor(request)), request));
  app.post(externalBulkVisibilityPath, { schema: schema('bulkExternalListingVisibility', admin.ExternalBulkVisibilityResponseSchema,
    { body: admin.ExternalBulkVisibilityRequestSchema, headers: idem }) },
  async request => result(await store.bulkVisibility(request.body as admin.ExternalBulkVisibilityRequest, key(request), actor(request)), request));
  app.post(externalMediaFailurePath, { bodyLimit: 1000, config: { rateLimit: { max: 15, timeWindow: 60_000 } }, schema: {
    operationId: 'reportExternalMediaFailure', tags: ['public'], params: z.strictObject({ id: publicApi.ExternalMediaIdSchema }),
    body: publicApi.ExternalMediaFailureRequestSchema, response: { 202: publicApi.ExternalMediaFailureResponseSchema, ...errors },
  } }, async (request, reply) => {
    const { revision } = request.body as z.infer<typeof publicApi.ExternalMediaFailureRequestSchema>;
    const { found, queued } = await reportMediaFailure(db, pathId(request).slice(5), revision);
    if (!found) throw notFound();
    return reply.code(202).send(result({ queued }, request));
  });
}
