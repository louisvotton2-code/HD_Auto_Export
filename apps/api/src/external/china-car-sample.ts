import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ExternalImportBatchRequestSchema, type ExternalImportBatchRequest, type ExternalUpsertCandidate } from '@hd/contracts/admin';
import { IdSchema, MoneySchema, PartialDateSchema, TimestampSchema, type Locale, type Powertrain } from '@hd/contracts/public';
import { isPublicText, jsonHash, sha256 } from './normalize.js';
import { chinaCarSampleProfile, getPlatform, knownPhotoExpiry, publicLink } from './profiles.js';

type JsonObject = Record<string, unknown>;
type Copy = ExternalUpsertCandidate['copy'];
type Fact = ExternalUpsertCandidate['facts'];
type Entries = ExternalUpsertCandidate['specifications'];
type LanguageCapture = Partial<Record<Locale, JsonObject>>;
type Tagged = { text: string; contentLocale: Locale | 'und' };
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown, limit = 2048) => typeof value === 'string' && /\S/.test(value) && value.length <= limit ? value : null;
const asNumber = (value: unknown, min: number, max: number, integer = true) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : null;
const iso = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  if (!partialDate(value.slice(0, 10))) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const result = TimestampSchema.safeParse(new Date(parsed).toISOString());
  return result.success ? result.data : null;
};
function partialDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const result = PartialDateSchema.safeParse({ precision: { 4: 'year', 7: 'month', 10: 'day' }[value.length], value });
  return result.success ? result.data : null;
}
const identity = (value: unknown) => {
  const row = object(value);
  return typeof row.source === 'string' && !!getPlatform(chinaCarSampleProfile, row.source) && typeof row.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/.test(row.id)
    ? `${row.source}:${row.id}` : null;
};

function actualText(value: unknown, hinted: Locale, limit: number): Tagged | null {
  const text = str(value, limit);
  if (!text || !isPublicText(text)) return null;
  const han = /\p{Script=Han}/u.test(text);
  const cyrillic = /\p{Script=Cyrillic}/u.test(text);
  const markedPinyin = /\b(?:yongci|tongbu|fuzhubocheruwei|chukongyejingping|yaoshilei|zuoyi)\b/i.test(text);
  const contentLocale = han && !cyrillic ? 'zh' : cyrillic && !han && hinted === 'ru' ? 'ru' :
    !han && !cyrillic && hinted === 'en' && /[A-Za-z]/.test(text) && !markedPinyin ? 'en' : 'und';
  return { text, contentLocale };
}

function chooseCopy(versions: Array<ReturnType<typeof actualText>>, primary?: ReturnType<typeof actualText>): Copy['title'] {
  const known = versions.filter((text): text is NonNullable<typeof text> => !!text);
  const original = primary ?? known.find(text => text.contentLocale === 'zh') ?? known[0];
  if (!original) return null;
  const translations: NonNullable<Copy['title']>['translations'] = {};
  for (const item of known) if (item.contentLocale !== 'und' && item.contentLocale !== original.contentLocale && !translations[item.contentLocale]) {
    translations[item.contentLocale] = item;
  }
  return { original, translations };
}

function sameObservation(base: JsonObject, localized: JsonObject) {
  const version = iso(base.updatedAt);
  if (!version || identity(base) !== identity(localized) || version !== iso(localized.updatedAt)) return false;
  const factsSignature = (record: JsonObject) => {
    const normalized = normalizeFacts(record);
    const { make, model, trim, location, ...structured } = normalized.facts;
    return jsonHash([record.status, object(record.make).id, object(record.model).id, object(record.trim).id,
      object(record.price).cny, structured, normalized.energyConflict]);
  };
  return factsSignature(base) === factsSignature(localized);
}
function sourceCopy(row: JsonObject, captures: LanguageCapture): Copy {
  const matched = (['zh', 'en', 'ru'] as const).flatMap(locale => {
    const sibling = captures[locale];
    return sibling && sameObservation(row, sibling) ? [{ locale, data: sibling }] : [];
  });
  const title = chooseCopy([actualText(row.title, 'en', 500), ...matched.map(item => actualText(item.data.title, item.locale, 500))]);
  const model = object(row.model);
  const sameProperName = model.name === model.nameZh && typeof model.name === 'string' && !/\p{Script=Han}/u.test(model.name);
  const modelName = sameProperName ? actualText(model.name, 'zh', 120) : null;
  return {
    title,
    model: chooseCopy([actualText(model.nameZh, 'zh', 120), actualText(model.name, 'en', 120),
      ...matched.map(item => actualText(object(item.data.model).name, item.locale, 120))], modelName),
    description: chooseCopy([actualText(row.description, 'en', 2000), ...matched.map(item => actualText(item.data.description, item.locale, 2000))]),
  };
}

const powertrain = new Map<string, Powertrain>([
  ['Petrol', 'petrol'], ['Gasoline', 'petrol'], ['Diesel', 'diesel'], ['Electric', 'bev'], ['Pure Electric', 'bev'],
  ['Hybrid', 'hev'], ['Plug-in Hybrid', 'phev'], ['Plug-in hybrid', 'phev'], ['Range extender (EREV)', 'erev'], ['Range Extender', 'erev'],
]);
const bodies = new Map<string, NonNullable<Fact['body']>>([
  ['SUV', 'suv'], ['SUV Crossover', 'suv'], ['Sedan', 'sedan'], ['MPV', 'van'], ['Hatchback', 'hatchback'],
  ['Station Wagon', 'wagon'], ['Hardtop Coupe', 'coupe'],
]);
function named(value: unknown, category: string) {
  const row = object(value);
  const name = str(row.nameZh, 120) ?? str(row.name, 120);
  const id = IdSchema.safeParse(`cca-${category}-${String(row.id)}`);
  return name && id.success && (typeof row.id === 'string' || typeof row.id === 'number') && isPublicText(name) ? { id: id.data, name } : null;
}

function normalizeFacts(row: JsonObject): { facts: Fact; energyConflict: boolean } {
  const specs = object(row.specs);
  const primaryPower = powertrain.get(String(row.fuel));
  const specsPower = powertrain.get(String(specs.energyType));
  const drivetrain = /(?:^|\s)(FWD|RWD|AWD|4WD)$/.exec(String(row.drivetrain))?.[1];
  const transmission = str(specs.transmissionType, 100) ?? '';
  const firstRegistration = partialDate(row.firstRegistration);
  const city = str(row.city, 120);
  return {
    facts: {
      make: named(row.make, 'make'), model: named(row.model, 'model'), trim: named(row.trim, 'trim'), generation: null,
      modelYear: asNumber(row.modelYear, 1886, 9999), manufacturedAt: partialDate(row.manufactureDate), firstRegistration,
      registrationStatus: firstRegistration ? 'registered' : 'unknown', mileageKm: asNumber(row.mileageKm, 0, 10_000_000),
      powertrain: primaryPower ?? specsPower ?? 'unknown', engineCc: asNumber(specs.displacementCc, 0, 100_000),
      powerKw: asNumber(row.powerKw, 0, 100_000, false), body: bodies.get(String(specs.bodyType)) ?? null,
      transmission: /\bDCT\b/.test(transmission) ? 'dct' : /\bCVT\b/.test(transmission) ? 'cvt' : row.transmission === 'Automatic' ? 'automatic' : row.transmission === 'Manual' ? 'manual' : null,
      drivetrain: drivetrain === '4WD' ? 'four_wd' : drivetrain === 'FWD' ? 'fwd' : drivetrain === 'RWD' ? 'rwd' : drivetrain === 'AWD' ? 'awd' : null,
      location: city && isPublicText(city) ? { country: 'CN', city, displayName: null } : null,
    },
    energyConflict: !!primaryPower && !!specsPower && primaryPower !== specsPower,
  };
}

function candidatePrice(value: unknown) {
  const cny = object(value).cny;
  if (typeof cny !== 'string' && typeof cny !== 'number') return null;
  const valid = MoneySchema.shape.amount.safeParse(String(cny));
  return { cny: valid.success ? valid.data : 'invalid' };
}

function photos(row: JsonObject): ExternalUpsertCandidate['images'] {
  const photos = new Map<string, ExternalUpsertCandidate['images'][number]>();
  const expiry = (value: string | null) => value ? Date.parse(value) : Infinity;
  for (const value of [row.image, ...array(row.photos)]) {
    const valid = publicLink(str(value), 'media', chinaCarSampleProfile);
    if (!valid) continue;
    const url = new URL(valid);
    const cdn = url.hostname.endsWith('.byteimg.com') ? 'dongchedi' : 'che168';
    const assetPath = cdn === 'dongchedi' ? url.pathname.split('~')[0] : url.pathname;
    const sourceMediaId = sha256(`${cdn}:${assetPath}`);
    const expiresAt = knownPhotoExpiry(url);
    const existing = photos.get(sourceMediaId);
    if (existing ? expiry(expiresAt) > expiry(existing.expiresAt) : photos.size < 30) {
      photos.set(sourceMediaId, { sourceMediaId, url: valid, width: null, height: null, alt: null, expiresAt });
    }
  }
  return [...photos.values()];
}

function entry(entries: Entries, name: unknown, value: unknown, language: Locale = 'en') {
  const label = actualText(name, language, 500);
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'boolean' ? String(value) : value;
  const displayed = actualText(text, language, 500);
  if (label && displayed && entries.length < 500) entries.push({ name: label, value: displayed });
}
const specFields = ['displacementCc', 'powerKw', 'powerHp', 'torqueNm', 'engineKw', 'motorKw', 'systemKw', 'energyType', 'emissionStandard',
  'cylinders', 'transmissionType', 'gears', 'driveType', 'bodyType', 'doors', 'seats', 'lengthMm', 'widthMm', 'heightMm', 'wheelbaseMm',
  'curbWeightKg', 'grossWeightKg', 'fuelTankL', 'trunkL', 'topSpeedKmh', 'acceleration0to100S', 'fuelConsumptionL100km', 'launchDate', 'warranty'];
const evFields = ['batteryKwh', 'batteryType', 'batteryWarranty', 'consumptionKwh100km', 'fastChargeHours', 'motorLayout', 'motorPowerKw',
  'motorTorqueNm', 'motorType', 'motors', 'rangeKm', 'slowChargeHours'];
function specifications(row: JsonObject, disputes: JsonObject[]): Entries {
  const entries: Entries = [];
  const specs = object(row.specs);
  const ev = object(specs.ev);
  for (const field of specFields) entry(entries, field, specs[field]);
  for (const field of evFields) entry(entries, field, ev[field]);
  if (!disputes.some(item => item.field === 'ownershipTransfers')) entry(entries, 'Ownership transfers', asNumber(row.ownershipTransfers, 0, 100));
  for (const group of array(row.equipment)) for (const item of array(object(group).items)) {
    const spec = object(item);
    if (str(spec.nameZh, 500) && str(spec.valueZh, 500)) entry(entries, spec.nameZh, spec.valueZh, 'zh');
    else entry(entries, spec.name, spec.value);
  }
  return entries;
}
function inspection(row: JsonObject, report: JsonObject | undefined): ExternalUpsertCandidate['inspection'] {
  const reportUrl = publicLink(str(row.inspectionReportUrl), 'report', chinaCarSampleProfile);
  const entries: Entries = [];
  for (const value of array(report?.summary)) {
    const item = object(value);
    entry(entries, item.area, item.result);
    if (item.textZh) entry(entries, '报告说明', item.textZh, 'zh');
  }
  for (const value of array(report?.counts)) {
    const item = object(value);
    const faults = asNumber(item.faults, 0, 10_000);
    const checked = asNumber(item.checked, 0, 10_000);
    if (faults !== null && checked !== null) entry(entries, item.category, `${faults} / ${checked}`);
  }
  return reportUrl || entries.length ? { reportUrl, entries: entries.slice(0, 300) } : null;
}

export function adaptChinaCarSample(row: JsonObject, fetchedAt: unknown, captures: LanguageCapture = {}, evidence: JsonObject[] = [], report?: JsonObject): ExternalUpsertCandidate | null {
  const collected = iso(fetchedAt) ?? iso(object(row.lifecycle).detailFetchedAt);
  const updated = iso(row.updatedAt);
  const key = identity(row);
  if (!key || !collected || row.status !== 'active') return null;
  const { facts, energyConflict } = normalizeFacts(row);
  const disputes = new Set<ExternalUpsertCandidate['disputes'][number]>();
  if (energyConflict) disputes.add('powertrain');
  for (const item of evidence) {
    if (item.field === 'titleAndModelYear') { disputes.add('modelYear'); disputes.add('trim'); }
    if (item.field === 'structuredRangeKm') disputes.add('specifications');
    if (item.field === 'domesticPrice' && object(item.evidence).sourceMatchesPrice === false) disputes.add('price');
  }
  return {
    operation: 'upsert', platformId: String(row.source), externalId: String(row.id), revision: Date.parse(updated ?? collected),
    fetchedAt: collected, sourceUpdatedAt: updated, listingUrl: str(row.url) ?? '',
    relatedListingUrls: array(row.alsoListedOn).flatMap(item => str(object(item).url) ?? []).slice(0, 20),
    facts, disputes: [...disputes], price: candidatePrice(row.price), sellerPrice: candidatePrice(row.sellerPrice),
    copy: sourceCopy(row, captures), images: photos(row), specifications: specifications(row, evidence), inspection: inspection(row, report),
  };
}

/** Reads the specific, verified PA handoff. It cannot download or extract anything. */
export async function loadChinaCarSample(folder: string) {
  const root = await realpath(folder);
  async function localFile(relative: string) {
    const file = await realpath(path.resolve(root, relative));
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Sample input is outside the verified archive.');
    const info = await stat(file);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('Sample input exceeds its local file limit.');
    return readFile(file, 'utf8');
  }
  const json = async (relative: string): Promise<unknown> => JSON.parse(await localFile(relative));
  const summary = object(await json('handoff/summary.json'));
  const rawDirectory = await realpath(path.join(root, 'package/raw'));
  if (!rawDirectory.startsWith(`${root}${path.sep}`)) throw new Error('Sample input directory is outside the verified archive.');
  const lines = async (relative: string, expectedHash: unknown) => {
    const raw = await localFile(relative);
    if (sha256(raw) !== expectedHash) throw new Error('Sample file does not match its handoff digest.');
    return raw.split(/\r?\n/).filter(line => /\S/.test(line));
  };
  const [pilot, control, envelopes, firstIds, controlIds, matches, disputed, filenames] = await Promise.all([
    lines('package/pilot_100/vehicles_100_raw.jsonl', summary.pilot_raw_sha256),
    lines('handoff/control-100-raw.jsonl', summary.control_sha256),
    lines('package/pilot_100/vehicles_100_envelopes.jsonl', summary.pilot_envelope_sha256),
    json('handoff/pilot-identities.json'), json('handoff/control-identities.json'), json('handoff/language-matches.json'),
    json('handoff/disputes.json'), readdir(rawDirectory),
  ]);
  const captures = new Map<string, LanguageCapture>();
  for (const value of array(matches)) {
    const row = object(value);
    const key = identity(row);
    if (!key || captures.has(key)) throw new Error('Invalid paired language identity.');
    const group: LanguageCapture = {};
    for (const locale of ['zh', 'en', 'ru'] as const) {
      const file = str(object(row.files)[locale]);
      if (!file) continue;
      const response = object(await json(`package/${file}`));
      const data = object(response.data);
      const requestedLocale = object(response.params).lang ?? 'en';
      if (response.status !== 200 || response.truncated !== false || identity(data) !== key || requestedLocale !== locale) throw new Error('Paired capture does not match its declared identity and language.');
      group[locale] = data;
    }
    captures.set(key, group);
  }
  const reports = new Map<string, JsonObject>();
  for (const file of filenames) {
    const match = /^\d+_inspection_(che168|dongchedi)_([A-Za-z0-9._:-]+)_en\.json$/.exec(file);
    if (!match) continue;
    const response = object(await json(`package/raw/${file}`));
    const data = object(response.data);
    if (response.status === 200 && response.truncated === false && String(data.id) === match[2] && (data.source == null || data.source === match[1])) {
      reports.set(`${match[1]}:${match[2]}`, data);
    }
  }
  const disputes = new Map<string, JsonObject[]>();
  for (const value of array(disputed)) {
    const row = object(value);
    const key = identity(row);
    if (!key) throw new Error('Invalid dispute identity.');
    disputes.set(key, [...(disputes.get(key) ?? []), row]);
  }
  const seen = new Set<string>();
  const group = (raw: string[], ids: unknown, pilotGroup: boolean): ExternalImportBatchRequest => {
    const ordered = array(ids).map(object);
    if (raw.length !== 100 || ordered.length !== raw.length || (pilotGroup && envelopes.length !== raw.length)) throw new Error('Expected exactly 100 verified sample identities.');
    return ExternalImportBatchRequestSchema.parse({ provider: chinaCarSampleProfile.id, records: raw.map((line, index) => {
      const row = object(JSON.parse(line));
      const envelope = pilotGroup ? object(JSON.parse(envelopes[index]!)) : {};
      const info = object(envelope.observed_info);
      const key = identity(row);
      const expected = ordered[index]!;
      if (!key || key !== identity(expected) || expected.listingUrl !== row.url || seen.has(key) ||
          (pilotGroup && (identity(envelope) !== key || jsonHash(envelope.raw_payload) !== jsonHash(row) || info.api_language !== 'en'))) {
        throw new Error('Sample identities or captures do not match the verified order.');
      }
      seen.add(key);
      const languages = captures.get(key);
      const evidence = disputes.get(key) ?? [];
      const report = reports.get(key);
      const candidate = adaptChinaCarSample(row, info.api_response_received_at_utc, languages, evidence, report);
      return { raw: JSON.stringify({ sourceLine: line, captureLanguage: 'en', observedAt: info.api_response_received_at_utc, pairedCaptures: languages, evidence, inspection: report }), candidate };
    }) });
  };
  return { pilot: group(pilot, firstIds, true), control: group(control, controlIds, false), languageGroups: captures.size, evidenceEntries: array(disputed).length };
}
