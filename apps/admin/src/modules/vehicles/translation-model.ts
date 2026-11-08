import type { LocalizedText, Locale, TranslatableField } from '@hd/contracts/admin';

export const translationLocales = ['zh', 'en', 'ru'] as const;
export const translationLocaleLabels = { zh: '中文', en: '英文', ru: '俄文' };
export type TranslationReviewState = 'empty' | LocalizedText['reviewStatus'];

/** Match the existing source form: preserve untouched source whitespace; normalize only new edits. */
export function translationSource(field: TranslatableField, sourceText: string, sourceLanguage: string) {
  const text = sourceText === (field.sourceText ?? '') ? field.sourceText : sourceText.trim() || null;
  const language = sourceLanguage === field.sourceLanguage ? field.sourceLanguage : sourceLanguage.trim();
  return { text, language, changed: text !== field.sourceText || language !== field.sourceLanguage };
}

function canBeOriginal(locale: Locale, text: string, source: ReturnType<typeof translationSource>) {
  return locale === source.language.split('-')[0] && text === source.text;
}

/** Keep the server's source and human revisions; the server increments them after a successful save. */
export function prepareTranslationField(field: TranslatableField, sourceText: string, sourceLanguage: string): TranslatableField {
  const source = translationSource(field, sourceText, sourceLanguage);
  const result = structuredClone(field);
  result.sourceText = source.text;
  result.sourceLanguage = source.language;
  if (source.changed) {
    for (const locale of translationLocales) {
      const translation = result.translations[locale];
      if (translation) translation.reviewStatus = 'stale';
    }
  }
  return result;
}

export function editTranslation(
  field: TranslatableField, locale: Locale, text: string, sourceText: string, sourceLanguage: string,
  savedHumanEditVersion?: number,
): TranslatableField {
  const prior = field.translations[locale];
  if (text === (prior?.text ?? '')) return field;
  const source = translationSource(field, sourceText, sourceLanguage);
  const translation: LocalizedText | null = !text.trim() ? null : {
    text,
    kind: canBeOriginal(locale, text, source) ? 'original' : 'human',
    reviewStatus: source.changed ? 'stale' : 'pending',
    sourceVersion: field.sourceVersion,
    humanEditVersion: prior?.humanEditVersion ?? savedHumanEditVersion ?? 0,
    engineVersion: null,
  };
  return { ...field, translations: { ...field.translations, [locale]: translation } };
}

export function translationReviewState(
  field: TranslatableField, locale: Locale, sourceText: string, sourceLanguage: string,
): TranslationReviewState {
  const translation = field.translations[locale];
  if (!translation) return 'empty';
  const source = translationSource(field, sourceText, sourceLanguage);
  if (source.changed || translation.sourceVersion !== field.sourceVersion) return 'stale';
  if (translation.kind === 'original' && !canBeOriginal(locale, translation.text, source)) return 'pending';
  return translation.reviewStatus;
}

/** Approval is a separate explicit action after the current source has been saved. */
export function approveTranslation(
  field: TranslatableField, locale: Locale, approved: boolean, sourceText: string, sourceLanguage: string,
): TranslatableField {
  const prior = field.translations[locale];
  const source = translationSource(field, sourceText, sourceLanguage);
  if (!prior || !prior.text.trim() || source.changed) return field;
  const invalidOriginal = prior.kind === 'original' && !canBeOriginal(locale, prior.text, source);
  const translation: LocalizedText = {
    ...prior,
    kind: invalidOriginal ? 'human' : prior.kind,
    engineVersion: invalidOriginal ? null : prior.engineVersion,
    reviewStatus: approved ? 'approved' : 'pending',
    sourceVersion: field.sourceVersion,
  };
  return { ...field, translations: { ...field.translations, [locale]: translation } };
}
