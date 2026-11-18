import type { Locator } from '@playwright/test';

/** Exercise the enhanced selection as a customer, retaining the native path in no-script tests. */
export async function chooseCatalogBrand(form: Locator, brand: string, native = false) {
  if (native) {
    await form.locator('select[name="make"]').selectOption(brand);
    return;
  }
  await form.getByTestId('catalog-brand-search').click();
  await form.locator(`[role="option"][data-make-option="${brand}"]`).click();
}
