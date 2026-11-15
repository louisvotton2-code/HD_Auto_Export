import { expect, type Locator } from '@playwright/test';

export async function chooseVehicleDestination(scope: Locator, code: string) {
  const picker = scope.getByTestId('vehicle-destination-picker');
  await expect(picker).toHaveAttribute('aria-disabled', 'false');
  await picker.click();
  await scope.locator(`[data-country-option="${code}"]`).click();
}
