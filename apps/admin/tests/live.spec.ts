import { expect, test, type Page } from '@playwright/test';
import { AdminVehicleResponseSchema, AdminVehicleListSchema, BulkVehicleMutationResponseSchema, AdminHomeSectionsResponseSchema, AdminVehicleFiltersResponseSchema, MediaAssetResponseSchema, MediaUploadRequestSchema, VehicleTranslationSuggestionsResponseSchema, type AdminVehicle } from '@hd/contracts/admin';
import { PublicVehicleResponseSchema, PublicVehicleListSchema, PublicHomeSectionsSchema } from '@hd/contracts/public';
import { newName, notes, select, tab } from './ui-helpers';
import { acknowledgePublicationPreview, chooseYear, chooseUtcDateTime } from './publication-test-helpers';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { ExternalBatchRecordsResponseSchema, ExternalTrialResponseSchema } from '@hd/contracts/admin';
import { makeExternalImportFixture } from '@hd/contracts/fixtures';
import { extendRateDeadline, rateCooldownMs, rateLimitSeconds } from './live-rate-window';
import { assertDisabledLivePlan, assertLivePublicConfiguration, completeLiveTranslations, enterLiveConfiguration, expandLiveTranslationGroup, liveConfiguration, readLiveBundle, saveLiveBundle } from './ux11-live-helpers';

const rateWindows = new WeakMap<Page, { deadline: number; observations: number }>();
function observeRateWindow(page: Page, response: { url(): string; headers(): Record<string, string> }) {
  const url = new URL(response.url());
  if (url.origin !== 'http://127.0.0.1:3319' || !(url.pathname.startsWith('/api/v1/admin/') || url.pathname.startsWith('/api/auth/'))) return;
  const state = rateWindows.get(page);
  if (!state) return;
  const next = extendRateDeadline(state.deadline, response.headers(), Date.now());
  if (next !== state.deadline) { state.deadline = next; state.observations++; }
}
async function waitForServerWindow(waitMs: number, reason: 'afterEach' | 'login-429' | 'external-published-to-deletion') {
  if (!waitMs) return;
  // Used at teardown, the one observed login 429, or an explicit completed business-stage boundary.
  // Existing test failures and all UI/action timeouts remain unchanged.
  const info = test.info();
  info.setTimeout(info.timeout + waitMs);
  await test.step(`等待服务端限流窗口：${reason}（${waitMs}ms）`, async () => {
    console.log(JSON.stringify({ event: 'live-server-rate-window', reason, waitMs }));
    await new Promise(resolve => setTimeout(resolve, waitMs));
  });
}
test.beforeEach(async ({ page }) => {
  rateWindows.set(page, { deadline: 0, observations: 0 });
  page.on('response', response => observeRateWindow(page, response));
});
test.afterEach(async ({ page }) => {
  // Stop iframe/readiness traffic before measuring the final window, including after a failed body.
  await page.close();
  const state = rateWindows.get(page);
  await waitForServerWindow(rateCooldownMs(state?.deadline ?? 0, Date.now()), 'afterEach');
  rateWindows.delete(page);
});

async function login(page: Page, path = '/admin/vehicles') {
  const allowedDatabase = process.env.ADMIN_LIVE_EXTERNAL === 'synthetic-only' ? /^hd_ext_ad_[a-f0-9]{16}$/ : /^hd_admin_test_[a-f0-9]{16}$/;
  if (!process.env.ADMIN_TEST_PASSWORD || process.env.ADMIN_LIVE_TEST !== '1' || process.env.ADMIN_LIVE_ORIGIN || process.env.ADMIN_API_TARGET !== 'http://127.0.0.1:3322' || !allowedDatabase.test(process.env.ADMIN_TEST_DB_NAME ?? '')) throw new Error('Use the isolated live runner only.');
  const isIdentityResponse = (response: import('@playwright/test').Response) => response.request().method() === 'GET'
    && response.url() === 'http://127.0.0.1:3319/api/v1/admin/me';
  const [initialIdentity] = await Promise.all([page.waitForResponse(isIdentityResponse, { timeout: 15_000 }), page.goto(path)]);
  let identity = initialIdentity;
  if (identity.status() === 429) {
    const seconds = rateLimitSeconds(identity.headers()['retry-after']);
    expect(seconds, 'Login 429 must provide a relative Retry-After between 1 and 60 seconds').not.toBeNull();
    await waitForServerWindow(rateCooldownMs(Date.now() + seconds! * 1000, Date.now()), 'login-429');
    [identity] = await Promise.all([
      page.waitForResponse(isIdentityResponse, { timeout: 15_000 }),
      page.getByRole('button', { name: /重新连接$/ }).click(),
    ]);
  }
  // A second 429 or any unexpected response fails here, before waiting for a missing login field.
  expect(identity.status(), 'A fresh isolated browser must reach the unauthenticated login form').toBe(401);
  await page.getByLabel('账号或工作邮箱').fill('browser-test@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill(process.env.ADMIN_TEST_PASSWORD);
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('heading', { name: '车辆管理', exact: true })).toBeVisible();
}
async function save(page: Page, id?: string) {
  // Core facts and the translation bundle have separate save actions in UX11.
  await tab(page, '基础资料');
  const response = page.waitForResponse(r => r.url().endsWith(`/api/v1/admin/vehicles${id ? `/${id}` : ''}`) && r.request().method() === (id ? 'PATCH' : 'POST'));
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  const saved = await response;
  expect(saved.status()).toBe(id ? 200 : 201);
  const vehicle = AdminVehicleResponseSchema.parse(await saved.json()).data;
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled();
  return vehicle;
}
async function create(page: Page, kind: 'manual' | 'demo', title: string) {
  await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: kind === 'manual' ? '真实车源录入' : '展示样例，非实际库存' }).click();
  await newName(page, '品牌', `${kind === 'manual' ? '真实' : '展示'}联调品牌${Date.now()}`);
  await newName(page, '车型', '隔离测试车型');
  await page.getByLabel('标题原文', { exact: true }).fill(title);
  if (kind === 'manual') await select(page, '所在地国家', '中国');
  await (await notes(page)).fill('PRIVATE_AD_UX_ONLY');
  return save(page);
}
async function selectPetrolFromUnknown(page: Page) {
  const input = page.getByRole('combobox', { name: '动力类型', exact: true });
  await input.click();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const activeLabel = async () => {
    const activeId = await input.getAttribute('aria-activedescendant');
    return activeId ? page.locator(`[id="${activeId}"]`).getAttribute('aria-label') : null;
  };
  // The selected last option scrolls Ant's virtual list past petrol; keyboard navigation renders it.
  await expect.poll(activeLabel).toBe('未知');
  await input.press('ArrowDown');
  await expect.poll(activeLabel).toBe('汽油');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ant-select').filter({ has: input }).getByTitle('汽油', { exact: true })).toBeVisible();
}
async function selectCurrency(page: Page, label: '公开价格币种' | '采购成本币种', currency: 'USD' | 'CNY') {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.click();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toHaveAttribute('aria-controls', /\S+/);
  const controls = await input.getAttribute('aria-controls');
  const list = page.locator(`[id=${JSON.stringify(controls)}]`);
  const popup = page.locator('.ant-select-dropdown:visible').filter({ has: list });
  await expect(popup).toHaveCount(1);
  // Currency labels also appear in the hidden accessibility list; click the rendered option only.
  const option = popup.locator('.ant-select-item-option-content:visible').filter({ hasText: new RegExp(`^${currency}$`) });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ant-select').filter({ has: input }).getByTitle(currency, { exact: true })).toBeVisible();
}
async function contentAndImage(page: Page, vehicle: AdminVehicle) {
  if (vehicle.draft.source.kind === 'manual') {
    await tab(page, '基础资料');
    await page.getByLabel('配置名称', { exact: true }).fill('隔离合成测试配置');
    await chooseYear(page, '年款', 2024);
    await selectPetrolFromUnknown(page);
    await page.getByLabel('里程（公里）', { exact: true }).fill('12345');
    await tab(page, '价格与内部信息');
    await select(page, '公开价格口径', '公开报价');
    await page.getByLabel('公开价格金额', { exact: true }).fill('20000');
    await selectCurrency(page, '公开价格币种', 'USD');
    await page.getByLabel('内部采购成本', { exact: true }).fill('15000');
    await selectCurrency(page, '采购成本币种', 'USD');
    await page.getByLabel('车况描述', { exact: true }).fill('仅供隔离测试的合成车况，不是真实库存或车辆承诺。');
    await enterLiveConfiguration(page);
    vehicle = await save(page, vehicle.id);
    expect(vehicle.draft.configuration).toEqual(liveConfiguration);
    expect(vehicle.draft.facts.powertrain).toBe('petrol');
    expect(vehicle.draft.price.money?.currency).toBe('USD');
    expect(vehicle.draft.internal.purchaseCost?.currency).toBe('USD');
  }
  await tab(page, '图片管理');
  await page.getByLabel('图片来源／授权说明', { exact: true }).fill('隔离浏览器测试生成图片，不是真实库存。');
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const ctx = c.getContext('2d')!; ctx.fillStyle = '#315b50'; ctx.fillRect(0, 0, 64, 48); return c.toDataURL('image/png').split(',')[1]!; }), 'base64');
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('textbox', { name: '图片 1 说明', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '图片 1 说明', exact: true }).fill('合成测试封面');
  return save(page, vehicle.id);
}
async function operation(page: Page, id: string, button: string, route: string) {
  await tab(page, '发布预览');
  if (route === 'publish') {
    await expect(page.getByTestId('vehicle-publish')).toHaveText('请完善信息');
    await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
    await acknowledgePublicationPreview(page);
    await expect(page.getByTestId('vehicle-publish')).toHaveText(button);
    await page.getByTestId('vehicle-publish').click();
  } else await page.getByRole('button', { name: new RegExp(button + '$') }).click();
  const response = page.waitForResponse(r => r.url().endsWith(`/api/v1/admin/vehicles/${id}/${route}`) && r.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  return response;
}
async function screenshot(page: Page, name: string) {
  await mkdir('/private/tmp/hd-ad-ux-evidence', { recursive: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true, animations: 'disabled' });
  await copyFile(`test-results/${name}.png`, `/private/tmp/hd-ad-ux-evidence/${name}.png`);
}
async function fitsViewport(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: 'Page fits viewport after responsive layout settles' }).toBeLessThanOrEqual(0);
}

/** Only safe reads retry 429; writes always go through the UI's explicit confirmation. */
async function readRespectingRateLimit(page: Page, url: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await page.request.get(url);
    observeRateWindow(page, response);
    if (response.status() !== 429 || attempt === 4) return response;
    const seconds = Number(response.headers()['retry-after']);
    const minimumMs = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60_000;
    const waitMs = Math.min(60_000, minimumMs * 2 ** attempt + 250);
    console.log(`Read-only verification reached rate protection; Retry-After=${seconds}s, bounded backoff=${waitMs}ms before retry ${attempt + 1}.`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  throw new Error('Unreachable bounded read retry.');
}

test('real external catalog supports admin import, trial and override', async ({ page }) => {
  test.skip(process.env.ADMIN_LIVE_EXTERNAL !== 'synthetic-only');
  expect(process.env.EXTERNAL_CATALOG_MODE).toBe('synthetic');
  expect(process.env.TRANSLATION_PROVIDER).toBe('disabled');
  await login(page);
  await page.goto('/admin/external-sources/batches');
  await page.getByRole('button', { name: '导入批次' }).click();
  const input = makeExternalImportFixture(100);
  await page.getByLabel('规范化批次 JSON').setInputFiles({
    name: 'synthetic-batch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)),
  });
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByText('导入完成，请查看批次结果。')).toBeVisible();
  await page.getByRole('link', { name: '查看批次' }).click();
  const batchId = new URL(page.url()).pathname.split('/').at(-1);
  const batchPath = `/api/v1/admin/external/batches/${batchId}`;
  const records = ExternalBatchRecordsResponseSchema.parse(await (await page.request.get(`${batchPath}/records?page=1&pageSize=100`)).json());
  const ids = records.data.items.flatMap(item => item.listingId ? [item.listingId] : []);
  expect(new Set(ids).size).toBe(100);
  await page.getByRole('textbox', { name: '试译挂牌编号' }).fill(ids.join('\n'));
  await page.getByRole('button', { name: '测算试译用量' }).click();
  await expect(page.getByText('已记录试译测算')).toBeVisible();
  const trial = ExternalTrialResponseSchema.parse(await (await page.request.get(`${batchPath}/translation-trial`)).json());
  expect(trial.data?.budget).toMatchObject({ accountFreeRemaining: null, attemptedCharacters: 0, realCalls: 0 });
  await page.getByRole('link', { name: '查看来源' }).first().click();
  await page.getByRole('button', { name: '读取受保护原档' }).click();
  await expect(page.getByText(/PRIVATE_RAW_MARKER/)).toBeVisible();
  await page.getByRole('link', { name: '查看当前挂牌' }).click();
  await page.getByRole('button', { name: '人工修订' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: '标题 · 中文人工文案', exact: true }).fill('员工修订的合成标题');
  await page.getByRole('dialog').getByRole('button', { name: '保存修订' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const publicResponse = await page.request.get(`/api/v1/vehicles/${ids[0]}?locale=zh&view=localized`);
  expect(publicResponse.ok()).toBe(true);
  const published = PublicVehicleResponseSchema.parse(await publicResponse.json());
  expect(published.data.content.title.text).toBe('员工修订的合成标题');
  expect(JSON.stringify(published)).not.toContain('PRIVATE_RAW_MARKER');
});

test('real localization sidecar preserves public language snapshots with disabled translation', async ({ page }) => {
  test.setTimeout(180_000);
  expect(process.env.ADMIN_LIVE_TRANSLATION_PROVIDER).toBe('disabled');
  expect(process.env.TRANSLATION_PROVIDER).toBe('disabled');
  const privateMarker = 'PRIVATE_I18N02_SYNTHETIC_ONLY';
  const model = { zh: '合成中文车型', en: 'Synthetic model', ru: 'Синтетическая модель' };
  const alt = { zh: '合成测试封面', en: 'Synthetic cover image', ru: 'Синтетическое изображение' };
  const generation = { zh: '合成测试代系', en: 'Synthetic generation', ru: 'Синтетическое поколение' };
  let translationExecutions = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (path.endsWith('/translation-suggestions') || /\/translation-plans\/[^/]+\/generate$/.test(path))) translationExecutions++;
  });
  await login(page); await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '展示样例，非实际库存' }).click();
  await select(page, '品牌', '丰田 / Toyota'); await newName(page, '车型', model.zh);
  await page.getByLabel('标题原文', { exact: true }).fill('多语字段隔离展示样例'); await (await notes(page)).fill(privateMarker);
  const initial = await save(page); const ready = await contentAndImage(page, initial);
  expect(ready.draft.internal.notes).toBe(privateMarker); expect(ready.draft.media).toHaveLength(1);
  async function evidence(name: string) {
    await mkdir('/private/tmp/hd-ad-i18n02-evidence', { recursive: true });
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 }); await fitsViewport(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `/private/tmp/hd-ad-i18n02-evidence/real-disabled-${name}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const read = (path: string) => readRespectingRateLimit(page, path);
  const before = await readLiveBundle(initial.id, read);
  expect(before.localization.data.facts).toEqual({ generation: null, drivetrain: null });
  expect(before.localization.data.fields.map(field => field.ref)).toEqual(['model', `media.${ready.draft.media[0]!.id}.alt`]);
  expect(before.sourceLanguageConfirmationRequired).toEqual([]);
  expect(before.localization.data.fields.every(field => field.sourceLanguage === 'zh')).toBe(true);
  await assertDisabledLivePlan(page, before, read);
  const translated = await completeLiveTranslations(page, ready, read, {
    display: { model, [`media.${ready.draft.media[0]!.id}.alt`]: alt },
  });
  expect(translated.vehicle.draft.internal.notes).toBe(privateMarker);
  await evidence('display-saved-pending');
  let publishCalls = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api/v1/admin/vehicles/${initial.id}/publish`)) publishCalls++; });
  const firstPublish = await operation(page, initial.id, '发布车辆', 'publish'); expect(firstPublish.status()).toBe(200);
  const first = AdminVehicleResponseSchema.parse(await firstPublish.json()).data; expect(first.hasUnpublishedChanges).toBe(false);
  async function verifyPublic(expectedEnglish: string, publishedGeneration: typeof generation | null = null) {
    for (const locale of ['zh', 'en', 'ru'] as const) {
      const response = await readRespectingRateLimit(page, `/api/v1/vehicles/${initial.id}?locale=${locale}&view=localized`); expect(response.status()).toBe(200);
      const raw = await response.text();
      for (const secret of [privateMarker, 'purchaseCost', 'supplierContact', 'sourceHash', 'humanEditVersion', 'engineVersion']) expect(raw).not.toContain(secret);
      const publicVehicle = PublicVehicleResponseSchema.parse(JSON.parse(raw)).data;
      expect(publicVehicle.source.kind).toBe('demo'); expect(publicVehicle.availability).toBe('unknown');
      expect(publicVehicle.facts.model?.name).toBe(locale === 'en' ? expectedEnglish : model[locale]);
      expect(publicVehicle.display?.model).toMatchObject({ status: 'ready', text: locale === 'en' ? expectedEnglish : model[locale], requestedLocale: locale, contentLocale: locale, provenance: locale === 'zh' ? 'original' : 'human', reviewed: false });
      expect(publicVehicle.images[0]!.alt).toBe(alt[locale]);
      expect(publicVehicle.display?.mediaAlt.find(entry => entry.mediaId === ready.draft.media[0]!.id)?.value).toMatchObject({ status: 'ready', text: alt[locale], contentLocale: locale });
      if (publishedGeneration) {
        expect(publicVehicle.facts.generation?.name).toBe(publishedGeneration[locale]);
        expect(publicVehicle.display?.generation).toMatchObject({ status: 'ready', text: publishedGeneration[locale], contentLocale: locale,
          provenance: locale === 'zh' ? 'original' : 'human', reviewed: false });
        expect(publicVehicle.facts.drivetrain).toBe('awd');
      } else {
        expect(publicVehicle.facts.generation).toBeNull(); expect(publicVehicle.facts.drivetrain).toBeNull();
      }
    }
  }
  await verifyPublic(model.en);
  const beforeFacts = await readLiveBundle(initial.id, read);
  expect(beforeFacts.vehicle.version).toBe(first.version);
  await tab(page, '公开字段多语');
  await expandLiveTranslationGroup(page, '补充代系与驱动形式');
  await page.getByRole('textbox', { name: '代系名称', exact: true }).fill(generation.zh);
  await select(page, '驱动形式', '全轮驱动');
  // The same bundle transaction saves extra facts and derives the new field on the server.
  // No client-invented ref, per-field review, or provider request participates in this change.
  const factsSaved = await saveLiveBundle(page, initial.id);
  expect(factsSaved.input.version).toBe(beforeFacts.vehicle.version);
  expect(factsSaved.input.localizationRevision).toBe(beforeFacts.localization.revision);
  expect(factsSaved.input.localization.facts).toMatchObject({ generation: { name: generation.zh }, drivetrain: 'awd' });
  expect(factsSaved.input.localization.fields).toEqual(beforeFacts.localization.data.fields);
  expect(factsSaved.bundle.localization.data.facts).toEqual(factsSaved.input.localization.facts);
  expect(factsSaved.bundle.vehicle.draft).toEqual(beforeFacts.vehicle.draft);
  expect(factsSaved.bundle.sourceLanguageConfirmationRequired).toEqual([]);
  expect(factsSaved.bundle.localization.data.fields.filter(field => field.ref !== 'generation')).toEqual(beforeFacts.localization.data.fields);
  const generationField = factsSaved.bundle.localization.data.fields.find(field => field.ref === 'generation');
  expect(generationField).toMatchObject({ sourceLanguage: 'zh', sourceText: generation.zh, sourceVersion: 1,
    translations: { zh: { text: generation.zh, kind: 'original', reviewStatus: 'pending', sourceVersion: 1 }, en: null, ru: null } });
  await expandLiveTranslationGroup(page, '车辆展示资料');
  await expect(page.getByLabel('代系名称原文（只读）', { exact: true })).toHaveValue(generation.zh);
  await expect(page.getByLabel('英文代系名称', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('俄文代系名称', { exact: true })).toHaveValue('');
  await page.getByLabel('英文代系名称', { exact: true }).fill(generation.en);
  await page.getByLabel('俄文代系名称', { exact: true }).fill(generation.ru);
  await page.getByLabel('英文车型名称', { exact: true }).fill('Synthetic revised model');
  const revision = await saveLiveBundle(page, initial.id);
  expect(revision.input.version).toBe(factsSaved.bundle.vehicle.version);
  expect(revision.input.localizationRevision).toBe(factsSaved.bundle.localization.revision);
  const savedGeneration = revision.bundle.localization.data.fields.find(field => field.ref === 'generation');
  for (const locale of ['en', 'ru'] as const) expect(savedGeneration?.translations[locale]).toMatchObject({
    text: generation[locale], kind: 'human', reviewStatus: 'pending', sourceVersion: generationField!.sourceVersion,
  });
  expect(revision.bundle.localization.data.fields.filter(field => field.ref !== 'generation' && field.ref !== 'model'))
    .toEqual(beforeFacts.localization.data.fields.filter(field => field.ref !== 'model'));
  const changedResponse = await readRespectingRateLimit(page, `/api/v1/admin/vehicles/${initial.id}`); expect(changedResponse.status()).toBe(200);
  const changed = AdminVehicleResponseSchema.parse(await changedResponse.json()).data;
  expect(changed.hasUnpublishedChanges).toBe(true); expect(changed.publishedRevisionId).toBe(first.publishedRevisionId); expect(changed.draft).toEqual(first.draft);
  expect(revision.bundle.vehicle.version).toBe(changed.version); expect(publishCalls).toBe(1);
  await verifyPublic(model.en); await tab(page, '发布预览');
  await expect(page.getByTestId('vehicle-publish')).toHaveText('请完善信息');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled(); await evidence('translation-only-unpublished');
  const secondPublish = await operation(page, initial.id, '发布已保存的修改', 'publish'); expect(secondPublish.status()).toBe(200);
  const second = AdminVehicleResponseSchema.parse(await secondPublish.json()).data;
  expect(second.publishedRevisionId).not.toBe(first.publishedRevisionId); expect(second.hasUnpublishedChanges).toBe(false);
  await verifyPublic('Synthetic revised model', generation);
  await expect(page.getByTestId('vehicle-publish')).toHaveText('已发布，暂无待发布修改');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  await page.reload(); await tab(page, '发布预览');
  await expect(page.getByTestId('vehicle-publish')).toHaveText('已发布，暂无待发布修改');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled(); expect(publishCalls).toBe(2);
  expect(translationExecutions).toBe(0);
  await writeFile('/private/tmp/hd-ad-i18n02-evidence/real-disabled-sidecar-summary.json', JSON.stringify({ sampleKind: 'Real API isolated synthetic demo; translator disabled; all translations entered manually', provider: 'disabled', vehicleId: initial.id, refs: revision.bundle.localization.data.fields.map(field => field.ref), firstPublication: first.publishedRevisionId, secondPublication: second.publishedRevisionId, model, alt, generation, drivetrain: 'awd', revisedEnglish: 'Synthetic revised model', publishCalls, translationExecutions }, null, 2));
});

test('real cookie login, draft persistence/privacy and logout', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: '车辆管理', exact: true })).toBeVisible();
  expect((await page.context().cookies()).some(c => c.httpOnly && c.path === '/api' && c.sameSite === 'Lax')).toBe(true);
  const initial = await create(page, 'manual', '隔离草稿车辆');
  expect(initial.draft.price).toEqual({ kind: 'asking', money: { amount: null, currency: 'USD' }, includes: [] });
  expect(initial.draft.facts.manufacturedAt).toBeNull();
  expect(initial.draft.facts.registrationStatus).toBe('registered');
  expect(initial.draft.facts.firstRegistration).toBeNull();
  expect(initial.draft.configuration).toBeNull();
  let invalidConfigurationWrites = 0;
  const observeInvalidWrite = (request: import('@playwright/test').Request) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/admin/vehicles/${initial.id}`) invalidConfigurationWrites++;
  };
  page.on('request', observeInvalidWrite);
  await tab(page, '车辆配置');
  await page.getByLabel('配置内容（JSON）', { exact: true }).fill('{"version":1,"version":1,"items":[{"name":"座位数","value":"5"}]}');
  await expect(page.getByLabel('配置内容（JSON）', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled();
  expect(invalidConfigurationWrites).toBe(0);
  await page.getByLabel('配置内容（JSON）', { exact: true }).fill('');
  page.off('request', observeInvalidWrite);
  await (await notes(page)).fill('PRIVATE_UPDATED');
  await save(page, initial.id);
  await page.reload();
  await expect(await notes(page)).toHaveValue('PRIVATE_UPDATED');
  expect((await page.request.get(`/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  await page.getByRole('button', { name: /退出登录$/ }).click();
  await expect(page.getByRole('heading', { name: '登录员工工作台' })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/me')).status()).toBe(401);
});

test('manual image/translation/inventory publishing, draft snapshot and archive', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const initial = await create(page, 'manual', '人工车源完整隔离联调');
  const ready = await contentAndImage(page, initial);
  const translated = await completeLiveTranslations(page, ready, path => readRespectingRateLimit(page, path));
  expect(translated.vehicle.draft.content.title.translations.ru).toMatchObject({ kind: 'human', reviewStatus: 'pending' });
  expect(translated.vehicle.draft.configuration).toEqual(liveConfiguration);
  await tab(page, '发布预览');
  await expect(page.getByTestId('vehicle-publish')).toHaveText('请完善信息');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  const currentBeforeRejection = AdminVehicleResponseSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/admin/vehicles/${initial.id}`)).json()).data;
  // Negative API contract check: no preview was confirmed, and inventory remains unknown.
  const rejected = await page.request.post(`/api/v1/admin/vehicles/${initial.id}/publish`, {
    data: { version: currentBeforeRejection.version }, headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': `isolated-unready-${initial.id}-${currentBeforeRejection.version}` },
  });
  expect(rejected.status()).toBe(422);
  const rejection = await rejected.json(); expect(rejection.error.code).toBe('PUBLISH_VALIDATION_FAILED');
  expect(rejection.error.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'availability' })]));
  const afterRejection = AdminVehicleResponseSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/admin/vehicles/${initial.id}`)).json()).data;
  expect(afterRejection.version).toBe(currentBeforeRejection.version); expect(afterRejection.publicationState).toBe('draft');
  await select(page, '核验后的库存状态', '可售');
  expect((await operation(page, initial.id, '核验并更新库存', 'availability')).status()).toBe(200);
  const publishedResponse = await operation(page, initial.id, '发布车辆', 'publish');
  expect(publishedResponse.status()).toBe(200);
  expect(AdminVehicleResponseSchema.parse(await publishedResponse.json()).data.hasUnpublishedChanges).toBe(false);
  await expect(page.getByTestId('vehicle-publish')).toHaveText('已发布，暂无待发布修改');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  await page.reload(); await tab(page, '发布预览');
  await expect(page.getByTestId('vehicle-publish')).toHaveText('已发布，暂无待发布修改');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  await (await notes(page)).fill('PRIVATE_INTERNAL_ONLY_AFTER_PUBLISH');
  const internalOnly = await save(page, initial.id);
  expect(internalOnly.hasUnpublishedChanges).toBe(false);
  await expect(page.locator('.ant-alert-success').filter({ hasText: '草稿已保存，对外内容已是最新，无需重复发布。' })).toBeVisible();
  await tab(page, '发布预览');
  await select(page, '核验后的库存状态', '已预订');
  const inventoryOnly = await operation(page, initial.id, '核验并更新库存', 'availability');
  expect(inventoryOnly.status()).toBe(200);
  expect(AdminVehicleResponseSchema.parse(await inventoryOnly.json()).data.hasUnpublishedChanges).toBe(false);
  await expect(page.getByTestId('vehicle-publish')).toHaveText('已发布，暂无待发布修改');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  for (const locale of ['zh', 'en', 'ru'] as const) {
    const response = await page.request.get(`/api/v1/vehicles/${initial.id}?locale=${locale}`);
    expect(response.status()).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain('PRIVATE_AD_UX_ONLY');
    expect(raw).not.toContain('purchaseCost');
    const data = PublicVehicleResponseSchema.parse(JSON.parse(raw)).data;
    assertLivePublicConfiguration(data.configuration, locale);
    expect(data.report).toEqual({ hasReport: false });
    expect(data.content.title.reviewed).toBe(false);
    expect(data.content.title.kind).toBe(locale === 'zh' ? 'original' : 'human');
    expect(data.images[0]).toMatchObject({ isCover: true, alt: '合成测试封面' });
    expect((await page.request.get(data.images[0]!.url)).status()).toBe(200);
  }
  const versionBeforeSourceEdit = AdminVehicleResponseSchema.parse(await inventoryOnly.json()).data.version;
  const vehiclePath = `/api/v1/admin/vehicles/${initial.id}`;
  const blockedTranslationWrites = { bundle: 0, plan: 0, generate: 0, legacySuggestions: 0 };
  const observeBlockedTranslationWrites = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT' && path === `${vehiclePath}/translation-bundle`) blockedTranslationWrites.bundle++;
    if (request.method() !== 'POST') return;
    if (path === `${vehiclePath}/translation-plans`) blockedTranslationWrites.plan++;
    if (path.startsWith(`${vehiclePath}/translation-plans/`) && path.endsWith('/generate')) blockedTranslationWrites.generate++;
    if (path.startsWith(`${vehiclePath}/`) && path.endsWith('/translation-suggestions')) blockedTranslationWrites.legacySuggestions++;
  };
  page.on('request', observeBlockedTranslationWrites);
  await tab(page, '基础资料');
  await page.getByLabel('标题原文', { exact: true }).fill('尚未发布的新原文');
  await tab(page, '公开字段多语');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('vehicle-translation-generate')).toHaveCount(0);
  await expect(page.getByText('请先保存车辆资料，再编辑或生成译文', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /重新读取多语资料$/ })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /已审核/ })).toHaveCount(0);
  expect(blockedTranslationWrites).toEqual({ bundle: 0, plan: 0, generate: 0, legacySuggestions: 0 });
  // The first workspace visit after reload has no bundle while core facts are dirty.
  // Save this tab's core action explicitly; its footer disappears once the new bundle can load.
  const sourceSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === vehiclePath);
  await page.getByRole('button', { name: /保存基础资料$/ }).click();
  const sourceResponse = await sourceSaved;
  expect(sourceResponse.status()).toBe(200);
  const { SaveVehicleRequestSchema } = await import('@hd/contracts/admin');
  const sourceInput = SaveVehicleRequestSchema.parse(sourceResponse.request().postDataJSON());
  expect(sourceInput.version).toBe(versionBeforeSourceEdit);
  const edited = AdminVehicleResponseSchema.parse(await sourceResponse.json()).data;
  expect(edited.id).toBe(initial.id);
  expect(edited.version).toBe(versionBeforeSourceEdit + 1);
  expect(edited.draft.content.title.sourceText).toBe('尚未发布的新原文');
  await expect(page.getByRole('button', { name: /保存基础资料$/ })).toHaveCount(0);
  await expect(page.getByText('请先保存车辆资料，再编辑或生成译文', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveValue('尚未发布的新原文');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('英文标题', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue(edited.draft.content.title.translations.en!.text);
  await expect(page.getByTestId('vehicle-translation-generate')).toBeEnabled();
  expect(blockedTranslationWrites).toEqual({ bundle: 0, plan: 0, generate: 0, legacySuggestions: 0 });
  page.off('request', observeBlockedTranslationWrites);
  expect(edited.hasUnpublishedChanges).toBe(true);
  expect(edited.draft.content.title.translations.en?.reviewStatus).toBe('stale');
  expect(PublicVehicleResponseSchema.parse(await (await page.request.get(`/api/v1/vehicles/${initial.id}?locale=zh`)).json()).data.content.title.text).toBe(initial.draft.content.title.sourceText);
  await tab(page, '发布预览');
  await select(page, '核验后的库存状态', '已售');
  expect((await operation(page, initial.id, '核验并更新库存', 'availability')).status()).toBe(200);
  expect(PublicVehicleResponseSchema.parse(await (await page.request.get(`/api/v1/vehicles/${initial.id}`)).json()).data.availability).toBe('sold');
  expect((await operation(page, initial.id, '下架车辆', 'archive')).status()).toBe(200);
  expect((await page.request.get(`/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/media/${ready.draft.media[0]!.id}`)).status()).toBe(404);
});

test('demo pending content publishes honestly; dictionary/search/home/bulk use real contracts', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const demo = await create(page, 'demo', '展示样例隔离联调');
  const draftOptions = AdminVehicleFiltersResponseSchema.parse(await (await page.request.get('/api/v1/admin/vehicle-filters')).json()).data;
  expect(draftOptions.makes.some(item => item.id === demo.draft.facts.make?.id)).toBe(true);
  const ready = await contentAndImage(page, demo);
  const translated = await completeLiveTranslations(page, ready, path => readRespectingRateLimit(page, path));
  expect(translated.vehicle.draft.content.title.translations.en?.reviewStatus).toBe('pending');
  expect(translated.vehicle.draft.configuration).toBeNull();
  expect((await operation(page, demo.id, '发布车辆', 'publish')).status()).toBe(200);
  const publicDemo = PublicVehicleResponseSchema.parse(await (await page.request.get(`/api/v1/vehicles/${demo.id}?locale=en`)).json()).data;
  expect(publicDemo.source.kind).toBe('demo'); expect(publicDemo.availability).toBe('unknown');
  expect(publicDemo.price.money).toBeNull(); expect(publicDemo.content.title.reviewed).toBe(false);
  await expect(page.getByRole('combobox', { name: '核验后的库存状态', exact: true })).toHaveCount(0);
  await screenshot(page, 'live-desktop-review');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const section of ['基础资料', '价格与内部信息', '车辆配置', '图片管理', '公开字段多语', '发布预览']) {
      await tab(page, section);
      await fitsViewport(page);
      await screenshot(page, `live-${width}-${section}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/vehicles');
  await page.getByRole('searchbox', { name: '关键词搜索' }).fill(demo.stockCode);
  await page.getByRole('button', { name: /搜\s*索$/ }).click();
  await select(page, '品牌筛选', demo.draft.facts.make!.name);
  await select(page, '车型筛选', demo.draft.facts.model!.name);
  await expect(page.getByText(demo.stockCode, { exact: true })).toBeVisible();
  await expect(page.getByText('共 1 辆', { exact: true })).toBeVisible();
  await expect(page.getByText('展示样例，非实际库存', { exact: true })).toBeVisible();
  await screenshot(page, 'live-desktop-list');
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await fitsViewport(page); await screenshot(page, `live-${width}-list`); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/home-sections');
  await page.getByLabel('区块 1中文标题').fill('隔离展示推荐');
  await page.getByRole('button', { name: /选择车辆$/ }).first().click();
  await page.getByRole('dialog').getByRole('row').filter({ hasText: demo.stockCode }).getByRole('button', { name: '加入此区块' }).click();
  await page.getByRole('button', { name: /完成选择$/ }).click();
  await page.getByLabel('区块 2中文标题').fill('隔离新车展示');
  await page.getByRole('button', { name: /选择车辆$/ }).nth(1).click();
  await page.getByRole('dialog').getByRole('row').filter({ hasText: demo.stockCode }).getByRole('button', { name: '加入此区块' }).click();
  await page.getByRole('button', { name: /完成选择$/ }).click();
  const savedHome = page.waitForResponse(r => r.url().endsWith('/api/v1/admin/home/vehicle-sections') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: /保存首页配置$/ }).click();
  const response = await savedHome; expect(response.status()).toBe(200);
  const home = AdminHomeSectionsResponseSchema.parse(await response.json()).data;
  expect(home.sections[0]!.vehicleIds).toContain(demo.id);
  expect(home.sections[1]).toMatchObject({ title: { zh: '隔离新车展示' }, vehicleIds: [demo.id] });
  await page.getByRole('button', { name: /读取公开首页$/ }).click();
  const publicHome = PublicHomeSectionsSchema.parse(await (await page.request.get('/api/v1/home/vehicles?locale=zh')).json()).data;
  expect(publicHome.sections[0]!.vehicles.map(v => v.id)).toContain(demo.id);
  await screenshot(page, 'live-desktop-home');
  const manual = await create(page, 'manual', '批量测试独立车辆');
  await page.goto('/admin/vehicles');
  await page.getByRole('checkbox', { name: `选择车辆 ${demo.stockCode}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `选择车辆 ${manual.stockCode}`, exact: true }).check();
  await page.getByRole('button', { name: /批量更新库存$/ }).click();
  await page.getByRole('checkbox', { name: '我已实际核验所选真实车辆的库存状态' }).check();
  const batch = page.waitForResponse(r => r.url().endsWith('/api/v1/admin/vehicles/bulk') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /确认批量操作$/ }).click();
  const batchResponse = await batch; expect(batchResponse.status()).toBe(200);
  const results = BulkVehicleMutationResponseSchema.parse(await batchResponse.json()).data;
  expect(results.summary).toMatchObject({ succeeded: 1, failed: 1 });
  expect(results.results.find(r => r.id === demo.id)).toMatchObject({ status: 'failed', error: { code: 'DEMO_RESTRICTION' } });
  await expect(page.getByRole('dialog', { name: '批量操作结果' })).toContainText('展示样例不能改为实际库存');
  await page.getByRole('button', { name: /完\s*成$/ }).click();
  await expect(page.getByText('已选择 1 辆', { exact: true })).toBeVisible();
  await page.goto('/admin/home-sections');
  await page.getByRole('button', { name: /读取公开首页$/ }).click();
  await expect(page.getByText('隔离展示推荐', { exact: true })).toBeVisible();
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await fitsViewport(page); await screenshot(page, `live-${width}-home`); }
});

test('external eight-image real API lifecycle preserves source honesty, removes public media and restores only a draft', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '外部挂牌资料' }).click();
  await newName(page, '品牌', `外部隔离品牌${Date.now()}`);
  await newName(page, '车型', '八图生命周期测试车型');
  const externalId = `synthetic-lifecycle-${Date.now()}`;
  const listingUrl = `https://example.invalid/listings/${externalId}`;
  const collectedAt = '2026-11-08T08:00:00.000Z';
  await page.getByLabel('来源平台标识', { exact: true }).fill('synthetic-lifecycle-market');
  await page.getByLabel('来源平台名称', { exact: true }).fill('合成挂牌平台（隔离测试）');
  await page.getByLabel('原始挂牌链接', { exact: true }).fill(listingUrl);
  await page.getByLabel('原始挂牌编号', { exact: true }).fill(externalId);
  await chooseUtcDateTime(page, '资料采集时间（UTC）', { date: '2026-11-08', hour: 8, minute: 0 });
  await page.getByLabel('标题原文', { exact: true }).fill('合成外部挂牌八图生命周期，不是真实库存');
  await page.getByLabel('里程（公里）', { exact: true }).fill('12345');
  await select(page, '所在地国家', '中国');
  await tab(page, '价格与内部信息');
  await select(page, '公开价格口径', '来源参考价格');
  await page.getByLabel('公开价格金额', { exact: true }).fill('123456.78');
  await selectCurrency(page, '公开价格币种', 'CNY');
  await (await notes(page)).fill('PRIVATE_EXTERNAL_LIFECYCLE_ONLY');
  const initial = await save(page);
  expect(initial.draft.source).toMatchObject({ kind: 'external', listingUrl, externalId, collectedAt });
  expect(initial.draft.price.money?.currency).toBe('CNY');
  expect(initial.draft.facts.mileageKm).toBe(12345);
  expect(initial.availability).toBe('unknown'); expect(initial.availabilityCheckedAt).toBeNull();
  await expect(page.getByLabel('来源平台标识', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('原始挂牌编号', { exact: true })).toBeDisabled();
  await tab(page, '发布预览');
  await expect(page.getByRole('combobox', { name: '核验后的库存状态', exact: true })).toHaveCount(0);
  await tab(page, '图片管理');
  await page.getByLabel('图片来源／授权说明', { exact: true }).fill('本测试生成的合成图片；出处仅为隔离元数据，不是实际挂牌或授权证明。');
  await expect(page.getByLabel('图片挂牌来源', { exact: true })).toHaveValue(listingUrl);
  await chooseUtcDateTime(page, '图片采集时间（UTC）', { date: '2026-11-08', hour: 8, minute: 0 });
  const imageUrls = Array.from({ length: 8 }, (_, i) => `https://example.invalid/images/${externalId}-${i + 1}.png`);
  await page.getByLabel('逐图原始地址', { exact: true }).fill(imageUrls.join('\n'));
  const uploads: ReturnType<typeof MediaUploadRequestSchema.parse>[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v1/admin/media/uploads' && request.method() === 'POST') uploads.push(MediaUploadRequestSchema.parse(request.postDataJSON()));
  });
  const pngs = await page.evaluate(() => Array.from({ length: 8 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d')!;
    context.fillStyle = `hsl(${index * 41}, 45%, 40%)`; context.fillRect(0, 0, 320, 240);
    context.fillStyle = '#fff'; context.font = '24px sans-serif'; context.fillText(`SYNTHETIC ${index + 1}`, 32, 125);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }));
  await page.locator('input[type=file]').setInputFiles(pngs.map((png, i) => ({ name: `synthetic-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(page.getByRole('textbox', { name: '图片 8 说明', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ant-message-success').filter({ hasText: '8张图片已上传，请保存草稿' })).toBeVisible();
  await expect(page.locator('.ant-alert').filter({ hasText: '8张图片已上传，请保存草稿' })).toBeVisible();
  expect(uploads).toHaveLength(8);
  expect(uploads.map(upload => upload.rights.source?.imageUrl)).toEqual(imageUrls);
  for (const upload of uploads) expect(upload.rights).toMatchObject({ basis: 'unverified', source: { listingUrl, collectedAt } });
  for (let i = 1; i <= 8; i++) await page.getByRole('textbox', { name: `图片 ${i} 说明`, exact: true }).fill(`合成图 ${i}`);
  await page.locator('ol > li').filter({ has: page.getByRole('textbox', { name: '图片 8 说明', exact: true }) }).getByRole('button', { name: /设为封面$/ }).click();
  await page.getByRole('button', { name: '上移图片 8', exact: true }).click();
  const ready = await save(page, initial.id);
  expect(ready.draft.media).toHaveLength(8);
  expect(ready.draft.media.map(image => image.alt)).toEqual(['合成图 1', '合成图 2', '合成图 3', '合成图 4', '合成图 5', '合成图 6', '合成图 8', '合成图 7']);
  expect(ready.draft.media.find(image => image.isCover)?.alt).toBe('合成图 8');
  expect(ready.draft.content.title.translations).toMatchObject({ zh: { kind: 'original', reviewStatus: 'pending' }, en: null, ru: null });
  expect(ready.draft.configuration).toBeNull();
  for (const media of ready.draft.media) {
    const asset = MediaAssetResponseSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/admin/media/${media.id}`)).json()).data;
    expect(asset.status).toBe('ready'); expect(asset.rights.source?.listingUrl).toBe(listingUrl);
  }
  // This record was created under /admin/vehicles, not the automatic external_listings catalog.
  await tab(page, '发布预览');
  await expect(page.getByTestId('vehicle-publish')).toHaveText('请完善信息');
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  const rejected = await page.request.post(`/api/v1/admin/vehicles/${initial.id}/publish`, {
    data: { version: ready.version }, headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': `isolated-external-unready-${initial.id}-${ready.version}` },
  });
  expect(rejected.status()).toBe(422);
  const rejection = await rejected.json(); expect(rejection.error.code).toBe('PUBLISH_VALIDATION_FAILED');
  expect(rejection.error.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'draft.facts.trim' }),
    expect.objectContaining({ path: 'draft.configuration' }),
    expect.objectContaining({ path: 'draft.content.title.translations.en' }),
  ]));
  const rejectedState = AdminVehicleResponseSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/admin/vehicles/${initial.id}`)).json()).data;
  expect(rejectedState.version).toBe(ready.version); expect(rejectedState.publicationState).toBe('draft');
  await tab(page, '基础资料');
  await page.getByLabel('配置名称', { exact: true }).fill('员工挂牌隔离合成配置');
  await chooseYear(page, '年款', 2024);
  await selectPetrolFromUnknown(page);
  await tab(page, '价格与内部信息');
  await page.getByLabel('内部采购成本', { exact: true }).fill('100000');
  await selectCurrency(page, '采购成本币种', 'CNY');
  const condition = '仅用于隔离测试的外部挂牌车况，不代表真实车辆或库存。';
  await page.getByLabel('车况描述', { exact: true }).fill(condition);
  await enterLiveConfiguration(page);
  const configured = await save(page, initial.id);
  expect(configured.draft.facts.powertrain).toBe('petrol');
  expect(configured.draft.internal.purchaseCost?.currency).toBe('CNY');
  expect(configured.draft.configuration).toEqual(liveConfiguration);
  const translated = await completeLiveTranslations(page, configured, path => readRespectingRateLimit(page, path), {
    title: { en: 'Synthetic external lifecycle vehicle', ru: 'Синтетический внешний автомобиль' },
    description: { en: 'Synthetic external vehicle condition for an isolated test only.', ru: 'Синтетическое состояние внешнего автомобиля только для изолированного теста.' },
  });
  for (const field of [translated.vehicle.draft.content.title, translated.vehicle.draft.content.description]) {
    for (const locale of ['zh', 'en', 'ru'] as const) expect(field.translations[locale]).toMatchObject({
      kind: locale === 'zh' ? 'original' : 'human', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
    });
  }
  const publishedResponse = await operation(page, initial.id, '发布车辆', 'publish');
  expect(publishedResponse.status()).toBe(200);
  const publishedBeforeDeletion = AdminVehicleResponseSchema.parse(await publishedResponse.json()).data;
  expect(publishedBeforeDeletion.id).toBe(initial.id);
  expect(publishedBeforeDeletion.publicationState).toBe('published');
  for (const locale of ['zh', 'en', 'ru'] as const) {
    const response = await readRespectingRateLimit(page, `/api/v1/vehicles/${initial.id}?locale=${locale}`);
    expect(response.status()).toBe(200);
    const raw = await response.text(); const current = PublicVehicleResponseSchema.parse(JSON.parse(raw)).data;
    expect(raw).not.toContain('PRIVATE_EXTERNAL_LIFECYCLE_ONLY'); expect(raw).not.toContain('externalId'); expect(raw).not.toContain('rights');
    expect(current).toMatchObject({ source: { kind: 'external', listingUrl }, availability: 'unknown', availabilityCheckedAt: null, price: { kind: 'reference', money: { amount: '123456.78', currency: 'CNY' } }, content: { title: { reviewed: false } } });
    assertLivePublicConfiguration(current.configuration, locale);
    expect(current.report).toEqual({ hasReport: false });
    expect(current.images).toHaveLength(8);
    for (const image of current.images) {
      expect((await readRespectingRateLimit(page, image.url)).status()).toBe(200);
      expect((await readRespectingRateLimit(page, `${image.url}?variant=thumb`)).status()).toBe(200);
    }
  }
  await mkdir('/private/tmp/hd-ad-del-evidence', { recursive: true });
  await page.screenshot({ path: '/private/tmp/hd-ad-del-evidence/external-published.png', fullPage: true, animations: 'disabled' });
  // R3 consumed 98/120 admin requests here. Stop background preview traffic before the deletion lifecycle.
  // Keep this page's context/session and the saved vehicle; no mutation is retried or test data replaced.
  await page.goto('about:blank');
  const publishedRateWindow = rateWindows.get(page);
  expect(publishedRateWindow?.observations, 'The phase boundary must use a real observed server window').toBeGreaterThan(0);
  await waitForServerWindow(rateCooldownMs(publishedRateWindow!.deadline, Date.now()), 'external-published-to-deletion');
  // Select through the real home editor so deletion must remove an actual persisted reference.
  await page.goto('/admin/home-sections');
  await page.getByRole('button', { name: /选择车辆$/ }).first().click();
  await page.getByRole('dialog').getByRole('row').filter({ hasText: initial.stockCode }).getByRole('button', { name: '加入此区块' }).click();
  await page.getByRole('button', { name: /完成选择$/ }).click();
  const saveHome = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/home/vehicle-sections') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: /保存首页配置$/ }).click(); expect((await saveHome).status()).toBe(200);
  const homeBefore = AdminHomeSectionsResponseSchema.parse(await (await readRespectingRateLimit(page, '/api/v1/admin/home/vehicle-sections')).json()).data;
  expect(homeBefore.sections.some(section => section.vehicleIds.includes(initial.id))).toBe(true);
  await page.goto(`/admin/vehicles/${initial.id}`);
  await tab(page, '发布预览');
  await page.getByRole('button', { name: /删除车辆$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /取\s*消$/ }).click();
  expect((await readRespectingRateLimit(page, `/api/v1/vehicles/${initial.id}`)).status()).toBe(200);
  await page.getByRole('button', { name: /删除车辆$/ }).click();
  const deletedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/admin/vehicles/${initial.id}` && response.request().method() === 'DELETE');
  await page.getByRole('dialog').getByRole('button', { name: /确认删除$/ }).click();
  const deletedResult = await deletedResponse; expect(deletedResult.status()).toBe(200);
  const deleted = AdminVehicleResponseSchema.parse(await deletedResult.json()).data;
  expect(deleted.deletedAt).not.toBeNull();
  expect(deleted.draft).toEqual(publishedBeforeDeletion.draft);
  const ordinary = AdminVehicleListSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/admin/vehicles?q=${initial.stockCode}`)).json()).data;
  expect(ordinary.items).toEqual([]);
  expect((await readRespectingRateLimit(page, `/api/v1/admin/vehicles/${initial.id}`)).status()).toBe(404);
  expect((await readRespectingRateLimit(page, `/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  expect(PublicVehicleListSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/vehicles?q=${initial.stockCode}`)).json()).data.items).toEqual([]);
  for (const media of ready.draft.media) for (const endpoint of [`/api/v1/admin/media/${media.id}`, `/api/v1/admin/media/${media.id}/preview`, `/api/v1/media/${media.id}`, `/api/v1/media/${media.id}?variant=thumb`]) expect((await readRespectingRateLimit(page, endpoint)).status(), endpoint).toBe(404);
  const homeDeleted = AdminHomeSectionsResponseSchema.parse(await (await readRespectingRateLimit(page, '/api/v1/admin/home/vehicle-sections')).json()).data;
  expect(homeDeleted.version).toBe(homeBefore.version + 1); expect(homeDeleted.sections.every(section => !section.vehicleIds.includes(initial.id))).toBe(true);
  await page.goto('/admin/recycle-bin');
  await expect(page.getByText(initial.stockCode, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: `${initial.draft.facts.make!.name} ${initial.draft.facts.model!.name}` }).click();
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toBeVisible();
  await expect(page.locator('input[type=file], main img')).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/hd-ad-del-evidence/deleted-readonly.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /恢复车辆$/ }).click();
  const restoreResponse = page.waitForResponse(response => response.url().endsWith(`/api/v1/admin/vehicles/${initial.id}/restore`) && response.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: /确认恢复$/ }).click();
  const restoredResult = await restoreResponse; expect(restoredResult.status()).toBe(200);
  const restored = AdminVehicleResponseSchema.parse(await restoredResult.json()).data;
  expect(restored).toMatchObject({ version: deleted.version + 1, deletedAt: null, publicationState: 'draft', availability: 'unknown', availabilityCheckedAt: null, publishedAt: null, publishedRevisionId: null });
  // The original `ready` predates required facts and language review; restore must preserve the draft actually deleted.
  expect(restored.draft).toEqual(publishedBeforeDeletion.draft);
  for (const media of restored.draft.media) {
    expect(MediaAssetResponseSchema.parse(await (await readRespectingRateLimit(page, `/api/v1/admin/media/${media.id}`)).json()).data.status).toBe('ready');
    expect((await readRespectingRateLimit(page, `/api/v1/admin/media/${media.id}/preview`)).status()).toBe(200);
    expect((await readRespectingRateLimit(page, `/api/v1/media/${media.id}`)).status()).toBe(404);
    expect((await readRespectingRateLimit(page, `/api/v1/media/${media.id}?variant=thumb`)).status()).toBe(404);
  }
  expect((await readRespectingRateLimit(page, `/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  const homeRestored = AdminHomeSectionsResponseSchema.parse(await (await readRespectingRateLimit(page, '/api/v1/admin/home/vehicle-sections')).json()).data;
  expect(homeRestored).toEqual(homeDeleted);
  expect(PublicHomeSectionsSchema.parse(await (await readRespectingRateLimit(page, '/api/v1/home/vehicles?locale=zh')).json()).data.sections.every(section => section.vehicles.every(item => item.id !== initial.id))).toBe(true);
  await expect(page.getByLabel('标题原文', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/hd-ad-del-evidence/restored-draft.png', fullPage: true, animations: 'disabled' });
});

test('translation disabled real API keeps Chinese source intact and never pretends machine suggestions were saved', async ({ page }) => {
  test.skip(process.env.ADMIN_LIVE_TRANSLATION_PROVIDER !== 'disabled', 'This case verifies the explicitly disabled provider.');
  await login(page);
  const initial = await create(page, 'manual', '中文首存与未配置机器翻译隔离测试');
  expect(initial.draft.content.title).toMatchObject({ sourceLanguage: 'zh', sourceText: '中文首存与未配置机器翻译隔离测试' });
  expect(initial.draft.content.title.translations.en).toBeNull();
  await tab(page, '公开字段多语');
  const read = (path: string) => readRespectingRateLimit(page, path);
  const bundle = await readLiveBundle(initial.id, read);
  expect(bundle.sourceLanguageConfirmationRequired).toEqual([]);
  await assertDisabledLivePlan(page, bundle, read);
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue('');
  const unchanged = AdminVehicleResponseSchema.parse(await (await page.request.get(`/api/v1/admin/vehicles/${initial.id}`)).json()).data;
  expect(unchanged.version).toBe(initial.version); expect(unchanged.draft).toEqual(initial.draft);
});

// Historical suggestions-API provider cases below retain their explicit mode/paid guards.
// They are not part of the UX11 disabled-provider run and require a separate plan-workflow migration
// before any newly authorized real provider execution; this task does not execute either case.
test('actual local machine translation produces English/Russian suggestions and persists only after an explicit save', async ({ page }) => {
  test.skip(process.env.ADMIN_LIVE_TRANSLATION_PROVIDER !== 'libretranslate', 'Requires the explicitly selected loopback-only LibreTranslate service.');
  test.setTimeout(90_000);
  await login(page);
  const sourceTitle = '2024款二手汽车';
  const sourceDescription = '车辆行驶12000公里，售价50000元，仅用于本地翻译测试。';
  const initial = await create(page, 'manual', sourceTitle);
  await tab(page, '价格与内部信息');
  await page.getByLabel('车况描述', { exact: true }).fill(sourceDescription);
  const withDescription = await save(page, initial.id);
  await tab(page, '公开字段多语');
  const generating = page.waitForResponse(response => response.url().endsWith(`/api/v1/admin/vehicles/${initial.id}/translation-suggestions`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: /生成英俄译文$/ }).click();
  const response = await generating;
  expect(response.status()).toBe(200);
  const generated = VehicleTranslationSuggestionsResponseSchema.parse(await response.json()).data;
  expect(generated.engineVersion).toBe(`libretranslate:${process.env.LIBRETRANSLATE_ENGINE_VERSION}`);
  expect(generated.content.title.translations.zh).toMatchObject({ text: sourceTitle, kind: 'original', reviewStatus: 'pending' });
  expect(generated.content.description!.translations.zh).toMatchObject({ text: sourceDescription, kind: 'original', reviewStatus: 'pending' });
  for (const field of ['title', 'description'] as const) {
    const suggestion = generated.content[field]!;
    for (const locale of ['en', 'ru'] as const) {
      const translation = suggestion.translations[locale];
      expect(translation).toMatchObject({ kind: 'machine', reviewStatus: 'pending', engineVersion: generated.engineVersion });
      expect(translation.text.trim()).not.toBe(suggestion.sourceText.trim());
      expect(translation.text).toMatch(locale === 'en' ? /[A-Za-z]/ : /[А-Яа-яЁё]/);
      const normalized = translation.text.replace(/[,\s\u00a0\u202f]/g, '');
      for (const number of field === 'title' ? ['2024'] : ['12000', '50000']) expect(normalized).toContain(number);
    }
  }
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue(generated.content.title.translations.en.text);
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue(generated.content.description!.translations.ru.text);
  await expect(page.getByRole('checkbox', { name: '英文标题已审核', exact: true })).not.toBeChecked();
  const beforeSave = AdminVehicleResponseSchema.parse(await (await page.request.get(`/api/v1/admin/vehicles/${initial.id}`)).json()).data;
  expect(beforeSave.version).toBe(withDescription.version); expect(beforeSave.draft).toEqual(withDescription.draft);
  expect((await page.request.get(`/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  await mkdir('/private/tmp/hd-ad-i18n-evidence', { recursive: true });
  await writeFile('/private/tmp/hd-ad-i18n-evidence/actual-local-machine-output.json', JSON.stringify(generated, null, 2));
  await page.screenshot({ path: '/private/tmp/hd-ad-i18n-evidence/actual-local-machine-suggestions.png', fullPage: true, animations: 'disabled' });
  const saved = await save(page, initial.id);
  expect(saved.publicationState).toBe('draft'); expect(saved.hasUnpublishedChanges).toBe(true);
  for (const field of ['title', 'description'] as const) for (const locale of ['zh', 'en', 'ru'] as const) {
    expect(saved.draft.content[field].translations[locale]).toMatchObject({ text: generated.content[field]!.translations[locale].text, reviewStatus: 'pending', kind: locale === 'zh' ? 'original' : 'machine' });
  }
  expect((await page.request.get(`/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  await page.reload(); await tab(page, '公开字段多语');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue(generated.content.title.translations.en.text);
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue(generated.content.description!.translations.ru.text);
});

test('real Aliyun international Chinese suggestion persistence', async ({ page }) => {
  test.skip(process.env.ADMIN_LIVE_TRANSLATION_PROVIDER !== 'aliyun', 'Requires the separately approved real Aliyun synthetic-only mode.');
  test.setTimeout(90_000);
  expect(process.env.ADMIN_LIVE_ALIYUN_CONFIRM).toBe('synthetic-only');
  expect(process.env.ALI_MT_REGION).toBe('ap-southeast-1');
  expect(process.env.TRANSLATION_MAX_CHARACTERS_PER_HOUR).toBe('500');
  const sourceTitle = '2024款丰田卡罗拉';
  const sourceDescription = '合成测试：里程12000km，参考价格50000CNY，库存和出口资格待核验。';
  const sourceCharacters = sourceTitle.length + sourceDescription.length;
  expect(sourceCharacters).toBeLessThanOrEqual(200);
  expect(sourceCharacters * 2).toBeLessThan(400);
  await login(page);
  const initial = await create(page, 'manual', sourceTitle);
  await tab(page, '价格与内部信息');
  await page.getByLabel('车况描述', { exact: true }).fill(sourceDescription);
  const source = await save(page, initial.id);
  await tab(page, '公开字段多语');
  const responseReady = page.waitForResponse(response => response.url().endsWith(`/api/v1/admin/vehicles/${initial.id}/translation-suggestions`) && response.request().method() === 'POST');
  const startedAt = Date.now();
  // Exactly one generation click: an unknown result fails this case instead of making more paid calls.
  await page.getByRole('button', { name: /生成英俄译文$/ }).click();
  const response = await responseReady;
  const elapsedMs = Date.now() - startedAt;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ version: source.version });
  const generated = VehicleTranslationSuggestionsResponseSchema.parse(await response.json()).data;
  expect(generated.engineVersion).toBe(`aliyun-general:2018-10-12:general:ap-southeast-1:${process.env.ALI_MT_CONFIG_VERSION ?? '1'}`);
  expect(JSON.stringify(generated)).not.toContain('PRIVATE_AD_UX_ONLY');
  const output = {
    sampleKind: 'real Aliyun international synthetic sample; not operational inventory or professional translation certification',
    engineVersion: generated.engineVersion, elapsedMs, sourceCharacters, maximumPlannedTranslatedSourceCharacters: sourceCharacters * 2,
    zh: { title: sourceTitle, description: sourceDescription },
    en: { title: generated.content.title.translations.en.text, description: generated.content.description!.translations.en.text },
    ru: { title: generated.content.title.translations.ru.text, description: generated.content.description!.translations.ru.text },
  };
  await mkdir('/private/tmp/hd-ad-i18n-evidence', { recursive: true });
  // Only the deliberately synthetic source/output and timing are written; no environment, signatures, or upstream messages.
  await writeFile('/private/tmp/hd-ad-i18n-evidence/real-aliyun-international-synthetic-output.json', JSON.stringify(output, null, 2));
  for (const field of ['title', 'description'] as const) {
    const suggestion = generated.content[field]!;
    expect(suggestion.translations.zh).toMatchObject({ text: field === 'title' ? sourceTitle : sourceDescription, kind: 'original', reviewStatus: 'pending' });
    for (const locale of ['en', 'ru'] as const) {
      const translation = suggestion.translations[locale];
      expect(translation).toMatchObject({ kind: 'machine', reviewStatus: 'pending', engineVersion: generated.engineVersion });
      expect(translation.text.trim()).not.toBe(suggestion.sourceText.trim());
      const normalized = translation.text.replace(/[,\s\u00a0\u202f]/g, '');
      for (const number of field === 'title' ? ['2024'] : ['12000', '50000']) expect(normalized).toContain(number);
    }
  }
  expect(output.en.title).toMatch(/[A-Za-z]/); expect(output.en.description).toMatch(/[A-Za-z]/);
  // A proper model name may remain Latin in Russian; the sentence must contain actual Cyrillic text.
  expect(output.ru.description).toMatch(/[А-Яа-яЁё]/);
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue(output.en.title);
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue(output.ru.description);
  const beforeSave = AdminVehicleResponseSchema.parse(await (await page.request.get(`/api/v1/admin/vehicles/${initial.id}`)).json()).data;
  expect(beforeSave.version).toBe(source.version); expect(beforeSave.draft).toEqual(source.draft);
  expect((await page.request.get(`/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  for (const locale of ['中文', '英文', '俄文']) await expect(page.getByRole('checkbox', { name: `${locale}标题已审核`, exact: true })).not.toBeChecked();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '/private/tmp/hd-ad-i18n-evidence/real-aliyun-international-synthetic-unsaved.png', fullPage: true, animations: 'disabled' });
  const saved = await save(page, initial.id);
  expect(saved.publicationState).toBe('draft'); expect(saved.publishedAt).toBeNull(); expect(saved.publishedRevisionId).toBeNull();
  for (const field of ['title', 'description'] as const) for (const locale of ['zh', 'en', 'ru'] as const) {
    expect(saved.draft.content[field].translations[locale]).toMatchObject({ text: generated.content[field]!.translations[locale].text, reviewStatus: 'pending', kind: locale === 'zh' ? 'original' : 'machine' });
  }
  expect(saved.draft.internal.notes).toBe('PRIVATE_AD_UX_ONLY');
  expect((await page.request.get(`/api/v1/vehicles/${initial.id}`)).status()).toBe(404);
  await page.reload(); await tab(page, '公开字段多语');
  await expect(page.getByLabel('英文标题', { exact: true })).toHaveValue(output.en.title);
  await expect(page.getByLabel('俄文描述', { exact: true })).toHaveValue(output.ru.description);
  await expect(page.locator('.ant-alert').filter({ hasText: /已填入\d+项语言内容，请核对并保存草稿|译文已填入当前草稿，请核对并保存/ })).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '/private/tmp/hd-ad-i18n-evidence/real-aliyun-international-synthetic-saved.png', fullPage: true, animations: 'disabled' });
});

test('real publication preview rejects private image failures until a new load succeeds', async ({ page }, testInfo) => {
  // Requires the reviewed FE image-decode fix; the older FE build must fail this regression.
  test.setTimeout(240_000);
  expect(process.env.ADMIN_LIVE_TRANSLATION_PROVIDER).toBe('disabled');
  expect(process.env.TRANSLATION_PROVIDER).toBe('disabled');
  const { PublishReadinessResponseSchema, ConfirmPublicationPreviewRequestSchema } = await import('@hd/contracts/admin');
  await login(page);
  const initial = await create(page, 'manual', '私图失败发布预览隔离样例');
  const firstImage = await contentAndImage(page, initial);
  await tab(page, '图片管理');
  await page.getByLabel('图片来源／授权说明', { exact: true }).fill('第二张本地生成合成图片，仅供隔离预览故障验收。');
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#4a376d'; context.fillRect(0, 0, 96, 64);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }), 'base64');
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-second.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('textbox', { name: '图片 2 说明', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '图片 2 说明', exact: true }).fill('合成测试第二张图片');
  const withImages = await save(page, initial.id);
  expect(withImages.draft.media).toHaveLength(2);
  expect(withImages.draft.media[0]!.id).toBe(firstImage.draft.media[0]!.id);
  await completeLiveTranslations(page, withImages, path => readRespectingRateLimit(page, path));
  await tab(page, '发布预览');
  await select(page, '核验后的库存状态', '可售');
  const availability = await operation(page, initial.id, '核验并更新库存', 'availability');
  expect(availability.status()).toBe(200);
  expect(AdminVehicleResponseSchema.parse(await availability.json()).data.availability).toBe('available');

  const vehiclePath = `/api/v1/admin/vehicles/${initial.id}`;
  const readinessResponse = await readRespectingRateLimit(page, `${vehiclePath}/publish-readiness?locale=zh`);
  expect(readinessResponse.status()).toBe(200);
  const readiness = PublishReadinessResponseSchema.parse(await readinessResponse.json()).data;
  expect(readiness).toMatchObject({ requiredFieldsReady: true, localizationReady: true, previewConfirmed: false, canPublish: false, confirmation: null });
  expect(readiness.issues.every(issue => issue.stage === 'preview')).toBe(true);
  const cover = withImages.draft.media.find(image => image.isCover)!;
  const second = withImages.draft.media.find(image => !image.isCover)!;
  expect(cover).toBeTruthy(); expect(second).toBeTruthy();
  const paths = new Map([cover, second].map(image => [`/api/v1/admin/media/${image.id}/preview`, image.id]));
  const origin = new URL(page.url()).origin;
  const matchesImage = (url: URL) => url.origin === origin && paths.has(url.pathname);
  let stage = 'initial';
  let fault: { mediaId: string; result: 401 | 403 | 500 | 'abort' } | null = null;
  const writes = { confirm: 0, publish: 0, translation: 0 };
  const confirmationBodies: ReturnType<typeof ConfirmPublicationPreviewRequestSchema.parse>[] = [];
  const imageOutcomes: Array<{ stage: string; loadId: string | null; mediaId: string; result: number | 'failed' }> = [];
  const loads: Array<{ stage: string; previousLoadId: string; loadId: string }> = [];
  function recordImageOutcome(request: import('@playwright/test').Request, result: number | 'failed') {
    const mediaId = paths.get(new URL(request.url()).pathname);
    if (!mediaId) return;
    let loadId: string | null = null;
    try { loadId = new URL(request.frame().url()).searchParams.get('loadId'); } catch { /* Detached frame; no private request details are recorded. */ }
    imageOutcomes.push({ stage, loadId, mediaId, result });
  }
  page.on('response', response => recordImageOutcome(response.request(), response.status()));
  page.on('requestfailed', request => recordImageOutcome(request, 'failed'));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === `${vehiclePath}/publication-preview/confirm`) {
      writes.confirm++;
      confirmationBodies.push(ConfirmPublicationPreviewRequestSchema.parse(request.postDataJSON()));
    }
    if (path === `${vehiclePath}/publish`) writes.publish++;
    if (path.endsWith('/translation-suggestions') || /^\/api\/v1\/admin\/vehicles\/[^/]+\/translation-plans\/[^/]+\/generate$/.test(path)) writes.translation++;
  });
  const intercept = async (route: import('@playwright/test').Route) => {
    const mediaId = paths.get(new URL(route.request().url()).pathname);
    if (!fault || fault.mediaId !== mediaId) { await route.continue(); return; }
    if (fault.result === 'abort') { await route.abort('failed'); return; }
    await route.fulfill({ status: fault.result, contentType: 'text/plain', headers: { 'Cache-Control': 'no-store' }, body: 'Isolated private image failure' });
  };
  // Only this synthetic vehicle's image bytes are intercepted. FE, preview DTOs, proof and mutations remain real.
  await page.route(matchesImage, intercept);
  const iframe = page.locator('iframe[title="中文车辆发布预览"]');
  const frame = page.frameLocator('iframe[title="中文车辆发布预览"]');
  const checkbox = page.getByRole('checkbox', { name: '我已检查当前预览，确认图片、价格和文字正确', exact: true });
  const confirm = page.getByRole('button', { name: /确认当前预览$/ });
  async function loadId() {
    const src = await iframe.getAttribute('src');
    expect(src).toBeTruthy();
    const id = new URL(src!, origin).searchParams.get('loadId');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    return id!;
  }
  async function reloadPreview(nextStage: string) {
    stage = nextStage;
    const previousLoadId = await loadId();
    await page.getByRole('button', { name: /重新载入预览$/ }).click();
    await expect.poll(loadId).not.toBe(previousLoadId);
    const nextLoadId = await loadId();
    loads.push({ stage, previousLoadId, loadId: nextLoadId });
    return nextLoadId;
  }
  async function expectNoWrites() {
    expect(writes).toEqual({ confirm: 0, publish: 0, translation: 0 });
    await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  }
  async function expectFailed() {
    await expect(frame.getByTestId('publication-preview-media-error')).toBeVisible();
    await expect(checkbox).toBeDisabled();
    await expect(confirm).toBeDisabled();
    await expectNoWrites();
  }
  async function expectDecoded(mediaId: string) {
    const body = frame.getByTestId('publication-preview-body');
    await expect(body).toHaveAttribute('data-vehicle-version', String(readiness.vehicleVersion));
    await expect(body).toHaveAttribute('data-public-content-revision', String(readiness.publicContentRevision));
    await expect(body).toHaveAttribute('data-fingerprint', readiness.fingerprint);
    const image = frame.locator(`img[data-gallery-active-image="${mediaId}"]`);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => {
      const current = node as HTMLImageElement;
      return current.complete && current.naturalWidth > 0;
    })).toBe(true);
    await expect(frame.getByTestId('publication-preview-media-error')).toHaveCount(0);
    await expect(checkbox).toBeEnabled();
    await expectNoWrites();
  }
  async function removeFaultWithoutReload(failedLoadId: string) {
    fault = null;
    // Drain render callbacks without changing src, dispatching image events or manufacturing a frame proof.
    await frame.getByTestId('publication-preview-body').evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    expect(await loadId()).toBe(failedLoadId);
    await expectFailed();
  }
  try {
    for (const result of [401, 403, 500, 'abort'] as const) {
      fault = { mediaId: cover.id, result };
      const failedLoadId = await reloadPreview(`cover-${result}`);
      await expect.poll(() => imageOutcomes.some(outcome => outcome.loadId === failedLoadId && outcome.mediaId === cover.id
        && outcome.result === (result === 'abort' ? 'failed' : result))).toBe(true);
      await expectFailed();
      await removeFaultWithoutReload(failedLoadId);
      await reloadPreview(`cover-${result}-recovered`);
      await expectDecoded(cover.id);
    }

    // Fault the second URL before a new cover load, so a previously decoded thumbnail cannot mask the failure.
    fault = { mediaId: second.id, result: 500 };
    const selectionLoadId = await reloadPreview('second-image-ready-cover');
    await expectDecoded(cover.id);
    stage = 'second-image-failed';
    await frame.getByRole('link', { name: /查看第 2 张照片$/ }).click();
    await expect.poll(() => imageOutcomes.some(outcome => outcome.loadId === selectionLoadId && outcome.mediaId === second.id && outcome.result === 500)).toBe(true);
    await expect(frame.locator(`[data-selected-image="${second.id}"]`)).toBeVisible();
    await expectFailed();
    await removeFaultWithoutReload(selectionLoadId);
    await reloadPreview('second-image-recovered');
    await expectDecoded(cover.id);
    await frame.getByRole('link', { name: /查看第 2 张照片$/ }).click();
    await expectDecoded(second.id);

    const beforeConfirmation = await readRespectingRateLimit(page, `${vehiclePath}/publish-readiness?locale=zh`);
    expect(beforeConfirmation.status()).toBe(200);
    expect(PublishReadinessResponseSchema.parse(await beforeConfirmation.json()).data).toMatchObject({
      requiredFieldsReady: true, localizationReady: true, previewConfirmed: false, canPublish: false, confirmation: null,
    });
    stage = 'explicit-confirm-and-publish';
    const publishedResponse = await operation(page, initial.id, '发布车辆', 'publish');
    expect(publishedResponse.status()).toBe(200);
    expect(AdminVehicleResponseSchema.parse(await publishedResponse.json()).data).toMatchObject({ publicationState: 'published', hasUnpublishedChanges: false });
    expect(writes).toEqual({ confirm: 1, publish: 1, translation: 0 });
    expect(confirmationBodies).toEqual([{ version: readiness.vehicleVersion, publicContentRevision: readiness.publicContentRevision, fingerprint: readiness.fingerprint, locale: 'zh' }]);
  } finally {
    await page.unroute(matchesImage, intercept);
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(testInfo.outputPath('private-image-preview-summary.json'), JSON.stringify({
      sampleKind: 'Real isolated API and FE; only this synthetic vehicle image responses faulted; no provider calls',
      vehicleId: initial.id, coverId: cover.id, secondImageId: second.id, loads, imageOutcomes, writes,
    }, null, 2));
  }
});
