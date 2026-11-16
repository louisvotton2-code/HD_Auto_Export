import { expect, type APIResponse, type Page } from '@playwright/test';
import {
  ConfigurationImportPreviewRequestSchema, ConfigurationImportPreviewResponseSchema, ConfigurationImportSaveRequestSchema,
  VehicleTranslationBundleResponseSchema, parseConfigurationImportJson, vehicleConfigurationItemId, type AdminVehicle, type ConfigurationImportDocument,
} from '@hd/contracts/admin';
import type { Locale, PublicVehicle } from '@hd/contracts/public';
import { tab } from './ui-helpers';

// These helpers exercise the real API through the isolated runner. They never install API routes,
// fabricate preview receipts, call a translation provider, or write directly to the database.
type LiveRead = (path: string) => Promise<APIResponse>;
type LocaleTexts = Record<Locale, string>;
type ImportOptions = Pick<ConfigurationImportDocument, 'items' | 'facts'> & {
  title?: Omit<LocaleTexts, 'zh'>;
  description?: LocaleTexts;
  display?: Record<string, LocaleTexts>;
};

export function liveConfigurationItem(name: LocaleTexts, value: LocaleTexts) {
  return { id: vehicleConfigurationItemId(name.zh), name, value };
}

export const liveConfiguration = [
  liveConfigurationItem({ zh: '座位数', en: 'Seats', ru: 'Количество мест' }, { zh: '5', en: '5', ru: '5' }),
  liveConfigurationItem({ zh: '内饰说明', en: 'Interior description', ru: 'Описание салона' },
    { zh: '合成织物座椅', en: 'Synthetic fabric seats', ru: 'Синтетические тканевые сиденья' }),
];

export function configurationJson(page: Page) {
  return page.getByRole('textbox', { name: '三语 JSON', exact: true });
}

export function previewConfigurationButton(page: Page) {
  return page.getByRole('button', { name: '预览导入变更', exact: true });
}

export function confirmConfigurationButton(page: Page) {
  return page.getByRole('button', { name: '确认并保存三语资料', exact: true });
}

export async function readLiveBundle(id: string, read: LiveRead) {
  const response = await read(`/api/v1/admin/vehicles/${id}/translation-bundle`);
  expect(response.status()).toBe(200);
  return VehicleTranslationBundleResponseSchema.parse(await response.json()).data;
}

type PreviewOptions = { omitItemIds?: boolean };

export async function previewLiveImport(page: Page, id: string, document: ConfigurationImportDocument, options: PreviewOptions = {}) {
  await tab(page, '车辆配置');
  const source = options.omitItemIds
    ? { ...document, items: document.items?.map(({ name, value }) => ({ name, value })) }
    : document;
  const json = JSON.stringify(source, null, 2);
  await configurationJson(page).fill(json);
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v1/admin/vehicles/${id}/configuration-import/preview`),
    previewConfigurationButton(page).click(),
  ]);
  expect(response.status()).toBe(200);
  const input = ConfigurationImportPreviewRequestSchema.parse(response.request().postDataJSON());
  const preview = ConfigurationImportPreviewResponseSchema.parse(await response.json()).data;
  expect(parseConfigurationImportJson(input.json)).toEqual(document);
  expect(preview).toMatchObject({ version: input.version, localizationRevision: input.localizationRevision });
  await expect(confirmConfigurationButton(page)).toBeEnabled();
  return { input, preview };
}

export async function importLiveConfiguration(page: Page, vehicle: AdminVehicle, document: ConfigurationImportDocument, options?: PreviewOptions) {
  const { input, preview } = await previewLiveImport(page, vehicle.id, document, options);
  expect(input.version).toBe(vehicle.version);
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/v1/admin/vehicles/${vehicle.id}/configuration-import`),
    confirmConfigurationButton(page).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(ConfigurationImportSaveRequestSchema.parse(response.request().postDataJSON())).toEqual({ ...input, previewToken: preview.previewToken });
  const bundle = VehicleTranslationBundleResponseSchema.parse(await response.json()).data;
  expect(bundle.vehicle).toMatchObject({ id: vehicle.id, version: vehicle.version + 1 });
  expect(bundle.localization.revision).toBe(input.localizationRevision + 1);
  expect(bundle.vehicle.draft.configuration).toEqual(document.items
    ? { version: 1, items: document.items.map(({ name, value }) => ({ name: name.zh, value: value.zh })) }
    : vehicle.draft.configuration);
  await expect(configurationJson(page)).toHaveValue('');
  await expect(confirmConfigurationButton(page)).toHaveCount(0);
  return bundle;
}

export function assertLivePublicConfiguration(value: PublicVehicle['configuration'], locale: Locale, config = liveConfiguration) {
  expect(value?.version).toBe(1);
  expect(value?.items).toHaveLength(config.length);
  for (const source of config) {
    const item = value!.items.find(item => item.id === source.id);
    expect(item).toBeTruthy();
    expect(item!.name).toMatchObject({ status: 'ready', text: source.name[locale],
      contentLocale: locale, provenance: locale === 'zh' ? 'original' : 'human', reviewed: false });
    expect(item!.value).toMatchObject(source.value.zh === '5'
      ? { status: 'ready', text: '5', contentLocale: 'und', provenance: 'original', reviewed: false }
      : { status: 'ready', text: source.value[locale],
        contentLocale: locale, provenance: locale === 'zh' ? 'original' : 'human', reviewed: false });
  }
}

export async function importLiveVehicleDetails(page: Page, vehicle: AdminVehicle, read: LiveRead, options: ImportOptions = {}) {
  const current = await readLiveBundle(vehicle.id, read);
  expect(current.vehicle.version).toBe(vehicle.version);
  const originalTitle = vehicle.draft.content.title.sourceText;
  expect(originalTitle).toBeTruthy();
  const title = { zh: originalTitle!, ...options.title ?? { en: 'Synthetic test vehicle', ru: 'Тестовый автомобиль' } };
  const originalDescription = vehicle.draft.content.description.sourceText;
  const description = options.description ?? (originalDescription?.trim() ? {
    zh: originalDescription, en: 'Synthetic condition for an isolated test, not real inventory.',
    ru: 'Синтетическое состояние для изолированного теста, не реальный автомобиль.',
  } : undefined);
  const display = current.localization.data.fields.filter(field => !field.ref.startsWith('configuration.')).map(field => {
    expect(field.sourceLanguage).toBe('zh');
    return { ref: field.ref, text: options.display?.[field.ref] ?? {
      zh: field.sourceText, en: 'Synthetic display text', ru: 'Синтетический текст',
    } };
  });
  const content = { title, description };
  const saved = await importLiveConfiguration(page, vehicle, {
    version: 1, items: options.items, facts: options.facts, content,
    display: display.length ? display : undefined,
  });
  expect(saved.localization.revision).toBe(current.localization.revision + 1);
  if (options.facts) expect(saved.vehicle.draft.facts.powertrain).toBe(options.facts.powertrain);
  for (const name of ['title', 'description'] as const) {
    const text = content[name];
    if (text) expectImportedTexts(saved.vehicle.draft.content[name], text);
  }
  for (const { ref, text } of display) {
    const field = saved.localization.data.fields.find(field => field.ref === ref);
    expect(field, ref).toBeDefined();
    expectImportedTexts(field!, text);
  }
  return saved;
}

function expectImportedTexts(field: AdminVehicle['draft']['content']['title'], text: LocaleTexts) {
  expect(field.sourceLanguage).toBe('zh');
  expect(field.sourceText).toBe(text.zh);
  for (const locale of ['zh', 'en', 'ru'] as const) expect(field.translations[locale]).toMatchObject({
    text: text[locale], kind: locale === 'zh' ? 'original' : 'human', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
  });
}
