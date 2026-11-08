import { z } from 'zod';

export const CONTRACT_VERSION = '0.1.0';
export const LocaleSchema = z.enum(['zh', 'en', 'ru']);
export type Locale = z.infer<typeof LocaleSchema>;
export const LanguageTagSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35);
export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
export const VersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const TimestampSchema = z.iso.datetime({ precision: null });
export const RequestMetaSchema = z.strictObject({ requestId: z.string().min(1).max(200) });

/** ISO 4217 code shape; monetary support does not imply an exchange rate exists. */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
export const MoneySchema = z.strictObject({
  amount: z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

function validDate(value: string, precision: 'year' | 'month' | 'day'): boolean {
  const parts = value.split('-').map(Number);
  const [year, month = 1, day = 1] = parts;
  if (!year || year < 1886 || year > 9999) return false;
  if (precision === 'year') return parts.length === 1;
  if (month < 1 || month > 12) return false;
  if (precision === 'month') return parts.length === 2;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}
export const PartialDateSchema = z.discriminatedUnion('precision', [
  z.strictObject({ precision: z.literal('year'), value: z.string().regex(/^\d{4}$/).refine((v) => validDate(v, 'year'), 'Invalid year') }),
  z.strictObject({ precision: z.literal('month'), value: z.string().regex(/^\d{4}-\d{2}$/).refine((v) => validDate(v, 'month'), 'Invalid month') }),
  z.strictObject({ precision: z.literal('day'), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => validDate(v, 'day'), 'Invalid calendar date') }),
]);
export type PartialDate = z.infer<typeof PartialDateSchema>;

export const AvailabilitySchema = z.enum(['available', 'reserved', 'sold', 'unknown']);
export const PublicationStateSchema = z.enum(['draft', 'published', 'archived']);
export const PowertrainSchema = z.enum(['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev', 'lpg', 'other', 'unknown']);
export const BodySchema = z.enum(['hatchback', 'suv', 'sedan', 'wagon', 'coupe', 'convertible', 'van', 'pickup', 'other', 'unknown']);
export const TransmissionSchema = z.enum(['manual', 'automatic', 'cvt', 'dct', 'other', 'unknown']);
export const NamedValueSchema = z.strictObject({ id: IdSchema, name: z.string().min(1).max(120) });
export const LocationSchema = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/),
  city: z.string().min(1).max(120).nullable(),
  displayName: z.string().min(1).max(200).nullable(),
});
export const VehicleFactsSchema = z.strictObject({
  make: NamedValueSchema.nullable(),
  model: NamedValueSchema.nullable(),
  trim: NamedValueSchema.nullable(),
  modelYear: z.number().int().min(1886).max(9999).nullable(),
  manufacturedAt: PartialDateSchema.nullable(),
  firstRegistration: PartialDateSchema.nullable(),
  registrationStatus: z.enum(['never_registered', 'registered', 'unknown']),
  mileageKm: z.number().int().min(0).max(10_000_000).nullable(),
  powertrain: PowertrainSchema,
  engineCc: z.number().int().min(0).max(100_000).nullable(),
  powerKw: z.number().min(0).max(100_000).nullable(),
  body: BodySchema.nullable(),
  transmission: TransmissionSchema.nullable(),
  location: LocationSchema.nullable(),
});
export type VehicleFacts = z.infer<typeof VehicleFactsSchema>;

const PriceIncludesSchema = z.array(z.string().min(1).max(200)).max(30);
export const PublicPriceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('asking'), money: MoneySchema, includes: PriceIncludesSchema }),
  z.strictObject({ kind: z.literal('reference'), money: MoneySchema, includes: PriceIncludesSchema }),
  z.strictObject({ kind: z.literal('on_request'), money: z.null(), includes: PriceIncludesSchema }),
]);
export type PublicPrice = z.infer<typeof PublicPriceSchema>;

export const TranslationKindSchema = z.enum(['original', 'machine', 'human']);
export const ErrorCodeSchema = z.enum([
  'INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT', 'PAYLOAD_TOO_LARGE', 'PUBLISH_VALIDATION_FAILED',
  'MEDIA_NOT_READY', 'MEDIA_IN_USE', 'UNSUPPORTED_MEDIA_TYPE', 'RATE_LIMITED',
  'SERVICE_UNAVAILABLE', 'UNSUPPORTED_CATALOG', 'INTERNAL_ERROR',
]);
export const FieldErrorSchema = z.strictObject({
  path: z.string().min(1).max(500),
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
});
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1).max(1000),
    fields: z.array(FieldErrorSchema).max(100).optional(),
    retryable: z.boolean(),
  }),
  meta: RequestMetaSchema,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;

/** JSON-compatible validation only: callers retain the authority to project public data. */
export function responseSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, meta: RequestMetaSchema });
}
