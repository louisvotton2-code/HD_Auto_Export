import { expect, test, type Locator } from '@playwright/test';
import { externalFixtureId, makeConfigurationDisplayFixture } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
import { authorizePreview, installPreviewTransport, openPreviewHost, previewMessages, waitForPreviewEvent } from './helpers/publication-preview';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the health-marked isolated fixture.');
test.beforeEach(async ({ request }) => { await resetPublicFixture(request); });
test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

const inspectionTitles = { zh: '车辆检测报告', en: 'Vehicle inspection report', ru: 'Отчёт об осмотре автомобиля' };
const openReport = { zh: '查看检测报告', en: 'View inspection report', ru: 'Посмотреть отчёт об осмотре' };
async function configurationFields(configuration: Locator) {
  return configuration.locator('[data-configuration-field]').evaluateAll((nodes) => nodes.map((node) => ({
    field: node.getAttribute('data-configuration-field'), text: node.textContent, lang: node.getAttribute('lang'),
  })));
}

for (const [locale, width] of [['zh', 1440], ['en', 390], ['ru', 320]] as const) {
  test(`${locale}: public detail and private preview share configuration, retaining units and language at ${width}px`, async ({ page, context, request, baseURL }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setPublicFixtureState(request, { importedPublished: true, configurationMode: 'ready', historyScenario: 'structured-zero', inspectionMode: 'structured', reportPresenceMode: 'known' });
    const image = await (await request.get('/api/v1/media/media_fixture_car_2/')).body();
    await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    await page.goto(`/${locale}/cars/${externalFixtureId(1)}/`);
    const configuration = page.locator('main [data-vehicle-configuration]');
    await expect(configuration).toBeVisible();
    await expect(configuration.locator('details').first()).toHaveAttribute('open', '');
    const fixture = makeConfigurationDisplayFixture(locale);
    const publicFields = await configurationFields(configuration);
    expect(publicFields).toEqual(fixture.items.flatMap((item) => [
      { field: 'name', text: item.name.text, lang: item.name.contentLocale },
      { field: 'value', text: item.value.text, lang: item.value.contentLocale },
    ]));
    await expect(page.locator('[data-vehicle-history] [data-history-kind]')).toHaveCount(1);
    await expect(page.locator('[data-history-kind="transfers"] dd')).toHaveText('0');
    const inspection = page.getByRole('region', { name: inspectionTitles[locale], exact: true });
    await expect(inspection).toBeVisible();
    await expect(inspection).toHaveAttribute('data-report-status', 'unread');
    await expect(inspection.locator('[data-public-inspection-item]')).toHaveCount(0);
    await inspection.getByRole('button', { name: openReport[locale], exact: true }).click();
    await expect(inspection).toHaveAttribute('data-report-status', 'available');
    await expect(inspection.locator('[data-public-inspection-item]').first()).toBeVisible();
    await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
    // A checked part and its defect count must never become historical accident events.
    await expect(page.locator('[data-history-kind="accidents"]')).toHaveCount(0);
    await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await authorizePreview(context, baseURL!);
    const transport = await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, locale);
    const privateConfiguration = frame.locator('[data-vehicle-configuration]');
    await expect(privateConfiguration).toBeVisible();
    expect(await configurationFields(privateConfiguration)).toEqual(publicFields);
    const ready = await waitForPreviewEvent(page, 'ready');
    expect(ready.bodyRendered).toBe(true);
    expect(transport.publicReads).toEqual([]);
    expect(transport.reads.every((read) => read.method === 'GET')).toBe(true);
    expect(await frame.getByTestId('publication-preview-body').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(JSON.stringify(await previewMessages(page))).not.toContain(fixture.items[0].name.text);
  });
}

for (const mode of ['fallback', 'missing', 'long'] as const) {
  test(`${mode}: configuration does not invent missing values or change actual language and units`, async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await setPublicFixtureState(request, { configurationMode: mode });
    await page.goto('/ru/cars/fixture_car_1/');
    const configuration = page.locator('[data-vehicle-configuration]');
    await expect(configuration).toBeVisible();
    const fields = await configurationFields(configuration);
    if (mode === 'fallback') {
      expect(fields[0]).toMatchObject({ text: '排量(cc)', lang: 'zh' });
      expect(fields[1]).toMatchObject({ text: '1989 cm³ / 8 AT', lang: 'und' });
    } else if (mode === 'missing') {
      expect(fields.filter((field) => field.field === 'value').at(-1)?.text).not.toMatch(/^0$/);
      expect(fields.filter((field) => field.field === 'value').at(-1)?.text).not.toBe('8');
    } else {
      expect(fields[1].text).toHaveLength(500);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('a vehicle without configuration does not create a blank configuration card', async ({ page }) => {
  await page.goto('/en/cars/fixture_car_1/');
  await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
  await expect(page.locator('[data-vehicle-configuration]')).toHaveCount(0);
});

for (const locale of ['zh', 'en', 'ru'] as const) {
  for (const [presence, inspectionMode] of [['known', 'empty'], ['known', 'structured'], ['false', 'structured'], ['absent', 'structured']] as const) {
    test(`${locale}: ${presence}/${inspectionMode} reports use the bounded public projection without a sales-contact gate`, async ({ page, request }) => {
      await setPublicFixtureState(request, { importedPublished: true, inspectionMode, reportPresenceMode: presence });
      await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
      const id = externalFixtureId(1);
      const api = await request.get(`/api/v1/vehicles/${id}/inspection/?locale=${locale}&limit=50`);
      expect(api.status()).toBe(200);
      const body = await api.json();
      expect(['available', 'no_report', 'unavailable', 'pending']).toContain(body.data.status);
      expect(body.data.items.length).toBeLessThanOrEqual(50);
      expect(JSON.stringify(body)).not.toMatch(/reports\.example\.invalid|PRIVATE_SELLER_SENTINEL|PRIVATE_RAW_MARKER/);
      const response = await page.goto(`/${locale}/cars/${id}/`);
      expect(await response!.text()).not.toContain('reports.example.invalid');
      const section = page.locator('[data-public-vehicle-inspection]');
      await expect(section).toHaveAttribute('data-report-status', 'unread');
      await section.getByRole('button', { name: openReport[locale], exact: true }).click();
      await expect(section).toHaveAttribute('data-report-status', body.data.status);
      await expect(section.locator('[data-public-inspection-item]')).toHaveCount(body.data.status === 'available' ? body.data.items.filter((item: { name: { status: string } }) => item.name.status === 'ready').length : 0);
      await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
      await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
    });
  }
}

test('a staff vehicle uses the report endpoint without requiring an external listing', async ({ page, request }) => {
  await setPublicFixtureState(request, { reportPresenceMode: 'known' });
  await page.goto('/en/cars/fixture_car_1/');
  const inspection = page.locator('[data-public-vehicle-inspection]');
  await inspection.getByRole('button', { name: openReport.en, exact: true }).click();
  await expect(inspection).toHaveAttribute('data-report-status', 'available');
  await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
  await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
});

for (const [scenario, count] of [['structured-null', null], ['structured-two', '2']] as const) {
  test(`${scenario}: explicit ownership data supersedes stale generic entries`, async ({ page, request }) => {
    await setPublicFixtureState(request, { importedPublished: true, historyScenario: scenario });
    await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
    await page.goto(`/en/cars/${externalFixtureId(1)}/`);
    if (count === null) await expect(page.locator('[data-vehicle-history]')).toHaveCount(0);
    else await expect(page.locator('[data-history-kind="transfers"] dd')).toHaveText(count);
  });
}

for (const mode of ['wrong_name_locale', 'wrong_value_locale'] as const) {
  test(`${mode}: private configuration outside the requested locale cannot become ready`, async ({ page, context, request, baseURL }) => {
    await setPublicFixtureState(request, { configurationMode: mode });
    await authorizePreview(context, baseURL!);
    await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, 'en');
    const failure = await waitForPreviewEvent(page, 'error');
    if (failure.data.event === 'error') expect(failure.data.error.code).toBe('invalid_response');
    await expect(frame.getByTestId('publication-preview-body')).toHaveCount(0);
    expect((await previewMessages(page)).some((event) => event.data.event === 'ready')).toBe(false);
  });
}

for (const [locale, width] of [['zh', 1440], ['en', 390], ['ru', 320]] as const) {
  test(`${locale}: without JavaScript initial parameters stay readable and report loading explains its requirement`, async ({ browser, request, baseURL }) => {
    await setPublicFixtureState(request, { importedPublished: true, configurationMode: 'ready', inspectionMode: 'large', reportPresenceMode: 'known' });
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
      await page.goto(`/${locale}/cars/${externalFixtureId(1)}/`);
      await expect(page.locator('[data-vehicle-configuration]')).toContainText('1989');
      const inspection = page.getByRole('region', { name: inspectionTitles[locale], exact: true });
      await expect(inspection).toBeVisible();
      await expect(inspection.locator('[data-public-inspection-item]')).toHaveCount(0);
      await expect(inspection.locator('button')).toHaveCount(0);
      await expect(inspection.getByText(/JavaScript/)).toBeVisible();
      await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
      const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
      expect(events.requests.filter((event: { path: string }) => /\/(inspection|configuration)$/.test(event.path))).toHaveLength(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally { await context.close(); }
  });
}

test('large inspection content loads only a bounded requested page', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', reportPresenceMode: 'known' });
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
  await page.goto(`/en/cars/${externalFixtureId(1)}/`);
  const inspection = page.getByRole('region', { name: inspectionTitles.en, exact: true });
  await expect(inspection.locator('[data-public-inspection-item]')).toHaveCount(0);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/inspection/'));
  await inspection.getByRole('button', { name: openReport.en, exact: true }).click();
  const body = await (await loaded).json();
  expect(body.data.items.length).toBeGreaterThan(0);
  expect(body.data.items.length).toBeLessThanOrEqual(50);
  await expect(inspection.locator('[data-public-inspection-item]')).toHaveCount(body.data.items.filter((item: { name: { status: string } }) => item.name.status === 'ready').length);
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  expect(events.requests.filter((event: { path: string }) => event.path.endsWith('/inspection'))).toHaveLength(1);
});
