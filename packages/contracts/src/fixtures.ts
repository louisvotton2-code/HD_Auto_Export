/** Synthetic, isolated examples. Never import these as production inventory. */
import { ApiErrorSchema } from './common.js';
import {
  AdminVehicleSchema, MediaAssetSchema, VehicleDraftInputSchema,
  type TranslatableField, type VehicleDraftInput,
} from './admin.js';
import { PublicVehicleSchema, type PublicVehicle } from './public.js';

const fixtureTime = '2026-11-08T00:00:00Z';
function textField(zh: string, en: string, ru: string): TranslatableField {
  return {
    sourceLanguage: 'zh', sourceText: zh, sourceVersion: 1,
    translations: {
      zh: { text: zh, kind: 'original', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 0, engineVersion: null },
      en: { text: en, kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 1, engineVersion: null },
      ru: { text: ru, kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 1, engineVersion: null },
    },
  };
}

export const vehicleDraftFixture = VehicleDraftInputSchema.parse({
  source: { kind: 'manual' },
  facts: {
    make: { id: 'fixture_make', name: 'Example' },
    model: { id: 'fixture_model', name: 'Sample vehicle' }, trim: null,
    modelYear: 2024, manufacturedAt: { value: '2024-02', precision: 'month' },
    firstRegistration: null, registrationStatus: 'unknown', mileageKm: 12000,
    powertrain: 'petrol', engineCc: 1998, powerKw: 110, body: 'sedan',
    transmission: 'automatic', location: { country: 'CN', city: null, displayName: null },
  },
  price: { kind: 'asking', money: { amount: '23500.00', currency: 'USD' }, includes: ['Vehicle only; fixture'] },
  content: {
    title: textField('测试样例车辆', 'Synthetic test vehicle', 'Тестовый автомобиль'),
    description: textField('仅供开发测试，不是真实库存。', 'Development fixture, not real inventory.', 'Пример для тестирования, не реальное предложение.'),
  },
  media: [{ id: 'fixture_media_1', alt: 'Synthetic test image', sortOrder: 0, isCover: true }],
  internal: { purchaseCost: { amount: '18000.00', currency: 'USD' }, notes: 'INTERNAL_FIXTURE_NOT_PUBLIC', supplierContact: null, vin: null },
});
export function makeVehicleDraftFixture(): VehicleDraftInput {
  return structuredClone(vehicleDraftFixture);
}

export const adminVehicleFixture = AdminVehicleSchema.parse({
  id: 'fixture_vehicle_1', stockCode: 'FIXTURE-0001', version: 1,
  publicationState: 'draft', availability: 'unknown', availabilityCheckedAt: null,
  draft: vehicleDraftFixture, publishedRevisionId: null, publishedAt: null,
  createdAt: fixtureTime, updatedAt: fixtureTime,
});
export const publicVehicleFixture = PublicVehicleSchema.parse({
  id: 'fixture_vehicle_1', stockCode: 'FIXTURE-0001', source: { kind: 'manual' },
  facts: vehicleDraftFixture.facts, price: vehicleDraftFixture.price,
  content: {
    title: { text: 'Тестовый автомобиль', requestedLocale: 'ru', contentLocale: 'ru', kind: 'human' },
    description: { text: 'Пример для тестирования, не реальное предложение.', requestedLocale: 'ru', contentLocale: 'ru', kind: 'human' },
  },
  images: [{ id: 'fixture_media_1', url: '/api/v1/media/fixture_media_1', alt: 'Synthetic test image', width: 800, height: 600, sortOrder: 0, isCover: true }],
  availability: 'available', availabilityCheckedAt: fixtureTime, sourceUpdatedAt: null,
  fetchedAt: null, publishedAt: fixtureTime, detailPath: '/ru/cars/fixture_vehicle_1/',
});
export function makePublicVehicleFixture(): PublicVehicle {
  return structuredClone(publicVehicleFixture);
}

const pendingTranslation = makeVehicleDraftFixture();
pendingTranslation.content.title.translations.ru = {
  text: 'Машинный перевод для проверки', kind: 'machine', reviewStatus: 'pending',
  sourceVersion: 1, humanEditVersion: 0, engineVersion: 'fixture-engine-1',
};
const staleTranslation = makeVehicleDraftFixture();
staleTranslation.content.title.sourceVersion = 2;
staleTranslation.content.title.sourceText = '已修改的测试标题';
staleTranslation.content.title.translations.ru!.reviewStatus = 'stale';
const koreanSource = makeVehicleDraftFixture();
koreanSource.content.title = {
  sourceLanguage: 'ko', sourceText: '테스트 차량', sourceVersion: 1,
  translations: { zh: null, en: null, ru: null },
};

export const contractFixtures = {
  draft: adminVehicleFixture,
  published: publicVehicleFixture,
  onRequest: PublicVehicleSchema.parse({ ...publicVehicleFixture, price: { kind: 'on_request', money: null, includes: [] } }),
  reserved: PublicVehicleSchema.parse({ ...publicVehicleFixture, availability: 'reserved' }),
  sold: PublicVehicleSchema.parse({ ...publicVehicleFixture, availability: 'sold' }),
  archived: AdminVehicleSchema.parse({
    ...adminVehicleFixture, version: 4, publicationState: 'archived',
    publishedRevisionId: 'fixture_revision_1', publishedAt: fixtureTime,
  }),
  missingManufacturedAt: PublicVehicleSchema.parse({ ...publicVehicleFixture, facts: { ...publicVehicleFixture.facts, manufacturedAt: null } }),
  failedMedia: MediaAssetSchema.parse({
    id: 'fixture_media_failed', vehicleId: 'fixture_vehicle_1', version: 2, status: 'failed',
    contentType: 'image/jpeg', sizeBytes: 128, width: null, height: null,
    previewPath: null, createdAt: fixtureTime,
  }),
  versionConflict: ApiErrorSchema.parse({
    error: { code: 'VERSION_CONFLICT', message: 'Reload the current version before saving.', retryable: false },
    meta: { requestId: 'fixture-request-conflict' },
  }),
  pendingTranslation: VehicleDraftInputSchema.parse(pendingTranslation),
  staleTranslation: VehicleDraftInputSchema.parse(staleTranslation),
  untranslatedKorean: VehicleDraftInputSchema.parse(koreanSource),
};
