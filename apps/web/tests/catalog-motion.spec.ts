import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Uses the isolated catalog fixture.');
test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});
async function rotation(card: Locator) {
  return card.evaluate((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return { x: matrix.m23, y: matrix.m13, active: node.getAttribute('data-tilt-active') };
  });
}
async function flat(card: Locator) {
  await expect
    .poll(async () => {
      const value = await rotation(card);
      return Math.abs(value.x) + Math.abs(value.y);
    })
    .toBeLessThan(0.0001);
}

test('catalog cards share pointer-origin 3D rotation and highlight, reset on leave and retain navigation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/cars/?pageSize=2');
  const card = page.locator('main article[data-pointer-tilt]').first();
  await card.scrollIntoViewIfNeeded();
  const slot = await card.locator('..').boundingBox();
  await page.mouse.move(slot!.x + slot!.width * 0.25, slot!.y + slot!.height * 0.2);
  await expect(card).toHaveAttribute('data-tilt-active', 'true');
  await expect.poll(async () => Math.abs((await rotation(card)).x)).toBeGreaterThan(0.005);
  const first = await rotation(card);
  await page.mouse.move(slot!.x + slot!.width * 0.75, slot!.y + slot!.height * 0.8);
  await expect
    .poll(async () => {
      const value = await rotation(card);
      return first.x * value.x < 0 && first.y * value.y < 0;
    })
    .toBe(true);
  const light = await card.evaluate((node) =>
    [...node.children]
      .find((child) => getComputedStyle(child).backgroundImage.includes('radial-gradient'))
      ?.getAttribute('class'),
  );
  expect(light).toBeTruthy();
  const favorite = card.locator('[data-vehicle-favorite]');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/en\/cars\/\?pageSize=2$/);
  await page.mouse.move(5, 75);
  await flat(card);
  await expect(card).not.toHaveAttribute('data-tilt-active', 'true');
  await card.getByRole('link', { name: /View details/, exact: true }).click();
  await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
});

test('catalog detail button does not flicker at its real hit boundary while the card tilts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/cars/?pageSize=2');
  const card = page.locator('main article[data-pointer-tilt]').first();
  const details = card.getByRole('link', { name: /View details/, exact: true });
  await details.hover();
  await expect(card).toHaveAttribute('data-tilt-active', 'true');
  await page.waitForTimeout(450);
  const point = await details.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    let y = rect.bottom;
    while (y > rect.top && !node.contains(document.elementFromPoint(x, y))) y -= 0.5;
    Reflect.set(window, '__catalogButtonProbe', { leaves: 0 });
    node.addEventListener(
      'pointerleave',
      () => (Reflect.get(window, '__catalogButtonProbe') as { leaves: number }).leaves++,
    );
    return { x, y: y - 4 };
  });
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => Reflect.get(window, '__catalogButtonProbe').leaves)).toBe(0);
  expect(await details.evaluate((node) => node.matches(':hover'))).toBe(true);
  await page.keyboard.press('Tab');
  await details.focus();
  await expect(details).toBeFocused();
  await flat(card);
});

test('touch and reduced-motion catalog cards stay flat, readable and within a narrow screen', async ({
  browser,
  baseURL,
}) => {
  for (const touch of [true, false]) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 900 },
      hasTouch: touch,
      isMobile: touch,
      reducedMotion: touch ? 'no-preference' : 'reduce',
    });
    try {
      const page = await context.newPage();
      await page.goto('/ru/cars/?pageSize=2');
      const card = page.locator('main article[data-pointer-tilt]').first();
      await card.scrollIntoViewIfNeeded();
      if (touch) await card.locator('p').first().tap();
      else await card.hover();
      await flat(card);
      await expect(card).not.toHaveAttribute('data-tilt-active', 'true');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    } finally {
      await context.close();
    }
  }
});

test('catalog refresh resets cached tilt bounds without moving the pointer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/cars/?pageSize=2');
  const card = page.locator('main article[data-pointer-tilt]').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.locator('..').boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.7);
  await expect(card).toHaveAttribute('data-tilt-active', 'true');
  const response = page.waitForResponse(
    (value) => new URL(value.url()).pathname === '/api/v1/vehicles/',
  );
  await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate', { state: history.state })));
  expect((await response).status()).toBe(200);
  await expect(card).not.toHaveAttribute('data-tilt-active', 'true');
  await flat(card);
});
