import { expect, test, type Locator, type Page } from '@playwright/test';

// These checks exercise the public page. Financial fixtures remain in calculator.spec.ts;
// this file verifies that the explanation, substituted formula and receipt stay in sync.
async function openCalculator(page: Page, country: string, locale = 'zh') {
  await page.goto(`/${locale}/calculator/${country}`);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await page.locator('#customsDate').fill('2026-10-22');
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
  { country: 'KZ', slug: 'kazakhstan', locale: 'en', lines: 9 },
  { country: 'UZ', slug: 'uzbekistan', locale: 'ru', lines: 5 },
  { country: 'GE', slug: 'georgia', locale: 'zh', lines: 5 },
  { country: 'AM', slug: 'armenia', locale: 'ru', lines: 4 },
  { country: 'KG', slug: 'kyrgyzstan', locale: 'en', lines: 4 },
  { country: 'AL', slug: 'albania', locale: 'zh', lines: 5 },
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
        /=.+(?:RUB|KZT|UZS|GEL|AMD|KGS|ALL)/,
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
  await page.locator('#manufactureDate').fill('2020-01');
  const duty = method(page, 'AM.dutyMiddle');
  await expect(duty.locator('.fee-method-description')).toContainText('20 AMD');
  await expect(duty.locator('.fee-method-description')).toContainText('取较大值 879.12 AMD');
  await expect(duty.getByTestId('fee-formula').locator('code')).toContainText('879 AMD');
  await page.locator('#price').fill('10000');
  await expect(duty.locator('.fee-method-description')).toContainText('2,000 AMD');
  await expect(duty.locator('.fee-method-description')).toContainText('取较大值 2,000 AMD');
  await expect(duty.getByTestId('fee-formula').locator('code')).toContainText('2,000 AMD');
  await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('取较大值 2,000 AMD');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('代入公式:');
  expect(copied).not.toMatch(/\bround2?\(|clearance_band\(/);
});

test('Armenia environmental explanation and receipt switch through 0, 2, 10 and 20 percent without stale text', async ({
  page,
}) => {
  await openCalculator(page, 'armenia');
  const stamp = page.getByTestId('result-stamp');
  for (const [manufacture, key, condition, expected] of [
    ['2021-01', 'AM.environmentalYoung', 'environmentNone', '未超过 5 年'],
    ['2020-01', 'AM.environmental', 'environment2', '本车命中 2% 档'],
    ['2015-01', 'AM.environmental', 'environment10', '本车命中 10% 档'],
    ['2010-01', 'AM.environmental', 'environment20', '本车命中 20% 档'],
    ['2021-01', 'AM.environmentalYoung', 'environmentNone', '未超过 5 年'],
  ]) {
    await page.locator('#manufactureDate').fill(manufacture);
    await expectStamp(stamp, { condition });
    const explanation = method(page, key).locator('.fee-method-description');
    await expect(explanation).toContainText(expected);
    if (key === 'AM.environmentalYoung') {
      await expect(method(page, 'AM.environmental')).toHaveCount(0);
      await expect(explanation).not.toContainText('本车命中 20% 档');
    }
  }
});

test('Russia receipt follows the exact 36 and 60 month boundaries and clears the old band when inputs are missing', async ({
  page,
}) => {
  await openCalculator(page, 'russia', 'en');
  await fixedValueInputs(page, '10000');
  const stamp = page.getByTestId('result-stamp');
  for (const [manufacture, band, dutyMethod] of [
    ['2023-11', 'under3', 'RU.dutyYoung'],
    ['2023-10', 'ruMiddle', 'RU.dutyMiddle'],
    ['2021-10', 'fivePlus', 'RU.dutyOld'],
  ]) {
    await page.locator('#manufactureDate').fill(manufacture);
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
  await expectStamp(stamp, { title: 'personalTariff', band: 'fivePlus', tone: 'gold' });
});

test('Uzbekistan switches never-registered 12-month bands and used-car methods with the matching receipt', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan', 'en');
  await page.locator('#condition').selectOption('new');
  await page.locator('#manufactureDate').fill('2025-10');
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'newUnder12', band: 'recyclingUpTo36', tone: 'green' });
  await expect(method(page, 'UZ.dutyNewYoung').locator('.fee-method-description')).toContainText(
    '12 months',
  );
  await page.locator('#manufactureDate').fill('2025-09');
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
  await expectStamp(stamp, { title: 'personalSchedule', band: 'kgPersonalMiddle' });
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
    'База НДС юрлица',
  );
  await expect(method(page, 'KG.vatPersonal')).toHaveCount(0);
  await expect(extra).toHaveCount(0);
});

test('Georgia left-hand hybrid relief and right-hand tripling never leave conflicting methods or receipt labels', async ({
  page,
}) => {
  await openCalculator(page, 'georgia');
  await page.locator('#manufactureDate').fill('2020-01');
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
    '不叠加左舵混动优惠',
  );
  await page.locator('#steering').selectOption('left');
  await expectStamp(stamp, { title: 'hybridRelief', condition: 'leftHand', tone: 'green' });
  await expect(method(page, 'GE.exciseRight')).toHaveCount(0);
});

test('Albania luxury receipt follows the charged fee for displacement and value, and clears when neither triggers', async ({
  page,
}) => {
  await openCalculator(page, 'albania', 'en');
  await fixedValueInputs(page, '100000');
  await page.locator('#displacementCc').fill('2999');
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'vat20', condition: 'registrationIncluded' });
  await expect(method(page, 'AL.luxuryBelow')).toBeVisible();
  await page.locator('#displacementCc').fill('3000');
  await expectStamp(stamp, { title: 'luxurySchedule', condition: 'annualTaxExtra' });
  await expect(
    method(page, 'AL.luxuryDisplacement').locator('.fee-method-description'),
  ).toContainText('3,000 cc threshold');
  await expect(
    method(page, 'AL.luxuryDisplacement').getByTestId('fee-formula').locator('code'),
  ).toContainText('70,000 ALL');
  await expect(method(page, 'AL.annualLuxury').locator('.fee-method-description')).toContainText(
    'excluded from the one-time import-fee total',
  );
  await page.locator('#displacementCc').fill('2999');
  await expectStamp(stamp, { title: 'vat20', condition: 'registrationIncluded' });
  await expect(method(page, 'AL.annualLuxury')).toHaveCount(0);
  await page.locator('#price').fill('5000000');
  await expectStamp(stamp, { title: 'luxurySchedule', condition: 'annualTaxExtra' });
  await expect(method(page, 'AL.luxuryValue').locator('.fee-method-description')).toContainText(
    'ALL 5,000,000 threshold',
  );
});

test('360px Russian Armenia keeps the long explanation, formula and changing receipt within the result panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await openCalculator(page, 'armenia', 'ru');
  await fixedValueInputs(page, '10000');
  await page.locator('#manufactureDate').fill('2020-01');
  await expect(method(page, 'AM.dutyMiddle').locator('.fee-method-description')).toHaveText(
    /.{200,}/,
  );
  await expect(
    method(page, 'AM.dutyMiddle').getByTestId('fee-formula').locator('code'),
  ).toContainText('AMD');
  const stamp = page.getByTestId('result-stamp');
  await expectStamp(stamp, { title: 'commonTariff', band: 'amMiddle', condition: 'environment2' });
  await expect(stamp).toHaveAttribute('aria-label', /Экосбор · 2%/);
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
