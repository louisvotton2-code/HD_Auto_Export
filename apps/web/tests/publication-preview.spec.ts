import { expect, test } from '@playwright/test';
import { makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
import {
  authorizePreview, installPreviewTransport, nextPreviewLoadId, openPreviewHost,
  previewHref, previewLoadId, previewMessages, previewStaffCookie, previewVehicleId, waitForPreviewEvent,
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
  await waitForPreviewEvent(page, 'ready');
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
