import { expect, type Locator, type Page } from '@playwright/test';

/** Exercise the visible numeric controls; the hidden canonical value is assertion-only. */
export async function fillNumericDate(scope: Page | Locator, name: 'manufactureDate' | 'customsDate', value: string) {
  const group = scope.locator(`[data-numeric-date="${name}"]`);
  const [year = '', month = '', day = ''] = value.split('-');
  await group.locator(`[name="${name}Year"]`).fill(year);
  await group.locator(`[name="${name}Month"]`).fill(month);
  if (await group.locator(`[name="${name}Day"]`).count()) await group.locator(`[name="${name}Day"]`).fill(day);
  await expect(group.locator(`[name="${name}"]`)).toHaveValue(value);
}
