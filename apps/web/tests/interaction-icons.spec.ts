import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Uses the isolated public catalog fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

test('the footer puts Telegram and WhatsApp before WeChat without phone links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/buy/');
  const contacts = page.locator('footer .hd-contacts');
  const primary = contacts.locator('.hd-contact-grid').first().locator('.hd-contact-item');
  await expect(primary).toHaveCount(4);
  await expect(primary.nth(0)).toHaveAttribute('href', 'https://t.me/HD_Auto_CN');
  await expect(primary.nth(1)).toHaveAttribute('href', 'https://wa.me/8618215932610');
  await expect(contacts.locator('.hd-contact-grid').first().getByRole('button')).toHaveCount(2);
  await expect(contacts.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(contacts.locator('a[href^="https://www.facebook.com/"]')).toHaveCount(1);
});

async function decorativeControlIcon(control: Locator, count = 1) {
  const icons = control.locator('svg');
  await expect(icons).toHaveCount(count);
  for (const icon of await icons.all()) {
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    await expect(icon).toHaveAttribute('focusable', 'false');
  }
}

test('SVG controls retain their labels, keyboard actions and state while flags use local assets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/');
  const explore = page.getByRole('link', { name: 'Scroll down', exact: true });
  await decorativeControlIcon(explore, 2);
  await explore.press('Enter');
  await expect(page).toHaveURL(/#home-vehicles$/);
  const catalog = page.getByRole('link', { name: 'Full catalog', exact: true });
  await decorativeControlIcon(catalog);
  await expect(catalog).toHaveAttribute('href', '/en/cars/');
  const russia = page.locator('[data-home-section="calculator"]').getByRole('link', { name: 'Russia', exact: true });
  await expect(russia.locator('img')).toHaveAttribute('src', /\/_next\/static\/media\/ru\.[\w-]+\.svg$/);
  await expect(russia.locator('img')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => russia.locator('img').evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);

  const favorites = page.getByRole('button', { name: 'View saved cars', exact: true });
  await favorites.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Saved cars', exact: true });
  await expect(drawer).toBeVisible();
  const closeSaved = drawer.getByRole('button', { name: 'Close saved cars', exact: true });
  await decorativeControlIcon(closeSaved);
  await expect(closeSaved).toHaveText('');
  await closeSaved.press('Enter');
  await expect(drawer).not.toBeVisible();
  await expect(favorites).toBeFocused();

  await page.goto('/en/parts/52910k2200/');
  const partPanel = page.getByTestId('part-detail').locator('aside');
  const save = partPanel.getByRole('button', { name: 'Save part', exact: true });
  await decorativeControlIcon(save);
  await save.press('Enter');
  const unsave = partPanel.getByRole('button', { name: 'Unsave part', exact: true });
  await expect(unsave).toHaveAttribute('aria-pressed', 'true');
  await decorativeControlIcon(unsave);
  const increase = page.getByRole('button', { name: 'Increase quantity', exact: true });
  const decrease = page.getByRole('button', { name: 'Decrease quantity', exact: true });
  await decorativeControlIcon(increase);
  await decorativeControlIcon(decrease);
  await increase.press('Enter');
  await expect(page.locator('input[name="quantity"]')).toHaveValue('2');
  await decrease.press('Enter');
  await expect(page.locator('input[name="quantity"]')).toHaveValue('1');
  const openImage = page.getByRole('link', { name: 'Open full image', exact: true });
  await openImage.press('Enter');
  const photos = page.getByRole('dialog', { name: 'Part images', exact: true });
  await expect(photos).toBeVisible();
  const closeImage = photos.getByRole('button', { name: 'Close full image', exact: true });
  await decorativeControlIcon(closeImage);
  await expect(closeImage).toHaveText('');
  await closeImage.press('Enter');
  await expect(photos).not.toBeVisible();
  await expect(openImage).toBeFocused();

  await page.goto('/en/cars/?pageSize=5');
  const pagination = page.locator('[data-catalog-pagination]');
  const next = pagination.getByRole('link', { name: 'Next', exact: true });
  await decorativeControlIcon(next);
  await expect(next).toHaveText('');
  await next.press('Enter');
  await expect(page).toHaveURL(url => url.searchParams.get('page') === '2');
  await expect(pagination.locator('[aria-current="page"]')).toHaveText('2');
  await decorativeControlIcon(pagination.getByRole('link', { name: 'Previous', exact: true }));
});
