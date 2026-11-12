import { z } from 'zod';
import { TimestampSchema, VersionSchema, responseSchema } from './common.js';
import { DisplayRefSchema, getDisplayTextLimit } from './localization.js';

/** Only persisted public fields enter a plan. Internal costs/notes are never translation input. */
export const TranslationPlanRefSchema = z.union([z.enum(['content.title', 'content.description']), DisplayRefSchema]);
export const getTranslationPlanTextLimit = (ref: string) => ref.startsWith('content.') ? 10_000 : getDisplayTextLimit(ref);
export function translationRequestCount(text: string): number {
  let count = 0, length = 0;
  for (const character of text) { if (length + character.length > 5000) { count++; length = 0; } length += character.length; }
  return count + (length ? 1 : 0);
}
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CountSchema = z.number().int().nonnegative().max(1_000_000);
export const TranslationPlanFieldSchema = z.strictObject({
  ref: TranslationPlanRefSchema,
  sourceText: z.string().min(1).max(10_000).regex(/\S/),
  sourceVersion: VersionSchema,
  sourceHash: HashSchema,
  // Language-neutral configuration values are projected unchanged, not sent to a provider.
  mode: z.literal('translate'),
  sourceCharacters: CountSchema,
}).superRefine((field, ctx) => {
  if (field.sourceText.length > getTranslationPlanTextLimit(field.ref)) ctx.addIssue({ code: 'custom', path: ['sourceText'], message: 'Source exceeds its field limit.' });
  if (field.sourceCharacters !== field.sourceText.length) ctx.addIssue({ code: 'custom', path: ['sourceCharacters'], message: 'Character count must match the UTF-16 source length.' });
});
export const CreateTranslationPlanRequestSchema = z.strictObject({ version: VersionSchema });
export type CreateTranslationPlanRequest = z.infer<typeof CreateTranslationPlanRequestSchema>;
export const TranslationPlanSchema = z.strictObject({
  id: z.uuid(), vehicleId: z.uuid(), vehicleVersion: VersionSchema,
  localizationRevision: z.number().int().nonnegative(), sourceFingerprint: HashSchema,
  sourceLanguage: z.literal('zh'), targetLocales: z.tuple([z.literal('en'), z.literal('ru')]),
  provider: z.enum(['disabled', 'libretranslate', 'aliyun']), engineVersion: z.string().min(1).max(200).nullable(),
  fields: z.array(TranslationPlanFieldSchema).min(1).max(472),
  estimate: z.strictObject({
    characterBasis: z.literal('utf16_upper_bound'), maximumCharacters: CountSchema, maximumRequests: CountSchema,
    hourlyCharacterLimit: CountSchema,
    // No live account query or guessed tariff. Unknown allowance is never described as free.
    cost: z.strictObject({ status: z.literal('unknown'), amount: z.null(), currency: z.null(), freeAllowanceCharacters: z.null() }),
  }),
  createdAt: TimestampSchema, expiresAt: TimestampSchema,
}).superRefine((value, ctx) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Plan expiry must follow creation.' });
  if (new Set(value.fields.map(field => field.ref)).size !== value.fields.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Duplicate translation fields.' });
  if ((value.provider === 'disabled') !== (value.engineVersion === null)) ctx.addIssue({ code: 'custom', path: ['engineVersion'], message: 'Disabled providers have no engine.' });
  if (value.estimate.maximumCharacters !== value.fields.reduce((sum, field) => sum + field.sourceCharacters * 2, 0)) ctx.addIssue({ code: 'custom', path: ['estimate', 'maximumCharacters'], message: 'Estimate must cover both targets for every source.' });
  if (value.estimate.maximumRequests !== value.fields.reduce((sum, field) => sum + translationRequestCount(field.sourceText) * 2, 0)) ctx.addIssue({ code: 'custom', path: ['estimate', 'maximumRequests'], message: 'Request estimate must include every bounded segment and target.' });
});
export type TranslationPlan = z.infer<typeof TranslationPlanSchema>;
export const TranslationPlanResponseSchema = responseSchema(TranslationPlanSchema);

/** Acknowledges the displayed immutable estimate, not a freshly recomputed hidden plan. */
export const GenerateTranslationPlanRequestSchema = z.strictObject({
  confirmed: z.literal(true), sourceFingerprint: HashSchema,
  maximumCharacters: CountSchema, acceptUnknownCost: z.literal(true),
});
export type GenerateTranslationPlanRequest = z.infer<typeof GenerateTranslationPlanRequestSchema>;
export const TranslationPlanResultTextSchema = z.strictObject({
  text: z.string().min(1).max(10_000).regex(/\S/),
  kind: z.enum(['original', 'machine']), reviewStatus: z.literal('pending'),
  sourceVersion: VersionSchema, humanEditVersion: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(200).nullable(),
});
export const TranslationPlanResultFieldSchema = TranslationPlanFieldSchema.safeExtend({
  targetHumanEditVersions: z.strictObject({ zh: z.number().int().nonnegative().nullable(), en: z.number().int().nonnegative().nullable(), ru: z.number().int().nonnegative().nullable() }),
  translations: z.strictObject({ zh: TranslationPlanResultTextSchema, en: TranslationPlanResultTextSchema.nullable(), ru: TranslationPlanResultTextSchema.nullable() }),
}).superRefine((field, ctx) => {
  for (const locale of ['zh', 'en', 'ru'] as const) {
    const translation = field.translations[locale];
    if (!translation) continue;
    if (translation.sourceVersion !== field.sourceVersion || translation.humanEditVersion !== (field.targetHumanEditVersions[locale] ?? 0))
      ctx.addIssue({ code: 'custom', path: ['translations', locale], message: 'Suggestions must preserve their exact source and target edit versions.' });
    if (translation.text.length > getTranslationPlanTextLimit(field.ref)) ctx.addIssue({ code: 'custom', path: ['translations', locale, 'text'], message: 'Suggestion exceeds its field limit.' });
    if (locale === 'zh' ? translation.kind !== 'original' || translation.engineVersion !== null || translation.text !== field.sourceText : translation.kind !== 'machine' || translation.engineVersion === null)
      ctx.addIssue({ code: 'custom', path: ['translations', locale], message: 'Keep original Chinese and genuine machine provenance distinct.' });
  }
});
export const TranslationPlanResultSchema = z.strictObject({
  planId: z.uuid(), vehicleId: z.uuid(), vehicleVersion: VersionSchema, localizationRevision: z.number().int().nonnegative(),
  sourceFingerprint: HashSchema, status: z.enum(['completed', 'partial']),
  fields: z.array(TranslationPlanResultFieldSchema).min(1).max(472),
  failures: z.array(z.strictObject({ ref: TranslationPlanRefSchema, targetLocale: z.enum(['en', 'ru']), code: z.enum(['upstream_failed', 'outcome_unknown', 'budget_exceeded', 'invalid_result', 'not_attempted']) })).max(944),
}).superRefine((result, ctx) => {
  const expected = new Set<string>(), failures = new Set<string>();
  if (new Set(result.fields.map(field => field.ref)).size !== result.fields.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Duplicate result fields.' });
  for (const field of result.fields) for (const locale of ['en', 'ru'] as const) if (!field.translations[locale]) expected.add(`${field.ref}:${locale}`);
  for (const [index, failure] of result.failures.entries()) {
    const key = `${failure.ref}:${failure.targetLocale}`;
    if (!expected.has(key) || failures.has(key)) ctx.addIssue({ code: 'custom', path: ['failures', index], message: 'Failures must correspond exactly to distinct missing target results.' });
    failures.add(key);
  }
  if (expected.size !== failures.size || [...expected].some(key => !failures.has(key))) ctx.addIssue({ code: 'custom', path: ['failures'], message: 'Every missing target needs a failure outcome.' });
  if ((result.status === 'completed') !== (expected.size === 0)) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Completed requires all target results and no failures.' });
});
export type TranslationPlanResult = z.infer<typeof TranslationPlanResultSchema>;
export const TranslationPlanResultResponseSchema = responseSchema(TranslationPlanResultSchema);
/** Authenticated recovery read. Polling this endpoint never starts or retries paid work. */
export const TranslationPlanStatusSchema = z.strictObject({
  planId: z.uuid(), vehicleId: z.uuid(), state: z.enum(['ready', 'running', 'completed', 'partial']),
  result: TranslationPlanResultSchema.nullable(), startedAt: TimestampSchema.nullable(), finishedAt: TimestampSchema.nullable(),
}).superRefine((value, ctx) => {
  const finished = value.state === 'completed' || value.state === 'partial';
  // A pure recovery read can expose a recovered outcome before finalization is persisted.
  if (finished !== (value.result !== null) || (!finished && value.finishedAt !== null) || (value.state === 'ready') !== (value.startedAt === null))
    ctx.addIssue({ code: 'custom', message: 'Execution state and its result timestamps must agree.' });
  if (value.result && (value.result.planId !== value.planId || value.result.vehicleId !== value.vehicleId || value.result.status !== value.state))
    ctx.addIssue({ code: 'custom', path: ['result'], message: 'Result belongs to a different plan or state.' });
});
export type TranslationPlanStatus = z.infer<typeof TranslationPlanStatusSchema>;
export const TranslationPlanStatusResponseSchema = responseSchema(TranslationPlanStatusSchema);
