import { expect, test, type Page } from '@playwright/test';
import { makePublishReadinessFixture } from '@hd/contracts/fixtures';
import { PublicationPreviewResponseSchema, PublishReadinessSchema, type AdminVehicle, type PublishReadiness } from '@hd/contracts/admin';
import { envelope, error, installApi, publicationKey, reply, vehicle } from './api-fixture';
import { notes, tab } from './ui-helpers';

const acknowledge = '我已检查当前预览，确认图片、价格和文字正确';
const confirmButton = '确认当前预览';
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
  { stage: 'localization' as const, path: 'draft.content.title.translations.en', message: '英文标题：请完善当前原文的译文', target: '公开字段多语' },
]) {
  test(`publication readiness reports and navigates server ${scenario.stage} issues`, async ({ page }) => {
    const item = record();
    const ready = gate(item, false, {
      requiredFieldsReady: scenario.stage !== 'required_fields', localizationReady: scenario.stage !== 'localization',
      issues: [{ stage: scenario.stage, path: scenario.path, code: 'REQUIRED', message: scenario.message }],
    });
    const api = await setup(page, ready, item);
    await expect(page.getByRole('button', { name: /请完善信息$/ })).toBeDisabled();
    await page.getByRole('button', { name: '查看发布缺项', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '发布缺项' });
    await dialog.getByRole('button', { name: scenario.message, exact: true }).click();
    await expect(page.getByRole('tab', { name: new RegExp(scenario.target) })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog).toBeHidden();
    await tab(page, '发布预览');
    await frameMessage(page, ready, 'ready');
    await expect(page.getByRole('checkbox', { name: acknowledge, exact: true })).toBeDisabled();
    expect(api.previewConfirmations).toEqual([]);
  });
}

test('publication readiness requires a matching rendered receipt and explicit acknowledgement before publishing', async ({ page }) => {
  const item = record(); const ready = gate(item);
  const api = await setup(page, ready, item);
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish`, route => {
    publishes++;
    expect(route.request().postDataJSON()).toEqual({ version: item.version });
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    return reply(route, envelope({ ...item, version: item.version + 1, publicationState: 'published',
      hasUnpublishedChanges: false, publishedRevisionId: '10000000-0000-4000-8000-000000000112', publishedAt: new Date().toISOString() }));
  });
  await tab(page, '发布预览');
  const checkbox = page.getByRole('checkbox', { name: acknowledge, exact: true });
  const confirm = page.getByRole('button', { name: confirmButton, exact: true });
  await expect(checkbox).toBeDisabled(); await expect(confirm).toBeDisabled();
  await frameMessage(page, ready, 'resize');
  await expect(checkbox).toBeDisabled();
  await frameMessage(page, ready, 'ready', { loadId: '10000000-0000-4000-8000-000000000999' });
  await expect(checkbox).toBeDisabled();
  await frameMessage(page, ready, 'ready', { preview: { vehicleId: item.id, vehicleVersion: item.version,
    publicContentRevision: ready.publicContentRevision, fingerprint: 'f'.repeat(64), locale: 'zh' } });
  await expect(checkbox).toBeDisabled();
  await frameMessage(page, ready, 'ready');
  await expect(checkbox).toBeEnabled(); await expect(confirm).toBeDisabled();
  await frameMessage(page, ready, 'resize', { height: 900 });
  await expect(checkbox).toBeEnabled();
  expect(api.previewConfirmations).toHaveLength(0);
  expect(api.publicationPreviewReads.length).toBeGreaterThan(0);
  await checkbox.check(); await confirm.click();
  await expect.poll(() => api.previewConfirmations.length).toBe(1);
  expect(api.previewConfirmations[0]).toEqual({ id: item.id, input: { version: item.version,
    publicContentRevision: ready.publicContentRevision, fingerprint: ready.fingerprint, locale: 'zh' } });
  const publish = page.getByRole('button', { name: /发布车辆$/ });
  await expect(publish).toBeEnabled(); expect(publishes).toBe(0);
  await publish.click();
  await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click();
  await expect.poll(() => publishes).toBe(1);
});

for (const terminal of ['error', 'disposed'] as const) {
  test(`publication readiness rejects late ready after ${terminal} until a new iframe load`, async ({ page }) => {
    const ready = gate(record()); const api = await setup(page, ready);
    await tab(page, '发布预览');
    const checkbox = page.getByRole('checkbox', { name: acknowledge, exact: true });
    const oldLoadId = await frameMessage(page, ready, 'ready');
    await expect(checkbox).toBeEnabled();
    await frameMessage(page, ready, terminal);
    await expect(checkbox).toBeDisabled();
    await frameMessage(page, ready, 'ready');
    await expect(checkbox).toBeDisabled();
    await page.getByRole('button', { name: /重新载入预览$/ }).click();
    await expect.poll(async () => new URL((await page.locator('iframe[title="中文车辆发布预览"]').getAttribute('src'))!, page.url()).searchParams.get('loadId')).not.toBe(oldLoadId);
    await frameMessage(page, ready, 'ready', { loadId: oldLoadId });
    await expect(checkbox).toBeDisabled();
    await frameMessage(page, ready, 'ready');
    await expect(checkbox).toBeEnabled();
    expect(api.previewConfirmations).toHaveLength(0);
  });
}

test('publication readiness does not reuse green status after a failed reload or an expired confirmation', async ({ page }) => {
  const item = record(); const ready = gate(item, true);
  const api = await setup(page, ready, item);
  await expect(page.getByRole('button', { name: /发布车辆$/ })).toBeEnabled();
  await tab(page, '发布预览');
  await page.route(`**/api/v1/admin/vehicles/${item.id}/publish-readiness?*`, route => reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await page.getByRole('button', { name: /重新检查发布条件$/ }).click();
  await expect(page.getByText('发布检查未完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /请完善信息$/ })).toBeDisabled();
  await page.unroute(`**/api/v1/admin/vehicles/${item.id}/publish-readiness?*`);
  api.publishReadiness.set(publicationKey(item.id), gate(item, true, {
    confirmation: { locale: 'zh', confirmedAt: new Date(Date.now() - 660_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() },
  }));
  await page.getByRole('button', { name: /重新检查发布条件$/ }).click();
  await expect.poll(() => api.publishReadiness.get(publicationKey(item.id))?.previewConfirmed).toBe(false);
  await expect(page.getByRole('button', { name: /请完善信息$/ })).toBeDisabled();
  expect(api.previewConfirmations).toHaveLength(0);
});

test('publication readiness blocks dirty input, retains private-only confirmation and invalidates public revisions', async ({ page }) => {
  const item = record(); const ready = gate(item, true);
  const api = await setup(page, ready, item);
  await expect(page.getByRole('button', { name: /发布车辆$/ })).toBeEnabled();
  await (await notes(page)).fill('仅更新内部跟进信息');
  await tab(page, '发布预览');
  await expect(page.getByRole('button', { name: /请完善信息$/ })).toBeDisabled();
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  const afterPrivate = api.publishReadiness.get(publicationKey(item.id))!;
  expect(afterPrivate).toMatchObject({ vehicleVersion: 2, publicContentRevision: ready.publicContentRevision,
    fingerprint: ready.fingerprint, previewConfirmed: true, confirmation: ready.confirmation });
  await expect(page.getByRole('button', { name: /发布车辆$/ })).toBeEnabled();
  await tab(page, '基础资料');
  await page.getByRole('textbox', { name: '标题原文', exact: true }).fill('公开标题已改变');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(2);
  const afterPublic = api.publishReadiness.get(publicationKey(item.id))!;
  expect(afterPublic.publicContentRevision).toBe(ready.publicContentRevision + 1);
  expect(afterPublic.fingerprint).not.toBe(ready.fingerprint);
  expect(afterPublic.previewConfirmed).toBe(false); expect(afterPublic.confirmation).toBeNull();
  await tab(page, '发布预览');
  await expect(page.getByRole('button', { name: /请完善信息$/ })).toBeDisabled();
  expect(api.previewConfirmations).toHaveLength(0);
});
