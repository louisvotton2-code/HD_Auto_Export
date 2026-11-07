import { expect, test, type Locator, type Page } from '@playwright/test';

async function prepareCard(
  page: Page,
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
) {
  await page.emulateMedia({ reducedMotion });
  await page.goto('/en/');
  await page.getByRole('button', { name: 'Pause autoplay', exact: true }).click();
  const card = page.locator('[data-home-section="vehicles-kia"] article').first();
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 80);
  return { card, details: card.getByRole('link', { name: 'Details', exact: true }) };
}

async function tilt(card: Locator) {
  return card.evaluate((node) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return Math.abs(m.m13) + Math.abs(m.m23);
  });
}

test('reduced-motion details keep their lower edge hovered without a geometric feedback loop', async ({
  page,
}) => {
  const { details } = await prepareCard(page, 'reduce');
  // With the card flat, this is a real point inside the button, not the axis-aligned box of
  // a perspective quadrilateral. No pointer movement follows the initial boundary entry.
  const edge = await details.boundingBox();
  await details.evaluate((node) => {
    const probe = { leaves: 0, frames: [] as boolean[] };
    Reflect.set(window, '__hdDetailsHoverProbe', probe);
    node.addEventListener('pointerleave', () => probe.leaves++);
    let remaining = 45;
    const sample = () => {
      probe.frames.push(node.matches(':hover'));
      if (--remaining > 0) requestAnimationFrame(sample);
    };
    node.addEventListener('pointerenter', () => requestAnimationFrame(sample), { once: true });
  });
  await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height - 0.5);
  await page.waitForTimeout(900);
  const probe = await page.evaluate(
    () => Reflect.get(window, '__hdDetailsHoverProbe') as { leaves: number; frames: boolean[] },
  );
  expect(probe.leaves).toBe(0);
  expect(probe.frames.length).toBeGreaterThan(5);
  expect(probe.frames.filter((hover) => !hover)).toHaveLength(0);
});

test('details stay stable inside the actual hit area while their parent card retains 3D tilt', async ({
  page,
}) => {
  const { card, details } = await prepareCard(page);
  await details.hover();
  await expect.poll(() => tilt(card)).toBeGreaterThan(0.001);
  await page.waitForTimeout(450);
  const point = await details.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2;
    let y = box.bottom;
    // DOMRect encloses the rotated quad; find its actual hit-tested lower boundary first.
    while (y > box.top && !node.contains(document.elementFromPoint(x, y))) y -= 0.5;
    return { x, y: y - 4 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(details).toBeVisible();
  const samples = await details.evaluate(
    (node) =>
      new Promise<boolean[]>((resolve) => {
        const result: boolean[] = [];
        const sample = () => {
          result.push(node.matches(':hover'));
          if (result.length < 30) requestAnimationFrame(sample);
          else resolve(result);
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(samples.every(Boolean)).toBe(true);
  await expect(card).toHaveAttribute('data-tilt-active', 'true');
});

test('mouse focus retains tilt while keyboard focus flattens the card and keeps the link usable', async ({
  page,
}) => {
  const { card, details } = await prepareCard(page);
  await details.evaluate((node) => {
    // Only prevent this test's navigation; the click still performs its native focus action.
    node.addEventListener('click', (event) => event.preventDefault(), { once: true });
  });
  await details.click();
  await expect(details).toBeFocused();
  await expect.poll(() => tilt(card)).toBeGreaterThan(0.001);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => tilt(card)).toBeLessThan(0.0001);
  await page.keyboard.press('Tab');
  await expect(details).toBeFocused();
  expect(await details.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
  await expect.poll(() => tilt(card)).toBeLessThan(0.0001);
  const href = await details.getAttribute('href');
  expect(href).toMatch(/^\/en\/cars\/.+\/$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
  await expect(page.locator('main h1')).toBeVisible();
});
