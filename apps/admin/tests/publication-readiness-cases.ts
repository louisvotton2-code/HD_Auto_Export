import { expect, test, type Page } from '@playwright/test';
import { makePublishReadinessFixture } from '@hd/contracts/fixtures';
import { PublicationPreviewResponseSchema, PublishReadinessSchema, vehicleConfigurationItemId, type AdminVehicle, type DisplayField, type PublishReadiness } from '@hd/contracts/admin';
import { envelope, error, installApi, localization, publicationKey, reply, vehicle } from './api-fixture';
import { saveBundle } from './translation-test-helpers';
import { notes, tab } from './ui-helpers';

const publish = (page: Page) => page.getByTestId('vehicle-publish');
const fixtureId = '10000000-0000-4000-8000-000000000111';
function record(): AdminVehicle { return { ...vehicle(), id: fixtureId }; }
function gate(item: AdminVehicle, confirmed = false, overrides: Partial<PublishReadiness> = {}) {
  const now = Date.now();
  return PublishReadinessSchema.parse({ ...makePublishReadinessFixture(confirmed), vehicleId: item.id,
    vehicleVersion: item.version,
    confirmation: confirmed ? { locale: 'zh', confirmedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() } : null,
    ...overrides });
}

async function setup(page: Page, ready: PublishReadiness, item = record()) {
  const api = await installApi(page, { items: [item], publicationReadiness: [ready], publicationDefaultConfirmed: false });
  // This is a contract simulation of FE's authenticated iframe, not proof of the real FE renderer.
  // No ready receipt is sent automatically: each case must explicitly simulate a completed render.
  await page.route(/\/staff\/vehicles\/[^/]+\/publication-preview\/\?/, route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html lang="zh"><head><meta charset="utf-8"></head><body><main>合成草稿预览，仅供浏览器契约验证</main></body></html>',
  }));
  await page.goto(`/admin/vehicles/${item.id}`);
  await expect.poll(() => api.readinessReads.length).toBeGreaterThan(0);
  await tab(page, '发布预览');
  return api;
}

async function frameMessage(page: Page, ready: PublishReadiness, event: 'loading' | 'ready' | 'error' | 'disposed' | 'resize', overrides: Record<string, unknown> = {}) {
  const frameElement = page.locator('iframe[title="中文车辆发布预览"]');
  const source = await frameElement.getAttribute('src');
  expect(source).toBeTruthy();
  const loadId = new URL(source!, page.url()).searchParams.get('loadId');
  const frame = await (await frameElement.elementHandle())!.contentFrame();
  expect(frame).toBeTruthy();
  await frame!.waitForLoadState('domcontentloaded');
  const projection = event === 'ready' ? PublicationPreviewResponseSchema.parse(await frame!.evaluate(async path => {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Synthetic preview read failed');
    return response.json();
  }, `/api/v1/admin/vehicles/${encodeURIComponent(ready.vehicleId)}/publication-preview?locale=${ready.locale}`)).data : null;
  const message = {
    schemaVersion: 1, type: 'hd:auto:publication-preview', event, loadId, vehicleId: ready.vehicleId, locale: ready.locale,
    ...(projection ? { preview: { vehicleId: projection.vehicle.id, vehicleVersion: projection.vehicleVersion,
      publicContentRevision: projection.publicContentRevision, fingerprint: projection.fingerprint, locale: projection.locale } } : {}),
    ...(event === 'resize' ? { height: 640 } : {}),
    ...(event === 'error' ? { error: { code: 'render_error' } } : {}),
    ...overrides,
  };
  // Posting from the actual child window is essential: the parent checks event.source and origin.
  await frame!.evaluate(value => window.parent.postMessage(value, window.location.origin), message);
  return loadId!;
}

for (const scenario of [
  { stage: 'required_fields' as const, path: 'draft.price.money.amount', message: '公开价格：请检查价格口径、金额和币种', target: '价格与内部信息' },
  { stage: 'localization' as const, path: 'draft.content.title.translations.en', message: '车辆标题 · 英文', target: '公开字段多语' },
]) {
  test(`publication readiness reports and navigates server ${scenario.stage} issues`, async ({ page }) => {
    const item = record();
    const ready = gate(item, false, {
      requiredFieldsReady: scenario.stage !== 'required_fields', localizationReady: scenario.stage !== 'localization',
      issues: [{ stage: scenario.stage, path: scenario.path, code: 'REQUIRED', message: scenario.message }],
    });
    const api = await setup(page, ready, item);
    await expect(publish(page)).toBeDisabled();
    await page.getByRole('button', { name: scenario.message, exact: true }).click();
    await expect(page.getByRole('tab', { name: new RegExp(scenario.target) })).toHaveAttribute('aria-selected', 'true');
    if (scenario.stage === 'localization') await expect(page.getByLabel('英文标题', { exact: true })).toBeFocused();
    await tab(page, '发布预览');
    await frameMessage(page, ready, 'ready');
    await expect(publish(page)).toBeDisabled();
    expect(api.previewConfirmations).toEqual([]);
  });
}

test('publication readiness preserves separate Russian issues, focuses exact fields and refreshes after each save', async ({ page }) => {
  const item = record();
  const first = '测试充电电量范围', second = '测试座椅调节方式';
  item.draft.configuration = { version: 1, items: [{ name: first, value: '已配置' }, { name: second, value: '4向电动调节' }] };
  const firstRef = `configuration.${vehicleConfigurationItemId(first)}.name`;
  const secondRef = `configuration.${vehicleConfigurationItemId(second)}.value`;
  const issues = [{
    stage: 'localization' as const, path: `localization.${firstRef}.ru`, code: 'REQUIRED_FOR_PUBLICATION',
    message: 'A display translation is required.',
  }, {
    stage: 'localization' as const, path: `localization.${secondRef}.ru`, code: 'REQUIRED_FOR_PUBLICATION',
    message: 'A display translation is required.',
  }, {
    stage: 'preview' as const, path: 'publicationPreview', code: 'PREVIEW_CONFIRMATION_REQUIRED',
    message: 'Confirm the current publication preview before publishing.',
  }];
  const fields: DisplayField[] = [
    { ref: firstRef, sourceLanguage: 'zh', sourceText: first, sourceVersion: 1, sourceHash: '1'.repeat(64),
      translations: { zh: null, en: null, ru: null } },
    { ref: secondRef, sourceLanguage: 'zh', sourceText: '4向电动调节', sourceVersion: 2, sourceHash: '2'.repeat(64),
      translations: { zh: null, en: null, ru: null } },
  ];
  const ready = gate(item, false, { localizationReady: false, issues });
  const api = await setup(page, ready, item);
  const saved = localization(item, fields);
  api.localizations.set(item.id, saved);
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish-readiness?*`, route => {
    const current = api.publishReadiness.get(publicationKey(item.id))!;
    const remaining = issues.filter((issue, index) => issue.stage === 'preview' || !api.localizations.get(item.id)?.data.fields[index]?.translations.ru?.text.trim());
    api.publishReadiness.set(publicationKey(item.id), PublishReadinessSchema.parse({ ...current,
      localizationReady: !remaining.some(issue => issue.stage === 'localization'), issues: remaining }));
    return route.fallback();
  });
  await expect(page.getByTestId('vehicle-publish')).toBeDisabled();
  const firstLabel = `${first} · 配置名称 · 俄文`, secondLabel = `${second} · 配置内容 · 俄文`;
  await expect(page.getByRole('button', { name: secondLabel, exact: true })).toBeVisible();
  await page.getByRole('button', { name: firstLabel, exact: true }).click();
  await expect(page.getByRole('tab', { name: /公开字段多语/ })).toHaveAttribute('aria-selected', 'true');
  const firstInput = page.getByLabel(`俄文${first} · 配置名称`, { exact: true });
  const secondInput = page.getByLabel(`俄文${second} · 配置内容`, { exact: true });
  await expect(firstInput).toBeFocused();
  const pending = page.getByRole('region', { name: '发布检查待处理' });
  await firstInput.fill('Исправленный перевод');
  await saveBundle(page);
  await expect(pending.getByRole('button', { name: firstLabel, exact: true })).toHaveCount(0);
  await pending.getByRole('button', { name: secondLabel, exact: true }).click();
  await expect(secondInput).toBeFocused();
  await secondInput.fill('Электрорегулировка в 4 направлениях');
  await saveBundle(page);
  await expect(pending).toHaveCount(0);
  await tab(page, '发布预览');
  await expect(publish(page)).toBeDisabled();
  await frameMessage(page, api.publishReadiness.get(publicationKey(item.id))!, 'ready');
  await expect(publish(page)).toBeEnabled();
  expect(api.previewConfirmations).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});

test('publication readiness retries after a failed preview confirmation without publishing early', async ({ page }) => {
  const item = record(); const ready = gate(item);
  const api = await setup(page, ready, item);
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish`, route => {
    publishes++;
    return reply(route, error('PUBLISH_VALIDATION_FAILED'), 422);
  });
  const confirmPath = `**/api/v1/admin/vehicles/${item.id}/publication-preview/confirm`;
  await page.route(confirmPath, route => reply(route, error('PUBLISH_VALIDATION_FAILED'), 422));
  await frameMessage(page, ready, 'ready');
  await publish(page).click();
  await expect(page.getByText('发布检查未完成', { exact: true })).toBeVisible();
  expect(publishes).toBe(0);
  await page.unroute(confirmPath);
  await page.getByRole('button', { name: /重新检查发布条件$/ }).click();
  await publish(page).click();
  await expect.poll(() => publishes).toBe(1);
  expect(api.previewConfirmations).toHaveLength(1);
});

test('publication readiness opens missing legacy Chinese content for entry without relabeling its source', async ({ page }) => {
  const item = record();
  item.draft.content.title = { sourceLanguage: 'en', sourceText: 'Legacy title', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  item.draft.content.description = { sourceLanguage: 'und', sourceText: 'Legacy description', sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
  const issues = ['draft.content.title.translations.zh', 'draft.content.description.translations.zh', 'localization.model.zh']
    .map(path => ({ stage: 'localization' as const, path, code: 'REQUIRED_FOR_PUBLICATION', message: 'A nonempty translation is required.' }));
  const ready = gate(item, false, { localizationReady: false, issues });
  const api = await setup(page, ready, item);
  api.localizations.set(item.id, localization(item, [{
    ref: 'model', sourceLanguage: 'und', sourceText: 'Legacy model', sourceVersion: 1, sourceHash: '3'.repeat(64),
    translations: { zh: null, en: null, ru: null },
  }]));
  await page.getByRole('button', { name: '车辆标题 · 中文', exact: true }).click();
  const title = page.getByLabel('中文标题', { exact: true });
  await expect(title).toBeFocused();
  await title.fill('补充的中文标题');
  const pending = page.getByRole('region', { name: '发布检查待处理' });
  await pending.getByRole('button', { name: '车况描述 · 中文', exact: true }).click();
  const description = page.getByLabel('中文描述', { exact: true });
  await expect(description).toBeFocused();
  await description.fill('补充的中文车况');
  await pending.getByRole('button', { name: '车型名称 · 中文', exact: true }).click();
  const model = page.getByLabel('中文车型名称', { exact: true });
  await expect(model).toBeFocused();
  await model.fill('补充的中文车型');
  await saveBundle(page);
  const input = api.bundleSaves[0]!.input;
  expect(input.sourceLanguageConfirmations).toEqual([]);
  for (const [field, sourceLanguage, text] of [
    [input.content.title, 'en', '补充的中文标题'],
    [input.content.description, 'und', '补充的中文车况'],
    [input.localization.fields[0]!, 'und', '补充的中文车型'],
  ] as const) {
    expect(field).toMatchObject({ sourceLanguage, translations: { zh: { text, kind: 'human', engineVersion: null } } });
  }
  await expect(title).toHaveCount(0);
  await expect(description).toHaveCount(0);
  await expect(model).toHaveCount(0);
});

test('publication readiness requires a matching rendered receipt and confirms it before the publish request', async ({ page }) => {
  const item = record(); const ready = gate(item);
  const api = await setup(page, ready, item);
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publication-preview/confirm`, async route => {
    // A background readiness read requested during confirmation must not discard its valid receipt.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return route.fallback();
  });
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish`, route => {
    publishes++;
    expect(api.previewConfirmations).toHaveLength(1);
    expect(route.request().postDataJSON()).toEqual({ version: item.version });
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    return reply(route, envelope({ ...item, version: item.version + 1, publicationState: 'published',
      hasUnpublishedChanges: false, publishedRevisionId: '10000000-0000-4000-8000-000000000112', publishedAt: new Date().toISOString() }));
  });
  await tab(page, '发布预览');
  await expect(publish(page)).toBeDisabled();
  await frameMessage(page, ready, 'resize');
  await expect(publish(page)).toBeDisabled();
  await frameMessage(page, ready, 'ready', { loadId: '10000000-0000-4000-8000-000000000999' });
  await expect(publish(page)).toBeDisabled();
  await frameMessage(page, ready, 'ready', { preview: { vehicleId: item.id, vehicleVersion: item.version,
    publicContentRevision: ready.publicContentRevision, fingerprint: 'f'.repeat(64), locale: 'zh' } });
  await expect(publish(page)).toBeDisabled();
  await frameMessage(page, ready, 'ready');
  await expect(publish(page)).toBeEnabled();
  await frameMessage(page, ready, 'resize', { height: 900 });
  await expect(publish(page)).toBeEnabled();
  expect(api.previewConfirmations).toHaveLength(0);
  expect(api.publicationPreviewReads.length).toBeGreaterThan(0);
  await publish(page).click();
  await expect.poll(() => publishes).toBe(1);
  expect(api.previewConfirmations).toEqual([{ id: item.id, input: { version: item.version,
    publicContentRevision: ready.publicContentRevision, fingerprint: ready.fingerprint, locale: 'zh' } }]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const terminal of ['error', 'disposed'] as const) {
  test(`publication readiness rejects late ready after ${terminal} until a new iframe load`, async ({ page }) => {
    const ready = gate(record()); const api = await setup(page, ready);
    await tab(page, '发布预览');
    const action = publish(page);
    const oldLoadId = await frameMessage(page, ready, 'ready');
    await expect(action).toBeEnabled();
    await frameMessage(page, ready, terminal);
    await expect(action).toBeDisabled();
    await frameMessage(page, ready, 'ready');
    await expect(action).toBeDisabled();
    await page.getByRole('button', { name: /重新载入预览$/ }).click();
    await expect.poll(async () => new URL((await page.locator('iframe[title="中文车辆发布预览"]').getAttribute('src'))!, page.url()).searchParams.get('loadId')).not.toBe(oldLoadId);
    await frameMessage(page, ready, 'ready', { loadId: oldLoadId });
    await expect(action).toBeDisabled();
    await frameMessage(page, ready, 'ready');
    await expect(action).toBeEnabled();
    expect(api.previewConfirmations).toHaveLength(0);
  });
}

test('publication readiness requires fresh readiness after a failed reload and does not reuse expired confirmation', async ({ page }) => {
  const item = record(); const ready = gate(item, true);
  const api = await setup(page, ready, item);
  await frameMessage(page, ready, 'ready');
  await expect(publish(page)).toBeEnabled();
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish-readiness?*`, route => reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('发布检查未完成', { exact: true })).toBeVisible();
  await expect(publish(page)).toBeDisabled();
  await page.unroute(`**/api/v1/admin/vehicles/${item.id}/publish-readiness?*`);
  api.publishReadiness.set(publicationKey(item.id), gate(item, true, {
    confirmation: { locale: 'zh', confirmedAt: new Date(Date.now() - 660_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() },
  }));
  await page.getByRole('button', { name: /重新检查发布条件$/ }).click();
  await expect.poll(() => api.publishReadiness.get(publicationKey(item.id))?.previewConfirmed).toBe(false);
  await expect(publish(page)).toBeEnabled();
  expect(api.previewConfirmations).toHaveLength(0);
});

test('publication readiness blocks dirty input, retains private-only confirmation and invalidates public revisions', async ({ page }) => {
  const item = record(); const ready = gate(item, true);
  const api = await setup(page, ready, item);
  await frameMessage(page, ready, 'ready');
  await expect(publish(page)).toBeEnabled();
  await (await notes(page)).fill('仅更新内部跟进信息');
  await tab(page, '发布预览');
  await expect(publish(page)).toBeDisabled();
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  const afterPrivate = api.publishReadiness.get(publicationKey(item.id))!;
  expect(afterPrivate).toMatchObject({ vehicleVersion: 2, publicContentRevision: ready.publicContentRevision,
    fingerprint: ready.fingerprint, previewConfirmed: true, confirmation: ready.confirmation });
  await frameMessage(page, afterPrivate, 'ready');
  await expect(publish(page)).toBeEnabled();
  await tab(page, '基础资料');
  await page.getByRole('textbox', { name: '标题原文', exact: true }).fill('公开标题已改变');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(2);
  const afterPublic = api.publishReadiness.get(publicationKey(item.id))!;
  expect(afterPublic.publicContentRevision).toBe(ready.publicContentRevision + 1);
  expect(afterPublic.fingerprint).not.toBe(ready.fingerprint);
  expect(afterPublic.previewConfirmed).toBe(false); expect(afterPublic.confirmation).toBeNull();
  await tab(page, '发布预览');
  await expect(publish(page)).toBeDisabled();
  expect(api.previewConfirmations).toHaveLength(0);
});
