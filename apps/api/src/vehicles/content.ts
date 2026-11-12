import { createHash } from 'node:crypto';
import type { TranslatableField, VehicleDraftInput } from '@hd/contracts/admin';
import { conflict } from '../errors.js';

export const locales = ['zh','en','ru'] as const;
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
      if (!translation) continue;
      if (old && prior && translation.humanEditVersion !== prior.humanEditVersion) throw conflict();
      if (old && translation.sourceVersion !== old.sourceVersion && translation.sourceVersion !== field.sourceVersion && translation.sourceVersion !== prior?.sourceVersion) throw conflict();
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
    // Chinese is the authoritative source, not an independently editable translation.
    // Preserve legacy language declarations until an explicit source-language confirmation.
    if (field.sourceLanguage === 'zh' && field.sourceText !== null &&
      (changed || !field.translations.zh || field.translations.zh.text !== field.sourceText || field.translations.zh.sourceVersion !== field.sourceVersion)) {
      field.translations.zh = { text: field.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
        humanEditVersion: (old?.translations.zh?.humanEditVersion ?? 0) + (old ? 1 : 0), engineVersion: null };
    }
  }
  return result;
}
