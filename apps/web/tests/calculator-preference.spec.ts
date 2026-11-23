import { chooseVehicleDestination } from './helpers/vehicle-destination';
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

test('manufacture month and clearance day remain separate editable fields', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T04:00:00Z'));
  await page.goto('/en/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('input[type="date"],input[type="month"]')).toHaveCount(0);
  const manufacture = page.locator('[data-numeric-date="manufactureDate"]');
  await expect(manufacture.locator('select')).toHaveCount(2);
  await expect(manufacture.locator('button')).toHaveCount(0);
  const assumption = page.locator('#manufactureDate-note strong');
  await expect(assumption).toContainText('January of each of the last six years');
  await expect(assumption).toHaveCSS('color', 'rgb(255, 141, 141)');
  await expect(assumption).toHaveCSS('font-weight', '700');
  await expect(page.locator('[name="customsDateDay"]')).toBeVisible();
  await expect(page.getByText('Expected clearance date', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-numeric-date] input:not([type="hidden"])')).toHaveCount(0);
  const months = await manufacture.locator('select[name="manufactureDateMonth"] option:not([value=""])')
    .evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(months).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1)));
  await expect(page.locator('#manufactureDate-year option[value="0000"],#manufactureDate-year option[value="0"]')).toHaveCount(0);
  await expect(page.locator('#manufactureDate-year option[value="1886"]')).toHaveCount(1);
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
  await expect(budget).toHaveAttribute('data-country', 'KZ');
  const initial = await page.evaluate(() => (window as unknown as { __destinationObservation: { writes: string[]; wrongRuQuote: boolean } }).__destinationObservation);
  expect(initial).toEqual({ writes: [], wrongRuQuote: false });
  await chooseVehicleDestination(budget, 'KG');
  await budget.locator('[name="price"]').fill('77777');
  await budget.locator('[name="displacementCc"]').fill('2222');
  await fillNumericDate(budget, 'manufactureDate', '2010-01');
  await budget.locator('[name="transactionRate"]').fill('999');
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('KG');
  await page.goto('/en/cars/fixture_car_1/');
  await expect(budget).toHaveAttribute('data-country-ready', 'true');
  await expect(budget).toHaveAttribute('data-country', 'KG');
  await expect(budget.locator('[name="price"]')).not.toHaveValue('77777');
  await expect(budget.locator('[name="displacementCc"]')).not.toHaveValue('2222');
  await expect(budget.locator('[name="manufactureDate"]')).not.toHaveValue('2010-01');
  await expect(budget.locator('[name="transactionRate"]')).not.toHaveValue('999');
  expect(await page.evaluate(() => (window as unknown as { __destinationObservation: { wrongRuQuote: boolean } }).__destinationObservation.wrongRuQuote)).toBe(false);
  await page.evaluate(() => history.pushState(null, '', `${location.pathname}?country=UZ`));
  await expect(budget).toHaveAttribute('data-country', 'UZ');
  await page.evaluate(() => history.pushState(null, '', `${location.pathname}?country=AM`));
  await expect(budget).toHaveAttribute('data-country', 'AM');
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\?country=UZ$/);
  await expect(budget).toHaveAttribute('data-country', 'UZ');
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
