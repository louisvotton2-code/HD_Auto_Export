import { expect, test } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
import { expectInlineInspection } from './helpers/inline-inspection';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: inline inspection preserves part identity and complete counts without extra report reads`, async ({ page, request }) => {
    await setPublicFixtureState(request, { importedPublished: true, inspectionMode: 'large', inspectionSummaryStatus: 'available' });
    const id = externalFixtureId(1);
    await page.goto(`/${locale}/cars/${id}/`);
    const section = page.locator('#inspection');
    await expectInlineInspection(section);
    await expect(section.locator('[data-inspection-complete-counts] dd')).toHaveText(['32', '1']);
    await expect(section.locator('[data-inspection-language]')).toHaveAttribute('data-inspection-language', 'en');
    await expect(section.locator('[data-inspection-normal-count]')).toContainText('31');
    const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
    expect(events.requests.filter((row: { path: string }) => row.path.endsWith('/inspection'))).toHaveLength(0);
    const details = events.requests.filter((row: { path: string }) => row.path.endsWith(`/vehicles/${id}`));
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((row: { query: { projection: string } }) => row.query.projection === 'detail-inline-v1')).toBe(true);
    await expect(page.locator('[data-public-inspection-link]')).toHaveCount(0);
  });
  test(`${locale}: legacy report URL redirects to the same detail anchor`, async ({ request }) => {
    const id = externalFixtureId(1);
    const response = await request.get(`/${locale}/cars/${id}/inspection/`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(new URL(response.headers().location, response.url()).pathname).toBe(`/${locale}/cars/${id}/`);
    expect(new URL(response.headers().location, response.url()).hash).toBe('#inspection');
  });
}

test('inline report is readable without JavaScript on a narrow screen', async ({ browser, baseURL, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, inspectionSummaryStatus: 'available' });
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(`/zh/cars/${externalFixtureId(1)}/`);
    await expectInlineInspection(page.locator('#inspection'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});
