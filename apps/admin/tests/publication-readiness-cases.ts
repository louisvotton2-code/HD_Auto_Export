import { expect, test, type Page } from '@playwright/test';
import { makeExternalVehicleDraftFixture, makePublishReadinessFixture } from '@hd/contracts/fixtures';
import { PublishReadinessSchema, type AdminVehicle, type PublishReadiness } from '@hd/contracts/admin';
import { envelope, error, installApi, publicationKey, reply, vehicle } from './api-fixture';
import { openOptionalPublicationPreview } from './publication-test-helpers';
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
  await page.goto(`/admin/vehicles/${item.id}`);
  await expect.poll(() => api.readinessReads.length).toBeGreaterThan(0);
  await tab(page, '发布预览');
  return api;
}

for (const scenario of [
  { stage: 'required_fields' as const, path: 'draft.price.money.amount', message: '公开价格：请检查价格口径、金额和币种', target: '价格与内部信息' },
  { stage: 'localization' as const, path: 'draft.content.title.translations.en', message: '车辆标题 · 英文', target: '车辆配置' },
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
    if (scenario.stage === 'localization') {
      await expect(page.getByLabel('三语 JSON', { exact: true })).toBeFocused();
      await expect(page.getByText('发布前请在 JSON 中补齐资料', { exact: true })).toBeVisible();
      await expect(page.getByText(scenario.message, { exact: true })).toBeVisible();
    }
    await tab(page, '发布预览');
    await expect(publish(page)).toBeDisabled();
    expect(api.previewConfirmations).toEqual([]);
  });
}

test('publication readiness opens the external vehicle powertrain on the configuration tab', async ({ page }) => {
  const item = { ...record(), draft: makeExternalVehicleDraftFixture() };
  item.draft.facts.powertrain = 'unknown';
  const ready = gate(item, false, {
    requiredFieldsReady: false,
    issues: [{ stage: 'required_fields', path: 'draft.facts.powertrain', code: 'REQUIRED', message: 'A known powertrain is required.' }],
  });
  await setup(page, ready, item);
  const powertrain = page.getByRole('combobox', { name: '动力类型', exact: true });
  await page.getByRole('button', { name: '动力类型：请选择已知动力类型', exact: true }).click();
  await expect(page.getByRole('tab', { name: /车辆配置/ })).toHaveAttribute('aria-selected', 'true');
  await expect(powertrain).toBeEnabled();
  await expect(powertrain).toBeFocused();
});

test('publication readiness retries after a failed version confirmation without publishing early', async ({ page }) => {
  const item = record(); const ready = gate(item);
  const api = await setup(page, ready, item);
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish`, route => {
    publishes++;
    return reply(route, error('PUBLISH_VALIDATION_FAILED'), 422);
  });
  const confirmPath = `**/api/v1/admin/vehicles/${item.id}/publication-preview/confirm`;
  await page.route(confirmPath, route => reply(route, error('PUBLISH_VALIDATION_FAILED'), 422));
  await publish(page).click();
  await expect(page.getByText('发布检查未完成', { exact: true })).toBeVisible();
  expect(publishes).toBe(0);
  await page.unroute(confirmPath);
  await page.getByRole('button', { name: /重新检查发布条件$/ }).click();
  await publish(page).click();
  await expect.poll(() => publishes).toBe(1);
  expect(api.previewConfirmations).toHaveLength(1);
});

for (const preview of ['closed', 503, 401] as const) {
  test('publication readiness confirms the server version before publishing with optional preview ' + preview, async ({ page }) => {
    const item = record(); const ready = gate(item);
    const api = await setup(page, ready, item);
    await page.route('**/api/v1/admin/vehicles/' + item.id + '/publication-preview/confirm', async route => {
      // A background readiness read must not cancel the manual confirmation.
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      return route.fallback();
    });
    let publishes = 0;
    await page.route('**/api/v1/admin/vehicles/' + item.id + '/publish', route => {
      publishes++;
      expect(api.previewConfirmations).toHaveLength(1);
      expect(route.request().postDataJSON()).toEqual({ version: item.version });
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      return reply(route, envelope({ ...item, version: item.version + 1, publicationState: 'published',
        hasUnpublishedChanges: false, publishedRevisionId: '10000000-0000-4000-8000-000000000112', publishedAt: new Date().toISOString() }));
    });
    await expect(page.locator('iframe[title="中文车辆发布预览"]')).toHaveCount(0);
    if (preview !== 'closed') {
      await page.route('**/api/v1/admin/vehicles/' + item.id + '/publication-preview?*',
        route => reply(route, error(preview === 401 ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE'), preview));
      await openOptionalPublicationPreview(page);
      await expect(page.getByText('预览未就绪', { exact: true })).toBeVisible();
    }
    await expect(publish(page)).toBeEnabled();
    expect(api.previewConfirmations).toEqual([]);
    expect(api.publicationPreviewReads).toEqual([]);
    expect(publishes).toBe(0);
    await publish(page).click();
    await expect.poll(() => publishes).toBe(1);
    expect(api.previewConfirmations).toEqual([{ id: item.id, input: { version: item.version,
      publicContentRevision: ready.publicContentRevision, fingerprint: ready.fingerprint, locale: 'zh' } }]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('publication readiness stops when the saved version changes before confirmation', async ({ page }) => {
  const item = record();
  const api = await setup(page, gate(item), item);
  await page.route('**/api/v1/admin/vehicles/' + item.id + '/publication-preview/confirm',
    route => reply(route, error('VERSION_CONFLICT'), 409));
  let publishes = 0;
  await page.route('**/api/v1/admin/vehicles/' + item.id + '/publish', route => {
    publishes++;
    return reply(route, error('VERSION_CONFLICT'), 409);
  });
  await publish(page).click();
  await expect(page.getByText('车辆已被其他操作更新', { exact: true })).toBeVisible();
  await expect(publish(page)).toBeDisabled();
  expect(api.previewConfirmations).toEqual([]);
  expect(publishes).toBe(0);
});

test('publication readiness requires a valid staff session for the confirmation request', async ({ page }) => {
  const item = record();
  const api = await setup(page, gate(item), item);
  await page.route('**/api/v1/admin/vehicles/' + item.id + '/publication-preview/confirm',
    route => reply(route, error('UNAUTHENTICATED'), 401));
  let publishes = 0;
  await page.route('**/api/v1/admin/vehicles/' + item.id + '/publish', route => {
    publishes++;
    return reply(route, error('UNAUTHENTICATED'), 401);
  });
  await publish(page).click();
  await expect(page.getByRole('dialog').filter({ hasText: '登录已失效' })).toBeVisible();
  expect(api.previewConfirmations).toEqual([]);
  expect(publishes).toBe(0);
});

test('publication readiness can recheck a recovered condition at the same draft version', async ({ page }) => {
  const item = record();
  const complete = gate(item);
  const incomplete = gate(item, false, {
    requiredFieldsReady: false,
    issues: [{ stage: 'required_fields', path: 'draft.media', code: 'MEDIA_NOT_READY', message: 'The cover is temporarily unreadable.' }],
  });
  const api = await setup(page, incomplete, item);
  await expect(publish(page)).toBeDisabled();
  api.publishReadiness.set(publicationKey(item.id), complete);
  await page.getByRole('button', { name: /重新检查发布条件$/ }).click();
  await expect(publish(page)).toBeEnabled();
  expect(api.previewConfirmations).toEqual([]);
});

test('publication readiness requires fresh readiness after a failed reload and does not reuse expired confirmation', async ({ page }) => {
  const item = record(); const ready = gate(item, true);
  const api = await setup(page, ready, item);
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
  await expect(publish(page)).toBeEnabled();
  await (await notes(page)).fill('仅更新内部跟进信息');
  await tab(page, '发布预览');
  await expect(publish(page)).toBeDisabled();
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  const afterPrivate = api.publishReadiness.get(publicationKey(item.id))!;
  expect(afterPrivate).toMatchObject({ vehicleVersion: 2, publicContentRevision: ready.publicContentRevision,
    fingerprint: ready.fingerprint, previewConfirmed: true, confirmation: ready.confirmation });
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
  await expect(publish(page)).toBeEnabled();
  expect(api.previewConfirmations).toHaveLength(0);
  await publish(page).click();
  await expect.poll(() => api.previewConfirmations.length).toBe(1);
  expect(api.previewConfirmations[0]?.input).toEqual({
    version: afterPublic.vehicleVersion, publicContentRevision: afterPublic.publicContentRevision,
    fingerprint: afterPublic.fingerprint, locale: 'zh',
  });
});
