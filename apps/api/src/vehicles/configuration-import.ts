import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  CONFIGURATION_IMPORT_JSON_BYTES, CONFIGURATION_IMPORT_LOCALES, LocalizationDataSchema, VehicleDraftInputSchema,
  parseConfigurationImportJson, vehicleConfigurationItemId, type ConfigurationImportDocument, type ConfigurationImportPreview,
  type ConfigurationImportPreviewRequest, type DisplayField, type LocalizedText, type VehicleDraftInput, type VehicleDetailMatchKey,
  VEHICLE_POWER_DETAIL_KEYS, VehicleTechnicalFactsSchema,
} from '@hd/contracts/admin';
import { ApiError, conflict } from '../errors.js';
import { sameValue } from '../activity/changes.js';
import { configurationValueNeedsTranslation } from './configuration.js';
import { isChineseSource } from './content.js';
import { syncLocalization, technicalFactsIdentity, type StoredLocalization } from './localization.js';
import { configurationTechnicalCandidates } from './configuration-technical-facts.js';

const locales = CONFIGURATION_IMPORT_LOCALES;
type Locale = typeof locales[number];
type Triple = Record<Locale, string>;
type Binding = { vehicleId: string; actorId: string; input: ConfigurationImportPreviewRequest };
const previewTtlMs = 10 * 60 * 1000;

function sign(secret: string, { vehicleId, actorId, input }: Binding, expiresAt: number) {
  return createHmac('sha256', secret).update(JSON.stringify([
    // The preview policy has changed independently of the input JSON version.
    'vehicle.configuration-import.preview.v2', vehicleId.toLowerCase(), actorId, input.version, input.localizationRevision, expiresAt, input.json,
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
  if (document.items) {
    for (const key of ['engineCc', 'powerHp', 'body', 'transmission'] as const) {
      const value = draft.facts[key];
      if (value != null) put(`facts.${key}`, String(value));
    }
    put('localization.facts.drivetrain', localization.data.facts.drivetrain);
    const technical = localization.data.facts.verifiedTechnical;
    for (const key of VEHICLE_POWER_DETAIL_KEYS) {
      if (technical?.[key] !== undefined) put(`localization.facts.verifiedTechnical.${key}`, String(technical[key]));
    }
    if (technical?.vehicleClass) for (const locale of locales) {
      put(`localization.facts.verifiedTechnical.vehicleClass.${locale}`, technical.vehicleClass.value[locale]);
    }
  }
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

function importTechnicalFacts(draft: VehicleDraftInput, localization: StoredLocalization, items: NonNullable<ConfigurationImportDocument['items']>) {
  const { candidates, invalid } = configurationTechnicalCandidates(items);
  type Candidate = typeof candidates[number];
  const warnings: NonNullable<ConfigurationImportPreview['warnings']> = [];
  const facts = localization.data.facts;
  const identityHash = technicalFactsIdentity(draft.facts);
  const technical: NonNullable<typeof facts.verifiedTechnical> =
    facts.verifiedTechnical?.identityHash === identityHash ? { ...facts.verifiedTechnical } : { identityHash };
  const commonFields = { displacementCc: 'engineCc', powerHp: 'powerHp', bodyType: 'body', transmissionType: 'transmission' } as const;
  const commonField = (key: VehicleDetailMatchKey) => Object.hasOwn(commonFields, key) ? commonFields[key as keyof typeof commonFields] : null;
  const description = (value: Candidate['value'] | undefined | null) => typeof value === 'object' ? value?.zh ?? null : value == null ? null : String(value);
  const powerField = (key: VehicleDetailMatchKey) => VEHICLE_POWER_DETAIL_KEYS.find(power => power === key);
  const existingValue = (key: VehicleDetailMatchKey) => {
    const field = commonField(key), powerKey = powerField(key);
    return field ? draft.facts[field] : key === 'driveType' ? facts.drivetrain : key === 'vehicleClass' ? technical.vehicleClass?.value :
      key === 'energyType' ? draft.facts.powertrain : key === 'powerKw' ? draft.facts.powerKw : powerKey ? technical[powerKey] : null;
  };
  const warn = (index: number, code: typeof warnings[number]['code'], retained: string | null = null) => {
    warnings.push({ path: `json.items.${index}.value`, code, retained, submitted: items[index]!.value.zh });
  };
  for (const { index, key, reason } of invalid) {
    if (reason === 'conflict') warn(index, 'CONFLICTING_CONFIGURATION_VALUES', description(existingValue(key)));
    else warn(index, 'UNVERIFIED_CONFIGURATION_VALUE');
  }
  const groups = new Map<VehicleDetailMatchKey, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.key);
    if (group) group.push(candidate);
    else groups.set(candidate.key, [candidate]);
  }
  for (const [key, group] of groups) {
    const first = group[0]!;
    const field = commonField(key);
    const powerKey = powerField(key);
    const prior = existingValue(key);
    if (group.some(entry => description(entry.value) !== description(first.value)) || invalid.some(entry => entry.key === key)) {
      for (const candidate of group) warn(candidate.index, 'CONFLICTING_CONFIGURATION_VALUES', description(prior));
      continue;
    }
    if (prior != null && prior !== 'unknown') {
      if (description(prior) !== description(first.value)) {
        for (const candidate of group) warn(candidate.index, 'RETAINED_CONFIRMED_VALUE', description(prior));
      } else if (key === 'vehicleClass' && technical.vehicleClass) {
        const bound = group.find(candidate => candidate.id === technical.vehicleClass?.id && typeof candidate.value === 'object');
        if (bound && typeof bound.value === 'object') technical.vehicleClass = { id: bound.id, value: bound.value };
      }
      continue;
    }
    if (field) Object.assign(draft.facts, { [field]: first.value });
    else if (key === 'driveType') Object.assign(facts, { drivetrain: first.value });
    else if (key === 'vehicleClass' && typeof first.value === 'object') technical.vehicleClass = { id: first.id, value: first.value };
    else if (powerKey && typeof first.value === 'number') technical[powerKey] = first.value;
  }
  if (technical.vehicleClass || VEHICLE_POWER_DETAIL_KEYS.some(key => technical[key] !== undefined))
    facts.verifiedTechnical = VehicleTechnicalFactsSchema.parse(technical);
  return warnings;
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
  const warnings = document.items ? importTechnicalFacts(draft, localization, document.items) : [];
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
    ...(warnings.length ? { warnings } : {}),
  };
}
