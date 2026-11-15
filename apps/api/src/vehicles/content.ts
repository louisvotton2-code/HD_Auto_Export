import { createHash } from 'node:crypto';
import type { TranslatableField, VehicleDraftInput } from '@hd/contracts/admin';
import { ApiError, conflict } from '../errors.js';
import { isConfigurationCatalogEngine } from './configuration-translation-catalog.js';

export const locales = ['zh','en','ru'] as const;
export const isChineseSource = (language: string) => language.split('-')[0]?.toLowerCase() === 'zh';
export function hasTranslationText<T extends { text: string }>(value: T | undefined | null): value is T {
  return Boolean(value?.text.trim());
}
export const sourceHash = (field: TranslatableField) => createHash('sha256').update(JSON.stringify([field.sourceLanguage, field.sourceText])).digest('hex');

/** Source and human revisions are checked on save; callers cannot write an old result over a newer draft. */
export function normalizeContent(incoming: VehicleDraftInput, previous?: VehicleDraftInput): VehicleDraftInput {
  const result = structuredClone(incoming);
  result.configuration = incoming.configuration === undefined ? previous?.configuration ?? null : incoming.configuration;
  for (const key of ['title','description'] as const) {
    const field = result.content[key]; const old = previous?.content[key];
    if (old && field.sourceVersion !== old.sourceVersion) throw conflict();
    const changed = !!old && sourceHash(field) !== sourceHash(old);
    field.sourceVersion = old ? old.sourceVersion + (changed ? 1 : 0) : 1;
    for (const locale of locales) {
      const translation = field.translations[locale]; const prior = old?.translations[locale];
      if (translation && prior && translation.humanEditVersion !== prior.humanEditVersion) throw conflict();
      if (translation?.kind === 'machine' && hasTranslationText(prior) &&
          (prior.kind === 'human' || (prior.reviewStatus === 'approved' && translation.text !== prior.text))) throw conflict();
      if (!hasTranslationText(translation)) {
        field.translations[locale] = null;
        continue;
      }
      if (isConfigurationCatalogEngine(translation.engineVersion))
        throw new ApiError(400, 'INVALID_REQUEST', 'Catalog provenance is reserved for configuration names.');
      if (translation.kind === 'machine' && !translation.engineVersion)
        throw new ApiError(400, 'INVALID_REQUEST', 'Machine translations require provenance.');
      const textChanged = !prior || translation.text !== prior.text || translation.kind !== prior.kind;
      const reviewed = translation.reviewStatus === 'approved' && (!prior || prior.reviewStatus !== 'approved' || prior.sourceVersion !== translation.sourceVersion);
      translation.humanEditVersion = (prior?.humanEditVersion ?? 0) + (textChanged || reviewed ? 1 : 0);
      if (changed) {
        // Source changes always require a separate review save, even when a client sends approved=true.
        translation.reviewStatus = 'stale';
        translation.sourceVersion = prior?.sourceVersion ?? field.sourceVersion;
      } else if (!old) translation.sourceVersion = field.sourceVersion;
      else if (translation.sourceVersion !== field.sourceVersion) translation.reviewStatus = 'stale';
      if (translation.kind === 'original' && (locale !== field.sourceLanguage.split('-')[0] || translation.text !== field.sourceText)) {
        if (translation.reviewStatus !== 'stale') translation.reviewStatus = 'pending';
      }
    }
    // Refresh a derived Chinese original when its source changes. Explicit saved
    // text survives independently, even if it belongs to an earlier source revision.
    const priorChinese = old?.translations.zh;
    const chinese = field.translations.zh;
    const refreshOriginal = changed && priorChinese?.kind === 'original' &&
      priorChinese.text === old?.sourceText && chinese?.kind === 'original' && chinese.text === priorChinese.text;
    if (isChineseSource(field.sourceLanguage) && field.sourceText?.trim() &&
        (!hasTranslationText(chinese) || refreshOriginal)) {
      field.translations.zh = { text: field.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
        humanEditVersion: (priorChinese?.humanEditVersion ?? 0) + (old ? 1 : 0), engineVersion: null };
    }
  }
  return result;
}
