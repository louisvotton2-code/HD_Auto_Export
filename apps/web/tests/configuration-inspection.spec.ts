import { expect, test, type Locator } from '@playwright/test';
import { externalFixtureId, makeConfigurationDisplayFixture } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
import { authorizePreview, installPreviewTransport, openPreviewHost, previewMessages, waitForPreviewEvent } from './helpers/publication-preview';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the health-marked isolated fixture.');
test.beforeEach(async ({ request }) => { await resetPublicFixture(request); });
test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

const inspectionTitles = { zh: '车辆检测信息', en: 'Vehicle inspection details', ru: 'Данные осмотра автомобиля' };
const reportNotices = {
  zh: '详细报告请联系销售人员获取',
  en: 'Contact our sales team for the detailed report',
  ru: 'Для получения подробного отчёта свяжитесь с отделом продаж',
};
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
    await expect(inspection).toContainText('Body inspection');
    const checkCategory = inspection.locator('[data-inspection-check-category]').first();
    await expect(checkCategory.locator('details').first()).not.toHaveAttribute('open');
    await expect(inspection.locator('[data-inspection-check-item]')).toHaveCount(0);
    await checkCategory.locator('[data-inspection-section="check-category"] > summary').click();
    const group = checkCategory.locator('[data-inspection-check-group]').first();
    await group.locator('[data-inspection-section="check-group"] > summary').click();
    await expect(group.locator('[data-inspection-check-item]')).toHaveCount(2);
    await expect(group.locator('[data-inspection-ok="false"]')).toBeVisible();
    await expect(group.locator('[data-inspection-ok="unknown"]')).toBeVisible();
    await expect(group).toContainText('Surface scratch observed');
    const defectCategory = inspection.locator('[data-inspection-defect-category]').first();
    await defectCategory.locator('[data-inspection-section="defect-category"] > summary').click();
    await expect(defectCategory.locator('[data-inspection-defect-item]')).toHaveCount(1);
    await defectCategory.locator('[data-inspection-section="defect-details"] > summary').click();
    await expect(defectCategory).toContainText(locale === 'zh' ? '表面划痕说明' : 'Synthetic surface scratch description');
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
    test(`${locale}: ${presence}/${inspectionMode} reports offer sales contact solely from the published existence fact`, async ({ page, request }) => {
      await setPublicFixtureState(request, { importedPublished: true, inspectionMode, reportPresenceMode: presence });
      await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
      const id = externalFixtureId(1);
      const api = await request.get(`/api/v1/vehicles/${id}/?locale=${locale}&view=localized`);
      expect(api.status()).toBe(200);
      const body = await api.json();
      expect(body.data.report?.hasReport).toBe(presence === 'known' ? true : presence === 'false' ? false : undefined);
      expect(JSON.stringify(body)).not.toContain('reports.example.invalid');
      expect(body.data.external.detail.inspection.reportUrl).toBeNull();
      if (inspectionMode === 'structured') expect(body.data.external.detail.inspection.reportAccess?.status).not.toBe('available');
      const response = await page.goto(`/${locale}/cars/${id}/`);
      expect(await response!.text()).not.toContain('reports.example.invalid');
      const notice = page.locator('[data-vehicle-report-request]');
      if (presence === 'known') {
        await expect(notice.getByRole('heading', { name: reportNotices[locale], exact: true })).toBeVisible();
        const contacts = notice.locator('[data-vehicle-report-contacts] a');
        await expect(contacts).toHaveCount(2);
        for (const link of await contacts.all()) {
          const url = new URL((await link.getAttribute('href'))!);
          expect(['https://t.me/HD_Auto_CN', 'https://wa.me/8618215932610']).toContain(url.origin + url.pathname);
          expect(url.searchParams.get('text')).toContain('EXT-000001');
          expect(url.searchParams.get('text')).toContain(`/${locale}/cars/${id}/`);
        }
      } else await expect(notice).toHaveCount(0);
      await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
      if (inspectionMode === 'structured') await expect(page.getByRole('region', { name: inspectionTitles[locale], exact: true })).toBeVisible();
    });
  }
}

test('a bound staff vehicle can offer the report enquiry without external inspection content', async ({ page, request }) => {
  await setPublicFixtureState(request, { reportPresenceMode: 'known' });
  await page.goto('/en/cars/fixture_car_1/');
  await expect(page.locator('[data-vehicle-report-request]')).toContainText(reportNotices.en);
  await expect(page.getByRole('region', { name: inspectionTitles.en, exact: true })).toHaveCount(0);
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
  test(`${locale}: without JavaScript the bounded inspection summary stays readable and deeper content explains its requirement`, async ({ browser, request, baseURL }) => {
    await setPublicFixtureState(request, { importedPublished: true, configurationMode: 'ready', inspectionMode: 'large', reportPresenceMode: 'known' });
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
      await page.goto(`/${locale}/cars/${externalFixtureId(1)}/`);
      await expect(page.locator('[data-vehicle-configuration]')).toContainText('1989');
      await expect(page.locator('[data-vehicle-report-request]')).toContainText(reportNotices[locale]);
      const inspection = page.getByRole('region', { name: inspectionTitles[locale], exact: true });
      await expect(inspection).toBeVisible();
      await expect(inspection).toContainText('Inspection summary 1');
      await expect(inspection.locator('[data-inspection-check-category]')).toHaveCount(6);
      await expect(inspection.locator('button')).toHaveCount(0);
      const category = inspection.locator('[data-inspection-check-category]').first();
      await category.locator('summary').click();
      await expect(category.getByText(/JavaScript/)).toBeVisible();
      await expect(inspection.locator('[data-inspection-check-item]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await setPublicFixtureState(request, { inspectionMode: 'legacy-large' });
      await page.reload();
      await expect(inspection.locator('[data-inspection-check-category]')).toHaveCount(0);
      await expect(inspection).toContainText('Inspection summary 6');
      await expect(inspection).not.toContainText('Inspection summary 7');
      await expect(inspection.getByText(/JavaScript/)).toBeVisible();
      await expect(inspection.getByText(/JavaScript/)).toContainText('(2)');
      await expect(inspection.locator('button')).toHaveCount(0);
    } finally { await context.close(); }
  });
}

test('large inspection content expands in bounded category and item batches', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large' });
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
  await page.goto(`/en/cars/${externalFixtureId(1)}/`);
  const inspection = page.getByRole('region', { name: inspectionTitles.en, exact: true });
  const categories = inspection.locator('[data-inspection-check-category]');
  await expect(categories).toHaveCount(6);
  await expect(inspection.locator('[data-inspection-check-item]')).toHaveCount(0);
  const first = categories.first();
  await first.locator('[data-inspection-section="check-category"] > summary').click();
  const group = first.locator('[data-inspection-check-group]').first();
  await group.locator('[data-inspection-section="check-group"] > summary').click();
  await expect(group.locator('[data-inspection-check-item]')).toHaveCount(12);
  await group.locator('button').click();
  await expect(group.locator('[data-inspection-check-item]')).toHaveCount(24);
  await expect(group.locator('button')).toHaveCount(0);
  const checks = inspection.getByRole('region', { name: 'Inspection checks', exact: true });
  await checks.locator(':scope > button').click();
  await expect(categories).toHaveCount(8);
  await expect(checks.locator(':scope > button')).toHaveCount(0);
});
