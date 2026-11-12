/** Unified translation browser contract simulations; no provider is contacted. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { TranslationPlanResultSchema, TranslationPlanStatusSchema, type AdminVehicle } from '@hd/contracts/admin';
import { envelope, error, installApi, localization, reply, translationBundle, translationResult, vehicle } from './api-fixture';
import { bundleSave, confirmPlan, generateSuggestions, noReviewControls, openWorkspace, planButton, recoverResult, requestPlan, saveBundle } from './translation-test-helpers';
import { tab } from './ui-helpers';

const id = '30000000-0000-4000-8000-000000000001';
const bundlePath = `/api/v1/admin/vehicles/${id}/translation-bundle`;
const generatePath = `**/api/v1/admin/vehicles/${id}/translation-plans/*/generate`;
function record(): AdminVehicle {
  const item = { ...vehicle(), id };
  item.draft.content.title = { sourceLanguage: 'zh', sourceText: '员工自己的中文标题，不按车型拼接', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  item.draft.content.description = { sourceLanguage: 'zh', sourceText: '仅供隔离测试的中文车况描述', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  return item;
}
const snapshot = (route: Route) => ({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
async function signIn(page: Page) {
  await page.getByLabel('账号或工作邮箱').fill('editor@example.invalid'); await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  const loginResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/sign-in/email');
  const staffResponse = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/admin/me');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  expect((await loginResponse).status()).toBe(200); expect((await staffResponse).status()).toBe(200);
  await expect(page.getByLabel('账号或工作邮箱')).toBeHidden(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workspace')).not.toHaveAttribute('inert');
  await expect(page.getByTestId('translation-result-recover')).toBeEnabled();
}
async function expectUnfilled(page: Page) {
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('');
}

test('workspace Chinese-first save generates original Chinese and machine pending targets without automatically saving', async ({ page }) => {
  const api = await installApi(page, { createdId: id }); await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '真实车源录入' }).click();
  await page.getByLabel('标题原文', { exact: true }).fill('中文权威原文');
  await tab(page, '价格与内部信息'); await page.getByLabel('车况描述', { exact: true }).fill('这段中文只用于合成浏览器验证。');
  await tab(page, '公开字段多语'); await expect(planButton(page)).toHaveCount(0);
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect(page).toHaveURL(new RegExp(`${id}$`));
  await tab(page, '公开字段多语');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue('中文权威原文');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveAttribute('readonly', ''); await noReviewControls(page);
  const plan = await generateSuggestions(page);
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('Машинное описание');
  expect(api.translationGenerations).toHaveLength(1); expect(api.translationGenerations[0]!.key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
  expect(JSON.parse(api.translationGenerations[0]!.body!)).toEqual({ confirmed: true, sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: true });
  expect(api.bundleSaves).toEqual([]); expect(api.saves).toEqual([]); expect(api.items[0]!.draft.content.title.translations.en).toBeNull();
  const saved = await saveBundle(page); expect(api.bundleSaves).toHaveLength(1); expect(api.saves).toEqual([]);
  expect(saved.vehicle.draft.content.title.translations).toMatchObject({ zh: { text: '中文权威原文', kind: 'original', reviewStatus: 'pending' }, en: { kind: 'machine', reviewStatus: 'pending', engineVersion: plan.engineVersion }, ru: { kind: 'machine', reviewStatus: 'pending' } });
  expect(saved.vehicle.publicationState).toBe('draft');
  await page.reload(); await tab(page, '公开字段多语'); await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
});

test('workspace plans and cancellation cannot generate or claim unknown fees are free', async ({ page }) => {
  const api = await installApi(page, { items: [record()] }); await openWorkspace(page, id);
  const plan = await requestPlan(page); const dialog = page.getByRole('dialog');
  await expect(page.getByTestId('translation-plan-confirmation')).toContainText(String(plan.estimate.maximumCharacters));
  await expect(page.getByTestId('translation-plan-confirmation')).toContainText(/未核实|未知/);
  await expect(page.getByTestId('translation-plan-confirmation')).not.toContainText(/免费翻译|无需付费|费用[：:]?\s*0/);
  await expect(page.getByTestId('translation-plan-start')).toBeDisabled(); expect(api.translationGenerations).toEqual([]);
  await dialog.getByRole('button', { name: /取\s*消$/ }).click(); await expect(dialog).toBeHidden();
  expect(api.translationGenerations).toEqual([]); expect(api.bundleSaves).toEqual([]); await expectUnfilled(page);
});

test('workspace in-flight generation locks edits and a double fee confirmation sends one immutable request', async ({ page }) => {
  const api = await installApi(page, { items: [record()] }); const calls: ReturnType<typeof snapshot>[] = [];
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(generatePath, async route => { calls.push(snapshot(route)); await waiting; return route.fallback(); });
  await openWorkspace(page, id); const plan = await requestPlan(page); await confirmPlan(page, true);
  await expect.poll(() => calls.length).toBe(1); await expect(page.getByLabel('英文标题', { exact: true })).toBeDisabled();
  await expect(bundleSave(page)).toBeDisabled(); await expect(planButton(page)).toBeDisabled();
  await tab(page, '价格与内部信息'); await expect(page.getByLabel('车况描述', { exact: true })).toBeDisabled();
  release(); await tab(page, '公开字段多语'); await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toHaveLength(1); expect(JSON.parse(calls[0]!.body!)).toMatchObject({ sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters });
  expect(api.bundleSaves).toEqual([]);
});

test('workspace saved historical sources require one explicit whole-workspace Chinese declaration', async ({ page }) => {
  const item = record(); item.draft.content.title.sourceLanguage = 'und'; const api = await installApi(page, { items: [item] });
  await openWorkspace(page, id); await expect(planButton(page)).toBeDisabled(); await noReviewControls(page);
  expect(api.translationPlans).toEqual([]);
  await page.getByTestId('translation-source-confirm').check(); await expect(planButton(page)).toBeDisabled();
  expect(item.draft.content.title.sourceLanguage).toBe('und');
  const saved = await saveBundle(page); expect(api.bundleSaves[0]!.input.sourceLanguageConfirmations).toEqual(['content.title']);
  expect(saved.vehicle.draft.content.title.sourceLanguage).toBe('zh'); expect(saved.vehicle.draft.content.title.sourceVersion).toBe(2);
  await expect(planButton(page)).toBeEnabled(); expect(api.translationGenerations).toEqual([]);
});

test('workspace unsaved source edits cannot plan or overwrite the authoritative Chinese title', async ({ page }) => {
  const api = await installApi(page, { items: [record()] }); await page.goto(`/admin/vehicles/${id}`);
  await tab(page, '公开字段多语'); await expect(page.getByLabel('标题原文（只读）', { exact: true })).toBeVisible();
  await tab(page, '基础资料'); await page.getByLabel('标题原文', { exact: true }).fill('尚未保存的新中文标题'); await tab(page, '公开字段多语');
  await expect(planButton(page)).toBeDisabled(); expect(api.translationPlans).toEqual([]); expect(api.bundleSaves).toEqual([]);
  await page.getByRole('button', { name: /保存基础资料$/ }).click(); await expect.poll(() => api.saves.length).toBe(1);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue('尚未保存的新中文标题');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveAttribute('readonly', '');
});

test('workspace generation preserves human and historical approved texts without review controls', async ({ page }) => {
  const item = record();
  item.draft.content.title.translations.en = { text: 'Human corrected title', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
  item.draft.content.description.translations.ru = { text: 'Проверенное описание', kind: 'machine', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 4, engineVersion: 'historic-engine' };
  const protectedTitle = structuredClone(item.draft.content.title.translations.en), protectedDescription = structuredClone(item.draft.content.description.translations.ru);
  const api = await installApi(page, { items: [item] }); await openWorkspace(page, id); await generateSuggestions(page);
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue('Машинный заголовок');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Human corrected title');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('Проверенное описание'); await noReviewControls(page);
  await saveBundle(page); expect(api.bundleSaves[0]!.input.content.title.translations.en).toEqual(protectedTitle);
  expect(api.bundleSaves[0]!.input.content.description.translations.ru).toEqual(protectedDescription);
});

for (const mismatch of ['vehicle version', 'source hash', 'target edit revision', 'source fingerprint', 'engine version'] as const) {
  test(`workspace rejects suggestions with a mismatched ${mismatch}`, async ({ page }) => {
    const item = record(); const saved = localization(item); const api = await installApi(page, { items: [item], localizations: [saved] });
    await page.route(generatePath, route => {
      const result = translationResult(translationBundle(item, saved), api.translationPlans.at(-1)!.plan);
      if (mismatch === 'vehicle version') result.vehicleVersion++;
      if (mismatch === 'source hash') result.fields[0]!.sourceHash = '0'.repeat(64);
      if (mismatch === 'target edit revision') { result.fields[0]!.targetHumanEditVersions.en = 9; result.fields[0]!.translations.en!.humanEditVersion = 9; }
      if (mismatch === 'source fingerprint') result.sourceFingerprint = '0'.repeat(64);
      if (mismatch === 'engine version') result.fields[0]!.translations.en!.engineVersion = 'wrong-engine';
      return reply(route, envelope(TranslationPlanResultSchema.parse(result)));
    });
    await openWorkspace(page, id); await generateSuggestions(page);
    await expect(page.locator('.ant-alert-error').first()).toBeVisible(); await expectUnfilled(page); expect(api.bundleSaves).toEqual([]);
  });
}

for (const scenario of [{ code: 'TRANSLATION_DISABLED', status: 503 }, { code: 'TRANSLATION_UPSTREAM_FAILED', status: 503 }, { code: 'TRANSLATION_SOURCE_UNSUPPORTED', status: 422 }]) {
  test(`workspace ${scenario.code} is an explicit failure without persistence`, async ({ page }) => {
    const api = await installApi(page, { items: [record()] }); await page.route(generatePath, route => reply(route, error(scenario.code), scenario.status));
    await openWorkspace(page, id); await generateSuggestions(page); await expect(page.locator('.ant-alert-error').first()).toBeVisible();
    await expectUnfilled(page); expect(api.bundleSaves).toEqual([]); expect(api.saves).toEqual([]);
  });
}

test('workspace initial 401 requests login and never changes saved source text', async ({ page }) => {
  const item = record(); const before = structuredClone(item.draft); const api = await installApi(page, { items: [item] }); let calls = 0;
  await page.route(generatePath, route => { calls++; api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); });
  await openWorkspace(page, id); await generateSuggestions(page); await signIn(page); await expectUnfilled(page);
  expect(calls).toBe(1); expect(item.draft).toEqual(before); expect(api.bundleSaves).toEqual([]);
});

test('workspace unknown generation uses only status reads through 401 recovery and never reposts its frozen request', async ({ page }) => {
  const item = record(); const saved = localization(item); const api = await installApi(page, { items: [item], localizations: [saved] });
  const calls: ReturnType<typeof snapshot>[] = []; let statusCalls = 0;
  await page.route(generatePath, route => { calls.push(snapshot(route)); return route.abort('failed'); });
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans/*`, route => {
    if (route.request().method() !== 'GET') return route.fallback(); statusCalls++;
    if (statusCalls === 1) { api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); }
    const plan = api.translationPlans[0]!.plan; const now = new Date().toISOString();
    return reply(route, envelope(TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: id, state: 'completed', result: translationResult(translationBundle(item, saved), plan), startedAt: now, finishedAt: now })));
  });
  await openWorkspace(page, id); const plan = await generateSuggestions(page); await expect(recoverResult(page)).toBeEnabled();
  const frozen = structuredClone(calls[0]); await recoverResult(page).click(); await signIn(page);
  await recoverResult(page).click(); await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toEqual([frozen]); expect(frozen!.key).toBeTruthy(); expect(JSON.parse(frozen!.body!)).toEqual({ confirmed: true, sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: true });
  expect(statusCalls).toBe(2); expect(api.bundleSaves).toEqual([]);
});

for (const mutation of ['vehicle version', 'localization revision', 'source hash', 'target human revision', 'configuration', 'deleted vehicle'] as const) {
  test(`workspace recovered results cannot replace a changed ${mutation}`, async ({ page }) => {
    const item = record(); const saved = localization(item); const api = await installApi(page, { items: [item], localizations: [saved] });
    let result: ReturnType<typeof translationResult>;
    const calls: ReturnType<typeof snapshot>[] = [];
    await page.route(generatePath, route => { calls.push(snapshot(route)); result = translationResult(translationBundle(item, saved), api.translationPlans.at(-1)!.plan); return route.abort('failed'); });
    await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans/*`, route => {
      if (route.request().method() !== 'GET') return route.fallback(); const now = new Date().toISOString();
      return reply(route, envelope({ planId: result.planId, vehicleId: id, state: 'completed', result, startedAt: now, finishedAt: now }));
    });
    await openWorkspace(page, id); await generateSuggestions(page); await expect(recoverResult(page)).toBeEnabled();
    if (mutation === 'vehicle version') item.version++;
    if (mutation === 'localization revision') saved.revision++;
    if (mutation === 'source hash') item.draft.content.title.sourceText = '同事更新的中文标题';
    if (mutation === 'target human revision') item.draft.content.title.translations.en = { text: 'New colleague edit', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 4, engineVersion: null };
    if (mutation === 'configuration') item.draft.configuration = { version: 1, items: [{ name: '挡位数', value: '8' }] };
    if (mutation === 'deleted vehicle') { item.version++; item.deletedAt = '2026-11-08T10:00:00Z'; }
    await recoverResult(page).click(); await expect(page.locator('.ant-alert-error').first()).toBeVisible(); await expectUnfilled(page);
    expect(calls).toHaveLength(1); expect(api.bundleSaves).toEqual([]);
  });
}

test('workspace an acknowledged result waits for a fresh bundle and recovers through GET without generating again', async ({ page }) => {
  const api = await installApi(page, { items: [record()] }); let failRead = false;
  await page.route(`**${bundlePath}`, route => route.request().method() === 'GET' && failRead ? reply(route, error('SERVICE_UNAVAILABLE'), 503) : route.fallback());
  await page.route(generatePath, route => { failRead = true; return route.fallback(); });
  await openWorkspace(page, id); await generateSuggestions(page); await expect(recoverResult(page)).toBeEnabled(); await expectUnfilled(page);
  expect(api.translationGenerations).toHaveLength(1); const frozen = structuredClone(api.translationGenerations[0]);
  failRead = false; await recoverResult(page).click(); await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(api.translationGenerations).toEqual([frozen]); expect(api.translationStatusReads).toHaveLength(1); expect(api.bundleSaves).toEqual([]);
});

test('workspace generation deadline preserves a read-only recovery route and never sends an automatic second generation', async ({ page }) => {
  await page.clock.install();
  // Bind the native deadline to the browser test clock without changing the production duration.
  await page.addInitScript(() => { AbortSignal.timeout = (milliseconds: number) => { const controller = new AbortController(); window.setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds); return controller.signal; }; });
  const api = await installApi(page, { items: [record()] }); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); let started = false; let posts = 0;
  await page.route(generatePath, async route => { started = true; posts++; await wait; return route.abort('aborted').catch(() => {}); });
  await openWorkspace(page, id); const plan = await generateSuggestions(page); await expect.poll(() => started).toBe(true);
  await page.clock.fastForward(151_000); await expect(recoverResult(page)).toBeEnabled(); await expectUnfilled(page);
  const saved = api.localizations.get(id)!; const now = new Date().toISOString();
  api.translationStatuses.set(plan.id, TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: id, state: 'completed', result: translationResult(translationBundle(api.items[0]!, saved), plan), startedAt: now, finishedAt: now }));
  release(); await recoverResult(page).click(); await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(posts).toBe(1); expect(api.translationPlans).toHaveLength(1); expect(api.translationStatusReads).toHaveLength(1); expect(api.bundleSaves).toEqual([]);
});

test('workspace historical Chinese mismatch can be synchronized explicitly without editing readonly source or inventing review', async ({ page }) => {
  const item = record(); item.draft.content.title.translations.zh = { text: '历史错误中文槽', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 7, engineVersion: null };
  item.draft.content.title.translations.en = { text: 'Protected English', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
  item.draft.content.title.translations.ru = { text: 'Сохранённый русский', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 5, engineVersion: null };
  const before = structuredClone(item.draft.content.title); const api = await installApi(page, { items: [item], publicationDefaultConfirmed: false });
  await openWorkspace(page, id); await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue(before.sourceText!);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveAttribute('readonly', ''); await expect(page.getByLabel('中文标题', { exact: true })).toHaveCount(0);
  await noReviewControls(page); await expect(bundleSave(page)).toBeEnabled(); expect(api.bundleSaves).toEqual([]); expect(item.draft.content.title).toEqual(before);
  // Opening historical data is not a local edit and must not create a spurious leave guard.
  await page.getByRole('button', { name: /返回车辆列表$/ }).click(); await expect(page).toHaveURL(/\/vehicles$/); await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWorkspace(page, id); const saved = await saveBundle(page);
  expect(api.bundleSaves).toHaveLength(1); expect(api.bundleSaves[0]!.input.content.title.translations.zh).toEqual(before.translations.zh);
  expect(saved.vehicle.draft.content.title).toMatchObject({ sourceText: before.sourceText, sourceVersion: before.sourceVersion,
    translations: { zh: { text: before.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: before.sourceVersion, engineVersion: null }, en: before.translations.en, ru: before.translations.ru } });
  expect(api.translationGenerations).toEqual([]); expect(api.previewConfirmations).toEqual([]);
});

test('workspace an expired estimate cannot trigger generation even after prior fee acknowledgement', async ({ page }) => {
  await page.clock.install(); const api = await installApi(page, { items: [record()] }); await openWorkspace(page, id); await requestPlan(page);
  await page.getByTestId('translation-generate-confirm').check(); await expect(page.getByTestId('translation-plan-start')).toBeEnabled();
  await page.clock.fastForward(601_000); await expect(page.getByTestId('translation-plan-start')).toBeDisabled();
  await expect(page.getByTestId('translation-plan-confirmation')).toContainText('计划已过期');
  await page.getByTestId('translation-plan-start').evaluate(node => (node as HTMLButtonElement).click());
  expect(api.translationGenerations).toEqual([]); expect(api.bundleSaves).toEqual([]);
});

test('workspace running and not-started status reads never restart an unknown paid generation', async ({ page }) => {
  const api = await installApi(page, { items: [record()] }); let posts = 0;
  await page.route(generatePath, route => { posts++; return route.abort('failed'); });
  await openWorkspace(page, id); const plan = await generateSuggestions(page); await expect(recoverResult(page)).toBeEnabled();
  api.translationStatuses.set(plan.id, TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: id, state: 'running', result: null, startedAt: new Date().toISOString(), finishedAt: null }));
  await recoverResult(page).click(); await expect(page.getByText('翻译仍在处理中。稍后继续读取结果，不会再次发起生成请求。', { exact: true })).toBeVisible();
  await recoverResult(page).click(); await expect.poll(() => api.translationStatusReads.length).toBe(2);
  api.translationStatuses.set(plan.id, TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: id, state: 'ready', result: null, startedAt: null, finishedAt: null }));
  await expect(recoverResult(page)).toBeEnabled(); await recoverResult(page).click();
  await expect(page.getByRole('button', { name: '结束本次计划并重新读取', exact: true })).toBeVisible();
  expect(posts).toBe(1); expect(api.translationStatusReads).toHaveLength(3); expect(api.bundleSaves).toEqual([]); await expectUnfilled(page);
});

test('workspace partial generation stages successful targets and preserves existing text for missing targets without saving', async ({ page }) => {
  const item = record(); item.draft.content.description.translations.ru = { text: 'Старое машинное описание', kind: 'machine', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 2, engineVersion: 'historic' };
  const saved = localization(item); const api = await installApi(page, { items: [item], localizations: [saved] });
  await page.route(generatePath, route => {
    const result = translationResult(translationBundle(item, saved), api.translationPlans[0]!.plan);
    result.status = 'partial'; result.fields.find(field => field.ref === 'content.description')!.translations.ru = null;
    result.failures = [{ ref: 'content.description', targetLocale: 'ru', code: 'outcome_unknown' }];
    return reply(route, envelope(TranslationPlanResultSchema.parse(result)));
  });
  await openWorkspace(page, id); await generateSuggestions(page);
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('Старое машинное описание');
  await expect(page.locator('.ant-alert-warning').filter({ hasText: '未完成部分可能已产生费用' })).toBeVisible();
  expect(api.bundleSaves).toEqual([]); await saveBundle(page);
  expect(api.bundleSaves[0]!.input.content.description.translations.ru).toEqual(item.draft.content.description.translations.ru);
  expect(item.draft.content.title.translations.en).toMatchObject({ kind: 'machine', reviewStatus: 'pending' });
});
