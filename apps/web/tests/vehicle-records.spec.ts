import { expect, test } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

test('detail renders same-response inspection states without probing and keeps click-loaded price history in original money', async ({ page, request }) => {
  const vehicleId = 'fixture_car_3';
  const locale = 'ru';
  const requested: string[] = [];
  page.on('request', request => { requested.push(new URL(request.url()).pathname); });
  let reportReads = 0;
  // Any detail-side probe is a regression. Report bodies belong to the separate page.
  await page.route(/\/api\/v1\/vehicles\/fixture_car_3\/inspection(?:\/|\?|$)/, route => {
    reportReads++;
    return route.abort('blockedbyclient');
  });
  let priceReads = 0;
  await page.route(/\/api\/v1\/vehicles\/fixture_car_3\/price-history\//, route => {
    priceReads++;
    const tail = new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({ json: {
      data: { vehicleId, locale, revision: 'b'.repeat(64), total: 2,
        items: [tail
          ? { id: 'price-2', at: null, money: { amount: '0', currency: 'USD' }, kind: 'unknown' }
          : { id: 'price-1', at: '2026-10-01T00:00:00.000Z', money: { amount: '74000.50', currency: 'CNY' }, kind: 'asking' }],
        nextCursor: tail ? null : 'price_tail' },
      meta: { requestId: 'records-ui-prices' },
    } });
  });
  for (const status of ['available', 'no_report', 'pending', 'unknown', 'unavailable'] as const) {
    await setPublicFixtureState(request, { inspectionSummaryStatus: status });
    await page.goto(`/${locale}/cars/${vehicleId}/`);
    if (status === 'available') {
      const summary = page.locator('[data-inspection-summary]');
      await expect(summary).toHaveAttribute('data-inspection-status', status);
      const reportLink = summary.getByRole('link', { name: 'Посмотреть отчёт об осмотре', exact: true });
      await expect(reportLink).toHaveAttribute('href', `/${locale}/cars/${vehicleId}/inspection/`);
      await expect(reportLink).toHaveAttribute('target', '_blank');
      await expect(reportLink).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(summary.locator('button')).toHaveCount(0);
      await expect(summary.locator('dl dd')).toHaveText(['32', '1']);
      await expect(summary.locator('[data-inspection-category="accident"] small')).toHaveText('Проверено пунктов: 24 · Выявлено замечаний: 0');
    } else {
      const service = page.locator('[data-inspection-service]');
      await expect(service).toHaveAttribute('data-inspection-status', status);
      await expect(service).toContainText('Для этого объявления сейчас нет доступного исторического отчёта об осмотре.');
      await expect(service).toContainText('задаток возвращается полностью');
      await expect(service).toContainText('клиент не оплачивает осмотр');
      await expect(service).toContainText('осмотр оплачивает клиент');
      await expect(page.locator('[data-inspection-summary]')).toHaveCount(0);
      await expect(page.locator('main a[href*="/inspection/"]')).toHaveCount(0);
      await expect(service.locator('button')).toHaveCount(0);
      const contacts = service.locator('[data-vehicle-contacts] a');
      await expect(contacts).toHaveCount(2);
      for (const link of await contacts.all()) await expect(link).toHaveAttribute('href', /^https:\/\/(?:t\.me|wa\.me)\//);
    }
    await expect(page.locator('[data-public-inspection-item]')).toHaveCount(0);
    await expect(page.locator('[data-public-vehicle-inspection]')).toHaveCount(0);
    await expect(page.locator('main a[href^="#vehicle-public-inspection-"]')).toHaveCount(0);
    await expect(page.locator('[data-history-kind="accidents"]')).toHaveCount(0);
    expect(reportReads).toBe(0);
    expect(priceReads).toBe(0);
  }
  const prices = page.locator('[data-public-price-history]');
  await prices.getByRole('button', { name: 'Посмотреть историю цены', exact: true }).click();
  await expect(prices.locator('[data-price-history-item]')).toHaveCount(1);
  await expect(prices.locator('tbody td').nth(1)).toHaveText(/74\s000,5/);
  await expect(prices.locator('tbody td').nth(2)).toHaveText('CNY');
  await expect(prices.locator('time')).toHaveAttribute('datetime', '2026-10-01T00:00:00.000Z');
  expect(priceReads).toBe(1);
  await prices.getByRole('button', { name: 'Загрузить ещё', exact: true }).click();
  await expect(prices.locator('[data-price-history-item]')).toHaveCount(2);
  await expect(prices.locator('[data-price-history-item="price-2"] td').nth(1)).toHaveText('0');
  await expect(prices.locator('[data-price-history-item="price-2"] td').nth(2)).toHaveText('USD');
  await expect(prices.locator('[data-price-history-item="price-2"] td').first()).toHaveText('Время записи не указано');
  await expect(prices).toContainText('без пересчёта по текущему курсу');
  expect(priceReads).toBe(2);
  expect(requested.filter(path => path.endsWith('/configuration/'))).toHaveLength(0);
  expect(requested.filter(path => /\/inspection\/?$/.test(path))).toHaveLength(0);
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  expect(events.requests.filter((event: { path: string }) => /\/inspection\/?$/.test(event.path))).toHaveLength(0);
  await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
});
