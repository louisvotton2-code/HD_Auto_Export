import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  CONFIGURATION_IMPORT_JSON_BYTES, CONFIGURATION_IMPORT_LOCALES, LocalizationDataSchema, VehicleDraftInputSchema,
  parseConfigurationImportJson, vehicleConfigurationItemId, type ConfigurationImportDocument, type ConfigurationImportPreview,
  type ConfigurationImportPreviewRequest, type DisplayField, type LocalizedText, type VehicleDraftInput,
} from '@hd/contracts/admin';
import { ApiError, conflict } from '../errors.js';
import { sameValue } from '../activity/changes.js';
import { configurationValueNeedsTranslation } from './configuration.js';
import { isChineseSource } from './content.js';
import { syncLocalization, type StoredLocalization } from './localization.js';

const locales = CONFIGURATION_IMPORT_LOCALES;
type Locale = typeof locales[number];
type Triple = Record<Locale, string>;
type Binding = { vehicleId: string; actorId: string; input: ConfigurationImportPreviewRequest };
const previewTtlMs = 10 * 60 * 1000;

function sign(secret: string, { vehicleId, actorId, input }: Binding, expiresAt: number) {
  return createHmac('sha256', secret).update(JSON.stringify([
    'vehicle.configuration-import.v1', vehicleId.toLowerCase(), actorId, input.version, input.localizationRevision, expiresAt, input.json,
  ])).digest('hex');
}
export function configurationImportToken(secret: string, binding: Binding) {
  const expiresAt = Date.now() + previewTtlMs;
  return `${expiresAt}.${sign(secret, binding, expiresAt)}`;
}
export function requireConfigurationImportToken(secret: string, binding: Binding, token: string) {
  const [expiry, mac] = token.split('.');
  const expiresAt = Number(expiry);
  if (!mac || !/^[0-9a-f]{64}$/.test(mac) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() ||
      !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(sign(secret, binding, expiresAt), 'hex'))) throw conflict();
}

function parseImport(raw: string) {
  if (Buffer.byteLength(raw, 'utf8') > CONFIGURATION_IMPORT_JSON_BYTES)
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Configuration import JSON exceeds 512 KiB.');
  try { return parseConfigurationImportJson(raw); }
  catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const fields = error.issues.slice(0, 100).map(issue => {
      const path = issue.path.every(key => typeof key === 'number' || typeof key === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(key))
        ? ['json', ...issue.path].join('.').slice(0, 500) : 'json';
      return { path, code: 'INVALID_FIELD', message: issue.code === 'custom' ? issue.message : 'Invalid field value.' };
    });
    throw new ApiError(400, 'INVALID_REQUEST', 'Configuration import JSON is invalid.', fields);
  }
}

function importTexts(field: Pick<DisplayField, 'sourceLanguage' | 'sourceText' | 'sourceVersion' | 'translations'> |
  VehicleDraftInput['content']['title'], texts: Triple, sourceEstablished = false) {
  for (const locale of locales) {
    const prior = field.translations[locale];
    const exact = prior?.text === texts[locale] ? prior : null;
    if (exact && !sourceEstablished) continue;
    const original = locale === 'zh' && isChineseSource(field.sourceLanguage) && texts.zh === field.sourceText;
    const machineEngine = !original && exact?.kind === 'machine' ? exact.engineVersion : null;
    const value: LocalizedText = {
      text: texts[locale], kind: original ? 'original' : machineEngine ? 'machine' : 'human',
      reviewStatus: 'pending', sourceVersion: field.sourceVersion,
      humanEditVersion: (prior?.humanEditVersion ?? 0) + 1, engineVersion: machineEngine,
    };
    field.translations[locale] = value;
  }
}

function previewValues(draft: VehicleDraftInput, localization: StoredLocalization, document: ConfigurationImportDocument) {
  const values = new Map<string, string>();
  const put = (path: string, value: string | null | undefined) => { if (value != null) values.set(path, value); };
  if (document.facts) put('facts.powertrain', draft.facts.powertrain);
  const byRef = new Map(localization.data.fields.map(field => [field.ref, field]));
  for (const key of ['title', 'description'] as const) {
    if (!document.content?.[key]) continue;
    const field = draft.content[key];
    put(`content.${key}.sourceText`, field.sourceText);
    for (const locale of locales) put(`content.${key}.${locale}`, field.translations[locale]?.text);
  }
  for (const { ref } of document.display ?? []) {
    for (const locale of locales) put(`display.${ref}.${locale}`, byRef.get(ref)?.translations[locale]?.text);
  }
  if (document.items) for (const item of draft.configuration?.items ?? []) {
    const id = vehicleConfigurationItemId(item.name);
    for (const key of ['name', 'value'] as const) {
      put(`items.${id}.${key}.sourceText`, item[key]);
      const field = byRef.get(`configuration.${id}.${key}`);
      for (const locale of locales) put(`items.${id}.${key}.${locale}`,
        field?.translations[locale]?.text ?? (key === 'value' && !configurationValueNeedsTranslation(item.value) ? item.value : null));
    }
  }
  return values;
}

/** Derive both the preview and the atomic write from the same versioned draft and file. */
export function prepareConfigurationImport(id: string, before: VehicleDraftInput, current: StoredLocalization, raw: string) {
  const document = parseImport(raw);
  const draft = structuredClone(before);
  if (document.facts) draft.facts.powertrain = document.facts.powertrain;
  for (const key of ['title', 'description'] as const) {
    const texts = document.content?.[key];
    if (!texts) continue;
    const field = draft.content[key];
    const sourceEstablished = !field.sourceText?.trim();
    if (sourceEstablished) {
      field.sourceText = texts.zh;
      field.sourceLanguage = 'zh';
      field.sourceVersion++;
    }
    importTexts(field, texts, sourceEstablished);
  }
  if (document.items) draft.configuration = {
    version: 1, items: document.items.map(({ name, value }) => ({ name: name.zh, value: value.zh })),
  };
  const localization = document.items ? syncLocalization(id, draft, current, 'zh') : structuredClone(current);
  const byRef = new Map(localization.data.fields.map(field => [field.ref, field]));
  for (const [index, { ref, text }] of (document.display ?? []).entries()) {
    const field = byRef.get(ref);
    if (!field) throw new ApiError(400, 'INVALID_REQUEST', 'Display reference is not present on this draft.',
      [{ path: `json.display.${index}.ref`, code: 'INVALID_FIELD', message: 'Select an existing display reference.' }]);
    importTexts(field, text);
  }
  for (const item of document.items ?? []) {
    importTexts(byRef.get(`configuration.${item.id}.name`)!, item.name);
    const value = byRef.get(`configuration.${item.id}.value`);
    if (value) importTexts(value, item.value);
  }
  const previousValues = previewValues(before, current, document), nextValues = previewValues(draft, localization, document);
  const changes: ConfigurationImportPreview['changes'] = [];
  for (const path of new Set([...previousValues.keys(), ...nextValues.keys()])) {
    const previous = previousValues.get(path) ?? null, next = nextValues.get(path) ?? null;
    if (previous !== next) changes.push({ path, before: previous, after: next });
  }
  const order = (data: VehicleDraftInput) => data.configuration?.items.map(item => vehicleConfigurationItemId(item.name)) ?? [];
  const itemOrder = document.items ? { before: order(before), after: order(draft) } : null;
  return {
    draft: VehicleDraftInputSchema.parse(draft), localization: { ...localization, data: LocalizationDataSchema.parse(localization.data) }, changes,
    itemOrder: itemOrder && !sameValue(itemOrder.before, itemOrder.after) ? itemOrder : null,
  };
}
