/** Synthetic server state validated by the official contract. No provider or real API is used. */
import { createHash } from 'node:crypto';
import {
  TranslationPlanSchema, TranslationPlanResultSchema, VehicleTranslationBundleSchema, translationRequestCount, getTranslationPlanTextLimit,
  type AdminVehicle, type VehicleLocalization, type VehicleTranslationBundle, type TranslationPlan, type TranslatableField,
} from '@hd/contracts/admin';

export const syntheticHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function translationBundle(vehicle: AdminVehicle, localization: VehicleLocalization): VehicleTranslationBundle {
  const required = [
    ...(['title', 'description'] as const).flatMap(name => vehicle.draft.content[name].sourceText && vehicle.draft.content[name].sourceLanguage.split('-')[0] !== 'zh' ? [`content.${name}`] : []),
    ...localization.data.fields.filter(field => field.sourceLanguage.split('-')[0] !== 'zh').map(field => field.ref),
  ];
  return VehicleTranslationBundleSchema.parse({ vehicle, localization: { ...localization, vehicleVersion: vehicle.version }, sourceLanguageConfirmationRequired: required });
}

export function bundleField(bundle: VehicleTranslationBundle, ref: string): TranslatableField & { sourceHash?: string } {
  if (ref === 'content.title') return bundle.vehicle.draft.content.title;
  if (ref === 'content.description') return bundle.vehicle.draft.content.description;
  const field = bundle.localization.data.fields.find(field => field.ref === ref);
  if (!field) throw new Error(`Missing synthetic field ${ref}`);
  return field;
}

export function translationPlan(bundle: VehicleTranslationBundle, id = '70000000-0000-4000-8000-000000000001'): TranslationPlan {
  const fields = [
    ...(['title', 'description'] as const).flatMap(name => {
      const source = bundle.vehicle.draft.content[name];
      return source.sourceText ? [{ ref: `content.${name}`, sourceText: source.sourceText, sourceVersion: source.sourceVersion,
        sourceHash: syntheticHash([source.sourceLanguage, source.sourceText]), mode: 'translate', sourceCharacters: source.sourceText.length }] : [];
    }),
    ...bundle.localization.data.fields.map(field => ({ ref: field.ref, sourceText: field.sourceText, sourceVersion: field.sourceVersion,
      sourceHash: field.sourceHash, mode: 'translate', sourceCharacters: field.sourceText.length })),
  ];
  const now = Date.now();
  return TranslationPlanSchema.parse({ id, vehicleId: bundle.vehicle.id, vehicleVersion: bundle.vehicle.version,
    localizationRevision: bundle.localization.revision, sourceFingerprint: syntheticHash([bundle.vehicle.version, bundle.vehicle.draft.content, bundle.vehicle.draft.configuration ?? null, bundle.localization]),
    sourceLanguage: 'zh', targetLocales: ['en', 'ru'], provider: 'libretranslate', engineVersion: 'fixture-machine-translation-v1', fields,
    estimate: { characterBasis: 'utf16_upper_bound', maximumCharacters: fields.reduce((sum, field) => sum + field.sourceCharacters * 2, 0),
      maximumRequests: fields.reduce((sum, field) => sum + translationRequestCount(field.sourceText) * 2, 0), hourlyCharacterLimit: 50_000,
      cost: { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null } },
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() });
}

export function translationResult(bundle: VehicleTranslationBundle, plan = translationPlan(bundle)) {
  return TranslationPlanResultSchema.parse({ planId: plan.id, vehicleId: plan.vehicleId, vehicleVersion: plan.vehicleVersion,
    localizationRevision: plan.localizationRevision, sourceFingerprint: plan.sourceFingerprint, status: 'completed', failures: [],
    fields: plan.fields.map(field => {
      const source = bundleField(bundle, field.ref);
      const targetHumanEditVersions = { zh: source.translations.zh?.humanEditVersion ?? null,
        en: source.translations.en?.humanEditVersion ?? null, ru: source.translations.ru?.humanEditVersion ?? null };
      return { ...field, targetHumanEditVersions, translations: Object.fromEntries((['zh', 'en', 'ru'] as const).map(locale => [locale, {
        text: locale === 'zh' ? field.sourceText : locale === 'en' ? field.ref === 'content.title' ? 'Machine generated title' : field.ref === 'content.description' ? 'Machine generated description' : `Synthetic English ${field.ref}`.slice(0, getTranslationPlanTextLimit(field.ref))
          : field.ref === 'content.title' ? 'Машинный заголовок' : field.ref === 'content.description' ? 'Машинное описание' : `Тестовый перевод ${field.ref}`.slice(0, getTranslationPlanTextLimit(field.ref)),
        kind: locale === 'zh' ? 'original' : 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
        humanEditVersion: targetHumanEditVersions[locale] ?? 0, engineVersion: locale === 'zh' ? null : plan.engineVersion,
      }])) };
    }) });
}
