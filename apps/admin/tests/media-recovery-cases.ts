import { expect, test, type Page } from '@playwright/test';
import { MediaUploadRequestSchema, type AdminVehicle, type MediaAsset, type MediaUploadRequest } from '@hd/contracts/admin';
import { contractFixtures } from '@hd/contracts/fixtures';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { tab } from './ui-helpers';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwjA4AAAGdAN1OqARQAAAAAElFTkSuQmCC', 'base64');
const localImage = { name: 'synthetic-recovery.png', mimeType: 'image/png', buffer: png };
const mediaPath = '/api/v1/admin/media';
const quotaError = '图片名额已满。每辆车最多 30 张，待处理的上传也占名额。请先回收不需要的上传任务。';
const failurePrefix = 'hd-admin:media-upload-failure:v1:';
const uploadRequestId = 'a60490e1-3d54-4f32-8ce6-adf43def8329';
const rejectedImage = { ...localImage, name: 'fixture-local-only.png' };
const rawMessage = `Synthetic validation detail for ${rejectedImage.name}`;
const rawPath = 'fixture-private-validation-path';
const invalidUpload = {
  error: { code: 'INVALID_REQUEST', message: rawMessage, retryable: false,
    fields: [{ path: rawPath, code: 'INVALID_FIELD', message: rawMessage }] },
  meta: { requestId: uploadRequestId },
};
const limit = 30;
const databaseId = (id: string) => {
  const match = id.toLowerCase().replace(/-/g, '').match(/^([\da-f]{8})([\da-f]{4})([\da-f]{4})([\da-f]{4})([\da-f]{12})$/);
  return match ? match.slice(1).join('-') : id;
};

function media(vehicleId: string, id: string, status: MediaAsset['status'], version = 1): MediaAsset {
  const { failedMedia } = contractFixtures;
  return {
    ...failedMedia, id, vehicleId, status, version, contentType: 'image/png', sizeBytes: png.length,
    width: status === 'ready' || status === 'uploaded' ? 1 : null,
    height: status === 'ready' || status === 'uploaded' ? 1 : null,
    previewPath: status === 'ready' ? `${mediaPath}/${id}/preview` : null,
  };
}

async function installMediaApi(page: Page, item: AdminVehicle, uploads: MediaAsset[] = []) {
  const api = await installApi(page, { items: [item] });
  const records = new Map([
    ...item.draft.media.map(({ id }) => media(item.id, databaseId(id), 'ready')),
    ...uploads,
  ].map(asset => [asset.id, asset]));
  const protectedIds = new Set<string>();
  const permits: MediaUploadRequest[] = [];
  const writes: { method: string; id: string; version: number }[] = [];
  const listingReads: string[][] = [];
  const listPath = `/api/v1/admin/vehicles/${item.id}/media-uploads`;
  const fixture = { api, records, permits, writes, protectedIds, listingReads, listPath, loseNextPermit: false,
    rejectUploadAt: null as 'permit' | 'content' | null };
  const saved = (id: string) => item.draft.media.some(asset => databaseId(asset.id) === id);
  const activeAssets = () => [...records.values()].filter(asset => !protectedIds.has(asset.id) || saved(asset.id));

  await page.route(`**${listPath}`, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const active = activeAssets();
    const items = active.filter(asset => !saved(asset.id));
    listingReads.push(items.map(({ id }) => id));
    return reply(route, envelope({ items, used: active.length, limit }));
  });

  await page.route(`**${mediaPath}/uploads`, route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const input = MediaUploadRequestSchema.parse(request.postDataJSON());
    permits.push(input);
    if (fixture.rejectUploadAt === 'permit') return reply(route, invalidUpload, 400);
    if (activeAssets().length >= limit) return reply(route, error('PUBLISH_VALIDATION_FAILED'), 422);
    const asset = media(input.vehicleId, `new-fixture-${permits.length}`, 'pending');
    records.set(asset.id, asset);
    if (fixture.loseNextPermit) {
      fixture.loseNextPermit = false;
      return route.abort('failed');
    }
    return reply(route, envelope({
      media: asset, method: 'PUT', uploadUrl: `${mediaPath}/${asset.id}/content`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }), 201);
  });

  await page.route(/\/api\/v1\/admin\/media\/(?!uploads$)[^/?]+(?:\/(?:content|complete|preview))?$/, route => {
    const request = route.request();
    const [pathId, action] = new URL(request.url()).pathname.slice(mediaPath.length + 1).split('/');
    const id = databaseId(pathId!);
    const asset = records.get(id);
    if (!asset) return reply(route, error('NOT_FOUND'), 404);
    const method = request.method();
    if (method === 'GET' && action === 'preview' && asset.status === 'ready') {
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    }
    if (method === 'GET' && !action) return reply(route, envelope(asset));

    const version = method === 'PUT' ? Number(request.headers()['if-match']) : request.postDataJSON()?.version;
    writes.push({ method, id, version });
    if (version !== asset.version) return reply(route, error('VERSION_CONFLICT'), 409);
    if (method === 'DELETE' && !action) {
      if (protectedIds.has(id) || saved(id)) return reply(route, error('MEDIA_IN_USE'), 409);
      records.delete(id);
      return route.fulfill({ status: 204 });
    }
    if (method === 'PUT' && action === 'content' && asset.status === 'pending') {
      if (fixture.rejectUploadAt === 'content') return reply(route, invalidUpload, 400);
      if (!request.postDataBuffer()?.equals(png)) return reply(route, error('INVALID_REQUEST'), 400);
      const uploaded = media(asset.vehicleId, asset.id, 'uploaded', version + 1);
      records.set(id, uploaded);
      return reply(route, envelope(uploaded));
    }
    if (method === 'POST' && action === 'complete' && asset.status === 'uploaded') {
      const ready = media(asset.vehicleId, asset.id, 'ready', version + 1);
      records.set(id, ready);
      return reply(route, envelope(ready));
    }
    return reply(route, error('MEDIA_NOT_READY'), 422);
  });

  return fixture;
}

const quota = (page: Page, used: number) => page.getByText(`图片名额 ${used} / ${limit}`, { exact: true });
const quotaFull = (page: Page) => page.getByText(quotaError, { exact: true });
const pendingList = (page: Page) => page.getByLabel('待处理上传任务', { exact: true });
const chooseImage = (page: Page, file = localImage) => page.locator('input[type=file][accept*="image/png"]').setInputFiles(file);
const saveDraft = (page: Page) => page.getByRole('button', { name: /保存草稿$/ }).click();
const lastFailure = (page: Page) => page.getByRole('alert').filter({ hasText: '上次上传失败' });

test('media recovery reclaims a lost upload permit after reload and uploads the file again', async ({ page }) => {
  const item = vehicle();
  const original = structuredClone(item.draft.media);
  const otherUploads = Array.from({ length: limit - 2 }, (_, index) => media(item.id, `fixture_failed_${index}`, 'failed'));
  const fixture = await installMediaApi(page, item, otherUploads);
  fixture.loseNextPermit = true;

  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await expect(quota(page, 29)).toBeVisible();
  await chooseImage(page);
  await expect(page.getByText('上传未完成', { exact: true })).toBeVisible();
  expect(fixture.permits).toHaveLength(1);
  expect(fixture.writes).toEqual([]);

  await page.reload();
  await tab(page, '图片管理');
  const pending = pendingList(page).getByRole('listitem').filter({ hasText: '待上传文件' });
  await expect(pending.getByRole('button')).toHaveCount(1);
  await expect(quota(page, 30)).toBeVisible();
  await expect(quotaFull(page)).toBeVisible();
  await pending.getByRole('button', { name: /回收上传任务$/ }).click();
  await expect(quota(page, 29)).toBeVisible();
  await expect(quotaFull(page)).toHaveCount(0);
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole('img', { name: original[0].alt, exact: true })).toBeVisible();

  await chooseImage(page);
  await expect(page.getByText('上传完成，已加入当前草稿', { exact: true })).toBeVisible();
  await saveDraft(page);
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await expect(quota(page, 30)).toBeVisible();
  const expectedUpload = { vehicleId: item.id, filename: localImage.name, contentType: localImage.mimeType, sizeBytes: png.length };
  expect(fixture.permits).toEqual([expectedUpload, expectedUpload]);
  expect(fixture.writes).toEqual([
    { method: 'DELETE', id: 'new-fixture-1', version: 1 },
    { method: 'PUT', id: 'new-fixture-2', version: 1 },
    { method: 'POST', id: 'new-fixture-2', version: 2 },
  ]);
  expect(fixture.api.saves.map(({ draft }) => draft.media)).toEqual([
    [...original, { id: 'new-fixture-2', sortOrder: 1, isCover: false, alt: '' }],
  ]);
});

test('media recovery restores uploaded and ready images once and preserves saved image order and cover', async ({ page }) => {
  const item = vehicle();
  item.draft.media[0].isCover = false;
  item.draft.media.push({ id: 'fixture_second_original', alt: '合成原封面', sortOrder: 1, isCover: true });
  const original = structuredClone(item.draft.media);
  const uploaded = media(item.id, 'fixture_uploaded', 'uploaded', 3);
  const ready = media(item.id, 'fixture_ready', 'ready', 5);
  const failed = media(item.id, 'fixture_failed', 'failed', 2);
  const fixture = await installMediaApi(page, item, [uploaded, ready, failed]);

  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await page.reload();
  await tab(page, '图片管理');
  const pending = pendingList(page);
  const failedRow = pending.getByRole('listitem').filter({ hasText: '处理失败' });
  await expect(quota(page, 5)).toBeVisible();
  await expect(failedRow.getByRole('button')).toHaveCount(1);
  await failedRow.getByRole('button', { name: /回收上传任务$/ }).click();
  await expect(quota(page, 4)).toBeVisible();
  await expect(failedRow).toHaveCount(0);

  await expect(pending.getByText('已上传，待处理', { exact: true })).toBeVisible();
  await pending.getByRole('button', { name: /处理并加入草稿$/ }).click();
  await expect(pending.getByText('已上传，待处理', { exact: true })).toHaveCount(0);
  await expect(pending.getByText('已处理，待加入草稿', { exact: true })).toBeVisible();
  await pending.getByRole('button', { name: /^加入草稿$/ }).click();
  await expect(pending.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /图片 \d+ 说明/ })).toHaveCount(4);

  const readsBeforeSave = fixture.listingReads.length;
  await saveDraft(page);
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await expect.poll(() => fixture.listingReads.slice(readsBeforeSave)).toContainEqual([]);
  expect(fixture.permits).toEqual([]);
  expect(fixture.writes).toEqual([
    { method: 'DELETE', id: failed.id, version: failed.version },
    { method: 'POST', id: uploaded.id, version: uploaded.version },
  ]);
  expect(fixture.api.saves.map(({ draft }) => draft.media)).toEqual([
    [...original,
      { id: uploaded.id, sortOrder: 2, isCover: false, alt: '' },
      { id: ready.id, sortOrder: 3, isCover: false, alt: '' }],
  ]);

  await page.reload();
  await tab(page, '图片管理');
  await expect(quota(page, 4)).toBeVisible();
  await expect(pending.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /图片 \d+ 说明/ })).toHaveCount(4);
  await expect(page.getByLabel('图片 1 说明', { exact: true })).toHaveValue(original[0].alt);
  await expect(page.getByLabel('图片 2 说明', { exact: true })).toHaveValue(original[1].alt);
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('img', { name: original[1].alt, exact: true }) })
    .getByRole('button', { name: /当前封面$/ })).toBeDisabled();
});

test('media recovery lists a same-page upload only once after saving its removal', async ({ page }) => {
  const item = vehicle();
  const original = structuredClone(item.draft.media);
  const fixture = await installMediaApi(page, item);
  const added = { id: 'new-fixture-1', sortOrder: 1, isCover: false, alt: '合成车辆侧面' };
  const pending = pendingList(page);
  const savedStatus = page.getByRole('status').filter({ hasText: '草稿已保存' });
  const addedAlt = page.getByLabel('图片 2 说明', { exact: true });

  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await expect(quota(page, 1)).toBeVisible();
  await chooseImage(page);
  await expect(page.getByText('上传完成，已加入当前草稿', { exact: true })).toBeVisible();
  await addedAlt.fill(added.alt);
  await saveDraft(page);
  await expect(savedStatus).toBeVisible();

  await page.getByRole('button', { name: '从草稿移除图片 2', exact: true }).click();
  await expect(addedAlt).toHaveCount(0);
  await expect(savedStatus).toHaveCount(0);
  await saveDraft(page);
  await expect(savedStatus).toBeVisible();
  const ready = pending.getByRole('listitem');
  await expect(ready).toHaveCount(1);
  await expect(ready).toContainText('已处理，待加入草稿');
  expect(fixture.listingReads.at(-1)).toEqual([added.id]);
  await expect(page.getByLabel('图片上传进度', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/已移除图片 ·/)).toHaveCount(0);
  await expect(quota(page, 2)).toBeVisible();

  await ready.getByRole('button', { name: '加入草稿', exact: true }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /图片 \d+ 说明/ })).toHaveCount(2);
  await expect(addedAlt).toHaveValue(added.alt);
  await expect(page.getByRole('img', { name: original[0].alt, exact: true })).toBeVisible();
  await saveDraft(page);
  await expect(savedStatus).toBeVisible();
  expect(fixture.api.saves.map(({ draft }) => draft.media)).toEqual([[...original, added], original, [...original, added]]);
  expect(fixture.permits).toHaveLength(1);
  expect(fixture.writes).toEqual([
    { method: 'PUT', id: added.id, version: 1 },
    { method: 'POST', id: added.id, version: 2 },
  ]);
});

for (const [format, id] of [
  ['hyphenated', 'ABCDEF01-0000-4000-8000-000000000002'],
  ['compact', 'ABCDEF01000040008000000000000002'],
] as const) {
  test(`media recovery matches ${format} historical UUID references to a canonical asset`, async ({ page }) => {
    const item = vehicle();
    const previous = { id, alt: '已保存的侧面照片', sortOrder: 1, isCover: false };
    item.draft.media.push(previous);
    const fixture = await installMediaApi(page, item);
    await page.goto(`/admin/vehicles/${item.id}`);
    await tab(page, '图片管理');
    await expect(quota(page, 2)).toBeVisible();
    await expect(pendingList(page)).toHaveCount(0);
    await expect(page.getByRole('img', { name: previous.alt, exact: true })).toBeVisible();

    await page.getByRole('button', { name: '从草稿移除图片 2', exact: true }).click();
    await saveDraft(page);
    const ready = pendingList(page).getByRole('listitem');
    await expect(ready).toHaveCount(1);
    expect(fixture.listingReads.at(-1)).toEqual(['abcdef01-0000-4000-8000-000000000002']);
    await expect(page.getByText(/已移除图片 ·/)).toHaveCount(0);
    await ready.getByRole('button', { name: '加入草稿', exact: true }).click();
    await expect(page.getByLabel('图片 2 说明', { exact: true })).toHaveValue(previous.alt);
    await expect(pendingList(page)).toHaveCount(0);
    await expect(page.getByText(/已移除图片 ·/)).toHaveCount(0);
    await saveDraft(page);
    await expect.poll(() => fixture.api.saves.at(-1)?.draft.media[1]).toEqual(previous);
    expect(fixture.writes).toEqual([]);
  });
}

test('media recovery respects a server rejection when an upload becomes referenced', async ({ page }) => {
  const item = vehicle();
  const ready = media(item.id, 'fixture_upcoming_publication', 'ready');
  const fixture = await installMediaApi(page, item, [ready]);
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  const recycle = pendingList(page).getByRole('button', { name: /回收上传任务$/ });
  await expect(recycle).toBeVisible();
  fixture.protectedIds.add(ready.id);
  await recycle.click();

  await expect(page.getByText(/仍被草稿或发布历史使用，无法回收/)).toBeVisible();
  expect(fixture.writes).toEqual([{ method: 'DELETE', id: ready.id, version: ready.version }]);
  expect(fixture.records.has(ready.id)).toBe(true);
  expect(fixture.api.saves).toEqual([]);
});

for (const status of [404, 405]) {
  test(`media recovery keeps uploads and draft saving on an older API (${status})`, async ({ page }) => {
    const item = vehicle();
    const original = structuredClone(item.draft.media);
    const fixture = await installMediaApi(page, item);
    await page.route(`**${fixture.listPath}`, route => route.fulfill({ status, body: 'Unsupported route' }));
    const listing = page.waitForResponse(response => response.url().endsWith(fixture.listPath) && response.status() === status);
    await page.goto(`/admin/vehicles/${item.id}`);
    await tab(page, '图片管理');
    await listing;
    await expect(page.getByRole('img', { name: original[0].alt, exact: true })).toBeVisible();
    await expect(pendingList(page)).toHaveCount(0);
    await chooseImage(page);
    await expect(page.getByText('上传完成，已加入当前草稿', { exact: true })).toBeVisible();
    await saveDraft(page);
    await expect(page.getByRole('status')).toContainText('草稿已保存');
    expect(fixture.permits).toHaveLength(1);
    expect(fixture.api.saves.map(({ draft }) => draft.media)).toEqual([
      [...original, { id: 'new-fixture-1', sortOrder: 1, isCover: false, alt: '' }],
    ]);
  });
}

test('media recovery reads current quota after an upload permit 422, reload and expiration', async ({ page }) => {
  await page.clock.install();
  const item = vehicle();
  const fixture = await installMediaApi(page, item);
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await expect(quota(page, 1)).toBeVisible();
  // The shared quota fills in a different session after the browser's last read.
  for (let index = 1; index < limit; index++) {
    const asset = media(item.id, `fixture_other_upload_${index}`, 'pending');
    fixture.records.set(asset.id, asset);
  }
  const rejected = page.waitForResponse(response => response.url().endsWith(`${mediaPath}/uploads`)
    && response.request().method() === 'POST' && response.status() === 422);
  await chooseImage(page);
  await rejected;

  await expect(quota(page, 30)).toBeVisible();
  await expect(quotaFull(page)).toBeVisible();
  await expect(page.getByText(/尚未满足发布条件/)).toHaveCount(0);

  await page.reload();
  await tab(page, '图片管理');
  await expect(quota(page, 30)).toBeVisible();
  await expect(quotaFull(page)).toBeVisible();

  // An unavailable read should not stop checking for expiring permits.
  await page.route(`**${fixture.listPath}`, route => reply(route, error('SERVICE_UNAVAILABLE'), 503), { times: 1 });
  await page.clock.fastForward(60_000);
  await expect(page.getByText('读取待处理上传任务失败', { exact: true })).toBeVisible();
  // The server has collected an expired permit since the last successful read.
  fixture.records.delete('fixture_other_upload_1');
  await page.clock.fastForward(60_000);
  await expect(quota(page, 29)).toBeVisible();
  await expect(quotaFull(page)).toHaveCount(0);
  expect(fixture.permits).toHaveLength(1);
  expect(fixture.writes).toEqual([]);
});

for (const scenario of [
  { step: 'permit', method: 'POST', path: `${mediaPath}/uploads`, quotaUsed: 1,
    reason: 'permitRejected', text: '上传许可申请未通过校验' },
  { step: 'content', method: 'PUT', path: `${mediaPath}/new-fixture-1/content`, quotaUsed: 2,
    reason: 'contentRejected', text: '发送图片时未通过校验' },
] as const) {
  test(`media recovery keeps a safe reference across reload after upload ${scenario.method} 400`, async ({ page }) => {
    const item = vehicle();
    const original = structuredClone(item.draft.media);
    const fixture = await installMediaApi(page, item);
    fixture.rejectUploadAt = scenario.step;
    await page.goto(`/admin/vehicles/${item.id}`);
    await tab(page, '图片管理');
    await expect(quota(page, 1)).toBeVisible();
    const rejected = page.waitForResponse(response => response.url().endsWith(scenario.path)
      && response.request().method() === scenario.method && response.status() === 400);
    await chooseImage(page, rejectedImage);
    await rejected;
    await expect(page.getByText('上传未完成', { exact: true })).toBeVisible();

    await page.reload();
    await tab(page, '图片管理');
    await expect(quota(page, scenario.quotaUsed)).toBeVisible();
    const history = lastFailure(page);
    await expect(history).toContainText(scenario.text);
    await expect(history).toContainText('参考编号');
    await expect(history).toContainText(uploadRequestId);
    const privateDetails = [rawMessage, rawPath, rejectedImage.name, png.toString('base64')];
    const stored = await page.evaluate(prefix => Object.entries(sessionStorage).filter(([key]) => key.startsWith(prefix)), failurePrefix);
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0][1])).toEqual({ reason: scenario.reason, reference: uploadRequestId });
    for (const detail of privateDetails) {
      expect(JSON.stringify(stored)).not.toContain(detail);
      await expect(page.getByText(detail, { exact: false })).toHaveCount(0);
    }
    await expect(page.getByRole('img', { name: original[0].alt, exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /图片 \d+ 说明/ })).toHaveCount(1);
    expect(item.draft.media).toEqual(original);
    expect(fixture.api.saves).toEqual([]);
    expect(fixture.permits).toHaveLength(1);
    expect(fixture.writes).toEqual(scenario.step === 'content' ? [{ method: 'PUT', id: 'new-fixture-1', version: 1 }] : []);

    if (scenario.step === 'content') {
      await expect(pendingList(page).getByText('待上传文件', { exact: true })).toBeVisible();
      fixture.rejectUploadAt = null;
      await chooseImage(page);
      await expect(page.getByText('上传完成，已加入当前草稿', { exact: true })).toBeVisible();
      return;
    }

    await expect(pendingList(page)).toHaveCount(0);
    const otherVehicle = { ...vehicle(), id: 'fixture_other_vehicle', stockCode: 'FIXTURE-OTHER' };
    otherVehicle.draft.facts.model!.name = 'Other sample vehicle';
    fixture.api.items.push(otherVehicle);
    await page.route(`**/api/v1/admin/vehicles/${otherVehicle.id}/media-uploads`, route => reply(route, envelope({ items: [], used: 1, limit })));
    await page.getByRole('button', { name: /返回车辆列表$/ }).click();
    await page.getByRole('link', { name: 'Example Other sample vehicle', exact: true }).click();
    await tab(page, '图片管理');
    await expect(quota(page, 1)).toBeVisible();
    await expect(history).toHaveCount(0);

    await page.getByRole('button', { name: /返回车辆列表$/ }).click();
    await page.getByRole('link', { name: 'Example Sample vehicle', exact: true }).click();
    await tab(page, '图片管理');
    await expect(history).toContainText(uploadRequestId);
    const staffId = fixture.api.me.id;
    fixture.api.me.id = 'fixture_other_staff';
    await page.reload();
    await tab(page, '图片管理');
    await expect(quota(page, 1)).toBeVisible();
    await expect(history).toHaveCount(0);

    fixture.api.me.id = staffId;
    await page.reload();
    await tab(page, '图片管理');
    await expect(history).toContainText(uploadRequestId);

    await page.getByRole('button', { name: /返回车辆列表$/ }).click();
    fixture.api.me.id = 'fixture_other_staff';
    await page.getByRole('link', { name: 'Example Sample vehicle', exact: true }).click();
    await tab(page, '图片管理');
    await expect(page.getByRole('dialog')).toContainText('登录已失效');
    await expect(history).toHaveCount(0);
    fixture.api.me.id = staffId;
    await page.reload();
    await tab(page, '图片管理');
    await expect(history).toContainText(uploadRequestId);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(() => { window.open('about:blank'); }),
    ]);
    const tabEntry = await page.evaluate(() => ['hd-admin:media-upload-feedback-tab:v1', sessionStorage.getItem('hd-admin:media-upload-feedback-tab:v1')!] as const);
    expect(tabEntry[1]).toBeTruthy();
    const duplicatedTabs = [];
    for (const navigation of ['back_forward', 'reload']) {
      const duplicated = await page.context().newPage();
      await duplicated.addInitScript(({ entries, navigation }) => {
        for (const [key, value] of entries) sessionStorage.setItem(key, value);
        const getEntries = performance.getEntriesByType.bind(performance);
        performance.getEntriesByType = type => type === 'navigation'
          ? [{ type: navigation } as PerformanceNavigationTiming] : getEntries(type);
      }, { entries: [...stored, tabEntry], navigation });
      duplicatedTabs.push(duplicated);
    }
    for (const otherTab of [popup, await page.context().newPage(), ...duplicatedTabs]) {
      try {
        const otherFixture = await installMediaApi(otherTab, structuredClone(item));
        await otherTab.goto(`/admin/vehicles/${item.id}`);
        await tab(otherTab, '图片管理');
        await expect(quota(otherTab, 1)).toBeVisible();
        await expect(lastFailure(otherTab)).toHaveCount(0);
        expect(otherFixture.permits).toEqual([]);
        expect(otherFixture.writes).toEqual([]);
      } finally { await otherTab.close(); }
    }

    await expect(history).toContainText(uploadRequestId);
    await history.getByRole('button', { name: '关闭上次上传提示', exact: true }).click();
    await expect(history).toHaveCount(0);
    await page.reload();
    await tab(page, '图片管理');
    await expect(quota(page, 1)).toBeVisible();
    await expect(history).toHaveCount(0);
    expect(fixture.permits).toHaveLength(1);
    expect(fixture.writes).toEqual([]);
  });
}

test('media recovery does not count a rejected permit as a slot on an older API', async ({ page }) => {
  const item = vehicle();
  item.draft.media.push(...Array.from({ length: 28 }, (_, index) => ({
    id: `fixture_saved_${index}`, alt: `合成已保存图 ${index + 2}`, sortOrder: index + 1, isCover: false,
  })));
  const fixture = await installMediaApi(page, item);
  fixture.rejectUploadAt = 'permit';
  await page.route(`**${fixture.listPath}`, route => reply(route, error('NOT_FOUND'), 404));
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await expect(page.getByText('图片名额暂不可用', { exact: true })).toHaveCount(0);
  await chooseImage(page);
  await expect(page.getByText(/上传许可申请未通过校验/)).toBeVisible();
  expect(fixture.permits).toHaveLength(1);
  expect(fixture.writes).toEqual([]);

  fixture.rejectUploadAt = null;
  await chooseImage(page);
  await expect(page.getByText('上传完成，已加入当前草稿', { exact: true })).toBeVisible();
  await expect(quotaFull(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /图片 \d+ 说明/ })).toHaveCount(30);
  expect(fixture.permits).toHaveLength(2);
});

test('media recovery discards the failure reference when the shared login changed before the editor updated', async ({ page }) => {
  const item = vehicle();
  const fixture = await installMediaApi(page, item);
  fixture.rejectUploadAt = 'permit';
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await expect(quota(page, 1)).toBeVisible();
  const originalStaffId = fixture.api.me.id;
  // A different tab can replace the active session cookie without changing this tab's editor state.
  fixture.api.me.id = 'fixture_staff_in_another_tab';
  await chooseImage(page);
  await expect(page.getByRole('dialog')).toContainText('登录已失效');
  const stored = await page.evaluate(prefix => Object.keys(sessionStorage).filter(key => key.startsWith(prefix)), failurePrefix);
  expect(stored).toEqual([]);
  expect(fixture.permits).toHaveLength(1);
  expect(fixture.writes).toEqual([]);

  fixture.api.me.id = originalStaffId;
  await page.reload();
  await tab(page, '图片管理');
  await expect(quota(page, 1)).toBeVisible();
  await expect(lastFailure(page)).toHaveCount(0);
});

test('media recovery keeps a known permit recoverable after the same employee signs in again on an older API', async ({ page }) => {
  const item = vehicle();
  const fixture = await installMediaApi(page, item);
  fixture.rejectUploadAt = 'content';
  await page.route(`**${fixture.listPath}`, route => reply(route, error('NOT_FOUND'), 404));
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '图片管理');
  await page.route('**/api/v1/admin/me', route => reply(route, error('UNAUTHENTICATED'), 401), { times: 1 });
  await chooseImage(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('登录已失效');
  await dialog.getByLabel('账号或工作邮箱').fill('fixture-editor');
  await dialog.getByLabel('密码', { exact: true }).fill('synthetic-fixture-password');
  await dialog.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(dialog).toHaveCount(0);
  const uploads = page.getByLabel('图片上传进度', { exact: true });
  await expect(uploads.getByRole('button', { name: /确认状态并重试上传$/ })).toBeEnabled();
  await uploads.getByRole('button', { name: '取消并回收上传任务', exact: true }).click();
  await expect(uploads).toHaveCount(0);
  expect(fixture.permits).toHaveLength(1);
  expect(fixture.writes).toEqual([{ method: 'PUT', id: 'new-fixture-1', version: 1 }, { method: 'DELETE', id: 'new-fixture-1', version: 1 }]);
  await expect(page.getByRole('img', { name: item.draft.media[0]!.alt, exact: true })).toBeVisible();
});
