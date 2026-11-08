import { createHash } from 'node:crypto';
import type { TranslatableField, VehicleDraftInput } from '@hd/contracts/admin';
import { conflict } from '../errors.js';

export const locales = ['zh','en','ru'] as const;
export const sourceHash = (field: TranslatableField) => createHash('sha256').update(JSON.stringify([field.sourceLanguage, field.sourceText])).digest('hex');

/** Source and human revisions are checked on save; callers cannot write an old result over a newer draft. */
export function normalizeContent(incoming: VehicleDraftInput, previous?: VehicleDraftInput): VehicleDraftInput {
  const result = structuredClone(incoming);
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
  }
  return result;
}
