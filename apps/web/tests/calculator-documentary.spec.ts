import { expect, test, type Locator } from '@playwright/test';
import { chooseVehicleDestination } from './helpers/vehicle-destination';
import { fillNumericDate } from './helpers/numeric-date';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Uses only the isolated public vehicle fixture.');
test.beforeEach(async ({ page, request }) => {
  await setPublicFixtureState(request, { estimateDocumentary: true });
  await page.clock.setFixedTime(new Date('2026-11-23T04:00:00Z'));
});
test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

type Example = {
  name: string;
  car: number;
  country: string;
  rate: string;
  price: string;
  date?: string;
  amounts?: Record<string, number>;
  review?: RegExp;
};

const examples: Example[] = [
  { name: 'TJ electric on the documented anniversary', car: 16, country: 'TJ', rate: '10', price: '20000',
    amounts: { duty: 0, excise: 0, vat: 0, customsFee: 700, recycling: 11232 } },
  { name: 'TJ electric a day after the anniversary', car: 16, country: 'TJ', rate: '10', price: '20000',
    date: '2026-11-24', review: /production day/ },
  { name: 'AL documented never-registered zero-km electric', car: 16, country: 'AL', rate: '100', price: '10000',
    amounts: { vat: 0 } },
  { name: 'AL registered zero-km electric', car: 17, country: 'AL', rate: '100', price: '10000',
    amounts: { vat: 200000 } },
  { name: 'UZ new combustion on its first anniversary', car: 18, country: 'UZ', rate: '12000', price: '20000',
    amounts: { duty: 40800000 } },
  { name: 'UZ new combustion after its first anniversary', car: 18, country: 'UZ', rate: '12000', price: '20000',
    date: '2026-11-24', amounts: { duty: 93600000 } },
  { name: 'UZ new combustion day before third anniversary', car: 19, country: 'UZ', rate: '12000', price: '20000',
    date: '2026-11-22', amounts: { duty: 93600000 } },
  { name: 'UZ unclassified new combustion at age three', car: 19, country: 'UZ', rate: '12000', price: '20000',
    review: /tariff classification/ },
  { name: 'UZ first anniversary month without a day', car: 20, country: 'UZ', rate: '12000', price: '20000',
    review: /exact manufacture date/ },
  { name: 'UZ recycling boundary without a day', car: 21, country: 'UZ', rate: '12000', price: '20000',
    review: /exact manufacture date/ },
  { name: 'KZ BEV goods at the luxury threshold', car: 16, country: 'KZ', rate: '500', price: '155700',
    amounts: { duty: 11677500, luxuryExcise: 7785000 } },
];

async function verify(scope: Locator, example: Example, inline: boolean) {
  if (example.review) {
    await expect(scope.getByTestId(inline ? 'inline-estimate-status' : 'result-status')).toContainText(example.review);
    await expect(scope.getByTestId(inline ? 'inline-estimate-total' : 'total')).toHaveCount(0);
    return;
  }
  expect(example.amounts).toBeDefined();
  for (const [id, amount] of Object.entries(example.amounts!)) {
    const row = scope.locator(`button[aria-controls$="-${id}"] .fee-values strong`);
    await expect(row).toBeVisible();
    await expect.poll(async () => Number((await row.innerText()).replace(/[^0-9.]/g, ''))).toBe(amount);
  }
}

for (const example of examples) {
  test(`${example.name}: published facts survive the handoff to the standalone calculator`, async ({ page }) => {
    await page.goto(`/en/cars/fixture_car_${example.car}/`);
    const inline = page.getByTestId('vehicle-import-estimate');
    await chooseVehicleDestination(inline, example.country);
    await fillNumericDate(inline, 'customsDate', example.date ?? '2026-11-23');
    await inline.locator('select[name="currency"]').selectOption('USD');
    for (const [key, value] of Object.entries({
      price: example.price, freight: '0', insurance: '0', transactionRate: example.rate,
    })) {
      const field = inline.locator(`input[name="${key}"]`);
      if (await field.count()) { await field.fill(value); await field.blur(); }
    }
    await verify(inline, example, true);
    const fullLink = inline.getByTestId('vehicle-full-calculator');
    await expect(fullLink).toHaveAttribute('href', /#hd-estimate=/);
    await fullLink.click();
    const full = page.locator('main');
    await expect(full.locator('.reset-button')).toBeEnabled();
    await expect(full.locator('[name="customsDate"]')).toHaveValue(example.date ?? '2026-11-23');
    await verify(full, example, false);
  });
}
