/** Public localized metadata contract simulations. Unified editing lives in bundle-cases. */
import { expect, test, type Page } from '@playwright/test';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicVehicleSchema, type DisplayText, type PublicVehicle } from '@hd/contracts/public';
import { envelope, installApi, reply } from './api-fixture';
const priceId = '40000000-0000-4000-8000-000000000003';
async function capture(page: Page, name: string) {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`fixture-${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
test('localization public verification requests localized metadata and never falls back to raw Chinese facts', async ({ page }) => {
  await installApi(page);
  const ready = (text: string): DisplayText => ({ status: 'ready', text, requestedLocale: 'en', contentLocale: 'en', provenance: 'machine', reviewed: false });
  const missing: DisplayText = { status: 'missing', text: null, requestedLocale: 'en', contentLocale: null, provenance: null, reviewed: false };
  const items: PublicVehicle[] = [0, 1].map(index => {
    const item = makeLocalizedPublicVehicleFixture('en', 'machine');
    item.id = `i18n02-public-${index}`; item.stockCode = `I18N02-${index}`;
    item.source = { kind: 'external', platform: { id: 'synthetic_platform', name: '不得回退的原始中文平台' }, listingUrl: 'https://example.invalid/synthetic-only' };
    item.facts.make = { id: 'synthetic_make', name: '不得回退的原始中文品牌' };
    item.facts.model = { id: 'synthetic_model', name: '不得回退的原始中文车型' };
    item.price.kind = 'reference'; item.availability = 'unknown'; item.availabilityCheckedAt = null;
    item.content.title = { text: `Synthetic English vehicle ${index}`, requestedLocale: 'en', contentLocale: 'en', kind: 'machine', reviewed: false };
    item.content.description = null;
    item.images = item.images.map(image => ({ ...image, alt: '不得回退的原始中文图片说明' }));
    if (index === 0) item.display = { make: ready('English synthetic make'), model: ready('English synthetic model'), trim: missing, generation: missing,
      city: missing, location: missing, platform: ready('English source platform'),
      priceIncludes: [{ id: priceId, value: missing }], mediaAlt: item.images.map(image => ({ mediaId: image.id, value: missing })) };
    else delete item.display;
    return PublicVehicleSchema.parse(item);
  });
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/media/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLXcAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/v1/vehicle-filters?*', route => { queries.push(new URL(route.request().url()).searchParams); return reply(route, envelope({
    catalog: 'curated', makes: [{ id: 'synthetic_make', name: 'English synthetic make', count: 2 }],
    models: [{ id: 'synthetic_model', makeId: 'synthetic_make', name: 'English synthetic model', count: 2 }], powertrains: [],
  })); });
  await page.route('**/api/v1/vehicles?*', route => { queries.push(new URL(route.request().url()).searchParams); return reply(route, {
    data: { items, page: 1, pageSize: 24, hasMore: false }, meta: { requestId: 'i18n02-synthetic-public', catalog: 'curated', total: 2, totalKind: 'exact', accessibleTotal: 2, dataAsOf: '2026-11-08T00:00:00Z', freshness: 'fresh' },
  }); });
  await page.goto('/admin/public-catalog/verification?locale=en');
  const first = page.getByRole('row').filter({ hasText: 'I18N02-0' }); const legacy = page.getByRole('row').filter({ hasText: 'I18N02-1' });
  await expect(first).toContainText('English synthetic make English synthetic model');
  await expect(first).toContainText('English source platform');
  await expect(legacy).toContainText('品牌未填写或待翻译'); await expect(legacy).toContainText('来源平台未填写或待翻译');
  for (const row of [first, legacy]) {
    await expect(row.getByRole('img', { name: '车辆封面', exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: /查看数据/ })).toHaveAttribute('href', /[?]locale=en&view=localized$/);
    await row.locator('.ant-table-row-expand-icon').click();
  }
  await expect(page.locator('.ant-table-expanded-row').first()).toContainText('未填写或待翻译');
  await expect(page.getByText('服务尚未提供多语展示资料', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('不得回退的原始中文');
  expect(queries).toHaveLength(2); expect(queries.every(query => query.get('view') === 'localized' && query.get('locale') === 'en')).toBe(true);
  await capture(page, 'public-display-verification');
});
