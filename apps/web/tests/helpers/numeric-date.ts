import { expect, type Locator, type Page } from '@playwright/test';

/** Exercise the visible numeric dropdowns; the hidden ISO value is assertion-only. */
export async function fillNumericDate(scope: Page | Locator, name: 'manufactureDate' | 'customsDate', value: string) {
  const group = scope.locator(`[data-numeric-date="${name}"]`);
  const [year = '', month = '', day = ''] = value.split('-');
  const dayControl = group.locator(`select[name="${name}Day"]`);
  if (value === '') {
    // Clear the dependent day before removing year/month; it is then legitimately disabled.
    if (await dayControl.count() && await dayControl.isEnabled()) await dayControl.selectOption('');
    await group.locator(`select[name="${name}Month"]`).selectOption('');
    await group.locator(`select[name="${name}Year"]`).selectOption('');
    await expect(group.locator(`[name="${name}"]`)).toHaveValue('');
    return;
  }
  await group.locator(`select[name="${name}Year"]`).selectOption(year);
  await group.locator(`select[name="${name}Month"]`).selectOption(month ? String(Number(month)) : '');
  if (await dayControl.count()) await dayControl.selectOption(day ? String(Number(day)) : '');
  await expect(group.locator(`[name="${name}"]`)).toHaveValue(value);
}
