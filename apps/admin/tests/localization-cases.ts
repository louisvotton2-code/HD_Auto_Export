/** I18N02 browser contract simulations. No external translator or shared business data is contacted. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { DisplayFieldSchema, type AdminVehicle, type DisplayField } from '@hd/contracts/admin';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicVehicleSchema, type DisplayText, type PublicVehicle } from '@hd/contracts/public';
import { displaySuggestions, envelope, error, installApi, localization, reply, vehicle } from './api-fixture';
import { notes, select, tab } from './ui-helpers';

const id = '40000000-0000-4000-8000-000000000001';
const priceId = '40000000-0000-4000-8000-000000000003';
const path = `/api/v1/admin/vehicles/${id}/localization`;
function record(): AdminVehicle {
  const item = { ...vehicle(), id }; item.draft.media = [];
  item.draft.facts.make = { id: 'toyota', name: '丰田' };
  item.draft.facts.model = { id: 'synthetic_model', name: '合成中文车型' };
  item.draft.facts.trim = null; item.draft.facts.location = null; item.draft.price.includes = [];
  return item;
}
/** These are explicit opaque fields returned by the simulated server, not derived client refs. */
function field(ref: string, sourceText: string, sourceLanguage = 'zh'): DisplayField {
  return DisplayFieldSchema.parse({ ref, sourceLanguage, sourceText, sourceVersion: 1,
    sourceHash: createHash('sha256').update(JSON.stringify(['synthetic-server-field', ref, sourceText, sourceLanguage])).digest('hex'),
    translations: { zh: null, en: null, ru: null } });
}
function requestSnapshot(route: Route) { return { key: route.request().headers()['idempotency-key'], body: route.request().postData() }; }
async function openLocalization(page: Page) { await page.goto(`/admin/vehicles/${id}`); await tab(page, '公开字段多语'); }
async function capture(page: Page, name: string) {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`fixture-${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
const saveLocalization = (page: Page) => page.getByRole('button', { name: /保存多语展示资料$/ });
const generate = (page: Page) => page.getByRole('button', { name: /生成所选展示字段英俄译文$/ });
const retryGeneration = (page: Page) => page.getByRole('button', { name: /重试原展示翻译请求$/ });
async function expand(page: Page, label: string) {
  if (!await page.getByLabel(`${label}原文`, { exact: true }).isVisible())
    await page.locator('.ant-collapse-header').filter({ has: page.getByText(label, { exact: true }) }).click();
}
async function selectFirst(page: Page) { await page.getByRole('button', { name: '选择前10个中文字段', exact: true }).click(); }

test('localization und source must be explicitly saved before suggestions, which remain pending until a second save', async ({ page }) => {
  const item = record(); const saved = localization(item, [field('model', '合成中文车型', 'und')]);
  const before = structuredClone(saved); const api = await installApi(page, { items: [item], localizations: [saved] });
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { publishes++; return reply(route, error('PUBLISH_VALIDATION_FAILED'), 422); });
  await openLocalization(page);
  await expect(page.getByLabel('车型名称原文', { exact: true })).toHaveValue('合成中文车型');
  await expect(page.getByLabel('车型名称原文', { exact: true })).toHaveJSProperty('readOnly', true);
  await expect(generate(page)).toBeDisabled();
  await select(page, '车型名称来源语言', '中文');
  await expect(generate(page)).toBeDisabled();
  await expect(page.getByText('来源语言已修改，请先保存，再审核对应新版本译文', { exact: true })).toBeVisible();
  await saveLocalization(page).click();
  await expect.poll(() => api.localizationSaves.length).toBe(1);
  await expect(saveLocalization(page)).toBeDisabled();
  expect(api.localizationSaves[0]!.input).toMatchObject({ vehicleVersion: 1, revision: 0, data: { fields: [{ sourceLanguage: 'zh', sourceVersion: before.data.fields[0]!.sourceVersion, sourceHash: before.data.fields[0]!.sourceHash }] } });
  expect(saved.data.fields[0]!.sourceVersion).toBe(2); expect(saved.data.fields[0]!.sourceHash).not.toBe(before.data.fields[0]!.sourceHash);
  await selectFirst(page); await generate(page).click();
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Synthetic English model');
  await expect(page.getByLabel('中文车型名称', { exact: true })).toHaveValue('合成中文车型');
  await expect(page.getByLabel('俄文车型名称', { exact: true })).toHaveValue('Тестовый перевод model');
  for (const locale of ['中文', '英文', '俄文']) await expect(page.getByRole('checkbox', { name: `${locale}车型名称已审核`, exact: true })).not.toBeChecked();
  expect(api.localizationSaves).toHaveLength(1); expect(saved.data.fields[0]!.translations.en).toBeNull(); expect(api.saves).toEqual([]);
  expect(api.localizationTranslations).toHaveLength(1);
  expect(JSON.parse(api.localizationTranslations[0]!.body!)).toEqual({ vehicleVersion: 2, revision: 1, refs: ['model'] });
  expect(api.localizationTranslations[0]!.key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
  expect(api.localizationReads.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.ant-alert-success').filter({ hasText: '已填入3项待审核内容' })).toBeVisible();
  await capture(page, 'display-suggestions-pending');
  await page.setViewportSize({ width: 320, height: 844 });
  const english = page.getByLabel('英文车型名称', { exact: true }); await english.focus(); await expect(english).toBeFocused();
  await expect.poll(() => english.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && !!hit && (hit === node || node.contains(hit)); })).toBe(true);
  await saveLocalization(page).click();
  await expect.poll(() => api.localizationSaves.length).toBe(2);
  await expect(page.locator('.ant-alert-success').filter({ hasText: '多语展示资料已保存，尚未自动发布' })).toBeVisible();
  const values = api.localizationSaves[1]!.input.data.fields[0]!.translations;
  expect(values).toMatchObject({ zh: { kind: 'original', reviewStatus: 'pending', humanEditVersion: 0 }, en: { kind: 'machine', reviewStatus: 'pending', humanEditVersion: 0 }, ru: { kind: 'machine', reviewStatus: 'pending', humanEditVersion: 0 } });
  expect(saved.data.fields[0]!.translations.en).toMatchObject({ text: 'Synthetic English model', humanEditVersion: 1, reviewStatus: 'pending' });
  expect(item.publicationState).toBe('draft'); expect(publishes).toBe(0);
  await page.reload(); await tab(page, '公开字段多语');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Synthetic English model');
});

test('localization protects human and approved translations and sends the old target human revisions', async ({ page }) => {
  const item = record(); const protectedField = field('model', '合成中文车型');
  protectedField.translations.en = { text: 'Human protected model', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
  protectedField.translations.ru = { text: 'Проверенная модель', kind: 'machine', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 2, engineVersion: 'previous-fixture-engine' };
  const saved = localization(item, [protectedField]); const before = structuredClone(saved.data.fields[0]!.translations);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  await openLocalization(page); await selectFirst(page); await generate(page).click();
  await expect(page.getByLabel('中文车型名称', { exact: true })).toHaveValue('合成中文车型');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Human protected model');
  await expect(page.getByLabel('俄文车型名称', { exact: true })).toHaveValue('Проверенная модель');
  await expect(page.getByRole('checkbox', { name: '英文车型名称已审核', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '俄文车型名称已审核', exact: true })).toBeChecked();
  await expect(page.locator('.ant-alert-success').filter({ hasText: '已保留2项人工或已审核内容' })).toBeVisible();
  await saveLocalization(page).click(); await expect.poll(() => api.localizationSaves.length).toBe(1);
  expect(api.localizationSaves[0]!.input.data.fields[0]!.translations).toMatchObject({ en: before.en, ru: before.ru });
  expect(saved.data.fields[0]!.translations.en?.humanEditVersion).toBe(3); expect(saved.data.fields[0]!.translations.ru?.humanEditVersion).toBe(2);
});

for (const mutation of ['vehicle version', 'sidecar revision', 'source hash', 'target human revision', 'deleted vehicle'] as const) {
  test(`localization refuses a replayed suggestion after fresh ${mutation} changes`, async ({ page }) => {
    const item = record(); const saved = localization(item, [field('model', '合成中文车型')]);
    const receipt = displaySuggestions(saved, ['model']); const api = await installApi(page, { items: [item], localizations: [saved] });
    const calls: ReturnType<typeof requestSnapshot>[] = [];
    await page.route(`**${path}/translation-suggestions`, route => {
      calls.push(requestSnapshot(route));
      if (calls.length === 1) return route.abort('failed');
      return reply(route, envelope(receipt));
    });
    await openLocalization(page); await selectFirst(page); await generate(page).click(); await expect(retryGeneration(page)).toBeEnabled();
    if (mutation === 'vehicle version') { item.version++; saved.vehicleVersion = item.version; }
    else if (mutation === 'sidecar revision') saved.revision++;
    else if (mutation === 'source hash') saved.data.fields[0]!.sourceHash = 'b'.repeat(64);
    else if (mutation === 'target human revision') {
      saved.data.fields[0]!.translations.en = { text: 'Fresh human edit', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 4, engineVersion: null };
    } else { item.version++; item.deletedAt = '2026-11-08T10:00:00Z'; }
    await retryGeneration(page).click();
    await expect(page.getByText('多语资料版本冲突，当前输入已保留', { exact: true })).toBeVisible();
    await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('');
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); expect(api.localizationSaves).toEqual([]);
    await expect(page.locator('.ant-message-success').filter({ hasText: '已填入' })).toHaveCount(0);
  });
}

test('localization acknowledged suggestions wait for a successful fresh read and retry the exact original request', async ({ page }) => {
  const item = record(); const saved = localization(item, [field('model', '合成中文车型')]); const receipt = displaySuggestions(saved, ['model']);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  const calls: ReturnType<typeof requestSnapshot>[] = []; let failRead = false;
  await page.route(new RegExp(`${path}(?:[?]|$)`), route => route.request().method() === 'GET' && failRead ? reply(route, error('SERVICE_UNAVAILABLE'), 503) : route.fallback());
  await page.route(`**${path}/translation-suggestions`, route => { calls.push(requestSnapshot(route)); if (calls.length === 1) failRead = true; return reply(route, envelope(receipt)); });
  await openLocalization(page); await selectFirst(page); await generate(page).click();
  await expect(retryGeneration(page)).toBeEnabled(); await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('');
  expect(api.localizationSaves).toEqual([]); failRead = false;
  await retryGeneration(page).click(); await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Synthetic English model');
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); expect(api.localizationSaves).toEqual([]);
});

test('localization a conflicting save preserves input and compares the remote revision without automatic overwrite', async ({ page }) => {
  const item = record(); const saved = localization(item, [field('model', '合成中文车型')]);
  const api = await installApi(page, { items: [item], localizations: [saved] }); let puts = 0;
  await page.route(`**${path}`, route => { if (route.request().method() !== 'PUT') return route.fallback(); puts++; return reply(route, error('VERSION_CONFLICT'), 409); });
  await openLocalization(page); await page.getByLabel('英文车型名称', { exact: true }).fill('Local unsaved model');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toBeEnabled();
  await page.getByLabel('英文车型名称', { exact: true }).fill('Local unsaved model, still editable');
  item.version++; saved.vehicleVersion = item.version; saved.revision++;
  saved.data.fields[0]!.translations.en = { text: 'Remote colleague model', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 1, engineVersion: null };
  await saveLocalization(page).click();
  await expect(page.getByText('多语资料版本冲突，当前输入已保留', { exact: true })).toBeVisible();
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Local unsaved model, still editable');
  await expect(page.getByRole('cell', { name: /Remote colleague model/ })).toBeVisible();
  await expect(saveLocalization(page)).toBeDisabled(); expect(puts).toBe(1); expect(api.localizationSaves).toEqual([]);
  await page.getByRole('button', { name: /放弃修改并重新读取多语资料$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保留输入', exact: true }).click();
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Local unsaved model, still editable'); expect(puts).toBe(1);
});

test('localization unsaved sidecar input guards navigation and serializes writes across editor tabs', async ({ page }) => {
  const item = record(); const saved = localization(item, [field('model', '合成中文车型')]);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  let calls = 0; let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${path}`, async route => { if (route.request().method() !== 'PUT') return route.fallback(); calls++; await pause; return route.fallback(); });
  await openLocalization(page); await page.getByLabel('英文车型名称', { exact: true }).fill('Local unsaved model');
  await page.getByRole('button', { name: /返回车辆列表$/ }).click();
  await expect(page.getByRole('dialog')).toContainText('离开当前草稿');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect((await notes(page))).toBeDisabled();
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled();
  await tab(page, '公开字段多语');
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveValue('Local unsaved model');
  await saveLocalization(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect.poll(() => calls).toBe(1); await expect(page.getByLabel('英文车型名称', { exact: true })).toBeDisabled();
  await expect(generate(page)).toBeDisabled();
  release(); await expect.poll(() => api.localizationSaves.length).toBe(1);
  await expect(saveLocalization(page)).toBeDisabled(); expect(api.saves).toEqual([]); expect(calls).toBe(1);
});

test('localization main draft edits must be saved before the separate sidecar can be read and edited', async ({ page }) => {
  const item = record(); const api = await installApi(page, { items: [item], localizations: [localization(item, [field('model', '合成中文车型')])] });
  await page.goto(`/admin/vehicles/${id}`); await page.getByLabel('标题原文', { exact: true }).fill('尚未保存的主资料');
  await tab(page, '公开字段多语');
  await expect(page.getByText('请先保存车辆资料，再编辑公开字段多语', { exact: true })).toBeVisible();
  await expect(page.getByLabel('英文车型名称', { exact: true })).toHaveCount(0);
  expect(api.localizationSaves).toEqual([]); expect(api.localizationTranslations).toEqual([]);
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  await expect(page.getByLabel('英文车型名称', { exact: true })).toBeEnabled();
  expect(api.localizationSaves).toEqual([]);
});

test('localization a delayed matching old read pair cannot downgrade a newly saved main draft', async ({ page }) => {
  const item = record(); const saved = localization(item, [field('model', '合成中文车型')]);
  const oldVehicle = structuredClone(item); const oldSidecar = structuredClone(saved);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  await page.goto(`/admin/vehicles/${id}`); await page.getByLabel('标题原文', { exact: true }).fill('已保存且不可降回旧版的主资料');
  let releaseMain!: () => void; const mainPause = new Promise<void>(resolve => { releaseMain = resolve; });
  let releaseOld!: () => void; const oldPause = new Promise<void>(resolve => { releaseOld = resolve; });
  let mainStarted = false; let oldReadStarted = false; let oldVehicleSent = false;
  await page.route(new RegExp(`/api/v1/admin/vehicles/${id}(?:[?]|$)`), async route => {
    if (route.request().method() === 'PATCH') { mainStarted = true; await mainPause; return route.fallback(); }
    if (!oldVehicleSent && route.request().method() === 'GET') { oldVehicleSent = true; return reply(route, envelope(oldVehicle)); }
    return route.fallback();
  });
  await page.route(`**${path}`, async route => {
    if (route.request().method() !== 'GET' || oldReadStarted) return route.fallback();
    oldReadStarted = true; await oldPause; return reply(route, envelope(oldSidecar));
  });
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => mainStarted).toBe(true);
  await tab(page, '公开字段多语'); await expect.poll(() => oldReadStarted).toBe(true);
  releaseMain(); await expect.poll(() => api.saves.length).toBe(1);
  const version = page.locator('.ant-descriptions-item').filter({ has: page.getByText('草稿版本', { exact: true }) });
  await expect(version).toContainText('2');
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'GET');
  releaseOld(); await (await oldResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await tab(page, '基础资料');
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('已保存且不可降回旧版的主资料');
  await expect(version).toContainText('2');
  await tab(page, '公开字段多语');
  const reload = page.getByRole('button', { name: /重新读取多语资料$/ });
  if (await reload.isVisible()) await reload.click();
  await expect(page.getByLabel('英文车型名称', { exact: true })).toBeEnabled();
  await page.getByLabel('英文车型名称', { exact: true }).fill('Fresh version two model'); await saveLocalization(page).click();
  await expect.poll(() => api.localizationSaves.length).toBe(1);
  expect(api.localizationSaves[0]!.input.vehicleVersion).toBe(2);
  await expect(page.locator('.ant-alert-success').filter({ hasText: '多语展示资料已保存，尚未自动发布' })).toBeVisible();
});

test('localization nullable extra facts stay unknown and generation refs are read again after saving', async ({ page }) => {
  const item = record(); item.draft.content.title.sourceText = '标题提到四驱与E210但不是事实';
  const saved = localization(item, [field('model', '合成中文车型')]); const api = await installApi(page, { items: [item], localizations: [saved] });
  await openLocalization(page);
  await expect(page.getByLabel('代系名称', { exact: true })).toHaveValue('');
  await expect(page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '驱动形式', exact: true }) })).toContainText('未知 / 未填写');
  await saveLocalization(page).click(); await expect.poll(() => api.localizationSaves.length).toBe(1);
  expect(api.localizationSaves[0]!.input.data.facts).toEqual({ generation: null, drivetrain: null });
  await page.getByLabel('代系名称', { exact: true }).fill('E210 合成代系'); await select(page, '驱动形式', '全轮驱动');
  await expect(page.getByLabel('代系名称原文', { exact: true })).toHaveCount(0);
  await saveLocalization(page).click(); await expect.poll(() => api.localizationSaves.length).toBe(2);
  expect(api.localizationSaves[1]!.input.data.fields.map(field => field.ref)).toEqual(['model']);
  expect(api.localizationSaves[1]!.input.data.facts).toMatchObject({ generation: { name: 'E210 合成代系' }, drivetrain: 'awd' });
  await expand(page, '代系名称');
  await expect(page.getByLabel('代系名称原文', { exact: true })).toHaveValue('E210 合成代系');
  expect(api.localizationReads.length).toBeGreaterThanOrEqual(2);
  await page.getByLabel('代系名称', { exact: true }).fill(''); await select(page, '驱动形式', '未知 / 未填写');
  await saveLocalization(page).click(); await expect.poll(() => api.localizationSaves.length).toBe(3);
  expect(api.localizationSaves[2]!.input.data.facts).toEqual({ generation: null, drivetrain: null });
  expect(saved.data.fields.map(field => field.ref)).toEqual(['model']); expect(api.saves).toEqual([]);
});

test('localization changes alone unlock an explicit new publication after a sidecar save', async ({ page }) => {
  const item = { ...record(), publicationState: 'published' as const, publishedRevisionId: 'i18n02-published-before', publishedAt: '2026-11-08T08:00:00Z', availability: 'available' as const, availabilityCheckedAt: '2026-11-08T08:00:00Z', hasUnpublishedChanges: false };
  item.draft.media = vehicle().draft.media.map(media => ({ ...media, id: '40000000-0000-4000-8000-000000000002', alt: '' }));
  const source = field('model', '合成中文车型');
  source.translations = { zh: { text: source.sourceText, kind: 'original', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 1, engineVersion: null },
    en: { text: 'Original English model', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 2, engineVersion: null },
    ru: { text: 'Исходная модель', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 1, engineVersion: null } };
  const api = await installApi(page, { items: [item], localizations: [localization(item, [source])] }); let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { publishes++; Object.assign(item, { version: item.version + 1, hasUnpublishedChanges: false, publishedRevisionId: 'i18n02-published-after' }); return reply(route, envelope(item)); });
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '三语与发布');
  await expect(page.getByRole('button', { name: /已发布，暂无待发布修改$/ })).toBeDisabled();
  await tab(page, '公开字段多语'); await page.getByLabel('英文车型名称', { exact: true }).fill('Revised English model');
  await page.getByRole('checkbox', { name: '英文车型名称已审核', exact: true }).check();
  await saveLocalization(page).click(); await expect.poll(() => api.localizationSaves.length).toBe(1);
  expect(item.hasUnpublishedChanges).toBe(true); expect(publishes).toBe(0); expect(api.saves).toEqual([]);
  expect(api.localizationSaves[0]!.input.data.fields[0]!.translations.en).toMatchObject({ text: 'Revised English model', humanEditVersion: 2, reviewStatus: 'approved' });
  expect(api.localizations.get(id)!.data.fields[0]!.translations.en?.humanEditVersion).toBe(3);
  await tab(page, '三语与发布');
  await expect(page.getByRole('button', { name: /发布已保存的修改$/ })).toBeEnabled();
  await capture(page, 'translation-only-unpublished');
  await page.setViewportSize({ width: 320, height: 844 });
  const prompt = page.locator('.ant-alert').filter({ has: page.getByText('标题描述完成不代表全部公开字段已译', { exact: true }) });
  const action = prompt.getByRole('button', { name: '整理公开字段多语', exact: true });
  await expect.poll(async () => {
    const section = await prompt.locator('.ant-alert-section').boundingBox(); const button = await action.boundingBox();
    return !!section && !!button && section.width >= 180 && button.y >= section.y + section.height;
  }, { message: 'Mobile localization guidance keeps readable text width and places its action on the next row' }).toBe(true);
  await action.focus(); await expect(action).toBeFocused();
  await expect.poll(() => action.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return box.top >= 0 && box.bottom <= innerHeight && !!hit && (hit === node || node.contains(hit)); })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('fixture-localization-prompt-focus-320.png'), fullPage: false, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /发布已保存的修改$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.getByRole('button', { name: /已发布，暂无待发布修改$/ })).toBeDisabled(); expect(publishes).toBe(1);
});

test('localization limits each explicit suggestion batch to ten server-supplied refs', async ({ page }) => {
  const item = record(); const refs = ['make', 'model', 'trim', 'generation', 'location.city', 'location.displayName', ...Array.from({ length: 5 }, (_, index) => `price.includes.40000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`)];
  const saved = localization(item, refs.map((ref, index) => field(ref, `合成中文字段${index + 1}`)));
  item.draft.facts.make = { id: 'unknown_synthetic_brand', name: '合成中文字段1' }; item.draft.facts.model = { id: 'synthetic_model', name: '合成中文字段2' };
  item.draft.facts.trim = { id: 'synthetic_trim', name: '合成中文字段3' }; item.draft.facts.location = { country: 'CN', city: '合成中文字段5', displayName: '合成中文字段6' };
  item.draft.price.includes = Array.from({ length: 5 }, (_, index) => `合成中文字段${index + 7}`);
  saved.data.facts.generation = { id: 'synthetic_generation', name: '合成中文字段4' };
  const api = await installApi(page, { items: [item], localizations: [saved] });
  await openLocalization(page); await selectFirst(page);
  await expect(page.getByText('已选择 10 / 10 项', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '费用条目 5', exact: true }).click();
  await expect(page.getByText('已选择 10 / 10 项', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '费用条目 5', exact: true })).not.toBeChecked();
  await generate(page).click(); await expect.poll(() => api.localizationTranslations.length).toBe(1);
  const input = JSON.parse(api.localizationTranslations[0]!.body!);
  expect(input.refs).toEqual(refs.slice(0, 10)); expect(new Set(input.refs).size).toBe(10); expect(api.localizationSaves).toEqual([]);
});

test('localization public verification requests localized metadata and never falls back to raw Chinese facts', async ({ page }) => {
  await installApi(page);
  const ready = (text: string): DisplayText => ({ status: 'ready', text, requestedLocale: 'en', contentLocale: 'en', provenance: 'machine', reviewed: false });
  const missing: DisplayText = { status: 'missing', text: null, requestedLocale: 'en', contentLocale: null, provenance: null, reviewed: false };
  const items: PublicVehicle[] = [0, 1].map(index => {
    const item = makeLocalizedPublicVehicleFixture('en', 'machine');
    item.id = `i18n02-public-${index}`; item.stockCode = `I18N02-${index}`;
    item.source = { kind: 'external', platform: { id: 'synthetic_platform', name: '不得回退的原始中文平台' }, listingUrl: 'https://example.invalid/synthetic-only' };
    item.facts.make = { id: 'synthetic_make', name: '不得回退的原始中文品牌' };
    item.facts.model = { id: 'synthetic_model', name: '不得回退的原始中文车型' };
    item.price.kind = 'reference'; item.availability = 'unknown'; item.availabilityCheckedAt = null;
    item.content.title = { text: `Synthetic English vehicle ${index}`, requestedLocale: 'en', contentLocale: 'en', kind: 'machine', reviewed: false };
    item.content.description = null;
    item.images = item.images.map(image => ({ ...image, alt: '不得回退的原始中文图片说明' }));
    if (index === 0) item.display = { make: ready('English synthetic make'), model: ready('English synthetic model'), trim: missing, generation: missing,
      city: missing, location: missing, platform: ready('English source platform'),
      priceIncludes: [{ id: priceId, value: missing }], mediaAlt: item.images.map(image => ({ mediaId: image.id, value: missing })) };
    else delete item.display;
    return PublicVehicleSchema.parse(item);
  });
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/media/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLXcAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/v1/vehicle-filters?*', route => { queries.push(new URL(route.request().url()).searchParams); return reply(route, envelope({
    catalog: 'curated', makes: [{ id: 'synthetic_make', name: 'English synthetic make', count: 2 }],
    models: [{ id: 'synthetic_model', makeId: 'synthetic_make', name: 'English synthetic model', count: 2 }], powertrains: [],
  })); });
  await page.route('**/api/v1/vehicles?*', route => { queries.push(new URL(route.request().url()).searchParams); return reply(route, {
    data: { items, page: 1, pageSize: 24, hasMore: false }, meta: { requestId: 'i18n02-synthetic-public', catalog: 'curated', total: 2, totalKind: 'exact', accessibleTotal: 2, dataAsOf: '2026-11-08T00:00:00Z', freshness: 'fresh' },
  }); });
  await page.goto('/admin/public-catalog/verification?locale=en');
  const first = page.getByRole('row').filter({ hasText: 'I18N02-0' }); const legacy = page.getByRole('row').filter({ hasText: 'I18N02-1' });
  await expect(first).toContainText('English synthetic make English synthetic model');
  await expect(first).toContainText('English source platform');
  await expect(legacy).toContainText('品牌未填写或待翻译'); await expect(legacy).toContainText('来源平台未填写或待翻译');
  for (const row of [first, legacy]) {
    await expect(row.getByRole('img', { name: '车辆封面', exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: /查看数据/ })).toHaveAttribute('href', /[?]locale=en&view=localized$/);
    await row.locator('.ant-table-row-expand-icon').click();
  }
  await expect(page.locator('.ant-table-expanded-row').first()).toContainText('未填写或待翻译');
  await expect(page.getByText('服务尚未提供多语展示资料', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('不得回退的原始中文');
  expect(queries).toHaveLength(2); expect(queries.every(query => query.get('view') === 'localized' && query.get('locale') === 'en')).toBe(true);
  await capture(page, 'public-display-verification');
});
