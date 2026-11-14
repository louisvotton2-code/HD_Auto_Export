import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

test('obsolete export filters are ignored by SSR, catalog requests and facet requests', async ({ page, request }) => {
  await page.goto('/en/cars/?exportStatus=restricted&exportStatus=invalid');
  await expect(page.locator('[data-public-vehicle]')).not.toHaveCount(0);
  await expect(page.locator('select[name="exportStatus"]')).toHaveCount(0);
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  const queries = events.requests.filter((row: { path: string }) => /\/(vehicles|vehicle-filters)$/.test(row.path));
  expect(queries.length).toBeGreaterThan(0);
  for (const row of queries) expect(row.query).not.toHaveProperty('exportStatus');
  const direct = await request.get('/api/v1/vehicle-filters/?locale=en&view=localized&priceView=usd&exportStatus=invalid');
  expect(direct.status()).toBe(200);
});

test('loading is driven by the pending response, keeps cards and clears after completion', async ({ page }) => {
  await page.goto('/en/cars/');
  const cards = page.locator('[data-public-vehicle]');
  const ids = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')));
  expect(ids.length).toBeGreaterThan(0);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/v1\/vehicles\/\?/, async route => { await pending; await route.continue(); });
  try {
    await page.locator('input[name="q"]').fill('fixture_car');
    const searchButton = page.locator('form').filter({ has: page.locator('input[name="q"]') })
      .getByRole('button', { name: 'Search', exact: true });
    await expect(searchButton).toHaveCount(1);
    await searchButton.click();
    const status = page.getByTestId('public-resource-status').filter({ visible: true });
    await expect(status).toHaveAttribute('data-phase', 'checking');
    await expect(status.locator('.public-resource-spinner svg')).toBeVisible();
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')))).toEqual(ids);
  } finally { release(); }
  await expect(page.getByTestId('public-resource-status')).toBeHidden();
});
