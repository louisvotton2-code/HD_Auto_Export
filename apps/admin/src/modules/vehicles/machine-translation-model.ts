import type { AdminVehicle, VehicleDraftInput, VehicleTranslationSuggestions } from '@hd/contracts/admin';

export class TranslationContextChanged extends Error {}
const locales = ['zh', 'en', 'ru'] as const;

export async function translationSourceHash(language: string, text: string | null): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([language, text])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Suggestions are never persisted or allowed to replace employee-authored/reviewed content here. */
export async function applyMachineTranslationSuggestions(
  vehicle: AdminVehicle,
  currentContent: VehicleDraftInput['content'],
  suggestions: VehicleTranslationSuggestions,
): Promise<{ content: VehicleDraftInput['content']; applied: number; protected: number }> {
  const changed = () => new TranslationContextChanged('原文或译文版本已变化，本次建议没有覆盖当前内容。请保存并核对后重新生成。');
  if (suggestions.vehicleId !== vehicle.id || suggestions.version !== vehicle.version || JSON.stringify(currentContent) !== JSON.stringify(vehicle.draft.content)) throw changed();
  const content = structuredClone(currentContent);
  let applied = 0; let protectedCount = 0;
  for (const name of ['title', 'description'] as const) {
    const saved = vehicle.draft.content[name];
    const suggestion = suggestions.content[name];
    if (!suggestion) {
      if (saved.sourceText !== null || Object.values(saved.translations).some(Boolean)) throw changed();
      continue;
    }
    if (saved.sourceLanguage.split('-')[0] !== 'zh' || suggestion.sourceLanguage !== saved.sourceLanguage || suggestion.sourceText !== saved.sourceText || suggestion.sourceVersion !== saved.sourceVersion || suggestion.sourceHash !== await translationSourceHash(saved.sourceLanguage, saved.sourceText)) throw changed();
    for (const locale of locales) {
      const prior = saved.translations[locale];
      const next = suggestion.translations[locale];
      if (suggestion.targetHumanEditVersions[locale] !== (prior?.humanEditVersion ?? null) || next.humanEditVersion !== (prior?.humanEditVersion ?? 0) || next.sourceVersion !== saved.sourceVersion) throw changed();
      if (locale === 'zh' && next.text !== saved.sourceText || locale !== 'zh' && next.engineVersion !== suggestions.engineVersion) throw changed();
      if (prior?.kind === 'human' || prior?.reviewStatus === 'approved') { protectedCount += 1; continue; }
      content[name].translations[locale] = structuredClone(next);
      applied += 1;
    }
  }
  return { content, applied, protected: protectedCount };
}
