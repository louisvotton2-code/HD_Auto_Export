import { expect, type APIResponse, type Page, type Request } from '@playwright/test';
import {
  CreateTranslationPlanRequestSchema, SaveVehicleTranslationBundleSchema, TranslationPlanResponseSchema,
  TranslationPlanStatusResponseSchema, VehicleConfigurationSchema, VehicleTranslationBundleResponseSchema,
  vehicleConfigurationItemId, type AdminVehicle, type VehicleTranslationBundle,
} from '@hd/contracts/admin';
import type { Locale, PublicVehicle } from '@hd/contracts/public';
import { tab } from './ui-helpers';

// These helpers exercise the real API through the isolated runner. They never install API routes,
// fabricate preview receipts, call a translation provider, or write directly to the database.
type LiveRead = (path: string) => Promise<APIResponse>;
export const liveConfiguration = VehicleConfigurationSchema.parse({
  version: 1, items: [{ name: '座位数', value: '5' }, { name: '内饰说明', value: '合成织物座椅' }],
});

export async function enterLiveConfiguration(page: Page) {
  await tab(page, '车辆配置');
  await page.getByLabel('配置内容（JSON）', { exact: true }).fill(JSON.stringify(liveConfiguration, null, 2));
  await expect(page.getByLabel('配置内容（JSON）', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');
}

export async function readLiveBundle(id: string, read: LiveRead) {
  const response = await read(`/api/v1/admin/vehicles/${id}/translation-bundle`);
  expect(response.status()).toBe(200);
  return VehicleTranslationBundleResponseSchema.parse(await response.json()).data;
}

export async function saveLiveBundle(page: Page, id: string) {
  const result = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/api/v1/admin/vehicles/${id}/translation-bundle`);
  await expect(page.getByTestId('translation-bundle-save')).toBeEnabled();
  await page.getByTestId('translation-bundle-save').click();
  const response = await result;
  expect(response.status()).toBe(200);
  const input = SaveVehicleTranslationBundleSchema.parse(response.request().postDataJSON());
  const bundle = VehicleTranslationBundleResponseSchema.parse(await response.json()).data;
  expect(bundle.vehicle.id).toBe(id);
  expect(bundle.vehicle.version).toBe(input.version + 1);
  expect(bundle.localization.revision).toBe(input.localizationRevision + 1);
  await expect(page.getByTestId('translation-bundle-save')).toBeDisabled();
  return { bundle, input };
}

export async function expandLiveTranslationGroup(page: Page, label: string) {
  const header = page.locator('.ant-collapse-header').filter({ has: page.getByText(label, { exact: true }) });
  await expect(header).toHaveCount(1);
  if (await header.getAttribute('aria-expanded') === 'false') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
}

function groupFor(ref: string) {
  return ref.startsWith('configuration.') ? '车辆配置译文' : ref.startsWith('media.') ? '图片说明'
    : ref.startsWith('price.includes.') ? '价格包含项目' : '车辆展示资料';
}
function labelFor(ref: string, bundle: VehicleTranslationBundle) {
  const labels: Record<string, string> = { make: '品牌名称', model: '车型名称', trim: '配置名称', generation: '代系名称', 'location.city': '所在地城市', 'location.displayName': '所在地说明', 'source.platform': '来源平台名称' };
  if (labels[ref]) return labels[ref];
  if (ref.startsWith('configuration.')) {
    const item = bundle.vehicle.draft.configuration?.items.find(item => ref.startsWith(`configuration.${vehicleConfigurationItemId(item.name)}.`));
    expect(item, 'The live configuration ref must identify an actual saved item').toBeTruthy();
    return `${item!.name} · ${ref.endsWith('.name') ? '配置名称' : '配置内容'}`;
  }
  if (ref.startsWith('media.')) {
    const index = [...bundle.vehicle.draft.media].sort((a, b) => a.sortOrder - b.sortOrder).findIndex(image => ref === `media.${image.id}.alt`);
    expect(index).toBeGreaterThanOrEqual(0);
    return `图片 ${index + 1} 说明`;
  }
  if (ref.startsWith('price.includes.')) return `费用条目 ${bundle.localization.data.fields.filter(field => field.ref.startsWith('price.includes.')).findIndex(field => field.ref === ref) + 1}`;
  throw new Error(`Unexpected live display field: ${ref}`);
}

type Targets = { en: string; ru: string };
function syntheticDisplayTargets(ref: string): Targets {
  // Configuration translations preserve all fact tokens. In particular, the numeric value "5"
  // has no translation ref and must remain the server's original neutral value in every locale.
  const configuration: Record<string, Targets> = {
    [`configuration.${vehicleConfigurationItemId('座位数')}.name`]: { en: 'Seats', ru: 'Количество мест' },
    [`configuration.${vehicleConfigurationItemId('内饰说明')}.name`]: { en: 'Interior description', ru: 'Описание салона' },
    [`configuration.${vehicleConfigurationItemId('内饰说明')}.value`]: { en: 'Synthetic fabric seats', ru: 'Синтетические тканевые сиденья' },
  };
  if (ref.startsWith('configuration.')) {
    expect(configuration[ref], 'Only known synthetic configuration fields may be translated by this helper').toBeTruthy();
    return configuration[ref]!;
  }
  return { en: 'Synthetic display text', ru: 'Синтетический текст' };
}

export function assertLivePublicConfiguration(value: PublicVehicle['configuration'], locale: Locale) {
  expect(value?.version).toBe(1);
  expect(value?.items).toHaveLength(liveConfiguration.items.length);
  for (const source of liveConfiguration.items) {
    const id = vehicleConfigurationItemId(source.name);
    const item = value!.items.find(item => item.id === id);
    expect(item).toBeTruthy();
    expect(item!.name).toMatchObject({ status: 'ready', text: locale === 'zh' ? source.name : syntheticDisplayTargets(`configuration.${id}.name`)[locale],
      contentLocale: locale, provenance: locale === 'zh' ? 'original' : 'human', reviewed: false });
    expect(item!.value).toMatchObject(source.name === '座位数'
      ? { status: 'ready', text: '5', contentLocale: 'und', provenance: 'original', reviewed: false }
      : { status: 'ready', text: locale === 'zh' ? source.value : syntheticDisplayTargets(`configuration.${id}.value`)[locale],
        contentLocale: locale, provenance: locale === 'zh' ? 'original' : 'human', reviewed: false });
  }
}
/** Manually enter the synthetic translations once; never mislabel them as approved or machine output. */
export async function completeLiveTranslations(page: Page, vehicle: AdminVehicle, read: LiveRead, overrides: {
  title?: Targets; description?: Targets; display?: Record<string, Targets>;
} = {}) {
  await tab(page, '公开字段多语');
  let current = await readLiveBundle(vehicle.id, read);
  expect(current.vehicle.version).toBe(vehicle.version);
  await expect(page.getByTestId('vehicle-publish')).toHaveCount(0);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue(vehicle.draft.content.title.sourceText!);
  await expect(page.getByRole('checkbox', { name: /已审核/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /来源语言$/ })).toHaveCount(0);
  if (current.sourceLanguageConfirmationRequired.length) {
    // Legacy imports require one explicit whole-page confirmation before editing translations.
    // The real server decides which refs need confirmation; do not silently relabel any source.
    const required = current.sourceLanguageConfirmationRequired;
    await page.getByTestId('translation-source-confirm').check();
    const confirmed = await saveLiveBundle(page, vehicle.id);
    expect(confirmed.input.sourceLanguageConfirmations).toEqual(required);
    expect(confirmed.bundle.sourceLanguageConfirmationRequired).toEqual([]);
    current = confirmed.bundle;
  }
  const values = {
    title: overrides.title ?? { en: 'Synthetic test vehicle', ru: 'Тестовый автомобиль' },
    description: overrides.description ?? { en: 'Synthetic condition for an isolated test, not real inventory.', ru: 'Синтетическое состояние для изолированного теста, не реальный автомобиль.' },
  };
  for (const [name, label] of [['title', '标题'], ['description', '描述']] as const) {
    const source = current.vehicle.draft.content[name];
    if (!source.sourceText?.trim()) continue;
    expect(source.sourceLanguage).toBe('zh');
    await expect(page.getByLabel(`${label}原文（只读）`, { exact: true })).toHaveValue(source.sourceText);
    await page.getByLabel(`英文${label}`, { exact: true }).fill(values[name].en);
    await page.getByLabel(`俄文${label}`, { exact: true }).fill(values[name].ru);
  }
  const fields = current.localization.data.fields;
  for (const group of new Set(fields.map(field => groupFor(field.ref)))) {
    await expandLiveTranslationGroup(page, group);
    for (const field of fields) {
      if (groupFor(field.ref) !== group) continue;
      expect(field.sourceLanguage).toBe('zh');
      const label = labelFor(field.ref, current);
      await expect(page.getByLabel(`${label}原文（只读）`, { exact: true })).toHaveValue(field.sourceText);
      const target = overrides.display?.[field.ref] ?? syntheticDisplayTargets(field.ref);
      await page.getByLabel(`英文${label}`, { exact: true }).fill(target.en);
      await page.getByLabel(`俄文${label}`, { exact: true }).fill(target.ru);
    }
  }
  const saved = await saveLiveBundle(page, vehicle.id);
  expect(saved.input.version).toBe(current.vehicle.version);
  expect(saved.input.localizationRevision).toBe(current.localization.revision);
  expect(saved.bundle.vehicle.draft.configuration).toEqual(current.vehicle.draft.configuration);
  for (const field of [...Object.values(saved.bundle.vehicle.draft.content), ...saved.bundle.localization.data.fields]) {
    if (!field.sourceText?.trim()) continue;
    expect(field.sourceLanguage).toBe('zh');
    for (const locale of ['zh', 'en', 'ru'] as const) expect(field.translations[locale]).toMatchObject({
      text: locale === 'zh' ? field.sourceText : expect.any(String),
      kind: locale === 'zh' ? 'original' : 'human', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
    });
  }
  for (const name of ['title', 'description'] as const) {
    const field = saved.bundle.vehicle.draft.content[name];
    if (field.sourceText?.trim()) for (const locale of ['en', 'ru'] as const) expect(field.translations[locale]?.text).toBe(values[name][locale]);
  }
  for (const field of saved.bundle.localization.data.fields) {
    const targets = overrides.display?.[field.ref] ?? syntheticDisplayTargets(field.ref);
    for (const locale of ['en', 'ru'] as const) expect(field.translations[locale]?.text).toBe(targets[locale]);
  }
  return saved.bundle;
}

/** A real disabled plan is an estimate only. Its API/UI must never authorize a provider execution. */
export async function assertDisabledLivePlan(page: Page, before: VehicleTranslationBundle, read: LiveRead) {
  expect(process.env.ADMIN_LIVE_TRANSLATION_PROVIDER).toBe('disabled');
  expect(process.env.TRANSLATION_PROVIDER).toBe('disabled');
  const root = `/api/v1/admin/vehicles/${before.vehicle.id}`;
  const executions: string[] = [];
  const observe = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.startsWith(`${root}/`) && (path.endsWith('/generate') || path.endsWith('/translation-suggestions'))) executions.push(path);
  };
  page.on('request', observe);
  try {
    await tab(page, '公开字段多语');
    const result = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `${root}/translation-plans`);
    await page.getByTestId('vehicle-translation-generate').click();
    const response = await result; expect(response.status()).toBe(200);
    expect(CreateTranslationPlanRequestSchema.parse(response.request().postDataJSON())).toEqual({ version: before.vehicle.version });
    const plan = TranslationPlanResponseSchema.parse(await response.json()).data;
    expect(plan).toMatchObject({ vehicleId: before.vehicle.id, vehicleVersion: before.vehicle.version, localizationRevision: before.localization.revision,
      sourceLanguage: 'zh', targetLocales: ['en', 'ru'], provider: 'disabled', engineVersion: null,
      estimate: { cost: { status: 'unknown', amount: null, currency: null, freeAllowanceCharacters: null } } });
    const expectedRefs = [...(['title', 'description'] as const).filter(name => before.vehicle.draft.content[name].sourceText?.trim()).map(name => `content.${name}`), ...before.localization.data.fields.map(field => field.ref)];
    expect(plan.fields.map(field => field.ref).sort()).toEqual(expectedRefs.sort());
    await expect(page.getByTestId('translation-plan-confirmation')).toBeVisible();
    await expect(page.getByTestId('translation-generate-confirm')).toBeDisabled();
    await expect(page.getByTestId('translation-plan-start')).toBeDisabled();
    const statusResponse = await read(`${root}/translation-plans/${plan.id}`);
    expect(statusResponse.status()).toBe(200);
    expect(TranslationPlanStatusResponseSchema.parse(await statusResponse.json()).data).toEqual({ planId: plan.id, vehicleId: before.vehicle.id, state: 'ready', result: null, startedAt: null, finishedAt: null });
    await page.getByRole('dialog').getByRole('button', { name: /取\s*消$/ }).click();
    expect(await readLiveBundle(before.vehicle.id, read)).toEqual(before);
    expect(executions).toEqual([]);
    return plan;
  } finally { page.off('request', observe); }
}
