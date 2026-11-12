import { expect, test, type Page } from '@playwright/test';
import { makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
import {
  authorizePreview, installPreviewTransport, nextPreviewLoadId, openPreviewHost,
  previewHref, previewLoadId, previewMessages, previewStaffCookie, previewVehicleId, waitForPreviewEvent,
  holdPreviewImageDecode, holdPreviewMedia, previewCoverId, previewSecondImageId, previewThirdImageId,
  type PreviewMediaControls,
} from './helpers/publication-preview';

test.beforeEach(async ({ request }) => {
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated staff fixtures are required.');
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

test('the HTML shell exposes no draft data and declares its private embedding policy', async ({ request }) => {
  const response = await request.get(previewHref('en'));
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(response.headers()['cache-control']).toMatch(/no-store/);
  expect(response.headers()['x-robots-tag']).toMatch(/noindex/);
  expect(response.headers()['x-frame-options']?.toUpperCase()).toBe('SAMEORIGIN');
  expect(response.headers()['content-security-policy']?.split(';').map((directive) => directive.trim())
    .find((directive) => directive.startsWith('frame-ancestors'))).toBe("frame-ancestors 'self'");
  expect(html).toContain('noindex');
  expect(html).not.toMatch(/FIXTURE-0001|Test vehicle|Toyota|PRIVATE_COST_SENTINEL|PRIVATE_NOTES_SENTINEL/);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain('/staff/vehicles/');
});

for (const [locale, width, height] of [['zh', 1440, 1000], ['en', 390, 900], ['ru', 320, 900]] as const) {
  test(`${locale}: authorized preview renders at ${width}px before reporting the matching proof`, async ({ page, context, request, baseURL }) => {
    await page.setViewportSize({ width, height });
    await authorizePreview(context, baseURL!);
    const transport = await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, locale);
    const main = frame.getByTestId('publication-preview-body');
    await expect(main).toBeVisible();
    const fixture = makePublicationPreviewFixture(locale);
    await expect(main.locator('h1')).toHaveText(fixture.vehicle.content.title.text!);
    await expect(main).toHaveAttribute('lang', locale === 'zh' ? 'zh-Hans' : locale);
    const ready = await waitForPreviewEvent(page, 'ready');
    expect(ready.fromChild).toBe(true);
    expect(ready.origin).toBe(new URL(baseURL!).origin);
    expect(ready.bodyRendered).toBe(true);
    expect(ready.data.event).toBe('ready');
    if (ready.data.event === 'ready') {
      expect(ready.data.preview).toEqual({ vehicleId: previewVehicleId, vehicleVersion: 4, publicContentRevision: 3, fingerprint: '4'.padStart(64, '0'), locale });
    }
    const observations = await previewMessages(page);
    expect(observations.findIndex((entry) => entry.data.event === 'loading')).toBeLessThan(observations.findIndex((entry) => entry.data.event === 'ready'));
    const resize = await waitForPreviewEvent(page, 'resize');
    if (resize.data.event === 'resize') {
      expect(Number.isInteger(resize.data.height)).toBe(true);
      expect(resize.data.height).toBeGreaterThanOrEqual(240);
      expect(resize.data.height).toBeLessThanOrEqual(16000);
      expect(resize.data).not.toHaveProperty('preview');
    }
    const image = main.locator('[data-vehicle-gallery] img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
    await expect(image).toHaveAttribute('src', /\/api\/v1\/admin\/media\/.+\/preview$/);
    expect(await main.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain(previewStaffCookie);
    await expect.poll(() => transport.reads.some((entry) => entry.path.endsWith('/publication-preview') && entry.cookie?.includes(`${previewStaffCookie}=authorized`))).toBe(true);
    expect(transport.publicReads).toEqual([]);
    expect(transport.reads.every((entry) => entry.method === 'GET')).toBe(true);
    await expect(frame.locator('header.site-header, footer.site-footer, [aria-labelledby="site-enquiry-title"]')).toHaveCount(0);
    await expect(frame.locator('a[href^="https://t.me/"], a[href^="https://wa.me/"]')).toHaveCount(0);
    expect(JSON.stringify(observations)).not.toContain(fixture.vehicle.content.title.text!);
  });
}

for (const [mode, code, authorized] of [
  ['unauthenticated', 'unauthenticated', false], ['forbidden', 'forbidden', true],
  ['not_found', 'not_found', true], ['conflict', 'conflict', true],
  ['unavailable', 'unavailable', true], ['malformed', 'invalid_response', true],
  ['wrong_id', 'invalid_response', true], ['wrong_locale', 'invalid_response', true],
  ['private_field', 'invalid_response', true],
] as const) {
  test(`${mode}: the frame clears readiness without public fallback or private diagnostics`, async ({ page, context, request, baseURL }) => {
    await setPublicFixtureState(request, { previewMode: mode });
    if (authorized) await authorizePreview(context, baseURL!);
    const transport = await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, 'en');
    await expect(frame.getByTestId('publication-preview-status')).toBeVisible();
    const failure = await waitForPreviewEvent(page, 'error');
    expect(failure.data.event).toBe('error');
    if (failure.data.event === 'error') expect(failure.data.error.code).toBe(code);
    await expect(frame.getByTestId('publication-preview-body')).toHaveCount(0);
    const text = await frame.locator('body').innerText();
    expect(text).not.toMatch(/PRIVATE_|Test vehicle|FIXTURE-0001|Toyota/);
    expect((await previewMessages(page)).filter((entry) => entry.data.event === 'ready')).toEqual([]);
    expect(transport.publicReads).toEqual([]);
    expect(transport.reads.every((entry) => entry.method === 'GET')).toBe(true);
    expect(transport.reads.some((entry) => entry.path.includes('/admin/media/'))).toBe(false);
  });
}

test('an incomplete quote retains its currency and remains distinct from zero and on-request pricing', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await installPreviewTransport(page, request);
  await setPublicFixtureState(request, { previewMode: 'incomplete' });
  const frame = await openPreviewHost(page, 'en');
  const failure = await waitForPreviewEvent(page, 'error');
  if (failure.data.event === 'error') expect(failure.data.error.code).toBe('render_error');
  await expect(frame.getByTestId('publication-preview-body')).toBeVisible();
  expect((await previewMessages(page)).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  await expect(frame.locator('[data-preview-price-status="missing"]')).toContainText('Price not entered');
  await expect(frame.locator('[data-preview-price-status="missing"]')).toContainText('CNY');
  await expect(frame.locator('[data-preview-price-status="missing"]')).not.toContainText(/\$\s*0|Price on request/);
  await expect(frame.locator('h1')).toHaveText('Title not entered');
  await expect(frame.locator('[data-review-status="missing"]').first()).toBeVisible();
});

for (const [price, status, expected] of [
  ['zero', 'ready', /\$\s*0|USD\s*0|0\s*USD/],
  ['on_request', 'on_request', /Price on request/],
  ['unavailable', 'ready', /128,000/],
] as const) {
  test(`${price}: the preview shows the actual quote state`, async ({ page, context, request, baseURL }) => {
    await authorizePreview(context, baseURL!);
    await setPublicFixtureState(request, { previewPrice: price });
    await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, 'en');
    await waitForPreviewEvent(page, 'ready');
    const quote = frame.locator(`[data-preview-price-status="${status}"]`);
    await expect(quote).toContainText(expected);
    await expect(quote).not.toContainText('Price not entered');
    if (price === 'unavailable') await expect(quote).not.toContainText(/≈\s*0|\$\s*0/);
  });
}

for (const [mode, state, label] of [['machine', 'pending', 'Pending review'], ['stale', 'stale', 'Outdated text']] as const) {
  test(`${mode}: textual review facts are visible in the selected language`, async ({ page, context, request, baseURL }) => {
    await authorizePreview(context, baseURL!);
    await setPublicFixtureState(request, { previewMode: mode });
    await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, 'en');
    await waitForPreviewEvent(page, 'ready');
    const title = frame.locator('[data-preview-text="title"]');
    await expect(title).toContainText('Test vehicle');
    await expect(title.locator(`[data-review-status="${state}"]`)).toContainText(label);
    await expect(frame.locator('h1')).toHaveAttribute('lang', 'en');
    if (mode === 'machine') await expect(title).toContainText('Machine translated');
  });
}

test('a slow previous language cannot report readiness after a newer iframe instance renders', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewDelayMs: 1200, previewSlowLocale: 'en' });
  const transport = await installPreviewTransport(page, request);
  await openPreviewHost(page, 'en');
  await expect.poll(() => transport.reads.some((entry) => entry.locale === 'en')).toBe(true);
  await setPublicFixtureState(request, { previewVersion: 5, previewDelayMs: 0 });
  await page.locator('#publication-frame').evaluate((node, href) => { (node as HTMLIFrameElement).src = href; }, previewHref('ru', nextPreviewLoadId));
  const ready = await waitForPreviewEvent(page, 'ready', nextPreviewLoadId);
  if (ready.data.event === 'ready') expect(ready.data.preview).toEqual({ vehicleId: previewVehicleId, vehicleVersion: 5, publicContentRevision: 4, fingerprint: '5'.padStart(64, '0'), locale: 'ru' });
  await expect.poll(() => transport.reads.find((entry) => entry.locale === 'en')?.completed).toBe(true);
  const events = await previewMessages(page);
  expect(events.filter((entry) => entry.data.event === 'ready' && entry.data.loadId === previewLoadId)).toEqual([]);
  await expect(page.frameLocator('#publication-frame').getByTestId('publication-preview-body').locator('h1')).toHaveText('Тестовый автомобиль');
});

test('pagehide disposes the exact rendered instance without confirming or mutating the draft', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  const transport = await installPreviewTransport(page, request);
  await openPreviewHost(page, 'en');
  await waitForPreviewEvent(page, 'ready');
  await page.frameLocator('#publication-frame').locator('body').evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  const disposed = await waitForPreviewEvent(page, 'disposed');
  expect(disposed.data.vehicleId).toBe(previewVehicleId);
  expect(disposed.data.loadId).toBe(previewLoadId);
  await page.frameLocator('#publication-frame').locator('body').evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const events = await previewMessages(page);
  const disposedAt = events.findIndex((entry) => entry.data.event === 'disposed');
  expect(events.slice(disposedAt + 1).filter((entry) => ['ready', 'resize'].includes(entry.data.event))).toEqual([]);
  expect(transport.reads.every((entry) => entry.method === 'GET')).toBe(true);
});

async function settlePreviewPaint(page: Page) {
  await page.frameLocator('#publication-frame').locator('body').evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function expectTerminalImageFailure(page: Page, after = 0) {
  const failure = await waitForPreviewEvent(page, 'error', previewLoadId, after);
  if (failure.data.event === 'error') expect(failure.data.error.code).toBe('render_error');
  await expect(page.frameLocator('#publication-frame').getByTestId('publication-preview-body')).toBeVisible();
  const events = await previewMessages(page);
  const terminal = events.findIndex((entry, index) => index >= after && entry.data.event === 'error' && entry.data.loadId === previewLoadId);
  expect(terminal).toBeGreaterThanOrEqual(after);
  return terminal;
}

test('a received cover image cannot qualify the frame before its actual decode completes', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  const cover = holdPreviewMedia();
  const decode = await holdPreviewImageDecode(page, [previewCoverId]);
  const transport = await installPreviewTransport(page, request, { [previewCoverId]: cover });
  const frame = await openPreviewHost(page, 'en');
  await expect(frame.getByTestId('publication-preview-body')).toBeVisible();
  await expect.poll(() => transport.reads.some((entry) => entry.path.includes(`/media/${previewCoverId}/`))).toBe(true);
  expect((await previewMessages(page)).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  cover.release();
  await expect.poll(() => decode.calls(previewCoverId)).toBeGreaterThan(0);
  const active = frame.locator(`img[data-gallery-active-image="${previewCoverId}"]`);
  await expect.poll(() => active.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
  // A valid, downloaded image is still insufficient while its decode promise is pending.
  await settlePreviewPaint(page);
  expect((await previewMessages(page)).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  await decode.release(previewCoverId);
  await waitForPreviewEvent(page, 'ready');
});

for (const outcome of [401, 403, 500, 'abort', 'corrupt'] as const) {
  test(`cover ${outcome}: private image failure preserves the draft but never qualifies it`, async ({ page, context, request, baseURL }) => {
    await authorizePreview(context, baseURL!);
    const cover = holdPreviewMedia();
    cover.release(outcome);
    const transport = await installPreviewTransport(page, request, { [previewCoverId]: cover });
    const frame = await openPreviewHost(page, 'en');
    const terminal = await expectTerminalImageFailure(page);
    await settlePreviewPaint(page);
    const events = await previewMessages(page);
    expect(events.filter((entry) => entry.data.event === 'ready')).toEqual([]);
    expect(events.slice(terminal + 1).filter((entry) => ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
    await expect(frame.locator('h1')).toHaveText('Test vehicle');
    expect(await frame.locator('body').innerText()).not.toContain('PRIVATE_MEDIA_SENTINEL');
    expect(transport.publicReads).toEqual([]);
    const media = transport.reads.filter((entry) => entry.path.includes('/admin/media/'));
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((entry) => entry.cookie?.includes(`${previewStaffCookie}=authorized`))).toBe(true);
    expect(transport.reads.every((entry) => entry.method === 'GET')).toBe(true);
  });
}

test('offscreen gallery images do not all download or block the decoded cover receipt', async ({ page, context, request, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 12 });
  const lastImageId = '00000000-0000-4000-8000-00000000000e';
  const offscreen = holdPreviewMedia();
  const transport = await installPreviewTransport(page, request, { [lastImageId]: offscreen });
  try {
    const frame = await openPreviewHost(page, 'en');
    await waitForPreviewEvent(page, 'ready');
    await expect(frame.locator('[data-vehicle-thumbnails] a')).toHaveCount(12);
    await expect(frame.locator('[data-vehicle-gallery]')).toHaveAttribute('data-selected-image', previewCoverId);
    await settlePreviewPaint(page);
    const fetched = new Set(transport.reads.filter((entry) => entry.path.includes('/admin/media/')).map((entry) => entry.path));
    expect(fetched.size).toBeLessThan(12);
    expect([...fetched].some((path) => path.includes(lastImageId))).toBe(false);
  } finally { offscreen.release(); }
});

test('changing the current image clears the receipt until the selected image decodes', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 2 });
  const second = holdPreviewMedia();
  const decode = await holdPreviewImageDecode(page, [previewSecondImageId]);
  await installPreviewTransport(page, request, { [previewSecondImageId]: second });
  const frame = await openPreviewHost(page, 'en');
  const firstReady = await waitForPreviewEvent(page, 'ready');
  const after = (await previewMessages(page)).length;
  await frame.locator('[data-vehicle-thumbnails] a').nth(1).click();
  await waitForPreviewEvent(page, 'loading', previewLoadId, after);
  await expect(frame.locator('[data-vehicle-gallery]')).toHaveAttribute('data-selected-image', previewSecondImageId);
  expect((await previewMessages(page)).slice(after).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  second.release();
  await expect.poll(() => decode.calls(previewSecondImageId)).toBeGreaterThan(0);
  await settlePreviewPaint(page);
  expect((await previewMessages(page)).slice(after).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  await decode.release(previewSecondImageId);
  const selectedReady = await waitForPreviewEvent(page, 'ready', previewLoadId, after);
  expect(selectedReady.data).toEqual(firstReady.data);
  const changeEvents = (await previewMessages(page)).slice(after);
  expect(changeEvents.findIndex((entry) => entry.data.event === 'loading')).toBeLessThan(changeEvents.findIndex((entry) => entry.data.event === 'ready'));
});

test('a failed selected image rejects old cover load events and needs a new loadId to recover', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 2 });
  const second = holdPreviewMedia();
  const controls: PreviewMediaControls = { [previewSecondImageId]: second };
  await installPreviewTransport(page, request, controls);
  const frame = await openPreviewHost(page, 'en');
  await waitForPreviewEvent(page, 'ready');
  const oldCover = await frame.locator(`img[data-gallery-active-image="${previewCoverId}"]`).elementHandle();
  expect(oldCover).not.toBeNull();
  const after = (await previewMessages(page)).length;
  await frame.locator('[data-vehicle-thumbnails] a').nth(1).click();
  await waitForPreviewEvent(page, 'loading', previewLoadId, after);
  second.release(500);
  const terminal = await expectTerminalImageFailure(page, after);
  await oldCover!.dispatchEvent('load');
  const coverThumbnail = frame.locator('[data-vehicle-thumbnails] a').first();
  await expect(coverThumbnail).toHaveAttribute('aria-disabled', 'true');
  await coverThumbnail.dispatchEvent('click');
  await settlePreviewPaint(page);
  expect((await previewMessages(page)).slice(terminal + 1).filter((entry) => ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
  delete controls[previewSecondImageId];
  await page.locator('#publication-frame').evaluate((node, href) => { (node as HTMLIFrameElement).src = href; }, previewHref('en', nextPreviewLoadId));
  const recovered = await waitForPreviewEvent(page, 'ready', nextPreviewLoadId);
  expect(recovered.data.loadId).not.toBe(previewLoadId);
  expect((await previewMessages(page)).slice(terminal + 1).filter((entry) => entry.data.loadId === previewLoadId && ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
});

test('an obsolete successful decode cannot revive a frame after another selected image fails', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 3 });
  const third = holdPreviewMedia();
  third.release('corrupt');
  const decode = await holdPreviewImageDecode(page, [previewSecondImageId]);
  await installPreviewTransport(page, request, { [previewThirdImageId]: third });
  const frame = await openPreviewHost(page, 'en');
  await waitForPreviewEvent(page, 'ready');
  const after = (await previewMessages(page)).length;
  await frame.locator('[data-vehicle-thumbnails] a').nth(1).click();
  await waitForPreviewEvent(page, 'loading', previewLoadId, after);
  await expect.poll(() => decode.calls(previewSecondImageId)).toBeGreaterThan(0);
  await frame.locator('[data-vehicle-thumbnails] a').nth(2).click();
  const terminal = await expectTerminalImageFailure(page, after);
  await decode.release(previewSecondImageId);
  await settlePreviewPaint(page);
  expect((await previewMessages(page)).slice(terminal + 1).filter((entry) => ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
});

test('opening the viewer while the same selected main image is decoding starts a distinct visible-image wait', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 2 });
  const decode = await holdPreviewImageDecode(page, [previewSecondImageId]);
  await installPreviewTransport(page, request);
  const frame = await openPreviewHost(page, 'en');
  await waitForPreviewEvent(page, 'ready');
  const selectedAfter = (await previewMessages(page)).length;
  await frame.locator('[data-vehicle-thumbnails] a').nth(1).click();
  await waitForPreviewEvent(page, 'loading', previewLoadId, selectedAfter);
  await expect.poll(() => decode.calls(previewSecondImageId)).toBeGreaterThan(0);
  const mainDecodes = await decode.calls(previewSecondImageId);
  // Capture this pending main-image decode before arming an independent viewer decode.
  const releaseOldMain = await frame.locator('body').evaluateHandle((_node, mediaId) => {
    const gates = Reflect.get(window, '__publicationDecodeGates') as Map<string, { release(): void }> | undefined;
    const release = gates?.get(mediaId)?.release;
    if (typeof release !== 'function') throw new Error('The pending main-image decode gate is missing.');
    return release;
  }, previewSecondImageId);
  await decode.arm(previewSecondImageId);
  const viewerAfter = (await previewMessages(page)).length;
  await frame.locator('[data-vehicle-photo-opener]').click();
  await expect(frame.locator('dialog[open]')).toBeVisible();
  await waitForPreviewEvent(page, 'loading', previewLoadId, viewerAfter);
  await expect.poll(() => decode.calls(previewSecondImageId)).toBeGreaterThan(mainDecodes);
  await expect(frame.locator(`dialog[open] img[data-gallery-active-image="${previewSecondImageId}"]`)).toBeVisible();
  expect((await previewMessages(page)).slice(selectedAfter).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  await releaseOldMain.evaluate((release) => release());
  await settlePreviewPaint(page);
  expect((await previewMessages(page)).slice(viewerAfter).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  await decode.release(previewSecondImageId);
  await waitForPreviewEvent(page, 'ready', previewLoadId, viewerAfter);
  await settlePreviewPaint(page);
  expect((await previewMessages(page)).slice(selectedAfter).filter((entry) => entry.data.event === 'ready')).toHaveLength(1);
  await expect(frame.locator(`img[data-gallery-active-image="${previewSecondImageId}"]`)).toHaveCount(1);
  await releaseOldMain.dispose();
});

for (const outcome of ['ready', 'decode_failure'] as const) {
  test(`fullscreen ${outcome}: the visible viewer needs its own decode receipt`, async ({ page, context, request, baseURL }) => {
    await authorizePreview(context, baseURL!);
    const decode = await holdPreviewImageDecode(page, [previewCoverId]);
    await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, 'en');
    await expect.poll(() => decode.calls(previewCoverId)).toBeGreaterThan(0);
    await decode.release(previewCoverId);
    await waitForPreviewEvent(page, 'ready');
    const previousDecodes = await decode.calls(previewCoverId);
    await decode.arm(previewCoverId);
    const after = (await previewMessages(page)).length;
    await frame.locator('[data-vehicle-photo-opener]').click();
    await expect(frame.locator('dialog[open]')).toBeVisible();
    await waitForPreviewEvent(page, 'loading', previewLoadId, after);
    await expect.poll(() => decode.calls(previewCoverId)).toBeGreaterThan(previousDecodes);
    await expect(frame.locator(`dialog[open] img[data-gallery-active-image="${previewCoverId}"]`)).toBeVisible();
    await expect(frame.locator(`img[data-gallery-active-image="${previewCoverId}"]`)).toHaveCount(1);
    await settlePreviewPaint(page);
    expect((await previewMessages(page)).slice(after).filter((entry) => entry.data.event === 'ready')).toEqual([]);
    if (outcome === 'ready') {
      await decode.release(previewCoverId);
      await waitForPreviewEvent(page, 'ready', previewLoadId, after);
    } else {
      await decode.fail(previewCoverId);
      const terminal = await expectTerminalImageFailure(page, after);
      // Closing the failed viewer must not reuse the decoded image behind it to requalify.
      await frame.locator('dialog[open]').press('Escape');
      await expect(frame.locator('dialog[open]')).toHaveCount(0);
      await settlePreviewPaint(page);
      expect((await previewMessages(page)).slice(terminal + 1).filter((entry) => ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
    }
  });
}

test('the undecoded initial cover cannot be skipped through thumbnails or keyboard before its deadline', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 2 });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const cover = holdPreviewMedia();
  const transport = await installPreviewTransport(page, request, { [previewCoverId]: cover });
  const frame = await openPreviewHost(page, 'en');
  await expect(frame.getByTestId('publication-preview-body')).toBeVisible();
  const gallery = frame.locator('[data-vehicle-gallery]');
  await expect.poll(() => transport.reads.some((entry) => entry.path.includes(`/media/${previewCoverId}/`))).toBe(true);
  const secondThumbnail = frame.locator('[data-vehicle-thumbnails] a').nth(1);
  await expect(secondThumbnail).toHaveAttribute('aria-disabled', 'true');
  await secondThumbnail.dispatchEvent('click');
  await expect(gallery).toHaveAttribute('data-selected-image', previewCoverId);
  await secondThumbnail.focus();
  await secondThumbnail.press('ArrowRight');
  await expect(gallery).toHaveAttribute('data-selected-image', previewCoverId);
  expect((await previewMessages(page)).filter((entry) => entry.data.event === 'ready')).toEqual([]);
  await page.clock.fastForward(14_999);
  expect((await previewMessages(page)).filter((entry) => ['ready', 'error'].includes(entry.data.event))).toEqual([]);
  await page.clock.fastForward(2);
  const terminal = await expectTerminalImageFailure(page);
  cover.release();
  await expect.poll(() => {
    const reads = transport.reads.filter((entry) => entry.path.includes(`/media/${previewCoverId}/`));
    return reads.length > 0 && reads.every((entry) => entry.completed);
  }).toBe(true);
  await page.clock.runFor(100);
  expect((await previewMessages(page)).slice(terminal + 1).filter((entry) => ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
});

test('the current-image 15 second deadline is terminal even when delayed bytes later arrive', async ({ page, context, request, baseURL }) => {
  await authorizePreview(context, baseURL!);
  await setPublicFixtureState(request, { previewImageCount: 2 });
  await page.clock.install();
  const second = holdPreviewMedia();
  const transport = await installPreviewTransport(page, request, { [previewSecondImageId]: second });
  const frame = await openPreviewHost(page, 'en');
  await waitForPreviewEvent(page, 'ready');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const after = (await previewMessages(page)).length;
  await frame.locator('[data-vehicle-thumbnails] a').nth(1).click();
  await waitForPreviewEvent(page, 'loading', previewLoadId, after);
  await page.clock.fastForward(14_999);
  expect((await previewMessages(page)).slice(after).filter((entry) => ['ready', 'error'].includes(entry.data.event))).toEqual([]);
  await page.clock.fastForward(2);
  const terminal = await expectTerminalImageFailure(page, after);
  second.release();
  await expect.poll(() => {
    const reads = transport.reads.filter((entry) => entry.path.includes(`/media/${previewSecondImageId}/`));
    return reads.length > 0 && reads.every((entry) => entry.completed);
  }).toBe(true);
  await page.clock.runFor(100);
  expect((await previewMessages(page)).slice(terminal + 1).filter((entry) => ['ready', 'loading'].includes(entry.data.event))).toEqual([]);
});
