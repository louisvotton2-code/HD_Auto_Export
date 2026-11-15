/** Unified body/display persistence and recovery simulations, using the public contract only. */
import { expect, test, type Page } from '@playwright/test';
import { DisplayFieldSchema, SaveVehicleTranslationBundleSchema, TranslationPlanStatusSchema, type AdminVehicle, type DisplayField } from '@hd/contracts/admin';
import { envelope, error, installApi, localization, reply, translationBundle, translationResult, vehicle } from './api-fixture';
import { syntheticHash } from './translation-fixture';
import { bundleSave, generateSuggestions, noReviewControls, openWorkspace, planButton, recoverResult, requestPlan, saveBundle } from './translation-test-helpers';
import { notes, select, tab } from './ui-helpers';
import { acknowledgePublicationPreview } from './publication-test-helpers';

const id = '40000000-0000-4000-8000-000000000001';
const path = `/api/v1/admin/vehicles/${id}/translation-bundle`;
function record(): AdminVehicle {
  const item = { ...vehicle(), id }; item.draft.media = [];
  item.draft.content.title = { sourceLanguage: 'zh', sourceText: '独立中文标题', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  item.draft.content.description = { sourceLanguage: 'zh', sourceText: null, sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  item.draft.facts.make = { id: 'toyota', name: '丰田' }; item.draft.facts.model = { id: 'synthetic_model', name: '合成中文车型' };
  item.draft.facts.trim = null; item.draft.facts.location = null; item.draft.price.includes = []; return item;
}
function field(ref: string, sourceText: string, sourceLanguage = 'zh'): DisplayField {
  return DisplayFieldSchema.parse({ ref, sourceLanguage, sourceText, sourceVersion: 1,
    sourceHash: syntheticHash(['synthetic-server-field', ref, sourceText, sourceLanguage]), translations: { zh: null, en: null, ru: null } });
}
async function expand(page: Page, label: string) {
  const input = page.getByLabel(`英文${label}`, { exact: true });
  if (!await input.isVisible()) await page.locator('.ant-collapse-header').filter({ hasText: '车辆展示资料' }).click();
  await expect(input).toBeVisible();
}

test('bundle historical display source declaration is explicit and machine suggestions stay pending until one atomic save', async ({ page }) => {
  const item = record(); const saved = localization(item, [field('model', '合成中文车型', 'und')]);
  const api = await installApi(page, { items: [item], localizations: [saved] }); await openWorkspace(page, id); await noReviewControls(page);
  await expect(planButton(page)).toBeDisabled(); await page.getByTestId('translation-source-confirm').check();
  expect(saved.data.fields[0]!.sourceLanguage).toBe('und'); await expect(planButton(page)).toBeDisabled();
  await saveBundle(page); expect(api.bundleSaves[0]!.input.sourceLanguageConfirmations).toEqual(['model']);
  expect(saved.data.fields[0]).toMatchObject({ sourceLanguage: 'zh', sourceVersion: 2 });
  const before = structuredClone(saved); await generateSuggestions(page); await expand(page, '车型名称');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Synthetic English model');
  expect(saved).toEqual(before); expect(api.bundleSaves).toHaveLength(1);
  const result = await saveBundle(page); expect(api.bundleSaves).toHaveLength(2); expect(api.saves).toEqual([]);
  expect(result.vehicle.draft.content.title.translations.en).toMatchObject({ kind: 'machine', reviewStatus: 'pending' });
  expect(result.localization.data.fields[0]!.translations.en).toMatchObject({ kind: 'machine', reviewStatus: 'pending', sourceVersion: 2 });
});

test('bundle protects historical human and approved display text and their exact target revisions', async ({ page }) => {
  const item = record(); const source = field('model', '合成中文车型');
  source.translations.en = { text: 'Human protected model', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
  source.translations.ru = { text: 'Проверенная модель', kind: 'machine', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 2, engineVersion: 'historic' };
  const before = structuredClone(source.translations); const saved = localization(item, [source]);
  const api = await installApi(page, { items: [item], localizations: [saved] }); await openWorkspace(page, id); await generateSuggestions(page); await expand(page, '车型名称');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Human protected model');
  await expect(page.getByLabel('俄文车型名称', { exact: true })).toHaveValue('Проверенная модель'); await noReviewControls(page);
  await saveBundle(page); expect(api.bundleSaves[0]!.input.localization.fields[0]!.translations).toMatchObject({ en: before.en, ru: before.ru });
  expect(saved.data.fields[0]!.translations.en?.humanEditVersion).toBe(3); expect(saved.data.fields[0]!.translations.ru?.humanEditVersion).toBe(2);
});

for (const mutation of ['source hash', 'target human revision'] as const) {
  test(`bundle recovered suggestions preserve current input after a display ${mutation} changes`, async ({ page }) => {
    const item = record(), saved = localization(item, [field('model', '合成中文车型')]);
    const api = await installApi(page, { items: [item], localizations: [saved] }); let result: ReturnType<typeof translationResult>; let posts = 0;
    await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans/*/generate`, route => { posts++; result = translationResult(translationBundle(item, saved), api.translationPlans[0]!.plan); return route.abort('failed'); });
    await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans/*`, route => {
      if (route.request().method() !== 'GET') return route.fallback(); const now = new Date().toISOString();
      return reply(route, envelope(TranslationPlanStatusSchema.parse({ planId: result.planId, vehicleId: id, state: 'completed', result, startedAt: now, finishedAt: now })));
    });
    await openWorkspace(page, id); await generateSuggestions(page); await expect(recoverResult(page)).toBeEnabled();
    if (mutation === 'source hash') saved.data.fields[0]!.sourceHash = 'b'.repeat(64);
    else saved.data.fields[0]!.translations.en = { text: 'Fresh human edit', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 4, engineVersion: null };
    await recoverResult(page).click(); await expect(page.locator('.ant-alert-error').first()).toBeVisible(); await expand(page, '车型名称');
    await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue(''); expect(posts).toBe(1); expect(api.bundleSaves).toEqual([]);
  });
}

test('bundle conflict retains body and display inputs and cancelling reload does not discard either', async ({ page }) => {
  const item = record(), saved = localization(item, [field('model', '合成中文车型')]);
  const api = await installApi(page, { items: [item], localizations: [saved] }); let puts = 0;
  await page.route(`**${path}`, route => { if (route.request().method() !== 'PUT') return route.fallback(); puts++; return reply(route, error('VERSION_CONFLICT'), 409); });
  await openWorkspace(page, id); await page.getByLabel('英文标题', { exact: true }).fill('Local unsaved title'); await expand(page, '车型名称');
  await page.getByLabel('英文车型名称', { exact: true }).fill('Local unsaved model');
  item.version++; saved.vehicleVersion = item.version; saved.revision++;
  saved.data.fields[0]!.translations.en = { text: 'Remote colleague model', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 1, engineVersion: null };
  await bundleSave(page).click(); await expect(page.locator('.ant-alert-error').first()).toBeVisible();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Local unsaved title');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Local unsaved model');
  await page.getByTestId('translation-save-recover').click();
  await expect(page.getByRole('cell', { name: /Remote colleague model/ })).toBeVisible();
  await expect(bundleSave(page)).toBeDisabled(); expect(puts).toBe(1); expect(api.bundleSaves).toEqual([]);
  await page.getByRole('button', { name: /放弃.*重新读取/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /保留输入/ }).click();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Local unsaved title'); await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Local unsaved model');
});

test('bundle unsaved translations guard navigation and double-click saves body and display in one request', async ({ page }) => {
  const item = record(), saved = localization(item, [field('model', '合成中文车型')]);
  const api = await installApi(page, { items: [item], localizations: [saved] }); let calls = 0, release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${path}`, async route => { if (route.request().method() !== 'PUT') return route.fallback(); calls++; await pause; return route.fallback(); });
  await openWorkspace(page, id); await page.getByLabel('英文标题', { exact: true }).fill('Unsaved title'); await expand(page, '车型名称');
  await page.getByLabel('英文车型名称', { exact: true }).fill('Unsaved model');
  await page.getByRole('button', { name: /返回车辆列表$/ }).click(); await expect(page.getByRole('dialog')).toContainText('离开当前草稿');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(await notes(page)).toBeDisabled(); await expect(page.getByRole('button', { name: /保存草稿$/ })).toHaveCount(0); await expect(page.getByRole('button', { name: '返回多语处理修改', exact: true })).toBeVisible();
  await tab(page, '公开字段多语'); await bundleSave(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect.poll(() => calls).toBe(1); await expect(page.getByLabel('英文标题', { exact: true })).toBeDisabled(); await expect(planButton(page)).toBeDisabled();
  release(); await expect.poll(() => api.bundleSaves.length).toBe(1); await expect(bundleSave(page)).toBeDisabled();
  expect(api.bundleSaves[0]!.input.content.title.translations.en?.text).toBe('Unsaved title');
  expect(api.bundleSaves[0]!.input.localization.fields[0]!.translations.en?.text).toBe('Unsaved model'); expect(api.saves).toEqual([]);
});

test('bundle a delayed old atomic read cannot downgrade a newer vehicle or become its save baseline', async ({ page }) => {
  const item = record(), saved = localization(item, [field('model', '合成中文车型')]);
  const old = structuredClone(translationBundle(item, saved)); item.version = 2; item.draft.content.title.sourceText = '版本二中文标题'; saved.vehicleVersion = 2;
  const api = await installApi(page, { items: [item], localizations: [saved] }); let started = false, release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${path}`, async route => { if (route.request().method() !== 'GET') return route.fallback(); started = true; await pause; return reply(route, envelope(old)); });
  await page.goto(`/admin/vehicles/${id}`); await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('版本二中文标题');
  await tab(page, '公开字段多语'); await expect.poll(() => started).toBe(true); release();
  await expect(page.locator('.ant-alert-error').first()).toBeVisible(); await tab(page, '基础资料');
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('版本二中文标题');
  await page.unroute(`**${path}`); await tab(page, '公开字段多语');
  await page.getByRole('button', { name: /重新读取多语资料$/ }).click();
  await page.getByLabel('英文标题', { exact: true }).fill('Fresh version two title'); await saveBundle(page);
  expect(api.bundleSaves[0]!.input.version).toBe(2); expect(item.version).toBe(3);
});

test('bundle nullable extra facts stay unknown and generation references refresh after an explicit save', async ({ page }) => {
  const item = record(); item.draft.content.title.sourceText = '标题提到四驱E210不等于事实';
  const saved = localization(item, [field('model', '合成中文车型')]); const api = await installApi(page, { items: [item], localizations: [saved] });
  await openWorkspace(page, id); await page.locator('.ant-collapse-header').filter({ hasText: '补充代系与驱动形式' }).click();
  const generationName = page.getByRole('textbox', { name: '代系名称', exact: true });
  await expect(generationName).toHaveValue('');
  expect(saved.data.facts).toEqual({ generation: null, drivetrain: null }); expect(api.bundleSaves).toEqual([]);
  await select(page, '驱动形式', '全轮驱动'); const drivetrainOnly = await saveBundle(page);
  expect(drivetrainOnly.localization.data.facts).toEqual({ generation: null, drivetrain: 'awd' });
  expect(drivetrainOnly.localization.data.fields.map(field => field.ref)).toEqual(['model']);
  await generationName.fill('E210 合成代系'); const created = await saveBundle(page);
  expect(api.bundleSaves[1]!.input.localization.fields.map(field => field.ref)).toEqual(['model']);
  expect(api.bundleSaves[1]!.input.localization.facts).toMatchObject({ generation: { name: 'E210 合成代系' }, drivetrain: 'awd' });
  const createdField = created.localization.data.fields.find(field => field.ref === 'generation')!;
  expect(createdField).toMatchObject({ sourceLanguage: 'zh', sourceText: 'E210 合成代系', sourceVersion: 1,
    translations: { zh: { text: 'E210 合成代系', kind: 'original', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 0, engineVersion: null }, en: null, ru: null } });
  await expand(page, '代系名称'); await expect(page.getByLabel('代系名称原文（只读）', { exact: true })).toHaveValue('E210 合成代系');
  await expect(page.getByLabel('英文代系名称', { exact: true })).toHaveValue(''); await expect(page.getByLabel('俄文代系名称', { exact: true })).toHaveValue('');
  await page.getByLabel('英文代系名称', { exact: true }).fill('Preserve this generation text');
  await page.getByLabel('俄文代系名称', { exact: true }).fill('Сохранить это поколение');
  const translated = await saveBundle(page); const beforeRename = translated.localization.data.fields.find(field => field.ref === 'generation')!;
  await generationName.fill('E220 新的合成代系'); await select(page, '驱动形式', '后轮驱动'); const renamed = await saveBundle(page);
  const renamedField = renamed.localization.data.fields.find(field => field.ref === 'generation')!;
  expect(renamed.localization.data.facts).toEqual({ generation: { ...translated.localization.data.facts.generation!, name: 'E220 新的合成代系' }, drivetrain: 'rwd' });
  expect(renamedField.sourceVersion).toBe(beforeRename.sourceVersion + 1); expect(renamedField.sourceHash).not.toBe(beforeRename.sourceHash);
  expect(renamedField.translations.zh).toEqual({ text: 'E220 新的合成代系', kind: 'original', reviewStatus: 'pending', sourceVersion: renamedField.sourceVersion,
    humanEditVersion: beforeRename.translations.zh!.humanEditVersion + 1, engineVersion: null });
  for (const locale of ['en', 'ru'] as const) expect(renamedField.translations[locale]).toEqual({ ...beforeRename.translations[locale], reviewStatus: 'stale' });
  await expect(page.getByLabel('代系名称原文（只读）', { exact: true })).toHaveValue('E220 新的合成代系');
  await expect(page.getByLabel('英文代系名称', { exact: true })).toHaveValue('Preserve this generation text');
  await expect(page.getByLabel('俄文代系名称', { exact: true })).toHaveValue('Сохранить это поколение');
  expect(renamed.localization.data.fields.map(field => field.ref)).toEqual(['model', 'generation']);
  await generationName.fill(''); await select(page, '驱动形式', '未知 / 未填写'); const cleared = await saveBundle(page);
  expect(saved.data.facts).toEqual({ generation: null, drivetrain: null }); expect(saved.data.fields.map(field => field.ref)).toEqual(['model']);
  expect(cleared.localization.retiredFieldCount).toBe(renamed.localization.retiredFieldCount + 1); expect(api.saves).toEqual([]); expect(api.translationGenerations).toEqual([]);
});

test('bundle plans include every server-selected public field instead of the removed ten-field selection UI', async ({ page }) => {
  const item = record(); const refs = ['make', 'model', 'trim', 'generation', 'location.city', 'location.displayName', ...Array.from({ length: 5 }, (_, index) => `price.includes.40000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`)];
  const saved = localization(item, refs.map((ref, index) => field(ref, `合成字段${index + 1}`)));
  const api = await installApi(page, { items: [item], localizations: [saved] }); await openWorkspace(page, id); const plan = await requestPlan(page);
  expect(plan.fields.map(field => field.ref)).toEqual(['content.title', ...refs]); expect(new Set(plan.fields.map(field => field.ref)).size).toBe(12);
  await expect(page.getByRole('button', { name: '选择前10个中文字段', exact: true })).toHaveCount(0);
  expect(api.translationGenerations).toEqual([]); expect(api.bundleSaves).toEqual([]);
});

test('bundle display-only edits require a new preview confirmation before a single explicit publication', async ({ page }) => {
  const item = { ...record(), publicationState: 'published' as const, publishedRevisionId: 'before', publishedAt: '2026-11-08T08:00:00Z', hasUnpublishedChanges: false };
  const saved = localization(item, [field('model', '合成中文车型')]); const api = await installApi(page, { items: [item], localizations: [saved] }); let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { publishes++; Object.assign(item, { version: item.version + 1, hasUnpublishedChanges: false, publishedRevisionId: 'after' }); return reply(route, envelope(item)); });
  await openWorkspace(page, id); await expect(page.getByTestId('vehicle-publish')).toHaveCount(0); await expand(page, '车型名称');
  await page.getByLabel('英文车型名称', { exact: true }).fill('Revised English model'); await saveBundle(page);
  expect(item.hasUnpublishedChanges).toBe(true); expect(publishes).toBe(0); expect(api.saves).toEqual([]);
  await tab(page, '发布预览'); await expect(page.getByTestId('vehicle-publish')).toHaveText('请完善信息'); await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 844 }); await page.getByRole('button', { name: '查看发布缺项', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发布缺项', exact: true });
  const action = dialog.getByRole('button', { name: '发布预览：请检查并确认当前内容', exact: true }); await expect(action).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await action.focus(); await expect(action).toBeFocused(); await action.click(); await expect(dialog).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('unified-bundle-preview-320.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 }); await acknowledgePublicationPreview(page);
  expect(api.previewConfirmations).toHaveLength(1); expect(api.previewConfirmations[0]!.input.version).toBe(item.version);
  await page.getByTestId('vehicle-publish').click(); await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.getByTestId('vehicle-publish')).toHaveText('已发布，暂无待发布修改'); await expect(page.getByTestId('vehicle-publish')).toBeDisabled(); expect(publishes).toBe(1);
});

for (const persisted of [false, true]) {
  test(`bundle unknown save ${persisted ? 'with persisted result requires comparison' : 'with unchanged server permits only the frozen original retry'}`, async ({ page }) => {
    const item = record(), saved = localization(item, [field('model', '合成中文车型')]); const api = await installApi(page, { items: [item], localizations: [saved] });
    const writes: string[] = []; let first = true;
    await page.route(`**${path}`, async route => {
      if (route.request().method() !== 'PUT') return route.fallback(); writes.push(route.request().postData()!);
      if (!first) return route.fallback(); first = false;
      if (persisted) {
        const input = route.request().postDataJSON(); item.draft.content = structuredClone(input.content); item.version++;
        saved.data = structuredClone(input.localization); saved.revision++; saved.vehicleVersion = item.version;
      }
      return route.abort('failed');
    });
    await openWorkspace(page, id); await page.getByLabel('英文标题', { exact: true }).fill('Uncertain save title'); await expand(page, '车型名称'); await page.getByLabel('英文车型名称', { exact: true }).fill('Uncertain save model');
    await bundleSave(page).click(); await expect(page.getByTestId('translation-save-recover')).toBeEnabled();
    await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Uncertain save title'); await expect(page.getByLabel('英文标题', { exact: true })).toBeDisabled();
    expect(writes).toHaveLength(1); const original = writes[0]!; await page.getByTestId('translation-save-recover').click();
    if (persisted) {
      await expect(page.getByRole('button', { name: '重试原多语保存请求', exact: true })).toHaveCount(0);
      await expect(page.getByText('服务端已返回不同版本。请比较后明确重新读取，不会自动覆盖当前输入。', { exact: true })).toBeVisible();
      await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Uncertain save title'); expect(writes).toEqual([original]);
    } else {
      const retry = page.getByRole('button', { name: '重试原多语保存请求', exact: true }); await expect(retry).toBeEnabled(); await retry.click();
      await expect.poll(() => api.bundleSaves.length).toBe(1); expect(writes).toEqual([original, original]); expect(JSON.parse(original)).toMatchObject({ version: 1, localizationRevision: 0 });
      await expect(bundleSave(page)).toBeDisabled(); expect(item.draft.content.title.translations.en?.text).toBe('Uncertain save title');
    }
    expect(api.translationGenerations).toEqual([]);
  });
}

for (const mismatch of ['content source', 'display source hash', 'vehicle version', 'localization revision'] as const) {
  test(`bundle atomic facts save rejects mismatched ${mismatch} without partially persisting body fields or facts`, async ({ page }) => {
    const item = record(), generation = field('generation', '原有合成代系');
    generation.translations.zh = { text: generation.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 0, engineVersion: null };
    generation.translations.en = { text: 'Existing saved generation', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
    const saved = localization(item, [field('model', '合成中文车型'), generation]);
    saved.data.facts = { generation: { id: 'synthetic-generation', name: generation.sourceText }, drivetrain: 'awd' };
    const beforeVehicle = structuredClone(item), beforeLocalization = structuredClone(saved);
    const api = await installApi(page, { items: [item], localizations: [saved] }); let faulted = 0;
    // Deliberate transport fault injection exercises the fixture's contract guards; it is not evidence for BE transaction behavior.
    await page.route(`**${path}`, route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const input = SaveVehicleTranslationBundleSchema.parse(route.request().postDataJSON()); faulted++;
      if (mismatch === 'content source') input.content.title.sourceText = '错配的正文原文';
      if (mismatch === 'display source hash') input.localization.fields.find(field => field.ref === 'model')!.sourceHash = '0'.repeat(64);
      if (mismatch === 'vehicle version') input.version++;
      if (mismatch === 'localization revision') input.localizationRevision++;
      return route.fallback({ postData: JSON.stringify(SaveVehicleTranslationBundleSchema.parse(input)) });
    });
    await openWorkspace(page, id); await page.getByLabel('英文标题', { exact: true }).fill('Local body must stay unsaved'); await expand(page, '车型名称');
    await page.getByLabel('英文车型名称', { exact: true }).fill('Local model must stay unsaved');
    await page.locator('.ant-collapse-header').filter({ hasText: '补充代系与驱动形式' }).click();
    await page.getByRole('textbox', { name: '代系名称', exact: true }).fill('本地新代系不能部分写入'); await select(page, '驱动形式', '后轮驱动');
    const response = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/translation-bundle'));
    await bundleSave(page).click(); const rejected = await response; expect(rejected.status()).toBe(409); expect((await rejected.json()).error.code).toBe('VERSION_CONFLICT');
    await expect(page.locator('.ant-alert-error').first()).toBeVisible(); await expect(bundleSave(page)).toBeDisabled();
    await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Local body must stay unsaved');
    await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Local model must stay unsaved');
    await expect(page.getByRole('textbox', { name: '代系名称', exact: true })).toHaveValue('本地新代系不能部分写入');
    await expect(page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name: '驱动形式', exact: true }) }).locator('.ant-select-content-has-value')).toHaveText('后轮驱动');
    expect(item).toEqual(beforeVehicle); expect(saved).toEqual(beforeLocalization); expect(faulted).toBe(1); expect(api.bundleSaves).toHaveLength(1); expect(api.saves).toEqual([]); expect(api.translationGenerations).toEqual([]);
  });
}
