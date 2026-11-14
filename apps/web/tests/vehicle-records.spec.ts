import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

test('public records load bounded pages explicitly, preserve actual language and original money, and distinguish report states', async ({ page }) => {
  const vehicleId = 'fixture_car_3';
  const locale = 'ru';
  const requested: string[] = [];
  page.on('request', request => { requested.push(new URL(request.url()).pathname); });
  const text = (value: string) => ({ status: 'ready', text: value, requestedLocale: locale, contentLocale: 'en', provenance: 'supplier', reviewed: false });
  const entries = Array.from({ length: 51 }, (_, index) => ({
    id: `inspection-${index + 1}`, category: text('Inspection'), part: null,
    name: text(`Report item ${index + 1}`), value: text(index === 0 ? '0' : 'Recorded'), outcome: index === 0 ? 'ok' : 'unknown',
  }));
  let reportStatus = 'available';
  let reportReads = 0;
  await page.route(/\/api\/v1\/vehicles\/fixture_car_3\/inspection\//, route => {
    reportReads++;
    const tail = new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({ json: {
      data: { vehicleId, locale, revision: 'a'.repeat(64), status: reportStatus,
        total: reportStatus === 'available' ? entries.length : 0,
        items: reportStatus === 'available' ? tail ? entries.slice(50) : entries.slice(0, 50) : [],
        nextCursor: reportStatus === 'available' && !tail ? 'record_tail' : null },
      meta: { requestId: 'records-ui-inspection' },
    } });
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
  await page.goto(`/${locale}/cars/${vehicleId}/`);
  const report = page.locator('[data-public-vehicle-inspection]');
  const prices = page.locator('[data-public-price-history]');
  await expect(report).toHaveAttribute('data-report-status', 'unread');
  await expect(report.locator('[data-public-inspection-item]')).toHaveCount(0);
  expect(reportReads).toBe(0);
  expect(priceReads).toBe(0);
  await report.getByRole('button', { name: 'Посмотреть отчёт об осмотре', exact: true }).click();
  await expect(report.locator('[data-public-inspection-item]')).toHaveCount(50);
  await expect(report.locator('[data-public-inspection-item]').first().locator('dt > span')).toHaveAttribute('lang', 'en');
  await expect(report.locator('[data-public-inspection-item]').first().locator('dd > span')).toHaveText('0');
  expect(reportReads).toBe(1);
  await report.getByRole('button', { name: 'Загрузить ещё', exact: true }).click();
  await expect(report.locator('[data-public-inspection-item]')).toHaveCount(51);
  expect(reportReads).toBe(2);
  for (const [status, message] of [
    ['no_report', 'Для этого автомобиля нет отчёта об осмотре.'],
    ['pending', 'Данные отчёта об осмотре дополняются.'],
    ['unavailable', 'Отчёт об осмотре временно недоступен. Попробуйте позже.'],
  ] as const) {
    reportStatus = status;
    await report.getByRole('button', { name: 'Загрузить заново', exact: true }).click();
    await expect(report).toHaveAttribute('data-report-status', status);
    await expect(report).toContainText(message);
    await expect(report.locator('[data-public-inspection-item]')).toHaveCount(0);
    if (status !== 'no_report') await expect(report).not.toContainText('Для этого автомобиля нет отчёта об осмотре.');
  }
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
  await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
});
