import { expect, test, type Locator, type Page } from '@playwright/test';

// Fixed business examples form a public-page contract, independent of the
// policy implementation. Build-snapshot defaults deliberately do not fix totals.
// Every browser test gets a fresh sessionStorage.
test.beforeEach(async ({ page }) => {
  // The rules intentionally cover 2026 only; UI defaults must follow the browser clock.
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
});

const ruSample = {
  country: 'RU',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '25000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '150',
  manufactureDate: '2021-01',
  customsDate: '2026-10-22',
  freight: '',
  insurance: '',
  steering: 'left',
  transactionRate: '81.969182',
  euroRate: '94.7',
};

// Fixed outputs independently recorded from the reference site's public
// calculator. GE's binary-floating-point 1805.0000000000002 is exactly 1805 GEL.
// KG's target/USD rate is 0.865939 EUR/USD × 100.77 KGS/EUR.
const countryFixtures = [
  {
    country: 'RU',
    slug: 'russia',
    currency: 'RUB',
    price: '25000',
    transactionRate: '81.969182',
    euroRate: '94.7',
    freight: '',
    totals: ['926952', '926952', '2548125'],
  },
  {
    country: 'KZ',
    slug: 'kazakhstan',
    currency: 'KZT',
    price: '25000',
    transactionRate: '468.321957',
    euroRate: '541.1',
    freight: '',
    totals: ['7277481', '7277481', '3402156'],
  },
  {
    country: 'UZ',
    slug: 'uzbekistan',
    currency: 'UZS',
    price: '25000',
    transactionRate: '11851.454593',
    euroRate: '',
    freight: '2250',
    totals: ['355921427', '355921427', '129476657'],
  },
  {
    country: 'GE',
    slug: 'georgia',
    currency: 'GEL',
    price: '',
    transactionRate: '',
    euroRate: '',
    freight: '',
    totals: ['3605', '1805', '480'],
  },
  {
    country: 'AM',
    slug: 'armenia',
    currency: 'AMD',
    price: '9000',
    transactionRate: '366.081469',
    euroRate: '422.7',
    freight: '1100',
    totals: ['1626867', '1626867', '0'],
  },
  {
    country: 'KG',
    slug: 'kyrgyzstan',
    currency: 'KGS',
    price: '9000',
    transactionRate: '87.26067303',
    euroRate: '100.77',
    freight: '1100',
    totals: ['547138.77', '547138.77', '135725.09'],
  },
  {
    country: 'AL',
    slug: 'albania',
    currency: 'ALL',
    price: '9000',
    transactionRate: '80.7859',
    euroRate: '',
    freight: '1100',
    totals: ['171688', '171688', '171688'],
  },
] as const;
type CountryFixture = (typeof countryFixtures)[number];
const primaryPowertrains = [
  { value: 'petrol', label: '汽油 / 柴油' },
  { value: 'hev', label: '混合动力' },
  { value: 'bev', label: '纯电 BEV' },
] as const;

function digits(value: string) {
  return value.replace(/[^\d]/g, '');
}

async function expectAmount(page: Page, amount: string) {
  const total = page.getByTestId('total');
  await expect(total).toBeVisible();
  await expect
    .poll(async () => digits(await total.locator('strong').innerText()))
    .toBe(digits(amount));
}

async function expectUsdAmount(locator: Locator, amount: number) {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText('≈');
  await expect(locator).toContainText('USD');
  await expect
    .poll(async () => Number((await locator.innerText()).replace(/[^\d.]/g, '')))
    .toBe(amount);
}

async function openCalculator(page: Page, country = 'russia', locale = 'zh') {
  await page.goto(`/${locale}/calculator/${country}`);
  // Wait for draft restoration before interacting with the native details element.
  await expect(page.locator('.reset-button')).toBeEnabled();
}

async function openAdvanced(page: Page) {
  const advanced = page.locator('.advanced-settings');
  await expect(page.locator('.reset-button')).toBeEnabled();
  if ((await advanced.getAttribute('open')) === null) await advanced.locator('summary').click();
  await expect(page.locator('#customsDate')).toBeVisible();
}

async function fillRussianReference(page: Page) {
  await openAdvanced(page);
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('USD');
  await page.locator('#price').fill(ruSample.price);
  // Explicitly edit even when the build falls back to the same reference rates.
  // Filling an unchanged value does not emit React's change event.
  await page.locator('#transactionRate').fill('');
  await page.locator('#transactionRate').fill(ruSample.transactionRate);
  await page.locator('#euroRate').fill(ruSample.euroRate);
  await page.locator('#customsDate').fill(ruSample.customsDate);
}

async function fillCountryReference(page: Page, fixture: CountryFixture, powertrainIndex = 0) {
  await openCalculator(page, fixture.slug);
  await openAdvanced(page);
  if (fixture.country !== 'GE') {
    await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('USD');
    await page.locator('#price').fill(fixture.price);
    await page.locator('#transactionRate').fill(fixture.transactionRate);
  }
  if (await page.locator('#euroRate').count())
    await page.locator('#euroRate').fill(fixture.euroRate);
  if (await page.locator('#manufactureDate').count())
    await page.locator('#manufactureDate').fill('2021-01');
  await page.locator('#customsDate').fill(ruSample.customsDate);
  await page.locator('#displacementCc').fill('1998');
  if (await page.locator('#powerHp').count()) await page.locator('#powerHp').fill('150');
  if (await page.locator('#freight').count()) {
    await page.locator('#freight').fill(fixture.freight);
    await page.locator('#insurance').fill('0');
  }
  await page
    .getByRole('button', { name: primaryPowertrains[powertrainIndex].label, exact: true })
    .click();
}

async function expectReferenceAmount(page: Page) {
  const total = page.getByTestId('total');
  await expect(total).toBeVisible();
  await expect
    .poll(async () => Number(digits(await total.locator('strong').innerText())))
    .toBeGreaterThan(0);
}

test('defaults calculate immediately with settings expanded and still allow manual collapse', async ({
  page,
}) => {
  await openCalculator(page);
  await expect(page.locator('#price')).toHaveValue('180000');
  await expect(page.getByRole('combobox', { name: '交易币种', exact: true })).toHaveValue('CNY');
  await expect(page.locator('#displacementCc')).toHaveValue('1998');
  await expect(page.locator('#powerHp')).toHaveValue('150');
  await expect(page.locator('#manufactureDate')).toHaveValue('2021-01');
  await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
  await expect(page.locator('#importerType')).toHaveCount(0);
  await expect(page.locator('#customsDate')).toBeVisible();
  await expect(page.locator('#transactionRate')).toBeVisible();
  await expect(page.getByRole('button', { name: '载入示例', exact: true })).toHaveCount(0);
  await expect(page.locator('.simple-powertrain button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '汽油 / 柴油', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('fx-status')).toContainText(/构建时汇率快照|默认演示汇率/);
  await expect(page.getByTestId('fx-status')).toContainText(/\d{4}-\d{2}-\d{2}/);
  await expectReferenceAmount(page);

  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
  await expect(page.locator('#transactionRate')).not.toBeVisible();
  await expectReferenceAmount(page);
  await openAdvanced(page);

  const initialTotal = await page.getByTestId('total').locator('strong').innerText();
  await page.locator('#displacementCc').fill('1700');
  await expectReferenceAmount(page);
  await expect(page.getByTestId('total').locator('strong')).not.toHaveText(initialTotal);
});

test('legacy empty prices do not relabel the CNY default as USD during draft migration', async ({
  page,
}) => {
  await openCalculator(page);
  await openAdvanced(page);
  const defaultLocalValue =
    Number(await page.locator('#price').inputValue()) *
    Number(await page.locator('#transactionRate').inputValue());
  await page.evaluate(() => {
    sessionStorage.removeItem('hd-auto.calculator.draft.v2');
    sessionStorage.setItem(
      'aurex.calculator.draft.v1',
      JSON.stringify({
        country: 'RU',
        currency: 'USD',
        price: '',
        transactionRate: '',
        euroRate: '',
      }),
    );
  });
  await page.reload();
  await openAdvanced(page);
  await expect(page.getByRole('combobox', { name: '交易币种', exact: true })).toHaveValue('USD');
  const migratedPrice = Number(await page.locator('#price').inputValue());
  const migratedRate = Number(await page.locator('#transactionRate').inputValue());
  expect(migratedPrice).not.toBe(180000);
  expect(Math.abs(migratedPrice * migratedRate - defaultLocalValue)).toBeLessThanOrEqual(
    migratedRate * 0.011 + 0.001,
  );
  await expectReferenceAmount(page);
});

test('manual reference inputs preserve the fixed independent Russian personal reference amounts', async ({
  page,
}) => {
  await openCalculator(page);
  await fillRussianReference(page);
  await expectAmount(page, '926952');
  await expect(page.getByTestId('total')).toContainText('RUB');
  await expect(page.getByText('不含车价及运输费用', { exact: true })).toBeVisible();
  await expect(page.getByTestId('fx-status')).toContainText('使用你手动设置的参考汇率');
  await page.locator('#displacementCc').fill('1700');
  await expectAmount(page, '582206');

  await expect(page.locator('#importerType')).toHaveCount(0);
  await expectAmount(page, '582206');
});

test('an old Russian company draft cannot leave a hidden unsupported identity on the page', async ({
  page,
}) => {
  await openCalculator(page);
  await page.evaluate((input) => {
    sessionStorage.setItem(
      'hd-auto.calculator.draft.v2',
      JSON.stringify({ input: { ...input, importerType: 'company' }, manualRates: true }),
    );
  }, ruSample);
  await page.reload();
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#importerType')).toHaveCount(0);
  await expectAmount(page, '926952');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const draft = JSON.parse(sessionStorage.getItem('hd-auto.calculator.draft.v2') || '{}');
        return draft.input?.importerType;
      }),
    )
    .toBe('individual');
});

test('Kyrgyzstan preserves the chosen importer in its language routes but resets it on another country', async ({
  page,
}) => {
  await openCalculator(page, 'kyrgyzstan');
  await expect(page.locator('#importerType')).toHaveValue('individual');
  await page.locator('#importerType').selectOption('company');
  await page.locator('#price').fill('215000');
  await expectReferenceAmount(page);
  await page
    .getByRole('navigation', { name: '语言', exact: true })
    .getByRole('link', { name: 'RU', exact: true })
    .click();
  await expect(page).toHaveURL(/\/ru\/calculator\/kyrgyzstan\/?$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#importerType')).toHaveValue('company');
  await expect(page.locator('#price')).toHaveValue('215000');
  await expectReferenceAmount(page);

  await page.locator('.country-nav a[href^="/ru/calculator/georgia"]').click();
  await expect(page).toHaveURL(/\/ru\/calculator\/georgia\/?$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#importerType')).toHaveCount(0);
  await expectReferenceAmount(page);
  await page.locator('#customsDate').fill('2026-10-22');
  await expectAmount(page, '3605');

  await page.locator('.country-nav a[href^="/ru/calculator/kyrgyzstan"]').click();
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#importerType')).toHaveValue('individual');
  await expect(page.locator('#price')).toHaveValue('215000');
  await page.locator('#importerType').selectOption('company');
  await page.getByRole('button', { name: 'По умолчанию', exact: true }).click();
  await expect(page.locator('#importerType')).toHaveValue('individual');
});

test('fee rows, total and copied summary show USD and follow the manually entered conversion rate', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCalculator(page);
  await fillRussianReference(page);
  await expectAmount(page, '926952');
  await expectUsdAmount(page.getByTestId('total-usd'), 11308.54);

  // Independent fixture values: the displayed USD total is converted before rounding;
  // summing the three separately rounded USD fees would instead produce 11308.55.
  const fees = [
    { label: '进口关税', local: '908211', usd: 11079.91, usdAt100: 9082.11 },
    { label: '报关手续费', local: '13541', usd: 165.2, usdAt100: 135.41 },
    { label: '回收费', local: '5200', usd: 63.44, usdAt100: 52 },
  ];
  await expect(page.getByTestId('fee-usd')).toHaveCount(3);
  for (const fee of fees) {
    const row = page
      .locator('.fee-line')
      .filter({ has: page.getByText(fee.label, { exact: true }) });
    await expect
      .poll(async () => digits(await row.locator('strong').first().innerText()))
      .toBe(fee.local);
    await expectUsdAmount(row.getByTestId('fee-usd'), fee.usd);
  }

  await page.locator('#transactionRate').fill('100');
  await expectAmount(page, '926952');
  await expectUsdAmount(page.getByTestId('total-usd'), 9269.52);
  for (const fee of fees) {
    const row = page
      .locator('.fee-line')
      .filter({ has: page.getByText(fee.label, { exact: true }) });
    await expect
      .poll(async () => digits(await row.locator('strong').first().innerText()))
      .toBe(fee.local);
    await expectUsdAmount(row.getByTestId('fee-usd'), fee.usdAt100);
  }

  await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('9,269.52 USD');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('926,952 RUB');
  expect(copied).toMatch(/908,211 RUB[^\n]*9,082\.11 USD/);
  expect(copied).toMatch(/13,541 RUB[^\n]*135\.41 USD/);
  expect(copied).toMatch(/5,200 RUB[^\n]*52(?:\.00)? USD/);
});

test('ambiguous grouping separators are rejected rather than silently changing the amount', async ({
  page,
}) => {
  await openCalculator(page);
  await fillRussianReference(page);
  await expectAmount(page, '926952');
  await page.locator('#price').fill('25,000');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expect(page.locator('#price')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#price-error')).toContainText('不含逗号或千位分隔符');
  await page.locator('#price').fill('25000');
  await expectAmount(page, '926952');
  await page.locator('#displacementCc').fill('1,998');
  await expect(page.getByTestId('total')).toHaveCount(0);
});

test('Georgia defaults need no price or FX and the three fuel groups update the result', async ({
  page,
}) => {
  await openCalculator(page, 'georgia');
  await expectReferenceAmount(page);
  await expect(page.getByTestId('total-usd')).toBeVisible();
  await expect(page.getByTestId('total-usd')).toContainText('USD');
  await expect(page.locator('#price')).toHaveCount(0);
  await expect(page.locator('#transactionRate')).toHaveCount(0);
  await expect(page.locator('#steering')).toBeVisible();
  await openAdvanced(page);
  await expect(page.locator('#steering')).toHaveValue('left');
  await page.locator('#customsDate').fill('2026-10-22');
  await expectAmount(page, '3605');
  await expect(page.getByTestId('total')).toContainText('GEL');

  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  await expect(page.locator('#powertrainDetail')).toHaveValue('hev');
  await expectAmount(page, '1805');
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expect(page.locator('#powertrainDetail')).toHaveValue('bev');
  await expect(page.locator('#displacementCc')).toHaveCount(0);
  await expectAmount(page, '480');
  await page.getByRole('button', { name: '汽油 / 柴油', exact: true }).click();
  await expect(page.locator('#displacementCc')).toHaveValue('1998');
  await expectAmount(page, '3605');
});

test('Georgia policy notes follow age, steering and powertrain without retaining conflicting exemptions', async ({
  page,
}) => {
  await openCalculator(page, 'georgia');
  await page.locator('#customsDate').fill('2026-10-22');
  await page.locator('#manufactureDate').fill('2020-01');
  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  const notes = page.getByTestId('country-policy-notes');
  const note = (key: string) => notes.locator(`[data-policy-note="${key}"]`);
  await expect(note('GE.hybridRelief')).toBeVisible();
  await expect(note('GE.hybridNoRelief')).toHaveCount(0);
  await expect(note('GE.older')).toHaveCount(0);

  await page.locator('#steering').selectOption('right');
  await expect(note('GE.rightHand')).toBeVisible();
  await expect(note('GE.hybridNoRelief')).toBeVisible();
  await expect(note('GE.hybridRelief')).toHaveCount(0);

  await page.locator('#steering').selectOption('left');
  await page.locator('#manufactureDate').fill('2019-01');
  await expect(note('GE.older')).toBeVisible();
  await expect(note('GE.hybridNoRelief')).toBeVisible();
  await expect(note('GE.hybridRelief')).toHaveCount(0);
  await expect(note('GE.rightHand')).toHaveCount(0);

  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expect(note('GE.electric')).toBeVisible();
  await expect(note('GE.older')).toHaveCount(0);
  await expect(note('GE.hybridNoRelief')).toHaveCount(0);
  await expectAmount(page, '480');
});

test('switching language preserves destination, entered values and manually overridden FX', async ({
  page,
}) => {
  await openCalculator(page);
  await fillRussianReference(page);
  await page.locator('#displacementCc').fill('1700');
  await expectAmount(page, '582206');
  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
  await page
    .getByRole('navigation', { name: '语言', exact: true })
    .getByRole('link', { name: 'RU', exact: true })
    .click();
  await expect(page).toHaveURL(/\/ru\/calculator\/russia\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('#displacementCc')).toHaveValue('1700');
  await expect(page.locator('#price')).toHaveValue('25000');
  await expect(page.locator('#manufactureDate')).toHaveValue('2021-01');
  await expectAmount(page, '582206');
  await expect(page.getByTestId('fx-status')).toContainText(
    'Используются введённые вами справочные курсы',
  );
  await expect(page.getByRole('button', { name: 'По умолчанию', exact: true })).toBeVisible();
  await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
  await expect(page.locator('#transactionRate')).toHaveValue('81.969182');
  await expect(page.locator('#euroRate')).toHaveValue('94.7');
  await expect(page.locator('#customsDate')).toHaveValue('2026-10-22');
});

test('changing currency converts the price and preserves its value with the automatic FX snapshot', async ({
  page,
}) => {
  await openCalculator(page);
  await openAdvanced(page);
  const initialPrice = Number(await page.locator('#price').inputValue());
  const initialRate = Number(await page.locator('#transactionRate').inputValue());
  const initialEuroRate = await page.locator('#euroRate').inputValue();
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('USD');
  await expect(page.locator('#price')).not.toHaveValue('180000');
  const convertedPrice = Number(await page.locator('#price').inputValue());
  const convertedRate = Number(await page.locator('#transactionRate').inputValue());
  expect(convertedPrice).toBeGreaterThan(0);
  expect(convertedRate).toBeGreaterThan(0);
  // A conversion rounded to cents must preserve the underlying local-currency value.
  expect(Math.abs(convertedPrice * convertedRate - initialPrice * initialRate)).toBeLessThanOrEqual(
    convertedRate * 0.011 + 0.001,
  );
  await expect(page.locator('#euroRate')).toHaveValue(initialEuroRate);
  await expect(page.getByTestId('fx-status')).not.toContainText('手动');
  await expectReferenceAmount(page);
  await expect(page.getByRole('button', { name: '复制测算结果', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('CNY');
  expect(
    Math.abs(Number(await page.locator('#price').inputValue()) - initialPrice),
  ).toBeLessThanOrEqual(0.1);
  await expectReferenceAmount(page);
});

test('restore defaults resets vehicle facts, current date and automatic FX and expands settings', async ({
  page,
}) => {
  await openCalculator(page);
  await openAdvanced(page);
  const defaultDate = await page.locator('#customsDate').inputValue();
  const today = '2026-10-24'; // Matches the fixed browser clock in beforeEach.
  expect(defaultDate).toBe(today);
  const defaultRate = await page.locator('#transactionRate').inputValue();
  const defaultEuroRate = await page.locator('#euroRate').inputValue();
  await fillRussianReference(page);
  await page.locator('#displacementCc').fill('1700');
  await page.locator('#powerHp').fill('130');
  await page.locator('#manufactureDate').fill('2020-03');
  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();

  await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
  await expect(page.locator('#price')).toHaveValue('180000');
  await expect(page.getByRole('combobox', { name: '交易币种', exact: true })).toHaveValue('CNY');
  await expect(page.locator('#displacementCc')).toHaveValue('1998');
  await expect(page.locator('#powerHp')).toHaveValue('150');
  await expect(page.locator('#manufactureDate')).toHaveValue('2021-01');
  await expect(page.getByTestId('fx-status')).not.toContainText('手动');
  await expectReferenceAmount(page);
  await openAdvanced(page);
  await expect(page.locator('#importerType')).toHaveCount(0);
  await expect(page.locator('#powertrainDetail')).toHaveValue('petrol');
  await expect(page.locator('#customsDate')).toHaveValue(defaultDate);
  await expect(page.locator('#transactionRate')).toHaveValue(defaultRate);
  await expect(page.locator('#euroRate')).toHaveValue(defaultEuroRate);
});

test('all seven destinations navigate correctly and provide default reference amounts', async ({
  page,
}) => {
  await openCalculator(page);
  const destinations = [
    ['kazakhstan', '哈萨克斯坦'],
    ['uzbekistan', '乌兹别克斯坦'],
    ['georgia', '格鲁吉亚'],
    ['armenia', '亚美尼亚'],
    ['kyrgyzstan', '吉尔吉斯斯坦'],
    ['albania', '阿尔巴尼亚'],
    ['russia', '俄罗斯'],
  ] as const;

  for (const [slug, label] of destinations) {
    await page.locator('.advanced-settings summary').click();
    await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
    const nav = page.getByRole('navigation', { name: '目的国', exact: true });
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/zh/calculator/${slug}/?$`));
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
    await expect(page.locator('#importerType')).toHaveCount(slug === 'kyrgyzstan' ? 1 : 0);
    const policyNotes = page.getByTestId('country-policy-notes');
    await expect(policyNotes).toBeVisible();
    expect(await policyNotes.locator('li').count()).toBeGreaterThan(0);
    await expect(policyNotes.locator('a')).toHaveAttribute(
      'href',
      `https://www.kmotors.shop/en/calculator${slug === 'russia' ? '' : `/${slug}`}`,
    );
    await expectReferenceAmount(page);
    await expect(page.getByTestId('total-usd')).toContainText('USD');
    await expect(page.getByRole('button', { name: '复制测算结果', exact: true })).toBeEnabled();
  }
});

for (const fixture of countryFixtures) {
  for (const [index, powertrain] of primaryPowertrains.entries()) {
    test(`${fixture.country} ${powertrain.value}: static public page and copied quote match the independent reference amount`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await fillCountryReference(page, fixture, index);
      const expectedTotal = fixture.totals[index];
      await expectAmount(page, expectedTotal);
      await expect(page.getByTestId('total')).toContainText(fixture.currency);
      await expect(page.getByTestId('total-usd')).toContainText('USD');
      for (const value of await page.getByTestId('fee-usd').all()) {
        await expect(value).toContainText('USD');
        await expect(value).not.toContainText('—');
      }

      if (fixture.country === 'RU' && powertrain.value === 'bev') {
        // A BEV has no engine displacement, but its power still selects recycling.
        await expect(page.locator('#displacementCc')).toHaveCount(0);
        await expect(page.locator('#powerHp')).toBeVisible();
        await page.locator('#euroRate').fill('');
        await expectAmount(page, '2548125');
        await page.locator('#powerHp').fill('');
        await expect(page.getByTestId('total')).toHaveCount(0);
        await page.locator('#powerHp').fill('150');
        await expectAmount(page, '2548125');
      }

      await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
      const localText = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(
        Number(expectedTotal),
      );
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain(`${localText} ${fixture.currency}`);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('USD');
    });
  }
}

test('KG personal registration stays outside total, is copied in both currencies and disappears for company', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const fixture = countryFixtures.find((item) => item.country === 'KG')!;
  await fillCountryReference(page, fixture);
  await expectAmount(page, '547138.77');
  const extra = page
    .getByTestId('additional-costs')
    .locator('[data-extra-cost="registrationEstimate"]');
  await expect(extra).toContainText('KGS');
  await expect.poll(async () => digits(await extra.locator('strong').innerText())).toBe('4406672');
  await expectUsdAmount(extra.locator('.fee-usd'), 505);
  await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('44,066.72 KGS (≈ 505.00 USD)');

  await page.locator('#importerType').selectOption('company');
  await expectAmount(page, '306703.56');
  await expect(page.getByTestId('additional-costs')).toHaveCount(0);
});

test('UZ registration condition and separate CNY/USD rates change tax for the same young vehicle', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan');
  await page.locator('#price').fill('50000');
  await page.locator('#transactionRate').fill('200');
  await expect(page.locator('#usdRate')).toBeVisible();
  await page.locator('#usdRate').fill('1000');
  await page.locator('#displacementCc').fill('1000');
  await page.locator('#manufactureDate').fill('2026-01');
  await page.locator('#customsDate').fill('2026-10-22');
  await page.locator('#freight').fill('0');
  await page.locator('#insurance').fill('0');
  await expect(page.locator('#condition')).toHaveValue('used');
  await expectAmount(page, '27184480');
  await page.locator('#condition').selectOption('new');
  await expectAmount(page, '21472480');
  await page.locator('#condition').selectOption('used');
  await expectAmount(page, '27184480');
});

test('AL annual luxury cost is shown and copied in both currencies without entering the import total', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const fixture = countryFixtures.find((item) => item.country === 'AL')!;
  await fillCountryReference(page, fixture);
  await page.locator('#displacementCc').fill('3000');
  await expectAmount(page, '241688');
  const extra = page.getByTestId('additional-costs').locator('[data-extra-cost="annualLuxury"]');
  await expect.poll(async () => digits(await extra.locator('strong').innerText())).toBe('21000');
  await expect(extra).toContainText('ALL');
  await expectUsdAmount(extra.locator('.fee-usd'), 259.95);
  await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('21,000 ALL (≈ 259.95 USD)');
});

test('currency switches convert price, freight and insurance together instead of changing their labels', async ({
  page,
}) => {
  await openCalculator(page, 'albania');
  await page.locator('#price').fill('180000');
  await page.locator('#freight').fill('6900');
  await page.locator('#insurance').fill('690');
  const fields = ['price', 'freight', 'insurance'];
  const initialRate = Number(await page.locator('#transactionRate').inputValue());
  const original = await Promise.all(fields.map((field) => page.locator(`#${field}`).inputValue()));
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('USD');
  const dollarRate = Number(await page.locator('#transactionRate').inputValue());
  for (const [index, field] of fields.entries()) {
    const value = Number(await page.locator(`#${field}`).inputValue());
    expect(value).not.toBe(Number(original[index]));
    expect(
      Math.abs(value * dollarRate - Number(original[index]) * initialRate),
    ).toBeLessThanOrEqual(dollarRate * 0.011 + 0.001);
  }
  await expect(page.locator('#freight').locator('..').locator('.input-unit')).toHaveText('USD');
  await expect(page.locator('#insurance').locator('..').locator('.input-unit')).toHaveText('USD');
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('CNY');
  for (const [index, field] of fields.entries()) {
    expect(
      Math.abs(Number(await page.locator(`#${field}`).inputValue()) - Number(original[index])),
    ).toBeLessThanOrEqual(0.1);
  }
  await expectReferenceAmount(page);
});

test('unknown transport stays an explicit tax-base assumption and clears when both costs are supplied', async ({
  page,
}) => {
  await openCalculator(page, 'albania');
  await expectReferenceAmount(page);
  await expect(page.getByTestId('calculation-assumptions')).toContainText(
    '未填写的运费或保险尚未加入计税基础',
  );
  await page.locator('#freight').fill('1100');
  await page.locator('#insurance').fill('0');
  await expect(page.getByTestId('calculation-assumptions')).toHaveCount(0);
});

for (const width of [390, 360]) {
  for (const locale of ['zh', 'en', 'ru'] as const) {
    test(`${locale} has no page overflow at ${width}px with defaults, expanded settings, FAQ and contacts`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await openCalculator(page, 'russia', locale);
      await expectReferenceAmount(page);
      await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
      await openAdvanced(page);
      await expect(page.locator('.faq-list details')).toHaveCount(2);
      await page.locator('.faq-list details').first().locator('summary').click();
      for (const selector of [
        '.site-header',
        '.calculator-grid',
        '.advanced-settings',
        '[data-testid="country-policy-notes"]',
        '.faq-list',
        '#contact',
        '.mobile-result-bar',
      ]) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
          .toBeLessThanOrEqual(1);
      }
      await expect(page.locator('.mobile-result-bar')).toBeVisible();
      await expect(page.getByTestId('mobile-total-usd')).toBeVisible();
      await expect(page.getByTestId('mobile-total-usd')).toContainText('≈');
      await expect(page.getByTestId('mobile-total-usd')).toContainText('USD');
      await expect
        .poll(async () => Number(digits(await page.getByTestId('mobile-total-usd').innerText())))
        .toBeGreaterThan(0);
    });
  }
}

test('country pages expose localized metadata and reciprocal language URLs', async ({ page }) => {
  await page.goto('/zh/calculator/georgia');
  await expect(page).toHaveTitle('格鲁吉亚汽车进口费用计算器 | HD Auto Export');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).not.toBeNull();
  expect(new URL(canonical!).pathname.replace(/\/$/, '')).toBe('/zh/calculator/georgia');
  for (const [language, locale] of [
    ['zh-Hans', 'zh'],
    ['en', 'en'],
    ['ru', 'ru'],
    ['x-default', 'en'],
  ]) {
    const href = await page
      .locator(`link[rel="alternate"][hreflang="${language}"]`)
      .getAttribute('href');
    expect(href).not.toBeNull();
    expect(new URL(href!).pathname.replace(/\/$/, '')).toBe(`/${locale}/calculator/georgia`);
  }
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /格鲁吉亚/);
});

test('HD Auto Export uses its logo and real contact links; account numbers are copied without invented handles', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCalculator(page);
  const footer = page.locator('#contact');
  await footer.scrollIntoViewIfNeeded();
  for (const section of [page.locator('.site-header'), footer]) {
    const logo = section.getByRole('img', { name: 'HD Auto Export 标志', exact: true });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', /hd-auto-logo/);
    await expect
      .poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(footer.getByRole('link', { name: /^Facebook/ })).toHaveAttribute(
    'href',
    'https://www.facebook.com/HDAuto',
  );
  await expect(footer.getByRole('link', { name: /^WhatsApp/ })).toHaveAttribute(
    'href',
    'https://wa.me/8618215932610',
  );
  await expect(footer.getByRole('link', { name: /^电话/ })).toHaveAttribute(
    'href',
    'tel:+8618215932610',
  );
  await expect(footer.getByRole('link', { name: /^电话/ })).toContainText('+86 182 1593 2610');
  await expect(footer.getByRole('link', { name: /Instagram|Telegram|微信/ })).toHaveCount(0);
  await expect(
    page.locator('a[href*="instagram.com"], a[href*="t.me"], a[href*="telegram.me"]'),
  ).toHaveCount(0);

  for (const platform of ['Instagram', 'Telegram', '微信']) {
    const button = footer.getByRole('button', { name: `复制${platform}联系号码`, exact: true });
    await expect(button).toContainText('18215932610');
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await button.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('18215932610');
    await expect(button).toContainText('已复制');
  }
});

test('an unknown destination returns HTTP 404', async ({ page }) => {
  const response = await page.goto('/zh/calculator/unknown-destination');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('main')).toContainText('HD Auto Export / 404');
  await expect(page.getByTestId('total')).toHaveCount(0);
});
