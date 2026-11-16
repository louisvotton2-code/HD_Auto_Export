import { z } from 'zod';
import { PowertrainSchema, VersionSchema, responseSchema } from './common.js';
import { VEHICLE_CONFIGURATION_LIMITS, VehicleConfigurationSchema, parseBoundedJson, vehicleConfigurationItemId } from './configuration.js';
import { DisplayRefSchema, getDisplayTextLimit } from './localization.js';

export const CONFIGURATION_IMPORT_JSON_BYTES = 512 * 1024;
export const CONFIGURATION_IMPORT_LOCALES = ['zh', 'en', 'ru'] as const;
export const ConfigurationImportPowertrainSchema = PowertrainSchema.exclude(['unknown']);
const { items, nameUtf16, valueUtf16 } = VEHICLE_CONFIGURATION_LIMITS;
const itemId = z.string().regex(/^cfg-(?:[0-9a-f]{4}){1,100}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().max(max).regex(/\S/u)
  .refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), 'Text must be valid database Unicode without NUL or unpaired surrogates');
const localeTexts = (max: number) => z.strictObject({ zh: text(max), en: text(max), ru: text(max) });
const displayRef = DisplayRefSchema.refine(ref => !ref.startsWith('configuration.'), 'Configuration translations belong in items');

const ConfigurationImportItemSchema = z.strictObject({ id: itemId, name: localeTexts(nameUtf16), value: localeTexts(valueUtf16) });
export type ConfigurationImportItem = z.infer<typeof ConfigurationImportItemSchema>;
export const ConfigurationImportDocumentSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(ConfigurationImportItemSchema).min(1).max(items).optional(),
  content: z.strictObject({ title: localeTexts(10_000).optional(), description: localeTexts(10_000).optional() })
    .refine(value => value.title !== undefined || value.description !== undefined).optional(),
  display: z.array(z.strictObject({ ref: displayRef, text: localeTexts(500) })).min(1).max(70).optional(),
  facts: z.strictObject({ powertrain: ConfigurationImportPowertrainSchema }).optional(),
}).superRefine((document, ctx) => {
  if (!document.items && !document.content && !document.display && !document.facts) ctx.addIssue({ code: 'custom', message: 'At least one section is required.' });
  const ids = new Set<string>();
  if (document.items) {
    const result = VehicleConfigurationSchema.safeParse({ version: 1, items: document.items.map(item => ({ name: item.name.zh, value: item.value.zh })) });
    if (!result.success) for (const issue of result.error.issues) {
      const [, index, key] = issue.path;
      ctx.addIssue({ code: 'custom', path: typeof index === 'number' && typeof key === 'string' ? ['items', index, key, 'zh'] : ['items'], message: issue.message });
    }
    document.items.forEach((item, index) => {
      const name = item.name.zh;
      const validName = name === name.trim() && !/[\u0000\uD800-\uDFFF]/u.test(name) && name.length > 0 && name.length <= nameUtf16;
      if (ids.has(item.id) || (validName && item.id !== vehicleConfigurationItemId(name))) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: 'Item ID must be unique and match its Chinese name.' });
      }
      ids.add(item.id);
      // Locale-neutral values continue to be presented verbatim by the v1 projection.
      if (!/\p{Script=Han}/u.test(item.value.zh)) for (const locale of ['en', 'ru'] as const) {
        if (item.value[locale] !== item.value.zh) ctx.addIssue({ code: 'custom', path: ['items', index, 'value', locale], message: 'Use the same literal for locale-neutral values.' });
      }
    });
  }
  const refs = new Set<string>();
  document.display?.forEach((field, index) => {
    if (refs.has(field.ref)) ctx.addIssue({ code: 'custom', path: ['display', index, 'ref'], message: 'Display reference must be unique.' });
    refs.add(field.ref);
    for (const locale of CONFIGURATION_IMPORT_LOCALES) if (field.text[locale].length > getDisplayTextLimit(field.ref)) {
      ctx.addIssue({ code: 'custom', path: ['display', index, 'text', locale], message: 'Display text exceeds its field limit.' });
    }
  });
});
export type ConfigurationImportDocument = z.infer<typeof ConfigurationImportDocumentSchema>;

export function parseConfigurationImportJson(raw: string): ConfigurationImportDocument {
  return ConfigurationImportDocumentSchema.parse(parseBoundedJson(raw, { jsonBytes: CONFIGURATION_IMPORT_JSON_BYTES, jsonDepth: 8, jsonNodes: 4096 }));
}

export const ConfigurationImportPreviewRequestSchema = z.strictObject({
  version: VersionSchema, localizationRevision: revision, json: z.string().min(1).describe('Original versioned JSON file text, at most 512 KiB of UTF-8.'),
});
const previewToken = z.string().regex(/^[0-9]{13}\.[0-9a-f]{64}$/);
export const ConfigurationImportSaveRequestSchema = ConfigurationImportPreviewRequestSchema.extend({ previewToken });
export const ConfigurationImportPreviewResponseSchema = responseSchema(z.strictObject({
  version: VersionSchema, localizationRevision: revision, previewToken,
  changes: z.array(z.strictObject({ path: z.string().min(1).max(480), before: z.string().max(10_000).nullable(), after: z.string().max(10_000).nullable() })).max(3500),
  itemOrder: z.strictObject({ before: z.array(itemId).max(items), after: z.array(itemId).max(items) }).nullable(),
  warnings: z.array(z.strictObject({
    path: z.string().min(1).max(120), code: z.enum(['RETAINED_CONFIRMED_VALUE', 'UNVERIFIED_CONFIGURATION_VALUE', 'CONFLICTING_CONFIGURATION_VALUES']),
    retained: z.string().max(500).nullable(), submitted: z.string().max(500),
  })).max(items).optional(),
}));
export type ConfigurationImportPreviewRequest = z.infer<typeof ConfigurationImportPreviewRequestSchema>;
export type ConfigurationImportSaveRequest = z.infer<typeof ConfigurationImportSaveRequestSchema>;
export type ConfigurationImportPreview = z.infer<typeof ConfigurationImportPreviewResponseSchema>['data'];

export const configurationImportExample: ConfigurationImportDocument = {
  version: 1,
  items: [{ id: vehicleConfigurationItemId('挡位数'),
    name: { zh: '挡位数', en: 'Gears', ru: 'Количество передач' }, value: { zh: '8', en: '8', ru: '8' } }],
  content: {
    title: { zh: '车辆展示样例', en: 'Example vehicle', ru: 'Пример автомобиля' },
    description: { zh: '车况以实际检查为准。', en: 'Condition is subject to inspection.', ru: 'Состояние уточняется при осмотре.' },
  },
  facts: { powertrain: 'petrol' },
};
