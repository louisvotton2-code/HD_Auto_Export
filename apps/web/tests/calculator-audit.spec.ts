import { expect, test, type Locator } from '@playwright/test';
import { chooseVehicleDestination } from './helpers/vehicle-destination';
import { fillNumericDate } from './helpers/numeric-date';

type Example = {
  name: string; country: string; month?: string; day?: string; motor?: string; importer?: string; cc?: string;
  price?: string; hp?: string; fx?: string; eur?: string; steering?: string; freight?: string;
  lines: Record<string, number>; total?: number; review?: RegExp;
};
const examples: Example[] = [
  { name: 'personal over five years', country: 'KG', month: '2021-01', eur: '100', lines: { duty: 959040 } },
  { name: 'personal new with separate freight', country: 'KG', month: '2026-01', price: '10000', cc: '1000', fx: '100', eur: '100', freight: '1000', lines: { duty: 480000 } },
  { name: 'company after three years', country: 'KG', month: '2023-01', importer: 'company', price: '8750', fx: '100', eur: '100', lines: { duty: 175000, vat: 126000, customsFee: 3500 }, total: 304500 },
  { name: 'company processing fee floor', country: 'KG', month: '2022-01', importer: 'company', price: '1000', fx: '100', lines: { customsFee: 500 } },
  { name: 'used hybrid', country: 'UZ', month: '2022-10', motor: 'hev', cc: '1500', price: '20000', fx: '12000', lines: { duty: 72000000, vat: 37440000 } },
  { name: 'September EV recycling', country: 'UZ', month: '2025-01', motor: 'bev', lines: { recycling: 52800000 } },
  { name: 'electric recycling before September', country: 'UZ', month: '2025-01', day: '2026-08-31', motor: 'bev', lines: { recycling: 49440000 } },
  { name: 'exactly one million USD', country: 'UZ', month: '2025-01', motor: 'bev', price: '1000000', fx: '12000', lines: { customsFee: 11000000 } },
  { name: 'personal passenger declaration', country: 'KZ', month: '2022-11', cc: '1500', eur: '550', price: '20000', fx: '500', lines: { duty: 1402500 } },
  { name: 'standard EV goods declaration', country: 'KZ', month: '2025-01', motor: 'bev', price: '20000', fx: '500', lines: { duty: 1500000 } },
  { name: 'ordinary taxable vehicle', country: 'TJ', month: '2022-01', price: '20000', fx: '10', eur: '11', lines: { duty: 20000, excise: 28000, vat: 36390.48 }, total: 96322.48 },
  { name: 'factory-left petrol', country: 'TM', month: '2026-01', price: '20000', fx: '3.5', lines: { duty: 1400, excise: 2097.90 }, total: 3637.90 },
  { name: 'factory-left hybrid', country: 'TM', month: '2026-01', motor: 'hev', price: '20000', fx: '3.5', lines: { duty: 700 }, total: 2937.90 },
  { name: 'factory-left EV', country: 'TM', month: '2026-01', motor: 'bev', price: '20000', fx: '3.5', lines: { customsFee: 140 }, total: 140 },
  { name: 'fifth anniversary', country: 'RU', month: '2021-11', day: '2026-11-15', eur: '100', lines: { duty: 539460 } },
  { name: 'day after fifth anniversary', country: 'RU', month: '2021-11', day: '2026-11-16', eur: '100', lines: { duty: 959040 } },
  { name: '70 hp personal EV', country: 'RU', month: '2025-01', motor: 'bev', hp: '70', fx: '100', price: '20000', lines: { duty: 300000, vat: 506000, excise: 0, recycling: 3400 }, total: 822941 },
  { name: 'official 2500 cc 510 hp recycling fee', country: 'RU', month: '2025-01', cc: '2500', hp: '510', fx: '80', price: '25000', lines: { duty: 1375000, customsFee: 13541, recycling: 3448800 }, total: 4837341 },
  { name: 'official 2500 cc 500 hp recycling fee', country: 'RU', month: '2025-01', cc: '2500', hp: '500', fx: '80', price: '25000', lines: { recycling: 3316800 }, total: 4705341 },
  { name: '2500 cc high-power ambiguous anniversary', country: 'RU', month: '2023-11', cc: '2500', hp: '510', fx: '80', price: '25000', lines: {}, review: /three-year recycling fee boundary/ },
  { name: 'unrounded displacement', country: 'GE', month: '2021-01', lines: { excise: 2997, importTax: 124.88 }, total: 3271.88 },
  { name: 'right-hand EV', country: 'GE', month: '2021-01', motor: 'bev', steering: 'right', lines: { excise: 3000 }, total: 3150 },
  { name: 'personal union tariff plus environmental tax', country: 'AM', month: '2022-11', fx: '400', price: '10000', eur: '420', lines: { duty: 2265732, environmental: 160000 }, total: 2425732 },
  { name: 'older EV outside VAT relief', country: 'AM', month: '2021-01', motor: 'bev', price: '10000', fx: '400', lines: { duty: 600000, vat: 920000 } },
  { name: 'accepted customs valuation', country: 'AL', price: '3000', fx: '100', lines: { vat: 60000 }, total: 68500 },
];

async function verifyAmounts(scope: Locator, example: Example, totalId: string) {
  if (example.review) {
    const statusId = totalId === 'total' ? 'result-status' : 'inline-estimate-status';
    await expect(scope.getByTestId(statusId)).toContainText(example.review);
    await expect(scope.getByTestId(totalId)).toHaveCount(0);
    return;
  }
  for (const [id, amount] of Object.entries(example.lines)) {
    const output = scope.locator(`button[aria-controls$="-${id}"] .fee-values strong`);
    await expect.poll(async () => Number((await output.innerText()).replace(/[^0-9.]/g, ''))).toBe(amount);
  }
  if (example.total !== undefined)
    await expect.poll(async () => Number((await scope.getByTestId(totalId).innerText()).replace(/[^0-9.]/g, ''))).toBe(example.total);
}
for (const example of examples) {
  test(`reported example: ${example.country} ${example.name} in detail and standalone`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-23T04:00:00Z'));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/en/cars/fixture_car_1/');
    const inline = page.getByTestId('vehicle-import-estimate');
    await chooseVehicleDestination(inline, example.country);
    await expect(inline.locator('[name="customsDate"]')).toHaveValue('2026-12-07');
    await fillNumericDate(inline, 'customsDate', example.day ?? '2026-11-23');
    if (example.month) await fillNumericDate(inline, 'manufactureDate', example.month);
    for (const [field, value] of Object.entries({ powertrain: example.motor ?? 'petrol', importerType: example.importer ?? 'individual',
      condition: 'used', steering: example.steering ?? 'left', currency: 'USD' })) {
      const select = inline.locator(`select[name="${field}"]`);
      if (await select.count()) await select.selectOption(value);
    }
    for (const [field, value] of Object.entries({ price: example.price ?? '20000', powerHp: example.hp ?? '150',
      displacementCc: example.cc ?? '1998', freight: example.freight ?? '0', insurance: '0',
      transactionRate: example.fx ?? '100', euroRate: example.eur ?? '100' })) {
      const input = inline.locator(`input[name="${field}"]`);
      if (await input.count()) { await input.fill(value); await input.blur(); }
    }
    await verifyAmounts(inline, example, 'inline-estimate-total');
    await inline.getByTestId('vehicle-full-calculator').click();
    const full = page.locator('main');
    await expect(full.locator('.reset-button')).toBeEnabled();
    await expect(full.locator('[name="customsDate"]')).toHaveValue(example.day ?? '2026-11-23');
    await verifyAmounts(full, example, 'total');
    await page.reload();
    await expect(full.locator('.reset-button')).toBeEnabled();
    await expect(full.locator('[name="customsDate"]')).toHaveValue(example.day ?? '2026-11-23');
    expect(errors).toEqual([]);
  });
}
