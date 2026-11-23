import { expect, test, type Locator, type Page } from '@playwright/test';
import { fillNumericDate } from './helpers/numeric-date';

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

function digits(value: string) {
  return value.replace(/[^\d]/g, '');
}

async function expectAmount(page: Page, amount: string) {
  const total = page.getByTestId('total');
  await expect(total).toBeVisible();
  await expect
    .poll(async () => (await total.locator('strong').innerText()).replace(/[^\d]/g, ''))
    .toBe(digits(Number(amount).toFixed(2)));
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

async function readExact(input: Locator) {
  await input.focus();
  const value = await input.inputValue();
  await input.blur();
  return value;
}

async function openAdvanced(page: Page) {
  const advanced = page.locator('.advanced-settings');
  await expect(page.locator('.reset-button')).toBeEnabled();
  if ((await advanced.getAttribute('open')) === null) await advanced.locator('summary').click();
  await expect(page.locator('#powertrainDetail')).toBeVisible();
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
  await fillNumericDate(page, 'manufactureDate', ruSample.manufactureDate);
}

async function expectReferenceAmount(page: Page) {
  const total = page.getByTestId('total').or(page.getByTestId('manufacture-range-total'));
  await expect(total).toBeVisible();
  await expect
    .poll(async () => Number(digits(await total.innerText())))
    .toBeGreaterThan(0);
}

test('defaults calculate immediately with settings expanded and still allow manual collapse', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan');
  await expect(page.locator('#price')).toHaveValue('25000');
  await expect(page.getByRole('combobox', { name: '交易币种', exact: true })).toHaveValue('USD');
  await expect(page.locator('#displacementCc')).toHaveValue('1998');
  await expect(page.locator('#manufactureDate')).toHaveValue('');
  await expect(page.getByTestId('manufacture-range-result')).toContainText('最近六年');
  await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
  await expect(page.locator('#importerType')).toHaveCount(0);
  await expect(page.locator('[name^="customsDate"]')).toHaveCount(0);
  await expect(page.locator('#transactionRate')).toBeVisible();
  await expect(page.getByRole('button', { name: '载入示例', exact: true })).toHaveCount(0);
  await expect(page.locator('.simple-powertrain button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '汽油 / 柴油', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('fx-status')).toContainText(/构建时汇率快照|默认参考汇率/);
  await expect(page.getByTestId('fx-status')).toContainText(/\d{4}-\d{2}-\d{2}/);
  await expectReferenceAmount(page);

  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
  await expect(page.locator('#transactionRate')).not.toBeVisible();
  await expectReferenceAmount(page);
  await openAdvanced(page);

  const initialTotal = await page.getByTestId('manufacture-range-total').innerText();
  await page.locator('#displacementCc').fill('1700');
  await expectReferenceAmount(page);
  await expect(page.getByTestId('manufacture-range-total')).not.toHaveText(initialTotal);
  await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expect(page.getByTestId('total')).toBeVisible();
  await page.locator('#manufactureDate-year').selectOption('');
  await expect(page.getByTestId('manufacture-range-total')).toBeVisible();
});

test('legacy empty prices do not relabel the CNY default as USD during draft migration', async ({
  page,
}) => {
  await openCalculator(page);
  await openAdvanced(page);
  const defaultLocalValue =
    Number(await readExact(page.locator('#price'))) *
    Number(await readExact(page.locator('#transactionRate')));
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
  const migratedPrice = Number(await readExact(page.locator('#price')));
  const migratedRate = Number(await readExact(page.locator('#transactionRate')));
  expect(migratedPrice).not.toBe(180000);
  expect(Math.abs(migratedPrice * migratedRate - defaultLocalValue)).toBeLessThanOrEqual(
    migratedRate * 0.011 + 0.001,
  );
  await expect(page.getByTestId('result-status')).toBeVisible();
});

test('manual Russian inputs show verified individual charges without a total or clipboard quote', async ({ page }) => {
  await openCalculator(page);
  await fillRussianReference(page);
  const fees = page.getByTestId('verified-fee-items');
  await expect(fees).toContainText('908,210.88');
  await expect(fees).toContainText('13,541.00');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expect(page.locator('.copy-button')).toBeDisabled();
  await expect(page.getByTestId('fx-status')).toContainText('使用你手动设置的参考汇率');
  await page.locator('#displacementCc').fill('1700');
  await expect(fees).toContainText('563,465.00');
  await expect(page.locator('#importerType')).toHaveCount(0);
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
  await expect(page.getByTestId('verified-fee-items')).toContainText('908,210.88');
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
  await fillNumericDate(page, 'manufactureDate', '2022-01');
  await expectReferenceAmount(page);
  await page.locator('.language-switch summary').click();
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
  await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expectAmount(page, '3271.88');

  await page.locator('.country-nav a[href^="/ru/calculator/kyrgyzstan"]').click();
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#importerType')).toHaveValue('individual');
  await expect(page.locator('#price')).toHaveValue('215000');
  await page.locator('#importerType').selectOption('company');
  await page.getByRole('button', { name: 'По умолчанию', exact: true }).click();
  await expect(page.locator('#importerType')).toHaveValue('individual');
});

test('fee rows, total and copied summary apply the separate Uzbekistan USD rate before rounding', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCalculator(page, 'uzbekistan');
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('CNY');
  await page.locator('#price').fill('50000');
  await page.locator('#transactionRate').fill('200');
  await page.locator('#usdRate').fill('1011');
  await page.locator('#freight').fill('0');
  await page.locator('#insurance').fill('0');
  await fillNumericDate(page, 'manufactureDate', '2026-01');
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expectAmount(page, '54440000');
  await expectUsdAmount(page.getByTestId('total-usd'), 53847.68);
  for (const amount of [435.21, 1186.94, 52225.52]) {
    const shown = (await page.locator('.fee-lines').getByTestId('fee-usd').allTextContents())
      .map(text => Number(text.replace(/[^\d.]/g, '')));
    expect(shown).toContain(amount);
  }
  await page.locator('#usdRate').fill('1000');
  await expectAmount(page, '54440000');
  await expectUsdAmount(page.getByTestId('total-usd'), 54440);
  const registration = page.getByTestId('additional-costs').locator('[data-extra-cost="registration"]');
  await expect(registration).toContainText('660,000.00 UZS');
  await expectUsdAmount(registration.getByTestId('fee-usd'), 660);
  await page.locator('.copy-button').click();
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await expect.poll(clipboard).toContain('54,440,000.00 UZS');
  expect(await clipboard()).toContain('54,440.00 USD');
  expect(await clipboard()).toContain('660,000.00 UZS');
});

test('ambiguous grouping separators are rejected rather than silently changing the amount', async ({
  page,
}) => {
  await openCalculator(page);
  await fillRussianReference(page);
  await expect(page.getByTestId('verified-fee-items')).toContainText('908,210.88');
  await page.locator('#price').fill('25,000');
  await expect(page.getByTestId('verified-fee-items')).toHaveCount(0);
  await expect(page.locator('#price')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#price-error')).toContainText('不含逗号或千位分隔符');
  await page.locator('#price').fill('25000');
  await expect(page.getByTestId('verified-fee-items')).toContainText('908,210.88');
  await page.locator('#displacementCc').fill('1,998');
  await expect(page.getByTestId('verified-fee-items')).toHaveCount(0);
});

test('Georgia defaults need no price or FX and the three fuel groups update the result', async ({
  page,
}) => {
  await openCalculator(page, 'georgia');
  await expectReferenceAmount(page);
  await expect(page.getByTestId('manufacture-range-usd')).toContainText('USD');
  await expect(page.locator('#price')).toHaveCount(0);
  await expect(page.locator('#transactionRate')).toHaveCount(0);
  await expect(page.locator('#steering')).toBeVisible();
  await openAdvanced(page);
  await expect(page.locator('#steering')).toHaveValue('left');
  await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expectAmount(page, '3271.88');
  await expect(page.getByTestId('total')).toContainText('GEL');

  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  await expect(page.locator('#powertrainDetail')).toHaveValue('hev');
  await expectAmount(page, '1473.68');
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expect(page.locator('#powertrainDetail')).toHaveValue('bev');
  await expect(page.locator('#displacementCc')).toHaveCount(0);
  await expectAmount(page, '150');
  await page.getByRole('button', { name: '汽油 / 柴油', exact: true }).click();
  await expect(page.locator('#displacementCc')).toHaveValue('1998');
  await expectAmount(page, '3271.88');
});

test('Georgia applies hybrid relief only through six years and distinguishes converted steering', async ({ page }) => {
  await openCalculator(page, 'georgia');
  await fillNumericDate(page, 'manufactureDate', '2020-01');
  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  await expectAmount(page, '1478.67');
  await expect(page.getByTestId('country-policy-notes')).toContainText('中国优惠原产地证明');
  await expect(page.locator('#steering option[value="right"]')).toContainText('改舵');
  await page.locator('#steering').selectOption('right');
  await expectAmount(page, '9270.87');
  await page.locator('#steering').selectOption('left');
  await fillNumericDate(page, 'manufactureDate', '2019-01');
  await expectAmount(page, '9275.87');
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expectAmount(page, '150');
  await page.locator('#steering').selectOption('right');
  await expectAmount(page, '3150');
});

test('switching language preserves destination, entered values and manually overridden FX', async ({
  page,
}) => {
  await openCalculator(page);
  await fillRussianReference(page);
  await page.locator('#displacementCc').fill('1700');
  await expect(page.getByTestId('verified-fee-items')).toContainText('563');
  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
  await page.locator('.language-switch summary').click();
  await page
    .getByRole('navigation', { name: '语言', exact: true })
    .getByRole('link', { name: 'RU', exact: true })
    .click();
  await expect(page).toHaveURL(/\/ru\/calculator\/russia\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('#displacementCc')).toHaveValue('1700');
  await expect(page.locator('#price')).toHaveValue('25000');
  await expect(page.locator('#manufactureDate')).toHaveValue('2021-01');
  await expect(page.getByTestId('verified-fee-items')).toContainText('563');
  await expect(page.getByTestId('fx-status')).toContainText(
    'Используются введённые вами справочные курсы',
  );
  await expect(page.getByRole('button', { name: 'По умолчанию', exact: true })).toBeVisible();
  await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
  await expect(page.locator('#transactionRate')).toHaveValue('81.97');
  await expect(page.locator('#euroRate')).toHaveValue('94.70');
  await page.locator('#transactionRate').focus();
  await expect(page.locator('#transactionRate')).toHaveValue('81.969182');
  await page.locator('#transactionRate').blur();
  await expect(page.locator('[name^="customsDate"]')).toHaveCount(0);
});

test('changing currency converts the price and preserves its value with the automatic FX snapshot', async ({
  page,
}) => {
  await openCalculator(page);
  await openAdvanced(page);
  const initialPrice = Number(await readExact(page.locator('#price')));
  const initialRate = Number(await readExact(page.locator('#transactionRate')));
  const initialEuroRate = await page.locator('#euroRate').inputValue();
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('CNY');
  await expect(page.locator('#price')).not.toHaveValue(String(initialPrice));
  const convertedPrice = Number(await readExact(page.locator('#price')));
  const convertedRate = Number(await readExact(page.locator('#transactionRate')));
  expect(convertedPrice).toBeGreaterThan(0);
  expect(convertedRate).toBeGreaterThan(0);
  // A conversion rounded to cents must preserve the underlying local-currency value.
  expect(Math.abs(convertedPrice * convertedRate - initialPrice * initialRate)).toBeLessThanOrEqual(
    convertedRate * 0.011 + 0.001,
  );
  await expect(page.locator('#euroRate')).toHaveValue(initialEuroRate);
  await expect(page.getByTestId('fx-status')).not.toContainText('手动');
  await expect(page.getByTestId('result-status')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制测算结果', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('USD');
  expect(
    Math.abs(Number(await readExact(page.locator('#price'))) - initialPrice),
  ).toBeLessThanOrEqual(0.1);
  await expect(page.getByTestId('result-status')).toBeVisible();
});

test('restore defaults resets vehicle facts, current date and automatic FX and expands settings', async ({
  page,
}) => {
  await openCalculator(page);
  await openAdvanced(page);
  const defaultRate = await page.locator('#transactionRate').inputValue();
  const defaultEuroRate = await page.locator('#euroRate').inputValue();
  await fillRussianReference(page);
  await page.locator('#displacementCc').fill('1700');
  await page.locator('#powerHp').fill('130');
  await fillNumericDate(page, 'manufactureDate', '2020-03');
  await page.getByRole('button', { name: '混合动力', exact: true }).click();
  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();

  await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
  await expect(page.locator('#price')).toHaveValue('25000');
  await expect(page.getByRole('combobox', { name: '交易币种', exact: true })).toHaveValue('USD');
  await expect(page.locator('#displacementCc')).toHaveValue('1998');
  await expect(page.locator('#powerHp')).toHaveValue('150');
  await expect(page.locator('#manufactureDate')).toHaveValue('');
  await expect(page.getByTestId('fx-status')).not.toContainText('手动');
  await expect(page.getByTestId('result-status')).toBeVisible();
  await openAdvanced(page);
  await expect(page.locator('#importerType')).toHaveCount(0);
  await expect(page.locator('#powertrainDetail')).toHaveValue('petrol');
  await expect(page.locator('#transactionRate')).toHaveValue(defaultRate);
  await expect(page.locator('#euroRate')).toHaveValue(defaultEuroRate);
});

test('all nine destinations show either a supported quote or a manual review and official sources', async ({ page }) => {
  await openCalculator(page);
  const destinations = [
    ['kazakhstan', '哈萨克斯坦', false], ['uzbekistan', '乌兹别克斯坦', true],
    ['georgia', '格鲁吉亚', true], ['armenia', '亚美尼亚', false],
    ['kyrgyzstan', '吉尔吉斯斯坦', false], ['albania', '阿尔巴尼亚', false],
    ['russia', '俄罗斯', false], ['tajikistan', '塔吉克斯坦', true], ['turkmenistan', '土库曼斯坦', true],
  ] as const;
  for (const [slug, label, quote] of destinations) {
    await page.locator('.advanced-settings summary').click();
    await expect(page.locator('.advanced-settings')).not.toHaveAttribute('open');
    const nav = page.getByRole('navigation', { name: '目的国', exact: true });
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/zh/calculator/${slug}/?$`));
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.advanced-settings')).toHaveAttribute('open', '');
    await expect(page.locator('#importerType')).toHaveCount(slug === 'kyrgyzstan' ? 1 : 0);
    const notes = page.getByTestId('country-policy-notes');
    await expect(notes).toBeVisible();
    const sources = await notes.locator('a').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href));
    expect(sources.length).toBeGreaterThan(1);
    expect(sources.every(url => url.startsWith('https://') && !url.includes('kmotors.shop'))).toBe(true);
    if (quote) {
      await expectReferenceAmount(page);
      await expect(page.getByTestId('total-usd').or(page.getByTestId('manufacture-range-usd'))).toContainText('USD');
      await expect(page.locator('.copy-button')).toBeEnabled();
    } else {
      await expect(page.getByTestId('result-status')).toBeVisible();
      await expect(page.locator('.copy-button')).toBeDisabled();
    }
    // Avoid passing another country's condition, engine type or steering into the next check.
    await page.locator('.reset-button').click();
  }
});

test('Kyrgyz company charges have a total and personal charges need review', async ({ page }) => {
  await openCalculator(page, 'kyrgyzstan');
  await page.locator('#price').fill('10000');
  await page.locator('#transactionRate').fill('87.5');
  await page.locator('#euroRate').fill('100');
  await page.locator('#freight').fill('0');
  await page.locator('#insurance').fill('0');
  await fillNumericDate(page, 'manufactureDate', '2022-01');
  await expect(page.getByTestId('verified-fee-items')).toContainText('539,460.00');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await page.locator('#importerType').selectOption('company');
  await expectAmount(page, '304500');
  await expect(page.getByTestId('additional-costs')).toHaveCount(0);
});

test('UZ registration condition and separate CNY/USD rates change tax for the same young vehicle', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan');
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('CNY');
  await page.locator('#price').fill('50000');
  await page.locator('#transactionRate').fill('200');
  await expect(page.locator('#usdRate')).toBeVisible();
  await page.locator('#usdRate').fill('1000');
  await page.locator('#displacementCc').fill('1000');
  await fillNumericDate(page, 'manufactureDate', '2026-01');
  await page.locator('#freight').fill('0');
  await page.locator('#insurance').fill('0');
  await expect(page.locator('#condition')).toHaveValue('used');
  await expectAmount(page, '22680000');
  await page.locator('#condition').selectOption('new');
  await expectAmount(page, '16968000');
  await page.locator('#condition').selectOption('used');
  await expectAmount(page, '22680000');
});

test('Albania shows ordinary VAT and registration separately and requires assessment for the total', async ({ page }) => {
  await openCalculator(page, 'albania');
  await page.locator('#price').fill('9000');
  await page.locator('#freight').fill('1100');
  await page.locator('#insurance').fill('0');
  await page.locator('#transactionRate').fill('81.16');
  const fees = page.getByTestId('verified-fee-items');
  await expect(fees).toContainText('163,943.20');
  await expect(fees).toContainText('8,500.00');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expect(page.locator('.copy-button')).toBeDisabled();
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expect(fees).toContainText('163,943.20');
  await page.locator('#condition').selectOption('new');
  await expect(fees).not.toContainText('163,943.20');
  await expect(fees).toContainText('0.00');
});

test('currency switches convert price, freight and insurance together instead of changing their labels', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan');
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('CNY');
  await page.locator('#price').fill('180000');
  await page.locator('#freight').fill('6900');
  await page.locator('#insurance').fill('690');
  const fields = ['price', 'freight', 'insurance'];
  const initialRate = Number(await readExact(page.locator('#transactionRate')));
  const original = [];
  for (const field of fields) original.push(await readExact(page.locator(`#${field}`)));
  await page.getByRole('combobox', { name: '交易币种', exact: true }).selectOption('USD');
  const dollarRate = Number(await readExact(page.locator('#transactionRate')));
  for (const [index, field] of fields.entries()) {
    const value = Number(await readExact(page.locator(`#${field}`)));
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
      Math.abs(Number(await readExact(page.locator(`#${field}`))) - Number(original[index])),
    ).toBeLessThanOrEqual(0.1);
  }
  await expectReferenceAmount(page);
});

test('unknown transport stays an explicit tax-base assumption and clears when both costs are supplied', async ({
  page,
}) => {
  await openCalculator(page, 'uzbekistan');
  await fillNumericDate(page, 'manufactureDate', '2021-01');
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
      await openCalculator(page, 'uzbekistan', locale);
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
    ['x-default', 'ru'],
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
  await expect(footer.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(footer.getByRole('link', { name: /^Telegram/ })).toHaveAttribute(
    'href',
    'https://t.me/HD_Auto_CN',
  );
  await expect(footer.getByRole('link', { name: /^Telegram/ })).toContainText('@HD_Auto_CN');
  await expect(footer.getByRole('link', { name: /^Instagram/ })).toHaveAttribute(
    'href',
    'https://www.instagram.com/hongding_auto/',
  );
  await expect(footer.getByRole('link', { name: /^TikTok/ })).toHaveAttribute(
    'href',
    'https://www.tiktok.com/@votton.louis?is_from_webapp=1&sender_device=pc',
  );
  await expect(footer.getByRole('list', { name: '付款方式参考' })).toContainText('Mastercard');
  await expect(footer.getByText('请先向销售确认订单可用的付款方式。')).toBeVisible();

  const firstWeChat = footer.getByRole('button', { name: '复制微信联系号码 +86 182 1593 2610', exact: true });
  const secondWeChat = footer.getByRole('button', { name: '复制微信联系号码 +86 199 3899 9916', exact: true });
  await expect(firstWeChat).toContainText('+86 182 1593 2610');
  await expect(secondWeChat).toContainText('+86 199 3899 9916');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await firstWeChat.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('+8618215932610');
  await expect(firstWeChat).toContainText('已复制');
  await secondWeChat.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('+8619938999916');
  await expect(secondWeChat).toContainText('已复制');
  await expect(firstWeChat).not.toContainText('已复制');
});

test('an unknown destination returns HTTP 404', async ({ page }) => {
  const response = await page.goto('/zh/calculator/unknown-destination');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('main')).toContainText('HD Auto Export / 404');
  await expect(page.getByTestId('total')).toHaveCount(0);
});
