import { expect, test, type APIRequestContext } from '@playwright/test';
import { PublicCatalogCacheStampSchema } from '@hd/contracts/public';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

// These are synthetic controls, not integration assertions about the production backend.
// The shared helper health-checks the dedicated loopback server before every mutation.
const fixtureBase = process.env.PUBLIC_FIXTURE_API_URL;
const internal = '/internal/public-catalog';
const versionPath = `${internal}/version`;
type RecordedRequest = {
  path: string;
  method: string;
  query: Record<string, string>;
  serviceAuthenticated?: boolean;
  hasVisitorIp?: boolean;
  hasCookie?: boolean;
  hasAuthorization?: boolean;
  hasRequestId?: boolean;
};

async function recorded(request: APIRequestContext): Promise<RecordedRequest[]> {
  const health = await request.get(`${fixtureBase}/__fixtures/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ suite: 'hd-web-public-catalog-v1' });
  const response = await request.get(`${fixtureBase}/__fixtures/requests`);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.suite).toBe('hd-web-public-catalog-v1');
  return result.requests;
}

const versions = (rows: RecordedRequest[]) => rows.filter(row => row.path === versionPath);
const anonymous = (rows: RecordedRequest[]) => rows.filter(row => row.path.startsWith(`${internal}/`) && row.path !== versionPath);
const detailPath = '/en/cars/fixture_car_3/';
const importedId = 'ext-00000000-0000-4000-8000-000000000001';

test.describe('anonymous cross-request SSR DTO reuse with the isolated catalog protocol', () => {
  test.skip(!fixtureBase, 'Requires the explicitly configured isolated public fixture API.');
  // Disable client revalidation: each navigation below observes a fresh server render.
  test.use({ javaScriptEnabled: false, extraHTTPHeaders: { 'X-HD-Visitor-IP': '198.51.100.79' } });
  test.beforeEach(async ({ page, request }) => {
    await resetPublicFixture(request);
    await page.route('https://photos.example.invalid/**', route => route.abort());
  });
  test.afterEach(async ({ request }) => resetPublicFixture(request));

  test('two SSR loads check the visitor quota each time but reuse anonymous DTOs', async ({ page, context, request, baseURL }) => {
    await context.addCookies([{ name: 'synthetic_employee', value: 'must_stay_at_web', url: baseURL! }]);
    await page.setExtraHTTPHeaders({
      'X-HD-Visitor-IP': '198.51.100.79', Authorization: 'Bearer SYNTHETIC_BROWSER_ONLY',
      'X-Request-ID': 'synthetic-browser-trace',
    });
    expect((await page.goto('/en/cars/?pageSize=5'))?.status()).toBe(200);
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(5);
    const first = await recorded(request);
    expect(anonymous(first).length).toBeGreaterThan(0);
    expect((await page.reload())?.status()).toBe(200);
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(5);
    const second = await recorded(request);
    expect(versions(second).length).toBeGreaterThan(versions(first).length);
    expect(anonymous(second)).toHaveLength(anonymous(first).length);
    expect(versions(second).every(row => row.serviceAuthenticated && row.hasVisitorIp)).toBe(true);
    expect(anonymous(second).every(row => row.serviceAuthenticated && !row.hasVisitorIp)).toBe(true);
    expect([...versions(second), ...anonymous(second)].every(row =>
      !row.hasCookie && !row.hasAuthorization && !row.hasRequestId)).toBe(true);
    expect(JSON.stringify(second)).not.toMatch(/SYNTHETIC_BROWSER_ONLY|must_stay_at_web|synthetic-browser-trace|x-hd-ssr-key/i);
  });

  test('business and FX changes invalidate the same URL and withdrawn vehicles disappear', async ({ page, request }) => {
    await setPublicFixtureState(request, { richCatalog: true });
    await page.goto(detailPath);
    await expect(page.locator('[data-vehicle-usd-approx]').first()).toContainText('1,000');
    const before = anonymous(await recorded(request)).length;
    await setPublicFixtureState(request, { usdRateDivisor: 4 });
    await page.reload();
    await expect(page.locator('[data-vehicle-usd-approx]').first()).toContainText('2,000');
    expect(anonymous(await recorded(request)).length).toBeGreaterThan(before);
    // Publish after checking FX: the legacy rich fixture prices follow its row order.
    await setPublicFixtureState(request, { futurePublished: true });
    await page.goto('/en/cars/fixture_future/');
    await expect(page.locator('main h1')).toHaveText('Newly published vehicle');
    await setPublicFixtureState(request, { futureArchived: true });
    expect((await page.reload())?.status()).toBe(404);
    await expect(page.locator('[data-vehicle-contacts="fixture_future"]')).toHaveCount(0);
    const withdrawn = await request.get('/api/v1/vehicles/fixture_future?locale=en&view=localized&priceView=usd');
    expect(withdrawn.status()).toBe(404);
    await page.goto('/en/cars/?pageSize=5');
    await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(0);
  });

  test('known P2: inherited dynamic vehicle 404 needs a readable no-JS fallback', async ({ page, request }) => {
    // PM explicitly accepted this inherited defect for REL-03; FE owns its fix
    // before formal operation. Preserve the failing UI assertions, separately
    // from successful cache invalidation checks; never count this as a pass.
    await setPublicFixtureState(request, { futurePublished: true, futureArchived: true });
    expect((await page.goto('/en/cars/fixture_future/'))?.status()).toBe(404);
    await expect(page.locator('[data-vehicle-contacts="fixture_future"]')).toHaveCount(0);
    const missingPages: string[] = [];
    for (const locale of ['zh', 'en', 'ru'] as const) {
      for (const id of ['fixture_future', 'fixture_never_published']) {
        const missing = await request.get(`/${locale}/cars/${id}/`);
        expect(missing.status()).toBe(404);
        const html = await missing.text();
        expect(html).not.toMatch(/Newly published vehicle|新发布车型|Новый опубликованный автомобиль|reports\.example\.invalid|data-vehicle-contacts/);
        const structured = [...html.matchAll(/<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
          .map(match => match[1]).join('\n');
        expect(structured).not.toMatch(/"@type"\s*:\s*"(?:Vehicle|Car)"|fixture_future|fixture_never_published/);
        missingPages.push(html);
      }
    }
    // Only the inherited body/brand/recovery UI assertions are accepted failures.
    // HTTP status and privacy checks above remain unexpected failures if broken.
    test.fail(true, 'Known inherited P2: Next dynamic error recovery has an empty no-JS body; PM REL-03 acceptance, 2026-11-13.');
    await expect(page.locator('main h1')).toHaveText('404');
    for (const html of missingPages) {
      const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0];
      expect(main).toBeDefined();
      expect(main).toMatch(/<h1\b[^>]*>\s*404\s*<\/h1>/);
      expect(html).toContain('HD Auto Export');
      const href = main!.match(/<a\b[^>]*\bhref="(\/(?!\/)[^"]+)"/)?.[1];
      expect(href).toBeDefined();
      expect((await request.get(href!)).status()).toBe(200);
    }
  });

  test('version outages and quota rejection cannot fall back to a warm result', async ({ page, request }) => {
    await page.goto(detailPath);
    await expect(page.locator('main h1')).toContainText('fixture_car_3');
    await setPublicFixtureState(request, { cacheVersionFailure: true });
    const beforeFailure = anonymous(await recorded(request)).length;
    await page.reload();
    await expect(page.getByTestId('public-vehicle-unavailable')).toBeVisible();
    expect(anonymous(await recorded(request))).toHaveLength(beforeFailure);
    await setPublicFixtureState(request, { cacheVersionFailure: false });
    await page.reload();
    await expect(page.locator('main h1')).toContainText('fixture_car_3');
    await setPublicFixtureState(request, { publicRateLimited: true });
    const beforeQuota = anonymous(await recorded(request)).length;
    await page.reload();
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Selected vehicle fixture_car_3');
    expect(anonymous(await recorded(request))).toHaveLength(beforeQuota);
  });

  test('a version mismatch retries once and a persistent mismatch stops without old data', async ({ page, request }) => {
    await setPublicFixtureState(request, { cacheMismatch: 'once' });
    await page.goto(detailPath);
    await expect(page.locator('main h1')).toContainText('fixture_car_3');
    const first = await recorded(request);
    expect(anonymous(first).filter(row => row.path.endsWith('/vehicles/fixture_car_3'))).toHaveLength(2);
    expect(versions(first)).toHaveLength(2);
    await setPublicFixtureState(request, { cacheMismatch: 'always' });
    await page.reload();
    await expect(page.getByTestId('public-vehicle-unavailable')).toBeVisible();
    const second = await recorded(request);
    expect(anonymous(second).length - anonymous(first).length).toBe(2);
    expect(versions(second).length - versions(first).length).toBe(2);
  });

  test('a hit does not renew the original short remaining payload lifetime', async ({ page, request }) => {
    await setPublicFixtureState(request, { cachePayloadTtlMs: 2_000 });
    await page.goto(detailPath);
    await expect(page.locator('main h1')).toContainText('fixture_car_3');
    const cold = anonymous(await recorded(request)).length;
    await page.waitForTimeout(1_050);
    await page.reload();
    await expect(page.locator('main h1')).toContainText('fixture_car_3');
    expect(anonymous(await recorded(request))).toHaveLength(cold);
    await page.waitForTimeout(1_050);
    await page.reload();
    await expect(page.locator('main h1')).toContainText('fixture_car_3');
    expect(anonymous(await recorded(request)).length).toBeGreaterThan(cold);
  });

  for (const bound of ['FX', 'remote media'] as const) {
    test(`${bound} expiry bounds reuse and never revives an expired signed resource`, async ({ page, request }) => {
      await setPublicFixtureState(request, bound === 'FX'
        ? { richCatalog: true, cacheFxTtlMs: 2_500 }
        : { importedPublished: true, cacheMediaTtlMs: 2_500 });
      const path = bound === 'FX' ? detailPath : `/en/cars/${importedId}/`;
      await page.goto(path);
      await expect(page.locator('main h1')).not.toBeEmpty();
      await expect(page.getByTestId('public-vehicle-unavailable')).toHaveCount(0);
      if (bound === 'FX') await expect(page.locator('[data-vehicle-usd-approx]').first()).toContainText('1,000');
      else await expect(page.locator('main img[src^="https://photos.example.invalid/"]').first()).toHaveCount(1);
      const cold = anonymous(await recorded(request)).length;
      await page.waitForTimeout(2_550);
      await page.reload();
      await expect(page.getByTestId('public-vehicle-unavailable')).toHaveCount(0);
      await expect(page.locator('main h1')).not.toBeEmpty();
      if (bound === 'FX') await expect(page.locator('[data-vehicle-usd-approx]')).toHaveCount(0);
      else await expect(page.locator('main img[src^="https://photos.example.invalid/"]')).toHaveCount(0);
      expect(anonymous(await recorded(request)).length).toBeGreaterThan(cold);
      if (bound === 'FX') {
        await page.goto('/en/cars/fixture_car_1/');
        await expect(page.locator('[data-vehicle-original-price]').first()).toContainText('6,000');
        await expect(page.locator('[data-vehicle-original-price]').first()).toContainText('USD');
        await expect(page.getByTestId('public-vehicle-unavailable')).toHaveCount(0);
      }
    });
  }

  test('browser BFF stays uncached and private reports/internal routes never become public', async ({ page, request }) => {
    await setPublicFixtureState(request, { importedPublished: true, reportPresenceMode: 'known', inspectionMode: 'structured' });
    const route = `/api/v1/vehicles/${importedId}?locale=en&view=localized&priceView=usd`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request.get(route);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toContain('no-store');
      const data = await response.json();
      // The detail BFF deliberately reconstructs public meta with its own requestId.
      expect(data.meta.requestId).toEqual(expect.any(String));
      expect(data.data.report.hasReport).toBe(true);
      expect(data.data.external.detail.inspection.reportUrl).toBeNull();
      expect(JSON.stringify(data)).not.toContain('https://reports.example.invalid');
    }
    const reads = await recorded(request);
    expect(reads.filter(row => row.path === `/api/v1/vehicles/${importedId}`)).toHaveLength(2);
    expect(anonymous(reads)).toHaveLength(0);
    // List envelopes retain the backend stamp, unlike the detail BFF projection.
    const list = await request.get('/api/v1/vehicles?locale=en&catalog=curated&view=localized&priceView=usd&q=EXT-000001');
    expect(list.status()).toBe(200);
    const envelope = await list.json();
    const stamp = PublicCatalogCacheStampSchema.parse(envelope.meta.catalogCache);
    expect(Date.parse(stamp.validUntil) - Date.parse(stamp.checkedAt)).toBeLessThanOrEqual(15_000);
    expect(Date.parse(stamp.validUntil)).toBeLessThanOrEqual(Date.parse(stamp.fx!.expiresAt));
    expect(envelope.data.items[0].id).toBe(importedId);
    expect(Date.parse(stamp.validUntil)).toBeLessThanOrEqual(Date.parse(envelope.data.items[0].images[0].remote.expiresAt));
    for (const path of [versionPath, `${internal}/vehicles`, `${internal}/media/private`, `${internal}/admin/me`, '/api/v1/admin/me'])
      expect((await request.get(path)).status()).toBe(404);
    const rendered = await page.goto(`/en/cars/${importedId}/`);
    expect(rendered?.status()).toBe(200);
    expect(rendered?.headers()['cache-control']).toContain('no-store');
    expect(await page.content()).not.toMatch(/reports\.example\.invalid|PRIVATE_RAW_MARKER|PRIVATE_COST_SENTINEL|HD_SSR_SERVICE_SECRET_FILE/);
    const staticReference = page.locator('link[rel="stylesheet"][href^="/_next/static/"], script[src^="/_next/static/"]').first();
    const staticPath = await staticReference.getAttribute('href') ?? await staticReference.getAttribute('src');
    expect(staticPath).toMatch(/^\/_next\/static\//);
    const asset = await request.get(staticPath!);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toMatch(/\bimmutable\b/);
    const privatePreview = await request.get(`${fixtureBase}/api/v1/admin/vehicles/00000000-0000-4000-8000-000000000001/publication-preview?locale=en`, {
      headers: { Cookie: 'hd-preview-staff=authorized' },
    });
    expect(privatePreview.status()).toBe(200);
    expect((await privatePreview.json()).meta).not.toHaveProperty('catalogCache');
    const invalidStaff = await request.get('/staff/vehicles/invalid/publication-preview/?locale=en&loadId=invalid');
    expect(invalidStaff.status()).toBe(200);
    expect(invalidStaff.headers()['cache-control']).toMatch(/\bprivate\b/);
    expect(invalidStaff.headers()['cache-control']).toMatch(/\bno-store\b/);
    expect(await invalidStaff.text()).not.toMatch(/PRIVATE_COST_SENTINEL|PRIVATE_NOTES_SENTINEL|reports\.example\.invalid/);
  });

  const offsetCopy = {
    zh: ['请缩小筛选范围', '保留筛选条件，返回第一页'],
    en: ['Refine your search', 'Return to page 1 with these filters'],
    ru: ['Уточните условия поиска', 'На первую страницу с этими фильтрами'],
  } as const;
  for (const locale of ['zh', 'en', 'ru'] as const) {
    test(`${locale}: an offset-only deep link returns readable 200 and preserves filters`, async ({ page, request }, testInfo) => {
      const response = await page.goto(`/${locale}/cars/?page=210&pageSize=48&make=alpha&model=alpha_model&q=Alpha&yearMin=2020`);
      expect(response?.status()).toBe(200);
      const notice = page.getByTestId('catalog-offset-limit');
      await expect(notice.getByRole('heading')).toHaveText(offsetCopy[locale][0]);
      const screenshot = testInfo.outputPath(`offset-${locale}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(`offset-${locale}`, { path: screenshot, contentType: 'image/png' });
      const recovery = notice.getByRole('link', { name: offsetCopy[locale][1] });
      const href = new URL((await recovery.getAttribute('href'))!, 'http://fixture.invalid');
      expect(href.pathname).toBe(`/${locale}/cars/`);
      // Canonical links omit the default first page; all actual filters remain explicit.
      expect(href.searchParams.get('page') ?? '1').toBe('1');
      for (const [key, value] of Object.entries({ pageSize: '48', make: 'alpha', model: 'alpha_model', q: 'Alpha', yearMin: '2020' }))
        expect(href.searchParams.get(key)).toBe(value);
      expect(anonymous(await recorded(request))).toHaveLength(0);
      await recovery.click();
      await expect(page.getByTestId('catalog-offset-limit')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('page') ?? '1').toBe('1');
      for (const invalid of ['page=210&pageSize=48&powertrain=invalid', 'page=210&page=211&pageSize=48', 'page=oops&pageSize=48', 'page=210&pageSize=49'])
        expect((await request.get(`/${locale}/cars/?${invalid}`)).status()).toBe(404);
    });
  }

  test('actual page sizes retain the full final allowed page and truthful API totals', async ({ page, request }) => {
    test.setTimeout(60_000);
    // This case measures pagination, not 48 images each regenerating a large synthetic data set.
    await page.route('**/api/v1/media/**', route => route.abort());
    await setPublicFixtureState(request, { catalogSampleCount: 10_080 });
    await page.goto('/en/cars/?page=209&pageSize=48');
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(48);
    await expect(page.locator('[data-catalog-page-count]')).toHaveAttribute('data-catalog-page-count', '209');
    await expect(page.locator('[data-catalog-offset-hint]')).toBeVisible();
    await expect(page.locator('[data-catalog-pagination] a[rel="next"]')).toHaveCount(0);
    const full = await request.get('/api/v1/vehicles?locale=en&catalog=curated&page=209&pageSize=48&view=localized&priceView=usd');
    expect(full.status()).toBe(200);
    const result = await full.json();
    expect(result.data.items).toHaveLength(48);
    expect(result.data.items[47].id).toBe('fixture_car_10032');
    expect(result.meta.total).toBe(10_080);
    expect(result.meta.accessibleTotal).toBe(10_080);
    expect(result.data.hasMore).toBe(true);
    await page.goto('/en/cars/?page=2001&pageSize=5');
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(5);
    await expect(page.locator('[data-catalog-page-count]')).toHaveAttribute('data-catalog-page-count', '2001');
    await expect(page.locator('[data-public-vehicle="fixture_car_10005"]')).toBeVisible();
    expect((await page.goto('/en/cars/?page=2002&pageSize=5'))?.status()).toBe(200);
    await expect(page.getByTestId('catalog-offset-limit')).toBeVisible();
  });
});
