import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';
import { fillNumericDate } from './helpers/numeric-date';

const key = 'hd-auto.destination-country.v1';
test.beforeEach(async ({ request }) => {
  if (process.env.PUBLIC_FIXTURE_API_URL) await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  if (process.env.PUBLIC_FIXTURE_API_URL) await resetPublicFixture(request);
});

test('numeric date dropdowns retain empty values, valid month choices, leap days and a cleared impossible day', async ({ page }) => {
  await page.goto('/en/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('input[type="date"],input[type="month"]')).toHaveCount(0);
  await expect(page.locator('[data-numeric-date="manufactureDate"] select')).toHaveCount(2);
  await expect(page.locator('[data-numeric-date="customsDate"] select')).toHaveCount(3);
  await expect(page.locator('[data-numeric-date] input:not([type="hidden"])')).toHaveCount(0);
  for (const name of ['manufactureDate', 'customsDate']) {
    const monthOptions = await page.locator(`#${name}-month option:not([value=""])`).evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    expect(monthOptions).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1)));
    await expect(page.locator(`#${name}-year option[value="0000"],#${name}-year option[value="0"]`)).toHaveCount(0);
    await expect(page.locator(`#${name}-year option[value="1886"]`)).toHaveCount(1);
  }
  await fillNumericDate(page, 'customsDate', '2024-02-29');
  await expect(page.locator('#customsDate-day option:not([value=""])')).toHaveCount(29);
  await page.locator('#customsDate-year').selectOption('2023');
  await expect(page.locator('#customsDate-day')).toHaveValue('');
  await expect(page.locator('#customsDate')).toHaveValue('');
  await expect(page.locator('#customsDate-date-feedback')).toContainText('Day was cleared');
  await expect(page.locator('#customsDate-day option:not([value=""])')).toHaveCount(28);
  await expect(page.locator('#customsDate-day option[value="29"]')).toHaveCount(0);
  await page.locator('#customsDate-day').selectOption('28');
  await expect(page.locator('#customsDate')).toHaveValue('2023-02-28');
  await fillNumericDate(page, 'customsDate', '2000-02-29');
  await expect(page.locator('#customsDate-day option:not([value=""])')).toHaveCount(29);
  await page.locator('#customsDate-year').selectOption('1900');
  await expect(page.locator('#customsDate-day')).toHaveValue('');
  await expect(page.locator('#customsDate')).toHaveValue('');
  await expect(page.locator('#customsDate-day option:not([value=""])')).toHaveCount(28);
  await fillNumericDate(page, 'customsDate', '2024-01-31');
  await page.locator('#customsDate-month').selectOption('4');
  await expect(page.locator('#customsDate-day')).toHaveValue('');
  await expect(page.locator('#customsDate')).toHaveValue('');
  await expect(page.locator('#customsDate-day option:not([value=""])')).toHaveCount(30);
  await expect(page.locator('#customsDate-date-feedback')).toContainText('Day was cleared');
  await fillNumericDate(page, 'customsDate', '');
  await expect(page.locator('#customsDate-day')).toBeDisabled();
  await expect(page.locator('#customsDate-year')).toHaveValue('');
  await expect(page.locator('#customsDate-month')).toHaveValue('');
  await page.locator('#manufactureDate-year').selectOption('');
  await expect(page.locator('#manufactureDate')).toHaveValue('');
  await expect(page.locator('#manufactureDate-year')).toHaveValue('');
  await fillNumericDate(page, 'manufactureDate', '2021-12');
  await expect(page.locator('#manufactureDate-year')).toHaveAttribute('aria-invalid', 'false');
});

test('stored country is read before a detail quote and only country survives moving to another car', async ({ page }) => {
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated vehicle fixture.');
  await page.addInitScript(storageKey => {
    if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, 'KZ');
    const observation = { writes: [] as string[], wrongRuQuote: false };
    Object.assign(window, { __destinationObservation: observation });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === storageKey) observation.writes.push(value);
      original.call(this, name, value);
    };
    new MutationObserver(() => {
      const calculator = document.querySelector('[data-testid="vehicle-import-estimate"]');
      if (calculator?.getAttribute('data-country') === 'RU' && calculator.querySelector('[data-testid="inline-estimate-result"]')) observation.wrongRuQuote = true;
    }).observe(document, { childList: true, subtree: true, attributes: true });
  }, key);
  await page.goto('/en/cars/fixture_car_3/');
  const budget = page.getByTestId('vehicle-import-estimate');
  await expect(budget).toHaveAttribute('data-country-ready', 'true');
  await expect(budget.locator('[name="country"]')).toHaveValue('KZ');
  const initial = await page.evaluate(() => (window as unknown as { __destinationObservation: { writes: string[]; wrongRuQuote: boolean } }).__destinationObservation);
  expect(initial).toEqual({ writes: [], wrongRuQuote: false });
  await budget.locator('[name="country"]').selectOption('KG');
  await budget.locator('[name="price"]').fill('77777');
  await budget.locator('[name="displacementCc"]').fill('2222');
  await fillNumericDate(budget, 'manufactureDate', '2010-01');
  await budget.locator('[name="transactionRate"]').fill('999');
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('KG');
  await page.goto('/en/cars/fixture_car_1/');
  await expect(budget).toHaveAttribute('data-country-ready', 'true');
  await expect(budget.locator('[name="country"]')).toHaveValue('KG');
  await expect(budget.locator('[name="price"]')).not.toHaveValue('77777');
  await expect(budget.locator('[name="displacementCc"]')).not.toHaveValue('2222');
  await expect(budget.locator('[name="manufactureDate"]')).not.toHaveValue('2010-01');
  await expect(budget.locator('[name="transactionRate"]')).not.toHaveValue('999');
  expect(await page.evaluate(() => (window as unknown as { __destinationObservation: { wrongRuQuote: boolean } }).__destinationObservation.wrongRuQuote)).toBe(false);
  await page.evaluate(() => history.pushState(null, '', `${location.pathname}?country=UZ`));
  await expect(budget.locator('[name="country"]')).toHaveValue('UZ');
  await page.evaluate(() => history.pushState(null, '', `${location.pathname}?country=AM`));
  await expect(budget.locator('[name="country"]')).toHaveValue('AM');
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\?country=UZ$/);
  await expect(budget.locator('[name="country"]')).toHaveValue('UZ');
  // Back's explicit URL wins over the newer AM storage value.
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('UZ');
});

test('an explicit country URL wins and ordinary calculator entry reuses that preference', async ({ page }) => {
  await page.addInitScript(storageKey => { if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, 'KZ'); }, key);
  await page.goto('/en/calculator/armenia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('.country-tab.active')).toHaveAttribute('href', /\/calculator\/armenia\/$/);
  await expect.poll(() => page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('AM');
  await page.goto('/en/calculator/');
  await expect(page).toHaveURL(/\/en\/calculator\/armenia\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
});

test('disabled local storage still permits fallback, explicit URLs and a user country choice', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage is disabled', 'SecurityError'); } }));
  await page.goto('/en/calculator/');
  await expect(page).toHaveURL(/\/en\/calculator\/russia\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await page.locator('.country-tab').filter({ hasText: 'Armenia' }).click();
  await expect(page).toHaveURL(/\/en\/calculator\/armenia\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
});
