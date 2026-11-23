import { expect, test, type Locator, type Page } from '@playwright/test';
import { fillNumericDate } from './helpers/numeric-date';

// These checks exercise the public page. Financial fixtures remain in calculator.spec.ts;
// this file verifies that the explanation, substituted formula and receipt stay in sync.
async function openCalculator(page: Page, country: string, locale = 'zh') {
  await page.clock.setFixedTime(new Date('2026-10-22T04:00:00Z'));
  await page.goto(`/${locale}/calculator/${country}`);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await fillNumericDate(page, 'customsDate', '2026-10-22');
  if (await page.locator('#manufactureDate').count()) await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expect(page.getByTestId('total')).toBeVisible();
  // Explanations are intentionally collapsed in the initial quote. These checks
  // exercise their contents; the default and independent controls live in fee-details.spec.ts.
  await page.getByTestId('toggle-all-fee-details').click();
}

function method(page: Page, key: string) {
  return page.locator(`[data-testid="fee-method"][data-method-key="${key}"]`);
}

async function fixedValueInputs(page: Page, price: string, euroRate = '1') {
  await page.locator('.currency-select').selectOption('USD');
  await page.locator('#price').fill(price);
  await page.locator('#transactionRate').fill('1');
  if (await page.locator('#euroRate').count()) await page.locator('#euroRate').fill(euroRate);
  if (await page.locator('#freight').count()) await page.locator('#freight').fill('0');
  if (await page.locator('#insurance').count()) await page.locator('#insurance').fill('0');
}

async function expectStamp(
  stamp: Locator,
  values: { title?: string; band?: string; condition?: string; tone?: string },
) {
  await expect(stamp).toBeVisible();
  for (const [name, value] of Object.entries(values))
    await expect(stamp).toHaveAttribute(`data-stamp-${name}`, value);
}

const countries = [
  { country: 'RU', slug: 'russia', locale: 'zh', lines: 3 },
  { country: 'KZ', slug: 'kazakhstan', locale: 'en', lines: 5 },
  { country: 'UZ', slug: 'uzbekistan', locale: 'ru', lines: 4 },
  { country: 'GE', slug: 'georgia', locale: 'zh', lines: 4 },
  { country: 'AM', slug: 'armenia', locale: 'ru', lines: 4 },
  { country: 'KG', slug: 'kyrgyzstan', locale: 'en', lines: 4 },
  { country: 'AL', slug: 'albania', locale: 'zh', lines: 4 },
] as const;

for (const fixture of countries) {
  test(`${fixture.country} ${fixture.locale}: every main fee explains the applied method and substituted formula`, async ({
    page,
  }) => {
    await openCalculator(page, fixture.slug, fixture.locale);
    const rows = page.locator('.fee-lines > .fee-line');
    await expect(rows).toHaveCount(fixture.lines);
    await expectStamp(page.getByTestId('result-stamp'), { tone: 'gold' });
    for (let index = 0; index < fixture.lines; index++) {
      const row = rows.nth(index);
      const explanation = row.getByTestId('fee-method');
      await expect(explanation).toHaveAttribute(
        'data-method-key',
        new RegExp(`^${fixture.country}\\.`),
      );
      await expect(explanation.locator('.fee-method-description')).toHaveText(/.{20,}/);
      await expect(row.getByTestId('fee-formula').locator('code')).toHaveText(
        fixture.country === 'KG' ? /[=≈].+KGS/ : /=.+(?:RUB|KZT|UZS|GEL|AMD|ALL)/,
      );
      await expect(explanation).not.toContainText(
        /\bround2?\(|clearance_band\(|FeeMethods\.|\{\w+\}/,
      );
    }
    const stamp = page.getByTestId('result-stamp');
    await expect(stamp).toHaveAttribute('role', 'img');
    await expect(stamp).toHaveAttribute('aria-label', /2026/);
  });
}

test('Armenia explains both winners of the minimum comparison and copies the explanation with its formula', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCalculator(page, 'armenia');
  await fixedValueInputs(page, '100');
  await fillNumericDate(page, 'manufactureDate', '2025-01');
  await page.locator('#displacementCc').fill('100');
  const duty = method(page, 'AM.unifiedYoung');
  await expect(duty.locator('.fee-method-description')).toContainText('54%');
  await expect(duty.getByTestId('fee-formula').locator('code')).toContainText('250 AMD');
  await page.locator('#price').fill('8000');
  await expect(duty.locator('.fee-method-description')).toContainText('2.5');
  await expect(duty.getByTestId('fee-formula').locator('code')).toContainText('4,320 AMD');
  await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('4,320 AMD');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('代入公式:');
  expect(copied).not.toMatch(/\bround2?\(|clearance_band\(/);
});

test('Armenia reports the current environmental bands up and back down in both the receipt and explanation', async ({ page }) => {
  await openCalculator(page, 'armenia');
  for (const [manufacture, rate] of [
    ['2025-01', 2], ['2021-01', 4], ['2020-01', 6], ['2015-01', 12], ['2010-01', 24], ['2025-01', 2],
  ] as const) {
    await fillNumericDate(page, 'manufactureDate', manufacture);
    const stamp = page.getByTestId('result-stamp');
    await expectStamp(stamp, { condition: 'environmentRate' });
    await expect(stamp).toHaveAttribute('aria-label', new RegExp(`环保税 · ${rate}%`));
    await expect(method(page, 'AM.importEnvironment').locator('.fee-method-description')).toContainText(`${rate}%`);
  }
});

test('Russia receipt follows the exact 36 and 60 month boundaries and clears the old band when inputs are missing', async ({
  page,
}) => {
  await openCalculator(page, 'russia', 'en');
  await fixedValueInputs(page, '10000');
  const stamp = page.getByTestId('result-stamp');
  for (const [manufacture, band, dutyMethod] of [
    ['2023-11', 'upTo3', 'RU.unifiedYoung'],
    ['2023-10', 'kgPersonalMiddle', 'RU.unifiedUsed'],
    ['2021-10', 'over5', 'RU.unifiedUsed'],
  ]) {
    await fillNumericDate(page, 'manufactureDate', manufacture);
    await expectStamp(stamp, { title: 'personalTariff', band });
    await expect(method(page, dutyMethod)).toBeVisible();
  }
  await page.locator('#price').fill('');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expectStamp(stamp, {
    title: 'pending',
    band: 'completeInputs',
    condition: '',
    tone: 'muted',
  });
  await expect(stamp).not.toContainText('≥ 5 years');
  await expect(page.getByTestId('fee-method')).toHaveCount(0);
  await page.locator('#price').fill('180000');
  await expectStamp(stamp, { title: 'personalTariff', band: 'over5', tone: 'gold' });
});

test('Uzbekistan switches never-registered 12-month bands and used-car methods with the matching receipt', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan', 'en');
  await page.locator('#condition').selectOption('new');
  await fillNumericDate(page, 'manufactureDate', '2025-11');
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'newUnder12', band: 'recyclingUpTo36', tone: 'green' });
  await expect(method(page, 'UZ.dutyNewYoung').locator('.fee-method-description')).toContainText(
    '11 months',
  );
  await fillNumericDate(page, 'manufactureDate', '2025-09');
  await expectStamp(stamp, { title: 'newOver12', tone: 'green' });
  await expect(method(page, 'UZ.dutyNewYoung')).toHaveCount(0);
  await expect(method(page, 'UZ.dutyNewOld').locator('.fee-method-description')).toContainText(
    '13 months',
  );
  await page.locator('#condition').selectOption('used');
  await expectStamp(stamp, { title: 'used', tone: 'gold' });
  await expect(method(page, 'UZ.dutyNewOld')).toHaveCount(0);
  await expect(method(page, 'UZ.dutyUsed').locator('.fee-method-description')).toContainText(
    'registered combustion vehicle',
  );
});

test('Kyrgyzstan identity changes the receipt, VAT explanation and excluded first-registration explanation', async ({
  page,
}) => {
  await openCalculator(page, 'kyrgyzstan', 'ru');
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'personalSchedule', band: 'over5' });
  await expect(method(page, 'KG.vatPersonal').locator('.fee-method-description')).toContainText(
    'повторно',
  );
  const extra = page
    .getByTestId('additional-costs')
    .locator('[data-extra-cost="registrationEstimate"]');
  await expect(extra.getByTestId('fee-method')).toHaveAttribute(
    'data-method-key',
    'KG.registrationEstimate',
  );
  await expect(extra.locator('.fee-method-description')).toContainText(
    'не официально начисленная сумма',
  );
  await expect(extra.locator('.fee-method-description')).toContainText('не входит в итог');
  await expect(extra.getByTestId('fee-formula').locator('code')).toContainText('KGS');
  await page.locator('#importerType').selectOption('company');
  await expectStamp(stamp, { title: 'companySchedule', band: 'kgCompanyMiddle' });
  await expect(method(page, 'KG.dutyCompanyMiddle')).toBeVisible();
  await expect(method(page, 'KG.vat').locator('.fee-method-description')).toContainText(
    'НДС 12%',
  );
  await expect(method(page, 'KG.vatPersonal')).toHaveCount(0);
  await expect(extra).toHaveCount(0);
});

test('Georgia left-hand hybrid relief and right-hand tripling never leave conflicting methods or receipt labels', async ({
  page,
}) => {
  await openCalculator(page, 'georgia');
  await fillNumericDate(page, 'manufactureDate', '2020-01');
  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'hybridRelief', condition: 'leftHand', tone: 'green' });
  await expect(
    method(page, 'GE.exciseHybridRelief').locator('.fee-method-description'),
  ).toContainText('减免 60%');
  await page.locator('#steering').selectOption('right');
  await expectStamp(stamp, { title: 'rightHandSchedule', condition: 'rightHand', tone: 'gold' });
  await expect(method(page, 'GE.exciseHybridRelief')).toHaveCount(0);
  await expect(method(page, 'GE.exciseRight').locator('.fee-method-description')).toContainText(
    '3 倍',
  );
  await expect(method(page, 'GE.exciseRight').locator('.fee-method-description')).toContainText(
    '实报排量 1,998 cc',
  );
  await page.locator('#steering').selectOption('left');
  await expectStamp(stamp, { title: 'hybridRelief', condition: 'leftHand', tone: 'green' });
  await expect(method(page, 'GE.exciseRight')).toHaveCount(0);
});

test('Albania separates conditional luxury registration and annual costs until eligibility is established', async ({ page }) => {
  await openCalculator(page, 'albania', 'en');
  await fixedValueInputs(page, '100000');
  const stamp = page.getByTestId('result-stamp');
  await page.locator('#displacementCc').fill('2999');
  await expectStamp(stamp, { title: 'vat20', condition: 'registrationIncluded' });
  await expect(page.getByTestId('additional-costs')).toHaveCount(0);
  await page.locator('#displacementCc').fill('3000');
  await expectStamp(stamp, { title: 'vat20', condition: 'registrationIncluded' });
  const extra = page.getByTestId('additional-costs');
  const luxury = extra.locator('[data-extra-cost="luxuryOnce"]');
  const annual = extra.locator('[data-extra-cost="annualLuxury"]');
  await expect(luxury.locator('strong').first()).toContainText('70,000');
  await expect(annual.locator('strong').first()).toContainText('21,000');
  await page.locator('#displacementCc').fill('2999');
  await expect(extra).toHaveCount(0);
  await page.locator('#price').fill('5000000');
  if (!(await method(page, 'AL.luxuryConditional').isVisible())) await luxury.locator('button').click();
  await expect(method(page, 'AL.luxuryConditional').locator('.fee-method-description')).toContainText('at most seven seats');
  await expect(method(page, 'AL.luxuryConditional').getByTestId('fee-formula').locator('code')).toContainText('70,000 ALL');
});

test('360px Russian Armenia keeps the long explanation, formula and changing receipt within the result panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await openCalculator(page, 'armenia', 'ru');
  await fixedValueInputs(page, '10000');
  await fillNumericDate(page, 'manufactureDate', '2020-01');
  await expect(method(page, 'AM.unifiedUsed').locator('.fee-method-description')).toHaveText(
    /1[\s\u00a0]?998.*4[,.]8/,
  );
  await expect(
    method(page, 'AM.unifiedUsed').getByTestId('fee-formula').locator('code'),
  ).toContainText('AMD');
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'personalTariff', band: 'over5', condition: 'environmentRate' });
  await expect(stamp).toHaveAttribute('aria-label', /Экосбор · 6%/);
  await stamp.scrollIntoViewIfNeeded();
  const heading = await page.locator('#result-title').boundingBox();
  const receipt = await stamp.boundingBox();
  expect(heading).not.toBeNull();
  expect(receipt).not.toBeNull();
  expect(heading!.x + heading!.width).toBeLessThanOrEqual(receipt!.x + 4);
  for (const block of await page.getByTestId('fee-method').all()) {
    await block.scrollIntoViewIfNeeded();
    const bounds = await block.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(361);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
  }
});
