import { expect, test } from '@playwright/test';

test('copied quotes preserve effective inputs and exclude inactive fields carried across destinations', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-23T04:00:00Z'));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { copiedQuote?: string }).copiedQuote = text;
        },
      },
    });
    sessionStorage.setItem(
      'hd-auto.calculator.draft.v2',
      JSON.stringify({
        manualRates: true,
        input: {
          country: 'AL',
          importerType: 'individual',
          powertrain: 'petrol',
          price: '23456.78',
          currency: 'USD',
          displacementCc: '3000',
          powerHp: '987',
          manufactureDate: '1994-12',
          customsDate: '2027-01-01',
          freight: '1200.50',
          insurance: '',
          steering: 'right',
          condition: 'new',
          transactionRate: '80.12567',
          euroRate: '999',
          usdRate: '998',
        },
      }),
    );
  });
  await page.goto('/zh/calculator/albania');
  const price = page.locator('#price');
  await expect(price).toHaveValue('23457');
  await price.focus();
  await expect(price).toHaveValue('23456.78');
  await price.blur();
  await expect(price).toHaveValue('23457');
  await expect(page.getByTestId('total')).toBeVisible();
  await page.getByRole('button', { name: '复制测算结果', exact: true }).click();
  const albania = await page.evaluate(
    () => (window as Window & { copiedQuote?: string }).copiedQuote || '',
  );
  const albaniaInputs = albania.split('\n费用明细\n')[0];
  expect(albaniaInputs).toContain('车辆价格: 23456.78 USD');
  expect(albaniaInputs).toContain('清关日期: 2026-11-06');
  expect(albaniaInputs).toContain('运费: 1200.50 USD');
  expect(albaniaInputs).toContain('保险费: 未填写，尚未加入计税基础');
  expect(albaniaInputs).toContain('交易币种兑目的国货币: 80.12567 ALL/USD');
  expect(albaniaInputs).toContain('参考规则版本: al-hs8703-2026.11.23-v3');
  expect(albaniaInputs).not.toMatch(/制造日期|发动机功率|欧元兑|车辆登记状态|方向盘位置/);
  expect(albania).toContain('代入公式:');

  await page.goto('/en/calculator/georgia');
  await expect(page.locator('#steering')).toHaveValue('right');
  await expect(page.getByTestId('total')).toBeVisible();
  await page.getByRole('button', { name: 'Copy estimate', exact: true }).click();
  const georgia = await page.evaluate(
    () => (window as Window & { copiedQuote?: string }).copiedQuote || '',
  );
  const georgiaInputs = georgia.split('\nCost breakdown\n')[0];
  expect(georgiaInputs).toContain('Manufacture date: 1994-12');
  expect(georgiaInputs).toContain('Clearance date: 2026-11-06');
  expect(georgiaInputs).toContain('Steering position: Right-hand drive');
  expect(georgiaInputs).toContain('Destination currency per US dollar:');
  expect(georgiaInputs).toContain('Reference rule version: ge-hs8703-2026.11.23-v3');
  expect(georgiaInputs).not.toMatch(
    /Vehicle price:|Freight cost:|Insurance cost:|Engine power|Transaction to destination currency:|Euro to destination currency:|Vehicle registration status:/,
  );
});
