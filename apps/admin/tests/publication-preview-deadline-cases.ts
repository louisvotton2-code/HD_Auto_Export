/** UI contract simulations with an actual synthetic child window, not a real FE rendering acceptance. */
import { expect, test, type Page } from '@playwright/test';
import { makePublishReadinessFixture } from '@hd/contracts/fixtures';
import { PublicationPreviewFrameMessageSchema, PublicationPreviewResponseSchema, PublishReadinessSchema, type PublishReadiness } from '@hd/contracts/admin';
import { installApi, vehicle } from './api-fixture';
import { tab } from './ui-helpers';

const acknowledge = '我已检查当前预览，确认图片、价格和文字正确';
const timeoutMessage = '预览尚未完整显示。请重新载入，显示完成后才能确认。';
const frameSelector = 'iframe[title="中文车辆发布预览"]';
const checkbox = (page: Page) => page.getByRole('checkbox', { name: acknowledge, exact: true });

async function setup(page: Page) {
  await page.clock.install();
  const item = { ...vehicle(), id: '10000000-0000-4000-8000-000000000211' };
  const ready = PublishReadinessSchema.parse({ ...makePublishReadinessFixture(false), vehicleId: item.id, vehicleVersion: item.version });
  const api = await installApi(page, { items: [item], publicationReadiness: [ready], publicationDefaultConfirmed: false });
  await page.route(/\/staff\/vehicles\/[^/]+\/publication-preview\/\?/, route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><html lang="zh"><head><meta charset="utf-8"></head><body><main>合成预览计时验证，不是真实官网渲染</main></body></html>',
  }));
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '发布预览');
  await expect.poll(() => api.readinessReads.length).toBeGreaterThan(0);
  await expect(page.getByText('正在读取服务端发布检查…', { exact: true })).toBeHidden();
  await expect(page.locator(frameSelector)).toBeVisible();
  // Freeze only after the initial UI/network work settles; subsequent phase boundaries are exact.
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  return { item, ready, api };
}

async function message(page: Page, ready: PublishReadiness, event: 'loading' | 'ready' | 'error' | 'disposed' | 'resize', overrides: Record<string, unknown> = {}) {
  const element = page.locator(frameSelector);
  const loadId = new URL((await element.getAttribute('src'))!, page.url()).searchParams.get('loadId')!;
  const child = await (await element.elementHandle())!.contentFrame();
  expect(child).toBeTruthy();
  await child!.waitForLoadState('domcontentloaded');
  const projection = event === 'ready' ? PublicationPreviewResponseSchema.parse(await child!.evaluate(async url => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Synthetic projection failed');
    return response.json();
  }, `/api/v1/admin/vehicles/${ready.vehicleId}/publication-preview?locale=${ready.locale}`)).data : null;
  const data = PublicationPreviewFrameMessageSchema.parse({
    schemaVersion: 1, type: 'hd:auto:publication-preview', event, loadId, vehicleId: ready.vehicleId, locale: ready.locale,
    ...(projection ? { preview: { vehicleId: projection.vehicle.id, vehicleVersion: projection.vehicleVersion,
      publicContentRevision: projection.publicContentRevision, fingerprint: projection.fingerprint, locale: projection.locale } } : {}),
    ...(event === 'error' ? { error: { code: 'render_error' } } : {}),
    ...(event === 'resize' ? { height: 640 } : {}),
    ...overrides,
  });
  // postMessage originates in the iframe, preserving the parent's origin and event.source checks.
  await child!.evaluate(value => window.parent.postMessage(value, window.location.origin), data);
  return loadId;
}

async function reload(page: Page, oldLoadId: string) {
  await page.getByRole('button', { name: /重新载入预览$/ }).click();
  await expect.poll(async () => new URL((await page.locator(frameSelector).getAttribute('src'))!, page.url()).searchParams.get('loadId')).not.toBe(oldLoadId);
  await expect(page.getByText('正在载入预览', { exact: true })).toBeVisible();
}

test('preview deadline gives an image loading phase a fresh forty seconds after a completed render', async ({ page }) => {
  const { item, ready, api } = await setup(page);
  await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  await page.clock.fastForward(39_000);
  await message(page, ready, 'loading');
  await expect(page.getByText('正在载入预览', { exact: true })).toBeVisible(); await expect(checkbox(page)).toBeDisabled();
  await page.clock.fastForward(3_000);
  await message(page, ready, 'ready');
  await expect(checkbox(page)).toBeEnabled(); await expect(page.getByText(timeoutMessage, { exact: true })).toHaveCount(0);
  expect(api.previewConfirmations).toEqual([]);
  await checkbox(page).check(); await page.getByRole('button', { name: '确认当前预览', exact: true }).click();
  await expect.poll(() => api.previewConfirmations.length).toBe(1);
  expect(api.previewConfirmations[0]).toEqual({ id: item.id, input: { version: item.version,
    publicContentRevision: ready.publicContentRevision, fingerprint: ready.fingerprint, locale: ready.locale } });
  await expect(page.getByTestId('vehicle-publish')).toBeEnabled();
});

test('preview deadline expires a full loading phase and rejects late loading or ready until a new load id', async ({ page }) => {
  const { ready, api } = await setup(page);
  await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  const oldLoadId = await message(page, ready, 'loading');
  await expect(checkbox(page)).toBeDisabled();
  await page.clock.fastForward(39_000);
  await expect(page.getByText('正在载入预览', { exact: true })).toBeVisible();
  await page.clock.fastForward(1_001);
  await expect(page.getByText(timeoutMessage, { exact: true })).toBeVisible();
  await message(page, ready, 'loading'); await message(page, ready, 'ready');
  await page.clock.fastForward(1);
  await expect(checkbox(page)).toBeDisabled(); await expect(page.getByText(timeoutMessage, { exact: true })).toBeVisible();
  await reload(page, oldLoadId);
  await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  expect(api.previewConfirmations).toEqual([]);
});

for (const terminal of ['error', 'disposed'] as const) {
  test(`preview deadline preserves terminal ${terminal} and cannot be revived by old phase messages`, async ({ page }) => {
    const { ready, api } = await setup(page);
    await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
    await message(page, ready, 'loading'); await expect(checkbox(page)).toBeDisabled();
    const oldLoadId = await message(page, ready, terminal);
    const terminalMessage = terminal === 'error' ? '车辆预览未能完整显示，请重新载入。' : '预览已关闭，请重新载入。';
    await expect(page.getByText(terminalMessage, { exact: true })).toBeVisible();
    await page.clock.fastForward(40_001);
    await message(page, ready, 'loading'); await message(page, ready, 'ready');
    await page.clock.fastForward(1);
    await expect(checkbox(page)).toBeDisabled(); await expect(page.getByText(terminalMessage, { exact: true })).toBeVisible();
    await expect(page.getByText(timeoutMessage, { exact: true })).toHaveCount(0);
    await reload(page, oldLoadId); await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
    expect(api.previewConfirmations).toEqual([]);
  });
}

test('preview deadline treats resize as geometry without clearing ready or extending loading', async ({ page }) => {
  const { ready } = await setup(page);
  await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  await message(page, ready, 'resize');
  await page.clock.fastForward(41_000);
  await expect(checkbox(page)).toBeEnabled();
  await message(page, ready, 'loading'); await expect(checkbox(page)).toBeDisabled();
  await page.clock.fastForward(39_000); await message(page, ready, 'resize', { height: 720 });
  await expect(page.locator(frameSelector)).toHaveCSS('height', '720px');
  await page.clock.fastForward(1_001);
  await expect(page.getByText(timeoutMessage, { exact: true })).toBeVisible(); await expect(checkbox(page)).toBeDisabled();
});

test('preview deadline ignores a previous load id without extending or cancelling the new deadline', async ({ page }) => {
  const { ready } = await setup(page);
  const oldLoadId = await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  await reload(page, oldLoadId);
  await message(page, ready, 'loading'); await expect(checkbox(page)).toBeDisabled();
  await page.clock.fastForward(39_000);
  await message(page, ready, 'loading', { loadId: oldLoadId }); await message(page, ready, 'ready', { loadId: oldLoadId });
  await page.clock.fastForward(1_001);
  await expect(page.getByText(timeoutMessage, { exact: true })).toBeVisible(); await expect(checkbox(page)).toBeDisabled();
});

test('preview deadline keeps the initial forty-second bound when loading repeats during the same pending phase', async ({ page }) => {
  const { ready, api } = await setup(page);
  const oldLoadId = await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  await reload(page, oldLoadId);
  // Initial iframe creation already began the pending phase. Neither its first
  // delayed loading message nor another at thirty seconds may renew that deadline.
  await page.clock.fastForward(10_000); await message(page, ready, 'loading');
  await expect(page.getByText('正在载入预览', { exact: true })).toBeVisible();
  await page.clock.fastForward(20_000); await message(page, ready, 'loading');
  await expect(checkbox(page)).toBeDisabled();
  await page.clock.fastForward(10_001);
  await expect(page.getByText(timeoutMessage, { exact: true })).toBeVisible();
  await message(page, ready, 'ready'); await page.clock.fastForward(1);
  await expect(checkbox(page)).toBeDisabled(); expect(api.previewConfirmations).toEqual([]);
});

test('preview deadline rejects a wrong vehicle version and cancels its timer for unsaved public input', async ({ page }) => {
  const { item, ready, api } = await setup(page);
  const oldLoadId = await message(page, ready, 'ready', { preview: { vehicleId: item.id, vehicleVersion: item.version + 1,
    publicContentRevision: ready.publicContentRevision, fingerprint: ready.fingerprint, locale: ready.locale } });
  await expect(page.getByText('车辆已发生变化，请核对最新草稿后重新载入。', { exact: true })).toBeVisible();
  await message(page, ready, 'ready'); await expect(checkbox(page)).toBeDisabled();
  await reload(page, oldLoadId); await message(page, ready, 'ready'); await expect(checkbox(page)).toBeEnabled();
  await message(page, ready, 'loading'); await expect(checkbox(page)).toBeDisabled();
  await tab(page, '基础资料'); await page.getByRole('textbox', { name: '标题原文', exact: true }).fill('尚未保存的公开标题');
  await tab(page, '发布预览');
  await expect(page.getByText('请先保存修改', { exact: true })).toBeVisible();
  await page.clock.fastForward(40_001);
  await message(page, ready, 'ready'); await expect(checkbox(page)).toBeDisabled();
  await expect(page.getByText('请先保存修改', { exact: true })).toBeVisible();
  await expect(page.getByText(timeoutMessage, { exact: true })).toHaveCount(0); expect(api.previewConfirmations).toEqual([]);
});
