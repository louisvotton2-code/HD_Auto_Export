import { z } from 'zod';
import {
  AvailabilitySchema, DemoVehicleFactsSchema, ExternalPlatformSchema, IdSchema, LanguageTagSchema, MoneySchema, NamedValueSchema, PowertrainSchema, PublicationStateSchema,
  PublicPriceSchema, SafeHttpUrlSchema, SearchTextSchema, TimestampSchema, TranslationKindSchema, VehicleFactsSchema,
  VersionSchema, responseSchema,
} from './common.js';

export * from './common.js';

export const LocalizedTextSchema = z.strictObject({
  text: z.string().min(1).max(10_000).regex(/\S/, 'Display text cannot be blank'),
  kind: TranslationKindSchema,
  reviewStatus: z.enum(['pending', 'approved', 'stale']),
  sourceVersion: VersionSchema,
  humanEditVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  engineVersion: z.string().min(1).max(200).nullable(),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
export const TranslatableFieldSchema = z.strictObject({
  sourceLanguage: LanguageTagSchema,
  sourceText: z.string().min(1).max(10_000).nullable(),
  sourceVersion: VersionSchema,
  translations: z.strictObject({
    zh: LocalizedTextSchema.nullable(), en: LocalizedTextSchema.nullable(), ru: LocalizedTextSchema.nullable(),
  }),
});
export type TranslatableField = z.infer<typeof TranslatableFieldSchema>;
export const DraftMediaSchema = z.strictObject({
  id: IdSchema, alt: z.string().max(500), sortOrder: z.number().int().min(0).max(29), isCover: z.boolean(),
});
export type DraftMedia = z.infer<typeof DraftMediaSchema>;
export const ExternalVehicleSourceSchema = z.strictObject({
  kind: z.literal('external'), platform: ExternalPlatformSchema, listingUrl: SafeHttpUrlSchema,
  externalId: z.string().min(1).max(300).regex(/\S/, 'External identity cannot be blank'),
  collectedAt: TimestampSchema, sourceUpdatedAt: TimestampSchema.nullable(),
});
export type ExternalVehicleSource = z.infer<typeof ExternalVehicleSourceSchema>;
export const VehicleDraftSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual') }),
  z.strictObject({ kind: z.literal('demo') }),
  ExternalVehicleSourceSchema,
]);
export type VehicleDraftSource = z.infer<typeof VehicleDraftSourceSchema>;
export const VehicleDraftInputSchema = z.strictObject({
  source: VehicleDraftSourceSchema,
  facts: VehicleFactsSchema,
  price: PublicPriceSchema,
  content: z.strictObject({ title: TranslatableFieldSchema, description: TranslatableFieldSchema }),
  media: z.array(DraftMediaSchema).max(30),
  internal: z.strictObject({
    purchaseCost: MoneySchema.nullable(),
    notes: z.string().min(1).max(10_000).nullable(),
    supplierContact: z.string().min(1).max(1000).nullable(),
    vin: z.string().min(1).max(17).nullable(),
  }),
}).superRefine((value, ctx) => {
  const ids = value.media.map((media) => media.id);
  const positions = value.media.map((media) => media.sortOrder);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['media'], message: 'Duplicate media IDs' });
  if (new Set(positions).size !== positions.length) ctx.addIssue({ code: 'custom', path: ['media'], message: 'Duplicate media positions' });
  if (value.media.filter((media) => media.isCover).length > 1) ctx.addIssue({ code: 'custom', path: ['media'], message: 'Only one cover is allowed' });
  if (value.source.kind === 'demo') {
    const facts = DemoVehicleFactsSchema.safeParse(value.facts);
    if (!facts.success) for (const issue of facts.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['facts', ...issue.path], message: 'Demo vehicles cannot contain physical inventory facts' });
    }
    if (value.price.kind !== 'on_request') ctx.addIssue({ code: 'custom', path: ['price'], message: 'Demo vehicles must use on-request pricing' });
    if (value.internal.vin !== null) ctx.addIssue({ code: 'custom', path: ['internal', 'vin'], message: 'Demo vehicles cannot contain a VIN' });
  }
  if (value.source.kind === 'external' && value.price.kind === 'asking') {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'External vehicles must use reference or on-request pricing' });
  }
});
export type VehicleDraftInput = z.infer<typeof VehicleDraftInputSchema>;

export const AdminVehicleSchema = z.strictObject({
  id: IdSchema, stockCode: z.string().min(1).max(60), version: VersionSchema,
  publicationState: PublicationStateSchema, availability: AvailabilitySchema,
  availabilityCheckedAt: TimestampSchema.nullable(),
  draft: VehicleDraftInputSchema,
  publishedRevisionId: IdSchema.nullable(),
  publishedAt: TimestampSchema.nullable(),
  deletedAt: TimestampSchema.nullable().default(null),
  createdAt: TimestampSchema, updatedAt: TimestampSchema,
});
export type AdminVehicle = z.infer<typeof AdminVehicleSchema>;
export const AdminVehicleResponseSchema = responseSchema(AdminVehicleSchema);
export type AdminVehicleResponse = z.infer<typeof AdminVehicleResponseSchema>;
export const AdminVehicleListSchema = responseSchema(z.strictObject({
  items: z.array(AdminVehicleSchema).max(48), page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(48), total: z.number().int().nonnegative(), hasMore: z.boolean(),
}));
export type AdminVehicleList = z.infer<typeof AdminVehicleListSchema>;
export const AdminVehicleQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().min(1).max(48).default(24),
  publicationState: PublicationStateSchema.optional(), availability: AvailabilitySchema.optional(),
  q: SearchTextSchema.optional(),
  make: IdSchema.optional(), model: IdSchema.optional(), powertrain: PowertrainSchema.optional(),
  deleted: z.enum(['exclude', 'only']).default('exclude'),
});
export type AdminVehicleQuery = z.infer<typeof AdminVehicleQuerySchema>;
export const AdminVehicleDetailQuerySchema = z.strictObject({ includeDeleted: z.enum(['false', 'true']).default('false') });
export type AdminVehicleDetailQuery = z.infer<typeof AdminVehicleDetailQuerySchema>;
export const CreateVehicleRequestSchema = z.strictObject({ draft: VehicleDraftInputSchema });
export const SaveVehicleRequestSchema = z.strictObject({ version: VersionSchema, draft: VehicleDraftInputSchema });
export const VersionRequestSchema = z.strictObject({ version: VersionSchema });
export const PublishVehicleRequestSchema = VersionRequestSchema;
export const ArchiveVehicleRequestSchema = VersionRequestSchema;
export const DeleteVehicleRequestSchema = VersionRequestSchema;
export const RestoreVehicleRequestSchema = VersionRequestSchema;
export const AvailabilityRequestSchema = z.strictObject({ version: VersionSchema, availability: AvailabilitySchema, checkedAt: TimestampSchema });
export type CreateVehicleRequest = z.infer<typeof CreateVehicleRequestSchema>;
export type SaveVehicleRequest = z.infer<typeof SaveVehicleRequestSchema>;
export type VersionRequest = z.infer<typeof VersionRequestSchema>;
export type PublishVehicleRequest = z.infer<typeof PublishVehicleRequestSchema>;
export type ArchiveVehicleRequest = z.infer<typeof ArchiveVehicleRequestSchema>;
export type DeleteVehicleRequest = z.infer<typeof DeleteVehicleRequestSchema>;
export type RestoreVehicleRequest = z.infer<typeof RestoreVehicleRequestSchema>;
export type AvailabilityRequest = z.infer<typeof AvailabilityRequestSchema>;
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);

export const BulkVehicleMutationItemSchema = z.strictObject({
  id: z.uuid(), expectedVersion: VersionSchema,
});
export type BulkVehicleMutationItem = z.infer<typeof BulkVehicleMutationItemSchema>;
const BulkVehicleMutationItemsSchema = z.array(BulkVehicleMutationItemSchema).min(1).max(50).superRefine((items, ctx) => {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const id = item.id.toLowerCase();
    if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Duplicate vehicle IDs are not allowed' });
    seen.add(id);
  }
});
export const BulkVehicleMutationRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('availability'), availability: AvailabilitySchema,
    checkedAt: TimestampSchema, items: BulkVehicleMutationItemsSchema,
  }),
  z.strictObject({ operation: z.literal('archive'), items: BulkVehicleMutationItemsSchema }),
]);
export type BulkVehicleMutationRequest = z.infer<typeof BulkVehicleMutationRequestSchema>;
export const BulkVehicleMutationResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('succeeded'), id: z.uuid(), version: VersionSchema,
    publicationState: PublicationStateSchema, availability: AvailabilitySchema,
    availabilityCheckedAt: TimestampSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal('failed'), id: z.uuid(),
    error: z.strictObject({
      code: z.enum(['NOT_FOUND', 'VERSION_CONFLICT', 'DEMO_RESTRICTION', 'EXTERNAL_RESTRICTION']),
      message: z.string().min(1).max(1000), retryable: z.literal(false),
    }),
  }),
]);
export type BulkVehicleMutationResult = z.infer<typeof BulkVehicleMutationResultSchema>;
export const BulkVehicleMutationResponseSchema = responseSchema(z.strictObject({
  operation: z.enum(['availability', 'archive']),
  results: z.array(BulkVehicleMutationResultSchema).min(1).max(50),
  summary: z.strictObject({
    total: z.number().int().min(1).max(50),
    succeeded: z.number().int().min(0).max(50), failed: z.number().int().min(0).max(50),
  }),
}).superRefine((value, ctx) => {
  const succeeded = value.results.filter((result) => result.status === 'succeeded').length;
  if (value.summary.total !== value.results.length || value.summary.succeeded !== succeeded || value.summary.failed !== value.results.length - succeeded) {
    ctx.addIssue({ code: 'custom', path: ['summary'], message: 'Summary must match the per-vehicle results' });
  }
}));
export type BulkVehicleMutationResponse = z.infer<typeof BulkVehicleMutationResponseSchema>;

export const AdminVehicleFiltersQuerySchema = z.strictObject({ make: IdSchema.optional() });
export type AdminVehicleFiltersQuery = z.infer<typeof AdminVehicleFiltersQuerySchema>;
const AdminVehicleFilterOptionSchema = NamedValueSchema.extend({ count: z.number().int().nonnegative() });
export const AdminVehicleFiltersResponseSchema = responseSchema(z.strictObject({
  scope: z.literal('all_inventory'),
  makes: z.array(AdminVehicleFilterOptionSchema),
  models: z.array(AdminVehicleFilterOptionSchema.extend({ makeId: IdSchema })),
  powertrains: z.array(z.strictObject({ id: PowertrainSchema, count: z.number().int().nonnegative() })),
}));
export type AdminVehicleFiltersResponse = z.infer<typeof AdminVehicleFiltersResponseSchema>;

export const AdminHomeSectionSchema = z.strictObject({
  id: IdSchema,
  title: z.strictObject({
    zh: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'),
    en: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'),
    ru: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'),
  }),
  vehicleIds: z.array(IdSchema).max(30).refine((ids) => new Set(ids.map(id => id.toLowerCase())).size === ids.length, 'Duplicate vehicles in section'),
});
export type AdminHomeSection = z.infer<typeof AdminHomeSectionSchema>;
export const AdminHomeSectionsSchema = z.strictObject({ version: VersionSchema, sections: z.array(AdminHomeSectionSchema).length(2) }).superRefine((value, ctx) => {
  if (new Set(value.sections.map((section) => section.id)).size !== value.sections.length) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Duplicate section IDs' });
});
export const SaveHomeSectionsRequestSchema = AdminHomeSectionsSchema;
export const AdminHomeSectionsResponseSchema = responseSchema(AdminHomeSectionsSchema);
export type AdminHomeSections = z.infer<typeof AdminHomeSectionsSchema>;
export type SaveHomeSectionsRequest = z.infer<typeof SaveHomeSectionsRequestSchema>;

export const MediaContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const MediaStatusSchema = z.enum(['pending', 'uploaded', 'ready', 'failed', 'deleted']);
export type MediaContentType = z.infer<typeof MediaContentTypeSchema>;
export type MediaStatus = z.infer<typeof MediaStatusSchema>;
export const MediaSourceSchema = z.strictObject({
  listingUrl: SafeHttpUrlSchema, imageUrl: SafeHttpUrlSchema, collectedAt: TimestampSchema,
});
export type MediaSource = z.infer<typeof MediaSourceSchema>;
export const MediaRightsSchema = z.strictObject({
  basis: z.enum(['owned', 'permission', 'unverified']),
  note: z.string().min(1).max(500).regex(/\S/, 'Image rights declaration cannot be blank'),
  source: MediaSourceSchema.optional(),
});
export type MediaRights = z.infer<typeof MediaRightsSchema>;
export const MediaAssetSchema = z.strictObject({
  id: IdSchema, vehicleId: IdSchema, version: VersionSchema, status: MediaStatusSchema,
  contentType: MediaContentTypeSchema,
  rights: MediaRightsSchema,
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  width: z.number().int().positive().max(100_000).nullable(),
  height: z.number().int().positive().max(100_000).nullable(),
  previewPath: z.string().regex(/^\/api\/v1\/admin\/media\/[A-Za-z0-9_-]+\/preview$/).nullable(),
  createdAt: TimestampSchema,
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export const MediaAssetResponseSchema = responseSchema(MediaAssetSchema);
export type MediaAssetResponse = z.infer<typeof MediaAssetResponseSchema>;
export const MediaUploadRequestSchema = z.strictObject({
  vehicleId: IdSchema,
  filename: z.string().min(1).max(255).regex(/^[^/\\\u0000-\u001f]+$/).optional(),
  contentType: MediaContentTypeSchema,
  rights: MediaRightsSchema,
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
});
export const MediaUploadResponseSchema = responseSchema(z.strictObject({
  media: MediaAssetSchema,
  method: z.literal('PUT'),
  uploadUrl: z.string().regex(/^\/api\/v1\/admin\/media\/[A-Za-z0-9_-]+\/content$/),
  expiresAt: TimestampSchema,
}));
export const MediaCompleteRequestSchema = VersionRequestSchema;
export const MediaDeleteRequestSchema = VersionRequestSchema;
export type MediaUploadRequest = z.infer<typeof MediaUploadRequestSchema>;
export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;
export type MediaCompleteRequest = z.infer<typeof MediaCompleteRequestSchema>;
export type MediaDeleteRequest = z.infer<typeof MediaDeleteRequestSchema>;

export const StaffRoleSchema = z.enum(['admin', 'editor']);
export const StaffPermissionSchema = z.enum(['vehicles:read', 'vehicles:write', 'vehicles:publish', 'media:write', 'home:write', 'staff:manage']);
export type StaffRole = z.infer<typeof StaffRoleSchema>;
export type StaffPermission = z.infer<typeof StaffPermissionSchema>;
export const StaffMeSchema = z.strictObject({ id: IdSchema, name: z.string().min(1).max(200), role: StaffRoleSchema, permissions: z.array(StaffPermissionSchema) });
export const StaffMeResponseSchema = responseSchema(StaffMeSchema);
export type StaffMe = z.infer<typeof StaffMeSchema>;
export type StaffMeResponse = z.infer<typeof StaffMeResponseSchema>;
