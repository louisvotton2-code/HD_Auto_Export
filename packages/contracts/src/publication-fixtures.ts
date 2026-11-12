/** Synthetic authenticated previews only; these are never production inventory. */
import type { Locale } from './common.js';
import { PublicationPreviewSchema, PublishReadinessSchema, type PublicationPreviewText } from './publication.js';

export function makePublicationPreviewFixture(locale: Locale = 'zh', scenario: 'ready' | 'incomplete' | 'stale' | 'machine' = 'ready') {
  const text = (value: string): PublicationPreviewText => ({ text: value, requestedLocale: locale,
    contentLocale: locale, kind: locale === 'zh' ? 'original' : 'human', reviewStatus: 'approved', sourceVersion: 1 });
  const missing: PublicationPreviewText = { text: null, requestedLocale: locale, contentLocale: null,
    kind: null, reviewStatus: 'missing', sourceVersion: null };
  const title = text(({ zh: '测试车源', en: 'Test vehicle', ru: 'Тестовый автомобиль' })[locale]);
  if (scenario === 'stale') title.reviewStatus = 'stale';
  if (scenario === 'machine') { title.kind = 'machine'; title.reviewStatus = 'pending'; }
  return PublicationPreviewSchema.parse({ schemaVersion: 1, vehicleVersion: 4, publicContentRevision: 3,
    fingerprint: 'a'.repeat(64), locale, priceView: 'usd', vehicle: {
      id: '00000000-0000-4000-8000-000000000001', stockCode: 'FIXTURE-0001', source: { kind: 'manual' },
      facts: { make: { id: 'toyota', name: 'Toyota' }, model: { id: 'camry', name: 'Camry' },
        trim: { id: 'test', name: 'Test trim' }, modelYear: 2024, manufacturedAt: null,
        firstRegistration: null, registrationStatus: 'registered', mileageKm: 0, powertrain: 'petrol',
        engineCc: null, powerKw: null, body: 'sedan', transmission: 'automatic',
        location: { country: 'CN', city: null, displayName: null }, generation: null, drivetrain: null },
      content: { title: scenario === 'incomplete' ? missing : title,
        description: scenario === 'incomplete' ? missing : text('Synthetic fixture for preview only.') },
      display: { make: text('Toyota'), model: text('Camry'), trim: text('Test trim'), generation: missing,
        city: missing, location: missing, platform: missing, priceIncludes: [], mediaAlt: [] },
      price: scenario === 'incomplete' ? { kind: 'asking', money: { amount: null, currency: 'CNY' },
        includes: [], status: 'missing', displayPrice: null } : { kind: 'asking',
        money: { amount: '20000', currency: 'USD' }, includes: [], status: 'ready',
        displayPrice: { status: 'ready', kind: 'asking', money: { amount: '20000', currency: 'USD' }, conversion: null } },
      images: scenario === 'incomplete' ? [] : [{ id: '00000000-0000-4000-8000-000000000002',
        url: '/api/v1/admin/media/00000000-0000-4000-8000-000000000002/preview', alt: '',
        sortOrder: 0, isCover: true, width: 800, height: 600, status: 'ready' }],
      availability: 'available', availabilityCheckedAt: '2026-11-12T00:00:00Z',
    } });
}

export function makePublishReadinessFixture(confirmed = false) {
  const preview = makePublicationPreviewFixture();
  return PublishReadinessSchema.parse({ schemaVersion: 1, vehicleId: preview.vehicle.id,
    vehicleVersion: preview.vehicleVersion, publicContentRevision: preview.publicContentRevision,
    fingerprint: preview.fingerprint, locale: preview.locale,
    requiredFieldsReady: true, localizationReady: true, previewConfirmed: confirmed, canPublish: confirmed,
    issues: confirmed ? [] : [{ stage: 'preview', path: 'publicationPreview', code: 'PREVIEW_CONFIRMATION_REQUIRED',
      message: 'Confirm the current publication preview before publishing.' }],
    confirmation: confirmed ? { locale: 'zh', confirmedAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T00:10:00Z' } : null,
  });
}
