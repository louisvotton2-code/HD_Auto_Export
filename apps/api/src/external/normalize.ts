import { createHash } from 'node:crypto';
import {
  ExternalFactFieldSchema, MoneySchema, brandLabel, findBrand,
  type DisplayText, type ExternalIssue, type Locale, type PublicText, type VehicleDisplay,
} from '@hd/contracts/public';
import { ExternalCopySchema, type ExternalOverrides, type ExternalTrialField, type ExternalUpsertCandidate } from '@hd/contracts/admin';
import { ApiError } from '../errors.js';
import { getPlatform, publicLink, syntheticProfile, type ExternalSourceProfile } from './profiles.js';

export const locales = ['zh', 'en', 'ru'] as const;
export const copyFields = ['title', 'model', 'description'] as const;
export const emptyOverrides = (): ExternalOverrides => ({ hidden: false, facts: {}, text: [] });
const fallbackTitle = { zh: '外部挂牌', en: 'External listing', ru: 'Внешнее объявление' };

// Stream stable JSON without recursing into an invalid candidate. Row validation can then archive it.
function writeCanonicalJson(initial: unknown, emit: (text: string) => void) {
  type Frame = { value: object; keys: string[] | null; index: number };
  const stack: Frame[] = [];
  const ancestors = new Set<object>();
  const writeValue = (value: unknown) => {
    if (value === null || typeof value !== 'object') { emit(JSON.stringify(value) ?? 'null'); return; }
    if (ancestors.has(value)) throw new ApiError(400, 'INVALID_REQUEST', 'External records must contain JSON data.');
    const keys = Array.isArray(value) ? null : Object.keys(value).sort();
    emit(keys ? '{' : '[');
    ancestors.add(value);
    stack.push({ value, keys, index: 0 });
  };
  writeValue(initial);
  while (stack.length) {
    const frame = stack.at(-1)!;
    const count = frame.keys?.length ?? (frame.value as unknown[]).length;
    if (frame.index === count) {
      emit(frame.keys ? '}' : ']');
      ancestors.delete(frame.value);
      stack.pop();
      continue;
    }
    const index = frame.index++;
    if (index > 0) emit(',');
    if (frame.keys) {
      const key = frame.keys[index]!;
      emit(JSON.stringify(key));
      emit(':');
      writeValue((frame.value as Record<string, unknown>)[key]);
    } else writeValue((frame.value as unknown[])[index]);
  }
}
export function canonicalJson(value: unknown): string {
  const parts: string[] = [];
  writeCanonicalJson(value, part => parts.push(part));
  return parts.join('');
}
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export function jsonHash(value: unknown): string {
  const hash = createHash('sha256');
  writeCanonicalJson(value, part => hash.update(part));
  return hash.digest('hex');
}
export const unsafeDatabaseText = (value: string) => /[\u0000\uD800-\uDFFF]/u.test(value);
export function isDatabaseJson(value: unknown): boolean {
  if (typeof value === 'string') return !unsafeDatabaseText(value);
  if (Array.isArray(value)) return value.every(isDatabaseJson);
  if (value && typeof value === 'object') return Object.entries(value).every(([key, item]) => !unsafeDatabaseText(key) && isDatabaseJson(item));
  return true;
}

/** Promote only candidate display fields. Untrusted text remains plain data even after filtering. */
export function isPublicText(value: string): boolean {
  if (!/\S/.test(value) || unsafeDatabaseText(value) || /[\u0001-\u0008\u000B-\u001F\u007F]/u.test(value)) return false;
  const text = value.normalize('NFKC');
  return !/<(?:[!/]|[A-Za-z])|(?:https?:\/\/|javascript:)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) &&
    !/微信|联系方式|电话|手机号|whatsapp|telegram|телефон|\b(?:contact|phone|call|tel)\s*[:+]/i.test(text) &&
    !/\+\d(?:[\p{Zs}\t().-]{0,6}\d){6,}/u.test(text) &&
    !/\b(?:1[3-9]\d{9}|[A-HJ-NPR-Z0-9]{17})\b/i.test(text);
}

type Copy = ExternalUpsertCandidate['copy'];
type Tagged = NonNullable<Copy['title']>['original'];
type Facts = ExternalUpsertCandidate['facts'];
type IssueField = ExternalIssue['field'];
type Localized = { title: PublicText; description: PublicText | null; display: VehicleDisplay };
type Details = {
  original: Record<ExternalTrialField, Tagged | null>;
  specifications: ExternalUpsertCandidate['specifications'];
  inspection: ExternalUpsertCandidate['inspection'];
  relatedListingUrls: string[];
};

function usableSupplierText(original: string, translated: string, locale: string): boolean {
  if (!isPublicText(translated)) return false;
  if (locale === 'en' && (!/[A-Za-z]/.test(translated) || /[\p{Script=Han}\p{Script=Cyrillic}]/u.test(translated))) return false;
  if (locale === 'ru' && (!/\p{Script=Cyrillic}/u.test(translated) || /\p{Script=Han}/u.test(translated))) return false;
  if (locale === 'zh' && !/\p{Script=Han}/u.test(translated)) return false;
  const numbers = (value: string) => (value.normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join('|');
  return numbers(original) === numbers(translated);
}

export function sourceCopy(source: ExternalUpsertCandidate, facts: Facts = source.facts): Copy {
  // Free copy/specifications can restate disputed claims. Keep them in the source archive.
  if (source.disputes.length) return { title: null, model: null, description: null };
  const copy = (field: ExternalTrialField) => {
    const item = source.copy[field];
    if (!item || !isPublicText(item.original.text)) return null;
    return { original: item.original, translations: Object.fromEntries(Object.entries(item.translations)
      .filter(([locale, text]) => usableSupplierText(item.original.text, text.text, locale))) };
  };
  const sameModel = (findBrand(facts.make)?.catalogId ?? facts.make?.id) === (findBrand(source.facts.make)?.catalogId ?? source.facts.make?.id) &&
    facts.model?.id === source.facts.model?.id && facts.model?.name === source.facts.model?.name;
  return ExternalCopySchema.parse({ title: copy('title'), model: sameModel && facts.model ? copy('model') : null, description: copy('description') });
}

export function sourceHashes(source: ExternalUpsertCandidate | null, copy?: Copy) {
  const result: Record<ExternalTrialField, string | null> = { title: null, model: null, description: null };
  if (!source) return result;
  const content = copy ?? sourceCopy(source);
  const identity = [source.platformId, source.externalId, source.facts.make?.id, source.facts.model?.id];
  for (const field of copyFields) if (content[field]) result[field] = jsonHash([identity, field, content[field].original]);
  return result;
}

export function glossaryModel(source: ExternalUpsertCandidate, locale: Locale, original: Tagged) {
  if (source.facts.make?.id !== 'toyota' || source.facts.model?.id !== 'synthetic-r1' || original.contentLocale !== 'zh' || original.text !== '示例 R1') return null;
  return { zh: '示例 R1', en: 'Example R1', ru: 'Пример R1' }[locale];
}

function effectiveFacts(source: ExternalUpsertCandidate, overrides: ExternalOverrides, issues: Map<IssueField, ExternalIssue['code']>): Facts {
  const facts = { ...source.facts, ...overrides.facts };
  for (const field of ExternalFactFieldSchema.options) {
    if (source.disputes.includes(field) && !Object.hasOwn(overrides.facts, field)) {
      issues.set(field, 'conflict');
      Object.assign(facts, { [field]: field === 'powertrain' || field === 'registrationStatus' ? 'unknown' : null });
    }
  }
  for (const field of ['make', 'model', 'trim', 'generation'] as const) {
    if (facts[field] && !isPublicText(facts[field].name)) {
      facts[field] = null;
      issues.set(field, 'invalid');
    }
  }
  const brand = findBrand(facts.make);
  if (facts.make && brand) facts.make = { ...facts.make, id: brand.catalogId };
  if (!facts.make) facts.model = null;
  if (!facts.model) { facts.trim = null; facts.generation = null; }
  if (facts.location) {
    facts.location = { ...facts.location };
    for (const field of ['city', 'displayName'] as const) if (facts.location[field] && !isPublicText(facts.location[field])) {
      facts.location[field] = null;
      issues.set('location', 'invalid');
    }
    if (!facts.location.city && !issues.has('location')) issues.set('location', 'missing');
  }
  for (const field of ExternalFactFieldSchema.options) {
    if (!issues.has(field) && (facts[field] === null || facts[field] === 'unknown')) issues.set(field, 'missing');
  }
  return facts;
}

function referenceCny(source: ExternalUpsertCandidate, issues: Map<IssueField, ExternalIssue['code']>) {
  if (source.disputes.includes('price')) { issues.set('price', 'conflict'); return null; }
  const value = source.price?.cny;
  if (value === null || value === undefined) { issues.set('price', 'missing'); return null; }
  const text = typeof value === 'number' ? String(value) : value;
  // Very large fractional JSON numbers may have lost precision before they reached us.
  if (!MoneySchema.shape.amount.safeParse(text).success || Number(text) <= 0 ||
      (typeof value === 'number' && !Number.isInteger(value) && value > Number.MAX_SAFE_INTEGER / 100)) {
    issues.set('price', 'invalid');
    return null;
  }
  return text;
}

export function displayText(locale: Locale, value: Tagged | null, provenance: NonNullable<DisplayText['provenance']> = 'original'): DisplayText {
  return value ? { status: 'ready', ...value, requestedLocale: locale, provenance, reviewed: false }
    : { status: 'missing', text: null, requestedLocale: locale, contentLocale: null, provenance: null, reviewed: false };
}
export const publicText = (locale: Locale, value: Tagged, kind: PublicText['kind'] = 'original'): PublicText =>
  ({ ...value, requestedLocale: locale, kind, reviewed: false });

function localizedCopy(source: ExternalUpsertCandidate, facts: Facts, copy: Copy, overrides: ExternalOverrides, platform: Tagged, locale: Locale): Localized {
  const hashes = sourceHashes(source, copy);
  const choose = (field: ExternalTrialField) => {
    const item = copy[field];
    if (!item) return null;
    const staff = overrides.text.find(entry => entry.field === field && entry.locale === locale && entry.sourceHash === hashes[field]);
    if (staff) return publicText(locale, { text: staff.text, contentLocale: locale }, 'human');
    if (item.original.contentLocale.split('-')[0] === locale) return publicText(locale, item.original);
    const translated = item.translations[locale];
    return translated ? publicText(locale, translated, 'supplier') : publicText(locale, item.original);
  };
  const name = (text: string | null | undefined) => text ? { text, contentLocale: 'und' } : null;
  const knownBrand = brandLabel(facts.make, locale);
  const model = choose('model');
  const glossary = model?.kind === 'original' && model.contentLocale.split('-')[0] !== locale && copy.model
    ? glossaryModel(source, locale, copy.model.original) : null;
  return {
    title: choose('title') ?? publicText(locale, { text: fallbackTitle[locale], contentLocale: locale }, 'catalog'),
    description: choose('description'),
    display: {
      make: knownBrand ? displayText(locale, { text: knownBrand, contentLocale: locale }, 'catalog') : displayText(locale, name(facts.make?.name)),
      model: glossary ? displayText(locale, { text: glossary, contentLocale: locale }, 'catalog') :
        model ? displayText(locale, { text: model.text, contentLocale: model.contentLocale }, model.kind) : displayText(locale, name(facts.model?.name)),
      trim: displayText(locale, name(facts.trim?.name)), generation: displayText(locale, name(facts.generation?.name)),
      city: displayText(locale, name(facts.location?.city)), location: displayText(locale, name(facts.location?.displayName)),
      platform: displayText(locale, platform), priceIncludes: [], mediaAlt: [],
    },
  };
}

export function buildProjection(source: ExternalUpsertCandidate, overrides: ExternalOverrides, platform: string, profile: ExternalSourceProfile = syntheticProfile) {
  const issues = new Map<IssueField, ExternalIssue['code']>();
  const facts = effectiveFacts(source, overrides, issues);
  const copy = sourceCopy(source, facts);
  for (const field of copyFields) if (field !== 'model' && !copy[field]) {
    issues.set(field, source.disputes.length && source.copy[field] ? 'conflict' : source.copy[field] ? 'invalid' : 'missing');
  }
  const priceCny = referenceCny(source, issues);
  const images = source.images.flatMap(image => {
    const url = publicLink(image.url, 'media', profile);
    if (!url) return [];
    const dimensions = image.width && image.height ? { width: image.width, height: image.height } : { width: null, height: null };
    return [{ ...image, ...dimensions, url, alt: !source.disputes.length && image.alt && isPublicText(image.alt.text) ? image.alt : null }];
  });
  if (images.length !== source.images.length) issues.set('images', 'invalid');
  else if (!images.length) issues.set('images', 'missing');

  const relatedListingUrls = [...new Set(source.relatedListingUrls.flatMap(value => publicLink(value, 'listing', profile) ?? []))];
  if (source.relatedListingUrls.some(value => !publicLink(value, 'listing', profile))) issues.set('relatedListingUrls', 'invalid');
  const safeEntries = (entries: Details['specifications']) => entries.filter(entry => isPublicText(entry.name.text) && isPublicText(entry.value.text));
  const specifications = source.disputes.length ? [] : safeEntries(source.specifications);
  if (source.disputes.includes('specifications') || specifications.length !== source.specifications.length) {
    issues.set('specifications', source.disputes.length ? 'conflict' : 'invalid');
  }
  const reportUrl = publicLink(source.inspection?.reportUrl ?? null, 'report', profile);
  const entries = source.inspection && !source.disputes.length ? safeEntries(source.inspection.entries) : [];
  if (source.inspection && (entries.length !== source.inspection.entries.length || source.inspection.reportUrl && !reportUrl)) {
    issues.set('inspection', source.disputes.length ? 'conflict' : 'invalid');
  }
  const inspection = !source.disputes.length && (reportUrl || entries.length) ? { reportUrl, entries } : null;
  const details: Details = {
    original: { title: copy.title?.original ?? null, model: copy.model?.original ?? null, description: copy.description?.original ?? null },
    specifications, inspection, relatedListingUrls,
  };
  return {
    facts, priceCny, images, details, sourceHashes: sourceHashes(source, copy),
    localized: Object.fromEntries(locales.map(locale => [locale, localizedCopy(source, facts, copy, overrides,
      { text: platform, contentLocale: getPlatform(profile, source.platformId)?.contentLocale ?? 'und' }, locale)])) as Record<Locale, Localized>,
    issues: [...issues].map(([field, code]) => ({ field, code })),
  };
}

export type ExternalProjection = ReturnType<typeof buildProjection>;
