import { expect, test } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires only the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

test('the independent report keeps complete statistics while paging and filtering stored English records', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', reportPresenceMode: 'known', inspectionSummaryStatus: 'available' });
  const id = externalFixtureId(1);
  await page.goto(`/zh/cars/${id}/inspection/`);
  const report = page.locator(`[data-vehicle-inspection-page="${id}"]`);
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute('data-inspection-status', 'available');
  await expect(report.locator('[data-report-language]')).toHaveAttribute('data-report-language', 'en');
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(50);
  await expect(report.locator('[data-inspection-page-item] [lang="en"]').first()).not.toBeEmpty();
  const checked = await report.locator('[data-report-checked]').innerText();
  const faults = await report.locator('[data-report-faults]').innerText();
  await expect(report.locator('[data-report-checked]')).toContainText(/\d/);
  await report.locator('[data-inspection-page-load-more]').click();
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(100);
  await report.locator('[data-inspection-page-load-more]').click();
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(125);
  await expect(report.locator('[data-report-checked]')).toHaveText(checked);
  await expect(report.locator('[data-report-faults]')).toHaveText(faults);
  await expect(report.locator('[data-inspection-page-load-more]')).toHaveCount(0);

  await report.locator('form select[name="category"]').selectOption('accident');
  await report.locator('form button[type="submit"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe('accident');
  await expect(report.locator('[data-report-checked]')).toHaveText(checked);
  await expect(report.locator('[data-report-faults]')).toHaveText(faults);
  const result = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  const reads = result.requests.filter((row: { path: string }) => row.path.endsWith('/inspection'));
  expect(reads.length).toBe(4); // Initial SSR page, two bounded next pages, and one category read.
  expect(reads.every((row: { query: { locale: string; order: string; limit: string } }) => row.query.locale === 'zh' && row.query.order === 'faults_first' && Number(row.query.limit) === 50)).toBe(true);
  expect(reads.at(-1).query.category).toBe('accident');
  expect(reads.at(-1).query.cursor).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('the first report records and native category filters remain readable without JavaScript', async ({ browser, baseURL, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', reportPresenceMode: 'known', inspectionSummaryStatus: 'available' });
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  try {
    const page = await context.newPage();
    const id = externalFixtureId(1);
    const response = await page.goto(`/ru/cars/${id}/inspection/`);
    expect(response?.status()).toBe(200);
    const report = page.locator('[data-vehicle-inspection-page]');
    await expect(report).toBeVisible();
    await expect(report.locator('h1')).toHaveText('Отчёт об осмотре автомобиля');
    await expect(report.locator('[data-report-complete-counts]')).toBeVisible();
    await expect(report.locator('[data-inspection-page-item]')).toHaveCount(50);
    await expect(report.locator('[data-inspection-page-load-more]')).toHaveCount(0);
    await report.locator('form select[name="category"]').selectOption('flood');
    await report.locator('form button[type="submit"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe('flood');
    await expect(report.locator('[data-report-complete-counts]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});

test('an initial rate limit counts down without an automatic report retry', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', inspectionSummaryStatus: 'available', segmentFailure: 'rate_limit' });
  const id = externalFixtureId(1);
  await page.goto(`/en/cars/${id}/inspection/`);
  const report = page.locator('[data-vehicle-inspection-page]');
  const action = report.locator('[data-inspection-page-load-more]');
  await expect(report.locator('h1')).toHaveText('Vehicle inspection report');
  await expect(action).toBeDisabled();
  await expect(report.locator('form button[type="submit"]')).toBeDisabled();
  await setPublicFixtureState(request, { segmentFailure: 'none' });
  await expect(action).toBeEnabled({ timeout: 5_000 });
  await expect(action).toHaveText('Retry loading');
  const before = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  expect(before.requests.filter((row: { path: string }) => row.path.endsWith('/inspection'))).toHaveLength(1);
  await action.click();
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(50);
});

test('a changed revision discards old records and withdrawal removes the whole report', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', inspectionSummaryStatus: 'available' });
  const id = externalFixtureId(1);
  await page.goto(`/en/cars/${id}/inspection/`);
  const report = page.locator('[data-vehicle-inspection-page]');
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(50);
  await setPublicFixtureState(request, { segmentRevision: 2 });
  await report.locator('[data-inspection-page-load-more]').click();
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(0);
  await expect(report.locator('[data-report-complete-counts]')).toHaveCount(0);
  await expect(report.getByRole('status')).toContainText('The report has changed');
  await report.locator('[data-inspection-page-load-more]').click();
  await expect(report.locator('[data-inspection-page-item]')).toHaveCount(50);
  await setPublicFixtureState(request, { importedWithdrawn: true });
  await report.locator('[data-inspection-page-load-more]').click();
  await expect(page.locator('[data-inspection-missing]')).toBeVisible();
  await expect(report).toHaveCount(0);
  await expect(page.locator('[data-report-complete-counts]')).toHaveCount(0);
});

test('a missing or withdrawn inspection route preserves a real 404', async ({ request }) => {
  for (const locale of ['zh', 'en', 'ru']) {
    const response = await request.get(`/${locale}/cars/fixture_ext08_missing/inspection/`);
    expect(response.status()).toBe(404);
  }
  await setPublicFixtureState(request, { importedPublished: true, importedWithdrawn: true });
  for (const locale of ['zh', 'en', 'ru']) {
    const response = await request.get(`/${locale}/cars/${externalFixtureId(1)}/inspection/`);
    expect(response.status()).toBe(404);
  }
});
