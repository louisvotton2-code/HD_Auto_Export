import { expectInlineInspection } from './helpers/inline-inspection';
import { expect, test, type Locator } from '@playwright/test';
import { externalFixtureId, makeConfigurationDisplayFixture } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
import { authorizePreview, installPreviewTransport, openPreviewHost, previewMessages, waitForPreviewEvent } from './helpers/publication-preview';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the health-marked isolated fixture.');
test.beforeEach(async ({ request }) => { await resetPublicFixture(request); });
test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

const inspectionTitles = { zh: '车辆检测摘要', en: 'Vehicle inspection summary', ru: 'Результаты осмотра автомобиля' };
const configurationTitles = { zh: '车辆参数与配置', en: 'Vehicle parameters and equipment', ru: 'Характеристики и комплектация' };
async function configurationFields(configuration: Locator) {
  return configuration.locator('[data-configuration-field]').evaluateAll((nodes) => nodes.map((node) => ({
    field: node.getAttribute('data-configuration-field'), text: node.textContent, lang: node.getAttribute('lang'),
  })));
}

async function expandPublicConfiguration(configuration: Locator) {
  const disclosure = configuration.locator(':scope > details');
  const firstValue = configuration.locator('[data-configuration-field="value"]').first();
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(firstValue).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(firstValue).toBeVisible();
}

for (const [locale, width] of [['zh', 1440], ['en', 390], ['ru', 320]] as const) {
  test(`${locale}: supplier configuration stays below while staff preview can promote an explicit value at ${width}px`, async ({ page, context, request, baseURL }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setPublicFixtureState(request, { importedPublished: true, configurationMode: 'ready', historyScenario: 'structured-zero', inspectionMode: 'structured', reportPresenceMode: 'known' });
    const image = await (await request.get('/api/v1/media/media_fixture_car_2/')).body();
    await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    await page.goto(`/${locale}/cars/${externalFixtureId(1)}/`);
    const configuration = page.locator('main [data-vehicle-parameters]');
    await expect(configuration).toBeVisible();
    await expect(configuration.locator('[data-equipment-group]')).toHaveCount(0);
    await expect(configuration.getByText(configurationTitles[locale], { exact: true })).toBeVisible();
    await expandPublicConfiguration(configuration);
    const fixture = makeConfigurationDisplayFixture(locale);
    const displacement = `${new Intl.NumberFormat(locale).format(1989)} cm³`;
    await expect(page.locator('[data-vehicle-fact="displacementCc"]')).toHaveCount(0);
    const publicFields = await configurationFields(configuration);
    expect(publicFields).toEqual(fixture.items.flatMap((item) => [
      { field: 'name', text: item.name.text, lang: item.name.contentLocale },
      { field: 'value', text: item.value.text, lang: item.value.contentLocale },
    ]));
    await expect(page.locator('[data-vehicle-history] [data-history-kind]')).toHaveCount(1);
    await expect(page.locator('[data-history-kind="transfers"] dd')).toHaveText('0');
    const inspection = page.getByRole('region', { name: inspectionTitles[locale], exact: true });
    await expect(inspection).toBeVisible();
    await expect(inspection).toHaveAttribute('data-inspection-status', 'available');
    await expect(page.locator('[data-public-inspection-item]')).toHaveCount(0);
    await expectInlineInspection(inspection);
    await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
    const detailEvents = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
    expect(detailEvents.requests.filter((event: { path: string }) => /\/inspection\/?$/.test(event.path))).toHaveLength(0);
    // A checked part and its defect count must never become historical accident events.
    await expect(page.locator('[data-history-kind="accidents"]')).toHaveCount(0);
    await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await authorizePreview(context, baseURL!);
    const transport = await installPreviewTransport(page, request);
    const frame = await openPreviewHost(page, locale);
    const privateConfiguration = frame.locator('[data-vehicle-parameters]');
    await expect(privateConfiguration).toBeVisible();
    await expect(privateConfiguration.getByText(configurationTitles[locale], { exact: true })).toBeVisible();
    await expect(privateConfiguration.locator(':scope > details')).toHaveAttribute('open', '');
    await expect(privateConfiguration.locator('[data-configuration-field="value"]').first()).toBeVisible();
    expect(await configurationFields(privateConfiguration)).toEqual(publicFields.slice(2));
    const privateFact = frame.locator('[data-vehicle-fact="displacementCc"]');
    await expect(privateFact.locator('dd > span').first()).toHaveText(displacement);
    await expect(privateFact.locator('[data-configuration-metadata]')).toHaveCount(2);
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
    const configuration = page.locator('[data-vehicle-parameters]');
    await expect(configuration).toBeVisible();
    await expandPublicConfiguration(configuration);
    const fields = await configurationFields(configuration);
    if (mode === 'fallback') {
      expect(fields[0]).toMatchObject({ text: '排量(cc)', lang: 'zh' });
      expect(fields[1]).toMatchObject({ text: '1989 cm³ / 8 AT', lang: 'und' });
    } else if (mode === 'missing') {
      await expect(configuration.locator('[data-configuration-item]')).toHaveCount(1);
      expect(fields.filter((field) => field.field === 'value')).toEqual([{ field: 'value', text: '1989', lang: 'und' }]);
    } else {
      expect(fields[1].text).toHaveLength(500);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('a vehicle without configuration does not create a blank configuration card', async ({ page }) => {
  await page.goto('/en/cars/fixture_car_1/');
  await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
  await expect(page.locator('[data-vehicle-parameters]')).toHaveCount(0);
});

for (const locale of ['zh', 'en', 'ru'] as const) {
  for (const [presence, inspectionMode] of [['known', 'empty'], ['known', 'structured'], ['false', 'structured'], ['absent', 'structured']] as const) {
    test(`${locale}: ${presence}/${inspectionMode} detail uses its report summary without probing inspection`, async ({ page, request }) => {
      await setPublicFixtureState(request, { importedPublished: true, inspectionMode, reportPresenceMode: presence });
      await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
      const id = externalFixtureId(1);
      const api = await request.get(`/api/v1/vehicles/${id}/?locale=${locale}&view=localized`);
      expect(api.status()).toBe(200);
      const body = await api.json();
      const status = body.data.inspectionSummary?.status ?? 'unknown';
      expect(['available', 'no_report', 'unavailable', 'pending', 'unknown']).toContain(status);
      expect(body.data.external.detail.inspection).toBeNull();
      if (presence === 'false' && inspectionMode === 'structured') expect(status).toBe('available');
      expect(JSON.stringify(body)).not.toMatch(/reports\.example\.invalid|PRIVATE_SELLER_SENTINEL|PRIVATE_RAW_MARKER/);
      await page.goto(`/${locale}/cars/${id}/`);
      if (status === 'available') {
        const section = page.locator('[data-inspection-summary]');
        await expect(section).toHaveAttribute('data-inspection-status', status);
        await expectInlineInspection(section);
      } else {
        await expect(page.locator('[data-inspection-summary]')).toHaveCount(0);
        await expect(page.locator('[data-inspection-service]')).toHaveAttribute('data-inspection-status', status);
        await expect(page.locator('[data-public-inspection-link]')).toHaveCount(0);
        await expect(page.locator('main a[href^="#vehicle-public-inspection-"]')).toHaveCount(0);
      }
      await expect(page.locator('[data-public-inspection-item]')).toHaveCount(0);
      await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
      await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
      const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
      expect(events.requests.filter((event: { path: string }) => /\/inspection\/?$/.test(event.path))).toHaveLength(0);
    });
  }
}

test('a staff vehicle uses only its same-response report summary', async ({ page, request }) => {
  await setPublicFixtureState(request, { reportPresenceMode: 'known' });
  await page.goto('/en/cars/fixture_car_1/');
  const inspection = page.locator('[data-inspection-summary]');
  await expect(inspection).toHaveAttribute('data-inspection-status', 'available');
  await expectInlineInspection(inspection);
  await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
  await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  expect(events.requests.filter((event: { path: string }) => /\/inspection\/?$/.test(event.path))).toHaveLength(0);
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
  test(`${locale}: without JavaScript initial parameters and same-response report summary stay readable`, async ({ browser, request, baseURL }) => {
    await setPublicFixtureState(request, { importedPublished: true, configurationMode: 'ready', inspectionMode: 'large', reportPresenceMode: 'known' });
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
      await page.goto(`/${locale}/cars/${externalFixtureId(1)}/`);
      const configuration = page.locator('[data-vehicle-parameters]');
      await expandPublicConfiguration(configuration);
      await expect(page.locator('[data-vehicle-fact="displacementCc"]')).toHaveCount(0);
      await expect(configuration.locator('[data-configuration-field="value"][lang="und"]').first()).toHaveText('1989');
      const inspection = page.getByRole('region', { name: inspectionTitles[locale], exact: true });
      await expect(inspection).toBeVisible();
      await expect(inspection.locator('[data-public-inspection-item]')).toHaveCount(0);
      await expect(inspection.locator('button')).toHaveCount(0);
      await expectInlineInspection(inspection);
      await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
      const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
      expect(events.requests.filter((event: { path: string }) => /\/(inspection|configuration)$/.test(event.path))).toHaveLength(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally { await context.close(); }
  });
}

test('large stored inspection content leaves only its summary in detail and performs no report read', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', reportPresenceMode: 'known' });
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
  await page.goto(`/en/cars/${externalFixtureId(1)}/`);
  const inspection = page.getByRole('region', { name: inspectionTitles.en, exact: true });
  await expect(inspection).toBeVisible();
  await expect(inspection).toHaveAttribute('data-inspection-status', 'available');
  await expect(page.locator('[data-public-inspection-item]')).toHaveCount(0);
  await expect(inspection.locator('button')).toHaveCount(0);
  await expectInlineInspection(inspection);
  await expect(page.locator('main')).not.toContainText('Inspection summary 1');
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  expect(events.requests.filter((event: { path: string }) => /\/inspection\/?$/.test(event.path))).toHaveLength(0);
});
