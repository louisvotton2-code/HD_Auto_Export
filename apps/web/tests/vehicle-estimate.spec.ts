import { chooseVehicleDestination } from './helpers/vehicle-destination';
import { expect, test, type Locator } from '@playwright/test';
import { fillNumericDate } from './helpers/numeric-date';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires isolated public data fixtures.');
test.beforeEach(async ({ page, request }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T04:00:00Z'));
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});
const compact = (text: string) => text.replace(/\s+/g, '');
async function fillIfVisible(scope: Locator, name: string, value: string) {
  if (name === 'manufactureDate') {
    if (await scope.locator(`[data-numeric-date="${name}"]`).isVisible()) await fillNumericDate(scope, name, value);
    return;
  }
  const field = scope.locator(`[name="${name}"]`);
  if (await field.isVisible()) await field.fill(value);
}
async function complete(scope: Locator, code: string) {
  await chooseVehicleDestination(scope, code);
  await scope.locator('[name="powertrain"]').selectOption('petrol');
  for (const [name, value] of Object.entries({
    price: '25000',
    displacementCc: '1998',
    powerHp: '150',
    manufactureDate: '2021-01',
    freight: '1000',
    insurance: '100',
  }))
    await fillIfVisible(scope, name, value);
  for (const [name, value] of [
    ['condition', 'used'],
    ['steering', 'left'],
  ]) {
    const field = scope.locator(`[name="${name}"]`);
    if (await field.isVisible()) await field.selectOption(value);
  }
}

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: an explicit mL configuration supplies the missing displacement to the detail and calculators`, async ({ page, request }) => {
    await setPublicFixtureState(request, { estimateDisplacementMl: 'configuration' });
    await page.goto(`/${locale}/cars/fixture_car_1/`);
    const detail = page.locator('[data-vehicle-fact="displacementCc"] dd');
    await expect(detail).toHaveText(`${new Intl.NumberFormat(locale).format(1197)} cm³`);
    const budget = page.getByTestId('vehicle-import-estimate');
    await expect(budget.locator('[name="displacementCc"]')).toHaveValue('1197');
    await budget.getByTestId('vehicle-full-calculator').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/calculator/russia/`));
    await expect(page.locator('[name="displacementCc"]')).toHaveValue('1197');
  });

  test(`${locale}: detail budget preserves direct hp and withholds an unverified Russian total`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/${locale}/cars/fixture_car_1/`);
    const budget = page.getByTestId('vehicle-import-estimate');
    await expect(budget.locator('[name^="customsDate"]')).toHaveCount(0);
    const manufacture = budget.locator('[name="manufactureDate"]');
    await expect(manufacture).toHaveValue('');
    await expect(manufacture).not.toHaveAttribute('aria-describedby');
    await expect(budget.locator('[name="displacementCc"]')).toHaveValue('1998');
    await expect(budget.locator('[name="powerHp"]')).toHaveValue('150');
    await expect(budget.getByTestId('manufacture-range-total')).toHaveCount(0);
    await budget.locator('[name="powertrain"]').selectOption('');
    const status = budget.getByTestId('inline-estimate-status');
    await expect(status.getByRole('listitem')).toHaveCount(1);
    await expect(status).toHaveCSS('background-color', 'rgb(45, 32, 21)');
    await expect(budget.getByTestId('inline-estimate-result')).toHaveCount(0);
    await complete(budget, 'RU');
    await expect(budget.getByTestId('inline-estimate-total')).toHaveCount(0);
    await expect(manufacture).not.toHaveAttribute('aria-describedby');
    await expect(budget.locator('details[open]')).toHaveCount(1);
    const toggle = budget.locator('.fee-detail-toggle').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(budget.locator('.fee-method-description').first()).not.toBeEmpty();
    await expect(budget.locator('.fee-formula').first()).toContainText('=');
    expect(errors).toEqual([]);
  });
}

test('verified 265 kW engine power prefills the inline and full calculators', async ({ page, request }) => {
  await setPublicFixtureState(request, { estimateEnginePower: true });
  await page.goto('/zh/cars/fixture_car_1/');
  const budget = page.getByTestId('vehicle-import-estimate');
  const power = budget.locator('[name="powerHp"]');
  await expect(page.locator('[data-vehicle-fact="engineKw"] dd')).toHaveText('265 kW');
  await expect(page.locator('[data-vehicle-fact="systemKw"] dd')).toHaveText('395 kW');
  await expect(power).toHaveValue('360.2993');
  await budget.getByTestId('vehicle-full-calculator').click();
  await expect(page.locator('[name="powerHp"]')).toHaveValue('360.2993');
  await page.reload();
  await expect(page.locator('[name="powerHp"]')).toHaveValue('360.2993');
  await page.locator('#powertrainDetail').selectOption('bev');
  await expect(page.locator('[name="powerHp"]')).toHaveValue('');
  await page.locator('[name="powerHp"]').fill('160');
  await page.locator('#powertrainDetail').selectOption('phev');
  await page.locator('#powertrainDetail').selectOption('bev');
  await expect(page.locator('[name="powerHp"]')).toHaveValue('160');
  await page.goto('/zh/cars/fixture_car_1/');
  await budget.locator('[name="powertrain"]').selectOption('bev');
  await expect(power).toHaveValue('');
});

test('the estimate prefers an authoritative displacement and does not prefill machine-only evidence', async ({ page, request }) => {
  const field = page.getByTestId('vehicle-import-estimate').locator('[name="displacementCc"]');
  await setPublicFixtureState(request, { estimateDisplacementMl: 'structured' });
  await page.goto('/zh/cars/fixture_car_1/');
  await expect(field).toHaveValue('1998');
  await setPublicFixtureState(request, { estimateDisplacementMl: 'machine' });
  await page.reload();
  await expect(page.locator('[data-vehicle-fact="displacementCc"] dd')).toContainText('1,197 cm³');
  await expect(field).toHaveValue('');
});

for (const [code, slug] of Object.entries({
  RU: 'russia',
  KZ: 'kazakhstan',
  TJ: 'tajikistan',
  UZ: 'uzbekistan',
  GE: 'georgia',
  AM: 'armenia',
  KG: 'kyrgyzstan',
  AL: 'albania',
})) {
  test(`${code}: edited inline facts and both currencies survive opening and refreshing the full calculator`, async ({
    page,
  }) => {
    await page.goto('/en/cars/fixture_car_1/');
    const budget = page.getByTestId('vehicle-import-estimate');
    await complete(budget, code);
    if (code === 'TJ') {
      await expect(budget.getByLabel('Customs value', { exact: true })).toHaveValue('25000');
      await expect(budget.locator('[name="tjExciseMinimum"]')).toHaveValue('0.20');
      await expect(budget.locator('[name="freight"], [name="insurance"]')).toHaveCount(0);
    }
    const withTotal = ['TJ', 'UZ', 'GE'].includes(code);
    const total = withTotal ? compact(await budget.getByTestId('inline-estimate-total').innerText()) : null;
    const usd = withTotal ? compact(await budget.getByTestId('inline-estimate-usd').innerText()) : null;
    if (!withTotal) await expect(budget.getByTestId('inline-estimate-total')).toHaveCount(0);
    const link = budget.getByTestId('vehicle-full-calculator');
    await expect(link).toHaveAttribute('href', /#hd-estimate=/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/en/calculator/${slug}/$`));
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await page.reload();
      if (withTotal) {
        await expect.poll(async () => compact(await page.getByTestId('total').innerText())).toBe(total);
        expect(compact(await page.getByTestId('total-usd').innerText())).toBe(usd);
      } else {
        await expect(page.getByTestId('result-status')).toBeVisible();
        await expect(page.getByTestId('total')).toHaveCount(0);
      }
      await expect(page.locator('#customsDate')).toHaveCount(0);
    }
  });
}

test('unknown choices stay empty through the explicit seed, storage and reload', async ({
  page,
}) => {
  await page.goto('/en/cars/fixture_demo/');
  const budget = page.getByTestId('vehicle-import-estimate');
  await chooseVehicleDestination(budget, 'GE');
  await budget.locator('[name="powertrain"]').selectOption('');
  await expect(budget.locator('[name="steering"]')).toHaveValue('');
  await budget.getByTestId('vehicle-full-calculator').click();
  await expect(page).toHaveURL(/\/en\/calculator\/georgia\/$/);
  for (let i = 0; i < 2; i++) {
    if (i) await page.reload();
    await expect(page.locator('#powertrainDetail')).toHaveValue('');
    await expect(page.locator('#steering')).toHaveValue('');
    await expect(page.locator('#manufactureDate')).toHaveValue('');
    await expect(page.getByTestId('total')).toHaveCount(0);
  }
});

test('a quote link opened after Shanghai midnight keeps vehicle facts and uses the new visit date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-31T15:59:59Z'));
  await page.goto('/en/cars/fixture_car_1/');
  const budget = page.getByTestId('vehicle-import-estimate');
  await complete(budget, 'RU');
  const href = await budget.getByTestId('vehicle-full-calculator').getAttribute('href');
  expect(href).toContain('#hd-estimate=');
  await page.clock.setFixedTime(new Date('2026-12-31T16:00:00Z'));
  await page.goto(href!);
  await expect(page.locator('#manufactureDate')).toHaveValue('2021-01');
  await expect(page.locator('[name^="customsDate"]')).toHaveCount(0);
  await expect(page.getByTestId('result-status')).toContainText('2026');
  await expect(page.getByTestId('total')).toHaveCount(0);
});

test('a supplier range uses six January dates in both calculators, on reload and in the copied quote', async ({ page, context, request }) => {
  await setPublicFixtureState(request, { estimateDateRange: true });
  await page.goto('/en/cars/fixture_car_1/');
  const budget = page.getByTestId('vehicle-import-estimate');
  await chooseVehicleDestination(budget, 'GE');
  await budget.locator('[name="powertrain"]').selectOption('petrol');
  await budget.locator('[name="steering"]').selectOption('left');
  const bounds = budget.getByTestId('manufacture-range-total');
  await expect(bounds).toBeVisible();
  const before = compact(await bounds.innerText());
  const note = '2021-01 to 2026-01, 6 scenarios';
  await expect(budget.getByTestId('manufacture-range-result')).toContainText(note);
  const lower = budget.locator('[data-range-scenario="minimum"]');
  const upper = budget.locator('[data-range-scenario="maximum"]');
  await expect(lower.locator('summary')).toContainText('Lowest cost');
  await expect(upper.locator('summary')).toContainText('Highest cost');
  const lowerAmount = await lower.locator('summary strong').innerText();
  const upperAmount = await upper.locator('summary strong').innerText();
  const lowerMonth = await lower.locator('summary time').innerText();
  const upperMonth = await upper.locator('summary time').innerText();
  expect(Number(lowerAmount.replace(/[^\d.]/g, ''))).toBeLessThan(Number(upperAmount.replace(/[^\d.]/g, '')));
  await upper.locator('summary').click();
  await expect(upper.getByTestId('fee-detail-toggle').first()).toBeVisible();
  await expect(budget.locator('[name="manufactureDate"]')).toHaveValue('');
  await budget.getByTestId('vehicle-full-calculator').click();
  await expect(page).toHaveURL(/\/en\/calculator\/georgia\/$/);
  const month = page.locator('#manufactureDate');
  for (let visit = 0; visit < 2; visit++) {
    if (visit) await page.reload();
    await expect(month).toHaveValue('');
    await expect.poll(async () => compact(await page.getByTestId('manufacture-range-total').innerText())).toBe(before);
    await expect(page.getByTestId('manufacture-range-result')).toContainText(note);
    await expect(page.locator('[data-range-scenario]')).toHaveCount(2);
    await expect(page.locator('[data-range-scenario="minimum"] summary')).toContainText('Lowest cost');
    await expect(page.locator('[data-range-scenario="maximum"] summary')).toContainText('Highest cost');
    await expect(page.locator('[data-range-scenario="minimum"] summary strong')).toHaveText(lowerAmount);
    await expect(page.locator('[data-range-scenario="maximum"] summary strong')).toHaveText(upperAmount);
    await expect(page.locator('[data-range-scenario="minimum"] summary time')).toHaveText(lowerMonth);
    await expect(page.locator('[data-range-scenario="maximum"] summary time')).toHaveText(upperMonth);
  }
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy estimate' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Lowest cost');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Highest cost');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(note);
  for (const [productionMonth, expectedAmount] of [[lowerMonth, lowerAmount], [upperMonth, upperAmount]]) {
    await fillNumericDate(page, 'manufactureDate', productionMonth);
    await expect(month).not.toHaveAttribute('aria-describedby');
    await expect(page.getByTestId('manufacture-range-result')).toHaveCount(0);
    await expect.poll(async () => compact(await page.getByTestId('total').innerText())).toBe(compact(expectedAmount));
  }
  await fillNumericDate(page, 'manufactureDate', '');
  await expect(page.getByTestId('manufacture-range-result')).toContainText(note);
});

test('Russian detail budget fits a 320px screen and works without inventing missing vehicle facts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/ru/cars/fixture_car_1/');
  const budget = page.getByTestId('vehicle-import-estimate');
  await complete(budget, 'RU');
  await budget.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await budget.getByTestId('vehicle-full-calculator').click();
  await expect(page.getByTestId('verified-fee-items')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test.describe('touch destination picker', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a tap changes the destination even when the summary loses focus before the click', async ({ page }) => {
    await page.goto('/en/cars/fixture_car_1/');
    const budget = page.getByTestId('vehicle-import-estimate');
    const picker = budget.getByTestId('vehicle-destination-picker');
    const details = picker.locator('..');
    await expect(budget).toHaveAttribute('data-country-ready', 'true');
    await expect(picker).toHaveAttribute('aria-disabled', 'false');
    await picker.tap();
    await expect(details).toHaveAttribute('open', '');
    await picker.focus();
    await expect(picker).toBeFocused();
    const kazakhstan = budget.locator('[data-country-option="KZ"]');
    // Reproduce WebKit's null-relatedTarget focus loss before a touch click.
    await kazakhstan.evaluate((option) => option.addEventListener('pointerdown', () => {
      option.closest('details')?.querySelector('summary')?.blur();
    }, { once: true }));
    await kazakhstan.tap();
    await expect(budget).toHaveAttribute('data-country', 'KZ');
    await expect(details).not.toHaveAttribute('open');
    await fillNumericDate(budget, 'manufactureDate', '2024-02');
    await expect(budget.getByTestId('inline-verified-fee-items')).toContainText('KZT');

    await picker.tap();
    await expect(details).toHaveAttribute('open', '');
    await budget.locator('[id$="-country-label"]').tap();
    await expect(details).not.toHaveAttribute('open');
    await expect(budget).toHaveAttribute('data-country', 'KZ');
  });
});

test('the import calculator stays usable on both sides of the two-column breakpoints', async ({ page }) => {
  await page.goto('/en/cars/fixture_car_1/');
  const calculator = page.getByRole('complementary', { name: 'Import cost calculator' });
  const contacts = page.locator('#vehicle-contact-fixture_car_1 [data-vehicle-contacts="fixture_car_1"]');
  await expect(contacts).toHaveCount(1);
  await expect(contacts.locator('a[href^="https://t.me/HD_Auto_CN?"]')).toHaveCount(1);
  await expect(contacts.locator('a[href^="https://wa.me/8618215932610?"]')).toHaveCount(1);
  const heading = page.locator('main h1');
  const destination = calculator.getByTestId('vehicle-destination-picker');
  for (const width of [1023, 1024, 1180, 1279, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(calculator).toBeVisible();
    await expect(destination).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 1024 && width < 1280) {
      const [form, title, inquiry] = await Promise.all([calculator.boundingBox(), heading.boundingBox(), contacts.boundingBox()]);
      expect(form!.x).toBeGreaterThan(title!.x);
      expect(form!.y).toBeGreaterThan(inquiry!.y + inquiry!.height);
    }
  }
  await page.setViewportSize({ width: 1180, height: 1000 });
  await chooseVehicleDestination(calculator, 'KZ');
  await fillNumericDate(calculator, 'manufactureDate', '2024-02');
  await expect(calculator.getByTestId('inline-verified-fee-items')).toContainText('KZT');

  const summary = page.locator('main summary').filter({ hasText: 'Detailed vehicle information' });
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  const location = summary.locator('..').locator('dt').filter({ hasText: /^Location$/ }).locator('..');
  await expect(location.locator('dd')).toHaveText('China');
  await expect(location.locator('dd')).toHaveAttribute('lang', 'en');
});

test('manual inline exchange rates are labelled and explicitly transferred', async ({ page }) => {
  await page.goto('/en/cars/fixture_car_1/');
  const budget = page.getByTestId('vehicle-import-estimate');
  await complete(budget, 'UZ');
  await budget.locator('[name="transactionRate"]').fill('91.1234');
  await expect(budget.getByTestId('inline-fx-status')).toContainText(
    'Using your manually entered reference rates',
  );
  const total = compact(await budget.getByTestId('inline-estimate-total').innerText());
  await budget.getByTestId('vehicle-full-calculator').click();
  await expect(page.locator('#transactionRate')).toHaveValue('91.12');
  await page.locator('#transactionRate').focus();
  await expect(page.locator('#transactionRate')).toHaveValue('91.1234');
  await expect.poll(async () => compact(await page.getByTestId('total').innerText())).toBe(total);
});
