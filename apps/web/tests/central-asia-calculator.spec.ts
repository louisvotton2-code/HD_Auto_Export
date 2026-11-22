import { expect, test } from '@playwright/test';
import { fillNumericDate } from './helpers/numeric-date';

const destinations = ['kyrgyzstan', 'uzbekistan', 'kazakhstan', 'tajikistan', 'turkmenistan', 'russia', 'georgia', 'armenia', 'albania'];
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T04:00:00Z'));
});

test('the homepage, standalone calculator and vehicle estimate share the destination order', async ({ page }) => {
  await page.goto('/zh/');
  const paths = destinations.map(slug => `/zh/calculator/${slug}/`);
  const home = page.locator('[data-home-section="calculator"] li a');
  expect(await home.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(paths);
  await home.nth(3).click();
  const tabs = page.locator('.country-nav a');
  await expect(tabs).toHaveCount(paths.length);
  expect(await tabs.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(paths);
  await expect(tabs.nth(3).locator('img')).toHaveAttribute('src', /\/tj\.[\w-]+\.svg$/);
  await expect(tabs.nth(4).locator('img')).toHaveAttribute('src', /\/tm\.[\w-]+\.svg$/);

  await page.goto('/zh/cars/fixture_car_1/');
  const picker = page.getByTestId('vehicle-destination-picker');
  await expect(picker).not.toHaveAttribute('aria-disabled', 'true');
  await picker.click();
  const options = page.getByTestId('vehicle-import-estimate').locator('[data-country-option]');
  expect(await options.evaluateAll(buttons => buttons.map(button => button.getAttribute('data-country-option'))))
    .toEqual(['KG', 'UZ', 'KZ', 'TJ', 'TM', 'RU', 'GE', 'AM', 'AL']);
});

test('Tajikistan prefills editable fuel tariff references and retains an override on refresh', async ({ page }) => {
  await page.goto('/zh/calculator/tajikistan/');
  await expect(page.getByTestId('total')).toContainText('TJS');
  await expect(page.getByTestId('total-usd')).toContainText('USD');
  await expect(page.locator('#tjDutyPercent')).toHaveValue('10');
  await expect(page.locator('#tjExcisePercent')).toHaveValue('14');
  await expect(page.locator('#tjExciseMinimum')).toHaveValue('0.20');
  await expect(page.getByLabel('海关计税价值', { exact: true })).toHaveValue('25000');
  await expect(page.locator('#freight, #insurance')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '官方来源 · № 470' })).toHaveAttribute('href', 'https://new.edavlat.tj/api/files_storage/3467');
  await expect(page.getByRole('link', { name: '官方来源 · № 335' })).toHaveAttribute('href', 'https://new.edavlat.tj/api/files_storage/3483');
  await page.locator('#tjExciseMinimum').fill('');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await page.locator('#tjExciseMinimum').fill('0.25');
  await page.reload();
  await expect(page.locator('#tjExciseMinimum')).toHaveValue('0.25');
  await expect(page.getByTestId('total')).toContainText('TJS');
});

test('Turkmenistan shows an ordinary amount and withholds a total for a restricted manufacture year', async ({ page }) => {
  await page.goto('/zh/calculator/turkmenistan/');
  await expect(page.getByTestId('total')).toContainText('TMT');
  await expect(page.getByTestId('total-usd')).toContainText('USD');
  await expect(page.locator('#freight')).toHaveCount(0);
  await fillNumericDate(page.locator('main'), 'manufactureDate', '2021-01');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expect(page.locator('#calculation-result')).toContainText('5 个日历年');
});
