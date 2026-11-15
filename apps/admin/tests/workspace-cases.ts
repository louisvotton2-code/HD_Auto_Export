/** Unified translation browser contract simulations; no provider is contacted. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { CONFIGURATION_TRANSLATION_CATALOG_VERSION, TranslationPlanResponseSchema, TranslationPlanResultSchema, TranslationPlanSchema, TranslationPlanStatusSchema, vehicleConfigurationItemId, type AdminVehicle } from '@hd/contracts/admin';
import { envelope, error, installApi, localization, reply, translationBundle, translationResult, vehicle } from './api-fixture';
import { syntheticHash, translationPlan } from './translation-fixture';
import { bundleSave, confirmPlan, generateSuggestions, noReviewControls, openWorkspace, planButton, recoverResult, requestPlan, saveBundle } from './translation-test-helpers';
import { fillRequiredVehicleBasics, tab } from './ui-helpers';

const id = '30000000-0000-4000-8000-000000000001';
const bundlePath = `/api/v1/admin/vehicles/${id}/translation-bundle`;
const generatePath = `**/api/v1/admin/vehicles/${id}/translation-plans/*/generate`;
const planStatusPath = new RegExp(`/api/v1/admin/vehicles/${id}/translation-plans/[a-f0-9-]{36}$`, 'i');
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

test('workspace Chinese-first generation automatically saves original Chinese and machine pending targets', async ({ page }) => {
  const api = await installApi(page, { createdId: id }); await page.goto('/admin/vehicles/new');
  await fillRequiredVehicleBasics(page, '中文权威原文');
  await tab(page, '基础资料'); await page.getByLabel('车况描述', { exact: true }).fill('这段中文只用于合成浏览器验证。');
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
  await expect(page.getByText('已自动保存 4 项译文。请重新打开发布预览核对。', { exact: true })).toBeVisible();
  expect(api.bundleSaves).toHaveLength(1); expect(api.saves).toEqual([]);
  const saved = translationBundle(api.items[0]!, api.localizations.get(id)!);
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
  const waitingDialog = page.getByRole('dialog', { name: '正在处理翻译' });
  await expect(waitingDialog).toBeVisible();
  const commercialTab = page.getByRole('tab', { name: /价格与内部信息/ });
  const position = await commercialTab.boundingBox();
  expect(position).toBeTruthy();
  await page.mouse.click(position!.x + 5, position!.y + 5);
  await page.keyboard.press('Escape');
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect.poll(() => waitingDialog.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Enter');
  await expect(commercialTab).toHaveAttribute('aria-selected', 'false');
  await expect(waitingDialog).toBeVisible();
  release();
  await expect(waitingDialog).toBeHidden();
  await expect(page.getByText(/已自动保存 .*请重新打开发布预览核对/)).toBeVisible();
  expect(calls).toHaveLength(1); expect(JSON.parse(calls[0]!.body!)).toMatchObject({ sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters });
  expect(api.bundleSaves).toHaveLength(1);
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
  await expect.poll(() => api.bundleSaves.length).toBe(1);
  expect(api.bundleSaves[0]!.input.content.title.translations.en).toEqual(protectedTitle);
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
    await expect(page.getByRole('dialog', { name: '正在处理翻译' })).toBeHidden();
    await expect(planButton(page)).toBeEnabled();
    await expectUnfilled(page); expect(api.bundleSaves).toEqual([]); expect(api.saves).toEqual([]);
  });
}

test('workspace initial 401 requests login and never changes saved source text', async ({ page }) => {
  const item = record(); const before = structuredClone(item.draft); const api = await installApi(page, { items: [item] }); let calls = 0;
  await page.route(generatePath, route => { calls++; api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); });
  await openWorkspace(page, id); await generateSuggestions(page); await signIn(page); await expectUnfilled(page);
  expect(calls).toBe(1); expect(item.draft).toEqual(before); expect(api.bundleSaves).toEqual([]);
});

test('workspace unknown generation recovers through 401 and saves without reposting the paid request', async ({ page }) => {
  const item = record(); const saved = localization(item); const api = await installApi(page, { items: [item], localizations: [saved] });
  const calls: ReturnType<typeof snapshot>[] = []; let statusCalls = 0;
  await page.route(generatePath, route => { calls.push(snapshot(route)); return route.abort('failed'); });
  await page.route(planStatusPath, route => {
    if (route.request().method() !== 'GET') return route.fallback(); statusCalls++;
    if (statusCalls === 1) { api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); }
    const plan = api.translationPlans[0]!.plan; const now = new Date().toISOString();
    return reply(route, envelope(TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: id, state: 'completed', result: translationResult(translationBundle(item, saved), plan), startedAt: now, finishedAt: now })));
  });
  await openWorkspace(page, id); const plan = await generateSuggestions(page); await expect(recoverResult(page)).toBeEnabled();
  const frozen = structuredClone(calls[0]); await recoverResult(page).click(); await signIn(page);
  await recoverResult(page).click(); await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  expect(calls).toEqual([frozen]); expect(frozen!.key).toBeTruthy(); expect(JSON.parse(frozen!.body!)).toEqual({ confirmed: true, sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: true });
  expect(statusCalls).toBe(2); await expect.poll(() => api.bundleSaves.length).toBe(1);
});

for (const mutation of ['vehicle version', 'localization revision', 'source hash', 'target human revision', 'configuration', 'deleted vehicle'] as const) {
  test(`workspace recovered results cannot replace a changed ${mutation}`, async ({ page }) => {
    const item = record(); const saved = localization(item); const api = await installApi(page, { items: [item], localizations: [saved] });
    let result: ReturnType<typeof translationResult>;
    const calls: ReturnType<typeof snapshot>[] = [];
    await page.route(generatePath, route => { calls.push(snapshot(route)); result = translationResult(translationBundle(item, saved), api.translationPlans.at(-1)!.plan); return route.abort('failed'); });
    await page.route(planStatusPath, route => {
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
  expect(api.translationGenerations).toEqual([frozen]); expect(api.translationStatusReads).toHaveLength(1);
  await expect.poll(() => api.bundleSaves.length).toBe(1);
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
  expect(posts).toBe(1); expect(api.translationPlans).toHaveLength(1); expect(api.translationStatusReads).toHaveLength(1);
  await expect.poll(() => api.bundleSaves.length).toBe(1);
});

test('workspace historical Chinese mismatch can be synchronized explicitly without editing readonly source or inventing review', async ({ page }) => {
  const item = record(); item.draft.content.title.translations.zh = { text: '历史错误中文槽', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 7, engineVersion: null };
  item.draft.content.title.translations.en = { text: 'Protected English', kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 3, engineVersion: null };
  item.draft.content.title.translations.ru = { text: 'Сохранённый русский', kind: 'human', reviewStatus: 'approved', sourceVersion: 1, humanEditVersion: 5, engineVersion: null };
  for (const locale of ['en', 'ru'] as const) item.draft.content.description.translations[locale] = {
    text: locale === 'en' ? 'Existing English description' : 'Сохранённое описание',
    kind: 'human', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 1, engineVersion: null,
  };
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

test('workspace gateway failure keeps result recovery even if the plan has not appeared to start', async ({ page }) => {
  const api = await installApi(page, { items: [record()] });
  let executions = 0, statusReads = 0;
  await page.route(generatePath, route => {
    executions++;
    return route.fulfill({ status: 504, contentType: 'text/html', body: 'Gateway Timeout' });
  });
  await page.route(planStatusPath, route => {
    if (route.request().method() === 'GET') statusReads++;
    return route.fallback();
  });
  await openWorkspace(page, id); await generateSuggestions(page);
  await expect(page.getByRole('dialog', { name: '正在处理翻译' })).toBeHidden();
  await expect(recoverResult(page)).toBeEnabled();
  await expect(planButton(page)).toBeDisabled();
  expect(executions).toBe(1);
  expect(statusReads).toBe(0);
  expect(api.bundleSaves).toEqual([]);
});

test('workspace partial results auto-save and the top button resumes only missing targets', async ({ page }) => {
  const item = record(); item.draft.content.description.translations.ru = { text: 'Старое машинное описание', kind: 'machine', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 2, engineVersion: 'historic' };
  const legacy = { text: 'Мощность 84 kW', kind: 'machine' as const, reviewStatus: 'pending' as const, sourceVersion: 1, humanEditVersion: 3, engineVersion: 'historic' };
  const ref = `configuration.${vehicleConfigurationItemId('合成配置')}.value`;
  const saved = localization(item, [{ ref, sourceLanguage: 'zh', sourceText: '功率 85 kW', sourceVersion: 1, sourceHash: syntheticHash(ref),
    translations: { zh: null, en: { ...legacy, text: 'Power 85 kW' }, ru: legacy } }]);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  let executions = 0;
  await page.route(generatePath, route => {
    const result = translationResult(translationBundle(item, saved), api.translationPlans.at(-1)!.plan);
    const title = result.fields.find(field => field.ref === 'content.title')!;
    if (++executions === 1) {
      result.status = 'partial'; title.translations.ru = null;
      result.failures = [{ ref: 'content.title', targetLocale: 'ru', code: 'outcome_unknown' }];
    }
    return reply(route, envelope(TranslationPlanResultSchema.parse(result)));
  });
  await openWorkspace(page, id);
  await expect(planButton(page)).toHaveText('翻译剩余 3 项');
  const firstPlan = await generateSuggestions(page);
  expect(api.translationPlans[0]!.input.scope).toBe('missing');
  expect(firstPlan.fields.map(({ ref, targets }) => ({ ref, targets }))).toEqual([
    { ref: 'content.title', targets: ['en', 'ru'] }, { ref: 'content.description', targets: ['en'] },
  ]);
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue('Старое машинное описание');
  await expect(page.locator('.ant-alert-warning').filter({ hasText: '未完成部分可能已产生费用' })).toBeVisible();
  await expect(page.getByText(/调用结果未确认 1 项/)).toBeVisible();
  await expect(page.getByText(/已自动保存 2 项译文。还有 1 项译文待补/)).toBeVisible();
  await expect(page.getByText('· 调用结果未确认', { exact: true })).toBeVisible();
  await expect(bundleSave(page)).toBeDisabled();
  await expect(planButton(page)).toHaveText('翻译剩余 1 项');
  expect(api.bundleSaves[0]!.input.content.title.translations.ru).toBeNull();
  expect(api.bundleSaves[0]!.input.localization.fields[0]!.translations.ru).toEqual(legacy);
  expect(item.draft.content.title.translations.en).toMatchObject({ text: 'Machine generated title', kind: 'machine', reviewStatus: 'pending' });
  const remaining = await requestPlan(page);
  expect(api.translationPlans.at(-1)!.input).toEqual({ version: item.version, scope: 'missing', useCatalog: true });
  expect(remaining.fields.map(({ ref, targets }) => ({ ref, targets }))).toEqual([{ ref: 'content.title', targets: ['ru'] }]);
  expect(remaining.estimate).toMatchObject({ maximumRequests: 1, hourlyCharacterLimit: 50_000 });
  await expect(page.getByTestId('translation-plan-confirmation')).toContainText('目标语言：俄文');
  expect(executions).toBe(1);
  await confirmPlan(page);
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue('Машинный заголовок');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  await expect(page.getByText('已自动保存 1 项译文。请重新打开发布预览核对。', { exact: true })).toBeVisible();
  await expect(planButton(page)).toHaveText('翻译剩余 0 项');
  await expect(planButton(page)).toBeDisabled();
  expect(executions).toBe(2); expect(api.bundleSaves).toHaveLength(2);
});

test('workspace failed automatic save keeps generated text and allows saving from the top without another paid request', async ({ page }) => {
  const item = record(); const api = await installApi(page, { items: [item] });
  const tab = page.getByRole('tab', { name: '公开字段多语' });
  let writes = 0;
  let rejectSave!: () => void;
  const pending = new Promise<void>(resolve => { rejectSave = resolve; });
  await page.route(`**${bundlePath}`, async route => {
    if (route.request().method() !== 'PUT' || ++writes > 1) return route.fallback();
    await pending;
    return reply(route, error('VALIDATION_FAILED'), 422);
  });
  await openWorkspace(page, id);
  await generateSuggestions(page);
  await expect(page.getByRole('dialog', { name: '正在保存译文' })).toBeVisible();
  await expect(bundleSave(page)).toBeDisabled();
  rejectSave();
  await expect(page.getByText(/译文已生成，自动保存失败。当前译文仍保留/)).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('Machine generated title');
  await expect(bundleSave(page)).toBeEnabled();
  expect(api.bundleSaves).toEqual([]); expect(writes).toBe(1);
  await saveBundle(page);
  expect(api.bundleSaves).toHaveLength(1); expect(api.translationGenerations).toHaveLength(1);
});

test('workspace completely rejected translations keep the top retry available without a save', async ({ page }) => {
  const item = record(); const saved = localization(item);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  await page.route(generatePath, route => {
    const result = translationResult(translationBundle(item, saved), api.translationPlans[0]!.plan);
    result.status = 'partial';
    result.failures = result.fields.flatMap(field => (['en', 'ru'] as const).map(targetLocale => {
      field.translations[targetLocale] = null;
      return { ref: field.ref, targetLocale, code: 'invalid_result' as const };
    }));
    return reply(route, envelope(TranslationPlanResultSchema.parse(result)));
  });
  await openWorkspace(page, id);
  await generateSuggestions(page);
  await expect(page.getByText(/本次没有获得新的可用译文.*译文校验未通过 4 项/)).toBeVisible();
  await expect(planButton(page)).toBeEnabled();
  await expectUnfilled(page);
  expect(api.bundleSaves).toEqual([]);
});

test('workspace identifies the rejected configuration locale and focuses it for manual completion', async ({ page }) => {
  const item = record();
  const name = '合成OTA升级';
  const ref = `configuration.${vehicleConfigurationItemId(name)}.name`;
  item.draft.configuration = { version: 1, items: [{ name, value: '标配' }] };
  const saved = localization(item, [{
    ref, sourceLanguage: 'zh', sourceText: name, sourceVersion: 1, sourceHash: syntheticHash(name),
    translations: { zh: null, en: null, ru: null },
  }]);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  let executions = 0;
  await page.route(generatePath, route => {
    executions++;
    const result = translationResult(translationBundle(item, saved), api.translationPlans[0]!.plan);
    result.fields.find(field => field.ref === ref)!.translations.ru = null;
    result.fields.find(field => field.ref === 'content.description')!.translations.en = null;
    result.status = 'partial';
    result.failures = [
      { ref, targetLocale: 'ru', code: 'invalid_result', reason: 'facts_mismatch' },
      { ref: 'content.description', targetLocale: 'en', code: 'invalid_result', reason: 'output_constraint' },
    ];
    return reply(route, envelope(TranslationPlanResultSchema.parse(result)));
  });
  await openWorkspace(page, id);
  await generateSuggestions(page);
  const editTarget = page.getByRole('button', { name: `编辑${name} · 配置名称 · 俄文` });
  const input = page.getByLabel(`俄文${name} · 配置名称`, { exact: true });
  const constraint = page.getByText('· 译文格式、长度或内容未通过校验', { exact: true });
  await expect(page.getByText('· 本次未获得可用译文', { exact: true })).toBeVisible();
  await expect(constraint).toBeVisible();
  await expect(input).toBeHidden();
  await editTarget.click();
  await expect(input).toBeFocused();
  await input.fill('OTA-обновление');
  await saveBundle(page);
  await expect(editTarget).toHaveCount(0);
  await expect(constraint).toBeVisible();
  expect(api.bundleSaves).toHaveLength(2);
  expect(api.bundleSaves[1]!.input.localization.fields[0]!.translations.ru).toMatchObject({ text: 'OTA-обновление', kind: 'human' });
  await page.reload(); await tab(page, '公开字段多语');
  await expect(constraint).toHaveCount(0);
  await page.getByRole('button', { name: '编辑车况描述 · 英文' }).click();
  await expect(page.getByLabel('英文描述', { exact: true })).toBeFocused();
  expect(executions).toBe(1); expect(api.translationPlans).toHaveLength(1);
});

for (const scenario of ['catalog-only', 'mixed catalog', 'first generation'] as const) {
  test(`workspace ${scenario} plan preserves the exact supplier cost confirmation`, async ({ page }) => {
    const usesSupplier = scenario !== 'catalog-only';
    const initial = scenario === 'first generation';
    const item = record();
    const name = '合成OTA升级';
    const ref = `configuration.${vehicleConfigurationItemId(name)}.name`;
    item.draft.configuration = { version: 1, items: [{ name, value: '标配' }] };
    const existingEnglish = { text: 'Existing English', kind: 'human' as const, reviewStatus: 'pending' as const,
      sourceVersion: 1, humanEditVersion: 1, engineVersion: null };
    if (!initial) {
      for (const field of Object.values(item.draft.content)) {
        field.translations.en = { ...existingEnglish, sourceVersion: field.sourceVersion };
        field.translations.ru = { ...existingEnglish, text: 'Существующий перевод', sourceVersion: field.sourceVersion };
      }
    }
    const saved = localization(item, [{
      ref, sourceLanguage: 'zh', sourceText: name, sourceVersion: 1, sourceHash: syntheticHash(name),
      translations: { zh: null, en: usesSupplier ? null : existingEnglish, ru: null },
    }]);
    const api = await installApi(page, { items: [item], localizations: [saved] });
    const bundle = translationBundle(item, saved);
    const estimate = translationPlan(bundle, undefined, 'missing');
    const plan = TranslationPlanSchema.parse({
      ...estimate,
      provider: usesSupplier ? estimate.provider : 'disabled',
      engineVersion: usesSupplier ? estimate.engineVersion : null,
      catalogVersion: CONFIGURATION_TRANSLATION_CATALOG_VERSION,
      fields: estimate.fields.map(field => field.ref === ref ? { ...field, catalogTargets: ['ru'] } : field),
      estimate: { ...estimate.estimate, maximumCharacters: estimate.estimate.maximumCharacters - name.length, maximumRequests: estimate.estimate.maximumRequests - 1,
        cost: usesSupplier ? estimate.estimate.cost : { status: 'no_supplier_calls', amount: 0, currency: null, freeAllowanceCharacters: null } },
    });
    const requests: unknown[] = [];
    await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans`, route => {
      expect(route.request().postDataJSON()).toEqual({ version: item.version, scope: 'missing', useCatalog: true });
      return reply(route, TranslationPlanResponseSchema.parse(envelope(plan)));
    });
    await page.route(generatePath, route => {
      requests.push(route.request().postDataJSON());
      return reply(route, envelope(translationResult(bundle, plan)));
    });
    await openWorkspace(page, id);
    if (initial) await expect(planButton(page)).toHaveText('生成翻译');
    await requestPlan(page);
    const dialog = page.getByTestId('translation-plan-confirmation');
    const start = page.getByTestId('translation-plan-start');
    await expect(dialog).toContainText('俄文（本地术语）');
    expect(requests).toEqual([]);
    if (usesSupplier) {
      await expect(dialog).toContainText('费用及免费额度未知');
      await expect(dialog).toContainText(`最多 ${plan.estimate.maximumRequests} 次请求`);
      await expect(start).toBeDisabled();
      await confirmPlan(page);
    } else {
      await expect(dialog).toContainText('使用本地术语，无供应商费用');
      await expect(page.getByTestId('translation-generate-confirm')).toHaveCount(0);
      await expect(start).toBeEnabled();
      await page.getByRole('dialog', { name: '确认本地术语' }).getByRole('button', { name: /取\s*消/ }).click();
      // The modal may retain its closing button. A late click still cannot submit.
      await start.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await expect(dialog).toBeHidden();
      await requestPlan(page);
      expect(requests).toEqual([]);
      await start.click();
    }
    await expect.poll(() => api.bundleSaves.length).toBe(1);
    expect(requests).toEqual([{ confirmed: true, sourceFingerprint: plan.sourceFingerprint,
      maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: usesSupplier }]);
    const translations = api.bundleSaves[0]!.input.localization.fields[0]!.translations;
    expect(translations.ru).toMatchObject({ engineVersion: CONFIGURATION_TRANSLATION_CATALOG_VERSION, kind: 'machine', reviewStatus: 'pending' });
    if (usesSupplier) expect(translations.en?.engineVersion).toBe(plan.engineVersion);
    else expect(translations.en).toEqual(existingEnglish);
  });
}

test('workspace after reload explicitly recovers the previous receipt without saving blocked targets or generating again', async ({ page }) => {
  const item = record(); const saved = localization(item);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  const original = translationBundle(item, saved);
  const plan = translationPlan(original, undefined, 'missing');
  const result = translationResult(original, plan);
  const title = result.fields.find(field => field.ref === 'content.title')!;
  title.translations.ru = null;
  result.status = 'partial';
  result.failures = [{ ref: title.ref, targetLocale: 'ru', code: 'invalid_result' }];
  const blockedTargets = [{ ref: 'content.description', targetLocale: 'ru' }];
  let reads = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans/recoverable`, route => {
    expect(route.request().method()).toBe('GET');
    reads++;
    return reply(route, envelope(item.version === original.vehicle.version ? { plan, result, blockedTargets } : null));
  });
  const recover = page.getByRole('button', { name: '恢复并保存上次译文' });
  await openWorkspace(page, id);
  await expect(recover).toBeEnabled();
  await page.reload(); await tab(page, '公开字段多语');
  await expect(recover).toBeEnabled();
  await expectUnfilled(page);
  expect(reads).toBe(2); expect(api.bundleSaves).toEqual([]);
  await recover.click();
  await expect(page.getByText(/已自动保存 2 项译文。还有 2 项译文待补/)).toBeVisible();
  await expect(recover).toHaveCount(0);
  await expect(planButton(page)).toHaveText('翻译剩余 2 项');
  expect(api.bundleSaves).toHaveLength(1);
  expect(api.bundleSaves[0]!.input).toMatchObject({ version: original.vehicle.version, localizationRevision: original.localization.revision });
  expect(api.bundleSaves[0]!.input.content.description.translations.ru).toBeNull();
  expect(api.translationPlans).toEqual([]); expect(api.translationGenerations).toEqual([]);
});

test('workspace restores a previous receipt against the latest saved revision without retranslation', async ({ page }) => {
  const item = record(); const saved = localization(item);
  const original = translationBundle(item, saved);
  const plan = translationPlan(original, undefined, 'missing');
  const result = translationResult(original, plan);
  item.version++;
  saved.vehicleVersion = item.version;
  saved.revision++;
  const employeeTitle = { text: 'Staff English title', kind: 'human' as const, reviewStatus: 'pending' as const,
    sourceVersion: item.draft.content.title.sourceVersion, humanEditVersion: 2, engineVersion: null };
  item.draft.content.title.translations.en = employeeTitle;
  const adoptionBase = { vehicleVersion: item.version, localizationRevision: saved.revision };
  const api = await installApi(page, { items: [item], localizations: [saved] });
  await page.route(`**/api/v1/admin/vehicles/${id}/translation-plans/recoverable`, route => reply(route, envelope({
    plan, result, blockedTargets: [{ ref: 'content.title', targetLocale: 'en' }], adoptionBase,
  })));

  await openWorkspace(page, id);
  await page.getByRole('button', { name: '恢复并保存上次译文' }).click();
  await expect(page.getByText('已自动保存 3 项译文。请重新打开发布预览核对。', { exact: true })).toBeVisible();
  expect(api.bundleSaves).toHaveLength(1);
  expect(api.bundleSaves[0]!.input).toMatchObject({
    version: adoptionBase.vehicleVersion, localizationRevision: adoptionBase.localizationRevision,
    content: { title: { translations: { en: employeeTitle, ru: { kind: 'machine' } } } },
  });
  expect(api.translationPlans).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
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
  await expect(planButton(page)).toHaveText('翻译剩余 0 项');
  await expect(planButton(page)).toBeDisabled();
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue('Protected source translation');
  await page.locator('.ant-collapse-header').filter({ hasText: '车辆配置译文' }).click();
  await expect(page.getByLabel(`俄文${name} · 配置内容`, { exact: true })).toHaveValue('Электрорегулировка в 4 направлениях');
  expect(api.bundleSaves).toEqual([]);
  expect(api.translationPlans).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});

test('workspace a historical draft without a saved title cannot request a plan', async ({ page }) => {
  const item = record();
  item.draft.content.title.sourceText = null;
  const api = await installApi(page, { items: [item] });
  await openWorkspace(page, id);
  await expect(planButton(page)).toBeDisabled();
  await expect(page.getByText('请先在基础资料填写并保存中文标题。', { exact: true })).toBeVisible();
  expect(api.translationPlans).toEqual([]);
});
