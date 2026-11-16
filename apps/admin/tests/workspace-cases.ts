/** Manual public field editing on the vehicle configuration step. */
import { expect, test } from '@playwright/test';
import { vehicleConfigurationItemId, type AdminVehicle } from '@hd/contracts/admin';
import { installApi, localization, vehicle } from './api-fixture';
import { syntheticHash } from './translation-fixture';
import { bundleSave, noReviewControls, openWorkspace, saveBundle } from './translation-test-helpers';
import { fillRequiredVehicleBasics, tab } from './ui-helpers';

const id = '30000000-0000-4000-8000-000000000001';
function record(): AdminVehicle {
  const item = { ...vehicle(), id };
  item.draft.content.title = { sourceLanguage: 'zh', sourceText: '员工自己的中文标题，不按车型拼接', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  item.draft.content.description = { sourceLanguage: 'zh', sourceText: '仅供隔离测试的中文车况描述', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  return item;
}

test('workspace keeps creation and manual public text edits on the configuration step without translation calls', async ({ page }) => {
  const api = await installApi(page, { createdId: id });
  await page.goto('/admin/vehicles/new');
  await fillRequiredVehicleBasics(page, '中文权威原文');
  await page.getByLabel('车况描述', { exact: true }).fill('这段中文只用于合成浏览器验证。');
  await page.getByRole('button', { name: /下一步：车辆配置$/ }).click();
  await expect(page).toHaveURL(new RegExp(`${id}$`));
  await expect(page.getByRole('tab', { name: /车辆配置/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /公开字段多语/ })).toHaveCount(0);
  await expect(page.getByTestId('vehicle-translation-generate')).toHaveCount(0);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue('中文权威原文');
  await expect(page.getByLabel('描述原文（只读）', { exact: true })).toHaveValue('这段中文只用于合成浏览器验证。');
  await page.getByLabel('英文标题', { exact: true }).fill('Synthetic English title');
  const saved = await saveBundle(page);
  expect(saved.vehicle.draft.content.title).toMatchObject({ sourceLanguage: 'zh', sourceText: '中文权威原文',
    translations: { en: { kind: 'human', text: 'Synthetic English title' }, ru: null } });
  expect(api.translationPlans).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});

test('workspace saved historical sources require one explicit whole-workspace Chinese declaration', async ({ page }) => {
  const item = record(); item.draft.content.title.sourceLanguage = 'und'; const api = await installApi(page, { items: [item] });
  await openWorkspace(page, id); await noReviewControls(page);
  expect(api.translationPlans).toEqual([]);
  await page.getByTestId('translation-source-confirm').check(); await expect(bundleSave(page)).toBeEnabled();
  expect(api.bundleSaves).toEqual([]);
  expect(item.draft.content.title.sourceLanguage).toBe('und');
  const saved = await saveBundle(page); expect(api.bundleSaves[0]!.input.sourceLanguageConfirmations).toEqual(['content.title']);
  expect(saved.vehicle.draft.content.title.sourceLanguage).toBe('zh'); expect(saved.vehicle.draft.content.title.sourceVersion).toBe(2);
  expect(api.translationGenerations).toEqual([]);
});

test('workspace blocks translation edits until the new source title is saved', async ({ page }) => {
  const api = await installApi(page, { items: [record()] }); await page.goto(`/admin/vehicles/${id}`);
  await tab(page, '车辆配置'); await expect(page.getByLabel('标题原文（只读）', { exact: true })).toBeVisible();
  await tab(page, '基础资料'); await page.getByLabel('标题原文', { exact: true }).fill('尚未保存的新中文标题'); await tab(page, '车辆配置');
  await expect(page.getByLabel('英文标题', { exact: true })).toBeDisabled();
  expect(api.translationPlans).toEqual([]); expect(api.bundleSaves).toEqual([]);
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => api.saves.length).toBe(1);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue('尚未保存的新中文标题');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveAttribute('readonly', '');
});

test('workspace historical Chinese display text stays editable and can be saved separately from the source', async ({ page }) => {
  const item = record(); item.draft.content.title.translations.zh = { text: '历史错误中文槽', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 7, engineVersion: null };
  item.draft.content.title.translations.en = { text: 'Protected English', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
  item.draft.content.title.translations.ru = { text: 'Сохранённый русский', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 5, engineVersion: null };
  item.draft.content.description.translations.zh = { text: item.draft.content.description.sourceText!, kind: 'original', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 1, engineVersion: null };
  for (const locale of ['en', 'ru'] as const) item.draft.content.description.translations[locale] = {
    text: locale === 'en' ? 'Existing English description' : 'Сохранённое описание',
    kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 1, engineVersion: null,
  };
  const before = structuredClone(item.draft.content.title); const api = await installApi(page, { items: [item], publicationDefaultConfirmed: false });
  await openWorkspace(page, id); await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue(before.sourceText!);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveAttribute('readonly', ''); await expect(page.getByLabel('中文标题', { exact: true })).toHaveValue('历史错误中文槽');
  await noReviewControls(page); await expect(bundleSave(page)).toBeDisabled(); expect(api.bundleSaves).toEqual([]); expect(item.draft.content.title).toEqual(before);
  // Opening historical data is not a local edit and must not create a spurious leave guard.
  await page.getByRole('button', { name: /返回车辆列表$/ }).click(); await expect(page).toHaveURL(/\/vehicles$/); await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWorkspace(page, id);
  await page.getByLabel('中文标题', { exact: true }).fill('核对后的中文展示标题');
  const saved = await saveBundle(page);
  expect(api.bundleSaves).toHaveLength(1); expect(api.bundleSaves[0]!.input.content.title.translations.zh).toMatchObject({ text: '核对后的中文展示标题', kind: 'human' });
  expect(saved.vehicle.draft.content.title).toMatchObject({ sourceText: before.sourceText, sourceVersion: before.sourceVersion,
    translations: { zh: { text: '核对后的中文展示标题', kind: 'human', reviewStatus: 'pending', sourceVersion: before.sourceVersion, engineVersion: null }, en: before.translations.en, ru: before.translations.ru } });
  expect(api.translationGenerations).toEqual([]); expect(api.previewConfirmations).toEqual([]);
});

test('workspace keeps nonblank older wording without counting it as a gap', async ({ page }) => {
  const item = record();
  for (const field of Object.values(item.draft.content)) {
    for (const locale of ['en', 'ru'] as const) field.translations[locale] = {
      text: 'Protected source translation', kind: 'human', reviewStatus: 'pending',
      sourceVersion: field.sourceVersion, humanEditVersion: 1, engineVersion: null,
    };
  }
  item.draft.content.title.sourceVersion = 2;
  item.draft.content.title.translations.en!.sourceVersion = 2;
  item.draft.content.title.translations.ru!.reviewStatus = 'stale';
  const name = '合成座椅配置';
  const ref = `configuration.${vehicleConfigurationItemId(name)}.value`;
  item.draft.configuration = { version: 1, items: [{ name, value: '4向电动调节' }] };
  const saved = localization(item, [{ ref, sourceLanguage: 'zh', sourceText: '4向电动调节', sourceVersion: 2, sourceHash: syntheticHash(ref),
    translations: { zh: null,
      en: { text: '4-way electric adjustment', kind: 'human', reviewStatus: 'pending', sourceVersion: 2, humanEditVersion: 4, engineVersion: null },
      ru: { text: 'Электрорегулировка в 4 направлениях', kind: 'human', reviewStatus: 'stale', sourceVersion: 1, humanEditVersion: 5, engineVersion: null },
    } }]);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  await openWorkspace(page, id);
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue('Protected source translation');
  await page.locator('.ant-collapse-header').filter({ hasText: '车辆配置译文' }).click();
  await expect(page.getByLabel(`俄文${name} · 配置内容`, { exact: true })).toHaveValue('Электрорегулировка в 4 направлениях');
  expect(api.bundleSaves).toEqual([]);
  expect(api.translationPlans).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});
