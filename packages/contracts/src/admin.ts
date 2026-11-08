import { z } from 'zod';
import {
  AvailabilitySchema, IdSchema, LanguageTagSchema, MoneySchema, PublicationStateSchema,
  PublicPriceSchema, TimestampSchema, TranslationKindSchema, VehicleFactsSchema,
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
export const VehicleDraftInputSchema = z.strictObject({
  source: z.strictObject({ kind: z.literal('manual') }),
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
});
export type VehicleDraftInput = z.infer<typeof VehicleDraftInputSchema>;

export const AdminVehicleSchema = z.strictObject({
  id: IdSchema, stockCode: z.string().min(1).max(60), version: VersionSchema,
  publicationState: PublicationStateSchema, availability: AvailabilitySchema,
  availabilityCheckedAt: TimestampSchema.nullable(),
  draft: VehicleDraftInputSchema,
  publishedRevisionId: IdSchema.nullable(),
  publishedAt: TimestampSchema.nullable(),
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
});
export type AdminVehicleQuery = z.infer<typeof AdminVehicleQuerySchema>;
export const CreateVehicleRequestSchema = z.strictObject({ draft: VehicleDraftInputSchema });
export const SaveVehicleRequestSchema = z.strictObject({ version: VersionSchema, draft: VehicleDraftInputSchema });
export const VersionRequestSchema = z.strictObject({ version: VersionSchema });
export const PublishVehicleRequestSchema = VersionRequestSchema;
export const ArchiveVehicleRequestSchema = VersionRequestSchema;
export const AvailabilityRequestSchema = z.strictObject({ version: VersionSchema, availability: AvailabilitySchema, checkedAt: TimestampSchema });
export type CreateVehicleRequest = z.infer<typeof CreateVehicleRequestSchema>;
export type SaveVehicleRequest = z.infer<typeof SaveVehicleRequestSchema>;
export type VersionRequest = z.infer<typeof VersionRequestSchema>;
export type PublishVehicleRequest = z.infer<typeof PublishVehicleRequestSchema>;
export type ArchiveVehicleRequest = z.infer<typeof ArchiveVehicleRequestSchema>;
export type AvailabilityRequest = z.infer<typeof AvailabilityRequestSchema>;
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);

export const AdminHomeSectionSchema = z.strictObject({
  id: IdSchema,
  title: z.strictObject({
    zh: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'),
    en: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'),
    ru: z.string().min(1).max(120).regex(/\S/, 'Section title cannot be blank'),
  }),
  vehicleIds: z.array(IdSchema).max(30).refine((ids) => new Set(ids).size === ids.length, 'Duplicate vehicles in section'),
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
export const MediaRightsSchema = z.strictObject({
  basis: z.enum(['owned', 'permission']),
  note: z.string().min(1).max(500).regex(/\S/, 'Image rights declaration cannot be blank'),
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
