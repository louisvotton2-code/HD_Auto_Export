/** Browser contract simulations only. No cloud translation or operational data is used. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { AdminVehicle } from '@hd/contracts/admin';
import { envelope, error, installApi, reply, translationSuggestions, vehicle } from './api-fixture';
import { notes, select, tab } from './ui-helpers';

const id = '30000000-0000-4000-8000-000000000001';
const savedNotice = /已填入\d+项语言内容，请核对并保存草稿/;
function chineseVehicle(): AdminVehicle {
  const record = { ...vehicle(), id };
  record.draft.content.title = { sourceLanguage: 'zh', sourceText: '用于机器翻译的中文标题', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  record.draft.content.description = { sourceLanguage: 'zh', sourceText: '用于机器翻译的中文描述', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  return record;
}
function publishedVehicle(): AdminVehicle {
  return { ...vehicle(), id, publicationState: 'published', publishedRevisionId: 'fixture_revision', publishedAt: '2026-11-08T08:00:00Z', availability: 'available', availabilityCheckedAt: '2026-11-08T08:00:00Z', hasUnpublishedChanges: false };
}
const mtButton = (page: Page) => page.getByRole('button', { name: /生成英俄译文$/ });
const publishButton = (page: Page) => page.getByRole('button', { name: /发布车辆$|发布已保存的修改$|已发布，暂无待发布修改$|先保存当前修改$/ });
function requestSnapshot(route: Route) { return { key: route.request().headers()['idempotency-key'], body: route.request().postData() }; }
async function openReview(page: Page, record: AdminVehicle) { await page.goto(`/admin/vehicles/${record.id}`); await tab(page, '三语与发布'); }
async function signInAgain(page: Page) {
  await page.getByLabel('工作邮箱').fill('editor@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function captureFixtureEvidence(page: Page, name: string) {
  const directory = process.env.ADMIN_FIXTURE_EVIDENCE_DIR ?? '/private/tmp/hd-ad-i18n-evidence';
  await mkdir(directory, { recursive: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/fixture-${name}-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('translation Chinese-first save then generation yields original Chinese and pending English/Russian until saved', async ({ page }) => {
  const api = await installApi(page, { createdId: id });
  await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '真实车源录入' }).click();
  await page.getByLabel('标题原文', { exact: true }).fill('中文优先录入测试');
  await tab(page, '三语与发布');
  await page.getByLabel('描述原文', { exact: true }).fill('这段中文将生成英俄译文，不代表已人工审核。');
  await expect(mtButton(page)).toHaveCount(0);
  await expect(page.getByText('先保存中文原文，再生成英俄译文', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/vehicles/${id}$`));
  expect(api.items[0]!.draft.content.title).toMatchObject({ sourceLanguage: 'zh', sourceText: '中文优先录入测试' });
  await tab(page, '三语与发布');
  await mtButton(page).click();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('Машинное описание');
  await expect(page.getByRole('checkbox', { name: '英文标题已审核', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '俄文描述已审核', exact: true })).not.toBeChecked();
  expect(api.translations).toHaveLength(1);
  expect(api.translations[0]!.body).toBe('{"version":1}');
  expect(api.translations[0]!.key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
  expect(api.saves).toHaveLength(0);
  expect(api.items[0]!.draft.content.title.translations.en).toBeNull();
  expect(api.items[0]!.publicationState).toBe('draft');
  await expect(page.locator('.ant-message').filter({ hasText: savedNotice })).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();
  await captureFixtureEvidence(page, 'generated-suggestions');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  await expect(page.locator('.ant-alert').filter({ hasText: /已填入\d+项语言内容，请核对并保存草稿|译文已填入当前草稿，请核对并保存/ })).toHaveCount(0);
  expect(api.saves[0]!.draft.content.title.translations).toMatchObject({ zh: { kind: 'original', reviewStatus: 'pending' }, en: { kind: 'machine', reviewStatus: 'pending', engineVersion: 'fixture-machine-translation-v1' }, ru: { kind: 'machine', reviewStatus: 'pending' } });
  expect(api.items[0]!.publicationState).toBe('draft');
  await page.reload(); await tab(page, '三语与发布');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
});

test('translation generation is unavailable for unsaved source edits and saved non-Chinese source', async ({ page }) => {
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
  await page.goto(`/admin/vehicles/${id}`);
  await page.getByLabel('标题原文', { exact: true }).fill('还没有保存的中文标题');
  await tab(page, '三语与发布');
  await expect(mtButton(page)).toBeDisabled();
  expect(api.translations).toEqual([]);
  record.draft.content.title.sourceLanguage = 'en'; record.draft.content.title.sourceText = 'Saved English source';
  await page.reload(); await tab(page, '三语与发布');
  await expect(mtButton(page)).toBeDisabled();
  await expect(page.getByText('请先准备中文原文', { exact: true })).toBeVisible();
  expect(api.translations).toEqual([]);
});

test('translation suggestions preserve human and approved target text instead of replacing it', async ({ page }) => {
  const record = chineseVehicle();
  const machine = translationSuggestions(record);
  record.draft.content.title.translations.en = { ...machine.content.title.translations.en, text: 'Human corrected title', kind: 'human', humanEditVersion: 3 };
  record.draft.content.description.translations.ru = { ...machine.content.description!.translations.ru, text: 'Проверенное описание', reviewStatus: 'approved', humanEditVersion: 4 };
  const protectedTitle = structuredClone(record.draft.content.title.translations.en);
  const protectedDescription = structuredClone(record.draft.content.description.translations.ru);
  const api = await installApi(page, { items: [record] });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue('Машинный заголовок');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Human corrected title');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('Проверенное описание');
  await expect(page.getByRole('checkbox', { name: '俄文描述已审核', exact: true })).toBeChecked();
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]!.draft.content.title.translations.en).toEqual(protectedTitle);
  expect(api.saves[0]!.draft.content.description.translations.ru).toEqual(protectedDescription);
});

for (const mismatch of ['vehicle version', 'source hash', 'target edit revision'] as const) {
  test(`translation rejects stale suggestions with a mismatched ${mismatch}`, async ({ page }) => {
    const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
    const suggestion = translationSuggestions(record);
    if (mismatch === 'vehicle version') suggestion.version++;
    if (mismatch === 'source hash') suggestion.content.title.sourceHash = '0'.repeat(64);
    if (mismatch === 'target edit revision') suggestion.content.title.targetHumanEditVersions.en = 9;
    await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => reply(route, envelope(suggestion)));
    await openReview(page, record); await mtButton(page).click();
    await expect(page.locator('.ant-alert').filter({ hasText: /变化|过期|不一致|核对|更新/ }).first()).toBeVisible();
    await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
    expect(api.saves).toEqual([]);
    await expect(page.locator('.ant-message-success').filter({ hasText: savedNotice })).toHaveCount(0);
  });
}

test('translation in flight locks editing and a same-task double click sends one request', async ({ page }) => {
  const record = chineseVehicle(); await installApi(page, { items: [record] });
  const calls: ReturnType<typeof requestSnapshot>[] = [];
  let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, async route => { calls.push(requestSnapshot(route)); await pause; return reply(route, envelope(translationSuggestions(record))); });
  await openReview(page, record);
  await mtButton(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect.poll(() => calls.length).toBe(1);
  await expect(page.getByLabel('英文标题', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('描述原文', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled();
  release();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toHaveLength(1);
});

for (const scenario of [
  { code: 'TRANSLATION_DISABLED', status: 503 },
  { code: 'TRANSLATION_UPSTREAM_FAILED', status: 503 },
  { code: 'TRANSLATION_SOURCE_UNSUPPORTED', status: 422 },
] as const) {
  test(`translation ${scenario.code} remains an explicit failure without changing text or claiming success`, async ({ page }) => {
    const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
    await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => reply(route, error(scenario.code), scenario.status));
    await openReview(page, record); await mtButton(page).click();
    await expect(page.locator('.ant-alert').filter({ hasText: /未配置|未开启|失败|不可用|不支持|未完成|尚未|未返回|请先保存中文/ }).first()).toBeVisible();
    await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('');
    expect(api.saves).toEqual([]);
    await expect(page.locator('.ant-message-success').filter({ hasText: savedNotice })).toHaveCount(0);
  });
}

test('translation a first 401 requests login and leaves saved source text unchanged', async ({ page }) => {
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] }); let calls = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => { calls++; api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.getByLabel('工作邮箱')).toBeVisible();
  await signInAgain(page);
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('描述原文', { exact: true })).toHaveValue(record.draft.content.description.sourceText!);
  expect(calls).toBe(1); expect(api.saves).toEqual([]);
});

test('translation an ambiguous request retries its frozen version and key after same-account login', async ({ page }) => {
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
  const calls: ReturnType<typeof requestSnapshot>[] = [];
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => {
    calls.push(requestSnapshot(route));
    if (calls.length === 1) return route.abort('failed');
    if (calls.length === 2) { api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); }
    return reply(route, envelope(translationSuggestions(record)));
  });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.getByRole('button', { name: /重试原翻译请求$/ })).toBeVisible();
  await page.getByRole('button', { name: /重试原翻译请求$/ }).click();
  await expect(page.getByLabel('工作邮箱')).toBeVisible(); await signInAgain(page);
  await page.getByRole('button', { name: /重试原翻译请求$/ }).click();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toHaveLength(3); expect(calls[1]).toEqual(calls[0]); expect(calls[2]).toEqual(calls[0]);
  expect(api.saves).toEqual([]);
});

test('translation replayed suggestions are rejected after another employee changes the saved source and human revision', async ({ page }) => {
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
  const receipt = translationSuggestions(record); const calls: ReturnType<typeof requestSnapshot>[] = []; let reads = 0;
  page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/admin/vehicles/${id}`) reads++; });
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => {
    calls.push(requestSnapshot(route));
    if (calls.length === 1) return route.abort('failed');
    return reply(route, envelope(receipt));
  });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.getByRole('button', { name: /重试原翻译请求$/ })).toBeVisible();
  record.version = 2; record.draft.content.title.sourceText = '另一位员工已经改过的中文标题'; record.draft.content.title.sourceVersion = 2;
  record.draft.content.title.translations.en = { ...receipt.content.title.translations.en, text: 'Saved by another employee', kind: 'human', humanEditVersion: 4, sourceVersion: 2 };
  const readsBeforeRetry = reads;
  await page.getByRole('button', { name: /重试原翻译请求$/ }).click();
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRetry);
  await expect(page.locator('.ant-alert-error').filter({ hasText: /变化|更新|过期|核对/ })).toBeVisible();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  expect(record.draft.content.title.translations.en.text).toBe('Saved by another employee');
  expect(api.saves).toEqual([]); expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  await expect(page.locator('.ant-message-success').filter({ hasText: savedNotice })).toHaveCount(0);
});

test('translation replayed suggestions cannot fill a vehicle that has since been deleted', async ({ page }) => {
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
  const receipt = translationSuggestions(record); const calls: ReturnType<typeof requestSnapshot>[] = [];
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => {
    calls.push(requestSnapshot(route));
    return calls.length === 1 ? route.abort('failed') : reply(route, envelope(receipt));
  });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.getByRole('button', { name: /重试原翻译请求$/ })).toBeVisible();
  Object.assign(record, { deletedAt: '2026-11-08T09:00:00Z', version: 2 });
  await page.getByRole('button', { name: /重试原翻译请求$/ }).click();
  await expect(page.locator('.ant-alert-error').filter({ hasText: /回收站|删除|变化|更新|核对/ })).toBeVisible();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  expect(api.saves).toEqual([]); expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  await expect(page.locator('.ant-message-success').filter({ hasText: savedNotice })).toHaveCount(0);
});

test('translation acknowledged suggestions with a failed fresh read retain the same request until current state can be checked', async ({ page }) => {
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
  const calls: ReturnType<typeof requestSnapshot>[] = []; let failRead = false;
  await page.route(new RegExp(`/api/v1/admin/vehicles/${id}(?:[?]|$)`), route => {
    if (route.request().method() === 'GET' && failRead) return reply(route, error('SERVICE_UNAVAILABLE'), 503);
    return route.fallback();
  });
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => { calls.push(requestSnapshot(route)); if (calls.length === 1) failRead = true; return reply(route, envelope(translationSuggestions(record))); });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.getByText('翻译结果尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /重试原翻译请求$/ })).toBeEnabled();
  failRead = false;
  await page.getByRole('button', { name: /重试原翻译请求$/ }).click();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); expect(api.saves).toEqual([]);
});

test('translation whole-flow deadline keeps an acknowledged request recoverable when the fresh read stalls', async ({ page }) => {
  test.setTimeout(50_000);
  const record = chineseVehicle(); const api = await installApi(page, { items: [record] });
  const calls: ReturnType<typeof requestSnapshot>[] = []; let stallRead = false;
  let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(new RegExp(`/api/v1/admin/vehicles/${id}(?:[?]|$)`), async route => {
    if (route.request().method() !== 'GET' || !stallRead) return route.fallback();
    await pause;
    await route.abort('aborted').catch(() => { /* The browser deadline already cancelled this read. */ });
  });
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-suggestions`, route => { calls.push(requestSnapshot(route)); if (calls.length === 1) stallRead = true; return reply(route, envelope(translationSuggestions(record))); });
  await openReview(page, record); await mtButton(page).click();
  await expect(page.locator('.ant-alert-error').filter({ hasText: '翻译等待超时' })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('翻译结果尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /重试原翻译请求$/ })).toBeEnabled();
  stallRead = false; release();
  await page.getByRole('button', { name: /重试原翻译请求$/ }).click();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); expect(api.saves).toEqual([]);
});

test('publication unchanged state survives refresh and internal or inventory changes do not unlock publishing', async ({ page }) => {
  const record = publishedVehicle(); const api = await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${id}/availability`, route => { const body = route.request().postDataJSON(); Object.assign(record, { version: record.version + 1, availability: body.availability, availabilityCheckedAt: body.checkedAt }); return reply(route, envelope(record)); });
  await openReview(page, record);
  await expect(publishButton(page)).toHaveText(/已发布，暂无待发布修改/); await expect(publishButton(page)).toBeDisabled();
  await page.reload(); await tab(page, '三语与发布'); await expect(publishButton(page)).toBeDisabled();
  await (await notes(page)).fill('只修改内部备注');
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(record.hasUnpublishedChanges).toBe(false);
  await expect(page.locator('.ant-alert-success').filter({ hasText: '草稿已保存，对外内容已是最新，无需重复发布。' })).toBeVisible();
  await tab(page, '三语与发布'); await expect(publishButton(page)).toBeDisabled();
  await select(page, '核验后的库存状态', '已售');
  await page.getByRole('button', { name: /核验并更新库存$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.locator('.ant-message-success').filter({ hasText: '库存状态和核验时间已更新' })).toBeVisible();
  expect(record.hasUnpublishedChanges).toBe(false); await expect(publishButton(page)).toBeDisabled();
});

test('publication saving a public field sets unpublished changes and allows an explicit new publication', async ({ page }) => {
  const record = publishedVehicle(); const api = await installApi(page, { items: [record] });
  await page.goto(`/admin/vehicles/${id}`);
  await page.getByLabel('年款', { exact: true }).fill('2025');
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(record.hasUnpublishedChanges).toBe(true);
  await tab(page, '三语与发布');
  await expect(publishButton(page)).toHaveText(/发布已保存的修改/); await expect(publishButton(page)).toBeEnabled();
});

test('publication same-task double clicks create one confirmation and one request, then success is visible and publishing disables', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  let calls = 0; let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, async route => { calls++; await pause; Object.assign(record, { version: 2, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' }); return reply(route, envelope(record)); });
  await openReview(page, record);
  await publishButton(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByRole('dialog', { name: '发布当前已保存的草稿？', exact: true })).toHaveCount(1); expect(calls).toBe(0);
  if (process.env.ADMIN_FIXTURE_EVIDENCE_DIR) await captureFixtureEvidence(page, 'publish-confirmation');
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect.poll(() => calls).toBe(1); await expect(publishButton(page)).toBeDisabled();
  release();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  await expect(page.locator('.ant-alert-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  await expect(publishButton(page)).toHaveText(/已发布，暂无待发布修改/); await expect(publishButton(page)).toBeDisabled();
  await captureFixtureEvidence(page, 'published-disabled');
  await page.reload(); await tab(page, '三语与发布'); await expect(publishButton(page)).toBeDisabled(); expect(calls).toBe(1);
});

test('publication a definitive validation failure has a toast and a persistent recovery message', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => reply(route, error('PUBLISH_VALIDATION_FAILED'), 422));
  await openReview(page, record); await publishButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.locator('.ant-message-error').filter({ hasText: '尚未满足发布条件' })).toBeVisible();
  await expect(page.locator('.ant-alert-error').filter({ hasText: '尚未满足发布条件' })).toBeVisible();
  await expect(publishButton(page)).toBeEnabled();
});

test('publication an unknown original request remains retryable even after the server reports no unpublished changes', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  const calls: ReturnType<typeof requestSnapshot>[] = [];
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => {
    calls.push(requestSnapshot(route));
    if (calls.length === 1) { Object.assign(record, { version: 2, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' }); return route.abort('failed'); }
    return reply(route, envelope(record));
  });
  await openReview(page, record); await publishButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.getByRole('button', { name: /重试原发布请求$/ })).toBeEnabled();
  await page.getByRole('button', { name: /重试原发布请求$/ }).click();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); await expect(publishButton(page)).toBeDisabled();
});

test('publication missing historical comparison requires a fresh read before showing the unchanged state', async ({ page }) => {
  const record: AdminVehicle = { ...publishedVehicle(), hasUnpublishedChanges: null }; await installApi(page, { items: [record] });
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { publishes++; return reply(route, error('INTERNAL_ERROR'), 500); });
  await openReview(page, record);
  await expect(page.getByText('发布差异待核对', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /已发布，暂无待发布修改$/ })).toHaveCount(0);
  record.hasUnpublishedChanges = false;
  await page.getByRole('button', { name: /^(?:reload )?核对发布状态$/ }).click();
  await expect(publishButton(page)).toHaveText(/已发布，暂无待发布修改/); await expect(publishButton(page)).toBeDisabled();
  expect(publishes).toBe(0);
});

test('publication a replayed publish receipt cannot announce success after the current vehicle was deleted', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  let calls = 0; const receipt = { ...structuredClone(record), version: 2, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' };
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => {
    calls++;
    if (calls === 1) { Object.assign(record, { ...receipt, deletedAt: '2026-11-08T09:00:00Z', version: 3 }); return route.abort('failed'); }
    return reply(route, envelope(receipt));
  });
  await openReview(page, record); await publishButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await page.getByRole('button', { name: /重试原发布请求$/ }).click();
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-message-info').filter({ hasText: '回收站' })).toBeVisible();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toHaveCount(0);
  expect(calls).toBe(2);
});
